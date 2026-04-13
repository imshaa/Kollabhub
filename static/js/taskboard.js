/* ═══════════════════════════════════════════════════════════
   KOLLABHUB  —  taskboard.js   v3  (settings + full perms)
═══════════════════════════════════════════════════════════ */

/* ── DOM helpers ─────────────────────────────────────────── */
const $ = id => document.getElementById(id);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/* ── Read config from board header data-* attributes ──────── */
const BH = document.querySelector('.board-header');
const WORKSPACE_ID = BH?.dataset?.workspaceId  || '';
const IS_ADMIN     = BH?.dataset?.isAdmin      === 'true';

// Permissions from Django (re-evaluated live after settings save)
let PERMS = {
  createTasks:  BH?.dataset?.permCreateTasks  === 'true',
  editTasks:    BH?.dataset?.permEditTasks    === 'true',
  deleteTasks:  BH?.dataset?.permDeleteTasks  === 'true',
  moveTasks:    BH?.dataset?.permMoveTasks    === 'true',
  createLists:  BH?.dataset?.permCreateLists  === 'true',
  editLists:    BH?.dataset?.permEditLists    === 'true',
  deleteLists:  BH?.dataset?.permDeleteLists  === 'true',
  attach:       BH?.dataset?.permAttach       === 'true',
  comment:      BH?.dataset?.permComment      === 'true',
};

// Feature flags
let FEAT = {
  priorities:  BH?.dataset?.featPriorities  === 'true',
  assignees:   BH?.dataset?.featAssignees   === 'true',
  attachments: BH?.dataset?.featAttachments === 'true',
  comments:    BH?.dataset?.featComments    === 'true',
  desc:        BH?.dataset?.featDesc        === 'true',
};

const ATTACH_SIZE_LIMITS = {
  image:    1  * 1024 * 1024,
  video:   25 * 1024 * 1024,
  document:20 * 1024 * 1024,
};
const ATTACH_COUNT_LIMITS = {
  image: 10,
  video: 5,
  document: 5,
  link: 5,
};

// Workspace members
let MEMBERS = [];
try { const r = $('workspaceMembersData'); if (r) MEMBERS = JSON.parse(r.textContent); } catch {}

/* ── CSRF + fetch wrapper ─────────────────────────────────── */
function getCSRF() {
  for (let c of document.cookie.split(';')) {
    c = c.trim();
    if (c.startsWith('csrftoken=')) return c.slice('csrftoken='.length);
  }
  return '';
}

async function api(url, method = 'GET', body = null) {
  const opts = {
    method, credentials: 'same-origin',
    headers: { 'X-CSRFToken': getCSRF(), 'X-Requested-With': 'XMLHttpRequest' },
  };
  if (body && !(body instanceof FormData)) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  } else if (body) {
    opts.body = body;
  }
  const res  = await fetch(url, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

/* ── Utility ──────────────────────────────────────────────── */
function avatarColor(name = '') {
  const p = [
    'linear-gradient(135deg,#f4856a,#e05a7d)',
    'linear-gradient(135deg,#60a5fa,#3b82f6)',
    'linear-gradient(135deg,#34d399,#059669)',
    'linear-gradient(135deg,#a78bfa,#7c3aed)',
    'linear-gradient(135deg,#fbbf24,#d97706)',
  ];
  let h = 0;
  for (const c of name) h = c.charCodeAt(0) + ((h << 5) - h);
  return p[Math.abs(h) % p.length];
}
function initials(name='') { return name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2); }
function escHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function fmtDate(iso) { return new Date(iso).toLocaleDateString([],{month:'short',day:'numeric',year:'numeric'}); }
function fmtTime(iso) { return new Date(iso).toLocaleString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}); }
function fmtBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b/1024).toFixed(1)+' KB';
  return (b/1048576).toFixed(1)+' MB';
}

/* ── State ────────────────────────────────────────────────── */
let lists          = [];
let tasks          = [];
let boardSettings  = {};
let activeFilter   = 'all';
let activeAssignee = '';
let searchQuery    = '';
let openTaskId     = null;
let selPriority    = 'medium';
let selColColor    = '#60a5fa';
let colEditMode    = 'add';
let colEditId      = null;
let taskSocket;

function sortListsByPosition() {
  lists.sort((a, b) => (a.position || 0) - (b.position || 0));
}

function upsertList(list) {
  const normalizedId = Number(list.id);
  const idx = lists.findIndex(l => Number(l.id) === normalizedId);
  if (idx === -1) {
    lists.push(list);
  } else {
    lists[idx] = list;
  }
  sortListsByPosition();
}

function upsertTask(task) {
  const normalizedId = Number(task.id);
  const idx = tasks.findIndex(t => Number(t.id) === normalizedId);
  if (idx === -1) {
    tasks.push(task);
  } else {
    tasks[idx] = task;
  }
}

function removeTaskById(taskId) {
  const normalizedId = Number(taskId);
  tasks = tasks.filter(t => Number(t.id) !== normalizedId);
  if (openTaskId && Number(openTaskId) === normalizedId) {
    closeTaskDetail();
  }
}

function removeListById(listId) {
  lists = lists.filter(l => l.id !== listId);
  const removedTask = tasks.some(t => t.task_list_id === listId);
  tasks = tasks.filter(t => t.task_list_id !== listId);
  if (removedTask && openTaskId && !tasks.some(t => t.id === openTaskId)) {
    closeTaskDetail();
  }
}

function upsertComment(taskId, comment) {
  const task = tasks.find(t => t.id === taskId);
  if (!task) return;
  task.comments = task.comments || [];
  const idx = task.comments.findIndex(c => c.id === comment.id);
  if (idx === -1) {
    task.comments.push(comment);
  } else {
    task.comments[idx] = comment;
  }
}

function applyTaskboardSettings(settings) {
  boardSettings = settings;

  PERMS.createTasks = IS_ADMIN || settings.who_can_create_tasks === 'all_members';
  PERMS.editTasks   = IS_ADMIN || settings.who_can_edit_tasks === 'all_members';
  PERMS.deleteTasks = IS_ADMIN || settings.who_can_delete_tasks === 'all_members';
  PERMS.moveTasks   = IS_ADMIN || settings.who_can_move_tasks === 'all_members';
  PERMS.createLists = IS_ADMIN || settings.who_can_create_lists === 'all_members';
  PERMS.editLists   = IS_ADMIN || settings.who_can_edit_lists === 'all_members';
  PERMS.deleteLists = IS_ADMIN || settings.who_can_delete_lists === 'all_members';
  PERMS.attach      = IS_ADMIN || settings.who_can_attach_files === 'all_members';
  PERMS.comment     = IS_ADMIN || settings.who_can_comment === 'all_members';

  FEAT.priorities  = !!settings.allow_task_priorities;
  FEAT.assignees   = !!settings.allow_task_assignees;
  FEAT.attachments = !!settings.allow_attachments;
  FEAT.comments    = !!settings.allow_comments;
  FEAT.desc        = !!settings.allow_task_desc;

  const btn = $('addTaskBtn');
  if (btn) {
    btn.style.display = PERMS.createTasks ? '' : 'none';
  } else if (PERMS.createTasks) {
    const headerRight = document.querySelector('.board-header-right');
    if (headerRight) {
      const addBtn = document.createElement('button');
      addBtn.className = 'btn-accent';
      addBtn.id = 'addTaskBtn';
      addBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Add Task`;
      addBtn.addEventListener('click', () => openAddTaskModal());
      headerRight.insertBefore(addBtn, headerRight.firstChild);
    }
  }

  renderBoard();
  if (openTaskId) {
    openTaskDetail(openTaskId);
  }
}

function handleTaskboardEvent(event) {
  if (!event || typeof event !== 'object') return;
  if (event.notification && window.NotificationManager) {
    window.NotificationManager.handleNotificationEvent(event);
  }
  if (!event.object) {
    return;
  }
  if (event.object === 'list') {
    if (event.action === 'delete') {
      removeListById(event.list_id);
    } else {
      upsertList(event.list);
    }
    renderBoard();
    buildAssigneeFilterList();
    return;
  }
  if (event.object === 'task') {
    if (event.action === 'delete') {
      removeTaskById(event.task_id);
    } else {
      upsertTask(event.task);
    }
    renderBoard();
    buildAssigneeFilterList();
    if (openTaskId && event.action !== 'delete' && Number(event.task?.id) === Number(openTaskId)) {
      openTaskDetail(openTaskId);
    }
    return;
  }
  if (event.object === 'comment') {
    if (event.action === 'create') {
      upsertComment(event.task_id, event.comment);
      if (Number(openTaskId) === Number(event.task_id)) {
        renderComments(tasks.find(t => Number(t.id) === Number(openTaskId)));
      }
    }
    return;
  }
  if (event.object === 'settings' && event.event_type === 'settings_update') {
    applyTaskboardSettings(event.settings);
    showToast('Board settings were updated', 'success');
    return;
  }
}

function initTaskboardSocket() {
  if (!WORKSPACE_ID) return;
  const wsScheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const socketUrl = `${wsScheme}://${window.location.host}/ws/taskboard/${WORKSPACE_ID}/`;
  try {
    taskSocket = new WebSocket(socketUrl);
  } catch (error) {
    console.error('Taskboard WebSocket creation failed:', error);
    return;
  }

  taskSocket.addEventListener('open', () => {
    console.info('Taskboard WebSocket connected', socketUrl);
  });
  taskSocket.addEventListener('message', event => {
    try {
      const data = JSON.parse(event.data);
      handleTaskboardEvent(data);
    } catch (err) {
      console.warn('Invalid taskboard socket message:', err, event.data);
    }
  });
  taskSocket.addEventListener('close', e => {
    console.warn('Taskboard WebSocket closed:', e.code, e.reason);
  });
  taskSocket.addEventListener('error', err => {
    console.error('Taskboard WebSocket error:', err);
  });
}

/* ══════════════════════════════════════════════════════════
   LOAD
══════════════════════════════════════════════════════════ */
async function loadAll() {
  try {
    const [lData, tData] = await Promise.all([
      api(`/api/workspace/${WORKSPACE_ID}/lists/`),
      api(`/api/workspace/${WORKSPACE_ID}/tasks/`),
    ]);
    lists         = lData.lists;
    boardSettings = lData.settings || {};
    tasks         = tData.tasks;
    renderBoard();
    buildAssigneeFilterList();
    initTaskboardSocket();
    if (window.NotificationManager) {
      window.NotificationManager.markRead('taskboard');
    }
  } catch(err) {
    showBoardError('Could not load board. ' + err.message);
  }
}

/* ══════════════════════════════════════════════════════════
   BOARD SETTINGS MODAL
══════════════════════════════════════════════════════════ */
const PERM_FIELDS = [
  'who_can_create_tasks','who_can_edit_tasks','who_can_delete_tasks','who_can_move_tasks',
  'who_can_create_lists','who_can_edit_lists','who_can_delete_lists',
  'who_can_attach_files','who_can_comment',
];
const BOOL_FIELDS = [
  'allow_task_priorities','allow_task_assignees','allow_task_desc',
  'allow_attachments','allow_comments',
  'notify_on_task_create','notify_on_task_done','notify_on_comment','notify_on_assign',
];
const INT_FIELDS = ['max_lists','max_tasks_per_list'];

function openBoardSettings() {
  // Load fresh settings then populate
  api(`/api/workspace/${WORKSPACE_ID}/taskboard-settings/`)
    .then(data => {
      boardSettings = data.settings;
      populateBoardSettings(data.settings);
      $('boardSettingsOverlay').classList.add('visible');
    })
    .catch(err => showToast('Could not load settings: ' + err.message, 'error'));
}

function populateBoardSettings(s) {
  // Permission selects
  PERM_FIELDS.forEach(f => {
    const el = document.querySelector(`.bset-select[data-field="${f}"]`);
    if (el) el.value = s[f] || 'all_members';
  });
  // Bool toggles
  BOOL_FIELDS.forEach(f => {
    const el = document.querySelector(`.bset-toggle[data-field="${f}"]`);
    if (el) el.classList.toggle('active', !!s[f]);
  });
  // Int inputs
  INT_FIELDS.forEach(f => {
    const el = document.querySelector(`.bset-number[data-field="${f}"]`);
    if (el) el.value = s[f] ?? 0;
  });
  // Last saved
  $('bsetLastSaved').textContent = s.updated_at
    ? `Last saved ${fmtTime(s.updated_at)}${s.updated_by ? ' by ' + s.updated_by : ''}`
    : '';
}

function closeBoardSettings() { $('boardSettingsOverlay').classList.remove('visible'); }

// Tab switching inside settings modal
$$('.bset-nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.bset-nav-item').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    $$('.bset-panel').forEach(p => p.classList.remove('active'));
    $(`bset-tab-${tab}`)?.classList.add('active');
  });
});

// Toggle buttons
$$('.bset-toggle').forEach(btn => {
  btn.addEventListener('click', () => btn.classList.toggle('active'));
});

// Save
$('boardSettingsSaveBtn')?.addEventListener('click', async () => {
  const payload = {};
  PERM_FIELDS.forEach(f => {
    const el = document.querySelector(`.bset-select[data-field="${f}"]`);
    if (el) payload[f] = el.value;
  });
  BOOL_FIELDS.forEach(f => {
    const el = document.querySelector(`.bset-toggle[data-field="${f}"]`);
    if (el) payload[f] = el.classList.contains('active');
  });
  INT_FIELDS.forEach(f => {
    const el = document.querySelector(`.bset-number[data-field="${f}"]`);
    if (el) payload[f] = parseInt(el.value, 10) || 0;
  });

  const btn = $('boardSettingsSaveBtn');
  btn.disabled = true; btn.textContent = 'Saving…';

  try {
    const data = await api(`/api/workspace/${WORKSPACE_ID}/taskboard-settings/update/`, 'POST', payload);
    boardSettings = data.settings;
    $('bsetLastSaved').textContent = `Saved ${fmtTime(data.settings.updated_at)}`;
    showToast('Board settings saved', 'success');

    // Update local FEAT flags so board reflects changes immediately
    FEAT.priorities  = data.settings.allow_task_priorities;
    FEAT.assignees   = data.settings.allow_task_assignees;
    FEAT.attachments = data.settings.allow_attachments;
    FEAT.comments    = data.settings.allow_comments;
    FEAT.desc        = data.settings.allow_task_desc;

    // Re-render board to reflect new feature flags
    renderBoard();
    setTimeout(closeBoardSettings, 600);
  } catch(err) {
    showToast('Save failed: ' + err.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Save Settings';
  }
});

$('boardSettingsBtn')?.addEventListener('click', openBoardSettings);
$('boardSettingsCloseBtn')?.addEventListener('click', closeBoardSettings);
$('boardSettingsCancelBtn')?.addEventListener('click', closeBoardSettings);
$('boardSettingsOverlay')?.addEventListener('click', e => { if (e.target === $('boardSettingsOverlay')) closeBoardSettings(); });

/* ══════════════════════════════════════════════════════════
   RENDER BOARD
══════════════════════════════════════════════════════════ */
function renderBoard() {
  const kanban = $('kanban');
  kanban.innerHTML = '';

  lists.forEach((col, ci) => {
    const colTasks   = tasks.filter(t => t.task_list_id === col.id && !isHidden(t));
    const totalCount = tasks.filter(t => t.task_list_id === col.id).length;

    const colEl = document.createElement('div');
    colEl.className = 'kanban-col';
    colEl.style.animationDelay = `${ci * 0.06}s`;

    let headerActions = '';
    if (PERMS.editLists || PERMS.deleteLists) {
      const editBtn   = PERMS.editLists   ? `<button class="col-btn rename-col-btn" data-col-id="${col.id}" title="Edit list"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>` : '';
      const deleteBtn = PERMS.deleteLists && !col.is_default ? `<button class="col-btn delete-col-btn" data-col-id="${col.id}" title="Delete list"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button>` : '';
      headerActions = `<div class="col-header-actions">${editBtn}${deleteBtn}</div>`;
    }

    colEl.innerHTML = `
      <div class="kanban-col-header">
        <div class="col-title-row">
          <div class="col-dot" style="background:${col.color}"></div>
          <span class="col-name">${escHtml(col.name)}</span>
          <span class="col-count">${totalCount}</span>
        </div>
        ${headerActions}
      </div>
      <div class="kanban-cards" id="cards-${col.id}"></div>
      ${PERMS.createTasks ? `<button class="add-card-btn" data-col-id="${col.id}">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Add task
      </button>` : ''}
    `;
    kanban.appendChild(colEl);

    // Cards
    const cardsEl = $(`cards-${col.id}`);
    colTasks.forEach((task, ti) => cardsEl.appendChild(buildCard(task, ti)));

    // Bind
    colEl.querySelector('.rename-col-btn')?.addEventListener('click', e => { e.stopPropagation(); openColModal('rename', col.id); });
    colEl.querySelector('.delete-col-btn')?.addEventListener('click', async e => {
      e.stopPropagation();
      if (!confirm(`Delete list "${col.name}"? All tasks inside will also be deleted.`)) return;
      try {
        await api(`/api/workspace/${WORKSPACE_ID}/lists/${col.id}/delete/`, 'POST');
        lists = lists.filter(l => l.id !== col.id);
        tasks = tasks.filter(t => t.task_list_id !== col.id);
        renderBoard();
        showToast('List deleted', 'success');
      } catch(err) { showToast(err.message, 'error'); }
    });
    colEl.querySelector('.add-card-btn')?.addEventListener('click', () => openAddTaskModal(col.id));
  });

  // Add new list tile
  if (PERMS.createLists) {
    const addColEl = document.createElement('div');
    addColEl.className = 'kanban-add-col';
    addColEl.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg><span>Add New List</span>`;
    addColEl.addEventListener('click', () => openColModal('add'));
    kanban.appendChild(addColEl);
  }
}

/* ── Card ─────────────────────────────────────────────────── */
function buildCard(task, index = 0) {
  const card = document.createElement('div');
  card.className = 'task-card' + (task.complete ? ' complete' : '');
  card.dataset.id = task.id;
  card.style.animationDelay = `${index * 0.04}s`;
  const aName    = task.assignee_display || '';
  const hasDesc  = task.description?.trim();
  const attCount = task.attachments?.length || 0;

  card.innerHTML = `
    <div class="task-card-top">
      <div class="task-card-title">${escHtml(task.title)}</div>
      <button class="task-complete-btn" title="${task.complete ? 'Mark incomplete' : 'Mark complete'}">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
      </button>
    </div>
    ${FEAT.desc && hasDesc ? `<div class="task-card-desc">${escHtml(task.description)}</div>` : ''}
    <div class="task-card-footer">
      <div class="task-card-badges">
        ${FEAT.priorities ? `<span class="task-priority ${task.priority}">${task.priority}</span>` : ''}
        ${FEAT.attachments && attCount > 0 ? `<span class="task-attach-badge"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>${attCount}</span>` : ''}
      </div>
      ${FEAT.assignees && aName
        ? `<div class="task-assignee-av" style="background:${avatarColor(aName)}" title="${escHtml(aName)}">${initials(aName)}</div>`
        : (FEAT.assignees ? `<div class="task-assignee-av" style="background:var(--border)" title="Unassigned">?</div>` : '')}
    </div>`;

  card.querySelector('.task-complete-btn').addEventListener('click', e => { e.stopPropagation(); toggleComplete(task.id); });
  card.addEventListener('click', () => openTaskDetail(task.id));
  return card;
}

/* ══════════════════════════════════════════════════════════
   FILTERS
══════════════════════════════════════════════════════════ */
function isHidden(task) {
  if (activeFilter === 'high'       && task.priority !== 'high')   return true;
  if (activeFilter === 'medium'     && task.priority !== 'medium') return true;
  if (activeFilter === 'low'        && task.priority !== 'low')    return true;
  if (activeFilter === 'complete'   && !task.complete)             return true;
  if (activeFilter === 'incomplete' && task.complete)              return true;
  if (activeAssignee && (task.assignee_display || '') !== activeAssignee) return true;
  if (searchQuery && !task.title.toLowerCase().includes(searchQuery.toLowerCase())) return true;
  return false;
}

function applyFilters() {
  $$('.task-card').forEach(card => {
    const task = tasks.find(t => t.id === parseInt(card.dataset.id));
    if (task) card.classList.toggle('hidden', isHidden(task));
  });
  lists.forEach(col => {
    const el = $(`cards-${col.id}`)?.closest('.kanban-col')?.querySelector('.col-count');
    if (el) el.textContent = tasks.filter(t => t.task_list_id === col.id).length;
  });
  const active = activeFilter !== 'all' || activeAssignee || searchQuery;
  $('filterActiveDot').classList.toggle('visible', !!active);
}

function buildAssigneeFilterList() {
  const list = $('assigneeFilterList');
  if (!list) return;
  list.innerHTML = '';
  const allBtn = document.createElement('button');
  allBtn.className = 'filter-assignee-opt active'; allBtn.dataset.member = '';
  allBtn.innerHTML = `<div class="filter-assignee-av" style="background:var(--surface2,#2a2a3e);border:1px solid var(--border)"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg></div>All Members<span class="filter-assignee-check">✓</span>`;
  list.appendChild(allBtn);
  MEMBERS.forEach(m => {
    const btn = document.createElement('button');
    btn.className = 'filter-assignee-opt'; btn.dataset.member = m.display;
    btn.innerHTML = `<div class="filter-assignee-av" style="background:${avatarColor(m.display)}">${initials(m.display)}</div>${escHtml(m.display)}<span class="filter-assignee-check">✓</span>`;
    list.appendChild(btn);
  });
  list.querySelectorAll('.filter-assignee-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      list.querySelectorAll('.filter-assignee-opt').forEach(b => b.classList.remove('active'));
      btn.classList.add('active'); activeAssignee = btn.dataset.member; applyFilters();
    });
  });
}

$('filterIconBtn').addEventListener('click', e => {
  e.stopPropagation(); $('filterDropdown').classList.toggle('open');
  $('filterIconBtn').classList.toggle('active', $('filterDropdown').classList.contains('open'));
});
document.addEventListener('click', e => {
  if (!$('filterDropdownWrap').contains(e.target)) {
    $('filterDropdown').classList.remove('open'); $('filterIconBtn').classList.remove('active');
  }
});
$$('.filter-opt').forEach(opt => {
  opt.addEventListener('click', () => {
    $$('.filter-opt').forEach(o => o.classList.remove('active'));
    opt.classList.add('active'); activeFilter = opt.dataset.filter; applyFilters();
  });
});
$('filterClearBtn').addEventListener('click', () => {
  activeFilter = 'all'; activeAssignee = ''; searchQuery = ''; $('searchInput').value = '';
  $$('.filter-opt').forEach(o => o.classList.toggle('active', o.dataset.filter === 'all'));
  $$('.filter-assignee-opt').forEach(b => b.classList.toggle('active', b.dataset.member === ''));
  applyFilters();
});
$('searchInput').addEventListener('input', e => { searchQuery = e.target.value; applyFilters(); });

/* ══════════════════════════════════════════════════════════
   SELECT HELPERS
══════════════════════════════════════════════════════════ */
function populateListSelect(el, selectedId) {
  el.innerHTML = '';
  lists.forEach(l => {
    const o = document.createElement('option');
    o.value = l.id; o.textContent = l.name;
    if (selectedId && l.id === selectedId) o.selected = true;
    el.appendChild(o);
  });
}
function populateMemberSelect(el, selectedId) {
  el.innerHTML = '<option value="">Unassigned</option>';
  MEMBERS.forEach(m => {
    const o = document.createElement('option');
    o.value = m.id; o.textContent = m.display;
    if (selectedId && m.id === selectedId) o.selected = true;
    el.appendChild(o);
  });
}

/* ══════════════════════════════════════════════════════════
   COLUMN MODAL
══════════════════════════════════════════════════════════ */
function openColModal(mode, colId = null) {
  colEditMode = mode; colEditId = colId;
  const existing = colId ? lists.find(l => l.id === colId) : null;
  $('colModalTitle').textContent = mode === 'rename' ? 'Edit List' : 'Add New List';
  $('colSaveBtn').textContent    = mode === 'rename' ? 'Save'      : 'Create List';
  $('colNameInput').value        = existing?.name || '';
  $('colNameErr').textContent    = '';
  selColColor = existing?.color || '#60a5fa';
  $$('.color-dot').forEach(d => d.classList.toggle('active', d.dataset.color === selColColor));
  $('colOverlay').classList.add('visible');
  setTimeout(() => $('colNameInput').focus(), 80);
}
function closeColModal() { $('colOverlay').classList.remove('visible'); }

$('colCloseBtn').addEventListener('click', closeColModal);
$('colCancelBtn').addEventListener('click', closeColModal);
$('colOverlay').addEventListener('click', e => { if (e.target === $('colOverlay')) closeColModal(); });
$$('.color-dot').forEach(dot => {
  dot.addEventListener('click', () => {
    $$('.color-dot').forEach(d => d.classList.remove('active'));
    dot.classList.add('active'); selColColor = dot.dataset.color;
  });
});

$('colSaveBtn').addEventListener('click', async () => {
  const name = $('colNameInput').value.trim();
  if (!name) { $('colNameErr').textContent = 'List name is required'; return; }
  $('colSaveBtn').disabled = true; $('colSaveBtn').textContent = 'Saving…';
  try {
    if (colEditMode === 'add') {
      await api(`/api/workspace/${WORKSPACE_ID}/lists/create/`, 'POST', { name, color: selColColor });
      showToast('List created', 'success');
    } else {
      const data = await api(`/api/workspace/${WORKSPACE_ID}/lists/${colEditId}/update/`, 'PATCH', { name, color: selColColor });
      const idx = lists.findIndex(l => l.id === colEditId);
      if (idx > -1) lists[idx] = data.list;
      showToast('List updated', 'success');
    }
    closeColModal(); renderBoard(); buildAssigneeFilterList();
  } catch(err) {
    $('colNameErr').textContent = err.message;
  } finally {
    $('colSaveBtn').disabled = false;
    $('colSaveBtn').textContent = colEditMode === 'add' ? 'Create List' : 'Save';
  }
});

/* ══════════════════════════════════════════════════════════
   ADD TASK MODAL
══════════════════════════════════════════════════════════ */
function openAddTaskModal(defaultListId = null) {
  populateListSelect($('newTaskCol'), defaultListId || lists[0]?.id);
  populateMemberSelect($('newTaskAssignee'), null);
  $('newTaskTitle').value = ''; $('newTaskDesc').value = '';
  $('newTaskTitleErr').textContent = '';
  selPriority = 'medium';
  $$('.priority-opt').forEach(b => b.classList.toggle('active', b.dataset.p === 'medium'));
  // Show/hide optional sections
  $('newTaskDescGroup').style.display     = FEAT.desc        ? '' : 'none';
  $('newTaskAssigneeGroup').style.display = FEAT.assignees   ? '' : 'none';
  $('newTaskPriorityGroup').style.display = FEAT.priorities  ? '' : 'none';
  $('addTaskOverlay').classList.add('visible');
  setTimeout(() => $('newTaskTitle').focus(), 80);
}
function closeAddTaskModal() { $('addTaskOverlay').classList.remove('visible'); }

$('addTaskBtn')?.addEventListener('click', () => openAddTaskModal());
$('addTaskCloseBtn').addEventListener('click', closeAddTaskModal);
$('addTaskCancelBtn').addEventListener('click', closeAddTaskModal);
$('addTaskOverlay').addEventListener('click', e => { if (e.target === $('addTaskOverlay')) closeAddTaskModal(); });
$$('.priority-opt').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.priority-opt').forEach(b => b.classList.remove('active'));
    btn.classList.add('active'); selPriority = btn.dataset.p;
  });
});

$('addTaskSaveBtn').addEventListener('click', async () => {
  const title = $('newTaskTitle').value.trim();
  if (!title) { $('newTaskTitleErr').textContent = 'Task title is required'; $('newTaskTitle').focus(); return; }
  const btn = $('addTaskSaveBtn');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const aid  = $('newTaskAssignee').value;
    const data = await api(`/api/workspace/${WORKSPACE_ID}/tasks/create/`, 'POST', {
      title,
      description:  FEAT.desc       ? $('newTaskDesc').value.trim() : '',
      task_list_id: parseInt($('newTaskCol').value, 10),
      priority:     FEAT.priorities ? selPriority : 'medium',
      assignee_id:  FEAT.assignees && aid ? parseInt(aid, 10) : null,
    });
    closeAddTaskModal();
    showToast('Task created', 'success');
    // UI will update via WebSocket event to avoid duplicate tasks from both REST response and socket event
  } catch(err) {
    $('newTaskTitleErr').textContent = err.message;
  } finally {
    btn.disabled = false; btn.textContent = 'Add Task';
  }
});

/* ══════════════════════════════════════════════════════════
   TOGGLE COMPLETE
══════════════════════════════════════════════════════════ */
async function toggleComplete(taskId) {
  const task = tasks.find(t => t.id === taskId);
  if (!task) return;
  if (!PERMS.moveTasks && !PERMS.editTasks) { showToast('You don\'t have permission to change task status.', 'error'); return; }
  task.complete = !task.complete;
  const card = document.querySelector(`.task-card[data-id="${taskId}"]`);
  if (card) card.classList.toggle('complete', task.complete);
  if (openTaskId === taskId) syncDetailComplete(task);
  try {
    const data = await api(`/api/workspace/${WORKSPACE_ID}/tasks/${taskId}/update/`, 'PATCH', { complete: task.complete });
    Object.assign(task, data.task);
  } catch(err) {
    task.complete = !task.complete;
    if (card) card.classList.toggle('complete', task.complete);
    if (openTaskId === taskId) syncDetailComplete(task);
    showToast(err.message, 'error');
  }
}

/* ══════════════════════════════════════════════════════════
   TASK DETAIL MODAL
══════════════════════════════════════════════════════════ */
function openTaskDetail(taskId) {
  const task = tasks.find(t => t.id === taskId);
  if (!task) return;
  openTaskId = taskId;

  const col = lists.find(l => l.id === task.task_list_id);
  $('detailColLabel').textContent       = col?.name || '—';
  $('detailColLabel').style.borderLeft  = `3px solid ${col?.color || '#888'}`;
  $('detailColLabel').style.paddingLeft = '8px';

  // Priority badge
  if (FEAT.priorities) {
    const pb = $('detailPriority');
    pb.textContent = task.priority; pb.className = `task-priority-badge ${task.priority}`;
    $('detailPriorityBlock').style.display = '';
  } else {
    $('detailPriority').textContent = '';
    $('detailPriorityBlock').style.display = 'none';
  }

  // Title
  $('detailTitle').textContent       = task.title;
  $('detailTitle').contentEditable   = PERMS.editTasks ? 'true' : 'false';

  syncDetailComplete(task);

  // Description
  $('detailDescSection').style.display = FEAT.desc ? '' : 'none';
  if (FEAT.desc) {
    $('detailDesc').value    = task.description || '';
    $('detailDesc').disabled = !PERMS.editTasks;
  }

  // Attachments
  $('detailAttachSection').style.display = FEAT.attachments ? '' : 'none';
  if (FEAT.attachments) { renderAttachments(task); }

  // Comments
  $('detailCommentSection').style.display = FEAT.comments ? '' : 'none';
  if (FEAT.comments) {
    renderComments(task);
    $('commentInputWrap').style.display = PERMS.comment ? '' : 'none';
  }

  // Assignee
  $('detailAssigneeBlock').style.display = FEAT.assignees ? '' : 'none';
  if (FEAT.assignees) {
    populateMemberSelect($('detailAssignee'), task.assignee_id);
    $('detailAssignee').disabled = !PERMS.editTasks;
    const av = $('detailAssigneeAv');
    const an = task.assignee_display || '';
    av.style.background = an ? avatarColor(an) : 'var(--border)';
    av.textContent = an ? initials(an) : '?';
  }

  // Priority chips
  $$('.priority-chip').forEach(c => {
    c.classList.toggle('active', c.dataset.p === task.priority);
    c.disabled = !PERMS.editTasks || !FEAT.priorities;
  });

  // List select (anyone who can move can change this)
  populateListSelect($('detailCol'), task.task_list_id);
  $('detailCol').disabled = !PERMS.moveTasks;

  // Status
  const s = $('detailStatus');
  s.textContent = task.complete ? '✓ Complete' : '○ Incomplete';
  s.className   = `detail-status ${task.complete ? 'complete' : 'incomplete'}`;

  $('detailCreated').textContent = fmtDate(task.created_at);
  $('sidebarCompleteBtnLabel').textContent = task.complete ? 'Mark Incomplete' : 'Mark Complete';
  $('sidebarCompleteBtn').classList.toggle('done', task.complete);

  // Show save/delete based on perms
  $('detailSaveBtn').style.display   = (PERMS.editTasks || PERMS.moveTasks) ? '' : 'none';
  $('detailDeleteBtn').style.display = PERMS.deleteTasks ? '' : 'none';

  // Attachment upload bar
  if (FEAT.attachments) {
    $('attachTypeBar').style.display = PERMS.attach ? '' : 'none';
  }

  $('taskDetailOverlay').classList.add('visible');
}

async function saveTaskDetail() {
  if (!openTaskId) return;
  const task = tasks.find(t => t.id === openTaskId);
  if (!task) return;
  const btn = $('detailSaveBtn');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const payload = {
      task_list_id: parseInt($('detailCol').value, 10),
      complete:     task.complete,
    };
    if (PERMS.editTasks) {
      payload.title       = $('detailTitle').textContent.trim() || task.title;
      if (FEAT.desc)        payload.description = $('detailDesc').value.trim();
      if (FEAT.priorities)  payload.priority    = $$('.priority-chip').find(c => c.classList.contains('active'))?.dataset.p || task.priority;
      if (FEAT.assignees) {
        const aid = $('detailAssignee').value;
        payload.assignee_id = aid ? parseInt(aid, 10) : null;
      }
    }
    const data = await api(`/api/workspace/${WORKSPACE_ID}/tasks/${openTaskId}/update/`, 'PATCH', payload);
    Object.assign(task, data.task);
    renderBoard();
    showToast('Saved!', 'success');
  } catch(err) {
    showToast('Save failed: ' + err.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Save Changes';
  }
}

function closeTaskDetail() {
  openTaskId = null;
  $('taskDetailOverlay').classList.remove('visible');
  $('attachLinkRow').style.display = 'none';
}

$('taskDetailCloseBtn').addEventListener('click', closeTaskDetail);
$('taskDetailOverlay').addEventListener('click', e => { if (e.target === $('taskDetailOverlay')) closeTaskDetail(); });
$('detailSaveBtn').addEventListener('click', saveTaskDetail);

function syncDetailComplete(task) {
  $('detailCompleteBtn').classList.toggle('done', task.complete);
  $('detailTitle').classList.toggle('complete', task.complete);
  $('sidebarCompleteBtnLabel').textContent = task.complete ? 'Mark Incomplete' : 'Mark Complete';
  $('sidebarCompleteBtn').classList.toggle('done', task.complete);
  const s = $('detailStatus');
  if (s) { s.textContent = task.complete ? '✓ Complete' : '○ Incomplete'; s.className = `detail-status ${task.complete ? 'complete' : 'incomplete'}`; }
}

$('detailCompleteBtn').addEventListener('click', () => { if (openTaskId) toggleComplete(openTaskId); });
$('sidebarCompleteBtn').addEventListener('click', () => { if (openTaskId) toggleComplete(openTaskId); });

$$('.priority-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    if (!PERMS.editTasks || !FEAT.priorities) return;
    const task = tasks.find(t => t.id === openTaskId);
    if (!task) return;
    task.priority = chip.dataset.p;
    $$('.priority-chip').forEach(c => c.classList.toggle('active', c.dataset.p === chip.dataset.p));
    $('detailPriority').textContent = task.priority;
    $('detailPriority').className   = `task-priority-badge ${task.priority}`;
  });
});

$('detailAssignee').addEventListener('change', e => {
  if (!PERMS.editTasks || !FEAT.assignees) return;
  const task = tasks.find(t => t.id === openTaskId);
  if (!task) return;
  const id  = e.target.value ? parseInt(e.target.value, 10) : null;
  const mem = MEMBERS.find(m => m.id === id);
  task.assignee_id      = id;
  task.assignee_display = mem?.display || null;
  const av = $('detailAssigneeAv');
  av.style.background = mem ? avatarColor(mem.display) : 'var(--border)';
  av.textContent      = mem ? initials(mem.display) : '?';
});

$('detailCol').addEventListener('change', () => {
  const task = tasks.find(t => t.id === openTaskId);
  if (task) task.task_list_id = parseInt($('detailCol').value, 10);
});

$('detailDeleteBtn').addEventListener('click', async () => {
  if (!openTaskId || !PERMS.deleteTasks) return;
  if (!confirm('Delete this task permanently?')) return;
  try {
    await api(`/api/workspace/${WORKSPACE_ID}/tasks/${openTaskId}/delete/`, 'POST');
    tasks = tasks.filter(t => t.id !== openTaskId);
    closeTaskDetail(); renderBoard();
    showToast('Task deleted', 'success');
  } catch(err) { showToast(err.message, 'error'); }
});

/* ══════════════════════════════════════════════════════════
   ATTACHMENTS
══════════════════════════════════════════════════════════ */
$$('.attach-type-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const type = btn.dataset.type;
    if (type === 'link') { $('attachLinkRow').style.display = 'flex'; $('attachLinkInput').focus(); return; }
    $(`fileInput${type.charAt(0).toUpperCase()+type.slice(1)}`)?.click();
  });
});

['Image','Video','Document'].forEach(t => {
  $(`fileInput${t}`)?.addEventListener('change', async e => {
    const file = e.target.files[0]; if (!file) return;
    e.target.value = '';
    try {
      await uploadFile(file, t.toLowerCase());
    } catch(err) {
      showToast(err.message || 'Upload failed', 'error');
    }
  });
});

async function uploadFile(file, type) {
  const task = tasks.find(t => t.id === openTaskId);
  if (!task) return;
  const count = (task.attachments || []).filter(a => a.type === type).length;
  if (count >= ATTACH_COUNT_LIMITS[type]) {
    throw new Error(`Each task can have at most ${ATTACH_COUNT_LIMITS[type]} ${type}${ATTACH_COUNT_LIMITS[type] === 1 ? '' : 's'}.`);
  }
  if (file.size > ATTACH_SIZE_LIMITS[type]) {
    throw new Error(`${type.charAt(0).toUpperCase()+type.slice(1)} must be under ${ATTACH_SIZE_LIMITS[type] / (1024*1024)} MB.`);
  }
  const fd = new FormData();
  fd.append('file', file); fd.append('type', type);
  showToast(`Uploading ${file.name}…`, 'info');
  try {
    const data = await api(`/api/workspace/${WORKSPACE_ID}/tasks/${openTaskId}/attachments/upload/`, 'POST', fd);
    task.attachments.push(data.attachment);
    renderAttachments(task); renderBoard();
    showToast('Uploaded', 'success');
  } catch(err) { showToast(err.message, 'error'); }
}

$('attachLinkSubmit').addEventListener('click', async () => {
  const url = $('attachLinkInput').value.trim(); if (!url) return;
  const task = tasks.find(t => t.id === openTaskId); if (!task) return;
  const existingLinks = (task.attachments || []).filter(a => a.type === 'link').length;
  if (existingLinks >= ATTACH_COUNT_LIMITS.link) {
    showToast(`Each task can have at most ${ATTACH_COUNT_LIMITS.link} links.`, 'error');
    return;
  }
  const fd = new FormData(); fd.append('type','link'); fd.append('url', url);
  try {
    const data = await api(`/api/workspace/${WORKSPACE_ID}/tasks/${openTaskId}/attachments/upload/`, 'POST', fd);
    task.attachments.push(data.attachment);
    $('attachLinkInput').value = ''; $('attachLinkRow').style.display = 'none';
    renderAttachments(task); showToast('Link added','success');
  } catch(err) { showToast(err.message,'error'); }
});
$('attachLinkCancel').addEventListener('click', () => { $('attachLinkRow').style.display = 'none'; $('attachLinkInput').value = ''; });

function renderAttachments(task) {
  const list = $('attachmentList'); list.innerHTML = '';
  (task.attachments || []).forEach(att => {
    const item = document.createElement('div'); item.className = 'attachment-item';
    let preview = '';
    if (att.type === 'image' && att.url)
      preview = `<div class="att-preview att-preview--image"><img src="${att.url}" alt="${escHtml(att.original_name)}" loading="lazy"/></div>`;
    else if (att.type === 'video' && att.url)
      preview = `<div class="att-preview att-preview--video"><video controls preload="metadata" style="max-width:100%;border-radius:6px;"><source src="${att.url}"/></video></div>`;
    else if (att.type === 'link')
      preview = `<div class="att-preview att-preview--link"><a href="${escHtml(att.link_url)}" target="_blank" rel="noopener noreferrer">${escHtml(att.link_url)}</a></div>`;
    else if (att.url) {
      const ext = (att.original_name||'').split('.').pop().toUpperCase().slice(0,4);
      preview = `<div class="att-preview att-preview--doc"><a href="${att.url}" target="_blank" rel="noopener" class="att-doc-link"><span class="att-doc-ext">${ext}</span><span>${escHtml(att.original_name)}</span></a></div>`;
    }
    const meta = att.type === 'link'
      ? `Link · ${att.uploaded_by||''} · ${fmtTime(att.created_at)}`
      : `${att.type} · ${fmtBytes(att.file_size)} · ${att.uploaded_by||''} · ${fmtTime(att.created_at)}`;
    item.innerHTML = `${preview}<div class="att-footer"><span class="att-meta">${escHtml(meta)}</span><button class="att-del-btn" data-att-id="${att.id}" title="Remove"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>`;
    item.querySelector('.att-del-btn').addEventListener('click', async () => {
      if (!confirm('Remove this attachment?')) return;
      try {
        await api(`/api/workspace/${WORKSPACE_ID}/tasks/${openTaskId}/attachments/${att.id}/delete/`, 'POST');
        task.attachments = task.attachments.filter(a => a.id !== att.id);
        renderAttachments(task); renderBoard();
        showToast('Attachment removed','success');
      } catch(err) { showToast(err.message,'error'); }
    });
    list.appendChild(item);
  });
}

/* ══════════════════════════════════════════════════════════
   COMMENTS
══════════════════════════════════════════════════════════ */
function renderComments(task) {
  const list = $('commentList'); list.innerHTML = '';
  (task.comments||[]).forEach(c => {
    const item = document.createElement('div'); item.className = 'comment-item';
    const avHtml = c.author_avatar
      ? `<img src="${c.author_avatar}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;"/>`
      : initials(c.author);
    item.innerHTML = `
      <div class="comment-av" style="background:${avatarColor(c.author)}">${avHtml}</div>
      <div class="comment-body">
        <div class="comment-meta"><span class="comment-author">${escHtml(c.author)}</span><span class="comment-time">${fmtTime(c.created_at)}</span></div>
        <div class="comment-text">${escHtml(c.text)}</div>
      </div>`;
    list.appendChild(item);
  });
  list.scrollTop = list.scrollHeight;
}

async function sendComment() {
  if (!openTaskId || !PERMS.comment) return;
  const input = $('commentInput');
  const text  = input.value.trim(); if (!text) return;
  input.value = '';
  const task = tasks.find(t => t.id === openTaskId); if (!task) return;
  try {
    const data = await api(`/api/workspace/${WORKSPACE_ID}/tasks/${openTaskId}/comments/`, 'POST', { text });
    task.comments = task.comments || [];
    if (!task.comments.some(c => c.id === data.comment.id)) {
      task.comments.push(data.comment);
    }
    renderComments(task);
  } catch(err) { input.value = text; showToast(err.message,'error'); }
}
$('commentSend').addEventListener('click', sendComment);
$('commentInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); sendComment(); } });

/* ══════════════════════════════════════════════════════════
   TOAST
══════════════════════════════════════════════════════════ */
function showToast(msg, type = 'info') {
  let box = $('toastContainer');
  if (!box) {
    box = document.createElement('div'); box.id = 'toastContainer';
    box.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:99999;display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none;';
    document.body.appendChild(box);
  }
  const colors = { success:'#22c55e', error:'#f87171', info:'#818cf8' };
  const t = document.createElement('div');
  t.style.cssText = `background:var(--bg-2,#1a1a2e);color:var(--text,#e4e4f0);border:1px solid ${colors[type]||colors.info};border-radius:10px;padding:10px 20px;font-size:.85rem;box-shadow:0 4px 20px rgba(0,0,0,.4);pointer-events:auto;transition:opacity .3s;white-space:nowrap;`;
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 2800);
}

function showBoardError(msg) {
  const k = $('kanban');
  if (k) k.innerHTML = `<div style="padding:40px;text-align:center;color:var(--red,#f87171);">${escHtml(msg)}</div>`;
}

/* ══════════════════════════════════════════════════════════
   KEYBOARD SHORTCUTS
══════════════════════════════════════════════════════════ */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if ($('boardSettingsOverlay')?.classList.contains('visible')) { closeBoardSettings(); return; }
    if ($('taskDetailOverlay').classList.contains('visible'))     { closeTaskDetail();    return; }
    if ($('addTaskOverlay').classList.contains('visible'))        { closeAddTaskModal();  return; }
    if ($('colOverlay').classList.contains('visible'))            { closeColModal();      return; }
  }
});

/* ══════════════════════════════════════════════════════════
   INIT
══════════════════════════════════════════════════════════ */
if (WORKSPACE_ID) { loadAll(); } else { showBoardError('Workspace not found.'); }

