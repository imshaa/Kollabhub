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
let firstMessageDayKey = null;

let workspaceHistoryCursor = null;
let workspaceHasMore = true;
let workspaceHistoryLoading = false;

let dmHistoryCursor = null;
let dmHasMore = true;
let dmHistoryLoading = false;

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

function insertDateDivider(date, prepend = false) {
  const key = getDateKey(date);
  if (!chatContainer) return null;
  if (chatContainer.querySelector(`.msg-date-divider[data-day-key="${key}"]`)) {
    return null;
  }

  const divider = document.createElement('div');
  divider.className = 'msg-date-divider';
  divider.dataset.dayKey = key;
  divider.textContent = formatChatDay(date);

  if (prepend && chatContainer.firstChild) {
    chatContainer.insertBefore(divider, chatContainer.firstChild);
  } else {
    chatContainer.appendChild(divider);
  }
  return divider;
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

// Switch smoothly from DM/channel to workspace general channel
function switchToWorkspaceChat() {
  // Leave current DM if active
  if (currentDMUser) {
    leaveDM(currentDMUser);
  }
  // Clear DM state
  currentDMUser = null;
  lastDMUser = null;
  lastMessageDayKey = null;

  // Update UI
  const chatTitle = document.getElementById("chatChannelTitle");
  if (chatTitle) {
    chatTitle.innerText = 'general';
    chatTitle.classList.remove('dm-header');
  }
  const chatSubtitle = document.querySelector(".view-subtitle");
  if (chatSubtitle) {
    chatSubtitle.innerText = 'Topic: Team announcements and general chatter';
  }
  if (messageInput) {
    messageInput.placeholder = 'Message #general';
  }

  // Clear container and load workspace chat history
  if (chatContainer) {
    chatContainer.innerHTML = "";
    chatContainer.scrollTop = 0;
  }
  
  // Load workspace chat history
  loadWorkspaceHistory().then(() => {
    // After loading, focus input and scroll to bottom
    if (chatContainer) {
      chatContainer.scrollTop = chatContainer.scrollHeight;
    }
    if (messageInput) {
      messageInput.focus();
    }
    // Mark workspace chat as read
    if (window.NotificationManager) {
      window.NotificationManager.markRead('chat');
    }
  });
}

// element references (new ids first, then old as fallback)
const messageInput = document.getElementById("chatInput") || document.getElementById("messageInput");
const sendButton = document.getElementById("sendBtn") || document.getElementById("sendButton");

// Utility for $ and $$
function $(id) { return document.getElementById(id); }
function $$(sel) { return Array.from(document.querySelectorAll(sel)); }

function _getSenderInfo(msg) {
  return {
    sender: msg.sender_display_name || msg.sender_username || msg.sender || 'Unknown',
    avatar: msg.sender_avatar || '/static/Areeba.jpeg',
    time:   new Date(msg.created_at || msg.timestamp || Date.now()),
    side:   (msg.sender_id ? msg.sender_id === currentUserId : msg.sender === username) ? 'right' : 'left',
    messageId: msg.message_id || (msg.id ? String(msg.id) : null),
  };
}

function _markMessageSeen(msg) {
  if (!window._seenMessageIds) window._seenMessageIds = new Set();
  const key = msg.message_id || (msg.id ? String(msg.id) : null);
  if (!key) return true;
  if (window._seenMessageIds.has(key)) return false;
  window._seenMessageIds.add(key);
  return true;
}

function _renderChatMessage(msg, prepend = false) {
  if (!_markMessageSeen(msg)) return;
  const info = _getSenderInfo(msg);

  if (msg.voice_url) {
    appendVoiceNoteToWindow({
      sender: info.sender,
      avatar: info.avatar,
      voiceUrl: msg.voice_url,
      duration: msg.duration || 0,
      side: info.side,
      time: info.time,
      messageId: info.messageId,
      prepend,
    });
    return;
  }

  if (msg.files && msg.files.length) {
    msg.files.forEach(f => {
      appendFileMessageToWindow({
        sender:       info.sender,
        avatar:       info.avatar,
        fileUrl:      f.file_url,
        fileId:       f.file_id,
        fileName:     f.original_name,
        mimeType:     f.mime_type,
        fileSize:     f.file_size,
        fileCategory: f.file_category,
        side:         info.side,
        time:         info.time,
        messageId:    info.messageId,
        prepend,
      });
    });
    if (!msg.message || !msg.message.trim()) return;
  }

  if (msg.message && msg.message.trim()) {
    appendMessageToWindow({
      sender: info.sender,
      avatar: info.avatar,
      text: msg.message,
      side: info.side,
      time: info.time,
      prepend,
    });
  }
}

function _prependMessages(messages) {
  if (!chatContainer || !messages || !messages.length) return;
  const previousHeight = chatContainer.scrollHeight;
  const previousScrollTop = chatContainer.scrollTop;
  messages.forEach(msg => {
    _renderChatMessage(msg, true);
  });
  const newHeight = chatContainer.scrollHeight;
  chatContainer.scrollTop = Math.max(newHeight - previousHeight + previousScrollTop, 0);
}

async function _fetchHistory(path) {
  const resp = await fetch(path, { credentials: 'same-origin' });
  if (!resp.ok) throw new Error('History fetch failed');
  const payload = await resp.json();
  return payload;
}

// Load recent message history when opening the chat UI
async function loadWorkspaceHistory() {
  if (!chatContainer) return;
  chatContainer.innerHTML = "";
  lastMessageDayKey = null;
  firstMessageDayKey = null;
  workspaceHistoryCursor = null;
  workspaceHasMore = true;
  workspaceHistoryLoading = true;

  try {
    const payload = await _fetchHistory(`/api/workspace/${workspaceId}/messages/?limit=50`);
    const msgs = payload.messages || [];
    workspaceHistoryCursor = payload.next_cursor || null;
    workspaceHasMore = Boolean(payload.has_more);

    if (!window._seenMessageIds) window._seenMessageIds = new Set();
    msgs.forEach(m => _renderChatMessage(m));

    if (chatContainer) {
      chatContainer.scrollTop = chatContainer.scrollHeight;
    }
  } catch (err) {
    console.warn('Could not load chat history:', err);
  } finally {
    workspaceHistoryLoading = false;
  }
}
if (workspaceId) {
  loadWorkspaceHistory();
  if (window.NotificationManager) {
    window.NotificationManager.markRead('chat');
  }
}

if (chatContainer) {
  chatContainer.addEventListener('scroll', async () => {
    if (workspaceHistoryLoading || dmHistoryLoading) return;
    if (chatContainer.scrollTop > 120) return;

    if (currentDMUser) {
      if (!dmHasMore || !dmHistoryCursor) return;
      dmHistoryLoading = true;
      try {
        const payload = await _fetchHistory(
          `/api/workspace/${workspaceId}/dm/${currentDMUser}/?limit=50&before=${encodeURIComponent(dmHistoryCursor)}`
        );
        const msgs = payload.messages || [];
        if (!msgs.length) {
          dmHasMore = false;
          return;
        }
        dmHistoryCursor = payload.next_cursor || null;
        dmHasMore = Boolean(payload.has_more);
        _prependMessages(msgs);
      } catch (err) {
        console.warn('Could not load older DM messages:', err);
      } finally {
        dmHistoryLoading = false;
      }
    } else {
      if (!workspaceHasMore || !workspaceHistoryCursor) return;
      workspaceHistoryLoading = true;
      try {
        const payload = await _fetchHistory(
          `/api/workspace/${workspaceId}/messages/?limit=50&before=${encodeURIComponent(workspaceHistoryCursor)}`
        );
        const msgs = payload.messages || [];
        if (!msgs.length) {
          workspaceHasMore = false;
          return;
        }
        workspaceHistoryCursor = payload.next_cursor || null;
        workspaceHasMore = Boolean(payload.has_more);
        _prependMessages(msgs);
      } catch (err) {
        console.warn('Could not load older workspace messages:', err);
      } finally {
        workspaceHistoryLoading = false;
      }
    }
  });
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

      if (data.type === 'call_signal') { if (window.__handleCallSignal) window.__handleCallSignal(data); return; } 

      if (data.type === 'notification_event') {
        if (window.NotificationManager) {
          window.NotificationManager.handleNotificationEvent(data);
        }
        return;
      }

      if (data.notification && window.NotificationManager) {
        window.NotificationManager.handleNotificationEvent(data);
      }

      // ROUTING LOGIC: Show messages only for the current view
      // If we're in a DM conversation
      if (currentDMUser) {
        // Only show messages that are DMs for THIS specific conversation
        if (data.dm) {
          const otherId = data.sender_id === currentUserId ? data.receiver_id : data.sender_id;
          if (currentDMUser !== otherId) {
            return; // This DM is for a different user, ignore
          }
          // Show this DM message
        } else {
          return; // We're in DM mode, ignore workspace messages
        }
      } else {
        // We're in workspace chat view
        // Ignore DM messages
        if (data.dm) {
          return; // Ignore DMs when viewing workspace chat
        }
        // Show workspace messages
      }

      // Handle different message types for the CURRENT view
      if (data.type === "chat_message" || data.type === "message" || data.message) {
        const sender = data.sender_username || data.username || data.sender || "Unknown";
        const text = data.message || data.text || "";
        const avatar = data.sender_avatar || data.avatar || "/static/Areeba.jpeg";
        const time = data.timestamp ? new Date(data.timestamp) : new Date();
        const senderId = data.sender_id || null;
        if (msgId) window._seenMessageIds.add(msgId);
        // Use sender_id if available (more reliable), fallback to username comparison
        const isOwnMessage = senderId ? (senderId === currentUserId) : (sender === username);
        appendMessageToWindow({ sender, avatar, text, side: isOwnMessage ? "right" : "left", time });
      } else if (data.type === "voice_note") {
        // Voice notes need to be handled correctly
        const sender = data.sender_username || "Unknown";
        const avatar = data.sender_avatar || "/static/Areeba.jpeg";
        const time = data.created_at ? new Date(data.created_at) : new Date();
        const isOwnMessage = data.sender_id === currentUserId;
        if (msgId) window._seenMessageIds.add(msgId);
        appendVoiceNoteToWindow({
          sender: sender,
          avatar: avatar,
          voiceUrl: data.voice_url,
          duration: data.duration || 0,
          side: isOwnMessage ? 'right' : 'left',
          time: time,
          messageId: msgId
        });
      } else if (data.type === "file_message") {
        // File messages need to be handled correctly
        const sender = data.sender_username || "Unknown";
        const avatar = data.sender_avatar || "/static/Areeba.jpeg";
        const time = data.created_at ? new Date(data.created_at) : new Date();
        const isOwnMessage = data.sender_id === currentUserId;
        if (msgId) window._seenMessageIds.add(msgId);
        appendFileMessageToWindow({
          sender: sender,
          avatar: avatar,
          fileUrl: data.file_url,
          fileId: data.file_id,
          fileName: data.original_name,
          mimeType: data.mime_type,
          fileSize: data.file_size,
          fileCategory: data.file_category,
          side: isOwnMessage ? 'right' : 'left',
          time: time,
          messageId: msgId
        });
      } else if (data.type === "typing" || data.type === "typing_indicator") {
        // Pass both username and sender_id for reliable identification
        showTyping(data.username || data.sender || data.sender_username, data.sender_id);
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

function appendMessageToWindow({ sender, avatar, text, side = "left", time = new Date(), prepend = false }) {
  time = time instanceof Date ? time : new Date(time || Date.now());
  insertDateDivider(time, prepend);

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
  if (!chatContainer) return group;

  if (prepend && chatContainer.firstChild) {
    chatContainer.insertBefore(group, chatContainer.firstChild);
  } else {
    chatContainer.appendChild(group);
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }
  return group;
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
  if (!chatContainer) return;
  chatContainer.innerHTML = "";
  lastMessageDayKey = null;
  firstMessageDayKey = null;
  dmHistoryCursor = null;
  dmHasMore = true;
  dmHistoryLoading = true;

  try {
    const payload = await _fetchHistory(`/api/workspace/${workspaceId}/dm/${userId}/?limit=50`);
    const msgs = payload.messages || [];
    dmHistoryCursor = payload.next_cursor || null;
    dmHasMore = Boolean(payload.has_more);

    if (!window._seenMessageIds) window._seenMessageIds = new Set();
    msgs.forEach(m => {
      m.sender_display_name = m.sender;
      m.sender_username = m.sender;
      _renderChatMessage(m);
    });

    if (chatContainer) {
      chatContainer.scrollTop = chatContainer.scrollHeight;
    }
  } catch (err) {
    console.error("DM load failed", err);
  } finally {
    dmHistoryLoading = false;
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
      // Smoothly transition to workspace chat
      switchToWorkspaceChat();
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
  if (view === 'chat') {
    // When switching to chat view, ensure smooth DM-to-channel transition
    if (currentDMUser) {
      switchToWorkspaceChat();
    }
  } else {
    // When switching away from chat (e.g., to settings), leave DM
    if (currentDMUser) {
      leaveDM(currentDMUser);
      currentDMUser = null;
      lastDMUser = null;
    }
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
      // Smoothly transition to workspace chat (leaves DM if needed)
      switchToWorkspaceChat();
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
    isAdminUser = data.is_admin === true || data.is_admin === 'true';
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
 
    if (isAdminUser) {
      if (!isCurrentUser && !isAdmin) {
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
            <div class="member-row-actions">
              <button class="remove-btn" data-user-id="${m.id}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2l-2-14"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>Remove
              </button>
            </div>`;
        }
      } else if (!isCurrentUser && isAdmin) {
        actionBtn = `
          <div class="member-row-actions">
            <span class="member-role-pill">Admin</span>
          </div>`;
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



/* ══════════════════════════════════════════════════
   Voice Notes
══════════════════════════════════════════════════ */

// ── State ─────────────────────────────────────────────────────────────────────
let mediaRecorder     = null;
let recordedChunks    = [];
let recordingStream   = null;
let recordingTimer    = null;
let recordingSeconds  = 0;
let previewBlob       = null;      // the recorded Blob waiting to be sent
let previewObjectURL  = null;      // revocable URL for the preview audio element
let analyserNode      = null;
let animFrameId       = null;
let isRecording       = false;
 
// ── DOM: inject mic button into .chat-input-box ────────────────────────────────
(function injectMicButton() {
  const box = document.querySelector('.chat-input-box');
  if (!box) return;
 
  // Mic button  (sits between emoji btn and send btn)
  const micBtn = document.createElement('button');
  micBtn.className  = 'icon-btn vn-mic-btn';
  micBtn.id         = 'vnMicBtn';
  micBtn.title      = 'Voice note';
  micBtn.innerHTML  = `
    <svg id="vnMicIcon" width="18" height="18" viewBox="0 0 24 24"
         fill="none" stroke="currentColor" stroke-width="2">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
      <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
      <line x1="12" y1="19" x2="12" y2="23"/>
      <line x1="8"  y1="23" x2="16" y2="23"/>
    </svg>`;
 
  // Insert before send button
  const sendBtn = document.getElementById('sendBtn');
  if (sendBtn) box.insertBefore(micBtn, sendBtn);
  else box.appendChild(micBtn);
 
  micBtn.addEventListener('click', toggleRecording);
})();
 
// ── Recording bar (shown while recording / in preview mode) ───────────────────
const recordingBar = document.createElement('div');
recordingBar.id        = 'vnRecordingBar';
recordingBar.className = 'vn-recording-bar';
recordingBar.style.display = 'none';
recordingBar.innerHTML = `
  <div class="vn-bar-inner">
    <!-- Live waveform canvas -->
    <canvas id="vnWaveCanvas" class="vn-wave-canvas" width="120" height="36"></canvas>
 
    <!-- Timer -->
    <span class="vn-timer" id="vnTimer">0:00</span>
 
    <!-- Cancel -->
    <button class="vn-ctrl-btn vn-cancel" id="vnCancelBtn" title="Cancel">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2.5">
        <line x1="18" y1="6" x2="6" y2="18"/>
        <line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>
 
    <!-- Stop (while recording) -->
    <button class="vn-ctrl-btn vn-stop" id="vnStopBtn" title="Stop recording">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
        <rect x="3" y="3" width="18" height="18" rx="3"/>
      </svg>
    </button>
  </div>`;
 
// Insert above the input wrap
const chatInputWrap = document.querySelector('.chat-input-wrap');
if (chatInputWrap) chatInputWrap.insertBefore(recordingBar, chatInputWrap.firstChild);
 
// ── Preview bar (shown after recording, before send) ──────────────────────────
const previewBar = document.createElement('div');
previewBar.id        = 'vnPreviewBar';
previewBar.className = 'vn-preview-bar';
previewBar.style.display = 'none';
previewBar.innerHTML = `
  <div class="vn-bar-inner">
    <button class="vn-ctrl-btn vn-play-preview" id="vnPlayPreview" title="Play preview">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
    </button>
    <div class="vn-preview-waveform" id="vnPreviewWaveform"></div>
    <span class="vn-timer" id="vnPreviewDuration">0:00</span>
    <button class="vn-ctrl-btn vn-cancel" id="vnDiscardBtn" title="Discard">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2.5">
        <polyline points="3 6 5 6 21 6"/>
        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
      </svg>
    </button>
    <button class="vn-ctrl-btn vn-send-voice" id="vnSendVoiceBtn" title="Send voice note">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2.5">
        <path d="m22 2-7 20-4-9-9-4Z"/>
        <path d="M22 2 11 13"/>
      </svg>
    </button>
  </div>`;
 
if (chatInputWrap) chatInputWrap.insertBefore(previewBar, chatInputWrap.firstChild);
 
// Hidden audio element for preview playback
const previewAudio = document.createElement('audio');
previewAudio.id = 'vnPreviewAudio';
document.body.appendChild(previewAudio);
 
// ── Wire up bar buttons ────────────────────────────────────────────────────────
document.getElementById('vnCancelBtn')?.addEventListener('click', cancelRecording);
document.getElementById('vnStopBtn')?.addEventListener('click', stopRecording);
document.getElementById('vnDiscardBtn')?.addEventListener('click', discardPreview);
document.getElementById('vnSendVoiceBtn')?.addEventListener('click', uploadVoiceNote);
document.getElementById('vnPlayPreview')?.addEventListener('click', togglePreviewPlayback);
 
// ── Recording core ─────────────────────────────────────────────────────────────
async function toggleRecording() {
  if (isRecording) { stopRecording(); return; }
  await startRecording();
}
 
async function startRecording() {
  try {
    recordingStream  = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    alert('Microphone access denied. Please allow microphone permission.');
    return;
  }
 
  // Set up AnalyserNode for live waveform
  const audioCtx   = new (window.AudioContext || window.webkitAudioContext)();
  const source      = audioCtx.createMediaStreamSource(recordingStream);
  analyserNode      = audioCtx.createAnalyser();
  analyserNode.fftSize = 64;
  source.connect(analyserNode);
 
  // MediaRecorder — prefer webm/opus, fall back to whatever browser supports
  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : MediaRecorder.isTypeSupported('audio/webm')
      ? 'audio/webm'
      : '';
 
  recordedChunks = [];
  mediaRecorder  = new MediaRecorder(recordingStream, mimeType ? { mimeType } : {});
 
  mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recordedChunks.push(e.data); };
  mediaRecorder.onstop          = onMediaRecorderStop;
  mediaRecorder.start(100);   // collect in 100 ms chunks
 
  isRecording      = true;
  recordingSeconds = 0;
 
  // Show recording bar, hide normal input
  showRecordingUI();
  updateTimerDisplay();
 
  recordingTimer = setInterval(() => {
    recordingSeconds++;
    updateTimerDisplay();
    if (recordingSeconds >= 300) stopRecording();   // 5-min cap
  }, 1000);
 
  // Live waveform
  drawLiveWaveform();
 
  // Pulse mic icon
  document.getElementById('vnMicBtn')?.classList.add('recording');
}
 
function stopRecording() {
  if (!mediaRecorder || mediaRecorder.state === 'inactive') return;
  clearInterval(recordingTimer);
  cancelAnimationFrame(animFrameId);
  mediaRecorder.stop();
  recordingStream?.getTracks().forEach(t => t.stop());
  isRecording = false;
  document.getElementById('vnMicBtn')?.classList.remove('recording');
}
 
function cancelRecording() {
  stopRecording();
  recordedChunks = [];
  hideRecordingUI();
  hidePreviewUI();
  restoreInputBar();
}
 
function discardPreview() {
  if (previewObjectURL) { URL.revokeObjectURL(previewObjectURL); previewObjectURL = null; }
  previewBlob = null;
  previewAudio.pause();
  previewAudio.src = '';
  hidePreviewUI();
  restoreInputBar();
}
 
function onMediaRecorderStop() {
  if (!recordedChunks.length) { restoreInputBar(); return; }
  const mimeType = mediaRecorder?.mimeType || 'audio/webm';
  previewBlob = new Blob(recordedChunks, { type: mimeType });
  if (previewObjectURL) URL.revokeObjectURL(previewObjectURL);
  previewObjectURL = URL.createObjectURL(previewBlob);
  previewAudio.src = previewObjectURL;
 
  hideRecordingUI();
  showPreviewUI();
 
  // Set displayed duration
  previewAudio.onloadedmetadata = () => {
    const dur = Math.round(previewAudio.duration) || recordingSeconds;
    document.getElementById('vnPreviewDuration').textContent = fmtDuration(dur);
  };
 
  // Build static waveform bars for preview
  buildPreviewWaveform();
}
 
// ── Upload ─────────────────────────────────────────────────────────────────────
async function uploadVoiceNote() {
  if (!previewBlob) return;
 
  const sendBtn = document.getElementById('vnSendVoiceBtn');
  if (sendBtn) { sendBtn.disabled = true; sendBtn.style.opacity = '.4'; }
 
  const audioDuration = Number.isFinite(previewAudio.duration) ? Math.round(previewAudio.duration) : 0;
  const duration = audioDuration > 0 ? audioDuration : recordingSeconds || 0;
  const ext      = previewBlob.type.includes('ogg') ? 'ogg' : 'webm';
  const fileName = `voice_${Date.now()}.${ext}`;
 
  const fd = new FormData();
  fd.append('audio',        previewBlob, fileName);
  fd.append('duration',     duration);
  fd.append('message_uuid', crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
 
  const isDM      = !!currentDMUser;
  const endpoint  = isDM
    ? `/api/workspace/${workspaceId}/send-dm-voice-note/`
    : `/api/workspace/${workspaceId}/send-voice-note/`;
 
  if (isDM) fd.append('receiver_id', currentDMUser);
 
  // Add CSRF token
  fd.append('csrfmiddlewaretoken', getCSRFToken());
 
  try {
    const resp = await fetch(endpoint, {
      method:      'POST',
      body:         fd,
      credentials: 'same-origin',
    });
 
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
 
    if (!data.success) throw new Error(data.error || 'Upload failed');
 
    // Broadcast over WebSocket so other tabs / users see it immediately
    if (chatSocket && chatSocket.readyState === WebSocket.OPEN) {
      const wsPayload = {
        type:           'voice_note',
        voice_url:       data.voice_url,
        duration:        data.duration,
        message_id:      data.message_id,
        sender_id:       data.sender_id,
        sender_username: data.sender_display_name || data.sender_username,
        sender_avatar:   data.sender_avatar,
        created_at:      data.created_at,
      };
      if (isDM) {
        wsPayload.dm          = true;
        wsPayload.receiver_id = currentDMUser;
      }
      chatSocket.send(JSON.stringify(wsPayload));
    }
 
    // Render locally for the sender
    appendVoiceNoteToWindow({
      sender:    data.sender_display_name || data.sender_username,
      avatar:    data.sender_avatar,
      voiceUrl:  data.voice_url,
      duration:  data.duration,
      side:      'right',
      time:      new Date(data.created_at),
      messageId: data.message_id,
    });
 
    discardPreview();
 
  } catch (err) {
    console.error('Voice note upload failed:', err);
    alert('Failed to send voice note. Please try again.');
    if (sendBtn) { sendBtn.disabled = false; sendBtn.style.opacity = '1'; }
  }
}
 
// ── WebSocket: receive voice notes from others ─────────────────────────────────
// Monkey-patch the existing onmessage to intercept voice_note type
(function patchWebSocketForVoiceNotes() {
  const pollInterval = setInterval(() => {
    if (!chatSocket) return;
    clearInterval(pollInterval);
 
    const _orig = chatSocket.onmessage;
    chatSocket.onmessage = function(e) {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'voice_note') {
          // Dedup
          if (!window._seenMessageIds) window._seenMessageIds = new Set();
          if (data.message_id && window._seenMessageIds.has(data.message_id)) return;
          if (data.message_id) window._seenMessageIds.add(data.message_id);
 
          // If DM voice note and we're not in that DM, skip
          if (data.dm) {
            const otherId = data.sender_id === currentUserId ? data.receiver_id : data.sender_id;
            if (currentDMUser !== otherId) return;
          }
 
          const isOwn = data.sender_id
            ? data.sender_id === currentUserId
            : data.sender_username === username;
 
          if (!isOwn) {
            appendVoiceNoteToWindow({
              sender:    data.sender_username,
              avatar:    data.sender_avatar,
              voiceUrl:  data.voice_url,
              duration:  data.duration || 0,
              side:      'left',
              time:      data.created_at ? new Date(data.created_at) : new Date(),
              messageId: data.message_id,
            });
          }
          return;   // handled; don't pass to original handler
        }
      } catch {}
      // pass everything else to the original handler
      if (_orig) _orig.call(this, e);
    };
  }, 200);
})();
 
// ── Render voice note player ───────────────────────────────────────────────────
let _vnPlayerCount = 0;
 
function appendVoiceNoteToWindow({ sender, avatar, voiceUrl, duration, side, time, messageId, prepend = false }) {
  if (!chatContainer || !voiceUrl) return;
  time = time instanceof Date ? time : new Date(time || Date.now());
  insertDateDivider(time, prepend);
 
  const pid = 'vnp_' + (++_vnPlayerCount);
 
  const group = document.createElement('div');
  group.className = 'msg-group' + (side === 'right' ? ' self' : '');
  if (messageId) group.dataset.messageId = messageId;
 
  const av = document.createElement('div');
  av.className = 'msg-av';
  av.textContent = initials(sender);
  av.style.background = avatarColor(sender);
 
  const totalSec  = Math.max(duration || 0, 1);
  const waveformSVG = generateWaveformSVG(messageId || sender, 48);
 
  const body = document.createElement('div');
  body.className = 'msg-body';
  body.innerHTML = `
    <div class="msg-meta">
      <span class="msg-name">${sender}</span>
      <span class="msg-time">${fmt(time)}</span>
    </div>
    <div class="msg-bubble vn-bubble" id="${pid}">
      <audio class="vn-audio" src="${voiceUrl}" preload="metadata"></audio>
 
      <button class="vn-play-btn" id="${pid}_play" title="Play">
        <svg class="vn-icon-play" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <polygon points="5,3 19,12 5,21"/>
        </svg>
        <svg class="vn-icon-pause" width="14" height="14" viewBox="0 0 24 24"
             fill="currentColor" style="display:none">
          <rect x="6"  y="4" width="4" height="16"/>
          <rect x="14" y="4" width="4" height="16"/>
        </svg>
      </button>
 
      <div class="vn-middle">
        <div class="vn-waveform-wrap">
          ${waveformSVG}
          <input type="range" class="vn-scrubber" id="${pid}_scrub"
                 min="0" max="100" value="0" step="0.5">
        </div>
        <div class="vn-timings">
          <span class="vn-elapsed" id="${pid}_elapsed">0:00</span>
          <span class="vn-total"   id="${pid}_total">${fmtDuration(totalSec)}</span>
        </div>
      </div>
 
      <button class="vn-speed-btn" id="${pid}_speed" title="Playback speed">1×</button>
    </div>`;
 
  group.appendChild(av);
  group.appendChild(body);
  if (prepend && chatContainer.firstChild) {
    chatContainer.insertBefore(group, chatContainer.firstChild);
  } else {
    chatContainer.appendChild(group);
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }
 
  wireVoiceNotePlayer(pid, totalSec);
  return group;
}
 
function wireVoiceNotePlayer(pid, totalSecHint) {
  const bubble   = document.getElementById(pid);
  if (!bubble) return;
 
  const audio    = bubble.querySelector('.vn-audio');
  const playBtn  = document.getElementById(`${pid}_play`);
  const iconPlay = playBtn?.querySelector('.vn-icon-play');
  const iconPause= playBtn?.querySelector('.vn-icon-pause');
  const scrubber = document.getElementById(`${pid}_scrub`);
  const elapsed  = document.getElementById(`${pid}_elapsed`);
  const totalEl  = document.getElementById(`${pid}_total`);
  const speedBtn = document.getElementById(`${pid}_speed`);
  const speeds   = [1, 1.5, 2];
  let   speedIdx = 0;
 
  // Update total duration once audio metadata loads
  audio.addEventListener('loadedmetadata', () => {
    const dur = Math.round(audio.duration);
    if (totalEl && dur > 0) totalEl.textContent = fmtDuration(dur);
  });
 
  // Play / Pause
  playBtn?.addEventListener('click', () => {
    if (audio.paused) {
      // Pause all other voice notes on the page
      document.querySelectorAll('.vn-audio').forEach(a => {
        if (a !== audio && !a.paused) {
          a.pause();
          const otherBubble = a.closest('.vn-bubble');
          if (otherBubble) {
            otherBubble.querySelector('.vn-icon-play') ?.removeAttribute('style');
            otherBubble.querySelector('.vn-icon-pause')?.setAttribute('style', 'display:none');
          }
        }
      });
      audio.play();
      if (iconPlay)  iconPlay.style.display  = 'none';
      if (iconPause) iconPause.style.display = '';
    } else {
      audio.pause();
      if (iconPlay)  iconPlay.style.display  = '';
      if (iconPause) iconPause.style.display = 'none';
    }
  });
 
  // Ended
  audio.addEventListener('ended', () => {
    if (iconPlay)  iconPlay.style.display  = '';
    if (iconPause) iconPause.style.display = 'none';
    if (scrubber) scrubber.value = 0;
    if (elapsed)  elapsed.textContent = '0:00';
  });
 
  // Time update → scrubber + elapsed
  audio.addEventListener('timeupdate', () => {
    if (!audio.duration) return;
    const pct = (audio.currentTime / audio.duration) * 100;
    if (scrubber) scrubber.value = pct;
    if (elapsed)  elapsed.textContent = fmtDuration(Math.floor(audio.currentTime));
 
    // Animate waveform fill
    const svg = bubble.querySelector('.vn-waveform-svg');
    if (svg) {
      svg.style.setProperty('--vn-progress', `${pct}%`);
    }
  });
 
  // Scrubber seek
  scrubber?.addEventListener('input', () => {
    if (!audio.duration) return;
    audio.currentTime = (scrubber.value / 100) * audio.duration;
  });
 
  // Speed toggle
  speedBtn?.addEventListener('click', () => {
    speedIdx = (speedIdx + 1) % speeds.length;
    audio.playbackRate = speeds[speedIdx];
    speedBtn.textContent = speeds[speedIdx] + '×';
  });
}
 
// ── Waveform helpers ───────────────────────────────────────────────────────────
function generateWaveformSVG(seed, bars = 48) {
  // Deterministic pseudo-random from seed string
  let hash = 0;
  const s  = String(seed);
  for (let i = 0; i < s.length; i++) hash = s.charCodeAt(i) + ((hash << 5) - hash);
  const rng = () => { hash = (hash * 1664525 + 1013904223) & 0xffffffff; return (hash >>> 0) / 0xffffffff; };
 
  const heights = Array.from({ length: bars }, () => 20 + rng() * 60);   // 20–80 %
  const w = 160, h = 36, bw = 2, gap = 1;
  const step = (w) / bars;
 
  const rects = heights.map((ht, i) => {
    const barH  = (ht / 100) * h;
    const x     = i * step + gap;
    const y     = (h - barH) / 2;
    return `<rect class="vn-bar" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw}" height="${barH.toFixed(1)}" rx="1"/>`;
  }).join('');
 
  return `<svg class="vn-waveform-svg" viewBox="0 0 ${w} ${h}"
               xmlns="http://www.w3.org/2000/svg"
               preserveAspectRatio="none"
               style="--vn-progress:0%">${rects}</svg>`;
}
 
function buildPreviewWaveform() {
  const wrap = document.getElementById('vnPreviewWaveform');
  if (!wrap) return;
  wrap.innerHTML = generateWaveformSVG('preview_' + Date.now(), 36);
}
 
// ── Live waveform (canvas) ─────────────────────────────────────────────────────
function drawLiveWaveform() {
  const canvas = document.getElementById('vnWaveCanvas');
  if (!canvas || !analyserNode) return;
  const ctx  = canvas.getContext('2d');
  const buf  = new Uint8Array(analyserNode.frequencyBinCount);
  const W = canvas.width, H = canvas.height;
 
  const accentColor = getComputedStyle(document.documentElement)
    .getPropertyValue('--accent').trim() || '#3b82f6';
 
  function draw() {
    animFrameId = requestAnimationFrame(draw);
    analyserNode.getByteFrequencyData(buf);
    ctx.clearRect(0, 0, W, H);
    const barW = W / buf.length;
    buf.forEach((val, i) => {
      const barH = (val / 255) * H;
      ctx.fillStyle = accentColor;
      ctx.beginPath();
      ctx.roundRect?.(i * barW, (H - barH) / 2, barW - 1, barH, 1);
      ctx.fill();
    });
  }
  draw();
}
 
// ── UI helpers ─────────────────────────────────────────────────────────────────
function showRecordingUI() {
  recordingBar.style.display = '';
  previewBar.style.display   = 'none';
  const inputBox = document.querySelector('.chat-input-box');
  if (inputBox) inputBox.style.opacity = '.35';
}
 
function hideRecordingUI() {
  recordingBar.style.display = 'none';
}
 
function showPreviewUI() {
  previewBar.style.display  = '';
  const inputBox = document.querySelector('.chat-input-box');
  if (inputBox) inputBox.style.opacity = '.35';
}
 
function hidePreviewUI() {
  previewBar.style.display = 'none';
}
 
function restoreInputBar() {
  const inputBox = document.querySelector('.chat-input-box');
  if (inputBox) inputBox.style.opacity = '1';
}
 
function updateTimerDisplay() {
  const el = document.getElementById('vnTimer');
  if (el) el.textContent = fmtDuration(recordingSeconds);
}
 
function fmtDuration(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
 
// Toggle preview audio play/pause
function togglePreviewPlayback() {
  const btn = document.getElementById('vnPlayPreview');
  if (previewAudio.paused) {
    previewAudio.play();
    if (btn) btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
  } else {
    previewAudio.pause();
    if (btn) btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <polygon points="5,3 19,12 5,21"/></svg>`;
  }
  previewAudio.onended = () => {
    if (btn) btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <polygon points="5,3 19,12 5,21"/></svg>`;
  };
}

/* ══════════════════════════════════════════════════════════════════════════════
   CHAT FILE ATTACHMENTS
   Handles: image (≤2 MB), video (≤25 MB), document (≤25 MB)
   Storage: Supabase via Django upload endpoints
   Rendering: inline image preview, video player, document download card
   ══════════════════════════════════════════════════════════════════════════════ */
 
const _FILE_IMAGE_MAX  = 2  * 1024 * 1024;   // 2 MB
const _FILE_OTHER_MAX  = 25 * 1024 * 1024;   // 25 MB
 
const _ALLOWED_MIME = new Set([
  // images
  'image/jpeg','image/png','image/gif','image/webp','image/svg+xml',
  // video
  'video/mp4','video/quicktime','video/webm','video/x-msvideo',
  // documents
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain','text/csv',
  'application/zip','application/x-zip-compressed',
]);
 
// ── Wire the existing attach button ───────────────────────────────────────────
(function wireAttachButton() {
  const attachBtn = document.querySelector('.chat-input-box .icon-btn[title="Attach"]');
  if (!attachBtn) return;
 
  // Create a hidden file input
  const fileInput  = document.createElement('input');
  fileInput.type   = 'file';
  fileInput.id     = 'chatFileInput';
  fileInput.accept = [
    'image/jpeg','image/png','image/gif','image/webp',
    'video/mp4','video/quicktime','video/webm',
    'application/pdf',
    '.doc','.docx','.xls','.xlsx','.ppt','.pptx',
    '.txt','.csv','.zip',
  ].join(',');
  fileInput.style.display = 'none';
  document.body.appendChild(fileInput);
 
  // Clicking the paperclip opens the file dialog
  attachBtn.addEventListener('click', (e) => {
    e.preventDefault();
    fileInput.value = '';       // reset so the same file can be re-selected
    fileInput.click();
  });
 
  // File selected → validate → show preview bar
  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) return;
    handleFileSelected(file);
  });
})();
 
 
// ── File selection: validate + show preview bar ───────────────────────────────
let _pendingFile = null;   // File object waiting to be sent
 
function handleFileSelected(file) {
  const mime     = file.type || 'application/octet-stream';
  const isImage  = mime.startsWith('image/');
  const maxBytes = isImage ? _FILE_IMAGE_MAX : _FILE_OTHER_MAX;
 
  // Validate MIME
  if (!_ALLOWED_MIME.has(mime)) {
    showFileError(`File type "${mime.split('/')[1]}" is not supported.`);
    return;
  }
  // Validate size
  if (file.size > maxBytes) {
    const limit = isImage ? '2 MB' : '25 MB';
    showFileError(`${isImage ? 'Images' : 'Files'} must be under ${limit}. This file is ${formatFileSize(file.size)}.`);
    return;
  }
 
  _pendingFile = file;
  showFilePreviewBar(file);
}
 
// ── File preview bar (above chat input) ───────────────────────────────────────
const filePreviewBar = document.createElement('div');
filePreviewBar.id        = 'cfPreviewBar';
filePreviewBar.className = 'cf-preview-bar';
filePreviewBar.style.display = 'none';
 
filePreviewBar.innerHTML = `
  <div class="cf-preview-inner">
    <div class="cf-preview-thumb" id="cfPreviewThumb"></div>
    <div class="cf-preview-info">
      <span class="cf-preview-name" id="cfPreviewName"></span>
      <span class="cf-preview-size" id="cfPreviewSize"></span>
    </div>
    <div class="cf-preview-actions">
      <button class="cf-preview-discard" id="cfDiscardBtn" title="Remove">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2.5">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6"  y1="6" x2="18" y2="18"/>
        </svg>
      </button>
      <button class="cf-preview-send" id="cfSendBtn" title="Send file">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2.5">
          <path d="m22 2-7 20-4-9-9-4Z"/>
          <path d="M22 2 11 13"/>
        </svg>
        Send
      </button>
    </div>
  </div>`;
 
const cfWrap = document.querySelector('.chat-input-wrap');
if (cfWrap) cfWrap.insertBefore(filePreviewBar, cfWrap.firstChild);
 
document.getElementById('cfDiscardBtn')?.addEventListener('click', discardFilePreview);
document.getElementById('cfSendBtn')?.addEventListener('click',    sendPendingFile);
 
 
function showFilePreviewBar(file) {
  const thumbEl = document.getElementById('cfPreviewThumb');
  const nameEl  = document.getElementById('cfPreviewName');
  const sizeEl  = document.getElementById('cfPreviewSize');
  if (!thumbEl || !nameEl || !sizeEl) return;
 
  nameEl.textContent = truncateFilename(file.name, 32);
  sizeEl.textContent = formatFileSize(file.size);
 
  // Thumbnail: image → ObjectURL preview; video → film icon; doc → file icon
  thumbEl.innerHTML = '';
  if (file.type.startsWith('image/')) {
    const img = document.createElement('img');
    img.src   = URL.createObjectURL(file);
    img.style.cssText = 'width:48px;height:48px;object-fit:cover;border-radius:6px;';
    img.onload = () => URL.revokeObjectURL(img.src);
    thumbEl.appendChild(img);
  } else if (file.type.startsWith('video/')) {
    thumbEl.innerHTML = fileIconSVG('video');
  } else {
    thumbEl.innerHTML = fileIconSVG('document', file.name);
  }
 
  filePreviewBar.style.display = '';
  // Dim the input row slightly
  const inputBox = document.querySelector('.chat-input-box');
  if (inputBox) inputBox.style.opacity = '.5';
}
 
function discardFilePreview() {
  _pendingFile = null;
  filePreviewBar.style.display = 'none';
  const inputBox = document.querySelector('.chat-input-box');
  if (inputBox) inputBox.style.opacity = '1';
}
 
 
// ── Upload pending file ────────────────────────────────────────────────────────
async function sendPendingFile() {
  if (!_pendingFile) return;
  const file = _pendingFile;
 
  const sendBtn = document.getElementById('cfSendBtn');
  if (sendBtn) {
    sendBtn.disabled  = true;
    sendBtn.innerHTML = '<span class="cf-spinner"></span> Sending…';
  }
 
  const isDM     = !!currentDMUser;
  const endpoint = isDM
    ? `/api/workspace/${workspaceId}/upload-dm-file/`
    : `/api/workspace/${workspaceId}/upload-file/`;
 
  const fd = new FormData();
  fd.append('file',         file);
  fd.append('message_uuid', crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
  if (isDM) fd.append('receiver_id', currentDMUser);
  fd.append('csrfmiddlewaretoken', getCSRFToken());
 
  try {
    const resp = await fetch(endpoint, {
      method:      'POST',
      body:         fd,
      credentials: 'same-origin',
    });
 
    const data = await resp.json();
 
    if (!resp.ok || !data.success) {
      showFileError(data.error || 'Upload failed. Please try again.');
      if (sendBtn) {
        sendBtn.disabled  = false;
        sendBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="2.5"><path d="m22 2-7 20-4-9-9-4Z"/>
          <path d="M22 2 11 13"/></svg> Send`;
      }
      return;
    }
 
    // Broadcast via WebSocket so other users see it instantly
    if (chatSocket && chatSocket.readyState === WebSocket.OPEN) {
      const wsPayload = {
        type:           'file_message',
        file_id:         data.file_id,
        file_url:        data.file_url,
        original_name:   data.original_name,
        mime_type:       data.mime_type,
        file_size:       data.file_size,
        file_category:   data.file_category,
        message_id:      data.message_id,
        sender_id:       data.sender_id,
        sender_username: data.sender_display_name || data.sender_username,
        sender_avatar:   data.sender_avatar,
        created_at:      data.created_at,
      };
      if (isDM) {
        wsPayload.dm          = true;
        wsPayload.receiver_id = currentDMUser;
      }
      chatSocket.send(JSON.stringify(wsPayload));
    }
 
    // Render for sender
    appendFileMessageToWindow({
      sender:       data.sender_display_name || data.sender_username,
      avatar:       data.sender_avatar,
      fileUrl:      data.file_url,
      fileId:       data.file_id,
      fileName:     data.original_name,
      mimeType:     data.mime_type,
      fileSize:     data.file_size,
      fileCategory: data.file_category,
      side:         'right',
      time:         new Date(data.created_at),
      messageId:    data.message_id,
    });
 
    discardFilePreview();
 
  } catch (err) {
    console.error('File upload error:', err);
    showFileError('Upload failed. Check your connection and try again.');
    if (sendBtn) {
      sendBtn.disabled  = false;
      sendBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" stroke-width="2.5"><path d="m22 2-7 20-4-9-9-4Z"/>
        <path d="M22 2 11 13"/></svg> Send`;
    }
  }
}
 
 
// ── WebSocket: intercept file_message events ───────────────────────────────────
(function patchWebSocketForFiles() {
  const poll = setInterval(() => {
    if (!chatSocket) return;
    clearInterval(poll);
 
    const _prev = chatSocket.onmessage;
    chatSocket.onmessage = function(e) {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'file_message') {
          // Dedup
          if (!window._seenMessageIds) window._seenMessageIds = new Set();
          if (data.message_id && window._seenMessageIds.has(data.message_id)) return;
          if (data.message_id) window._seenMessageIds.add(data.message_id);
 
          // DM filtering
          if (data.dm) {
            const otherId = data.sender_id === currentUserId ? data.receiver_id : data.sender_id;
            if (currentDMUser !== otherId) return;
          }
 
          const isOwn = data.sender_id
            ? data.sender_id === currentUserId
            : data.sender_username === username;
 
          if (!isOwn) {
            appendFileMessageToWindow({
              sender:       data.sender_username,
              avatar:       data.sender_avatar,
              fileUrl:      data.file_url,
              fileId:       data.file_id,
              fileName:     data.original_name,
              mimeType:     data.mime_type,
              fileSize:     data.file_size,
              fileCategory: data.file_category,
              side:         'left',
              time:         data.created_at ? new Date(data.created_at) : new Date(),
              messageId:    data.message_id,
            });
          }
          return;
        }
      } catch {}
      if (_prev) _prev.call(this, e);
    };
  }, 300);
})();
 
 
// ── Render a file message bubble ───────────────────────────────────────────────
function appendFileMessageToWindow({ sender, avatar, fileUrl, fileId, fileName,
    mimeType, fileSize, fileCategory, side, time, messageId, prepend = false }) {
  if (!chatContainer) return;
  time = time instanceof Date ? time : new Date(time || Date.now());
  insertDateDivider(time, prepend);
 
  const group = document.createElement('div');
  group.className = 'msg-group' + (side === 'right' ? ' self' : '');
  if (messageId) group.dataset.messageId = messageId;
 
  const av = document.createElement('div');
  av.className   = 'msg-av';
  av.textContent = initials(sender);
  av.style.background = avatarColor(sender);
 
  const body = document.createElement('div');
  body.className = 'msg-body';
 
  let bubbleHTML = '';
 
  if (fileCategory === 'image') {
    // ── Image bubble ────────────────────────────────────────────────────────
    bubbleHTML = `
      <div class="msg-bubble cf-image-bubble">
        <a href="${fileUrl}" target="_blank" rel="noopener" class="cf-image-link">
          <img class="cf-inline-image" src="${fileUrl}"
               alt="${escapeHtml(fileName)}"
               loading="lazy"
               onerror="this.closest('.cf-image-bubble').innerHTML=cfFallbackCard('${fileId}','${escapeHtml(fileName)}','${formatFileSize(fileSize)}')">
        </a>
        <div class="cf-image-meta">
          <span class="cf-filename">${escapeHtml(truncateFilename(fileName, 28))}</span>
          <span class="cf-filesize">${formatFileSize(fileSize)}</span>
          <a href="${fileUrl}" download="${escapeHtml(fileName)}"
             class="cf-dl-btn" title="Download">
            ${dlIcon()}
          </a>
        </div>
      </div>`;
 
  } else if (fileCategory === 'video') {
    // ── Video bubble ────────────────────────────────────────────────────────
    bubbleHTML = `
      <div class="msg-bubble cf-video-bubble">
        <video class="cf-inline-video" controls preload="metadata">
          <source src="${fileUrl}" type="${mimeType}">
          Your browser does not support video playback.
        </video>
        <div class="cf-image-meta">
          <span class="cf-filename">${escapeHtml(truncateFilename(fileName, 28))}</span>
          <span class="cf-filesize">${formatFileSize(fileSize)}</span>
          <a href="${fileUrl}" download="${escapeHtml(fileName)}"
             class="cf-dl-btn" title="Download">
            ${dlIcon()}
          </a>
        </div>
      </div>`;
 
  } else {
    // ── Document / generic file card ────────────────────────────────────────
    const ext = fileName.split('.').pop().toLowerCase();
    bubbleHTML = `
      <div class="msg-bubble cf-doc-bubble">
        <div class="cf-doc-icon">${fileIconSVG('document', fileName)}</div>
        <div class="cf-doc-info">
          <span class="cf-doc-name">${escapeHtml(truncateFilename(fileName, 30))}</span>
          <span class="cf-doc-meta">${ext.toUpperCase()} · ${formatFileSize(fileSize)}</span>
        </div>
        <a href="${fileUrl}" download="${escapeHtml(fileName)}"
           target="_blank" rel="noopener"
           class="cf-doc-dl" title="Download ${escapeHtml(fileName)}">
          ${dlIcon()}
        </a>
      </div>`;
  }
 
  body.innerHTML = `
    <div class="msg-meta">
      <span class="msg-name">${sender}</span>
      <span class="msg-time">${fmt(time)}</span>
    </div>
    ${bubbleHTML}`;
 
  group.appendChild(av);
  group.appendChild(body);
  if (prepend && chatContainer.firstChild) {
    chatContainer.insertBefore(group, chatContainer.firstChild);
  } else {
    chatContainer.appendChild(group);
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }
  return group;
}
 
// Fallback card if image fails to load (signed URL expired)
function cfFallbackCard(fileId, fileName, size) {
  return `<div class="cf-doc-bubble cf-expired">
    <div class="cf-doc-icon">${fileIconSVG('document')}</div>
    <div class="cf-doc-info">
      <span class="cf-doc-name">${escapeHtml(fileName)}</span>
      <span class="cf-doc-meta">${size} · link expired</span>
    </div>
    <button class="cf-doc-dl cf-refresh-btn" onclick="refreshFileUrl(${fileId}, this)" title="Refresh link">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2">
        <polyline points="23 4 23 10 17 10"/>
        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
      </svg>
    </button>
  </div>`;
}
 
// Refresh a signed URL that has expired
async function refreshFileUrl(fileId, btn) {
  try {
    btn.style.opacity = '.4';
    const resp = await fetch(`/api/chat-file/${fileId}/refresh-url/`, { credentials: 'same-origin' });
    const data = await resp.json();
    if (data.url) {
      // Find the parent bubble and update hrefs / src
      const bubble = btn.closest('.msg-bubble');
      if (bubble) {
        bubble.querySelectorAll('[href],[src]').forEach(el => {
          if (el.href && el.href.includes('supabase')) el.href = data.url;
          if (el.src  && el.src.includes('supabase'))  el.src  = data.url;
        });
      }
    }
  } catch {}
  btn.style.opacity = '1';
}
 
 
 
// ── Utilities ─────────────────────────────────────────────────────────────────
function formatFileSize(bytes) {
  if (!bytes) return '0 B';
  const units = ['B','KB','MB','GB'];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
  return `${bytes.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
 
function truncateFilename(name, max) {
  if (!name || name.length <= max) return name || '';
  const ext   = name.lastIndexOf('.');
  const extPart = ext > 0 ? name.slice(ext) : '';
  return name.slice(0, max - extPart.length - 1) + '…' + extPart;
}
 
function escapeHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}
 
function fileIconSVG(type, filename) {
  const ext = filename ? filename.split('.').pop().toLowerCase() : '';
  // Colour by extension group
  const color =
    ['pdf'].includes(ext)                           ? '#ef4444' :
    ['doc','docx'].includes(ext)                    ? '#3b82f6' :
    ['xls','xlsx','csv'].includes(ext)              ? '#22c55e' :
    ['ppt','pptx'].includes(ext)                    ? '#f97316' :
    ['zip','rar','7z'].includes(ext)                ? '#a855f7' :
    type === 'video'                                ? '#6366f1' :
                                                      '#64748b';
  if (type === 'video') {
    return `<svg width="32" height="32" viewBox="0 0 24 24" fill="none"
      stroke="${color}" stroke-width="1.5">
      <path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/>
      <rect x="2" y="6" width="14" height="12" rx="2"/>
    </svg>`;
  }
  return `<svg width="32" height="32" viewBox="0 0 24 24" fill="none"
    stroke="${color}" stroke-width="1.5">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
    <polyline points="14 2 14 8 20 8"/>
    <text x="6" y="19" font-size="5" fill="${color}"
      font-family="monospace" font-weight="700">${ext.toUpperCase().slice(0,4)}</text>
  </svg>`;
}
 
function dlIcon() {
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="2.5">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="7 10 12 15 17 10"/>
    <line x1="12" y1="15" x2="12" y2="3"/>
  </svg>`;
}
 
// ── Error toast ────────────────────────────────────────────────────────────────
function showFileError(msg) {
  const toast = document.createElement('div');
  toast.className = 'cf-error-toast';
  toast.textContent = msg;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('cf-toast-visible'));
  setTimeout(() => {
    toast.classList.remove('cf-toast-visible');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

window.chatSocket = chatSocket;