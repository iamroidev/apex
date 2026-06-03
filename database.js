// database.js — SQLite session and attendance storage for Apex
const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

const DB_PATH = path.join(__dirname, 'apex.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initTables();
  }
  return db;
}

function initTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'Untitled Meeting',
      host_name TEXT NOT NULL DEFAULT 'Host',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      started_at TEXT,
      ended_at TEXT,
      recording_path TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      password TEXT,
      recurrence TEXT
    );

    CREATE TABLE IF NOT EXISTS attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      participant_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'participant',
      joined_at TEXT NOT NULL DEFAULT (datetime('now')),
      left_at TEXT,
      duration_seconds INTEGER DEFAULT 0,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      message TEXT NOT NULL,
      sent_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS scheduled_meetings (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      scheduled_for TEXT NOT NULL,
      duration_minutes INTEGER DEFAULT 60,
      host_name TEXT NOT NULL DEFAULT 'Host',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      password TEXT,
      recurrence TEXT
    );

    CREATE TABLE IF NOT EXISTS whiteboard_paths (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      path_data TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
  `);

  // Schema migrations for user_id addition
  for (const table of ['sessions', 'scheduled_meetings']) {
    try { db.exec(`ALTER TABLE ${table} ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE SET NULL`); } catch (e) { /* already migrated */ }
    try { db.exec(`ALTER TABLE ${table} ADD COLUMN password TEXT`); } catch (e) { /* already migrated */ }
    try { db.exec(`ALTER TABLE ${table} ADD COLUMN recurrence TEXT`); } catch (e) { /* already migrated */ }
  }
}

// --- Hashing Helpers ---

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const [salt, hash] = storedHash.split(':');
  const verifyHash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return hash === verifyHash;
}

// --- User Helpers ---

function createUser(id, username, password) {
  const passwordHash = hashPassword(password);
  getDb().prepare(
    `INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)`
  ).run(id, username, passwordHash);
  return getUserById(id);
}

function getUserByUsername(username) {
  return getDb().prepare('SELECT * FROM users WHERE username = ?').get(username);
}

function getUserById(id) {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(id);
}

// --- Session helpers ---

function createSession(id, title, hostName, userId = null, password = null, recurrence = null) {
  const stmt = getDb().prepare(
    `INSERT INTO sessions (id, title, host_name, user_id, password, recurrence, started_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
  );
  stmt.run(id, title, hostName, userId, password, recurrence);
  return getSession(id);
}

function getSession(id) {
  return getDb().prepare('SELECT * FROM sessions WHERE id = ?').get(id);
}

function endSession(id) {
  getDb().prepare(
    `UPDATE sessions SET ended_at = datetime('now'), is_active = 0 WHERE id = ?`
  ).run(id);
  // Calculate attendance durations
  getDb().prepare(
    `UPDATE attendance SET 
       left_at = COALESCE(left_at, datetime('now')),
       duration_seconds = CAST((julianday(COALESCE(left_at, datetime('now'))) - julianday(joined_at)) * 86400 AS INTEGER)
     WHERE session_id = ? AND left_at IS NULL`
  ).run(id);
  return getSession(id);
}

function listSessions(userId = null, limit = 50) {
  if (userId) {
    return getDb().prepare(
      'SELECT * FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'
    ).all(userId, limit);
  }
  return getDb().prepare(
    'SELECT * FROM sessions ORDER BY created_at DESC LIMIT ?'
  ).all(limit);
}

// --- Attendance helpers ---

function logJoin(sessionId, participantId, displayName, role) {
  const sessionExists = getDb().prepare('SELECT 1 FROM sessions WHERE id = ?').get(sessionId);
  if (!sessionExists) return;
  getDb().prepare(
    `INSERT INTO attendance (session_id, participant_id, display_name, role) VALUES (?, ?, ?, ?)`
  ).run(sessionId, participantId, displayName, role || 'participant');
}

function logLeave(sessionId, participantId) {
  getDb().prepare(
    `UPDATE attendance SET 
       left_at = datetime('now'),
       duration_seconds = CAST((julianday(datetime('now')) - julianday(joined_at)) * 86400 AS INTEGER)
     WHERE session_id = ? AND participant_id = ? AND left_at IS NULL`
  ).run(sessionId, participantId);
}

function getAttendance(sessionId, limit = 1000, offset = 0) {
  return getDb().prepare(
    'SELECT * FROM attendance WHERE session_id = ? ORDER BY joined_at ASC LIMIT ? OFFSET ?'
  ).all(sessionId, limit, offset);
}

// --- Chat helpers ---

function saveChat(sessionId, senderId, senderName, message) {
  const sessionExists = getDb().prepare('SELECT 1 FROM sessions WHERE id = ?').get(sessionId);
  if (!sessionExists) return;
  getDb().prepare(
    `INSERT INTO chat_messages (session_id, sender_id, sender_name, message) VALUES (?, ?, ?, ?)`
  ).run(sessionId, senderId, senderName, message);
}

function getChatHistory(sessionId, limit = 1000, offset = 0) {
  return getDb().prepare(
    'SELECT * FROM chat_messages WHERE session_id = ? ORDER BY sent_at ASC LIMIT ? OFFSET ?'
  ).all(sessionId, limit, offset);
}

function getScheduledMeeting(id) {
  return getDb().prepare('SELECT * FROM scheduled_meetings WHERE id = ?').get(id);
}

// --- Scheduled meetings ---

function scheduleMeeting(id, title, description, scheduledFor, durationMinutes, hostName, userId = null, password = null, recurrence = null) {
  getDb().prepare(
    `INSERT INTO scheduled_meetings (id, title, description, scheduled_for, duration_minutes, host_name, user_id, password, recurrence) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, title, description || '', scheduledFor, durationMinutes || 60, hostName || 'Host', userId, password, recurrence);
  return getDb().prepare('SELECT * FROM scheduled_meetings WHERE id = ?').get(id);
}

function listScheduledMeetings(userId = null) {
  if (userId) {
    return getDb().prepare(
      'SELECT * FROM scheduled_meetings WHERE user_id = ? ORDER BY scheduled_for ASC'
    ).all(userId);
  }
  return getDb().prepare(
    'SELECT * FROM scheduled_meetings ORDER BY scheduled_for ASC'
  ).all();
}

function deleteScheduledMeeting(id) {
  getDb().prepare('DELETE FROM scheduled_meetings WHERE id = ?').run(id);
}

// --- Export helpers ---

function exportSessionJSON(sessionId) {
  const session = getSession(sessionId);
  const attendance = getAttendance(sessionId);
  const chat = getChatHistory(sessionId);
  return { session, attendance, chat };
}

function escapeCSV(val) {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function exportSessionCSV(sessionId) {
  const attendance = getAttendance(sessionId);
  if (attendance.length === 0) return 'participant_id,display_name,role,joined_at,left_at,duration_seconds\n';
  const header = 'participant_id,display_name,role,joined_at,left_at,duration_seconds';
  const rows = attendance.map(a =>
    `${escapeCSV(a.participant_id)},${escapeCSV(a.display_name)},${escapeCSV(a.role)},${escapeCSV(a.joined_at)},${escapeCSV(a.left_at)},${a.duration_seconds}`
  );
  return [header, ...rows].join('\n');
}

// --- Whiteboard helpers ---

function saveWhiteboardPath(sessionId, pathData) {
  const sessionExists = getDb().prepare('SELECT 1 FROM sessions WHERE id = ?').get(sessionId);
  if (!sessionExists) return;
  getDb().prepare(
    `INSERT INTO whiteboard_paths (session_id, path_data) VALUES (?, ?)`
  ).run(sessionId, pathData);
}

function getWhiteboardPaths(sessionId) {
  return getDb().prepare(
    `SELECT path_data FROM whiteboard_paths WHERE session_id = ? ORDER BY id ASC`
  ).all(sessionId).map(row => row.path_data);
}

function clearWhiteboardPaths(sessionId) {
  getDb().prepare(
    `DELETE FROM whiteboard_paths WHERE session_id = ?`
  ).run(sessionId);
}

function undoLastWhiteboardPath(sessionId) {
  getDb().prepare(
    `DELETE FROM whiteboard_paths 
     WHERE id = (SELECT max(id) FROM whiteboard_paths WHERE session_id = ?)`
  ).run(sessionId);
}

module.exports = {
  getDb,
  createUser, getUserByUsername, getUserById, verifyPassword,
  createSession, getSession, endSession, listSessions,
  logJoin, logLeave, getAttendance,
  saveChat, getChatHistory,
  scheduleMeeting, getScheduledMeeting, listScheduledMeetings, deleteScheduledMeeting,
  exportSessionJSON, exportSessionCSV,
  saveWhiteboardPath, getWhiteboardPaths, clearWhiteboardPaths, undoLastWhiteboardPath
};