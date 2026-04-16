class MultiCameraRecorder {
    constructor() {
        this.streams = [];
        this.videoElements = [];
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
        this.isPreviewing = false;
        this.animationFrameId = null;
        this.previewAnimationId = null;
        this.startTime = null;
        this.timerInterval = null;
        
        this.initializeElements();
        this.attachEventListeners();
    }

    initializeElements() {
        this.cameraCountSelect = document.getElementById('cameraCount');
        this.timerOverlayCheckbox = document.getElementById('timerOverlay');
        this.filenamePrefixInput = document.getElementById('filenamePrefix');
        this.setupButton = document.getElementById('setupCameras');
        this.startButton = document.getElementById('startRecording');
        this.stopButton = document.getElementById('stopRecording');
        this.videoGrid = document.getElementById('videoGrid');
        this.previewContainer = document.querySelector('.preview-container');
        this.cameraSelection = document.getElementById('cameraSelection');
        this.statusText = document.getElementById('statusText');
        this.recordingIndicator = document.getElementById('recordingIndicator');
        this.recordingTime = document.getElementById('recordingTime');
    }

    attachEventListeners() {
        this.setupButton.addEventListener('click', () => this.setupCameras());
        this.startButton.addEventListener('click', () => this.startRecording());
        this.stopButton.addEventListener('click', () => this.stopRecording());
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

    async setupCameras() {
        this.cleanup();
        
        const cameraCount = parseInt(this.cameraCountSelect.value);
        const cameras = await this.getAvailableCameras();
        
        if (cameras.length === 0) {
            this.updateStatus('No cameras found. Please connect a camera and try again.');
            return;
        }

        this.updateStatus(`Found ${cameras.length} camera(s). Setting up ${cameraCount} stream(s)...`);
        
        this.createCameraSelectionUI(cameras, cameraCount);
    }

    createCameraSelectionUI(cameras, cameraCount) {
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
        
        const startButton = document.createElement('button');
        startButton.className = 'btn btn-secondary';
        startButton.textContent = 'Initialize Selected Cameras';
        startButton.style.marginTop = '15px';
        startButton.addEventListener('click', () => this.initializeCameras(cameraCount));
        
        this.cameraSelection.appendChild(startButton);
    }

    async initializeCameras(cameraCount) {
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
                    audio: i === 0
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
        
        this.setupCanvas(cameraCount);
        this.updateStatus('Cameras ready! Click "Start Recording" to begin.');
        this.startButton.disabled = false;
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
        const elapsed = Date.now() - this.startTime;
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
        this.startTime = Date.now();
        
        this.drawVideoGrid();
        
        this.individualCheckboxes.forEach((checkbox, index) => {
            if (checkbox.checked && this.streams[index]) {
                this.startIndividualRecording(index);
            }
        });
        
        const canvasStream = this.canvas.captureStream(30);
        
        if (this.streams[0].getAudioTracks().length > 0) {
            const audioTrack = this.streams[0].getAudioTracks()[0];
            canvasStream.addTrack(audioTrack);
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
        const stream = this.streams[index];
        if (!stream) return;
        
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
            const recorder = new MediaRecorder(stream, options);
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
        this.stopButton.disabled = true;
        this.setupButton.disabled = false;
        this.recordingIndicator.classList.remove('active');
    }

    saveRecording() {
        if (this.recordedChunks.length === 0) {
            this.updateStatus('No recording data available.');
            return;
        }
        
        const mimeType = this.mediaRecorder.mimeType;
        const extension = mimeType.includes('mp4') ? 'mp4' : 'webm';
        
        const blob = new Blob(this.recordedChunks, { type: mimeType });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        const now = new Date();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const year = now.getFullYear();
        
        const prefix = this.filenamePrefixInput.value.trim();
        const baseFilename = `multicam_${month}_${day}_${year}`;
        const filename = prefix ? `${prefix}_${baseFilename}` : baseFilename;
        
        a.download = `${filename}.${extension}`;
        
        document.body.appendChild(a);
        a.click();
        
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 100);
        
        this.updateStatus(`Recording saved! (${(blob.size / 1024 / 1024).toFixed(2)} MB)`);
        this.recordedChunks = [];
    }

    saveIndividualRecording(chunks, cameraIndex, mimeType) {
        if (chunks.length === 0) {
            console.warn(`No data for individual camera ${cameraIndex + 1}`);
            return;
        }
        
        const extension = mimeType.includes('mp4') ? 'mp4' : 'webm';
        const blob = new Blob(chunks, { type: mimeType });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        
        const now = new Date();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const year = now.getFullYear();
        
        const prefix = this.filenamePrefixInput.value.trim();
        const baseFilename = `camera${cameraIndex + 1}_${month}_${day}_${year}`;
        const filename = prefix ? `${prefix}_${baseFilename}` : baseFilename;
        
        a.download = `${filename}.${extension}`;
        
        document.body.appendChild(a);
        a.click();
        
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 100);
        
        console.log(`Individual recording saved for Camera ${cameraIndex + 1}: ${filename}.${extension} (${(blob.size / 1024 / 1024).toFixed(2)} MB)`);
    }

    startTimer() {
        this.timerInterval = setInterval(() => {
            const elapsed = Date.now() - this.startTime;
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
