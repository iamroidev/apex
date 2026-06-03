// public/src/overlay.js — Screen annotations drawing and Presenter chroma key overlay
import { state, dom } from './core.js';

let annotationDrawing = false;
let annotationLastX = 0;
let annotationLastY = 0;

export function initAnnotationCanvas() {
  const canvas = dom.annotationCanvas;
  if (!canvas) return;

  canvas.width = 1280;
  canvas.height = 720;

  canvas.addEventListener('mousedown', startAnnotatingDraw);
  canvas.addEventListener('mousemove', drawAnnotating);
  canvas.addEventListener('mouseup', stopAnnotatingDraw);
  canvas.addEventListener('mouseout', stopAnnotatingDraw);

  canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      const rect = canvas.getBoundingClientRect();
      annotationLastX = ((touch.clientX - rect.left) / rect.width) * 1280;
      annotationLastY = ((touch.clientY - rect.top) / rect.height) * 720;
      annotationDrawing = true;
    }
  });

  canvas.addEventListener('touchmove', (e) => {
    if (annotationDrawing && e.touches.length === 1) {
      const touch = e.touches[0];
      const rect = canvas.getBoundingClientRect();
      const x = ((touch.clientX - rect.left) / rect.width) * 1280;
      const y = ((touch.clientY - rect.top) / rect.height) * 720;
      drawStroke(annotationLastX, annotationLastY, x, y, state.annotationColor, state.annotationWidth, state.annotationTool === 'eraser', true);
      annotationLastX = x;
      annotationLastY = y;
    }
  });

  canvas.addEventListener('touchend', stopAnnotatingDraw);
}

function startAnnotatingDraw(e) {
  const canvas = dom.annotationCanvas;
  const rect = canvas.getBoundingClientRect();
  annotationLastX = ((e.clientX - rect.left) / rect.width) * 1280;
  annotationLastY = ((e.clientY - rect.top) / rect.height) * 720;
  annotationDrawing = true;
}

function drawAnnotating(e) {
  if (!annotationDrawing) return;
  const canvas = dom.annotationCanvas;
  const rect = canvas.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * 1280;
  const y = ((e.clientY - rect.top) / rect.height) * 720;
  drawStroke(annotationLastX, annotationLastY, x, y, state.annotationColor, state.annotationWidth, state.annotationTool === 'eraser', true);
  annotationLastX = x;
  annotationLastY = y;
}

function stopAnnotatingDraw() {
  annotationDrawing = false;
}

export function drawStroke(x1, y1, x2, y2, color, width, isEraser, emit = false) {
  const canvas = dom.annotationCanvas;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (isEraser) {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = 'rgba(0,0,0,1)';
  } else {
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = color;
  }
  ctx.stroke();
  ctx.globalCompositeOperation = 'source-over';

  if (emit && state.socket) {
    state.socket.emit('annotation-draw', {
      roomId: state.roomId,
      path: { x1, y1, x2, y2, color, width, isEraser }
    });
  }
}

export function clearAnnotations(emit = true) {
  const canvas = dom.annotationCanvas;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (emit && state.socket) {
    state.socket.emit('annotation-clear', { roomId: state.roomId });
  }
}

export function toggleAnnotationMode() {
  state.isAnnotating = !state.isAnnotating;
  dom.btnAnnotateToggle.classList.toggle('active', state.isAnnotating);
  dom.annotationToolbar.classList.toggle('hidden', !state.isAnnotating);

  const canvas = dom.annotationCanvas;
  canvas.classList.toggle('hidden', !state.isAnnotating && !state.screenSharingActive);
  canvas.style.pointerEvents = state.isAnnotating ? 'auto' : 'none';

  if (state.isAnnotating) {
    canvas.width = 1280;
    canvas.height = 720;
    setAnnotationTool('pen');
  }
}

export function setAnnotationTool(tool) {
  state.annotationTool = tool;
  dom.btnAnnotationPen.style.background = tool === 'pen' ? 'var(--bg-elevated)' : 'transparent';
  dom.btnAnnotationPen.style.borderColor = tool === 'pen' ? 'var(--border-strong)' : 'transparent';
  dom.btnAnnotationEraser.style.background = tool === 'eraser' ? 'var(--bg-elevated)' : 'transparent';
  dom.btnAnnotationEraser.style.borderColor = tool === 'eraser' ? 'var(--border-strong)' : 'transparent';
}

function getPresenterVideoElement() {
  if (!state.slidePresenterSocketId) return null;
  if (state.slidePresenterSocketId === state.socket?.id) {
    return dom.localVideo;
  }
  const tile = document.querySelector(`.video-tile[data-socket="${state.slidePresenterSocketId}"]`);
  return tile ? tile.querySelector('video') : null;
}

let presenterOverlayLoopId = null;

export function startPresenterOverlayLoop() {
  if (presenterOverlayLoopId) return;
  
  const canvas = dom.slidesPresenterCanvas;
  if (!canvas) return;
  
  canvas.width = 140;
  canvas.height = 140;
  const ctx = canvas.getContext('2d');
  
  canvas.classList.remove('hidden');

  function loop() {
    if (!state.isSharingSlides || !state.presenterOverlayEnabled) {
      stopPresenterOverlayLoop();
      return;
    }

    const video = getPresenterVideoElement();
    if (video && video.readyState >= video.HAVE_CURRENT_DATA) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      const type = state.presenterOverlayType;
      if (type === 'bubble') {
        canvas.style.borderRadius = '50%';
        canvas.style.border = '3px solid var(--border-strong)';
        canvas.style.boxShadow = 'var(--neo-shadow-cyan)';
        
        ctx.save();
        ctx.beginPath();
        ctx.arc(canvas.width / 2, canvas.height / 2, canvas.width / 2, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        ctx.restore();
      } else if (type === 'chromakey') {
        canvas.style.borderRadius = '0px';
        canvas.style.border = 'none';
        canvas.style.boxShadow = 'none';
        
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = canvas.width;
        tempCanvas.height = canvas.height;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.drawImage(video, 0, 0, tempCanvas.width, tempCanvas.height);
        
        const imgData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
        const data = imgData.data;
        
        const keyType = state.presenterChromaColor;
        const tolerance = state.presenterChromaTolerance;
        
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          
          let isMatch = false;
          if (keyType === 'green') {
            isMatch = (g - r > tolerance / 2) && (g - b > tolerance / 2);
          } else if (keyType === 'blue') {
            isMatch = (b - r > tolerance / 2) && (b - g > tolerance / 2);
          } else if (keyType === 'dark') {
            isMatch = (r < tolerance && g < tolerance && b < tolerance);
          }
          
          if (isMatch) {
            data[i + 3] = 0;
          }
        }
        ctx.putImageData(imgData, 0, 0);
      }
    }
    
    presenterOverlayLoopId = requestAnimationFrame(loop);
  }
  
  presenterOverlayLoopId = requestAnimationFrame(loop);
}

export function stopPresenterOverlayLoop() {
  if (presenterOverlayLoopId) {
    cancelAnimationFrame(presenterOverlayLoopId);
    presenterOverlayLoopId = null;
  }
  if (dom.slidesPresenterCanvas) {
    dom.slidesPresenterCanvas.classList.add('hidden');
  }
}
