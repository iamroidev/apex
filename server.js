// server.js — Apex conferencing backend
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const db = require('./database');
const pino = require('pino');
const pinoHttp = require('pino-http');

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

const app = express();
app.use(pinoHttp({ logger }));
const server = http.createServer(app);

const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS || '*';
const io = new Server(server, { 
  cors: { origin: ALLOWED_ORIGINS === '*' ? '*' : ALLOWED_ORIGINS.split(',') },
  maxHttpBufferSize: 1e8
});

const PORT = process.env.PORT || 3000;

app.use((req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  next();
});

app.use(express.json({ limit: '50mb' })); // Increased for file sharing
app.use(express.static(path.join(__dirname, 'public')));

// ---------- REST API ----------
const apiRoutes = require('./src/routes/api');
app.use('/api', apiRoutes(db, process.env));

// ---------- SOCKET.IO ----------
const setupSockets = require('./src/sockets');
setupSockets(io, db, logger);

// ---------- START ----------
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  ╔══════════════════════════════════════╗`);
  console.log(`  ║   Apex Classroom — Running           ║`);
  console.log(`  ║   http://localhost:${PORT}              ║`);
  console.log(`  ║   LiveKit: ${process.env.LIVEKIT_API_KEY ? 'Configured' : 'Not configured (Sandbox Mode)'}     ║`);
  console.log(`  ╚══════════════════════════════════════╝\n`);
});
