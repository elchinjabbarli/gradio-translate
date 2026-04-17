/**
 * FocusPulse — Popup UI Logic
 * Handles all user interactions, rendering, and communication with background.
 * Uses ONLY message passing for data operations (no direct storage access).
 */

// ─── State ──────────────────────────────────────────────────

let allTasks = [];
let currentFilter = 'all';
let currentSort = 'due';

// ─── DOM References ─────────────────────────────────────────

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const quickAddInput = $('#quick-add-input');
const quickAddBtn = $('#quick-add-btn');
const addTaskForm = $('#add-task-form');
const taskList = $('#task-list');
const filterBtns = $$('.filter-btn');
const sortSelect = $('#sort-select');
const settingsPanel = $('#settings-panel');
const contextPanel = $('#context-panel');
const detailPanel = $('#detail-panel');

// Form fields
const taskTitle = $('#task-title');
const taskDesc = $('#task-desc');
const taskPriority = $('#task-priority');
const taskDue = $('#task-due');
const taskRecurrence = $('#task-recurrence');
const taskRecurrenceDays = $('#task-recurrence-days');
const taskContext = $('#task-context');
const formCancel = $('#form-cancel');
const formSave = $('#form-save');

// ─── Initialization ─────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  await loadTasks();
  await loadSettings();
  setupEventListeners();
  quickAddInput.focus();
});

// ─── Event Listeners ────────────────────────────────────────

function setupEventListeners() {
  // Quick add — single Enter for quick add, Shift+Enter opens detail form
  quickAddBtn.addEventListener('click', handleQuickAdd);

  quickAddInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      const text = quickAddInput.value.trim();
      if (text) taskTitle.value = text;
      showAddForm();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      handleQuickAdd();
    }
  });

  // Form actions
  formCancel.addEventListener('click', hideAddForm);
  formSave.addEventListener('click', handleFormSave);

  // Recurrence toggle
  taskRecurrence.addEventListener('change', () => {
    taskRecurrenceDays.classList.toggle('hidden', taskRecurrence.value !== 'custom');
  });

  // Filter buttons
  filterBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      filterBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      renderTasks();
    });
  });

  // Sort select
  sortSelect.addEventListener('change', () => {
    currentSort = sortSelect.value;
    renderTasks();
  });

  // Settings panel
  $('#btn-settings').addEventListener('click', () => {
    settingsPanel.classList.remove('hidden');
  });
  $('#settings-close').addEventListener('click', () => {
    settingsPanel.classList.add('hidden');
  });
  $('#save-settings').addEventListener('click', handleSaveSettings);

  // Context rules panel
  $('#btn-context-rules').addEventListener('click', () => {
    showContextRules();
  });
  $('#context-close').addEventListener('click', () => {
    contextPanel.classList.add('hidden');
  });

  // Detail panel
  $('#detail-close').addEventListener('click', () => {
    detailPanel.classList.add('hidden');
  });
}

// ─── Task Loading & Rendering ───────────────────────────────

async function loadTasks() {
  try {
    const response = await sendMessage({ type: 'GET_TASKS' });
    if (response.success) {
      allTasks = response.data || [];
    }
  } catch (err) {
    console.error('Failed to load tasks:', err);
  }
  renderTasks();
}

function renderTasks() {
  let tasks = [...allTasks];

  // Filter
  if (currentFilter === 'pending') {
    tasks = tasks.filter((t) => t.status === 'pending');
  } else if (currentFilter === 'completed') {
    tasks = tasks.filter((t) => t.status === 'completed');
  }

  // Sort
  tasks.sort((a, b) => {
    switch (currentSort) {
      case 'due':
        if (!a.dueTime && !b.dueTime) return b.createdAt - a.createdAt;
        if (!a.dueTime) return 1;
        if (!b.dueTime) return -1;
        return a.dueTime - b.dueTime;
      case 'priority': {
        const pMap = { high: 0, medium: 1, low: 2 };
        return pMap[a.priority] - pMap[b.priority];
      }
      case 'created':
        return b.createdAt - a.createdAt;
      default:
        return 0;
    }
  });

  // Render
  if (tasks.length === 0) {
    taskList.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">📋</span>
        <p>${currentFilter === 'completed' ? 'No completed tasks yet' : currentFilter === 'pending' ? 'All caught up! No pending tasks.' : 'No tasks yet. Add one above!'}</p>
      </div>
    `;
    return;
  }

  taskList.innerHTML = tasks.map((task) => renderTaskItem(task)).join('');

  // Attach event listeners to task items
  taskList.querySelectorAll('.task-item').forEach((el) => {
    const taskId = el.dataset.taskId;

    el.querySelector('.task-check').addEventListener('click', async (e) => {
      e.stopPropagation();
      await toggleComplete(taskId);
    });

    el.querySelector('.task-body').addEventListener('click', () => {
      showTaskDetail(taskId);
    });

    const snoozeBtn = el.querySelector('.snooze-btn');
    if (snoozeBtn) {
      snoozeBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await handleSnooze(taskId);
      });
    }

    const deleteBtn = el.querySelector('.delete-btn');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await handleDelete(taskId);
      });
    }
  });
}

function renderTaskItem(task) {
  const isCompleted = task.status === 'completed';
  const priorityClass = task.priority;
  const isOverdue = task.dueTime && task.dueTime <= Date.now() && !isCompleted;

  const dueLabel = task.dueTime
    ? `<span class="task-due ${isOverdue ? 'overdue' : ''}">${isOverdue ? '⚠ ' : ''}${formatDueTime(task.dueTime)}</span>`
    : '';

  const recurrenceLabel = task.recurrence
    ? `<span>🔄 ${task.recurrence.type === 'custom' ? `Every ${task.recurrence.intervalDays}d` : task.recurrence.type}</span>`
    : '';

  const contextTags = task.contextRules && task.contextRules.length > 0
    ? task.contextRules.map((r) => `<span class="task-context-tag">📍 ${escapeHtml(r.domain)}</span>`).join('')
    : '';

  const snoozedLabel = task.snoozedUntil && task.snoozedUntil > Date.now()
    ? `<span>💤 Snoozed ${formatRelativeTime(task.snoozedUntil)}</span>`
    : '';

  return `
    <div class="task-item ${isCompleted ? 'completed' : ''}" data-task-id="${task.id}">
      <button class="task-check" title="${isCompleted ? 'Mark pending' : 'Mark complete'}">${isCompleted ? '✓' : ''}</button>
      <div class="task-body">
        <div class="task-title">${escapeHtml(task.title)}</div>
        <div class="task-meta">
          <span class="task-priority ${priorityClass}"><span class="dot"></span> ${task.priority}</span>
          ${dueLabel}
          ${recurrenceLabel}
          ${snoozedLabel}
          ${contextTags}
        </div>
      </div>
      <div class="task-actions">
        ${!isCompleted ? '<button class="task-action-btn snooze-btn" title="Snooze">💤</button>' : ''}
        <button class="task-action-btn delete-btn delete" title="Delete">🗑</button>
      </div>
    </div>
  `;
}

// ─── Quick Add ──────────────────────────────────────────────

async function handleQuickAdd() {
  const text = quickAddInput.value.trim();
  if (!text) {
    showAddForm();
    return;
  }

  const taskData = parseQuickInput(text);
  await createTaskFromData(taskData);
  quickAddInput.value = '';
}

function parseQuickInput(text) {
  const data = {
    title: text,
    description: '',
    priority: 'medium',
    dueTime: null,
    contextRules: [],
    recurrence: null,
  };

  // Try to extract time reference (e.g., "tomorrow 3pm", "today 5pm")
  const timePatterns = [
    { regex: /(?:tomorrow|tmr)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i, offset: 1 },
    { regex: /(?:today)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i, offset: 0 },
    { regex: /(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s+(?:tomorrow|tmr)/i, offset: 1 },
    { regex: /(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i, offset: 0 },
  ];

  for (const pattern of timePatterns) {
    const match = text.match(pattern.regex);
    if (match) {
      let hours = parseInt(match[1]);
      const minutes = match[2] ? parseInt(match[2]) : 0;
      const ampm = match[3] ? match[3].toLowerCase() : null;

      if (ampm === 'pm' && hours < 12) hours += 12;
      if (ampm === 'am' && hours === 12) hours = 0;

      const due = new Date();
      due.setDate(due.getDate() + pattern.offset);
      due.setHours(hours, minutes, 0, 0);

      if (due.getTime() > Date.now()) {
        data.dueTime = due.getTime();
        data.title = text.replace(match[0], '').trim();
      }
      break;
    }
  }

  // Try to extract priority
  if (/\b(?:high|urgent|important)\b/i.test(text)) {
    data.priority = 'high';
    data.title = data.title.replace(/\b(?:high|urgent|important)\b/i, '').trim();
  } else if (/\b(?:low|minor)\b/i.test(text)) {
    data.priority = 'low';
    data.title = data.title.replace(/\b(?:low|minor)\b/i, '').trim();
  }

  // Clean up title
  data.title = data.title.replace(/\s+/g, ' ').trim() || text;

  return data;
}

// ─── Add Form ───────────────────────────────────────────────

function showAddForm() {
  addTaskForm.classList.remove('hidden');
  quickAddInput.value = '';
  taskTitle.focus();
}

function hideAddForm() {
  addTaskForm.classList.add('hidden');
  resetForm();
}

function resetForm() {
  taskTitle.value = '';
  taskDesc.value = '';
  taskPriority.value = 'medium';
  taskDue.value = '';
  taskRecurrence.value = '';
  taskRecurrenceDays.classList.add('hidden');
  taskContext.value = '';
}

async function handleFormSave() {
  const title = taskTitle.value.trim();
  if (!title) {
    taskTitle.focus();
    return;
  }

  const data = {
    title: title,
    description: taskDesc.value.trim(),
    priority: taskPriority.value,
    dueTime: taskDue.value ? new Date(taskDue.value).getTime() : null,
    contextRules: [],
    recurrence: null,
  };

  // Parse context domains
  const contextText = taskContext.value.trim();
  if (contextText) {
    data.contextRules = contextText
      .split(',')
      .map((d) => d.trim().replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, ''))
      .filter((d) => d.length > 0)
      .map((d) => ({ domain: d }));
  }

  // Parse recurrence
  if (taskRecurrence.value) {
    if (taskRecurrence.value === 'custom') {
      const days = parseInt(taskRecurrenceDays.value) || 1;
      data.recurrence = { type: 'custom', intervalDays: days };
    } else {
      data.recurrence = { type: taskRecurrence.value };
    }
  }

  await createTaskFromData(data);
  hideAddForm();
}

async function createTaskFromData(taskData) {
  try {
    const response = await sendMessage({ type: 'CREATE_TASK', data: taskData });
    if (response.success) {
      allTasks.push(response.data);
      renderTasks();
    }
  } catch (err) {
    console.error('Failed to create task:', err);
  }
}

// ─── Task Actions ───────────────────────────────────────────

async function toggleComplete(taskId) {
  try {
    const task = allTasks.find((t) => t.id === taskId);
    if (!task) return;

    if (task.status === 'completed') {
      const response = await sendMessage({
        type: 'UPDATE_TASK',
        taskId: taskId,
        data: { status: 'pending', completedAt: null },
      });
      if (response.success) {
        const idx = allTasks.findIndex((t) => t.id === taskId);
        allTasks[idx] = response.data;
        renderTasks();
      }
    } else {
      const response = await sendMessage({ type: 'COMPLETE_TASK', taskId: taskId });
      if (response.success) {
        const idx = allTasks.findIndex((t) => t.id === taskId);
        allTasks[idx] = response.data;
        renderTasks();
      }
    }
  } catch (err) {
    console.error('Failed to toggle task:', err);
  }
}

async function handleSnooze(taskId) {
  try {
    const response = await sendMessage({ type: 'SNOOZE_TASK', taskId: taskId, minutes: 10 });
    if (response.success) {
      const idx = allTasks.findIndex((t) => t.id === taskId);
      allTasks[idx] = response.data;
      renderTasks();
    }
  } catch (err) {
    console.error('Failed to snooze task:', err);
  }
}

async function handleDelete(taskId) {
  if (!confirm('Delete this task?')) return;
  try {
    const response = await sendMessage({ type: 'DELETE_TASK', taskId: taskId });
    if (response.success) {
      allTasks = allTasks.filter((t) => t.id !== taskId);
      renderTasks();
    }
  } catch (err) {
    console.error('Failed to delete task:', err);
  }
}

// ─── Task Detail ────────────────────────────────────────────

function showTaskDetail(taskId) {
  const task = allTasks.find((t) => t.id === taskId);
  if (!task) return;

  const content = $('#detail-content');
  const priorityColors = { high: 'var(--danger)', medium: 'var(--warning)', low: 'var(--success)' };
  const priorityEmojis = { high: '🔴', medium: '🟡', low: '🟢' };

  content.innerHTML = `
    <div class="detail-field">
      <div class="detail-label">Title</div>
      <div class="detail-value" style="font-weight:600; font-size:15px;">${escapeHtml(task.title)}</div>
    </div>

    ${task.description ? `
    <div class="detail-field">
      <div class="detail-label">Description</div>
      <div class="detail-value">${escapeHtml(task.description)}</div>
    </div>` : ''}

    <div class="detail-field">
      <div class="detail-label">Priority</div>
      <div class="detail-value" style="color: ${priorityColors[task.priority]}">
        ${priorityEmojis[task.priority]} ${task.priority.charAt(0).toUpperCase() + task.priority.slice(1)}
      </div>
    </div>

    <div class="detail-field">
      <div class="detail-label">Status</div>
      <div class="detail-value">${task.status === 'completed' ? '✅ Completed' : '⏳ Pending'}</div>
    </div>

    ${task.dueTime ? `
    <div class="detail-field">
      <div class="detail-label">Due</div>
      <div class="detail-value" style="color: ${task.dueTime <= Date.now() && task.status !== 'completed' ? 'var(--danger)' : 'var(--text-primary)'}">
        ${formatDateTime(task.dueTime)}
        ${task.dueTime <= Date.now() && task.status !== 'completed' ? ' (Overdue!)' : ''}
      </div>
    </div>` : ''}

    ${task.recurrence ? `
    <div class="detail-field">
      <div class="detail-label">Recurrence</div>
      <div class="detail-value">🔄 ${task.recurrence.type === 'custom' ? `Every ${task.recurrence.intervalDays} days` : task.recurrence.type.charAt(0).toUpperCase() + task.recurrence.type.slice(1)}</div>
    </div>` : ''}

    ${task.snoozedUntil && task.snoozedUntil > Date.now() ? `
    <div class="detail-field">
      <div class="detail-label">Snoozed Until</div>
      <div class="detail-value">💤 ${formatDateTime(task.snoozedUntil)}</div>
    </div>` : ''}

    <div class="detail-field">
      <div class="detail-label">Created</div>
      <div class="detail-value">${formatDateTime(task.createdAt)}</div>
    </div>

    ${task.completedAt ? `
    <div class="detail-field">
      <div class="detail-label">Completed At</div>
      <div class="detail-value">${formatDateTime(task.completedAt)}</div>
    </div>` : ''}

    <div class="detail-field">
      <div class="detail-label">Context Rules (Websites)</div>
      <div class="context-tag-list" id="detail-context-tags">
        ${(task.contextRules || []).map((r, i) => `
          <span class="context-tag" data-index="${i}">
            📍 ${escapeHtml(r.domain)}
            <span class="remove-tag" data-task-id="${task.id}" data-index="${i}">&times;</span>
          </span>
        `).join('')}
      </div>
      <div class="context-edit-row">
        <input type="text" id="detail-add-context" placeholder="e.g. github.com">
        <button class="btn btn-sm btn-primary" id="detail-add-context-btn">Add</button>
      </div>
    </div>

    <div class="detail-actions">
      ${task.status !== 'completed' ? `
        <button class="btn btn-primary" id="detail-complete">✓ Complete</button>
        <button class="btn btn-secondary" id="detail-snooze">💤 Snooze</button>
      ` : `
        <button class="btn btn-secondary" id="detail-reopen">↩ Reopen</button>
      `}
      <button class="btn btn-danger" id="detail-delete">🗑 Delete</button>
    </div>
  `;

  detailPanel.classList.remove('hidden');

  // Event: Remove context tag
  content.querySelectorAll('.remove-tag').forEach((el) => {
    el.addEventListener('click', async () => {
      const tId = el.dataset.taskId;
      const idx = parseInt(el.dataset.index);
      const t = allTasks.find((x) => x.id === tId);
      if (!t) return;
      const newRules = (t.contextRules || []).filter((_, i) => i !== idx);
      const resp = await sendMessage({ type: 'UPDATE_TASK', taskId: tId, data: { contextRules: newRules } });
      if (resp.success) {
        const tIdx = allTasks.findIndex((x) => x.id === tId);
        allTasks[tIdx] = resp.data;
        showTaskDetail(tId);
        renderTasks();
      }
    });
  });

  // Event: Add context domain
  const addCtxBtn = content.querySelector('#detail-add-context-btn');
  const addCtxInput = content.querySelector('#detail-add-context');
  if (addCtxBtn) {
    addCtxBtn.addEventListener('click', async () => {
      const domain = addCtxInput.value.trim().replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, '');
      if (!domain) return;
      const t = allTasks.find((x) => x.id === taskId);
      if (!t) return;
      const newRules = [...(t.contextRules || []), { domain }];
      const resp = await sendMessage({ type: 'UPDATE_TASK', taskId, data: { contextRules: newRules } });
      if (resp.success) {
        const tIdx = allTasks.findIndex((x) => x.id === taskId);
        allTasks[tIdx] = resp.data;
        showTaskDetail(taskId);
        renderTasks();
      }
    });
    // Also allow Enter key in the context input
    addCtxInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addCtxBtn.click();
      }
    });
  }

  // Event: Complete
  const completeBtn = content.querySelector('#detail-complete');
  if (completeBtn) {
    completeBtn.addEventListener('click', async () => {
      await toggleComplete(taskId);
      detailPanel.classList.add('hidden');
    });
  }

  // Event: Reopen
  const reopenBtn = content.querySelector('#detail-reopen');
  if (reopenBtn) {
    reopenBtn.addEventListener('click', async () => {
      await toggleComplete(taskId);
      detailPanel.classList.add('hidden');
    });
  }

  // Event: Snooze
  const snoozeDetailBtn = content.querySelector('#detail-snooze');
  if (snoozeDetailBtn) {
    snoozeDetailBtn.addEventListener('click', async () => {
      await handleSnooze(taskId);
      detailPanel.classList.add('hidden');
    });
  }

  // Event: Delete
  const deleteDetailBtn = content.querySelector('#detail-delete');
  if (deleteDetailBtn) {
    deleteDetailBtn.addEventListener('click', async () => {
      await handleDelete(taskId);
      detailPanel.classList.add('hidden');
    });
  }
}

// ─── Settings ───────────────────────────────────────────────

async function loadSettings() {
  try {
    const response = await sendMessage({ type: 'GET_PREFERENCES' });
    if (response.success) {
      const prefs = response.data;
      $('#pref-notification-style').value = prefs.notificationStyle;
      $('#pref-snooze-duration').value = prefs.snoozeDuration;
      $('#pref-context-cooldown').value = prefs.contextTriggerCooldown;
    }
  } catch (err) {
    console.error('Failed to load settings:', err);
  }
}

async function handleSaveSettings() {
  const data = {
    notificationStyle: $('#pref-notification-style').value,
    snoozeDuration: parseInt($('#pref-snooze-duration').value) || 10,
    contextTriggerCooldown: parseInt($('#pref-context-cooldown').value) || 30,
  };

  try {
    await sendMessage({ type: 'UPDATE_PREFERENCES', data });
    settingsPanel.classList.add('hidden');
  } catch (err) {
    console.error('Failed to save settings:', err);
  }
}

// ─── Context Rules Panel ────────────────────────────────────

function showContextRules() {
  const list = $('#context-rules-list');
  const tasksWithContext = allTasks.filter((t) => t.contextRules && t.contextRules.length > 0);

  if (tasksWithContext.length === 0) {
    list.innerHTML = '<p style="color: var(--text-muted); font-size: 12px;">No context rules yet. Add website domains to tasks from the task detail view (click a task to open details).</p>';
  } else {
    list.innerHTML = tasksWithContext
      .map((task) =>
        task.contextRules
          .map((rule) => `
            <div class="context-rule-item">
              <div class="context-rule-domain">
                <div class="domain">📍 ${escapeHtml(rule.domain)}</div>
                <div class="task-name">${escapeHtml(task.title)}</div>
              </div>
              <button class="btn btn-sm btn-danger context-remove" data-task-id="${task.id}" data-domain="${escapeHtml(rule.domain)}">Remove</button>
            </div>
          `)
          .join('')
      )
      .join('');

    list.querySelectorAll('.context-remove').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const taskId = btn.dataset.taskId;
        const domain = btn.dataset.domain;
        const task = allTasks.find((t) => t.id === taskId);
        if (!task) return;
        const newRules = (task.contextRules || []).filter((r) => r.domain !== domain);
        await sendMessage({ type: 'UPDATE_TASK', taskId, data: { contextRules: newRules } });
        await loadTasks();
        showContextRules();
      });
    });
  }

  contextPanel.classList.remove('hidden');
}

// ─── Message Helper ─────────────────────────────────────────

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(response || { success: false, error: 'No response' });
      });
    } catch (err) {
      reject(err);
    }
  });
}

// ─── Formatting Utilities ───────────────────────────────────

function formatDueTime(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = timestamp - Date.now();

  if (diff < 0) return 'Overdue';

  if (date.toDateString() === now.toDateString()) {
    return 'Today ' + formatTime(date);
  }

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (date.toDateString() === tomorrow.toDateString()) {
    return 'Tomorrow ' + formatTime(date);
  }

  if (diff < 7 * 24 * 60 * 60 * 1000) {
    return date.toLocaleDateString('en', { weekday: 'short' }) + ' ' + formatTime(date);
  }

  return date.toLocaleDateString('en', { month: 'short', day: 'numeric' }) + ' ' + formatTime(date);
}

function formatDateTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleDateString('en', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatRelativeTime(timestamp) {
  const diff = timestamp - Date.now();
  if (diff < 0) return 'now';
  if (diff < 60 * 1000) return 'soon';
  if (diff < 60 * 60 * 1000) return `in ${Math.ceil(diff / 60000)}m`;
  if (diff < 24 * 60 * 60 * 1000) return `in ${Math.ceil(diff / 3600000)}h`;
  return `in ${Math.ceil(diff / 86400000)}d`;
}

function formatTime(date) {
  return date.toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
