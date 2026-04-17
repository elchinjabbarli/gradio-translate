/**
 * FocusPulse — Storage Layer
 * Handles all local data persistence using chrome.storage.local
 * No external dependencies. Fully offline.
 */

const STORAGE_KEYS = {
  TASKS: 'fp_tasks',
  TRIGGERED: 'fp_triggered',
  PREFERENCES: 'fp_preferences',
};

class StorageManager {
  constructor() {
    this._cache = null;
  }

  // ─── Generic Helpers ───────────────────────────────────────

  async _get(key) {
    return new Promise((resolve) => {
      chrome.storage.local.get(key, (result) => {
        resolve(result[key] ?? null);
      });
    });
  }

  async _set(key, value) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [key]: value }, resolve);
    });
  }

  // ─── Tasks ─────────────────────────────────────────────────

  async getAllTasks() {
    const tasks = await this._get(STORAGE_KEYS.TASKS);
    return tasks || [];
  }

  async getTask(taskId) {
    const tasks = await this.getAllTasks();
    return tasks.find((t) => t.id === taskId) || null;
  }

  async createTask(taskData) {
    const tasks = await this.getAllTasks();
    const task = {
      id: this._generateId(),
      title: taskData.title || 'Untitled Task',
      description: taskData.description || '',
      createdAt: Date.now(),
      dueTime: taskData.dueTime || null,
      priority: taskData.priority || 'medium', // low | medium | high
      status: 'pending', // pending | completed
      recurrence: taskData.recurrence || null, // { type: 'daily'|'weekly'|'custom', intervalDays?: number, weekDay?: number }
      contextRules: taskData.contextRules || [], // [{ domain: 'linkedin.com' }]
      snoozedUntil: null,
      completedAt: null,
    };
    tasks.push(task);
    await this._set(STORAGE_KEYS.TASKS, tasks);
    return task;
  }

  async updateTask(taskId, updates) {
    const tasks = await this.getAllTasks();
    const idx = tasks.findIndex((t) => t.id === taskId);
    if (idx === -1) return null;
    tasks[idx] = { ...tasks[idx], ...updates };
    await this._set(STORAGE_KEYS.TASKS, tasks);
    return tasks[idx];
  }

  async deleteTask(taskId) {
    const tasks = await this.getAllTasks();
    const filtered = tasks.filter((t) => t.id !== taskId);
    await this._set(STORAGE_KEYS.TASKS, filtered);
    // Also clean up triggered records for this task
    const triggered = await this.getTriggered();
    const cleaned = triggered.filter((t) => t.taskId !== taskId);
    await this._set(STORAGE_KEYS.TRIGGERED, cleaned);
    return true;
  }

  async completeTask(taskId) {
    const task = await this.getTask(taskId);
    if (!task) return null;

    if (task.recurrence) {
      // For recurring tasks, compute next due time instead of completing
      const nextDue = this._computeNextDue(task);
      return await this.updateTask(taskId, {
        dueTime: nextDue,
        snoozedUntil: null,
        status: 'pending',
      });
    }

    return await this.updateTask(taskId, {
      status: 'completed',
      completedAt: Date.now(),
      snoozedUntil: null,
    });
  }

  async snoozeTask(taskId, minutes = 10) {
    return await this.updateTask(taskId, {
      snoozedUntil: Date.now() + minutes * 60 * 1000,
    });
  }

  async getPendingTasks() {
    const tasks = await this.getAllTasks();
    const now = Date.now();
    return tasks.filter(
      (t) =>
        t.status === 'pending' &&
        (!t.snoozedUntil || t.snoozedUntil <= now)
    );
  }

  async getDueTasks() {
    const pending = await this.getPendingTasks();
    const now = Date.now();
    return pending.filter((t) => t.dueTime && t.dueTime <= now);
  }

  async getContextTasks(domain) {
    const pending = await this.getPendingTasks();
    return pending.filter((t) =>
      t.contextRules.some((rule) => this._domainMatches(domain, rule.domain))
    );
  }

  /**
   * Check if the current browsing domain matches a rule domain.
   * Exact match or subdomain match: rule "linkedin.com" matches "linkedin.com" or "www.linkedin.com"
   * but NOT "evillinkedin.com".
   */
  _domainMatches(currentDomain, ruleDomain) {
    if (currentDomain === ruleDomain) return true;
    if (currentDomain.endsWith('.' + ruleDomain)) return true;
    return false;
  }

  // ─── Triggered Records (prevent spam) ─────────────────────

  async getTriggered() {
    const triggered = await this._get(STORAGE_KEYS.TRIGGERED);
    return triggered || [];
  }

  async wasTriggered(taskId, triggerType, sessionId) {
    const triggered = await this.getTriggered();
    return triggered.some(
      (t) =>
        t.taskId === taskId &&
        t.triggerType === triggerType &&
        t.sessionId === sessionId
    );
  }

  async markTriggered(taskId, triggerType, sessionId) {
    const triggered = await this.getTriggered();
    triggered.push({
      taskId,
      triggerType, // 'time' | 'context'
      sessionId,
      triggeredAt: Date.now(),
    });
    // Clean up old records (older than 24h) to prevent unbounded growth
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const cleaned = triggered.filter((t) => t.triggeredAt >= cutoff);
    await this._set(STORAGE_KEYS.TRIGGERED, cleaned);
  }

  async clearTriggeredForTask(taskId) {
    const triggered = await this.getTriggered();
    const cleaned = triggered.filter((t) => t.taskId !== taskId);
    await this._set(STORAGE_KEYS.TRIGGERED, cleaned);
  }

  // ─── Preferences ──────────────────────────────────────────

  async getPreferences() {
    const prefs = await this._get(STORAGE_KEYS.PREFERENCES);
    return (
      prefs || {
        notificationStyle: 'standard', // soft | standard | persistent
        snoozeDuration: 10, // minutes
        contextTriggerCooldown: 30, // minutes between same context trigger
      }
    );
  }

  async updatePreferences(updates) {
    const current = await this.getPreferences();
    const merged = { ...current, ...updates };
    await this._set(STORAGE_KEYS.PREFERENCES, merged);
    return merged;
  }

  // ─── Utility ──────────────────────────────────────────────

  _generateId() {
    return 'fp_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  _computeNextDue(task) {
    if (!task.recurrence || !task.dueTime) return null;
    const due = new Date(task.dueTime);
    switch (task.recurrence.type) {
      case 'daily':
        due.setDate(due.getDate() + 1);
        break;
      case 'weekly':
        due.setDate(due.getDate() + 7);
        break;
      case 'custom':
        due.setDate(due.getDate() + (task.recurrence.intervalDays || 1));
        break;
    }
    return due.getTime();
  }
}

// Singleton
const storage = new StorageManager();
