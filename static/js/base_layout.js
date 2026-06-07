/* ── Read layout data from JSON blob ── */
(function () {
  var _d = {};
  try { _d = JSON.parse(document.getElementById('__layoutData__').textContent); } catch(e) {}
  window.currentWorkspaceId          = _d.workspaceId  || null;
  window.currentUserId               = _d.userId        || null;
  window.INITIAL_NOTIFICATION_COUNTS = _d.notificationCounts || null;
})();

/* ── AI Panel ──────────────────────────────────────────────────────────────── */
/*
  Workspace-aware AI panel script. Replaces older ai panel logic.
  Uses workspace-scoped endpoints: /api/workspace/<id>/ai-chat/, ai-history, ai-clear-history
*/
(function () {
  'use strict';

  /* ── DOM refs ────────────────────────────────────────────────────────────── */
  const fab       = document.getElementById('aiFab');
  const panel     = document.getElementById('aiPanel');
  const closeBtn  = document.getElementById('aiClose');
  const input     = document.getElementById('aiInput');
  const sendBtn   = document.getElementById('aiSend');
  const msgArea   = document.getElementById('aiMessages');

  if (!msgArea) return; // AI panel not in this page

  /* ── Read workspaceId from layout data, DOM, or URL ─────────────────── */
  function _getWorkspaceId() {
    if (typeof window.currentWorkspaceId !== 'undefined' && window.currentWorkspaceId !== null) {
      return window.currentWorkspaceId;
    }
    const fromDom = document.getElementById('messagesArea')?.dataset?.workspaceId;
    if (fromDom) return fromDom;
    const match = window.location.pathname.match(/\/([0-9]+)\/?/);
    return match ? match[1] : null;
  }

  const workspaceId = _getWorkspaceId();

  /* ── CSRF helper ─────────────────────────────────────────────────────────── */
  function _csrf() {
    if (typeof getCSRFToken === 'function') return getCSRFToken();
    const m = document.cookie.match(/csrftoken=([^;]+)/);
    return m ? m[1] : '';
  }

  /* ── Panel open / close ──────────────────────────────────────────────────── */
  fab?.addEventListener('click', () => {
    panel?.classList.toggle('visible');
    if (panel?.classList.contains('visible')) {
      _loadHistory();
      setTimeout(() => input?.focus(), 120);
    }
  });

  closeBtn?.addEventListener('click', () => panel?.classList.remove('visible'));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') panel?.classList.remove('visible'); });

  /* ── Render one message bubble ───────────────────────────────────────────── */
  function _appendBubble(role, content, animate) {
    const wrap = document.createElement('div');
    wrap.className = `ai-msg ${role === 'user' ? 'user' : 'ai'}`;
    if (animate) wrap.style.opacity = '0';

    const bubble = document.createElement('div');
    bubble.className   = 'ai-msg-bubble';
    bubble.textContent = content;

    wrap.appendChild(bubble);
    msgArea.appendChild(wrap);
    msgArea.scrollTop = msgArea.scrollHeight;

    if (animate) {
      requestAnimationFrame(() => { wrap.style.transition = 'opacity .25s'; wrap.style.opacity = '1'; });
    }
    return wrap;
  }

  /* ── Typing indicator ────────────────────────────────────────────────────── */
  let _typingEl = null;
  function _showTyping() {
    if (_typingEl) return;
    _typingEl = document.createElement('div');
    _typingEl.className = 'ai-msg ai';
    _typingEl.innerHTML = `
      <div class="ai-msg-bubble ai-typing-bubble">
        <span class="ai-dot"></span>
        <span class="ai-dot"></span>
        <span class="ai-dot"></span>
      </div>`;
    msgArea.appendChild(_typingEl);
    msgArea.scrollTop = msgArea.scrollHeight;
  }
  function _hideTyping() { _typingEl?.remove(); _typingEl = null; }

  /* ── Load history from API ───────────────────────────────────────────────── */
  async function _loadHistory() {
    if (!workspaceId) return;
    try {
      const resp = await fetch(`/api/workspace/${workspaceId}/ai-history/`, { credentials: 'same-origin' });
      if (!resp.ok) return;
      const data = await resp.json();
      if (data.history && data.history.length > 0) {
        msgArea.innerHTML = '';
        data.history.forEach(m => _appendBubble(m.role, m.content, false));
      }
    } catch (err) { console.warn('[AI] History load failed:', err); }
  }

  /* ── Send message ────────────────────────────────────────────────────────── */
  async function _send() {
    const text = (input?.value || '').trim();
    if (!text) return;
    input.value = '';
    input.disabled = true; if (sendBtn) sendBtn.disabled = true;
    _appendBubble('user', text, true);
    _showTyping();
    if (!workspaceId) { _hideTyping(); _appendBubble('assistant', 'Could not determine workspace. Please refresh the page.', true); input.disabled = false; if (sendBtn) sendBtn.disabled = false; return; }

    try {
      const resp = await fetch(`/api/workspace/${workspaceId}/ai-chat/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': _csrf() },
        credentials: 'same-origin',
        body: JSON.stringify({ message: text }),
      });
      const data = await resp.json();
      _hideTyping();
      if (!resp.ok || data.error) { _appendBubble('assistant', data.error || 'Something went wrong. Please try again.', true); }
      else { _appendBubble('assistant', data.response, true); }
    } catch (err) {
      console.error('[AI] Send error:', err); _hideTyping(); _appendBubble('assistant', 'Network error — please check your connection.', true);
    } finally { input.disabled = false; if (sendBtn) sendBtn.disabled = false; input.focus(); }
  }

  /* ── Wire send button + Enter key ────────────────────────────────────────── */
  sendBtn?.addEventListener('click', _send);
  input?.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _send(); } });

  /* ── Optional: Clear history button ─────────────────────────────────────── */
  document.getElementById('aiClearBtn')?.addEventListener('click', async () => {
    if (!workspaceId) return;
    if (!confirm('Clear your AI conversation history for this workspace?')) return;
    try {
      await fetch(`/api/workspace/${workspaceId}/ai-clear-history/`, { method: 'POST', headers: { 'X-CSRFToken': _csrf() }, credentials: 'same-origin' });
      msgArea.innerHTML = `\n        <div class="ai-msg ai">\n          <div class="ai-msg-bubble">\n            History cleared. How can I help you today?\n          </div>\n        </div>`;
    } catch (err) { console.warn('[AI] Clear history failed:', err); }
  });

})();

/* ── Profile Modal ─────────────────────────────────────────────────────────── */
(function () {
  var overlay = document.getElementById('profileOverlay');
  function openFn()  { if (overlay) overlay.classList.add('visible'); }
  function closeFn() { if (overlay) overlay.classList.remove('visible'); }
  var openBtn   = document.getElementById('openProfileBtn');
  var closeBtn  = document.getElementById('profileCloseBtn');
  var cancelBtn = document.getElementById('profileCancelBtn');
  if (openBtn)   openBtn.addEventListener('click', openFn);
  if (closeBtn)  closeBtn.addEventListener('click', closeFn);
  if (cancelBtn) cancelBtn.addEventListener('click', closeFn);
  if (overlay)   overlay.addEventListener('click', function(e){ if (e.target === overlay) closeFn(); });
  document.querySelectorAll('.status-opt').forEach(function(btn){
    btn.addEventListener('click', function(){
      document.querySelectorAll('.status-opt').forEach(function(b){ b.classList.remove('active'); });
      btn.classList.add('active');
      var si = document.getElementById('statusInput');
      if (si) si.value = btn.dataset.status;
    });
  });

  var profileAvatarInput = document.getElementById('profileAvatarInput');
  var profileAvatarPreview = document.getElementById('profileAvatarImage');
  if (profileAvatarInput && profileAvatarPreview) {
    profileAvatarInput.addEventListener('change', function() {
      var file = profileAvatarInput.files && profileAvatarInput.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function(e) {
        if (profileAvatarPreview.tagName.toLowerCase() === 'img') {
          profileAvatarPreview.src = e.target.result;
        } else {
          profileAvatarPreview.innerHTML = '<img src="' + e.target.result + '" alt="Avatar preview" />';
        }
      };
      reader.readAsDataURL(file);
    });
  }
})();

/* ── Settings nav ──────────────────────────────────────────────────────────── */
document.getElementById('settingsNavBtn') && document.getElementById('settingsNavBtn').addEventListener('click', function(){
  var vs = document.getElementById('view-settings');
  var vc = document.getElementById('view-chat');
  if (vs) {
    vs.classList.add('active');
    if (vc) vc.classList.remove('active');
    document.querySelectorAll('.sidebar-nav .nav-item').forEach(function(n){ n.classList.remove('active'); });
    document.getElementById('settingsNavBtn').classList.add('active');
  }
});

/* ── Channel List ──────────────────────────────────────────────────────────── */
(function () {
  var list    = document.getElementById('channelList');
  var wrap    = document.getElementById('addChannelInputWrap');
  var input   = document.getElementById('addChannelInput');
  var addBtn  = document.getElementById('addChannelBtn');
  var confBtn = document.getElementById('confirmAddChannelBtn');
  var cancelBtn = document.getElementById('cancelAddChannelBtn');

  function wsId() { return window.currentWorkspaceId || 'default'; }

  function render() {
    if (!list) return;
    var stored = [];
    try { stored = JSON.parse(localStorage.getItem('ch_' + wsId()) || '[]'); } catch(e){}
    var names = stored.length ? stored : ['general','announcements','random'];
    list.innerHTML = '';
    names.forEach(function(name, i){
      var btn = document.createElement('button');
      btn.className = 'nav-item' + (i === 0 ? ' active' : '');
      btn.style.paddingLeft = '10px';
      btn.innerHTML = '<span style="opacity:.4">#</span> ' + name;
      btn.addEventListener('click', function(){
        list.querySelectorAll('.nav-item').forEach(function(b){ b.classList.remove('active'); });
        btn.classList.add('active');
        var t = document.getElementById('chatChannelTitle');
        if (t) t.textContent = name;
        var inp = document.getElementById('chatInput');
        if (inp) inp.placeholder = 'Message #' + name;
      });
      list.appendChild(btn);
    });
  }

  function addChannel() {
    var name = input && input.value && input.value.trim().toLowerCase().replace(/\s+/g,'-');
    if (!name) return;
    var key    = 'ch_' + wsId();
    var stored = [];
    try { stored = JSON.parse(localStorage.getItem(key) || '[]'); } catch(e){}
    if (!stored.includes(name)) { stored.push(name); localStorage.setItem(key, JSON.stringify(stored)); }
    if (input) input.value = '';
    if (wrap)  wrap.style.display = 'none';
    render();
  }

  if (addBtn) {
    addBtn.addEventListener('click', function(){ 
      if (wrap) wrap.style.display = wrap.style.display === 'none' ? 'block' : 'none'; 
      if (input) input.focus(); 
    });
  }
  
  if (cancelBtn) {
    cancelBtn.addEventListener('click', function() {
      if (input) input.value = '';
      if (wrap) wrap.style.display = 'none';
    });
  }

  if (confBtn) confBtn.addEventListener('click', addChannel);
  if (input)   input.addEventListener('keydown', function(e){ if (e.key === 'Enter') addChannel(); });
  render();
})();

/* ── Notification Manager ── */
window.NotificationManager = (function () {
  var state = { chat: 0, taskboard: 0, dm: {} };
  var wsId  = null;

  function getCSRF() {
    var c = document.cookie.split(';').find(function(x){ return x.trim().startsWith('csrftoken='); });
    return c ? c.split('=')[1].trim() : '';
  }

  function setBadge(el, count) {
    if (!el) return;
    if (count > 0) {
      el.textContent = count > 99 ? '99+' : String(count);
      el.style.display = 'inline-flex';
    } else {
      el.textContent = '';
      el.style.display = 'none';
    }
  }

  function renderAll() {
    setBadge(document.getElementById('chatNavBadge'),  state.chat);
    setBadge(document.getElementById('taskNavBadge'),  state.taskboard);
    Object.keys(state.dm).forEach(function(uid){
      setBadge(document.querySelector('.dm-badge[data-dm-user-id="' + uid + '"]'), state.dm[uid]);
    });
    document.querySelectorAll('.dm-badge').forEach(function(el){
      var uid = el.dataset.dmUserId;
      if (!state.dm[uid]) setBadge(el, 0);
    });
  }

  function syncRead(section, extraPayload) {
    if (!wsId) return;
    var payload = Object.assign({ section: section }, extraPayload || {});
    fetch('/api/workspace/' + wsId + '/notifications/mark-read/', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'X-CSRFToken': getCSRF(),
      },
      body: JSON.stringify(payload),
    }).catch(function(e){ console.warn('mark-read failed', e); });
  }

  return {
    init: function() {
      wsId = window.currentWorkspaceId || null;
      if (!wsId) return;

      var initial = window.INITIAL_NOTIFICATION_COUNTS || null;
      if (initial) {
        state.chat      = Number(initial.chat      || 0);
        state.taskboard = Number(initial.taskboard || 0);
        state.dm        = {};
        if (initial.dm_counts) {
          Object.keys(initial.dm_counts).forEach(function(k){
            state.dm[String(k)] = Number(initial.dm_counts[k]) || 0;
          });
        }
        renderAll();
      } else {
        fetch('/api/workspace/' + wsId + '/notifications/counts/', { credentials: 'same-origin' })
          .then(function(r){ return r.json(); })
          .then(function(data){
            state.chat      = Number(data.chat      || 0);
            state.taskboard = Number(data.taskboard || 0);
            state.dm        = {};
            if (data.dm_counts) {
              Object.keys(data.dm_counts).forEach(function(k){
                state.dm[String(k)] = Number(data.dm_counts[k]) || 0;
              });
            }
            renderAll();
          })
          .catch(function(e){ console.warn('notification counts load failed', e); });
      }

      var chatBtn = document.getElementById('chatNavBtn');
      var taskBtn = document.getElementById('taskNavBtn');

      if (chatBtn) {
        chatBtn.addEventListener('click', function(){
          if (state.chat > 0) {
            state.chat = 0;
            renderAll();
            syncRead('chat');
          }
        });
      }

      if (taskBtn) {
        taskBtn.addEventListener('click', function(){
          if (state.taskboard > 0) {
            state.taskboard = 0;
            renderAll();
            syncRead('taskboard');
          }
        });
      }

      document.querySelectorAll('.dm-item').forEach(function(btn){
        btn.addEventListener('click', function(){
          var uid = String(btn.dataset.dmUserId);
          if (state.dm[uid] && state.dm[uid] > 0) {
            state.dm[uid] = 0;
            renderAll();
            syncRead('dm', { other_user_id: parseInt(uid, 10) });
          }
        });
      });

      if (window.location.pathname.includes('/chatui/')) {
        if (state.chat > 0) { state.chat = 0; renderAll(); syncRead('chat'); }
      }
      if (window.location.pathname.includes('/taskboard/')) {
        if (state.taskboard > 0) { state.taskboard = 0; renderAll(); syncRead('taskboard'); }
      }
    },

    handleNotificationEvent: function(data) {
      if (!data || !data.notification) return;
      var section  = data.notification_section;
      var actorId  = Number(data.notification_actor_id);
      var myId     = Number(window.currentUserId);
      var path     = window.location.pathname;

      if (section === 'chat') {
        if (actorId === myId) return;
        if (path.includes('/chatui/') && !window.currentDMUser) return;
        state.chat = (state.chat || 0) + 1;
        renderAll();
        return;
      }

      if (section === 'taskboard') {
        if (path.includes('/taskboard/')) return;
        state.taskboard = (state.taskboard || 0) + 1;
        renderAll();
        return;
      }

      if (section === 'dm') {
        var targetId = Number(data.notification_target_user_id);
        if (myId !== targetId) return;
        var senderId = String(actorId);
        if (path.includes('/chatui/') && window.currentDMUser === actorId) return;
        state.dm[senderId] = (state.dm[senderId] || 0) + 1;
        renderAll();
        return;
      }
    },

    markRead: function(section, options) {
      options = options || {};
      if (section === 'chat') {
        if (state.chat === 0) return;
        state.chat = 0; renderAll(); syncRead('chat');
      } else if (section === 'taskboard') {
        if (state.taskboard === 0) return;
        state.taskboard = 0; renderAll(); syncRead('taskboard');
      } else if (section === 'dm') {
        var uid = String(options.other_user_id || '');
        if (!uid || !state.dm[uid]) return;
        state.dm[uid] = 0; renderAll(); syncRead('dm', { other_user_id: parseInt(uid, 10) });
      }
    },

    clearDM: function(userId) {
      this.markRead('dm', { other_user_id: userId });
    },
  };
})();

/* ── Workspace Edit Overlay ───────────────────────────────────────────────── */
(function() {
  var editOverlay    = document.getElementById('workspaceEditOverlay');
  var editForm       = document.getElementById('workspaceEditForm');
  var editCloseBtn   = document.getElementById('workspaceEditCloseBtn');
  var editCancelBtn  = document.getElementById('workspaceEditCancelBtn');
  var editNameInput  = document.getElementById('workspaceEditName');
  var editImageInput = document.getElementById('workspaceEditImage');
  var editPreview    = document.getElementById('workspaceEditImagePreview');
  var wsActions      = document.querySelectorAll('.ws-selector-action');

  function getCSRF() {
    var cookie = document.cookie.split(';').find(function(x){ return x.trim().startsWith('csrftoken='); });
    return cookie ? cookie.split('=')[1].trim() : '';
  }

  function closeOverlay() {
    if (!editOverlay) return;
    editOverlay.classList.remove('visible');
  }

  function openOverlay() {
    if (!editOverlay) return;
    if (editNameInput) editNameInput.focus();
    editOverlay.classList.add('visible');
  }

  function previewFile(file) {
    if (!file || !editPreview) return;
    var reader = new FileReader();
    reader.onload = function(e) {
      if (editPreview.tagName.toLowerCase() === 'img') {
        editPreview.src = e.target.result;
      } else {
        editPreview.innerHTML = '<img src="' + e.target.result + '" alt="Workspace Preview" />';
      }
    };
    reader.readAsDataURL(file);
  }

  var wsSelector = document.querySelector('.ws-selector');
  if (wsSelector) {
    wsSelector.addEventListener('click', function() {
      openOverlay();
    });
  }

  if (wsActions.length > 0) {
    wsActions.forEach(function(btn) {
      btn.addEventListener('click', function() {
        if (!editOverlay) return;
        openOverlay();
      });
    });
  }

  if (editCloseBtn) editCloseBtn.addEventListener('click', closeOverlay);
  if (editCancelBtn) editCancelBtn.addEventListener('click', closeOverlay);
  if (editOverlay) editOverlay.addEventListener('click', function(e){ if (e.target === editOverlay) closeOverlay(); });

  if (editImageInput) {
    editImageInput.addEventListener('change', function() {
      var file = editImageInput.files && editImageInput.files[0];
      previewFile(file);
    });
  }

  if (editForm) {
    editForm.addEventListener('submit', function(e) {
      e.preventDefault();
      var formData = new FormData(editForm);
      fetch(editForm.action, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'X-CSRFToken': getCSRF(),
        },
        body: formData,
      }).then(function(resp){ return resp.json(); }).then(function(data) {
        if (!data || data.error) {
          window.alert(data && data.error ? data.error : 'Unable to save workspace settings.');
          return;
        }

        var titleEl = document.querySelector('.ws-selector-name');
        if (titleEl && data.title) titleEl.textContent = data.title;

        var iconEl = document.querySelector('.ws-selector-icon');
        if (iconEl && data.image_url) {
          iconEl.innerHTML = '<img src="' + data.image_url + '" alt="Workspace Image" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />';
        }

        if (editNameInput && data.title) editNameInput.value = data.title;
        closeOverlay();
      }).catch(function() {
        window.alert('Unable to save workspace settings. Please try again.');
      });
    });
  }
})();

/* ── Boot NotificationManager after DOM is ready ───────────────────────────── */
document.addEventListener('DOMContentLoaded', function(){
  window.NotificationManager.init();
});