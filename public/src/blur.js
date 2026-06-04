// Virtual Background using Mediapipe Selfie Segmentation
export const blurState = {
  enabled: false,
  segmentation: null,
  canvas: null,
  ctx: null,
  videoEl: null,
  processorLoop: null,
  originalTrack: null,
  blurredTrack: null,
  cameraStream: null
};

export async function initBlur() {
  blurState.canvas = document.createElement('canvas');
  blurState.canvas.width = 1280;
  blurState.canvas.height = 720;
  blurState.ctx = blurState.canvas.getContext('2d');
  
  blurState.videoEl = document.createElement('video');
  blurState.videoEl.autoplay = true;
  blurState.videoEl.playsInline = true;
  
  if (window.SelfieSegmentation) {
    blurState.segmentation = new window.SelfieSegmentation({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@0.1/${file}`
    });
    blurState.segmentation.setOptions({ modelSelection: 1 });
    blurState.segmentation.onResults(onSegmentationResults);
  } else {
    console.warn('SelfieSegmentation not loaded');
  }
}

function onSegmentationResults(results) {
  if (!blurState.enabled) return;
  const ctx = blurState.ctx;
  const canvas = blurState.canvas;
  
  ctx.save();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  // Draw the segmentation mask
  ctx.drawImage(results.segmentationMask, 0, 0, canvas.width, canvas.height);
  
  // Draw the original image over the mask
  ctx.globalCompositeOperation = 'source-in';
  ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
  
  // Draw the blurred background
  ctx.globalCompositeOperation = 'destination-over';
  ctx.filter = 'blur(10px)';
  ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
  
  ctx.restore();
}

export async function toggleBlur(stream, onTrackChange) {
  blurState.enabled = !blurState.enabled;
  
  const btn = document.getElementById('btn-blur');
  if (btn) btn.classList.toggle('active', blurState.enabled);
  
  if (blurState.enabled) {
    if (!blurState.segmentation) await initBlur();
    
    blurState.originalTrack = stream.getVideoTracks()[0];
    blurState.cameraStream = new MediaStream([blurState.originalTrack]);
    blurState.videoEl.srcObject = blurState.cameraStream;
    
    // Start processing loop
    blurState.processorLoop = setInterval(async () => {
      if (blurState.videoEl.readyState >= 2) {
        await blurState.segmentation.send({ image: blurState.videoEl });
      }
    }, 1000 / 30); // 30 fps
    
    blurState.blurredTrack = blurState.canvas.captureStream(30).getVideoTracks()[0];
    onTrackChange(blurState.blurredTrack);
  } else {
    // Disable blur
    if (blurState.processorLoop) clearInterval(blurState.processorLoop);
    if (blurState.originalTrack) onTrackChange(blurState.originalTrack);
  }
}
