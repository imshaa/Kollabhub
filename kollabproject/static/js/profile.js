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


// escape key closes any open modal
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (joinOverlay && joinOverlay.classList.contains('visible'))   closeJoinModal();
  if (createOverlay && createOverlay.classList.contains('visible')) closeCreateModal();
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
// polling to refresh profile avatar (and other details) every 5sec
// function refreshProfile() { ... }

/*
// previous behaviour – remove the automatic polling so the form is
// not overwritten while the user is editing.
// setInterval(refreshProfile, 5000);
// document.addEventListener('DOMContentLoaded', refreshProfile);
*/

// keep profile poll running so avatar and fields stay current
// setInterval(refreshProfile, 5000);
// ensure initial fetch
document.addEventListener('DOMContentLoaded', refreshProfile);

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