// server.js — Apex conferencing backend
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const db = require('./database');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;
const LK_KEY = process.env.LIVEKIT_API_KEY || '';
const LK_SECRET = process.env.LIVEKIT_API_SECRET || '';
const LK_WS = process.env.LIVEKIT_WS_URL || '';

const crypto = require('crypto');
const JWT_SECRET = process.env.JWT_SECRET || 'apex_classroom_default_stable_fallback_secret_key';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- STATELESS SIGNED TOKEN UTILS ----------

function generateToken(user) {
  const payload = {
    userId: user.id,
    username: user.username,
    exp: Date.now() + 1000 * 60 * 60 * 24 // 24 hours
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const hmac = crypto.createHmac('sha256', JWT_SECRET);
  hmac.update(payloadB64);
  const signature = hmac.digest('base64url');
  return `${payloadB64}.${signature}`;
}

function verifyToken(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, signature] = parts;
  
  const hmac = crypto.createHmac('sha256', JWT_SECRET);
  hmac.update(payloadB64);
  const expectedSignature = hmac.digest('base64url');
  if (signature !== expectedSignature) return null;
  
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

function getCookie(req, name) {
  const cookieHeader = req.headers.cookie || '';
  const cookies = cookieHeader.split(';').reduce((acc, cookie) => {
    const parts = cookie.split('=');
    const key = parts[0].trim();
    const value = parts.slice(1).join('=').trim();
    if (key) acc[key] = value;
    return acc;
  }, {});
  return cookies[name] || null;
}

function setSessionCookie(res, req, token, maxAge = 86400) {
  const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const secureFlag = isSecure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `apex_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureFlag}`);
}

function clearSessionCookie(res, req) {
  const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const secureFlag = isSecure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `apex_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag}`);
}

function authenticate(req, res, next) {
  const token = getCookie(req, 'apex_session');
  const user = verifyToken(token);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  req.user = user;
  next();
}

// ---------- REST API ----------

// Auth endpoints
app.post('/api/auth/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password || username.length < 3 || password.length < 6) {
    return res.status(400).json({ error: 'Username (min 3 chars) and password (min 6 chars) are required' });
  }
  try {
    const existing = db.getUserByUsername(username);
    if (existing) {
      return res.status(400).json({ error: 'Username is already taken' });
    }
    const id = uuidv4().slice(0, 8);
    const user = db.createUser(id, username, password);
    const token = generateToken(user);
    setSessionCookie(res, req, token);
    res.json({ id: user.id, username: user.username });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  try {
    const user = db.getUserByUsername(username);
    if (!user || !db.verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    const token = generateToken(user);
    setSessionCookie(res, req, token);
    res.json({ id: user.id, username: user.username });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/google', async (req, res) => {
  const { credential } = req.body;
  if (!credential) {
    return res.status(400).json({ error: 'Credential is required' });
  }
  try {
    const googleRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${credential}`);
    if (!googleRes.ok) {
      return res.status(401).json({ error: 'Invalid Google credential' });
    }
    const payload = await googleRes.json();
    const clientId = process.env.GOOGLE_CLIENT_ID || '607768078052-16lmjehbrsfsfdhka89efg0d48vr7cev.apps.googleusercontent.com';
    if (payload.aud !== clientId) {
      return res.status(401).json({ error: 'Invalid audience' });
    }
    
    const email = payload.email;
    const username = payload.name ? payload.name.replace(/\s+/g, '').toLowerCase() : email.split('@')[0];
    
    // Check if user exists in SQLite, if not create them
    let user = db.getUserByUsername(username);
    if (!user) {
      const id = uuidv4().slice(0, 8);
      const randomPassword = crypto.randomBytes(16).toString('hex');
      try {
        user = db.createUser(id, username, randomPassword);
      } catch (e) {
        const uniqueUsername = `${username}_${crypto.randomBytes(2).toString('hex')}`;
        user = db.createUser(id, uniqueUsername, randomPassword);
      }
    }
    
    const token = generateToken(user);
    setSessionCookie(res, req, token);
    res.json({ id: user.id, username: user.username });
  } catch (err) {
    console.error('Google Auth Failed:', err);
    res.status(500).json({ error: 'Google authentication failed' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  clearSessionCookie(res, req);
  res.json({ ok: true });
});

app.get('/api/auth/session', (req, res) => {
  const token = getCookie(req, 'apex_session');
  const user = verifyToken(token);
  if (!user) {
    return res.json({ user: null });
  }
  res.json({ user: { id: user.userId, username: user.username } });
});

// Generate a LiveKit token for joining a room (publicly accessible)
app.post('/api/token', async (req, res) => {
  const { roomId, identity, name } = req.body;
  if (!roomId || !identity) {
    return res.status(400).json({ error: 'roomId and identity are required' });
  }
  if (!LK_KEY || !LK_SECRET) {
    return res.json({ token: null, sandbox: true, wsUrl: null });
  }
  try {
    const { AccessToken } = require('livekit-server-sdk');
    const at = new AccessToken(LK_KEY, LK_SECRET, {
      identity,
      name: name || identity,
      ttl: '2h'
    });
    at.addGrant({
      roomJoin: true,
      room: roomId,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true
    });
    const token = await at.toJwt();
    res.json({ token, sandbox: false, wsUrl: LK_WS });
  } catch (err) {
    console.error('Token generation failed:', err.message);
    res.json({ token: null, sandbox: true, wsUrl: null });
  }
});

// Sessions (Authenticated)
app.post('/api/sessions', authenticate, (req, res) => {
  const { title, hostName } = req.body;
  const id = uuidv4().slice(0, 8);
  try {
    const session = db.createSession(id, title || 'Untitled Meeting', hostName || req.user.username, req.user.userId);
    res.json(session);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/sessions', authenticate, (req, res) => {
  res.json(db.listSessions(req.user.userId));
});

app.post('/api/sessions/:id/end', authenticate, (req, res) => {
  try {
    const session = db.endSession(req.params.id);
    res.json(session);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Attendance (Authenticated)
app.get('/api/sessions/:id/attendance', authenticate, (req, res) => {
  res.json(db.getAttendance(req.params.id));
});

// Chat history (Authenticated)
app.get('/api/sessions/:id/chat', authenticate, (req, res) => {
  res.json(db.getChatHistory(req.params.id));
});

// Export (Authenticated)
app.get('/api/sessions/:id/export/:format', authenticate, (req, res) => {
  const { id, format } = req.params;
  if (format === 'json') {
    res.json(db.exportSessionJSON(id));
  } else if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=session-${id}.csv`);
    res.send(db.exportSessionCSV(id));
  } else {
    res.status(400).json({ error: 'Format must be json or csv' });
  }
});

// Scheduled meetings (Authenticated)
app.get('/api/scheduled', authenticate, (req, res) => {
  res.json(db.listScheduledMeetings(req.user.userId));
});

app.post('/api/scheduled', authenticate, (req, res) => {
  const { title, description, scheduledFor, durationMinutes, hostName } = req.body;
  const id = uuidv4().slice(0, 8);
  try {
    const meeting = db.scheduleMeeting(id, title, description, scheduledFor, durationMinutes, hostName || req.user.username, req.user.userId);
    res.json(meeting);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/scheduled/:id', authenticate, (req, res) => {
  db.deleteScheduledMeeting(req.params.id);
  res.json({ ok: true });
});

// ---------- SOCKET.IO ----------

const rooms = new Map(); // roomId -> Map of socket ids -> participantInfo
const lockedRooms = new Set();
const waitingRooms = new Set();
const waitingSockets = new Map(); // socketId -> { socket, roomId, participantId, displayName }
const slideControllers = new Map(); // roomId -> socketId
const handRaiseQueues = new Map(); // roomId -> Array of { socketId, participantId, displayName, timestamp }
const chatPermissions = new Map(); // roomId -> String ('none' | 'host-only' | 'public' | 'public-private')

function hasModPowers(roomId, socketId) {
  const room = rooms.get(roomId);
  if (!room) return false;
  const p = room.get(socketId);
  return p && (p.role === 'host' || p.role === 'cohost');
}

io.on('connection', (socket) => {
  let currentRoom = null;
  let participantInfo = null;

  socket.on('join-room', ({ roomId, participantId, displayName, role }) => {
    // If room is locked and user is not host, reject
    if (lockedRooms.has(roomId) && role !== 'host') {
      socket.emit('room-locked-error', { roomId });
      return;
    }

    // If waiting room is enabled and user is not host
    if (waitingRooms.has(roomId) && role !== 'host') {
      currentRoom = roomId + '-waiting';
      participantInfo = { participantId, displayName, role: 'participant' };
      socket.join(currentRoom);
      waitingSockets.set(socket.id, { socket, roomId, participantId, displayName });
      
      socket.emit('waiting-room-joined', { roomId });
      // Notify host in the main room
      io.to(roomId).emit('waiting-participant-joined', {
        socketId: socket.id,
        participantId,
        displayName
      });
      return;
    }

    currentRoom = roomId;
    participantInfo = { participantId, displayName, role: role || 'participant' };
    socket.join(roomId);

    if (!rooms.has(roomId)) rooms.set(roomId, new Map());
    rooms.get(roomId).set(socket.id, participantInfo);

    // Log attendance
    try { db.logJoin(roomId, participantId, displayName, role); } catch (e) { /* session may not exist yet */ }

    // Notify others
    socket.to(roomId).emit('participant-joined', {
      socketId: socket.id,
      ...participantInfo
    });

    // Send current participant list to the joiner
    const participants = [];
    rooms.get(roomId).forEach((info, sid) => {
      if (sid !== socket.id) participants.push({ socketId: sid, ...info });
    });
    socket.emit('room-participants', participants);

    // Send current chronological hand-raise queue to joiner
    const hrQueue = handRaiseQueues.get(roomId) || [];
    socket.emit('hand-raise-queue-changed', hrQueue);

    // Send current chat permissions to joiner
    const cPerms = chatPermissions.get(roomId) || 'public-private';
    socket.emit('chat-permissions-changed', { permissions: cPerms });

    // Send whiteboard history
    try {
      const paths = db.getWhiteboardPaths(roomId);
      socket.emit('whiteboard-history', paths.map(p => JSON.parse(p)));
    } catch (e) {
      console.error('Failed to load whiteboard history:', e.message);
    }
  });

  // WebRTC signaling
  socket.on('signal-offer', ({ targetSocketId, offer }) => {
    io.to(targetSocketId).emit('signal-offer', { fromSocketId: socket.id, offer });
  });

  socket.on('signal-answer', ({ targetSocketId, answer }) => {
    io.to(targetSocketId).emit('signal-answer', { fromSocketId: socket.id, answer });
  });

  socket.on('signal-candidate', ({ targetSocketId, candidate }) => {
    io.to(targetSocketId).emit('signal-candidate', { fromSocketId: socket.id, candidate });
  });

  // Chat
  socket.on('chat-message', ({ roomId, senderId, senderName, message, targetSocketId, recipientName }) => {
    const payload = { 
      senderId, 
      senderName, 
      message, 
      timestamp: new Date().toISOString(),
      isPrivate: !!targetSocketId,
      recipientName
    };
    if (targetSocketId) {
      io.to(targetSocketId).emit('chat-message', payload);
      socket.emit('chat-message', payload);
    } else {
      io.to(roomId).emit('chat-message', payload);
      try { db.saveChat(roomId, senderId, senderName, message); } catch (e) { /* ok */ }
    }
  });

  // Whiteboard vector events
  socket.on('whiteboard-draw', ({ roomId, path }) => {
    socket.to(roomId).emit('whiteboard-draw', { fromSocketId: socket.id, path });
    try {
      db.saveWhiteboardPath(roomId, JSON.stringify(path));
    } catch (e) {
      console.error('Failed to save whiteboard path:', e.message);
    }
  });

  socket.on('whiteboard-clear', ({ roomId }) => {
    socket.to(roomId).emit('whiteboard-clear', {});
    try {
      db.clearWhiteboardPaths(roomId);
    } catch (e) {
      console.error('Failed to clear whiteboard paths:', e.message);
    }
  });

  // Reactions
  socket.on('reaction', ({ roomId, emoji, senderName }) => {
    socket.to(roomId).emit('reaction', { emoji, senderName });
  });

  // Hand raise
  socket.on('hand-raise', ({ roomId, participantId, raised }) => {
    if (!handRaiseQueues.has(roomId)) {
      handRaiseQueues.set(roomId, []);
    }
    let queue = handRaiseQueues.get(roomId);
    
    if (raised) {
      if (!queue.some(item => item.socketId === socket.id)) {
        const room = rooms.get(roomId);
        const pInfo = room ? room.get(socket.id) : null;
        queue.push({
          socketId: socket.id,
          participantId,
          displayName: pInfo ? pInfo.displayName : 'Participant',
          timestamp: Date.now()
        });
      }
    } else {
      queue = queue.filter(item => item.socketId !== socket.id);
      handRaiseQueues.set(roomId, queue);
    }
    
    io.to(roomId).emit('hand-raise-queue-changed', queue);
    io.to(roomId).emit('hand-raise', { participantId, raised });
  });

  // Host & Co-Host controls
  socket.on('toggle-cohost', ({ roomId, targetSocketId }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const sender = room.get(socket.id);
    if (!sender || sender.role !== 'host') return; // Only original host can toggle co-host

    const target = room.get(targetSocketId);
    if (!target) return;

    target.role = target.role === 'cohost' ? 'participant' : 'cohost';
    io.to(roomId).emit('role-changed', { socketId: targetSocketId, role: target.role });
  });

  socket.on('mute-participant', ({ roomId, targetSocketId }) => {
    if (!hasModPowers(roomId, socket.id)) return;
    io.to(targetSocketId).emit('mute-command');
  });

  socket.on('mute-all', ({ roomId }) => {
    if (!hasModPowers(roomId, socket.id)) return;
    socket.to(roomId).emit('mute-command');
  });

  socket.on('kick-participant', ({ roomId, targetSocketId }) => {
    if (!hasModPowers(roomId, socket.id)) return;
    io.to(targetSocketId).emit('kick-command');
  });

  socket.on('lower-hand', ({ roomId, targetParticipantId }) => {
    if (!hasModPowers(roomId, socket.id)) return;
    let queue = handRaiseQueues.get(roomId);
    if (queue) {
      queue = queue.filter(item => item.participantId !== targetParticipantId);
      handRaiseQueues.set(roomId, queue);
      io.to(roomId).emit('hand-raise-queue-changed', queue);
    }
    io.to(roomId).emit('hand-raise', { participantId: targetParticipantId, raised: false });
  });

  // Security toggles
  socket.on('lock-room', ({ roomId, locked }) => {
    if (!hasModPowers(roomId, socket.id)) return;
    if (locked) {
      lockedRooms.add(roomId);
    } else {
      lockedRooms.delete(roomId);
    }
    io.to(roomId).emit('room-lock-changed', { locked });
  });

  socket.on('toggle-waiting-room', ({ roomId, enabled }) => {
    if (!hasModPowers(roomId, socket.id)) return;
    if (enabled) {
      waitingRooms.add(roomId);
    } else {
      waitingRooms.delete(roomId);
    }
    io.to(roomId).emit('waiting-room-changed', { enabled });
  });

  socket.on('waiting-admit', ({ roomId, targetSocketId }) => {
    if (!hasModPowers(roomId, socket.id)) return;
    const waitingInfo = waitingSockets.get(targetSocketId);
    if (!waitingInfo) return;

    const { socket: targetSocket, participantId, displayName } = waitingInfo;
    waitingSockets.delete(targetSocketId);

    // Remove from waiting room, join main room
    targetSocket.leave(roomId + '-waiting');
    targetSocket.join(roomId);
    targetSocket.currentRoom = roomId;

    const role = 'participant';
    const info = { participantId, displayName, role };
    if (!rooms.has(roomId)) rooms.set(roomId, new Map());
    rooms.get(roomId).set(targetSocketId, info);

    // Log attendance
    try { db.logJoin(roomId, participantId, displayName, role); } catch (e) { /* session may not exist yet */ }

    // Tell target they are admitted
    targetSocket.emit('waiting-admitted', { roomId });

    // Tell host/participants in main room that they joined
    targetSocket.to(roomId).emit('participant-joined', {
      socketId: targetSocketId,
      ...info
    });

    // Send participant list to admitted user
    const participants = [];
    rooms.get(roomId).forEach((i, sid) => {
      if (sid !== targetSocketId) participants.push({ socketId: sid, ...i });
    });
    targetSocket.emit('room-participants', participants);

    // Send current chronological hand-raise queue to admitted user
    const hrQueue = handRaiseQueues.get(roomId) || [];
    targetSocket.emit('hand-raise-queue-changed', hrQueue);

    // Send current chat permissions to admitted user
    const cPerms = chatPermissions.get(roomId) || 'public-private';
    targetSocket.emit('chat-permissions-changed', { permissions: cPerms });

    // Send whiteboard history to admitted user
    try {
      const paths = db.getWhiteboardPaths(roomId);
      targetSocket.emit('whiteboard-history', paths.map(p => JSON.parse(p)));
    } catch (e) {
      console.error('Failed to load whiteboard history:', e.message);
    }

    // Tell everyone to remove this participant from host's waiting queue
    io.to(roomId).emit('waiting-participant-left', { socketId: targetSocketId });
  });

  socket.on('waiting-decline', ({ roomId, targetSocketId }) => {
    if (!hasModPowers(roomId, socket.id)) return;
    const waitingInfo = waitingSockets.get(targetSocketId);
    if (!waitingInfo) return;

    const { socket: targetSocket } = waitingInfo;
    waitingSockets.delete(targetSocketId);

    targetSocket.emit('waiting-declined');
    targetSocket.disconnect();

    // Tell everyone in main room that they left waiting room
    io.to(roomId).emit('waiting-participant-left', { socketId: targetSocketId });
  });

  // Polling events
  socket.on('poll-create', ({ roomId, poll }) => {
    if (!hasModPowers(roomId, socket.id)) return;
    socket.to(roomId).emit('poll-created', poll);
  });

  socket.on('poll-vote', ({ roomId, pollId, optionIndex, voterName }) => {
    io.to(roomId).emit('poll-voted', { pollId, optionIndex, voterName, socketId: socket.id });
  });

  socket.on('poll-end', ({ roomId, pollId, results }) => {
    if (!hasModPowers(roomId, socket.id)) return;
    io.to(roomId).emit('poll-ended', { pollId, results });
  });

  // Breakout rooms
  socket.on('create-breakout', ({ roomId, groups }) => {
    if (!hasModPowers(roomId, socket.id)) return;
    io.to(roomId).emit('breakout-created', { groups });
  });

  socket.on('breakout-start', ({ roomId, rooms, duration, allowSelfSelect }) => {
    if (!hasModPowers(roomId, socket.id)) return;
    io.to(roomId).emit('breakout-started-broadcast', { rooms, duration, allowSelfSelect });
    rooms.forEach(r => {
      r.participantSocketIds.forEach(sid => {
        io.to(sid).emit('breakout-assigned', { roomName: r.roomName, duration });
      });
    });
  });

  socket.on('breakout-end', ({ roomId, roomCount }) => {
    if (!hasModPowers(roomId, socket.id)) return;
    for (let i = 1; i <= roomCount; i++) {
      io.to(`${roomId}-breakout-${i}`).emit('breakout-ended');
    }
  });

  // Annotation events
  socket.on('annotation-draw', ({ roomId, path }) => {
    socket.to(roomId).emit('annotation-draw', { fromSocketId: socket.id, path });
  });

  socket.on('annotation-clear', ({ roomId }) => {
    io.to(roomId).emit('annotation-clear');
  });

  socket.on('screenshare-start', ({ roomId }) => {
    socket.to(roomId).emit('screenshare-started', { fromSocketId: socket.id });
  });

  socket.on('screenshare-stop', ({ roomId }) => {
    socket.to(roomId).emit('screenshare-stopped', { fromSocketId: socket.id });
  });

  socket.on('video-filter-change', ({ roomId, filter }) => {
    socket.to(roomId).emit('video-filter-changed', { socketId: socket.id, filter });
  });

  // Slide Share & Control
  socket.on('slide-share-start', ({ roomId, slideIndex, slides }) => {
    if (!hasModPowers(roomId, socket.id)) return;
    io.to(roomId).emit('slide-share-started', { presenterSocketId: socket.id, slideIndex, slides });
  });

  socket.on('slide-share-stop', ({ roomId }) => {
    if (!hasModPowers(roomId, socket.id)) return;
    slideControllers.delete(roomId);
    io.to(roomId).emit('slide-share-stopped');
  });

  socket.on('slide-change', ({ roomId, slideIndex }) => {
    const isMod = hasModPowers(roomId, socket.id);
    const hasControl = slideControllers.get(roomId) === socket.id;
    if (!isMod && !hasControl) return; // Only mods or granted controller can change slides
    io.to(roomId).emit('slide-changed', { slideIndex });
  });

  socket.on('slide-grant-control', ({ roomId, targetSocketId }) => {
    if (!hasModPowers(roomId, socket.id)) return;
    slideControllers.set(roomId, targetSocketId);
    io.to(roomId).emit('slide-control-granted', { targetSocketId });
  });

  socket.on('slide-revoke-control', ({ roomId }) => {
    if (!hasModPowers(roomId, socket.id)) return;
    slideControllers.delete(roomId);
    io.to(roomId).emit('slide-control-revoked');
  });

  socket.on('change-chat-permissions', ({ roomId, permissions }) => {
    if (!hasModPowers(roomId, socket.id)) return;
    chatPermissions.set(roomId, permissions);
    io.to(roomId).emit('chat-permissions-changed', { permissions });
  });

  socket.on('unmute-request', ({ roomId, targetSocketId }) => {
    if (!hasModPowers(roomId, socket.id)) return;
    io.to(targetSocketId).emit('unmute-request-prompt');
  });

  // Disconnect
  socket.on('disconnect', () => {
    if (waitingSockets.has(socket.id)) {
      const { roomId } = waitingSockets.get(socket.id);
      waitingSockets.delete(socket.id);
      io.to(roomId).emit('waiting-participant-left', { socketId: socket.id });
    }

    if (currentRoom && rooms.has(currentRoom)) {
      rooms.get(currentRoom).delete(socket.id);
      if (rooms.get(currentRoom).size === 0) rooms.delete(currentRoom);
      socket.to(currentRoom).emit('participant-left', { socketId: socket.id });
      if (participantInfo) {
        try { db.logLeave(currentRoom, participantInfo.participantId); } catch (e) { /* ok */ }
      }
      
      // Clean up hand raise queue
      let queue = handRaiseQueues.get(currentRoom);
      if (queue) {
        queue = queue.filter(item => item.socketId !== socket.id);
        handRaiseQueues.set(currentRoom, queue);
        io.to(currentRoom).emit('hand-raise-queue-changed', queue);
      }
    }
  });
});

// ---------- START ----------

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  ╔══════════════════════════════════════╗`);
  console.log(`  ║   Apex Classroom — Running           ║`);
  console.log(`  ║   http://localhost:${PORT}              ║`);
  console.log(`  ║   LiveKit: ${LK_KEY ? 'Configured' : 'Not configured (Sandbox Mode)'}     ║`);
  console.log(`  ╚══════════════════════════════════════╝\n`);
});
