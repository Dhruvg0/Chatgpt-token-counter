(() => {
  'use strict';
  const GC = (globalThis.GPTCounter = globalThis.GPTCounter || {});

  function estimateTokens(input) {
    if (!input) return 0;
    const len = typeof input === 'number' ? input : (input?.length || 0);
    return Math.ceil(len / 4);
  }

  function getModelFromDOM() {
    const sels = [
      '[data-testid="model-switcher-dropdown-button"]',
      'button[aria-haspopup="menu"] span',
      'nav button span',
    ];
    for (const s of sels) {
      const el = document.querySelector(s);
      if (el?.textContent?.trim()) return el.textContent.trim();
    }
    return null;
  }

  function fmt(n) {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'k';
    return String(n);
  }

  function getState(ratio, plan) {
    const t = (GC.PLAN_THRESHOLDS && GC.PLAN_THRESHOLDS[plan]) || { warn: 0.60, danger: 0.85 };
    if (ratio > t.danger) return 'danger';
    if (ratio > t.warn)   return 'warn';
    return 'ok';
  }

  const COLOR = { ok: '#0A84FF', warn: '#FF9F0A', danger: '#FF453A' };
  // Arc circumference for r=9: 2π×9 ≈ 56.55
  const CIRC = 56.55;

  class CounterUI {
    constructor() {
      this._tokens     = 0;
      this._model      = null;
      this._generating = false;
      this._plan       = 'plus';
      this._bar        = null;
      this._arcFill    = null;
      this._usedEl     = null;
      this._limitEl    = null;
      this._modelEl    = null;
      this._pctEl      = null;
      this._trackFill  = null;
      this._dotEl      = null;
    }

    initialize() {
      chrome.storage.local.get(['gc:plan'], (r) => {
        if (r['gc:plan']) this._plan = r['gc:plan'];
        this._createBar();
        this._attachBar();
      });
      const mo = new MutationObserver(() => {
        if (!document.getElementById('gc-counter-bar')) this._attachBar();
      });
      mo.observe(document.body, { childList: true, subtree: false });
    }

    _createBar() {
      const bar = document.createElement('div');
      bar.id = 'gc-counter-bar';
      bar.innerHTML = `
        <div id="gc-arc-wrap">
          <svg id="gc-arc-svg" viewBox="0 0 20 20">
            <circle id="gc-arc-track" cx="10" cy="10" r="7"/>
            <circle id="gc-arc-fill"  cx="10" cy="10" r="7"/>
          </svg>
        </div>
        <span id="gc-model-tag">—</span>
        <div id="gc-track-bg">
          <div id="gc-track-fill"></div>
        </div>
        <div id="gc-token-label">
          <span id="gc-used">0</span>
          <span id="gc-sep">/</span>
          <span id="gc-limit">—</span>
        </div>
        <span id="gc-pct-badge">0%</span>
        <div class="gc-spacer"></div>
        <select id="gc-plan-select">
          <option value="free">Free</option>
          <option value="go">Go</option>
          <option value="plus" selected>Plus</option>
          <option value="pro">Pro</option>
        </select>
        <div id="gc-pulse"></div>
      `;

      this._bar       = bar;
      this._arcFill   = bar.querySelector('#gc-arc-fill');
      this._usedEl    = bar.querySelector('#gc-used');
      this._limitEl   = bar.querySelector('#gc-limit');
      this._modelEl   = bar.querySelector('#gc-model-tag');
      this._pctEl     = bar.querySelector('#gc-pct-badge');
      this._trackFill = bar.querySelector('#gc-track-fill');
      this._dotEl     = bar.querySelector('#gc-pulse');

      const planSel = bar.querySelector('#gc-plan-select');
      planSel.value = this._plan;
      planSel.addEventListener('change', (e) => {
        this._plan = e.target.value;
        chrome.storage.local.set({ 'gc:plan': this._plan });
        this._render();
      });
    }

    _attachBar() {
      if (document.getElementById('gc-counter-bar')) return;
      const anchors = [document.querySelector('form'), document.querySelector('main'), document.body];
      for (const a of anchors) {
        if (a) { a.prepend(this._bar); break; }
      }
      this._render();
    }

    setModel(slug) { if (!slug) return; this._model = slug; this._render(); }
    setExactTokens(n) { this._tokens = n; this._render(); }
    reset() { this._tokens = 0; this._render(); }
    setGenerating(v) { this._generating = v; this._render(); }

    _render() {
      if (!this._bar) return;

      const model = this._model || getModelFromDOM();
      if (model && model !== this._model) this._model = model;

      const planLimit = GC.PLAN_LIMITS[this._plan] || 360_000;
      const used      = this._tokens;
      const ratio     = Math.min(used / planLimit, 1);
      const pct       = (ratio * 100).toFixed(1);
      const state     = getState(ratio, this._plan);
      const color     = COLOR[state];

      // Arc (r=7, circ=2π×7≈43.98)
      const arcCirc = 43.98;
      this._arcFill.style.strokeDasharray  = `${arcCirc}`;
      this._arcFill.style.strokeDashoffset = (arcCirc - ratio * arcCirc).toFixed(2);
      this._arcFill.style.stroke           = color;

      // Track
      this._trackFill.style.width      = (ratio * 100).toFixed(1) + '%';
      this._trackFill.style.background = color;

      // Values
      this._usedEl.textContent  = fmt(used);
      this._usedEl.style.color  = color;
      this._limitEl.textContent = fmt(planLimit);
      this._pctEl.textContent   = pct + '%';
      this._pctEl.style.color   = state === 'ok'
        ? 'rgba(255,255,255,0.22)'
        : color;

      // Model
      if (this._modelEl) {
        const label = this._model
          ? this._model.replace(/^ChatGPT\s*/i, '').trim() || this._model
          : '—';
        this._modelEl.textContent = label;
      }

      // Pulse
      this._dotEl.className = 'gc-pulse' + (this._generating ? ' on' : '');
    }
  }

  GC.ui = { CounterUI, estimateTokens };
})();
