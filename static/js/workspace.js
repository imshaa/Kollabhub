/* KOLLABHUB Workspace Management Logic */

document.addEventListener('DOMContentLoaded', () => {
    const createOverlay = document.getElementById('createOverlay');
    const joinOverlay   = document.getElementById('joinOverlay');

    function openCreateModal() {
        if (createOverlay) {
            createOverlay.classList.add('visible');
            document.body.style.overflow = 'hidden';
        }
    }

    function closeCreateModal() {
        if (createOverlay) {
            createOverlay.classList.remove('visible');
            document.body.style.overflow = '';
        }
    }

    function openJoinModal() {
        if (joinOverlay) {
            joinOverlay.classList.add('visible');
            document.body.style.overflow = 'hidden';
        }
    }

    function closeJoinModal() {
        if (joinOverlay) {
            joinOverlay.classList.remove('visible');
            document.body.style.overflow = '';
        }
    }

    // Header buttons
    const openCreateBtn = document.getElementById('openCreateBtn');
    if (openCreateBtn) openCreateBtn.addEventListener('click', openCreateModal);

    const openJoinBtn = document.getElementById('openJoinBtn');
    if (openJoinBtn) openJoinBtn.addEventListener('click', openJoinModal);

    // Modal internal buttons
    const createBackBtn = document.getElementById('createBackBtn');
    if (createBackBtn) createBackBtn.addEventListener('click', closeCreateModal);

    const createCancelBtn = document.getElementById('createCancelBtn');
    if (createCancelBtn) createCancelBtn.addEventListener('click', closeCreateModal);

    const joinCloseBtn = document.getElementById('joinCloseBtn');
    if (joinCloseBtn) joinCloseBtn.addEventListener('click', closeJoinModal);

    const joinCancelBtn = document.getElementById('joinCancelBtn');
    if (joinCancelBtn) joinCancelBtn.addEventListener('click', closeJoinModal);

    // Grid card for new users
    const createGridCard = document.getElementById('createGridCard');
    if (createGridCard) createGridCard.addEventListener('click', openCreateModal);

    // Click outside to close
    if (createOverlay) {
        createOverlay.addEventListener('click', e => {
            if (e.target === createOverlay) closeCreateModal();
        });
    }
    if (joinOverlay) {
        joinOverlay.addEventListener('click', e => {
            if (e.target === joinOverlay) closeJoinModal();
        });
    }

    // Permission card toggling
    document.querySelectorAll(".perm-card:not(.disabled)").forEach(card => {
        card.addEventListener("click", function () {
            document.querySelectorAll(".perm-card").forEach(c => c.classList.remove("active"));
            this.classList.add("active");
            const visibility = this.getAttribute("data-visibility");
            const visibilityInput = document.getElementById("visibilityInput");
            if (visibilityInput) visibilityInput.value = visibility;
        });
    });

    // Image preview helper
    function attachImagePreview(fileInputId, previewElementId) {
        const fileInput = document.getElementById(fileInputId);
        const previewEl = document.getElementById(previewElementId);
        if (!fileInput || !previewEl) return;

        fileInput.addEventListener('change', function() {
            const file = fileInput.files && fileInput.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = function(e) {
                if (previewEl.tagName.toLowerCase() === 'img') {
                    previewEl.src = e.target.result;
                } else {
                    previewEl.innerHTML = '<img src="' + e.target.result + '" alt="Preview" style="width:100%;height:100%;border-radius:inherit;object-fit:cover;" />';
                }
            };
            reader.readAsDataURL(file);
        });
    }

    attachImagePreview('workspaceImage', 'createWorkspaceImagePreview');

    // Escape key
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            closeJoinModal();
            closeCreateModal();
        }
    });

    // Error dismissal
    document.querySelectorAll('.error-wrapper').forEach(el => {
        setTimeout(() => {
            el.style.opacity = '0';
            el.style.transform = 'translateY(-10px)';
            setTimeout(() => el.remove(), 300);
        }, 4000);
    });
});
