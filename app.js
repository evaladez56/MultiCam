class MultiCameraRecorder {
    constructor() {
        this.streams = [];
        this.videoElements = [];
        this.audioStreams = [];
        this.audioToggles = [];
        this.cameraSlots = [];
        this.disconnectedVideos = new Set();
        this.reconnectTimer = null;
        this.reconnectBusy = false;
        this.mediaRecorder = null;
        this.recordedChunks = [];
        this.individualRecorders = [];
        this.individualChunks = [];
        this.individualCheckboxes = [];
        this.canvas = document.getElementById('outputCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.previewCanvas = document.getElementById('previewCanvas');
        this.previewCtx = this.previewCanvas.getContext('2d');
        this.isRecording = false;
        this.isPaused = false;
        this.isPreviewing = false;
        this.animationFrameId = null;
        this.previewAnimationId = null;
        this.startTime = null;
        this.pausedAt = null;
        this.totalPausedMs = 0;
        this.timerInterval = null;
        this.activeSplitTimer = null;
        this.splitTimerStartedAt = null;
        this.machineTimeMs = 0;
        this.manualTimeMs = 0;
        this.resumeOverlayStart = null;
        this.wavRecorder = null;
        this.wavBuffers = [];
        this.wavSampleRate = 48000;
        this.activeCameraCount = 0;
        this.availableCameras = [];
        this.layoutStorageKey = 'multicam.cameraLayouts';
        this.recordingSegment = 1;
        this.hasReinitialized = false;
        this.isReinitializing = false;
        this.individualRecordersNeedRestart = false;
        
        this.initializeElements();
        this.attachEventListeners();
    }

    initializeElements() {
        this.cameraCountSelect = document.getElementById('cameraCount');
        this.timerOverlayCheckbox = document.getElementById('timerOverlay');
        this.filenamePrefixInput = document.getElementById('filenamePrefix');
        this.setupButton = document.getElementById('setupCameras');
        this.startButton = document.getElementById('startRecording');
        this.pauseButton = document.getElementById('pauseRecording');
        this.stopButton = document.getElementById('stopRecording');
        this.videoGrid = document.getElementById('videoGrid');
        this.previewContainer = document.querySelector('.preview-container');
        this.cameraSelection = document.getElementById('cameraSelection');
        this.statusText = document.getElementById('statusText');
        this.recordingIndicator = document.getElementById('recordingIndicator');
        this.recordingTime = document.getElementById('recordingTime');
        this.splitTimerControls = document.getElementById('splitTimerControls');
        this.machineTimeBtn = document.getElementById('machineTimeBtn');
        this.manualTimeBtn = document.getElementById('manualTimeBtn');
    }

    attachEventListeners() {
        this.setupButton.addEventListener('click', () => this.onSetupButtonClick());
        this.startButton.addEventListener('click', () => this.startRecording());
        this.pauseButton.addEventListener('click', () => this.togglePauseRecording());
        this.stopButton.addEventListener('click', () => this.stopRecording());
        this.machineTimeBtn.addEventListener('click', () => this.toggleSplitTimer('machine'));
        this.manualTimeBtn.addEventListener('click', () => this.toggleSplitTimer('manual'));
        if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
            navigator.mediaDevices.addEventListener('devicechange', () => this.refreshDetectedCameraCount());
        }
        this.toggleSelectionBtn = document.getElementById('toggleSelection');
        this.toggleSelectionBtn.addEventListener('click', () => this.toggleSelectionSection());
    }

    toggleSelectionSection() {
        const collapsed = this.cameraSelection.classList.toggle('collapsed');
        this.toggleSelectionBtn.setAttribute('aria-expanded', String(!collapsed));
        this.toggleSelectionBtn.innerHTML = collapsed
            ? '&#9654; Show Camera &amp; Audio Selection'
            : '&#9660; Hide Camera &amp; Audio Selection';
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    describeMediaError(error) {
        const name = error && error.name;
        const reasons = {
            NotAllowedError: 'permission denied (check the browser and Windows camera privacy settings)',
            SecurityError: 'blocked for security reasons (use https:// or http://localhost)',
            NotFoundError: 'camera not found (unplugged or no power?)',
            NotReadableError: 'camera is in use by another app, or has a USB power/bandwidth problem',
            AbortError: 'camera failed to start (driver or USB problem)',
            OverconstrainedError: 'device not available under that ID or does not support the requested settings',
            TypeError: 'invalid camera request'
        };
        return reasons[name] || (error && error.message) || 'unknown error';
    }

    async probePermission(constraints) {
        const probe = await navigator.mediaDevices.getUserMedia(constraints);
        probe.getTracks().forEach(track => track.stop());
        await this.delay(200);
    }

    async getAvailableCameras() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            this.updateStatus('Camera access is unavailable. Open this page via https:// or http://localhost in Chrome or Edge.');
            return [];
        }
        
        let probeError = null;
        try {
            await this.probePermission({ video: true, audio: false });
        } catch (error) {
            probeError = error;
            console.warn('Camera permission probe failed:', error);
        }
        
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const cameras = devices.filter(device => device.kind === 'videoinput');
            
            console.log('Found cameras:', cameras.map(c => ({ 
                label: c.label, 
                id: c.deviceId ? c.deviceId.slice(-4) : 'none',
                fullId: c.deviceId 
            })));
            
            if (probeError && (probeError.name === 'NotAllowedError' || probeError.name === 'SecurityError' || cameras.length === 0)) {
                this.updateStatus(`Error accessing cameras: ${this.describeMediaError(probeError)}.`);
                return [];
            }
            
            this.availableCameras = cameras;
            return cameras;
        } catch (error) {
            console.error('Error getting cameras:', error);
            this.updateStatus(`Error accessing cameras: ${this.describeMediaError(error)}.`);
            return [];
        }
    }

    async getAvailableAudioDevices() {
        try {
            await this.probePermission({ audio: true });
            
            const devices = await navigator.mediaDevices.enumerateDevices();
            const audioDevices = devices.filter(device => device.kind === 'audioinput');
            
            console.log('Found audio devices:', audioDevices.map(a => ({ 
                label: a.label, 
                id: a.deviceId ? a.deviceId.slice(-4) : 'none'
            })));
            
            return audioDevices;
        } catch (error) {
            console.error('Error getting audio devices:', error);
            return [];
        }
    }

    deviceSignature(cameras) {
        return cameras
            .map(c => c.deviceId)
            .filter(Boolean)
            .sort()
            .join('|');
    }

    layoutKey(cameras, cameraCount) {
        return `${cameraCount}::${this.deviceSignature(cameras)}`;
    }

    readLayoutStore() {
        try {
            const raw = localStorage.getItem(this.layoutStorageKey);
            const parsed = raw ? JSON.parse(raw) : {};
            return (parsed && typeof parsed === 'object') ? parsed : {};
        } catch (error) {
            console.warn('Could not read saved camera layouts:', error);
            return {};
        }
    }

    writeLayoutStore(store) {
        try {
            localStorage.setItem(this.layoutStorageKey, JSON.stringify(store));
        } catch (error) {
            console.warn('Could not save camera layout:', error);
        }
    }

    getSavedLayout(cameras, cameraCount) {
        const saved = this.readLayoutStore()[this.layoutKey(cameras, cameraCount)];
        
        if (!Array.isArray(saved) || saved.length !== cameraCount) return null;
        
        // Only reuse the arrangement if every remembered device is still present.
        const available = new Set(cameras.map(c => c.deviceId));
        if (!saved.every(id => available.has(id))) return null;
        
        return saved;
    }

    saveCameraLayout(cameraCount) {
        const cameras = this.availableCameras;
        if (!cameras || cameras.length === 0) return;
        
        const ids = this.getCameraSelects(cameraCount).map(s => s.value);
        if (ids.length !== cameraCount || ids.some(id => !id)) return;
        
        const store = this.readLayoutStore();
        store[this.layoutKey(cameras, cameraCount)] = ids;
        this.writeLayoutStore(store);
    }

    onSetupButtonClick() {
        // While a recording is in progress this button re-initializes the cameras
        // in place instead of starting a fresh cold setup.
        if (this.isRecording) {
            this.reinitializeCamerasWhilePaused();
        } else {
            this.setupCameras();
        }
    }

    updateSetupButtonMode() {
        this.audioToggles.forEach(toggle => {
            toggle.disabled = this.isRecording;
            toggle.title = this.isRecording ? 'Audio inputs are locked while recording.' : '';
        });
        if (this.isRecording) {
            this.setupButton.textContent = 'Re-initialize Cameras';
            this.setupButton.disabled = !this.isPaused || this.isReinitializing;
        } else {
            this.setupButton.textContent = 'Initialize Cameras';
            this.setupButton.disabled = this.isReinitializing;
        }
    }

    async setupCameras() {
        this.setupButton.disabled = true;
        this.startButton.disabled = true;
        
        this.cleanup();
        
        const cameraCount = parseInt(this.cameraCountSelect.value);
        const cameras = await this.getAvailableCameras();
        const audioDevices = await this.getAvailableAudioDevices();
        
        if (cameras.length === 0) {
            this.updateStatus('No cameras found. Please connect a camera and try again.');
            this.updateSetupButtonMode();
            return;
        }

        const savedLayout = this.getSavedLayout(cameras, cameraCount);
        const restoredNote = savedLayout ? ' Restored your last arrangement.' : '';
        this.updateStatus(`Found ${cameras.length} camera(s) and ${audioDevices.length} audio device(s). Setting up...${restoredNote}`);
        
        this.createCameraSelectionUI(cameras, cameraCount, audioDevices, savedLayout);
        await this.initializeCameras(cameraCount);
        this.updateSetupButtonMode();
    }

    createCameraSelectionUI(cameras, cameraCount, audioDevices, preferredIds = null) {
        this.audioToggles = [];
        this.cameraSelection.innerHTML = '';
        
        const counter = document.createElement('div');
        counter.id = 'cameraCounter';
        counter.className = 'camera-counter';
        this.cameraSelection.appendChild(counter);
        this.updateCameraCounter();
        
        this.cameraSelection.appendChild(this.buildCameraDropdowns(cameras, cameraCount, preferredIds));
        
        if (audioDevices.length > 0) {
            const audioSection = document.createElement('div');
            audioSection.className = 'audio-select-section';
            
            const audioTitle = document.createElement('h3');
            audioTitle.textContent = 'Audio Inputs';
            audioSection.appendChild(audioTitle);
            
            const audioContainer = document.createElement('div');
            audioContainer.className = 'audio-select-group';
            
            audioDevices.forEach((device, index) => {
                const audioItem = document.createElement('div');
                audioItem.className = 'audio-select-item';
                
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.id = `audio-${index}`;
                checkbox.value = device.deviceId;
                checkbox.checked = index === 0;
                
                const label = document.createElement('label');
                label.htmlFor = `audio-${index}`;
                const deviceIdSuffix = device.deviceId.slice(-4);
                const deviceName = device.label || `Audio Device ${index + 1}`;
                label.textContent = `${deviceName} (...${deviceIdSuffix})`;
                
                const meter = document.createElement('canvas');
                meter.className = 'audio-meter';
                meter.width = 160;
                meter.height = 24;
                this.drawAudioMeter(meter, null);
                
                checkbox.addEventListener('change', () => {
                    if (checkbox.checked) {
                        this.startAudioMeter(checkbox, meter);
                    } else {
                        this.removeAudioDevice(checkbox);
                    }
                });
                
                audioItem.appendChild(checkbox);
                audioItem.appendChild(label);
                audioItem.appendChild(meter);
                audioContainer.appendChild(audioItem);
                
                this.audioToggles.push(checkbox);
                checkbox.meterCanvas = meter;
            });
            
            audioSection.appendChild(audioContainer);
            this.cameraSelection.appendChild(audioSection);
        }
    }

    buildCameraDropdowns(cameras, cameraCount, preferredIds = null) {
        const container = document.createElement('div');
        container.className = 'camera-select-group';
        
        for (let i = 0; i < cameraCount; i++) {
            const selectItem = document.createElement('div');
            selectItem.className = 'camera-select-item';
            
            const label = document.createElement('label');
            label.textContent = `Camera ${i + 1}:`;
            
            const select = document.createElement('select');
            select.id = `camera-${i}`;
            select.className = 'camera-select';
            
            const preferred = preferredIds ? preferredIds[i] : null;
            const preferredAvailable = preferred && cameras.some(c => c.deviceId === preferred);
            
            cameras.forEach((camera, index) => {
                const option = document.createElement('option');
                option.value = camera.deviceId;
                
                const deviceIdSuffix = camera.deviceId.slice(-4);
                const baseName = camera.label || `Camera ${index + 1}`;
                const sameName = cameras.filter(c => (c.label || '') === (camera.label || ''));
                const prefix = camera.label && sameName.length > 1
                    ? `${this.toBoldDigits(sameName.indexOf(camera) + 1)} `
                    : '';
                option.textContent = `${prefix}${baseName} (...${deviceIdSuffix})`;
                
                const isSelected = preferredAvailable
                    ? camera.deviceId === preferred
                    : index === i % cameras.length;
                
                if (isSelected) {
                    option.selected = true;
                }
                select.appendChild(option);
            });
            
            select.addEventListener('change', () => this.onCameraSelectChange(cameraCount));
            
            selectItem.appendChild(label);
            selectItem.appendChild(select);
            container.appendChild(selectItem);
        }
        
        return container;
    }

    onCameraSelectChange(cameraCount) {
        if (this.isRecording) {
            // Rearranging mid-recording is only safe while paused.
            if (this.isPaused) {
                this.reinitializeCamerasWhilePaused();
            }
            return;
        }
        
        if (this.streams.length > 0) {
            this.initializeCameras(cameraCount);
        }
    }

    refreshCameraDropdowns(cameras, cameraCount) {
        const currentSelections = this.getCameraSelects(cameraCount).map(s => s.value);
        const replacement = this.buildCameraDropdowns(cameras, cameraCount, currentSelections);
        const existing = this.cameraSelection.querySelector('.camera-select-group');
        
        if (existing) {
            existing.replaceWith(replacement);
        } else {
            this.cameraSelection.prepend(replacement);
        }
    }

    getCameraSelects(cameraCount) {
        return Array.from({ length: cameraCount }, (_, i) => document.getElementById(`camera-${i}`)).filter(Boolean);
    }

    async initializeCameras(cameraCount) {
        const selects = this.getCameraSelects(cameraCount);
        selects.forEach(s => s.disabled = true);
        this.cleanup();
        this.updateStatus('Initializing cameras...');
        
        await this.acquireCameraStreams(cameraCount);
        
        const audioPromises = this.audioToggles.map(async (toggle, index) => {
            if (toggle.checked) {
                try {
                    const audioStream = await this.openAudioDevice(toggle.value);
                    this.audioStreams.push(audioStream);
                    console.log(`Initialized audio device ${index + 1}:`, audioStream.getAudioTracks()[0].label);
                } catch (error) {
                    console.error(`Error accessing audio device ${index + 1}:`, error);
                }
            }
        });
        
        await Promise.all(audioPromises);
        
        console.log(`Total audio streams initialized: ${this.audioStreams.length}`);
        
        this.audioToggles.forEach(toggle => {
            if (toggle.checked) this.startAudioMeter(toggle, toggle.meterCanvas);
        });
        
        this.toggleSelectionBtn.classList.add('visible');
        this.setupCanvas(cameraCount);
        this.updateStatus('Cameras ready! Click "Start Recording" to begin.');
        this.startButton.disabled = false;
        this.getCameraSelects(cameraCount).forEach(s => s.disabled = false);
        this.startPreview();
    }

    drawAudioMeter(canvas, levels) {
        const ctx = canvas.getContext('2d');
        const bars = 16;
        const gap = 2;
        const barWidth = (canvas.width - gap * (bars - 1)) / bars;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        for (let i = 0; i < bars; i++) {
            const level = levels ? levels[i] : 0;
            const h = Math.max(2, level * canvas.height);
            ctx.fillStyle = level > 0.02 ? '#3D4DFF' : '#BCBDC2';
            ctx.fillRect(i * (barWidth + gap), (canvas.height - h) / 2, barWidth, h);
        }
    }

    async startAudioMeter(checkbox, canvas) {
        this.stopAudioMeter(checkbox);
        if (!canvas) return;
        
        if (!this.audioMeters) this.audioMeters = new Map();
        const entry = { cancelled: false, context: null, raf: null, canvas };
        this.audioMeters.set(checkbox, entry);
        
        try {
            let stream = this.findAudioStream(checkbox.value);
            
            if (!stream) {
                stream = await this.openAudioDevice(checkbox.value);
                
                const openedId = stream.getAudioTracks()[0].getSettings().deviceId;
                const duplicate = this.audioStreams.some(s => s.getAudioTracks()[0].getSettings().deviceId === openedId);
                if (entry.cancelled || duplicate) {
                    stream.getTracks().forEach(t => t.stop());
                    if (duplicate) throw new Error('this input is the same device as one already selected');
                    return;
                }
                this.audioStreams.push(stream);
            }
            
            const context = new AudioContext();
            const analyser = context.createAnalyser();
            analyser.fftSize = 256;
            analyser.smoothingTimeConstant = 0.7;
            context.createMediaStreamSource(stream).connect(analyser);
            entry.context = context;
            
            const bins = new Uint8Array(analyser.frequencyBinCount);
            const bars = 16;
            const usable = Math.floor(bins.length * 0.75);
            const perBar = Math.max(1, Math.floor(usable / bars));
            
            const tick = () => {
                if (entry.cancelled) return;
                analyser.getByteFrequencyData(bins);
                const levels = [];
                for (let b = 0; b < bars; b++) {
                    let sum = 0;
                    for (let k = 0; k < perBar; k++) sum += bins[b * perBar + k];
                    levels.push(Math.min(1, (sum / perBar / 255) * 1.6));
                }
                this.drawAudioMeter(canvas, levels);
                entry.raf = requestAnimationFrame(tick);
            };
            tick();
        } catch (error) {
            console.error('Could not start audio meter:', error);
            this.audioMeters.delete(checkbox);
            this.drawAudioMeter(canvas, null);
            checkbox.checked = false;
            this.updateStatus(`Could not open audio device: ${this.describeMediaError(error)}.`);
        }
    }

    async openAudioDevice(deviceId) {
        let stream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: deviceId } }, video: false });
        } catch (error) {
            if (error.name !== 'OverconstrainedError' && error.name !== 'NotFoundError') throw error;
            console.warn('Exact audio device ID rejected, retrying with a preferred ID:', error);
            stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { ideal: deviceId } }, video: false });
        }
        stream.requestedDeviceId = deviceId;
        return stream;
    }

    findAudioStream(deviceId) {
        return this.audioStreams.find(s => {
            const track = s.getAudioTracks()[0];
            return track && track.readyState === 'live' &&
                (s.requestedDeviceId === deviceId || track.getSettings().deviceId === deviceId);
        });
    }

    removeAudioDevice(checkbox) {
        this.stopAudioMeter(checkbox);
        const stream = this.findAudioStream(checkbox.value);
        if (!stream) return;
        stream.getTracks().forEach(t => t.stop());
        this.audioStreams = this.audioStreams.filter(s => s !== stream);
    }

    stopAudioMeter(checkbox) {
        const entry = this.audioMeters && this.audioMeters.get(checkbox);
        if (!entry) return;
        
        entry.cancelled = true;
        if (entry.raf) cancelAnimationFrame(entry.raf);
        if (entry.context) entry.context.close();
        this.audioMeters.delete(checkbox);
        this.drawAudioMeter(entry.canvas, null);
    }

    stopAllAudioMeters() {
        if (!this.audioMeters) return;
        Array.from(this.audioMeters.keys()).forEach(checkbox => this.stopAudioMeter(checkbox));
    }

    toBoldDigits(n) {
        return String(n).replace(/\d/g, d => String.fromCodePoint(0x1D7CE + Number(d)));
    }

    updateCameraCounter(count = (this.availableCameras || []).length) {
        const el = document.getElementById('cameraCounter');
        if (el) el.textContent = `Cameras detected: ${count}`;
    }

    setCameraStatus(select, status, detail = '') {
        if (!select) return;
        select.classList.remove('camera-status-pending', 'camera-status-ready', 'camera-status-error', 'camera-status-blank');
        select.classList.add(`camera-status-${status}`);
        select.title = detail;
    }

    buildVideoConstraintTiers(deviceId, cameraCount) {
        const device = deviceId ? { deviceId: { exact: deviceId } } : {};
        const lowBandwidth = cameraCount >= 6;
        return [
            { ...device, width: { ideal: lowBandwidth ? 640 : 1280 }, height: { ideal: lowBandwidth ? 480 : 720 }, frameRate: { ideal: 30 } },
            { ...device, width: { ideal: 640 }, height: { ideal: 480 } },
            { ...device }
        ];
    }

    async openCameraWithFallback(deviceId, cameraCount) {
        const tiers = this.buildVideoConstraintTiers(deviceId, cameraCount);
        let lastError = null;
        
        for (let attempt = 0; attempt < 2; attempt++) {
            if (attempt > 0) await this.delay(700);
            for (const video of tiers) {
                try {
                    return await navigator.mediaDevices.getUserMedia({ video, audio: false });
                } catch (error) {
                    lastError = error;
                    console.warn('Camera open attempt failed:', error.name, video);
                    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') throw error;
                }
            }
        }
        throw lastError;
    }

    async verifyVideoHasPicture(video, select, cameraNumber) {
        const sample = document.createElement('canvas');
        sample.width = sample.height = 16;
        const sctx = sample.getContext('2d', { willReadFrequently: true });
        
        let brightest = 0;
        let lastReadyState = 0;
        for (let attempt = 0; attempt < 8; attempt++) {
            await this.delay(500);
            if (!video.isConnected || !this.videoElements.includes(video)) return;
            
            lastReadyState = video.readyState;
            if (video.readyState >= 2 && video.videoWidth > 0) {
                sctx.drawImage(video, 0, 0, 16, 16);
                const data = sctx.getImageData(0, 0, 16, 16).data;
                let min = 765;
                let max = 0;
                for (let p = 0; p < data.length; p += 4) {
                    const sum = data[p] + data[p + 1] + data[p + 2];
                    min = Math.min(min, sum);
                    max = Math.max(max, sum);
                }
                brightest = Math.max(brightest, max);
                if (max > 6 || max - min > 3) {
                    this.setCameraStatus(select, 'ready', 'Camera is on and sending a picture.');
                    return;
                }
            }
        }
        console.warn(`Camera ${cameraNumber} flagged blank: brightest=${brightest}, readyState=${lastReadyState}, size=${video.videoWidth}x${video.videoHeight}`);
        
        const detail = 'Camera opened but is sending a black or empty picture (lens covered, USB power/bandwidth issue, or driver problem).';
        this.setCameraStatus(select, 'blank', detail);
        this.updateStatus(`Camera ${cameraNumber}: ${detail}`);
    }

    watchCameraTrack(slot) {
        const stream = slot.stream;
        stream.getVideoTracks()[0].addEventListener('ended', () => this.handleCameraTrackEnded(slot, stream));
    }

    handleCameraTrackEnded(slot, stream) {
        if (slot.stream !== stream || !this.streams.includes(stream)) return;
        
        const detail = 'Camera disconnected or stopped sending video.';
        this.setCameraStatus(slot.select, 'error', detail);
        
        if (!this.isRecording) {
            this.updateStatus(`Camera ${slot.number}: ${detail} Reconnect it, then re-initialize.`);
            return;
        }
        
        this.disconnectedVideos.add(slot.video);
        slot.container.classList.add('disconnected');
        
        const index = this.videoElements.indexOf(slot.video);
        const entry = this.individualRecorders.find(e => e.index === index && e.recorder && e.recorder.state !== 'inactive');
        if (entry) {
            slot.nextSegment = entry.segment + 1;
            this.hasReinitialized = true;
            entry.recorder.stop();
        }
        
        this.updateStatus(`Camera ${slot.number} disconnected. Recording continues; plug it back in and it will reconnect automatically.`);
        this.startReconnectWatch();
    }

    startReconnectWatch() {
        if (this.reconnectTimer) return;
        this.reconnectTimer = setInterval(() => this.tryReconnectCameras(), 2000);
    }

    stopReconnectWatch() {
        if (this.reconnectTimer) clearInterval(this.reconnectTimer);
        this.reconnectTimer = null;
    }

    async tryReconnectCameras() {
        if (this.reconnectBusy) return;
        
        const pending = this.cameraSlots.filter(slot => this.disconnectedVideos.has(slot.video));
        if (pending.length === 0) {
            this.stopReconnectWatch();
            return;
        }
        
        this.reconnectBusy = true;
        try {
            const devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
            
            for (const slot of pending) {
                if (!this.disconnectedVideos.has(slot.video)) continue;
                const inUse = new Set(this.cameraSlots.filter(s => !this.disconnectedVideos.has(s.video)).map(s => s.deviceId));
                const match = devices.find(d => d.deviceId === slot.deviceId) ||
                    devices.find(d => slot.trackLabel && d.label === slot.trackLabel && !inUse.has(d.deviceId));
                if (!match) continue;
                
                try {
                    await this.reconnectSlot(slot, match.deviceId);
                } catch (error) {
                    console.warn(`Camera ${slot.number} reconnect attempt failed:`, error);
                }
            }
        } catch (error) {
            console.warn('Could not check for reconnected cameras:', error);
        } finally {
            this.reconnectBusy = false;
        }
    }

    async reconnectSlot(slot, deviceId) {
        const stream = await this.openCameraWithFallback(deviceId, this.activeCameraCount);
        
        if (!this.disconnectedVideos.has(slot.video) || !this.cameraSlots.includes(slot)) {
            stream.getTracks().forEach(track => track.stop());
            return;
        }
        
        const index = this.videoElements.indexOf(slot.video);
        slot.stream = stream;
        slot.deviceId = deviceId;
        slot.trackLabel = stream.getVideoTracks()[0].label || slot.trackLabel;
        this.streams[index] = stream;
        slot.video.srcObject = stream;
        this.watchCameraTrack(slot);
        
        if (Array.from(slot.select.options).some(o => o.value === deviceId)) slot.select.value = deviceId;
        
        this.disconnectedVideos.delete(slot.video);
        slot.container.classList.remove('disconnected');
        this.setCameraStatus(slot.select, 'pending', 'Camera reconnected. Checking for a picture...');
        this.verifyVideoHasPicture(slot.video, slot.select, slot.number);
        
        const checkbox = this.individualCheckboxes[index];
        if (this.isRecording && checkbox && checkbox.checked && slot.nextSegment) {
            this.startIndividualRecording(index, slot.nextSegment);
            if (this.isPaused) {
                const entry = this.individualRecorders[this.individualRecorders.length - 1];
                if (entry && entry.recorder.state === 'recording') entry.recorder.pause();
            }
        }
        slot.nextSegment = null;
        
        this.updateStatus(this.isRecording ? `Camera ${slot.number} reconnected. Recording continues.` : `Camera ${slot.number} reconnected.`);
    }

    async refreshDetectedCameraCount() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const count = devices.filter(d => d.kind === 'videoinput').length;
            this.updateCameraCounter(count);
            if (this.disconnectedVideos.size > 0) {
                this.tryReconnectCameras();
            } else if (this.streams.length > 0) {
                this.updateStatus(`Camera list changed (${count} detected). Re-initialize cameras to pick up changes.`);
            }
        } catch (error) {
            console.warn('Could not refresh camera count:', error);
        }
    }

    async acquireCameraStreams(cameraCount) {
        this.activeCameraCount = cameraCount;
        this.videoGrid.className = `video-grid grid-${cameraCount}`;
        
        for (let i = 0; i < cameraCount; i++) {
            const select = document.getElementById(`camera-${i}`);
            const deviceId = select ? select.value : undefined;
            this.setCameraStatus(select, 'pending', 'Opening camera...');
            if (i > 0) await this.delay(300);
            
            try {
                const stream = await this.openCameraWithFallback(deviceId, cameraCount);
                this.streams.push(stream);
                const cameraNumber = i + 1;
                
                const videoContainer = document.createElement('div');
                videoContainer.className = 'video-container';
                
                const video = document.createElement('video');
                video.srcObject = stream;
                video.autoplay = true;
                video.muted = true;
                video.playsInline = true;
                
                const actualDeviceLabel = stream.getVideoTracks()[0].label;
                const deviceIdSuffix = deviceId ? deviceId.slice(-4) : '';
                
                const label = document.createElement('div');
                label.className = 'video-label';
                label.textContent = deviceIdSuffix ? `Camera ${i + 1} (...${deviceIdSuffix})` : `Camera ${i + 1}`;
                
                const checkboxContainer = document.createElement('div');
                checkboxContainer.className = 'individual-record-checkbox';
                
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.id = `record-individual-${i}`;
                checkbox.checked = false;
                
                const checkboxLabel = document.createElement('label');
                checkboxLabel.htmlFor = `record-individual-${i}`;
                checkboxLabel.textContent = 'Record Separately';
                
                checkboxContainer.appendChild(checkbox);
                checkboxContainer.appendChild(checkboxLabel);
                
                videoContainer.appendChild(video);
                videoContainer.appendChild(label);
                videoContainer.appendChild(checkboxContainer);
                
                const offline = document.createElement('div');
                offline.className = 'video-offline';
                offline.textContent = `Camera ${cameraNumber} disconnected. Waiting for it to reconnect...`;
                videoContainer.appendChild(offline);
                
                this.videoGrid.appendChild(videoContainer);
                
                this.videoElements.push(video);
                this.individualCheckboxes.push(checkbox);
                
                const slot = { video, stream, select, container: videoContainer, number: cameraNumber, deviceId, trackLabel: stream.getVideoTracks()[0].label, nextSegment: null };
                this.cameraSlots.push(slot);
                this.watchCameraTrack(slot);
                this.setCameraStatus(select, 'pending', 'Camera opened. Checking for a picture...');
                this.verifyVideoHasPicture(video, select, cameraNumber);
                
            } catch (error) {
                console.error(`Error accessing camera ${i + 1}:`, error);
                const reason = this.describeMediaError(error);
                this.setCameraStatus(select, 'error', reason);
                this.updateStatus(`Error accessing camera ${i + 1}: ${reason}.`);
                
                const videoContainer = document.createElement('div');
                videoContainer.className = 'video-container';
                videoContainer.style.background = '#333';
                videoContainer.innerHTML = `<div class="video-label">Camera ${i + 1} - Error</div>`;
                this.videoGrid.appendChild(videoContainer);
            }
        }
        
        this.saveCameraLayout(cameraCount);
    }

    setupCanvas(cameraCount) {
        let cols, rows;
        
        if (cameraCount === 1) {
            cols = 1;
            rows = 1;
        } else if (cameraCount === 2) {
            cols = 2;
            rows = 1;
        } else if (cameraCount <= 4) {
            cols = 2;
            rows = 2;
        } else if (cameraCount <= 6) {
            cols = 3;
            rows = 2;
        } else {
            cols = 3;
            rows = 3;
        }
        
        this.canvas.width = 1920;
        this.canvas.height = 1080;
        
        const gridRect = this.videoGrid.getBoundingClientRect();
        this.previewCanvas.width = gridRect.width;
        this.previewCanvas.height = gridRect.height;
        
        this.gridLayout = {
            cols,
            rows,
            cellWidth: this.canvas.width / cols,
            cellHeight: this.canvas.height / rows
        };
    }

    startPreview() {
        this.isPreviewing = true;
        this.drawPreview();
    }

    drawPreview() {
        if (!this.isPreviewing) return;
        
        this.previewCtx.clearRect(0, 0, this.previewCanvas.width, this.previewCanvas.height);
        
        if (this.isRecording && this.timerOverlayCheckbox.checked) {
            this.drawTimerOverlay(this.previewCtx, this.previewCanvas.width, this.previewCanvas.height);
        }
        
        if (this.isRecording) {
            this.drawSplitTimerOverlays(this.previewCtx, this.previewCanvas.width, this.previewCanvas.height);
            this.drawResumeOverlay(this.previewCtx, this.previewCanvas.width, this.previewCanvas.height);
        }
        
        this.previewAnimationId = requestAnimationFrame(() => this.drawPreview());
    }

    drawVideoGrid() {
        if (!this.isRecording) return;
        
        this.ctx.fillStyle = '#000000';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        
        this.videoElements.forEach((video, index) => {
            if (this.disconnectedVideos.has(video)) {
                this.drawOfflineCell(index);
                return;
            }
            if (video.readyState === video.HAVE_ENOUGH_DATA) {
                const col = index % this.gridLayout.cols;
                const row = Math.floor(index / this.gridLayout.cols);
                
                const x = col * this.gridLayout.cellWidth;
                const y = row * this.gridLayout.cellHeight;
                const cellW = this.gridLayout.cellWidth;
                const cellH = this.gridLayout.cellHeight;
                
                // Preserve aspect ratio (object-fit: cover) by cropping the source
                const srcW = video.videoWidth;
                const srcH = video.videoHeight;
                
                if (srcW > 0 && srcH > 0) {
                    const srcAspect = srcW / srcH;
                    const cellAspect = cellW / cellH;
                    
                    let sx, sy, sWidth, sHeight;
                    if (srcAspect > cellAspect) {
                        // Source is wider than cell — crop left/right
                        sHeight = srcH;
                        sWidth = srcH * cellAspect;
                        sx = (srcW - sWidth) / 2;
                        sy = 0;
                    } else {
                        // Source is taller than cell — crop top/bottom
                        sWidth = srcW;
                        sHeight = srcW / cellAspect;
                        sx = 0;
                        sy = (srcH - sHeight) / 2;
                    }
                    
                    this.ctx.drawImage(
                        video,
                        sx, sy, sWidth, sHeight,
                        x, y, cellW, cellH
                    );
                } else {
                    this.ctx.drawImage(video, x, y, cellW, cellH);
                }
                
                this.drawCameraLabel(this.ctx, `Camera ${index + 1}`, x, y, this.canvas.width);
            }
        });
        
        if (this.timerOverlayCheckbox.checked) {
            this.drawTimerOverlay(this.ctx, this.canvas.width, this.canvas.height);
        }
        
        this.drawSplitTimerOverlays(this.ctx, this.canvas.width, this.canvas.height);
        this.drawResumeOverlay(this.ctx, this.canvas.width, this.canvas.height);
        
        this.animationFrameId = requestAnimationFrame(() => this.drawVideoGrid());
    }

    drawOfflineCell(index) {
        const { cols, cellWidth, cellHeight } = this.gridLayout;
        const x = (index % cols) * cellWidth;
        const y = Math.floor(index / cols) * cellHeight;
        const scale = this.canvas.width / 1920;
        const ctx = this.ctx;
        
        ctx.fillStyle = '#000000';
        ctx.fillRect(x, y, cellWidth, cellHeight);
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `bold ${28 * scale}px Arial`;
        ctx.fillText(`Camera ${index + 1} disconnected`, x + cellWidth / 2, y + cellHeight / 2 - 16 * scale);
        ctx.font = `${18 * scale}px Arial`;
        ctx.fillText('Waiting for reconnect...', x + cellWidth / 2, y + cellHeight / 2 + 20 * scale);
        ctx.textAlign = 'start';
        
        this.drawCameraLabel(ctx, `Camera ${index + 1}`, x, y, this.canvas.width);
    }

    drawCameraLabel(ctx, label, x, y, canvasWidth) {
        const scale = canvasWidth / 1920;
        const padding = 10 * scale;
        const labelWidth = 120 * scale;
        const labelHeight = 30 * scale;
        const fontSize = 16 * scale;
        
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(x + padding, y + padding, labelWidth, labelHeight);
        ctx.fillStyle = '#ffffff';
        ctx.font = `bold ${fontSize}px Arial`;
        ctx.textBaseline = 'top';
        ctx.fillText(label, x + padding * 2, y + padding + (labelHeight - fontSize) / 2);
    }

    drawTimerOverlay(ctx, canvasWidth, canvasHeight) {
        const pauseOffset = this.totalPausedMs + (this.isPaused ? Date.now() - this.pausedAt : 0);
        const elapsed = Date.now() - this.startTime - pauseOffset;
        const totalSeconds = Math.floor(elapsed / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        
        const timeString = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        
        const scale = canvasWidth / 1920;
        const padding = 30 * scale;
        const fontSize = 48 * scale;
        ctx.font = `bold ${fontSize}px Arial`;
        const textMetrics = ctx.measureText(timeString);
        const textWidth = textMetrics.width;
        const textHeight = fontSize;
        
        const bgX = canvasWidth - textWidth - padding * 2 - 20 * scale;
        const bgY = canvasHeight - textHeight - padding * 2 - 20 * scale;
        const bgWidth = textWidth + padding * 2;
        const bgHeight = textHeight + padding * 1.5;
        
        ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
        ctx.fillRect(bgX, bgY, bgWidth, bgHeight);
        
        ctx.fillStyle = '#ffffff';
        ctx.textBaseline = 'top';
        ctx.fillText(timeString, bgX + padding, bgY + padding);
    }

    startRecording() {
        if (this.streams.length === 0) {
            this.updateStatus('Please setup cameras first.');
            return;
        }
        
        this.recordedChunks = [];
        this.individualRecorders = [];
        this.individualChunks = [];
        this.isRecording = true;
        this.isPaused = false;
        this.totalPausedMs = 0;
        this.pausedAt = null;
        this.startTime = Date.now();
        this.recordingSegment = 1;
        this.hasReinitialized = false;
        this.individualRecordersNeedRestart = false;
        
        this.drawVideoGrid();
        
        const canvasStream = this.canvas.captureStream(30);
        
        if (this.audioStreams.length > 0) {
            console.log(`Mixing ${this.audioStreams.length} audio stream(s)`);
            const audioContext = new AudioContext();
            const destination = audioContext.createMediaStreamDestination();
            
            this.audioStreams.forEach((stream, idx) => {
                const source = audioContext.createMediaStreamSource(stream);
                source.connect(destination);
                console.log(`Connected audio source ${idx + 1}:`, stream.getAudioTracks()[0].label);
            });
            
            this.mixedAudioTrack = destination.stream.getAudioTracks()[0];
            canvasStream.addTrack(this.mixedAudioTrack);
            console.log('Mixed audio track added to recording');
            
            this.audioContext = audioContext;
        } else {
            console.warn('No audio streams available for recording');
        }
        
        this.individualCheckboxes.forEach((checkbox, index) => {
            if (checkbox.checked && this.streams[index]) {
                this.startIndividualRecording(index, this.recordingSegment);
            }
        });
        
        const options = {
            mimeType: 'video/mp4',
            videoBitsPerSecond: 5000000
        };
        
        if (!MediaRecorder.isTypeSupported(options.mimeType)) {
            options.mimeType = 'video/webm;codecs=h264,opus';
        }
        
        if (!MediaRecorder.isTypeSupported(options.mimeType)) {
            options.mimeType = 'video/webm;codecs=vp9,opus';
        }
        
        if (!MediaRecorder.isTypeSupported(options.mimeType)) {
            options.mimeType = 'video/webm';
        }
        
        if (this.audioContext && this.audioStreams.length > 0) {
            this.startWavRecording();
        }
        
        try {
            this.mediaRecorder = new MediaRecorder(canvasStream, options);
            
            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.recordedChunks.push(event.data);
                }
            };
            
            this.mediaRecorder.onstop = () => {
                this.saveRecording();
            };
            
            this.mediaRecorder.start(100);
            
            this.updateStatus('Recording in progress...');
            this.startButton.disabled = true;
            this.pauseButton.disabled = false;
            this.stopButton.disabled = false;
            this.cameraCountSelect.disabled = true;
            this.updateSetupButtonMode();
            this.recordingIndicator.classList.add('active');
            
            this.startTimer();
            
        } catch (error) {
            console.error('Error starting recording:', error);
            this.updateStatus('Error starting recording: ' + error.message);
            this.isRecording = false;
            this.updateSetupButtonMode();
        }
    }

    startIndividualRecording(index, segment = 1) {
        const videoStream = this.streams[index];
        if (!videoStream) return;
        
        const combinedStream = new MediaStream();
        videoStream.getVideoTracks().forEach(track => combinedStream.addTrack(track));
        
        if (this.mixedAudioTrack) {
            combinedStream.addTrack(this.mixedAudioTrack);
        }
        
        const options = {
            mimeType: 'video/mp4',
            videoBitsPerSecond: 5000000
        };
        
        if (!MediaRecorder.isTypeSupported(options.mimeType)) {
            options.mimeType = 'video/webm;codecs=h264,opus';
        }
        
        if (!MediaRecorder.isTypeSupported(options.mimeType)) {
            options.mimeType = 'video/webm;codecs=vp9,opus';
        }
        
        if (!MediaRecorder.isTypeSupported(options.mimeType)) {
            options.mimeType = 'video/webm';
        }
        
        try {
            const recorder = new MediaRecorder(combinedStream, options);
            const chunks = [];
            const entry = { recorder, index, segment, includeWav: true };
            
            recorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    chunks.push(event.data);
                }
            };
            
            recorder.onstop = () => {
                this.saveIndividualRecording(chunks, index, recorder.mimeType, entry.segment, entry.includeWav);
            };
            
            recorder.start(100);
            
            this.individualRecorders.push(entry);
            this.individualChunks.push(chunks);
            
            console.log(`Started individual recording for Camera ${index + 1} (segment ${segment})`);
        } catch (error) {
            console.error(`Error starting individual recording for Camera ${index + 1}:`, error);
        }
    }

    stopRecording() {
        if (!this.isRecording) return;
        
        this.isRecording = false;
        
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
        }
        
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
        }
        
        this.stopWavRecording();
        
        this.individualRecorders.forEach(({ recorder }) => {
            if (recorder && recorder.state !== 'inactive') {
                recorder.stop();
            }
        });
        
        this.stopTimer();
        
        const individualCount = this.individualRecorders.length;
        const message = individualCount > 0 
            ? `Recording stopped. Processing ${individualCount + 1} video(s)...`
            : 'Recording stopped. Processing video...';
        this.updateStatus(message);
        
        this.startButton.disabled = false;
        this.pauseButton.disabled = true;
        this.pauseButton.textContent = 'Pause Recording';
        this.stopButton.disabled = true;
        this.cameraCountSelect.disabled = false;
        this.recordingIndicator.classList.remove('active');
        this.isPaused = false;
        this.updateSetupButtonMode();
        this.activeSplitTimer = null;
        this.splitTimerStartedAt = null;
        this.machineTimeMs = 0;
        this.manualTimeMs = 0;
        this.updateSplitTimerButtons();
    }

    togglePauseRecording() {
        if (!this.isRecording) return;
        
        if (!this.isPaused) {
            this.mediaRecorder.pause();
            this.individualRecorders.forEach(({ recorder }) => {
                if (recorder && recorder.state === 'recording') recorder.pause();
            });
            this.isPaused = true;
            this.pausedAt = Date.now();
            this.pauseButton.textContent = 'Resume Recording';
            this.updateSetupButtonMode();
            this.recordingIndicator.classList.remove('active');
            this.stopTimer();
            if (this.activeSplitTimer) {
                const now = Date.now();
                if (this.activeSplitTimer === 'machine') this.machineTimeMs += now - this.splitTimerStartedAt;
                else this.manualTimeMs += now - this.splitTimerStartedAt;
                this.splitTimerStartedAt = null;
            }
            this.updateStatus('Recording paused. You can re-initialize or rearrange cameras, then click Resume.');
        } else {
            if (this.isReinitializing) {
                this.updateStatus('Still re-initializing cameras. Please wait before resuming.');
                return;
            }
            
            this.totalPausedMs += Date.now() - this.pausedAt;
            this.pausedAt = null;
            this.mediaRecorder.resume();
            this.individualRecorders.forEach(({ recorder }) => {
                if (recorder && recorder.state === 'paused') recorder.resume();
            });
            
            if (this.individualRecordersNeedRestart) {
                this.individualRecordersNeedRestart = false;
                this.individualCheckboxes.forEach((checkbox, index) => {
                    if (checkbox.checked && this.streams[index]) {
                        this.startIndividualRecording(index, this.recordingSegment);
                    }
                });
            }
            
            this.isPaused = false;
            this.pauseButton.textContent = 'Pause Recording';
            this.updateSetupButtonMode();
            this.recordingIndicator.classList.add('active');
            if (this.activeSplitTimer) {
                this.splitTimerStartedAt = Date.now();
            }
            this.resumeOverlayStart = Date.now();
            this.startTimer();
            this.updateStatus('Recording in progress...');
        }
    }

    async reinitializeCamerasWhilePaused() {
        if (!this.isRecording || !this.isPaused) {
            this.updateStatus('Pause the recording before re-initializing cameras.');
            return;
        }
        
        if (this.isReinitializing) return;
        this.isReinitializing = true;
        
        const cameraCount = this.activeCameraCount;
        
        this.getCameraSelects(cameraCount).forEach(s => s.disabled = true);
        this.pauseButton.disabled = true;
        this.stopButton.disabled = true;
        this.updateSetupButtonMode();
        this.updateStatus('Re-initializing cameras... the recording stays paused.');
        
        // Preserve which cameras were flagged for separate recording.
        const separateFlags = this.individualCheckboxes.map(cb => cb.checked);
        
        // Per-camera recorders are bound to the raw camera tracks we are about to
        // stop, so close them out as a segment. Fresh ones start on resume.
        if (this.individualRecorders.length > 0) {
            this.hasReinitialized = true;
            this.individualRecorders.forEach(entry => {
                entry.includeWav = false;
                if (entry.recorder && entry.recorder.state !== 'inactive') {
                    entry.recorder.stop();
                }
            });
        }
        this.individualRecorders = [];
        this.individualChunks = [];
        this.recordingSegment++;
        this.individualRecordersNeedRestart = true;
        
        // Video only — the audio graph feeding the active MediaRecorder must survive.
        this.stopVideoStreams();
        
        const cameras = await this.getAvailableCameras();
        
        if (cameras.length === 0) {
            this.updateStatus('No cameras found. Reconnect a camera, then click Re-initialize Cameras again.');
            this.finishReinitialize(cameraCount);
            return;
        }
        
        this.refreshCameraDropdowns(cameras, cameraCount);
        
        // The canvas is left untouched, so the in-progress recording continues
        // into the same file once resumed.
        await this.acquireCameraStreams(cameraCount);
        
        this.individualCheckboxes.forEach((checkbox, index) => {
            if (separateFlags[index] !== undefined) {
                checkbox.checked = separateFlags[index];
            }
        });
        
        const liveCount = this.streams.length;
        this.updateStatus(`Cameras re-initialized (${liveCount}/${cameraCount} live). Rearrange if needed, then click Resume Recording.`);
        this.finishReinitialize(cameraCount);
    }

    finishReinitialize(cameraCount) {
        this.isReinitializing = false;
        this.getCameraSelects(cameraCount).forEach(s => s.disabled = false);
        this.pauseButton.disabled = false;
        this.stopButton.disabled = false;
        this.updateSetupButtonMode();
    }

    drawResumeOverlay(ctx, canvasWidth, canvasHeight) {
        if (!this.resumeOverlayStart) return;
        const elapsed = Date.now() - this.resumeOverlayStart;
        const duration = 1000;
        if (elapsed >= duration) {
            this.resumeOverlayStart = null;
            return;
        }
        const alpha = 1 - elapsed / duration;
        const scale = canvasWidth / 1920;
        const fontSize = 64 * scale;
        ctx.font = `bold ${fontSize}px Arial`;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';
        const text = 'Resumed from pause';
        const textWidth = ctx.measureText(text).width;
        const padX = 40 * scale;
        const padY = 24 * scale;
        const boxW = textWidth + padX * 2;
        const boxH = fontSize + padY * 2;
        const boxX = (canvasWidth - boxW) / 2;
        const boxY = (canvasHeight - boxH) / 2;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(boxX, boxY, boxW, boxH);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(text, canvasWidth / 2, canvasHeight / 2);
        ctx.globalAlpha = 1;
        ctx.textAlign = 'left';
    }

    toggleSplitTimer(type) {
        const now = Date.now();
        if (this.activeSplitTimer === type) {
            if (type === 'machine') this.machineTimeMs += now - this.splitTimerStartedAt;
            else this.manualTimeMs += now - this.splitTimerStartedAt;
            this.activeSplitTimer = null;
            this.splitTimerStartedAt = null;
        } else {
            if (this.activeSplitTimer === 'machine') this.machineTimeMs += now - this.splitTimerStartedAt;
            else if (this.activeSplitTimer === 'manual') this.manualTimeMs += now - this.splitTimerStartedAt;
            this.activeSplitTimer = type;
            this.splitTimerStartedAt = now;
        }
        this.updateSplitTimerButtons();
    }

    updateSplitTimerButtons() {
        const machineRunning = this.activeSplitTimer === 'machine';
        const manualRunning = this.activeSplitTimer === 'manual';
        this.machineTimeBtn.textContent = machineRunning ? 'Stop Machine Time' : 'Start Machine Time';
        this.machineTimeBtn.className = machineRunning ? 'btn btn-success' : 'btn btn-secondary';
        this.manualTimeBtn.textContent = manualRunning ? 'Stop Manual Time' : 'Start Manual Time';
        this.manualTimeBtn.className = manualRunning ? 'btn btn-success' : 'btn btn-secondary';
    }

    getSplitTimerElapsed(type) {
        const base = type === 'machine' ? this.machineTimeMs : this.manualTimeMs;
        if (this.activeSplitTimer === type && this.splitTimerStartedAt !== null) {
            return base + (Date.now() - this.splitTimerStartedAt);
        }
        return base;
    }

    drawSplitTimerOverlays(ctx, canvasWidth, canvasHeight) {
        const hasMachine = this.machineTimeMs > 0 || this.activeSplitTimer === 'machine';
        const hasManual = this.manualTimeMs > 0 || this.activeSplitTimer === 'manual';
        if (!hasMachine && !hasManual) return;

        const scale = canvasWidth / 1920;
        const fontSize = 36 * scale;
        const padding = 20 * scale;
        const lineHeight = fontSize + padding;
        const boxHeight = fontSize + padding;
        const marginLeft = 20 * scale;

        const formatMs = (ms) => {
            const totalSeconds = Math.floor(ms / 1000);
            const h = Math.floor(totalSeconds / 3600);
            const m = Math.floor((totalSeconds % 3600) / 60);
            const s = totalSeconds % 60;
            return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        };

        const entries = [];
        if (hasMachine) entries.push({ label: 'Machine Time', elapsed: this.getSplitTimerElapsed('machine'), running: this.activeSplitTimer === 'machine' });
        if (hasManual)  entries.push({ label: 'Manual Time',  elapsed: this.getSplitTimerElapsed('manual'),  running: this.activeSplitTimer === 'manual' });

        const totalHeight = entries.length * (boxHeight + 8 * scale) - 8 * scale;
        let startY = canvasHeight - totalHeight - 20 * scale;

        ctx.font = `bold ${fontSize}px Arial`;

        entries.forEach(({ label, elapsed, running }) => {
            const timeStr = formatMs(elapsed);
            const fullText = `${label}  ${timeStr}`;
            const textWidth = ctx.measureText(fullText).width;
            const boxWidth = textWidth + padding * 2;

            ctx.fillStyle = running ? 'rgba(72, 187, 120, 0.85)' : 'rgba(0, 0, 0, 0.7)';
            ctx.fillRect(marginLeft, startY, boxWidth, boxHeight);

            ctx.fillStyle = '#ffffff';
            ctx.textBaseline = 'top';
            ctx.fillText(fullText, marginLeft + padding, startY + (boxHeight - fontSize) / 2);

            startY += boxHeight + 8 * scale;
        });
    }

    saveRecording() {
        if (this.recordedChunks.length === 0) {
            this.updateStatus('No recording data available.');
            return;
        }
        
        const mimeType = this.mediaRecorder.mimeType;
        const blob = new Blob(this.recordedChunks, { type: mimeType });
        
        const now = new Date();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const year = now.getFullYear();
        
        const prefix = this.filenamePrefixInput.value.trim();
        const baseFilename = `multicam_${month}_${day}_${year}`;
        const filename = prefix ? `${prefix}_${baseFilename}` : baseFilename;
        
        const extension = mimeType.includes('mp4') ? 'mp4' : 'webm';
        this.downloadBlob(blob, `${filename}.${extension}`);
        
        if (this.wavBuffers.length > 0) {
            const wavBlob = this.encodeWav();
            this.downloadBlob(wavBlob, `${filename}_audio.wav`);
            const videoMB = (blob.size / 1024 / 1024).toFixed(2);
            const audioMB = (wavBlob.size / 1024 / 1024).toFixed(2);
            this.updateStatus(`Recording saved! ${filename}.${extension} (${videoMB} MB) + ${filename}_audio.wav (${audioMB} MB)`);
        } else {
            this.updateStatus(`Recording saved! (${(blob.size / 1024 / 1024).toFixed(2)} MB)`);
        }
        
        this.recordedChunks = [];
    }

    saveIndividualRecording(chunks, cameraIndex, mimeType, segment = null, includeWav = true) {
        if (chunks.length === 0) {
            console.warn(`No data for individual camera ${cameraIndex + 1}`);
            return;
        }
        
        const blob = new Blob(chunks, { type: mimeType });
        
        const now = new Date();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const year = now.getFullYear();
        
        const prefix = this.filenamePrefixInput.value.trim();
        const partSuffix = (segment && this.hasReinitialized) ? `_part${segment}` : '';
        const baseFilename = `camera${cameraIndex + 1}_${month}_${day}_${year}${partSuffix}`;
        const filename = prefix ? `${prefix}_${baseFilename}` : baseFilename;
        
        const extension = mimeType.includes('mp4') ? 'mp4' : 'webm';
        this.downloadBlob(blob, `${filename}.${extension}`);
        
        if (includeWav && this.wavBuffers.length > 0) {
            const wavBlob = this.encodeWav();
            this.downloadBlob(wavBlob, `${filename}_audio.wav`);
            console.log(`Camera ${cameraIndex + 1} saved: ${filename}.${extension} + ${filename}_audio.wav`);
        } else {
            console.log(`Individual recording saved for Camera ${cameraIndex + 1}: ${filename}.${extension} (${(blob.size / 1024 / 1024).toFixed(2)} MB)`);
        }
    }

    downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 100);
    }

    startWavRecording() {
        this.wavBuffers = [];
        this.wavSampleRate = this.audioContext.sampleRate;
        
        const mixedStream = new MediaStream([this.mixedAudioTrack]);
        const source = this.audioContext.createMediaStreamSource(mixedStream);
        const processor = this.audioContext.createScriptProcessor(4096, 1, 1);
        
        processor.onaudioprocess = (e) => {
            if (this.isRecording && !this.isPaused) {
                const inputData = e.inputBuffer.getChannelData(0);
                this.wavBuffers.push(new Float32Array(inputData));
            }
        };
        
        source.connect(processor);
        processor.connect(this.audioContext.destination);
        
        this.wavRecorder = { source, processor };
        console.log(`WAV recording started (${this.wavSampleRate} Hz)`);
    }

    stopWavRecording() {
        if (this.wavRecorder) {
            this.wavRecorder.processor.disconnect();
            this.wavRecorder.source.disconnect();
            this.wavRecorder = null;
        }
    }

    encodeWav() {
        const totalLength = this.wavBuffers.reduce((sum, buf) => sum + buf.length, 0);
        const pcmData = new Float32Array(totalLength);
        let offset = 0;
        for (const buf of this.wavBuffers) {
            pcmData.set(buf, offset);
            offset += buf.length;
        }
        
        const numChannels = 1;
        const bitsPerSample = 16;
        const byteRate = this.wavSampleRate * numChannels * (bitsPerSample / 8);
        const blockAlign = numChannels * (bitsPerSample / 8);
        const dataSize = pcmData.length * (bitsPerSample / 8);
        const buffer = new ArrayBuffer(44 + dataSize);
        const view = new DataView(buffer);
        
        const writeString = (offset, str) => {
            for (let i = 0; i < str.length; i++) {
                view.setUint8(offset + i, str.charCodeAt(i));
            }
        };
        
        writeString(0, 'RIFF');
        view.setUint32(4, 36 + dataSize, true);
        writeString(8, 'WAVE');
        writeString(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, numChannels, true);
        view.setUint32(24, this.wavSampleRate, true);
        view.setUint32(28, byteRate, true);
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, bitsPerSample, true);
        writeString(36, 'data');
        view.setUint32(40, dataSize, true);
        
        let writeOffset = 44;
        for (let i = 0; i < pcmData.length; i++) {
            const sample = Math.max(-1, Math.min(1, pcmData[i]));
            view.setInt16(writeOffset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
            writeOffset += 2;
        }
        
        return new Blob([buffer], { type: 'audio/wav' });
    }

    saveWebmWithWav(videoBlob, filename, label) {
        const displayLabel = label || 'recording';
        
        this.downloadBlob(videoBlob, `${filename}.webm`);
        
        if (this.wavBuffers.length > 0) {
            const wavBlob = this.encodeWav();
            this.downloadBlob(wavBlob, `${filename}_audio.wav`);
            const videoMB = (videoBlob.size / 1024 / 1024).toFixed(2);
            const audioMB = (wavBlob.size / 1024 / 1024).toFixed(2);
            const msg = `${displayLabel} saved: ${filename}.webm (${videoMB} MB) + ${filename}_audio.wav (${audioMB} MB). Import both into Premiere Pro and sync.`;
            this.updateStatus(msg);
            console.log(msg);
        } else {
            const videoMB = (videoBlob.size / 1024 / 1024).toFixed(2);
            this.updateStatus(`${displayLabel} saved: ${filename}.webm (${videoMB} MB). No separate audio recorded.`);
        }
    }

    startTimer() {
        this.timerInterval = setInterval(() => {
            const elapsed = Date.now() - this.startTime - this.totalPausedMs;
            const seconds = Math.floor(elapsed / 1000);
            const minutes = Math.floor(seconds / 60);
            const hours = Math.floor(minutes / 60);
            
            const displayHours = String(hours).padStart(2, '0');
            const displayMinutes = String(minutes % 60).padStart(2, '0');
            const displaySeconds = String(seconds % 60).padStart(2, '0');
            
            this.recordingTime.textContent = `${displayHours}:${displayMinutes}:${displaySeconds}`;
        }, 1000);
    }

    stopTimer() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
        this.recordingTime.textContent = '';
    }

    updateStatus(message) {
        this.statusText.textContent = message;
    }

    stopVideoStreams() {
        this.stopReconnectWatch();
        this.cameraSlots = [];
        this.disconnectedVideos.clear();
        this.streams.forEach(stream => {
            stream.getTracks().forEach(track => track.stop());
        });
        this.streams = [];
        
        this.videoElements = [];
        this.individualCheckboxes = [];
        this.videoGrid.innerHTML = '';
    }

    stopAudioStreams() {
        this.stopAllAudioMeters();
        this.audioStreams.forEach(stream => {
            stream.getTracks().forEach(track => track.stop());
        });
        this.audioStreams = [];
        
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }
        
        this.mixedAudioTrack = null;
    }

    cleanup() {
        this.isPreviewing = false;
        
        this.stopVideoStreams();
        this.stopAudioStreams();
        
        this.individualRecorders = [];
        this.individualChunks = [];
        
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
        }
        
        if (this.previewAnimationId) {
            cancelAnimationFrame(this.previewAnimationId);
        }
        
        this.stopTimer();
    }
}

const app = new MultiCameraRecorder();
