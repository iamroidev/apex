const { v4: uuidv4 } = require('uuid');
const { verifyToken } = require('../utils/auth');
const state = require('../state');

module.exports = function(io, db, logger) {
  io.on('connection', (socket) => {
    let currentRoom = null;
    let participantInfo = null;

    socket.on('join-room', async ({ roomId, participantId, displayName, role, password, socketId }) => {
      let verifiedRole = 'participant';
      
      // Verify meeting password if needed
      try {
        const session = db.getSession(roomId);
        const scheduled = db.getScheduledMeeting(roomId);
        const stored = session || scheduled;
        if (stored && stored.password && stored.password !== password) {
          socket.emit('password-error', { roomId });
          return;
        }
      } catch (e) {}

      if (role === 'host' || role === 'cohost') {
        const cookieHeader = socket.handshake.headers.cookie || '';
        const token = cookieHeader.split(';').reduce((acc, cookie) => {
          const parts = cookie.split('=');
          if (parts[0].trim() === 'apex_session') return parts.slice(1).join('=').trim();
          return acc;
        }, null);
        const verifiedUser = verifyToken(token);
        let session = null;
        try { session = db.getSession(roomId); } catch (e) {}
        let scheduled = null;
        try { scheduled = db.getScheduledMeeting(roomId); } catch (e) {}
        if (session || scheduled) {
          const ownerId = session?.user_id || scheduled?.user_id;
          if (ownerId && verifiedUser && ownerId === verifiedUser.userId) {
            verifiedRole = role;
          } else {
            const hk = state.hostKeys.get(roomId);
            if (hk && socket.handshake.auth && socket.handshake.auth.hostKey === hk) {
              verifiedRole = role;
            } else {
              verifiedRole = 'participant';
            }
          }
        } else {
          verifiedRole = role || 'participant';
        }
      } else {
        verifiedRole = role || 'participant';
      }
      role = verifiedRole;

      if (state.lockedRooms.has(roomId) && role !== 'host') {
        socket.emit('room-locked-error', { roomId });
        return;
      }

      if (state.waitingRooms.has(roomId) && role !== 'host') {
        currentRoom = roomId + '-waiting';
        participantInfo = { participantId, displayName, role: 'participant' };
        socket.join(currentRoom);
        state.waitingSockets.set(socket.id, { socket, roomId, participantId, displayName });
        socket.emit('waiting-room-joined', { roomId });
        io.to(roomId).emit('waiting-participant-joined', { socketId: socket.id, participantId, displayName });
        return;
      }

      currentRoom = roomId;
      participantInfo = { participantId, displayName, role: role || 'participant' };
      socket.join(roomId);
      if (!state.rooms.has(roomId)) state.rooms.set(roomId, new Map());
      state.rooms.get(roomId).set(socket.id, participantInfo);

      // Check mute-on-entry for this participant
      if (state.muteOnEntry.has(roomId) && state.muteOnEntry.get(roomId).has(participantId)) {
        socket.emit('mute-command');
      }

      // Generate host key for the host
      if (role === 'host' && !state.hostKeys.has(roomId)) {
        state.hostKeys.set(roomId, uuidv4().slice(0, 6).toUpperCase());
      }
      if (role === 'host') {
        socket.emit('host-key-generated', { hostKey: state.hostKeys.get(roomId) });
      }

      try { await db.logJoin(roomId, participantId, displayName, role); } catch (e) {}

      socket.to(roomId).emit('participant-joined', { socketId: socket.id, ...participantInfo });

      const participants = [];
      state.rooms.get(roomId).forEach((info, sid) => {
        if (sid !== socket.id) participants.push({ socketId: sid, ...info });
      });
      socket.emit('room-participants', participants);

      const hrQueue = state.handRaiseQueues.get(roomId) || [];
      socket.emit('hand-raise-queue-changed', hrQueue);
      const cPerms = state.chatPermissions.get(roomId) || 'public-private';
      socket.emit('chat-permissions-changed', { permissions: cPerms });

      try {
        const paths = await db.getWhiteboardPaths(roomId);
        socket.emit('whiteboard-history', paths.map(p => JSON.parse(p)));
      } catch (e) { logger.error('Failed to load whiteboard history:', e.message); }
    });

    // WebRTC signaling
    socket.on('signal-offer', async ({ targetSocketId, offer }) => { io.to(targetSocketId).emit('signal-offer', { fromSocketId: socket.id, offer }); });
    socket.on('signal-answer', async ({ targetSocketId, answer }) => { io.to(targetSocketId).emit('signal-answer', { fromSocketId: socket.id, answer }); });
    socket.on('signal-candidate', async ({ targetSocketId, candidate }) => { io.to(targetSocketId).emit('signal-candidate', { fromSocketId: socket.id, candidate }); });

    // Chat
    socket.on('chat-message', async ({ roomId, senderId, senderName, message, targetSocketId, recipientName }) => {
      const roomPerms = state.chatPermissions.get(roomId) || 'public-private';
      const senderIsMod = state.hasModPowers(roomId, socket.id);
      if (roomPerms === 'none' && !senderIsMod) return;
      if (roomPerms === 'host-only' && !senderIsMod && !targetSocketId) return;
      if (roomPerms === 'public' && !senderIsMod && targetSocketId) return;
      
      // @mentions
      const mentions = message.match(/@(\w+)/g);
      if (mentions) {
        mentions.forEach(mention => {
          const username = mention.slice(1).toLowerCase();
          if (state.rooms.has(roomId)) {
            state.rooms.get(roomId).forEach((p, sid) => {
              if (p.displayName && p.displayName.toLowerCase().includes(username)) {
                io.to(sid).emit('chat-mention', { fromName: senderName, mention, message });
              }
            });
          }
        });
      }

      const payload = { senderId, senderName, message, timestamp: new Date().toISOString(), isPrivate: !!targetSocketId, recipientName };
      if (targetSocketId) {
        io.to(targetSocketId).emit('chat-message', payload);
        socket.emit('chat-message', payload);
      } else {
        io.to(roomId).emit('chat-message', payload);
        try { await db.saveChat(roomId, senderId, senderName, message); } catch (e) {}
      }
    });

    // Whiteboard
    socket.on('whiteboard-draw', async ({ roomId, path }) => { socket.to(roomId).emit('whiteboard-draw', { fromSocketId: socket.id, path }); try { await db.saveWhiteboardPath(roomId, JSON.stringify(path)); } catch (e) {} });
    socket.on('whiteboard-clear', async ({ roomId }) => { socket.to(roomId).emit('whiteboard-clear', {}); try { await db.clearWhiteboardPaths(roomId); } catch (e) {} });
    socket.on('whiteboard-undo', async ({ roomId }) => { try { await db.undoLastWhiteboardPath(roomId); const paths = await db.getWhiteboardPaths(roomId); io.to(roomId).emit('whiteboard-history', paths.map(p => JSON.parse(p))); } catch (e) {} });
    socket.on('rename-participant', async ({ roomId, displayName }) => { if (roomId && state.rooms.has(roomId)) { const p = state.rooms.get(roomId).get(socket.id); if (p) { p.displayName = displayName; io.to(roomId).emit('participant-renamed', { socketId: socket.id, displayName }); } } });
    socket.on('speech-transcription', async ({ roomId, text, final }) => { const room = state.rooms.get(roomId); const pInfo = room ? room.get(socket.id) : null; socket.to(roomId).emit('speech-transcription-broadcast', { senderId: socket.id, senderName: pInfo ? pInfo.displayName : 'Participant', text, final }); });
    socket.on('reaction', async ({ roomId, emoji, senderName }) => { socket.to(roomId).emit('reaction', { emoji, senderName }); });

    socket.on('hand-raise', async ({ roomId, participantId, raised }) => {
      if (!state.handRaiseQueues.has(roomId)) state.handRaiseQueues.set(roomId, []);
      let queue = state.handRaiseQueues.get(roomId);
      if (raised) {
        if (!queue.some(item => item.socketId === socket.id)) {
          const room = state.rooms.get(roomId);
          const pInfo = room ? room.get(socket.id) : null;
          queue.push({ socketId: socket.id, participantId, displayName: pInfo ? pInfo.displayName : 'Participant', timestamp: Date.now() });
        }
      } else {
        queue = queue.filter(item => item.socketId !== socket.id);
        state.handRaiseQueues.set(roomId, queue);
      }
      io.to(roomId).emit('hand-raise-queue-changed', queue);
      io.to(roomId).emit('hand-raise', { participantId, raised });
    });

    // Host & Co-Host controls
    socket.on('toggle-cohost', async ({ roomId, targetSocketId }) => { if (!state.rooms.has(roomId)) return; const room = state.rooms.get(roomId); const sender = room.get(socket.id); if (!sender || sender.role !== 'host') return; const target = room.get(targetSocketId); if (!target) return; target.role = target.role === 'cohost' ? 'participant' : 'cohost'; io.to(roomId).emit('role-changed', { socketId: targetSocketId, role: target.role }); });
    socket.on('mute-participant', async ({ roomId, targetSocketId }) => { if (!state.hasModPowers(roomId, socket.id)) return; io.to(targetSocketId).emit('mute-command'); });
    socket.on('mute-all', async ({ roomId }) => { if (!state.hasModPowers(roomId, socket.id)) return; socket.to(roomId).emit('mute-command'); });
    socket.on('kick-participant', async ({ roomId, targetSocketId }) => { if (!state.hasModPowers(roomId, socket.id)) return; io.to(targetSocketId).emit('kick-command'); });

    // End Meeting For All
    socket.on('end-meeting-for-all', async ({ roomId }) => {
      if (!state.hasModPowers(roomId, socket.id)) return;
      const room = state.rooms.get(roomId);
      if (room) {
        room.forEach((info, sid) => { io.to(sid).emit('meeting-ended-by-host'); });
      }
      try { await db.endSession(roomId); } catch (e) { logger.error({ err: e }, 'Failed to end session'); }
      state.cleanupRoomIfEmpty(roomId, logger);
    });

    // Mute on Entry per participant
    socket.on('toggle-mute-on-entry', async ({ roomId, participantId }) => {
      if (!state.hasModPowers(roomId, socket.id)) return;
      if (!state.muteOnEntry.has(roomId)) state.muteOnEntry.set(roomId, new Set());
      const s = state.muteOnEntry.get(roomId);
      if (s.has(participantId)) s.delete(participantId);
      else s.add(participantId);
      io.to(roomId).emit('mute-on-entry-changed', { participantId, enabled: s.has(participantId) });
    });

    socket.on('lower-hand', async ({ roomId, targetParticipantId }) => {
      if (!state.hasModPowers(roomId, socket.id)) return;
      let queue = state.handRaiseQueues.get(roomId);
      if (queue) { queue = queue.filter(item => item.participantId !== targetParticipantId); state.handRaiseQueues.set(roomId, queue); io.to(roomId).emit('hand-raise-queue-changed', queue); }
      io.to(roomId).emit('hand-raise', { participantId: targetParticipantId, raised: false });
    });
    socket.on('stop-video-participant', async ({ roomId, targetSocketId }) => { if (!state.hasModPowers(roomId, socket.id)) return; io.to(targetSocketId).emit('stop-video-command'); });
    socket.on('ask-unmute-participant', async ({ roomId, targetSocketId }) => { if (!state.hasModPowers(roomId, socket.id)) return; io.to(targetSocketId).emit('unmute-request-prompt'); });

    // Security toggles
    socket.on('lock-room', async ({ roomId, locked }) => { if (!state.hasModPowers(roomId, socket.id)) return; if (locked) state.lockedRooms.add(roomId); else state.lockedRooms.delete(roomId); io.to(roomId).emit('room-lock-changed', { locked }); });
    socket.on('toggle-waiting-room', async ({ roomId, enabled }) => { if (!state.hasModPowers(roomId, socket.id)) return; if (enabled) state.waitingRooms.add(roomId); else state.waitingRooms.delete(roomId); io.to(roomId).emit('waiting-room-changed', { enabled }); });
    socket.on('spotlight-participants', async ({ roomId, targetSocketIds }) => { if (!state.hasModPowers(roomId, socket.id)) return; state.spotlightQueue.set(roomId, targetSocketIds || []); io.to(roomId).emit('spotlight-updated', { spotlightSocketIds: targetSocketIds || [] }); });

    socket.on('waiting-admit', async ({ roomId, targetSocketId }) => {
      if (!state.hasModPowers(roomId, socket.id)) return;
      const waitingInfo = state.waitingSockets.get(targetSocketId);
      if (!waitingInfo) return;
      const { socket: targetSocket, participantId, displayName } = waitingInfo;
      state.waitingSockets.delete(targetSocketId);
      targetSocket.leave(roomId + '-waiting');
      targetSocket.join(roomId);
      targetSocket.currentRoom = roomId;
      const role = 'participant';
      const info = { participantId, displayName, role };
      if (!state.rooms.has(roomId)) state.rooms.set(roomId, new Map());
      state.rooms.get(roomId).set(targetSocketId, info);
      try { await db.logJoin(roomId, participantId, displayName, role); } catch (e) {}
      targetSocket.emit('waiting-admitted', { roomId });
      targetSocket.to(roomId).emit('participant-joined', { socketId: targetSocketId, ...info });
      const participants = []; state.rooms.get(roomId).forEach((i, sid) => { if (sid !== targetSocketId) participants.push({ socketId: sid, ...i }); });
      targetSocket.emit('room-participants', participants);
      targetSocket.emit('hand-raise-queue-changed', state.handRaiseQueues.get(roomId) || []);
      targetSocket.emit('chat-permissions-changed', { permissions: state.chatPermissions.get(roomId) || 'public-private' });
      try { const paths = await db.getWhiteboardPaths(roomId); targetSocket.emit('whiteboard-history', paths.map(p => JSON.parse(p))); } catch (e) {}
      io.to(roomId).emit('waiting-participant-left', { socketId: targetSocketId });
    });

    socket.on('waiting-decline', async ({ roomId, targetSocketId }) => {
      if (!state.hasModPowers(roomId, socket.id)) return;
      const waitingInfo = state.waitingSockets.get(targetSocketId);
      if (!waitingInfo) return;
      state.waitingSockets.delete(targetSocketId);
      waitingInfo.socket.emit('waiting-declined');
      waitingInfo.socket.disconnect();
      io.to(roomId).emit('waiting-participant-left', { socketId: targetSocketId });
    });

    // Polling
    socket.on('poll-create', async ({ roomId, poll }) => { if (!state.hasModPowers(roomId, socket.id)) return; socket.to(roomId).emit('poll-created', poll); });
    socket.on('poll-vote', async ({ roomId, pollId, optionIndex, voterName }) => { io.to(roomId).emit('poll-voted', { pollId, optionIndex, voterName, socketId: socket.id }); });
    socket.on('poll-end', async ({ roomId, pollId, results }) => { if (!state.hasModPowers(roomId, socket.id)) return; io.to(roomId).emit('poll-ended', { pollId, results }); });

    // Breakout rooms
    socket.on('create-breakout', async ({ roomId, groups }) => { if (!state.hasModPowers(roomId, socket.id)) return; io.to(roomId).emit('breakout-created', { groups }); });
    socket.on('breakout-start', async ({ roomId, rooms: breakoutRooms, duration, allowSelfSelect }) => {
      if (!state.hasModPowers(roomId, socket.id)) return;
      io.to(roomId).emit('breakout-started-broadcast', { rooms: breakoutRooms, duration, allowSelfSelect });
      breakoutRooms.forEach(r => { r.participantSocketIds.forEach(sid => { io.to(sid).emit('breakout-assigned', { roomName: r.roomName, duration }); }); });
    });
    socket.on('breakout-end', async ({ roomId, roomCount }) => { if (!state.hasModPowers(roomId, socket.id)) return; for (let i = 1; i <= roomCount; i++) io.to(`${roomId}-breakout-${i}`).emit('breakout-ended'); });
    socket.on('breakout-broadcast-message', async ({ roomId, message, roomCount }) => { if (!state.hasModPowers(roomId, socket.id)) return; io.to(roomId).emit('breakout-broadcast-received', { message }); for (let i = 1; i <= roomCount; i++) io.to(`${roomId}-breakout-${i}`).emit('breakout-broadcast-received', { message }); });

    // Annotation
    socket.on('annotation-draw', async ({ roomId, path }) => { socket.to(roomId).emit('annotation-draw', { fromSocketId: socket.id, path }); });
    socket.on('annotation-clear', async ({ roomId }) => { io.to(roomId).emit('annotation-clear'); });
    socket.on('screenshare-start', async ({ roomId }) => { socket.to(roomId).emit('screenshare-started', { fromSocketId: socket.id }); });
    socket.on('screenshare-stop', async ({ roomId }) => { socket.to(roomId).emit('screenshare-stopped', { fromSocketId: socket.id }); });
    socket.on('screenshare-grant-control', async ({ roomId, targetSocketId }) => { if (!state.hasModPowers(roomId, socket.id)) return; state.screenShareControllers.set(roomId, { presenterSocketId: socket.id, controllerSocketId: targetSocketId }); io.to(targetSocketId).emit('screenshare-control-granted', { presenterSocketId: socket.id }); });
    socket.on('screenshare-revoke-control', async ({ roomId }) => { if (!state.hasModPowers(roomId, socket.id)) return; const sc = state.screenShareControllers.get(roomId); if (sc) io.to(sc.controllerSocketId).emit('screenshare-control-revoked'); state.screenShareControllers.delete(roomId); });
    socket.on('video-filter-change', async ({ roomId, filter }) => { socket.to(roomId).emit('video-filter-changed', { socketId: socket.id, filter }); });

    // Slides
    socket.on('slide-share-start', async ({ roomId, slideIndex, slides }) => { if (!state.hasModPowers(roomId, socket.id)) return; io.to(roomId).emit('slide-share-started', { presenterSocketId: socket.id, slideIndex, slides }); });
    socket.on('slide-share-stop', async ({ roomId }) => { if (!state.hasModPowers(roomId, socket.id)) return; state.slideControllers.delete(roomId); io.to(roomId).emit('slide-share-stopped'); });
    socket.on('slide-change', async ({ roomId, slideIndex }) => { const isMod = state.hasModPowers(roomId, socket.id); const hasControl = state.slideControllers.get(roomId) === socket.id; if (!isMod && !hasControl) return; io.to(roomId).emit('slide-changed', { slideIndex }); });
    socket.on('slide-grant-control', async ({ roomId, targetSocketId }) => { if (!state.hasModPowers(roomId, socket.id)) return; state.slideControllers.set(roomId, targetSocketId); io.to(roomId).emit('slide-control-granted', { targetSocketId }); });
    socket.on('slide-revoke-control', async ({ roomId }) => { if (!state.hasModPowers(roomId, socket.id)) return; state.slideControllers.delete(roomId); io.to(roomId).emit('slide-control-revoked'); });

    const VALID_PERMISSIONS = ['none', 'host-only', 'public', 'public-private'];
    socket.on('change-chat-permissions', async ({ roomId, permissions }) => { if (!state.hasModPowers(roomId, socket.id)) return; if (!VALID_PERMISSIONS.includes(permissions)) return; state.chatPermissions.set(roomId, permissions); io.to(roomId).emit('chat-permissions-changed', { permissions }); });
    socket.on('participant-status-change', async ({ roomId, participantId, isBrb, brbTime }) => { socket.to(roomId).emit('participant-status-changed', { socketId: socket.id, participantId, isBrb, brbTime }); });
    socket.on('virtual-background-change', async ({ roomId, bgType, bgValue }) => { socket.to(roomId).emit('virtual-background-changed', { socketId: socket.id, bgType, bgValue }); });
    socket.on('whiteboard-laser', async ({ roomId, x, y, isStart }) => { socket.to(roomId).emit('whiteboard-laser', { socketId: socket.id, x, y, isStart }); });
    socket.on('mute-all-except-presenter', async ({ roomId, presenterSocketId }) => { if (!state.hasModPowers(roomId, socket.id)) return; socket.to(roomId).emit('mute-all-except-presenter-command', { presenterSocketId }); });

    // Leave room
    socket.on('leave-room', async ({ roomId }) => {
      if (currentRoom && state.rooms.has(currentRoom)) {
        state.rooms.get(currentRoom).delete(socket.id);
        socket.to(currentRoom).emit('participant-left', { socketId: socket.id });
        if (participantInfo) { try { await db.logLeave(currentRoom, participantInfo.participantId); } catch (e) { logger.error(e, 'Failed to log leave'); } }
        let queue = state.handRaiseQueues.get(currentRoom);
        if (queue) { queue = queue.filter(item => item.socketId !== socket.id); state.handRaiseQueues.set(currentRoom, queue); io.to(currentRoom).emit('hand-raise-queue-changed', queue); }
        state.cleanupRoomIfEmpty(currentRoom, logger);
        currentRoom = null; participantInfo = null;
      }
      socket.leave(roomId);
    });

    // Disconnect
    socket.on('disconnect', async () => {
      if (state.waitingSockets.has(socket.id)) {
        const { roomId } = state.waitingSockets.get(socket.id);
        state.waitingSockets.delete(socket.id);
        io.to(roomId).emit('waiting-participant-left', { socketId: socket.id });
      }
      if (currentRoom && state.rooms.has(currentRoom)) {
        state.rooms.get(currentRoom).delete(socket.id);
        socket.to(currentRoom).emit('participant-left', { socketId: socket.id });
        if (participantInfo) { try { await db.logLeave(currentRoom, participantInfo.participantId); } catch (e) { logger.error(e, 'Failed to log leave on disconnect'); } }
        let queue = state.handRaiseQueues.get(currentRoom);
        if (queue) { queue = queue.filter(item => item.socketId !== socket.id); state.handRaiseQueues.set(currentRoom, queue); io.to(currentRoom).emit('hand-raise-queue-changed', queue); }
        state.cleanupRoomIfEmpty(currentRoom, logger);
      }
    });
  });
};