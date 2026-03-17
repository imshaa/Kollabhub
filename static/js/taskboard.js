/* ═══════════════════════════════════════════════════
   KOLLABHUB  —  tasks.js
═══════════════════════════════════════════════════ */

/* ── Helpers ───────────────────────────────────── */
const $ = (id) => document.getElementById(id);
const $$ = (sel, root = document) => root.querySelectorAll(sel);

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

function initials(name = '') {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function fmtTime(d) {
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ── Data ──────────────────────────────────────── */
let columns = [
  { id: 'todo',       name: 'To Do',       color: '#60a5fa' },
  { id: 'inprogress', name: 'In Progress',  color: '#facc15' },
  { id: 'review',     name: 'In Review',   color: '#a78bfa' },
  { id: 'done',       name: 'Done',        color: '#4ade80' },
];

let tasks = [
  { id: 1,  title: 'Redesign onboarding flow',       col: 'todo',       priority: 'high',   assignee: 'Sarah Chen',  desc: 'Revamp the full onboarding UX to reduce drop-off rate.', complete: false, attachments: [], comments: [], created: new Date(Date.now() - 3*24*3600000) },
  { id: 2,  title: 'Component library audit',        col: 'todo',       priority: 'medium', assignee: 'Alex Morgan', desc: 'Go through every component and flag inconsistencies.',    complete: false, attachments: [], comments: [], created: new Date(Date.now() - 2*24*3600000) },
  { id: 3,  title: 'Dark mode token system',         col: 'inprogress', priority: 'high',   assignee: 'David Kim',   desc: 'Define semantic tokens for dark mode palette.',           complete: false, attachments: [], comments: [], created: new Date(Date.now() - 1*24*3600000) },
  { id: 4,  title: 'Figma handoff for sprint 4',     col: 'inprogress', priority: 'medium', assignee: 'Alex Morgan', desc: '',                                                        complete: false, attachments: [], comments: [], created: new Date(Date.now() - 1*24*3600000) },
  { id: 5,  title: 'Accessibility review – nav',     col: 'review',     priority: 'medium', assignee: 'Mia Torres',  desc: 'Test keyboard navigation and screen-reader labels.',      complete: false, attachments: [], comments: [], created: new Date(Date.now() - 4*24*3600000) },
  { id: 6,  title: 'Icon set v2 export',             col: 'review',     priority: 'low',    assignee: 'Sarah Chen',  desc: '',                                                        complete: false, attachments: [], comments: [], created: new Date(Date.now() - 5*24*3600000) },
  { id: 7,  title: 'Design system doc site',         col: 'done',       priority: 'low',    assignee: 'David Kim',   desc: 'Published the docs at design.kollabhub.io.',              complete: true,  attachments: [], comments: [], created: new Date(Date.now() - 7*24*3600000) },
  { id: 8,  title: 'Q3 brand refresh proposal',      col: 'done',       priority: 'high',   assignee: 'Alex Morgan', desc: 'Completed and presented to the executive team.',          complete: true,  attachments: [], comments: [], created: new Date(Date.now() - 10*24*3600000) },
];

let nextId     = 9;
let nextColId  = 100;
let activeFilter   = 'all';
let activeAssignee = '';
let searchQuery    = '';
let openTaskId     = null;
let selectedPriority    = 'medium';
let selectedColColor    = '#60a5fa';

/* ══════════════════════════════════════════════
   RENDER BOARD
══════════════════════════════════════════════ */
function renderBoard() {
  const kanban = $('kanban');
  kanban.innerHTML = '';

  columns.forEach((col, ci) => {
    const colTasks = getFilteredTasks(col.id);

    const colEl = document.createElement('div');
    colEl.className = 'kanban-col';
    colEl.style.animationDelay = `${ci * 0.06}s`;
    colEl.innerHTML = `
      <div class="kanban-col-header">
        <div class="col-title-row">
          <div class="col-dot" style="background:${col.color}"></div>
          <span class="col-name">${col.name}</span>
          <span class="col-count">${tasks.filter(t => t.col === col.id).length}</span>
        </div>
        <div class="col-header-actions">
          <button class="col-btn rename-col-btn" data-col="${col.id}" title="Rename">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="col-btn delete-col-btn" data-col="${col.id}" title="Delete list">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
          </button>
        </div>
      </div>
      <div class="kanban-cards" id="cards-${col.id}"></div>
      <button class="add-card-btn" data-col="${col.id}">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Add task
      </button>
    `;
    kanban.appendChild(colEl);

    // Render cards
    const cardsEl = $(`cards-${col.id}`);
    colTasks.forEach((task, ti) => {
      cardsEl.appendChild(buildCard(task, ti));
    });

    // col action handlers
    colEl.querySelector('.rename-col-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      openColModal('rename', col.id);
    });
    colEl.querySelector('.delete-col-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm(`Delete list "${col.name}"? Tasks will also be removed.`)) {
        tasks = tasks.filter(t => t.col !== col.id);
        columns = columns.filter(c => c.id !== col.id);
        renderBoard();
      }
    });
    colEl.querySelector('.add-card-btn').addEventListener('click', () => {
      openAddTaskModal(col.id);
    });
  });

  // "Add new list" button at end
  const addColEl = document.createElement('div');
  addColEl.className = 'kanban-add-col';
  addColEl.innerHTML = `
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
    <span>Add New List</span>
  `;
  addColEl.addEventListener('click', () => openColModal('add'));
  kanban.appendChild(addColEl);
}

/* ── Build a single task card DOM element ── */
function buildCard(task, index = 0) {
  const card = document.createElement('div');
  card.className = 'task-card' + (task.complete ? ' complete' : '') + (isHidden(task) ? ' hidden' : '');
  card.dataset.id = task.id;
  card.style.animationDelay = `${index * 0.04}s`;

  const hasDesc = task.desc && task.desc.trim();
  const attachCount = task.attachments.length;

  card.innerHTML = `
    <div class="task-card-top">
      <div class="task-card-title">${task.title}</div>
      <button class="task-complete-btn" title="${task.complete ? 'Mark incomplete' : 'Mark complete'}">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
      </button>
    </div>
    ${hasDesc ? `<div class="task-card-desc">${task.desc}</div>` : ''}
    <div class="task-card-footer">
      <div class="task-card-badges">
        <span class="task-priority ${task.priority}">${task.priority}</span>
        ${attachCount > 0 ? `<span class="task-attach-badge">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
          ${attachCount}
        </span>` : ''}
      </div>
      <div class="task-assignee-av" style="background:${avatarColor(task.assignee)}" title="${task.assignee}">${initials(task.assignee)}</div>
    </div>
  `;

  // Complete toggle (quick, without opening modal)
  card.querySelector('.task-complete-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleComplete(task.id);
  });

  // Open detail
  card.addEventListener('click', () => openTaskDetail(task.id));

  return card;
}

/* ── Filter helper ── */
function isHidden(task) {
  if (activeFilter === 'high'       && task.priority !== 'high')       return true;
  if (activeFilter === 'medium'     && task.priority !== 'medium')     return true;
  if (activeFilter === 'low'        && task.priority !== 'low')        return true;
  if (activeFilter === 'complete'   && !task.complete)                 return true;
  if (activeFilter === 'incomplete' && task.complete)                  return true;
  if (activeAssignee && task.assignee !== activeAssignee)              return true;
  if (searchQuery && !task.title.toLowerCase().includes(searchQuery.toLowerCase())) return true;
  return false;
}

function getFilteredTasks(colId) {
  return tasks.filter(t => t.col === colId && !isHidden(t));
}

/* ══════════════════════════════════════════════
   FILTERS  —  dropdown panel
══════════════════════════════════════════════ */
const MEMBERS = ['Alex Morgan', 'Sarah Chen', 'David Kim', 'Mia Torres'];

// Build assignee rows
(function buildAssigneeFilterList() {
  const list = $('assigneeFilterList');
  // "All members" row
  const allBtn = document.createElement('button');
  allBtn.className = 'filter-assignee-opt active';
  allBtn.dataset.member = '';
  allBtn.innerHTML = `
    <div class="filter-assignee-av" style="background:var(--surface2);border:1px solid var(--border);">
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--text-400)" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
    </div>
    All Members
    <span class="filter-assignee-check">✓</span>
  `;
  list.appendChild(allBtn);

  MEMBERS.forEach(name => {
    const btn = document.createElement('button');
    btn.className = 'filter-assignee-opt';
    btn.dataset.member = name;
    btn.innerHTML = `
      <div class="filter-assignee-av" style="background:${avatarColor(name)}">${initials(name)}</div>
      ${name}
      <span class="filter-assignee-check">✓</span>
    `;
    list.appendChild(btn);
  });

  // click handlers
  list.querySelectorAll('.filter-assignee-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      list.querySelectorAll('.filter-assignee-opt').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeAssignee = btn.dataset.member;
      updateFilterState();
      applyFilters();
    });
  });
})();

// Toggle dropdown open/close
$('filterIconBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  const dd = $('filterDropdown');
  dd.classList.toggle('open');
  $('filterIconBtn').classList.toggle('active', dd.classList.contains('open'));
});

// Close when clicking outside
document.addEventListener('click', (e) => {
  if (!$('filterDropdownWrap').contains(e.target)) {
    $('filterDropdown').classList.remove('open');
    $('filterIconBtn').classList.remove('active');
  }
});

// Filter option clicks (priority + status)
$$('.filter-opt').forEach(opt => {
  opt.addEventListener('click', () => {
    $$('.filter-opt').forEach(o => o.classList.remove('active'));
    opt.classList.add('active');
    activeFilter = opt.dataset.filter;
    updateFilterState();
    applyFilters();
  });
});
// Set default active
document.querySelector('.filter-opt[data-filter="all"]').classList.add('active');

// Clear all
$('filterClearBtn').addEventListener('click', () => {
  activeFilter   = 'all';
  activeAssignee = '';
  searchQuery    = '';
  $('searchInput').value = '';
  $$('.filter-opt').forEach(o => o.classList.toggle('active', o.dataset.filter === 'all'));
  $$('.filter-assignee-opt').forEach(b => b.classList.toggle('active', b.dataset.member === ''));
  updateFilterState();
  applyFilters();
});

function updateFilterState() {
  const isFiltered = activeFilter !== 'all' || activeAssignee !== '' || searchQuery !== '';
  $('filterActiveDot').classList.toggle('visible', isFiltered);
  $('filterIconBtn').classList.toggle('active',
    isFiltered || $('filterDropdown').classList.contains('open')
  );
}

function applyFilters() {
  // Toggle card visibility without full re-render for smooth UX
  $$('.task-card').forEach(card => {
    const task = tasks.find(t => t.id === parseInt(card.dataset.id));
    if (!task) return;
    card.classList.toggle('hidden', isHidden(task));
  });
  // Update col counts
  columns.forEach(col => {
    const countEl = document.querySelector(`#cards-${col.id}`)?.closest('.kanban-col')?.querySelector('.col-count');
    if (countEl) countEl.textContent = tasks.filter(t => t.col === col.id).length;
  });
}

$('searchInput').addEventListener('input', (e) => {
  searchQuery = e.target.value;
  updateFilterState();
  applyFilters();
});

/* ══════════════════════════════════════════════
   ADD / RENAME COLUMN MODAL
══════════════════════════════════════════════ */
let colEditMode = 'add';
let colEditId   = null;

function openColModal(mode, colId = null) {
  colEditMode = mode;
  colEditId   = colId;
  $('colModalTitle').textContent = mode === 'add' ? 'Add New List' : 'Rename List';
  $('colSaveBtn').textContent    = mode === 'add' ? 'Create List' : 'Save';
  $('colNameInput').value        = mode === 'rename' ? columns.find(c => c.id === colId)?.name || '' : '';
  $('colNameErr').classList.remove('visible');

  // Reset color selection
  selectedColColor = mode === 'rename'
    ? (columns.find(c => c.id === colId)?.color || '#60a5fa')
    : '#60a5fa';
  $$('.color-dot').forEach(d => d.classList.toggle('active', d.dataset.color === selectedColColor));

  $('colOverlay').classList.add('visible');
  setTimeout(() => $('colNameInput').focus(), 80);
}

function closeColModal() {
  $('colOverlay').classList.remove('visible');
  $('colNameInput').value = '';
}

$('colCloseBtn').addEventListener('click',  closeColModal);
$('colCancelBtn').addEventListener('click', closeColModal);
$('colOverlay').addEventListener('click', e => { if (e.target === $('colOverlay')) closeColModal(); });

// Color selection
$$('.color-dot').forEach(dot => {
  dot.addEventListener('click', () => {
    $$('.color-dot').forEach(d => d.classList.remove('active'));
    dot.classList.add('active');
    selectedColColor = dot.dataset.color;
  });
});

$('colSaveBtn').addEventListener('click', () => {
  const name = $('colNameInput').value.trim();
  if (!name) {
    const err = $('colNameErr');
    err.textContent = 'List name is required';
    err.classList.add('visible');
    return;
  }

  if (colEditMode === 'add') {
    const id = 'col_' + (nextColId++);
    columns.push({ id, name, color: selectedColColor });
  } else {
    const col = columns.find(c => c.id === colEditId);
    if (col) { col.name = name; col.color = selectedColColor; }
  }

  closeColModal();
  renderBoard();
  // re-populate column select in add-task modal
  populateColSelect();
});

/* ══════════════════════════════════════════════
   ADD TASK MODAL
══════════════════════════════════════════════ */
function populateColSelect(selectEl, defaultCol) {
  const el = selectEl || $('newTaskCol');
  el.innerHTML = '';
  columns.forEach(col => {
    const opt = document.createElement('option');
    opt.value = col.id;
    opt.textContent = col.name;
    if (defaultCol && col.id === defaultCol) opt.selected = true;
    el.appendChild(opt);
  });
}
populateColSelect();

function openAddTaskModal(defaultCol) {
  populateColSelect($('newTaskCol'), defaultCol);
  $('newTaskTitle').value = '';
  $('newTaskDesc').value  = '';
  $('newTaskTitleErr').classList.remove('visible');
  selectedPriority = 'medium';
  $$('.priority-opt').forEach(b => b.classList.toggle('active', b.dataset.p === 'medium'));
  $('addTaskOverlay').classList.add('visible');
  setTimeout(() => $('newTaskTitle').focus(), 80);
}

function closeAddTaskModal() {
  $('addTaskOverlay').classList.remove('visible');
}

$('addTaskBtn').addEventListener('click', () => openAddTaskModal());
$('addTaskCloseBtn').addEventListener('click',  closeAddTaskModal);
$('addTaskCancelBtn').addEventListener('click', closeAddTaskModal);
$('addTaskOverlay').addEventListener('click', e => { if (e.target === $('addTaskOverlay')) closeAddTaskModal(); });

// Priority selection (add modal)
$$('.priority-opt').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.priority-opt').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedPriority = btn.dataset.p;
  });
});

$('addTaskSaveBtn').addEventListener('click', () => {
  const title = $('newTaskTitle').value.trim();
  if (!title) {
    const err = $('newTaskTitleErr');
    err.textContent = 'Task title is required';
    err.classList.add('visible');
    $('newTaskTitle').focus();
    return;
  }

  tasks.push({
    id:          nextId++,
    title,
    desc:        $('newTaskDesc').value.trim(),
    col:         $('newTaskCol').value,
    priority:    selectedPriority,
    assignee:    $('newTaskAssignee').value,
    complete:    false,
    attachments: [],
    comments:    [],
    created:     new Date(),
  });

  closeAddTaskModal();
  renderBoard();
});

/* ══════════════════════════════════════════════
   TOGGLE COMPLETE
══════════════════════════════════════════════ */
function toggleComplete(taskId) {
  const task = tasks.find(t => t.id === taskId);
  if (!task) return;
  task.complete = !task.complete;

  // Update card visually without full re-render
  const card = document.querySelector(`.task-card[data-id="${taskId}"]`);
  if (card) {
    card.classList.toggle('complete', task.complete);
    card.querySelector('.task-complete-btn').title = task.complete ? 'Mark incomplete' : 'Mark complete';
    const titleEl = card.querySelector('.task-card-title');
    // filter re-apply
    if (isHidden(task)) card.classList.add('hidden');
  }

  // Sync detail modal if open
  if (openTaskId === taskId) syncDetailComplete(task);
}

/* ══════════════════════════════════════════════
   TASK DETAIL MODAL
══════════════════════════════════════════════ */
function openTaskDetail(taskId) {
  const task = tasks.find(t => t.id === taskId);
  if (!task) return;
  openTaskId = taskId;

  // Col label
  const col = columns.find(c => c.id === task.col);
  $('detailColLabel').textContent = col?.name || task.col;
  $('detailColLabel').style.borderLeft = `3px solid ${col?.color || '#888'}`;
  $('detailColLabel').style.paddingLeft = '8px';

  // Priority badge
  const pb = $('detailPriority');
  pb.textContent = task.priority;
  pb.className = `task-priority-badge ${task.priority}`;

  // Title
  $('detailTitle').textContent = task.title;
  $('detailTitle').classList.toggle('complete', task.complete);

  // Complete toggle
  syncDetailComplete(task);

  // Description
  $('detailDesc').value = task.desc || '';

  // Attachments
  renderAttachments(task);

  // Comments
  renderComments(task);

  // Sidebar: assignee
  const sAv = $('detailAssigneeAv');
  sAv.style.background = avatarColor(task.assignee);
  sAv.textContent = initials(task.assignee);
  $('detailAssignee').value = task.assignee;

  // Sidebar: priority chips
  $$('.priority-chip').forEach(c => c.classList.toggle('active', c.dataset.p === task.priority));

  // Sidebar: column select
  populateColSelect($('detailCol'), task.col);

  // Sidebar: status
  const statusEl = $('detailStatus');
  statusEl.textContent  = task.complete ? '✓ Complete' : '○ Incomplete';
  statusEl.className    = `detail-status ${task.complete ? 'complete' : 'incomplete'}`;

  // Sidebar: created
  $('detailCreated').textContent = task.created.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });

  // Complete btn label
  $('sidebarCompleteBtnLabel').textContent = task.complete ? 'Mark Incomplete' : 'Mark Complete';
  $('sidebarCompleteBtn').classList.toggle('done', task.complete);

  $('taskDetailOverlay').classList.add('visible');
  setTimeout(() => $('detailTitle').focus(), 80);
}

function closeTaskDetail() {
  // Auto-save title + desc on close
  if (openTaskId) {
    const task = tasks.find(t => t.id === openTaskId);
    if (task) {
      const newTitle = $('detailTitle').textContent.trim();
      if (newTitle) task.title = newTitle;
      task.desc = $('detailDesc').value.trim();

      // Sync col & assignee & priority from sidebar
      task.col      = $('detailCol').value;
      task.assignee = $('detailAssignee').value;
    }
    renderBoard();
  }
  openTaskId = null;
  $('taskDetailOverlay').classList.remove('visible');
}

$('taskDetailCloseBtn').addEventListener('click', closeTaskDetail);
$('taskDetailOverlay').addEventListener('click', e => { if (e.target === $('taskDetailOverlay')) closeTaskDetail(); });

/* ── Complete toggle in detail ── */
function syncDetailComplete(task) {
  const btn = $('detailCompleteBtn');
  btn.classList.toggle('done', task.complete);
  $('detailTitle').classList.toggle('complete', task.complete);
  $('sidebarCompleteBtnLabel').textContent = task.complete ? 'Mark Incomplete' : 'Mark Complete';
  $('sidebarCompleteBtn').classList.toggle('done', task.complete);
  const statusEl = $('detailStatus');
  statusEl.textContent = task.complete ? '✓ Complete' : '○ Incomplete';
  statusEl.className   = `detail-status ${task.complete ? 'complete' : 'incomplete'}`;
  const pb = $('detailPriority');
  pb.className = `task-priority-badge ${task.priority}`;
}

$('detailCompleteBtn').addEventListener('click', () => {
  if (!openTaskId) return;
  toggleComplete(openTaskId);
});

$('sidebarCompleteBtn').addEventListener('click', () => {
  if (!openTaskId) return;
  toggleComplete(openTaskId);
});

/* ── Priority chips in detail ── */
$$('.priority-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    const task = tasks.find(t => t.id === openTaskId);
    if (!task) return;
    task.priority = chip.dataset.p;
    $$('.priority-chip').forEach(c => c.classList.toggle('active', c.dataset.p === chip.dataset.p));
    const pb = $('detailPriority');
    pb.textContent = task.priority;
    pb.className   = `task-priority-badge ${task.priority}`;
  });
});

/* ── Assignee change in detail ── */
$('detailAssignee').addEventListener('change', (e) => {
  const task = tasks.find(t => t.id === openTaskId);
  if (!task) return;
  task.assignee = e.target.value;
  const av = $('detailAssigneeAv');
  av.style.background = avatarColor(task.assignee);
  av.textContent = initials(task.assignee);
});

/* ── Delete task ── */
$('detailDeleteBtn').addEventListener('click', () => {
  if (!openTaskId) return;
  if (!confirm('Delete this task? This cannot be undone.')) return;
  tasks = tasks.filter(t => t.id !== openTaskId);
  closeTaskDetail();
  renderBoard();
});

/* ══════════════════════════════════════════════
   ATTACHMENTS
══════════════════════════════════════════════ */
$('fileInput').addEventListener('change', (e) => {
  const task = tasks.find(t => t.id === openTaskId);
  if (!task) return;
  Array.from(e.target.files).forEach(file => {
    task.attachments.push({
      id:   Date.now() + Math.random(),
      name: file.name,
      size: file.size,
      ext:  file.name.split('.').pop().toUpperCase().slice(0, 4),
    });
  });
  e.target.value = ''; // reset input
  renderAttachments(task);
});

function renderAttachments(task) {
  const list = $('attachmentList');
  list.innerHTML = '';
  task.attachments.forEach(att => {
    const item = document.createElement('div');
    item.className = 'attachment-item';
    item.innerHTML = `
      <div class="attach-file-icon">${att.ext}</div>
      <div class="attach-info">
        <div class="attach-name" title="${att.name}">${att.name}</div>
        <div class="attach-size">${formatBytes(att.size)}</div>
      </div>
      <button class="attach-remove" data-att-id="${att.id}" title="Remove">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    `;
    item.querySelector('.attach-remove').addEventListener('click', () => {
      task.attachments = task.attachments.filter(a => a.id !== att.id);
      renderAttachments(task);
    });
    list.appendChild(item);
  });
}

/* ══════════════════════════════════════════════
   COMMENTS
══════════════════════════════════════════════ */
function renderComments(task) {
  const list = $('commentList');
  list.innerHTML = '';
  task.comments.forEach(c => {
    const item = document.createElement('div');
    item.className = 'comment-item';
    item.innerHTML = `
      <div class="comment-av" style="background:${avatarColor(c.author)}">${initials(c.author)}</div>
      <div class="comment-body">
        <div class="comment-meta">
          <span class="comment-author">${c.author}</span>
          <span class="comment-time">${c.time}</span>
        </div>
        <div class="comment-text">${c.text}</div>
      </div>
    `;
    list.appendChild(item);
  });
  list.scrollTop = list.scrollHeight;
}

function sendComment() {
  const task = tasks.find(t => t.id === openTaskId);
  if (!task) return;
  const input = $('commentInput');
  const text  = input.value.trim();
  if (!text) return;
  input.value = '';

  task.comments.push({
    id:     Date.now(),
    author: 'Alex Morgan',
    text,
    time:   fmtTime(new Date()),
  });
  renderComments(task);
}

$('commentSend').addEventListener('click', sendComment);
$('commentInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); sendComment(); }
});

/* ══════════════════════════════════════════════
   GLOBAL KEYBOARD
══════════════════════════════════════════════ */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if ($('taskDetailOverlay').classList.contains('visible')) { closeTaskDetail(); return; }
    if ($('addTaskOverlay').classList.contains('visible'))    { closeAddTaskModal(); return; }
    if ($('colOverlay').classList.contains('visible'))        { closeColModal(); return; }
  }
});

/* ══════════════════════════════════════════════
   INIT
══════════════════════════════════════════════ */
renderBoard();