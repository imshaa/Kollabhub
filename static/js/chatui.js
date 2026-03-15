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
  loadDMHistory(userId);
  if (messageInput) messageInput.placeholder = `Message ${username}`;
  setTimeout(() => {
    if (messageInput) messageInput.focus();
  }, 100);
}

// Loading DM history when opening a DM chat window
async function loadDMHistory(userId){

  chatContainer.innerHTML = "";

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



// --- Modal/View switching logic for sidebar nav and settings/profile ---
function switchView(view) {
  // if leaving chat view, tear down any DM subscription
  if (view !== 'chat' && currentDMUser) {
    leaveDM(currentDMUser);
    currentDMUser = null;
    lastDMUser = null;
    const titleEl = document.getElementById('chatChannelTitle');
    if (titleEl) {
      titleEl.innerText = 'general';
      titleEl.classList.remove('dm-header');
    }
    const chatSubtitle = document.querySelector('.view-subtitle');
    if (chatSubtitle) chatSubtitle.innerText = 'Topic: Team announcements and general chatter';
    if (messageInput) messageInput.placeholder = 'Message #general';
  }
  $$('.view').forEach(v => v.classList.remove('active'));
  const el = document.getElementById('view-' + view);
  if (el) el.classList.add('active');
  // Remove active from nav
  $$('.nav-item').forEach(b => b.classList.remove('active'));
  // Set active nav
  const navBtn = document.querySelector('.nav-item[data-view="' + view + '"]');
  if (navBtn) navBtn.classList.add('active');
}

// Sidebar nav buttons (Chat, Tasks, Settings)
$$('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    const view = btn.getAttribute('data-view');
    switchView(view);
  });
});

// Settings icon in sidebar footer
const settingsBtn = document.querySelector('.icon-btn[data-view-trigger="settings"]');
const sidebarSettingsBtn = document.getElementById('sidebarSettingsBtn');
if (settingsBtn) {
  settingsBtn.addEventListener('click', () => switchView('settings'));
}
if (sidebarSettingsBtn) {
  sidebarSettingsBtn.addEventListener('click', () => switchView('settings'));
}

// Profile modal open (sidebar footer)
const openProfileBtn = document.getElementById('openProfileBtn');
// Use the existing profileOverlay reference from later in the file
// (let the later code own the variable)
if (openProfileBtn && $('profileOverlay')) {
  openProfileBtn.addEventListener('click', () => {
    $('profileOverlay').classList.add('visible');
  });
}

// Profile modal close
const profileCloseBtn = document.getElementById('profileCloseBtn');
const profileCancelBtn = document.getElementById('profileCancelBtn');
if (profileCloseBtn && $('profileOverlay')) {
  profileCloseBtn.addEventListener('click', () => $('profileOverlay').classList.remove('visible'));
}
if (profileCancelBtn && $('profileOverlay')) {
  profileCancelBtn.addEventListener('click', () => $('profileOverlay').classList.remove('visible'));
}
if ($('profileOverlay')) {
  $('profileOverlay').addEventListener('click', e => { if (e.target === $('profileOverlay')) $('profileOverlay').classList.remove('visible'); });
}


// Visibility settings toggles
(function initVisibilityToggles(){
  const onlineToggle = document.getElementById('onlineStatusToggle');
  const lastSeenToggle = document.getElementById('lastSeenToggle');
  function updateVisibility() {
    const showOnline = onlineToggle ? onlineToggle.checked : true;
    document.querySelectorAll('.status-dot').forEach(el => {
      el.style.visibility = showOnline ? '' : 'hidden';
    });
  }
  if (onlineToggle) {
    onlineToggle.addEventListener('change', updateVisibility);
    updateVisibility();
  }
  // lastSeenToggle could be wired similarly when last-seen timestamps shown
})();


// Channel switcher
$$('.channel-item').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.channel-item').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const ch = btn.dataset.channel;
    $('chatChannelTitle').textContent = ch;
    $('chatInput').placeholder = `Message #${ch}`;
    switchView('chat');
  });
});

// ========== CHANNELS (dynamic, per workspace) ========== //
let channels = ["general"];
if (window.localStorage && workspaceId) {
  // Load channels for this workspace from localStorage
  const saved = localStorage.getItem("channels_" + workspaceId);
  if (saved) {
    try { channels = JSON.parse(saved); } catch {}
  }
}

function saveChannels() {
  if (window.localStorage && workspaceId) {
    localStorage.setItem("channels_" + workspaceId, JSON.stringify(channels));
  }
}

function renderChannels() {
  const list = document.getElementById("channelList");
  if (!list) return;
  list.innerHTML = "";
  channels.forEach((ch, i) => {
    const btn = document.createElement("button");
    btn.className = "channel-item" + (i === 0 ? " active" : "");
    btn.setAttribute("data-channel", ch);
    btn.textContent = "# " + ch;
    btn.addEventListener("click", () => {
      $$('.channel-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      $('chatChannelTitle').textContent = ch;
      $('chatInput').placeholder = `Message #${ch}`;
      switchView('chat');
      // Optionally: update current channel for websocket logic if needed
    });
    list.appendChild(btn);
  });
}
renderChannels();

// Add channel button logic
const addChannelBtn = document.getElementById('addChannelBtn');
const addChannelInputWrap = document.getElementById('addChannelInputWrap');
const addChannelInput = document.getElementById('addChannelInput');
const confirmAddChannelBtn = document.getElementById('confirmAddChannelBtn');
if (addChannelBtn && addChannelInputWrap && addChannelInput && confirmAddChannelBtn) {
  addChannelBtn.addEventListener('click', () => {
    addChannelInputWrap.style.display = 'flex';
    addChannelInput.value = '';
    addChannelInput.focus();
  });
  confirmAddChannelBtn.addEventListener('click', () => {
    const name = addChannelInput.value.trim();
    if (!name || channels.includes(name)) return;
    channels.push(name);
    saveChannels();
    renderChannels();
    addChannelInputWrap.style.display = 'none';
  });
  addChannelInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      confirmAddChannelBtn.click();
    } else if (e.key === 'Escape') {
      addChannelInputWrap.style.display = 'none';
    }
  });
}



/* ══════════════════════════════════════════════════
   2. KANBAN TASK BOARD
══════════════════════════════════════════════════ */
const COLUMNS = [
  { id: 'todo',       label: 'To Do',       color: '#60a5fa' },
  { id: 'inprogress', label: 'In Progress',  color: '#facc15' },
  { id: 'review',     label: 'In Review',   color: '#a78bfa' },
  { id: 'done',       label: 'Done',        color: '#4ade80' },
];

let tasks = [
  { id: 1, title: 'Redesign onboarding flow',       col: 'todo',       priority: 'high',   assignee: 'Sarah Chen'  },
  { id: 2, title: 'Component library audit',        col: 'todo',       priority: 'medium', assignee: 'Alex Morgan' },
  { id: 3, title: 'Dark mode token system',         col: 'inprogress', priority: 'high',   assignee: 'David Kim'   },
  { id: 4, title: 'Figma handoff for sprint 4',    col: 'inprogress', priority: 'medium', assignee: 'Alex Morgan' },
  { id: 5, title: 'Accessibility review – nav',     col: 'review',     priority: 'medium', assignee: 'Mia Torres'  },
  { id: 6, title: 'Icon set v2 export',             col: 'review',     priority: 'low',    assignee: 'Sarah Chen'  },
  { id: 7, title: 'Design system doc site',        col: 'done',       priority: 'low',    assignee: 'David Kim'   },
  { id: 8, title: 'Q3 brand refresh proposal',     col: 'done',       priority: 'high',   assignee: 'Alex Morgan' },
];

let nextId = 9;

function renderKanban() {
  const kanban = $('kanban');
  kanban.innerHTML = '';
  COLUMNS.forEach(col => {
    const colTasks = tasks.filter(t => t.col === col.id);
    const colEl = document.createElement('div');
    colEl.className = 'kanban-col';
    colEl.innerHTML = `
      <div class="kanban-col-header">
        <div class="col-title">
          <div class="col-dot" style="background:${col.color}"></div>
          ${col.label}
        </div>
        <span class="col-count">${colTasks.length}</span>
      </div>
      <div class="kanban-cards" id="col-${col.id}"></div>
    `;
    kanban.appendChild(colEl);

    const cardsEl = colEl.querySelector(`#col-${col.id}`);
    colTasks.forEach((task, i) => {
      const card = document.createElement('div');
      card.className = 'task-card';
      card.style.animationDelay = `${i * 0.05}s`;
      card.innerHTML = `
        <div class="task-card-title">${task.title}</div>
        <div class="task-card-meta">
          <span class="task-priority ${task.priority}">${task.priority}</span>
          <div class="task-assignee" style="background:${avatarColor(task.assignee)}" title="${task.assignee}">${initials(task.assignee)}</div>
        </div>
      `;
      cardsEl.appendChild(card);
    });
  });
}

renderKanban();

/* Add task modal */
const taskOverlay = $('taskOverlay');

const addTaskBtn = $('addTaskBtn');
if (addTaskBtn) {
  addTaskBtn.addEventListener('click', () => {
    if (taskOverlay) taskOverlay.classList.add('visible');
    const taskTitle = $('taskTitle');
    if (taskTitle) taskTitle.focus();
  });
}

const taskCloseBtn = $('taskCloseBtn');
if (taskCloseBtn) {
  taskCloseBtn.addEventListener('click',  closeTaskModal);
}

const taskCancelBtn = $('taskCancelBtn');
if (taskCancelBtn) {
  taskCancelBtn.addEventListener('click', closeTaskModal);
}

if (taskOverlay) {
  taskOverlay.addEventListener('click', e => { if (e.target === taskOverlay) closeTaskModal(); });
}

function closeTaskModal() {
  taskOverlay.classList.remove('visible');
  $('taskTitle').value = '';
  $('taskTitleErr').classList.remove('visible');
}

// Priority selector
let selectedPriority = 'medium';
$$('.priority-opt').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.priority-opt').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedPriority = btn.dataset.p;
  });
});

const taskSaveBtn = $('taskSaveBtn');
if (taskSaveBtn) {
  taskSaveBtn.addEventListener('click', () => {
    const title = $('taskTitle').value.trim();
    if (!title) {
      const err = $('taskTitleErr');
      err.textContent = 'Task title is required';
      err.classList.add('visible');
      $('taskTitle').focus();
      return;
    }
    tasks.push({
      id: nextId++,
      title,
      col: $('taskColumn').value,
      priority: selectedPriority,
      assignee: $('taskAssignee').value,
    });
    renderKanban();
    closeTaskModal();
  });
}

/* ══════════════════════════════════════════════════
   3. SETTINGS TABS
══════════════════════════════════════════════════ */
const tabs      = $$('.tab');
const tabPanels = $$('.tab-panel');
const indicator = $('tabIndicator');

function switchTab(tabEl) {
  tabs.forEach(t => t.classList.remove('active'));
  tabPanels.forEach(p => p.classList.remove('active'));
  tabEl.classList.add('active');

  const tabId = tabEl.dataset.tab;
  $(`tab-${tabId}`)?.classList.add('active');

  // danger tab: red indicator
  indicator.style.background = tabId === 'danger' ? 'var(--red)' : 'var(--accent)';

  // move indicator
  const rect   = tabEl.getBoundingClientRect();
  const barRect = tabEl.parentElement.getBoundingClientRect();
  indicator.style.left  = (rect.left - barRect.left) + 'px';
  indicator.style.width = rect.width + 'px';
  
  // Load data when tabs are accessed
  if (tabId === 'danger') {
    loadTransferMembers();
  } else if (tabId === 'privacy') {
    loadPrivacySettings();
  }
}

tabs.forEach(tab => tab.addEventListener('click', () => switchTab(tab)));

// Init indicator on first active tab
requestAnimationFrame(() => {
  const activeTab = document.querySelector('.tab.active');
  if (activeTab) switchTab(activeTab);
});

/* ── Members list ─────────────────────────────── */

let members = [];
// Try to get isAdminUser from data attributes, default to false
let isAdminUser = document.body.dataset.isAdmin === 'true' || chatContainer?.dataset?.isAdmin === 'true' ? true : false;
console.log('Initial isAdminUser value:', isAdminUser);
let removingMemberId = null;

// Fetch members from API
async function loadMembers() {
  try {
    const response = await fetch(`/api/workspace/${workspaceId}/members/`, {
      credentials: 'same-origin'
    });
    if (!response.ok) throw new Error('Failed to fetch members');
    const data = await response.json();
    members = data.members;
    isAdminUser = data.is_admin;
    renderMembers();
  } catch (err) {
    console.error('Error loading members:', err);
    const list = $('memberList');
    list.innerHTML = '<p style="color:var(--red);padding:20px;">Failed to load members</p>';
  }
}

function renderMembers() {
  const list = $('memberList');
  const countText = $('memberCountText');
  
  // Update member count
  if (countText) {
    const count = members.length;
    countText.textContent = count === 1 
      ? '1 person in this workspace' 
      : `${count} people in this workspace`;
  }

  list.innerHTML = '';

  if (members.length === 0) {
    list.innerHTML = '<p style="color:var(--muted);padding:20px;text-align:center;">No members in this workspace</p>';
    return;
  }

  members.forEach((m, i) => {
    const row = document.createElement('div');
    row.className = 'member-row';
    row.style.animationDelay = `${i * 0.05}s`;
    
    const memberAvatar = m.avatar 
      ? `<img src="${m.avatar}" alt="${m.display_name}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;"/>`
      : `${initials(m.display_name)}`;

    const isCurrentUser = m.id === currentUserId;
    const isAdmin = m.role === 'admin';
    
    let actionButton = '';
    if (!isCurrentUser && !isAdmin && isAdminUser) {
      // Show remove button for admins removing non-admin members
      if (removingMemberId === m.id) {
        actionButton = `
          <div class="member-row-actions confirm-mode">
            <button class="member-confirm-btn" data-user-id="${m.id}" data-username="${m.username}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
              Confirm
            </button>
            <button class="member-cancel-btn" data-user-id="${m.id}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              Cancel
            </button>
          </div>
        `;
      } else {
        actionButton = `
          <button class="remove-btn" data-user-id="${m.id}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2l-2-14"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
            Remove
          </button>
        `;
      }
    }

    row.innerHTML = `
      <div class="member-row-content">
        <div class="member-row-av" style="background:${avatarColor(m.display_name)}">
          ${memberAvatar}
          <span class="status-dot ${m.status}"></span>
        </div>
        <div class="member-row-info">
          <div class="member-row-name">
            ${m.display_name}
            <span class="member-role-badge ${m.role.toLowerCase()}">${m.role}</span>
          </div>
          <div class="member-row-status">${m.status}</div>
        </div>
      </div>
      ${actionButton}
    `;
    
    list.appendChild(row);
  });

  // Attach event listeners
  $$('.remove-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const userId = parseInt(btn.dataset.userId, 10);
      removingMemberId = userId;
      renderMembers();
    });
  });

  $$('.member-confirm-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const username = btn.dataset.username;
      const userId = parseInt(btn.dataset.userId, 10);
      await removeMember(username, userId);
    });
  });

  $$('.member-cancel-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      removingMemberId = null;
      renderMembers();
    });
  });
}

async function removeMember(username, userId) {
  try {
    const formData = new FormData();
    formData.append('username', username);
    formData.append('csrfmiddlewaretoken', getCSRFToken());
    
    console.log('Attempting to remove member:', username, 'User ID:', userId);
    console.log('Workspace ID:', workspaceId);
    
    const response = await fetch(
      `/workspace/${workspaceId}/remove-member/`,
      {
        method: 'POST',
        body: formData,
        credentials: 'same-origin',
        headers: {
          'X-Requested-With': 'XMLHttpRequest'
        }
      }
    );

    console.log('Response status:', response.status);
    const data = await response.json();
    console.log('Response data:', data);

    if (data.success) {
      // Remove from local list and update UI
      members = members.filter(m => m.id !== userId);
      removingMemberId = null;
      renderMembers();
      showSuccessMessage(data.message || `${username} has been removed`);
    } else if (data.error) {
      showErrorMessage(data.error);
      removingMemberId = null;
    } else {
      showErrorMessage('Failed to remove member');
      removingMemberId = null;
    }
  } catch (err) {
    console.error('Error removing member:', err);
    showErrorMessage('Error removing member. Please try again.');
    removingMemberId = null;
  }
}

function showSuccessMessage(msg) {
  const messageEl = document.createElement('div');
  messageEl.className = 'messages success';
  messageEl.innerHTML = `<div class="message success">${msg}</div>`;
  const view = document.getElementById('view-settings');
  if (view) {
    const header = view.querySelector('.view-header');
    if (header) {
      header.parentElement.insertBefore(messageEl, header.nextSibling);
      setTimeout(() => messageEl.remove(), 3000);
    }
  }
}

function showErrorMessage(msg) {
  const messageEl = document.createElement('div');
  messageEl.className = 'messages error';
  messageEl.innerHTML = `<div class="message error">${msg}</div>`;
  const view = document.getElementById('view-settings');
  if (view) {
    const header = view.querySelector('.view-header');
    if (header) {
      header.parentElement.insertBefore(messageEl, header.nextSibling);
      setTimeout(() => messageEl.remove(), 3000);
    }
  }
}

// Load members when settings view is clicked
const settingsTabs = $$('.tab[data-tab="users"]');
settingsTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    // Refresh members when switching to users tab
    loadMembers();
  });
});

// Initial load
if (workspaceId) {
  loadMembers();
}

/* ── Invite links ───────────────────────────── */

let inviteLinks = [];

/* Load invite links from backend */
async function loadInviteLinks() {
  try {
    const res = await fetch(`/api/workspace/${workspaceId}/invite-links/`);
    const data = await res.json();

    inviteLinks = data.links || [];
    renderInviteLinks();
  } catch (err) {
    console.error("Failed to load invite links", err);
  }
}


/* Create new invite link */
const createInviteBtn = $('createInviteBtn');

if (createInviteBtn) {
  createInviteBtn.addEventListener('click', async () => {

    try {
      // Prompt user for expiry (optional)
      const expiryInput = prompt("Enter expiry period in days (leave blank for no expiry):");
      let expires_in_days = null;
      
      if (expiryInput !== null && expiryInput.trim() !== "") {
        const days = parseInt(expiryInput, 10);
        if (isNaN(days) || days <= 0) {
          alert("Please enter a valid number of days");
          return;
        }
        expires_in_days = days;
      }

      const res = await fetch(`/api/workspace/${workspaceId}/create-invite/`, {
        method: 'POST',
        headers: {
          "X-CSRFToken": getCSRFToken(),
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ expires_in_days })
      });

      const data = await res.json();

      if (data.success) {
        inviteLinks.push(data.link);
        renderInviteLinks();
        showSuccessMessage("Invite link created successfully");
      } else {
        showErrorMessage(data.error || "Failed to create invite link");
      }

    } catch (err) {
      console.error("Invite creation failed", err);
      showErrorMessage("Failed to create invite link");
    }

  });
}


/* Render invite links */
function renderInviteLinks() {

  const el = $('inviteLinks');
  if (!el) return;

  if (inviteLinks.length === 0) {
    el.innerHTML = `
      <div style="padding:20px;text-align:center;color:var(--text-500);font-size:.8rem;border:1px dashed var(--border);border-radius:var(--radius-lg);">
        No active invite links
      </div>`;
    return;
  }

  el.innerHTML = '';

  inviteLinks.forEach(lnk => {

    const row = document.createElement('div');
    row.className = 'invite-link-row';
    
    // Determine status styling
    let statusColor = '';
    let statusIcon = '✓';
    
    if (lnk.is_expired) {
      statusColor = 'color: var(--red);';
      statusIcon = '⚠';
    }

    row.innerHTML = `
      <div style="flex:1;min-width:0;">
        <div class="invite-link-code">${lnk.code}</div>
        <div class="invite-link-meta" style="${statusColor}">
          ${statusIcon} Expires: ${lnk.expires} · ${lnk.usage} uses
          ${lnk.created_by ? ' · by ' + lnk.created_by : ''}
        </div>
      </div>

      <div class="invite-link-actions">

        <button class="icon-btn copy-lnk" data-id="${lnk.id}" title="Copy" ${lnk.is_expired ? 'disabled' : ''}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
        </button>

        <button class="icon-btn revoke-lnk" data-id="${lnk.id}" title="Revoke">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
          </svg>
        </button>

      </div>
    `;

    el.appendChild(row);
  });


  /* Copy invite link */
  $$('.copy-lnk').forEach(btn => {

    btn.addEventListener('click', async () => {

      if (btn.disabled) return;
      
      const link = inviteLinks.find(l => String(l.id) === btn.dataset.id);
      if (!link || link.is_expired) return;

      const fullLink = window.location.origin + link.code;

      try {

        await navigator.clipboard.writeText(fullLink);

        btn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2.5">
          <polyline points="20 6 9 17 4 12"/>
        </svg>`;

        setTimeout(() => {
          btn.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>`;
        }, 1800);

      } catch (err) {
        console.error("Copy failed", err);
      }

    });

  });


  /* Revoke invite link */
  $$('.revoke-lnk').forEach(btn => {

    btn.addEventListener('click', async () => {

      const inviteId = btn.dataset.id;

      try {

        await fetch(`/api/invite/${inviteId}/revoke/`, {
          method: 'POST',
          headers: {
            "X-CSRFToken": getCSRFToken()
          }
        });

        inviteLinks = inviteLinks.filter(l => String(l.id) !== inviteId);

        renderInviteLinks();

      } catch (err) {
        console.error("Revoke failed", err);
      }

    });

  });

}


/* Load invites when page loads */
document.addEventListener('DOMContentLoaded', () => {

  renderInviteLinks();
  loadInviteLinks();

});

/* ── Sent Invitations ───────────────────────── */
let sentInvitations = [];

async function loadSentInvitations() {
  try {
    const response = await fetch(`/api/workspace/${workspaceId}/sent-invitations/`);
    const data = await response.json();
    sentInvitations = data.invitations;
    renderSentInvitations();
  } catch (err) {
    console.error('Error loading sent invitations:', err);
  }
}

function renderSentInvitations() {
  const el = $('sentInvitesList');
  if (!el) return;
  el.innerHTML = '';
  
  if (sentInvitations.length === 0) {
    el.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-500);font-size:.85rem;border:1px dashed var(--border);border-radius:var(--radius-lg);">No invitations sent yet</div>`;
    return;
  }
  
  sentInvitations.forEach(inv => {
    const row = document.createElement('div');
    row.className = 'invite-item';
    const statusClass = inv.status === 'accepted' ? 'accepted' : 'pending';
    const roleClass = inv.role === 'admin' ? 'admin' : 'member';
    
    row.innerHTML = `
      <div style="flex:1;">
        <div class="invite-item-email">${inv.recipient}</div>
        <div class="invite-item-meta">
          <span class="role-badge ${roleClass}">${inv.role}</span>
          · Sent ${inv.created_at}
        </div>
      </div>
      <span class="invite-status ${statusClass}">${inv.status}</span>
    `;
    el.appendChild(row);
  });
}

/* Send Invitations */
$('sendIdentifierInviteBtn').addEventListener('click', async () => {
  const identifiers = $('identifierInviteInput').value.trim().split(',').map(id => id.trim()).filter(id => id);
  const role = $('roleSelect').value;
  
  if (identifiers.length === 0) {
    showErrorMessage('No emails or usernames provided');
    return;
  }
  
  const btn = $('sendIdentifierInviteBtn');
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = 'Sending…';
  
  let successCount = 0;
  let failureCount = 0;
  
  for (const identifier of identifiers) {
    try {
      console.log('Sending invitation for:', identifier, 'as', role);
      
      const response = await fetch(`/api/workspace/${workspaceId}/send-invitation/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          'X-CSRFToken': getCSRFToken()
        },
        credentials: 'same-origin',
        body: JSON.stringify({ identifier, role })
      });
      
      console.log('Response status:', response.status);
      const data = await response.json();
      console.log('Response data:', data);
      
      if (response.ok && data.success) {
        successCount++;
        console.log('Invitation sent successfully');
      } else {
        failureCount++;
        console.error('Invitation failed:', data.error);
      }
    } catch (err) {
      failureCount++;
      console.error('Error sending invitation:', err);
    }
  }
  
  btn.disabled = false;
  btn.innerHTML = originalText;
  
  if (successCount > 0) {
    showSuccessMessage(`${successCount} invitation(s) sent successfully!`);
    $('identifierInviteInput').value = '';
    $('roleSelect').value = 'member';
    await loadSentInvitations();
  } 
  
  if (failureCount > 0) {
    showErrorMessage(`Failed to send ${failureCount} invitation(s). Check the identifiers and try again.`);
  }
});

/* Invite Member button - navigate to invitations */
$('inviteMemberBtn').addEventListener('click', () => {
  const inviteTab = document.querySelector('.tab[data-tab="invitations"]');
  if (inviteTab) {
    inviteTab.click();
  }
});

/* Load sent invitations when switching to invitations tab */
const inviteTab = document.querySelector('.tab[data-tab="invitations"]');
if (inviteTab) {
  inviteTab.addEventListener('click', () => {
    loadSentInvitations();
  });
}


/* ── Privacy Settings ─────────────────────────── */
let currentPrivacySettings = {};
let privacySettingsLoaded = false;

async function loadPrivacySettings() {
  try {
    const response = await fetch(`/api/workspace/${workspaceId}/privacy-settings/`);
    const data = await response.json();
    
    if (!response.ok) {
      console.error('Error loading privacy settings:', data.error);
      return;
    }
    
    console.log('Privacy settings data:', data);
    console.log('is_admin from API:', data.is_admin);
    
    currentPrivacySettings = data;
    isAdminUser = data.is_admin;
    console.log('isAdminUser now:', isAdminUser);
    updatePrivacyUI();
  } catch (err) {
    console.error('Error loading privacy settings:', err);
  }
}

function updatePrivacyUI() {
  // Update visibility buttons
  const visPublic = $('visPublic');
  const visPrivate = $('visPrivate');
  const inviteToggle = $('inviteToggle');
  const profileToggle = $('profileToggle');
  const retentionSelect = $('messageRetentionSelect');
  const saveBtn = $('savePrivacyBtn');
  
  if (!visPublic || !visPrivate || !inviteToggle || !retentionSelect || !saveBtn) {
    console.warn('Privacy settings elements not found in DOM');
    return;
  }
  
  // Update visibility buttons
  if (currentPrivacySettings.visibility === 'public') {
    visPublic.classList.add('active');
    visPrivate.classList.remove('active');
  } else {
    visPrivate.classList.add('active');
    visPublic.classList.remove('active');
  }
  
  // Update invite restriction toggle
  if (currentPrivacySettings.invites_restricted_to_admins) {
    inviteToggle.classList.add('active');
  } else {
    inviteToggle.classList.remove('active');
  }
  
  // Update profile visibility toggle (front-end only, no backend persistence yet)
  if (profileToggle) {
    // Initialize to unchecked since backend doesn't have this field yet
    profileToggle.classList.remove('active');
  }
  
  // Update message retention select
  if (currentPrivacySettings.message_retention_days === null) {
    retentionSelect.value = 'Forever';
  } else if (currentPrivacySettings.message_retention_days === 7) {
    retentionSelect.value = '7 Days';
  } else if (currentPrivacySettings.message_retention_days === 30) {
    retentionSelect.value = '30 Days';
  } else if (currentPrivacySettings.message_retention_days === 90) {
    retentionSelect.value = '90 Days';
  }
  
  // Handle controls based on admin status
  console.log('updatePrivacyUI - isAdminUser:', isAdminUser);
  
  if (isAdminUser === true) {
    // Enable all controls for admins
    visPublic.disabled = false;
    visPrivate.disabled = false;
    inviteToggle.disabled = false;
    if (profileToggle) profileToggle.disabled = false;
    retentionSelect.disabled = false;
    saveBtn.disabled = false;
    // Remove admin-only notice if it exists
    const privacyPanel = $('tab-privacy');
    const notice = privacyPanel?.querySelector('.admin-only-notice');
    if (notice) notice.remove();
  } else {
    // Disable controls for non-admins
    visPublic.disabled = true;
    visPrivate.disabled = true;
    inviteToggle.disabled = true;
    if (profileToggle) profileToggle.disabled = true;
    retentionSelect.disabled = true;
    saveBtn.disabled = true;
    // Show admin-only message if not already shown
    const privacyPanel = $('tab-privacy');
    if (privacyPanel && !privacyPanel.querySelector('.admin-only-notice')) {
      const notice = document.createElement('div');
      notice.className = 'admin-only-notice';
      notice.innerHTML = '<p style="color: var(--text-500); font-size: 0.85rem; padding: 12px; background: var(--bg); border-radius: var(--radius-md); border: 1px dashed var(--border);">ℹ Only workspace admins can change privacy settings.</p>';
      privacyPanel.insertBefore(notice, privacyPanel.firstChild);
    }
  }
}

// Privacy button event listeners - with null checks
const privacyVisPublic = $('visPublic');
const privacyVisPrivate = $('visPrivate');
if (privacyVisPublic) {
  privacyVisPublic.addEventListener('click', () => {
    privacyVisPublic.classList.add('active');
    privacyVisPrivate?.classList.remove('active');
  });
}
if (privacyVisPrivate) {
  privacyVisPrivate.addEventListener('click', () => {
    privacyVisPrivate.classList.add('active');
    privacyVisPublic?.classList.remove('active');
  });
}

// Invite restriction toggle
const privacyInviteToggle = $('inviteToggle');
if (privacyInviteToggle) {
  privacyInviteToggle.addEventListener('click', () => {
    privacyInviteToggle.classList.toggle('active');
  });
}

// Profile visibility toggle
const privacyProfileToggle = $('profileToggle');
if (privacyProfileToggle) {
  privacyProfileToggle.addEventListener('click', () => {
    privacyProfileToggle.classList.toggle('active');
  });
}

// Save privacy settings
const privacySaveBtn = $('savePrivacyBtn');
if (privacySaveBtn) {
  privacySaveBtn.addEventListener('click', async () => {
    if (isAdminUser !== true) {
      showErrorMessage('Only admins can save privacy settings');
      return;
    }
    
    const visPublicBtn = $('visPublic');
    const inviteToggleBtn = $('inviteToggle');
    const retentionSelectEl = $('messageRetentionSelect');
    
    if (!visPublicBtn || !inviteToggleBtn || !retentionSelectEl) {
      showErrorMessage('Privacy settings elements not found');
      return;
    }
    
    const visibility = visPublicBtn.classList.contains('active') ? 'public' : 'private';
    const invitesRestrictedToAdmins = inviteToggleBtn.classList.contains('active');
    
    // Parse retention days from select value (e.g., "7 Days" -> 7)
    let messageRetentionDays = null;
    if (retentionSelectEl.value !== 'Forever') {
      const match = retentionSelectEl.value.match(/\d+/);
      if (match) {
        messageRetentionDays = parseInt(match[0], 10);
      }
    }
    
    privacySaveBtn.disabled = true;
    privacySaveBtn.textContent = 'Saving…';
    
    try {
      const response = await fetch(`/api/workspace/${workspaceId}/update-privacy-settings/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': getCSRFToken()
        },
        credentials: 'same-origin',
        body: JSON.stringify({
          visibility,
          invites_restricted_to_admins: invitesRestrictedToAdmins,
          message_retention_days: messageRetentionDays
        })
      });
      
      const data = await response.json();
      
      if (response.ok && data.success) {
        showSuccessMessage('Privacy settings updated successfully!');
        currentPrivacySettings = data.settings;
        const msg = $('saveConfirm');
        if (msg) {
          msg.classList.add('visible');
          setTimeout(() => msg.classList.remove('visible'), 2500);
        }
      } else {
        showErrorMessage(data.error || 'Failed to update privacy settings');
      }
    } catch (err) {
      console.error('Error saving privacy settings:', err);
      showErrorMessage('Error saving privacy settings');
    } finally {
      privacySaveBtn.disabled = false;
      privacySaveBtn.textContent = 'Save Changes';
    }
  });
}

/* ── Danger zone ─────────────────────────── */

// Load non-admin members for transfer ownership
function loadTransferMembers() {
  const select = $('transferSelect');
  if (!select) return;
  
  // Clear existing options (keep the first placeholder)
  while (select.options.length > 1) {
    select.remove(1);
  }
  
  // Add non-admin members to select
  members.forEach(member => {
    if (member.role !== 'admin' && member.id !== currentUserId) {
      const option = document.createElement('option');
      option.value = member.username;
      option.textContent = member.display_name || member.username;
      select.appendChild(option);
    }
  });
}

// Transfer Ownership Button
if ($('transferBtn')) {
  $('transferBtn').addEventListener('click', async () => {
    const targetUsername = $('transferSelect').value;
    
    if (!targetUsername) {
      showErrorMessage('Please select a member');
      return;
    }
    
    if (!confirm('Are you sure? You will become a regular member.')) {
      return;
    }
    
    const btn = $('transferBtn');
    btn.disabled = true;
    btn.textContent = 'Transferring…';
    
    try {
      const response = await fetch(`/api/workspace/${workspaceId}/transfer-ownership/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          'X-CSRFToken': getCSRFToken()
        },
        credentials: 'same-origin',
        body: JSON.stringify({ target_username: targetUsername })
      });
      
      const data = await response.json();
      
      if (response.ok && data.success) {
        showSuccessMessage('Ownership transferred successfully!');
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      } else {
        showErrorMessage(data.error || 'Failed to transfer ownership');
        btn.disabled = false;
        btn.textContent = 'Transfer';
      }
    } catch (err) {
      console.error('Error transferring ownership:', err);
      showErrorMessage('Error transferring ownership');
      btn.disabled = false;
      btn.textContent = 'Transfer';
    }
  });
}

// Leave Workspace Button
if ($('leaveWorkspaceBtn')) {
  $('leaveWorkspaceBtn').addEventListener('click', async () => {
    if (!confirm('Are you sure you want to leave this workspace?')) {
      return;
    }
    
    const btn = $('leaveWorkspaceBtn');
    btn.disabled = true;
    btn.textContent = 'Leaving…';
    
    try {
      const response = await fetch(`/api/workspace/${workspaceId}/leave-workspace/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          'X-CSRFToken': getCSRFToken()
        },
        credentials: 'same-origin',
        body: JSON.stringify({})
      });
      
      const data = await response.json();
      
      if (response.ok && data.success) {
        showSuccessMessage('You have left the workspace!');
        setTimeout(() => {
          window.location.href = '/profile/';
        }, 1500);
      } else {
        showErrorMessage(data.error || 'Failed to leave workspace');
        btn.disabled = false;
        btn.textContent = 'Leave Workspace';
      }
    } catch (err) {
      console.error('Error leaving workspace:', err);
      showErrorMessage('Error leaving workspace');
      btn.disabled = false;
      btn.textContent = 'Leave Workspace';
    }
  });
}

// Delete Workspace
if ($('showDeleteBtn')) {
  $('showDeleteBtn').addEventListener('click', () => {
    $('deleteConfirmArea').style.display = 'block';
    $('showDeleteBtn').style.display = 'none';
    // Set the correct workspace name in the confirmation label
    const workspaceName = document.querySelector('[data-workspace-title]')?.getAttribute('data-workspace-title') || 
                         document.querySelector('.ws-selector-name')?.textContent || 'Workspace';
    $('workspaceNameConfirm').textContent = workspaceName;
  });
}

if ($('cancelDeleteBtn')) {
  $('cancelDeleteBtn').addEventListener('click', () => {
    $('deleteConfirmArea').style.display = 'none';
    $('showDeleteBtn').style.display = '';
    $('deleteConfirmInput').value = '';
    $('confirmDeleteBtn').disabled = true;
  });
}

if ($('deleteConfirmInput')) {
  $('deleteConfirmInput').addEventListener('input', () => {
    const workspaceName = document.querySelector('[data-workspace-title]')?.getAttribute('data-workspace-title') || 
                         document.querySelector('.ws-selector-name')?.textContent || 'Workspace';
    $('confirmDeleteBtn').disabled = $('deleteConfirmInput').value !== workspaceName;
  });
}

if ($('confirmDeleteBtn')) {
  $('confirmDeleteBtn').addEventListener('click', async () => {
    const workspaceName = document.querySelector('[data-workspace-title]')?.getAttribute('data-workspace-title') || 
                         document.querySelector('.ws-selector-name')?.textContent || 'Workspace';
    
    const btn = $('confirmDeleteBtn');
    btn.disabled = true;
    btn.textContent = 'Deleting…';
    
    try {
      const response = await fetch(`/api/workspace/${workspaceId}/delete-workspace/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          'X-CSRFToken': getCSRFToken()
        },
        credentials: 'same-origin',
        body: JSON.stringify({ title: workspaceName })
      });
      
      const data = await response.json();
      
      if (response.ok && data.success) {
        showSuccessMessage('Workspace deleted successfully!');
        setTimeout(() => {
          window.location.href = '/profile/';
        }, 1500);
      } else {
        showErrorMessage(data.error || 'Failed to delete workspace');
        btn.disabled = false;
        btn.textContent = 'Permanently Delete';
      }
    } catch (err) {
      console.error('Error deleting workspace:', err);
      showErrorMessage('Error deleting workspace');
      btn.disabled = false;
      btn.textContent = 'Permanently Delete';
    }
  });
}

/* ══════════════════════════════════════════════════
   4. PROFILE MODAL
══════════════════════════════════════════════════ */
const profileOverlay = $('profileOverlay');

$('openProfileBtn').addEventListener('click', () => {
  profileOverlay.classList.add('visible');
});
$('profileCloseBtn').addEventListener('click',  closeProfile);
$('profileCancelBtn').addEventListener('click', closeProfile);
profileOverlay.addEventListener('click', e => { if (e.target === profileOverlay) closeProfile(); });

function closeProfile() { profileOverlay.classList.remove('visible'); }

// Status selection
$$('.status-opt').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    $$('.status-opt').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const status = btn.getAttribute('data-status');
    const statusInput = document.getElementById('statusInput');
    if (statusInput) {
      statusInput.value = status;
    }
  });
});

// Profile save button - only if it exists
const profileSaveBtn = $('profileSaveBtn');
if (profileSaveBtn) {
  profileSaveBtn.addEventListener('click', async () => {
    const name = $('profileName').value.trim() || 'User';
    // update sidebar display
    document.querySelector('.user-name').textContent = name;
    document.querySelector('.user-av').textContent = initials(name);
    closeProfile();
  });
}
// --------------------------------------------AIBOT------------------------------------
const botReplies = [
//   'Great point! Let me check on that.',
//   'Thanks for the update, noted ✓',
//   'Can you share more details?',
//   'I'll look into it right after standup.',
//   'Sounds good, I'll sync with the team.',
//   'That's exactly what I was thinking!',
//   'Let's schedule a quick review for this.',
//   'Approved — looks great 🎉',
];

const botUsers = [
  { name: 'Sarah Chen' },
  { name: 'David Kim'  },
  { name: 'Mia Torres' },
];

function simulateReply(text) {
  // typing indicator
  const typing = document.createElement('div');
  typing.className = 'typing-indicator';
  const user = botUsers[Math.floor(Math.random() * botUsers.length)];
  typing.innerHTML = `
    <div class="msg-av" style="width:28px;height:28px;font-size:.65rem;background:${avatarColor(user.name)}">${initials(user.name)}</div>
    <span>${user.name} is typing</span>
    <div class="typing-dots"><span></span><span></span><span></span></div>
  `;
  messagesArea.appendChild(typing);
  messagesArea.scrollTop = messagesArea.scrollHeight;

  setTimeout(() => {
    typing.remove();
    renderMessage({
      sender: user.name,
      text: botReplies[Math.floor(Math.random() * botReplies.length)],
      time: new Date(),
    }, true);
    messagesArea.scrollTop = messagesArea.scrollHeight;
  }, 1500 + Math.random() * 1000);
}

/* ══════════════════════════════════════════════════
   5. AI ASSISTANT
══════════════════════════════════════════════════ */
const aiPanel    = $('aiPanel');
const aiFab      = $('aiFab');
const aiMessages = $('aiMessages');

aiFab.addEventListener('click', () => {
  aiPanel.classList.toggle('visible');
});
$('aiClose').addEventListener('click', () => aiPanel.classList.remove('visible'));

function addAiMsg(text, who = 'ai') {
  const msg = document.createElement('div');
  msg.className = `ai-msg ${who}`;
  msg.innerHTML = `<div class="ai-msg-bubble">${text}</div>`;
  aiMessages.appendChild(msg);
  aiMessages.scrollTop = aiMessages.scrollHeight;
}

function aiThinking() {
  const el = document.createElement('div');
  el.className = 'ai-msg ai';
  el.id = 'aiThinking';
  el.innerHTML = `<div class="ai-msg-bubble ai-thinking">
    <div class="typing-dots"><span></span><span></span><span></span></div>
  </div>`;
  aiMessages.appendChild(el);
  aiMessages.scrollTop = aiMessages.scrollHeight;
  return el;
}

const aiResponses = {
  task:    'I can see your team has 8 tasks in the board. 2 are high priority and still in To Do — want me to suggest who to assign them to?',
  meeting: 'I can summarize the last meeting for you: the team agreed to finalize the dark mode tokens by end of sprint and complete the accessibility review.',
  design:  'Based on your recent messages, the team is focused on the design system. I can generate a checklist for the handoff if you\'d like.',
  help:    'I can: summarize meetings, suggest task assignments, check team workload, explain design decisions, or draft messages. What do you need?',
  default: 'Great question! Based on the workspace activity, I\'d suggest prioritizing the "Redesign onboarding flow" task — it\'s high priority and still in To Do.',
};

function getAiReply(input) {
  const lower = input.toLowerCase();
  if (lower.includes('task') || lower.includes('board')) return aiResponses.task;
  if (lower.includes('meeting') || lower.includes('summar')) return aiResponses.meeting;
  if (lower.includes('design') || lower.includes('system')) return aiResponses.design;
  if (lower.includes('help') || lower.includes('what can')) return aiResponses.help;
  return aiResponses.default;
}

async function handleAiSend() {
  const input = $('aiInput');
  const text  = input.value.trim();
  if (!text) return;
  input.value = '';

  addAiMsg(text, 'user');
  const thinking = aiThinking();

  await delay(1200 + Math.random() * 600);
  thinking.remove();
  addAiMsg(getAiReply(text), 'ai');
}

$('aiSend').addEventListener('click', handleAiSend);
$('aiInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); handleAiSend(); }
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

