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
    const resp = await fetch(`/api/workspace/${workspaceId}/messages/?limit=200`, { credentials: 'same-origin' });
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
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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
  av.textContent = initials(sender);
  av.style.background = avatarColor(sender);

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
async function loadDMHistory(userId) {

  chatContainer.innerHTML = "";
  lastMessageDayKey = null;

  try {

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

  } catch (err) {
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
  '😮', '😯', '😲', '😳', '��', '😦', '😧', '😨', '😰', '😥',
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


/* ==========================================
   GLOBAL ESC
   ========================================== */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    ['aiPanel', 'profileOverlay', 'taskOverlay'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.remove('visible');
    });
    try { if (typeof emojiPickerContainer !== 'undefined') emojiPickerContainer.style.display = 'none'; if (typeof emojiPickerOpen !== 'undefined') emojiPickerOpen = false; } catch (e) { }
  }
});

/* ==========================================
   UTILITIES
   ========================================== */
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }