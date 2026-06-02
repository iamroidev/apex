// app.js — Apex Classroom client
// Handles views, media, WebRTC (via Socket.io signaling), sandbox mode,
// chat, whiteboard, reactions, recording, and session management.

(function () {
  'use strict';

  // ============================================================
  // STATE
  // ============================================================
  const state = {
    view: 'landing',       // 'landing' | 'dashboard' | 'meeting' | 'logs'
    user: null,            // { id, username } if logged in
    userName: '',
    oddsellerId: '',
    participantId: '',
    roomId: null,
    sessionData: null,
    isHost: false,

    // Media
    localStream: null,
    screenStream: null,
    micEnabled: true,
    camEnabled: true,
    isSharingScreen: false,

    // Recording
    mediaRecorder: null,
    recordedChunks: [],
    isRecording: false,

    // Timer
    meetingStartTime: null,
    timerInterval: null,

    // Side panel
    panelOpen: false,
    activeTab: 'chat',

    // Chat
    chatUnread: 0,

    // Whiteboard
    wbTool: 'pen',
    wbColor: '#00f2fe',
    wbDrawing: false,
    wbLastX: 0,
    wbLastY: 0,
    wbPaths: [],

    // Reactions
    reactionsOpen: false,

    // Hand
    handRaised: false,

    // Sandbox
    sandboxMode: false,
    bots: [],
    botIntervals: [],

    // Peers (for real WebRTC)
    peers: new Map(), // socketId -> { pc, stream, info }

    // Layout
    layoutMode: 'grid', // 'grid' | 'speaker'
    pinnedParticipantId: null,

    // Breakouts
    breakoutActive: false,
    breakoutRoomId: null,
    breakoutRoomsCount: 2,
    breakoutDuration: 1,
    breakoutTimerInterval: null,

    // Polling
    activePoll: null,
    hasVoted: false,

    // Socket
    socket: null,

    // Waiting Room & Security
    isWaitingToJoin: false,
    waitingQueue: [], // { socketId, participantId, displayName }
    isRoomLocked: false,
    isWaitingRoomEnabled: false,

    // Device selections
    selectedCameraId: '',
    selectedMicId: '',
    selectedSpeakerId: '',

    // Annotation
    isAnnotating: false,
    annotationTool: 'pen',
    annotationColor: '#00f2fe',
    annotationWidth: 4,
    screenSharingActive: false,

    // Audio & Video Enhancements
    videoFilter: 'none',
    noiseSuppressionEnabled: false,

    // Slide Sharing
    isSharingSlides: false,
    currentSlideIndex: 0,
    slidePresenterSocketId: null,
    hasSlideControl: false,
    controlledSocketId: null,

    // Breakouts csv assignment & self-selection
    breakoutCsvAssignments: null,
    breakoutSelfSelectEnabled: false,

    // New Zoom-like states
    presenterOverlayEnabled: false,
    presenterOverlayType: 'bubble',
    presenterChromaColor: 'green',
    presenterChromaTolerance: 80,
    handRaiseQueue: [],
    chatPermissions: 'public-private'
  };

  // ============================================================
  // DOM REFS
  // ============================================================
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const dom = {
    // Views
    viewLanding: $('#view-landing'),
    viewDashboard: $('#view-dashboard'),
    viewMeeting: $('#view-meeting'),
    viewLogs: $('#view-logs'),

    // Landing Page Auth & Guest Join
    formLogin: $('#form-login'),
    formRegister: $('#form-register'),
    loginUsername: $('#login-username'),
    loginPassword: $('#login-password'),
    loginError: $('#login-error'),
    registerUsername: $('#register-username'),
    registerPassword: $('#register-password'),
    registerError: $('#register-error'),
    authTabLogin: $('#auth-tab-login'),
    authTabSignup: $('#auth-tab-signup'),
    landingJoinCode: $('#landing-join-code'),
    landingJoinName: $('#landing-join-name'),
    btnLandingJoin: $('#btn-landing-join'),
    landingJoinError: $('#landing-join-error'),

    // Dashboard
    dashClock: $('#dash-clock'),
    dashUsernameDisplay: $('#dash-username-display'),
    btnLogout: $('#btn-logout'),
    btnNewMeeting: $('#btn-new-meeting'),
    btnJoinMeeting: $('#btn-join-meeting'),
    btnSchedule: $('#btn-schedule'),
    btnSessionLogs: $('#btn-session-logs'),
    upcomingList: $('#upcoming-list'),

    // Join modal
    modalJoin: $('#modal-join'),
    joinCodeInput: $('#join-code-input'),
    joinCancel: $('#join-cancel'),
    joinConfirm: $('#join-confirm'),

    // Schedule modal
    modalSchedule: $('#modal-schedule'),
    schedTitle: $('#sched-title'),
    schedDatetime: $('#sched-datetime'),
    schedDuration: $('#sched-duration'),
    schedCancel: $('#sched-cancel'),
    schedConfirm: $('#sched-confirm'),

    // Session logs
    logsBack: $('#logs-back'),
    logsList: $('#logs-list'),

    // Meeting
    meetingTitle: $('#meeting-title'),
    meetingCodeDisplay: $('#meeting-code-display'),
    meetingTimer: $('#meeting-timer'),
    videoGrid: $('#video-grid'),
    localVideo: $('#local-video'),
    localTile: $('#local-tile'),
    localNameLabel: $('#local-name-label'),
    localSpeaking: $('#local-speaking'),
    localAvatar: $('#local-avatar'),
    btnSpawnBots: $('#btn-spawn-bots'),

    // Controls
    btnMic: $('#btn-mic'),
    btnCam: $('#btn-cam'),
    btnScreen: $('#btn-screen'),
    btnRecord: $('#btn-record'),
    btnChatToggle: $('#btn-chat-toggle'),
    btnParticipantsToggle: $('#btn-participants-toggle'),
    btnWhiteboardToggle: $('#btn-whiteboard-toggle'),
    btnReactions: $('#btn-reactions'),
    btnHand: $('#btn-hand'),
    btnLeave: $('#btn-leave'),
    controlRoomCode: $('#control-room-code'),

    // Side panel
    sidePanel: $('#side-panel'),
    panelClose: $('#panel-close'),
    panelTabs: $$('.panel-tab'),
    tabChat: $('#tab-chat'),
    tabParticipants: $('#tab-participants'),
    wbOverlay: $('#wb-overlay'),
    wbClose: $('#wb-close'),

    // Chat
    chatMessages: $('#chat-messages'),
    chatInput: $('#chat-input'),
    btnSendChat: $('#btn-send-chat'),
    chatBadge: $('#chat-badge'),
    chatRecipient: $('#chat-recipient'),

    // Participants
    participantsList: $('#participants-list'),

    // Whiteboard
    wbCanvas: $('#whiteboard-canvas'),
    wbColor: $('#wb-color'),
    wbTools: $$('.wb-tool'),

    // Reactions
    reactionsLayer: $('#reactions-layer'),
    reactionsPicker: $('#reactions-picker'),
    reactionBtns: $$('.reaction-btn'),

    // Layout Toggling & Invite
    btnCopyInvite: $('#btn-copy-invite'),
    btnLayoutToggle: $('#btn-layout-toggle'),
    btnAnnotateToggle: $('#btn-annotate-toggle'),
    speakerViewContainer: $('#speaker-view-container'),
    speakerThumbnails: $('#speaker-thumbnails'),
    spotlightArea: $('#spotlight-area'),
    annotationToolbar: $('#annotation-toolbar'),
    annotationCanvas: $('#screen-annotation-canvas'),
    btnAnnotationPen: $('#btn-annotation-pen'),
    btnAnnotationEraser: $('#btn-annotation-eraser'),
    annotationColor: $('#annotation-color'),
    annotationWidth: $('#annotation-width'),
    btnAnnotationClear: $('#btn-annotation-clear'),
    btnAnnotationClose: $('#btn-annotation-close'),

    // Breakout timer & labels
    timerLabel: $('#timer-label'),
    breakoutTimerBadge: $('#breakout-timer-badge'),

    // Slides
    btnSlidesToggle: $('#btn-slides-toggle'),
    slidesOverlay: $('#slides-overlay'),
    slidesTitle: $('#slides-title'),
    slidesCounter: $('#slides-counter'),
    btnSlidesPrev: $('#btn-slides-prev'),
    btnSlidesNext: $('#btn-slides-next'),
    slidesControlStatus: $('#slides-control-status'),
    btnSlidesRevoke: $('#btn-slides-revoke'),
    btnSlidesClose: $('#btn-slides-close'),
    slidesContentContainer: $('#slides-content-container'),

    // Breakout Advanced
    breakoutCsvFile: $('#breakout-csv-file'),
    breakoutCsvStatus: $('#breakout-csv-status'),
    breakoutSelfSelect: $('#breakout-self-select'),
    modalBreakoutParticipant: $('#modal-breakout-participant'),
    breakoutRoomsList: $('#breakout-rooms-list'),
    breakoutParticipantCloseBtn: $('#breakout-participant-close-btn'),

    // New Zoom-like DOM refs
    chatPermissionsSelect: $('#chat-permissions-select'),
    settingsPresenterOverlay: $('#settings-presenter-overlay'),
    settingsOverlayType: $('#settings-overlay-type'),
    settingsChromaColor: $('#settings-chroma-color'),
    settingsChromaTolerance: $('#settings-chroma-tolerance'),
    slidesPresenterCanvas: $('#slides-presenter-canvas'),
    modalUnmutePrompt: $('#modal-unmute-prompt'),
    btnUnmuteDecline: $('#btn-unmute-decline'),
    btnUnmuteAccept: $('#btn-unmute-accept'),

    // Chat Attachment
    chatFileInput: $('#chat-file-input'),
    btnChatAttach: $('#btn-chat-attach'),

    // Host breakout control
    btnBreakoutToggle: $('#btn-breakout-toggle'),
    modalBreakoutHost: $('#modal-breakout-host'),
    breakoutRoomsCount: $('#breakout-rooms-count'),
    breakoutDuration: $('#breakout-duration'),
    breakoutCancel: $('#breakout-cancel'),
    breakoutStartBtn: $('#breakout-start-btn'),
    breakoutEndBtn: $('#breakout-end-btn'),
    breakoutSetupView: $('#breakout-setup-view'),
    breakoutActiveView: $('#breakout-active-view'),

    // Host polling control
    btnMuteAll: $('#btn-mute-all'),
    participantsFooter: $('#participants-footer'),
    btnPollsToggle: $('#btn-polls-toggle'),
    modalPollHost: $('#modal-poll-host'),
    pollHostTitle: $('#poll-host-title'),
    pollCreateView: $('#poll-create-view'),
    pollQuestion: $('#poll-question'),
    pollOpt1: $('#poll-opt-1'),
    pollOpt2: $('#poll-opt-2'),
    pollOpt3: $('#poll-opt-3'),
    pollOpt4: $('#poll-opt-4'),
    pollHostCancel: $('#poll-host-cancel'),
    pollLaunchBtn: $('#poll-launch-btn'),
    pollTallyView: $('#poll-tally-view'),
    pollTallyQuestion: $('#poll-tally-question'),
    pollTallyResults: $('#poll-tally-results'),
    pollHostClose: $('#poll-host-close'),
    pollEndShareBtn: $('#poll-end-share-btn'),

    // Participant polling control
    modalPollParticipant: $('#modal-poll-participant'),
    pollVoteView: $('#poll-vote-view'),
    pollVoteQuestion: $('#poll-vote-question'),
    pollVoteOptions: $('#poll-vote-options'),
    pollSubmitVoteBtn: $('#poll-submit-vote-btn'),
    pollWaitView: $('#poll-wait-view'),
    pollWaitText: $('#poll-wait-text'),
    pollParticipantResults: $('#poll-participant-results'),
    pollParticipantClose: $('#poll-participant-close'),

    // Settings & Device selections
    btnSettings: $('#btn-settings'),
    modalSettings: $('#modal-settings'),
    settingsCamera: $('#settings-camera'),
    settingsMic: $('#settings-mic'),
    settingsSpeaker: $('#settings-speaker'),
    settingsVideoFilter: $('#settings-video-filter'),
    settingsNoiseSuppression: $('#settings-noise-suppression'),
    btnSettingsClose: $('#btn-settings-close'),

    // Waiting Room & Security Controls
    btnToggleWaitingRoom: $('#btn-toggle-waiting-room'),
    btnLockMeeting: $('#btn-lock-meeting'),
    waitingQueueContainer: $('#waiting-queue-container'),
    waitingCountBadge: $('#waiting-count-badge'),
    waitingList: $('#waiting-list'),
    waitingRoomOverlay: $('#waiting-room-overlay'),
    waitingRoomMessage: $('#waiting-room-message'),
    waitingRoomMeetingTitle: $('#waiting-room-meeting-title'),
    btnCancelWaiting: $('#btn-cancel-waiting'),

    // Log Details
    modalLogDetails: $('#modal-log-details'),
    logDetailsTbody: $('#log-details-tbody'),
    btnLogDetailsClose: $('#btn-log-details-close'),
  };

  // ============================================================
  // UTILITIES
  // ============================================================
  function genId() {
    return Math.random().toString(36).slice(2, 10);
  }

  function hasModPowers() {
    return state.isHost || state.role === 'cohost';
  }

  function formatTime(seconds) {
    const h = String(Math.floor(seconds / 3600)).padStart(2, '0');
    const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
    const s = String(Math.floor(seconds % 60)).padStart(2, '0');
    return `${h}:${m}:${s}`;
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function showView(name) {
    state.view = name;
    dom.viewLanding.classList.toggle('active', name === 'landing');
    dom.viewDashboard.classList.toggle('active', name === 'dashboard');
    dom.viewMeeting.classList.toggle('active', name === 'meeting');
    dom.viewLogs.classList.toggle('active', name === 'logs');
  }

  // ============================================================
  // CLOCK
  // ============================================================
  function updateClock() {
    const now = new Date();
    const opts = { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true };
    dom.dashClock.textContent = now.toLocaleTimeString('en-US', opts);
  }
  setInterval(updateClock, 1000);
  updateClock();

  // ============================================================
  // THEME MANAGEMENT
  // ============================================================
  function initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);

    const toggleBtns = ['#theme-toggle-landing', '#theme-toggle-dash', '#theme-toggle-meeting'];
    toggleBtns.forEach(id => {
      const btn = document.querySelector(id);
      if (btn) {
        btn.addEventListener('click', () => {
          const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
          const newTheme = currentTheme === 'light' ? 'dark' : 'light';
          document.documentElement.setAttribute('data-theme', newTheme);
          localStorage.setItem('theme', newTheme);
        });
      }
    });
  }

  // ============================================================
  // INIT
  // ============================================================
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

    // Check invite code in URL query params
    const urlParams = new URLSearchParams(window.location.search);
    const inviteRoom = urlParams.get('room');
    if (inviteRoom) {
      dom.landingJoinCode.value = inviteRoom;
    }

    // Connect socket
    state.socket = io();
    bindSocketEvents();

    // Check Auth Session on startup
    try {
      const res = await fetch('/api/auth/session');
      const data = await res.json();
      if (data.user) {
        state.user = data.user;
        state.userName = data.user.username;
        dom.dashUsernameDisplay.textContent = data.user.username;
        showView('dashboard');
        loadUpcoming();
      } else {
        showView('landing');
      }
    } catch (e) {
      showView('landing');
    }
  }

  // ============================================================
  // LANDING PAGE
  // ============================================================
  function bindLanding() {
    // Tabs toggle
    dom.authTabLogin.addEventListener('click', () => {
      dom.authTabLogin.classList.add('active');
      dom.authTabSignup.classList.remove('active');
      dom.formLogin.classList.remove('hidden');
      dom.formRegister.classList.add('hidden');
    });

    dom.authTabSignup.addEventListener('click', () => {
      dom.authTabSignup.classList.add('active');
      dom.authTabLogin.classList.remove('active');
      dom.formRegister.classList.remove('hidden');
      dom.formLogin.classList.add('hidden');
    });

    // Forms submit
    dom.formLogin.addEventListener('submit', async (e) => {
      e.preventDefault();
      dom.loginError.classList.add('hidden');
      const username = dom.loginUsername.value.trim();
      const password = dom.loginPassword.value;

      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (res.ok) {
          state.user = data;
          state.userName = data.username;
          dom.dashUsernameDisplay.textContent = data.username;
          showView('dashboard');
          loadUpcoming();
        } else {
          dom.loginError.textContent = data.error || 'Login failed';
          dom.loginError.classList.remove('hidden');
        }
      } catch (err) {
        dom.loginError.textContent = 'Network error, please try again';
        dom.loginError.classList.remove('hidden');
      }
    });

    dom.formRegister.addEventListener('submit', async (e) => {
      e.preventDefault();
      dom.registerError.classList.add('hidden');
      const username = dom.registerUsername.value.trim();
      const password = dom.registerPassword.value;

      try {
        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (res.ok) {
          state.user = data;
          state.userName = data.username;
          dom.dashUsernameDisplay.textContent = data.username;
          showView('dashboard');
          loadUpcoming();
        } else {
          dom.registerError.textContent = data.error || 'Registration failed';
          dom.registerError.classList.remove('hidden');
        }
      } catch (err) {
        dom.registerError.textContent = 'Network error, please try again';
        dom.registerError.classList.remove('hidden');
      }
    });

    // Guest Join
    dom.btnLandingJoin.addEventListener('click', () => {
      dom.landingJoinError.classList.add('hidden');
      const code = dom.landingJoinCode.value.trim();
      const name = dom.landingJoinName.value.trim();
      if (!code || !name) {
        dom.landingJoinError.textContent = 'Both meeting code and display name are required';
        dom.landingJoinError.classList.remove('hidden');
        return;
      }
      state.userName = name;
      joinMeeting(code);
    });
  }

  // ============================================================
  // DASHBOARD
  // ============================================================
  function bindDashboard() {
    dom.btnNewMeeting.addEventListener('click', startNewMeeting);

    dom.btnJoinMeeting.addEventListener('click', () => {
      dom.modalJoin.classList.remove('hidden');
      dom.joinCodeInput.value = '';
      dom.joinCodeInput.focus();
    });
    dom.joinCancel.addEventListener('click', () => dom.modalJoin.classList.add('hidden'));
    dom.joinConfirm.addEventListener('click', () => {
      const code = dom.joinCodeInput.value.trim();
      if (code) {
        dom.modalJoin.classList.add('hidden');
        joinMeeting(code);
      }
    });
    dom.joinCodeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') dom.joinConfirm.click();
    });

    // Logout
    dom.btnLogout.addEventListener('click', async () => {
      try {
        await fetch('/api/auth/logout', { method: 'POST' });
      } catch (e) { /* ignore */ }
      state.user = null;
      state.userName = '';
      dom.loginUsername.value = '';
      dom.loginPassword.value = '';
      dom.registerUsername.value = '';
      dom.registerPassword.value = '';
      showView('landing');
    });

    // Schedule
    dom.btnSchedule.addEventListener('click', () => {
      dom.modalSchedule.classList.remove('hidden');
      const name = state.userName || 'My';
      dom.schedTitle.value = `${name}'s Session`;
      
      const now = new Date();
      const ms = 1000 * 60 * 30; // nearest 30 mins
      const nearest30 = new Date(Math.ceil(now.getTime() / ms) * ms);
      const tzOffset = nearest30.getTimezoneOffset() * 60000;
      const localISOTime = (new Date(nearest30.getTime() - tzOffset)).toISOString().slice(0, 16);
      dom.schedDatetime.value = localISOTime;
      
      dom.schedDuration.value = '60';
      dom.schedTitle.focus();
    });

    const pills = dom.modalSchedule.querySelectorAll('.preset-pill');
    pills.forEach(pill => {
      pill.addEventListener('click', (e) => {
        e.preventDefault();
        const preset = pill.dataset.preset;
        const now = new Date();
        let targetDate = new Date();
        
        if (preset === 'in15') {
          targetDate = new Date(now.getTime() + 15 * 60 * 1000);
        } else if (preset === 'in30') {
          targetDate = new Date(now.getTime() + 30 * 60 * 1000);
        } else if (preset === 'tomorrow') {
          targetDate = new Date(now.getTime() + 24 * 60 * 60 * 1000);
          const ms = 1000 * 60 * 30;
          targetDate = new Date(Math.ceil(targetDate.getTime() / ms) * ms);
        }
        
        const tzOffset = targetDate.getTimezoneOffset() * 60000;
        const localISOTime = (new Date(targetDate.getTime() - tzOffset)).toISOString().slice(0, 16);
        dom.schedDatetime.value = localISOTime;
      });
    });

    dom.schedCancel.addEventListener('click', () => dom.modalSchedule.classList.add('hidden'));
    dom.schedConfirm.addEventListener('click', scheduleNewMeeting);

    // Session logs
    dom.btnSessionLogs.addEventListener('click', () => {
      showView('logs');
      loadSessionLogs();
    });
    dom.logsBack.addEventListener('click', () => showView('dashboard'));
    dom.btnLogDetailsClose.addEventListener('click', () => dom.modalLogDetails.classList.add('hidden'));
  }

  async function startNewMeeting() {
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

  function updateRoleUI() {
    const hasMod = hasModPowers();
    document.querySelectorAll('.host-only').forEach(el => {
      el.classList.toggle('hidden', !hasMod);
    });
    updateWaitingQueueUI();
  }

  async function joinMeeting(roomId) {
    state.roomId = roomId;
    state.role = state.isHost ? 'host' : 'participant';
    const name = state.userName || 'Participant';
    dom.meetingTitle.textContent = state.sessionData?.title || 'Meeting';
    dom.meetingCodeDisplay.textContent = roomId;
    dom.controlRoomCode.textContent = `Room: ${roomId}`;
    dom.localNameLabel.textContent = name;
    dom.localAvatar.querySelector('.avatar-letter').textContent = name.charAt(0).toUpperCase();

    // Toggle host only UI elements
    updateRoleUI();

    // Reset layout mode to Grid View
    state.layoutMode = 'grid';
    dom.btnLayoutToggle.textContent = 'Layout: Grid';
    dom.videoGrid.classList.remove('hidden');
    dom.speakerViewContainer.classList.add('hidden');

    showView('meeting');
    startTimer();
    await initMedia();
    updateParticipantsList();
    connectToRoom(roomId);
    updateVideoGridCount();
  }

  // ============================================================
  // SCHEDULING
  // ============================================================
  async function scheduleNewMeeting() {
    const title = dom.schedTitle.value.trim() || 'Untitled';
    const scheduledFor = dom.schedDatetime.value;
    const duration = parseInt(dom.schedDuration.value) || 60;
    if (!scheduledFor) return;

    try {
      await fetch('/api/scheduled', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          scheduledFor,
          durationMinutes: duration,
          hostName: state.userName || 'Host'
        })
      });
    } catch (e) { /* offline, that's ok */ }

    dom.modalSchedule.classList.add('hidden');
    loadUpcoming();
  }

  async function loadUpcoming() {
    try {
      const res = await fetch('/api/scheduled');
      const meetings = await res.json();
      renderUpcoming(meetings);
    } catch (e) {
      dom.upcomingList.innerHTML = '<p class="empty-state">No scheduled meetings</p>';
    }
  }

  function renderUpcoming(meetings) {
    if (!meetings.length) {
      dom.upcomingList.innerHTML = '<p class="empty-state">No scheduled meetings</p>';
      return;
    }
    dom.upcomingList.innerHTML = meetings.map(m => {
      const dt = new Date(m.scheduled_for);
      const dateStr = dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const timeStr = dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      return `
        <div class="upcoming-item">
          <div class="upcoming-item-info">
            <span class="upcoming-item-title">${escapeHtml(m.title)}</span>
            <span class="upcoming-item-time">${dateStr} at ${timeStr} · ${m.duration_minutes}min</span>
          </div>
          <div class="upcoming-item-actions">
            <button class="btn btn-primary" onclick="window._apex.joinMeeting('${m.id}')">Start</button>
            <button class="btn btn-ghost" onclick="window._apex.deleteScheduled('${m.id}')">✕</button>
          </div>
        </div>`;
    }).join('');
  }

  async function deleteScheduled(id) {
    try { await fetch(`/api/scheduled/${id}`, { method: 'DELETE' }); } catch (e) { /* ok */ }
    loadUpcoming();
  }

  // ============================================================
  // SESSION LOGS
  // ============================================================
  async function loadSessionLogs() {
    try {
      const res = await fetch('/api/sessions');
      const sessions = await res.json();
      renderSessionLogs(sessions);
    } catch (e) {
      dom.logsList.innerHTML = '<p class="empty-state">No session history</p>';
    }
  }

  function renderSessionLogs(sessions) {
    if (!sessions.length) {
      dom.logsList.innerHTML = '<p class="empty-state">No session history</p>';
      return;
    }
    dom.logsList.innerHTML = sessions.map(s => {
      const start = s.started_at ? new Date(s.started_at + 'Z').toLocaleString() : '—';
      const ended = s.ended_at ? new Date(s.ended_at + 'Z').toLocaleString() : (s.is_active ? 'Active' : '—');
      return `
        <div class="log-item">
          <div class="log-info">
            <span class="log-title">${escapeHtml(s.title)} (${s.id})</span>
            <span class="log-meta">Host: ${escapeHtml(s.host_name)} · ${start} → ${ended}</span>
          </div>
          <div class="log-actions">
            <button class="btn btn-ghost" onclick="window._apex.viewSessionDetails('${s.id}')">Details</button>
            <button class="btn btn-ghost" onclick="window._apex.exportSession('${s.id}', 'csv')">CSV</button>
            <button class="btn btn-ghost" onclick="window._apex.exportSession('${s.id}', 'json')">JSON</button>
          </div>
        </div>`;
    }).join('');
  }

  function exportSession(id, format) {
    window.open(`/api/sessions/${id}/export/${format}`, '_blank');
  }

  async function viewSessionDetails(sessionId) {
    try {
      const res = await fetch(`/api/sessions/${sessionId}/attendance`);
      if (!res.ok) throw new Error();
      const attendance = await res.json();
      
      dom.logDetailsTbody.innerHTML = attendance.map(a => {
        const joined = a.joined_at ? new Date(a.joined_at).toLocaleTimeString() : '—';
        const left = a.left_at ? new Date(a.left_at).toLocaleTimeString() : 'Active';
        const duration = a.duration_seconds ? formatTime(a.duration_seconds) : '—';
        return `
          <tr style="border-bottom: 1px solid var(--border-subtle);">
            <td style="padding: var(--sp-2) var(--sp-3); border-right: 1px solid var(--border-subtle);">${escapeHtml(a.display_name)}</td>
            <td style="padding: var(--sp-2) var(--sp-3); border-right: 1px solid var(--border-subtle);">${escapeHtml(a.role)}</td>
            <td style="padding: var(--sp-2) var(--sp-3); border-right: 1px solid var(--border-subtle);">${joined}</td>
            <td style="padding: var(--sp-2) var(--sp-3); border-right: 1px solid var(--border-subtle);">${left}</td>
            <td style="padding: var(--sp-2) var(--sp-3);">${duration}</td>
          </tr>
        `;
      }).join('');
      
      if (!attendance.length) {
        dom.logDetailsTbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: var(--sp-4); color: var(--text-secondary);">No attendance recorded</td></tr>`;
      }
      
      dom.modalLogDetails.classList.remove('hidden');
    } catch (e) {
      alert('Failed to load session details');
    }
  }

  // ============================================================
  // MEDIA
  // ============================================================
  async function initMedia() {
    try {
      const rawStream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720, facingMode: 'user' },
        audio: true
      });
      state.localStream = initNoiseSuppression(rawStream);
      dom.localVideo.srcObject = state.localStream;
      dom.localVideo.style.filter = getCSSFilter(state.videoFilter);
      dom.localAvatar.classList.add('hidden');
      state.micEnabled = true;
      state.camEnabled = true;
      startLocalAudioAnalysis();
    } catch (err) {
      console.warn('Media access failed, running in chat-only mode:', err.message);
      // Progressive enhancement: fall back to chat + whiteboard only
      dom.localVideo.style.display = 'none';
      dom.localAvatar.classList.remove('hidden');
      state.micEnabled = false;
      state.camEnabled = false;
      dom.btnMic.classList.add('muted');
      dom.btnCam.classList.add('muted');
    }
  }

  function startLocalAudioAnalysis() {
    if (!state.localStream) return;
    const audioTracks = state.localStream.getAudioTracks();
    if (!audioTracks.length) return;

    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(state.localStream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);

    function check() {
      analyser.getByteFrequencyData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i];
      const avg = sum / data.length;
      const speaking = avg > 15 && state.micEnabled;
      dom.localTile.classList.toggle('speaking', speaking);
      requestAnimationFrame(check);
    }
    check();
  }

  // ============================================================
  // TIMER
  // ============================================================
  function startTimer() {
    state.meetingStartTime = Date.now();
    clearInterval(state.timerInterval);
    state.timerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - state.meetingStartTime) / 1000);
      dom.meetingTimer.textContent = formatTime(elapsed);
    }, 1000);
  }

  function stopTimer() {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }

  // ============================================================
  // SOCKET CONNECTION
  // ============================================================
  function connectToRoom(roomId) {
    const name = state.userName || 'Participant';
    state.socket.emit('join-room', {
      roomId,
      participantId: state.participantId,
      displayName: name,
      role: state.isHost ? 'host' : 'participant',
      videoFilter: state.videoFilter
    });
  }

  function bindSocketEvents() {
    const s = state.socket;

    s.on('room-participants', (participants) => {
      participants.forEach(p => {
        addRemotePeer(p.socketId, p);
      });
      updateParticipantsList();
      updateVideoGridCount();
    });

    s.on('participant-joined', (data) => {
      addRemotePeer(data.socketId, data);
      updateParticipantsList();
      updateVideoGridCount();
      // Initiate WebRTC offer to new peer
      if (state.localStream) {
        createOffer(data.socketId);
      }
    });

    s.on('participant-left', (data) => {
      removeRemotePeer(data.socketId);
      updateParticipantsList();
      updateVideoGridCount();
    });

    // WebRTC signaling
    s.on('signal-offer', async ({ fromSocketId, offer }) => {
      await handleOffer(fromSocketId, offer);
    });

    s.on('signal-answer', async ({ fromSocketId, answer }) => {
      const peer = state.peers.get(fromSocketId);
      if (peer && peer.pc) {
        await peer.pc.setRemoteDescription(new RTCSessionDescription(answer));
      }
    });

    s.on('signal-candidate', async ({ fromSocketId, candidate }) => {
      const peer = state.peers.get(fromSocketId);
      if (peer && peer.pc) {
        try { await peer.pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch (e) { /* ok */ }
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
      if (currentSpotlightId === socketId) {
        const activeVideo = dom.spotlightArea.querySelector('video');
        if (activeVideo) activeVideo.style.filter = getCSSFilter(filter);
      }
    });

    // Slide Share & Control events
    s.on('slide-share-started', ({ presenterSocketId, slideIndex }) => {
      state.isSharingSlides = true;
      state.slidePresenterSocketId = presenterSocketId;
      state.currentSlideIndex = slideIndex;
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

  // ============================================================
  // WEBRTC PEER CONNECTIONS
  // ============================================================
  const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

  function addRemotePeer(socketId, info) {
    if (state.peers.has(socketId)) return;
    state.peers.set(socketId, { pc: null, stream: null, info });
    createRemoteTile(socketId, info);
  }

  function removeRemotePeer(socketId) {
    const peer = state.peers.get(socketId);
    if (peer) {
      if (peer.pc) peer.pc.close();
      state.peers.delete(socketId);
    }
    const tile = document.querySelector(`.video-tile[data-socket="${socketId}"]`);
    if (tile) tile.remove();
  }

  function createRemoteTile(socketId, info) {
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

  async function createOffer(targetSocketId) {
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

  async function handleOffer(fromSocketId, offer) {
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

  // ============================================================
  // MEETING CONTROLS
  // ============================================================
  function bindMeetingControls() {
    dom.btnMic.addEventListener('click', toggleMic);
    dom.btnCam.addEventListener('click', toggleCam);
    dom.btnScreen.addEventListener('click', toggleScreenShare);
    dom.btnRecord.addEventListener('click', toggleRecording);
    dom.btnLeave.addEventListener('click', leaveMeeting);
    dom.btnSpawnBots.addEventListener('click', spawnSandboxBots);

    dom.btnChatToggle.addEventListener('click', () => togglePanel('chat'));
    dom.btnParticipantsToggle.addEventListener('click', () => togglePanel('participants'));
    dom.btnWhiteboardToggle.addEventListener('click', toggleWhiteboard);

    dom.panelClose.addEventListener('click', () => {
      state.panelOpen = false;
      dom.sidePanel.classList.add('hidden');
      dom.btnChatToggle.classList.remove('active');
      dom.btnParticipantsToggle.classList.remove('active');
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

    // Panel tabs
    dom.panelTabs.forEach(tab => {
      tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    // Copy meeting code on click
    dom.meetingCodeDisplay.addEventListener('click', () => {
      navigator.clipboard.writeText(state.roomId).catch(() => {});
      dom.meetingCodeDisplay.textContent = 'Copied!';
      setTimeout(() => {
        dom.meetingCodeDisplay.textContent = state.roomId;
      }, 1200);
    });
  }

  function toggleMic() {
    if (!state.localStream) return;
    state.micEnabled = !state.micEnabled;
    state.localStream.getAudioTracks().forEach(t => t.enabled = state.micEnabled);
    dom.btnMic.classList.toggle('muted', !state.micEnabled);
  }

  function toggleCam() {
    if (!state.localStream) return;
    state.camEnabled = !state.camEnabled;
    state.localStream.getVideoTracks().forEach(t => t.enabled = state.camEnabled);
    dom.btnCam.classList.toggle('muted', !state.camEnabled);
    dom.localAvatar.classList.toggle('hidden', state.camEnabled);
  }

  async function toggleScreenShare() {
    if (state.isSharingScreen) {
      // Stop sharing
      if (state.screenStream) {
        state.screenStream.getTracks().forEach(t => t.stop());
        state.screenStream = null;
      }
      
      // Restore camera track in peer connections for others
      state.peers.forEach((peer) => {
        if (peer.pc && state.localStream) {
          const sender = peer.pc.getSenders().find(s => s.track?.kind === 'video');
          const cameraTrack = state.localStream.getVideoTracks()[0];
          if (sender && cameraTrack) {
            sender.replaceTrack(cameraTrack);
          }
        }
      });

      dom.localTile.classList.remove('screen-sharing');
      state.isSharingScreen = false;
      dom.btnScreen.classList.remove('active');
      
      if (state.socket) {
        state.socket.emit('screenshare-stop', { roomId: state.roomId });
      }
      onScreenShareActive(false);
    } else {
      try {
        state.screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        
        // Show indicator on local tile but keep local video showing camera feed to prevent "hall of mirrors"
        dom.localTile.classList.add('screen-sharing');
        
        state.isSharingScreen = true;
        dom.btnScreen.classList.add('active');

        // Auto-stop when user clicks browser's "Stop Sharing"
        state.screenStream.getVideoTracks()[0].onended = () => {
          toggleScreenShare();
        };

        // Replace tracks in peer connections with screen share track
        state.peers.forEach((peer) => {
          if (peer.pc) {
            const sender = peer.pc.getSenders().find(s => s.track?.kind === 'video');
            if (sender && state.screenStream.getVideoTracks()[0]) {
              sender.replaceTrack(state.screenStream.getVideoTracks()[0]);
            }
          }
        });

        if (state.socket) {
          state.socket.emit('screenshare-start', { roomId: state.roomId });
        }
        onScreenShareActive(true, state.socket.id);
      } catch (err) {
        console.warn('Screen share cancelled or failed:', err.message);
        dom.localTile.classList.remove('screen-sharing');
        state.isSharingScreen = false;
        dom.btnScreen.classList.remove('active');
      }
    }
  }

  function toggleRecording() {
    if (state.isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  }

  function startRecording() {
    const stream = dom.localVideo.srcObject;
    if (!stream) return;

    // Capture composite: video + audio
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
  }

  function stopRecording() {
    if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
      state.mediaRecorder.stop();
    }
    state.isRecording = false;
    dom.btnRecord.classList.remove('recording');
  }

  function toggleHandRaise() {
    state.handRaised = !state.handRaised;
    dom.btnHand.classList.toggle('active', state.handRaised);

    // Show/hide on local tile
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

  function handleRemoteHandRaise(participantId, raised) {
    const tile = document.querySelector(`.video-tile[data-participant="${participantId}"]`);
    if (!tile) return;
    let badge = tile.querySelector('.tile-hand-badge');
    if (raised) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'tile-hand-badge';
        badge.textContent = '✋';
        tile.appendChild(badge);
      }
    } else {
      if (badge) badge.remove();
    }
  }

  async function leaveMeeting() {
    // Stop all media
    if (state.localStream) {
      state.localStream.getTracks().forEach(t => t.stop());
      state.localStream = null;
    }
    if (state.screenStream) {
      state.screenStream.getTracks().forEach(t => t.stop());
      state.screenStream = null;
    }

    // Stop recording
    if (state.isRecording) stopRecording();

    // Close peers
    state.peers.forEach((peer, sid) => {
      if (peer.pc) peer.pc.close();
    });
    state.peers.clear();

    // Disconnect from room
    state.socket.emit('leave-room', { roomId: state.roomId });

    // End session in DB
    if (state.roomId) {
      try { await fetch(`/api/sessions/${state.roomId}/end`, { method: 'POST' }); } catch (e) { /* ok */ }
    }

    // Clear bots
    clearSandboxBots();

    // Stop timer
    stopTimer();

    // Clean up video grid
    const remoteTiles = dom.videoGrid.querySelectorAll('.video-tile:not(.local-tile)');
    remoteTiles.forEach(t => t.remove());

    // Reset panel
    state.panelOpen = false;
    dom.sidePanel.classList.add('hidden');
    dom.wbOverlay.classList.add('hidden');
    dom.btnWhiteboardToggle.classList.remove('active');

    // Reset UI states
    dom.btnMic.classList.remove('muted');
    dom.btnCam.classList.remove('muted');
    dom.btnScreen.classList.remove('active');
    dom.btnRecord.classList.remove('recording');
    dom.btnHand.classList.remove('active');
    dom.chatMessages.innerHTML = '';
    state.chatUnread = 0;
    dom.chatBadge.classList.add('hidden');
    state.handRaised = false;
    const handBadge = dom.localTile.querySelector('.tile-hand-badge');
    if (handBadge) handBadge.remove();

    // Clear whiteboard
    clearWhiteboard(false);

    // Show dashboard
    state.roomId = null;
    state.sessionData = null;
    showView('dashboard');
    loadUpcoming();
  }

  // ============================================================
  // SIDE PANEL
  // ============================================================
  function togglePanel(tab) {
    if (state.panelOpen && state.activeTab === tab) {
      state.panelOpen = false;
      dom.sidePanel.classList.add('hidden');
      dom.btnChatToggle.classList.remove('active');
      dom.btnParticipantsToggle.classList.remove('active');
    } else {
      state.panelOpen = true;
      dom.sidePanel.classList.remove('hidden');
      switchTab(tab);
    }
  }

  function switchTab(tab) {
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

  function toggleWhiteboard() {
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

  function updateParticipantsList() {
    // 1. Gather all participants into a clean unified array
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
        const audioTrack = peer.stream.getAudioTracks()[0];
        if (audioTrack && audioTrack.enabled) {
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

    // 2. Sort by chronological hand raise queue first, then role, then display name
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

    // 3. Build HTML items and recipient options list
    const currentRecipient = dom.chatRecipient ? dom.chatRecipient.value : 'everyone';
    const recipientOptions = [];

    const isUserHost = state.isHost || state.role === 'cohost';
    const chatPerms = state.chatPermissions;

    // Allow Everyone (public) option if permitted
    const allowPublic = isUserHost || (chatPerms !== 'none' && chatPerms !== 'host-only');
    if (allowPublic) {
      recipientOptions.push(`<option value="everyone">Everyone</option>`);
    }

    const items = allParticipants.map(p => {
      const qIdx = state.handRaiseQueue.findIndex(item => item.participantId === p.participantId || item.socketId === p.socketId);
      const handBadge = qIdx !== -1 ? `<span class="participant-hand" style="color: var(--accent-cyan); font-weight: bold; margin-left: var(--sp-2);">✋ ${qIdx + 1}</span>` : '';
      const localSuffix = p.isLocal ? ' (You)' : '';

      // Populate DM option if allowed
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

      // Generate Host controls
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

    // Restore chat recipient select value
    if (dom.chatRecipient) {
      dom.chatRecipient.innerHTML = recipientOptions.join('');
      dom.chatRecipient.value = currentRecipient;
      if (!dom.chatRecipient.value) dom.chatRecipient.value = 'everyone';
    }

    updateHandIconsOnTiles();
  }

  function updateVideoGridCount() {
    const tiles = dom.videoGrid.querySelectorAll('.video-tile');
    const count = Math.min(tiles.length, 12);
    dom.videoGrid.dataset.count = count;
  }

  // ============================================================
  // CHAT
  // ============================================================
  function bindChat() {
    dom.btnSendChat.addEventListener('click', sendChat);
    dom.chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChat();
      }
    });
  }

  function sendChat() {
    const msg = dom.chatInput.value.trim();
    if (!msg || !state.roomId) return;
    dom.chatInput.value = '';

    const recipientId = dom.chatRecipient ? dom.chatRecipient.value : 'everyone';

    if (recipientId === 'everyone') {
      // Send public message
      state.socket.emit('chat-message', {
        roomId: state.breakoutRoomId || state.roomId,
        senderId: state.participantId,
        senderName: state.userName || 'You',
        message: msg
      });
    } else if (recipientId.startsWith('bot-')) {
      // Send private message to local bot
      const bot = state.bots.find(b => b.id === recipientId);
      if (bot) {
        // Render the message sent by us locally
        appendChatMessage(state.userName || 'You', msg, true, new Date().toISOString(), true, bot.name);
        
        // Simulate bot reply in 1-1.5 seconds
        setTimeout(() => {
          if (!state.bots.find(b => b.id === bot.id)) return;
          const replies = [
            "Hi! That's interesting, let me think.",
            "Understood, thanks for the private message.",
            "I'm on it! Let me check that.",
            "Thanks for the tip!",
            "Great, let's keep working on it."
          ];
          const reply = replies[Math.floor(Math.random() * replies.length)];
          appendChatMessage(bot.name, reply, false, new Date().toISOString(), true, 'You');
          
          if (state.activeTab !== 'chat' || !state.panelOpen) {
            state.chatUnread++;
            dom.chatBadge.textContent = state.chatUnread;
            dom.chatBadge.classList.remove('hidden');
          }
        }, 1000 + Math.random() * 500);
      }
    } else {
      // Send private message to real participant
      const peer = state.peers.get(recipientId);
      const recipientName = peer ? peer.info.displayName : 'Participant';
      state.socket.emit('chat-message', {
        roomId: state.breakoutRoomId || state.roomId,
        senderId: state.participantId,
        senderName: state.userName || 'You',
        message: msg,
        targetSocketId: recipientId,
        recipientName: recipientName
      });
    }
  }

  function appendChatMessage(name, text, isSelf, timestamp, isPrivate = false, recipientName = null) {
    const div = document.createElement('div');
    
    let classes = ['chat-msg'];
    if (isSelf) classes.push('self');
    if (isPrivate) classes.push('private');
    div.className = classes.join(' ');

    const time = timestamp ? new Date(timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '';
    
    let nameLabel = escapeHtml(name);
    if (isPrivate) {
      if (isSelf) {
        nameLabel = `To ${escapeHtml(recipientName)} (Private)`;
      } else {
        nameLabel = `${escapeHtml(name)} (Private)`;
      }
    }

    let contentHtml = '';
    try {
      if (text.startsWith('{"type":"file"')) {
        const fileObj = JSON.parse(text);
        const fileId = 'file-' + genId();
        
        if (!window._apexFiles) window._apexFiles = {};
        window._apexFiles[fileId] = fileObj;
        
        contentHtml = `
          <div class="chat-msg-name" style="${isPrivate ? 'color: var(--accent-lavender);' : ''}">${nameLabel}</div>
          <div class="chat-file-card">
            <span class="chat-file-icon">📄</span>
            <div class="chat-file-info">
              <span class="chat-file-name" title="${escapeHtml(fileObj.fileName)}">${escapeHtml(fileObj.fileName)}</span>
              <span class="chat-file-size">${escapeHtml(fileObj.fileSize)}</span>
            </div>
            <button class="btn-download-file" onclick="window._apex.downloadFile('${fileId}')" title="Download file">
              📥
            </button>
          </div>
          <div class="chat-msg-time">${time}</div>
        `;
      }
    } catch(e) {
      // Ignore
    }

    if (!contentHtml) {
      contentHtml = `
        <div class="chat-msg-name" style="${isPrivate ? 'color: var(--accent-lavender);' : ''}">${nameLabel}</div>
        <div class="chat-msg-text">${escapeHtml(text)}</div>
        <div class="chat-msg-time">${time}</div>
      `;
    }

    div.innerHTML = contentHtml;
    dom.chatMessages.appendChild(div);
    dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
  }

  // ============================================================
  // WHITEBOARD
  // ============================================================
  function bindWhiteboard() {
    const canvas = dom.wbCanvas;
    const ctx = canvas.getContext('2d');

    dom.wbTools.forEach(btn => {
      btn.addEventListener('click', () => {
        const tool = btn.dataset.tool;
        if (tool === 'clear') {
          clearWhiteboard(true);
          return;
        }
        state.wbTool = tool;
        dom.wbTools.forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
      });
    });

    dom.wbColor.addEventListener('input', (e) => {
      state.wbColor = e.target.value;
    });

    canvas.addEventListener('pointerdown', (e) => {
      state.wbDrawing = true;
      const rect = canvas.getBoundingClientRect();
      state.wbLastX = (e.clientX - rect.left) * (canvas.width / rect.width);
      state.wbLastY = (e.clientY - rect.top) * (canvas.height / rect.height);
      state.wbCurrentPath = {
        tool: state.wbTool,
        color: state.wbColor,
        points: [{ x: state.wbLastX, y: state.wbLastY }],
        startX: state.wbLastX,
        startY: state.wbLastY
      };
    });

    canvas.addEventListener('pointermove', (e) => {
      if (!state.wbDrawing) return;
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) * (canvas.width / rect.width);
      const y = (e.clientY - rect.top) * (canvas.height / rect.height);

      if (state.wbTool === 'pen') {
        ctx.strokeStyle = state.wbColor;
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(state.wbLastX, state.wbLastY);
        ctx.lineTo(x, y);
        ctx.stroke();
      }

      state.wbLastX = x;
      state.wbLastY = y;
      if (state.wbCurrentPath) {
        state.wbCurrentPath.points.push({ x, y });
      }
    });

    canvas.addEventListener('pointerup', (e) => {
      if (!state.wbDrawing) return;
      state.wbDrawing = false;
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) * (canvas.width / rect.width);
      const y = (e.clientY - rect.top) * (canvas.height / rect.height);

      const path = state.wbCurrentPath;
      if (!path) return;
      path.endX = x;
      path.endY = y;

      // Draw shapes
      if (path.tool === 'line') {
        ctx.strokeStyle = path.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(path.startX, path.startY);
        ctx.lineTo(x, y);
        ctx.stroke();
      } else if (path.tool === 'rect') {
        ctx.strokeStyle = path.color;
        ctx.lineWidth = 2;
        ctx.strokeRect(path.startX, path.startY, x - path.startX, y - path.startY);
      } else if (path.tool === 'circle') {
        const rx = Math.abs(x - path.startX) / 2;
        const ry = Math.abs(y - path.startY) / 2;
        const cx = path.startX + (x - path.startX) / 2;
        const cy = path.startY + (y - path.startY) / 2;
        ctx.strokeStyle = path.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Broadcast
      state.wbPaths.push(path);
      if (state.roomId) {
        state.socket.emit('whiteboard-draw', { roomId: state.roomId, path });
      }
      state.wbCurrentPath = null;
    });

    window.addEventListener('resize', () => {
      if (!dom.wbOverlay.classList.contains('hidden')) {
        resizeWhiteboard();
      }
    });
  }

  function drawRemotePath(path) {
    const ctx = dom.wbCanvas.getContext('2d');
    ctx.strokeStyle = path.color;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';

    if (path.tool === 'pen' && path.points.length > 1) {
      ctx.beginPath();
      ctx.moveTo(path.points[0].x, path.points[0].y);
      for (let i = 1; i < path.points.length; i++) {
        ctx.lineTo(path.points[i].x, path.points[i].y);
      }
      ctx.stroke();
    } else if (path.tool === 'line') {
      ctx.beginPath();
      ctx.moveTo(path.startX, path.startY);
      ctx.lineTo(path.endX, path.endY);
      ctx.stroke();
    } else if (path.tool === 'rect') {
      ctx.strokeRect(path.startX, path.startY, path.endX - path.startX, path.endY - path.startY);
    } else if (path.tool === 'circle') {
      const rx = Math.abs(path.endX - path.startX) / 2;
      const ry = Math.abs(path.endY - path.startY) / 2;
      const cx = path.startX + (path.endX - path.startX) / 2;
      const cy = path.startY + (path.endY - path.startY) / 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    state.wbPaths.push(path);
  }

  function clearWhiteboard(broadcast) {
    const ctx = dom.wbCanvas.getContext('2d');
    ctx.clearRect(0, 0, dom.wbCanvas.width, dom.wbCanvas.height);
    state.wbPaths = [];
    if (broadcast && state.roomId) {
      state.socket.emit('whiteboard-clear', { roomId: state.roomId });
    }
  }

  function resizeWhiteboard() {
    const container = dom.wbCanvas.parentElement;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    // Keep canvas at reasonable resolution
    dom.wbCanvas.width = Math.max(rect.width, 400);
    dom.wbCanvas.height = Math.max(rect.height - 45, 300);
    // Redraw existing paths
    redrawWhiteboard();
  }

  function redrawWhiteboard() {
    const ctx = dom.wbCanvas.getContext('2d');
    ctx.clearRect(0, 0, dom.wbCanvas.width, dom.wbCanvas.height);
    state.wbPaths.forEach(path => drawRemotePath(path));
  }

  // ============================================================
  // REACTIONS
  // ============================================================
  function bindReactions() {
    dom.reactionBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const emoji = btn.dataset.emoji;
        // Spawn locally immediately for instant visual response
        spawnFloatingReaction(emoji);
        
        state.socket.emit('reaction', {
          roomId: state.roomId,
          emoji,
          senderName: state.userName || 'You'
        });
        dom.reactionsPicker.classList.add('hidden');
        state.reactionsOpen = false;
      });
    });

    // Close picker if clicking outside
    document.addEventListener('click', (e) => {
      if (state.reactionsOpen && !dom.reactionsPicker.contains(e.target) && !dom.btnReactions.contains(e.target)) {
        dom.reactionsPicker.classList.add('hidden');
        state.reactionsOpen = false;
      }
    });
  }

  function spawnFloatingReaction(emoji) {
    const el = document.createElement('div');
    el.className = 'floating-reaction';
    el.textContent = emoji;
    el.style.left = (20 + Math.random() * 60) + '%';
    el.style.bottom = '0';
    dom.reactionsLayer.appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }

  // ============================================================
  // SANDBOX MODE (Simulated Participants)
  // ============================================================
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

  function spawnSandboxBots() {
    if (state.bots.length >= 12) return;

    const count = Math.min(4, 12 - state.bots.length);
    for (let i = 0; i < count; i++) {
      const nameIdx = state.bots.length % BOT_NAMES.length;
      const bot = {
        id: 'bot-' + genId(),
        name: BOT_NAMES[nameIdx],
        speaking: false
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

    // Audio level bars for visual effect
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

  function startBotActivity() {
    // Clear existing intervals
    state.botIntervals.forEach(id => clearInterval(id));
    state.botIntervals = [];

    // Random speaking simulation
    const speakInterval = setInterval(() => {
      if (state.bots.length === 0) return;
      const bot = state.bots[Math.floor(Math.random() * state.bots.length)];
      if (bot.muted) return;
      const tile = document.querySelector(`.video-tile[data-participant="${bot.id}"]`);
      if (!tile) return;

      tile.classList.add('speaking');
      // Animate audio bars
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

    // Random chat messages
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

    // Random whiteboard drawing
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

  function clearSandboxBots() {
    state.botIntervals.forEach(id => clearInterval(id));
    state.botIntervals = [];
    state.bots.forEach(bot => {
      const tile = document.querySelector(`.video-tile[data-participant="${bot.id}"]`);
      if (tile) tile.remove();
    });
    state.bots = [];
  }

  // ============================================================
  // NEW IN-MEETING FEATURES IMPLEMENTATION
  // ============================================================

  function bindNewInMeetingFeatures() {
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
  }

  // Settings & Media Device Switching
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

      // Pre-select active device IDs
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

      // Load Presenter Overlay values
      dom.settingsPresenterOverlay.checked = state.presenterOverlayEnabled;
      dom.settingsOverlayType.value = state.presenterOverlayType;
      dom.settingsChromaColor.value = state.presenterChromaColor;
      dom.settingsChromaTolerance.value = state.presenterChromaTolerance;

      // Update options visibility
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

  async function changeCameraDevice() {
    const deviceId = dom.settingsCamera.value;
    if (!deviceId || deviceId === state.selectedCameraId) return;

    try {
      const constraints = {
        video: { deviceId: { exact: deviceId }, width: 1280, height: 720 },
        audio: state.selectedMicId ? { deviceId: { exact: state.selectedMicId } } : true
      };
      const newStream = await navigator.mediaDevices.getUserMedia(constraints);
      const newVideoTrack = newStream.getVideoTracks()[0];
      const oldVideoTrack = state.localStream ? state.localStream.getVideoTracks()[0] : null;

      if (state.localStream) {
        if (oldVideoTrack) {
          state.localStream.removeTrack(oldVideoTrack);
          oldVideoTrack.stop();
        }
        state.localStream.addTrack(newVideoTrack);
      } else {
        state.localStream = newStream;
      }

      dom.localVideo.srcObject = state.localStream;
      state.selectedCameraId = deviceId;
      state.camEnabled = true;
      dom.btnCam.classList.remove('muted');
      dom.localAvatar.classList.add('hidden');

      // Update track on all peer connections
      state.peers.forEach(peer => {
        if (peer.pc) {
          const sender = peer.pc.getSenders().find(s => s.track?.kind === 'video');
          if (sender) {
            sender.replaceTrack(newVideoTrack);
          }
        }
      });
    } catch (e) {
      console.error('Failed to switch camera:', e.message);
      alert('Could not switch to selected camera.');
    }
  }

  async function changeMicDevice() {
    const deviceId = dom.settingsMic.value;
    if (!deviceId || deviceId === state.selectedMicId) return;

    try {
      const constraints = {
        video: state.selectedCameraId ? { deviceId: { exact: state.selectedCameraId }, width: 1280, height: 720 } : true,
        audio: { deviceId: { exact: deviceId } }
      };
      const newStream = await navigator.mediaDevices.getUserMedia(constraints);
      const newAudioTrack = newStream.getAudioTracks()[0];
      newAudioTrack.enabled = state.micEnabled;
      const oldAudioTrack = state.localStream ? state.localStream.getAudioTracks()[0] : null;

      if (state.localStream) {
        if (oldAudioTrack) {
          state.localStream.removeTrack(oldAudioTrack);
          oldAudioTrack.stop();
        }
        state.localStream.addTrack(newAudioTrack);
      } else {
        state.localStream = newStream;
      }

      state.selectedMicId = deviceId;

      // Update track on all peer connections
      state.peers.forEach(peer => {
        if (peer.pc) {
          const sender = peer.pc.getSenders().find(s => s.track?.kind === 'audio');
          if (sender) {
            sender.replaceTrack(newAudioTrack);
          }
        }
      });
    } catch (e) {
      console.error('Failed to switch microphone:', e.message);
      alert('Could not switch to selected microphone.');
    }
  }

  async function changeSpeakerDevice() {
    const deviceId = dom.settingsSpeaker.value;
    if (!deviceId || deviceId === state.selectedSpeakerId) return;

    state.selectedSpeakerId = deviceId;
    if (typeof dom.localVideo.setSinkId === 'function') {
      dom.localVideo.setSinkId(deviceId).catch(err => console.warn('setSinkId failed for local video:', err));
      const videos = document.querySelectorAll('.video-tile video');
      videos.forEach(v => {
        v.setSinkId(deviceId).catch(err => console.warn('setSinkId failed for remote video tile:', err));
      });
    } else {
      console.warn('Speaker switching (setSinkId) is not supported in this browser.');
    }
  }

  // Security Toggles
  function toggleWaitingRoomHost() {
    const enabled = !state.isWaitingRoomEnabled;
    state.socket.emit('toggle-waiting-room', { roomId: state.roomId, enabled });
  }

  function toggleLockMeetingHost() {
    const locked = !state.isRoomLocked;
    state.socket.emit('lock-room', { roomId: state.roomId, locked });
  }

  function cancelWaitingRoom() {
    dom.waitingRoomOverlay.classList.add('hidden');
    state.isWaitingToJoin = false;
    leaveMeeting();
  }

  // Waiting queue admit/decline methods
  function admitParticipant(socketId) {
    state.socket.emit('waiting-admit', { roomId: state.roomId, targetSocketId: socketId });
  }

  function declineParticipant(socketId) {
    state.socket.emit('waiting-decline', { roomId: state.roomId, targetSocketId: socketId });
  }

  function updateWaitingQueueUI() {
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

  // --- Screen Annotations ---
  let annotationDrawing = false;
  let annotationLastX = 0;
  let annotationLastY = 0;

  function initAnnotationCanvas() {
    const canvas = dom.annotationCanvas;
    if (!canvas) return;

    canvas.width = 1280;
    canvas.height = 720;

    canvas.addEventListener('mousedown', startAnnotatingDraw);
    canvas.addEventListener('mousemove', drawAnnotating);
    canvas.addEventListener('mouseup', stopAnnotatingDraw);
    canvas.addEventListener('mouseout', stopAnnotatingDraw);

    canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        const touch = e.touches[0];
        const rect = canvas.getBoundingClientRect();
        annotationLastX = ((touch.clientX - rect.left) / rect.width) * 1280;
        annotationLastY = ((touch.clientY - rect.top) / rect.height) * 720;
        annotationDrawing = true;
      }
    });

    canvas.addEventListener('touchmove', (e) => {
      if (annotationDrawing && e.touches.length === 1) {
        const touch = e.touches[0];
        const rect = canvas.getBoundingClientRect();
        const x = ((touch.clientX - rect.left) / rect.width) * 1280;
        const y = ((touch.clientY - rect.top) / rect.height) * 720;
        drawStroke(annotationLastX, annotationLastY, x, y, state.annotationColor, state.annotationWidth, state.annotationTool === 'eraser', true);
        annotationLastX = x;
        annotationLastY = y;
      }
    });

    canvas.addEventListener('touchend', stopAnnotatingDraw);
  }

  function startAnnotatingDraw(e) {
    const canvas = dom.annotationCanvas;
    const rect = canvas.getBoundingClientRect();
    annotationLastX = ((e.clientX - rect.left) / rect.width) * 1280;
    annotationLastY = ((e.clientY - rect.top) / rect.height) * 720;
    annotationDrawing = true;
  }

  function drawAnnotating(e) {
    if (!annotationDrawing) return;
    const canvas = dom.annotationCanvas;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 1280;
    const y = ((e.clientY - rect.top) / rect.height) * 720;
    drawStroke(annotationLastX, annotationLastY, x, y, state.annotationColor, state.annotationWidth, state.annotationTool === 'eraser', true);
    annotationLastX = x;
    annotationLastY = y;
  }

  function stopAnnotatingDraw() {
    annotationDrawing = false;
  }

  function drawStroke(x1, y1, x2, y2, color, width, isEraser, emit = false) {
    const canvas = dom.annotationCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (isEraser) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = color;
    }
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';

    if (emit && state.socket) {
      state.socket.emit('annotation-draw', {
        roomId: state.roomId,
        path: { x1, y1, x2, y2, color, width, isEraser }
      });
    }
  }

  function onScreenShareActive(active, presenterSocketId) {
    state.screenSharingActive = active;
    dom.btnAnnotateToggle.classList.toggle('hidden', !active);
    
    if (active) {
      if (state.layoutMode !== 'speaker') {
        toggleLayoutMode();
      }
      if (presenterSocketId) {
        currentSpotlightId = presenterSocketId;
        updateSpeakerViewLayout();
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

  function toggleAnnotationMode() {
    state.isAnnotating = !state.isAnnotating;
    dom.btnAnnotateToggle.classList.toggle('active', state.isAnnotating);
    dom.annotationToolbar.classList.toggle('hidden', !state.isAnnotating);

    const canvas = dom.annotationCanvas;
    canvas.classList.toggle('hidden', !state.isAnnotating && !state.screenSharingActive);
    canvas.style.pointerEvents = state.isAnnotating ? 'auto' : 'none';

    if (state.isAnnotating) {
      canvas.width = 1280;
      canvas.height = 720;
      setAnnotationTool('pen');
    }
  }

  // Set the toolbar background active color
  function setAnnotationTool(tool) {
    state.annotationTool = tool;
    dom.btnAnnotationPen.style.background = tool === 'pen' ? 'var(--bg-elevated)' : 'transparent';
    dom.btnAnnotationPen.style.borderColor = tool === 'pen' ? 'var(--border-strong)' : 'transparent';
    dom.btnAnnotationEraser.style.background = tool === 'eraser' ? 'var(--bg-elevated)' : 'transparent';
    dom.btnAnnotationEraser.style.borderColor = tool === 'eraser' ? 'var(--border-strong)' : 'transparent';
  }

  function clearAnnotations(emit = true) {
    const canvas = dom.annotationCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (emit && state.socket) {
      state.socket.emit('annotation-clear', { roomId: state.roomId });
    }
  }

  // --- Audio & Video Enhancements ---
  function getCSSFilter(filter) {
    if (filter === 'grayscale') return 'grayscale(1)';
    if (filter === 'sepia') return 'sepia(0.8)';
    if (filter === 'invert') return 'invert(1)';
    if (filter === 'blur') return 'blur(6px)';
    return 'none';
  }

  let audioCtx = null;
  let noiseGateNode = null;

  function initNoiseSuppression(stream) {
    if (!stream.getAudioTracks().length) return stream;

    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(stream);
      const filter = audioCtx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = 150; // Cut low hums

      noiseGateNode = audioCtx.createScriptProcessor(2048, 1, 1);
      noiseGateNode.onaudioprocess = function(e) {
        const input = e.inputBuffer.getChannelData(0);
        const output = e.outputBuffer.getChannelData(0);
        
        let sum = 0;
        for (let i = 0; i < input.length; i++) {
          sum += input[i] * input[i];
        }
        const rms = Math.sqrt(sum / input.length);
        const threshold = state.noiseSuppressionEnabled ? 0.015 : 0.002;
        
        for (let i = 0; i < input.length; i++) {
          output[i] = rms > threshold ? input[i] : 0;
        }
      };

      source.connect(filter);
      filter.connect(noiseGateNode);

      const dest = audioCtx.createMediaStreamDestination();
      noiseGateNode.connect(dest);

      const processedTrack = dest.stream.getAudioTracks()[0];
      return new MediaStream([processedTrack, ...stream.getVideoTracks()]);
    } catch (e) {
      console.warn('Failed to initialize Audio Noise suppression gate:', e);
      return stream;
    }
  }

  function changeVideoFilter() {
    const filterName = dom.settingsVideoFilter.value;
    state.videoFilter = filterName;
    
    // Apply local video filter
    dom.localVideo.style.filter = getCSSFilter(filterName);

    // Apply to local spotlight video if spotlight is active
    if (currentSpotlightId === 'local' || currentSpotlightId === state.participantId) {
      const activeVideo = dom.spotlightArea.querySelector('video');
      if (activeVideo) activeVideo.style.filter = getCSSFilter(filterName);
    }

    // Broadcast to peers
    if (state.socket) {
      state.socket.emit('video-filter-change', { roomId: state.roomId, filter: filterName });
    }
  }

  function changeNoiseSuppression() {
    state.noiseSuppressionEnabled = dom.settingsNoiseSuppression.checked;
  }

  // --- Copy Direct Invite Link ---
  function copyInviteLink() {
    const inviteUrl = window.location.origin + '?room=' + state.roomId;
    navigator.clipboard.writeText(inviteUrl).then(() => {
      dom.btnCopyInvite.textContent = 'Copied!';
      setTimeout(() => {
        dom.btnCopyInvite.textContent = 'Invite';
      }, 1500);
    }).catch(err => {
      console.error('Failed to copy link:', err);
    });
  }

  // --- Speaker View & Gallery Grid Toggling ---
  let currentSpotlightId = null;

  function toggleLayoutMode() {
    state.layoutMode = (state.layoutMode === 'grid') ? 'speaker' : 'grid';
    dom.btnLayoutToggle.textContent = `Layout: ${state.layoutMode.charAt(0).toUpperCase() + state.layoutMode.slice(1)}`;
    
    if (state.layoutMode === 'speaker') {
      dom.videoGrid.classList.add('hidden');
      dom.speakerViewContainer.classList.remove('hidden');
      updateSpeakerViewLayout();
    } else {
      dom.videoGrid.classList.remove('hidden');
      dom.speakerViewContainer.classList.add('hidden');
      resetToGridView();
    }
  }

  function updateSpeakerViewLayout() {
    if (state.layoutMode !== 'speaker') return;

    // Determine target speaker ID (pinned first, then active loud speaker, fallback to local/first peer)
    let targetId = state.pinnedParticipantId;
    if (!targetId) {
      const speakingTile = document.querySelector('.video-tile.speaking:not(.local-tile)');
      if (speakingTile) {
        targetId = speakingTile.dataset.participant;
      } else if (dom.localTile.classList.contains('speaking')) {
        targetId = 'local';
      }
    }
    if (!targetId) {
      const firstTile = document.querySelector('.video-tile');
      if (firstTile) {
        targetId = firstTile.dataset.participant;
      } else {
        targetId = 'local';
      }
    }

    if (targetId !== currentSpotlightId) {
      currentSpotlightId = targetId;
      
      // Move target tile to spotlight area
      const targetTile = document.querySelector(`.video-tile[data-participant="${targetId}"]`);
      if (targetTile) {
        dom.spotlightArea.innerHTML = '';
        dom.spotlightArea.appendChild(targetTile);
        const video = targetTile.querySelector('video');
        if (video && video.paused) video.play().catch(e => {});
      }

      // Move all other tiles to thumbnails strip
      dom.speakerThumbnails.innerHTML = '';
      const otherTiles = document.querySelectorAll(`.video-tile:not([data-participant="${targetId}"])`);
      otherTiles.forEach(tile => {
        dom.speakerThumbnails.appendChild(tile);
        const video = tile.querySelector('video');
        if (video && video.paused) video.play().catch(e => {});
      });
    }
  }

  function resetToGridView() {
    currentSpotlightId = null;
    const allTiles = document.querySelectorAll('.video-tile');
    allTiles.forEach(tile => {
      dom.videoGrid.appendChild(tile);
      const video = tile.querySelector('video');
      if (video && video.paused) video.play().catch(e => {});
    });
    updateVideoGridCount();
  }

  // Run layout correction on an interval in Speaker View
  setInterval(() => {
    if (state.layoutMode === 'speaker') {
      updateSpeakerViewLayout();
    }
  }, 1000);

  // --- Host Moderation Actions ---
  function toggleCoHost(socketId) {
    if (!state.isHost) return;
    state.socket.emit('toggle-cohost', { roomId: state.roomId, targetSocketId: socketId });
  }

  function muteParticipant(socketId) {
    if (!hasModPowers()) return;
    state.socket.emit('mute-participant', { roomId: state.roomId, targetSocketId: socketId });
  }

  function kickParticipant(socketId) {
    if (!hasModPowers()) return;
    state.socket.emit('kick-participant', { roomId: state.roomId, targetSocketId: socketId });
  }

  function muteBot(botId) {
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

  function kickBot(botId) {
    if (!hasModPowers()) return;
    state.bots = state.bots.filter(b => b.id !== botId);
    const tile = document.querySelector(`.video-tile[data-participant="${botId}"]`);
    if (tile) tile.remove();
    updateParticipantsList();
    updateVideoGridCount();
    
    if (state.layoutMode === 'speaker') {
      currentSpotlightId = null;
      updateSpeakerViewLayout();
    }
  }

  function muteAll() {
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

  // --- Chat File Attachments ---
  function handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    const MAX_SIZE = 5 * 1024 * 1024; // 5MB
    if (file.size > MAX_SIZE) {
      alert('File size exceeds the 5MB limit.');
      dom.chatFileInput.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = function(evt) {
      const base64Data = evt.target.result.split(',')[1];
      const filePayload = {
        type: 'file',
        fileName: file.name,
        fileType: file.type,
        fileSize: formatBytes(file.size),
        fileData: base64Data
      };
      
      const recipientId = dom.chatRecipient ? dom.chatRecipient.value : 'everyone';
      const msgStr = JSON.stringify(filePayload);

      if (recipientId === 'everyone') {
        state.socket.emit('chat-message', {
          roomId: state.breakoutRoomId || state.roomId,
          senderId: state.participantId,
          senderName: state.userName || 'You',
          message: msgStr
        });
      } else if (recipientId.startsWith('bot-')) {
        const bot = state.bots.find(b => b.id === recipientId);
        if (bot) {
          appendChatMessage(state.userName || 'You', msgStr, true, new Date().toISOString(), true, bot.name);
          setTimeout(() => {
            if (!state.bots.find(b => b.id === bot.id)) return;
            appendChatMessage(bot.name, "Received your file, thank you!", false, new Date().toISOString(), true, 'You');
          }, 1000);
        }
      } else {
        const peer = state.peers.get(recipientId);
        const recipientName = peer ? peer.info.displayName : 'Participant';
        state.socket.emit('chat-message', {
          roomId: state.breakoutRoomId || state.roomId,
          senderId: state.participantId,
          senderName: state.userName || 'You',
          message: msgStr,
          targetSocketId: recipientId,
          recipientName: recipientName
        });
      }
      
      dom.chatFileInput.value = '';
    };
    reader.readAsDataURL(file);
  }

  function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function downloadFile(fileId) {
    const fileObj = window._apexFiles?.[fileId];
    if (!fileObj) return;
    
    const binaryString = atob(fileObj.fileData);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: fileObj.fileType || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileObj.fileName;
    a.click();
    URL.revokeObjectURL(url);
  }

  // --- Live Polling Controllers ---
  function showPollModal() {
    if (!state.isHost) return;
    
    dom.pollQuestion.value = '';
    dom.pollOpt1.value = '';
    dom.pollOpt2.value = '';
    dom.pollOpt3.value = '';
    dom.pollOpt4.value = '';
    
    dom.pollCreateView.classList.remove('hidden');
    dom.pollTallyView.classList.add('hidden');
    dom.pollHostTitle.textContent = 'Create Poll';
    dom.modalPollHost.classList.remove('hidden');
  }

  function launchPoll() {
    const q = dom.pollQuestion.value.trim();
    const o1 = dom.pollOpt1.value.trim();
    const o2 = dom.pollOpt2.value.trim();
    const o3 = dom.pollOpt3.value.trim();
    const o4 = dom.pollOpt4.value.trim();

    if (!q || !o1 || !o2) {
      alert('Please provide a question and at least 2 options.');
      return;
    }

    const options = [o1, o2];
    if (o3) options.push(o3);
    if (o4) options.push(o4);

    state.activePoll = {
      id: genId(),
      question: q,
      options: options,
      votes: {},
      resultsShared: false
    };

    state.socket.emit('poll-create', { roomId: state.roomId, poll: state.activePoll });
    showPollTallyView();
  }

  function showPollTallyView() {
    dom.pollCreateView.classList.add('hidden');
    dom.pollTallyView.classList.remove('hidden');
    dom.pollHostTitle.textContent = 'Live Poll Results';
    dom.pollTallyQuestion.textContent = state.activePoll.question;
    
    dom.pollHostClose.style.display = 'none';
    dom.pollEndShareBtn.style.display = 'block';
    updatePollTallyResults();
  }

  function updatePollTallyResults() {
    const poll = state.activePoll;
    if (!poll) return;

    const counts = new Array(poll.options.length).fill(0);
    let total = 0;
    Object.values(poll.votes).forEach(optIdx => {
      counts[optIdx]++;
      total++;
    });

    const html = poll.options.map((opt, idx) => {
      const count = counts[idx];
      const percent = total > 0 ? Math.round((count / total) * 100) : 0;
      return `
        <div class="poll-option-result">
          <div class="poll-option-label-row">
            <span>${escapeHtml(opt)}</span>
            <span>${count} vote(s) (${percent}%)</span>
          </div>
          <div class="poll-progress-bar-bg">
            <div class="poll-progress-bar-fill" style="width: ${percent}%;"></div>
          </div>
        </div>
      `;
    }).join('');

    dom.pollTallyResults.innerHTML = html;
  }

  function sharePollResults() {
    if (!state.isHost || !state.activePoll) return;
    
    const counts = new Array(state.activePoll.options.length).fill(0);
    Object.values(state.activePoll.votes).forEach(optIdx => {
      counts[optIdx]++;
    });

    state.socket.emit('poll-end', {
      roomId: state.roomId,
      pollId: state.activePoll.id,
      results: counts
    });

    dom.pollEndShareBtn.style.display = 'none';
    dom.pollHostClose.style.display = 'block';
  }

  function closePollHost() {
    dom.modalPollHost.classList.add('hidden');
    state.activePoll = null;
  }

  function handlePollCreated(poll) {
    state.activePoll = poll;
    state.hasVoted = false;

    dom.pollVoteQuestion.textContent = poll.question;
    
    const html = poll.options.map((opt, idx) => `
      <button class="poll-vote-btn" data-index="${idx}">
        ${escapeHtml(opt)}
      </button>
    `).join('');
    dom.pollVoteOptions.innerHTML = html;

    const optButtons = dom.pollVoteOptions.querySelectorAll('.poll-vote-btn');
    optButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        optButtons.forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
      });
    });

    dom.pollVoteView.classList.remove('hidden');
    dom.pollWaitView.classList.add('hidden');
    dom.pollParticipantClose.style.display = 'none';
    dom.modalPollParticipant.classList.remove('hidden');
  }

  function submitPollVote() {
    if (state.hasVoted || !state.activePoll) return;
    
    const selectedBtn = dom.pollVoteOptions.querySelector('.poll-vote-btn.selected');
    if (!selectedBtn) {
      alert('Please select an option.');
      return;
    }

    const optIdx = parseInt(selectedBtn.dataset.index);
    state.hasVoted = true;

    state.socket.emit('poll-vote', {
      roomId: state.roomId,
      pollId: state.activePoll.id,
      optionIndex: optIdx,
      voterName: state.userName || 'Participant'
    });

    dom.pollVoteView.classList.add('hidden');
    dom.pollWaitView.classList.remove('hidden');
    dom.pollParticipantResults.classList.add('hidden');
    dom.pollWaitText.textContent = 'Vote submitted. Waiting for host to share results...';
  }

  function handlePollVoted({ pollId, optionIndex, voterName, socketId }) {
    if (state.isHost && state.activePoll && state.activePoll.id === pollId) {
      state.activePoll.votes[socketId] = optionIndex;
      updatePollTallyResults();
    }
  }

  function handlePollEnded(pollId, results) {
    if (!state.activePoll || state.activePoll.id !== pollId) return;
    
    dom.pollVoteView.classList.add('hidden');
    dom.pollWaitView.classList.remove('hidden');
    dom.pollWaitText.textContent = 'Final Poll Results:';
    
    let total = 0;
    results.forEach(c => total += c);

    const html = state.activePoll.options.map((opt, idx) => {
      const count = results[idx];
      const percent = total > 0 ? Math.round((count / total) * 100) : 0;
      return `
        <div class="poll-option-result">
          <div class="poll-option-label-row">
            <span>${escapeHtml(opt)}</span>
            <span>${count} vote(s) (${percent}%)</span>
          </div>
          <div class="poll-progress-bar-bg">
            <div class="poll-progress-bar-fill" style="width: ${percent}%;"></div>
          </div>
        </div>
      `;
    }).join('');

    dom.pollParticipantResults.innerHTML = html;
    dom.pollParticipantResults.classList.remove('hidden');
    dom.pollParticipantClose.style.display = 'block';
  }

  function closePollParticipant() {
    dom.modalPollParticipant.classList.add('hidden');
    state.activePoll = null;
  }

  // --- Breakout Rooms Controllers ---
  function showBreakoutModal() {
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

  function startBreakouts() {
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

  function endBreakouts() {
    if (!state.isHost) return;
    
    state.socket.emit('breakout-end', {
      roomId: state.roomId,
      roomCount: state.breakoutRoomsCount
    });

    handleBreakoutEnded();
    dom.modalBreakoutHost.classList.add('hidden');
  }

  function handleBreakoutAssigned(roomName, duration) {
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
      currentSpotlightId = null;
      updateSpeakerViewLayout();
    }
    updateVideoGridCount();
  }

  function handleBreakoutEnded() {
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
      currentSpotlightId = null;
      updateSpeakerViewLayout();
    }
    updateVideoGridCount();
  }

  function formatBreakoutTime(seconds) {
    const m = String(Math.floor(seconds / 60)).padStart(2, '0');
    const s = String(seconds % 60).padStart(2, '0');
    return `${m}:${s}`;
  }

  // ============================================================
  // SLIDES & ADVANCED BREAKOUT FEATURES HELPERS
  // ============================================================

  const APEX_SLIDES = [
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

  function toggleSlidesSharing() {
    if (state.isSharingSlides) {
      stopSlidesSharing();
    } else {
      state.isSharingSlides = true;
      state.currentSlideIndex = 0;
      state.hasSlideControl = true;
      state.slidePresenterSocketId = state.socket.id;
      
      dom.btnSlidesToggle.classList.add('active');
      dom.slidesOverlay.classList.remove('hidden');
      renderSlide();
      updateSlidesControlUI();
      
      state.socket.emit('slide-share-start', { roomId: state.roomId, slideIndex: 0 });
      updateParticipantsList();
      if (state.presenterOverlayEnabled) {
        startPresenterOverlayLoop();
      }
    }
  }

  function stopSlidesSharing() {
    state.isSharingSlides = false;
    state.hasSlideControl = false;
    state.slidePresenterSocketId = null;
    state.controlledSocketId = null;
    
    dom.btnSlidesToggle.classList.remove('active');
    dom.slidesOverlay.classList.add('hidden');
    
    state.socket.emit('slide-share-stop', { roomId: state.roomId });
    updateParticipantsList();
    stopPresenterOverlayLoop();
  }

  function changeSlide(direction) {
    if (!state.hasSlideControl) return;
    
    let newIndex = state.currentSlideIndex + direction;
    if (newIndex >= 0 && newIndex < APEX_SLIDES.length) {
      state.currentSlideIndex = newIndex;
      renderSlide();
      state.socket.emit('slide-change', { roomId: state.roomId, slideIndex: newIndex });
    }
  }

  function togglePeerSlideControl(socketId) {
    if (!state.isHost) return;
    
    if (state.controlledSocketId === socketId) {
      state.socket.emit('slide-revoke-control', { roomId: state.roomId });
    } else {
      state.socket.emit('slide-grant-control', { roomId: state.roomId, targetSocketId: socketId });
    }
  }

  function revokeSlideControl() {
    if (!state.isHost) return;
    state.socket.emit('slide-revoke-control', { roomId: state.roomId });
  }

  function updateSlidesControlUI() {
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

  function renderSlide() {
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

  function handleBreakoutCsvUpload(e) {
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
      dom.breakoutCsvStatus.textContent = `✅ Loaded ${loadedCount} assignments from CSV.`;
      dom.breakoutCsvStatus.style.color = "var(--accent-cyan)";
    };
    reader.onerror = function() {
      dom.breakoutCsvStatus.textContent = "❌ Failed to read CSV file.";
      dom.breakoutCsvStatus.style.color = "var(--accent-coral)";
    };
    reader.readAsText(file);
  }

  function openBreakoutSelectionModal(rooms, duration) {
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

  function joinSelfSelectedBreakout(roomName, duration) {
    dom.modalBreakoutParticipant.classList.add('hidden');
    handleBreakoutAssigned(roomName, duration);
  }

  // ============================================================
  // NEW ZOOM-LIKE FEATURES HELPERS
  // ============================================================

  function updateHandIconsOnTiles() {
    const tiles = document.querySelectorAll('.video-tile');
    tiles.forEach(tile => {
      const partId = tile.dataset.participant;
      const socketId = tile.dataset.socket;
      
      const isLocal = partId === 'local' || partId === state.participantId;
      
      let queueIndex = -1;
      if (isLocal) {
        queueIndex = state.handRaiseQueue.findIndex(item => item.socketId === state.socket?.id);
      } else {
        queueIndex = state.handRaiseQueue.findIndex(item => item.socketId === socketId || item.participantId === partId);
      }
      
      let badge = tile.querySelector('.tile-hand-badge');
      if (queueIndex !== -1) {
        const rank = queueIndex + 1;
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'tile-hand-badge';
          tile.appendChild(badge);
        }
        badge.textContent = `✋ ${rank}`;
        
        if (isLocal) {
          state.handRaised = true;
          dom.btnHand.classList.add('active');
        }
      } else {
        if (badge) badge.remove();
        if (isLocal) {
          state.handRaised = false;
          dom.btnHand.classList.remove('active');
        }
      }
    });
  }

  function updateChatPermissionsUI() {
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

  function getPresenterVideoElement() {
    if (!state.slidePresenterSocketId) return null;
    if (state.slidePresenterSocketId === state.socket?.id) {
      return dom.localVideo;
    }
    const tile = document.querySelector(`.video-tile[data-socket="${state.slidePresenterSocketId}"]`);
    return tile ? tile.querySelector('video') : null;
  }

  let presenterOverlayLoopId = null;

  function startPresenterOverlayLoop() {
    if (presenterOverlayLoopId) return;
    
    const canvas = dom.slidesPresenterCanvas;
    if (!canvas) return;
    
    canvas.width = 140;
    canvas.height = 140;
    const ctx = canvas.getContext('2d');
    
    canvas.classList.remove('hidden');

    function loop() {
      if (!state.isSharingSlides || !state.presenterOverlayEnabled) {
        stopPresenterOverlayLoop();
        return;
      }

      const video = getPresenterVideoElement();
      if (video && video.readyState >= video.HAVE_CURRENT_DATA) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        const type = state.presenterOverlayType;
        if (type === 'bubble') {
          canvas.style.borderRadius = '50%';
          canvas.style.border = '3px solid var(--border-strong)';
          canvas.style.boxShadow = 'var(--neo-shadow-cyan)';
          
          ctx.save();
          ctx.beginPath();
          ctx.arc(canvas.width / 2, canvas.height / 2, canvas.width / 2, 0, Math.PI * 2);
          ctx.clip();
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          ctx.restore();
        } else if (type === 'chromakey') {
          canvas.style.borderRadius = '0px';
          canvas.style.border = 'none';
          canvas.style.boxShadow = 'none';
          
          const tempCanvas = document.createElement('canvas');
          tempCanvas.width = canvas.width;
          tempCanvas.height = canvas.height;
          const tempCtx = tempCanvas.getContext('2d');
          tempCtx.drawImage(video, 0, 0, tempCanvas.width, tempCanvas.height);
          
          const imgData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
          const data = imgData.data;
          
          const keyType = state.presenterChromaColor;
          const tolerance = state.presenterChromaTolerance;
          
          for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            
            let isMatch = false;
            if (keyType === 'green') {
              isMatch = (g - r > tolerance / 2) && (g - b > tolerance / 2);
            } else if (keyType === 'blue') {
              isMatch = (b - r > tolerance / 2) && (b - g > tolerance / 2);
            } else if (keyType === 'dark') {
              isMatch = (r < tolerance && g < tolerance && b < tolerance);
            }
            
            if (isMatch) {
              data[i + 3] = 0;
            }
          }
          ctx.putImageData(imgData, 0, 0);
        }
      }
      
      presenterOverlayLoopId = requestAnimationFrame(loop);
    }
    
    presenterOverlayLoopId = requestAnimationFrame(loop);
  }

  function stopPresenterOverlayLoop() {
    if (presenterOverlayLoopId) {
      cancelAnimationFrame(presenterOverlayLoopId);
      presenterOverlayLoopId = null;
    }
    if (dom.slidesPresenterCanvas) {
      dom.slidesPresenterCanvas.classList.add('hidden');
    }
  }

  function askToUnmute(socketId) {
    if (!hasModPowers()) return;
    state.socket.emit('unmute-request', { roomId: state.roomId, targetSocketId: socketId });
  }

  // ============================================================
  // GLOBAL API (for inline HTML onclick handlers)
  // ============================================================
  window._apex = {
    joinMeeting,
    deleteScheduled,
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
    askToUnmute
  };

  // ============================================================
  // BOOT
  // ============================================================
  document.addEventListener('DOMContentLoaded', init);
})();
