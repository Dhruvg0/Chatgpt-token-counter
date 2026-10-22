// ChatGPT Counter — bridge-client.js
// Runs at document_start in ISOLATED world.
// Injects bridge.js into MAIN world and sets up the event relay.
(() => {
  'use strict';

  const GC = (globalThis.GPTCounter = globalThis.GPTCounter || {});
  if (GC.__bridgeStarted) return;
  GC.__bridgeStarted = true;

  // ── Event bus (used by main.js) ───────────────────────────────────────────
  const listeners = new Map();

  GC.bridge = {
    on(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    off(type, fn) {
      listeners.get(type)?.delete(fn);
    },
  };

  // ── Relay MAIN world → ISOLATED world ────────────────────────────────────
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.gc !== 'GCBridge') return;
    const fns = listeners.get(data.type);
    if (!fns) return;
    for (const fn of fns) {
      try { fn(data.payload); } catch (e) { console.error('[GC bridge relay]', e); }
    }
  });

  // ── Inject bridge.js into MAIN world ─────────────────────────────────────
  // Use a synchronous script injection so fetch is wrapped BEFORE
  // ChatGPT's own scripts make any requests.
  function inject() {
    if (document.getElementById('gc-bridge-script')) return;
    const s = document.createElement('script');
    s.id  = 'gc-bridge-script';
    s.src = chrome.runtime.getURL('src/injected/bridge.js');
    s.onload  = () => console.debug('[GC] bridge.js injected ✓');
    s.onerror = () => console.error('[GC] bridge.js failed to load');
    // Prepend to <head> or <html> — runs before body scripts
    (document.head || document.documentElement).prepend(s);
  }

  // document_start: document may not have <head> yet, so use documentElement
  if (document.readyState === 'loading') {
    inject(); // inject immediately at document_start
  } else {
    inject();
  }
})();
