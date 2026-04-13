# Multi-Camera Video Recorder

A web-based application that allows you to record multiple video inputs simultaneously and combine them into a single video file with a grid layout.

## Features

- **Multiple Camera Support**: Record from 1 to 9 cameras simultaneously
- **Grid Layouts**: Automatically arranges cameras in optimal grid patterns (1x1, 2x1, 2x2, 3x2, 3x3)
- **Live Preview**: See all camera feeds in real-time before and during recording
- **Timer Overlay**: Optional on-screen timer showing elapsed recording time (HH:MM:SS) in both live preview and recorded video
- **Single Video Output**: Combines all camera feeds into one video file
- **Audio Recording**: Captures audio from the first camera
- **High Quality**: Records at 1920x1080 resolution with configurable bitrate
- **Easy Download**: Automatically downloads the recorded video when you stop recording

## How to Use

1. **Open the Application**
   - Open `index.html` in a modern web browser (Chrome, Edge, or Firefox recommended)
   - Grant camera and microphone permissions when prompted

2. **Setup Cameras**
   - Select the number of cameras you want to use (1-9)
   - Toggle "Show Timer Overlay" if you want elapsed time displayed on the video (enabled by default)
   - Click "Setup Cameras" to detect available cameras
   - Choose which camera to use for each position
   - Click "Initialize Selected Cameras" to start the preview

3. **Start Recording**
   - Review the live preview to ensure all cameras are working
   - Click "Start Recording" to begin capturing
   - The recording indicator will show you're recording
   - A timer displays the recording duration in the interface
   - If enabled, the timer overlay will appear in the bottom-right corner of both the live preview and recorded video

4. **Stop Recording**
   - Click "Stop Recording" when finished
   - The video will automatically download to your default downloads folder
   - File format: MP4 (or WebM if MP4 not supported by browser)

## Technical Details

- **Resolution**: 1920x1080 (Full HD)
- **Frame Rate**: 30 FPS
- **Video Codec**: H.264 (fallback to VP9/VP8 if not supported)
- **Audio Codec**: Opus
- **Bitrate**: 5 Mbps
- **Format**: MP4 (or WebM as fallback)

## Browser Compatibility

- ✅ Google Chrome (recommended)
- ✅ Microsoft Edge
- ✅ Firefox
- ⚠️ Safari (limited support)

## Requirements

- Modern web browser with WebRTC support
- Multiple cameras/webcams connected to your computer
- Camera and microphone permissions granted

## Grid Layouts

- **1 Camera**: 1x1 grid
- **2 Cameras**: 2x1 grid (side by side)
- **4 Cameras**: 2x2 grid
- **6 Cameras**: 3x2 grid
- **9 Cameras**: 3x3 grid

## Troubleshooting

**Cameras not detected:**
- Ensure cameras are properly connected
- Grant browser permissions for camera access
- Refresh the page and try again

**Recording not starting:**
- Check that at least one camera is initialized
- Ensure your browser supports MediaRecorder API
- Try using Chrome or Edge for best compatibility

**Poor video quality:**
- Ensure good lighting for all cameras
- Check camera resolution settings
- Close other applications using the cameras

## Notes

- The first camera's audio will be included in the recording
- All cameras should be set up before starting the recording
- Recording stops automatically if a camera disconnects
- Large recordings may take a moment to process before download
