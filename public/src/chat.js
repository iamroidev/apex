// public/src/chat.js — Chat Message handling, private DMs, file attachments download and upload
import { state, dom, escapeHtml, genId } from './core.js';

export function bindChat() {
  dom.btnSendChat.addEventListener('click', sendChat);
  dom.chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChat();
    }
  });
}

export function sendChat() {
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

export function appendChatMessage(name, text, isSelf, timestamp, isPrivate = false, recipientName = null) {
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

export function handleFileSelect(e) {
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

export function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export function downloadFile(fileId) {
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
