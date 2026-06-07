// ═══════════════════════════════════════════════════
//  KollabHub AI Chat — fully functional
// ═══════════════════════════════════════════════════

const chatInput     = document.getElementById('chatInput');
const sendBtn       = document.getElementById('sendBtn');
const clearBtn      = document.getElementById('clearBtn');
const exportBtn     = document.getElementById('exportBtn');
const messagesEl    = document.getElementById('messagesContainer');
const welcomeState  = document.getElementById('welcomeState');
const typingIndicator = document.getElementById('typingIndicator');
const chatContainer = document.getElementById('chatContainer');
const modelPill     = document.getElementById('modelPill');
const modelDropdown = document.getElementById('modelDropdown');
const modelLabel    = document.getElementById('modelLabel');
const toast         = document.getElementById('toast');

let messages = []; // {role, content}
let isLoading = false;
let currentModel = 'claude-sonnet-4-20250514';
let streamController = null;

// ─── AUTO-RESIZE TEXTAREA ───────────────────────────
chatInput.addEventListener('input', () => {
  chatInput.style.height = 'auto';
  chatInput.style.height = Math.min(chatInput.scrollHeight, 160) + 'px';
  sendBtn.disabled = !chatInput.value.trim() || isLoading;
});

// ─── KEYBOARD SHORTCUTS ─────────────────────────────
chatInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (!sendBtn.disabled) sendMessage();
  }
});

// ─── SEND ────────────────────────────────────────────
sendBtn.addEventListener('click', sendMessage);

async function sendMessage() {
  const text = chatInput.value.trim();
  if (!text || isLoading) return;

  // Hide welcome state
  welcomeState.classList.add('hidden');

  // Add user message to state + DOM
  messages.push({ role: 'user', content: text });
  appendMessage('user', text);

  chatInput.value = '';
  chatInput.style.height = 'auto';
  sendBtn.disabled = true;
  isLoading = true;

  showTyping(true);
  scrollBottom();

  try {
    const reply = await callClaude(messages);
    showTyping(false);
    messages.push({ role: 'assistant', content: reply });
    appendMessage('ai', reply);
  } catch (err) {
    showTyping(false);
    if (err.name !== 'AbortError') {
      appendMessage('ai', `**Error:** ${err.message || 'Something went wrong. Please try again.'}`);
    }
  } finally {
    isLoading = false;
    sendBtn.disabled = !chatInput.value.trim();
    scrollBottom();
  }
}

// ─── CLAUDE API ──────────────────────────────────────
async function callClaude(history) {
  streamController = new AbortController();

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal: streamController.signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: currentModel,
      max_tokens: 1000,
      system: `You are the KollabHub AI assistant — a helpful, sharp, and friendly collaborator built into KollabHub, a modern team collaboration and project management platform. Help users with project planning, writing, brainstorming, analysis, and team workflows. Be concise but thorough. Use markdown formatting where it aids clarity.`,
      messages: history.map(m => ({ role: m.role === 'ai' ? 'assistant' : m.role, content: m.content }))
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message || `API error ${response.status}`);
  }

  const data = await response.json();
  return data.content?.[0]?.text || '(No response)';
}

// ─── RENDER MESSAGE ───────────────────────────────────
function appendMessage(role, content) {
  const group = document.createElement('div');
  group.className = 'message-group';

  const row = document.createElement('div');
  row.className = `message-row ${role}`;

  const avatarDiv = document.createElement('div');
  avatarDiv.className = `msg-avatar ${role}`;
  avatarDiv.innerHTML = role === 'ai'
    ? `<svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" width="15" height="15"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>`
    : 'JD';

  const bubble = document.createElement('div');
  bubble.className = `bubble ${role}`;
  bubble.innerHTML = renderMarkdown(content);

  row.appendChild(avatarDiv);
  row.appendChild(bubble);
  group.appendChild(row);

  // Meta row
  const meta = document.createElement('div');
  meta.className = 'msg-meta';
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  meta.innerHTML = `<span>${role === 'ai' ? 'AI Assistant' : 'You'} · ${time}</span>`;
  if (role === 'ai') {
    const copyBtn = document.createElement('button');
    copyBtn.className = 'copy-btn';
    copyBtn.innerHTML = `<svg fill="none" stroke="currentColor" stroke-width="1.7" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg> Copy`;
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(content).then(() => showToast('Copied to clipboard'));
    });
    meta.appendChild(copyBtn);
  }
  group.appendChild(meta);

  messagesEl.appendChild(group);
  scrollBottom();
}

// ─── BASIC MARKDOWN RENDERER ─────────────────────────
function renderMarkdown(text) {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => `<pre><code>${code.trim()}</code></pre>`)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^### (.+)$/gm, '<h3 style="font-size:14px;font-family:var(--font-display);font-weight:700;color:var(--color-peach-200);margin:10px 0 6px">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 style="font-size:16px;font-family:var(--font-display);font-weight:700;color:var(--color-peach-200);margin:12px 0 6px">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 style="font-size:18px;font-family:var(--font-display);font-weight:800;color:var(--color-white);margin:14px 0 8px">$1</h1>')
    .replace(/^[-•]\s(.+)$/gm, '<li style="margin:3px 0;padding-left:4px">$1</li>')
    .replace(/(<li[\s\S]+?<\/li>)/g, '<ul style="padding-left:18px;margin:8px 0">$1</ul>')
    .replace(/\n\n/g, '</p><p style="margin-top:8px">')
    .replace(/\n/g, '<br>');
}

// ─── TYPING INDICATOR ─────────────────────────────────
function showTyping(show) {
  typingIndicator.classList.toggle('hidden', !show);
  if (show) scrollBottom();
}

// ─── SCROLL ───────────────────────────────────────────
function scrollBottom() {
  requestAnimationFrame(() => {
    chatContainer.scrollTop = chatContainer.scrollHeight;
  });
}

// ─── CLEAR ────────────────────────────────────────────
clearBtn.addEventListener('click', () => {
  if (messages.length === 0) return;
  messages = [];
  messagesEl.innerHTML = '';
  welcomeState.classList.remove('hidden');
  showToast('Conversation cleared');
});

// ─── EXPORT ───────────────────────────────────────────
exportBtn.addEventListener('click', () => {
  if (messages.length === 0) { showToast('Nothing to export yet'); return; }
  const text = messages.map(m => `[${m.role === 'user' ? 'You' : 'AI'}]\n${m.content}`).join('\n\n---\n\n');
  const blob = new Blob([text], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `kolabhub-chat-${Date.now()}.txt`;
  a.click();
  showToast('Chat exported');
});

// ─── SUGGESTION CARDS ─────────────────────────────────
document.querySelectorAll('.suggestion-card').forEach(card => {
  card.addEventListener('click', () => {
    chatInput.value = card.dataset.prompt;
    chatInput.dispatchEvent(new Event('input'));
    chatInput.focus();
  });
});

// ─── MODEL SELECTOR ───────────────────────────────────
modelPill.addEventListener('click', e => {
  e.stopPropagation();
  modelDropdown.classList.toggle('open');
});
document.addEventListener('click', () => modelDropdown.classList.remove('open'));

document.querySelectorAll('.model-option').forEach(opt => {
  opt.addEventListener('click', e => {
    e.stopPropagation();
    document.querySelectorAll('.model-option').forEach(o => o.classList.remove('selected'));
    opt.classList.add('selected');
    currentModel = opt.dataset.model;
    modelLabel.textContent = opt.dataset.label;
    modelDropdown.classList.remove('open');
    showToast(`Switched to ${opt.dataset.label}`);
  });
});

// ─── ATTACH (placeholder) ─────────────────────────────
document.getElementById('attachBtn').addEventListener('click', () => {
  showToast('File attachment coming soon');
});

// ─── TOAST ────────────────────────────────────────────
let toastTimeout;
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove('show'), 2800);
}