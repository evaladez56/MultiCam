// Comparison Workspace
// Load 2-4 local video files, align their start offsets, and play them together.

class ComparisonWorkspace {
    constructor() {
        this.slots = [];
        this.isPlaying = false;
        this.seekTimer = null;

        this.view = document.getElementById('compareView');
        this.recorderView = document.getElementById('recorderView');
        this.grid = document.getElementById('compareGrid');
        this.countSelect = document.getElementById('compareCount');
        this.playBtn = document.getElementById('comparePlayAll');
        this.pauseBtn = document.getElementById('comparePauseAll');
        this.rewindBtn = document.getElementById('compareRewindAll');
        this.seekSlider = document.getElementById('compareMasterSeek');
        this.timeDisplay = document.getElementById('compareMasterTime');
        this.status = document.getElementById('compareStatus');

        this.switchToCompareBtn = document.getElementById('switchToCompare');
        this.switchToRecorderBtn = document.getElementById('switchToRecorder');

        this.attachListeners();
        this.renderSlots(parseInt(this.countSelect.value, 10));
    }

    attachListeners() {
        this.switchToCompareBtn.addEventListener('click', () => this.showCompare());
        this.switchToRecorderBtn.addEventListener('click', () => this.showRecorder());

        // Auto-load slots when the count dropdown changes
        this.countSelect.addEventListener('change', () => {
            this.renderSlots(parseInt(this.countSelect.value, 10));
        });

        this.playBtn.addEventListener('click', () => this.playAll());
        this.pauseBtn.addEventListener('click', () => this.pauseAll());
        this.rewindBtn.addEventListener('click', () => this.rewindAll());

        this.seekSlider.addEventListener('input', () => this.onSeekSliderInput());
    }

    showCompare() {
        this.recorderView.style.display = 'none';
        this.view.style.display = 'block';
        document.body.classList.add('compare-mode');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    showRecorder() {
        this.view.style.display = 'none';
        this.recorderView.style.display = 'block';
        document.body.classList.remove('compare-mode');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    renderSlots(count) {
        this.slots.forEach(slot => {
            if (slot && slot.url) URL.revokeObjectURL(slot.url);
        });
        this.slots = [];
        this.grid.innerHTML = '';
        this.grid.className = `compare-grid compare-grid-${count}`;

        for (let i = 0; i < count; i++) {
            const slotEl = document.createElement('div');
            slotEl.className = 'compare-slot';

            this.slots.push({
                el: slotEl,
                file: null,
                url: null,
                video: null,
                labelInput: null,
                offsetDisplay: null,
                offset: 0,
                label: `Video ${i + 1}`
            });

            this.renderEmptySlot(i);
            this.grid.appendChild(slotEl);
        }

        this.updateStatus(`Select a video file for each slot (${count} total).`);
        this.setMasterControlsEnabled(false);
        this.updateMasterTime();
    }

    renderEmptySlot(index) {
        const slot = this.slots[index];
        slot.el.innerHTML = '';

        const empty = document.createElement('div');
        empty.className = 'slot-empty';

        const label = document.createElement('p');
        label.textContent = `Slot ${index + 1}`;

        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'video/*';
        fileInput.addEventListener('change', (e) => this.onFileSelected(index, e.target.files[0]));

        empty.appendChild(label);
        empty.appendChild(fileInput);
        slot.el.appendChild(empty);
    }

    onFileSelected(index, file) {
        if (!file) return;
        const slot = this.slots[index];
        if (slot.url) URL.revokeObjectURL(slot.url);

        slot.file = file;
        slot.url = URL.createObjectURL(file);
        slot.offset = 0;

        this.renderLoadedSlot(index);
        this.refreshMasterControls();
    }

    renderLoadedSlot(index) {
        const slot = this.slots[index];
        slot.el.innerHTML = '';

        // --- Top bar: label input (separate from video, not overlapping) ---
        const topBar = document.createElement('div');
        topBar.className = 'slot-top-bar';

        const labelInput = document.createElement('input');
        labelInput.type = 'text';
        labelInput.className = 'slot-label-input';
        labelInput.value = slot.label || `Video ${index + 1}`;
        labelInput.placeholder = 'Label (e.g., Eduardo - Run 3)';
        labelInput.addEventListener('input', () => { slot.label = labelInput.value; });
        topBar.appendChild(labelInput);
        slot.el.appendChild(topBar);

        // --- Video with native controls (nothing overlays it) ---
        const videoWrap = document.createElement('div');
        videoWrap.className = 'slot-video-wrap';

        const video = document.createElement('video');
        video.src = slot.url;
        video.muted = true;
        video.playsInline = true;
        video.preload = 'metadata';
        video.controls = true;
        videoWrap.appendChild(video);
        slot.el.appendChild(videoWrap);

        // --- Bottom bar: alignment controls (below the video) ---
        const bottomBar = document.createElement('div');
        bottomBar.className = 'slot-bottom-bar';

        const setStartBtn = document.createElement('button');
        setStartBtn.className = 'slot-btn';
        setStartBtn.textContent = 'Set Start Here';
        setStartBtn.title = "Use this video's current playhead as its alignment point";
        setStartBtn.addEventListener('click', () => this.setOffsetFromCurrentTime(index));

        const clearOffsetBtn = document.createElement('button');
        clearOffsetBtn.className = 'slot-btn';
        clearOffsetBtn.textContent = 'Reset';
        clearOffsetBtn.title = 'Reset offset to 0';
        clearOffsetBtn.addEventListener('click', () => this.setOffset(index, 0));

        const reloadBtn = document.createElement('button');
        reloadBtn.className = 'slot-btn slot-reload';
        reloadBtn.textContent = 'Replace file';
        reloadBtn.title = 'Load a different file in this slot';
        reloadBtn.addEventListener('click', () => this.reloadSlot(index));

        const offsetDisplay = document.createElement('span');
        offsetDisplay.className = 'offset-display';
        offsetDisplay.textContent = 'offset: 0.00s';

        bottomBar.appendChild(setStartBtn);
        bottomBar.appendChild(clearOffsetBtn);
        bottomBar.appendChild(reloadBtn);
        bottomBar.appendChild(offsetDisplay);
        slot.el.appendChild(bottomBar);

        slot.video = video;
        slot.labelInput = labelInput;
        slot.offsetDisplay = offsetDisplay;

        video.addEventListener('loadedmetadata', () => this.refreshMasterControls());
    }

    reloadSlot(index) {
        const slot = this.slots[index];
        if (slot.url) URL.revokeObjectURL(slot.url);
        slot.file = null;
        slot.url = null;
        slot.video = null;
        slot.labelInput = null;
        slot.offsetDisplay = null;
        slot.offset = 0;

        this.renderEmptySlot(index);
        this.refreshMasterControls();
    }

    setOffsetFromCurrentTime(index) {
        const slot = this.slots[index];
        if (!slot.video) return;
        this.setOffset(index, slot.video.currentTime);
        this.updateStatus(`Slot ${index + 1} start point set to ${slot.video.currentTime.toFixed(2)}s.`);
    }

    setOffset(index, seconds) {
        const slot = this.slots[index];
        slot.offset = Math.max(0, seconds);
        if (slot.offsetDisplay) {
            slot.offsetDisplay.textContent = `offset: ${slot.offset.toFixed(2)}s`;
        }
        if (slot.video) {
            slot.video.currentTime = slot.offset;
        }
        this.refreshMasterControls();
    }

    loadedSlots() {
        return this.slots.filter(s => s.video && s.video.readyState >= 1);
    }

    setMasterControlsEnabled(enabled) {
        this.playBtn.disabled = !enabled;
        this.pauseBtn.disabled = !enabled;
        this.rewindBtn.disabled = !enabled;
        this.seekSlider.disabled = !enabled;
    }

    refreshMasterControls() {
        const loaded = this.loadedSlots();
        const enabled = loaded.length >= 2;
        this.setMasterControlsEnabled(enabled);
        if (enabled) {
            this.updateStatus(`${loaded.length} video(s) ready. Use "Set Start Here" on each to align.`);
        }
        this.updateMasterTime();
    }

    maxEffectiveDuration() {
        let max = 0;
        this.loadedSlots().forEach(s => {
            const eff = Math.max(0, (s.video.duration || 0) - s.offset);
            if (eff > max) max = eff;
        });
        return max;
    }

    formatTime(seconds) {
        if (!isFinite(seconds) || seconds < 0) seconds = 0;
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${String(s).padStart(2, '0')}`;
    }

    updateMasterTime() {
        const loaded = this.loadedSlots();
        const total = this.maxEffectiveDuration();
        let current = 0;
        if (loaded.length > 0) {
            current = Math.max(0, loaded[0].video.currentTime - loaded[0].offset);
        }
        this.timeDisplay.textContent = `${this.formatTime(current)} / ${this.formatTime(total)}`;
        this.seekSlider.value = total > 0
            ? String(Math.min(1000, Math.round((current / total) * 1000)))
            : '0';
    }

    playAll() {
        const loaded = this.loadedSlots();
        if (loaded.length < 2) return;
        loaded.forEach(s => {
            const effCurrent = s.video.currentTime - s.offset;
            const effDuration = (s.video.duration || 0) - s.offset;
            if (effCurrent >= effDuration || s.video.currentTime < s.offset) {
                s.video.currentTime = s.offset;
            }
        });
        loaded.forEach(s => s.video.play().catch(err => console.warn('play() rejected:', err)));
        this.isPlaying = true;
        this.startSeekTracker();
        this.updateStatus('Playing all videos.');
    }

    pauseAll() {
        this.loadedSlots().forEach(s => s.video.pause());
        this.isPlaying = false;
        this.stopSeekTracker();
        this.updateStatus('Paused.');
    }

    rewindAll() {
        this.loadedSlots().forEach(s => {
            s.video.pause();
            s.video.currentTime = s.offset;
        });
        this.isPlaying = false;
        this.stopSeekTracker();
        this.updateMasterTime();
        this.updateStatus('Rewound to aligned start point.');
    }

    onSeekSliderInput() {
        const total = this.maxEffectiveDuration();
        if (total <= 0) return;
        const pct = parseInt(this.seekSlider.value, 10) / 1000;
        const targetEffective = pct * total;
        this.loadedSlots().forEach(s => {
            const target = s.offset + targetEffective;
            s.video.currentTime = Math.min(target, s.video.duration || target);
        });
        this.updateMasterTime();
    }

    startSeekTracker() {
        this.stopSeekTracker();
        this.seekTimer = setInterval(() => this.updateMasterTime(), 200);
    }

    stopSeekTracker() {
        if (this.seekTimer) {
            clearInterval(this.seekTimer);
            this.seekTimer = null;
        }
    }

    updateStatus(msg) {
        this.status.textContent = msg;
    }
}

const compareApp = new ComparisonWorkspace();
