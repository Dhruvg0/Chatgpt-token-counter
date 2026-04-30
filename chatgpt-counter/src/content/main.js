// ChatGPT Counter — main.js
// Tracks TOTAL tokens used today across ALL chats, resets at midnight.
(() => {
  'use strict';

  const GC = (globalThis.GPTCounter = globalThis.GPTCounter || {});
  const ui = new GC.ui.CounterUI();
  ui.initialize();

  function estimateTokens(chars) {
    return Math.ceil((typeof chars === 'number' ? chars : (chars?.length || 0)) / 4);
  }

  function getAllMessageText() {
    const msgs = document.querySelectorAll('[data-message-author-role]');
    let total = '';
    for (const m of msgs) total += m.innerText || m.textContent || '';
    return total;
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

  // ── Daily storage helpers ─────────────────────────────────────────────────
  // Today's date string e.g. "2025-04-28"
  function todayKey() {
    return 'gc:daily:' + new Date().toISOString().slice(0, 10);
  }

  // Chat-specific key to track the last known token count per chat
  // so we can compute the DELTA when a chat grows
  function chatKey(url) {
    const match = url.match(/\/c\/([a-zA-Z0-9-]+)/);
    return match ? 'gc:chat:' + match[1] : null;
  }

  // Load daily total + all chat snapshots, call cb({ daily, chats })
  function loadState(cb) {
    const tKey = todayKey();
    chrome.storage.local.get(null, (all) => {
      // Clear old daily keys (keep only today's)
      const oldKeys = Object.keys(all).filter(
        k => k.startsWith('gc:daily:') && k !== tKey
      );
      if (oldKeys.length) chrome.storage.local.remove(oldKeys);

      cb({
        daily: all[tKey] || 0,
        chats: all, // full map, we'll look up gc:chat:* as needed
      });
    });
  }

  // ── State ──────────────────────────────────────────────────────────────────
  let navLock       = false;
  let isGenerating  = false;
  let genTimer      = null;
  let lastText      = '';
  let dailyTokens   = 0;   // running total for today
  let chatTokens    = 0;   // tokens counted for the CURRENT chat this session

  // Load persisted daily total on boot
  loadState(({ daily }) => {
    dailyTokens = daily;
    ui.setExactTokens(dailyTokens);
    setTimeout(update, 1000);
  });

  function update() {
    if (navLock) return;

    const model = detectModel();
    if (model) ui.setModel(model);

    const text    = getAllMessageText();
    if (text === lastText) return;

    const newChatTokens = estimateTokens(text.length);
    const delta         = Math.max(0, newChatTokens - chatTokens); // only add new tokens

    lastText   = text;
    chatTokens = newChatTokens;

    if (delta > 0) {
      dailyTokens += delta;
      ui.setExactTokens(dailyTokens);

      // Persist daily total
      chrome.storage.local.set({ [todayKey()]: dailyTokens });
    }
  }

  // ── MutationObserver ───────────────────────────────────────────────────────
  const observer = new MutationObserver(() => {
    if (navLock) return;
    if (genTimer) clearTimeout(genTimer);
    genTimer = setTimeout(update, 50);

    const streaming = !!document.querySelector(
      '[data-testid="stop-button"], button[aria-label="Stop streaming"]'
    );
    if (streaming !== isGenerating) {
      isGenerating = streaming;
      ui.setGenerating(streaming);
    }
  });

  observer.observe(document.body, { childList: true, subtree: true, characterData: true });

  // ── Navigation: switching chats ────────────────────────────────────────────
  // When user switches to a different chat, we need to:
  // 1. Save this chat's token count snapshot
  // 2. Load the new chat's snapshot so we know its baseline (already-counted tokens)
  let lastUrl = location.href;

  function onNavigate(newUrl) {
    // Save snapshot of chat we're leaving
    const oldCKey = chatKey(lastUrl);
    if (oldCKey) {
      chrome.storage.local.set({ [oldCKey]: chatTokens });
    }

    navLock    = true;
    lastText   = '';
    chatTokens = 0;

    // Load snapshot for the chat we're entering
    const newCKey = chatKey(newUrl);
    if (newCKey) {
      chrome.storage.local.get([newCKey], (r) => {
        // chatTokens = tokens already counted from this chat in today's daily total
        chatTokens = r[newCKey] || 0;
        setTimeout(() => {
          navLock  = false;
          lastText = '';
          update();
        }, 1200);
      });
    } else {
      // New chat page — no ID yet
      chatTokens = 0;
      setTimeout(() => {
        navLock  = false;
        lastText = '';
        update();
      }, 1200);
    }
  }

  setInterval(() => {
    if (location.href !== lastUrl) {
      const prev = lastUrl;
      lastUrl = location.href;
      onNavigate(location.href, prev);
    }
  }, 500);

  console.debug('[ChatGPT Counter] Daily usage tracker active ✓');
})();
