/* ── Read layout data from JSON blob ── */
(function () {
  var _d = {};
  try { _d = JSON.parse(document.getElementById('__layoutData__').textContent); } catch(e) {}
  window.currentWorkspaceId          = _d.workspaceId  || null;
  window.currentUserId               = _d.userId        || null;
  window.INITIAL_NOTIFICATION_COUNTS = _d.notificationCounts || null;
  window.WORKSPACE_MEMBER_MAP        = window.WORKSPACE_MEMBER_MAP || {};
  if (Array.isArray(_d.members)) {
    _d.members.forEach(function(member) {
      if (!member || !member.id) return;
      if (member.username) {
        window.WORKSPACE_MEMBER_MAP[member.username] = member.id;
      }
      if (member.displayName) {
        window.WORKSPACE_MEMBER_MAP[member.displayName] = member.id;
      }
    });
  }
})();

/* ── AI Panel ──────────────────────────────────────────────────────────────── */
(function () {
  var fab        = document.getElementById('aiFab');
  var fabWrap    = document.getElementById('aiFabWrap');
  var expandBtn  = document.getElementById('aiExpandBtn');
  var panel      = document.getElementById('aiPanel');
  var close      = document.getElementById('aiClose');
  var input      = document.getElementById('aiInput');
  var send       = document.getElementById('aiSend');
  var msgs       = document.getElementById('aiMessages');

  var aiNavBtn   = document.getElementById('aiNavBtn');
  var dragState  = { active: false, isDragging: false, pointerId: null, startX: 0, startY: 0, startRight: 24, startBottom: 24 };
  var idleTimer  = null;

  function updatePanelPosition() {
    if (!fabWrap || !panel) return;
    var right = parseFloat(fabWrap.style.right || getComputedStyle(fabWrap).right) || 24;
    var bottom = parseFloat(fabWrap.style.bottom || getComputedStyle(fabWrap).bottom) || 24;
    panel.style.right = right + 'px';
    panel.style.bottom = (bottom + fabWrap.offsetHeight + 12) + 'px';
  }

  function setFabIdle(state) {
    if (!fabWrap) return;
    fabWrap.classList.toggle('fab-idle', state);
  }

  function scheduleFabIdle() {
    if (!fabWrap) return;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(function(){
      if (panel && !panel.classList.contains('visible')) {
        setFabIdle(true);
      }
    }, 2500);
  }

  function clearFabIdle() {
    clearTimeout(idleTimer);
    setFabIdle(false);
  }

  function updatePanelState() {
    var open = panel && panel.classList.contains('visible');
    if (aiNavBtn) {
      document.querySelectorAll('.sidebar-nav .nav-item').forEach(function(el){ el.classList.remove('active'); });
      if (open) aiNavBtn.classList.add('active');
    }
    if (open && input) input.focus();
    if (open) {
      clearFabIdle();
    } else {
      scheduleFabIdle();
    }
    if (panel) updatePanelPosition();
  }

  if (fab) {
    fab.addEventListener('click', function(e){
      if (dragState.isDragging) return;
      e.stopPropagation();
      if (panel) panel.classList.toggle('visible');
      updatePanelState();
    });

    fab.addEventListener('pointerdown', function(e){
      if (e.button !== 0) return;
      dragState.active = true;
      dragState.pointerId = e.pointerId;
      dragState.startX = e.clientX;
      dragState.startY = e.clientY;
      var comp = getComputedStyle(fabWrap || fab);
      dragState.startRight = parseFloat(comp.right) || 24;
      dragState.startBottom = parseFloat(comp.bottom) || 24;
      clearFabIdle();
      fab.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    fab.addEventListener('pointermove', function(e){
      if (!dragState.active || e.pointerId !== dragState.pointerId) return;
      var dx = e.clientX - dragState.startX;
      var dy = e.clientY - dragState.startY;
      if (Math.abs(dx) + Math.abs(dy) < 6) return;
      dragState.isDragging = true;
      if (fabWrap) {
        var right = Math.max(12, dragState.startRight - dx);
        var bottom = Math.max(12, dragState.startBottom - dy);
        fabWrap.style.right = right + 'px';
        fabWrap.style.bottom = bottom + 'px';
        updatePanelPosition();
      }
    });
    fab.addEventListener('pointerup', function(e){
      if (!dragState.active || e.pointerId !== dragState.pointerId) return;
      dragState.active = false;
      fab.releasePointerCapture && fab.releasePointerCapture(e.pointerId);
      setTimeout(function(){ dragState.isDragging = false; }, 0);
      scheduleFabIdle();
    });
    fabWrap && fabWrap.addEventListener('mouseenter', clearFabIdle);
    fabWrap && fabWrap.addEventListener('mouseleave', scheduleFabIdle);
  }

  if (close) close.addEventListener('click', function(){
    if (panel) panel.classList.remove('visible');
    updatePanelState();
  });

  if (aiNavBtn) aiNavBtn.addEventListener('click', function(e){
    var href = aiNavBtn.getAttribute('href') || '';
    if (href && href !== '#') {
      // allow navigation to full AI page when the link points to it
      e.preventDefault();
      window.location.href = href;
      return;
    }
    e.preventDefault();
    if (panel) panel.classList.toggle('visible');
    updatePanelState();
  });

  if (expandBtn) expandBtn.addEventListener('click', function(e){
    e.stopPropagation();
    var url = fabWrap && fabWrap.dataset.fullAiUrl;
    if (url) window.location.href = url;
  });

  document.addEventListener('click', function(e){
    if (panel && panel.classList.contains('visible') && !panel.contains(e.target) && !(fabWrap && fabWrap.contains(e.target))) {
      panel.classList.remove('visible');
      updatePanelState();
    }
  });

  function appendMsg(text, role) {
    var d = document.createElement('div');
    d.className = 'ai-msg ' + role;
    d.innerHTML = '<div class="ai-msg-bubble">' + text.replace(/</g,'&lt;') + '</div>';
    if (msgs) { msgs.appendChild(d); msgs.scrollTop = msgs.scrollHeight; }
  }

  function doSend() {
    var text = input && input.value && input.value.trim();
    if (!text) return;
    appendMsg(text, 'user');
    input.value = '';
    var tid = 'ty' + Date.now();
    var t = document.createElement('div');
    t.className = 'ai-msg ai'; t.id = tid;
    t.innerHTML = '<div class="ai-msg-bubble" style="opacity:.5;font-style:italic;">Thinking…</div>';
    if (msgs) { msgs.appendChild(t); msgs.scrollTop = msgs.scrollHeight; }

    fetch('/api/ai-chat/', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': (document.cookie.split(';').find(function(x){
          return x.trim().startsWith('csrftoken=');
        }) || '=').split('=')[1].trim()
      },
      body: JSON.stringify({ message: text })
    })
    .then(function(r){ return r.json(); })
    .then(function(data){
      var el = document.getElementById(tid);
      if (el) el.remove();
      appendMsg(data.response || 'Sorry, try again.', 'ai');
    })
    .catch(function(){
      var el = document.getElementById(tid);
      if (el) el.remove();
      appendMsg('Could not reach AI. Please try again.', 'ai');
    });
  }
  if (send) send.addEventListener('click', doSend);
  if (input) input.addEventListener('keydown', function(e){ if (e.key === 'Enter') doSend(); });
  updatePanelPosition();
  scheduleFabIdle();
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
  document.querySelectorAll('.status-opt').forEach(function(btn)
  {
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

/* ── Direct Message Add / Sidebar helpers ─────────────────────────────────── */
(function () {
  var addDmBtn   = document.getElementById('addDmBtn');
  var addDmWrap  = document.getElementById('dmAddWrap');
  var addDmInput = document.getElementById('addDmInput');
  var confirmAddDmBtn = document.getElementById('confirmAddDmBtn');
  var cancelAddDmBtn  = document.getElementById('cancelAddDmBtn');

  function getMemberId(name) {
    if (!window.WORKSPACE_MEMBER_MAP) return null;
    var key = name.trim();
    if (!key) return null;
    if (window.WORKSPACE_MEMBER_MAP[key]) return window.WORKSPACE_MEMBER_MAP[key];
    key = key.toLowerCase();
    return Object.keys(window.WORKSPACE_MEMBER_MAP).reduce(function(found, k) {
      return found || (k.toLowerCase() === key ? window.WORKSPACE_MEMBER_MAP[k] : null);
    }, null);
  }

  function closeAddDm() {
    if (addDmInput) addDmInput.value = '';
    if (addDmWrap) addDmWrap.style.display = 'none';
  }

  function createDM() {
    if (!addDmInput) return;
    var raw = addDmInput.value.trim();
    if (!raw) return;
    var displayName = raw.replace(/^@/, '').trim();
    var memberId = getMemberId(displayName);
    if (!memberId) {
      alert('Member not found. Please enter a valid workspace member name or username.');
      return;
    }

    var existing = document.querySelector('.dm-item[data-dm-user-id="' + memberId + '"]');
    if (existing) {
      existing.click();
    } else {
      var container = addDmWrap ? addDmWrap.parentElement : null;
      if (container) {
        var btn = document.createElement('button');
        btn.className = 'dm-item';
        btn.type = 'button';
        btn.dataset.dmUserId = memberId;
        btn.innerHTML = '<span class="status-dot offline"></span>' + displayName + '<span class="badge dm-badge" data-dm-user-id="' + memberId + '" style="display:none;"></span>';
        btn.addEventListener('click', function() {
          if (typeof openDM === 'function') openDM(memberId, displayName);
        });
        container.insertBefore(btn, addDmWrap.nextSibling);
        btn.click();
      }
    }
    closeAddDm();
  }

  if (addDmBtn && addDmWrap && addDmInput && confirmAddDmBtn && cancelAddDmBtn) {
    addDmBtn.addEventListener('click', function() {
      if (addDmWrap) addDmWrap.style.display = addDmWrap.style.display === 'none' ? 'flex' : 'none';
      if (addDmInput) addDmInput.focus();
    });
    confirmAddDmBtn.addEventListener('click', createDM);
    cancelAddDmBtn.addEventListener('click', closeAddDm);
    addDmInput.addEventListener('keydown', function(e){
      if (e.key === 'Enter') {
        e.preventDefault();
        createDM();
      } else if (e.key === 'Escape') {
        closeAddDm();
      }
    });
  }
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
/* ── Mobile sidebar toggle + action buttons ─────────────────────
   Replace the previous mobile toggle block at the END of base_layout.js
─────────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', function () {
  var sidebar  = document.getElementById('sidebar');
  var mainArea = document.querySelector('.main-area');
  if (!sidebar || !mainArea) return;

  /* ── Backdrop ── */
  var backdrop = document.createElement('div');
  backdrop.className = 'sidebar-backdrop';
  backdrop.id = 'sidebarBackdrop';
  document.body.appendChild(backdrop);

  /* ── Grab call/video/info buttons from the desktop view-header ── */
  var desktopCallBtn  = document.querySelector('.view-header-right .icon-btn[title="Call"]');
  var desktopVideoBtn = document.querySelector('.view-header-right .icon-btn[title="Video"]');
  var desktopInfoBtn  = document.querySelector('.view-header-right .icon-btn[title="Info"]');

  /* ── Build mobile topbar ── */
  var wsName    = document.querySelector('.ws-selector-name');
  var titleText = wsName ? wsName.textContent.trim() : 'KollabHub';

  var topbar = document.createElement('div');
  topbar.className = 'mobile-topbar';
  topbar.id = 'mobileTopbar';

  /* Hamburger */
  var hamburger = document.createElement('button');
  hamburger.className = 'sidebar-toggle';
  hamburger.id = 'sidebarToggleBtn';
  hamburger.setAttribute('aria-label', 'Menu');
  hamburger.innerHTML =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">' +
      '<line x1="3" y1="6"  x2="21" y2="6"/>' +
      '<line x1="3" y1="12" x2="21" y2="12"/>' +
      '<line x1="3" y1="18" x2="21" y2="18"/>' +
    '</svg>';

  /* Title */
  var titleEl = document.createElement('span');
  titleEl.className = 'mobile-topbar-title';
  titleEl.id = 'mobileTopbarTitle';
  titleEl.textContent = titleText;

  /* Actions container */
  var actionsEl = document.createElement('div');
  actionsEl.className = 'mobile-topbar-actions';
  actionsEl.id = 'mobileTopbarActions';

  /* Helper: clone a desktop button as a mobile-action-btn */
  function makeMobileBtn(sourceBtn, title, svgContent) {
    var btn = document.createElement('button');
    btn.className = 'mobile-action-btn';
    btn.title = title;
    btn.setAttribute('aria-label', title);
    btn.innerHTML = svgContent;

    /* Forward clicks to the original desktop button */
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (sourceBtn) sourceBtn.click();
    });
    return btn;
  }

  /* Call button */
  var callSvg =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
      '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07' +
      'A19.5 19.5 0 0 1 4.19 11.9 19.79 19.79 0 0 1 1.12 3.24' +
      'A2 2 0 0 1 3.11 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81' +
      'a2 2 0 0 1-.45 2.11L7.09 8.91a16 16 0 0 0 6 6l1.27-1.27' +
      'a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>' +
    '</svg>';

  /* Video button */
  var videoSvg =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
      '<path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87' +
      'a.5.5 0 0 0-.752-.432L16 10.5"/>' +
      '<rect x="2" y="6" width="14" height="12" rx="2"/>' +
    '</svg>';

  /* Info button */
  var infoSvg =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
      '<circle cx="12" cy="12" r="10"/>' +
      '<path d="M12 16v-4"/>' +
      '<path d="M12 8h.01"/>' +
    '</svg>';

  var mobileCallBtn  = makeMobileBtn(desktopCallBtn,  'Call',  callSvg);
  var mobileVideoBtn = makeMobileBtn(desktopVideoBtn, 'Video', videoSvg);
  var mobileInfoBtn  = makeMobileBtn(desktopInfoBtn,  'Info',  infoSvg);

  actionsEl.appendChild(mobileCallBtn);
  actionsEl.appendChild(mobileVideoBtn);
  actionsEl.appendChild(mobileInfoBtn);

  topbar.appendChild(hamburger);
  topbar.appendChild(titleEl);
  topbar.appendChild(actionsEl);

  mainArea.insertBefore(topbar, mainArea.firstChild);

  /* ── Open / close ── */
  function openSidebar() {
    sidebar.classList.add('open');
    backdrop.classList.add('visible');
    document.body.style.overflow = 'hidden';
  }
  function closeSidebar() {
    sidebar.classList.remove('open');
    backdrop.classList.remove('visible');
    document.body.style.overflow = '';
  }

  hamburger.addEventListener('click', function (e) {
    e.stopPropagation();
    sidebar.classList.contains('open') ? closeSidebar() : openSidebar();
  });

  backdrop.addEventListener('click', closeSidebar);

  sidebar.querySelectorAll('a, .nav-item, .dm-item, .channel-item').forEach(function (el) {
    el.addEventListener('click', function () {
      if (window.innerWidth <= 640) closeSidebar();
    });
  });

  /* ── Sync mobile title with active channel ── */
  var chatTitle   = document.getElementById('chatChannelTitle');
  var mobileTitle = document.getElementById('mobileTopbarTitle');
  if (chatTitle && mobileTitle) {
    new MutationObserver(function () {
      mobileTitle.textContent = chatTitle.textContent.trim();
    }).observe(chatTitle, { childList: true, characterData: true, subtree: true });
  }

  /* ── Reset on resize to desktop ── */
  window.addEventListener('resize', function () {
    if (window.innerWidth > 640) closeSidebar();
  });
});