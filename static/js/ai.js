/* ============================================================
   KollabHub AI Assistant — Frontend (Updated)
   Now uses Django backend API instead of external APIs
   ============================================================ */

// ── DOM Elements ─────────────────────────────────────────
const inp = document.getElementById('inp');
const sendBtn = document.getElementById('sendBtn');
const chat = document.getElementById('chat');
const msgs = document.getElementById('msgs');
const welcome = document.getElementById('welcome');
const typing = document.getElementById('typing');
const attBtn = document.getElementById('attBtn');
const toast = document.getElementById('toast');

// Get workspace ID from layout data or URL
const workspaceId = window.currentWorkspaceId || (function() {
  const match = window.location.pathname.match(/\/ai\/(\d+)\/?/);
  return match ? match[1] : null;
})();

let history = [];
let loading = false;
let attachedFile = null;

// ── Input Auto-resize ───────────────────────────────────
inp.addEventListener('input', () => {
  inp.style.height = 'auto';
  inp.style.height = Math.min(inp.scrollHeight, 150) + 'px';
  sendBtn.disabled = !inp.value.trim() || loading;
});

// ── Send Message on Enter ────────────────────────────────
inp.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (!sendBtn.disabled) send();
  }
});

sendBtn.addEventListener('click', send);

// ── File Attachment ─────────────────────────────────────
attBtn.addEventListener('click', () => {
  showToast('File attachments are not supported in this view.');
});

// ── Send Message Function ────────────────────────────────
async function send() {
  const txt = inp.value.trim();
  if (!txt || loading) return;

  welcome.classList.add('hidden');
  history.push({ role: 'user', content: txt });
  addMsg('u', txt);

  if (attachedFile) {
    showToast('File attachments are not supported in this view.');
    attachedFile = null;
  }

  inp.value = '';
  inp.style.height = 'auto';
  sendBtn.disabled = true;
  loading = true;
  showTyping(true);
  scrollB();

  try {
    const reply = await callBackendAPI(txt, attachedFile);
    showTyping(false);
    history.push({ role: 'assistant', content: reply });
    addMsg('ai', reply);
  } catch (e) {
    showTyping(false);
    if (e.name !== 'AbortError') {
      addMsg('ai', `**Error:** ${e.message || 'Something went wrong.'}`);
    }
  } finally {
    loading = false;
    attachedFile = null;
    sendBtn.disabled = !inp.value.trim();
    scrollB();
  }
}

// ── Backend API Call ────────────────────────────────────
async function callBackendAPI(message, file) {
  const response = await fetch(`/api/workspace/${workspaceId}/ai-chat/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRFToken': document.cookie
        .split(';')
        .find(c => c.trim().startsWith('csrftoken='))
        ?.split('=')[1] || ''
    },
    credentials: 'same-origin',
    body: JSON.stringify({ message })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error?.error || `API error ${response.status}`);
  }

  const data = await response.json();
  return data.response || '(No response from AI)';
}

async function loadHistory() {
  if (!workspaceId) return;
  try {
    const response = await fetch(`/api/workspace/${workspaceId}/ai-history/`, {
      credentials: 'same-origin'
    });
    if (!response.ok) return;
    const data = await response.json();
    if (!data.history || !data.history.length) return;
    msgs.innerHTML = '';
    data.history.forEach(item => addMsg(item.role === 'assistant' ? 'ai' : 'u', item.content));
    history = data.history.map(item => ({ role: item.role, content: item.content }));
    welcome.classList.add('hidden');
  } catch (e) {
    console.warn('AI history load failed', e);
  }
}


// ── Message Display ─────────────────────────────────────
function addMsg(role, content) {
  const g = document.createElement('div');
  g.className = 'msg-group';

  const row = document.createElement('div');
  row.className = `msg-row ${role}`;

  const av = document.createElement('div');
  av.className = `mava ${role}`;
  av.innerHTML = role === 'ai'
    ? `<svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" width="13" height="13"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>`
    : 'YOU';

  const b = document.createElement('div');
  b.className = `bubble ${role}`;
  b.innerHTML = md(content);

  row.append(av, b);
  g.appendChild(row);

  const meta = document.createElement('div');
  meta.className = 'msg-meta';
  const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  meta.innerHTML = `<span>${role === 'ai' ? 'AI Assistant' : 'You'} · ${t}</span>`;

  if (role === 'ai') {
    const cp = document.createElement('button');
    cp.className = 'cpbtn';
    cp.innerHTML = `<svg fill="none" stroke="currentColor" stroke-width="1.7" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>Copy`;
    cp.onclick = () => navigator.clipboard.writeText(content).then(() => showToast('Copied'));
    meta.appendChild(cp);
  }

  g.appendChild(meta);
  msgs.appendChild(g);
  scrollB();
}

// ── Markdown Parser ──────────────────────────────────────
function md(t) {
  return t
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/```(\w*)\n?([\s\S]*?)```/g, (_, l, c) => `<pre><code>${c.trim()}</code></pre>`)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^### (.+)$/gm, '<h3 style="font-size:13px;font-weight:600;color:var(--p);margin:10px 0 5px;opacity:.9">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 style="font-size:15px;font-weight:600;color:var(--p);margin:11px 0 5px;opacity:.9">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 style="font-size:17px;font-weight:700;color:var(--t1);margin:12px 0 6px">$1</h1>')
    .replace(/^[-•]\s(.+)$/gm, '<li style="margin:3px 0;padding-left:3px">$1</li>')
    .replace(/(<li[\s\S]+?<\/li>)/g, '<ul style="padding-left:16px;margin:7px 0">$1</ul>')
    .replace(/\n\n/g, '</p><p style="margin-top:7px">')
    .replace(/\n/g, '<br>');
}

// ── UI Helpers ───────────────────────────────────────────
function showTyping(s) {
  typing.classList.toggle('hidden', !s);
  if (s) scrollB();
}

function scrollB() {
  requestAnimationFrame(() => (chat.scrollTop = chat.scrollHeight));
}

let toastTimeout;
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove('show'), 2600);
}

// ── Clear & Export Buttons ───────────────────────────────
document.getElementById('clearBtn').addEventListener('click', async () => {
  if (!workspaceId) return;
  try {
    const response = await fetch(`/api/workspace/${workspaceId}/ai-clear-history/`, {
      method: 'POST',
      headers: {
        'X-CSRFToken': document.cookie
          .split(';')
          .find(c => c.trim().startsWith('csrftoken='))
          ?.split('=')[1] || ''
      },
      credentials: 'same-origin'
    });
    if (!response.ok) throw new Error('Failed to clear history');
    history = [];
    msgs.innerHTML = '';
    welcome.classList.remove('hidden');
    showToast('History cleared');
  } catch (e) {
    console.warn('AI clear history failed', e);
    showToast('Failed to clear history');
  }
});

document.getElementById('exportBtn').addEventListener('click', () => {
  if (!history.length) {
    showToast('Nothing to export');
    return;
  }

  const txt = history
    .map(m => `[${m.role === 'user' ? 'You' : 'AI'}]\n${m.content}`)
    .join('\n\n---\n\n');

  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([txt], { type: 'text/plain' }));
  a.download = `kollab-ai-${Date.now()}.txt`;
  a.click();
  showToast('Exported');
});

// ── Welcome Suggestions ──────────────────────────────────
document.querySelectorAll('.sugg').forEach(sugg => {
  sugg.addEventListener('click', () => {
    const prompt = sugg.dataset.p;
    if (prompt) {
      inp.value = prompt;
      inp.dispatchEvent(new Event('input'));
      send();
    }
  });
});

loadHistory();