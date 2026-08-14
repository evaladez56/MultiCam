class MultiCameraRecorder {
    constructor() {
        this.streams = [];
        this.videoElements = [];
        this.audioStreams = [];
        this.audioToggles = [];
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
        this.setupButton.addEventListener('click', () => this.setupCameras());
        this.startButton.addEventListener('click', () => this.startRecording());
        this.pauseButton.addEventListener('click', () => this.togglePauseRecording());
        this.stopButton.addEventListener('click', () => this.stopRecording());
        this.machineTimeBtn.addEventListener('click', () => this.toggleSplitTimer('machine'));
        this.manualTimeBtn.addEventListener('click', () => this.toggleSplitTimer('manual'));
    }

    async getAvailableCameras() {
        try {
            await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
            
            const devices = await navigator.mediaDevices.enumerateDevices();
            const cameras = devices.filter(device => device.kind === 'videoinput');
            
            console.log('Found cameras:', cameras.map(c => ({ 
                label: c.label, 
                id: c.deviceId ? c.deviceId.slice(-4) : 'none',
                fullId: c.deviceId 
            })));
            
            return cameras;
        } catch (error) {
            console.error('Error getting cameras:', error);
            this.updateStatus('Error accessing cameras. Please grant camera permissions.');
            return [];
        }
    }

    async getAvailableAudioDevices() {
        try {
            await navigator.mediaDevices.getUserMedia({ audio: true });
            
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

    async setupCameras() {
        this.setupButton.disabled = true;
        this.startButton.disabled = true;
        
        this.cleanup();
        
        const cameraCount = parseInt(this.cameraCountSelect.value);
        const cameras = await this.getAvailableCameras();
        const audioDevices = await this.getAvailableAudioDevices();
        
        if (cameras.length === 0) {
            this.updateStatus('No cameras found. Please connect a camera and try again.');
            this.setupButton.disabled = false;
            return;
        }

        this.updateStatus(`Found ${cameras.length} camera(s) and ${audioDevices.length} audio device(s). Setting up...`);
        
        this.createCameraSelectionUI(cameras, cameraCount, audioDevices);
        await this.initializeCameras(cameraCount);
        this.setupButton.disabled = false;
    }

    createCameraSelectionUI(cameras, cameraCount, audioDevices) {
        this.audioToggles = [];
        this.cameraSelection.innerHTML = '';
        
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
            
            cameras.forEach((camera, index) => {
                const option = document.createElement('option');
                option.value = camera.deviceId;
                
                const deviceIdSuffix = camera.deviceId.slice(-4);
                const baseName = camera.label || `Camera ${index + 1}`;
                option.textContent = `${baseName} (...${deviceIdSuffix})`;
                
                if (index === i % cameras.length) {
                    option.selected = true;
                }
                select.appendChild(option);
            });
            
            select.addEventListener('change', () => {
                if (this.streams.length > 0) {
                    this.initializeCameras(cameraCount);
                }
            });
            
            selectItem.appendChild(label);
            selectItem.appendChild(select);
            container.appendChild(selectItem);
        }
        
        this.cameraSelection.appendChild(container);
        
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
                
                audioItem.appendChild(checkbox);
                audioItem.appendChild(label);
                audioContainer.appendChild(audioItem);
                
                this.audioToggles.push(checkbox);
            });
            
            audioSection.appendChild(audioContainer);
            this.cameraSelection.appendChild(audioSection);
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
        
        this.videoGrid.className = `video-grid grid-${cameraCount}`;
        
        for (let i = 0; i < cameraCount; i++) {
            const select = document.getElementById(`camera-${i}`);
            const deviceId = select ? select.value : undefined;
            
            try {
                const constraints = {
                    video: {
                        deviceId: deviceId ? { exact: deviceId } : undefined,
                        width: { ideal: 1280 },
                        height: { ideal: 720 }
                    },
                    audio: false
                };
                
                const stream = await navigator.mediaDevices.getUserMedia(constraints);
                this.streams.push(stream);
                
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
                this.videoGrid.appendChild(videoContainer);
                
                this.videoElements.push(video);
                this.individualCheckboxes.push(checkbox);
                
            } catch (error) {
                console.error(`Error accessing camera ${i + 1}:`, error);
                this.updateStatus(`Error accessing camera ${i + 1}. Using placeholder.`);
                
                const videoContainer = document.createElement('div');
                videoContainer.className = 'video-container';
                videoContainer.style.background = '#333';
                videoContainer.innerHTML = `<div class="video-label">Camera ${i + 1} - Error</div>`;
                this.videoGrid.appendChild(videoContainer);
            }
        }
        
        const audioPromises = this.audioToggles.map(async (toggle, index) => {
            if (toggle.checked) {
                try {
                    const audioStream = await navigator.mediaDevices.getUserMedia({
                        audio: { deviceId: { exact: toggle.value } },
                        video: false
                    });
                    this.audioStreams.push(audioStream);
                    console.log(`Initialized audio device ${index + 1}:`, audioStream.getAudioTracks()[0].label);
                } catch (error) {
                    console.error(`Error accessing audio device ${index + 1}:`, error);
                }
            }
        });
        
        await Promise.all(audioPromises);
        
        console.log(`Total audio streams initialized: ${this.audioStreams.length}`);
        
        this.setupCanvas(cameraCount);
        this.updateStatus('Cameras ready! Click "Start Recording" to begin.');
        this.startButton.disabled = false;
        this.getCameraSelects(cameraCount).forEach(s => s.disabled = false);
        this.startPreview();
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
                this.startIndividualRecording(index);
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
            this.setupButton.disabled = true;
            this.recordingIndicator.classList.add('active');
            
            this.startTimer();
            
        } catch (error) {
            console.error('Error starting recording:', error);
            this.updateStatus('Error starting recording: ' + error.message);
            this.isRecording = false;
        }
    }

    startIndividualRecording(index) {
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
            
            recorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    chunks.push(event.data);
                }
            };
            
            recorder.onstop = () => {
                this.saveIndividualRecording(chunks, index, recorder.mimeType);
            };
            
            recorder.start(100);
            
            this.individualRecorders.push({ recorder, index });
            this.individualChunks.push(chunks);
            
            console.log(`Started individual recording for Camera ${index + 1}`);
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
        this.setupButton.disabled = false;
        this.recordingIndicator.classList.remove('active');
        this.isPaused = false;
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
            this.recordingIndicator.classList.remove('active');
            this.stopTimer();
            if (this.activeSplitTimer) {
                const now = Date.now();
                if (this.activeSplitTimer === 'machine') this.machineTimeMs += now - this.splitTimerStartedAt;
                else this.manualTimeMs += now - this.splitTimerStartedAt;
                this.splitTimerStartedAt = null;
            }
            this.updateStatus('Recording paused. Click Resume to continue.');
        } else {
            this.totalPausedMs += Date.now() - this.pausedAt;
            this.pausedAt = null;
            this.mediaRecorder.resume();
            this.individualRecorders.forEach(({ recorder }) => {
                if (recorder && recorder.state === 'paused') recorder.resume();
            });
            this.isPaused = false;
            this.pauseButton.textContent = 'Pause Recording';
            this.recordingIndicator.classList.add('active');
            if (this.activeSplitTimer) {
                this.splitTimerStartedAt = Date.now();
            }
            this.resumeOverlayStart = Date.now();
            this.startTimer();
            this.updateStatus('Recording in progress...');
        }
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

    saveIndividualRecording(chunks, cameraIndex, mimeType) {
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
        const baseFilename = `camera${cameraIndex + 1}_${month}_${day}_${year}`;
        const filename = prefix ? `${prefix}_${baseFilename}` : baseFilename;
        
        const extension = mimeType.includes('mp4') ? 'mp4' : 'webm';
        this.downloadBlob(blob, `${filename}.${extension}`);
        
        if (this.wavBuffers.length > 0) {
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

    cleanup() {
        this.isPreviewing = false;
        
        this.streams.forEach(stream => {
            stream.getTracks().forEach(track => track.stop());
        });
        this.streams = [];
        
        this.audioStreams.forEach(stream => {
            stream.getTracks().forEach(track => track.stop());
        });
        this.audioStreams = [];
        
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }
        
        this.videoElements = [];
        this.individualCheckboxes = [];
        this.individualRecorders = [];
        this.individualChunks = [];
        this.videoGrid.innerHTML = '';
        
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
