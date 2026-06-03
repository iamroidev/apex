// public/src/livekit.js — LiveKit Client SFU wrapper room connection and events
import { state, dom, escapeHtml } from './core.js';
import { getCSSFilter, updateVideoGridCount, addPipButtonToTile } from './media.js';

export async function connectToLiveKit(wsUrl, token) {
  try {
    const room = new LivekitClient.Room({
      adaptiveStream: true,
      dynacast: true,
      publishDefaults: {
        videoSimulcast: true,
        screenShareSimulcast: true
      }
    });
    state.livekitRoom = room;
    state.livekitConnected = true;

    room.on(LivekitClient.RoomEvent.TrackSubscribed, (track, publication, participant) => {
      if (track.kind === 'video') {
        createLiveKitTile(participant.identity, participant.name);
        const tile = document.querySelector(`.video-tile[data-participant="${participant.identity}"]`);
        if (tile) {
          const video = tile.querySelector('video');
          if (video) {
            track.attach(video);
            tile.querySelector('.tile-avatar').classList.add('hidden');
            
            if (publication.source === 'screen_share') {
              tile.classList.add('screen-sharing');
            }
            
            const peer = [...state.peers.values()].find(p => p.info.participantId === participant.identity);
            if (peer && peer.info.videoFilter) {
              video.style.filter = getCSSFilter(peer.info.videoFilter);
            }
          }
        }
        updateVideoGridCount();
      } else if (track.kind === 'audio') {
        createLiveKitTile(participant.identity, participant.name);
        const tile = document.querySelector(`.video-tile[data-participant="${participant.identity}"]`);
        if (tile) {
          let audio = tile.querySelector('audio');
          if (!audio) {
            audio = document.createElement('audio');
            audio.autoplay = true;
            tile.appendChild(audio);
          }
          track.attach(audio);
        }
      }
    });

    room.on(LivekitClient.RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
      track.detach();
      if (publication.source === 'screen_share') {
        const tile = document.querySelector(`.video-tile[data-participant="${participant.identity}"]`);
        if (tile) {
          tile.classList.remove('screen-sharing');
          const cameraPub = Array.from(participant.trackPublications.values()).find(pub => pub.source === 'camera' || pub.source === 'video');
          if (cameraPub && cameraPub.track) {
            const video = tile.querySelector('video');
            if (video) {
              cameraPub.track.attach(video);
            }
          } else {
            tile.querySelector('.tile-avatar').classList.remove('hidden');
          }
        }
      } else if (track.kind === 'video') {
        const tile = document.querySelector(`.video-tile[data-participant="${participant.identity}"]`);
        if (tile) {
          tile.querySelector('.tile-avatar').classList.remove('hidden');
        }
      }
    });

    room.on(LivekitClient.RoomEvent.ActiveSpeakersChanged, (speakers) => {
      const remoteTiles = dom.videoGrid.querySelectorAll('.video-tile:not(.local-tile)');
      remoteTiles.forEach(t => t.classList.remove('speaking'));
      
      speakers.forEach(speaker => {
        if (speaker.identity === state.participantId) {
          dom.localTile.classList.add('speaking');
        } else {
          const tile = document.querySelector(`.video-tile[data-participant="${speaker.identity}"]`);
          if (tile) tile.classList.add('speaking');
        }
      });
    });

    room.on(LivekitClient.RoomEvent.ParticipantConnected, (participant) => {
      createLiveKitTile(participant.identity, participant.name);
      updateVideoGridCount();
    });

    room.on(LivekitClient.RoomEvent.ParticipantDisconnected, (participant) => {
      const tile = document.querySelector(`.video-tile[data-participant="${participant.identity}"]`);
      if (tile) tile.remove();
      updateVideoGridCount();
    });

    await room.connect(wsUrl, token);
    console.log('Connected to LiveKit Room:', room.name);

    room.remoteParticipants.forEach((participant) => {
      createLiveKitTile(participant.identity, participant.name);
      participant.trackPublications.forEach((pub) => {
        if (pub.isSubscribed && pub.track) {
          const tile = document.querySelector(`.video-tile[data-participant="${participant.identity}"]`);
          if (tile) {
            const video = tile.querySelector('video');
            if (video && pub.track.kind === 'video') {
              pub.track.attach(video);
              tile.querySelector('.tile-avatar').classList.add('hidden');
            }
          }
        }
      });
    });
    updateVideoGridCount();

    if (state.localStream) {
      const videoTrack = state.localStream.getVideoTracks()[0];
      if (videoTrack && state.camEnabled) {
        await room.localParticipant.publishTrack(videoTrack, { name: 'camera' });
      }
      const audioTrack = state.localStream.getAudioTracks()[0];
      if (audioTrack && state.micEnabled) {
        await room.localParticipant.publishTrack(audioTrack, { name: 'microphone' });
      }
    }
  } catch (e) {
    console.error('Error connecting to LiveKit room:', e);
    state.sandboxMode = true;
    state.livekitConnected = false;
    state.livekitRoom = null;
    alert('Failed to connect to media server. Running in fallback mode.');
  }
}

export function createLiveKitTile(participantId, displayName) {
  if (document.querySelector(`.video-tile[data-participant="${participantId}"]`)) return;
  
  const tile = document.createElement('div');
  tile.className = 'video-tile';
  tile.dataset.participant = participantId;
  
  const video = document.createElement('video');
  video.autoplay = true;
  video.playsInline = true;
  tile.appendChild(video);
  
  const overlay = document.createElement('div');
  overlay.className = 'tile-overlay';
  overlay.innerHTML = `
    <span class="tile-name">${escapeHtml(displayName || 'Participant')}</span>
    <span class="tile-speaking-indicator"></span>
  `;
  tile.appendChild(overlay);
  
  const avatar = document.createElement('div');
  avatar.className = 'tile-avatar';
  avatar.innerHTML = `<span class="avatar-letter">${(displayName || 'P').charAt(0).toUpperCase()}</span>`;
  tile.appendChild(avatar);
  
  dom.videoGrid.appendChild(tile);
  addPipButtonToTile(tile);
}
