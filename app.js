(() => {
  const $ = id => document.getElementById(id);
  const chat = $('chat'), input = $('input'), state = $('state'), net = $('net');
  let rec = null;
  let pending = null;
  let muted = false;
  let coreMeta = { provider: null, model: null, fallbackUsed: false, webUsed: false };

  const MEMORY_KEY = 'jarvis.memory.v3';
  const HISTORY_KEY = 'jarvis.history.v3';
  const S = {
    lang: localStorage.lang || 'en-IN',
    person: localStorage.person || 'bestfriend',
    voice: localStorage.voice !== 'false',
    wake: localStorage.wake === 'true',
    phrase: localStorage.phrase || 'jarvis',
    style: localStorage.responseStyle || 'balanced',
    theme: localStorage.theme || 'midnight',
    speechRate: Number(localStorage.speechRate || 1),
    animations: localStorage.animations || 'full',
    memoryEnabled: localStorage.memoryEnabled !== 'false',
    memory: loadJson(MEMORY_KEY, []),
    history: loadJson(HISTORY_KEY, [])
  };

  function loadJson(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return Array.isArray(value) ? value : fallback;
    } catch {
      return fallback;
    }
  }

  function saveState() {
    localStorage.lang = S.lang;
    localStorage.person = S.person;
    localStorage.voice = S.voice;
    localStorage.wake = S.wake;
    localStorage.phrase = S.phrase;
    localStorage.speechRate = S.speechRate;
    localStorage.responseStyle = S.style;
    localStorage.theme = S.theme;
    localStorage.animations = S.animations;
    localStorage.memoryEnabled = S.memoryEnabled;
    localStorage.setItem(MEMORY_KEY, JSON.stringify(S.memory.slice(-100)));
    localStorage.setItem(HISTORY_KEY, JSON.stringify(S.history.slice(-30)));
  }

  function esc(x) {
    return String(x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function renderMarkdown(text) {
    const normalized = String(text)
      .replace(/\r\n/g, '\n')
      .replace(/\basterisk\b/gi, '')
      .replace(/\bhashtag\b/gi, '');

    return normalized.split('\n').map(line => {
      let s = esc(line);
      if (/^###\s+/.test(line)) s = '<h4>' + s.slice(4) + '</h4>';
      else if (/^##\s+/.test(line)) s = '<h3>' + s.slice(3) + '</h3>';
      else if (/^#\s+/.test(line)) s = '<h2>' + s.slice(2) + '</h2>';
      else if (/^[-*]\s+/.test(line)) s = '• ' + s.slice(2);
      s = s.replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/__([^_]+)__/g, '<strong>$1</strong>')
        .replace(/(^|\s)\*([^*\n]+)\*(?=\s|$)/g, '$1<em>$2</em>');
      return s || '<br>';
    }).join('<br>');
  }

  // TTS gets a speech-safe copy, while the visual answer keeps its formatting.
  function speechText(text) {
    return String(text)
      .replace(/```[\s\S]*?```/g, ' code omitted ')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/^\s*#{1,6}\s*/gm, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/^\s*[-*]\s+/gm, '')
      .replace(/^\s*\d+[.)]\s+/gm, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/https?:\/\/\S+/gi, '')
      .replace(/\basterisk\b/gi, '')
      .replace(/\bhashtag\b/gi, '')
      // Emoji / pictographic symbols should remain visual only.
      .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}\u{200D}]/gu, ' ')
      .replace(/[\u{200B}-\u{200F}\u{202A}-\u{202E}]/gu, ' ')
      .replace(/[\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{2500}-\u{257F}\u{25A0}-\u{25FF}]/gu, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  function addHistory(role, text) {
    S.history.push({ role, text, at: Date.now() });
    S.history = S.history.slice(-30);
    saveState();
  }

  function msg(who, text, raw = false) {
    if (!chat) return;
    const d = document.createElement('div');
    d.className = 'msg ' + (who === 'YOU' ? 'u' : 'j');
    d.innerHTML = '<span class="meta">' + esc(who) + '</span>' +
      (who === 'JARVIS' && raw ? renderMarkdown(text) : esc(text).replace(/\n/g, '<br>'));
    chat.appendChild(d);
    chat.scrollTop = chat.scrollHeight;
  }

  function speak(text) {
    if (!S.voice || muted || !('speechSynthesis' in window)) return;
    const safe = speechText(text);
    if (!safe) return;
    speechSynthesis.cancel();
    state.textContent = 'SPEAKING';
    const utterance = new SpeechSynthesisUtterance(safe);
    utterance.lang = S.lang;
    utterance.rate = S.speechRate;
    utterance.onend = () => { state.textContent = 'READY'; };
    utterance.onerror = () => { state.textContent = 'READY'; };
    speechSynthesis.speak(utterance);
  }

  function reply(text, options = {}) {
    let display = text;
    if (options.meta && (options.meta.provider || options.meta.webUsed)) {
      const parts = [];
      if (options.meta.provider) parts.push(`AI: ${options.meta.provider}${options.meta.fallbackUsed ? ' (fallback)' : ''}`);
      if (options.meta.webUsed) parts.push('WEB: Tavily');
      if (parts.length) display += `\n\n<small>${parts.join(' · ')}</small>`;
    }
    msg('JARVIS', display);
    if (options.speak) speak(text);
    state.textContent = 'READY';
  }

  function openDialog(dialog) {
    if (!dialog) return false;
    try {
      if (typeof dialog.showModal === 'function') {
        if (!dialog.open) dialog.showModal();
      } else {
        dialog.setAttribute('open', '');
      }
      return true;
    } catch {
      dialog.setAttribute('open', '');
      return true;
    }
  }

  function closeDialog(dialog) {
    if (!dialog) return;
    try {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    } catch {
      dialog.removeAttribute('open');
    }
  }

  function auth(label, fn, speakAfter = false) {
    const dialog = $('confirm');
    const text = $('confirmText');
    if (!dialog || !text) {
      // Never dead-lock. A missing dialog means the action is not authorized.
      reply('I could not open the authorization panel, so I did not perform the action.', { speak: speakAfter });
      return;
    }
    pending = { fn, speakAfter };
    text.textContent = 'JARVIS wants to ' + label + '. This requires your authorization.';
    state.textContent = 'AWAITING AUTHORIZATION';
    openDialog(dialog);
  }

  async function weather(speakAfter = false) {
    if (!navigator.geolocation) return reply('I need location support for live weather.', { speak: speakAfter });
    return new Promise(resolve => navigator.geolocation.getCurrentPosition(async p => {
      try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${p.coords.latitude}&longitude=${p.coords.longitude}&current=temperature_2m,apparent_temperature,wind_speed_10m`;
        const response = await fetch(url);
        if (!response.ok) throw new Error('weather request failed');
        const data = await response.json();
        const c = data.current;
        const text = `It is ${c.temperature_2m}°C, feels like ${c.apparent_temperature}°C, with wind around ${c.wind_speed_10m} km/h.`;
        resolve(text);
      } catch {
        resolve('I could not retrieve live weather right now.');
      }
    }, () => resolve('Location permission is needed for live weather.')));
  }

  function openUrl(url) {
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  function remember(text, category = 'Personal') {
    if (!S.memoryEnabled) return false;
    const clean = text.trim();
    if (!clean) return false;
    S.memory.push({
      id: crypto.randomUUID?.() || String(Date.now()),
      text: clean.slice(0, 500),
      category,
      at: Date.now(),
      reason: 'User explicitly asked JARVIS to remember this.'
    });
    S.memory = S.memory.slice(-100);
    saveState();
    return true;
  }

  function showMemories() {
    if (!S.memory.length) return 'I do not have any saved memories yet.';
    return S.memory.slice(-8).map((m, i) => `${i + 1}. **${m.category}** — ${m.text}`).join('\n');
  }

  function getCurrentDate() {
    return new Intl.DateTimeFormat(S.lang, {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    }).format(new Date());
  }

  function getCurrentTime() {
    return new Intl.DateTimeFormat(S.lang, {
      hour: 'numeric', minute: '2-digit', second: '2-digit'
    }).format(new Date());
  }

  function localCommand(raw, speakAfter) {
    const x = raw.trim();
    const t = x.toLowerCase();

    if (['stop', 'mute', 'stop jarvis', 'be quiet'].includes(t)) {
      muted = true;
      speechSynthesis?.cancel();
      state.textContent = 'MUTED';
      msg('JARVIS', 'Understood. I am muted.');
      return true;
    }

    if (['unmute', 'resume', 'speak'].includes(t)) {
      muted = false;
      state.textContent = 'READY';
      reply('Voice output resumed.', { speak: speakAfter });
      return true;
    }

    if (/^(what(?:'s| is)\s+)?(the\s+)?time\??$/i.test(x) || /current time/i.test(x)) {
      reply(getCurrentTime(), { speak: speakAfter });
      return true;
    }

    if (/^(what(?:'s| is)\s+)?(today'?s?\s+)?date\??$/i.test(x) || t === 'today') {
      reply(getCurrentDate(), { speak: speakAfter });
      return true;
    }

    if (/\bweather\b/i.test(x)) {
      state.textContent = 'FETCHING';
      weather(speakAfter).then(v => { state.textContent = 'READY'; reply(v, { speak: speakAfter }); });
      return true;
    }

    if (t.startsWith('search ') || t.includes('search google')) {
      const q = x.replace(/^search google(?: for)?\s*/i, '').replace(/^search\s*/i, '').trim();
      if (!q) return false;
      reply('Searching Google for ' + q + '.', { speak: speakAfter });
      openUrl('https://www.google.com/search?q=' + encodeURIComponent(q));
      return true;
    }

    if (/^open\s+youtube\b/i.test(x)) {
      reply('Opening YouTube.', { speak: speakAfter });
      openUrl('https://www.youtube.com');
      return true;
    }

    if (/^open\s+(google\s+)?maps\b/i.test(x)) {
      reply('Opening Maps.', { speak: speakAfter });
      openUrl('https://maps.google.com');
      return true;
    }

    if (/^call\b/i.test(x)) {
      const target = x.replace(/^call\s*/i, '').trim();
      if (!target) {
        reply('Please provide a phone number. I cannot access your private contacts from the browser.', { speak: speakAfter });
        return true;
      }
      const normalized = target.replace(/[\s().-]/g, '');
      if (!/^\+?\d{7,15}$/.test(normalized)) {
        reply('I can prepare a call only when you provide a phone number. The web app cannot look up private contacts.', { speak: speakAfter });
        return true;
      }
      auth('prepare a call to ' + target, () => {
        window.location.assign('tel:' + encodeURIComponent(normalized));
      }, speakAfter);
      return true;
    }

    if (t.startsWith('message ') || t.startsWith('sms ')) {
      const body = x.replace(/^(message|sms)\s*/i, '').trim();
      if (!body) {
        reply('Please provide the message text.', { speak: speakAfter });
        return true;
      }
      auth('prepare this message: ' + body, () => {
        window.location.assign('sms:?body=' + encodeURIComponent(body));
      }, speakAfter);
      return true;
    }

    if (t.startsWith('remember ')) {
      const value = x.slice(9).trim();
      if (remember(value)) reply('Remembered: ' + value, { speak: speakAfter });
      else reply('Memory is disabled in Settings.', { speak: speakAfter });
      return true;
    }

    if (t.includes('what do you remember') || t.includes('show my memories') || t.includes('show memories')) {
      reply(showMemories(), { speak: speakAfter });
      return true;
    }

    if (t === 'forget everything' || t === 'clear all memories') {
      auth('clear all saved memories', () => {
        S.memory = [];
        saveState();
        reply('All saved memories were cleared.', { speak: speakAfter });
        renderMemory();
      }, speakAfter);
      return true;
    }

    if (t.startsWith('forget ')) {
      const query = t.slice(7).trim();
      const before = S.memory.length;
      S.memory = S.memory.filter(m => !m.text.toLowerCase().includes(query));
      saveState();
      reply(before === S.memory.length ? 'I could not find a matching memory.' : 'I forgot the matching memory.', { speak: speakAfter });
      renderMemory();
      return true;
    }

    if (/^(who\s+are\s+you|what\s+are\s+you|tell\s+me\s+about\s+yourself|what\s+is\s+your\s+origin)\??$/i.test(x)) {
      reply('I am JARVIS, the personal AI assistant in this JARVIS Web project. I do not have a separate company, founder, or real-world founding date unless that information is explicitly provided by the project owner.', { speak: speakAfter });
      return true;
    }

    return false;
  }

  async function aiCommand(x, speakAfter) {
    state.textContent = 'THINKING';
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: x,
          history: S.history.slice(-12),
          language: S.lang,
          personality: S.person,
          responseStyle: S.style,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'AI request failed.');
      state.textContent = 'READY';
      coreMeta = { provider: data.provider || null, model: data.model || null, fallbackUsed: data.fallbackUsed === true, webUsed: data.webUsed === true };
      reply(data.text, { speak: speakAfter, meta: coreMeta });
    } catch (error) {
      state.textContent = 'ERROR';
      reply('I could not complete that request. ' + error.message, { speak: speakAfter });
    }
  }

  async function command(raw, source = 'text') {
    const x = raw.trim();
    if (!x) return;
    const speakAfter = source === 'voice';
    msg('YOU', x);
    addHistory('user', x);
    input.value = '';
    muted = false;
    if (!localCommand(x, speakAfter)) await aiCommand(x, speakAfter);
  }

  function renderMemory() {
    const list = $('memoryList');
    if (!list) return;
    list.innerHTML = S.memory.length
      ? S.memory.slice().reverse().map(memory => `
          <article class="memory-card">
            <div><span class="pill">${esc(memory.category)}</span><time>${new Date(memory.at).toLocaleString()}</time></div>
            <p>${esc(memory.text)}</p>
            <small>${esc(memory.reason || 'Explicitly saved')}</small>
            <button type="button" data-forget="${esc(memory.id)}">Forget</button>
          </article>`).join('')
      : '<div class="empty">No saved memories.</div>';

    list.querySelectorAll('[data-forget]').forEach(button => {
      button.onclick = () => {
        S.memory = S.memory.filter(memory => memory.id !== button.dataset.forget);
        saveState();
        renderMemory();
      };
    });
  }

  function applyAppearance() {
    document.body.dataset.theme = S.theme;
    document.body.dataset.animations = S.animations;
  }

  // Send is always text-originated. Only microphone input is voice-originated.
  $('send')?.addEventListener('click', () => command(input.value, 'text'));

  $('mic')?.addEventListener('click', () => {
    if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
      return reply('Speech recognition is not supported in this browser.');
    }
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (rec) {
      rec.stop();
      return;
    }
    rec = new Recognition();
    rec.lang = S.lang;
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    state.textContent = 'LISTENING';
    document.body.classList.add('listening');
    rec.onresult = event => command(event.results[0][0].transcript, 'voice');
    rec.onerror = () => { state.textContent = 'ERROR'; };
    rec.onend = () => {
      rec = null;
      document.body.classList.remove('listening');
      if (state.textContent === 'LISTENING') state.textContent = 'READY';
    };
    rec.start();
  });

  $('stop')?.addEventListener('click', () => {
    rec?.stop();
    speechSynthesis?.cancel();
    muted = true;
    state.textContent = 'STOPPED';
    msg('JARVIS', 'Stopped.');
  });

  $('clear')?.addEventListener('click', () => { chat.innerHTML = ''; });

  $('remember')?.addEventListener('click', () => {
    const value = input.value.trim();
    if (value) command('remember ' + value, 'text');
    else openDialog($('memoryDlg'));
  });

  document.querySelectorAll('[data-c]').forEach(button => {
    button.addEventListener('click', () => {
      input.value = button.dataset.c || '';
      if (!button.dataset.c.endsWith(' ')) command(button.dataset.c, 'text');
      else input.focus();
    });
  });

  $('settings')?.addEventListener('click', () => {
    $('lang').value = S.lang;
    $('person').value = S.person;
    $('voice').checked = S.voice;
    $('wake').checked = S.wake;
    $('phrase').value = S.phrase;
    $('speechRate').value = S.speechRate;
    $('style').value = S.style;
    $('theme').value = S.theme;
    $('animations').value = S.animations;
    $('memoryEnabled').checked = S.memoryEnabled;
    openDialog($('dlg'));
  });

  $('save')?.addEventListener('click', () => {
    S.lang = $('lang').value;
    S.person = $('person').value;
    S.voice = $('voice').checked;
    S.wake = $('wake').checked;
    S.phrase = $('phrase').value.trim() || 'jarvis';
    S.speechRate = Number($('speechRate').value || 1);
    S.style = $('style').value;
    S.theme = $('theme').value;
    S.animations = $('animations').value;
    S.memoryEnabled = $('memoryEnabled').checked;
    saveState();
    applyAppearance();
    closeDialog($('dlg'));
    reply('Settings updated.');
  });

  $('openMemory')?.addEventListener('click', () => { renderMemory(); openDialog($('memoryDlg')); });
  $('openMemoryFromSettings')?.addEventListener('click', () => { renderMemory(); openDialog($('memoryDlg')); });
  $('clearMemories')?.addEventListener('click', () => auth('clear all saved memories', () => {
    S.memory = [];
    saveState();
    renderMemory();
    reply('All saved memories were cleared.');
  }, false));
  $('closeMemory')?.addEventListener('click', () => closeDialog($('memoryDlg')));

  $('cancel')?.addEventListener('click', () => {
    const speakAfter = pending?.speakAfter === true;
    pending = null;
    closeDialog($('confirm'));
    state.textContent = 'READY';
    reply('Authorization cancelled.', { speak: speakAfter });
  });

  $('authorize')?.addEventListener('click', () => {
    const action = pending;
    pending = null;
    closeDialog($('confirm'));
    state.textContent = 'EXECUTING';
    if (!action?.fn) {
      state.textContent = 'READY';
      return;
    }
    try {
      action.fn();
      // tel:/sms: navigation leaves the page, so no extra response is needed here.
      if (!/^call|^message/i.test($('confirmText')?.textContent || '')) {
        state.textContent = 'READY';
      }
    } catch {
      state.textContent = 'ERROR';
      reply('I could not execute the authorized action.', { speak: action.speakAfter === true });
    }
  });

  $('closeSettings')?.addEventListener('click', () => closeDialog($('dlg')));

  input?.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      $('send')?.click();
    }
  });

  addEventListener('online', () => { net.textContent = 'ONLINE'; });
  addEventListener('offline', () => { net.textContent = 'OFFLINE'; });
  net.textContent = navigator.onLine ? 'ONLINE' : 'OFFLINE';

  // Escape/backdrop should never leave a modal half-locked.
  [$('dlg'), $('memoryDlg'), $('confirm')].forEach(dialog => {
    dialog?.addEventListener('cancel', () => {
      if (dialog === $('confirm')) pending = null;
      state.textContent = 'READY';
    });
  });


  $('diagnostics')?.addEventListener('click', async () => {
    const out = $('diagResult');
    if (!out) return;
    out.textContent = 'Running…';
    try {
      const r = await fetch('/api/diagnostics');
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || 'Diagnostic request failed.');
      const p = d.providers || {};
      out.textContent = `Core ${d.version || 'unknown'}\nOpenRouter: ${p.openrouter?.configured ? 'READY' : 'NOT CONFIGURED'}\nGemini: ${p.gemini?.configured ? 'READY' : 'NOT CONFIGURED'}\nTavily: ${p.tavily?.configured ? 'READY' : 'NOT CONFIGURED'}\nWeb search: ${d.webSearchEnabled ? 'ON' : 'OFF'}`;
    } catch (error) {
      out.textContent = 'Diagnostics unavailable.';
    }
  });


  $('diagnostics')?.addEventListener('click', async () => {
    const out = $('diagResult');
    if (!out) return;
    out.textContent = 'Running…';
    try {
      const r = await fetch('/api/diagnostics');
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || 'Diagnostic request failed.');
      const p = d.providers || {};
      out.textContent = `Core ${d.version || 'unknown'}\nOpenRouter: ${p.openrouter?.configured ? 'READY' : 'NOT CONFIGURED'}\nGemini: ${p.gemini?.configured ? 'READY' : 'NOT CONFIGURED'}\nTavily: ${p.tavily?.configured ? 'READY' : 'NOT CONFIGURED'}\nWeb search: ${d.webSearchEnabled ? 'ON' : 'OFF'}`;
    } catch {
      out.textContent = 'Diagnostics unavailable.';
    }
  });

  applyAppearance();
  msg('JARVIS', 'JARVIS V1.3 online. Advanced tools, live-information routing, memory, voice, and secure authorization are ready.', true);
})();
