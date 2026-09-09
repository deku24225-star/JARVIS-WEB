(() => {
  const $ = id => document.getElementById(id);
  const chat = $('chat'), input = $('input'), state = $('state'), net = $('net');
  let rec = null, pending = null, muted = false;
  const MEMORY_KEY = 'jarvis.memory.v2';
  const HISTORY_KEY = 'jarvis.history.v2';
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
  const TOOL_LABELS = { time: 'get the current time', date: 'get today’s date', weather: 'get live weather', search: 'search Google', youtube: 'open YouTube', maps: 'open Maps', call: 'prepare a call', message: 'prepare a message' };

  function loadJson(k, fallback) { try { const v = JSON.parse(localStorage.getItem(k)); return Array.isArray(v) ? v : fallback; } catch { return fallback; } }
  function saveState() {
    localStorage.lang = S.lang; localStorage.person = S.person; localStorage.voice = S.voice; localStorage.wake = S.wake;
    localStorage.phrase = S.phrase; localStorage.speechRate = S.speechRate; localStorage.responseStyle = S.style; localStorage.theme = S.theme; localStorage.animations = S.animations;
    localStorage.memoryEnabled = S.memoryEnabled;
    localStorage.setItem(MEMORY_KEY, JSON.stringify(S.memory.slice(-100)));
    localStorage.setItem(HISTORY_KEY, JSON.stringify(S.history.slice(-30)));
  }
  function esc(x) { return String(x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function renderMarkdown(text) {
    const normalized = String(text).replace(/\r\n/g, '\n').replace(/\basterisk\b/gi, '').replace(/\bhashtag\b/gi, '');
    return normalized.split('\n').map(line => {
      let s = esc(line);
      if (/^###\s+/.test(line)) s = '<h4>' + s.slice(4) + '</h4>';
      else if (/^##\s+/.test(line)) s = '<h3>' + s.slice(3) + '</h3>';
      else if (/^#\s+/.test(line)) s = '<h2>' + s.slice(2) + '</h2>';
      else if (/^[-*]\s+/.test(line)) s = '• ' + s.slice(2);
      else if (/^\d+[.)]\s+/.test(line)) s = s.replace(/^(\d+[.)])\s+/, '$1 ');
      s = s.replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/__([^_]+)__/g, '<strong>$1</strong>')
        .replace(/(^|\s)\*([^*\n]+)\*(?=\s|$)/g, '$1<em>$2</em>');
      return s || '<br>';
    }).join('<br>');
  }
  function speechText(text) {
    return String(text).replace(/```[\s\S]*?```/g, ' code omitted ')
      .replace(/`([^`]+)`/g, '$1').replace(/#{1,6}\s*/g, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1').replace(/__([^_]+)__/g, '$1').replace(/\*([^*]+)\*/g, '$1')
      .replace(/^\s*[-*]\s+/gm, '').replace(/^\s*\d+[.)]\s+/gm, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/\basterisk\b/gi, '').replace(/\bhashtag\b/gi, '').replace(/\s{2,}/g, ' ').trim();
  }
  function addHistory(role, text) { S.history.push({ role, text, at: Date.now() }); S.history = S.history.slice(-30); saveState(); }
  function msg(w, t, raw = false) {
    const d = document.createElement('div'); d.className = 'msg ' + (w === 'YOU' ? 'u' : 'j');
    d.innerHTML = '<span class="meta">' + w + '</span>' + (w === 'JARVIS' && raw ? renderMarkdown(t) : esc(t).replace(/\n/g, '<br>'));
    chat.appendChild(d); chat.scrollTop = chat.scrollHeight;
  }
  function speak(t) {
    if (!S.voice || muted || !speechSynthesis) return;
    speechSynthesis.cancel(); state.textContent = 'SPEAKING';
    const u = new SpeechSynthesisUtterance(speechText(t)); u.lang = S.lang; u.rate = S.speechRate;
    u.onend = () => state.textContent = 'READY'; speechSynthesis.speak(u);
  }
  function reply(t) { msg('JARVIS', t, true); speak(t); addHistory('model', t); }
  function auth(label, fn) { pending = fn; $('confirmText').textContent = 'JARVIS wants to ' + label + '. This requires your authorization.'; $('confirm').showModal(); }
  async function weather() {
    if (!navigator.geolocation) return 'I need location support for live weather.';
    return new Promise(resolve => navigator.geolocation.getCurrentPosition(async p => {
      try { const u = `https://api.open-meteo.com/v1/forecast?latitude=${p.coords.latitude}&longitude=${p.coords.longitude}&current=temperature_2m,apparent_temperature,wind_speed_10m`; const d = await (await fetch(u)).json(), c = d.current; resolve(`It is ${c.temperature_2m}°C, feels like ${c.apparent_temperature}°C, with wind around ${c.wind_speed_10m} km/h.`); }
      catch { resolve('I could not retrieve live weather right now.'); }
    }, () => resolve('Location permission is needed for live weather.')));
  }
  function openUrl(u) { window.open(u, '_blank', 'noopener,noreferrer'); }
  function remember(text, category = 'Personal') {
    if (!S.memoryEnabled) return false;
    const clean = text.trim(); if (!clean) return false;
    S.memory.push({ id: crypto.randomUUID?.() || String(Date.now()), text: clean.slice(0, 500), category, at: Date.now(), reason: 'User explicitly asked JARVIS to remember this.' });
    S.memory = S.memory.slice(-100); saveState(); return true;
  }
  function showMemories() {
    if (!S.memory.length) return 'I do not have any saved memories yet.';
    return S.memory.slice(-8).map((m, i) => `${i + 1}. **${m.category}** — ${m.text}`).join('\n');
  }
  function localCommand(raw) {
    const x = raw.trim(), t = x.toLowerCase();
    if (['stop', 'mute', 'stop jarvis', 'be quiet'].includes(t)) { muted = true; speechSynthesis?.cancel(); state.textContent = 'MUTED'; msg('JARVIS', 'Understood. I am muted.'); return true; }
    if (['unmute', 'resume', 'speak'].includes(t)) { muted = false; state.textContent = 'READY'; reply('Voice output resumed.'); return true; }
    if (/^(what(?:'s| is)\s+)?(the\s+)?time\??$/i.test(x) || /current time/.test(t)) { reply(new Intl.DateTimeFormat(S.lang, { hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(new Date())); return true; }
    if (/^(what(?:'s| is)\s+)?(today'?s?\s+)?date\??$/i.test(x) || t === 'today') { reply(new Intl.DateTimeFormat(S.lang, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date())); return true; }
    if (t.includes('weather')) { state.textContent = 'FETCHING'; weather().then(v => { state.textContent = 'READY'; reply(v); }); return true; }
    if (t.startsWith('search ') || t.includes('search google')) { const q = x.replace(/^search google(?: for)?\s*/i, '').replace(/^search\s*/i, '').trim(); if (!q) return false; reply('Searching Google for ' + q + '.'); openUrl('https://www.google.com/search?q=' + encodeURIComponent(q)); return true; }
    if (/^open\s+youtube\b/i.test(x)) { reply('Opening YouTube.'); openUrl('https://www.youtube.com'); return true; }
    if (/^open\s+(google )?maps\b/i.test(x)) { reply('Opening Maps.'); openUrl('https://maps.google.com'); return true; }
    if (t.startsWith('call ')) { const n = x.slice(5).trim(); auth('prepare a call to ' + n, () => location.href = 'tel:' + encodeURIComponent(n)); return true; }
    if (t.startsWith('message ') || t.startsWith('sms ')) { const m = x.replace(/^(message|sms)\s*/i, ''); auth('prepare this message: ' + m, () => location.href = 'sms:?body=' + encodeURIComponent(m)); return true; }
    if (t.startsWith('remember ')) { const v = x.slice(9).trim(); if (remember(v)) reply('Remembered: ' + v); else reply('Memory is disabled in Settings.'); return true; }
    if (t.includes('what do you remember') || t.includes('show my memories')) { reply(showMemories()); return true; }
    if (t === 'forget everything' || t === 'clear all memories') { auth('clear all saved memories', () => { S.memory = []; saveState(); reply('All saved memories were cleared.'); renderMemory(); }); return true; }
    if (t.startsWith('forget ')) { const q = t.slice(7).trim(); const before = S.memory.length; S.memory = S.memory.filter(m => !m.text.toLowerCase().includes(q)); saveState(); reply(before === S.memory.length ? 'I could not find a matching memory.' : 'I forgot the matching memory.'); renderMemory(); return true; }
    return false;
  }
  async function aiCommand(x) {
    state.textContent = 'THINKING';
    try {
      const r = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: x, history: S.history.slice(-12), language: S.lang, personality: S.person, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }) });
      const d = await r.json(); if (!r.ok) throw new Error(d.error || 'AI request failed.');
      state.textContent = 'READY'; reply(d.text);
    } catch (e) { state.textContent = 'ERROR'; reply('I could not complete that request. ' + e.message); }
  }
  async function command(x) {
    x = x.trim(); if (!x) return; msg('YOU', x); addHistory('user', x); input.value = '';
    if (!localCommand(x)) await aiCommand(x);
  }
  function renderMemory() {
    const list = $('memoryList'); if (!list) return;
    list.innerHTML = S.memory.length ? S.memory.slice().reverse().map(m => `<article class="memory-card"><div><span class="pill">${esc(m.category)}</span><time>${new Date(m.at).toLocaleString()}</time></div><p>${esc(m.text)}</p><button data-forget="${esc(m.id)}">Forget</button></article>`).join('') : '<div class="empty">No saved memories.</div>';
    list.querySelectorAll('[data-forget]').forEach(b => b.onclick = () => { S.memory = S.memory.filter(m => m.id !== b.dataset.forget); saveState(); renderMemory(); });
  }
  function applyAppearance() { document.body.dataset.theme = S.theme; document.body.dataset.animations = S.animations; }

  $('send').onclick = () => command(input.value);
  $('mic').onclick = () => {
    if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) return reply('Speech recognition is not supported in this browser.');
    const R = window.SpeechRecognition || window.webkitSpeechRecognition; if (rec) { rec.stop(); return; }
    rec = new R(); rec.lang = S.lang; rec.interimResults = false; rec.maxAlternatives = 1; state.textContent = 'LISTENING'; document.body.classList.add('listening');
    rec.onresult = e => command(e.results[0][0].transcript); rec.onerror = () => { state.textContent = 'ERROR'; }; rec.onend = () => { rec = null; document.body.classList.remove('listening'); if (state.textContent === 'LISTENING') state.textContent = 'READY'; };
    rec.start();
  };
  $('stop').onclick = () => { rec?.stop(); speechSynthesis?.cancel(); muted = true; state.textContent = 'STOPPED'; msg('JARVIS', 'Stopped.'); };
  $('clear').onclick = () => { chat.innerHTML = ''; };
  $('remember').onclick = () => { const v = input.value.trim(); if (v) command('remember ' + v); else $('memoryDlg').showModal(); };
  document.querySelectorAll('[data-c]').forEach(b => b.onclick = () => { input.value = b.dataset.c; if (!b.dataset.c.endsWith(' ')) command(b.dataset.c); else input.focus(); });
  $('settings').onclick = () => { $('lang').value = S.lang; $('person').value = S.person; $('voice').checked = S.voice; $('wake').checked = S.wake; $('phrase').value = S.phrase; $('speechRate').value = S.speechRate; $('style').value = S.style; $('theme').value = S.theme; $('animations').value = S.animations; $('memoryEnabled').checked = S.memoryEnabled; $('dlg').showModal(); };
  $('save').onclick = () => { S.lang = $('lang').value; S.person = $('person').value; S.voice = $('voice').checked; S.wake = $('wake').checked; S.phrase = $('phrase').value.trim() || 'jarvis'; S.speechRate = Number($('speechRate').value || 1); S.style = $('style').value; S.theme = $('theme').value; S.animations = $('animations').value; S.memoryEnabled = $('memoryEnabled').checked; saveState(); applyAppearance(); $('dlg').close(); reply('Settings updated.'); };
  $('openMemory').onclick = () => { renderMemory(); $('memoryDlg').showModal(); };
  $('openMemoryFromSettings').onclick = () => { renderMemory(); $('memoryDlg').showModal(); };
  $('clearMemories').onclick = () => auth('clear all saved memories', () => { S.memory = []; saveState(); renderMemory(); });
  $('closeMemory').onclick = () => $('memoryDlg').close();
  $('cancel').onclick = () => { $('confirm').close(); pending = null; reply('Authorization cancelled.'); };
  $('authorize').onclick = () => { const f = pending; pending = null; $('confirm').close(); f?.(); };
  $('closeSettings').onclick = () => $('dlg').close();
  input.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('send').click(); } };
  addEventListener('online', () => net.textContent = 'ONLINE'); addEventListener('offline', () => net.textContent = 'OFFLINE'); net.textContent = navigator.onLine ? 'ONLINE' : 'OFFLINE';
  applyAppearance();
  msg('JARVIS', 'JARVIS V1.2 online. Memory, natural commands, current-time context, and the new interface are ready.', true);
})();
