// public/src/breakout.js — Breakout setup, CSV parsing, student self-selection list
import { state, dom, escapeHtml, genId } from './core.js';
import { connectToRoom } from './webrtc.js';
import { updateVideoGridCount, updateSpeakerViewLayout } from './media.js';
import { updateParticipantsList } from './main.js';

export function showBreakoutModal() {
  if (!state.isHost) return;
  
  if (state.breakoutActive) {
    dom.breakoutSetupView.classList.add('hidden');
    dom.breakoutActiveView.classList.remove('hidden');
  } else {
    dom.breakoutSetupView.classList.remove('hidden');
    dom.breakoutActiveView.classList.add('hidden');
  }
  dom.modalBreakoutHost.classList.remove('hidden');
}

export function startBreakouts() {
  if (!state.isHost) return;
  
  const count = parseInt(dom.breakoutRoomsCount.value);
  const duration = parseInt(dom.breakoutDuration.value);
  const allowSelfSelect = dom.breakoutSelfSelect.checked;
  
  state.breakoutRoomsCount = count;
  state.breakoutDuration = duration;
  state.breakoutActive = true;
  state.breakoutSelfSelectEnabled = allowSelfSelect;

  const peerSocketIds = Array.from(state.peers.keys());
  const rooms = [];
  for (let i = 1; i <= count; i++) {
    rooms.push({
      roomName: `${state.roomId}-breakout-${i}`,
      participantSocketIds: []
    });
  }

  const assignedSocketIds = new Set();
  const csvAssignments = state.breakoutCsvAssignments || {};

  // 1. Process CSV Pre-assignments first
  peerSocketIds.forEach(sid => {
    const peer = state.peers.get(sid);
    if (peer && peer.info && peer.info.displayName) {
      const name = peer.info.displayName.toLowerCase();
      if (csvAssignments[name] !== undefined) {
        const roomNum = csvAssignments[name];
        // Ensure roomNum is within valid range [1, count]
        const targetRoomIdx = Math.min(Math.max(1, roomNum), count) - 1;
        rooms[targetRoomIdx].participantSocketIds.push(sid);
        assignedSocketIds.add(sid);
      }
    }
  });

  // 2. If NOT self-select, distribute remaining participants evenly
  if (!allowSelfSelect) {
    let unassignedIdx = 0;
    peerSocketIds.forEach(sid => {
      if (!assignedSocketIds.has(sid)) {
        const roomIdx = unassignedIdx % count;
        rooms[roomIdx].participantSocketIds.push(sid);
        unassignedIdx++;
      }
    });
  }

  state.socket.emit('breakout-start', {
    roomId: state.roomId,
    rooms,
    duration,
    allowSelfSelect
  });

  handleBreakoutAssigned('Host Central / Main Room', duration);
  dom.modalBreakoutHost.classList.add('hidden');
}

export function endBreakouts() {
  if (!state.isHost) return;
  
  state.socket.emit('breakout-end', {
    roomId: state.roomId,
    roomCount: state.breakoutRoomsCount
  });

  handleBreakoutEnded();
  dom.modalBreakoutHost.classList.add('hidden');
}

export function handleBreakoutAssigned(roomName, duration) {
  state.breakoutActive = true;
  state.breakoutRoomId = roomName;

  dom.timerLabel.textContent = `Breakout Room (${roomName})`;
  dom.breakoutTimerBadge.classList.remove('hidden');

  let secondsLeft = duration * 60;
  clearInterval(state.breakoutTimerInterval);
  dom.breakoutTimerBadge.textContent = `Breakout: ${formatBreakoutTime(secondsLeft)}`;
  
  state.breakoutTimerInterval = setInterval(() => {
    secondsLeft--;
    if (secondsLeft <= 0) {
      clearInterval(state.breakoutTimerInterval);
      if (state.isHost) {
        endBreakouts();
      }
    } else {
      dom.breakoutTimerBadge.textContent = `Breakout: ${formatBreakoutTime(secondsLeft)}`;
    }
  }, 1000);

  // Disconnect peers and WebRTC isolate
  state.peers.forEach((peer) => {
    if (peer.pc) peer.pc.close();
  });
  state.peers.clear();
  const remoteTiles = dom.videoGrid.querySelectorAll('.video-tile:not(.local-tile)');
  remoteTiles.forEach(t => t.remove());

  state.socket.emit('join-room', {
    roomId: roomName,
    participantId: state.participantId,
    displayName: state.userName || 'Participant',
    role: state.isHost ? 'host' : 'participant'
  });

  // Simulated sandbox bots distribution
  if (state.bots.length > 0) {
    const botsToKeepCount = Math.ceil(state.bots.length / state.breakoutRoomsCount);
    const extraBots = state.bots.slice(botsToKeepCount);
    extraBots.forEach(b => {
      const tile = document.querySelector(`.video-tile[data-participant="${b.id}"]`);
      if (tile) tile.remove();
    });
    state.bots = state.bots.slice(0, botsToKeepCount);
    updateParticipantsList();
  }

  if (state.layoutMode === 'speaker') {
    state.currentSpotlightId = null;
    updateSpeakerViewLayout();
  }
  updateVideoGridCount();
}

export function handleBreakoutEnded() {
  state.breakoutActive = false;
  state.breakoutRoomId = null;
  clearInterval(state.breakoutTimerInterval);

  dom.timerLabel.textContent = 'Unlimited Session';
  dom.breakoutTimerBadge.classList.add('hidden');

  state.peers.forEach((peer) => {
    if (peer.pc) peer.pc.close();
  });
  state.peers.clear();
  const remoteTiles = dom.videoGrid.querySelectorAll('.video-tile:not(.local-tile)');
  remoteTiles.forEach(t => t.remove());

  connectToRoom(state.roomId);
  
  if (state.layoutMode === 'speaker') {
    state.currentSpotlightId = null;
    updateSpeakerViewLayout();
  }
  updateVideoGridCount();
}

export function formatBreakoutTime(seconds) {
  const m = String(Math.floor(seconds / 60)).padStart(2, '0');
  const s = String(seconds % 60).padStart(2, '0');
  return `${m}:${s}`;
}

export function handleBreakoutCsvUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(evt) {
    const text = evt.target.result;
    const assignments = {};
    const lines = text.split('\n');
    let loadedCount = 0;
    
    lines.forEach(line => {
      const parts = line.split(',');
      if (parts.length >= 2) {
        const name = parts[0].trim().toLowerCase();
        const roomNum = parseInt(parts[1].trim());
        if (name && !isNaN(roomNum)) {
          assignments[name] = roomNum;
          loadedCount++;
        }
      }
    });

    state.breakoutCsvAssignments = assignments;
    dom.breakoutCsvStatus.textContent = `Loaded ${loadedCount} assignments from CSV.`;
    dom.breakoutCsvStatus.style.color = "var(--accent-cyan)";
  };
  reader.onerror = function() {
    dom.breakoutCsvStatus.textContent = "Failed to read CSV file.";
    dom.breakoutCsvStatus.style.color = "var(--accent-coral)";
  };
  reader.readAsText(file);
}

export function openBreakoutSelectionModal(rooms, duration) {
  dom.breakoutRoomsList.innerHTML = rooms.map((r, idx) => {
    const roomDisplayName = `Room ${idx + 1}`;
    return `
      <div style="display: flex; align-items: center; justify-content: space-between; padding: var(--sp-2) var(--sp-3); border: 2px solid var(--border-strong); background: var(--bg-surface); border-radius: var(--radius-sm);">
        <span style="font-weight: 600; color: var(--text-primary); font-size: var(--text-sm);">${roomDisplayName}</span>
        <button class="btn btn-primary" onclick="window._apex.joinSelfSelectedBreakout('${r.roomName}', ${duration})" style="padding: 2px 10px; font-size: 11px;">
          Join
        </button>
      </div>
    `;
  }).join('');
  
  dom.modalBreakoutParticipant.classList.remove('hidden');
}

export function joinSelfSelectedBreakout(roomName, duration) {
  dom.modalBreakoutParticipant.classList.add('hidden');
  handleBreakoutAssigned(roomName, duration);
}
