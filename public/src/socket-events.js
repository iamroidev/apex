// public/src/socket-events.js — Bind Socket.io signalling event listeners and router
import { state, dom, hasModPowers } from './core.js';
import { addRemotePeer, removeRemotePeer, createOffer, handleOffer } from './webrtc.js';
import { appendChatMessage } from './chat.js';
import { drawRemotePath, clearWhiteboard, redrawWhiteboard } from './whiteboard.js';
import { spawnFloatingReaction } from './ui.js';
import { handleRemoteHandRaise, updateHandIconsOnTiles, toggleMic, toggleCam, displayCaption, getCSSFilter, syncPresentationVideoStrip } from './media.js';
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
    participants.forEach(p => addRemotePeer(p.socketId, p));
    updateParticipantsList();
    updateVideoGridCountLocal();
  });

  s.on('participant-joined', (data) => {
    addRemotePeer(data.socketId, data);
    updateParticipantsList();
    updateVideoGridCountLocal();
    if (state.sandboxMode && state.localStream) createOffer(data.socketId);
  });

  s.on('participant-left', (data) => {
    removeRemotePeer(data.socketId);
    updateParticipantsList();
    updateVideoGridCountLocal();
  });

  // WebRTC signaling
  s.on('signal-offer', async ({ fromSocketId, offer }) => { if (state.sandboxMode) await handleOffer(fromSocketId, offer); });
  s.on('signal-answer', async ({ fromSocketId, answer }) => {
    if (state.sandboxMode) {
      const peer = state.peers.get(fromSocketId);
      if (peer && peer.pc) {
        await peer.pc.setRemoteDescription(new RTCSessionDescription(answer));
        if (peer.iceBuffer && peer.iceBuffer.length) {
          peer.iceBuffer.forEach(async (cand) => { try { await peer.pc.addIceCandidate(new RTCIceCandidate(cand)); } catch (e) {} });
          peer.iceBuffer = [];
        }
      }
    }
  });
  s.on('signal-candidate', async ({ fromSocketId, candidate }) => {
    if (state.sandboxMode) {
      const peer = state.peers.get(fromSocketId);
      if (peer && peer.pc) {
        if (!peer.pc.remoteDescription) { if (!peer.iceBuffer) peer.iceBuffer = []; peer.iceBuffer.push(candidate); }
        else { try { await peer.pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch (e) {} }
      }
    }
  });

  // Chat
  s.on('chat-message', (msg) => {
    appendChatMessage(msg.senderName, msg.message, msg.senderId === state.participantId, msg.timestamp, msg.isPrivate, msg.recipientName);
    if (state.activeTab !== 'chat' || !state.panelOpen) {
      state.chatUnread++; dom.chatBadge.textContent = state.chatUnread; dom.chatBadge.classList.remove('hidden');
    }
  });

  // Chat @mentions
  s.on('chat-mention', ({ fromName, mention, message }) => {
    const toast = document.createElement('div');
    toast.style.cssText = `position:fixed;bottom:120px;right:24px;background:var(--bg-surface);color:var(--accent-cyan);border:2px solid var(--border-strong);padding:8px 16px;box-shadow:4px 4px 0 var(--accent-cyan);font-family:var(--font);font-size:12px;font-weight:bold;z-index:10000;`;
    toast.innerHTML = `📢 <b>${fromName}</b> mentioned you: "${message.slice(0, 80)}"`;
    document.body.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'translateY(-20px)'; toast.style.transition = 'all 0.3s'; setTimeout(() => toast.remove(), 300); }, 4000);
  });

  // Whiteboard
  s.on('whiteboard-draw', ({ fromSocketId, path }) => drawRemotePath(path));
  s.on('whiteboard-clear', () => clearWhiteboard(false));
  s.on('whiteboard-history', (paths) => { state.wbPaths = paths; redrawWhiteboard(); });

  // Reactions
  s.on('reaction', ({ emoji, senderName }) => spawnFloatingReaction(emoji));

  // Hand raise
  s.on('hand-raise', ({ participantId, raised }) => {
    handleRemoteHandRaise(participantId, raised);
    if (raised) {
      let displayName = 'Someone';
      if (participantId === state.participantId) displayName = state.userName || 'You';
      else { const peer = [...state.peers.values()].find(p => p.info.participantId === participantId); if (peer) displayName = peer.info.displayName; }
      import('./main.js').then(m => m.showHandRaiseToast(displayName, raised));
    }
  });

  s.on('hand-raise-queue-changed', (queue) => { state.handRaiseQueue = queue; updateParticipantsList(); updateHandIconsOnTiles(); });

  // Host moderation
  s.on('mute-command', () => {
    if (state.micEnabled) {
      toggleMic();
      const alertBox = document.createElement('div');
      alertBox.style.cssText = `position:fixed;bottom:80px;left:24px;background:var(--bg-surface);color:var(--accent-coral);border:2px solid var(--border-strong);padding:8px 16px;box-shadow:4px 4px 0 var(--accent-coral);font-family:var(--font);font-size:12px;font-weight:bold;z-index:10000;transition:all 0.3s ease;opacity:0;transform:translateY(20px);`;
      alertBox.innerHTML = `🎙️ The host has muted your microphone.`;
      document.body.appendChild(alertBox);
      setTimeout(() => { alertBox.style.opacity = '1'; alertBox.style.transform = 'translateY(0)'; }, 50);
      setTimeout(() => { alertBox.style.opacity = '0'; alertBox.style.transform = 'translateY(20px)'; setTimeout(() => alertBox.remove(), 300); }, 5000);
    }
  });

  s.on('kick-command', () => { alert('You have been removed from this meeting by the host.'); leaveMeeting(); });

  // Meeting ended by host
  s.on('meeting-ended-by-host', () => {
    alert('The host has ended the meeting for everyone.');
    leaveMeeting();
  });

  // Password error
  s.on('password-error', () => {
    alert('Incorrect meeting password. Please try again.');
    if (dom.passwordModal) dom.passwordModal.classList.remove('hidden');
  });

  // Host key
  s.on('host-key-generated', ({ hostKey }) => {
    state.hostKey = hostKey;
    if (dom.hostKeyDisplay) {
      dom.hostKeyDisplay.textContent = `Host Key: ${hostKey}`;
      dom.hostKeyDisplay.classList.remove('hidden');
    }
  });

  // Polling
  s.on('poll-created', (poll) => handlePollCreated(poll));
  s.on('poll-voted', (vote) => handlePollVoted(vote));
  s.on('poll-ended', ({ pollId, results }) => handlePollEnded(pollId, results));

  // Breakout
  s.on('breakout-assigned', ({ roomName, duration }) => handleBreakoutAssigned(roomName, duration));
  s.on('breakout-ended', () => handleBreakoutEnded());
  s.on('breakout-started-broadcast', ({ rooms, duration, allowSelfSelect }) => {
    state.breakoutRoomsCount = rooms.length;
    state.breakoutDuration = duration;
    state.breakoutSelfSelectEnabled = allowSelfSelect;
    if (!state.isHost && !state.breakoutRoomId && allowSelfSelect) openBreakoutSelectionModal(rooms, duration);
  });

  // Security & Waiting Room
  s.on('room-locked-error', () => { alert('This meeting is locked by the host.'); leaveMeeting(); });
  s.on('waiting-room-joined', () => { state.isWaitingToJoin = true; dom.waitingRoomOverlay.classList.remove('hidden'); dom.waitingRoomMeetingTitle.textContent = 'Room Code: ' + state.roomId; });
  s.on('waiting-participant-joined', (data) => { if (!state.waitingQueue.some(p => p.socketId === data.socketId)) state.waitingQueue.push(data); updateWaitingQueueUI(); });
  s.on('waiting-participant-left', ({ socketId }) => { state.waitingQueue = state.waitingQueue.filter(p => p.socketId !== socketId); updateWaitingQueueUI(); });
  s.on('waiting-admitted', () => { state.isWaitingToJoin = false; dom.waitingRoomOverlay.classList.add('hidden'); });
  s.on('waiting-declined', () => { alert('Your request to join this meeting was declined by the host.'); leaveMeeting(); });

  s.on('room-lock-changed', ({ locked }) => {
    state.isRoomLocked = locked;
    if (hasModPowers()) { dom.btnLockMeeting.textContent = locked ? 'Lock Room: On' : 'Lock Room: Off'; dom.btnLockMeeting.classList.toggle('active', locked); }
  });

  s.on('waiting-room-changed', ({ enabled }) => {
    state.isWaitingRoomEnabled = enabled;
    if (hasModPowers()) { dom.btnToggleWaitingRoom.textContent = enabled ? 'Waiting Room: On' : 'Waiting Room: Off'; dom.btnToggleWaitingRoom.classList.toggle('active', enabled); }
  });

  s.on('role-changed', ({ socketId, role }) => {
    if (socketId === s.id) { state.role = role; updateRoleUI(); }
    else { const peer = state.peers.get(socketId); if (peer) peer.info.role = role; }
    updateParticipantsList();
  });

  s.on('participant-renamed', ({ socketId, displayName }) => {
    const peer = state.peers.get(socketId);
    if (peer) peer.info.displayName = displayName;
    const tile = document.querySelector(`.video-tile[data-socket="${socketId}"]`) || document.querySelector(`.video-tile[data-participant="${peer?.info?.participantId}"]`);
    if (tile) {
      const nameEl = tile.querySelector('.tile-name');
      if (nameEl) nameEl.textContent = displayName;
      const avatarEl = tile.querySelector('.tile-avatar .avatar-letter');
      if (avatarEl) avatarEl.textContent = displayName.charAt(0).toUpperCase();
    }
    updateParticipantsList();
  });

  s.on('chat-permissions-changed', ({ permissions }) => { state.chatPermissions = permissions; updateChatPermissionsUI(); });

  s.on('unmute-request-prompt', () => { dom.modalUnmutePrompt.classList.remove('hidden'); });
  s.on('stop-video-command', () => { if (state.camEnabled) toggleCam(); });

  // Screenshare
  s.on('screenshare-started', ({ fromSocketId }) => onScreenShareActive(true, fromSocketId));
  s.on('screenshare-stopped', () => onScreenShareActive(false));

  // Screenshare Control
  s.on('screenshare-control-granted', ({ presenterSocketId }) => {
    state.screenShareController = true;
    alert('You have been granted control of the screenshare. You can now remotely point/annotate.');
  });
  s.on('screenshare-control-revoked', () => {
    state.screenShareController = false;
    alert('Screenshare control has been revoked.');
  });

  // Annotation
  s.on('annotation-draw', ({ fromSocketId, path }) => drawStroke(path.x1, path.y1, path.x2, path.y2, path.color, path.width, path.isEraser, false));
  s.on('annotation-clear', () => clearAnnotations(false));

  s.on('video-filter-changed', ({ socketId, filter }) => {
    const peer = state.peers.get(socketId);
    if (peer) peer.info.videoFilter = filter;
    const tile = document.querySelector(`.video-tile[data-socket="${socketId}"]`);
    if (tile) { const video = tile.querySelector('video'); if (video) video.style.filter = getCSSFilter(filter); }
    if (state.currentSpotlightId === socketId) { const activeVideo = dom.spotlightArea.querySelector('video'); if (activeVideo) activeVideo.style.filter = getCSSFilter(filter); }
  });

  // Virtual Background broadcast
  s.on('virtual-background-changed', ({ socketId, bgType, bgValue }) => {
    const tile = document.querySelector(`.video-tile[data-socket="${socketId}"]`);
    if (tile) {
      const video = tile.querySelector('video');
      if (video) {
        if (bgType === 'none') { video.style.filter = ''; video.style.objectFit = 'cover'; }
        else if (bgType === 'blur') { video.style.filter = 'blur(8px)'; video.style.objectFit = 'cover'; }
        else if (bgType === 'color') { video.style.filter = ''; video.style.objectFit = 'cover'; }
      }
    }
  });

  // Slides
  s.on('slide-share-started', ({ presenterSocketId, slideIndex, slides }) => {
    state.isSharingSlides = true; state.slidePresenterSocketId = presenterSocketId; state.currentSlideIndex = slideIndex; state.customSlides = slides || null;
    if (presenterSocketId === s.id) state.hasSlideControl = true; else state.hasSlideControl = false;
    dom.slidesOverlay.classList.remove('hidden'); renderSlide(); updateSlidesControlUI(); updateParticipantsList();
    if (state.presenterOverlayEnabled) startPresenterOverlayLoop();
    syncPresentationVideoStrip();
  });
  s.on('slide-share-stopped', () => {
    state.isSharingSlides = false; state.hasSlideControl = false; state.slidePresenterSocketId = null; state.controlledSocketId = null; state.customSlides = null;
    dom.slidesOverlay.classList.add('hidden'); updateParticipantsList(); stopPresenterOverlayLoop(); syncPresentationVideoStrip();
  });
  s.on('slide-changed', ({ slideIndex }) => { state.currentSlideIndex = slideIndex; renderSlide(); });
  s.on('slide-control-granted', ({ targetSocketId }) => {
    state.controlledSocketId = targetSocketId;
    state.hasSlideControl = (targetSocketId === s.id);
    updateSlidesControlUI(); updateParticipantsList();
  });
  s.on('slide-control-revoked', () => {
    state.controlledSocketId = null;
    state.hasSlideControl = (s.id === state.slidePresenterSocketId);
    updateSlidesControlUI(); updateParticipantsList();
  });

  // Spotlight (Multiple)
  s.on('spotlight-updated', ({ spotlightSocketIds }) => {
    state.spotlightSocketIds = spotlightSocketIds || [];
    // Visual indicator on spotlighted tiles
    document.querySelectorAll('.video-tile').forEach(t => t.classList.remove('spotlighted'));
    spotlightSocketIds.forEach(sid => {
      const tile = document.querySelector(`.video-tile[data-socket="${sid}"]`);
      if (tile) tile.classList.add('spotlighted');
    });
  });

  // Breakout broadcast
  s.on('breakout-broadcast-received', ({ message }) => {
    if (!dom.announcementToast) return;
    dom.announcementToast.textContent = message;
    dom.announcementToast.classList.remove('hidden');
    if (window._announcementTimeout) clearTimeout(window._announcementTimeout);
    window._announcementTimeout = setTimeout(() => dom.announcementToast.classList.add('hidden'), 10000);
  });

  s.on('speech-transcription-broadcast', ({ senderName, text }) => displayCaption(senderName, text));
  s.on('participant-status-changed', ({ socketId, participantId, isBrb, brbTime }) => {
    if (!state.brbStates) state.brbStates = {};
    const key = participantId || socketId;
    state.brbStates[key] = isBrb ? brbTime : null;
  });

  s.on('whiteboard-laser', ({ socketId, x, y, isStart }) => {
    import('./whiteboard.js').then((wbMod) => wbMod.addLaserPointLocal(x, y, isStart));
  });

  s.on('mute-all-except-presenter-command', ({ presenterSocketId }) => {
    if (s.id !== presenterSocketId && state.micEnabled) toggleMic();
  });
}

function updateVideoGridCountLocal() {
  import('./media.js').then((mediaMod) => {
    mediaMod.updateVideoGridCount();
    if (state.layoutMode === 'speaker') mediaMod.updateSpeakerViewLayout();
  });
}