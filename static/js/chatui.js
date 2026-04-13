/* ---------- Config / DOM refs ---------- */
// Get values from data attributes injected by Django template
// new layout uses #messagesArea, but keep fallback for older id.
const chatContainer = document.getElementById('messagesArea') || document.getElementById('chatWindow');
const workspaceId = chatContainer?.dataset?.workspaceId || "";
const currentUserId = parseInt(chatContainer?.dataset?.userId || "0", 10) || null;
const username = chatContainer?.dataset?.username || "";
const userAvatar = chatContainer?.dataset?.avatar || "/static/Areeba.jpeg";

const ws_scheme = window.location.protocol === "https:" ? "wss" : "ws";
const socketUrl = `${ws_scheme}://${window.location.host}/ws/chat/${workspaceId}/`;
console.log("Chat socket URL:", socketUrl);
console.log("Workspace ID:", workspaceId);
console.log("Username:", username);
console.log("Avatar:", userAvatar);

let chatSocket;
try {
  if (workspaceId) {
    chatSocket = new WebSocket(socketUrl);
    console.log("WebSocket object created");
  } else {
    console.warn("No workspaceId available, skipping WebSocket creation");
  }
} catch (err) {
  console.error("WebSocket creation failed:", err);
}

// keep track of current / last DM partner on client
let currentDMUser = null;
let lastDMUser = null;
let lastMessageDayKey = null;

function getDateKey(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function formatChatDay(date) {
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

function insertDateDivider(date) {
  const key = getDateKey(date);
  if (key === lastMessageDayKey) return;
  lastMessageDayKey = key;

  const divider = document.createElement('div');
  divider.className = 'msg-date-divider';
  divider.textContent = formatChatDay(date);
  if (chatContainer) {
    chatContainer.appendChild(divider);
  }
}

function joinDM(userId) {
  if (chatSocket && chatSocket.readyState === WebSocket.OPEN) {
    chatSocket.send(JSON.stringify({ join_dm: true, user_id: userId }));
  }
}
function leaveDM(userId) {
  if (chatSocket && chatSocket.readyState === WebSocket.OPEN) {
    chatSocket.send(JSON.stringify({ leave_dm: true, user_id: userId }));
  }
}

// element references (new ids first, then old as fallback)
const messageInput = document.getElementById("chatInput") || document.getElementById("messageInput");
const sendButton = document.getElementById("sendBtn") || document.getElementById("sendButton");

// Utility for $ and $$
function $(id) { return document.getElementById(id); }
function $$(sel) { return Array.from(document.querySelectorAll(sel)); }



// Load recent message history when opening the chat UI
async function loadWorkspaceHistory() {
  chatContainer.innerHTML = "";
  lastMessageDayKey = null;
  try {
    const resp = await fetch(`/api/workspace/${workspaceId}/messages/?limit=200`, {credentials: 'same-origin'});
    if (!resp.ok) throw new Error('Failed to fetch history');
    const msgs = await resp.json();
    if (!window._seenMessageIds) window._seenMessageIds = new Set();
    msgs.forEach(m => {
      const sender = m.sender_display_name || m.sender_username || 'Unknown';
      const text = m.message || '';
      const avatar = m.sender_avatar || '/static/Areeba.jpeg';
      const time = m.timestamp ? new Date(m.timestamp) : (m.created_at ? new Date(m.created_at) : new Date());
      const senderId = m.sender_id || null;
      if (m.message_id) {
        if (window._seenMessageIds.has(m.message_id)) return;
        window._seenMessageIds.add(m.message_id);
      }
      // Use sender_id if available (more reliable), fallback to username comparison
      const isOwnMessage = senderId ? (senderId === currentUserId) : (m.sender_username === username);
      appendMessageToWindow({ sender, avatar, text, side: isOwnMessage ? 'right' : 'left', time });
    });
  } catch (err) {
    console.warn('Could not load chat history:', err);
  }
}
if (workspaceId) {
  loadWorkspaceHistory();
  if (window.NotificationManager) {
    window.NotificationManager.markRead('chat');
  }
}


/* ---------- WebSocket handlers ---------- */
if (chatSocket) {
  chatSocket.onopen = () => {
    console.log("WebSocket connected.");
    // if a DM was previously selected, ensure we join its group
    if (lastDMUser) {
      joinDM(lastDMUser);
    }
  };

  chatSocket.onmessage = function (e) {
    try {
      const data = JSON.parse(e.data);
      // deduplicate messages by id (protects against multiple connections)
      if (!window._seenMessageIds) window._seenMessageIds = new Set();
      const msgId = data.message_id || data.id || null;
      if (msgId && window._seenMessageIds.has(msgId)) return; // ignore duplicate

      if (data.type === 'notification_event') {
        if (window.NotificationManager) {
          window.NotificationManager.handleNotificationEvent(data);
        }
        return;
      }

      if (data.notification && window.NotificationManager) {
        window.NotificationManager.handleNotificationEvent(data);
      }

      // If this is a DM event and we're not viewing that DM, ignore
      if (data.dm) {
        const otherId = data.sender_id === currentUserId ? data.receiver_id : data.sender_id;
        if (currentDMUser !== otherId) {
          return;
        }
      }

      // Handle message format: {type: "message", message, username, sender_username, sender_avatar, sender_id}
      if (data.type === "message" || data.message) {
        const sender = data.sender_username || data.username || data.sender || "Unknown";
        const text = data.message || data.text || "";
        const avatar = data.sender_avatar || data.avatar || "/static/Areeba.jpeg";
        const time = data.timestamp ? new Date(data.timestamp) : new Date();
        const senderId = data.sender_id || null;
        if (msgId) window._seenMessageIds.add(msgId);
        // Use sender_id if available (more reliable), fallback to username comparison
        const isOwnMessage = senderId ? (senderId === currentUserId) : (sender === username);
        appendMessageToWindow({ sender, avatar, text, side: isOwnMessage ? "right" : "left", time });
      } else if (data.type === "typing" || data.type === "typing_indicator") {
        // Pass both username and sender_id for reliable identification
        showTyping(data.username || data.sender || data.sender_username, data.sender_id);
      } else {
        // generic fallback: show raw payload
        appendMessageToWindow({ sender: data.username || "server", avatar: "/static/Areeba.jpeg", text: JSON.stringify(data), side: "left" });
      }
    } catch (err) {
      console.error("Error parsing socket message:", err, e.data);
    }
  };

  chatSocket.onclose = (e) => {
    console.warn("WebSocket closed:", e);
    // optional: show offline indicator
  };

  chatSocket.onerror = (err) => {
    console.error("WebSocket error:", err);
  };
}


/* ── helpers for new rendering and typing indicator ── */
function fmt(d) {
  return d.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
}

function avatarColor(name) {
  const palette = [
    'linear-gradient(135deg,#f4856a,#e05a7d)',
    'linear-gradient(135deg,#60a5fa,#3b82f6)',
    'linear-gradient(135deg,#34d399,#059669)',
    'linear-gradient(135deg,#a78bfa,#7c3aed)',
    'linear-gradient(135deg,#fbbf24,#d97706)',
  ];
  let hash = 0;
  for (let c of name) hash = c.charCodeAt(0) + ((hash << 5) - hash);
  return palette[Math.abs(hash) % palette.length];
}

function initials(name) {
  return name.split(' ').map(w => w[0]).join('').toUpperCase();
}

function appendMessageToWindow({ sender, avatar, text, side = "left", time = new Date() }) {
  insertDateDivider(time);
  const group = document.createElement('div');
  group.className = 'msg-group' + (side === 'right' ? ' self' : '');

  const av = document.createElement('div');
  av.className = 'msg-av';
  if (avatar && avatar.match(/^https?:/)) {
    const img = document.createElement('img');
    img.src = avatar;
    img.alt = sender;
    av.appendChild(img);
  } else {
    av.textContent = initials(sender);
    av.style.background = avatarColor(sender);
  }

  const body = document.createElement('div');
  body.className = 'msg-body';
  body.innerHTML = `
    <div class="msg-meta">
      <span class="msg-name">${sender}</span>
      <span class="msg-time">${fmt(time)}</span>
    </div>
    <div class="msg-bubble">${text}</div>
  `;

  group.appendChild(av);
  group.appendChild(body);
  if (chatContainer) {
    chatContainer.appendChild(group);
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }
}

/* show typing indicator for a user, auto remove after timeout */
function showTyping(user, userId) {
  if (!user) return;
  // Don't show typing indicator if it's from the current user
  // Use userId if available (more reliable), fallback to username comparison
  const isCurrentUser = userId ? (userId === currentUserId) : (user === username);
  if (isCurrentUser) return;
  
  if (document.getElementById(`typing-${user}`)) return;
  const el = document.createElement('div');
  el.id = `typing-${user}`;
  el.className = 'typing-indicator';
  el.innerHTML = `
    <div class="msg-av" style="background:${avatarColor(user)}">${initials(user)}</div>
    <span>${user} is typing</span>
    <div class="typing-dots"><span></span><span></span><span></span></div>
  `;
  if (chatContainer) {
    chatContainer.appendChild(el);
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }
  setTimeout(() => { el.remove(); }, 3000);
}



// Private chat between users (DM)

function openDM(userId, username) {
  // ensure numeric
  userId = parseInt(userId, 10);
  // leave previous DM if different
  if (lastDMUser && lastDMUser !== userId) {
    leaveDM(lastDMUser);
  }
  lastDMUser = userId;
  currentDMUser = userId;

  // join socket group for this conversation
  joinDM(userId);

  // Update header
  const chatTitle = document.getElementById("chatChannelTitle");
  if (chatTitle) {
    chatTitle.innerText = username;
    chatTitle.classList.add("dm-header");
  }
  const chatSubtitle = document.querySelector(".view-subtitle");
  if (chatSubtitle) {
    chatSubtitle.innerText = "Direct Message";
  }
  loadDMHistory(userId).then(() => {
    if (window.NotificationManager) {
      window.NotificationManager.markRead('dm', { other_user_id: userId });
    }
  });
  if (messageInput) messageInput.placeholder = `Message ${username}`;
  setTimeout(() => {
    if (messageInput) messageInput.focus();
  }, 100);
}

// Loading DM history when opening a DM chat window
async function loadDMHistory(userId){

  chatContainer.innerHTML = "";
  lastMessageDayKey = null;

  try{

    const resp = await fetch(
      `/api/workspace/${workspaceId}/dm/${userId}/`
    );

    const msgs = await resp.json();

    msgs.forEach(m => {

      appendMessageToWindow({
        sender: m.sender,
        text: m.message,
        side: m.sender === username ? "right" : "left",
        avatar: "/static/Areeba.jpeg",
        time: new Date(m.created_at)
      });

    });

  }catch(err){
    console.error("DM load failed", err);
  }

}
//------------------------------- csrf token -------------------------------
function getCSRFToken() {
  const name = "csrftoken";
  const cookies = document.cookie.split(";");

  for (let cookie of cookies) {
    cookie = cookie.trim();
    if (cookie.startsWith(name + "=")) {
      return cookie.substring(name.length + 1);
    }
  }
  return "";
}

/* ---------- Sending messages ---------- */
function sendTextMessage(text) {

  // ---------- DIRECT MESSAGE MODE ----------
  if (currentDMUser) {
    if (!chatSocket || chatSocket.readyState !== WebSocket.OPEN) {
      console.warn("Socket not open. Cannot send DM message. State:", chatSocket?.readyState);
      appendMessageToWindow({ sender: username, avatar: userAvatar, text, side: "right" });
      return;
    }
    const payload = {
      dm: true,
      receiver_id: currentDMUser,
      message: text,
      message_id: (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : (Date.now().toString() + Math.random().toString(36).slice(2)),
    };
    chatSocket.send(JSON.stringify(payload));
    return; // stop execution so workspace chat is not triggered
  }


  // ---------- EXISTING WORKSPACE CHAT (UNCHANGED) ----------

  if (!chatSocket || chatSocket.readyState !== WebSocket.OPEN) {
    console.warn("Socket not open. Cannot send message. State:", chatSocket?.readyState);

    // Still append locally so user sees it
    appendMessageToWindow({
      sender: username,
      avatar: userAvatar,
      text,
      side: "right"
    });

    return;
  }

  const payload = {
    message: text,

    // add a client-generated id for optimistic UI / dedup
    message_id:
      (window.crypto && window.crypto.randomUUID)
        ? window.crypto.randomUUID()
        : (Date.now().toString() + Math.random().toString(36).slice(2)),
  };

  chatSocket.send(JSON.stringify(payload));

  // Server will broadcast message back so no local append
}


// allow the user to click the channel title to return to workspace chat
const channelTitleEl = document.getElementById('chatChannelTitle');
if (channelTitleEl) {
  channelTitleEl.style.cursor = 'pointer';
  channelTitleEl.addEventListener('click', () => {
    if (currentDMUser) {
      leaveDM(currentDMUser);
      currentDMUser = null;
      lastDMUser = null;
      channelTitleEl.innerText = 'general';
      channelTitleEl.classList.remove('dm-header');
      const chatSubtitle = document.querySelector('.view-subtitle');
      if (chatSubtitle) chatSubtitle.innerText = 'Topic: Team announcements and general chatter';
      loadWorkspaceHistory();
      if (messageInput) messageInput.placeholder = 'Message #general';
    }
  });
}

/* ══════════════════════════════════
   EMOJI PICKER
══════════════════════════════════ */

const EMOJIS = [
  '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '😉', '😌',
  '🥰', '😍', '🤩', '😘', '😗', '😚', '😙', '🥲', '😋', '😛',
  '🤪', '😜', '🤑', '🤐', '😶', '🤫', '🤭', '🤫', '🤬', '😐',
  '😑', '😒', '🙃', '🙂', '🤨', '🧐', '😏', '😌', '😔', '😪',
  '🤤', '😴', '😷', '🤒', '🤕', '🤢', '🤮', '🤮', '🤧', '🤬',
  '😵', '🤯', '🤠', '🥳', '😎', '🤓', '🧐', '😕', '😟', '🙁',
  '😮', '😯', '😲', '😳', '��','😦', '😧', '😨', '😰', '😥',
  '😢', '😭', '😱', '😖', '😣', '😞', '😓', '😩', '😫', '🥱',
  '😤', '😡', '😠', '🤬', '😈', '👿', '💀', '☠️', '💩', '🤡',
  '👹', '👺', '👻', '👽', '👾', '🤖', '😺', '😸', '😹', '😻',
  '😼', '😽', '🙀', '😿', '😾', '❤️', '🧡', '💛', '💚', '💙',
  '💜', '🖤', '🤍', '🤎', '💔', '💕', '💞', '💓', '💗', '💖',
  '💘', '💝', '💟', '👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤌',
  '🤏', '✌️', '🤞', '🫰', '🤟', '🤘', '🤙', '👍', '👎', '👊',
  '👊', '👏', '🙌', '👐', '🫲', '🫳', '🤲', '🤲', '🤝', '🤜',
  '✨', '🌟', '💫', '⭐', '🌠', '💥', '❄️', '☄️', '🔥', '🎉',
  '🎊', '🎈', '🎀', '🎁', '🏆', '🥇', '🥈', '🥉', '⚽', '🏀',
  '🏈', '⚾', '🥎', '🎾', '🏐', '🏉', '🥏', '🎳', '🎯', '🎮',
  '🎲', '🧩', '🚀', '✈️', '🛫', '🛬', '🛩️', '💺', '🚁', '🛶',
  '⛵', '🚤', '🛳️', '⛴️', '🛥️', '🚢', '🚧', '⚓', '⛽', '🚨',
];

// Emoji picker overlay
let emojiPickerOpen = false;

// Create emoji picker DOM
const emojiPickerContainer = document.createElement('div');
emojiPickerContainer.id = 'emojiPicker';
emojiPickerContainer.style.cssText = `
  position: fixed;
  background: linear-gradient(135deg, var(--bg-secondary, #fff), var(--bg, #fafafa));
  border: 2px solid var(--accent, #3b82f6);
  border-radius: var(--radius-lg, 12px);
  box-shadow: 0 15px 50px rgba(0,0,0,0.2);
  display: grid;
  grid-template-columns: repeat(10, 1fr);
  gap: 6px;
  padding: 16px;
  width: 360px;
  max-height: 320px;
  overflow-y: auto;
  z-index: 10000;
  display: none;
  bottom: 100px;
  right: 16px;
`;

// Add custom scrollbar styling
const emojiStyle = document.createElement('style');
emojiStyle.textContent = `
  #emojiPicker::-webkit-scrollbar {
    width: 6px;
  }
  #emojiPicker::-webkit-scrollbar-track {
    background: transparent;
  }
  #emojiPicker::-webkit-scrollbar-thumb {
    background: var(--accent, #3b82f6);
    border-radius: 3px;
  }
  #emojiPicker::-webkit-scrollbar-thumb:hover {
    background: var(--accent-dark, #2563eb);
  }
`;
document.head.appendChild(emojiStyle);

emojiPickerContainer.innerHTML = EMOJIS.map(emoji => 
  `<button class="emoji-btn" style="
    background: var(--bg, #f5f5f5);
    border: 1px solid var(--border, #e5e7eb);
    border-radius: 8px;
    cursor: pointer;
    font-size: 1.6em;
    padding: 8px;
    transition: all 0.15s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    line-height: 1;
  " onclick="insertEmoji('${emoji}')" onmouseover="this.style.background='var(--accent, #3b82f6)'; this.style.transform='scale(1.25)'; this.style.boxShadow='0 4px 12px rgba(59, 130, 246, 0.3)'" onmouseout="this.style.background='var(--bg, #f5f5f5)'; this.style.transform='scale(1)'; this.style.boxShadow='none'">
    ${emoji}
  </button>`
).join('');

document.body.appendChild(emojiPickerContainer);

// Find emoji button in chat input
const emojiBtn = document.querySelector('.chat-input-box .icon-btn[title="Emoji"]');

if (emojiBtn) {
  emojiBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    emojiPickerOpen = !emojiPickerOpen;
    emojiPickerContainer.style.display = emojiPickerOpen ? 'grid' : 'none';
  });
}

// Close emoji picker on outside click
document.addEventListener('click', (e) => {
  if (emojiPickerOpen && e.target !== emojiBtn && !emojiPickerContainer.contains(e.target)) {
    emojiPickerOpen = false;
    emojiPickerContainer.style.display = 'none';
  }
});

// Close emoji picker on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && emojiPickerOpen) {
    emojiPickerOpen = false;
    emojiPickerContainer.style.display = 'none';
  }
});

// Insert emoji into input
function insertEmoji(emoji) {
  if (messageInput) {
    messageInput.value += emoji;
    messageInput.focus();
    // Trigger input event for typing indicator
    messageInput.dispatchEvent(new Event('input'));
  }
  emojiPickerOpen = false;
  emojiPickerContainer.style.display = 'none';
}

/* click -> send */
if (sendButton && messageInput) {
  function handleSend() {
    const text = messageInput.value.trim();
    if (!text) return;
    sendTextMessage(text);
    messageInput.value = "";
  }

  sendButton.addEventListener("click", handleSend);

  /* Enter key -> send (works for both group and DM) */
  messageInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  /* typing notifications (throttled, works for both group and DM) */
  let lastTypingSent = 0;
  messageInput.addEventListener('input', () => {
    const now = Date.now();
    // Send typing notification for both group chat and DMs
    if (chatSocket && chatSocket.readyState === WebSocket.OPEN && now - lastTypingSent > 2000) {
      if (currentDMUser) {
        // For DMs: send with receiver info
        chatSocket.send(JSON.stringify({ type: 'typing', receiver_id: currentDMUser }));
      } else {
        // For group chat: send typing notification
        chatSocket.send(JSON.stringify({ type: 'typing' }));
      }
      lastTypingSent = now;
    }
  });
}
// ---------------------end of chat message handling and DM logic----------------


// ---------------------Modals Logic start-------------------------------
 
/* =======================================================
   VIEW SWITCHING  (chat ↔ settings)
   ======================================================= */
function switchView(view) {
  if (view !== 'chat' && currentDMUser) {
    leaveDM(currentDMUser); currentDMUser = null; lastDMUser = null;
    const t = document.getElementById('chatChannelTitle');
    if (t) { t.innerText = 'general'; t.classList.remove('dm-header'); }
    const sub = document.querySelector('.view-subtitle');
    if (sub) sub.innerText = 'Topic: Team announcements and general chatter';
    if (messageInput) messageInput.placeholder = 'Message #general';
  }
  $$('.view').forEach(v => v.classList.remove('active'));
  const el = document.getElementById('view-' + view);
  if (el) el.classList.add('active');
}
 
// Settings button in sidebar nav (it's a <button> not a link)
document.getElementById('settingsNavBtn')?.addEventListener('click', () => {
  switchView('settings');
  loadMembers();
  loadPrivacySettings();
});

// Settings button in sidebar footer
document.getElementById('sidebarSettingsBtn')?.addEventListener('click', () => {
  switchView('settings');
  loadMembers();
  loadPrivacySettings();
});
 
/* =======================================================
   CHANNELS
   ======================================================= */
let channels = ['general'];
if (window.localStorage && workspaceId) {
  const saved = localStorage.getItem('channels_' + workspaceId);
  if (saved) { try { channels = JSON.parse(saved); } catch {} }
}
 
function saveChannels() {
  if (window.localStorage && workspaceId)
    localStorage.setItem('channels_' + workspaceId, JSON.stringify(channels));
}
 
function renderChannels() {
  const list = document.getElementById('channelList');
  if (!list) return;
  list.innerHTML = '';
  channels.forEach((ch, i) => {
    const btn = document.createElement('button');
    btn.className = 'nav-item' + (i === 0 ? ' active' : '');
    btn.dataset.channel = ch;
    btn.innerHTML = `<span style="opacity:.4">#</span> ${ch}`;
    btn.style.paddingLeft = '10px';
    btn.addEventListener('click', () => {
      list.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      $('chatChannelTitle').textContent = ch;
      if (messageInput) messageInput.placeholder = `Message #${ch}`;
      switchView('chat');
    });
    list.appendChild(btn);
  });
}
renderChannels();
 
const addChannelBtn        = document.getElementById('addChannelBtn');
const addChannelInputWrap  = document.getElementById('addChannelInputWrap');
const addChannelInputEl    = document.getElementById('addChannelInput');
const confirmAddChannelBtn = document.getElementById('confirmAddChannelBtn');
 
if (addChannelBtn && addChannelInputWrap && addChannelInputEl && confirmAddChannelBtn) {
  addChannelBtn.addEventListener('click', () => {
    addChannelInputWrap.style.display = 'flex';
    addChannelInputEl.value = '';
    addChannelInputEl.focus();
  });
  const doAddChannel = () => {
    const name = addChannelInputEl.value.trim();
    if (!name || channels.includes(name)) return;
    channels.push(name);
    saveChannels();
    renderChannels();
    addChannelInputWrap.style.display = 'none';
  };
  confirmAddChannelBtn.addEventListener('click', doAddChannel);
  addChannelInputEl.addEventListener('keydown', e => {
    if (e.key === 'Enter') doAddChannel();
    else if (e.key === 'Escape') addChannelInputWrap.style.display = 'none';
  });
}
 
/* =======================================================
   SETTINGS TABS
   ======================================================= */
const tabs      = $$('.tab');
const tabPanels = $$('.tab-panel');
const indicator = $('tabIndicator');
 
function switchTab(tabEl) {
  tabs.forEach(t => t.classList.remove('active'));
  tabPanels.forEach(p => p.classList.remove('active'));
  tabEl.classList.add('active');
  const tabId = tabEl.dataset.tab;
  $(`tab-${tabId}`)?.classList.add('active');
  if (indicator) {
    indicator.style.background = tabId === 'danger' ? 'var(--red)' : 'var(--accent)';
    const rect    = tabEl.getBoundingClientRect();
    const barRect = tabEl.parentElement.getBoundingClientRect();
    indicator.style.left  = (rect.left - barRect.left) + 'px';
    indicator.style.width = rect.width + 'px';
  }
  if (tabId === 'danger')      loadTransferMembers();
  else if (tabId === 'privacy') loadPrivacySettings();
  else if (tabId === 'users')   loadMembers();
  else if (tabId === 'invitations') { loadSentInvitations(); loadInviteLinks(); }
}
 
tabs.forEach(tab => tab.addEventListener('click', () => switchTab(tab)));
requestAnimationFrame(() => {
  const activeTab = document.querySelector('.tab.active');
  if (activeTab) switchTab(activeTab);
});
 
/* =======================================================
   MEMBERS
   ======================================================= */
let members       = [];
let isAdminUser   = false;
let removingMemberId = null;
 
async function loadMembers() {
  try {
    const r    = await fetch(`/api/workspace/${workspaceId}/members/`, { credentials: 'same-origin' });
    const data = await r.json();
    members     = data.members;
    isAdminUser = data.is_admin;
    renderMembers();
  } catch (err) {
    console.error('Error loading members:', err);
    const list = $('memberList');
    if (list) list.innerHTML = '<p style="color:var(--red);padding:20px;">Failed to load members</p>';
  }
}
 
function renderMembers() {
  const list      = $('memberList');
  const countText = $('memberCountText');
  if (!list) return;
 
  if (countText) {
    const c = members.length;
    countText.textContent = c === 1 ? '1 person in this workspace' : `${c} people in this workspace`;
  }
  list.innerHTML = '';
 
  if (!members.length) {
    list.innerHTML = '<p style="color:var(--muted);padding:20px;text-align:center;">No members</p>';
    return;
  }
 
  members.forEach((m, i) => {
    const row = document.createElement('div');
    row.className = 'member-row';
    row.style.animationDelay = `${i * 0.05}s`;
 
    const avHTML = m.avatar
      ? `<img src="${m.avatar}" alt="${m.display_name}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;"/>`
      : initials(m.display_name);
 
    const isCurrentUser = m.id === currentUserId;
    const isAdmin       = m.role === 'admin';
    let actionBtn = '';
 
    if (!isCurrentUser && !isAdmin && isAdminUser) {
      if (removingMemberId === m.id) {
        actionBtn = `
          <div class="member-row-actions confirm-mode">
            <button class="member-confirm-btn" data-user-id="${m.id}" data-username="${m.username}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>Confirm
            </button>
            <button class="member-cancel-btn" data-user-id="${m.id}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>Cancel
            </button>
          </div>`;
      } else {
        actionBtn = `
          <button class="remove-btn" data-user-id="${m.id}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2l-2-14"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>Remove
          </button>`;
      }
    }
 
    row.innerHTML = `
      <div class="member-row-content">
        <div class="member-row-av" style="background:${avatarColor(m.display_name)}">${avHTML}
          <span class="status-dot ${m.status}"></span>
        </div>
        <div class="member-row-info">
          <div class="member-row-name">${m.display_name} <span class="member-role-badge ${m.role.toLowerCase()}">${m.role}</span></div>
          <div class="member-row-status">${m.status}</div>
        </div>
      </div>${actionBtn}`;
    list.appendChild(row);
  });
 
  $$('.remove-btn').forEach(btn =>
    btn.addEventListener('click', () => { removingMemberId = parseInt(btn.dataset.userId, 10); renderMembers(); })
  );
  $$('.member-confirm-btn').forEach(btn =>
    btn.addEventListener('click', () => removeMember(btn.dataset.username, parseInt(btn.dataset.userId, 10)))
  );
  $$('.member-cancel-btn').forEach(btn =>
    btn.addEventListener('click', () => { removingMemberId = null; renderMembers(); })
  );
}
 
async function removeMember(uname, userId) {
  try {
    const fd = new FormData();
    fd.append('username', uname);
    fd.append('csrfmiddlewaretoken', getCSRFToken());
    const r    = await fetch(`/workspace/${workspaceId}/remove-member/`, {
      method: 'POST', body: fd, credentials: 'same-origin',
      headers: { 'X-Requested-With': 'XMLHttpRequest' }
    });
    const data = await r.json();
    if (data.success) {
      members = members.filter(m => m.id !== userId);
      removingMemberId = null;
      renderMembers();
      showSuccessMessage(data.message || `${uname} removed`);
    } else {
      showErrorMessage(data.error || 'Failed to remove member');
      removingMemberId = null;
    }
  } catch (err) {
    console.error('Remove error:', err);
    showErrorMessage('Error removing member');
    removingMemberId = null;
  }
}
 
function showSuccessMessage(msg) { _showMsg(msg, 'success'); }
function showErrorMessage(msg)   { _showMsg(msg, 'error');   }
function _showMsg(msg, type) {
  const el = document.createElement('div');
  el.className = `messages ${type}`;
  el.innerHTML = `<div class="message ${type}">${msg}</div>`;
  const view = document.getElementById('view-settings');
  const hdr  = view?.querySelector('.view-header');
  if (hdr) { hdr.parentElement.insertBefore(el, hdr.nextSibling); setTimeout(() => el.remove(), 3000); }
}
 
if (workspaceId) loadMembers();
 
/* =======================================================
   INVITE LINKS
   ======================================================= */
let inviteLinks = [];
 
async function loadInviteLinks() {
  try {
    const r    = await fetch(`/api/workspace/${workspaceId}/invite-links/`);
    const data = await r.json();
    inviteLinks = data.links || [];
    renderInviteLinks();
  } catch (err) { console.error('Failed to load invite links', err); }
}
 
const createInviteBtn = $('createInviteBtn');
if (createInviteBtn) {
  createInviteBtn.addEventListener('click', async () => {
    try {
      const expiryInput = prompt("Expiry in days (leave blank for no expiry):");
      let expires_in_days = null;
      if (expiryInput !== null && expiryInput.trim() !== "") {
        const days = parseInt(expiryInput, 10);
        if (isNaN(days) || days <= 0) { alert("Enter a valid number of days"); return; }
        expires_in_days = days;
      }
      const r    = await fetch(`/api/workspace/${workspaceId}/create-invite/`, {
        method: 'POST',
        headers: { 'X-CSRFToken': getCSRFToken(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ expires_in_days })
      });
      const data = await r.json();
      if (data.success) { inviteLinks.push(data.link); renderInviteLinks(); showSuccessMessage("Invite link created"); }
      else showErrorMessage(data.error || "Failed to create invite link");
    } catch (err) { showErrorMessage("Failed to create invite link"); }
  });
}
 
function renderInviteLinks() {
  const el = $('inviteLinks');
  if (!el) return;
  if (!inviteLinks.length) {
    el.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:.8rem;border:1px dashed var(--border);border-radius:10px;">No active invite links</div>`;
    return;
  }
  el.innerHTML = '';
  inviteLinks.forEach(lnk => {
    const row = document.createElement('div');
    row.className = 'invite-link-row';
    row.innerHTML = `
      <div style="flex:1;min-width:0;">
        <div class="invite-link-code">${lnk.code}</div>
        <div class="invite-link-meta" style="${lnk.is_expired ? 'color:var(--red)' : ''}">
          ${lnk.is_expired ? '⚠' : '✓'} Expires: ${lnk.expires} · ${lnk.usage} uses${lnk.created_by ? ' · by ' + lnk.created_by : ''}
        </div>
      </div>
      <div class="invite-link-actions">
        <button class="icon-btn copy-lnk" data-id="${lnk.id}" title="Copy" ${lnk.is_expired ? 'disabled' : ''}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        </button>
        <button class="icon-btn revoke-lnk" data-id="${lnk.id}" title="Revoke">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
        </button>
      </div>`;
    el.appendChild(row);
  });
 
  $$('.copy-lnk').forEach(btn => btn.addEventListener('click', async () => {
    if (btn.disabled) return;
    const lnk = inviteLinks.find(l => String(l.id) === btn.dataset.id);
    if (!lnk || lnk.is_expired) return;
    try {
      await navigator.clipboard.writeText(window.location.origin + lnk.code);
      btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`;
      setTimeout(() => btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`, 1800);
    } catch {}
  }));
  $$('.revoke-lnk').forEach(btn => btn.addEventListener('click', async () => {
    try {
      await fetch(`/api/invite/${btn.dataset.id}/revoke/`, { method: 'POST', headers: { 'X-CSRFToken': getCSRFToken() } });
      inviteLinks = inviteLinks.filter(l => String(l.id) !== btn.dataset.id);
      renderInviteLinks();
    } catch (err) { console.error('Revoke failed', err); }
  }));
}
 
document.addEventListener('DOMContentLoaded', () => { loadInviteLinks(); renderInviteLinks(); });
 
/* =======================================================
   SENT INVITATIONS
   ======================================================= */
let sentInvitations = [];
 
async function loadSentInvitations() {
  try {
    const r    = await fetch(`/api/workspace/${workspaceId}/sent-invitations/`);
    const data = await r.json();
    sentInvitations = data.invitations;
    renderSentInvitations();
  } catch (err) { console.error('Error loading sent invitations:', err); }
}
 
function renderSentInvitations() {
  const el = $('sentInvitesList');
  if (!el) return;
  el.innerHTML = '';
  if (!sentInvitations.length) {
    el.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:.85rem;border:1px dashed var(--border);border-radius:10px;">No invitations sent yet</div>`;
    return;
  }
  sentInvitations.forEach(inv => {
    const row = document.createElement('div');
    row.className = 'invite-item';
    row.innerHTML = `
      <div style="flex:1;">
        <div class="invite-item-email">${inv.recipient}</div>
        <div class="invite-item-meta"><span class="role-badge ${inv.role}">${inv.role}</span> · Sent ${inv.created_at}</div>
      </div>
      <span class="invite-status ${inv.status}">${inv.status}</span>`;
    el.appendChild(row);
  });
}
 
const sendInviteBtn = $('sendIdentifierInviteBtn');
if (sendInviteBtn) {
  sendInviteBtn.addEventListener('click', async () => {
    const identifiers = $('identifierInviteInput').value.trim().split(',').map(s => s.trim()).filter(Boolean);
    const role        = $('roleSelect').value;
    if (!identifiers.length) { showErrorMessage('No emails or usernames provided'); return; }
 
    sendInviteBtn.disabled = true;
    sendInviteBtn.textContent = 'Sending…';
    let ok = 0, fail = 0;
 
    for (const identifier of identifiers) {
      try {
        const r = await fetch(`/api/workspace/${workspaceId}/send-invitation/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-CSRFToken': getCSRFToken() },
          credentials: 'same-origin',
          body: JSON.stringify({ identifier, role })
        });
        const data = await r.json();
        if (r.ok && data.success) ok++; else fail++;
      } catch { fail++; }
    }
 
    sendInviteBtn.disabled = false;
    sendInviteBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg> Send Invitations`;
 
    if (ok)   { showSuccessMessage(`${ok} invitation(s) sent!`); $('identifierInviteInput').value = ''; await loadSentInvitations(); }
    if (fail) { showErrorMessage(`${fail} invitation(s) failed.`); }
  });
}
 
const inviteMemberBtn = $('inviteMemberBtn');
if (inviteMemberBtn) {
  inviteMemberBtn.addEventListener('click', () => { document.querySelector('.tab[data-tab="invitations"]')?.click(); });
}
 
/* =======================================================
   PRIVACY SETTINGS
   ======================================================= */
let currentPrivacySettings = {};
 
async function loadPrivacySettings() {
  try {
    const r    = await fetch(`/api/workspace/${workspaceId}/privacy-settings/`);
    const data = await r.json();
    if (!r.ok) return;
    currentPrivacySettings = data;
    isAdminUser = data.is_admin;
    updatePrivacyUI();
  } catch (err) { console.error('Privacy load error:', err); }
}
 
function updatePrivacyUI() {
  const vp = $('visPublic'); const vpr = $('visPrivate');
  const it = $('inviteToggle'); const pt = $('profileToggle');
  const rs = $('messageRetentionSelect'); const sb = $('savePrivacyBtn');
  if (!vp || !vpr || !it || !rs || !sb) return;
 
  if (currentPrivacySettings.visibility === 'public') { vp.classList.add('active'); vpr.classList.remove('active'); }
  else { vpr.classList.add('active'); vp.classList.remove('active'); }
 
  currentPrivacySettings.invites_restricted_to_admins ? it.classList.add('active') : it.classList.remove('active');
  if (pt) pt.classList.remove('active');
 
  const days = currentPrivacySettings.message_retention_days;
  rs.value = days === null ? 'Forever' : days === 7 ? '7 Days' : days === 30 ? '30 Days' : days === 90 ? '90 Days' : 'Forever';
 
  const disabled = !isAdminUser;
  [vp, vpr, it, rs, sb].forEach(el => el.disabled = disabled);
  if (pt) pt.disabled = disabled;
}
 
['visPublic','visPrivate'].forEach(id => {
  $(id)?.addEventListener('click', () => {
    $('visPublic')?.classList.toggle('active', id === 'visPublic');
    $('visPrivate')?.classList.toggle('active', id === 'visPrivate');
  });
});
$('inviteToggle')?.addEventListener('click', () => $('inviteToggle').classList.toggle('active'));
$('profileToggle')?.addEventListener('click', () => $('profileToggle').classList.toggle('active'));
 
$('savePrivacyBtn')?.addEventListener('click', async () => {
  if (!isAdminUser) { showErrorMessage('Only admins can save privacy settings'); return; }
  const visibility = $('visPublic')?.classList.contains('active') ? 'public' : 'private';
  const invitesRestricted = $('inviteToggle')?.classList.contains('active');
  const retVal = $('messageRetentionSelect')?.value;
  let messageRetentionDays = null;
  if (retVal && retVal !== 'Forever') { const m = retVal.match(/\d+/); if (m) messageRetentionDays = parseInt(m[0], 10); }
 
  const btn = $('savePrivacyBtn');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const r = await fetch(`/api/workspace/${workspaceId}/update-privacy-settings/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCSRFToken() },
      credentials: 'same-origin',
      body: JSON.stringify({ visibility, invites_restricted_to_admins: invitesRestricted, message_retention_days: messageRetentionDays })
    });
    const data = await r.json();
    if (r.ok && data.success) {
      showSuccessMessage('Privacy settings saved!');
      currentPrivacySettings = data.settings;
      const msg = $('saveConfirm');
      if (msg) { msg.classList.add('visible'); setTimeout(() => msg.classList.remove('visible'), 2500); }
    } else showErrorMessage(data.error || 'Failed to save');
  } catch { showErrorMessage('Error saving privacy settings'); }
  finally { btn.disabled = false; btn.textContent = 'Save Changes'; }
});
 
/* =======================================================
   DANGER ZONE
   ======================================================= */
function loadTransferMembers() {
  const select = $('transferSelect');
  if (!select) return;
  while (select.options.length > 1) select.remove(1);
  members.forEach(m => {
    if (m.role !== 'admin' && m.id !== currentUserId) {
      const o = document.createElement('option');
      o.value = m.username; o.textContent = m.display_name || m.username;
      select.appendChild(o);
    }
  });
}
 
$('transferBtn')?.addEventListener('click', async () => {
  const target = $('transferSelect').value;
  if (!target) { showErrorMessage('Select a member'); return; }
  if (!confirm('Are you sure? You will become a regular member.')) return;
  const btn = $('transferBtn'); btn.disabled = true; btn.textContent = 'Transferring…';
  try {
    const r = await fetch(`/api/workspace/${workspaceId}/transfer-ownership/`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCSRFToken(), 'X-Requested-With': 'XMLHttpRequest' },
      credentials: 'same-origin', body: JSON.stringify({ target_username: target })
    });
    const data = await r.json();
    if (r.ok && data.success) { showSuccessMessage('Ownership transferred!'); setTimeout(() => location.reload(), 1500); }
    else { showErrorMessage(data.error || 'Failed'); btn.disabled = false; btn.textContent = 'Transfer'; }
  } catch { showErrorMessage('Error transferring ownership'); btn.disabled = false; btn.textContent = 'Transfer'; }
});
 
$('leaveWorkspaceBtn')?.addEventListener('click', async () => {
  if (!confirm('Are you sure you want to leave?')) return;
  const btn = $('leaveWorkspaceBtn'); btn.disabled = true; btn.textContent = 'Leaving…';
  try {
    const r = await fetch(`/api/workspace/${workspaceId}/leave-workspace/`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCSRFToken(), 'X-Requested-With': 'XMLHttpRequest' },
      credentials: 'same-origin', body: JSON.stringify({})
    });
    const data = await r.json();
    if (r.ok && data.success) { showSuccessMessage('You left the workspace'); setTimeout(() => location.href = '/profile/', 1500); }
    else { showErrorMessage(data.error || 'Failed'); btn.disabled = false; btn.textContent = 'Leave Workspace'; }
  } catch { showErrorMessage('Error leaving'); btn.disabled = false; btn.textContent = 'Leave Workspace'; }
});
 
$('showDeleteBtn')?.addEventListener('click', () => {
  $('deleteConfirmArea').style.display = 'block';
  $('showDeleteBtn').style.display = 'none';
  const name = document.querySelector('[data-workspace-title]')?.getAttribute('data-workspace-title') || document.querySelector('.ws-selector-name')?.textContent || 'Workspace';
  $('workspaceNameConfirm').textContent = name;
});
$('cancelDeleteBtn')?.addEventListener('click', () => {
  $('deleteConfirmArea').style.display = 'none';
  $('showDeleteBtn').style.display = '';
  $('deleteConfirmInput').value = '';
  $('confirmDeleteBtn').disabled = true;
});
$('deleteConfirmInput')?.addEventListener('input', () => {
  const name = document.querySelector('[data-workspace-title]')?.getAttribute('data-workspace-title') || document.querySelector('.ws-selector-name')?.textContent || 'Workspace';
  $('confirmDeleteBtn').disabled = $('deleteConfirmInput').value !== name;
});
$('confirmDeleteBtn')?.addEventListener('click', async () => {
  const name = document.querySelector('[data-workspace-title]')?.getAttribute('data-workspace-title') || document.querySelector('.ws-selector-name')?.textContent || 'Workspace';
  const btn = $('confirmDeleteBtn'); btn.disabled = true; btn.textContent = 'Deleting…';
  try {
    const r = await fetch(`/api/workspace/${workspaceId}/delete-workspace/`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCSRFToken(), 'X-Requested-With': 'XMLHttpRequest' },
      credentials: 'same-origin', body: JSON.stringify({ title: name })
    });
    const data = await r.json();
    if (r.ok && data.success) { showSuccessMessage('Workspace deleted!'); setTimeout(() => location.href = '/profile/', 1500); }
    else { showErrorMessage(data.error || 'Failed'); btn.disabled = false; btn.textContent = 'Permanently Delete'; }
  } catch { showErrorMessage('Error deleting'); btn.disabled = false; btn.textContent = 'Permanently Delete'; }
});
 
/* =======================================================
   GLOBAL ESC — closes AI panel (using base_layout's 'visible' class)
   ======================================================= */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.getElementById('aiPanel')?.classList.remove('visible');
    document.getElementById('profileOverlay')?.classList.remove('visible');
    emojiPickerContainer.style.display = 'none';
    emojiPickerOpen = false;
  }
});
 


/* ══════════════════════════════════════════════════
   UTILITIES
══════════════════════════════════════════════════ */
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// Global ESC to close overlays
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    profileOverlay.classList.remove('visible');
    taskOverlay.classList.remove('visible');
    aiPanel.classList.remove('visible');
  }
});

