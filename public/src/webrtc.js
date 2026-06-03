// public/src/webrtc.js — fallback P2P Mesh WebRTC peer connections logic
import { state, dom, escapeHtml } from './core.js';
import { getCSSFilter, updateVideoGridCount } from './media.js';
import { updateParticipantsList } from './main.js';

const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

export function connectToRoom(roomId) {
  const name = state.userName || 'Participant';
  state.socket.emit('join-room', {
    roomId,
    participantId: state.participantId,
    displayName: name,
    role: state.isHost ? 'host' : 'participant',
    videoFilter: state.videoFilter
  });
}

export function addRemotePeer(socketId, info) {
  if (state.peers.has(socketId)) return;
  state.peers.set(socketId, { pc: null, stream: null, info });
  if (state.sandboxMode) {
    createRemoteTile(socketId, info);
  }
}

export function removeRemotePeer(socketId) {
  const peer = state.peers.get(socketId);
  if (peer) {
    if (peer.pc) peer.pc.close();
    state.peers.delete(socketId);
  }
  const tile = document.querySelector(`.video-tile[data-socket="${socketId}"]`);
  if (tile) tile.remove();
}

export function createRemoteTile(socketId, info) {
  const tile = document.createElement('div');
  tile.className = 'video-tile';
  tile.dataset.socket = socketId;
  tile.dataset.participant = info.participantId;

  const video = document.createElement('video');
  video.autoplay = true;
  video.playsInline = true;
  if (info.videoFilter) {
    video.style.filter = getCSSFilter(info.videoFilter);
  }
  if (state.selectedSpeakerId && typeof video.setSinkId === 'function') {
    video.setSinkId(state.selectedSpeakerId).catch(e => console.warn('setSinkId failed on remote video tile:', e));
  }
  tile.appendChild(video);

  const overlay = document.createElement('div');
  overlay.className = 'tile-overlay';
  overlay.innerHTML = `
    <span class="tile-name">${escapeHtml(info.displayName || 'Participant')}</span>
    <span class="tile-speaking-indicator"></span>
  `;
  tile.appendChild(overlay);

  const avatar = document.createElement('div');
  avatar.className = 'tile-avatar';
  avatar.innerHTML = `<span class="avatar-letter">${(info.displayName || 'P').charAt(0).toUpperCase()}</span>`;
  tile.appendChild(avatar);

  dom.videoGrid.appendChild(tile);
}

export async function createOffer(targetSocketId) {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  const peer = state.peers.get(targetSocketId);
  if (!peer) return;
  peer.pc = pc;

  if (state.localStream) {
    state.localStream.getTracks().forEach(track => pc.addTrack(track, state.localStream));
  }

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      state.socket.emit('signal-candidate', { targetSocketId, candidate: e.candidate });
    }
  };

  pc.ontrack = (e) => {
    peer.stream = e.streams[0];
    const tile = document.querySelector(`.video-tile[data-socket="${targetSocketId}"]`);
    if (tile) {
      const video = tile.querySelector('video');
      video.srcObject = e.streams[0];
      tile.querySelector('.tile-avatar').classList.add('hidden');
    }
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  state.socket.emit('signal-offer', { targetSocketId, offer });
}

export async function handleOffer(fromSocketId, offer) {
  let peer = state.peers.get(fromSocketId);
  if (!peer) {
    addRemotePeer(fromSocketId, { participantId: 'unknown', displayName: 'Participant' });
    peer = state.peers.get(fromSocketId);
  }

  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  peer.pc = pc;

  if (state.localStream) {
    state.localStream.getTracks().forEach(track => pc.addTrack(track, state.localStream));
  }

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      state.socket.emit('signal-candidate', { targetSocketId: fromSocketId, candidate: e.candidate });
    }
  };

  pc.ontrack = (e) => {
    peer.stream = e.streams[0];
    const tile = document.querySelector(`.video-tile[data-socket="${fromSocketId}"]`);
    if (tile) {
      const video = tile.querySelector('video');
      video.srcObject = e.streams[0];
      tile.querySelector('.tile-avatar').classList.add('hidden');
    }
  };

  await pc.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  state.socket.emit('signal-answer', { targetSocketId: fromSocketId, answer });
}
