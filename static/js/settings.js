/* SETTINGS PAGE LOGIC */

document.addEventListener('DOMContentLoaded', () => {
    // Tab Switching
    const navItems = document.querySelectorAll('.settings-nav-item[data-tab]');
    const tabPanels = document.querySelectorAll('.tab-panel');
    const workspaceId = document.getElementById('workspaceId')?.value;

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const targetTab = item.dataset.tab;

            // Update Nav
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');

            // Update Panels
            tabPanels.forEach(panel => {
                panel.classList.remove('active');
                if (panel.id === `${targetTab}-tab`) {
                    panel.classList.add('active');
                }
            });

            // Special logic for tabs
            if (targetTab === 'admin-members') {
                loadMembers();
                loadInvitations();
            }
        });
    });

    // --- Admin: Members Logic ---
    window.removeMember = async function(username) {
        if (!confirm(`Are you sure you want to remove ${username}?`)) return;
        try {
            const response = await fetch(`/workspace/${workspaceId}/remove-member/`, {
                method: 'POST',
                headers: {
                    'X-CSRFToken': getCSRFToken(),
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'X-Requested-With': 'XMLHttpRequest'
                },
                body: `username=${encodeURIComponent(username)}`
            });
            const data = await response.json();
            if (data.success) {
                showToast(data.message);
                loadMembers();
            } else {
                showToast(data.error, 'error');
            }
        } catch (err) {
            console.error('Error removing member:', err);
        }
    }

    async function loadMembers() {
        if (!workspaceId) return;
        const memberList = document.getElementById('memberList');
        const transferSelect = document.getElementById('transferSelect');
        if (!memberList) return;

        try {
            const response = await fetch(`/api/workspace/${workspaceId}/members/`);
            const data = await response.json();
            
            if (data.members) {
                memberList.innerHTML = data.members.map(member => `
                    <tr>
                        <td>
                            <div class="user-info-cell">
                                <div class="user-av-sm">
                                    ${member.avatar ? `<img src="${member.avatar}">` : member.display_name[0].toUpperCase()}
                                </div>
                                <div class="user-names">
                                    <span class="user-dn">${member.display_name}</span>
                                    <span class="user-un">@${member.username}</span>
                                </div>
                            </div>
                        </td>
                        <td><span class="role-badge ${member.role}">${member.role}</span></td>
                        <td><span class="status-indicator ${member.status}"></span> ${member.status}</td>
                        <td>
                            ${member.role !== 'admin' ? `
                                <button class="btn-icon-danger" onclick="removeMember('${member.username}')" title="Remove Member">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                                </button>
                            ` : ''}
                        </td>
                    </tr>
                `).join('');

                if (transferSelect) {
                    transferSelect.innerHTML = '<option value="">Select a member...</option>' + 
                        data.members.filter(m => m.role !== 'admin').map(m => `
                            <option value="${m.username}">${m.display_name} (@${m.username})</option>
                        `).join('');
                }
            }
        } catch (err) {
            console.error('Failed to load members:', err);
            memberList.innerHTML = '<tr><td colspan="4" class="error">Failed to load members.</td></tr>';
        }
    }

    async function loadInvitations() {
        if (!workspaceId) return;
        const invitationList = document.getElementById('invitationList');
        if (!invitationList) return;

        try {
            const response = await fetch(`/api/workspace/${workspaceId}/sent-invitations/`);
            const data = await response.json();
            
            if (data) {
                invitationList.innerHTML = data.map(inv => `
                    <tr>
                        <td>${inv.email || inv.username}</td>
                        <td>${inv.role}</td>
                        <td><span class="status-badge pending">Pending</span></td>
                        <td>
                             <button class="btn-icon-danger" onclick="revokeInvitation(${inv.id})" title="Revoke Invitation">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                            </button>
                        </td>
                    </tr>
                `).join('');
            }
        } catch (err) {
            console.error('Failed to load invitations:', err);
            invitationList.innerHTML = '<tr><td colspan="4" class="error">Failed to load invitations.</td></tr>';
        }
    }

    window.revokeInvitation = async function(id) {
        // We'll need a revoke API if it exists, otherwise skip for now.
        // Based on urls.py, I don't see a clear 'revoke' for sent-invitations, 
        // but there is 'api/invite/<int:invite_id>/revoke/'.
        if (!confirm('Revoke this invitation?')) return;
        try {
            const response = await fetch(`/api/invite/${id}/revoke/`, {
                method: 'POST',
                headers: { 'X-CSRFToken': getCSRFToken() }
            });
            if (response.ok) {
                showToast('Invitation revoked.');
                loadInvitations();
            }
        } catch (err) { console.error(err); }
    }

    const transferBtn = document.getElementById('transferBtn');
    if (transferBtn) {
        transferBtn.addEventListener('click', async () => {
            const target = document.getElementById('transferSelect').value;
            if (!target) return;
            if (!confirm(`Are you sure you want to transfer ownership to ${target}? This cannot be undone.`)) return;

            try {
                const response = await fetch(`/api/workspace/${workspaceId}/transfer-ownership/`, {
                    method: 'POST',
                    headers: { 'X-CSRFToken': getCSRFToken(), 'Content-Type': 'application/json' },
                    body: JSON.stringify({ target_username: target })
                });
                const data = await response.json();
                if (data.success) {
                    window.location.reload();
                } else {
                    showToast(data.error, 'error');
                }
            } catch (err) { console.error(err); }
        });
    }

    // --- Admin: Permissions Logic ---
    const saveAdminBtn = document.getElementById('saveAdminSettings');
    const workspaceImageInput = document.getElementById('workspaceImageInput');
    const workspaceImagePreview = document.getElementById('workspaceImagePreview');

    if (workspaceImageInput && workspaceImagePreview) {
        workspaceImageInput.addEventListener('change', () => {
            const file = workspaceImageInput.files && workspaceImageInput.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    workspaceImagePreview.innerHTML = `<img src="${e.target.result}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
                };
                reader.readAsDataURL(file);
            }
        });
    }

    if (saveAdminBtn) {
        saveAdminBtn.addEventListener('click', async () => {
            const title = document.getElementById('workspaceTitleInput')?.value;
            const visibility = document.querySelector('input[name="visibility"]:checked')?.value;
            const retention = document.getElementById('retentionSelect')?.value;
            const imageFile = workspaceImageInput?.files[0];

            const formData = new FormData();
            formData.append('title', title);
            formData.append('visibility', visibility);
            formData.append('message_retention_days', retention);
            if (imageFile) formData.append('fileUpload', imageFile);

            try {
                const response = await fetch(`/api/workspace/${workspaceId}/update-info/`, {
                    method: 'POST',
                    headers: {
                        'X-CSRFToken': getCSRFToken()
                    },
                    body: formData
                });

                if (response.ok) {
                    showToast('Workspace settings saved successfully!');
                    if (title) document.getElementById('workspaceTitle').value = title;
                } else {
                    const data = await response.json();
                    showToast(data.error || 'Failed to save settings.', 'error');
                }
            } catch (err) {
                console.error('Error saving admin settings:', err);
            }
        });
    }

    // --- Admin: Danger Logic ---
    const deleteBtn = document.getElementById('deleteWorkspaceBtn');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', async () => {
            const workspaceTitle = document.getElementById('workspaceTitle')?.value;
            const confirmName = prompt(`To delete this workspace, type its name: "${workspaceTitle}"`);
            
            if (confirmName === workspaceTitle) {
                try {
                    const response = await fetch(`/api/workspace/${workspaceId}/delete-workspace/`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-CSRFToken': getCSRFToken()
                        },
                        body: JSON.stringify({ title: workspaceTitle })
                    });

                    if (response.ok) {
                        window.location.href = '/workspace/';
                    } else {
                        showToast('Failed to delete workspace.', 'error');
                    }
                } catch (err) {
                    console.error('Error deleting workspace:', err);
                }
            } else if (confirmName !== null) {
                showToast('Workspace name did not match.', 'error');
            }
        });
    }

    const sendInviteBtn = document.getElementById('sendInviteBtn');
    if (sendInviteBtn) {
        sendInviteBtn.addEventListener('click', async () => {
            const identifiers = document.getElementById('inviteInput').value;
            const role = document.getElementById('inviteRole').value;
            if (!identifiers) return;

            try {
                const response = await fetch(`/api/workspace/${workspaceId}/send-invitation/`, {
                    method: 'POST',
                    headers: { 'X-CSRFToken': getCSRFToken(), 'Content-Type': 'application/json' },
                    body: JSON.stringify({ identifiers: identifiers, role: role })
                });
                const data = await response.json();
                if (data.success) {
                    showToast('Invitations sent!');
                    document.getElementById('inviteInput').value = '';
                    loadInvitations();
                } else {
                    showToast(data.error || 'Failed to send invitations', 'error');
                }
            } catch (err) { console.error(err); }
        });
    }

    // Helper: CSRF
    function getCSRFToken() {
        return document.querySelector('[name=csrfmiddlewaretoken]')?.value || '';
    }

    // Helper: Real Toast Notification
    function showToast(msg, type = 'success') {
        const existing = document.getElementById('settingsToast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.id = 'settingsToast';
        const isError = type === 'error';
        toast.style.cssText = `
            position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
            z-index: 99999; display: flex; align-items: center; gap: 10px;
            min-width: 260px; max-width: 440px; padding: 12px 18px;
            background: ${isError ? 'rgba(248,113,113,0.10)' : 'rgba(232,180,168,0.10)'};
            border: 1px solid ${isError ? 'rgba(248,113,113,0.4)' : 'rgba(232,180,168,0.4)'};
            border-radius: 12px; color: ${isError ? '#f87171' : '#E8B4A8'};
            font-size: 0.875rem; font-weight: 500; font-family: inherit;
            backdrop-filter: blur(12px); box-shadow: 0 8px 24px rgba(0,0,0,0.3);
            animation: settingsFadeIn 0.3s ease; pointer-events: none;
        `;
        toast.textContent = msg;
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transition = 'opacity 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, 3500);
    }

    // Status Selection
    const statusBtns = document.querySelectorAll('.status-btn');
    const statusInput = document.getElementById('statusInput');

    statusBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            statusBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            if (statusInput) statusInput.value = btn.dataset.status;
        });
    });

    // Avatar Preview
    const avatarInput = document.getElementById('profileAvatarInput');
    const avatarPreview = document.getElementById('profileAvatarImage');

    if (avatarInput && avatarPreview) {
        avatarInput.addEventListener('change', () => {
            const file = avatarInput.files && avatarInput.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (e) => {
                if (avatarPreview.tagName.toLowerCase() === 'img') {
                    avatarPreview.src = e.target.result;
                } else {
                    avatarPreview.innerHTML = `<img src="${e.target.result}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
                }
            };
            reader.readAsDataURL(file);
        });
    }

    // Error Dismissal
    const errorWrappers = document.querySelectorAll('.error-wrapper');
    errorWrappers.forEach(wrapper => {
        setTimeout(() => {
            wrapper.style.opacity = '0';
            wrapper.style.transform = 'translateY(-10px)';
            setTimeout(() => wrapper.remove(), 300);
        }, 5000);
    });
});
