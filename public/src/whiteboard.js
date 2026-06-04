// public/src/whiteboard.js — Whiteboard canvas controls, drawing, and remote syncing
import { state, dom } from './core.js';

export function bindWhiteboard() {
  const canvas = dom.wbCanvas;
  const ctx = canvas.getContext('2d');

  dom.wbTools.forEach(btn => {
    btn.addEventListener('click', () => {
      const tool = btn.dataset.tool;
      if (tool === 'clear') {
        clearWhiteboard(true);
        return;
      }
      state.wbTool = tool;
      dom.wbTools.forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
    });
  });

  dom.wbColor.addEventListener('input', (e) => {
    state.wbColor = e.target.value;
  });

  canvas.addEventListener('pointerdown', (e) => {
    state.wbDrawing = true;
    const rect = canvas.getBoundingClientRect();
    state.wbLastX = (e.clientX - rect.left) * (canvas.width / rect.width);
    state.wbLastY = (e.clientY - rect.top) * (canvas.height / rect.height);
    
    if (state.wbTool === 'laser') {
      if (state.roomId && state.socket) {
        state.socket.emit('whiteboard-laser', { roomId: state.roomId, x: state.wbLastX, y: state.wbLastY, isStart: true });
      }
      addLaserPointLocal(state.wbLastX, state.wbLastY, true);
      return;
    }

    state.wbCurrentPath = {
      tool: state.wbTool,
      color: state.wbColor,
      points: [{ x: state.wbLastX, y: state.wbLastY }],
      startX: state.wbLastX,
      startY: state.wbLastY
    };

    // Clear redo stack on new stroke
    state.wbRedoStack = [];
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!state.wbDrawing) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);

    if (state.wbTool === 'laser') {
      if (state.roomId && state.socket) {
        state.socket.emit('whiteboard-laser', { roomId: state.roomId, x, y, isStart: false });
      }
      addLaserPointLocal(x, y, false);
      state.wbLastX = x;
      state.wbLastY = y;
      return;
    }

    if (state.wbTool === 'pen') {
      ctx.strokeStyle = state.wbColor;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(state.wbLastX, state.wbLastY);
      ctx.lineTo(x, y);
      ctx.stroke();
    }

    state.wbLastX = x;
    state.wbLastY = y;
    if (state.wbCurrentPath) {
      state.wbCurrentPath.points.push({ x, y });
    }
  });

  canvas.addEventListener('pointerup', (e) => {
    if (!state.wbDrawing) return;
    state.wbDrawing = false;
    
    if (state.wbTool === 'laser') {
      state.wbCurrentPath = null;
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);

    const path = state.wbCurrentPath;
    if (!path) return;
    path.endX = x;
    path.endY = y;

    // Draw shapes locally
    if (path.tool === 'line') {
      ctx.strokeStyle = path.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(path.startX, path.startY);
      ctx.lineTo(x, y);
      ctx.stroke();
    } else if (path.tool === 'rect') {
      ctx.strokeStyle = path.color;
      ctx.lineWidth = 2;
      ctx.strokeRect(path.startX, path.startY, x - path.startX, y - path.startY);
    } else if (path.tool === 'circle') {
      const rx = Math.abs(x - path.startX) / 2;
      const ry = Math.abs(y - path.startY) / 2;
      const cx = path.startX + (x - path.startX) / 2;
      const cy = path.startY + (y - path.startY) / 2;
      ctx.strokeStyle = path.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Save and broadcast
    state.wbPaths.push(path);
    if (state.roomId && state.socket) {
      state.socket.emit('whiteboard-draw', { roomId: state.roomId, path });
    }
    state.wbCurrentPath = null;
  });

  // Undo/Redo & Save Buttons listeners
  if (dom.btnWbUndo) {
    dom.btnWbUndo.addEventListener('click', () => {
      if (state.wbPaths.length === 0) return;
      const undone = state.wbPaths[state.wbPaths.length - 1];
      state.wbRedoStack.push(undone);

      if (state.roomId) {
        state.socket.emit('whiteboard-undo', { roomId: state.roomId });
      } else {
        state.wbPaths.pop();
        redrawWhiteboard();
      }
    });
  }

  if (dom.btnWbRedo) {
    dom.btnWbRedo.addEventListener('click', () => {
      if (state.wbRedoStack.length === 0) return;
      const redone = state.wbRedoStack.pop();

      if (state.roomId) {
        state.socket.emit('whiteboard-draw', { roomId: state.roomId, path: redone });
      } else {
        state.wbPaths.push(redone);
        redrawWhiteboard();
      }
    });
  }

  if (dom.btnWbSave) {
    dom.btnWbSave.addEventListener('click', saveWhiteboardAsPNG);
  }

  dom.wbOverlay.addEventListener('transitionend', (e) => {
    if (e.target === dom.wbOverlay && !dom.wbOverlay.classList.contains('hidden')) {
      resizeWhiteboard();
    }
  });

  window.addEventListener('resize', () => {
    if (!dom.wbOverlay.classList.contains('hidden')) {
      resizeWhiteboard();
    }
  });
}

export function drawPathOnCanvas(ctx, path) {
  ctx.strokeStyle = path.color;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';

  if (path.tool === 'pen' && path.points.length > 1) {
    ctx.beginPath();
    ctx.moveTo(path.points[0].x, path.points[0].y);
    for (let i = 1; i < path.points.length; i++) {
      ctx.lineTo(path.points[i].x, path.points[i].y);
    }
    ctx.stroke();
  } else if (path.tool === 'line') {
    ctx.beginPath();
    ctx.moveTo(path.startX, path.startY);
    ctx.lineTo(path.endX, path.endY);
    ctx.stroke();
  } else if (path.tool === 'rect') {
    ctx.strokeRect(path.startX, path.startY, path.endX - path.startX, path.endY - path.startY);
  } else if (path.tool === 'circle') {
    const rx = Math.abs(path.endX - path.startX) / 2;
    const ry = Math.abs(path.endY - path.startY) / 2;
    const cx = path.startX + (path.endX - path.startX) / 2;
    const cy = path.startY + (path.endY - path.startY) / 2;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
}

export function drawRemotePath(path) {
  const ctx = dom.wbCanvas.getContext('2d');
  drawPathOnCanvas(ctx, path);
  state.wbPaths.push(path);
}

export function clearWhiteboard(broadcast) {
  const ctx = dom.wbCanvas.getContext('2d');
  ctx.clearRect(0, 0, dom.wbCanvas.width, dom.wbCanvas.height);
  state.wbPaths = [];
  state.wbRedoStack = [];
  if (broadcast && state.roomId) {
    state.socket.emit('whiteboard-clear', { roomId: state.roomId });
  }
}

export function resizeWhiteboard() {
  const container = dom.wbCanvas.parentElement;
  if (!container) return;
  const rect = container.getBoundingClientRect();
  const headerHeight = 45;
  let stripHeight = 0;
  
  const strip = document.getElementById('wb-video-strip');
  if (strip && strip.classList.contains('docked')) {
    stripHeight = 145;
  }
  
  const newWidth = Math.max(rect.width, 400);
  const newHeight = Math.max(rect.height - headerHeight - stripHeight, 300);
  
  if (dom.wbCanvas.width !== newWidth || dom.wbCanvas.height !== newHeight) {
    dom.wbCanvas.width = newWidth;
    dom.wbCanvas.height = newHeight;
  }
  redrawWhiteboard();
}

export function redrawWhiteboard() {
  const ctx = dom.wbCanvas.getContext('2d');
  ctx.clearRect(0, 0, dom.wbCanvas.width, dom.wbCanvas.height);
  state.wbPaths.forEach(path => {
    drawPathOnCanvas(ctx, path);
  });
}

export function saveWhiteboardAsPNG() {
  const canvas = dom.wbCanvas;
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = canvas.width;
  tempCanvas.height = canvas.height;
  const tempCtx = tempCanvas.getContext('2d');

  // Fill white background so drawings are visible on any image viewer
  tempCtx.fillStyle = '#ffffff';
  tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
  tempCtx.drawImage(canvas, 0, 0);

  const url = tempCanvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url;
  a.download = `apex-whiteboard-${state.roomId || 'local'}-${Date.now()}.png`;
  a.click();
}

let laserLoopId = null;

export function addLaserPointLocal(x, y, isStart) {
  if (!state.vanishingPaths) state.vanishingPaths = [];
  
  if (isStart || state.vanishingPaths.length === 0) {
    state.vanishingPaths.push({
      points: [{ x, y }],
      timestamp: Date.now()
    });
  } else {
    const lastStroke = state.vanishingPaths[state.vanishingPaths.length - 1];
    lastStroke.points.push({ x, y });
    lastStroke.timestamp = Date.now();
  }
  
  startLaserRenderLoop();
}

function startLaserRenderLoop() {
  if (laserLoopId) return;
  
  function loop() {
    const now = Date.now();
    const fadeDuration = 1000;
    
    state.vanishingPaths = (state.vanishingPaths || []).filter(stroke => {
      return now - stroke.timestamp < fadeDuration;
    });
    
    redrawWhiteboard();
    
    const ctx = dom.wbCanvas.getContext('2d');
    state.vanishingPaths.forEach(stroke => {
      const elapsed = now - stroke.timestamp;
      const opacity = Math.max(0, 1 - elapsed / fadeDuration);
      
      ctx.strokeStyle = `rgba(255, 59, 48, ${opacity})`;
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.shadowBlur = 6;
      ctx.shadowColor = 'rgba(255, 59, 48, 0.8)';
      
      if (stroke.points.length > 1) {
        ctx.beginPath();
        ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
        for (let i = 1; i < stroke.points.length; i++) {
          ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
        }
        ctx.stroke();
      } else if (stroke.points.length === 1) {
        ctx.beginPath();
        ctx.arc(stroke.points[0].x, stroke.points[0].y, 5, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 59, 48, ${opacity})`;
        ctx.fill();
      }
      
      ctx.shadowBlur = 0;
    });
    
    if (state.vanishingPaths.length > 0) {
      laserLoopId = requestAnimationFrame(loop);
    } else {
      laserLoopId = null;
      redrawWhiteboard();
    }
  }
  
  laserLoopId = requestAnimationFrame(loop);
}
