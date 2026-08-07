/* =========================================================================
   LUE — model providers
   =========================================================================
   One function per provider, plus a thin fallback wrapper. To add or swap a
   provider you only need to:
     1. write another `callX(payload)` that returns a plain string, and
     2. add it to the CHAIN array at the bottom.
   Nothing outside this file knows which model answered — `LueAI.ask()`
   returns `{ text, provider, fellBack, reason }`.

   Keys come from js/config.js and are exposed in the browser on purpose —
   see the warning at the top of that file.
   ========================================================================= */

const LueAI = (() => {

  const REQUEST_TIMEOUT_MS = 60000;

  /* ---------------------------------------------------------------------
     helpers
     --------------------------------------------------------------------- */

  /** A key that is still the placeholder counts as "not configured". */
  function configured(key) {
    return typeof key === 'string' && key.trim().length > 0 && !key.startsWith('PASTE_');
  }

  function providerError(message, { status = 0, quota = false } = {}) {
    const err = new Error(message);
    err.status = status;
    err.quota = quota;
    return err;
  }

  async function postJSON(url, { headers, body }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  /** "data:image/jpeg;base64,AAAA" -> { mediaType, base64 } */
  function splitDataUrl(dataUrl) {
    const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl || '');
    if (!m) throw providerError('That image could not be read.');
    return { mediaType: m[1], base64: m[2] };
  }

  /* ---------------------------------------------------------------------
     PROVIDER 1 — Gemini (primary)
     Free-tier flash model. Thinking is turned off for chat latency; if a
     response somehow comes back with no text, we throw so the wrapper can
     fall through to Claude rather than showing an empty bubble.
     --------------------------------------------------------------------- */
  async function callGemini({ system, history, text, imageDataUrl, maxTokens }) {
    if (!configured(LUE_CONFIG.GEMINI_API_KEY)) {
      throw providerError('No Gemini API key is set in js/config.js.');
    }

    const parts = [{ text }];
    if (imageDataUrl) {
      const { mediaType, base64 } = splitDataUrl(imageDataUrl);
      parts.push({ inlineData: { mimeType: mediaType, data: base64 } });
    }

    const contents = history.map((turn) => ({
      role: turn.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: turn.text }],
    }));
    contents.push({ role: 'user', parts });

    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/` +
      `${encodeURIComponent(LUE_CONFIG.GEMINI_MODEL)}:generateContent` +
      `?key=${encodeURIComponent(LUE_CONFIG.GEMINI_API_KEY)}`;

    const res = await postJSON(url, {
      body: {
        systemInstruction: { parts: [{ text: system }] },
        contents,
        generationConfig: {
          maxOutputTokens: maxTokens,
          thinkingConfig: { thinkingBudget: 0 },
        },
      },
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      const quota = res.status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(detail);
      throw providerError(
        quota ? 'Gemini free quota exhausted.' : `Gemini error ${res.status}.`,
        { status: res.status, quota }
      );
    }

    const data = await res.json();
    const out = (data?.candidates?.[0]?.content?.parts || [])
      .map((p) => p.text || '')
      .join('')
      .trim();

    if (!out) {
      const blocked = data?.promptFeedback?.blockReason;
      throw providerError(blocked ? `Gemini blocked the prompt (${blocked}).` : 'Gemini returned no text.');
    }
    return out;
  }

  /* ---------------------------------------------------------------------
     PROVIDER 2 — Claude (fallback)
     Mid-tier Sonnet. Called directly from the browser, which requires the
     `anthropic-dangerous-direct-browser-access` header — Anthropic's opt-in
     for exactly this "key is in the frontend" situation.
     Thinking is disabled so max_tokens is spent on the answer, not reasoning.
     --------------------------------------------------------------------- */
  async function callClaude({ system, history, text, imageDataUrl, maxTokens }) {
    if (!configured(LUE_CONFIG.ANTHROPIC_API_KEY)) {
      throw providerError('No Claude API key is set in js/config.js.');
    }

    const content = [];
    if (imageDataUrl) {
      const { mediaType, base64 } = splitDataUrl(imageDataUrl);
      content.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } });
    }
    content.push({ type: 'text', text });

    const messages = history.map((turn) => ({
      role: turn.role === 'assistant' ? 'assistant' : 'user',
      content: turn.text,
    }));
    messages.push({ role: 'user', content });

    const res = await postJSON('https://api.anthropic.com/v1/messages', {
      headers: {
        'x-api-key': LUE_CONFIG.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: {
        model: LUE_CONFIG.CLAUDE_MODEL,
        max_tokens: maxTokens,
        system,
        thinking: { type: 'disabled' },
        messages,
      },
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      const quota = res.status === 429;
      throw providerError(
        quota ? 'Claude is rate limited.' : `Claude error ${res.status}.`,
        { status: res.status, quota }
      );
    }

    const data = await res.json();

    // Safety classifiers can decline with a normal 200 — check before reading content.
    if (data.stop_reason === 'refusal') {
      throw providerError('Claude declined that request.');
    }

    const out = (data.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();

    if (!out) throw providerError('Claude returned no text.');
    return out;
  }

  /* ---------------------------------------------------------------------
     PER-PROVIDER DAILY BUDGETS
     Each provider gets its own allowance because their economics differ:
     Gemini's free tier is generous, Claude bills per token. Counts are kept
     per calendar day in localStorage and checked here, inside the chain, so
     every call — chat, vision, and constellation drawing — is counted.
     --------------------------------------------------------------------- */
  const USAGE_KEY = 'lue.usage';

  /** Local calendar day, so budgets roll over at the user's own midnight. */
  function todayStamp() {
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  }

  /** { gemini: n, claude: n } for today. Zeroed on a new day or blocked storage. */
  function usage() {
    try {
      const raw = JSON.parse(localStorage.getItem(USAGE_KEY) || '{}');
      if (raw.day !== todayStamp() || typeof raw.counts !== 'object' || !raw.counts) return {};
      return raw.counts;
    } catch {
      return {};   // private mode / storage disabled — session limits still apply
    }
  }

  function limitFor(id) {
    const limit = (LUE_CONFIG.PROVIDER_LIMITS || {})[id];
    return Number.isFinite(limit) ? limit : Infinity;
  }

  function spent(id) {
    return usage()[id] || 0;
  }

  function recordCall(id) {
    // Counted on attempt rather than on success: a request that errored may
    // still have consumed provider quota, so over-counting is the safe way to
    // be wrong here.
    try {
      const counts = usage();
      counts[id] = (counts[id] || 0) + 1;
      localStorage.setItem(USAGE_KEY, JSON.stringify({ day: todayStamp(), counts }));
    } catch { /* nothing to persist to — in-memory session limits still hold */ }
  }

  /* ---------------------------------------------------------------------
     FALLBACK WRAPPER
     Walks the chain in order. Gemini first; on ANY failure (quota, network,
     bad key, empty response) it retries the same request on Claude. A
     provider whose daily budget is spent is skipped without being called.
     Add or reorder providers here — callers are unaffected.
     --------------------------------------------------------------------- */
  const CHAIN = [
    { id: 'gemini', label: 'GEMINI', call: callGemini },
    { id: 'claude', label: 'CLAUDE', call: callClaude },
  ];

  async function ask({ text, imageDataUrl = null, history = [], system = null, maxTokens = null }) {
    const payload = {
      system: system || LUE_CONFIG.SYSTEM_PROMPT,
      history: history.slice(-LUE_CONFIG.HISTORY_TURNS),
      text,
      imageDataUrl,
      maxTokens: maxTokens || LUE_CONFIG.MAX_TOKENS,
    };

    const failures = [];

    for (let i = 0; i < CHAIN.length; i++) {
      const provider = CHAIN[i];

      const limit = limitFor(provider.id);
      const used = spent(provider.id);
      if (used >= limit) {
        failures.push(`${provider.label} daily budget spent (${used}/${limit})`);
        continue;                       // skip without spending a request
      }

      try {
        recordCall(provider.id);
        const out = await provider.call(payload);
        return {
          text: out,
          provider: provider.id,
          label: provider.label,
          fellBack: i > 0,
          reason: i > 0 ? failures[0] : null,
        };
      } catch (err) {
        failures.push(err.message || String(err));
        // keep going — the next provider in the chain gets the same request
      }
    }

    const err = new Error(failures.join(' · '));
    err.allFailed = true;
    err.failures = failures;
    throw err;
  }

  return { ask, configured, callGemini, callClaude, CHAIN, usage, limitFor, spent };
})();
