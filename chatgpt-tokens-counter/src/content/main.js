// ChatGPT Counter — main.js v4.0
// Same logic as v3 (DOM-based, chat-ID gating, today-only).
// Only change: countTokens() uses real o200k_base tokenizer instead of chars/4.
// o200k_base covers gpt-4o, gpt-4o-mini, o1, o3, o4-mini, gpt-4.1, gpt-5.
(() => {
  'use strict';

  const GC = (globalThis.GPTCounter = globalThis.GPTCounter || {});
  const ui = new GC.ui.CounterUI();
  ui.initialize();

  // ── Tokenizer (o200k_base loaded before this script via manifest) ──────────
  function countTokens(text) {
    if (!text) return 0;
    const tok = globalThis.GPTTokenizer_o200k_base;
    if (tok?.countTokens) {
      try { return tok.countTokens(text); } catch { /* fall through */ }
    }
    // Fallback only if tokenizer fails to load
    return Math.ceil(text.length / 4);
  }

  // Selector-free fallback: text of the conversation area (<main>) with the
  // composer, sidebar, buttons, etc. stripped. Only growth is ever counted
  // (delta vs. a baseline), so constant UI text doesn't matter.
  const STRIP = 'form, textarea, input, select, [contenteditable], nav, aside, header, footer, button, svg, script, style, noscript, .sr-only, [class*="sr-only"], #gc-counter-bar, [data-gc-composer], [id^="thread-bottom"], [role="textbox"], .ProseMirror, [role="toolbar"], [role="menu"], [role="dialog"]';
  const BLOCKS = 'div, p, li, ul, ol, pre, h1, h2, h3, h4, h5, h6, tr, table, blockquote, section, article, br';
  const CHROME_RE = /can make mistakes|check important info/i;
  const LABEL_RE = /^(you|chatgpt) said:?$/i;
  // Whatever the user types into is the composer, however ChatGPT marks it up.
  // Tag it so its (unsent) text is excluded from counting.
  function markEditor(e) {
    try {
      const t = e.target;
      if (!t || t.nodeType !== 1 || t === document.body || t === document.documentElement) return;
      if (t.closest && t.closest('#gc-counter-bar')) return;
      const editable = t.isContentEditable || /^(TEXTAREA|INPUT)$/.test(t.tagName) || t.getAttribute('role') === 'textbox';
      if (editable) t.setAttribute('data-gc-composer', '1');
    } catch {}
  }
  for (const ev of ['focusin', 'beforeinput', 'input']) document.addEventListener(ev, markEditor, true);
  // Composer may already be focused when the script loads.
  markEditor({ target: document.activeElement });

  // Visible conversation text split into per-message segments. Each message is
  // tokenized on its own, so the line break between two messages is never
  // counted as a token (it isn't part of any message). Message starts are found
  // from ChatGPT's hidden "You said:" / "ChatGPT said:" labels, plus role/turn
  // attributes when present. If neither exists we just get one segment.
  const SEG = '\u0001';
  function threadSegments() {
    const root = document.querySelector('main, [role="main"]') || document.body;
    if (!root) return [];
    const clone = root.cloneNode(true);
    // 1) turn hidden labels into boundary markers (before .sr-only is stripped)
    clone.querySelectorAll('*').forEach((el) => {
      if (!el.children.length && LABEL_RE.test((el.textContent || '').trim())) {
        el.replaceWith(document.createTextNode(SEG));
      }
    });
    clone.querySelectorAll('[data-message-author-role], [data-testid^="conversation-turn"]')
      .forEach((el) => el.before(document.createTextNode(SEG)));
    // 2) drop everything that isn't conversation text
    clone.querySelectorAll(STRIP).forEach((el) => el.remove());
    // 3) keep block boundaries inside a message so words don't glue together
    clone.querySelectorAll(BLOCKS).forEach((el) => el.after(document.createTextNode('\n')));
    return (clone.textContent || '').split(SEG).map((seg) => {
      const t = seg.replace(/[ \t]*\n[ \t\n]*/g, '\n').trim();
      // Fixed page chrome (e.g. the disclaimer under the composer). Short lines
      // only, so real messages are never dropped.
      return t.split('\n').filter((l) => !(CHROME_RE.test(l) && l.length < 120)).join('\n').trim();
    }).filter(Boolean);
  }

  const tokensOfSegments = (segs) => segs.reduce((n, seg) => n + countTokens(seg), 0);

  // Total tokens of the visible conversation. Single method on purpose:
  // mixing methods mid-chat makes the baseline inconsistent.
  let lastText = '';
  function measureTokens() {
    const segs = threadSegments();
    return { total: tokensOfSegments(segs), count: segs.length, mode: 'text', text: segs.join('\n¦ ') };
  }

  function detectModel() {
    const sels = [
      '[data-testid="model-switcher-dropdown-button"]',
      'button[aria-haspopup="listbox"] span',
      'button[aria-haspopup="menu"] span',
    ];
    for (const s of sels) {
      const t = document.querySelector(s)?.textContent?.trim();
      if (t && t.length < 40 && !/profile|loading/i.test(t)) return t;
    }
    return null;
  }

  // ── Storage ────────────────────────────────────────────────────────────────
  // Local calendar day (resets at the user's own midnight, not UTC).
  function today() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  let currentDay = today();
  function dailyKey() { return 'gc:daily:' + currentDay; }
  function chatsKey() { return 'gc:chats:' + currentDay; }

  function getChatId(url) {
    const m = (url || location.href).match(/\/c\/([a-zA-Z0-9-]+)/);
    return m ? m[1] : null;
  }

  const VER = '4.0.11';
  const RESET_MARK = '4.0.6'; // bump only when saved counts must be wiped

  // After the extension is reloaded/updated, old content scripts lose their
  // chrome.* access. Detect that and shut this instance down quietly.
  function alive() {
    try { return !!(chrome.runtime && chrome.runtime.id); } catch { return false; }
  }

  // "4.0.10" >= "4.0.6" style comparison (missing/garbled -> false).
  function verGte(a, b) {
    const pa = String(a || '').split('.').map(Number);
    const pb = String(b || '').split('.').map(Number);
    if (pa.length < 2 || pa.some(Number.isNaN)) return false;
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const x = pa[i] || 0, y = pb[i] || 0;
      if (x !== y) return x > y;
    }
    return true;
  }

  function loadState(cb) {
    if (!alive()) return;
    chrome.storage.local.get(null, (all) => {
      const old = Object.keys(all).filter(k =>
        (k.startsWith('gc:daily:') || k.startsWith('gc:chats:')) && !k.endsWith(currentDay)
      );
      if (old.length) chrome.storage.local.remove(old);
      // One-time reset: counts saved by earlier versions were wrong
      // (0, or inflated by existing chat history), so start today clean.
      if (!verGte(all['gc:ver'], RESET_MARK)) {
        chrome.storage.local.remove([dailyKey(), chatsKey()]);
        chrome.storage.local.set({ 'gc:ver': VER });
        return cb(0, new Set());
      }
      if (all['gc:ver'] !== VER) chrome.storage.local.set({ 'gc:ver': VER });
      cb(
        all[dailyKey()] || 0,
        new Set(JSON.parse(all[chatsKey()] || '[]'))
      );
    });
  }

  // All tabs share one total in chrome.storage. Writes are read-modify-write
  // under a cross-tab lock (Web Locks), so two tabs never overwrite each other.
  function withLock(fn) {
    try {
      if (navigator.locks && navigator.locks.request) {
        return navigator.locks.request('gc-storage', fn);
      }
    } catch { /* fall through */ }
    return fn();
  }

  function persistAdd(delta, chatId) {
    if (!alive()) return;
    const dk = dailyKey(), ck = chatsKey();
    withLock(() => new Promise((resolve) => {
      try {
        chrome.storage.local.get([dk, ck], (r) => {
          try {
            const out = {};
            if (delta) out[dk] = (r[dk] || 0) + delta;
            if (chatId) {
              const set = new Set(JSON.parse(r[ck] || '[]'));
              set.add(chatId);
              out[ck] = JSON.stringify([...set]);
            }
            chrome.storage.local.set(out, resolve);
          } catch { resolve(); }
        });
      } catch { resolve(); }
    }));
  }

  // Keep this tab's display in sync with writes made by other tabs.
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes[dailyKey()]) {
        dailyTokens = changes[dailyKey()].newValue || 0;
        ui.setExactTokens(dailyTokens);
      }
      if (changes[chatsKey()]) {
        try { todayChats = new Set(JSON.parse(changes[chatsKey()].newValue || '[]')); } catch {}
      }
    });
  } catch { /* stale instance */ }

  // New local day (e.g. tab left open past midnight): start from zero.
  function checkDayRollover() {
    const t = today();
    if (t === currentDay) return;
    const oldKeys = ['gc:daily:' + currentDay, 'gc:chats:' + currentDay];
    currentDay = t;
    dailyTokens = 0;
    todayChats = new Set();
    ui.setExactTokens(0);
    try { if (alive()) chrome.storage.local.remove(oldKeys); } catch {}
    console.log('[GC] new day — counter reset');
  }

  // ── State ──────────────────────────────────────────────────────────────────
  // Core rule: history is NEVER counted. While `armed` is false we only track
  // a baseline (whatever is on screen). Counting starts when a message is sent
  // in the current chat (armed = true) and only counts growth beyond baseline.
  let dailyTokens   = 0;
  let todayChats    = new Set();
  let armed         = false;
  let chatMsgTokens = 0;
  let isGenerating  = false;

  loadState((tokens, chats) => {
    dailyTokens = tokens;
    todayChats  = chats;
    ui.setExactTokens(dailyTokens);
    onUrlChange();
  });

  function registerChat(id) {
    if (!id || todayChats.has(id)) return false;
    todayChats.add(id);
    persistAdd(0, id);
    console.log('[GC] New today-chat registered:', id);
    return true;
  }

  function arm(reason) {
    if (armed) return;
    // Baseline = last tracked history snapshot. If we never got one
    // (sent immediately after load), take one now.
    if (chatMsgTokens === 0) snapBaseline();
    armed = true;
    setDebug(`armed (${reason}), baseline ${chatMsgTokens}`);
    console.log(`[GC] armed (${reason}) — baseline ${chatMsgTokens} tokens not counted`);
  }

  function setDebug(msg) {
    try {
      const bar = document.getElementById('gc-counter-bar');
      if (bar) bar.title = `ChatGPT Counter v${VER} — ${msg}`;
    } catch {}
  }

  // Baseline for a brand-new chat: all text currently on screen EXCEPT the
  // prompt just sent (which must be counted). Fixed page text stays in the
  // baseline; text that disappears later just lowers it (see update()).
  function newChatBaseline(prompt) {
    const segs = threadSegments();
    let total = tokensOfSegments(segs);
    const norm = String(prompt || '').replace(/[ \t]*\n[ \t\n]*/g, '\n').trim();
    if (norm && segs.some((x) => x.includes(norm))) total = Math.max(0, total - countTokens(norm));
    return total;
  }

  function snapBaseline() {
    const m = measureTokens();
    chatMsgTokens = m.total;
    lastText = m.text;
  }

  // ── Count growth beyond baseline (only when armed) ─────────────────────────
  function update() {
    checkDayRollover();
    if (!armed) return;

    const model = detectModel();
    if (model) ui.setModel(model);

    const { total, count, mode, text } = measureTokens();
    if (total < chatMsgTokens) {
      lastText = text;
      // Text shrank (e.g. a "Thinking…" block collapsed, old turns unloaded).
      // Follow it down so counting never stalls waiting to exceed an old peak.
      chatMsgTokens = total;
      return;
    }
    const delta = total - chatMsgTokens;
    if (delta === 0) return;
    let i = 0; const max = Math.min(lastText.length, text.length);
    while (i < max && lastText.charCodeAt(i) === text.charCodeAt(i)) i++;
    console.log(`[GC] +${delta} total=${total} baseline=${chatMsgTokens} added: ${JSON.stringify(text.slice(i, i + 80))}`);
    lastText = text;

    chatMsgTokens = total;
    dailyTokens  += delta;           // optimistic; storage.onChanged reconciles
    setDebug(`armed · +${delta} · text=${total} tokens`);
    ui.setExactTokens(dailyTokens);
    persistAdd(delta, null);
  }

  // Throttled baseline tracking while not armed (history loading in).
  let trackTimer = null;
  function scheduleTrack() {
    if (trackTimer || !getChatId()) return;
    trackTimer = setTimeout(() => {
      trackTimer = null;
      if (!armed) snapBaseline();
    }, 800);
  }

  // ── URL / chat change ──────────────────────────────────────────────────────
  let lastUrl = location.href;
  let lastSendAt = 0;
  let sendFromHome = false;   // last send happened from "/" (i.e. a brand-new chat)
  let pendingBase  = 0;       // baseline for that new chat: fixed page text, minus the prompt
  const recentlySent = () => Date.now() - lastSendAt < 120000;

  function onUrlChange() {
    armed = false;
    chatMsgTokens = 0;
    scheduleTrack();
    const model = detectModel();
    if (model) ui.setModel(model);
  }

  function handleUrlChange() {
    lastUrl = location.href;
    const newId = getChatId();
    if (newId && ((recentlySent() && sendFromHome) || (!todayChats.has(newId) && isGenerating))) {
      // Brand-new chat: URL became /c/<id> because we just sent a message.
      // The whole thread (prompt + reply) is new, so the baseline is 0.
      sendFromHome = false;
      registerChat(newId);
      if (!armed) {
        chatMsgTokens = pendingBase;
        pendingBase = 0;
        armed = true;
        setDebug('armed (new chat)');
        console.log('[GC] armed (new chat) — baseline', chatMsgTokens);
      }
    } else {
      onUrlChange();
    }
  }

  // ── MutationObserver ───────────────────────────────────────────────────────
  let updateTimer = null;
  const observer = new MutationObserver(() => {
    if (!alive()) { shutdown(); return; }
    checkDayRollover();
    const streaming = !!document.querySelector(
      '[data-testid="stop-button"], button[aria-label^="Stop"]'
    );
    if (streaming !== isGenerating) {
      isGenerating = streaming;
      ui.setGenerating(streaming);
      if (streaming) {
        const id = getChatId();
        if (id) { registerChat(id); arm('generation started'); }
      }
    }

    if (location.href !== lastUrl) handleUrlChange();

    if (armed) {
      if (updateTimer) clearTimeout(updateTimer);
      updateTimer = setTimeout(update, 100);
    } else {
      scheduleTrack();
    }
  });

  observer.observe(document.body, { childList: true, subtree: true, characterData: true });

  const urlPoll = setInterval(() => {
    if (!alive()) { shutdown(); return; }
    checkDayRollover();
    if (location.href !== lastUrl) handleUrlChange();
  }, 500);

  function shutdown() {
    try {
      const tag = document.getElementById('gc-model-tag');
      if (tag) tag.textContent = 'refresh page';
      const bar = document.getElementById('gc-counter-bar');
      if (bar) bar.title = 'ChatGPT Counter was reloaded/updated. Refresh this tab (Ctrl+Shift+R) to resume counting.';
    } catch {}
    observer.disconnect();
    clearInterval(urlPoll);
    clearTimeout(updateTimer);
    clearTimeout(trackTimer);
  }

  // ── Send detection (from fetch bridge) ─────────────────────────────────────
  // A POST to /backend-api/(f/)conversation = a message was just sent.
  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.gc !== 'GCBridge') return;
    if (d.type === 'gc:model' && d.payload?.model) ui.setModel(d.payload.model);
    if (d.type === 'gc:send') {
      console.log('[GC] send detected, chat id:', getChatId());
      lastSendAt = Date.now();
      const fromHome = !/\/c\/[\w-]+/.test(d.payload?.path || '');
      const id = getChatId();
      if (fromHome) {
        // Brand-new chat: everything in it is new, so don't snapshot a baseline
        // (it would swallow the prompt). If the URL is still "/", handleUrlChange()
        // arms it once the URL becomes /c/<id>.
        pendingBase = newChatBaseline(d.payload?.prompt || '');
        sendFromHome = true;
        if (id) {
          sendFromHome = false;
          registerChat(id);
          if (!armed) { chatMsgTokens = pendingBase; pendingBase = 0; armed = true; setDebug('armed (new chat)'); }
        }
      } else if (id) {
        registerChat(id);
        arm('message sent');
      }
    }
  });

  // Double-click the token count to set today's total by hand.
  document.addEventListener('dblclick', (e) => {
    try {
      if (!(e.target.closest && e.target.closest('#gc-token-label'))) return;
      const v = window.prompt("Set today's token total:", String(dailyTokens));
      if (v === null) return;
      const n = Math.max(0, Math.floor(Number(String(v).replace(/[,_\s]/g, ''))));
      if (!Number.isFinite(n)) return;
      dailyTokens = n;
      ui.setExactTokens(n);
      if (alive()) chrome.storage.local.set({ [dailyKey()]: n });
    } catch {}
  });

  console.log('[GC] v4.0.11 active');
})();
