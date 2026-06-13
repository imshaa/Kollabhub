/* ══════════════════════════════════════════════════════════════════════════
   PART A — WebSocket constructor intercept
══════════════════════════════════════════════════════════════════════════ */
(function _interceptWebSocket() {
  const _NativeWebSocket = window.WebSocket;
  let   _captured        = false;

  window.WebSocket = function(url, protocols) {
    const sock = protocols
      ? new _NativeWebSocket(url, protocols)
      : new _NativeWebSocket(url);

    if (!_captured && url && url.includes('/ws/chat/')) {
      _captured = true;
      window.WebSocket = _NativeWebSocket;
      sock.addEventListener('message', function(e) {
        let d;
        try { d = JSON.parse(e.data); } catch { return; }
        if (d && d.type === 'call_signal' && window.__handleCallSignal) {
          window.__handleCallSignal(d);
        }
      });
    }
    return sock;
  };

  Object.keys(_NativeWebSocket).forEach(k => {
    try { window.WebSocket[k] = _NativeWebSocket[k]; } catch {}
  });
  window.WebSocket.prototype = _NativeWebSocket.prototype;
})();


/* ══════════════════════════════════════════════════════════════════════════
   PART B — State and DOM refs
══════════════════════════════════════════════════════════════════════════ */

const _ma    = document.getElementById('messagesArea');
const _WS_ID = _ma?.dataset?.workspaceId || '';
const _UID   = parseInt(_ma?.dataset?.userId || '0', 10);

const _call = {
  id: null, type: null, roomUrl: null, token: null,
  callObj: null, iframe: null, active: false, iInitiated: false,
};

// Tracks the current live call shown in header indicator
const _liveCall = {
  id: null, type: null, callerName: null, callerId: null,
};

// Per-session declined set — user won't get re-notified for calls they declined
const _declinedCallIds = new Set();

const _modal       = document.getElementById('callModal');
const _frameWrap   = document.getElementById('callFrameWrap');
const _connecting  = document.getElementById('callConnectingMsg');
const _endBtn      = document.getElementById('callEndBtn');
const _titleText   = document.getElementById('callModalTitleText');

// Header indicator elements
const _indicator     = document.getElementById('activeCallIndicator');
const _indicatorJoin = document.getElementById('activeCallJoinBtn');
const _indicatorAvatars = document.getElementById('activeCallAvatars');

// Old banner elements (kept for incoming notification only — auto-dismiss after 12s)
const _bannerEl   = document.getElementById('incomingCallBanner');
const _bannerName = document.getElementById('incomingCallerName');
const _bannerLbl  = document.getElementById('incomingCallLabel');
const _bannerAv   = document.getElementById('incomingCallerAvatar');
const _acceptBtn  = document.getElementById('incomingAcceptBtn');
const _declineBtn = document.getElementById('incomingDeclineBtn');

let _bannerTimer = null;


/* ══════════════════════════════════════════════════════════════════════════
   PART C — Signal handler
══════════════════════════════════════════════════════════════════════════ */
window.__handleCallSignal = function(data) {
  if (data.type !== 'call_signal') return;
  const { signal, call_id, call_type, caller_id, caller_name } = data;

  if (signal === 'incoming_call') {
    if (caller_id === _UID) return;
    if (_call.active)       return;

    // Always show indicator first — this is the persistent state
    _showIndicator(call_id, call_type, caller_name, caller_id);

    // Only popup if not declined before
    if (!_declinedCallIds.has(call_id)) {
      // Small delay ensures indicator renders before banner animates in
      setTimeout(() => _showIncomingBanner(call_id, call_type, caller_name), 50);
    }
  }

  else if (signal === 'call_ended') {
    _hideIncomingBanner();
    _hideIndicator();
    if (_call.active) _teardownLocal();
  }
};
// window.__handleCallSignal = function(data) {
//   if (data.type !== 'call_signal') return;
//   const { signal, call_id, call_type, caller_id, caller_name } = data;

//   if (signal === 'incoming_call') {
//     if (caller_id === _UID) return;   // we started it
//     if (_call.active)       return;   // already in a call

//     // Show header indicator regardless
//     _showIndicator(call_id, call_type, caller_name, caller_id);

//     // Only show the popup banner if not already declined this call
//     if (!_declinedCallIds.has(call_id)) {
//       _showIncomingBanner(call_id, call_type, caller_name);
//     }
//   }

//   else if (signal === 'call_ended') {
//     _hideIncomingBanner();
//     _hideIndicator();
//     if (_call.active) _teardownLocal();
//   }
// };


/* ══════════════════════════════════════════════════════════════════════════
   PART D — Header call indicator (persists until call ends)
══════════════════════════════════════════════════════════════════════════ */

function _showIndicator(callId, callType, callerName, callerId) {
  Object.assign(_liveCall, { id: callId, type: callType, callerName, callerId });

  // Show caller initials avatar
  if (_indicatorAvatars) {
    _indicatorAvatars.innerHTML = `
      <div class="call-ind-avatar" title="${callerName || 'Someone'}">
        ${_initials(callerName || '?')}
      </div>`;
  }

  if (_indicator) _indicator.style.display = 'flex';
}

function _hideIndicator() {
  Object.assign(_liveCall, { id: null, type: null, callerName: null, callerId: null });
  if (_indicator) _indicator.style.display = 'none';
  if (_indicatorAvatars) _indicatorAvatars.innerHTML = '';
}

// Wire the Join button in the header indicator
_indicatorJoin?.addEventListener('click', () => {
  if (_liveCall.id) _acceptCallById(_liveCall.id, _liveCall.type);
});


/* ══════════════════════════════════════════════════════════════════════════
   PART E — Incoming banner (popup, auto-dismisses in 12s)
══════════════════════════════════════════════════════════════════════════ */

function _showIncomingBanner(callId, callType, callerName) {
  clearTimeout(_bannerTimer);

  if (_bannerName) _bannerName.textContent = callerName || 'Someone';
  if (_bannerAv)   _bannerAv.textContent   = _initials(callerName || '?');
  if (_bannerLbl)  _bannerLbl.textContent  =
    (callType === 'voice' ? '📞' : '📹') + ' is calling…';

  // Reset banner to incoming style (not live/persistent)
  if (_bannerEl) {
    _bannerEl.classList.remove('call-live');
    _bannerEl.querySelector('.call-live-pill')?.remove();
    _bannerEl.style.display = '';
    _bannerEl.dataset.callId = callId;
  }
  if (_declineBtn) _declineBtn.style.display = '';
  if (_acceptBtn)  {
    _acceptBtn.title            = 'Accept';
    _acceptBtn.innerHTML        = _phoneIcon();
    _acceptBtn.style.background = '#22c55e';
  }

  // Auto-dismiss after 12 seconds — user still sees the header indicator
  _bannerTimer = setTimeout(() => _hideIncomingBanner(), 12000);
}

function _hideIncomingBanner() {
  clearTimeout(_bannerTimer);
  _bannerTimer = null;
  if (_bannerEl) _bannerEl.style.display = 'none';
}

_acceptBtn?.addEventListener('click', () => {
  const callId = _bannerEl?.dataset?.callId;
  _hideIncomingBanner();
  if (callId) _acceptCallById(callId, _liveCall.type);
});

_declineBtn?.addEventListener('click', () => {
  const callId = _bannerEl?.dataset?.callId;
  _hideIncomingBanner();
  if (callId) {
    _declinedCallIds.add(callId);
    _declineCallApi(callId);
  }
  // Explicitly re-show indicator in case it was hidden or not yet rendered
  if (_liveCall.id) {
    _showIndicator(_liveCall.id, _liveCall.type, _liveCall.callerName, _liveCall.callerId);
  }
});
// _declineBtn?.addEventListener('click', () => {
//   const callId = _bannerEl?.dataset?.callId;
//   _hideIncomingBanner();
//   if (callId) {
//     _declinedCallIds.add(callId);  // suppress future popups for this call
//     _declineCallApi(callId);
//   }
//   // Header indicator stays visible so they can join later
// });


/* ══════════════════════════════════════════════════════════════════════════
   PART F — Button wiring
══════════════════════════════════════════════════════════════════════════ */

document.querySelector('.icon-btn[title="Call"]')
  ?.addEventListener('click', () => _initiateCall('voice'));
document.querySelector('.icon-btn[title="Video"]')
  ?.addEventListener('click', () => _initiateCall('video'));

_endBtn?.addEventListener('click', () => {
  _call.iInitiated ? _endCallForEveryone() : _leaveCallLocally();
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && _modal?.style.display !== 'none') {
    _call.iInitiated ? _endCallForEveryone() : _leaveCallLocally();
  }
});


/* ══════════════════════════════════════════════════════════════════════════
   PART G — Page-load: check for active call
══════════════════════════════════════════════════════════════════════════ */
function _checkActiveCall() {
  if (!_WS_ID) return;
  fetch(`/api/workspace/${_WS_ID}/call/active/`, { credentials: 'same-origin' })
    .then(r => r.json())
    .then(d => {
      if (d.active && !_call.active) {
        // Always show indicator on page load — no banner, just the header pill
        _showIndicator(d.call_id, d.call_type, d.caller_name, d.caller_id);
        
        // Restore initiator state: if current user is the caller, they can end the call
        const isInitiator = (d.caller_id === _UID);
        Object.assign(_call, {
          id: d.call_id,
          type: d.call_type,
          active: false,  // not in the call yet, just seeing the indicator
          iInitiated: isInitiator,
        });
        
        // Update end button hint for when they join
        if (_endBtn) {
          _endBtn.innerHTML = isInitiator ? `${_phoneIconEnd()} End Call` : `${_phoneIconEnd()} Leave Call`;
          isInitiator ? _endBtn.classList.remove('leave-mode') : _endBtn.classList.add('leave-mode');
        }
        
        // Do NOT show the popup banner on page load — indicator is enough
      }
    })
    .catch(e => console.warn('[Call] active-call check failed:', e));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _checkActiveCall);
} else {
  _checkActiveCall();
}


/* ══════════════════════════════════════════════════════════════════════════
   PART H — Initiate / accept / end / leave
══════════════════════════════════════════════════════════════════════════ */

async function _initiateCall(callType) {
  if (!_WS_ID)      { _toast('Workspace ID missing — refresh and try again.'); return; }
  if (_call.active) { _toast('You are already in a call.'); return; }

  _openModal(callType);

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
    if (_endBtn) {
      _endBtn.innerHTML = `${_phoneIconEnd()} End Call`;
      _endBtn.classList.remove('leave-mode');
    }
    _launchFrame(data.room_url, data.token);
  } catch (err) {
    console.error('[Call] _initiateCall error:', err);
    _closeModal();
    _toast('Network error — could not start call.');
  }
}

async function _acceptCallById(callId, callType) {
  if (_call.active) { _toast('Already in a call.'); return; }
  if (!callId)      { _toast('Call no longer available.'); return; }

  _openModal(callType || 'video');

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
    
    // Preserve initiator state if already set (e.g., after page refresh)
    const wasInitiator = _call.iInitiated;
    
    Object.assign(_call, {
      id: data.call_id, type: data.call_type,
      roomUrl: data.room_url, token: data.token,
      active: true, iInitiated: wasInitiator,  // preserve initiator state
    });
    if (_endBtn) {
      if (wasInitiator) {
        _endBtn.innerHTML = `${_phoneIconEnd()} End Call`;
        _endBtn.classList.remove('leave-mode');
      } else {
        _endBtn.innerHTML = `${_phoneIconEnd()} Leave Call`;
        _endBtn.classList.add('leave-mode');
      }
    }
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
  _hideIndicator();
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
  // Room stays alive for others — indicator stays visible
}

async function _declineCallApi(callId) {
  try {
    await fetch(`/api/workspace/${_WS_ID}/call/${callId}/decline/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': _csrf() },
      credentials: 'same-origin',
    });
  } catch {}
}


/* ══════════════════════════════════════════════════════════════════════════
   PART I — Daily.co frame (unchanged logic)
══════════════════════════════════════════════════════════════════════════ */

function _launchFrame(roomUrl, token) {
  _destroyFrame();

  const DailySDK = window.DailyIframe || window.Daily;

  if (!DailySDK) {
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
    _iframeFallback(roomUrl, token);
    return;
  }
  _call.callObj = callObj;

  callObj
    .on('joining-meeting', () => { if (_connecting) _connecting.style.display = 'none'; })
    .on('joined-meeting',  () => { if (_connecting) _connecting.style.display = 'none'; })
    .on('left-meeting',    () => { _leaveCallLocally(); })
    .on('error', err => {
      _toast('Call error: ' + (err?.errorMsg || JSON.stringify(err)));
      _teardownLocal();
    });

  const joinParams = { url: roomUrl };
  if (token) joinParams.token = token;

  callObj.join(joinParams)
    .then(() => console.log('[Call] join() ✓'))
    .catch(err => {
      const msg = err?.errorMsg || err?.details || err?.message || JSON.stringify(err);
      const tokenIssue = msg && (msg.includes('token') || msg.includes('auth') || msg.includes('401') || msg.includes('403'));
      if (token && tokenIssue) {
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

function _openModal(callType) {
  if (!_modal) return;
  if (_titleText)  _titleText.textContent    = callType === 'voice' ? 'Voice Call' : 'Video Call';
  if (_connecting) _connecting.style.display = 'flex';
  _modal.style.display         = 'flex';
  document.body.style.overflow = 'hidden';
}

function _closeModal() {
  if (_modal)      _modal.style.display      = 'none';
  if (_connecting) _connecting.style.display = 'flex';
  document.body.style.overflow = '';
}


/* ══════════════════════════════════════════════════════════════════════════
   PART J — Utilities
══════════════════════════════════════════════════════════════════════════ */

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
  return `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z"/></svg>`;
}
function _phoneIconEnd() {
  return `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z"/></svg>`;
}

console.log('[Call] v4 ready | workspace:', _WS_ID, '| user:', _UID);