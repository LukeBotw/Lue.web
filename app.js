/* =========================================================================
   LUE — app shell
   Chat, webcam, mic, limits. Wires js/providers.js (models),
   js/constellation.js (drawing) and js/orb.js (visuals) together.
   ========================================================================= */

(() => {
  'use strict';

  /* ---------------------------------------------------------------------
     elements
     --------------------------------------------------------------------- */
  const chatLog    = document.getElementById('chatLog');
  const textInput  = document.getElementById('textInput');
  const sendBtn    = document.getElementById('sendBtn');
  const charCount  = document.getElementById('charCount');
  const note       = document.getElementById('composerNote');

  const camBtn     = document.getElementById('camBtn');
  const micBtn     = document.getElementById('micBtn');
  const drawBtn    = document.getElementById('drawBtn');

  const camPod     = document.getElementById('camPod');
  const camVideo   = document.getElementById('camVideo');
  const camInd     = document.getElementById('camIndicator');
  const micInd     = document.getElementById('micIndicator');

  const statusVal  = document.getElementById('statusVal');
  const providerEl = document.getElementById('providerVal');
  const sessionHex = document.getElementById('sessionHex');
  const railMsgs   = document.getElementById('railMsgs');
  const railCam    = document.getElementById('railCam');
  const railMic    = document.getElementById('railMic');
  const railMode   = document.getElementById('railMode');

  /* ---------------------------------------------------------------------
     state
     --------------------------------------------------------------------- */
  const MAX = LUE_CONFIG.MAX_CHARS;   // declared up here: boot() reads it, and boot()
                                      // runs during script evaluation.

  const history = [];              // [{ role: 'user' | 'assistant', text }]
  let busy = false;
  let camStream = null;
  let camOn = false;
  let micOn = false;
  let recognition = null;
  let micBaseline = '';
  let noteTimer = null;

  // Throughput counters for this page load. The per-provider daily budgets are
  // separate and live in providers.js.
  const rate = { session: 0, lastAt: 0 };

  /* ---------------------------------------------------------------------
     small helpers
     --------------------------------------------------------------------- */
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /** Minimal markdown: fenced code, inline code, bold. Everything is escaped first. */
  function renderMarkdown(raw) {
    const chunks = String(raw).split('```');
    let out = '';
    chunks.forEach((chunk, i) => {
      if (i % 2 === 1) {
        const body = chunk.replace(/^[A-Za-z0-9+#._-]*\n/, '').replace(/\n+$/, '');
        out += `<pre><code>${esc(body)}</code></pre>`;
      } else {
        if (!chunk) return;
        let t = esc(chunk.replace(/\n{3,}/g, '\n\n'));
        t = t.replace(/`([^`\n]+)`/g, '<code>$1</code>');
        t = t.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
        out += t;
      }
    });
    return out;
  }

  function atBottom() {
    return chatLog.scrollHeight - chatLog.scrollTop - chatLog.clientHeight < 90;
  }
  function scrollDown(force) {
    if (force || atBottom()) chatLog.scrollTop = chatLog.scrollHeight;
  }

  function addMessage(kind, html, { meta = null, thumb = null } = {}) {
    const stick = atBottom();
    const el = document.createElement('div');
    el.className = `msg msg--${kind}`;
    let inner = '';
    if (meta) inner += `<span class="msg-meta">${esc(meta)}</span>`;
    inner += html;
    if (thumb) inner += `<img class="thumb" src="${thumb}" alt="Webcam frame sent with this message">`;
    el.innerHTML = inner;
    chatLog.appendChild(el);
    scrollDown(stick);
    return el;
  }

  function systemLine(text, tone) {
    const el = addMessage('sys', esc(text));
    if (tone) el.classList.add(`msg--${tone}`);
    return el;
  }

  function showNote(text, tone = 'error') {
    clearTimeout(noteTimer);
    note.textContent = text;
    note.classList.toggle('warn', tone === 'warn');
    note.hidden = false;
    noteTimer = setTimeout(() => { note.hidden = true; }, 6000);
  }
  function clearNote() {
    clearTimeout(noteTimer);
    note.hidden = true;
  }

  function setStatus(text, cls) {
    statusVal.textContent = text;
    statusVal.className = `stat-v ${cls || ''}`.trim();
  }
  function setMode(text, on) {
    railMode.textContent = text;
    railMode.className = `rail-v ${on || ''}`.trim();
  }

  /* ---------------------------------------------------------------------
     BOOT
     --------------------------------------------------------------------- */
  function boot() {
    LueOrb.start();

    const hex = Math.floor(Math.random() * 0xfffff).toString(16).toUpperCase().padStart(5, '0');
    sessionHex.textContent = `0x${hex}`;

    updateCounter();
    updateUsageReadout();
    setMode('IDLE');

    const missingGemini = !LueAI.configured(LUE_CONFIG.GEMINI_API_KEY);
    const missingClaude = !LueAI.configured(LUE_CONFIG.ANTHROPIC_API_KEY);

    addMessage('lue', renderMarkdown(
      'Lue online. Ask me anything — or say **“draw a lighthouse”** and I\'ll chart it as a constellation.\n\n' +
      'Camera and mic are off until you switch them on.'
    ), { meta: 'LUE' });

    if (missingGemini && missingClaude) {
      systemLine('No API keys configured — open js/config.js and paste in a Gemini key (and a Claude key for fallback).', 'err');
      setStatus('NO KEYS', 'err');
    } else if (missingGemini) {
      systemLine('No Gemini key set — every request will go straight to the Claude fallback.', 'warn');
      setStatus('DEGRADED', 'warn');
    } else if (missingClaude) {
      systemLine('No Claude key set — there is no fallback if Gemini\'s quota runs out.', 'warn');
    }

    if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
      micBtn.disabled = true;
      micBtn.title = 'Voice input needs a Chromium-based browser';
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      camBtn.disabled = true;
      camBtn.title = 'This browser has no camera access';
    }

    textInput.focus();
  }

  /* ---------------------------------------------------------------------
     CHARACTER LIMIT + COMPOSER
     --------------------------------------------------------------------- */
  function updateCounter() {
    const len = textInput.value.length;
    const showFrom = Math.floor(MAX * LUE_CONFIG.COUNTER_AT);
    charCount.textContent = `${len.toLocaleString()} / ${MAX.toLocaleString()}`;
    charCount.classList.toggle('show', len >= showFrom);
    charCount.classList.toggle('near', len >= MAX * 0.9 && len <= MAX);
    charCount.classList.toggle('over', len > MAX);
    textInput.classList.toggle('is-over', len > MAX);
  }

  function autoGrow() {
    textInput.style.height = 'auto';
    textInput.style.height = Math.min(textInput.scrollHeight, 150) + 'px';
  }

  textInput.addEventListener('input', () => {
    updateCounter();
    autoGrow();
    if (textInput.value.length <= MAX) clearNote();
  });

  textInput.addEventListener('keydown', (e) => {
    // Enter sends, Shift+Enter (and IME composition) inserts a newline.
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send();
    }
  });

  sendBtn.addEventListener('click', () => send());

  drawBtn.addEventListener('click', () => {
    const current = textInput.value.trim();

    // Empty box: prime it and wait — sending "draw " on its own would chart
    // the literal word "draw".
    if (!current) {
      textInput.value = 'draw ';
      textInput.focus();
      textInput.setSelectionRange(textInput.value.length, textInput.value.length);
      updateCounter();
      autoGrow();
      showNote('Name what you want charted after “draw” — e.g. “draw a lighthouse”.', 'warn');
      return;
    }

    textInput.value = LueConstellation.wantsImage(current) ? current : `draw ${current}`;
    updateCounter();
    autoGrow();
    send();
  });

  /* ---------------------------------------------------------------------
     RATE LIMIT
     --------------------------------------------------------------------- */
  /** Compact per-provider readout, e.g. "G 12 · C 2". */
  function updateUsageReadout() {
    const g = LueAI.spent('gemini');
    const c = LueAI.spent('claude');
    railMsgs.textContent = `G ${g} · C ${c}`;
    railMsgs.classList.toggle('busy', c >= LueAI.limitFor('claude') * 0.8);
  }

  /* Throughput only — the per-provider daily budgets live in providers.js and
     are enforced inside the fallback chain. */
  function rateAllows() {
    const { maxPerSession, minGapMs } = LUE_CONFIG.RATE_LIMIT;

    if (rate.session >= maxPerSession) {
      return { ok: false, msg: `Session limit reached (${maxPerSession} messages). Reload the page to continue.` };
    }
    if (rate.lastAt && Date.now() - rate.lastAt < minGapMs) {
      return { ok: false, msg: `Slow down a touch — one message every ${(minGapMs / 1000).toFixed(1)}s.` };
    }
    return { ok: true };
  }

  /* ---------------------------------------------------------------------
     WEBCAM
     --------------------------------------------------------------------- */
  async function startCamera() {
    try {
      camStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      camVideo.srcObject = camStream;
      await camVideo.play().catch(() => {});
      camOn = true;
      camPod.hidden = false;
      camInd.hidden = false;
      camBtn.classList.add('is-on');
      camBtn.setAttribute('aria-pressed', 'true');
      railCam.textContent = 'ON';
      railCam.classList.add('on');
      systemLine('Camera on — Lue sees a frame with each message you send.');
    } catch (err) {
      camOn = false;
      showNote(
        err && err.name === 'NotAllowedError'
          ? 'Camera permission denied. Allow it in the browser address bar to use vision.'
          : 'No camera available on this device.'
      );
    }
  }

  function stopCamera() {
    if (camStream) camStream.getTracks().forEach((t) => t.stop());
    camStream = null;
    camVideo.srcObject = null;
    camOn = false;
    camPod.hidden = true;
    camInd.hidden = true;
    camBtn.classList.remove('is-on');
    camBtn.setAttribute('aria-pressed', 'false');
    railCam.textContent = 'OFF';
    railCam.classList.remove('on');
    systemLine('Camera off.');
  }

  camBtn.addEventListener('click', () => (camOn ? stopCamera() : startCamera()));

  /** Grabs the current video frame as a downscaled JPEG data URL. */
  function captureFrame() {
    if (!camOn || !camVideo.videoWidth) return null;
    const maxW = 768;
    const scale = Math.min(1, maxW / camVideo.videoWidth);
    const c = document.createElement('canvas');
    c.width = Math.round(camVideo.videoWidth * scale);
    c.height = Math.round(camVideo.videoHeight * scale);
    c.getContext('2d').drawImage(camVideo, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.72);
  }

  /* ---------------------------------------------------------------------
     MICROPHONE  (Web Speech API)
     --------------------------------------------------------------------- */
  function startMic() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { showNote('Voice input needs a Chromium-based browser.'); return; }

    recognition = new SR();
    recognition.lang = navigator.language || 'en-US';
    recognition.continuous = true;
    recognition.interimResults = true;

    micBaseline = textInput.value.trim();

    recognition.onresult = (event) => {
      let transcript = '';
      for (let i = 0; i < event.results.length; i++) transcript += event.results[i][0].transcript;
      textInput.value = (micBaseline ? micBaseline + ' ' : '') + transcript.trim();
      updateCounter();
      autoGrow();
    };

    recognition.onerror = (event) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      showNote(
        event.error === 'not-allowed'
          ? 'Microphone permission denied. Allow it in the browser address bar.'
          : `Voice input error: ${event.error}`
      );
      stopMic();
    };

    // Chrome ends the session periodically; restart while the toggle is on.
    recognition.onend = () => {
      if (!micOn) return;
      micBaseline = textInput.value.trim();
      try { recognition.start(); } catch { /* already starting */ }
    };

    try {
      recognition.start();
    } catch {
      showNote('Could not start voice input.');
      return;
    }

    micOn = true;
    micInd.hidden = false;
    micBtn.classList.add('is-on', 'tool--mic');
    micBtn.setAttribute('aria-pressed', 'true');
    railMic.textContent = 'ON';
    railMic.classList.add('on');
    systemLine('Mic on — speak, then hit send when you\'re happy with the text.');
  }

  function stopMic() {
    micOn = false;
    if (recognition) {
      recognition.onend = null;
      try { recognition.stop(); } catch { /* ignore */ }
      recognition = null;
    }
    micInd.hidden = true;
    micBtn.classList.remove('is-on', 'tool--mic');
    micBtn.setAttribute('aria-pressed', 'false');
    railMic.textContent = 'OFF';
    railMic.classList.remove('on');
  }

  micBtn.addEventListener('click', () => (micOn ? (stopMic(), systemLine('Mic off.')) : startMic()));

  /* ---------------------------------------------------------------------
     SEND
     --------------------------------------------------------------------- */
  function setBusy(on) {
    busy = on;
    sendBtn.disabled = on;
    textInput.disabled = on;
    LueOrb.setEnergy(on ? 0.95 : 0.35);
    if (on) setStatus('THINKING', 'warn');
    else setStatus('ONLINE', 'ok');
  }

  function typingBubble() {
    return addMessage('lue', '<span class="typing"><i></i><i></i><i></i></span>', { meta: 'LUE' });
  }

  async function send() {
    if (busy) return;

    const text = textInput.value.trim();
    if (!text) return;

    // --- character limit: block, never silently truncate ---
    if (text.length > MAX) {
      showNote(
        `That message is ${text.length.toLocaleString()} characters — ${(text.length - MAX).toLocaleString()} over the ` +
        `${MAX.toLocaleString()} limit. Trim it and send again; nothing was sent.`
      );
      textInput.focus();
      return;
    }

    // --- courtesy rate limit ---
    const limitCheck = rateAllows();
    if (!limitCheck.ok) { showNote(limitCheck.msg, 'warn'); return; }

    clearNote();
    rate.session += 1;
    rate.lastAt = Date.now();

    const frame = captureFrame();

    addMessage('user', renderMarkdown(text), { meta: 'YOU', thumb: frame });
    textInput.value = '';
    micBaseline = '';
    updateCounter();
    autoGrow();
    setBusy(true);

    const bubble = typingBubble();

    try {
      if (LueConstellation.wantsImage(text)) {
        await runConstellation(text, bubble);
      } else {
        await runChat(text, frame, bubble);
      }
    } catch (err) {
      bubble.remove();
      addMessage('lue', renderMarkdown(
        `Both models failed on that one.\n\n\`${(err && err.message) || 'unknown error'}\``
      ), { meta: 'LUE · ERROR' }).classList.add('msg--err');
      setStatus('ERROR', 'err');
    } finally {
      setBusy(false);
      setMode('IDLE');
      updateUsageReadout();
      textInput.focus();
    }
  }

  /* --- plain chat turn --- */
  async function runChat(text, frame, bubble) {
    setMode(frame ? 'VISION' : 'CHAT', 'busy');

    const result = await LueAI.ask({ text, imageDataUrl: frame, history });

    bubble.remove();
    addMessage('lue', renderMarkdown(result.text), { meta: 'LUE' });

    if (result.fellBack) {
      systemLine(`Gemini unavailable (${result.reason}) — answered by ${result.label}.`, 'warn');
    }
    providerEl.textContent = result.label;
    providerEl.className = `stat-v ${result.fellBack ? 'warn' : ''}`.trim();

    history.push({ role: 'user', text });
    history.push({ role: 'assistant', text: result.text });

    // Any non-drawing reply dissolves a constellation that is still showing.
    LueOrb.morphToSphere();
  }

  /* --- constellation turn --- */
  async function runConstellation(text, bubble) {
    const subject = LueConstellation.extractSubject(text);
    setMode('CHARTING', 'busy');
    LueOrb.setCaption(`CHARTING · ${subject}`);

    const result = await LueConstellation.generate(subject);
    bubble.remove();

    const groups = result.strokes ? LueConstellation.toPointGroups(result.strokes) : [];

    if (groups.length > 0) {
      LueOrb.morphToConstellation(groups);
      LueOrb.setCaption(subject.toUpperCase());
      const reply = `Charted **${subject}** — ${groups.length} stroke${groups.length === 1 ? '' : 's'} across the field. It'll hold for about twenty seconds.`;
      addMessage('lue', renderMarkdown(reply), { meta: 'LUE' });
      history.push({ role: 'user', text });
      history.push({ role: 'assistant', text: `[charted a constellation of: ${subject}]` });
    } else {
      LueOrb.setCaption('');
      addMessage('lue', renderMarkdown(
        `I couldn't get clean stroke data for **${subject}**. Try naming something with a simpler silhouette — a lighthouse, a wolf, a sailboat.`
      ), { meta: 'LUE' }).classList.add('msg--warn');
    }

    if (result.fellBack) {
      systemLine(`Gemini unavailable (${result.reason}) — charted by ${result.label}.`, 'warn');
    }
    providerEl.textContent = result.label;
    providerEl.className = `stat-v ${result.fellBack ? 'warn' : ''}`.trim();
  }

  /* ---------------------------------------------------------------------
     STARTUP — runs last, so boot() can safely touch anything declared above.
     --------------------------------------------------------------------- */
  boot();

  /* ---------------------------------------------------------------------
     cleanup
     --------------------------------------------------------------------- */
  window.addEventListener('pagehide', () => {
    if (camStream) camStream.getTracks().forEach((t) => t.stop());
    if (recognition) { recognition.onend = null; try { recognition.stop(); } catch { /* ignore */ } }
  });
})();
