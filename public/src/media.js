// public/src/media.js — Media Capture, device management, layouts, grid pagination
import { state, dom, formatTime, playVoicePrompt } from './core.js';
import { createLiveKitTile } from './livekit.js';
import { createRemoteTile, connectToRoom } from './webrtc.js';
import { onScreenShareActive } from './main.js'; // imported from main.js orchestrator

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
    
    // Apply initial mute/hidden state from preview green room
    state.localStream.getAudioTracks().forEach(t => t.enabled = state.micEnabled);
    dom.btnMic.classList.toggle('muted', !state.micEnabled);
    
    state.localStream.getVideoTracks().forEach(t => t.enabled = state.camEnabled);
    dom.btnCam.classList.toggle('muted', !state.camEnabled);
    dom.localAvatar.classList.toggle('hidden', state.camEnabled);
    
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

export function startLocalAudioAnalysis() {
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

  if (targetId !== state.currentSpotlightId) {
    state.currentSpotlightId = targetId;
    
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

