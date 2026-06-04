const express = require('express');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const {
  generateToken,
  verifyToken,
  setSessionCookie,
  clearSessionCookie,
  getCookie,
  authenticate
} = require('../utils/auth');
const {
  sanitizeString,
  generateICS,
  sendEmail
} = require('../utils/helpers');

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

module.exports = function(db, env) {
  const router = express.Router();
  const LK_KEY = env.LIVEKIT_API_KEY || '';
  const LK_SECRET = env.LIVEKIT_API_SECRET || '';
  const LK_WS = env.LIVEKIT_WS_URL || '';

  // ---------- HEALTH CHECK ----------
  router.get('/health', async (req, res) => {
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      livekitConfigured: !!LK_KEY
    });
  });

  // ---------- MEETING ANALYTICS ----------
  router.get('/analytics', authenticate, async (req, res) => {
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
  router.post('/auth/register', authLimiter, async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password || username.length < 3 || password.length < 6) return res.status(400).json({ error: 'Username (min 3 chars) and password (min 6 chars) are required' });
    const sanitizedUsername = sanitizeString(username, 30);
    if (!/^[a-zA-Z0-9_]+$/.test(sanitizedUsername)) return res.status(400).json({ error: 'Username can only contain letters, numbers, and underscores' });
    try {
      const existing = await db.getUserByUsername(sanitizedUsername);
      if (existing) return res.status(400).json({ error: 'Username is already taken' });
      const id = uuidv4().slice(0, 8);
      const user = await db.createUser(id, sanitizedUsername, password);
      const token = generateToken(user);
      setSessionCookie(res, req, token);
      res.json({ id: user.id, username: user.username });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.post('/auth/login', authLimiter, async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });
    try {
      const user = await db.getUserByUsername(sanitizeString(username, 30));
      if (!user || !db.verifyPassword(password, user.password_hash)) return res.status(401).json({ error: 'Invalid username or password' });
      const token = generateToken(user);
      setSessionCookie(res, req, token);
      res.json({ id: user.id, username: user.username });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.post('/auth/google', authLimiter, async (req, res) => {
    const { credential } = req.body;
    if (!credential) return res.status(400).json({ error: 'Credential is required' });
    try {
      const googleRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${credential}`);
      if (!googleRes.ok) return res.status(401).json({ error: 'Invalid Google credential' });
      const payload = await googleRes.json();
      const clientId = process.env.GOOGLE_CLIENT_ID || '607768078052-16lmjehbrsfsfdhka89efg0d48vr7cev.apps.googleusercontent.com';
      if (payload.aud !== clientId) return res.status(401).json({ error: 'Invalid audience' });
      const email = payload.email;
      const username = payload.name ? payload.name.replace(/\\s+/g, '').toLowerCase() : email.split('@')[0];
      let user = await db.getUserByUsername(username);
      if (!user) {
        const id = uuidv4().slice(0, 8);
        const randomPassword = crypto.randomBytes(16).toString('hex');
        try { user = await db.createUser(id, username, randomPassword); } catch (e) {
          const uniqueUsername = `${username}_${crypto.randomBytes(2).toString('hex')}`;
          user = await db.createUser(id, uniqueUsername, randomPassword);
        }
      }
      const token = generateToken(user);
      setSessionCookie(res, req, token);
      res.json({ id: user.id, username: user.username });
    } catch (err) { console.error('Google Auth Failed:', err); res.status(500).json({ error: 'Google authentication failed' }); }
  });

  router.post('/auth/logout', async (req, res) => { clearSessionCookie(res, req); res.json({ ok: true }); });
  router.get('/auth/session', async (req, res) => {
    const token = getCookie(req, 'apex_session');
    const user = verifyToken(token);
    if (!user) return res.json({ user: null });
    res.json({ user: { id: user.userId, username: user.username } });
  });

  // LiveKit token
  router.post('/token', async (req, res) => {
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
  router.post('/sessions', authenticate, async (req, res) => {
    const { title, hostName, password, recurrence } = req.body;
    const id = uuidv4().slice(0, 8);
    try {
      const session = await db.createSession(id, title || 'Untitled Meeting', hostName || req.user.username, req.user.userId, password || null, recurrence || null);
      res.json(session);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.get('/sessions', authenticate, async (req, res) => { res.json(await db.listSessions(req.user.userId)); });
  router.post('/sessions/:id/end', authenticate, async (req, res) => {
    try { const session = db.endSession(req.params.id); res.json(session); } catch (err) { res.status(500).json({ error: err.message }); }
  });
  router.get('/sessions/:id', async (req, res) => {
    try {
      const session = await db.getSession(req.params.id);
      if (session) return res.json({ session });
      const scheduled = await db.getScheduledMeeting(req.params.id);
      if (scheduled) return res.json({ scheduled });
      res.status(404).json({ error: 'Session not found' });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
  router.get('/sessions/:id/attendance', authenticate, async (req, res) => { 
    const limit = parseInt(req.query.limit) || 1000;
    const offset = parseInt(req.query.offset) || 0;
    res.json(await db.getAttendance(req.params.id, limit, offset)); 
  });
  router.get('/sessions/:id/chat', authenticate, async (req, res) => { 
    const limit = parseInt(req.query.limit) || 1000;
    const offset = parseInt(req.query.offset) || 0;
    res.json(await db.getChatHistory(req.params.id, limit, offset)); 
  });

  router.get('/sessions/:id/export/:format', authenticate, async (req, res) => {
    const { id, format } = req.params;
    if (format === 'json') { res.json(db.exportSessionJSON(id)); }
    else if (format === 'csv') { res.setHeader('Content-Type', 'text/csv'); res.setHeader('Content-Disposition', `attachment; filename=session-${id}.csv`); res.send(db.exportSessionCSV(id)); }
    else { res.status(400).json({ error: 'Format must be json or csv' }); }
  });

  // Scheduled meetings (Authenticated)
  router.get('/scheduled', authenticate, async (req, res) => { res.json(await db.listScheduledMeetings(req.user.userId)); });
  router.post('/scheduled', authenticate, async (req, res) => {
    const { title, description, scheduledFor, durationMinutes, hostName, password, recurrence } = req.body;
    const id = uuidv4().slice(0, 8);
    try {
      const meeting = await db.scheduleMeeting(id, title, description, scheduledFor, durationMinutes, hostName || req.user.username, req.user.userId, password || null, recurrence || null);
      res.json(meeting);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
  router.delete('/scheduled/:id', authenticate, async (req, res) => { await db.deleteScheduledMeeting(req.params.id); res.json({ ok: true }); });

  // ICS Calendar Download
  router.get('/sessions/:id/ics', async (req, res) => {
    try {
      const session = await db.getSession(req.params.id) || await db.getScheduledMeeting(req.params.id);
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
  router.post('/send-invite', authenticate, async (req, res) => {
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
  router.post('/verify-password', async (req, res) => {
    const { roomId, password } = req.body;
    if (!roomId || !password) return res.status(400).json({ error: 'Room ID and password are required' });
    try {
      const session = await db.getSession(roomId);
      if (session && session.password) return res.json({ valid: session.password === password });
      const scheduled = await db.getScheduledMeeting(roomId);
      if (scheduled && scheduled.password) return res.json({ valid: scheduled.password === password });
      res.json({ valid: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
};