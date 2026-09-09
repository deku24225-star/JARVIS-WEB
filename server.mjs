import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 3000);

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const TAVILY_URL = 'https://api.tavily.com/search';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'openrouter/free';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.7-flash';
const TAVILY_API_KEY = process.env.TAVILY_API_KEY || '';
const WEB_SEARCH = String(process.env.WEB_SEARCH ?? 'true').toLowerCase() === 'true';
const PUBLIC_APP_URL = process.env.PUBLIC_APP_URL || process.env.OPENROUTER_SITE_URL || 'http://localhost:3000';
const SITE_NAME = process.env.OPENROUTER_SITE_NAME || 'JARVIS Web V1.4';

const MAX_MESSAGES = 20;
const MAX_CHARS = 12000;
const VERSION = '1.4.0-core';

app.use(express.json({ limit: '512kb' }));
app.use(express.static(__dirname));

const BASE_INSTRUCTION = `You are JARVIS, a personal AI assistant inside the JARVIS project.
Identity: You are JARVIS. Never invent a company, founder, creator, legal entity, or founding year. Do not mention Milimax unless the user explicitly supplies it as a fact.
Personality: intelligent, calm, confident, concise when possible, detailed when useful, lightly witty, and honest about uncertainty.
Core principle: PERCEIVE -> UNDERSTAND -> REMEMBER -> REASON -> PLAN -> PERMISSION -> ACT -> VERIFY -> REPORT.
Never claim an action happened unless a real tool or application result confirms it. Distinguish clearly between prepared, authorized, executed, verified, failed, and unavailable.
The browser is sandboxed. Never pretend you can access private contacts, hidden files, camera, microphone, calls, messages, Android settings, or device state unless the application actually provides the capability.
Sensitive actions require explicit user confirmation in the UI. Never bypass permissions, authentication, or platform security.
Use supplied current date/time context for date questions. Never assume a fixed year.
When live research results are supplied, use them as the source of truth for time-sensitive claims. Compare sources when useful, mention meaningful conflicts, and provide concise source attribution with the supplied URLs.
Do not say you have real-time information when no live web results were provided.
Support English and Hindi naturally. Tolerate speech-to-text mistakes.
Return clean user-facing Markdown. Do not spell out formatting words such as “asterisk” or “hashtag”.
Never invent unsupported personal facts. Keep responses reasonably concise unless the user asks for depth.`;

function cleanHistory(history) {
  if (!Array.isArray(history)) return [];
  return history.slice(-MAX_MESSAGES)
    .filter(m => m && (m.role === 'user' || m.role === 'model' || m.role === 'assistant') && typeof m.text === 'string')
    .map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text.slice(0, MAX_CHARS) }));
}

function extractText(content) {
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) return content.map(part => typeof part === 'string' ? part : (part?.text || '')).join('').trim();
  return '';
}

function currentContext(timeZone = 'Asia/Kolkata') {
  const now = new Date();
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-IN', {
      timeZone,
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true, timeZoneName: 'short'
    }).formatToParts(now);
  } catch {
    timeZone = 'Asia/Kolkata';
    parts = new Intl.DateTimeFormat('en-IN', {
      timeZone, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true, timeZoneName: 'short'
    }).formatToParts(now);
  }
  return { iso: now.toISOString(), timeZone, formatted: parts.map(p => p.value).join('') };
}

function looksCurrent(text) {
  const currentWords = /\b(today|now|current|currently|latest|recent|breaking|this week|this month|this year|just now|right now|price|scores?|news|weather|exchange rate|live|release|updated|who is the current|who's the current|what is the current|what's the current)\b/i;
  const officeHolder = /\b(who is|who's|name of)\b.*\b(prime minister|president|vice president|chief minister|king|queen|monarch|chancellor|secretary[- ]general|ceo)\b/i;
  const hindi = /\b(आज|अभी|वर्तमान|नवीनतम|ताज़ा|इस समय|मौसम|कीमत|स्कोर|प्रधानमंत्री|राष्ट्रपति|मुख्यमंत्री)\b/i;
  return currentWords.test(text) || officeHolder.test(text) || hindi.test(text);
}

function looksLikeWebRequest(text) {
  return looksCurrent(text) || /^(search|research|look up|find online|browse|what does the web say)\b/i.test(text.trim());
}

function sanitizeForModel(text) {
  return String(text).replace(/\b(?:asterisk|hashtag)\b/gi, '').slice(0, MAX_CHARS);
}

function compactWebResults(data) {
  const results = Array.isArray(data?.results) ? data.results : [];
  return results.slice(0, 6).map((r, i) => ({
    rank: i + 1,
    title: String(r?.title || '').slice(0, 240),
    url: String(r?.url || '').slice(0, 500),
    content: String(r?.content || r?.raw_content || '').slice(0, 900),
    score: typeof r?.score === 'number' ? Number(r.score.toFixed(3)) : null
  })).filter(r => r.title || r.url || r.content);
}

async function tavilySearch(query, options = {}) {
  if (!TAVILY_API_KEY) throw new Error('TAVILY_NOT_CONFIGURED');
  const body = {
    query: query.slice(0, 1000),
    search_depth: options.searchDepth || 'basic',
    topic: options.topic || (looksCurrent(query) ? 'news' : 'general'),
    max_results: Math.min(Math.max(Number(options.maxResults) || 5, 1), 8),
    include_answer: false,
    include_raw_content: false
  };
  if (options.timeRange) body.time_range = options.timeRange;
  if (Array.isArray(options.includeDomains) && options.includeDomains.length) body.include_domains = options.includeDomains.slice(0, 20);

  const response = await fetch(TAVILY_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TAVILY_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data?.message || data?.error || `HTTP ${response.status}`;
    throw new Error(`TAVILY_${response.status}: ${detail}`);
  }
  return data;
}

async function callOpenRouter({ messages }) {
  if (!OPENROUTER_API_KEY) throw new Error('OPENROUTER_NOT_CONFIGURED');
  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': PUBLIC_APP_URL,
      'X-Title': SITE_NAME
    },
    body: JSON.stringify({ model: OPENROUTER_MODEL, messages, temperature: 0.5 })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`OPENROUTER_${response.status}: ${data?.error?.message || data?.error || 'provider error'}`);
  const text = extractText(data?.choices?.[0]?.message?.content);
  if (!text) throw new Error('OPENROUTER_EMPTY');
  return { text, provider: 'OpenRouter', model: data?.model || OPENROUTER_MODEL, requestId: data?.id || null };
}

function geminiContents(history, userMessage) {
  const contents = [];
  for (const item of history) {
    contents.push({ role: item.role === 'assistant' ? 'model' : 'user', parts: [{ text: item.content }] });
  }
  contents.push({ role: 'user', parts: [{ text: userMessage }] });
  return contents;
}

async function callGemini({ messages }) {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_NOT_CONFIGURED');
  const system = messages.find(m => m.role === 'system')?.content || '';
  const history = messages.filter(m => m.role !== 'system' && (m.role === 'user' || m.role === 'assistant'));
  const lastUser = [...history].reverse().find(m => m.role === 'user')?.content || '';
  const chatHistory = history.slice(0, -1);
  const url = `${GEMINI_BASE}/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents: geminiContents(chatHistory, lastUser),
      generationConfig: { temperature: 0.5, maxOutputTokens: 1600 }
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`GEMINI_${response.status}: ${data?.error?.message || 'provider error'}`);
  const text = extractText(data?.candidates?.[0]?.content?.parts || '');
  if (!text) throw new Error('GEMINI_EMPTY');
  return { text, provider: 'Gemini', model: data?.modelVersion || GEMINI_MODEL, requestId: data?.responseId || null };
}

async function generateWithFailover(args) {
  const failures = [];
  if (OPENROUTER_API_KEY) {
    try { return { ...(await callOpenRouter(args)), fallbackUsed: false, failures }; }
    catch (error) { console.error('OpenRouter failure:', error?.message || error); failures.push({ provider: 'OpenRouter', code: error?.message || 'error' }); }
  }
  if (GEMINI_API_KEY) {
    try { return { ...(await callGemini(args)), fallbackUsed: true, failures }; }
    catch (error) { console.error('Gemini failure:', error?.message || error); failures.push({ provider: 'Gemini', code: error?.message || 'error' }); }
  }
  const reason = failures.length ? 'All configured AI providers were unavailable.' : 'No AI provider is configured on the server.';
  const error = new Error(reason);
  error.failures = failures;
  throw error;
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    version: VERSION,
    webSearch: WEB_SEARCH,
    providers: {
      openrouter: { configured: Boolean(OPENROUTER_API_KEY), model: OPENROUTER_MODEL, primary: true },
      gemini: { configured: Boolean(GEMINI_API_KEY), model: GEMINI_MODEL, fallback: true },
      tavily: { configured: Boolean(TAVILY_API_KEY), role: 'live_web' }
    }
  });
});

app.get('/api/diagnostics', async (_req, res) => {
  res.json({
    ok: true,
    version: VERSION,
    timestamp: new Date().toISOString(),
    network: 'server reachable',
    webSearchEnabled: WEB_SEARCH,
    providers: {
      openrouter: { configured: Boolean(OPENROUTER_API_KEY), model: OPENROUTER_MODEL },
      gemini: { configured: Boolean(GEMINI_API_KEY), model: GEMINI_MODEL },
      tavily: { configured: Boolean(TAVILY_API_KEY) }
    },
    tools: ['time', 'web_search', 'open_url', 'memory_client', 'authorization_gate']
  });
});

app.get('/api/time', (req, res) => {
  const requested = typeof req.query.tz === 'string' ? req.query.tz : 'Asia/Kolkata';
  res.json({ ok: true, ...currentContext(requested) });
});

app.post('/api/web-search', async (req, res) => {
  if (!WEB_SEARCH) return res.status(503).json({ ok: false, error: 'Live web search is disabled by WEB_SEARCH.' });
  const query = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
  if (!query || query.length > 1000) return res.status(400).json({ ok: false, error: 'Invalid search query.' });
  try {
    const data = await tavilySearch(query, req.body || {});
    res.json({ ok: true, query, source: 'Tavily', results: compactWebResults(data) });
  } catch (error) {
    console.error('Tavily search failed:', error?.message || error);
    const message = error?.message === 'TAVILY_NOT_CONFIGURED' ? 'Live web search is not configured yet.' : 'JARVIS could not complete the web search right now.';
    res.status(502).json({ ok: false, error: message });
  }
});

app.post('/api/chat', async (req, res) => {
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  if (!message || message.length > MAX_CHARS) return res.status(400).json({ ok: false, error: 'Invalid message.' });

  const history = cleanHistory(req.body?.history);
  const language = req.body?.language === 'hi-IN' ? 'Hindi' : 'English';
  const personality = typeof req.body?.personality === 'string' ? req.body.personality.slice(0, 80) : 'Male Best Friend';
  const responseStyle = typeof req.body?.responseStyle === 'string' ? req.body.responseStyle.slice(0, 30) : 'balanced';
  const timeZone = typeof req.body?.timeZone === 'string' ? req.body.timeZone.slice(0, 80) : 'Asia/Kolkata';
  const ctx = currentContext(timeZone);
  const webNeeded = WEB_SEARCH && looksLikeWebRequest(message);

  let webData = null;
  let webUsed = false;
  if (webNeeded) {
    try {
      webData = await tavilySearch(message, {
        topic: looksCurrent(message) ? 'news' : 'general',
        searchDepth: looksCurrent(message) ? 'basic' : 'fast',
        maxResults: 5
      });
      webUsed = true;
    } catch (error) {
      console.error('Tavily grounding failed:', error?.message || error);
    }
  }

  const sources = compactWebResults(webData);
  const webContext = sources.length
    ? `\nLIVE WEB RESEARCH (Tavily) — treat these results as current evidence, not as model memory:\n${sources.map(r => `[${r.rank}] ${r.title}\nURL: ${r.url}\nSnippet: ${r.content}`).join('\n\n')}\n\nUse only supported claims. At the end, add a compact Sources section with the relevant URLs as Markdown links.`
    : (webNeeded ? '\nLIVE WEB RESEARCH was requested but no usable web results were returned. State that live verification was unavailable; do not fabricate current facts.\n' : '');

  const systemContent = `${BASE_INSTRUCTION}\nResponse language: ${language}.\nPersonality: ${personality}.\nResponse style: ${responseStyle}.\nCurrent time: ${ctx.formatted} (${ctx.timeZone}); ISO: ${ctx.iso}.\nLive research requested: ${webNeeded ? 'YES' : 'NO'}.${webContext}`;
  const messages = [{ role: 'system', content: systemContent }, ...history, { role: 'user', content: sanitizeForModel(message) }];

  try {
    const result = await generateWithFailover({ messages });
    res.json({
      ok: true,
      text: result.text,
      provider: result.provider,
      model: result.model,
      requestId: result.requestId,
      fallbackUsed: result.fallbackUsed,
      failures: result.failures,
      webUsed,
      sources: sources.map(({ title, url, score }) => ({ title, url, score }))
    });
  } catch (error) {
    console.error('JARVIS AI failure:', error?.message || error);
    const localMessage = 'JARVIS AI is temporarily unavailable. Your local tools can still operate.';
    res.status(503).json({ ok: false, error: localMessage, failures: error?.failures || [] });
  }
});

app.use((_req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.listen(port, '0.0.0.0', () => {
  console.log(`JARVIS ${VERSION} running on port ${port}`);
  console.log(`OpenRouter: ${OPENROUTER_API_KEY ? 'configured' : 'missing'} | Gemini fallback: ${GEMINI_API_KEY ? 'configured' : 'missing'} | Tavily: ${TAVILY_API_KEY ? 'configured' : 'missing'} | Web search: ${WEB_SEARCH ? 'on' : 'off'}`);
});
