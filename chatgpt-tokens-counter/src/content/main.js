// ChatGPT Counter — main.js
// Tracks TOTAL tokens used TODAY across ALL chats, resets at midnight.
//
// KEY DESIGN: We only count tokens from messages that appear AFTER we
// "settle" on a chat. Old history (including lazy-loaded scroll-up content)
// is never counted. New messages always appear at the BOTTOM of the list.
(() => {
  'use strict';

  const GC = (globalThis.GPTCounter = globalThis.GPTCounter || {});
  const ui = new GC.ui.CounterUI();
  ui.initialize();

  function estimateTokens(text) {
    return Math.ceil((text?.length || 0) / 4);
  }

  function getAllMessages() {
    return Array.from(document.querySelectorAll('[data-message-author-role]'));
  }

  function detectModel() {
    const selectors = [
      '[data-testid="model-switcher-dropdown-button"]',
      'button[aria-haspopup="listbox"] span',
      'button[aria-haspopup="menu"] span',
      '[class*="model"] button span',
      'nav button span',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      const text = el?.textContent?.trim();
      if (text && text.length > 0 && text.length < 40) return text;
    }
    return null;
  }

  // ── Storage helpers ────────────────────────────────────────────────────────
  function todayKey() {
    return 'gc:daily:' + new Date().toISOString().slice(0, 10);
  }

  function chatKey(url) {
    const match = url.match(/\/c\/([a-zA-Z0-9-]+)/);
    return match ? 'gc:chat:' + match[1] : null;
  }

  function loadDailyTotal(cb) {
    const tKey = todayKey();
    chrome.storage.local.get(null, (all) => {
      // Purge old daily keys
      const old = Object.keys(all).filter(k => k.startsWith('gc:daily:') && k !== tKey);
      if (old.length) chrome.storage.local.remove(old);
      cb(all[tKey] || 0);
    });
  }

  function saveDailyTotal(n) {
    chrome.storage.local.set({ [todayKey()]: n });
  }

  // ── State ──────────────────────────────────────────────────────────────────
  let navLock      = false;
  let isGenerating = false;
  let genTimer     = null;
  let dailyTokens  = 0;

  // After settling on a chat, we record the DOM elements that already existed.
  // Only elements that appear AFTER this set are "new" and get counted.
  let baselineElements = new Set(); // Set of DOM elements present at settle time
  // Track which new elements we've already counted (element → token count)
  let countedElements  = new Map();

  // ── Boot ───────────────────────────────────────────────────────────────────
  loadDailyTotal((daily) => {
    dailyTokens = daily;
    ui.setExactTokens(dailyTokens);

    // Settle: record all current messages as baseline (don't count them)
    setTimeout(settle, 1200);
  });

  function settle() {
    const msgs = getAllMessages();
    baselineElements = new Set(msgs);
    countedElements  = new Map();
    console.debug('[GC] Settled. Baseline:', msgs.length, 'messages (not counted)');

    const model = detectModel();
    if (model) ui.setModel(model);
  }

  // ── Update: only count messages NOT in baseline ────────────────────────────
  function update() {
    if (navLock) return;

    const model = detectModel();
    if (model) ui.setModel(model);

    const msgs = getAllMessages();
    let changed = false;

    for (const el of msgs) {
      // Skip any message that was present when we settled
      if (baselineElements.has(el)) continue;

      const text   = el.innerText || el.textContent || '';
      const tokens = estimateTokens(text);

      // If we haven't counted this element yet, or its token count grew
      // (assistant streaming), update the delta
      const prev  = countedElements.get(el) || 0;
      const delta = tokens - prev;

      if (delta > 0) {
        countedElements.set(el, tokens);
        dailyTokens += delta;
        changed = true;
        console.debug('[GC] Counted delta', delta, 'for role:', el.dataset.messageAuthorRole);
      }
    }

    if (changed) {
      ui.setExactTokens(dailyTokens);
      saveDailyTotal(dailyTokens);
    }
  }

  // ── MutationObserver ───────────────────────────────────────────────────────
  const observer = new MutationObserver(() => {
    if (navLock) return;
    if (genTimer) clearTimeout(genTimer);
    genTimer = setTimeout(update, 80);

    const streaming = !!document.querySelector(
      '[data-testid="stop-button"], button[aria-label="Stop streaming"]'
    );
    if (streaming !== isGenerating) {
      isGenerating = streaming;
      ui.setGenerating(streaming);
    }
  });

  observer.observe(document.body, { childList: true, subtree: true, characterData: true });

  // ── Navigation ─────────────────────────────────────────────────────────────
  let lastUrl = location.href;

  function onNavigate(newUrl) {
    navLock = true;

    // Save this chat's contribution before leaving
    const oldCKey = chatKey(lastUrl);
    if (oldCKey) {
      chrome.storage.local.set({ [oldCKey]: dailyTokens });
    }

    isGenerating = false;
    ui.setGenerating(false);

    // Wait for new chat DOM to settle, then re-baseline
    setTimeout(() => {
      settle();
      navLock = false;
    }, 1400);
  }

  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      onNavigate(location.href);
    }
  }, 500);

  console.debug('[ChatGPT Counter] Daily usage tracker active ✓');
})();
