// ChatGPT Counter — bridge.js
// Injected into MAIN world at document_start to wrap window.fetch early.
(() => {
  'use strict';

  const MARKER = 'GCBridge';
  const originalFetch = window.fetch;

  // Wrap history for SPA nav detection
  const origPush    = history.pushState.bind(history);
  const origReplace = history.replaceState.bind(history);
  history.pushState = function (...args) {
    const r = origPush(...args);
    window.dispatchEvent(new CustomEvent('gc:urlchange'));
    return r;
  };
  history.replaceState = function (...args) {
    const r = origReplace(...args);
    window.dispatchEvent(new CustomEvent('gc:urlchange'));
    return r;
  };

  function post(type, payload) {
    window.postMessage({ gc: MARKER, type, payload }, '*');
  }

  function resolveUrl(input) {
    if (typeof input === 'string') return input;
    if (input instanceof URL)     return input.href;
    if (input instanceof Request) return input.url;
    return '';
  }

  // ChatGPT completions: /backend-api/conversation (old) and
  // /backend-api/f/conversation (current). Anything else is not a send.
  const CONVO_RE = /\/backend-api\/(?:f\/)?conversation(?:[?#]|$)/;

  function resolveMethod(args) {
    const init = args[1];
    if (init && init.method) return String(init.method).toUpperCase();
    if (args[0] instanceof Request) return args[0].method.toUpperCase();
    return 'GET';
  }

  // User prompt text from the request body (used only to compute a clean
  // baseline for new chats; never stored or sent anywhere).
  function extractPrompt(args) {
    try {
      const body = args[1] && args[1].body;
      if (typeof body !== 'string') return '';
      const j = JSON.parse(body);
      const out = [];
      for (const m of (j.messages || [])) {
        if (m && m.author && m.author.role === 'user' && m.content && Array.isArray(m.content.parts)) {
          for (const part of m.content.parts) if (typeof part === 'string') out.push(part);
        }
      }
      return out.join('\n');
    } catch { return ''; }
  }

  window.fetch = async function (...args) {
    const url  = resolveUrl(args[0]);

    // A POST to the conversation endpoint == the user just sent a message.
    // This is the primary "count this chat today" signal (no DOM selectors).
    if (url && CONVO_RE.test(url) && resolveMethod(args) === 'POST') {
      // path is captured NOW, before the app navigates to /c/<id>.
      post('gc:send', { url, path: location.pathname, prompt: extractPrompt(args) });
    }

    const resp = await originalFetch.apply(window, args);

    if (url && /\/backend-api\/(?:f\/)?conversation/.test(url)) {
      const ct = resp.headers.get('content-type') || '';
      if (ct.includes('event-stream') || ct.includes('text/plain') || ct.includes('octet-stream')) {
        interceptStream(resp.clone(), url);
      }
    }

    return resp;
  };

  // ── SSE stream interceptor ─────────────────────────────────────────────────
  async function interceptStream(response, url) {
    try {
      const reader  = response.body?.getReader?.();
      if (!reader) return;

      const decoder     = new TextDecoder();
      let buffer        = '';
      let model         = null;
      let totalText     = '';   // accumulate all generated text for fallback estimation
      let usageFound    = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const raw = line.slice(5).trim();
          if (!raw || raw === '[DONE]') continue;

          let json;
          try { json = JSON.parse(raw); } catch { continue; }

          // Grab model name
          if (!model && json?.model) {
            model = json.model;
            post('gc:model', { model });
          }

          // Best case: OpenAI includes usage in stream (some accounts/models do)
          if (json?.usage?.total_tokens) {
            usageFound = true;
            post('gc:usage', {
              promptTokens:     json.usage.prompt_tokens     || 0,
              completionTokens: json.usage.completion_tokens || 0,
              totalTokens:      json.usage.total_tokens      || 0,
              source:           'api',
            });
          }

          // Accumulate delta text for fallback
          // ChatGPT format: choices[0].delta.content
          const delta = json?.choices?.[0]?.delta?.content;
          if (typeof delta === 'string') {
            totalText += delta;
          }

          // Also check message.content for non-streaming format
          const msgContent = json?.message?.content?.parts;
          if (Array.isArray(msgContent)) {
            totalText = msgContent.join('');
          }
        }
      }

      // Fallback: if API didn't give us usage, estimate from generated text
      if (!usageFound && totalText.length > 0) {
        const completionTokens = Math.ceil(totalText.length / 4);
        post('gc:usage', {
          promptTokens:     0,
          completionTokens: completionTokens,
          totalTokens:      completionTokens,
          source:           'estimated',
        });
        console.debug('[GCBridge] Estimated', completionTokens, 'tokens from', totalText.length, 'chars');
      }

    } catch (err) {
      console.debug('[GCBridge] Stream read error:', err?.message);
    }
  }

  console.debug('[GCBridge] fetch interceptor active ✓');
})();
