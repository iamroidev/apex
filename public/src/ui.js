// public/src/ui.js — UI Module: clock, themes, dashboard, profile editing, and scheduling
import { state, dom, showView, escapeHtml, formatTime } from './core.js';
import { startNewMeeting, joinMeeting } from './main.js';

export function updateDashboardAvatar() {
  const avatarEl = document.getElementById('dash-avatar');
  if (!avatarEl) return;
  const name = localStorage.getItem('apexDisplayName') || state.userName || state.user?.username || 'A';
  const color = localStorage.getItem('apexAvatarColor') || '#00f2fe';
  avatarEl.textContent = name.charAt(0).toUpperCase();
  avatarEl.style.backgroundColor = color;
}

export function initGoogleAuth() {
  // Bind fallback button handler
  const fallbackBtn = document.getElementById("google-signin-fallback");
  if (fallbackBtn && !fallbackBtn.dataset.bound) {
    fallbackBtn.dataset.bound = "true";
    fallbackBtn.addEventListener('click', () => {
      alert("Google Sign-In is disabled on insecure connections (HTTP). Please access the application via a secure HTTPS domain or localhost.");
    });
  }

  if (window.google && window.google.accounts) {
    try {
      window.google.accounts.id.initialize({
        client_id: "607768078052-16lmjehbrsfsfdhka89efg0d48vr7cev.apps.googleusercontent.com",
        callback: handleGoogleCredentialResponse
      });
      const btnContainer = document.getElementById("google-signin-btn");
      if (btnContainer) {
        window.google.accounts.id.renderButton(btnContainer, {
          theme: "outline",
          size: "large",
          width: 290
        });
      }
    } catch (err) {
      console.warn("Google Auth SDK initialization failed:", err);
    }
  } else {
    setTimeout(initGoogleAuth, 100);
  }
}

export async function handleGoogleCredentialResponse(response) {
  try {
    const res = await fetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: response.credential })
    });
    const data = await res.json();
    if (res.ok) {
      state.user = data;
      state.userName = data.username;
      dom.dashUsernameDisplay.textContent = data.username;
      updateDashboardAvatar();
      showView('dashboard');
      loadUpcoming();
    } else {
      const errEl = document.getElementById('login-error');
      if (errEl) {
        errEl.textContent = data.error || 'Google login failed';
        errEl.classList.remove('hidden');
      }
    }
  } catch (err) {
    console.error('Google Auth communication error:', err);
  }
}

export function updateClock() {
  const now = new Date();
  const opts = { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true };
  dom.dashClock.textContent = now.toLocaleTimeString('en-US', opts);
}

export function initTheme() {
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

export function bindLanding() {
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
        updateDashboardAvatar();
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
        updateDashboardAvatar();
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
    localStorage.setItem('apexDisplayName', name);
    joinMeeting(code);
  });
}

export function bindDashboard() {
  // Toggle dashboard profile dropdown menu
  if (dom.dashAvatarToggle && dom.dashProfileDropdown) {
    dom.dashAvatarToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      dom.dashProfileDropdown.classList.toggle('hidden');
    });
    document.addEventListener('click', (e) => {
      if (!dom.dashProfileDropdown.contains(e.target) && !dom.dashAvatarToggle.contains(e.target)) {
        dom.dashProfileDropdown.classList.add('hidden');
      }
    });
  }

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

  // ---- Profile Editing ----
  const profileModal  = document.getElementById('modal-profile');
  const btnEditProfile = document.getElementById('btn-edit-profile');
  const profileNameInput = document.getElementById('profile-display-name');
  const profileAvatarPreview = document.getElementById('profile-avatar-preview');
  const profileSaveMsg = document.getElementById('profile-save-msg');
  let selectedProfileColor = localStorage.getItem('apexAvatarColor') || '#00f2fe';

  function updateAvatarPreview() {
    const name = profileNameInput.value.trim() || state.userName || 'A';
    profileAvatarPreview.textContent = name.charAt(0).toUpperCase();
    profileAvatarPreview.style.background = selectedProfileColor;
  }

  if (btnEditProfile) {
    btnEditProfile.addEventListener('click', () => {
      profileNameInput.value = localStorage.getItem('apexDisplayName') || state.userName || '';
      selectedProfileColor = localStorage.getItem('apexAvatarColor') || '#00f2fe';
      // Mark active swatch
      document.querySelectorAll('.profile-swatch').forEach(s => {
        s.style.outline = s.dataset.color === selectedProfileColor ? '3px solid #fff' : 'none';
        s.style.outlineOffset = '2px';
      });
      profileSaveMsg.textContent = '';
      updateAvatarPreview();
      profileModal.classList.remove('hidden');
    });
  }

  document.querySelectorAll('.profile-swatch').forEach(swatch => {
    swatch.addEventListener('click', () => {
      selectedProfileColor = swatch.dataset.color;
      document.querySelectorAll('.profile-swatch').forEach(s => {
        s.style.outline = 'none';
      });
      swatch.style.outline = '3px solid #fff';
      swatch.style.outlineOffset = '2px';
      updateAvatarPreview();
    });
  });

  if (profileNameInput) profileNameInput.addEventListener('input', updateAvatarPreview);

  const profileCancelBtn = document.getElementById('profile-cancel');
  if (profileCancelBtn) {
    profileCancelBtn.addEventListener('click', () => profileModal.classList.add('hidden'));
  }

  const profileSaveBtn = document.getElementById('profile-save');
  if (profileSaveBtn) {
    profileSaveBtn.addEventListener('click', () => {
      const newName = profileNameInput.value.trim();
      if (!newName) {
        profileSaveMsg.style.color = 'var(--accent-coral)';
        profileSaveMsg.textContent = 'Name cannot be empty.';
        return;
      }
      localStorage.setItem('apexDisplayName', newName);
      localStorage.setItem('apexAvatarColor', selectedProfileColor);
      // Update displayed name in header
      if (dom.dashUsernameDisplay) dom.dashUsernameDisplay.textContent = newName;
      updateDashboardAvatar();
      // Update state so new meetings use the new name
      state.displayName = newName;
      profileSaveMsg.style.color = 'var(--accent-cyan)';
      profileSaveMsg.textContent = 'Profile saved.';
      setTimeout(() => profileModal.classList.add('hidden'), 900);
    });
  }

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

export async function scheduleNewMeeting() {
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

export async function loadUpcoming() {
  try {
    const res = await fetch('/api/scheduled');
    const meetings = await res.json();
    renderUpcoming(meetings);
  } catch (e) {
    dom.upcomingList.innerHTML = '<p class="empty-state">No scheduled meetings</p>';
  }
}

export function renderUpcoming(meetings) {
  if (!meetings.length) {
    dom.upcomingList.innerHTML = '<p class="empty-state">No scheduled meetings</p>';
    return;
  }
  dom.upcomingList.innerHTML = meetings.map(m => {
    const dt = new Date(m.scheduled_for);
    const dateStr = dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const timeStr = dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const inviteLink = `${location.origin}/?join=${m.id}`;
    return `
      <div class="upcoming-item">
        <div class="upcoming-item-info">
          <span class="upcoming-item-title">${escapeHtml(m.title)}</span>
          <span class="upcoming-item-time">${dateStr} at ${timeStr} · ${m.duration_minutes}min</span>
          <span class="upcoming-item-link" style="font-size:var(--text-xs);color:var(--accent-cyan);word-break:break-all;margin-top:2px;display:block;">${inviteLink}</span>
        </div>
        <div class="upcoming-item-actions">
          <button class="btn btn-ghost" style="font-size:var(--text-xs);padding:var(--sp-1) var(--sp-2);" onclick="window._apex.copyScheduledLink('${m.id}', this)" title="Copy invite link">Copy Link</button>
          <button class="btn btn-primary" onclick="window._apex.joinMeeting('${m.id}')">Start</button>
          <button class="btn btn-ghost" onclick="window._apex.deleteScheduled('${m.id}')">✕</button>
        </div>
      </div>`;
  }).join('');
}

export async function deleteScheduled(id) {
  try { await fetch(`/api/scheduled/${id}`, { method: 'DELETE' }); } catch (e) { /* ok */ }
  loadUpcoming();
}

export async function loadSessionLogs() {
  try {
    const res = await fetch('/api/sessions');
    const sessions = await res.json();
    renderSessionLogs(sessions);
  } catch (e) {
    dom.logsList.innerHTML = '<p class="empty-state">No session history</p>';
  }
}

export function renderSessionLogs(sessions) {
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

export function exportSession(id, format) {
  window.open(`/api/sessions/${id}/export/${format}`, '_blank');
}

export async function viewSessionDetails(sessionId) {
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

export function bindReactions() {
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

export function spawnFloatingReaction(emoji) {
  const el = document.createElement('div');
  el.className = 'floating-reaction';
  el.textContent = emoji;
  el.style.left = (20 + Math.random() * 60) + '%';
  el.style.bottom = '0';
  dom.reactionsLayer.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

