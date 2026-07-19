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
    document.getElementById("visibilityInput").value = visibility;
  });
});

// document.querySelectorAll('.perm-card:not(.disabled)').forEach(card => {
//   card.addEventListener('click', () => {
//     document.querySelectorAll('.perm-card:not(.disabled)').forEach(c => c.classList.remove('active'));
//     card.classList.add('active');
//   });
// });


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
    document.getElementById("statusInput").value = this.dataset.status;
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

  // Close button
  if (managementCloseBtn) {
    managementCloseBtn.addEventListener('click', closeManagementOverlay);
  }

  // Click outside to close
  managementOverlay.addEventListener('click', (e) => {
    if (e.target === managementOverlay) {
      closeManagementOverlay();
    }
  });

  // Escape key closes the overlay
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && managementOverlay.classList.contains('visible')) {
      closeManagementOverlay();
    }
  });

  // Attach tab button click handlers (removed inline onclicks in HTML)
  if (tabAdminBtn) tabAdminBtn.addEventListener('click', () => switchManagementTab('admin'));
  if (tabUserBtn)  tabUserBtn.addEventListener('click', () => switchManagementTab('user'));
}

document.addEventListener('DOMContentLoaded', dismissErrors);

// automatically dismiss error-wrapper messages after a few seconds
function dismissErrors() {
  document.querySelectorAll('.error-wrapper').forEach(el => {
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(-10px)';
      setTimeout(() => el.remove(), 300);
    }, 4000);
  });
}

document.addEventListener('DOMContentLoaded', dismissErrors);
/* ==========================================================================
   NOTIFICATION SYSTEM & MANAGEMENT LAYOUT
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
    // Initialize standard core interface hook systems
    initNotificationDropdown();
    initJoinFormSubmission();
    
    // Initial live update pull synchronization across components
    refreshNotificationSystem();
});

/**
 * Section 1: Dropdown Toggle Mechanics & Outside Closes Engine
 */
function initNotificationDropdown() {
    const bellBtn = document.getElementById('notiBellBtn');
    const dropdown = document.getElementById('notiDropdown');
    const markAllReadBtn = document.getElementById('markAllReadBtn');
    const viewAllLink = document.getElementById('viewAllNotiLink');

    if (!bellBtn || !dropdown) return;

    // Toggle Dropdown Display State window
    bellBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.classList.toggle('hidden');
    });

    // Dismiss active element containers safely upon layout focus changes outside element block bounds
    document.addEventListener('click', (e) => {
        if (!dropdown.classList.contains('hidden') && !dropdown.contains(e.target) && e.target !== bellBtn) {
            dropdown.classList.add('hidden');
        }
    });

    // Action execution routing hooks: View All Notifications Click Trigger Handler
    if (viewAllLink) {
      viewAllLink.addEventListener('click', () => {
        dropdown.classList.add('hidden'); // Close the alert dropdown drawer panel

        // Open the workspace management modal overlay instead of scrolling
        const managementOverlay = document.getElementById('workspaceManagementSection');
        if (managementOverlay) {
          // Attach management modal handlers once (idempotent)
          initManagementModal();

          managementOverlay.classList.add('visible');
          managementOverlay.setAttribute('aria-hidden', 'false');
          document.body.style.overflow = 'hidden';

          // Auto-select appropriate tab based on presence of admin requests
          const adminRows = document.querySelectorAll('#adminRequestTableBody tr:not(.hidden)');
          if (adminRows.length > 0) {
            switchManagementTab('admin');
          } else {
            switchManagementTab('user');
          }
        }
      });
    }

    // Action Execution: Mark all notifications read locally
    if (markAllReadBtn) {
        markAllReadBtn.addEventListener('click', () => {
            executeBackendMarkAllRead();
        });
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

/* Section 3: REST/WebSocket Database Integration Hooks active API endpoints here. */
function refreshNotificationSystem() {
    console.log("[Data Sync] Fetching dynamic WorkspaceRequest dataset instances from backend endpoints...");
    evaluateDOMRowStates();
}

/**
 * Process Workspace Inbound Decisional Action
 * @param {string|number} requestId - Target row key index tracking sequence.
 * @param {string} actionDecision - Execution state parameter token: 'approved' | 'rejected'
 */
function processApplicationRequest(requestId, actionDecision) {
    console.log(`[Action Dispatcher] Dispatching ID: ${requestId} status resolution update value: ${actionDecision}`);

    // INTEGRATION WEBHOOK PATTERN EXAMPLE:
    /*
    fetch(`/api/workspaces/requests/${requestId}/evaluate/`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCookie('csrftoken') // Handles standard Django CSRF security validations cleanly
        },
        body: JSON.stringify({ status: actionDecision })
    })
    .then(res => {
        if(res.ok) {
            // Optimistic rendering update sync layout execution refresh tracking loops immediately
            refreshNotificationSystem();
        }
    });
    */

    // Visual Optimistic Row Removal Animation Interface helper block rule
    const targetRow = document.querySelector(`tr[data-request-id="${requestId}"]`);
    if (targetRow) {
        targetRow.style.opacity = '0';
        targetRow.style.transform = 'translateX(-12px)';
        targetRow.style.transition = 'all 0.25s ease';
        setTimeout(() => {
            targetRow.remove();
            evaluateDOMRowStates();
        }, 250);
    }
}

/**
 * Submit outward Join Application Form entries dynamically via AJAX pipelines
 */
function initJoinFormSubmission() {
    const joinForm = document.getElementById('joinWorkspaceForm');
    if (!joinForm) return;

    joinForm.addEventListener('submit', (e) => {
        e.preventDefault();
        
        // Grab values cleanly from element references
        const emailVal = document.getElementById('workspaceEmail').value;
        const titleVal = document.getElementById('wsTitle').value;

        console.log(`[Form Dispatch] Outbound application packaging dispatched -> target: ${titleVal}, contact: ${emailVal}`);

        // Handle native form data submissions to Django backend controller views via active Fetch API wrappers here if needed.
        // Upon successful execution return responses:
        // document.getElementById('joinOverlay').classList.remove('active'); // dismisses tracking dialog view
        // refreshNotificationSystem();
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
}

/**
 * Helper Utility Layer: Computes row elements directly within DOM state layers to handle real-time empty placeholder state updates safely
 */
function evaluateDOMRowStates() {
    const adminRows = document.querySelectorAll('#adminRequestTableBody tr');
    const adminEmptyState = document.getElementById('adminEmptyState');
    const adminTable = document.querySelector('#adminPanelWrapper .table-responsive');

    if (adminRows.length === 0) {
        if (adminTable) adminTable.classList.add('hidden');
        if (adminEmptyState) adminEmptyState.classList.remove('hidden');
    } else {
        if (adminTable) adminTable.classList.remove('hidden');
        if (adminEmptyState) adminEmptyState.classList.add('hidden');
    }

    const userRows = document.querySelectorAll('#userRequestTableBody tr');
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
}

/**
 * Reads dynamic unread status criteria counts straight out of rendering feeds to balance counter metrics dynamically
 */
function updateBadgeCounterOptimistically() {
    const badge = document.getElementById('notiBadge');
    if (!badge) return;

    const pendingAdminCount = document.querySelectorAll('#adminRequestTableBody tr').length;
    
    if (pendingAdminCount > 0) {
        badge.innerText = pendingAdminCount;
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
}