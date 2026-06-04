// public/src/chat.js — Chat Message handling, private DMs, file attachments download and upload
import { state, dom, escapeHtml, genId } from './core.js';
import { playChime } from './main.js';

const EMOJI_LIST = ['😀','😁','😂','🤣','😃','😄','😅','😆','😉','😊','😋','😎','😍','🥰','😘','😜','😝','🤗','🤔','🤩','🙄','😏','😒','😔','😞','😟','😠','😡','😢','😭','😤','😱','😨','😰','😥','😓','🤯','😳','🥵','🥶','😶‍🌫️','😱','🤬','😈','👿','💀','☠️','💩','🤡','👹','👺','👻','💀','☠️','👽','👾','🤖','🎃','😺','😸','😹','😻','😼','😽','🙀','😿','😾','💋','👋','🤚','🖐️','✋','🖖','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','🖕','👇','👍','👎','👊','✊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏','💪','🦵','🦶','👂','🦻','👃','🧠','🦷','🦴','👀','👁️','👅','👄','💘','❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','☮️','✝️','☪️','🕉️','☸️','✡️','🔯','🕎','☯️','🦸','🦹','🧑‍🎤','🧑‍🏫','🧑‍💻','🧑‍🔬','🧑‍🎨','🧑‍🚀','🧑‍✈️','👮','🕵️','👨‍⚕️','👩‍⚕️','👨‍🎓','👩‍🎓','👨‍🏫','👩‍🏫','👨‍💻','👩‍💻','👨‍🔧','👩‍🔧','🎉','🎊','🎈','🎁','🏆','🥇','🥈','🥉','🏅','🎖️','🏵️','🎗️','🎪','🎭','🎨','🎬','🎤','🎧','🎼','🎹','🥁','🎷','🎺','🎸','🪕','🎻','🎲','♟️','🎯','🎳','🎮','🕹️','🎰','🎲','🧩','♠️','♥️','♦️','♣️','🃏','🀄','🎴','🌍','🌎','🌏','🌐','🗺️','🧭','🏔️','⛰️','🌋','🗻','🏕️','🏖️','🏜️','🏝️','🏞️','🏟️','🏛️','🏗️','🧱','🪨','🪵','🛖','🏘️','🏚️','🏠','🏡','🏢','🏣','🏤','🏥','🏦','🏨','🏩','🏪','🏫','🏬','🏭','🏯','🏰','💒','🗼','🗽','⛪','🕌','🛕','🕍','⛩️','🕋','⛲','⛺','🌁','🌃','🏙️','🌄','🌅','🌆','🌇','🌉','🌌','🌠','🎇','🎆','🌈','🏳️‍🌈','🏴‍☠️','🇺🇳','🇺🇸','🇬🇧','🇫🇷','🇩🇪','🇮🇹','🇪🇸','🇯🇵','🇨🇳','🇷🇺','🇧🇷','🇮🇳','🇦🇺','🇨🇦','🇰🇷','🇸🇦','🇿🇦','🇳🇬','🇰🇪','🇬🇭'];

export function bindChat() {
  dom.btnSendChat.addEventListener('click', sendChat);
  dom.chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChat();
    }
  });

  if (dom.chatSearchInput) {
    dom.chatSearchInput.addEventListener('input', (e) => {
      filterChatMessages(e.target.value);
    });
  }

  // Build emoji picker
  buildEmojiPicker();

  // Bind @mention autocomplete
  bindMentionAutocomplete();
}

function buildEmojiPicker() {
  const emojiPicker = document.createElement('div');
  emojiPicker.id = 'emoji-picker';
  emojiPicker.style.cssText = `
    display: none;
    position: absolute;
    bottom: 50px;
    left: 12px;
    width: 300px;
    height: 200px;
    background: var(--bg-surface);
    border: 2px solid var(--border-strong);
    box-shadow: var(--neo-shadow-md);
    overflow-y: auto;
    z-index: 100;
    padding: 8px;
    display: grid;
    grid-template-columns: repeat(8, 1fr);
    gap: 2px;
  `;
  
  EMOJI_LIST.forEach(emoji => {
    const btn = document.createElement('button');
    btn.textContent = emoji;
    btn.type = 'button';
    btn.style.cssText = 'background:transparent;border:none;cursor:pointer;font-size:18px;padding:2px;border-radius:4px;transition:background 0.1s;';
    btn.addEventListener('mouseenter', () => btn.style.background = 'var(--bg-hover)');
    btn.addEventListener('mouseleave', () => btn.style.background = 'transparent');
    btn.addEventListener('click', () => {
      dom.chatInput.value += emoji;
      dom.chatInput.focus();
      emojiPicker.style.display = 'none';
    });
    emojiPicker.appendChild(btn);
  });

  // Emoji toggle button next to chat input
  const emojiBtn = document.createElement('button');
  emojiBtn.className = 'btn-icon';
  emojiBtn.title = 'Emoji Picker';
  emojiBtn.innerHTML = '😊';
  emojiBtn.style.cssText = 'height:38px;width:38px;flex-shrink:0;padding:0;margin-right:4px;font-size:18px;';
  emojiBtn.addEventListener('click', () => {
    const isVisible = emojiPicker.style.display === 'grid';
    emojiPicker.style.display = isVisible ? 'none' : 'grid';
    emojiPicker.style.bottom = '50px';
    emojiPicker.style.left = '12px';
  });

  // Insert emoji button before file attach button
  if (dom.btnChatAttach && dom.btnChatAttach.parentNode) {
    dom.btnChatAttach.parentNode.insertBefore(emojiBtn, dom.btnChatAttach);
    dom.btnChatAttach.parentNode.appendChild(emojiPicker);
  }

  // Close on click outside
  document.addEventListener('click', (e) => {
    if (!emojiPicker.contains(e.target) && e.target !== emojiBtn) {
      emojiPicker.style.display = 'none';
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

export function formatMessageText(text) {
  let escapedText = escapeHtml(text);
  
  // Highlight @mentions
  const mentionRegex = /@(\w+)/g;
  escapedText = escapedText.replace(mentionRegex, (match, username) => {
    const localUsername = (state.userName || 'You').toLowerCase().replace(/\s+/g, '_');
    const isMe = localUsername.includes(username.toLowerCase()) || username.toLowerCase().includes(localUsername);
    if (isMe) {
      return `<span class="chat-mention-tag me" style="background: var(--accent-cyan-dim); color: var(--text-accent-cyan); font-weight: 700; padding: 1px 4px; border: 2px solid var(--accent-cyan); border-radius: var(--radius-sm);">@${username}</span>`;
    }
    return `<span class="chat-mention-tag" style="background: var(--bg-hover); color: var(--text-secondary); font-weight: 500; padding: 1px 4px; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm);">@${username}</span>`;
  });
  
  // Format code blocks: ```code```
  const codeBlockRegex = /```([\s\S]*?)```/g;
  escapedText = escapedText.replace(codeBlockRegex, (match, code) => {
    const copyId = 'copy-' + genId();
    if (!window._copyTexts) window._copyTexts = {};
    window._copyTexts[copyId] = code.trim();
    
    return `
      <div class="chat-copy-container" style="position: relative; margin: var(--sp-2) 0; background: var(--bg-elevated); border: 1px solid var(--border-strong); padding: var(--sp-2); border-radius: var(--radius-sm); font-family: monospace; white-space: pre-wrap; font-size: var(--text-xs); color: var(--accent-cyan); padding-top: var(--sp-6);">
        <button class="chat-copy-btn" onclick="window._apex.copyChatText('${copyId}', this)">Copy</button>
        <code>${code.trim()}</code>
      </div>
    `;
  });

  // Format inline code: `code`
  const inlineCodeRegex = /`([^`]+)`/g;
  escapedText = escapedText.replace(inlineCodeRegex, (match, code) => {
    return `<code style="font-family: monospace; background: var(--bg-elevated); padding: 2px 4px; border-radius: var(--radius-xs); font-size: 0.9em; color: var(--accent-cyan); border: 1px solid var(--border-subtle);">${code}</code>`;
  });

  // Format URLs
  const urlRegex = /(https?:\/\/[^\s<]+)/g;
  escapedText = escapedText.replace(urlRegex, (url) => {
    const copyId = 'copy-' + genId();
    if (!window._copyTexts) window._copyTexts = {};
    window._copyTexts[copyId] = url;
    
    return `
      <span class="chat-copy-container" style="position: relative; display: inline-block;">
        <a href="${url}" target="_blank" rel="noopener noreferrer" style="color: var(--accent-cyan); text-decoration: underline; word-break: break-all;">${url}</a>
        <button class="chat-copy-btn" style="position: static; display: inline-block; margin-left: 6px; padding: 1px 3px; font-size: 8px; vertical-align: middle;" onclick="window._apex.copyChatText('${copyId}', this)">Copy</button>
      </span>
    `;
  });

  return escapedText;
}

export function filterChatMessages(query) {
  const q = query.toLowerCase().trim();
  const messages = dom.chatMessages.querySelectorAll('.chat-msg');
  messages.forEach(msg => {
    const textEl = msg.querySelector('.chat-msg-text');
    const fileEl = msg.querySelector('.chat-file-name');
    const nameEl = msg.querySelector('.chat-msg-name');
    
    let content = '';
    if (textEl) content += textEl.textContent.toLowerCase();
    if (fileEl) content += fileEl.textContent.toLowerCase();
    if (nameEl) content += nameEl.textContent.toLowerCase();
    
    if (content.includes(q)) {
      msg.classList.remove('hidden-by-search');
    } else {
      msg.classList.add('hidden-by-search');
    }
  });
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
    const formattedText = formatMessageText(text);
    contentHtml = `
      <div class="chat-msg-name" style="${isPrivate ? 'color: var(--accent-lavender);' : ''}">${nameLabel}</div>
      <div class="chat-msg-text">${formattedText}</div>
      <div class="chat-msg-time">${time}</div>
    `;
  }

  div.innerHTML = contentHtml;
  dom.chatMessages.appendChild(div);
  dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;

  if (!isSelf) {
    playChime('chat');
  }
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

export function copyChatText(copyId, btn) {
  const text = window._copyTexts?.[copyId];
  if (!text) return;
  
  navigator.clipboard.writeText(text).then(() => {
    const originalText = btn.textContent;
    btn.textContent = 'Copied!';
    btn.style.background = 'var(--accent-green, #39ff14)';
    btn.style.color = '#000';
    setTimeout(() => {
      btn.textContent = originalText;
      btn.style.background = '';
      btn.style.color = '';
    }, 1500);
  }).catch(err => {
    console.warn('Failed to copy chat text:', err);
  });
}

export function bindMentionAutocomplete() {
  const input = dom.chatInput;
  if (!input) return;

  const autocomplete = document.createElement('div');
  autocomplete.id = 'mention-autocomplete';
  autocomplete.style.cssText = `
    display: none;
    position: absolute;
    bottom: 54px;
    left: 8px;
    right: 8px;
    background: var(--bg-surface);
    border: 2px solid var(--border-strong);
    box-shadow: var(--neo-shadow-sm);
    z-index: 1000;
    max-height: 120px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  `;
  
  const chatInputRow = input.closest('.chat-input-row');
  if (chatInputRow) {
    chatInputRow.parentNode.style.position = 'relative';
    chatInputRow.parentNode.insertBefore(autocomplete, chatInputRow);
  }

  let selectedIndex = -1;
  let matches = [];

  function getMentionQuery() {
    const text = input.value;
    const caretPos = input.selectionStart;
    const textBeforeCaret = text.slice(0, caretPos);
    const lastWord = textBeforeCaret.split(/\s+/).pop();
    if (lastWord.startsWith('@')) {
      return {
        query: lastWord.slice(1),
        startIdx: caretPos - lastWord.length
      };
    }
    return null;
  }

  input.addEventListener('input', () => {
    const mention = getMentionQuery();
    if (!mention) {
      autocomplete.style.display = 'none';
      return;
    }

    const query = mention.query.toLowerCase();
    const peersList = Array.from(state.peers.values()).map(p => p.info.displayName);
    const botsList = state.bots.map(b => b.name);
    const candidates = [...new Set([...peersList, ...botsList])];
    
    matches = candidates.filter(name => name.toLowerCase().includes(query));
    if (matches.length === 0) {
      autocomplete.style.display = 'none';
      return;
    }

    renderMatches(mention.startIdx);
  });

  function renderMatches(startIdx) {
    autocomplete.innerHTML = '';
    autocomplete.style.display = 'flex';
    selectedIndex = 0;

    matches.forEach((name, idx) => {
      const item = document.createElement('div');
      item.textContent = `@${name}`;
      item.style.cssText = `
        padding: var(--sp-2) var(--sp-3);
        cursor: pointer;
        font-size: var(--text-xs);
        font-family: var(--font);
        color: var(--text-primary);
        background: ${idx === 0 ? 'var(--bg-hover)' : 'transparent'};
        border-bottom: 1px solid var(--border-subtle);
      `;
      
      item.addEventListener('mouseenter', () => {
        selectedIndex = idx;
        updateSelection();
      });

      item.addEventListener('click', () => {
        selectName(name, startIdx);
      });

      autocomplete.appendChild(item);
    });
  }

  function updateSelection() {
    Array.from(autocomplete.children).forEach((child, idx) => {
      child.style.background = idx === selectedIndex ? 'var(--bg-hover)' : 'transparent';
    });
  }

  function selectName(name, startIdx) {
    const text = input.value;
    const caretPos = input.selectionStart;
    const beforeMention = text.slice(0, startIdx);
    const afterMention = text.slice(caretPos);
    
    const formattedName = name.replace(/\s+/g, '_');
    
    input.value = `${beforeMention}@${formattedName} ${afterMention}`;
    input.focus();
    const newCaretPos = startIdx + formattedName.length + 2;
    input.setSelectionRange(newCaretPos, newCaretPos);
    autocomplete.style.display = 'none';
  }

  input.addEventListener('keydown', (e) => {
    if (autocomplete.style.display === 'flex') {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedIndex = (selectedIndex + 1) % matches.length;
        updateSelection();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedIndex = (selectedIndex - 1 + matches.length) % matches.length;
        updateSelection();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (matches[selectedIndex]) {
          const mention = getMentionQuery();
          if (mention) selectName(matches[selectedIndex], mention.startIdx);
        }
      } else if (e.key === 'Escape') {
        autocomplete.style.display = 'none';
      }
    }
  });

  document.addEventListener('click', (e) => {
    if (!autocomplete.contains(e.target) && e.target !== input) {
      autocomplete.style.display = 'none';
    }
  });
}
