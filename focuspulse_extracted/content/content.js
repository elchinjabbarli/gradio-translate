/**
 * FocusPulse — Content Script
 * Runs on every page. Detects current domain and communicates with background.
 * Lightweight — minimal footprint per page.
 */

(function () {
  'use strict';

  // Only run once per page
  if (window.__focusPulseContentLoaded) return;
  window.__focusPulseContentLoaded = true;

  // ─── Domain Detection ─────────────────────────────────────

  function getCurrentDomain() {
    return window.location.hostname.replace(/^www\./, '');
  }

  // ─── Communication with Background ────────────────────────

  function notifyBackground(domain) {
    try {
      chrome.runtime.sendMessage({
        type: 'CONTENT_DOMAIN_UPDATE',
        domain: domain,
        url: window.location.href,
      });
    } catch (err) {
      // Extension context may be invalidated - silently ignore
    }
  }

  // ─── Initialize ───────────────────────────────────────────

  const currentDomain = getCurrentDomain();

  if (currentDomain) {
    // Notify background about current domain (useful for immediate context check)
    notifyBackground(currentDomain);
  }

  // ─── Subtle Overlay for Context Reminders ─────────────────
  // Background can request to show a subtle non-blocking overlay

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'SHOW_CONTEXT_OVERLAY') {
      showContextOverlay(message.task);
      sendResponse({ success: true });
    }

    if (message.type === 'HIDE_CONTEXT_OVERLAY') {
      hideContextOverlay();
      sendResponse({ success: true });
    }
  });

  function showContextOverlay(task) {
    // Remove existing overlay if any
    hideContextOverlay();

    const overlay = document.createElement('div');
    overlay.id = 'focuspulse-overlay';
    overlay.innerHTML = `
      <div class="fp-container">
        <div class="fp-icon">📍</div>
        <div class="fp-content">
          <div class="fp-title">${escapeHtml(task.title)}</div>
          ${task.description ? `<div class="fp-desc">${escapeHtml(task.description)}</div>` : ''}
        </div>
        <div class="fp-actions">
          <button class="fp-btn fp-complete" data-task-id="${task.id}">✓</button>
          <button class="fp-btn fp-dismiss">&times;</button>
        </div>
      </div>
    `;

    // Inline styles (can't load external CSS from content script easily)
    overlay.style.cssText = `
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 2147483647;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      pointer-events: auto;
      animation: fp-slide-in 0.3s ease-out;
    `;

    const container = overlay.querySelector('.fp-container');
    container.style.cssText = `
      display: flex;
      align-items: center;
      gap: 12px;
      background: #1a1a2e;
      color: #eee;
      padding: 12px 16px;
      border-radius: 10px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.3);
      max-width: 360px;
      border-left: 3px solid ${task.priority === 'high' ? '#ef4444' : task.priority === 'medium' ? '#f59e0b' : '#22c55e'};
    `;

    const icon = overlay.querySelector('.fp-icon');
    icon.style.cssText = `font-size: 20px; flex-shrink: 0;`;

    const content = overlay.querySelector('.fp-content');
    content.style.cssText = `flex: 1; min-width: 0;`;

    const title = overlay.querySelector('.fp-title');
    title.style.cssText = `font-weight: 600; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`;

    const desc = overlay.querySelector('.fp-desc');
    if (desc) {
      desc.style.cssText = `font-size: 12px; color: #aaa; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`;
    }

    const actions = overlay.querySelector('.fp-actions');
    actions.style.cssText = `display: flex; gap: 6px; flex-shrink: 0;`;

    const buttons = overlay.querySelectorAll('.fp-btn');
    buttons.forEach((btn) => {
      btn.style.cssText = `
        border: none;
        cursor: pointer;
        width: 28px;
        height: 28px;
        border-radius: 6px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 14px;
        transition: background 0.15s;
      `;
    });

    const completeBtn = overlay.querySelector('.fp-complete');
    completeBtn.style.background = '#22c55e33';
    completeBtn.style.color = '#22c55e';

    const dismissBtn = overlay.querySelector('.fp-dismiss');
    dismissBtn.style.background = '#ffffff1a';
    dismissBtn.style.color = '#aaa';

    // Add animation keyframes
    if (!document.getElementById('focuspulse-styles')) {
      const style = document.createElement('style');
      style.id = 'focuspulse-styles';
      style.textContent = `
        @keyframes fp-slide-in {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        #focuspulse-overlay .fp-btn:hover {
          filter: brightness(1.3);
        }
      `;
      document.head.appendChild(style);
    }

    // Event handlers
    completeBtn.addEventListener('click', () => {
      try {
        chrome.runtime.sendMessage({ type: 'COMPLETE_TASK', taskId: task.id });
      } catch (e) {}
      hideContextOverlay();
    });

    dismissBtn.addEventListener('click', () => {
      hideContextOverlay();
    });

    document.body.appendChild(overlay);

    // Auto-dismiss after 10 seconds
    setTimeout(() => {
      hideContextOverlay();
    }, 10000);
  }

  function hideContextOverlay() {
    const existing = document.getElementById('focuspulse-overlay');
    if (existing) {
      existing.remove();
    }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
})();
