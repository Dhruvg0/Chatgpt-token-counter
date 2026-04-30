(() => {
  'use strict';

  const GC = (globalThis.GPTCounter = globalThis.GPTCounter || {});

  GC.DOM = Object.freeze({
    BRIDGE_SCRIPT_ID: 'gc-bridge-script',
    COUNTER_BAR_ID:   'gc-counter-bar',
  });

  GC.MODEL_LIMITS = {
    'gpt-4o':          128000,
    'gpt-4o-mini':     128000,
    'gpt-4-turbo':     128000,
    'gpt-4':            8192,
    'gpt-3.5':          16385,
    'o1':              200000,
    'o1-mini':         128000,
    'o3':              200000,
    'o3-mini':         200000,
    'o4-mini':         200000,
    'gpt-4.1':         1000000,
    'gpt-5':           1000000,
    'default':         128000,
  };

  // ── Daily token caps per plan ──────────────────────────────────────────────
  //
  // FREE:  36k  — ~10 msgs/5hrs × avg ~600 tokens/msg × 6 windows/day
  //
  // GO:    360k — OpenAI says "10x more messages than Free" (confirmed by
  //               their launch post). Free=36k → Go=36k×10=360k.
  //               Dhruv hit 300k without a wall, which fits this estimate.
  //               warn @150k (41%), strong warn @250k (69%), hard cap ~360k
  //
  // PLUS:  ~1.5M — 160 msgs/3hrs × avg ~600 tokens × 8 windows/day ≈ 768k
  //                but Plus also gets longer context & reasoning tokens;
  //                real-world heavy Plus usage tops out ~1–1.5M/day.
  //                Set at 1.5M to be safe.
  //
  // PRO:   ~5M  — OpenAI markets as "unlimited"; Pro $200/mo includes
  //               20x Plus Codex usage + o3-pro access. Practical ceiling
  //               based on continuous o3/o1-pro use is ~3–5M tokens/day.
  //               Set at 5M.

  GC.PLAN_LIMITS = {
    'free': 36_000,
    'go':   360_000,
    'plus': 1_500_000,
    'pro':  5_000_000,
  };

  // Warn/danger thresholds as ratio of plan limit
  GC.PLAN_THRESHOLDS = {
    //          warn             danger
    'free': { warn: 0.75,  danger: 0.917 }, // warn@27k    danger@33k
    'go':   { warn: 0.417, danger: 0.694 }, // warn@150k ✓ danger@250k ✓ (your spec)
    'plus': { warn: 0.50,  danger: 0.833 }, // warn@750k   danger@1.25M
    'pro':  { warn: 0.50,  danger: 0.75  }, // warn@2.5M   danger@3.75M
  };

  GC.PLAN_LABELS = {
    'free': 'Free · 36K',
    'go':   'Go · 360K',
    'plus': 'Plus · 1.5M',
    'pro':  'Pro · 5M',
  };

  GC.COLORS = Object.freeze({
    BAR_FILL:    '#0A84FF',
    BAR_WARN:    '#FF9F0A',
    BAR_DANGER:  '#FF453A',
    TEXT_LIGHT:  '#ececec',
    TEXT_DARK:   '#0d0d0d',
    BG_DARK:     '#1e1e1e',
    BG_LIGHT:    '#f7f7f8',
  });
})();
