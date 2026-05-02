/* ═══════════════════════════════════════════════════════════
   KOLLABHUB  —  ai.js
   Handles both floating panel and full-page AI functionality.
   ═══════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {
    // Floating Panel Elements
    const aiFab = document.getElementById('aiFab');
    const aiPanel = document.getElementById('aiPanel');
    const aiClose = document.getElementById('aiClose');
    const aiExpand = document.getElementById('aiExpand');
    const aiOverlay = document.getElementById('aiOverlay');
    const aiMessages = document.getElementById('aiMessages');
    const aiInput = document.getElementById('aiInput');
    const aiSend = document.getElementById('aiSend');

    // Page View Elements
    const aiPageMessages = document.getElementById('aiPageMessages');
    const aiPageInput = document.getElementById('aiPageInput');
    const aiPageSend = document.getElementById('aiPageSend');

    /* ── Floating Panel Logic ───────────────────────────────── */
    if (aiFab && aiPanel) {
        aiFab.addEventListener('click', () => {
            aiPanel.classList.add('visible');
            aiFab.classList.add('hidden');
        });

        if (aiClose) {
            aiClose.addEventListener('click', () => {
                aiPanel.classList.remove('visible');
                aiPanel.classList.remove('expanded');
                if (aiOverlay) aiOverlay.classList.remove('active');
                aiFab.classList.remove('hidden');
            });
        }

        if (aiExpand) {
            aiExpand.addEventListener('click', () => {
                aiPanel.classList.toggle('expanded');
                if (aiOverlay) aiOverlay.classList.toggle('active');
                aiExpand.setAttribute('title', aiPanel.classList.contains('expanded') ? 'Minimize' : 'Expand');
            });
        }

        if (aiOverlay) {
            aiOverlay.addEventListener('click', () => {
                aiPanel.classList.remove('expanded');
                aiOverlay.classList.remove('active');
            });
        }
        
        // Floating Send Logic
        if (aiSend && aiInput) {
            const handleFloatingSend = () => {
                const text = aiInput.value.trim();
                if (!text) return;
                aiInput.value = '';
                appendMessage(aiMessages, text, 'user');
                setTimeout(() => {
                    appendMessage(aiMessages, "I'm looking into that for you...", 'ai');
                }, 1000);
            };
            aiSend.addEventListener('click', handleFloatingSend);
            aiInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleFloatingSend(); });
        }
    }

    /* ── Page View Logic ────────────────────────────────────── */
    if (aiPageSend && aiPageInput) {
        const handlePageSend = () => {
            const text = aiPageInput.value.trim();
            if (!text) return;
            aiPageInput.value = '';
            appendMessage(aiPageMessages, text, 'user');
            setTimeout(() => {
                appendMessage(aiPageMessages, "I'm processing your request in full-page mode. How else can I help?", 'ai');
            }, 1000);
        };
        aiPageSend.addEventListener('click', handlePageSend);
        aiPageInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') handlePageSend(); });
    }

    /* ── Shared Helpers ─────────────────────────────────────── */
    function appendMessage(container, text, type) {
        if (!container) return;
        const msgDiv = document.createElement('div');
        msgDiv.className = `ai-msg ${type}`;
        
        // Use the appropriate bubble class based on container
        const isPage = container.id === 'aiPageMessages';
        const bubbleClass = isPage ? 'ai-page-bubble' : 'ai-msg-bubble';
        
        let avatarHtml = '';
        if (type === 'ai' && isPage) {
            avatarHtml = `
            <div class="ai-page-avatar">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 8V4H8" /><rect width="16" height="12" x="4" y="8" rx="2" /><path d="M2 14h2" /><path d="M20 14h2" /><path d="M15 13v2" /><path d="M9 13v2" />
                </svg>
            </div>`;
        }

        msgDiv.innerHTML = `
            ${avatarHtml}
            <div class="${bubbleClass}">${text}</div>
        `;
        container.appendChild(msgDiv);
        container.scrollTop = container.scrollHeight;
    }
});