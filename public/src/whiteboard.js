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
    state.wbCurrentPath = {
      tool: state.wbTool,
      color: state.wbColor,
      points: [{ x: state.wbLastX, y: state.wbLastY }],
      startX: state.wbLastX,
      startY: state.wbLastY
    };
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!state.wbDrawing) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);

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
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);

    const path = state.wbCurrentPath;
    if (!path) return;
    path.endX = x;
    path.endY = y;

    // Draw shapes
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

    // Broadcast
    state.wbPaths.push(path);
    if (state.roomId) {
      state.socket.emit('whiteboard-draw', { roomId: state.roomId, path });
    }
    state.wbCurrentPath = null;
  });

  window.addEventListener('resize', () => {
    if (!dom.wbOverlay.classList.contains('hidden')) {
      resizeWhiteboard();
    }
  });
}

export function drawRemotePath(path) {
  const ctx = dom.wbCanvas.getContext('2d');
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

  state.wbPaths.push(path);
}

export function clearWhiteboard(broadcast) {
  const ctx = dom.wbCanvas.getContext('2d');
  ctx.clearRect(0, 0, dom.wbCanvas.width, dom.wbCanvas.height);
  state.wbPaths = [];
  if (broadcast && state.roomId) {
    state.socket.emit('whiteboard-clear', { roomId: state.roomId });
  }
}

export function resizeWhiteboard() {
  const container = dom.wbCanvas.parentElement;
  if (!container) return;
  const rect = container.getBoundingClientRect();
  // Keep canvas at reasonable resolution
  dom.wbCanvas.width = Math.max(rect.width, 400);
  dom.wbCanvas.height = Math.max(rect.height - 45, 300);
  // Redraw existing paths
  redrawWhiteboard();
}

export function redrawWhiteboard() {
  const ctx = dom.wbCanvas.getContext('2d');
  ctx.clearRect(0, 0, dom.wbCanvas.width, dom.wbCanvas.height);
  state.wbPaths.forEach(path => drawRemotePath(path));
}
