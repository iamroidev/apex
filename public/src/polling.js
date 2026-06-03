// public/src/polling.js — Polls setup modals, live results tallies, voting triggers
import { state, dom, escapeHtml, genId } from './core.js';

export function showPollModal() {
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

export function launchPoll() {
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

export function showPollTallyView() {
  dom.pollCreateView.classList.add('hidden');
  dom.pollTallyView.classList.remove('hidden');
  dom.pollHostTitle.textContent = 'Live Poll Results';
  dom.pollTallyQuestion.textContent = state.activePoll.question;
  
  dom.pollHostClose.style.display = 'none';
  dom.pollEndShareBtn.style.display = 'block';
  updatePollTallyResults();
}

export function updatePollTallyResults() {
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

export function sharePollResults() {
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

export function closePollHost() {
  dom.modalPollHost.classList.add('hidden');
  state.activePoll = null;
}

export function handlePollCreated(poll) {
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

export function submitPollVote() {
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

export function handlePollVoted({ pollId, optionIndex, voterName, socketId }) {
  if (state.isHost && state.activePoll && state.activePoll.id === pollId) {
    state.activePoll.votes[socketId] = optionIndex;
    updatePollTallyResults();
  }
}

export function handlePollEnded(pollId, results) {
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

export function closePollParticipant() {
  dom.modalPollParticipant.classList.add('hidden');
  state.activePoll = null;
}
