// public/src/media.js — Media Capture, device management, layouts, grid pagination
import { state, dom, formatTime, playVoicePrompt } from './core.js';
import { createLiveKitTile } from './livekit.js';
import { createRemoteTile, connectToRoom } from './webrtc.js';
import { onScreenShareActive } from './main.js'; // imported from main.js orchestrator
import { resizeWhiteboard } from './whiteboard.js';

let activeAnalysisCtx = null;
let activeAnalysisTrack = null;
let activeAnalysisFrameId = null;


export async function initMedia() {
  try {
    const videoConstraints = state.selectedCameraId 
      ? { deviceId: { exact: state.selectedCameraId }, width: 1280, height: 720 } 
      : { width: 1280, height: 720, facingMode: 'user' };
    const audioConstraints = state.selectedMicId 
      ? { deviceId: { exact: state.selectedMicId } } 
      : true;

    const rawStream = await navigator.mediaDevices.getUserMedia({
      video: videoConstraints,
      audio: audioConstraints
    });
    
    state.localStream = initNoiseSuppression(rawStream);
    dom.localVideo.srcObject = state.localStream;
    dom.localVideo.style.filter = getCSSFilter(state.videoFilter);
    dom.localVideo.style.transform = state.mirrorLocalVideo ? 'scaleX(-1)' : 'none';
    
    // Apply initial mute/hidden state from preview green room
    state.localStream.getAudioTracks().forEach(t => t.enabled = state.micEnabled);
    dom.btnMic.classList.toggle('muted', !state.micEnabled);
    
    state.localStream.getVideoTracks().forEach(t => t.enabled = state.camEnabled);
    dom.btnCam.classList.toggle('muted', !state.camEnabled);
    dom.localAvatar.classList.toggle('hidden', state.camEnabled);
    
    startLocalAudioAnalysis();
    addPipButtonToTile(dom.localTile);
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

export function showMutedSpeechToast() {
  if (document.querySelector('.talking-muted-toast')) return;

  const toast = document.createElement('div');
  toast.className = 'talking-muted-toast';
  toast.innerHTML = `
    <span style="font-size: 16px; margin-right: 8px;">🎙️</span>
    <span>You are speaking, but your microphone is muted.</span>
  `;
  document.body.appendChild(toast);

  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(320, audioCtx.currentTime);
    osc.frequency.setValueAtTime(480, audioCtx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.04, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.25);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.25);
    setTimeout(() => {
      audioCtx.close().catch(() => {});
    }, 350);
  } catch (e) {}

  setTimeout(() => {
    toast.classList.add('visible');
  }, 20);

  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 400);
  }, 4000);
}

export function startLocalAudioAnalysis() {
  if (!state.localStream) return;
  const audioTracks = state.localStream.getAudioTracks();
  if (!audioTracks.length) return;

  // Clean up any existing active analysis first to prevent leaks
  if (activeAnalysisFrameId) {
    cancelAnimationFrame(activeAnalysisFrameId);
    activeAnalysisFrameId = null;
  }
  if (activeAnalysisTrack) {
    activeAnalysisTrack.stop();
    activeAnalysisTrack = null;
  }
  if (activeAnalysisCtx) {
    activeAnalysisCtx.close().catch(() => {});
    activeAnalysisCtx = null;
  }

  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    // Clone the local mic track so it stays enabled for local analysis even when state.localStream audio is muted
    const analysisTrack = audioTracks[0].clone();
    analysisTrack.enabled = true;
    
    activeAnalysisCtx = ctx;
    activeAnalysisTrack = analysisTrack;
    
    const analysisStream = new MediaStream([analysisTrack]);
    const source = ctx.createMediaStreamSource(analysisStream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);

    let talkingMutedFrames = 0;
    let lastMutedAlertTime = 0;

    function check() {
      if (!analysisTrack || analysisTrack.readyState === 'ended') return;

      analyser.getByteFrequencyData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i];
      const avg = sum / data.length;

      // Local speaking indicator (only if unmuted)
      const speaking = avg > 15 && state.micEnabled;
      dom.localTile.classList.toggle('speaking', speaking);

      // Meeting controls mic level meter (pulses even when muted to verify hardware)
      const fill = document.getElementById('meeting-mic-meter-fill');
      if (fill) {
        // Map average (0-150 typical) to percentage height (0-100%)
        const percent = Math.min(100, Math.max(0, (avg / 80) * 100));
        fill.style.height = `${percent}%`;
      }

      // Talking while muted warning detection
      if (!state.micEnabled && avg > 18) {
        talkingMutedFrames++;
        // If speaking continuously for ~1 second (assuming ~60fps requestAnimationFrame, so 60 frames)
        if (talkingMutedFrames > 60) {
          const now = Date.now();
          if (now - lastMutedAlertTime > 12000) { // Throttle warning to every 12 seconds
            showMutedSpeechToast();
            lastMutedAlertTime = now;
          }
        }
      } else {
        talkingMutedFrames = 0;
      }

      activeAnalysisFrameId = requestAnimationFrame(check);
    }
    activeAnalysisFrameId = requestAnimationFrame(check);
  } catch (err) {
    console.warn('Failed to start local audio analysis:', err);
  }
}

export function toggleMic() {
  if (!state.localStream) return;
  state.micEnabled = !state.micEnabled;
  state.localStream.getAudioTracks().forEach(t => t.enabled = state.micEnabled);
  dom.btnMic.classList.toggle('muted', !state.micEnabled);

  if (state.livekitConnected && state.livekitRoom) {
    state.livekitRoom.localParticipant.setMicrophoneEnabled(state.micEnabled).catch(e => console.warn('setMicrophoneEnabled failed:', e));
  }
}

export function toggleCam() {
  if (!state.localStream) return;
  state.camEnabled = !state.camEnabled;
  state.localStream.getVideoTracks().forEach(t => t.enabled = state.camEnabled);
  dom.btnCam.classList.toggle('muted', !state.camEnabled);
  dom.localAvatar.classList.toggle('hidden', state.camEnabled);

  if (state.livekitConnected && state.livekitRoom) {
    state.livekitRoom.localParticipant.setCameraEnabled(state.camEnabled).catch(e => console.warn('setCameraEnabled failed:', e));
  }
}

export async function toggleScreenShare() {
  if (state.isSharingScreen) {
    if (state.livekitConnected && state.livekitRoom) {
      await state.livekitRoom.localParticipant.setScreenShareEnabled(false);
    } else {
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
    }

    dom.localTile.classList.remove('screen-sharing');
    state.isSharingScreen = false;
    dom.btnScreen.classList.remove('active');
    
    if (state.socket) {
      state.socket.emit('screenshare-stop', { roomId: state.roomId });
    }
    onScreenShareActive(false);
  } else {
    try {
      if (state.livekitConnected && state.livekitRoom) {
        await state.livekitRoom.localParticipant.setScreenShareEnabled(true);
      } else {
        state.screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        
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
      }
      
      // Show indicator on local tile but keep local video showing camera feed to prevent "hall of mirrors"
      dom.localTile.classList.add('screen-sharing');
      
      state.isSharingScreen = true;
      dom.btnScreen.classList.add('active');

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

// --- Audio & Video Enhancements ---
export function getCSSFilter(filter) {
  if (filter === 'grayscale') return 'grayscale(1)';
  if (filter === 'sepia') return 'sepia(0.8)';
  if (filter === 'invert') return 'invert(1)';
  if (filter === 'blur') return 'blur(6px)';
  return 'none';
}

let audioCtx = null;
let noiseGateNode = null;

export function initNoiseSuppression(stream) {
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

export function changeVideoFilter() {
  const filterName = dom.settingsVideoFilter.value;
  state.videoFilter = filterName;
  
  // Apply local video filter
  dom.localVideo.style.filter = getCSSFilter(filterName);

  // Apply to local spotlight video if spotlight is active
  if (state.currentSpotlightId === 'local' || state.currentSpotlightId === state.participantId) {
    const activeVideo = dom.spotlightArea.querySelector('video');
    if (activeVideo) activeVideo.style.filter = getCSSFilter(filterName);
  }

  // Broadcast to peers
  if (state.socket) {
    state.socket.emit('video-filter-change', { roomId: state.roomId, filter: filterName });
  }
}

export function changeNoiseSuppression() {
  state.noiseSuppressionEnabled = dom.settingsNoiseSuppression.checked;
}

export async function changeCameraDevice() {
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

    // Update LiveKit if connected
    if (state.livekitConnected && state.livekitRoom) {
      const localPubs = state.livekitRoom.localParticipant.videoTrackPublications;
      for (const [sid, pub] of localPubs) {
        if (pub.track && (pub.source === 'camera' || pub.source === 'video')) {
          await state.livekitRoom.localParticipant.unpublishTrack(pub.track);
        }
      }
      await state.livekitRoom.localParticipant.publishTrack(newVideoTrack, { name: 'camera' });
    }
  } catch (e) {
    console.error('Failed to switch camera:', e.message);
    alert('Could not switch to selected camera.');
  }
}

export async function changeMicDevice() {
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

    // Update LiveKit if connected
    if (state.livekitConnected && state.livekitRoom) {
      const localPubs = state.livekitRoom.localParticipant.audioTrackPublications;
      for (const [sid, pub] of localPubs) {
        if (pub.track) {
          await state.livekitRoom.localParticipant.unpublishTrack(pub.track);
        }
      }
      await state.livekitRoom.localParticipant.publishTrack(newAudioTrack, { name: 'microphone' });
    }
  } catch (e) {
    console.error('Failed to switch microphone:', e.message);
    alert('Could not switch to selected microphone.');
  }
}

export async function changeSpeakerDevice() {
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

// --- Speaker View & Gallery Grid Toggling ---
export function toggleLayoutMode() {
  state.layoutMode = (state.layoutMode === 'grid') ? 'speaker' : 'grid';
  const label = document.getElementById('layout-toggle-label');
  if (label) label.textContent = state.layoutMode === 'speaker' ? 'Speaker' : 'Gallery';
  dom.btnLayoutToggle.classList.toggle('active', state.layoutMode === 'speaker');

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

export function updateSpeakerViewLayout() {
  if (state.layoutMode !== 'speaker') return;

  // Determine target speaker ID
  // 1. Pinned participant
  let targetId = state.pinnedParticipantId;

  // 2. Screen sharing priority
  if (!targetId) {
    const screenShareTile = document.querySelector('.video-tile.screen-sharing');
    if (screenShareTile) {
      targetId = screenShareTile.dataset.participant;
    }
  }

  // 3. Host / Moderator Priority (if present)
  if (!targetId) {
    let remoteHost = null;
    state.peers.forEach((peer) => {
      if (peer.info && (peer.info.role === 'host' || peer.info.role === 'cohost')) {
        remoteHost = peer.info.participantId;
      }
    });

    if (remoteHost) {
      targetId = remoteHost;
    } else if (state.isHost || state.role === 'cohost') {
      // Local user is host, and no remote host is present.
      // Spotlight the active remote student speaker if one is talking, otherwise first remote
      if (state.activeSpeakerId && state.activeSpeakerId !== state.participantId) {
        targetId = state.activeSpeakerId;
      } else {
        const firstRemote = document.querySelector('.video-tile:not(.local-tile)');
        if (firstRemote) {
          targetId = firstRemote.dataset.participant;
        } else {
          targetId = 'local';
        }
      }
    }
  }

  // 4. Active speaker priority (fallback when no host/cohost is remote)
  if (!targetId) {
    if (state.activeSpeakerId) {
      if (state.activeSpeakerId === state.participantId) {
        targetId = 'local';
      } else {
        targetId = state.activeSpeakerId;
      }
    } else {
      const speakingTile = document.querySelector('.video-tile.speaking:not(.local-tile)');
      if (speakingTile) {
        targetId = speakingTile.dataset.participant;
      } else if (dom.localTile.classList.contains('speaking')) {
        targetId = 'local';
      }
    }
  }

  // 5. Default Fallback
  if (!targetId) {
    const firstRemote = document.querySelector('.video-tile:not(.local-tile)');
    if (firstRemote) {
      targetId = firstRemote.dataset.participant;
    } else {
      targetId = 'local';
    }
  }

  // Find the target tile
  let targetTile = document.querySelector(`.video-tile[data-participant="${targetId}"]`);
  if (!targetTile) {
    // Robust fallbacks if target is not found in DOM
    targetTile = document.querySelector('.video-tile.screen-sharing') ||
                 document.querySelector('.video-tile:not(.local-tile)') ||
                 dom.localTile;
    if (targetTile) {
      targetId = targetTile.dataset.participant;
    }
  }

  state.currentSpotlightId = targetId;

  // Render spotlight area
  if (targetTile && targetTile.parentElement !== dom.spotlightArea) {
    dom.spotlightArea.innerHTML = '';
    dom.spotlightArea.appendChild(targetTile);
    const video = targetTile.querySelector('video');
    if (video && video.paused) video.play().catch(e => {});
  }

  // Rebuild thumbnails strip
  dom.speakerThumbnails.innerHTML = '';
  const otherTiles = document.querySelectorAll(`.video-tile:not([data-participant="${targetId}"])`);
  otherTiles.forEach(tile => {
    dom.speakerThumbnails.appendChild(tile);
    const video = tile.querySelector('video');
    if (video && video.paused) video.play().catch(e => {});
  });
}

export function resetToGridView() {
  state.currentSpotlightId = null;
  const allTiles = document.querySelectorAll('.video-tile');
  allTiles.forEach(tile => {
    dom.videoGrid.appendChild(tile);
    const video = tile.querySelector('video');
    if (video && video.paused) video.play().catch(e => {});
  });
  updateVideoGridCount();
}

export function updateVideoGridCount() {
  updateVideoGridPagination();
  const visibleTiles = dom.videoGrid.querySelectorAll('.video-tile:not(.hidden-by-pagination)');
  const count = Math.min(visibleTiles.length, 12);
  dom.videoGrid.dataset.count = count;
}

export function updateVideoGridPagination() {
  const tiles = Array.from(dom.videoGrid.querySelectorAll('.video-tile'));
  const pageSize = 12;
  const totalTiles = tiles.length;
  const totalPages = Math.ceil(totalTiles / pageSize);

  if (state.galleryPage >= totalPages) {
    state.galleryPage = Math.max(0, totalPages - 1);
  }

  const startIdx = state.galleryPage * pageSize;
  const endIdx = startIdx + pageSize;

  tiles.forEach((tile, index) => {
    if (index >= startIdx && index < endIdx) {
      tile.classList.remove('hidden-by-pagination');
    } else {
      tile.classList.add('hidden-by-pagination');
    }
  });

  if (totalTiles > pageSize) {
    if (dom.galleryPaginationControls) {
      dom.galleryPaginationControls.classList.remove('hidden');
      dom.galleryPageIndicator.textContent = `Page ${state.galleryPage + 1} of ${totalPages}`;
    }
  } else {
    if (dom.galleryPaginationControls) {
      dom.galleryPaginationControls.classList.add('hidden');
    }
  }
}

export function changeGalleryPage(direction) {
  const tiles = dom.videoGrid.querySelectorAll('.video-tile');
  const pageSize = 12;
  const totalPages = Math.ceil(tiles.length / pageSize);

  state.galleryPage += direction;
  if (state.galleryPage < 0) {
    state.galleryPage = 0;
  } else if (state.galleryPage >= totalPages) {
    state.galleryPage = totalPages - 1;
  }

  updateVideoGridPagination();
  updateVideoGridCount();
}

// --- Direct Invite Link helpers ---
export function copyToClipboard(text, btn, originalLabel) {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(() => {
      if (btn) { btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = originalLabel; }, 1800); }
    }).catch(() => showLinkPrompt(text));
  } else {
    showLinkPrompt(text);
  }
}

export function showLinkPrompt(url) {
  // Remove any existing prompt
  const existing = document.getElementById('_link-modal-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = '_link-modal-overlay';
  overlay.className = 'modal-overlay';
  overlay.style.cssText = 'display:flex;z-index:9999;';

  const box = document.createElement('div');
  box.className = 'modal-box';
  box.style.maxWidth = '460px';
  box.innerHTML = `
    <h3 class="modal-title">Share Invite Link</h3>
    <p style="font-size:var(--text-xs);color:var(--text-secondary);margin-bottom:var(--sp-3);">Copy the link below and share it with anyone you want to invite.</p>
    <input id="_link-prompt-input" class="input-field" value="${url}" readonly style="margin-bottom:var(--sp-4);font-size:var(--text-xs);letter-spacing:0.01em;">
    <div class="modal-actions">
      <button class="btn btn-ghost" id="_link-close-btn">Close</button>
      <button class="btn btn-primary" id="_link-copy-btn">Copy Link</button>
    </div>`;

  overlay.appendChild(box);
  document.body.appendChild(overlay);

  const input = overlay.querySelector('#_link-prompt-input');
  const copyBtn = overlay.querySelector('#_link-copy-btn');
  const closeBtn = overlay.querySelector('#_link-close-btn');

  setTimeout(() => input.select(), 40);

  copyBtn.addEventListener('click', () => {
    input.select();
    document.execCommand('copy');
    copyBtn.textContent = 'Copied!';
    setTimeout(() => overlay.remove(), 900);
  });

  closeBtn.addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

export function copyInviteLink() {
  const inviteUrl = window.location.origin + '/?join=' + state.roomId;
  copyToClipboard(inviteUrl, dom.btnCopyInvite, 'Invite');
}

export function copyScheduledLink(id, btn) {
  const url = `${location.origin}/?join=${id}`;
  copyToClipboard(url, btn, 'Copy Link');
}

export function handleRemoteHandRaise(participantId, raised) {
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

export function updateHandIconsOnTiles() {
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

// --- Picture-in-Picture & Fullscreen Features ---

export function addPipButtonToTile(tile) {
  if (!tile || !document.pictureInPictureEnabled) return;
  if (tile.querySelector('.tile-pip-btn')) return;

  const video = tile.querySelector('video');
  if (!video) return;

  const btn = document.createElement('button');
  btn.className = 'tile-pip-btn';
  btn.title = 'Picture-in-Picture';
  btn.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2"></rect>
      <rect x="13" y="11" width="7" height="5" rx="1"></rect>
    </svg>
  `;

  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      if (document.pictureInPictureElement === video) {
        await document.exitPictureInPicture();
      } else {
        await video.requestPictureInPicture();
      }
    } catch (err) {
      console.warn('Failed to toggle Picture-in-Picture on tile video:', err);
    }
  });

  // Listen for PiP status changes to update main control button state
  video.addEventListener('enterpictureinpicture', () => {
    dom.btnPipToggle.classList.add('active');
  });
  video.addEventListener('leavepictureinpicture', () => {
    dom.btnPipToggle.classList.remove('active');
  });

  tile.appendChild(btn);
}

export async function toggleMainPip() {
  if (!document.pictureInPictureEnabled) {
    alert('Picture-in-Picture is not supported by your browser.');
    return;
  }

  // If already in picture-in-picture, exit
  if (document.pictureInPictureElement) {
    try {
      await document.exitPictureInPicture();
    } catch (err) {
      console.warn('Failed to exit Picture-in-Picture:', err);
    }
    return;
  }

  // Determine the best video element to display in PiP
  let targetVideo = null;

  // 1. Screenshare video (remote or local)
  const screenShareTile = document.querySelector('.video-tile.screen-sharing');
  if (screenShareTile) {
    targetVideo = screenShareTile.querySelector('video');
  }

  // 2. Spotlighted video (if active)
  if (!targetVideo && state.layoutMode === 'speaker') {
    const spotlightVideo = dom.spotlightArea?.querySelector('video');
    if (spotlightVideo) {
      targetVideo = spotlightVideo;
    }
  }

  // 3. Speaking participant
  if (!targetVideo) {
    const speakingTile = document.querySelector('.video-tile.speaking:not(.local-tile)');
    if (speakingTile) {
      targetVideo = speakingTile.querySelector('video');
    }
  }

  // 4. First remote participant
  if (!targetVideo) {
    const remoteTile = document.querySelector('.video-tile:not(.local-tile)');
    if (remoteTile) {
      targetVideo = remoteTile.querySelector('video');
    }
  }

  // 5. Local video
  if (!targetVideo) {
    targetVideo = dom.localVideo;
  }

  if (targetVideo) {
    try {
      await targetVideo.requestPictureInPicture();
    } catch (err) {
      console.warn('Failed to enter Picture-in-Picture:', err);
      alert('Unable to start Picture-in-Picture. Make sure the video is active and playing.');
    }
  } else {
    alert('No active video stream found to enter Picture-in-Picture mode.');
  }
}

export function toggleFullScreen() {
  const container = dom.viewMeeting;
  if (!container) return;

  if (!document.fullscreenElement) {
    container.requestFullscreen().catch(err => {
      console.error('Failed to enter Fullscreen mode:', err);
    });
  } else {
    document.exitFullscreen().catch(err => {
      console.error('Failed to exit Fullscreen mode:', err);
    });
  }
}

export function handleFullscreenChange() {
  const isFullscreen = !!document.fullscreenElement;
  dom.btnFullscreenToggle.classList.toggle('active', isFullscreen);
  
  const enterIcon = dom.btnFullscreenToggle.querySelector('.icon-enter-fullscreen');
  const exitIcon = dom.btnFullscreenToggle.querySelector('.icon-exit-fullscreen');
  
  if (isFullscreen) {
    enterIcon?.classList.add('hidden');
    exitIcon?.classList.remove('hidden');
  } else {
    enterIcon?.classList.remove('hidden');
    exitIcon?.classList.add('hidden');
  }
}

export function initFullscreenAndPip() {
  if (dom.btnPipToggle) {
    if (!document.pictureInPictureEnabled) {
      dom.btnPipToggle.style.display = 'none';
    } else {
      dom.btnPipToggle.addEventListener('click', toggleMainPip);
    }
  }

  if (dom.btnFullscreenToggle) {
    dom.btnFullscreenToggle.addEventListener('click', toggleFullScreen);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
  }

  // Automatic PiP on tab/window visibility change
  if (document.pictureInPictureEnabled) {
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState === 'hidden') {
        // Only enter auto-PiP if we are actively in a meeting and not already in PiP
        if (state.view === 'meeting' && !document.pictureInPictureElement) {
          let targetVideo = null;

          // 1. Screenshare video (remote or local)
          const screenShareTile = document.querySelector('.video-tile.screen-sharing');
          if (screenShareTile) {
            targetVideo = screenShareTile.querySelector('video');
          }

          // 2. Spotlighted video (if active)
          if (!targetVideo && state.layoutMode === 'speaker') {
            const spotlightVideo = dom.spotlightArea?.querySelector('video');
            if (spotlightVideo) {
              targetVideo = spotlightVideo;
            }
          }

          // 3. Speaking participant
          if (!targetVideo) {
            const speakingTile = document.querySelector('.video-tile.speaking:not(.local-tile)');
            if (speakingTile) {
              targetVideo = speakingTile.querySelector('video');
            }
          }

          // 4. First remote participant
          if (!targetVideo) {
            const remoteTile = document.querySelector('.video-tile:not(.local-tile)');
            if (remoteTile) {
              targetVideo = remoteTile.querySelector('video');
            }
          }

          // 5. Local video
          if (!targetVideo) {
            targetVideo = dom.localVideo;
          }

          if (targetVideo && targetVideo.readyState >= 2) {
            try {
              await targetVideo.requestPictureInPicture();
              state.autoPipVideo = targetVideo;
            } catch (err) {
              console.warn('Auto Picture-in-Picture failed:', err);
            }
          }
        }
      } else if (document.visibilityState === 'visible') {
        // Exit PiP if it was entered automatically
        if (document.pictureInPictureElement && state.autoPipVideo === document.pictureInPictureElement) {
          try {
            await document.exitPictureInPicture();
          } catch (err) {
            console.warn('Failed to exit auto-PiP:', err);
          }
          state.autoPipVideo = null;
        }
      }
    });
  }
}

// Closed Captions (Speech Recognition) Engine
let recognition = null;
export function initSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    console.warn("Speech recognition is not supported in this browser.");
    return;
  }
  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  recognition.onresult = (event) => {
    let interimTranscript = '';
    let finalTranscript = '';

    for (let i = event.resultIndex; i < event.results.length; ++i) {
      if (event.results[i].isFinal) {
        finalTranscript += event.results[i][0].transcript;
      } else {
        interimTranscript += event.results[i][0].transcript;
      }
    }

    const text = finalTranscript || interimTranscript;
    const isFinal = !!finalTranscript;
    if (text.trim() && state.captionsEnabled && state.socket) {
      state.socket.emit('speech-transcription', {
        roomId: state.roomId,
        text,
        final: isFinal
      });
    }
  };

  recognition.onerror = (event) => {
    console.warn('Speech recognition error:', event.error);
    if (event.error === 'not-allowed') {
      state.captionsEnabled = false;
      dom.btnCaptionsToggle?.classList.remove('active');
    }
  };

  recognition.onend = () => {
    if (state.captionsEnabled) {
      try {
        recognition.start();
      } catch (e) {
        console.warn('Failed to restart speech recognition:', e);
      }
    }
  };
}

export function toggleCaptions() {
  state.captionsEnabled = !state.captionsEnabled;
  dom.btnCaptionsToggle.classList.toggle('active', state.captionsEnabled);

  if (state.captionsEnabled) {
    if (!recognition) {
      initSpeechRecognition();
    }
    if (recognition) {
      try {
        recognition.start();
      } catch (e) {
        console.warn('SpeechRecognition start failed or already running:', e);
      }
    }
    displayCaption("System", "Closed captions enabled");
  } else {
    if (recognition) {
      try {
        recognition.stop();
      } catch (e) {
        console.warn('SpeechRecognition stop failed:', e);
      }
    }
    dom.captionsOverlay.classList.add('hidden');
    dom.captionsOverlay.innerHTML = '';
  }
}

export function displayCaption(senderName, text) {
  if (!dom.captionsOverlay) return;
  dom.captionsOverlay.classList.remove('hidden');
  dom.captionsOverlay.innerHTML = `<span class="caption-sender">${senderName}:</span> <span class="caption-text">${text}</span>`;
  
  if (window._captionTimeout) clearTimeout(window._captionTimeout);
  window._captionTimeout = setTimeout(() => {
    dom.captionsOverlay.classList.add('hidden');
  }, 5000);
}

// Auto-Hiding Controls (Focus Mode) Engine
let focusModeTimer = null;
export function initFocusMode() {
  const resetTimer = () => {
    if (state.view !== 'meeting') return;
    
    // Show controls (remove focus-mode class)
    dom.viewMeeting.classList.remove('focus-mode');
    
    if (focusModeTimer) clearTimeout(focusModeTimer);
    
    // Auto-hide after 4 seconds of inactivity
    focusModeTimer = setTimeout(() => {
      // If typing or if side panel is open, do not hide!
      if (document.activeElement && (
        document.activeElement.tagName === 'INPUT' || 
        document.activeElement.tagName === 'TEXTAREA' || 
        document.activeElement.tagName === 'SELECT'
      )) {
        return;
      }
      if (state.panelOpen) {
        return; 
      }
      dom.viewMeeting.classList.add('focus-mode');
    }, 4000);
  };

  // Interaction listeners
  window.addEventListener('mousemove', resetTimer);
  window.addEventListener('keydown', resetTimer);
  window.addEventListener('click', resetTimer);
  window.addEventListener('touchstart', resetTimer);
}

// Self Video Minimization
export function toggleSelfMinimization() {
  state.isLocalMinimized = !state.isLocalMinimized;
  dom.localTile.classList.toggle('local-minimized', state.isLocalMinimized);
  
  const minBtn = dom.btnLocalMinimize;
  if (minBtn) {
    if (state.isLocalMinimized) {
      minBtn.title = "Restore Self Video";
      minBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="15 3 21 3 21 9"></polyline>
          <polyline points="9 21 3 21 3 15"></polyline>
          <line x1="21" y1="3" x2="14" y2="10"></line>
          <line x1="3" y1="21" x2="10" y2="14"></line>
        </svg>
      `;
    } else {
      minBtn.title = "Minimize Self Video";
      minBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="4 14 10 14 10 20"></polyline>
          <polyline points="20 10 14 10 14 4"></polyline>
          <line x1="14" y1="10" x2="20" y2="4"></line>
          <line x1="10" y1="14" x2="4" y2="20"></line>
        </svg>
      `;
    }
  }
}

// Audio Input Level Meter in Green Room
let previewAudioContext = null;
let previewAnalyser = null;
let previewMicrophone = null;
let previewMeterInterval = null;

export function initGreenRoomMicMeter(stream) {
  if (previewMeterInterval) {
    clearInterval(previewMeterInterval);
    previewMeterInterval = null;
  }
  if (previewAudioContext) {
    previewAudioContext.close().catch(e => {});
    previewAudioContext = null;
  }

  const audioTracks = stream.getAudioTracks();
  if (!audioTracks.length) {
    resetGreenRoomMicMeter();
    return;
  }

  try {
    previewAudioContext = new (window.AudioContext || window.webkitAudioContext)();
    previewAnalyser = previewAudioContext.createAnalyser();
    previewAnalyser.fftSize = 256;
    previewMicrophone = previewAudioContext.createMediaStreamSource(stream);
    previewMicrophone.connect(previewAnalyser);

    const dataArray = new Uint8Array(previewAnalyser.frequencyBinCount);

    previewMeterInterval = setInterval(() => {
      if (!state.micEnabled) {
        resetGreenRoomMicMeter();
        return;
      }
      previewAnalyser.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
      }
      const average = sum / dataArray.length;

      const maxBars = 10;
      const activeBars = Math.min(maxBars, Math.round(average / 6));

      const bars = document.querySelectorAll('#mic-level-meter .meter-bar');
      bars.forEach((bar, idx) => {
        if (idx < activeBars) {
          if (idx < 6) {
            bar.style.backgroundColor = 'var(--accent-green)';
          } else if (idx < 8) {
            bar.style.backgroundColor = 'var(--accent-gold)';
          } else {
            bar.style.backgroundColor = 'var(--accent-coral)';
          }
        } else {
          bar.style.backgroundColor = 'transparent';
        }
      });
    }, 80);
  } catch (e) {
    console.warn('Failed to initialize green room mic meter:', e);
    resetGreenRoomMicMeter();
  }
}

export function resetGreenRoomMicMeter() {
  const bars = document.querySelectorAll('#mic-level-meter .meter-bar');
  bars.forEach(bar => {
    bar.style.backgroundColor = 'transparent';
  });
}

export function clearGreenRoomMicMeter() {
  if (previewMeterInterval) {
    clearInterval(previewMeterInterval);
    previewMeterInterval = null;
  }
  if (previewAudioContext) {
    previewAudioContext.close().catch(e => {});
    previewAudioContext = null;
  }
  resetGreenRoomMicMeter();
}

// Low-Bandwidth Mode
export function toggleDisableIncomingVideo() {
  state.disableIncomingVideo = dom.settingsIncomingVideo ? dom.settingsIncomingVideo.checked : false;

  const remoteTiles = document.querySelectorAll('.video-tile:not(.local-tile)');
  remoteTiles.forEach(tile => {
    const video = tile.querySelector('video');
    const avatar = tile.querySelector('.tile-avatar');

    if (state.disableIncomingVideo) {
      if (video) {
        video.classList.add('hidden');
        if (state.livekitConnected && state.livekitRoom) {
          const partId = tile.dataset.participant;
          const participant = state.livekitRoom.remoteParticipants.get(partId);
          if (participant) {
            participant.trackPublications.forEach(pub => {
              if (pub.track && pub.kind === 'video') {
                pub.setEnabled(false);
              }
            });
          }
        }
      }
      if (avatar) avatar.classList.remove('hidden');
    } else {
      if (video) {
        video.classList.remove('hidden');
        if (state.livekitConnected && state.livekitRoom) {
          const partId = tile.dataset.participant;
          const participant = state.livekitRoom.remoteParticipants.get(partId);
          if (participant) {
            participant.trackPublications.forEach(pub => {
              if (pub.track && pub.kind === 'video') {
                pub.setEnabled(true);
                pub.track.attach(video);
              }
            });
          }
        }
      }
      if (avatar && video && (video.srcObject || video.src)) {
        avatar.classList.add('hidden');
      }
    }
  });
}

// Tile status indicators (mic/cam icons)
export function updateAllTileStatusIndicators() {
  updateTileStatus('local', state.micEnabled, state.camEnabled);

  state.peers.forEach((peer) => {
    let mic = false;
    let cam = false;
    if (peer.stream) {
      const audioTracks = peer.stream.getAudioTracks();
      if (audioTracks.length && audioTracks[0].enabled) mic = true;
      const videoTracks = peer.stream.getVideoTracks();
      if (videoTracks.length && videoTracks[0].enabled) cam = true;
    }
    updateTileStatus(peer.info.participantId, mic, cam);
  });

  if (state.livekitConnected && state.livekitRoom) {
    state.livekitRoom.remoteParticipants.forEach((participant) => {
      let mic = false;
      let cam = false;
      const audioPub = Array.from(participant.audioTrackPublications.values()).find(pub => pub.source === 'microphone');
      if (audioPub && audioPub.isSubscribed && audioPub.track && audioPub.track.isEnabled) mic = true;
      const videoPub = Array.from(participant.videoTrackPublications.values()).find(pub => pub.source === 'camera' || pub.source === 'video');
      if (videoPub && videoPub.isSubscribed && videoPub.track && videoPub.track.isEnabled) cam = true;

      updateTileStatus(participant.identity, mic, cam);
    });
  }

  state.bots.forEach(bot => {
    updateTileStatus(bot.id, !bot.muted, true);
  });
}

export function getParticipantRole(id) {
  if (id === 'local') {
    return state.isHost ? 'host' : (state.role || 'participant');
  }
  const slidePresenterId = state.slidePresenterSocketId;
  let isPresenter = false;
  if (slidePresenterId) {
    if (slidePresenterId === id) isPresenter = true;
    const peer = state.peers.get(slidePresenterId);
    if (peer && peer.info && peer.info.participantId === id) isPresenter = true;
  }
  for (const [socketId, peer] of state.peers.entries()) {
    if (peer.info && (peer.info.participantId === id || socketId === id)) {
      if (isPresenter) return 'presenter';
      return peer.info.role || 'participant';
    }
  }
  if (isPresenter) return 'presenter';
  return 'participant';
}

export function setTileVolume(tile, volume) {
  const audios = tile.querySelectorAll('audio, video');
  audios.forEach(el => {
    el.volume = volume;
  });
}

export function addVolumeSliderToTile(tile) {
  if (!tile) return;
  if (tile.dataset.participant === 'local' || tile === dom.localTile) return;
  if (tile.querySelector('.tile-volume-container')) return;

  const container = document.createElement('div');
  container.className = 'tile-volume-container';
  container.title = 'Adjust Volume';
  
  const icon = document.createElement('span');
  icon.style.fontSize = '10px';
  icon.style.fontWeight = 'bold';
  icon.textContent = '🔊';

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '1';
  slider.step = '0.05';
  
  const partId = tile.dataset.participant;
  const savedVol = (state.individualVolumes && state.individualVolumes[partId] !== undefined)
    ? state.individualVolumes[partId]
    : 1.0;
  slider.value = savedVol;

  slider.className = 'tile-volume-slider';
  
  slider.addEventListener('input', (e) => {
    const vol = parseFloat(e.target.value);
    if (!state.individualVolumes) state.individualVolumes = {};
    state.individualVolumes[partId] = vol;
    setTileVolume(tile, vol);
  });

  container.appendChild(icon);
  container.appendChild(slider);
  tile.appendChild(container);
}

// Global BRB Status stopwatch updater
if (typeof window !== 'undefined') {
  setInterval(() => {
    if (!state.brbStates) state.brbStates = {};
    document.querySelectorAll('.video-tile').forEach(tile => {
      const partId = tile.dataset.participant;
      if (!partId) return;
      const brbTime = state.brbStates[partId];
      if (brbTime) {
        let overlay = tile.querySelector('.tile-brb-overlay');
        if (!overlay) {
          overlay = document.createElement('div');
          overlay.className = 'tile-brb-overlay';
          overlay.innerHTML = `
            <div class="brb-card">
              <div class="brb-text">☕ Away (BRB)</div>
              <div class="brb-timer">00:00</div>
            </div>
          `;
          tile.appendChild(overlay);
        }
        const elapsedSecs = Math.floor((Date.now() - brbTime) / 1000);
        const minutes = String(Math.floor(elapsedSecs / 60)).padStart(2, '0');
        const seconds = String(elapsedSecs % 60).padStart(2, '0');
        const timerEl = overlay.querySelector('.brb-timer');
        if (timerEl) timerEl.textContent = `${minutes}:${seconds}`;
      } else {
        const overlay = tile.querySelector('.tile-brb-overlay');
        if (overlay) overlay.remove();
      }
    });
  }, 1000);
}

export function updateTileStatus(id, micEnabled, camEnabled) {
  const tile = id === 'local' ? dom.localTile : document.querySelector(`.video-tile[data-participant="${id}"]`);
  if (!tile) return;

  // Toggle non-video class
  tile.classList.toggle('non-video-participant', !camEnabled);

  let indicators = tile.querySelector('.tile-status-indicators');
  if (!indicators) {
    indicators = document.createElement('div');
    indicators.className = 'tile-status-indicators';
    tile.appendChild(indicators);
  }

  indicators.innerHTML = `
    ${!micEnabled ? `
      <span class="tile-status-icon mic-muted" title="Microphone Muted">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .76-.13 1.48-.35 2.17"/></svg>
      </span>` : ''}
    ${!camEnabled ? `
      <span class="tile-status-icon cam-off" title="Camera Off">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M21 17V8l-5 2"/><rect x="2" y="3" width="15" height="14" rx="2"/></svg>
      </span>` : ''}
  `;

  // Persistent Role Badge
  let badge = tile.querySelector('.tile-role-badge');
  const role = getParticipantRole(id);
  if (role && role !== 'participant' && role !== 'simulated') {
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'tile-role-badge';
      tile.appendChild(badge);
    }
    badge.className = `tile-role-badge role-${role}`;
    badge.textContent = role;
  } else {
    if (badge) badge.remove();
  }

  // Ensure volume slider is attached (if remote)
  if (id !== 'local') {
    addVolumeSliderToTile(tile);
    const savedVol = (state.individualVolumes && state.individualVolumes[id] !== undefined)
      ? state.individualVolumes[id]
      : 1.0;
    setTileVolume(tile, savedVol);
  }
}

// Hover Pinning Shortcut
export function addPinButtonToTile(tile) {
  if (!tile) return;
  if (tile.querySelector('.tile-pin-btn')) return;

  const btn = document.createElement('button');
  btn.className = 'tile-pin-btn';
  btn.title = 'Pin Video';
  btn.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
      <circle cx="12" cy="10" r="3"></circle>
    </svg>
  `;

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const participantId = tile.dataset.participant;
    togglePinParticipant(participantId);
  });

  tile.appendChild(btn);
}

export function togglePinParticipant(participantId) {
  if (state.pinnedParticipantId === participantId) {
    state.pinnedParticipantId = null;
  } else {
    state.pinnedParticipantId = participantId;
  }

  updatePinIcons();

  if (state.layoutMode === 'speaker') {
    updateSpeakerViewLayout();
  }
}

export function updatePinIcons() {
  const tiles = document.querySelectorAll('.video-tile');
  tiles.forEach(tile => {
    const partId = tile.dataset.participant;
    const isPinned = state.pinnedParticipantId === partId;
    tile.classList.toggle('pinned', isPinned);
  });
}

// Draggable/dockable presentation video strip orchestration
export function appendTileToCorrectGridOrStrip(tile) {
  const isWbOpen = !dom.wbOverlay.classList.contains('hidden');
  const isSlidesOpen = !dom.slidesOverlay.classList.contains('hidden');

  if (isWbOpen) {
    const wbStrip = document.getElementById('wb-strip-tiles');
    if (wbStrip) wbStrip.appendChild(tile);
  } else if (isSlidesOpen) {
    const slidesStrip = document.getElementById('slides-strip-tiles');
    if (slidesStrip) slidesStrip.appendChild(tile);
  } else {
    if (state.layoutMode === 'speaker') {
      dom.speakerThumbnails.appendChild(tile);
    } else {
      dom.videoGrid.appendChild(tile);
    }
  }

  addPinButtonToTile(tile);
  updateAllTileStatusIndicators();
}

export function syncPresentationVideoStrip() {
  const isWbOpen = !dom.wbOverlay.classList.contains('hidden');
  const isSlidesOpen = !dom.slidesOverlay.classList.contains('hidden');

  let targetStripTiles = null;
  if (isWbOpen) {
    targetStripTiles = document.getElementById('wb-strip-tiles');
  } else if (isSlidesOpen) {
    targetStripTiles = document.getElementById('slides-strip-tiles');
  }

  if (targetStripTiles) {
    const tiles = document.querySelectorAll('.video-tile');
    tiles.forEach(tile => {
      targetStripTiles.appendChild(tile);
      const video = tile.querySelector('video');
      if (video && video.paused) video.play().catch(e => {});
    });
  } else {
    if (state.layoutMode === 'speaker') {
      updateSpeakerViewLayout();
    } else {
      resetToGridView();
    }
  }
}

export function makeStripDraggable(stripId) {
  const strip = document.getElementById(stripId);
  if (!strip) return;

  const header = strip.querySelector('.strip-header');
  if (!header) return;

  let isDragging = false;
  let startX = 0, startY = 0;
  let initialLeft = 0, initialTop = 0;

  header.addEventListener('pointerdown', (e) => {
    if (!strip.classList.contains('floating')) return;
    if (e.target.closest('button')) return;

    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;

    const rect = strip.getBoundingClientRect();
    initialLeft = rect.left;
    initialTop = rect.top;

    header.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  header.addEventListener('pointermove', (e) => {
    if (!isDragging) return;

    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    let newLeft = initialLeft + dx;
    let newTop = initialTop + dy;

    const maxLeft = window.innerWidth - strip.offsetWidth;
    const maxTop = window.innerHeight - strip.offsetHeight;

    newLeft = Math.max(0, Math.min(newLeft, maxLeft));
    newTop = Math.max(0, Math.min(newTop, maxTop));

    strip.style.left = `${newLeft}px`;
    strip.style.top = `${newTop}px`;
    strip.style.right = 'auto';
  });

  header.addEventListener('pointerup', (e) => {
    if (isDragging) {
      isDragging = false;
      header.releasePointerCapture(e.pointerId);
    }
  });
}

export function setupStripToggle(stripId, btnId) {
  const strip = document.getElementById(stripId);
  const btn = document.getElementById(btnId);
  if (!strip || !btn) return;

  strip.classList.add('docked');

  btn.addEventListener('click', () => {
    const isDocked = strip.classList.contains('docked');
    if (isDocked) {
      strip.classList.remove('docked');
      strip.classList.add('floating');
      btn.textContent = 'Dock';

      strip.style.top = '100px';
      strip.style.right = '20px';
      strip.style.left = 'auto';
      strip.style.width = '320px';
      strip.style.height = '240px';
    } else {
      strip.classList.remove('floating');
      strip.classList.add('docked');
      btn.textContent = 'Float';

      strip.style.top = '';
      strip.style.right = '';
      strip.style.left = '';
      strip.style.width = '';
      strip.style.height = '';
    }
    
    if (typeof resizeWhiteboard === 'function') {
      resizeWhiteboard();
    }
  });
}

export function toggleHideSelfView() {
  state.hideSelfView = dom.settingsHideSelf ? dom.settingsHideSelf.checked : false;
  if (dom.localTile) {
    dom.localTile.classList.toggle('self-view-hidden', state.hideSelfView);
  }
  localStorage.setItem('apex_hideSelfView', state.hideSelfView);
}

export function toggleHideNonVideoParticipants() {
  state.hideNonVideo = dom.settingsHideNonVideo ? dom.settingsHideNonVideo.checked : false;
  const grid = dom.videoGrid;
  if (grid) {
    grid.classList.toggle('hide-non-video-active', state.hideNonVideo);
  }
  const speakerThumbnails = dom.speakerThumbnails;
  if (speakerThumbnails) {
    speakerThumbnails.classList.toggle('hide-non-video-active', state.hideNonVideo);
  }
  localStorage.setItem('apex_hideNonVideo', state.hideNonVideo);
}

export function toggleMirrorLocalVideo() {
  state.mirrorLocalVideo = dom.settingsMirrorLocal ? dom.settingsMirrorLocal.checked : false;
  if (dom.localVideo) {
    dom.localVideo.style.transform = state.mirrorLocalVideo ? 'scaleX(-1)' : 'none';
  }
  localStorage.setItem('apex_mirrorLocalVideo', state.mirrorLocalVideo);
}

export function initPresentationVideoStrips() {
  makeStripDraggable('wb-video-strip');
  makeStripDraggable('slides-video-strip');
  setupStripToggle('wb-video-strip', 'btn-wb-strip-dock');
  setupStripToggle('slides-video-strip', 'btn-slides-strip-dock');
}

