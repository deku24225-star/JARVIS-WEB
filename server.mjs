import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 3000);
const apiKey = process.env.OPENROUTER_API_KEY;
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = process.env.OPENROUTER_MODEL || 'openrouter/free';
const WEB_SEARCH = String(process.env.OPENROUTER_WEB_SEARCH || 'true').toLowerCase() === 'true';
const MAX_MESSAGES = 20;
const MAX_CHARS = 12000;
const VERSION = '1.3.0-openrouter';

app.use(express.json({ limit: '256kb' }));
app.use(express.static(__dirname));

const BASE_INSTRUCTION = `You are JARVIS, a helpful futuristic personal AI assistant inside the JARVIS Web project.
Identity rules: You are JARVIS Web. Do not invent a company, founder, creator, legal entity, founding year, or fictional corporate history. If asked about your origin, state that you are the personal AI assistant in this project and that no separate real-world founding date or company has been established. Do not mention “Milimax” unless the user explicitly provides it as a fact.
Personality: confident, warm, concise, intelligent, lightly witty, and like a trusted best friend.
Never claim to have performed a device action unless the application actually performed it.
The browser is sandboxed: never pretend you can access private contacts, hidden files, camera, microphone, calls, messages, or Android settings unless the application really performs a supported action.
Sensitive actions require explicit user confirmation in the UI. Never bypass permissions, authentication, or platform security.
Use the supplied current date/time context for date questions. Never assume a fixed year.
For current, latest, recent, today's, or office-holder questions, use the supplied web-search results when available. Do not pretend stale model knowledge is current. If live search fails or is unavailable, say that clearly.
When web search results are provided, answer from them, cite sources using the links supplied by the web plugin, and make the freshness clear without overclaiming.
Support English and Hindi naturally. Tolerate spelling and speech-to-text mistakes.
Return clean user-facing text using normal Markdown for visual rendering. Never spell out formatting words such as “asterisk” or “hashtag” as an explanation of formatting.
Do not invent unsupported personal facts about the user.
Keep normal replies reasonably concise unless the user asks for depth.`;

function cleanHistory(history) {
  if (!Array.isArray(history)) return [];
  return history.slice(-MAX_MESSAGES)
    .filter(m => m && (m.role === 'user' || m.role === 'model' || m.role === 'assistant') && typeof m.text === 'string')
    .map(m => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.text.slice(0, MAX_CHARS)
    }));
}

function extractText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(part => typeof part === 'string' ? part : (part?.text || '')).join('').trim();
  }
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
    parts = new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true, timeZoneName: 'short'
    }).formatToParts(now);
    timeZone = 'Asia/Kolkata';
  }
  return {
    iso: now.toISOString(),
    timeZone,
    formatted: parts.map(p => p.value).join('')
  };
}

function looksCurrent(text) {
  const currentWords = /\b(today|now|current|currently|latest|recent|breaking|this week|this month|this year|just now|right now|who is the current|who's the current|what is the current|what's the current|price|scores?|news|weather|exchange rate|live)\b/i;
  const officeHolder = /\b(who is|who's|name of)\b.*\b(prime minister|president|vice president|chief minister|king|queen|monarch|chancellor|secretary[- ]general|ceo)\b/i;
  const hindi = /\b(आज|अभी|वर्तमान|नवीनतम|ताज़ा|आज क्या हुआ|इस समय|मौसम|कीमत|स्कोर|प्रधानमंत्री|राष्ट्रपति|मुख्यमंत्री)\b/i;
  return currentWords.test(text) || officeHolder.test(text) || hindi.test(text);
}

function sanitizeForModel(text) {
  return String(text)
    .replace(/\b(?:asterisk|hashtag|markdown)\b/gi, '')
    .slice(0, MAX_CHARS);
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    aiConfigured: Boolean(apiKey),
    provider: 'OpenRouter',
    model: MODEL,
    webSearch: WEB_SEARCH,
    version: VERSION
  });
});

app.get('/api/time', (req, res) => {
  const requested = typeof req.query.tz === 'string' ? req.query.tz : 'Asia/Kolkata';
  res.json({ ok: true, ...currentContext(requested) });
});

app.post('/api/chat', async (req, res) => {
  if (!apiKey) {
    return res.status(503).json({ error: 'JARVIS AI backend is not configured yet. Add OPENROUTER_API_KEY to the server environment.' });
  }

  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  if (!message || message.length > MAX_CHARS) return res.status(400).json({ error: 'Invalid message.' });

  const history = cleanHistory(req.body?.history);
  const language = req.body?.language === 'hi-IN' ? 'Hindi' : 'English';
  const personality = typeof req.body?.personality === 'string' ? req.body.personality.slice(0, 80) : 'Male Best Friend';
  const responseStyle = typeof req.body?.responseStyle === 'string' ? req.body.responseStyle.slice(0, 30) : 'balanced';
  const timeZone = typeof req.body?.timeZone === 'string' ? req.body.timeZone.slice(0, 80) : 'Asia/Kolkata';
  const ctx = currentContext(timeZone);
  const currentRequest = looksCurrent(message);
  const webAllowed = WEB_SEARCH && currentRequest;

  const systemContent = `${BASE_INSTRUCTION}\nCurrent response language: ${language}.\nSelected personality: ${personality}.\nResponse style: ${responseStyle}.\nCurrent server time context: ${ctx.formatted} (${ctx.timeZone}); ISO: ${ctx.iso}.\nCurrent-information request detected: ${currentRequest ? 'YES' : 'NO'}.\nLive web grounding for this request: ${webAllowed ? 'ENABLED' : 'NOT ENABLED'}.'`;

  const messages = [
    { role: 'system', content: systemContent },
    ...history,
    { role: 'user', content: sanitizeForModel(message) }
  ];

  const body = {
    model: MODEL,
    messages,
    temperature: 0.5
  };

  if (webAllowed) {
    body.plugins = [{ id: 'web', max_results: 5 }];
  }

  try {
    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.OPENROUTER_SITE_URL || 'http://localhost:3000',
        'X-Title': process.env.OPENROUTER_SITE_NAME || 'JARVIS Web V1.3'
      },
      body: JSON.stringify(body)
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const providerMessage = data?.error?.message || data?.error || `HTTP ${response.status}`;
      console.error('OpenRouter request failed:', providerMessage);
      return res.status(502).json({ error: `JARVIS AI request failed: ${String(providerMessage).slice(0, 500)}` });
    }

    const text = extractText(data?.choices?.[0]?.message?.content);
    if (!text) return res.status(502).json({ error: 'The AI returned an empty response. Try again.' });

    res.json({
      ok: true,
      text,
      requestId: data?.id || null,
      model: data?.model || MODEL,
      provider: 'OpenRouter',
      currentRequest,
      webUsed: webAllowed
    });
  } catch (error) {
    console.error('OpenRouter request failed:', error?.message || error);
    res.status(502).json({ error: 'JARVIS could not reach OpenRouter right now. Check the backend configuration and try again.' });
  }
});

app.use((_req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.listen(port, '0.0.0.0', () => {
  console.log(`JARVIS ${VERSION} backend running on port ${port}`);
  console.log(`Model: ${MODEL} | Current-info web search: ${WEB_SEARCH ? 'AVAILABLE' : 'OFF'}`);
});
