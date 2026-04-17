/**
 * FocusPulse — Background Service Worker
 * Handles: time-based reminders, context detection, notifications, alarms
 */

// Import storage (shared with popup via chrome.storage)
importScripts('../shared/storage.js');

// ─── Session Management ─────────────────────────────────────
// A "session" resets when the service worker restarts or browser restarts
let _sessionId = null;

function getSessionId() {
  if (!_sessionId) {
    _sessionId = 'sess_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }
  return _sessionId;
}

// ─── Initialization ─────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async () => {
  console.log('[FocusPulse] Extension installed/updated');
  await setupAlarms();
  // Initialize default preferences if not set
  const prefs = await storage.getPreferences();
  await storage.updatePreferences(prefs);
});

chrome.runtime.onStartup.addListener(async () => {
  console.log('[FocusPulse] Browser started');
  _sessionId = null; // Reset session on browser restart
  await setupAlarms();
});

async function setupAlarms() {
  // Clear existing alarms
  await chrome.alarms.clearAll();

  // Check due tasks every 1 minute
  chrome.alarms.create('checkDueTasks', { periodInMinutes: 1 });

  // Check context every 1 minute (Manifest V3 minimum periodInMinutes is 1)
  chrome.alarms.create('checkContext', { periodInMinutes: 1 });

  // Clean up old triggered records every 30 minutes
  chrome.alarms.create('cleanup', { periodInMinutes: 30 });

  console.log('[FocusPulse] Alarms set up');
}

// ─── Alarm Handler ──────────────────────────────────────────

chrome.alarms.onAlarm.addListener(async (alarm) => {
  switch (alarm.name) {
    case 'checkDueTasks':
      await checkTimeBasedReminders();
      break;
    case 'checkContext':
      await checkContextualReminders();
      break;
    case 'cleanup':
      // Triggered cleanup is handled inside storage.markTriggered
      break;
  }
});

// ─── Time-Based Reminders ───────────────────────────────────

async function checkTimeBasedReminders() {
  try {
    const dueTasks = await storage.getDueTasks();
    const sessionId = getSessionId();

    for (const task of dueTasks) {
      // Check if already triggered this session
      const alreadyTriggered = await storage.wasTriggered(task.id, 'time', sessionId);
      if (alreadyTriggered) continue;

      // Check if snoozed
      if (task.snoozedUntil && task.snoozedUntil > Date.now()) continue;

      await showTaskNotification(task, 'time');
      await storage.markTriggered(task.id, 'time', sessionId);
    }
  } catch (err) {
    console.error('[FocusPulse] Error checking time reminders:', err);
  }
}

// ─── Context-Based Reminders ────────────────────────────────

async function checkContextualReminders() {
  try {
    // Get active tab
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs || tabs.length === 0) return;

    const activeTab = tabs[0];
    if (!activeTab.url) return;

    const domain = extractDomain(activeTab.url);
    if (!domain) return;

    // Get tasks with matching context rules
    const contextTasks = await storage.getContextTasks(domain);
    const sessionId = getSessionId();
    const prefs = await storage.getPreferences();

    for (const task of contextTasks) {
      const alreadyTriggered = await storage.wasTriggered(task.id, 'context', sessionId);
      if (alreadyTriggered) continue;

      // Check cooldown: was this task triggered recently (even in another session)?
      const triggered = await storage.getTriggered();
      const recentContextTrigger = triggered.find(
        (t) =>
          t.taskId === task.id &&
          t.triggerType === 'context' &&
          t.triggeredAt > Date.now() - prefs.contextTriggerCooldown * 60 * 1000
      );
      if (recentContextTrigger) continue;

      await showTaskNotification(task, 'context');
      await storage.markTriggered(task.id, 'context', sessionId);

      // Also try to show content overlay on the active tab
      try {
        await chrome.tabs.sendMessage(activeTab.id, {
          type: 'SHOW_CONTEXT_OVERLAY',
          task: task,
        });
      } catch (e) {
        // Content script may not be injected yet - that's fine
      }
    }
  } catch (err) {
    console.error('[FocusPulse] Error checking context reminders:', err);
  }
}

// ─── Notification System ────────────────────────────────────

async function showTaskNotification(task, triggerType) {
  const prefs = await storage.getPreferences();

  const iconUrl = chrome.runtime ? chrome.runtime.getURL('icons/icon128.png') : '';

  const priorityLabel = task.priority === 'high' ? '🔴 ' : task.priority === 'medium' ? '🟡 ' : '🟢 ';
  const contextLabel = triggerType === 'context' ? '📍 Context Alert' : '⏰ Reminder';

  const notificationId = `fp_notify_${task.id}_${triggerType}`;

  const buttons = [
    { title: '✓ Complete' },
    { title: '⏳ Snooze' },
  ];

  const notificationOptions = {
    type: 'basic',
    iconUrl: iconUrl,
    title: `${priorityLabel}${task.title}`,
    message: task.description || `Task due now`,
    contextMessage: contextLabel,
    priority: task.priority === 'high' ? 2 : task.priority === 'medium' ? 1 : 0,
    buttons: buttons,
    requireInteraction: prefs.notificationStyle === 'persistent',
  };

  try {
    await chrome.notifications.create(notificationId, notificationOptions);
  } catch (err) {
    // Fallback without buttons/contextMessage if there's an issue
    try {
      await chrome.notifications.create(notificationId, {
        type: 'basic',
        iconUrl: iconUrl,
        title: `${priorityLabel}${task.title}`,
        message: task.description || `Task due now`,
      });
    } catch (err2) {
      console.error('[FocusPulse] Notification failed:', err2);
    }
  }
}

// ─── Notification Action Handlers ───────────────────────────
// notificationId format: fp_notify_{taskId}_{triggerType}
// taskId format: fp_{timestamp36}_{random6} — contains underscores
// So we need to extract taskId from between "fp_notify_" and the last "_{triggerType}"

function parseNotificationId(notificationId) {
  // Remove prefix "fp_notify_"
  const withoutPrefix = notificationId.startsWith('fp_notify_')
    ? notificationId.slice('fp_notify_'.length)
    : notificationId;

  // triggerType is either "time" or "context" — known suffixes
  const triggerTypes = ['time', 'context'];
  for (const tt of triggerTypes) {
    const suffix = '_' + tt;
    if (withoutPrefix.endsWith(suffix)) {
      return {
        taskId: withoutPrefix.slice(0, withoutPrefix.length - suffix.length),
        triggerType: tt,
      };
    }
  }
  // Fallback: assume last part is triggerType
  const lastUnderscore = withoutPrefix.lastIndexOf('_');
  return {
    taskId: withoutPrefix.slice(0, lastUnderscore),
    triggerType: withoutPrefix.slice(lastUnderscore + 1),
  };
}

chrome.notifications.onButtonClicked.addListener(async (notificationId, buttonIndex) => {
  const { taskId } = parseNotificationId(notificationId);

  if (buttonIndex === 0) {
    // Complete
    await storage.completeTask(taskId);
    await storage.clearTriggeredForTask(taskId);
  } else if (buttonIndex === 1) {
    // Snooze
    const prefs = await storage.getPreferences();
    await storage.snoozeTask(taskId, prefs.snoozeDuration);
  }

  chrome.notifications.clear(notificationId);
});

chrome.notifications.onClicked.addListener(async (notificationId) => {
  // Just clear the notification - user can manage from popup
  chrome.notifications.clear(notificationId);
});

chrome.notifications.onClosed.addListener(async (notificationId, byUser) => {
  // Dismissed - no action needed
});

// ─── Tab Change Detection ───────────────────────────────────
// Also check context when user switches tabs (in addition to alarm)

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  // Small delay to let the tab load
  setTimeout(async () => {
    await checkContextualReminders();
  }, 2000);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.active) {
    setTimeout(async () => {
      await checkContextualReminders();
    }, 1000);
  }
});

// ─── Message Handling (from popup & content scripts) ────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender, sendResponse);
  return true; // Keep channel open for async response
});

async function handleMessage(message, sender, sendResponse) {
  try {
    switch (message.type) {
      case 'GET_TASKS':
        const tasks = await storage.getAllTasks();
        sendResponse({ success: true, data: tasks });
        break;

      case 'CREATE_TASK':
        const newTask = await storage.createTask(message.data);
        sendResponse({ success: true, data: newTask });
        break;

      case 'UPDATE_TASK':
        const updated = await storage.updateTask(message.taskId, message.data);
        sendResponse({ success: true, data: updated });
        break;

      case 'DELETE_TASK':
        await storage.deleteTask(message.taskId);
        sendResponse({ success: true });
        break;

      case 'COMPLETE_TASK':
        const completed = await storage.completeTask(message.taskId);
        sendResponse({ success: true, data: completed });
        break;

      case 'SNOOZE_TASK':
        const prefs = await storage.getPreferences();
        const snoozed = await storage.snoozeTask(message.taskId, message.minutes || prefs.snoozeDuration);
        sendResponse({ success: true, data: snoozed });
        break;

      case 'GET_PREFERENCES':
        const preferences = await storage.getPreferences();
        sendResponse({ success: true, data: preferences });
        break;

      case 'UPDATE_PREFERENCES':
        const newPrefs = await storage.updatePreferences(message.data);
        sendResponse({ success: true, data: newPrefs });
        break;

      case 'CHECK_CONTEXT_NOW':
        await checkContextualReminders();
        sendResponse({ success: true });
        break;

      case 'GET_ACTIVE_DOMAIN':
        const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (activeTabs.length > 0 && activeTabs[0].url) {
          const domain = extractDomain(activeTabs[0].url);
          sendResponse({ success: true, data: domain });
        } else {
          sendResponse({ success: true, data: null });
        }
        break;

      case 'CONTENT_DOMAIN_UPDATE':
        // Content script notifies us of the current domain — trigger context check
        if (message.domain) {
          // Don't await, just fire and let alarm-based check handle it
          checkContextualReminders();
        }
        sendResponse({ success: true });
        break;

      default:
        sendResponse({ success: false, error: 'Unknown message type' });
    }
  } catch (err) {
    console.error('[FocusPulse] Message handler error:', err);
    sendResponse({ success: false, error: err.message });
  }
}

// ─── Utility ────────────────────────────────────────────────

function extractDomain(url) {
  try {
    const urlObj = new URL(url);
    // Return hostname without www. prefix
    return urlObj.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}
