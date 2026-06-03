// public/src/core.js — Core module: selectors, state, dom, and utilities

export const $ = (sel) => document.querySelector(sel);
export const $$ = (sel) => document.querySelectorAll(sel);

export const state = {
  view: 'landing',
  user: null,
  userName: '',
  oddsellerId: '',
  participantId: '',
  roomId: null,
  sessionData: null,
  isHost: false,
  hostKey: null,
  recordingApproved: false,
  recordingHostApproved: false,

  // Media
  localStream: null,
  screenStream: null,
  micEnabled: true,
  camEnabled: true,
  isSharingScreen: false,
  virtualBackground: { type: 'none', value: null },

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

  // LiveKit
  livekitRoom: null,
  livekitConnected: false,

  // Peers
  peers: new Map(),

  // Layout
  layoutMode: 'grid',
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
  waitingQueue: [],
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

  breakoutCsvAssignments: null,
  breakoutSelfSelectEnabled: false,

  presenterOverlayEnabled: false,
  presenterOverlayType: 'bubble',
  presenterChromaColor: 'green',
  presenterChromaTolerance: 80,
  handRaiseQueue: [],
  chatPermissions: 'public-private',
  galleryPage: 0,
  participantsSearchQuery: '',
  autoPipVideo: null,
  captionsEnabled: false,
  isLocalMinimized: false,
  sidePanelFloating: false,
  activeSpeakerId: null,
  activeSpeakerDebounceTimer: null,
  disableIncomingVideo: false,
  chatSearchQuery: '',
  wbRedoStack: [],
  hideSelfView: false,
  hideNonVideo: false,
  autoMuteOnEntry: true,
  mirrorLocalVideo: false,
  isBrb: false,
  wbLaserActive: false,
  vanishingPaths: [],
  individualVolumes: {},
  spotlightSocketIds: [],
  meetingPassword: null,
  meetingRecurrence: null,
  analytics: null
};

export const dom = {
  viewLanding: $('#view-landing'),
  viewDashboard: $('#view-dashboard'),
  viewMeeting: $('#view-meeting'),
  viewLogs: $('#view-logs'),
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
  dashClock: $('#dash-clock'),
  dashUsernameDisplay: $('#dash-username-display'),
  btnLogout: $('#btn-logout'),
  btnNewMeeting: $('#btn-new-meeting'),
  btnJoinMeeting: $('#btn-join-meeting'),
  btnSchedule: $('#btn-schedule'),
  btnSessionLogs: $('#btn-session-logs'),
  upcomingList: $('#upcoming-list'),
  modalJoin: $('#modal-join'),
  joinCodeInput: $('#join-code-input'),
  joinCancel: $('#join-cancel'),
  joinConfirm: $('#join-confirm'),
  modalSchedule: $('#modal-schedule'),
  schedTitle: $('#sched-title'),
  schedDatetime: $('#sched-datetime'),
  schedDuration: $('#sched-duration'),
  schedCancel: $('#sched-cancel'),
  schedConfirm: $('#sched-confirm'),
  logsBack: $('#logs-back'),
  logsList: $('#logs-list'),
  meetingTitle: $('#meeting-title'),
  meetingCodeDisplay: $('#meeting-code-display'),
  meetingTimer: $('#meeting-timer'),
  videoGrid: $('#video-grid'),
  localVideo: $('#local-video'),
  localTile: $('#local-tile'),
  btnLocalMinimize: $('#btn-local-minimize'),
  localNameLabel: $('#local-name-label'),
  localSpeaking: $('#local-speaking'),
  localAvatar: $('#local-avatar'),
  btnSpawnBots: $('#btn-spawn-bots'),
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
  btnPipToggle: $('#btn-pip-toggle'),
  btnFullscreenToggle: $('#btn-fullscreen-toggle'),
  btnCaptionsToggle: $('#btn-captions-toggle'),
  controlRoomCode: $('#control-room-code'),
  sidePanel: $('#side-panel'),
  panelClose: $('#panel-close'),
  panelTabs: $$('.panel-tab'),
  btnDockFloatToggle: $('#btn-dock-float-toggle'),
  tabChat: $('#tab-chat'),
  tabParticipants: $('#tab-participants'),
  captionsOverlay: $('#captions-overlay'),
  announcementToast: $('#announcement-toast'),
  wbOverlay: $('#wb-overlay'),
  wbClose: $('#wb-close'),
  chatMessages: $('#chat-messages'),
  chatInput: $('#chat-input'),
  btnSendChat: $('#btn-send-chat'),
  chatBadge: $('#chat-badge'),
  chatRecipient: $('#chat-recipient'),
  participantsList: $('#participants-list'),
  wbCanvas: $('#whiteboard-canvas'),
  wbColor: $('#wb-color'),
  wbTools: $$('.wb-tool'),
  reactionsLayer: $('#reactions-layer'),
  reactionsPicker: $('#reactions-picker'),
  reactionBtns: $$('.reaction-btn'),
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
  timerLabel: $('#timer-label'),
  breakoutTimerBadge: $('#breakout-timer-badge'),
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
  breakoutCsvFile: $('#breakout-csv-file'),
  breakoutCsvStatus: $('#breakout-csv-status'),
  breakoutSelfSelect: $('#breakout-self-select'),
  modalBreakoutParticipant: $('#modal-breakout-participant'),
  breakoutRoomsList: $('#breakout-rooms-list'),
  breakoutParticipantCloseBtn: $('#breakout-participant-close-btn'),
  chatPermissionsSelect: $('#chat-permissions-select'),
  settingsPresenterOverlay: $('#settings-presenter-overlay'),
  settingsOverlayType: $('#settings-overlay-type'),
  settingsChromaColor: $('#settings-chroma-color'),
  settingsChromaTolerance: $('#settings-chroma-tolerance'),
  slidesPresenterCanvas: $('#slides-presenter-canvas'),
  modalUnmutePrompt: $('#modal-unmute-prompt'),
  btnUnmuteDecline: $('#btn-unmute-decline'),
  btnUnmuteAccept: $('#btn-unmute-accept'),
  participantsSearch: $('#participants-search'),
  galleryPaginationControls: $('#gallery-pagination-controls'),
  btnGalleryPrev: $('#btn-gallery-prev'),
  btnGalleryNext: $('#btn-gallery-next'),
  galleryPageIndicator: $('#gallery-page-indicator'),
  dashAvatarToggle: $('#dash-avatar-toggle'),
  dashProfileDropdown: $('#dash-profile-dropdown'),
  recBadge: $('#rec-badge'),
  btnLeaveHeader: $('#btn-leave-header'),
  chatFileInput: $('#chat-file-input'),
  btnChatAttach: $('#btn-chat-attach'),
  btnBreakoutToggle: $('#btn-breakout-toggle'),
  modalBreakoutHost: $('#modal-breakout-host'),
  breakoutRoomsCount: $('#breakout-rooms-count'),
  breakoutDuration: $('#breakout-duration'),
  breakoutCancel: $('#breakout-cancel'),
  breakoutStartBtn: $('#breakout-start-btn'),
  breakoutEndBtn: $('#breakout-end-btn'),
  breakoutSetupView: $('#breakout-setup-view'),
  breakoutActiveView: $('#breakout-active-view'),
  breakoutBroadcastInput: $('#breakout-broadcast-input'),
  breakoutBroadcastBtn: $('#breakout-broadcast-btn'),
  breakoutBroadcastStatus: $('#breakout-broadcast-status'),
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
  modalPollParticipant: $('#modal-poll-participant'),
  pollVoteView: $('#poll-vote-view'),
  pollVoteQuestion: $('#poll-vote-question'),
  pollVoteOptions: $('#poll-vote-options'),
  pollSubmitVoteBtn: $('#poll-submit-vote-btn'),
  pollWaitView: $('#poll-wait-view'),
  pollWaitText: $('#poll-wait-text'),
  pollParticipantResults: $('#poll-participant-results'),
  pollParticipantClose: $('#poll-participant-close'),
  btnSettings: $('#btn-settings'),
  modalSettings: $('#modal-settings'),
  settingsCamera: $('#settings-camera'),
  settingsMic: $('#settings-mic'),
  settingsSpeaker: $('#settings-speaker'),
  settingsVideoFilter: $('#settings-video-filter'),
  settingsNoiseSuppression: $('#settings-noise-suppression'),
  btnSettingsClose: $('#btn-settings-close'),
  btnToggleWaitingRoom: $('#btn-toggle-waiting-room'),
  btnLockMeeting: $('#btn-lock-meeting'),
  waitingQueueContainer: $('#waiting-queue-container'),
  waitingCountBadge: $('#waiting-count-badge'),
  waitingList: $('#waiting-list'),
  waitingRoomOverlay: $('#waiting-room-overlay'),
  waitingRoomMessage: $('#waiting-room-message'),
  waitingRoomMeetingTitle: $('#waiting-room-meeting-title'),
  btnCancelWaiting: $('#btn-cancel-waiting'),
  modalLogDetails: $('#modal-log-details'),
  logDetailsTbody: $('#log-details-tbody'),
  btnLogDetailsClose: $('#btn-log-details-close'),
  btnWbUndo: $('#btn-wb-undo'),
  btnWbRedo: $('#btn-wb-redo'),
  btnWbSave: $('#btn-wb-save'),
  chatSearchInput: $('#chat-search-input'),
  settingsIncomingVideo: $('#settings-incoming-video'),
  micLevelMeter: $('#mic-level-meter'),
  wbVideoStrip: $('#wb-video-strip'),
  slidesVideoStrip: $('#slides-video-strip'),
  wbStripTiles: $('#wb-strip-tiles'),
  slidesStripTiles: $('#slides-strip-tiles'),
  btnWbStripDock: $('#btn-wb-strip-dock'),
  btnSlidesStripDock: $('#btn-slides-strip-dock'),
  settingsHideSelf: $('#settings-hide-self'),
  settingsHideNonVideo: $('#settings-hide-non-video'),
  settingsAutoMute: $('#settings-auto-mute'),
  settingsMirrorLocal: $('#settings-mirror-local'),
  btnWbLaser: $('#btn-wb-laser'),
  btnMuteAllExceptPresenter: $('#btn-mute-all-except-presenter'),
  btnBrb: $('#btn-brb'),
  // Recording approval + other new DOM refs
  recordingApprovalOverlay: $('#recording-approval-overlay'),
  recordingApprovalAccept: $('#recording-approval-accept'),
  recordingApprovalDecline: $('#recording-approval-decline'),
  hostKeyDisplay: $('#host-key-display'),
  meetingPasswordBadge: $('#meeting-password-badge'),
};

export function genId() {
  return Math.random().toString(36).slice(2, 10);
}

export function hasModPowers() {
  return state.isHost || state.role === 'cohost';
}

export function formatTime(seconds) {
  const h = String(Math.floor(seconds / 3600)).padStart(2, '0');
  const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
  const s = String(Math.floor(seconds % 60)).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

export function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

export function playVoicePrompt(text) {
  if ('speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      window.speechSynthesis.speak(utterance);
    } catch (e) { console.warn('SpeechSynthesis failed:', e); }
  }
}

export function showView(name) {
  state.view = name;
  dom.viewLanding.classList.toggle('active', name === 'landing');
  dom.viewDashboard.classList.toggle('active', name === 'dashboard');
  dom.viewMeeting.classList.toggle('active', name === 'meeting');
  dom.viewLogs.classList.toggle('active', name === 'logs');
}