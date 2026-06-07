
/* ══════════════════════════════════════════════════════════════════════════
   PART A — WebSocket constructor intercept
   Captures the chatSocket object the moment chatui.js creates it,
   so we can attach our own addEventListener without any polling.
   ══════════════════════════════════════════════════════════════════════════ */
(function _interceptWebSocket() {
  const _NativeWebSocket = window.WebSocket;
  let   _captured        = false;

  window.WebSocket = function(url, protocols) {
    const sock = protocols
      ? new _NativeWebSocket(url, protocols)
      : new _NativeWebSocket(url);

    // Only intercept the chat socket (url contains /ws/chat/)
    if (!_captured && url && url.includes('/ws/chat/')) {
      _captured = true;
      // Restore native constructor immediately so nothing else is affected
      window.WebSocket = _NativeWebSocket;

      // Attach our listener to this exact socket object
      sock.addEventListener('message', function _callSignalListener(e) {
        let d;
        try { d = JSON.parse(e.data); } catch { return; }
        if (d && d.type === 'call_signal' && window.__handleCallSignal) {
          window.__handleCallSignal(d);
        }
      });

      console.log('[Call] WebSocket intercepted — call signal listener attached ✓');
    }

    return sock;
  };

  // Copy static properties (CONNECTING, OPEN, CLOSED, etc.) so nothing breaks
  Object.keys(_NativeWebSocket).forEach(k => {
    try { window.WebSocket[k] = _NativeWebSocket[k]; } catch {}
  });
  window.WebSocket.prototype = _NativeWebSocket.prototype;
})();


/* ══════════════════════════════════════════════════════════════════════════
   PART B — call signal handler (registered synchronously on window)
   ══════════════════════════════════════════════════════════════════════════ */

/* ── Read workspace / user from DOM ──────────────────────────────────────── */
const _ma    = document.getElementById('messagesArea');
const _WS_ID = _ma?.dataset?.workspaceId || '';
const _UID   = parseInt(_ma?.dataset?.userId || '0', 10);

/* ── Internal state ──────────────────────────────────────────────────────── */
const _call = {
  id:         null,
  type:       null,
  roomUrl:    null,
  token:      null,
  callObj:    null,
  iframe:     null,
  active:     false,
  iInitiated: false,
};

const _banner = {
  callId:    null,
  callType:  null,
  callerName:null,
  callerId:  null,
  autoTimer: null,
};

/* ── DOM refs ────────────────────────────────────────────────────────────── */
const _modal      = document.getElementById('callModal');
const _frameWrap  = document.getElementById('callFrameWrap');
const _connecting = document.getElementById('callConnectingMsg');
const _endBtn     = document.getElementById('callEndBtn');
const _titleText  = document.getElementById('callModalTitleText');
const _bannerEl   = document.getElementById('incomingCallBanner');
const _bannerName = document.getElementById('incomingCallerName');
const _bannerLbl  = document.getElementById('incomingCallLabel');
const _bannerAv   = document.getElementById('incomingCallerAvatar');
const _acceptBtn  = document.getElementById('incomingAcceptBtn');
const _declineBtn = document.getElementById('incomingDeclineBtn');

/* ── Signal handler — registered on window so chatui.js can also call it ── */
window.__handleCallSignal = function(data) {
  if (data.type !== 'call_signal') return;
  const { signal, call_id, call_type, caller_id, caller_name } = data;

  console.log('[Call] ▶ signal received:', signal, 'call_id:', call_id, 'from:', caller_name);

  if (signal === 'incoming_call') {
    if (caller_id === _UID) return;   // we started it — already in the modal
    if (_call.active)       return;   // already in a call
    _showBanner(call_id, call_type, caller_name, caller_id, false);
  }

  else if (signal === 'call_ended') {
    _hideBanner(true);
    if (_call.active) _teardownLocal();
  }
};

/* ── Button wiring ───────────────────────────────────────────────────────── */
document.querySelector('.icon-btn[title="Call"]')
  ?.addEventListener('click', () => _initiateCall('voice'));
document.querySelector('.icon-btn[title="Video"]')
  ?.addEventListener('click', () => _initiateCall('video'));

_endBtn?.addEventListener('click', () => {
  _call.iInitiated ? _endCallForEveryone() : _leaveCallLocally();
});

_acceptBtn?.addEventListener('click',  _acceptCall);
_declineBtn?.addEventListener('click', _declineBanner);

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && _modal?.style.display !== 'none') {
    _call.iInitiated ? _endCallForEveryone() : _leaveCallLocally();
  }
});

/* ── Page-load: show banner if call already active ───────────────────────── */
// Use DOMContentLoaded — by this point the DOM is ready but call.js
// may have loaded before or after it fires, so guard both cases.
function _checkActiveCall() {
  if (!_WS_ID) return;
  fetch(`/api/workspace/${_WS_ID}/call/active/`, { credentials: 'same-origin' })
    .then(r => r.json())
    .then(d => {
      if (d.active && !_call.active) {
        console.log('[Call] Active call on page load:', d);
        _showBanner(d.call_id, d.call_type, d.caller_name, d.caller_id, true);
      }
    })
    .catch(e => console.warn('[Call] active-call check failed:', e));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _checkActiveCall);
} else {
  _checkActiveCall(); // DOM already ready
}

/* ═══════════════════════════════════════════════════════════════════════════
   BANNER
   ═══════════════════════════════════════════════════════════════════════════ */
function _showBanner(callId, callType, callerName, callerId, persistent) {
  clearTimeout(_banner.autoTimer);
  _banner.autoTimer = null;
  Object.assign(_banner, { callId, callType, callerName, callerId });

  if (_bannerName) _bannerName.textContent = callerName || 'Someone';
  if (_bannerAv)   _bannerAv.textContent   = _initials(callerName || '?');
  if (_bannerLbl)  _bannerLbl.textContent  =
    (callType === 'voice' ? '📞' : '📹') +
    (persistent ? ' call in progress' : ' is calling…');

  if (_acceptBtn) {
    _acceptBtn.title             = persistent ? 'Join call' : 'Accept';
    _acceptBtn.innerHTML         = _phoneIcon();
    _acceptBtn.style.background  = '#22c55e';
  }
  if (_declineBtn) {
    _declineBtn.style.display = persistent ? 'none' : '';
  }

  if (_bannerEl) {
    _bannerEl.style.display = '';
    if (persistent) {
      _bannerEl.classList.add('call-live');
      if (!_bannerEl.querySelector('.call-live-pill')) {
        const pill = document.createElement('span');
        pill.className   = 'call-live-pill';
        pill.textContent = 'Live';
        _bannerLbl?.insertAdjacentElement('afterend', pill);
      }
    } else {
      _bannerEl.classList.remove('call-live');
      _bannerEl.querySelector('.call-live-pill')?.remove();
    }
  }

  if (!persistent) {
    _banner.autoTimer = setTimeout(() => _hideBanner(false), 35_000);
  }
}

function _hideBanner(force) {
  clearTimeout(_banner.autoTimer);
  _banner.autoTimer = null;
  if (_bannerEl) {
    _bannerEl.style.display = 'none';
    _bannerEl.classList.remove('call-live');
    _bannerEl.querySelector('.call-live-pill')?.remove();
  }
  if (!force) return;
  Object.assign(_banner, { callId:null, callType:null, callerName:null, callerId:null });
}

async function _declineBanner() {
  const id = _banner.callId;
  _hideBanner(true);
  if (!id) return;
  try {
    await fetch(`/api/workspace/${_WS_ID}/call/${id}/decline/`, {
      method: 'POST', headers: { 'X-CSRFToken': _csrf() }, credentials: 'same-origin',
    });
  } catch {}
}

/* ═══════════════════════════════════════════════════════════════════════════
   INITIATE / ACCEPT / END / LEAVE
   ═══════════════════════════════════════════════════════════════════════════ */
async function _initiateCall(callType) {
  if (!_WS_ID)     { _toast('Workspace ID missing — refresh and try again.'); return; }
  if (_call.active) { _toast('You are already in a call.'); return; }

  _openModal(callType, false);

  try {
    const resp = await fetch(`/api/workspace/${_WS_ID}/call/start/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': _csrf() },
      credentials: 'same-origin',
      body: JSON.stringify({ call_type: callType }),
    });
    const data = await resp.json();
    if (!resp.ok || !data.success) {
      _closeModal();
      _toast(data.error || 'Could not start call. Please try again.');
      return;
    }
    Object.assign(_call, {
      id: data.call_id, type: data.call_type,
      roomUrl: data.room_url, token: data.token,
      active: true, iInitiated: true,
    });
    if (_endBtn) { _endBtn.innerHTML = `${_phoneIconEnd()} End Call`; _endBtn.classList.remove('leave-mode'); }
    _launchFrame(data.room_url, data.token);
  } catch (err) {
    console.error('[Call] _initiateCall error:', err);
    _closeModal();
    _toast('Network error — could not start call.');
  }
}

async function _acceptCall() {
  if (_call.active) { _toast('Already in a call.'); _hideBanner(true); return; }
  const callId = _banner.callId, callType = _banner.callType;
  _hideBanner(true);
  if (!callId) { _toast('Call no longer available.'); return; }

  _openModal(callType, true);

  try {
    const resp = await fetch(`/api/workspace/${_WS_ID}/call/${callId}/join/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': _csrf() },
      credentials: 'same-origin',
    });
    const data = await resp.json();
    if (!resp.ok || !data.success) {
      _closeModal();
      _toast(data.error || 'Could not join call — it may have ended.');
      return;
    }
    Object.assign(_call, {
      id: data.call_id, type: data.call_type,
      roomUrl: data.room_url, token: data.token,
      active: true, iInitiated: false,
    });
    if (_endBtn) { _endBtn.innerHTML = `${_phoneIconEnd()} Leave Call`; _endBtn.classList.add('leave-mode'); }
    _launchFrame(data.room_url, data.token);
  } catch (err) {
    console.error('[Call] _acceptCall error:', err);
    _closeModal();
    _toast('Network error — could not join call.');
  }
}

async function _endCallForEveryone() {
  const id = _call.id;
  _teardownLocal();
  if (!id) return;
  try {
    await fetch(`/api/workspace/${_WS_ID}/call/${id}/end/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': _csrf() },
      credentials: 'same-origin',
    });
  } catch (err) {
    console.error('[Call] _endCallForEveryone error:', err);
  }
}

function _leaveCallLocally() {
  _teardownLocal();
  // No API call — room stays alive for others
}

/* ═══════════════════════════════════════════════════════════════════════════
   DAILY.CO FRAME
   ═══════════════════════════════════════════════════════════════════════════ */
function _launchFrame(roomUrl, token) {
  _destroyFrame();

  const DailySDK = window.DailyIframe || window.Daily;
  console.log('[Call] Launching | SDK:', !!DailySDK, '| url:', roomUrl);

  if (!DailySDK) {
    console.warn('[Call] No Daily SDK — plain iframe fallback');
    _iframeFallback(roomUrl, token);
    return;
  }

  const iframe = document.createElement('iframe');
  iframe.allow = 'camera; microphone; fullscreen; speaker; display-capture; autoplay; clipboard-write';
  Object.assign(iframe.style, {
    position:'absolute', top:'0', left:'0',
    width:'100%', height:'100%', border:'none',
    borderRadius:'0 0 20px 20px', zIndex:'1',
  });
  _frameWrap?.appendChild(iframe);
  _call.iframe = iframe;

  let callObj;
  try {
    callObj = DailySDK.wrap(iframe, { showLeaveButton: false, showFullscreenButton: true });
  } catch (err) {
    console.error('[Call] DailySDK.wrap failed:', err);
    _iframeFallback(roomUrl, token);
    return;
  }
  _call.callObj = callObj;

  callObj
    .on('joining-meeting', () => { if (_connecting) _connecting.style.display = 'none'; })
    .on('joined-meeting',  () => { if (_connecting) _connecting.style.display = 'none'; })
    .on('left-meeting',    () => { _leaveCallLocally(); })   // NEVER end for all
    .on('error', err => {
      const msg = err?.errorMsg || err?.details || err?.error || JSON.stringify(err);
      console.error('[Call] Daily error:', msg);
      _toast('Call error: ' + msg);
      _teardownLocal();
    });

  const joinParams = { url: roomUrl };
  if (token) joinParams.token = token;

  callObj.join(joinParams)
    .then(() => console.log('[Call] join() ✓'))
    .catch(err => {
      const msg = err?.errorMsg || err?.details || err?.error || err?.message || JSON.stringify(err);
      console.error('[Call] join() failed:', msg);

      const tokenIssue = msg && (
        msg.includes('token') || msg.includes('auth') ||
        msg.includes('401')   || msg.includes('403')
      );
      if (token && tokenIssue) {
        console.warn('[Call] Token rejected — retrying without token');
        callObj.join({ url: roomUrl })
          .then(() => console.log('[Call] Public join ✓'))
          .catch(e2 => { _toast('Could not connect: ' + JSON.stringify(e2)); _teardownLocal(); });
        return;
      }
      _toast('Could not connect: ' + msg);
      _teardownLocal();
    });
}

function _iframeFallback(roomUrl, token) {
  const url    = token ? `${roomUrl}?t=${encodeURIComponent(token)}` : roomUrl;
  const iframe = document.createElement('iframe');
  iframe.src   = url;
  iframe.allow = 'camera; microphone; fullscreen; speaker; display-capture; autoplay';
  Object.assign(iframe.style, {
    position:'absolute', top:'0', left:'0',
    width:'100%', height:'100%', border:'none',
    borderRadius:'0 0 20px 20px', zIndex:'1',
  });
  _frameWrap?.appendChild(iframe);
  _call.iframe = iframe;
  setTimeout(() => { if (_connecting) _connecting.style.display = 'none'; }, 2500);
}

function _destroyFrame() {
  if (_call.callObj) {
    try { _call.callObj.leave();   } catch {}
    try { _call.callObj.destroy(); } catch {}
    _call.callObj = null;
  }
  if (_call.iframe) { try { _call.iframe.remove(); } catch {} _call.iframe = null; }
  _frameWrap?.querySelectorAll('iframe').forEach(f => f.remove());
}

function _teardownLocal() {
  _destroyFrame();
  Object.assign(_call, { id:null, type:null, roomUrl:null, token:null, active:false, iInitiated:false });
  _closeModal();
}

/* ── Modal ───────────────────────────────────────────────────────────────── */
function _openModal(callType, isJoining) {
  if (!_modal) { console.error('[Call] #callModal not found'); return; }
  if (_titleText)  _titleText.textContent    = callType === 'voice' ? 'Voice Call' : 'Video Call';
  if (_connecting) _connecting.style.display = 'flex';
  _modal.style.display        = 'flex';
  document.body.style.overflow = 'hidden';
}

function _closeModal() {
  if (_modal)      _modal.style.display      = 'none';
  if (_connecting) _connecting.style.display = 'flex';
  document.body.style.overflow = '';
}

/* ── Utilities ───────────────────────────────────────────────────────────── */
function _initials(n) {
  return (n || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}
function _csrf() {
  if (typeof getCSRFToken === 'function') return getCSRFToken();
  const m = document.cookie.match(/csrftoken=([^;]+)/);
  return m ? m[1] : '';
}
function _toast(msg) {
  const old = document.getElementById('_callToast');
  if (old) old.remove();
  const t = document.createElement('div');
  t.id = '_callToast';
  Object.assign(t.style, {
    position:'fixed', bottom:'90px', left:'50%', transform:'translateX(-50%)',
    background:'#1e293b', color:'#f8fafc', border:'1.5px solid #475569',
    padding:'12px 24px', borderRadius:'10px', fontSize:'.85rem',
    zIndex:'999999', boxShadow:'0 4px 24px rgba(0,0,0,.5)',
    whiteSpace:'nowrap', maxWidth:'90vw', textAlign:'center',
    opacity:'0', transition:'opacity .2s',
  });
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => { t.style.opacity = '1'; });
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 250); }, 5000);
}
function _phoneIcon() {
  return `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
    <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4
      1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4
      1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1
      .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z"/></svg>`;
}
function _phoneIconEnd() {
  return `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4
      1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4
      1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1
      .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z"/></svg>`;
}

console.log('[Call] v3 ready | workspace:', _WS_ID, '| user:', _UID, '| SDK:', !!(window.DailyIframe || window.Daily));