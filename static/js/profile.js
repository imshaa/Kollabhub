/* KOLLABHUB workspace helpers
   only basic modal open/close and permission card behaviour
*/

const createOverlay = document.getElementById('createOverlay');
const joinOverlay   = document.getElementById('joinOverlay');

function openCreateModal() {
  createOverlay.classList.add('visible');
  document.body.style.overflow = 'hidden';
}
function closeCreateModal() {
  createOverlay.classList.remove('visible');
  document.body.style.overflow = '';
}
function openJoinModal() {
  joinOverlay.classList.add('visible');
  document.body.style.overflow = 'hidden';
}
function closeJoinModal() {
  joinOverlay.classList.remove('visible');
  document.body.style.overflow = '';
}

// attach hooks for header buttons and any grid card
if (document.getElementById('openCreateBtn'))
  document.getElementById('openCreateBtn').addEventListener('click', openCreateModal);
if (document.getElementById('createBackBtn'))
  document.getElementById('createBackBtn').addEventListener('click', closeCreateModal);
if (document.getElementById('createCancelBtn'))
  document.getElementById('createCancelBtn').addEventListener('click', closeCreateModal);
// new-user grid card (only rendered when user has no workspaces)
const createGridCard = document.getElementById('createGridCard');
if (createGridCard) createGridCard.addEventListener('click', openCreateModal);
createOverlay && createOverlay.addEventListener('click', e => { if (e.target === createOverlay) closeCreateModal(); });

if (document.getElementById('openJoinBtn'))
  document.getElementById('openJoinBtn').addEventListener('click', openJoinModal);
if (document.getElementById('joinCloseBtn'))
  document.getElementById('joinCloseBtn').addEventListener('click', closeJoinModal);
if (document.getElementById('joinCancelBtn'))
  document.getElementById('joinCancelBtn').addEventListener('click', closeJoinModal);
joinOverlay && joinOverlay.addEventListener('click', e => { if (e.target === joinOverlay) closeJoinModal(); });

// permission card toggling (visual only)
document.querySelectorAll(".perm-card:not(.disabled)").forEach(card => {
  card.addEventListener("click", function () {
    // Remove active class from all
    document.querySelectorAll(".perm-card").forEach(c => {
      c.classList.remove("active");
    });

    // Add active to clicked
    this.classList.add("active");

    // Set hidden input value
    const visibility = this.getAttribute("data-visibility");
    const visInput = document.getElementById("visibilityInput");
    if (visInput) visInput.value = visibility;
  });
});

// escape key closes any open modal (also closes management modal when visible)
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (joinOverlay && joinOverlay.classList.contains('visible'))   closeJoinModal();
  if (createOverlay && createOverlay.classList.contains('visible')) closeCreateModal();
  const managementOverlay = document.getElementById('workspaceManagementSection');
  if (managementOverlay && managementOverlay.classList.contains('visible')) {
    managementOverlay.classList.remove('visible');
    managementOverlay.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }
});

const avatarBtn = document.querySelector(".avatar");
const profileOverlay = document.getElementById("profileOverlay");
const profileCloseBtn = document.getElementById("profileCloseBtn");
const profileCancelBtn = document.getElementById("profileCancelBtn");

// Open modal – only if both elements exist
if (avatarBtn && profileOverlay) {
  avatarBtn.addEventListener("click", () => {
    profileOverlay.classList.add("visible");
  });
}

// Close buttons
if (profileCloseBtn && profileOverlay) {
  profileCloseBtn.addEventListener("click", () => {
    profileOverlay.classList.remove("visible");
  });
}
if (profileCancelBtn && profileOverlay) {
  profileCancelBtn.addEventListener("click", () => {
    profileOverlay.classList.remove("visible");
  });
}

// Status selection
document.querySelectorAll(".status-opt").forEach(btn => {
  btn.addEventListener("click", function() {
    document.querySelectorAll(".status-opt").forEach(b => b.classList.remove("active"));
    this.classList.add("active");
    const statusInput = document.getElementById("statusInput");
    if (statusInput) statusInput.value = this.dataset.status;
  });
});

function attachImagePreview(fileInputId, previewElementId) {
  var fileInput = document.getElementById(fileInputId);
  var previewEl = document.getElementById(previewElementId);
  if (!fileInput || !previewEl) return;

  fileInput.addEventListener('change', function() {
    var file = fileInput.files && fileInput.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(e) {
      if (previewEl.tagName.toLowerCase() === 'img') {
        previewEl.src = e.target.result;
      } else {
        previewEl.innerHTML = '<img src="' + e.target.result + '" alt="Preview" />';
      }
    };
    reader.readAsDataURL(file);
  });
}

attachImagePreview('profileAvatarInput', 'profileAvatarImage');
attachImagePreview('workspaceImage', 'createWorkspaceImagePreview');

// Management modal init guard and handlers (prevent duplicate listeners)
let managementInitialized = false;
function closeManagementOverlay() {
  const managementOverlay = document.getElementById('workspaceManagementSection');
  if (!managementOverlay) return;
  managementOverlay.classList.remove('visible');
  managementOverlay.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

function initManagementModal() {
  if (managementInitialized) return;
  managementInitialized = true;

  const managementOverlay = document.getElementById('workspaceManagementSection');
  if (!managementOverlay) return;

  const managementCloseBtn = document.getElementById('managementCloseBtn');
  const tabAdminBtn = document.getElementById('tabAdminBtn');
  const tabUserBtn = document.getElementById('tabUserBtn');

  if (managementCloseBtn) {
    managementCloseBtn.addEventListener('click', closeManagementOverlay);
  }

  managementOverlay.addEventListener('click', (e) => {
    if (e.target === managementOverlay) {
      closeManagementOverlay();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && managementOverlay.classList.contains('visible')) {
      closeManagementOverlay();
    }
  });

  if (tabAdminBtn) tabAdminBtn.addEventListener('click', () => switchManagementTab('admin'));
  if (tabUserBtn)  tabUserBtn.addEventListener('click', () => switchManagementTab('user'));
}

// Automatically dismiss error-wrapper messages after a few seconds
function dismissErrors() {
  document.querySelectorAll('.error-wrapper').forEach(el => {
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(-10px)';
      setTimeout(() => el.remove(), 300);
    }, 4000);
  });
}

/* ==========================================================================
   NOTIFICATION SYSTEM & MANAGEMENT LAYOUT
   ========================================================================== */

let lastRenderedFeedCache = "";

document.addEventListener('DOMContentLoaded', () => {
    dismissErrors();
    
    // Initialize standard core interface hook systems
    initNotificationDropdown();
    initJoinFormSubmission();
    initAdminRequestActions();
    
    // Initial live update pull synchronization across components
    refreshNotificationSystem();
    
    // Optimized Polling: Runs every 12 seconds only if the notification dropdown is closed
    setInterval(() => {
        const dropdown = document.getElementById('notiDropdown');
        if (!dropdown || dropdown.classList.contains('hidden')) {
            refreshNotificationSystem();
        }
    }, 12000);
});

/**
 * Section 1: Dropdown Toggle Mechanics & Outside Closes Engine
 */
function initNotificationDropdown() {
    const bellBtn = document.getElementById('notiBellBtn');
    const dropdown = document.getElementById('notiDropdown');
    const markAllReadBtn = document.getElementById('markAllReadBtn');
    const viewAllLink = document.getElementById('viewAllNotiLink');
    const feed = document.getElementById('notiDropdownContainer');

    if (!bellBtn || !dropdown) return;

    bellBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.classList.toggle('hidden');
        if (!dropdown.classList.contains('hidden')) {
            refreshNotificationSystem();
        }
    });

    document.addEventListener('click', (e) => {
        if (!dropdown.classList.contains('hidden') && !dropdown.contains(e.target) && e.target !== bellBtn) {
            dropdown.classList.add('hidden');
        }
    });

    if (viewAllLink) {
      viewAllLink.addEventListener('click', () => {
        dropdown.classList.add('hidden');

        const managementOverlay = document.getElementById('workspaceManagementSection');
        if (managementOverlay) {
          initManagementModal();

          managementOverlay.classList.add('visible');
          managementOverlay.setAttribute('aria-hidden', 'false');
          document.body.style.overflow = 'hidden';

          const adminRows = document.querySelectorAll('#adminRequestTableBody tr:not(.hidden)');
          if (adminRows.length > 0) {
            switchManagementTab('admin');
          } else {
            switchManagementTab('user');
          }
        }
      });
    }

    if (markAllReadBtn) {
        markAllReadBtn.addEventListener('click', () => {
            executeBackendMarkAllRead();
        });
    }

    if (feed && !feed.innerHTML.trim()) {
        feed.innerHTML = '<div class="noti-feed-empty">Loading alerts…</div>';
    }
}

/**
 * Section 2: Management Switch Tab Controllers
 */
function switchManagementTab(targetTab) {
    const tabAdminBtn = document.getElementById('tabAdminBtn');
    const tabUserBtn = document.getElementById('tabUserBtn');
    const adminPanel = document.getElementById('adminPanelWrapper');
    const userPanel = document.getElementById('userPanelWrapper');

    if (!tabAdminBtn || !tabUserBtn || !adminPanel || !userPanel) return;

    if (targetTab === 'admin') {
        tabAdminBtn.classList.add('active');
        tabUserBtn.classList.remove('active');
        adminPanel.classList.remove('hidden');
        userPanel.classList.add('hidden');
    } else {
        tabUserBtn.classList.add('active');
        tabAdminBtn.classList.remove('active');
        userPanel.classList.remove('hidden');
        adminPanel.classList.add('hidden');
    }
}

/* Section 3: REST/WebSocket Database Integration Hooks */
function getRequestRowsFromDom() {
    const rows = [];
    document.querySelectorAll('#adminRequestTableBody tr, #userRequestTableBody tr').forEach((row) => {
        const cells = Array.from(row.querySelectorAll('td'));
        const workspaceCell = cells[0] || row;
        const statusCell = cells[cells.length - 1] || row;
        const workspaceText = (workspaceCell.textContent || '').replace(/\s+/g, ' ').trim();
        const statusText = (statusCell.textContent || '').replace(/\s+/g, ' ').trim();
        const status = /approved/i.test(statusText) ? 'approved' : /rejected/i.test(statusText) ? 'rejected' : 'pending';
        const title = /request/i.test(workspaceText) ? workspaceText : `Workspace request for ${workspaceText || 'a workspace'}`;
        rows.push({
            id: row.getAttribute('data-request-id') || '',
            title: title,
            body: `${workspaceText || 'Workspace'} • ${statusText || 'Pending'}`,
            time: (cells[1] ? cells[1].textContent : '').trim() || '',
            status: status,
            source: row.closest('#adminRequestTableBody') ? 'admin' : 'user',
        });
    });
    return rows;
}

function initAdminRequestActions() {
    document.addEventListener('click', (event) => {
        const button = event.target.closest('button[data-request-id]');
        if (!button) return;

        const requestId = button.getAttribute('data-request-id');
        const action = button.getAttribute('data-action');
        const row = document.querySelector(`tr[data-request-id="${requestId}"]`);
        if (!requestId || !row) return;

        const actionButtons = button.closest('.action-btn-group');
        if (actionButtons) {
            actionButtons.innerHTML = '<span class="status-pill pending">Updating…</span>';
        }

        fetch(`/api/workspace-join-request/${requestId}/decision/`, {
            method: 'POST',
            headers: {
                'X-Requested-With': 'XMLHttpRequest',
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'X-CSRFToken': getCsrfToken(),
            },
            body: `action=${encodeURIComponent(action)}`,
            credentials: 'same-origin'
        })
        .then(response => response.json().then(data => ({ response, data })).catch(() => ({ response, data: {} })))
        .then(({ response, data }) => {
            if (!response.ok || !data.ok) {
                if (actionButtons) {
                    actionButtons.innerHTML = `<span class="status-pill pending">${data.error || 'Unable to update request'}</span>`;
                }
                return;
            }

            if (row.closest('#adminRequestTableBody')) {
                processApplicationRequest(requestId, data.status === 'approved' ? 'approved' : 'rejected');
            }

            refreshNotificationSystem();
        })
        .catch(() => {
            if (actionButtons) {
                actionButtons.innerHTML = '<span class="status-pill pending">Unable to update request</span>';
            }
        });
    });
}

function getCsrfToken() {
    const input = document.querySelector('input[name="csrfmiddlewaretoken"]');
    if (input) return input.value;
    const meta = document.querySelector('meta[name="csrf-token"]');
    if (meta) return meta.getAttribute('content');
    return '';
}

function refreshNotificationSystem() {
    console.log("[Data Sync] Updating notification system...");
    evaluateDOMRowStates();

    const domItems = getRequestRowsFromDom();

    fetch('/api/workspace/notifications/', {
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
        credentials: 'same-origin'
    })
      .then(response => response.ok ? response.json() : null)
      .then(data => {
        if (!data) return;
        const mergedItems = [];
        const incoming = Array.isArray(data.incoming_requests) ? data.incoming_requests : [];
        const user = Array.isArray(data.user_requests) ? data.user_requests : [];
        
        incoming.forEach((item) => mergedItems.push({
            title: `${item.requested_by || 'A user'} requested access`,
            body: `${item.workspace_title || 'A workspace'} • ${item.status_label || 'Pending'}`,
            time: item.created_at || '',
            status: item.status_class || 'pending',
        }));
        user.forEach((item) => mergedItems.push({
            title: `Your request to ${item.workspace_title || 'a workspace'}`,
            body: `${item.status_label || 'Pending'}`,
            time: item.created_at || '',
            status: item.status_class || 'pending',
        }));

        syncRequestRowsFromApi([...incoming, ...user]);

        if (mergedItems.length) {
          renderNotificationFeed({ pending_count: data.pending_count || mergedItems.length, incoming_requests: incoming, user_requests: user });
        } else if (domItems.length) {
          renderNotificationFeed({ pending_count: domItems.length, incoming_requests: [], user_requests: [] });
        }

        const badge = document.getElementById('notiBadge');
        if (badge) {
          const count = data.pending_count !== undefined ? data.pending_count : domItems.length;
          if (count > 0) {
            badge.innerText = count;
            badge.classList.remove('hidden');
          } else {
            badge.innerText = '0';
            badge.classList.add('hidden');
          }
        }
      })
      .catch(() => {
        renderNotificationFeed({ pending_count: domItems.length || 0, incoming_requests: [], user_requests: [] });
      });
}

function syncRequestRowsFromApi(requests) {
    if (!Array.isArray(requests) || !requests.length) return;

    const requestMap = new Map(requests.map((request) => [String(request.id), request]));
    const rows = document.querySelectorAll('#adminRequestTableBody tr[data-request-id], #userRequestTableBody tr[data-request-id]');

    rows.forEach((row) => {
        const requestId = row.getAttribute('data-request-id');
        const request = requestMap.get(String(requestId));
        if (!request) return;

        const status = request.status || 'pending';
        const statusLabel = request.status_label || 'Pending';
        const statusClass = request.status_class || 'pending';
        const actionGroup = row.querySelector('.action-btn-group');

        if (actionGroup) {
            // Only convert buttons to a status badge if the decision is finalized
            if (status !== 'pending' && status !== 'on_hold') {
                actionGroup.innerHTML = `<span class="status-pill ${statusClass}">${statusLabel}</span>`;
            } else {
                // Keep/restore action buttons if still pending
                if (!actionGroup.querySelector('button[data-action="approve"]')) {
                    actionGroup.innerHTML = `
                        <button type="button" class="btn-table-approve" data-action="approve" data-request-id="${requestId}">Approve</button>
                        <button type="button" class="btn-table-reject" data-action="reject" data-request-id="${requestId}">Reject</button>
                    `;
                }
            }
        } else {
            const statusCell = row.querySelector('td:last-child');
            if (statusCell) {
                statusCell.innerHTML = `<span class="status-pill ${statusClass}">${statusLabel}</span>`;
            }
        }

        row.setAttribute('data-status', status === 'approved' ? 'approved' : status === 'rejected' ? 'rejected' : 'pending');
    });
}

function renderNotificationFeed(data) {
    const feed = document.getElementById('notiDropdownContainer');
    if (!feed) return;

    const domItems = getRequestRowsFromDom();
    const items = [];

    (data && data.incoming_requests || []).forEach((item) => {
        items.push({
            title: `${item.requested_by || 'A user'} requested access`,
            body: `${item.workspace_title || 'A workspace'} • ${item.status_label || 'Pending'}`,
            time: item.created_at || '',
            status: item.status_class || 'pending',
        });
    });
    (data && data.user_requests || []).forEach((item) => {
        items.push({
            title: `Your request to ${item.workspace_title || 'a workspace'}`,
            body: `${item.status_label || 'Pending'}`,
            time: item.created_at || '',
            status: item.status_class || 'pending',
        });
    });

    if (!items.length && domItems.length) {
        domItems.forEach((item) => items.push(item));
    }

    if (!items.length) {
        if (lastRenderedFeedCache !== "empty") {
            feed.innerHTML = '<div class="noti-feed-empty">No new system alerts</div>';
            lastRenderedFeedCache = "empty";
        }
        return;
    }

    // Check payload snapshot to prevent redundant innerHTML re-renders
    const currentFeedCache = JSON.stringify(items);
    if (currentFeedCache !== lastRenderedFeedCache) {
        feed.innerHTML = items.map((item) => `
          <div class="noti-feed-item">
            <div class="noti-item-status-icon ${item.status || 'pending'}">${item.status === 'approved' ? '✓' : item.status === 'rejected' ? '✕' : '•'}</div>
            <div class="noti-item-content">
              <p><strong>${(item.title || 'Workspace request').replace(/</g, '&lt;')}</strong></p>
              <p>${(item.body || 'Pending').replace(/</g, '&lt;')}</p>
              <span class="noti-item-time">${(item.time || '').replace(/</g, '&lt;')}</span>
            </div>
          </div>
        `).join('');

        lastRenderedFeedCache = currentFeedCache;
    }
}

/**
 * Process Workspace Inbound Decisional Action
 */
function processApplicationRequest(requestId, actionDecision) {
    console.log(`[Action Dispatcher] Dispatching ID: ${requestId} status resolution update value: ${actionDecision}`);

    const actionLabel = actionDecision === 'approved' ? 'approved' : 'rejected';
    const statusText = actionLabel === 'approved' ? 'Approved' : 'Rejected';

    const targetRow = document.querySelector(`tr[data-request-id="${requestId}"]`);
    if (!targetRow) return;

    const statusCell = targetRow.querySelector('td:last-child');
    if (statusCell) {
        statusCell.innerHTML = `<span class="status-pill ${actionLabel}">${statusText}</span>`;
    }

    targetRow.setAttribute('data-status', actionLabel);

    const memberRow = document.querySelector(`#userRequestTableBody tr[data-request-id="${requestId}"]`);
    if (memberRow) {
        const memberStatusCell = memberRow.querySelector('td:last-child');
        if (memberStatusCell) {
            memberStatusCell.innerHTML = `<span class="status-pill ${actionLabel}">${statusText}</span>`;
        }
        memberRow.setAttribute('data-status', actionLabel);
    }

    targetRow.style.opacity = '0';
    targetRow.style.transform = 'translateX(-12px)';
    targetRow.style.transition = 'all 0.25s ease';
    setTimeout(() => {
        targetRow.remove();
        evaluateDOMRowStates();
        refreshNotificationSystem();
    }, 220);
}

/**
 * Submit outward Join Application Form entries dynamically
 */
function initJoinFormSubmission() {
    const joinForm = document.getElementById('joinWorkspaceForm');
    if (!joinForm) return;

    joinForm.addEventListener('submit', (e) => {
        e.preventDefault();
        
        const emailInput = document.getElementById('workspaceEmail');
        const titleInput = document.getElementById('wsTitle');
        const emailVal = emailInput ? emailInput.value : '';
        const titleVal = titleInput ? titleInput.value : '';

        console.log(`[Form Dispatch] Outbound application packaging dispatched -> target: ${titleVal}, contact: ${emailVal}`);

        joinForm.submit();
    });
}

/**
 * Clear Alert Feed System Notification Flags
 */
function executeBackendMarkAllRead() {
    console.log("[Notification Engine] Executing active alerts mark-as-read updates across background processes...");
    const badge = document.getElementById('notiBadge');
    if (badge) {
        badge.classList.add('hidden');
        badge.innerText = "0";
    }
    const feed = document.getElementById('notiDropdownContainer');
    if (feed) {
        feed.innerHTML = '<div class="noti-feed-empty">No new system alerts</div>';
    }
    lastRenderedFeedCache = "empty";
}

function syncPendingRequestBadge() {
    const badge = document.getElementById('notiBadge');
    if (!badge) return;

    const pendingAdminCount = document.querySelectorAll('#adminRequestTableBody tr[data-request-id]').length;
    if (pendingAdminCount > 0) {
        badge.innerText = pendingAdminCount;
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
        badge.innerText = '0';
    }
}

function evaluateDOMRowStates() {
    const adminRows = document.querySelectorAll('#adminRequestTableBody tr[data-request-id]');
    const adminEmptyState = document.getElementById('adminEmptyState');
    const adminTable = document.querySelector('#adminPanelWrapper .table-responsive');

    if (adminRows.length === 0) {
        if (adminTable) adminTable.classList.add('hidden');
        if (adminEmptyState) adminEmptyState.classList.remove('hidden');
    } else {
        if (adminTable) adminTable.classList.remove('hidden');
        if (adminEmptyState) adminEmptyState.classList.add('hidden');
    }

    const userRows = document.querySelectorAll('#userRequestTableBody tr[data-request-id]');
    const userEmptyState = document.getElementById('userEmptyState');
    const userTable = document.querySelector('#userPanelWrapper .table-responsive');

    if (userRows.length === 0) {
        if (userTable) userTable.classList.add('hidden');
        if (userEmptyState) userEmptyState.classList.remove('hidden');
    } else {
        if (userTable) userTable.classList.remove('hidden');
        if (userEmptyState) userEmptyState.classList.add('hidden');
    }
    
    updateBadgeCounterOptimistically();
    syncPendingRequestBadge();
}

function updateBadgeCounterOptimistically() {
    const badge = document.getElementById('notiBadge');
    if (!badge) return;

    const pendingAdminCount = document.querySelectorAll('#adminRequestTableBody tr[data-request-id]').length;
    
    if (pendingAdminCount > 0) {
        badge.innerText = pendingAdminCount;
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
}