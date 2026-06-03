// public/src/socket-events.js — Bind Socket.io signalling event listeners and router
import { state, dom, hasModPowers } from './core.js';
import { addRemotePeer, removeRemotePeer, createOffer, handleOffer } from './webrtc.js';
import { appendChatMessage } from './chat.js';
import { drawRemotePath, clearWhiteboard, redrawWhiteboard } from './whiteboard.js';
import { spawnFloatingReaction } from './ui.js';
import { handleRemoteHandRaise, updateHandIconsOnTiles, toggleMic, getCSSFilter } from './media.js';
import { handlePollCreated, handlePollVoted, handlePollEnded } from './polling.js';
import { handleBreakoutAssigned, handleBreakoutEnded, openBreakoutSelectionModal } from './breakout.js';
import { drawStroke, clearAnnotations, startPresenterOverlayLoop, stopPresenterOverlayLoop } from './overlay.js';
import {
  leaveMeeting,
  updateRoleUI,
  updateParticipantsList,
  updateWaitingQueueUI,
  onScreenShareActive,
  renderSlide,
  updateSlidesControlUI,
  updateChatPermissionsUI
} from './main.js';


export function bindSocketEvents() {
  const s = state.socket;
  if (!s) return;

  s.on('room-participants', (participants) => {
    participants.forEach(p => {
      addRemotePeer(p.socketId, p);
    });
    updateParticipantsList();
    updateVideoGridCountLocal();
  });

  s.on('participant-joined', (data) => {
    addRemotePeer(data.socketId, data);
    updateParticipantsList();
    updateVideoGridCountLocal();
    // Initiate WebRTC offer to new peer
    if (state.sandboxMode && state.localStream) {
      createOffer(data.socketId);
    }
  });

  s.on('participant-left', (data) => {
    removeRemotePeer(data.socketId);
    updateParticipantsList();
    updateVideoGridCountLocal();
  });

  // WebRTC signaling
  s.on('signal-offer', async ({ fromSocketId, offer }) => {
    if (state.sandboxMode) {
      await handleOffer(fromSocketId, offer);
    }
  });

  s.on('signal-answer', async ({ fromSocketId, answer }) => {
    if (state.sandboxMode) {
      const peer = state.peers.get(fromSocketId);
      if (peer && peer.pc) {
        await peer.pc.setRemoteDescription(new RTCSessionDescription(answer));
      }
    }
  });

  s.on('signal-candidate', async ({ fromSocketId, candidate }) => {
    if (state.sandboxMode) {
      const peer = state.peers.get(fromSocketId);
      if (peer && peer.pc) {
        try { await peer.pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch (e) { /* ok */ }
      }
    }
  });

  // Chat
  s.on('chat-message', (msg) => {
    appendChatMessage(msg.senderName, msg.message, msg.senderId === state.participantId, msg.timestamp, msg.isPrivate, msg.recipientName);
    if (state.activeTab !== 'chat' || !state.panelOpen) {
      state.chatUnread++;
      dom.chatBadge.textContent = state.chatUnread;
      dom.chatBadge.classList.remove('hidden');
    }
  });

  // Whiteboard
  s.on('whiteboard-draw', ({ fromSocketId, path }) => {
    drawRemotePath(path);
  });

  s.on('whiteboard-clear', () => {
    clearWhiteboard(false);
  });

  // Reactions
  s.on('reaction', ({ emoji, senderName }) => {
    spawnFloatingReaction(emoji);
  });

  // Hand raise
  s.on('hand-raise', ({ participantId, raised }) => {
    handleRemoteHandRaise(participantId, raised);
  });

  // Host moderation commands
  s.on('mute-command', () => {
    if (state.micEnabled) {
      toggleMic();
    }
  });

  s.on('kick-command', () => {
    alert('You have been removed from this meeting by the host.');
    leaveMeeting();
  });

  // Polling socket events
  s.on('poll-created', (poll) => {
    handlePollCreated(poll);
  });

  s.on('poll-voted', (vote) => {
    handlePollVoted(vote);
  });

  s.on('poll-ended', ({ pollId, results }) => {
    handlePollEnded(pollId, results);
  });

  // Breakout socket events
  s.on('breakout-assigned', ({ roomName, duration }) => {
    handleBreakoutAssigned(roomName, duration);
  });

  s.on('breakout-ended', () => {
    handleBreakoutEnded();
  });

  // Security & Waiting Room events
  s.on('room-locked-error', () => {
    alert('This meeting is locked by the host.');
    leaveMeeting();
  });

  s.on('waiting-room-joined', () => {
    state.isWaitingToJoin = true;
    dom.waitingRoomOverlay.classList.remove('hidden');
    dom.waitingRoomMeetingTitle.textContent = 'Room Code: ' + state.roomId;
  });

  s.on('waiting-participant-joined', (data) => {
    if (!state.waitingQueue.some(p => p.socketId === data.socketId)) {
      state.waitingQueue.push(data);
    }
    updateWaitingQueueUI();
  });

  s.on('waiting-participant-left', ({ socketId }) => {
    state.waitingQueue = state.waitingQueue.filter(p => p.socketId !== socketId);
    updateWaitingQueueUI();
  });

  s.on('waiting-admitted', () => {
    state.isWaitingToJoin = false;
    dom.waitingRoomOverlay.classList.add('hidden');
  });

  s.on('waiting-declined', () => {
    alert('Your request to join this meeting was declined by the host.');
    leaveMeeting();
  });

  s.on('room-lock-changed', ({ locked }) => {
    state.isRoomLocked = locked;
    if (hasModPowers()) {
      dom.btnLockMeeting.textContent = locked ? 'Lock Room: On' : 'Lock Room: Off';
      dom.btnLockMeeting.classList.toggle('active', locked);
    }
  });

  s.on('waiting-room-changed', ({ enabled }) => {
    state.isWaitingRoomEnabled = enabled;
    if (hasModPowers()) {
      dom.btnToggleWaitingRoom.textContent = enabled ? 'Waiting Room: On' : 'Waiting Room: Off';
      dom.btnToggleWaitingRoom.classList.toggle('active', enabled);
    }
  });

  s.on('role-changed', ({ socketId, role }) => {
    if (socketId === s.id) {
      state.role = role;
      updateRoleUI();
    } else {
      const peer = state.peers.get(socketId);
      if (peer) {
        peer.info.role = role;
      }
    }
    updateParticipantsList();
  });

  s.on('screenshare-started', ({ fromSocketId }) => {
    onScreenShareActive(true, fromSocketId);
  });

  s.on('screenshare-stopped', () => {
    onScreenShareActive(false);
  });

  s.on('annotation-draw', ({ fromSocketId, path }) => {
    drawStroke(path.x1, path.y1, path.x2, path.y2, path.color, path.width, path.isEraser, false);
  });

  s.on('annotation-clear', () => {
    clearAnnotations(false);
  });

  s.on('video-filter-changed', ({ socketId, filter }) => {
    const peer = state.peers.get(socketId);
    if (peer) {
      peer.info.videoFilter = filter;
    }
    const tile = document.querySelector(`.video-tile[data-socket="${socketId}"]`);
    if (tile) {
      const video = tile.querySelector('video');
      if (video) video.style.filter = getCSSFilter(filter);
    }
    if (state.currentSpotlightId === socketId) {
      const activeVideo = dom.spotlightArea.querySelector('video');
      if (activeVideo) activeVideo.style.filter = getCSSFilter(filter);
    }
  });

  // Slide Share & Control events
  s.on('slide-share-started', ({ presenterSocketId, slideIndex, slides }) => {
    state.isSharingSlides = true;
    state.slidePresenterSocketId = presenterSocketId;
    state.currentSlideIndex = slideIndex;
    state.customSlides = slides || null;
    if (presenterSocketId === s.id) {
      state.hasSlideControl = true;
    } else {
      state.hasSlideControl = false;
    }
    dom.slidesOverlay.classList.remove('hidden');
    renderSlide();
    updateSlidesControlUI();
    updateParticipantsList();
    if (state.presenterOverlayEnabled) {
      startPresenterOverlayLoop();
    }
  });

  s.on('slide-share-stopped', () => {
    state.isSharingSlides = false;
    state.hasSlideControl = false;
    state.slidePresenterSocketId = null;
    state.controlledSocketId = null;
    state.customSlides = null;
    dom.slidesOverlay.classList.add('hidden');
    updateParticipantsList();
    stopPresenterOverlayLoop();
  });

  s.on('slide-changed', ({ slideIndex }) => {
    state.currentSlideIndex = slideIndex;
    renderSlide();
  });

  s.on('slide-control-granted', ({ targetSocketId }) => {
    state.controlledSocketId = targetSocketId;
    if (targetSocketId === s.id) {
      state.hasSlideControl = true;
    } else {
      state.hasSlideControl = false;
    }
    updateSlidesControlUI();
    updateParticipantsList();
  });

  s.on('slide-control-revoked', () => {
    state.controlledSocketId = null;
    if (s.id === state.slidePresenterSocketId) {
      state.hasSlideControl = true;
    } else {
      state.hasSlideControl = false;
    }
    updateSlidesControlUI();
    updateParticipantsList();
  });

  s.on('breakout-started-broadcast', ({ rooms, duration, allowSelfSelect }) => {
    state.breakoutRoomsCount = rooms.length;
    state.breakoutDuration = duration;
    state.breakoutSelfSelectEnabled = allowSelfSelect;
    if (!state.isHost && !state.breakoutRoomId && allowSelfSelect) {
      openBreakoutSelectionModal(rooms, duration);
    }
  });

  s.on('hand-raise-queue-changed', (queue) => {
    state.handRaiseQueue = queue;
    updateParticipantsList();
    updateHandIconsOnTiles();
  });

  s.on('chat-permissions-changed', ({ permissions }) => {
    state.chatPermissions = permissions;
    updateChatPermissionsUI();
  });

  s.on('unmute-request-prompt', () => {
    dom.modalUnmutePrompt.classList.remove('hidden');
  });

  // Whiteboard persistence
  s.on('whiteboard-history', (paths) => {
    state.wbPaths = paths;
    redrawWhiteboard();
  });
}

function updateVideoGridCountLocal() {
  // Simple local import wrapper to avoid circular dependency execution issues
  import('./media.js').then((mediaMod) => {
    mediaMod.updateVideoGridCount();
  });
}
