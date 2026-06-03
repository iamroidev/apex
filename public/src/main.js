// public/src/main.js — Entry script, orchestration, in-meeting control and global exports
import { state, dom, genId, hasModPowers, formatTime, escapeHtml, playVoicePrompt, showView } from './core.js';
import {
  updateClock,
  initTheme,
  bindLanding,
  bindDashboard,
  bindReactions,
  updateDashboardAvatar,
  loadUpcoming,
  deleteScheduled,
  exportSession,
  viewSessionDetails,
  initGoogleAuth
} from './ui.js';
import {
  initMedia,
  toggleMic,
  toggleCam,
  toggleScreenShare,
  changeCameraDevice,
  changeMicDevice,
  changeSpeakerDevice,
  changeVideoFilter,
  changeNoiseSuppression,
  toggleLayoutMode,
  updateSpeakerViewLayout,
  updateVideoGridCount,
  changeGalleryPage,
  copyInviteLink,
  copyScheduledLink,
  updateHandIconsOnTiles,
  initFullscreenAndPip,
  toggleCaptions,
  toggleSelfMinimization,
  initFocusMode
} from './media.js';
import { connectToRoom } from './webrtc.js';
import { connectToLiveKit } from './livekit.js';
import { bindWhiteboard, clearWhiteboard, resizeWhiteboard } from './whiteboard.js';
import { bindChat, downloadFile, handleFileSelect } from './chat.js';
import {
  showPollModal,
  launchPoll,
  sharePollResults,
  closePollHost,
  submitPollVote,
  closePollParticipant
} from './polling.js';
import {
  showBreakoutModal,
  startBreakouts,
  endBreakouts,
  handleBreakoutCsvUpload,
  joinSelfSelectedBreakout,
  openBreakoutSelectionModal
} from './breakout.js';
import {
  initAnnotationCanvas,
  clearAnnotations,
  toggleAnnotationMode,
  setAnnotationTool,
  startPresenterOverlayLoop,
  stopPresenterOverlayLoop
} from './overlay.js';
import { bindSocketEvents } from './socket-events.js';

// Slide presentation array
export const APEX_SLIDES = [
  {
    title: "Welcome to Apex Classroom",
    bullets: [
      "Modern virtual collaboration space built for educators.",
      "Zero artificial call time limits & no paywalls.",
      "High-definition video/audio, screen share, and group chat.",
      "Equipped with active participation tools for students."
    ]
  },
  {
    title: "WebRTC & Real-time Communication",
    bullets: [
      "Peer-to-peer mesh architecture for ultra-low latency.",
      "Signaling handled dynamically via Socket.io server.",
      "Web Audio API Noise Gate filters microphone hum and background noise.",
      "Video filters applied using native CSS visual transformations."
    ]
  },
  {
    title: "Interactive Collaboration Tools",
    bullets: [
      "Full-screen collaborative drawing whiteboard.",
      "Real-time screen sharing with canvas-overlay annotation drawing.",
      "Floating emoji reactions and digital hand raise queue.",
      "Stateless secure login and session logs with detailed metrics."
    ]
  },
  {
    title: "Advanced Classroom Administration",
    bullets: [
      "Pre-assign breakout rooms using client-parsed CSV file uploads.",
      "Let students self-select breakout subrooms as required.",
      "In-meeting live polling with results shared in real-time.",
      "Host and Co-Host roles for shared moderation controls."
    ]
  },
  {
    title: "Q&A Session",
    bullets: [
      "Open discussion and troubleshooting.",
      "Test out the annotation canvas or whiteboard.",
      "Try launching a poll or starting breakout rooms.",
      "Thank you for learning with Apex!"
    ]
  }
];

// Meeting Timer Management
export function startTimer() {
  state.meetingStartTime = Date.now();
  clearInterval(state.timerInterval);

  const durationMs = state.sessionData?.duration_minutes
    ? state.sessionData.duration_minutes * 60 * 1000
    : null;

  if (durationMs) {
    dom.timerLabel.textContent = 'Time Remaining';
    dom.timerLabel.style.color = 'var(--accent-cyan)';
  } else {
    dom.timerLabel.textContent = 'Unlimited Session';
    dom.timerLabel.style.color = 'var(--accent-green)';
  }

  state.timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - state.meetingStartTime) / 1000);
    if (durationMs) {
      const remaining = Math.max(0, Math.floor((durationMs - (Date.now() - state.meetingStartTime)) / 1000));
      dom.meetingTimer.textContent = formatTime(remaining);
      if (remaining <= 300) {
        dom.timerLabel.style.color = 'var(--accent-coral)';
        dom.timerLabel.textContent = remaining <= 0 ? 'Time Up' : 'Ending Soon';
      }
      if (remaining === 0) clearInterval(state.timerInterval);
    } else {
      dom.meetingTimer.textContent = formatTime(elapsed);
    }
  }, 1000);
}

export function stopTimer() {
  clearInterval(state.timerInterval);
  state.timerInterval = null;
}

// Start a new meeting session
export async function startNewMeeting() {
  const name = state.userName || 'Host';
  try {
    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Meeting', hostName: name })
    });
    const session = await res.json();
    state.sessionData = session;
    state.isHost = true;
    joinMeeting(session.id);
  } catch (err) {
    console.error('Failed to create session:', err);
    // Fallback: generate local ID
    const id = genId();
    state.isHost = true;
    joinMeeting(id);
  }
}

// Role elements updates
export function updateRoleUI() {
  const hasMod = hasModPowers();
  document.querySelectorAll('.host-only').forEach(el => {
    el.classList.toggle('hidden', !hasMod);
  });
  updateWaitingQueueUI();
}

let previewStream = null;

export async function showGreenRoomPreview(roomId) {
  const previewModal = document.getElementById('modal-preview');
  if (!previewModal) {
    enterMeeting(roomId);
    return;
  }

  const videoSelect = document.getElementById('preview-select-camera');
  const audioSelect = document.getElementById('preview-select-mic');
  
  state.micEnabled = true;
  state.camEnabled = true;
  
  const micBtn = document.getElementById('preview-btn-mic');
  const camBtn = document.getElementById('preview-btn-cam');
  const avatar = document.getElementById('preview-avatar');
  const avatarLetter = document.getElementById('preview-avatar-letter');
  const name = state.userName || localStorage.getItem('apexDisplayName') || 'Participant';
  if (avatarLetter) avatarLetter.textContent = name.charAt(0).toUpperCase();

  if (micBtn) micBtn.classList.remove('muted');
  if (camBtn) camBtn.classList.remove('muted');
  if (avatar) avatar.classList.add('hidden');

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    if (videoSelect) videoSelect.innerHTML = '';
    if (audioSelect) audioSelect.innerHTML = '';
    
    devices.forEach(device => {
      const option = document.createElement('option');
      option.value = device.deviceId;
      option.textContent = device.label || `${device.kind === 'videoinput' ? 'Camera' : 'Microphone'} (${device.deviceId.slice(0, 5)}...)`;
      if (device.kind === 'videoinput') {
        videoSelect.appendChild(option);
      } else if (device.kind === 'audioinput') {
        audioSelect.appendChild(option);
      }
    });
  } catch (e) {
    console.warn('Enumerate devices failed in preview:', e);
  }

  async function startPreviewStream() {
    if (previewStream) {
      previewStream.getTracks().forEach(t => t.stop());
    }
    
    try {
      const constraints = {
        video: state.selectedCameraId ? { deviceId: { exact: state.selectedCameraId }, width: 1280, height: 720 } : { width: 1280, height: 720, facingMode: 'user' },
        audio: state.selectedMicId ? { deviceId: { exact: state.selectedMicId } } : true
      };
      
      previewStream = await navigator.mediaDevices.getUserMedia(constraints);
      const videoEl = document.getElementById('preview-video');
      if (videoEl) {
        videoEl.srcObject = previewStream;
        videoEl.style.display = 'block';
      }
      
      previewStream.getVideoTracks().forEach(t => t.enabled = state.camEnabled);
      previewStream.getAudioTracks().forEach(t => t.enabled = state.micEnabled);
    } catch (err) {
      console.warn('Preview stream initialization failed:', err);
      const videoEl = document.getElementById('preview-video');
      if (videoEl) videoEl.style.display = 'none';
      if (avatar) avatar.classList.remove('hidden');
    }
  }

  await startPreviewStream();

  if (videoSelect) {
    videoSelect.value = state.selectedCameraId || (videoSelect.firstElementChild ? videoSelect.firstElementChild.value : '');
    videoSelect.onchange = async () => {
      state.selectedCameraId = videoSelect.value;
      await startPreviewStream();
    };
  }
  
  if (audioSelect) {
    audioSelect.value = state.selectedMicId || (audioSelect.firstElementChild ? audioSelect.firstElementChild.value : '');
    audioSelect.onchange = async () => {
      state.selectedMicId = audioSelect.value;
      await startPreviewStream();
    };
  }

  if (micBtn) {
    micBtn.onclick = () => {
      state.micEnabled = !state.micEnabled;
      micBtn.classList.toggle('muted', !state.micEnabled);
      micBtn.querySelectorAll('.icon-on, .icon-off').forEach(svg => {
        svg.style.display = (svg.classList.contains('icon-on') === state.micEnabled) ? 'block' : 'none';
      });
      if (previewStream) {
        previewStream.getAudioTracks().forEach(t => t.enabled = state.micEnabled);
      }
    };
  }

  if (camBtn) {
    camBtn.onclick = () => {
      state.camEnabled = !state.camEnabled;
      camBtn.classList.toggle('muted', !state.camEnabled);
      camBtn.querySelectorAll('.icon-on, .icon-off').forEach(svg => {
        svg.style.display = (svg.classList.contains('icon-on') === state.camEnabled) ? 'block' : 'none';
      });
      if (previewStream) {
        previewStream.getVideoTracks().forEach(t => t.enabled = state.camEnabled);
      }
      if (avatar) avatar.classList.toggle('hidden', state.camEnabled);
    };
  }

  const cancelBtn = document.getElementById('preview-cancel-btn');
  const joinBtn = document.getElementById('preview-join-btn');

  cancelBtn.onclick = () => {
    if (previewStream) {
      previewStream.getTracks().forEach(t => t.stop());
      previewStream = null;
    }
    previewModal.classList.add('hidden');
  };

  joinBtn.onclick = () => {
    if (previewStream) {
      previewStream.getTracks().forEach(t => t.stop());
      previewStream = null;
    }
    previewModal.classList.add('hidden');
    enterMeeting(roomId);
  };

  previewModal.classList.remove('hidden');
}

// Join room orchestration
export async function joinMeeting(roomId) {
  showGreenRoomPreview(roomId);
}

export async function enterMeeting(roomId) {
  // Update URL to include the room ID so refreshes work!
  const newUrl = window.location.origin + '/?join=' + roomId;
  if (window.location.search !== '?join=' + roomId) {
    window.history.pushState({ roomId }, '', newUrl);
  }

  state.roomId = roomId;
  state.isHost = false;
  state.role = 'participant';

  // Query session details to restore host role and title
  try {
    const sessionRes = await fetch('/api/sessions/' + roomId);
    if (sessionRes.ok) {
      const data = await sessionRes.json();
      const session = data.session || data.scheduled;
      if (session) {
        state.sessionData = session;
        if (state.user && session.user_id === state.user.id) {
          state.isHost = true;
        }
      }
    }
  } catch (e) {
    console.warn('Failed to query session host status:', e);
  }

  state.role = state.isHost ? 'host' : 'participant';
  const name = state.userName || 'Participant';
  dom.meetingTitle.textContent = state.sessionData?.title || 'Meeting';
  dom.meetingCodeDisplay.textContent = roomId;
  dom.controlRoomCode.textContent = `Room: ${roomId}`;
  dom.localNameLabel.textContent = name;
  dom.localAvatar.querySelector('.avatar-letter').textContent = name.charAt(0).toUpperCase();

  updateRoleUI();

  // Reset layout mode to Grid View
  state.layoutMode = 'grid';
  dom.btnLayoutToggle.classList.remove('active');
  const layoutLabel = document.getElementById('layout-toggle-label');
  if (layoutLabel) layoutLabel.textContent = 'Gallery';
  dom.videoGrid.classList.remove('hidden');
  dom.speakerViewContainer.classList.add('hidden');

  showView('meeting');
  startTimer();
  await initMedia();
  updateParticipantsList();

  // Fetch LiveKit Token
  let tokenData = null;
  try {
    const res = await fetch('/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId: roomId,
        identity: state.participantId,
        name: name
      })
    });
    tokenData = await res.json();
  } catch (e) {
    console.warn('Failed to fetch LiveKit token, falling back to sandbox mode', e);
    tokenData = { token: null, sandbox: true, wsUrl: null };
  }

  if (tokenData && !tokenData.sandbox && tokenData.token) {
    state.sandboxMode = false;
    await connectToLiveKit(tokenData.wsUrl, tokenData.token);
  } else {
    state.sandboxMode = true;
    state.livekitConnected = false;
    state.livekitRoom = null;
  }

  connectToRoom(roomId);
  updateVideoGridCount();
}

// Leave room orchestration
export async function leaveMeeting() {
  if (state.localStream) {
    state.localStream.getTracks().forEach(t => t.stop());
    state.localStream = null;
  }
  if (state.screenStream) {
    state.screenStream.getTracks().forEach(t => t.stop());
    state.screenStream = null;
  }

  if (state.isRecording) stopRecordingLocal();

  state.peers.forEach((peer) => {
    if (peer.pc) peer.pc.close();
  });
  state.peers.clear();

  if (state.livekitRoom) {
    try {
      state.livekitRoom.disconnect();
    } catch (e) {
      console.warn('Error disconnecting from LiveKit room:', e);
    }
    state.livekitRoom = null;
  }
  state.livekitConnected = false;

  state.socket.emit('leave-room', { roomId: state.roomId });

  if (state.roomId) {
    try { await fetch(`/api/sessions/${state.roomId}/end`, { method: 'POST' }); } catch (e) { /* ok */ }
  }

  clearSandboxBots();
  stopTimer();

  const remoteTiles = dom.videoGrid.querySelectorAll('.video-tile:not(.local-tile)');
  remoteTiles.forEach(t => t.remove());

  state.panelOpen = false;
  dom.sidePanel.classList.add('hidden');
  dom.wbOverlay.classList.add('hidden');
  dom.btnWhiteboardToggle.classList.remove('active');
  dom.viewMeeting.classList.remove('side-panel-open');

  dom.btnMic.classList.remove('muted');
  dom.btnCam.classList.remove('muted');
  dom.btnScreen.classList.remove('active');
  dom.btnRecord.classList.remove('recording');
  dom.btnHand.classList.remove('active');
  dom.viewMeeting.classList.remove('recording-active');
  dom.chatMessages.innerHTML = '';
  state.chatUnread = 0;
  dom.chatBadge.classList.add('hidden');
  state.handRaised = false;
  const handBadge = dom.localTile.querySelector('.tile-hand-badge');
  if (handBadge) handBadge.remove();

  state.galleryPage = 0;
  state.participantsSearchQuery = '';
  if (dom.participantsSearch) {
    dom.participantsSearch.value = '';
  }

  clearWhiteboard(false);

  state.roomId = null;
  state.sessionData = null;
  state.isHost = false;
  state.role = 'participant';
  state.isLocalMinimized = false;
  state.captionsEnabled = false;
  state.sidePanelFloating = false;

  // Revert URL to clean state
  const cleanUrl = window.location.origin + '/';
  if (window.location.search) {
    window.history.pushState(null, '', cleanUrl);
  }

  showView('dashboard');
  loadUpcoming();
}

function stopRecordingLocal() {
  if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
    state.mediaRecorder.stop();
  }
  state.isRecording = false;
  dom.btnRecord.classList.remove('recording');

  if (dom.recBadge) {
    dom.recBadge.classList.add('hidden');
    dom.recBadge.style.display = 'none';
  }
  dom.viewMeeting.classList.remove('recording-active');
  playVoicePrompt("Recording stopped");
}

// Side panels toggles
export function togglePanel(tab) {
  if (state.panelOpen && state.activeTab === tab) {
    state.panelOpen = false;
    dom.sidePanel.classList.add('hidden');
    dom.btnChatToggle.classList.remove('active');
    dom.btnParticipantsToggle.classList.remove('active');
    dom.viewMeeting.classList.remove('side-panel-open');
  } else {
    state.panelOpen = true;
    dom.sidePanel.classList.remove('hidden');
    dom.viewMeeting.classList.add('side-panel-open');
    switchTab(tab);
  }
}

export function switchTab(tab) {
  state.activeTab = tab;
  dom.panelTabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  dom.tabChat.classList.toggle('hidden', tab !== 'chat');
  dom.tabParticipants.classList.toggle('hidden', tab !== 'participants');

  dom.btnChatToggle.classList.toggle('active', tab === 'chat');
  dom.btnParticipantsToggle.classList.toggle('active', tab === 'participants');

  if (tab === 'chat') {
    state.chatUnread = 0;
    dom.chatBadge.classList.add('hidden');
  }
}

export function toggleWhiteboard() {
  const isHidden = dom.wbOverlay.classList.contains('hidden');
  if (isHidden) {
    dom.wbOverlay.classList.remove('hidden');
    dom.btnWhiteboardToggle.classList.add('active');
    resizeWhiteboard();
  } else {
    dom.wbOverlay.classList.add('hidden');
    dom.btnWhiteboardToggle.classList.remove('active');
  }
}

export function toggleRecording() {
  if (state.isRecording) {
    stopRecordingLocal();
  } else {
    startRecordingLocal();
  }
}

function startRecordingLocal() {
  const stream = dom.localVideo.srcObject;
  if (!stream) return;

  const canvasStream = dom.localVideo.captureStream ? dom.localVideo.captureStream() : null;
  const recordStream = canvasStream || stream;

  try {
    state.mediaRecorder = new MediaRecorder(recordStream, { mimeType: 'video/webm;codecs=vp9,opus' });
  } catch (e) {
    state.mediaRecorder = new MediaRecorder(recordStream);
  }
  state.recordedChunks = [];

  state.mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) state.recordedChunks.push(e.data);
  };

  state.mediaRecorder.onstop = () => {
    const blob = new Blob(state.recordedChunks, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `apex-recording-${state.roomId}-${Date.now()}.webm`;
    a.click();
    URL.revokeObjectURL(url);
  };

  state.mediaRecorder.start(1000);
  state.isRecording = true;
  dom.btnRecord.classList.add('recording');
  
  if (dom.recBadge) {
    dom.recBadge.classList.remove('hidden');
    dom.recBadge.style.display = 'inline-flex';
  }
  dom.viewMeeting.classList.add('recording-active');
  playVoicePrompt("Recording in progress");
}

export function toggleHandRaise() {
  state.handRaised = !state.handRaised;
  dom.btnHand.classList.toggle('active', state.handRaised);

  let badge = dom.localTile.querySelector('.tile-hand-badge');
  if (state.handRaised) {
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'tile-hand-badge';
      badge.textContent = '✋';
      dom.localTile.appendChild(badge);
    }
  } else {
    if (badge) badge.remove();
  }

  state.socket.emit('hand-raise', {
    roomId: state.roomId,
    participantId: state.participantId,
    raised: state.handRaised
  });
}

// In-meeting base events listeners bindings
export function bindMeetingControls() {
  dom.btnMic.addEventListener('click', toggleMic);
  dom.btnCam.addEventListener('click', toggleCam);
  dom.btnScreen.addEventListener('click', toggleScreenShare);
  dom.btnRecord.addEventListener('click', toggleRecording);
  dom.btnLeave.addEventListener('click', leaveMeeting);
  if (dom.btnLeaveHeader) {
    dom.btnLeaveHeader.addEventListener('click', leaveMeeting);
  }
  if (dom.btnSpawnBots) {
    dom.btnSpawnBots.addEventListener('click', spawnSandboxBots);
  }

  dom.btnChatToggle.addEventListener('click', () => togglePanel('chat'));
  dom.btnParticipantsToggle.addEventListener('click', () => togglePanel('participants'));
  dom.btnWhiteboardToggle.addEventListener('click', toggleWhiteboard);

  dom.panelClose.addEventListener('click', () => {
    state.panelOpen = false;
    dom.sidePanel.classList.add('hidden');
    dom.btnChatToggle.classList.remove('active');
    dom.btnParticipantsToggle.classList.remove('active');
    dom.viewMeeting.classList.remove('side-panel-open');
  });

  dom.wbClose.addEventListener('click', () => {
    dom.wbOverlay.classList.add('hidden');
    dom.btnWhiteboardToggle.classList.remove('active');
  });

  dom.btnReactions.addEventListener('click', () => {
    state.reactionsOpen = !state.reactionsOpen;
    dom.reactionsPicker.classList.toggle('hidden', !state.reactionsOpen);
  });

  dom.btnHand.addEventListener('click', toggleHandRaise);

  dom.panelTabs.forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  dom.meetingCodeDisplay.addEventListener('click', () => {
    navigator.clipboard.writeText(state.roomId).catch(() => {});
    dom.meetingCodeDisplay.textContent = 'Copied!';
    setTimeout(() => {
      dom.meetingCodeDisplay.textContent = state.roomId;
    }, 1200);
  });
}

// Sandbox simulated participants activity loop
const BOT_NAMES = [
  'Kwame A.', 'Ama K.', 'Kofi B.', 'Akua M.', 'Yaw D.',
  'Abena S.', 'Kwesi F.', 'Efua T.', 'Nana O.', 'Adjoa P.',
  'Kojo R.', 'Adwoa L.', 'Fiifi N.', 'Serwaa H.', 'Papa E.'
];

const BOT_MESSAGES = [
  'Can you repeat that?', 'Thanks for explaining!', 'I have a question',
  'That makes sense now', 'Could you share the slides?', 'Is this going to be recorded?',
  'Very helpful, thank you', 'Can we see an example?', 'I agree with that point',
  'Sorry, my connection dropped briefly', 'When is the assignment due?',
  'Can you zoom into that diagram?', 'I think there might be a typo on slide 5',
  'Great lecture!', 'Should we take notes on this?'
];

export function spawnSandboxBots() {
  if (state.bots.length >= 12) return;

  const count = Math.min(4, 12 - state.bots.length);
  for (let i = 0; i < count; i++) {
    const nameIdx = state.bots.length % BOT_NAMES.length;
    const bot = {
      id: 'bot-' + genId(),
      name: BOT_NAMES[nameIdx],
      speaking: false,
      muted: false
    };
    state.bots.push(bot);
    createBotTile(bot);
  }

  updateParticipantsList();
  updateVideoGridCount();
  startBotActivity();
}

function createBotTile(bot) {
  const tile = document.createElement('div');
  tile.className = 'video-tile';
  tile.dataset.participant = bot.id;
  tile.dataset.botTile = 'true';

  const avatar = document.createElement('div');
  avatar.className = 'tile-avatar';
  avatar.innerHTML = `<span class="avatar-letter">${bot.name.charAt(0)}</span>`;
  tile.appendChild(avatar);

  const bars = document.createElement('div');
  bars.className = 'tile-audio-bars';
  for (let i = 0; i < 5; i++) {
    const bar = document.createElement('div');
    bar.className = 'audio-bar';
    bar.style.height = '2px';
    bars.appendChild(bar);
  }
  tile.appendChild(bars);

  const overlay = document.createElement('div');
  overlay.className = 'tile-overlay';
  overlay.innerHTML = `
    <span class="tile-name">${escapeHtml(bot.name)}</span>
    <span class="tile-speaking-indicator"></span>`;
  tile.appendChild(overlay);

  dom.videoGrid.appendChild(tile);
}

export function startBotActivity() {
  state.botIntervals.forEach(id => clearInterval(id));
  state.botIntervals = [];

  const speakInterval = setInterval(() => {
    if (state.bots.length === 0) return;
    const bot = state.bots[Math.floor(Math.random() * state.bots.length)];
    if (bot.muted) return;
    const tile = document.querySelector(`.video-tile[data-participant="${bot.id}"]`);
    if (!tile) return;

    tile.classList.add('speaking');
    const bars = tile.querySelectorAll('.audio-bar');
    const barInterval = setInterval(() => {
      bars.forEach(bar => {
        bar.style.height = (2 + Math.random() * 14) + 'px';
      });
    }, 120);

    setTimeout(() => {
      tile.classList.remove('speaking');
      clearInterval(barInterval);
      bars.forEach(bar => bar.style.height = '2px');
    }, 1500 + Math.random() * 3000);
  }, 3000);
  state.botIntervals.push(speakInterval);

  const chatInterval = setInterval(() => {
    if (state.bots.length === 0) return;
    const bot = state.bots[Math.floor(Math.random() * state.bots.length)];
    const msg = BOT_MESSAGES[Math.floor(Math.random() * BOT_MESSAGES.length)];
    appendChatMessage(bot.name, msg, false, new Date().toISOString());

    if (state.activeTab !== 'chat' || !state.panelOpen) {
      state.chatUnread++;
      dom.chatBadge.textContent = state.chatUnread;
      dom.chatBadge.classList.remove('hidden');
    }
  }, 6000 + Math.random() * 8000);
  state.botIntervals.push(chatInterval);

  const drawInterval = setInterval(() => {
    if (state.bots.length === 0) return;
    const ctx = dom.wbCanvas.getContext('2d');
    const colors = ['#00f2fe', '#ff5252', '#a18cd1', '#4ceb9a', '#ffd200'];
    const color = colors[Math.floor(Math.random() * colors.length)];
    const startX = Math.random() * dom.wbCanvas.width;
    const startY = Math.random() * dom.wbCanvas.height;

    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(startX + (Math.random() - 0.5) * 100, startY + (Math.random() - 0.5) * 100);
    ctx.stroke();
  }, 10000);
  state.botIntervals.push(drawInterval);
}

export function clearSandboxBots() {
  state.botIntervals.forEach(id => clearInterval(id));
  state.botIntervals = [];
  state.bots.forEach(bot => {
    const tile = document.querySelector(`.video-tile[data-participant="${bot.id}"]`);
    if (tile) tile.remove();
  });
  state.bots = [];
}

// Slide sharing helpers
// Dynamic PDF/Image Presentation helpers
async function loadPDFJS() {
  if (window.pdfjsLib) return window.pdfjsLib;
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js';
    script.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
      resolve(window.pdfjsLib);
    };
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

async function parsePDF(file) {
  const pdfjsLib = await loadPDFJS();
  const fileReader = new FileReader();
  return new Promise((resolve, reject) => {
    fileReader.onload = async function() {
      try {
        const typedarray = new Uint8Array(this.result);
        const pdf = await pdfjsLib.getDocument({ data: typedarray }).promise;
        const pageImages = [];
        
        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          const page = await pdf.getPage(pageNum);
          const viewport = page.getViewport({ scale: 1.5 });
          
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');
          canvas.height = viewport.height;
          canvas.width = viewport.width;
          
          await page.render({ canvasContext: context, viewport: viewport }).promise;
          const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
          pageImages.push(dataUrl);
        }
        resolve(pageImages);
      } catch (err) {
        reject(err);
      }
    };
    fileReader.onerror = reject;
    fileReader.readAsArrayBuffer(file);
  });
}

async function loadJSZip() {
  if (window.JSZip) return window.JSZip;
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
    script.onload = () => resolve(window.JSZip);
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

async function parsePPTX(file) {
  const JSZip = await loadJSZip();
  const fileReader = new FileReader();
  return new Promise((resolve, reject) => {
    fileReader.onload = async function() {
      try {
        const zip = await JSZip.loadAsync(this.result);
        const images = [];
        
        // Find media images inside the pptx zip
        const mediaFiles = [];
        zip.forEach((relativePath, zipEntry) => {
          if (relativePath.startsWith('ppt/media/') && /\.(png|jpe?g|gif|webp|svg)$/i.test(relativePath)) {
            mediaFiles.push(zipEntry);
          }
        });
        
        // Sort files by name to maintain insertion order
        mediaFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
        
        for (const entry of mediaFiles) {
          const blob = await entry.async('blob');
          const dataUrl = await new Promise((res) => {
            const r = new FileReader();
            r.onload = () => res(r.result);
            r.readAsDataURL(blob);
          });
          images.push(dataUrl);
        }
        
        if (images.length === 0) {
          // Fallback: extract text content slide by slide
          const slideFiles = [];
          zip.forEach((relativePath, zipEntry) => {
            if (relativePath.startsWith('ppt/slides/slide') && relativePath.endsWith('.xml')) {
              slideFiles.push(zipEntry);
            }
          });
          slideFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
          
          const htmlSlides = [];
          for (const entry of slideFiles) {
            const text = await entry.async('string');
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(text, 'text/xml');
            const texts = Array.from(xmlDoc.getElementsByTagName('a:t')).map(t => t.textContent).filter(Boolean);
            
            // Render text extract in a neat styled card
            const slideHtml = `
              <div style="padding: var(--sp-6); width: 100%; height: 100%; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; background: var(--bg-surface); border: 2px solid var(--border-strong); box-shadow: var(--neo-shadow-md); overflow-y: auto;">
                <div style="font-family: var(--font); font-size: var(--text-lg); font-weight: bold; color: var(--text-primary); max-width: 85%; line-height: 1.6;">
                  ${texts.slice(0, 15).join('<br><br>')}
                </div>
              </div>
            `;
            htmlSlides.push(slideHtml);
          }
          
          if (htmlSlides.length > 0) {
            resolve(htmlSlides);
            return;
          }
          
          throw new Error("No slide media or text content found inside the PPTX file.");
        }
        
        resolve(images);
      } catch (err) {
        reject(err);
      }
    };
    fileReader.onerror = reject;
    fileReader.readAsArrayBuffer(file);
  });
}

async function parseImages(files) {
  const sortedFiles = Array.from(files).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const images = [];
  for (const file of sortedFiles) {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const compressedUrl = await compressImage(dataUrl);
    images.push(compressedUrl);
  }
  return images;
}

async function compressImage(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      const MAX_WIDTH = 1024;
      const MAX_HEIGHT = 768;
      let width = img.width;
      let height = img.height;
      
      if (width > MAX_WIDTH) {
        height *= MAX_WIDTH / width;
        width = MAX_WIDTH;
      }
      if (height > MAX_HEIGHT) {
        width *= MAX_HEIGHT / height;
        height = MAX_HEIGHT;
      }
      
      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.7));
    };
    img.src = dataUrl;
  });
}

export function startSlidesSharingWithDeck(deck) {
  state.isSharingSlides = true;
  state.currentSlideIndex = 0;
  state.hasSlideControl = true;
  state.slidePresenterSocketId = state.socket.id;
  state.customSlides = deck;

  dom.btnSlidesToggle.classList.add('active');
  dom.slidesOverlay.classList.remove('hidden');
  renderSlide();
  updateSlidesControlUI();

  state.socket.emit('slide-share-start', { 
    roomId: state.roomId, 
    slideIndex: 0,
    slides: deck 
  });
  
  updateParticipantsList();
  if (state.presenterOverlayEnabled) {
    startPresenterOverlayLoop();
  }
}

function showSlidesSourceModal() {
  const existing = document.getElementById('slides-source-modal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'slides-source-modal';
  overlay.className = 'modal-overlay';
  overlay.style.cssText = 'display:flex;z-index:10005;';

  const box = document.createElement('div');
  box.className = 'modal-box';
  box.style.maxWidth = '460px';
  box.innerHTML = `
    <h3 class="modal-title" style="font-family:'Space Grotesk',sans-serif;font-weight:700;margin-bottom:var(--sp-4);">Share Slides</h3>
    <p style="font-size:var(--text-xs);color:var(--text-secondary);margin-bottom:var(--sp-5);line-height:1.5;">Choose whether to present the default demo slide deck or upload your own PDF, PPTX presentation, or images.</p>
    
    <div style="display:flex;flex-direction:column;gap:var(--sp-3);margin-bottom:var(--sp-4);">
      <button class="btn btn-ghost" id="btn-use-demo-deck" style="width:100%;text-align:center;height:40px;">Use Demo Slides</button>
      <button class="btn btn-primary" id="btn-upload-custom-deck" style="width:100%;text-align:center;height:40px;">Upload PDF, PPTX or Images...</button>
    </div>
    
    <input type="file" id="custom-slides-file" accept="application/pdf, image/*, .pptx, application/vnd.openxmlformats-officedocument.presentationml.presentation" multiple style="display:none;">
    
    <div id="slides-loading-status" class="hidden" style="font-size:var(--text-xs);color:var(--accent-cyan);text-align:center;font-weight:bold;margin-bottom:var(--sp-2);">
      Processing files... Please wait.
    </div>

    <div class="modal-actions" style="margin-top:0;">
      <button class="btn btn-ghost" id="btn-cancel-slides-choice" style="width:100%;height:36px;">Cancel</button>
    </div>`;

  overlay.appendChild(box);
  document.body.appendChild(overlay);

  const demoBtn = overlay.querySelector('#btn-use-demo-deck');
  const uploadBtn = overlay.querySelector('#btn-upload-custom-deck');
  const cancelBtn = overlay.querySelector('#btn-cancel-slides-choice');
  const fileInput = overlay.querySelector('#custom-slides-file');
  const loadingStatus = overlay.querySelector('#slides-loading-status');

  demoBtn.onclick = () => {
    overlay.remove();
    startSlidesSharingWithDeck(null);
  };

  uploadBtn.onclick = () => {
    fileInput.click();
  };

  fileInput.onchange = async (e) => {
    const files = e.target.files;
    if (!files || !files.length) return;

    loadingStatus.classList.remove('hidden');
    demoBtn.disabled = true;
    uploadBtn.disabled = true;
    cancelBtn.disabled = true;

    try {
      let customSlides = [];
      const fileList = Array.from(files);
      const hasPdf = fileList.some(f => f.type === 'application/pdf');
      const hasPptx = fileList.some(f => f.name.toLowerCase().endsWith('.pptx') || f.type === 'application/vnd.openxmlformats-officedocument.presentationml.presentation');

      if (hasPptx) {
        const pptxFile = fileList.find(f => f.name.toLowerCase().endsWith('.pptx') || f.type === 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
        customSlides = await parsePPTX(pptxFile);
      } else if (hasPdf) {
        const pdfFile = fileList.find(f => f.type === 'application/pdf');
        customSlides = await parsePDF(pdfFile);
      } else {
        customSlides = await parseImages(files);
      }

      if (customSlides && customSlides.length > 0) {
        overlay.remove();
        startSlidesSharingWithDeck(customSlides);
      } else {
        alert('No valid pages or images could be processed.');
        loadingStatus.classList.add('hidden');
        demoBtn.disabled = false;
        uploadBtn.disabled = false;
        cancelBtn.disabled = false;
      }
    } catch (err) {
      console.error('Failed to load slides:', err);
      alert('Error parsing presentation files: ' + err.message);
      loadingStatus.classList.add('hidden');
      demoBtn.disabled = false;
      uploadBtn.disabled = false;
      cancelBtn.disabled = false;
    }
  };

  cancelBtn.onclick = () => overlay.remove();
}

export function toggleSlidesSharing() {
  if (state.isSharingSlides) {
    stopSlidesSharing();
    return;
  }
  showSlidesSourceModal();
}

export function stopSlidesSharing() {
  state.isSharingSlides = false;
  state.hasSlideControl = false;
  state.slidePresenterSocketId = null;
  state.controlledSocketId = null;
  state.customSlides = null;
  
  dom.btnSlidesToggle.classList.remove('active');
  dom.slidesOverlay.classList.add('hidden');
  
  state.socket.emit('slide-share-stop', { roomId: state.roomId });
  updateParticipantsList();
  stopPresenterOverlayLoop();
}

export function changeSlide(direction) {
  if (!state.hasSlideControl) return;
  
  let newIndex = state.currentSlideIndex + direction;
  const maxSlides = state.customSlides ? state.customSlides.length : APEX_SLIDES.length;
  if (newIndex >= 0 && newIndex < maxSlides) {
    state.currentSlideIndex = newIndex;
    renderSlide();
    state.socket.emit('slide-change', { roomId: state.roomId, slideIndex: newIndex });
  }
}

export function togglePeerSlideControl(socketId) {
  if (!state.isHost) return;
  
  if (state.controlledSocketId === socketId) {
    state.socket.emit('slide-revoke-control', { roomId: state.roomId });
  } else {
    state.socket.emit('slide-grant-control', { roomId: state.roomId, targetSocketId: socketId });
  }
}

export function revokeSlideControl() {
  if (!state.isHost) return;
  state.socket.emit('slide-revoke-control', { roomId: state.roomId });
}

export function updateSlidesControlUI() {
  dom.btnSlidesPrev.disabled = !state.hasSlideControl;
  dom.btnSlidesNext.disabled = !state.hasSlideControl;
  dom.btnSlidesPrev.style.opacity = state.hasSlideControl ? '1' : '0.4';
  dom.btnSlidesNext.style.opacity = state.hasSlideControl ? '1' : '0.4';
  dom.btnSlidesPrev.style.cursor = state.hasSlideControl ? 'pointer' : 'not-allowed';
  dom.btnSlidesNext.style.cursor = state.hasSlideControl ? 'pointer' : 'not-allowed';
  
  if (state.hasSlideControl) {
    dom.slidesControlStatus.textContent = "You have control";
    dom.slidesControlStatus.style.color = "var(--accent-cyan)";
  } else {
    let controllerName = "Presenter";
    if (state.controlledSocketId) {
      if (state.controlledSocketId === state.socket.id) {
        controllerName = "You";
      } else {
        const peer = state.peers.get(state.controlledSocketId);
        if (peer) controllerName = peer.info.displayName;
      }
    } else {
      const presenter = state.peers.get(state.slidePresenterSocketId);
      if (presenter) controllerName = presenter.info.displayName;
    }
    dom.slidesControlStatus.textContent = `${controllerName} is controlling`;
    dom.slidesControlStatus.style.color = "var(--text-secondary)";
  }

  dom.btnSlidesRevoke.classList.toggle('hidden', !state.isHost || !state.controlledSocketId);
}

export function renderSlide() {
  // If sharing custom deck of images or HTML slides
  if (state.customSlides && state.customSlides[state.currentSlideIndex]) {
    const slideContent = state.customSlides[state.currentSlideIndex];
    dom.slidesTitle.textContent = "Presentation: Custom Slides";
    dom.slidesCounter.textContent = `Slide ${state.currentSlideIndex + 1} of ${state.customSlides.length}`;
    
    // Check if the slide is HTML text (starts with '<div' or contains markup)
    if (typeof slideContent === 'string' && slideContent.trim().startsWith('<div')) {
      dom.slidesContentContainer.innerHTML = slideContent;
    } else {
      dom.slidesContentContainer.innerHTML = `
        <div style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; overflow: hidden; position: relative;">
          <img src="${slideContent}" style="max-width: 100%; max-height: 100%; object-fit: contain; border: 2px solid var(--border-strong); box-shadow: var(--neo-shadow-sm); background: #ffffff;" />
        </div>
      `;
    }
    return;
  }

  // Otherwise fallback to demo slides
  const slide = APEX_SLIDES[state.currentSlideIndex];
  if (!slide) return;
  
  dom.slidesTitle.textContent = `Presentation: ${slide.title}`;
  dom.slidesCounter.textContent = `Slide ${state.currentSlideIndex + 1} of ${APEX_SLIDES.length}`;
  
  const bulletsHtml = slide.bullets.map(b => `
    <li style="margin-bottom: var(--sp-3); font-size: var(--text-base); color: var(--text-primary); line-height: 1.5; display: flex; align-items: flex-start; gap: var(--sp-2);">
      <span style="color: var(--accent-cyan); font-weight: bold;">▪</span>
      <span>${escapeHtml(b)}</span>
    </li>
  `).join('');
  
  dom.slidesContentContainer.innerHTML = `
    <div class="slide-card" style="background: var(--bg-surface); border: 3px solid var(--border-strong); padding: var(--sp-6) var(--sp-8); max-width: 600px; width: 100%; box-shadow: var(--neo-shadow); border-radius: var(--radius-sm);">
      <h2 style="font-family: 'Space Grotesk', sans-serif; font-size: var(--text-2xl); font-weight: 700; margin-bottom: var(--sp-5); border-bottom: 2px solid var(--border-strong); padding-bottom: var(--sp-3); color: var(--accent-cyan); text-transform: uppercase; letter-spacing: 0.02em;">
        ${escapeHtml(slide.title)}
      </h2>
      <ul style="list-style: none; padding: 0; margin: 0;">
        ${bulletsHtml}
      </ul>
    </div>
  `;
}

// Moderator Controls
export function toggleCoHost(socketId) {
  if (!state.isHost) return;
  state.socket.emit('toggle-cohost', { roomId: state.roomId, targetSocketId: socketId });
}

export function muteParticipant(socketId) {
  if (!hasModPowers()) return;
  state.socket.emit('mute-participant', { roomId: state.roomId, targetSocketId: socketId });
}

export function kickParticipant(socketId) {
  if (!hasModPowers()) return;
  state.socket.emit('kick-participant', { roomId: state.roomId, targetSocketId: socketId });
}

export function lowerParticipantHand(participantId) {
  if (!hasModPowers()) return;
  state.socket.emit('lower-hand', { roomId: state.roomId, targetParticipantId: participantId });
}

export function stopParticipantVideo(socketId) {
  if (!hasModPowers()) return;
  state.socket.emit('stop-video-participant', { roomId: state.roomId, targetSocketId: socketId });
}

export function toggleDockFloat() {
  state.sidePanelFloating = !state.sidePanelFloating;
  dom.sidePanel.classList.toggle('floating-mode', state.sidePanelFloating);
  dom.viewMeeting.classList.toggle('side-panel-floating', state.sidePanelFloating);
  
  if (dom.btnDockFloatToggle) {
    dom.btnDockFloatToggle.textContent = state.sidePanelFloating ? 'Dock' : 'Float';
    dom.btnDockFloatToggle.classList.toggle('active', state.sidePanelFloating);
  }
}

export function muteBot(botId) {
  if (!hasModPowers()) return;
  const bot = state.bots.find(b => b.id === botId);
  if (bot) {
    bot.muted = !bot.muted;
    updateParticipantsList();
    
    const tile = document.querySelector(`.video-tile[data-participant="${botId}"]`);
    if (tile) {
      tile.classList.toggle('muted-sim', bot.muted);
      if (bot.muted) {
        tile.classList.remove('speaking');
        tile.querySelectorAll('.audio-bar').forEach(bar => bar.style.height = '2px');
      }
    }
  }
}

export function kickBot(botId) {
  if (!hasModPowers()) return;
  state.bots = state.bots.filter(b => b.id !== botId);
  const tile = document.querySelector(`.video-tile[data-participant="${botId}"]`);
  if (tile) tile.remove();
  updateParticipantsList();
  updateVideoGridCount();
  
  if (state.layoutMode === 'speaker') {
    state.currentSpotlightId = null;
    updateSpeakerViewLayout();
  }
}

export function muteAll() {
  if (!hasModPowers()) return;
  state.socket.emit('mute-all', { roomId: state.roomId });
  
  state.bots.forEach(b => {
    b.muted = true;
    const tile = document.querySelector(`.video-tile[data-participant="${b.id}"]`);
    if (tile) {
      tile.classList.add('muted-sim');
      tile.classList.remove('speaking');
      tile.querySelectorAll('.audio-bar').forEach(bar => bar.style.height = '2px');
    }
  });
  updateParticipantsList();
}

export function askToUnmute(socketId) {
  if (!hasModPowers()) return;
  state.socket.emit('unmute-request', { roomId: state.roomId, targetSocketId: socketId });
}

// Waiting Room & Security Controls
export function toggleWaitingRoomHost() {
  const enabled = !state.isWaitingRoomEnabled;
  state.socket.emit('toggle-waiting-room', { roomId: state.roomId, enabled });
}

export function toggleLockMeetingHost() {
  const locked = !state.isRoomLocked;
  state.socket.emit('lock-room', { roomId: state.roomId, locked });
}

export function cancelWaitingRoom() {
  dom.waitingRoomOverlay.classList.add('hidden');
  state.isWaitingToJoin = false;
  leaveMeeting();
}

export function admitParticipant(socketId) {
  state.socket.emit('waiting-admit', { roomId: state.roomId, targetSocketId: socketId });
}

export function declineParticipant(socketId) {
  state.socket.emit('waiting-decline', { roomId: state.roomId, targetSocketId: socketId });
}

export function updateWaitingQueueUI() {
  if (!hasModPowers()) return;

  const count = state.waitingQueue.length;
  dom.waitingCountBadge.textContent = count;
  dom.waitingQueueContainer.classList.toggle('hidden', count === 0);

  dom.waitingList.innerHTML = state.waitingQueue.map(p => `
    <div class="waiting-item">
      <span class="waiting-item-name" title="${escapeHtml(p.displayName)}">${escapeHtml(p.displayName)}</span>
      <div class="waiting-item-actions">
        <button class="waiting-btn waiting-btn-admit" onclick="window._apex.admitParticipant('${p.socketId}')">Admit</button>
        <button class="waiting-btn waiting-btn-decline" onclick="window._apex.declineParticipant('${p.socketId}')">Decline</button>
      </div>
    </div>
  `).join('');
}

// Screen sharing active loop trigger
export function onScreenShareActive(active, presenterSocketId) {
  state.screenSharingActive = active;
  dom.btnAnnotateToggle.classList.toggle('hidden', !active);
  
  if (active) {
    if (state.layoutMode !== 'speaker') {
      toggleLayoutMode();
    }
    if (presenterSocketId) {
      let presenterId = null;
      if (presenterSocketId === state.socket?.id) {
        presenterId = 'local';
      } else {
        const peer = state.peers.get(presenterSocketId);
        if (peer && peer.info) {
          presenterId = peer.info.participantId;
        }
      }
      if (presenterId) {
        state.currentSpotlightId = presenterId;
        updateSpeakerViewLayout();
      }
    }
    dom.annotationCanvas.classList.remove('hidden');
    dom.annotationCanvas.width = 1280;
    dom.annotationCanvas.height = 720;
    dom.annotationCanvas.style.pointerEvents = 'none';
    clearAnnotations(false);
  } else {
    if (state.isAnnotating) {
      toggleAnnotationMode();
    }
    dom.annotationCanvas.classList.add('hidden');
    clearAnnotations(false);
  }
}

// Chat Permissions Update
export function updateChatPermissionsUI() {
  const isHost = state.isHost || state.role === 'cohost';
  const permissions = state.chatPermissions;

  if (isHost && dom.chatPermissionsSelect) {
    dom.chatPermissionsSelect.value = permissions;
  }

  if (!dom.chatInput) return;

  if (permissions === 'none') {
    if (!isHost) {
      dom.chatInput.disabled = true;
      dom.chatInput.placeholder = "Chat is disabled by the host";
      dom.btnSendChat.disabled = true;
      dom.btnChatAttach.disabled = true;
    } else {
      dom.chatInput.disabled = false;
      dom.chatInput.placeholder = "Type a message (Chat is off for participants)...";
      dom.btnSendChat.disabled = false;
      dom.btnChatAttach.disabled = false;
    }
  } else {
    dom.chatInput.disabled = false;
    dom.chatInput.placeholder = "Type a message...";
    dom.btnSendChat.disabled = false;
    dom.btnChatAttach.disabled = false;
  }

  updateParticipantsList();
}

// Unified participants list updater
export function updateParticipantsList() {
  const allParticipants = [];
  
  // Local
  allParticipants.push({
    isLocal: true,
    socketId: state.socket?.id,
    participantId: state.participantId,
    displayName: state.userName || 'You',
    role: state.isHost ? 'host' : (state.role || 'participant'),
    bot: false,
    muted: !state.micEnabled
  });

  // Remote
  state.peers.forEach((peer, socketId) => {
    let isMuted = true;
    if (peer.stream) {
      const audioTracks = peer.stream.getAudioTracks();
      if (audioTracks.length && audioTracks[0].enabled) {
        isMuted = false;
      }
    }
    allParticipants.push({
      isLocal: false,
      socketId,
      participantId: peer.info.participantId,
      displayName: peer.info.displayName || 'Participant',
      role: peer.info.role || 'participant',
      bot: false,
      muted: isMuted
    });
  });

  // Bots
  state.bots.forEach(bot => {
    allParticipants.push({
      isLocal: false,
      socketId: bot.id,
      participantId: bot.id,
      displayName: bot.name,
      role: 'simulated',
      bot: true,
      muted: bot.muted
    });
  });

  allParticipants.sort((a, b) => {
    const aIdx = state.handRaiseQueue.findIndex(item => item.participantId === a.participantId || item.socketId === a.socketId);
    const bIdx = state.handRaiseQueue.findIndex(item => item.participantId === b.participantId || item.socketId === b.socketId);
    
    if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
    if (aIdx !== -1) return -1;
    if (bIdx !== -1) return 1;

    const roleOrder = { 'host': 0, 'cohost': 1, 'participant': 2, 'simulated': 3 };
    const aOrder = roleOrder[a.role] !== undefined ? roleOrder[a.role] : 2;
    const bOrder = roleOrder[b.role] !== undefined ? roleOrder[b.role] : 2;
    if (aOrder !== bOrder) return aOrder - bOrder;

    return a.displayName.localeCompare(b.displayName);
  });

  const searchQuery = (state.participantsSearchQuery || '').toLowerCase().trim();
  const filteredParticipants = searchQuery
    ? allParticipants.filter(p => p.displayName.toLowerCase().includes(searchQuery))
    : allParticipants;

  const currentRecipient = dom.chatRecipient ? dom.chatRecipient.value : 'everyone';
  const recipientOptions = [];

  const isUserHost = state.isHost || state.role === 'cohost';
  const chatPerms = state.chatPermissions;

  const allowPublic = isUserHost || (chatPerms !== 'none' && chatPerms !== 'host-only');
  if (allowPublic) {
    recipientOptions.push(`<option value="everyone">Everyone</option>`);
  }

  const items = filteredParticipants.map(p => {
    const qIdx = state.handRaiseQueue.findIndex(item => item.participantId === p.participantId || item.socketId === p.socketId);
    const handBadge = qIdx !== -1 ? `<span class="participant-hand" style="color: var(--accent-cyan); font-weight: bold; margin-left: var(--sp-2);">✋ ${qIdx + 1}</span>` : '';
    const localSuffix = p.isLocal ? ' (You)' : '';

    if (!p.isLocal) {
      const peerIsHost = p.role === 'host' || p.role === 'cohost';
      let allowDM = false;
      if (isUserHost) {
        allowDM = true;
      } else {
        if (chatPerms === 'public-private') {
          allowDM = true;
        } else if (chatPerms === 'public' || chatPerms === 'host-only') {
          allowDM = peerIsHost;
        }
      }

      if (allowDM) {
        recipientOptions.push(`<option value="${p.socketId}">${escapeHtml(p.displayName)}${p.bot ? ' (Private Sim)' : ' (Private)'}</option>`);
      }
    }

    let actionButtons = '';
    if (hasModPowers() && !p.isLocal) {
      actionButtons = `<div class="participant-actions">`;
      if (p.bot) {
        actionButtons += `<button class="btn-mod mod-mute" onclick="window._apex.muteBot('${p.participantId}')">${p.muted ? 'Unmute' : 'Mute'}</button>`;
      } else {
        if (p.muted) {
          actionButtons += `<button class="btn-mod mod-unmute" onclick="window._apex.askToUnmute('${p.socketId}')" style="background: var(--accent-cyan-dim); color: var(--accent-cyan); font-size: 9px; padding: 2px 4px;">Ask to Unmute</button>`;
        } else {
          actionButtons += `<button class="btn-mod mod-mute" onclick="window._apex.muteParticipant('${p.socketId}')">Mute</button>`;
        }
      }
      actionButtons += `<button class="btn-mod mod-kick" onclick="window._apex.${p.bot ? 'kickBot' : 'kickParticipant'}('${p.socketId}')">Kick</button>`;
      
      if (state.isHost && !p.bot) {
        const isPeerCoHost = p.role === 'cohost';
        actionButtons += `
          <button class="btn-mod mod-cohost" onclick="window._apex.toggleCoHost('${p.socketId}')" style="background: var(--accent-lavender-dim); color: var(--accent-lavender); font-size: 9px; padding: 2px 4px; margin-right: 2px;">
            ${isPeerCoHost ? 'Demote' : 'Co-Host'}
          </button>
        `;
        if (state.isSharingSlides) {
          const hasControl = state.controlledSocketId === p.socketId;
          actionButtons += `
            <button class="btn-mod mod-slide-control" onclick="window._apex.togglePeerSlideControl('${p.socketId}')" style="background: var(--accent-cyan-dim); color: var(--accent-cyan); font-size: 9px; padding: 2px 4px;">
              ${hasControl ? 'Revoke Slide' : 'Grant Slide'}
            </button>
          `;
        }
      }
      if (qIdx !== -1) {
        actionButtons += `
          <button class="btn-mod mod-lower-hand" onclick="window._apex.lowerParticipantHand('${p.participantId}')" style="background: var(--accent-cyan-dim); color: var(--accent-cyan); font-size: 9px; padding: 2px 4px; margin-right: 2px;">
            Lower Hand
          </button>
        `;
      }
      if (!p.bot) {
        actionButtons += `
          <button class="btn-mod mod-stop-video" onclick="window._apex.stopParticipantVideo('${p.socketId}')" style="background: var(--accent-coral-dim); color: var(--accent-coral); font-size: 9px; padding: 2px 4px; margin-right: 2px;">
            Stop Video
          </button>
        `;
      }
      actionButtons += `</div>`;
    }

    const dotColor = p.bot ? 'var(--accent-teal)' : (p.isLocal ? 'var(--accent-green)' : 'var(--accent-cyan)');
    return `
      <div class="participant-item">
        <span class="participant-dot" style="background: ${dotColor}"></span>
        <span class="participant-name">${escapeHtml(p.displayName)}${localSuffix}${handBadge}</span>
        ${actionButtons}
        <span class="participant-role">${p.role}</span>
      </div>`;
  });

  dom.participantsList.innerHTML = items.join('');

  if (dom.chatRecipient) {
    dom.chatRecipient.innerHTML = recipientOptions.join('');
    dom.chatRecipient.value = currentRecipient;
    if (!dom.chatRecipient.value) dom.chatRecipient.value = 'everyone';
  }

  updateHandIconsOnTiles();
}

export function bindNewInMeetingFeatures() {
  // Copy invite link
  dom.btnCopyInvite.addEventListener('click', copyInviteLink);

  // Layout toggling
  dom.btnLayoutToggle.addEventListener('click', toggleLayoutMode);

  // Annotation toolbar bindings
  dom.btnAnnotateToggle.addEventListener('click', toggleAnnotationMode);
  dom.btnAnnotationClose.addEventListener('click', toggleAnnotationMode);
  dom.btnAnnotationPen.addEventListener('click', () => setAnnotationTool('pen'));
  dom.btnAnnotationEraser.addEventListener('click', () => setAnnotationTool('eraser'));
  dom.annotationColor.addEventListener('input', (e) => state.annotationColor = e.target.value);
  dom.annotationWidth.addEventListener('change', (e) => state.annotationWidth = parseInt(e.target.value));
  dom.btnAnnotationClear.addEventListener('click', () => clearAnnotations(true));

  // Mute all button
  dom.btnMuteAll.addEventListener('click', muteAll);

  // Breakout modal toggle & launch
  dom.btnBreakoutToggle.addEventListener('click', showBreakoutModal);
  dom.breakoutCancel.addEventListener('click', () => dom.modalBreakoutHost.classList.add('hidden'));
  dom.breakoutStartBtn.addEventListener('click', startBreakouts);
  dom.breakoutEndBtn.addEventListener('click', endBreakouts);

  // Polls modal toggle & launch
  dom.btnPollsToggle.addEventListener('click', showPollModal);
  dom.pollHostCancel.addEventListener('click', () => dom.modalPollHost.classList.add('hidden'));
  dom.pollLaunchBtn.addEventListener('click', launchPoll);
  dom.pollEndShareBtn.addEventListener('click', sharePollResults);
  dom.pollHostClose.addEventListener('click', closePollHost);
  dom.pollSubmitVoteBtn.addEventListener('click', submitPollVote);
  dom.pollParticipantClose.addEventListener('click', closePollParticipant);

  // Chat attachments
  dom.btnChatAttach.addEventListener('click', () => dom.chatFileInput.click());
  dom.chatFileInput.addEventListener('change', handleFileSelect);

  // Settings button & modal
  dom.btnSettings.addEventListener('click', openSettings);
  dom.btnSettingsClose.addEventListener('click', () => dom.modalSettings.classList.add('hidden'));

  // Device changes
  dom.settingsCamera.addEventListener('change', changeCameraDevice);
  dom.settingsMic.addEventListener('change', changeMicDevice);
  dom.settingsSpeaker.addEventListener('change', changeSpeakerDevice);
  dom.settingsVideoFilter.addEventListener('change', changeVideoFilter);
  dom.settingsNoiseSuppression.addEventListener('change', changeNoiseSuppression);

  // Waiting Room & Security Controls
  dom.btnToggleWaitingRoom.addEventListener('click', toggleWaitingRoomHost);
  dom.btnLockMeeting.addEventListener('click', toggleLockMeetingHost);
  dom.btnCancelWaiting.addEventListener('click', cancelWaitingRoom);

  // Slide Sharing controls
  dom.btnSlidesToggle.addEventListener('click', toggleSlidesSharing);
  dom.btnSlidesClose.addEventListener('click', stopSlidesSharing);
  dom.btnSlidesPrev.addEventListener('click', () => changeSlide(-1));
  dom.btnSlidesNext.addEventListener('click', () => changeSlide(1));
  dom.btnSlidesRevoke.addEventListener('click', revokeSlideControl);

  // Breakout CSV & Self-Select
  dom.breakoutCsvFile.addEventListener('change', handleBreakoutCsvUpload);
  dom.breakoutParticipantCloseBtn.addEventListener('click', () => dom.modalBreakoutParticipant.classList.add('hidden'));

  // Initialize Fullscreen and Picture-in-Picture event listeners
  initFullscreenAndPip();

  // Double click to toggle fullscreen on video tiles or presentation overlay
  document.addEventListener('dblclick', (e) => {
    const tile = e.target.closest('.video-tile');
    if (tile) {
      if (!document.fullscreenElement) {
        tile.requestFullscreen().catch(err => console.warn(err));
      } else {
        document.exitFullscreen().catch(err => console.warn(err));
      }
      return;
    }

    const slidesOverlay = e.target.closest('#slides-overlay');
    if (slidesOverlay) {
      if (e.target.closest('.wb-overlay-header') || e.target.closest('button')) return;
      if (!document.fullscreenElement) {
        slidesOverlay.requestFullscreen().catch(err => console.warn(err));
      } else {
        document.exitFullscreen().catch(err => console.warn(err));
      }
    }
  });

  // Closed Captions, Focus Mode, Self-Minimization and Sidebar docking
  if (dom.btnCaptionsToggle) {
    dom.btnCaptionsToggle.addEventListener('click', toggleCaptions);
  }
  if (dom.btnDockFloatToggle) {
    dom.btnDockFloatToggle.addEventListener('click', toggleDockFloat);
  }
  if (dom.btnLocalMinimize) {
    dom.btnLocalMinimize.addEventListener('click', toggleSelfMinimization);
  }
  if (dom.localTile) {
    dom.localTile.addEventListener('dblclick', toggleSelfMinimization);
  }
  if (dom.breakoutBroadcastBtn) {
    dom.breakoutBroadcastBtn.addEventListener('click', () => {
      const msg = dom.breakoutBroadcastInput.value.trim();
      if (!msg) return;
      state.socket.emit('breakout-broadcast-message', {
        roomId: state.roomId,
        message: msg,
        roomCount: state.breakoutRoomsCount
      });
      dom.breakoutBroadcastInput.value = '';
      if (dom.breakoutBroadcastStatus) {
        dom.breakoutBroadcastStatus.textContent = 'Broadcast sent!';
        setTimeout(() => {
          dom.breakoutBroadcastStatus.textContent = '';
        }, 3000);
      }
    });
  }

  // Initialize focus mode
  initFocusMode();

  // Chat Permissions Selector
  dom.chatPermissionsSelect.addEventListener('change', (e) => {
    state.socket.emit('change-chat-permissions', { roomId: state.roomId, permissions: e.target.value });
  });

  // Presenter Overlay Settings
  dom.settingsPresenterOverlay.addEventListener('change', (e) => {
    state.presenterOverlayEnabled = e.target.checked;
    document.querySelectorAll('.id-presenter-overlay-options').forEach(el => {
      el.classList.toggle('hidden', !state.presenterOverlayEnabled);
    });
    document.querySelectorAll('.id-chroma-options').forEach(el => {
      el.classList.toggle('hidden', !state.presenterOverlayEnabled || state.presenterOverlayType !== 'chromakey');
    });
    
    if (state.presenterOverlayEnabled && state.isSharingSlides) {
      startPresenterOverlayLoop();
    } else {
      stopPresenterOverlayLoop();
    }
  });

  dom.settingsOverlayType.addEventListener('change', (e) => {
    state.presenterOverlayType = e.target.value;
    document.querySelectorAll('.id-chroma-options').forEach(el => {
      el.classList.toggle('hidden', state.presenterOverlayType !== 'chromakey');
    });
  });

  dom.settingsChromaColor.addEventListener('change', (e) => {
    state.presenterChromaColor = e.target.value;
  });

  dom.settingsChromaTolerance.addEventListener('input', (e) => {
    state.presenterChromaTolerance = parseInt(e.target.value);
  });

  // Unmute prompt modal controls
  dom.btnUnmuteDecline.addEventListener('click', () => {
    dom.modalUnmutePrompt.classList.add('hidden');
  });

  dom.btnUnmuteAccept.addEventListener('click', () => {
    dom.modalUnmutePrompt.classList.add('hidden');
    if (!state.micEnabled) {
      toggleMic();
    }
  });

  // Participant search bar input listener
  if (dom.participantsSearch) {
    dom.participantsSearch.addEventListener('input', (e) => {
      state.participantsSearchQuery = e.target.value;
      updateParticipantsList();
    });
  }

  // Gallery Grid Pagination buttons
  if (dom.btnGalleryPrev) {
    dom.btnGalleryPrev.addEventListener('click', () => changeGalleryPage(-1));
  }
  if (dom.btnGalleryNext) {
    dom.btnGalleryNext.addEventListener('click', () => changeGalleryPage(1));
  }
}

// Media settings helpers
async function openSettings() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    
    dom.settingsCamera.innerHTML = '';
    dom.settingsMic.innerHTML = '';
    dom.settingsSpeaker.innerHTML = '';

    let hasVideo = false;
    let hasAudio = false;
    let hasOutput = false;

    devices.forEach(device => {
      const option = document.createElement('option');
      option.value = device.deviceId;
      option.textContent = device.label || `${device.kind === 'videoinput' ? 'Camera' : device.kind === 'audioinput' ? 'Microphone' : 'Speaker'} (${device.deviceId.slice(0, 5)}...)`;

      if (device.kind === 'videoinput') {
        dom.settingsCamera.appendChild(option);
        hasVideo = true;
      } else if (device.kind === 'audioinput') {
        dom.settingsMic.appendChild(option);
        hasAudio = true;
      } else if (device.kind === 'audiooutput') {
        dom.settingsSpeaker.appendChild(option);
        hasOutput = true;
      }
    });

    if (!hasVideo) dom.settingsCamera.innerHTML = '<option value="">No Camera Found</option>';
    if (!hasAudio) dom.settingsMic.innerHTML = '<option value="">No Microphone Found</option>';
    if (!hasOutput) dom.settingsSpeaker.innerHTML = '<option value="default">Default Speaker</option>';

    if (state.localStream) {
      const videoTrack = state.localStream.getVideoTracks()[0];
      const audioTrack = state.localStream.getAudioTracks()[0];
      if (videoTrack) {
        const settings = videoTrack.getSettings();
        state.selectedCameraId = settings.deviceId || videoTrack.label;
      }
      if (audioTrack) {
        const settings = audioTrack.getSettings();
        state.selectedMicId = settings.deviceId || audioTrack.label;
      }
    }

    if (state.selectedCameraId) dom.settingsCamera.value = state.selectedCameraId;
    if (state.selectedMicId) dom.settingsMic.value = state.selectedMicId;
    if (state.selectedSpeakerId) dom.settingsSpeaker.value = state.selectedSpeakerId;

    dom.settingsPresenterOverlay.checked = state.presenterOverlayEnabled;
    dom.settingsOverlayType.value = state.presenterOverlayType;
    dom.settingsChromaColor.value = state.presenterChromaColor;
    dom.settingsChromaTolerance.value = state.presenterChromaTolerance;

    document.querySelectorAll('.id-presenter-overlay-options').forEach(el => {
      el.classList.toggle('hidden', !state.presenterOverlayEnabled);
    });
    document.querySelectorAll('.id-chroma-options').forEach(el => {
      el.classList.toggle('hidden', !state.presenterOverlayEnabled || state.presenterOverlayType !== 'chromakey');
    });

    dom.modalSettings.classList.remove('hidden');
  } catch (e) {
    console.error('Failed to open settings:', e.message);
  }
}

// Unified Core initialiser
async function init() {
  state.participantId = genId();

  initTheme();
  initAnnotationCanvas();
  bindLanding();
  bindDashboard();
  bindMeetingControls();
  bindChat();
  bindWhiteboard();
  bindReactions();
  bindNewInMeetingFeatures();

  const urlParams = new URLSearchParams(window.location.search);
  const inviteRoom = urlParams.get('join') || urlParams.get('room');
  if (inviteRoom) {
    dom.landingJoinCode.value = inviteRoom;
    const banner = document.getElementById('invite-banner');
    const bannerCode = document.getElementById('invite-banner-code');
    const joinTitle = document.getElementById('quick-join-title');
    const subtitle = document.querySelector('.landing-subtitle');
    if (banner) banner.classList.remove('hidden');
    if (bannerCode) bannerCode.textContent = `Room: ${inviteRoom}`;
    if (joinTitle) joinTitle.textContent = 'Enter your name to join';
    if (subtitle) subtitle.style.display = 'none';
    dom.landingJoinCode.readOnly = true;
    dom.landingJoinCode.style.opacity = '0.5';
    const savedName = localStorage.getItem('apexDisplayName');
    if (savedName && dom.landingJoinName) dom.landingJoinName.value = savedName;
    setTimeout(() => (dom.landingJoinName || dom.landingJoinCode).focus(), 120);
    window.history.replaceState({}, '', window.location.pathname);
  }

  // Connect socket
  state.socket = io();
  bindSocketEvents();

  // Initialize Google Authentication Sign-In
  initGoogleAuth();

  // Handle browser back/forward history navigation (popstate)
  window.addEventListener('popstate', (e) => {
    const params = new URLSearchParams(window.location.search);
    const room = params.get('join') || params.get('room');
    if (room) {
      if (state.roomId !== room) {
        enterMeeting(room);
      }
    } else {
      if (state.roomId) {
        leaveMeeting();
      }
    }
  });

  // Check Auth Session on startup
  try {
    const res = await fetch('/api/auth/session');
    const data = await res.json();
    const savedName = localStorage.getItem('apexDisplayName');

    if (data.user) {
      state.user = data.user;
      state.userName = data.user.username;
      dom.dashUsernameDisplay.textContent = data.user.username;
      updateDashboardAvatar();

      if (inviteRoom) {
        enterMeeting(inviteRoom);
      } else {
        showView('dashboard');
        loadUpcoming();
      }
    } else {
      if (inviteRoom && savedName) {
        state.userName = savedName;
        enterMeeting(inviteRoom);
      } else {
        showView('landing');
      }
    }
  } catch (e) {
    if (inviteRoom && localStorage.getItem('apexDisplayName')) {
      state.userName = localStorage.getItem('apexDisplayName');
      enterMeeting(inviteRoom);
    } else {
      showView('landing');
    }
  }
}

// Expose public API methods on window._apex for inline dynamic HTML template references
window._apex = {
  joinMeeting,
  deleteScheduled,
  copyScheduledLink,
  exportSession,
  muteParticipant,
  kickParticipant,
  muteBot,
  kickBot,
  downloadFile,
  admitParticipant,
  declineParticipant,
  toggleCoHost,
  viewSessionDetails,
  togglePeerSlideControl,
  joinSelfSelectedBreakout,
  askToUnmute,
  lowerParticipantHand,
  stopParticipantVideo
};

document.addEventListener('DOMContentLoaded', init);
