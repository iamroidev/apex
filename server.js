// server.js — Apex conferencing backend
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');
const db = require('./database');

const app = express();
const server = http.createServer(app);

const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS || '*';
const io = new Server(server, { 
  cors: { origin: ALLOWED_ORIGINS === '*' ? '*' : ALLOWED_ORIGINS.split(',') },
  maxHttpBufferSize: 1e8
});

const PORT = process.env.PORT || 3000;
const LK_KEY = process.env.LIVEKIT_API_KEY || '';
const LK_SECRET = process.env.LIVEKIT_API_SECRET || '';
const LK_WS = process.env.LIVEKIT_WS_URL || '';

const crypto = require('crypto');
if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'apex_classroom_default_stable_fallback_secret_key') {
  console.warn('WARNING: JWT_SECRET is not set or using default. Generate a secure secret with: node -e "console.log(crypto.randomBytes(32).toString(\'hex\'))"');
}
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');

app.use((req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  next();
});

app.use(express.json({ limit: '50mb' })); // Increased for file sharing
app.use(express.static(path.join(__dirname, 'public')));

// ---------- RATE LIMITING ----------
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // limit each IP to 20 auth requests per window
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // limit each IP to 100 API requests per minute
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ---------- INPUT SANITIZATION ----------
function sanitizeString(str, maxLen = 255) {
  if (typeof str !== 'string') return '';
  // Strip HTML tags and trim
  return str.replace(/<[^>]*>/g, '').trim().slice(0, maxLen);
}

// ---------- ICS CALENDAR GENERATOR ----------
function generateICS({ title, description, startDate, durationMinutes, roomId, hostName, organizer }) {
  const formatDT = (d) => {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth()+1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
  };
  const start = new Date(startDate);
  const end = new Date(start.getTime() + (durationMinutes || 60) * 60000);
  const uid = roomId + '-' + Date.now() + '@apexclassroom';
  const meetingUrl = `https://${process.env.PUBLIC_HOST || 'apexclassroom.duckdns.org'}/?join=${roomId}`;

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Apex Classroom//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    'UID:' + uid,
    'DTSTART:' + formatDT(start),
    'DTEND:' + formatDT(end),
    'SUMMARY:' + (title || 'Meeting'),
    'DESCRIPTION:' + (description || '') + '\\n\\nJoin link: ' + meetingUrl,
    'LOCATION:' + meetingUrl,
    'ORGANIZER;CN=' + (organizer || hostName || 'Host') + ':mailto:' + (process.env.EMAIL_USER || 'noreply@apexclassroom.duckdns.org'),
    'ATTENDEE:mailto:' + (process.env.EMAIL_USER || 'noreply@apexclassroom.duckdns.org'),
    'BEGIN:VALARM',
    'TRIGGER:-PT15M',
    'ACTION:DISPLAY',
    'DESCRIPTION:Reminder: ' + (title || 'Meeting') + ' starts in 15 minutes',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');
}

// ---------- EMAIL NOTIFICATIONS ----------
async function sendEmail(to, subject, htmlBody) {
  const emailUser = process.env.EMAIL_USER;
  const emailPass = process.env.EMAIL_PASS;
  if (!emailUser || !emailPass) return false;
  try {
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: emailUser, pass: emailPass }
    });
    await transporter.sendMail({
      from: `"Apex Classroom" <${emailUser}>`,
      to,
      subject,
      html: htmlBody
    });
    return true;
  } catch (e) {
    console.error('Email send failed:', e.message);
    return false;
  }
}

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
  } catch (e) { return null; }
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
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  req.user = user;
  next();
}

// ---------- HEALTH CHECK ----------
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    livekitConfigured: !!LK_KEY
  });
});

// ---------- MEETING ANALYTICS ----------
app.get('/api/analytics', authenticate, (req, res) => {
  try {
    const totalSessions = db.getDb().prepare('SELECT COUNT(*) as count FROM sessions WHERE user_id = ?').get(req.user.userId);
    const totalAttendance = db.getDb().prepare('SELECT COUNT(*) as count FROM attendance a JOIN sessions s ON a.session_id = s.id WHERE s.user_id = ?').get(req.user.userId);
    const avgDuration = db.getDb().prepare('SELECT COALESCE(AVG(a.duration_seconds), 0) as avg FROM attendance a JOIN sessions s ON a.session_id = s.id WHERE s.user_id = ? AND a.duration_seconds > 0').get(req.user.userId);
    const recentSessions = db.getDb().prepare('SELECT id, title, started_at, ended_at FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 5').all(req.user.userId);
    res.json({ totalSessions: totalSessions.count, totalAttendance: totalAttendance.count, avgDuration: Math.round(avgDuration.avg), recentSessions });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------- REST API ----------

// Auth endpoints (with rate limiting)
app.post('/api/auth/register', authLimiter, (req, res) => {
  const { username, password } = req.body;
  if (!username || !password || username.length < 3 || password.length < 6) return res.status(400).json({ error: 'Username (min 3 chars) and password (min 6 chars) are required' });
  const sanitizedUsername = sanitizeString(username, 30);
  if (!/^[a-zA-Z0-9_]+$/.test(sanitizedUsername)) return res.status(400).json({ error: 'Username can only contain letters, numbers, and underscores' });
  try {
    const existing = db.getUserByUsername(sanitizedUsername);
    if (existing) return res.status(400).json({ error: 'Username is already taken' });
    const id = uuidv4().slice(0, 8);
    const user = db.createUser(id, sanitizedUsername, password);
    const token = generateToken(user);
    setSessionCookie(res, req, token);
    res.json({ id: user.id, username: user.username });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/login', authLimiter, (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });
  try {
    const user = db.getUserByUsername(sanitizeString(username, 30));
    if (!user || !db.verifyPassword(password, user.password_hash)) return res.status(401).json({ error: 'Invalid username or password' });
    const token = generateToken(user);
    setSessionCookie(res, req, token);
    res.json({ id: user.id, username: user.username });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/google', authLimiter, async (req, res) => {
  const { credential } = req.body;
  if (!credential) return res.status(400).json({ error: 'Credential is required' });
  try {
    const googleRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${credential}`);
    if (!googleRes.ok) return res.status(401).json({ error: 'Invalid Google credential' });
    const payload = await googleRes.json();
    const clientId = process.env.GOOGLE_CLIENT_ID || '607768078052-16lmjehbrsfsfdhka89efg0d48vr7cev.apps.googleusercontent.com';
    if (payload.aud !== clientId) return res.status(401).json({ error: 'Invalid audience' });
    const email = payload.email;
    const username = payload.name ? payload.name.replace(/\s+/g, '').toLowerCase() : email.split('@')[0];
    let user = db.getUserByUsername(username);
    if (!user) {
      const id = uuidv4().slice(0, 8);
      const randomPassword = crypto.randomBytes(16).toString('hex');
      try { user = db.createUser(id, username, randomPassword); } catch (e) {
        const uniqueUsername = `${username}_${crypto.randomBytes(2).toString('hex')}`;
        user = db.createUser(id, uniqueUsername, randomPassword);
      }
    }
    const token = generateToken(user);
    setSessionCookie(res, req, token);
    res.json({ id: user.id, username: user.username });
  } catch (err) { console.error('Google Auth Failed:', err); res.status(500).json({ error: 'Google authentication failed' }); }
});

app.post('/api/auth/logout', (req, res) => { clearSessionCookie(res, req); res.json({ ok: true }); });
app.get('/api/auth/session', (req, res) => {
  const token = getCookie(req, 'apex_session');
  const user = verifyToken(token);
  if (!user) return res.json({ user: null });
  res.json({ user: { id: user.userId, username: user.username } });
});

// LiveKit token
app.post('/api/token', async (req, res) => {
  const { roomId, identity, name } = req.body;
  if (!roomId || !identity) return res.status(400).json({ error: 'roomId and identity are required' });
  if (!LK_KEY || !LK_SECRET) return res.json({ token: null, sandbox: true, wsUrl: null });
  try {
    const { AccessToken } = require('livekit-server-sdk');
    const at = new AccessToken(LK_KEY, LK_SECRET, { identity, name: name || identity, ttl: '2h' });
    at.addGrant({ roomJoin: true, room: roomId, canPublish: true, canSubscribe: true, canPublishData: true });
    const token = await at.toJwt();
    res.json({ token, sandbox: false, wsUrl: LK_WS });
  } catch (err) { console.error('Token generation failed:', err.message); res.json({ token: null, sandbox: true, wsUrl: null }); }
});

// Sessions (Authenticated)
app.post('/api/sessions', authenticate, (req, res) => {
  const { title, hostName, password, recurrence } = req.body;
  const id = uuidv4().slice(0, 8);
  try {
    const session = db.createSession(id, title || 'Untitled Meeting', hostName || req.user.username, req.user.userId, password || null, recurrence || null);
    res.json(session);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/sessions', authenticate, (req, res) => { res.json(db.listSessions(req.user.userId)); });
app.post('/api/sessions/:id/end', authenticate, (req, res) => {
  try { const session = db.endSession(req.params.id); res.json(session); } catch (err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/sessions/:id', (req, res) => {
  try {
    const session = db.getSession(req.params.id);
    if (session) return res.json({ session });
    const scheduled = db.getScheduledMeeting(req.params.id);
    if (scheduled) return res.json({ scheduled });
    res.status(404).json({ error: 'Session not found' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/sessions/:id/attendance', authenticate, (req, res) => { res.json(db.getAttendance(req.params.id)); });
app.get('/api/sessions/:id/chat', authenticate, (req, res) => { res.json(db.getChatHistory(req.params.id)); });

app.get('/api/sessions/:id/export/:format', authenticate, (req, res) => {
  const { id, format } = req.params;
  if (format === 'json') { res.json(db.exportSessionJSON(id)); }
  else if (format === 'csv') { res.setHeader('Content-Type', 'text/csv'); res.setHeader('Content-Disposition', `attachment; filename=session-${id}.csv`); res.send(db.exportSessionCSV(id)); }
  else { res.status(400).json({ error: 'Format must be json or csv' }); }
});

// Scheduled meetings (Authenticated)
app.get('/api/scheduled', authenticate, (req, res) => { res.json(db.listScheduledMeetings(req.user.userId)); });
app.post('/api/scheduled', authenticate, (req, res) => {
  const { title, description, scheduledFor, durationMinutes, hostName, password, recurrence } = req.body;
  const id = uuidv4().slice(0, 8);
  try {
    const meeting = db.scheduleMeeting(id, title, description, scheduledFor, durationMinutes, hostName || req.user.username, req.user.userId, password || null, recurrence || null);
    res.json(meeting);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.delete('/api/scheduled/:id', authenticate, (req, res) => { db.deleteScheduledMeeting(req.params.id); res.json({ ok: true }); });

// ICS Calendar Download
app.get('/api/sessions/:id/ics', (req, res) => {
  try {
    const session = db.getSession(req.params.id) || db.getScheduledMeeting(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    const icsContent = generateICS({
      title: session.title,
      description: session.description || 'Apex Classroom meeting',
      startDate: session.scheduled_for || session.started_at || new Date().toISOString(),
      durationMinutes: session.duration_minutes || 60,
      roomId: session.id,
      hostName: session.host_name
    });
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="apex-meeting-${session.id}.ics"`);
    res.send(icsContent);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Email Invite
app.post('/api/send-invite', authenticate, async (req, res) => {
  const { email, roomId, title, message } = req.body;
  if (!email || !roomId) return res.status(400).json({ error: 'Email and room ID are required' });
  const meetingUrl = `https://${process.env.PUBLIC_HOST || 'apexclassroom.duckdns.org'}/?join=${roomId}`;
  const sent = await sendEmail(email, `You're invited to ${title || 'a meeting'} on Apex`, `
    <div style="font-family:sans-serif;max-width:500px;margin:auto;border:2px solid #000;padding:20px;background:#0b0f19;color:#fff;">
      <h2 style="color:#00f2fe;">${title || 'Meeting Invitation'}</h2>
      <p>${message || 'You have been invited to join a meeting on Apex Classroom.'}</p>
      <p><strong>Room Code:</strong> ${roomId}</p>
      <a href="${meetingUrl}" style="display:inline-block;padding:12px 24px;background:#00f2fe;color:#000;text-decoration:none;font-weight:bold;border:2px solid #000;margin:10px 0;">Join Meeting</a>
      <p style="color:#9aa1b8;font-size:12px;">No account needed — just click the link and enter your name.</p>
    </div>
  `);
  res.json({ sent, message: sent ? 'Invite sent!' : 'Email not configured. Set EMAIL_USER and EMAIL_PASS in .env' });
});

// Meeting password verification endpoint
app.post('/api/verify-password', (req, res) => {
  const { roomId, password } = req.body;
  if (!roomId || !password) return res.status(400).json({ error: 'Room ID and password are required' });
  try {
    const session = db.getSession(roomId);
    if (session && session.password) return res.json({ valid: session.password === password });
    const scheduled = db.getScheduledMeeting(roomId);
    if (scheduled && scheduled.password) return res.json({ valid: scheduled.password === password });
    res.json({ valid: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------- SOCKET.IO ----------

const rooms = new Map();
const lockedRooms = new Set();
const waitingRooms = new Set();
const waitingSockets = new Map();
const slideControllers = new Map();
const handRaiseQueues = new Map();
const chatPermissions = new Map();
const screenShareControllers = new Map();
const spotlightQueue = new Map();
const hostKeys = new Map();
const muteOnEntry = new Map(); // roomId -> Set of participantIds to auto-mute on join

function hasModPowers(roomId, socketId) {
  const room = rooms.get(roomId);
  if (!room) return false;
  const p = room.get(socketId);
  return p && (p.role === 'host' || p.role === 'cohost');
}

io.on('connection', (socket) => {
  let currentRoom = null;
  let participantInfo = null;

  socket.on('join-room', ({ roomId, participantId, displayName, role, password, socketId }) => {
    let verifiedRole = 'participant';
    
    // Verify meeting password if needed
    try {
      const session = db.getSession(roomId);
      const scheduled = db.getScheduledMeeting(roomId);
      const stored = session || scheduled;
      if (stored && stored.password && stored.password !== password) {
        socket.emit('password-error', { roomId });
        return;
      }
    } catch (e) {}

    if (role === 'host' || role === 'cohost') {
      const cookieHeader = socket.handshake.headers.cookie || '';
      const token = cookieHeader.split(';').reduce((acc, cookie) => {
        const parts = cookie.split('=');
        if (parts[0].trim() === 'apex_session') return parts.slice(1).join('=').trim();
        return acc;
      }, null);
      const verifiedUser = verifyToken(token);
      let session = null;
      try { session = db.getSession(roomId); } catch (e) {}
      let scheduled = null;
      try { scheduled = db.getScheduledMeeting(roomId); } catch (e) {}
      if (session || scheduled) {
        const ownerId = session?.user_id || scheduled?.user_id;
        if (ownerId && verifiedUser && ownerId === verifiedUser.userId) {
          verifiedRole = role;
        } else {
          const hk = hostKeys.get(roomId);
          if (hk && socket.handshake.auth && socket.handshake.auth.hostKey === hk) {
            verifiedRole = role;
          } else {
            verifiedRole = 'participant';
          }
        }
      } else {
        verifiedRole = role || 'participant';
      }
    } else {
      verifiedRole = role || 'participant';
    }
    role = verifiedRole;

    if (lockedRooms.has(roomId) && role !== 'host') {
      socket.emit('room-locked-error', { roomId });
      return;
    }

    if (waitingRooms.has(roomId) && role !== 'host') {
      currentRoom = roomId + '-waiting';
      participantInfo = { participantId, displayName, role: 'participant' };
      socket.join(currentRoom);
      waitingSockets.set(socket.id, { socket, roomId, participantId, displayName });
      socket.emit('waiting-room-joined', { roomId });
      io.to(roomId).emit('waiting-participant-joined', { socketId: socket.id, participantId, displayName });
      return;
    }

    currentRoom = roomId;
    participantInfo = { participantId, displayName, role: role || 'participant' };
    socket.join(roomId);
    if (!rooms.has(roomId)) rooms.set(roomId, new Map());
    rooms.get(roomId).set(socket.id, participantInfo);

    // Check mute-on-entry for this participant
    if (muteOnEntry.has(roomId) && muteOnEntry.get(roomId).has(participantId)) {
      socket.emit('mute-command');
    }

    // Generate host key for the host
    if (role === 'host' && !hostKeys.has(roomId)) {
      hostKeys.set(roomId, uuidv4().slice(0, 6).toUpperCase());
    }
    if (role === 'host') {
      socket.emit('host-key-generated', { hostKey: hostKeys.get(roomId) });
    }

    try { db.logJoin(roomId, participantId, displayName, role); } catch (e) {}

    socket.to(roomId).emit('participant-joined', { socketId: socket.id, ...participantInfo });

    const participants = [];
    rooms.get(roomId).forEach((info, sid) => {
      if (sid !== socket.id) participants.push({ socketId: sid, ...info });
    });
    socket.emit('room-participants', participants);

    const hrQueue = handRaiseQueues.get(roomId) || [];
    socket.emit('hand-raise-queue-changed', hrQueue);
    const cPerms = chatPermissions.get(roomId) || 'public-private';
    socket.emit('chat-permissions-changed', { permissions: cPerms });

    try {
      const paths = db.getWhiteboardPaths(roomId);
      socket.emit('whiteboard-history', paths.map(p => JSON.parse(p)));
    } catch (e) { console.error('Failed to load whiteboard history:', e.message); }
  });

  // WebRTC signaling
  socket.on('signal-offer', ({ targetSocketId, offer }) => { io.to(targetSocketId).emit('signal-offer', { fromSocketId: socket.id, offer }); });
  socket.on('signal-answer', ({ targetSocketId, answer }) => { io.to(targetSocketId).emit('signal-answer', { fromSocketId: socket.id, answer }); });
  socket.on('signal-candidate', ({ targetSocketId, candidate }) => { io.to(targetSocketId).emit('signal-candidate', { fromSocketId: socket.id, candidate }); });

  // Chat
  socket.on('chat-message', ({ roomId, senderId, senderName, message, targetSocketId, recipientName }) => {
    const roomPerms = chatPermissions.get(roomId) || 'public-private';
    const senderIsMod = hasModPowers(roomId, socket.id);
    if (roomPerms === 'none' && !senderIsMod) return;
    if (roomPerms === 'host-only' && !senderIsMod && !targetSocketId) return;
    if (roomPerms === 'public' && !senderIsMod && targetSocketId) return;
    
    // @mentions
    const mentions = message.match(/@(\w+)/g);
    if (mentions) {
      mentions.forEach(mention => {
        const username = mention.slice(1).toLowerCase();
        if (rooms.has(roomId)) {
          rooms.get(roomId).forEach((p, sid) => {
            const cleanName = p.displayName ? p.displayName.toLowerCase().replace(/\s+/g, '_') : '';
            if (p.displayName && (p.displayName.toLowerCase().includes(username) || cleanName.includes(username))) {
              io.to(sid).emit('chat-mention', { fromName: senderName, mention, message });
            }
          });
        }
      });
    }

    const payload = { senderId, senderName, message, timestamp: new Date().toISOString(), isPrivate: !!targetSocketId, recipientName };
    if (targetSocketId) {
      io.to(targetSocketId).emit('chat-message', payload);
      socket.emit('chat-message', payload);
    } else {
      io.to(roomId).emit('chat-message', payload);
      try { db.saveChat(roomId, senderId, senderName, message); } catch (e) {}
    }
  });

  // Whiteboard
  socket.on('whiteboard-draw', ({ roomId, path }) => { socket.to(roomId).emit('whiteboard-draw', { fromSocketId: socket.id, path }); try { db.saveWhiteboardPath(roomId, JSON.stringify(path)); } catch (e) {} });
  socket.on('whiteboard-clear', ({ roomId }) => { socket.to(roomId).emit('whiteboard-clear', {}); try { db.clearWhiteboardPaths(roomId); } catch (e) {} });
  socket.on('whiteboard-undo', ({ roomId }) => { try { db.undoLastWhiteboardPath(roomId); const paths = db.getWhiteboardPaths(roomId); io.to(roomId).emit('whiteboard-history', paths.map(p => JSON.parse(p))); } catch (e) {} });
  socket.on('rename-participant', ({ roomId, displayName }) => { if (roomId && rooms.has(roomId)) { const p = rooms.get(roomId).get(socket.id); if (p) { p.displayName = displayName; io.to(roomId).emit('participant-renamed', { socketId: socket.id, displayName }); } } });
  socket.on('speech-transcription', ({ roomId, text, final }) => { const room = rooms.get(roomId); const pInfo = room ? room.get(socket.id) : null; socket.to(roomId).emit('speech-transcription-broadcast', { senderId: socket.id, senderName: pInfo ? pInfo.displayName : 'Participant', text, final }); });
  socket.on('reaction', ({ roomId, emoji, senderName }) => { socket.to(roomId).emit('reaction', { emoji, senderName }); });

  socket.on('hand-raise', ({ roomId, participantId, raised }) => {
    if (!handRaiseQueues.has(roomId)) handRaiseQueues.set(roomId, []);
    let queue = handRaiseQueues.get(roomId);
    if (raised) {
      if (!queue.some(item => item.socketId === socket.id)) {
        const room = rooms.get(roomId);
        const pInfo = room ? room.get(socket.id) : null;
        queue.push({ socketId: socket.id, participantId, displayName: pInfo ? pInfo.displayName : 'Participant', timestamp: Date.now() });
      }
    } else {
      queue = queue.filter(item => item.socketId !== socket.id);
      handRaiseQueues.set(roomId, queue);
    }
    io.to(roomId).emit('hand-raise-queue-changed', queue);
    io.to(roomId).emit('hand-raise', { participantId, raised });
  });

  // Host & Co-Host controls
  socket.on('toggle-cohost', ({ roomId, targetSocketId }) => { if (!rooms.has(roomId)) return; const room = rooms.get(roomId); const sender = room.get(socket.id); if (!sender || sender.role !== 'host') return; const target = room.get(targetSocketId); if (!target) return; target.role = target.role === 'cohost' ? 'participant' : 'cohost'; io.to(roomId).emit('role-changed', { socketId: targetSocketId, role: target.role }); });
  socket.on('mute-participant', ({ roomId, targetSocketId }) => { if (!hasModPowers(roomId, socket.id)) return; io.to(targetSocketId).emit('mute-command'); });
  socket.on('mute-all', ({ roomId }) => { if (!hasModPowers(roomId, socket.id)) return; socket.to(roomId).emit('mute-command'); });
  socket.on('kick-participant', ({ roomId, targetSocketId }) => { if (!hasModPowers(roomId, socket.id)) return; io.to(targetSocketId).emit('kick-command'); });

  // End Meeting For All
  socket.on('end-meeting-for-all', ({ roomId }) => {
    if (!hasModPowers(roomId, socket.id)) return;
    const room = rooms.get(roomId);
    if (room) {
      room.forEach((info, sid) => { io.to(sid).emit('meeting-ended-by-host'); });
    }
    try { db.endSession(roomId); } catch (e) {}
    rooms.delete(roomId); lockedRooms.delete(roomId); waitingRooms.delete(roomId);
    handRaiseQueues.delete(roomId); chatPermissions.delete(roomId);
    slideControllers.delete(roomId); hostKeys.delete(roomId);
    screenShareControllers.delete(roomId); spotlightQueue.delete(roomId); muteOnEntry.delete(roomId);
  });

  // Mute on Entry per participant
  socket.on('toggle-mute-on-entry', ({ roomId, participantId }) => {
    if (!hasModPowers(roomId, socket.id)) return;
    if (!muteOnEntry.has(roomId)) muteOnEntry.set(roomId, new Set());
    const set = muteOnEntry.get(roomId);
    if (set.has(participantId)) set.delete(participantId);
    else set.add(participantId);
    io.to(roomId).emit('mute-on-entry-changed', { participantId, enabled: set.has(participantId) });
  });

  socket.on('lower-hand', ({ roomId, targetParticipantId }) => {
    if (!hasModPowers(roomId, socket.id)) return;
    let queue = handRaiseQueues.get(roomId);
    if (queue) { queue = queue.filter(item => item.participantId !== targetParticipantId); handRaiseQueues.set(roomId, queue); io.to(roomId).emit('hand-raise-queue-changed', queue); }
    io.to(roomId).emit('hand-raise', { participantId: targetParticipantId, raised: false });
  });
  socket.on('stop-video-participant', ({ roomId, targetSocketId }) => { if (!hasModPowers(roomId, socket.id)) return; io.to(targetSocketId).emit('stop-video-command'); });
  socket.on('ask-unmute-participant', ({ roomId, targetSocketId }) => { if (!hasModPowers(roomId, socket.id)) return; io.to(targetSocketId).emit('unmute-request-prompt'); });

  // Security toggles
  socket.on('lock-room', ({ roomId, locked }) => { if (!hasModPowers(roomId, socket.id)) return; if (locked) lockedRooms.add(roomId); else lockedRooms.delete(roomId); io.to(roomId).emit('room-lock-changed', { locked }); });
  socket.on('toggle-waiting-room', ({ roomId, enabled }) => { if (!hasModPowers(roomId, socket.id)) return; if (enabled) waitingRooms.add(roomId); else waitingRooms.delete(roomId); io.to(roomId).emit('waiting-room-changed', { enabled }); });
  socket.on('claim-host', ({ roomId, hostKey }) => {
    const hk = hostKeys.get(roomId);
    if (hk && hostKey === hk) {
      const room = rooms.get(roomId);
      if (room) {
        const p = room.get(socket.id);
        if (p) {
          p.role = 'host';
          io.to(roomId).emit('role-changed', { socketId: socket.id, role: 'host' });
          try { db.logJoin(roomId, p.participantId, p.displayName, 'host'); } catch (e) {}
        }
      }
    } else {
      socket.emit('claim-host-error', { error: 'Invalid Host Key' });
    }
  });
  socket.on('spotlight-participants', ({ roomId, targetSocketIds }) => { if (!hasModPowers(roomId, socket.id)) return; spotlightQueue.set(roomId, targetSocketIds || []); io.to(roomId).emit('spotlight-updated', { spotlightSocketIds: targetSocketIds || [] }); });

  socket.on('waiting-admit', ({ roomId, targetSocketId }) => {
    if (!hasModPowers(roomId, socket.id)) return;
    const waitingInfo = waitingSockets.get(targetSocketId);
    if (!waitingInfo) return;
    const { socket: targetSocket, participantId, displayName } = waitingInfo;
    waitingSockets.delete(targetSocketId);
    targetSocket.leave(roomId + '-waiting');
    targetSocket.join(roomId);
    targetSocket.currentRoom = roomId;
    const role = 'participant';
    const info = { participantId, displayName, role };
    if (!rooms.has(roomId)) rooms.set(roomId, new Map());
    rooms.get(roomId).set(targetSocketId, info);
    try { db.logJoin(roomId, participantId, displayName, role); } catch (e) {}
    targetSocket.emit('waiting-admitted', { roomId });
    targetSocket.to(roomId).emit('participant-joined', { socketId: targetSocketId, ...info });
    const participants = []; rooms.get(roomId).forEach((i, sid) => { if (sid !== targetSocketId) participants.push({ socketId: sid, ...i }); });
    targetSocket.emit('room-participants', participants);
    targetSocket.emit('hand-raise-queue-changed', handRaiseQueues.get(roomId) || []);
    targetSocket.emit('chat-permissions-changed', { permissions: chatPermissions.get(roomId) || 'public-private' });
    try { const paths = db.getWhiteboardPaths(roomId); targetSocket.emit('whiteboard-history', paths.map(p => JSON.parse(p))); } catch (e) {}
    io.to(roomId).emit('waiting-participant-left', { socketId: targetSocketId });
  });

  socket.on('waiting-decline', ({ roomId, targetSocketId }) => {
    if (!hasModPowers(roomId, socket.id)) return;
    const waitingInfo = waitingSockets.get(targetSocketId);
    if (!waitingInfo) return;
    waitingSockets.delete(targetSocketId);
    waitingInfo.socket.emit('waiting-declined');
    waitingInfo.socket.disconnect();
    io.to(roomId).emit('waiting-participant-left', { socketId: targetSocketId });
  });

  // Polling
  socket.on('poll-create', ({ roomId, poll }) => { if (!hasModPowers(roomId, socket.id)) return; socket.to(roomId).emit('poll-created', poll); });
  socket.on('poll-vote', ({ roomId, pollId, optionIndex, voterName }) => { io.to(roomId).emit('poll-voted', { pollId, optionIndex, voterName, socketId: socket.id }); });
  socket.on('poll-end', ({ roomId, pollId, results }) => { if (!hasModPowers(roomId, socket.id)) return; io.to(roomId).emit('poll-ended', { pollId, results }); });

  // Breakout rooms
  socket.on('create-breakout', ({ roomId, groups }) => { if (!hasModPowers(roomId, socket.id)) return; io.to(roomId).emit('breakout-created', { groups }); });
  socket.on('breakout-start', ({ roomId, rooms: breakoutRooms, duration, allowSelfSelect }) => {
    if (!hasModPowers(roomId, socket.id)) return;
    io.to(roomId).emit('breakout-started-broadcast', { rooms: breakoutRooms, duration, allowSelfSelect });
    breakoutRooms.forEach(r => { r.participantSocketIds.forEach(sid => { io.to(sid).emit('breakout-assigned', { roomName: r.roomName, duration }); }); });
  });
  socket.on('breakout-end', ({ roomId, roomCount }) => { if (!hasModPowers(roomId, socket.id)) return; for (let i = 1; i <= roomCount; i++) io.to(`${roomId}-breakout-${i}`).emit('breakout-ended'); });
  socket.on('breakout-broadcast-message', ({ roomId, message, roomCount }) => { if (!hasModPowers(roomId, socket.id)) return; io.to(roomId).emit('breakout-broadcast-received', { message }); for (let i = 1; i <= roomCount; i++) io.to(`${roomId}-breakout-${i}`).emit('breakout-broadcast-received', { message }); });

  // Annotation
  socket.on('annotation-draw', ({ roomId, path }) => { socket.to(roomId).emit('annotation-draw', { fromSocketId: socket.id, path }); });
  socket.on('annotation-clear', ({ roomId }) => { io.to(roomId).emit('annotation-clear'); });
  socket.on('screenshare-start', ({ roomId }) => { socket.to(roomId).emit('screenshare-started', { fromSocketId: socket.id }); });
  socket.on('screenshare-stop', ({ roomId }) => { socket.to(roomId).emit('screenshare-stopped', { fromSocketId: socket.id }); });
  socket.on('screenshare-grant-control', ({ roomId, targetSocketId }) => { if (!hasModPowers(roomId, socket.id)) return; screenShareControllers.set(roomId, { presenterSocketId: socket.id, controllerSocketId: targetSocketId }); io.to(targetSocketId).emit('screenshare-control-granted', { presenterSocketId: socket.id }); });
  socket.on('screenshare-revoke-control', ({ roomId }) => { if (!hasModPowers(roomId, socket.id)) return; const sc = screenShareControllers.get(roomId); if (sc) io.to(sc.controllerSocketId).emit('screenshare-control-revoked'); screenShareControllers.delete(roomId); });
  socket.on('video-filter-change', ({ roomId, filter }) => { socket.to(roomId).emit('video-filter-changed', { socketId: socket.id, filter }); });

  // Slides
  socket.on('slide-share-start', ({ roomId, slideIndex, slides }) => { if (!hasModPowers(roomId, socket.id)) return; io.to(roomId).emit('slide-share-started', { presenterSocketId: socket.id, slideIndex, slides }); });
  socket.on('slide-share-stop', ({ roomId }) => { if (!hasModPowers(roomId, socket.id)) return; slideControllers.delete(roomId); io.to(roomId).emit('slide-share-stopped'); });
  socket.on('slide-change', ({ roomId, slideIndex }) => { const isMod = hasModPowers(roomId, socket.id); const hasControl = slideControllers.get(roomId) === socket.id; if (!isMod && !hasControl) return; io.to(roomId).emit('slide-changed', { slideIndex }); });
  socket.on('slide-grant-control', ({ roomId, targetSocketId }) => { if (!hasModPowers(roomId, socket.id)) return; slideControllers.set(roomId, targetSocketId); io.to(roomId).emit('slide-control-granted', { targetSocketId }); });
  socket.on('slide-revoke-control', ({ roomId }) => { if (!hasModPowers(roomId, socket.id)) return; slideControllers.delete(roomId); io.to(roomId).emit('slide-control-revoked'); });

  const VALID_PERMISSIONS = ['none', 'host-only', 'public', 'public-private'];
  socket.on('change-chat-permissions', ({ roomId, permissions }) => { if (!hasModPowers(roomId, socket.id)) return; if (!VALID_PERMISSIONS.includes(permissions)) return; chatPermissions.set(roomId, permissions); io.to(roomId).emit('chat-permissions-changed', { permissions }); });
  socket.on('participant-status-change', ({ roomId, participantId, isBrb, brbTime }) => { socket.to(roomId).emit('participant-status-changed', { socketId: socket.id, participantId, isBrb, brbTime }); });
  socket.on('virtual-background-change', ({ roomId, bgType, bgValue }) => { socket.to(roomId).emit('virtual-background-changed', { socketId: socket.id, bgType, bgValue }); });
  socket.on('whiteboard-laser', ({ roomId, x, y, isStart }) => { socket.to(roomId).emit('whiteboard-laser', { socketId: socket.id, x, y, isStart }); });
  socket.on('mute-all-except-presenter', ({ roomId, presenterSocketId }) => { if (!hasModPowers(roomId, socket.id)) return; socket.to(roomId).emit('mute-all-except-presenter-command', { presenterSocketId }); });

  // Leave room
  socket.on('leave-room', ({ roomId }) => {
    if (currentRoom && rooms.has(currentRoom)) {
      rooms.get(currentRoom).delete(socket.id);
      if (rooms.get(currentRoom).size === 0) rooms.delete(currentRoom);
      socket.to(currentRoom).emit('participant-left', { socketId: socket.id });
      if (participantInfo) { try { db.logLeave(currentRoom, participantInfo.participantId); } catch (e) {} }
      let queue = handRaiseQueues.get(currentRoom);
      if (queue) { queue = queue.filter(item => item.socketId !== socket.id); handRaiseQueues.set(currentRoom, queue); io.to(currentRoom).emit('hand-raise-queue-changed', queue); }
      currentRoom = null; participantInfo = null;
    }
    socket.leave(roomId);
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
      if (participantInfo) { try { db.logLeave(currentRoom, participantInfo.participantId); } catch (e) {} }
      let queue = handRaiseQueues.get(currentRoom);
      if (queue) { queue = queue.filter(item => item.socketId !== socket.id); handRaiseQueues.set(currentRoom, queue); io.to(currentRoom).emit('hand-raise-queue-changed', queue); }
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