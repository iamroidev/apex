// stress-test.js — Apex Classroom Socket.io stress tester
// Simulates concurrent participants joining a meeting, drawing, and chatting.

const { io } = require('socket.io-client');

const SERVER_URL = process.argv[2] || 'http://localhost:3000';
const ROOM_ID = process.argv[3] || 'stress-test-room';
const TOTAL_CLIENTS = parseInt(process.argv[4]) || 500;
const CONCURRENCY_STAGGER_MS = 50; // Stagger connections to prevent connection queue bottleneck

console.log(`\n==================================================`);
console.log(`      Apex Classroom Socket.io Stress Tester      `);
console.log(`==================================================`);
console.log(`Target Server : ${SERVER_URL}`);
console.log(`Target Room   : ${ROOM_ID}`);
console.log(`Total Clients : ${TOTAL_CLIENTS}`);
console.log(`Stagger Rate  : Connect 1 client every ${CONCURRENCY_STAGGER_MS}ms`);
console.log(`==================================================\n`);

const clients = [];
let connectedCount = 0;
let messageSentCount = 0;
let drawSentCount = 0;
let errorCount = 0;

function createClient(index) {
  const socket = io(SERVER_URL, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false
  });

  const participantId = `stress-bot-${index}-${Math.random().toString(36).substring(2, 6)}`;
  const displayName = `Stress Student ${index}`;

  socket.on('connect', () => {
    connectedCount++;
    process.stdout.write(`\r[+] Connected: ${connectedCount}/${TOTAL_CLIENTS} (Errors: ${errorCount})`);

    // Join the target classroom
    socket.emit('join-room', {
      roomId: ROOM_ID,
      participantId,
      displayName,
      role: 'participant'
    });

    // Start simulation loop for this client
    startClientSimulation(socket, participantId, displayName);
  });

  socket.on('connect_error', (err) => {
    errorCount++;
    process.stdout.write(`\r[-] Connection Error: ${errorCount} | Connected: ${connectedCount}/${TOTAL_CLIENTS}`);
  });

  socket.on('disconnect', () => {
    if (connectedCount > 0) connectedCount--;
    process.stdout.write(`\r[!] Client Disconnected | Active: ${connectedCount}/${TOTAL_CLIENTS}`);
  });

  clients.push(socket);
}

function startClientSimulation(socket, participantId, displayName) {
  // Randomly chat every 15-30 seconds
  const chatInterval = setInterval(() => {
    if (Math.random() < 0.15) { // 15% chance to chat on tick
      socket.emit('chat-message', {
        roomId: ROOM_ID,
        senderId: participantId,
        senderName: displayName,
        message: `Hello from stress agent! Count: ${messageSentCount}`
      });
      messageSentCount++;
    }
  }, 10000 + Math.random() * 10000);

  // Randomly draw whiteboard vectors every 5-10 seconds
  const drawInterval = setInterval(() => {
    if (Math.random() < 0.25) { // 25% chance to draw on tick
      socket.emit('whiteboard-draw', {
        roomId: ROOM_ID,
        path: {
          tool: 'pen',
          color: '#ff5252',
          points: [
            { x: Math.random() * 800, y: Math.random() * 600 },
            { x: Math.random() * 800, y: Math.random() * 600 }
          ]
        }
      });
      drawSentCount++;
    }
  }, 4000 + Math.random() * 4000);

  // Save intervals on socket to clear on shutdown
  socket._intervals = [chatInterval, drawInterval];
}

// Start staggering connections
let currentClientIndex = 0;
const connectTimer = setInterval(() => {
  if (currentClientIndex >= TOTAL_CLIENTS) {
    clearInterval(connectTimer);
    console.log(`\n\n[✓] Finished spawning all ${TOTAL_CLIENTS} connection processes.`);
    startReportingLoop();
    return;
  }
  createClient(currentClientIndex);
  currentClientIndex++;
}, CONCURRENCY_STAGGER_MS);

function startReportingLoop() {
  setInterval(() => {
    const memory = process.memoryUsage();
    console.log(`\n--- Status Report ---`);
    console.log(`Active Connected Clients : ${connectedCount} / ${TOTAL_CLIENTS}`);
    console.log(`Socket.io Errors         : ${errorCount}`);
    console.log(`Total Chat Messages Sent : ${messageSentCount}`);
    console.log(`Total Draw Vectors Sent  : ${drawSentCount}`);
    console.log(`Memory Usage (RSS)       : ${(memory.rss / 1024 / 1024).toFixed(2)} MB`);
    console.log(`Memory Heap Used         : ${(memory.heapUsed / 1024 / 1024).toFixed(2)} MB`);
    console.log(`---------------------`);
  }, 5000);
}

// Graceful shutdown on Ctrl+C
process.on('SIGINT', () => {
  console.log(`\n\nShutting down stress tester and disconnecting clients...`);
  clients.forEach(socket => {
    if (socket._intervals) {
      socket._intervals.forEach(clearInterval);
    }
    if (socket.connected) {
      socket.disconnect();
    }
  });
  console.log(`Disconnected. Exiting.`);
  process.exit(0);
});
