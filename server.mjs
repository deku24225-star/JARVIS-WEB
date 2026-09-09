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
const SITE_NAME = process.env.OPENROUTER_SITE_NAME || 'JARVIS Web V1.5';
const VERSION = '1.5.0-agent-core';
const MAX_MESSAGES = 20;
const MAX_CHARS = 12000;

app.use(express.json({ limit: '512kb' }));
app.use(express.static(__dirname));

const TOOL_REGISTRY = [
  { name:'time', description:'Return current local time/date.', risk:0, permission:'none', confirmation:false, verify:'local result' },
  { name:'web_search', description:'Search the live web with Tavily for current or research requests.', risk:0, permission:'network', confirmation:false, verify:'source results' },
  { name:'open_url', description:'Open a public URL in the browser.', risk:1, permission:'browser', confirmation:false, verify:'navigation handed to browser' },
  { name:'open_app', description:'Open a supported web/app destination.', risk:1, permission:'browser', confirmation:false, verify:'navigation handed to browser' },
  { name:'weather', description:'Get live weather using location permission in the client.', risk:1, permission:'location', confirmation:false, verify:'weather response' },
  { name:'memory', description:'Read or change explicit user-controlled memory.', risk:1, permission:'local_storage', confirmation:true, verify:'local state' },
  { name:'dial_number', description:'Prepare a phone dialer action; never auto-call.', risk:3, permission:'phone', confirmation:true, verify:'system dialer opened' },
  { name:'compose_sms', description:'Prepare an SMS draft; never auto-send.', risk:3, permission:'phone', confirmation:true, verify:'system SMS composer opened' }
];

const BASE_INSTRUCTION = `You are JARVIS, the personal AI assistant in the JARVIS project.
Core loop: PERCEIVE -> UNDERSTAND -> REMEMBER -> REASON -> PLAN -> PERMISSION -> ACT -> VERIFY -> REPORT.
Be transparent: distinguish proposed, authorized, executed, verified, failed, and unavailable. Never claim a tool or action succeeded without a supplied result.
Never invent personal facts, companies, founders, dates, device access, contacts, hidden files, permissions, or capabilities.
Sensitive/high-impact actions must be proposed to the client and confirmed by the user there. Never bypass platform security.
For live/current claims, rely on supplied live research. If none is supplied, say verification is unavailable.
Do not reveal hidden chain-of-thought. Give concise decision summaries, relevant evidence, assumptions, and uncertainty instead.
Use clean Markdown and never spell out formatting words such as asterisk or hashtag.`;

function cleanHistory(history) {
  if (!Array.isArray(history)) return [];
  return history.slice(-MAX_MESSAGES).filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string')
    .map(m => ({ role:m.role, content:m.text.slice(0, MAX_CHARS) }));
}
function extractText(content) {
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) return content.map(x => typeof x === 'string' ? x : (x?.text || '')).join('').trim();
  return '';
}
function currentContext(timeZone='Asia/Kolkata') {
  let tz = timeZone;
  let parts;
  try { parts = new Intl.DateTimeFormat('en-IN',{timeZone:tz,weekday:'long',year:'numeric',month:'long',day:'numeric',hour:'numeric',minute:'2-digit',second:'2-digit',hour12:true,timeZoneName:'short'}).formatToParts(new Date()); }
  catch { tz='Asia/Kolkata'; parts = new Intl.DateTimeFormat('en-IN',{timeZone:tz,weekday:'long',year:'numeric',month:'long',day:'numeric',hour:'numeric',minute:'2-digit',second:'2-digit',hour12:true,timeZoneName:'short'}).formatToParts(new Date()); }
  return { iso:new Date().toISOString(), timeZone:tz, formatted:parts.map(p=>p.value).join('') };
}
function looksCurrent(text) { return /\b(today|now|current|currently|latest|recent|breaking|this week|this month|this year|live|price|scores?|news|weather|exchange rate|updated|who is the current|who's the current|what is the current|what's the current)\b/i.test(text) || /\b(who is|who's|name of)\b.*\b(prime minister|president|chief minister|ceo|monarch|chancellor)\b/i.test(text) || /\b(आज|अभी|वर्तमान|नवीनतम|ताज़ा|मौसम|कीमत|स्कोर|प्रधानमंत्री|राष्ट्रपति|मुख्यमंत्री)\b/i.test(text); }
function looksLikeWebRequest(text) { return looksCurrent(text) || /^(search|research|look up|find online|browse|what does the web say)\b/i.test(text.trim()); }
function compactWebResults(data) { return (Array.isArray(data?.results)?data.results:[]).slice(0,6).map((r,i)=>({rank:i+1,title:String(r?.title||'').slice(0,240),url:String(r?.url||'').slice(0,500),content:String(r?.content||r?.raw_content||'').slice(0,900),score:typeof r?.score==='number'?Number(r.score.toFixed(3)):null})).filter(r=>r.title||r.url||r.content); }
async function tavilySearch(query, options={}) {
  if (!TAVILY_API_KEY) throw new Error('TAVILY_NOT_CONFIGURED');
  const body={query:query.slice(0,1000),search_depth:options.searchDepth||'basic',topic:options.topic||(looksCurrent(query)?'news':'general'),max_results:Math.min(Math.max(Number(options.maxResults)||5,1),8),include_answer:false,include_raw_content:false};
  const response=await fetch(TAVILY_URL,{method:'POST',headers:{Authorization:`Bearer ${TAVILY_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(`TAVILY_${response.status}: ${data?.message||data?.error||'provider error'}`);
  return data;
}
async function callOpenRouter({messages,temperature=0.5}) {
  if(!OPENROUTER_API_KEY) throw new Error('OPENROUTER_NOT_CONFIGURED');
  const r=await fetch(OPENROUTER_URL,{method:'POST',headers:{Authorization:`Bearer ${OPENROUTER_API_KEY}`,'Content-Type':'application/json','HTTP-Referer':PUBLIC_APP_URL,'X-Title':SITE_NAME},body:JSON.stringify({model:OPENROUTER_MODEL,messages,temperature})});
  const d=await r.json().catch(()=>({})); if(!r.ok) throw new Error(`OPENROUTER_${r.status}: ${d?.error?.message||'provider error'}`);
  const text=extractText(d?.choices?.[0]?.message?.content); if(!text) throw new Error('OPENROUTER_EMPTY');
  return {text,provider:'OpenRouter',model:d?.model||OPENROUTER_MODEL,requestId:d?.id||null};
}
function geminiContents(history,userMessage){return [...history,{role:'user',content:userMessage}].map(x=>({role:x.role==='assistant'?'model':'user',parts:[{text:x.content}]}));}
async function callGemini({messages,temperature=0.5}) {
  if(!GEMINI_API_KEY) throw new Error('GEMINI_NOT_CONFIGURED');
  const system=messages.find(m=>m.role==='system')?.content||''; const h=messages.filter(m=>m.role!=='system'); const last=h.pop();
  const r=await fetch(`${GEMINI_BASE}/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({system_instruction:{parts:[{text:system}]},contents:geminiContents(h,last?.content||''),generationConfig:{temperature,maxOutputTokens:1800}})});
  const d=await r.json().catch(()=>({})); if(!r.ok) throw new Error(`GEMINI_${r.status}: ${d?.error?.message||'provider error'}`);
  const text=extractText(d?.candidates?.[0]?.content?.parts||''); if(!text) throw new Error('GEMINI_EMPTY');
  return {text,provider:'Gemini',model:d?.modelVersion||GEMINI_MODEL,requestId:d?.responseId||null};
}
async function generateWithFailover(args){
  const failures=[];
  if(OPENROUTER_API_KEY){try{return {...await callOpenRouter(args),fallbackUsed:false,failures};}catch(e){failures.push({provider:'OpenRouter',code:e.message});}}
  if(GEMINI_API_KEY){try{return {...await callGemini(args),fallbackUsed:true,failures};}catch(e){failures.push({provider:'Gemini',code:e.message});}}
  const e=new Error('All configured AI providers were unavailable.'); e.failures=failures; throw e;
}

function inferTool(message) {
  const t=message.trim();
  if(/^(what(?:'s| is)\s+)?(the\s+)?time\??$/i.test(t)||/\bcurrent time\b/i.test(t)) return {name:'time',args:{},risk:0,requiresConfirmation:false};
  if(/\bweather\b/i.test(t)) return {name:'weather',args:{},risk:1,requiresConfirmation:false};
  if(/^open\s+youtube\b/i.test(t)) return {name:'open_url',args:{url:'https://www.youtube.com'},risk:1,requiresConfirmation:false};
  if(/^open\s+(google\s+)?maps\b/i.test(t)) return {name:'open_url',args:{url:'https://maps.google.com'},risk:1,requiresConfirmation:false};
  if(/^search\s+/i.test(t)||/\bsearch google\b/i.test(t)) return {name:'open_url',args:{url:'https://www.google.com/search?q='+encodeURIComponent(t.replace(/^search(?: google)?(?: for)?\s*/i,'').trim())},risk:1,requiresConfirmation:false};
  if(/^call\s+\+?[\d\s().-]{7,20}$/i.test(t)){const number=t.replace(/^call\s*/i,'').replace(/[\s().-]/g,'');return {name:'dial_number',args:{number},risk:3,requiresConfirmation:true};}
  if(/^(message|sms)\s+/i.test(t)) return {name:'compose_sms',args:{body:t.replace(/^(message|sms)\s*/i,'').trim()},risk:3,requiresConfirmation:true};
  return null;
}

app.get('/api/health',(_req,res)=>res.json({ok:true,version:VERSION,webSearch:WEB_SEARCH,providers:{openrouter:{configured:!!OPENROUTER_API_KEY,model:OPENROUTER_MODEL,primary:true},gemini:{configured:!!GEMINI_API_KEY,model:GEMINI_MODEL,fallback:true},tavily:{configured:!!TAVILY_API_KEY,role:'live_web'}}}));
app.get('/api/tools',(_req,res)=>res.json({ok:true,version:VERSION,tools:TOOL_REGISTRY}));
app.get('/api/diagnostics',(_req,res)=>res.json({ok:true,version:VERSION,timestamp:new Date().toISOString(),network:'server reachable',webSearchEnabled:WEB_SEARCH,orchestration:'agent-core',providers:{openrouter:{configured:!!OPENROUTER_API_KEY,model:OPENROUTER_MODEL},gemini:{configured:!!GEMINI_API_KEY,model:GEMINI_MODEL},tavily:{configured:!!TAVILY_API_KEY}},tools:TOOL_REGISTRY.map(t=>t.name)}));
app.get('/api/time',(req,res)=>res.json({ok:true,...currentContext(typeof req.query.tz==='string'?req.query.tz:'Asia/Kolkata')}));

app.post('/api/web-search',async(req,res)=>{if(!WEB_SEARCH)return res.status(503).json({ok:false,error:'Live web search is disabled.'});const query=typeof req.body?.query==='string'?req.body.query.trim():'';if(!query||query.length>1000)return res.status(400).json({ok:false,error:'Invalid search query.'});try{const data=await tavilySearch(query,req.body||{});res.json({ok:true,query,source:'Tavily',results:compactWebResults(data)});}catch(e){res.status(502).json({ok:false,error:e.message==='TAVILY_NOT_CONFIGURED'?'Live web search is not configured yet.':'JARVIS could not complete the web search right now.'});}});

app.post('/api/verify',async(req,res)=>{const claim=typeof req.body?.claim==='string'?req.body.claim.trim():'';if(!claim||claim.length>2000)return res.status(400).json({ok:false,error:'A claim is required.'});if(!WEB_SEARCH||!TAVILY_API_KEY)return res.status(503).json({ok:false,error:'Live verification is not configured.'});try{const data=await tavilySearch(claim,{topic:'general',searchDepth:'advanced',maxResults:5});const results=compactWebResults(data);res.json({ok:true,claim,verified:results.length>0,results:results.map(r=>({title:r.title,url:r.url,snippet:r.content,score:r.score}))});}catch(e){res.status(502).json({ok:false,error:'Verification failed right now.'});}});

app.post('/api/plan',async(req,res)=>{const goal=typeof req.body?.goal==='string'?req.body.goal.trim():'';if(!goal||goal.length>3000)return res.status(400).json({ok:false,error:'A goal is required.'});const inferred=inferTool(goal);const steps=inferred?[{id:1,title:'Interpret request',status:'ready'},{id:2,title:`Prepare ${inferred.name}`,status:'ready'},{id:3,title:inferred.requiresConfirmation?'Request user authorization':'Execute permitted low-risk tool',status:'blocked',blockedBy:inferred.requiresConfirmation?'user confirmation':null},{id:4,title:'Verify result and report',status:'pending'}]:[{id:1,title:'Understand goal',status:'ready'},{id:2,title:'Choose required tools',status:'ready'},{id:3,title:'Execute approved steps',status:'pending'},{id:4,title:'Verify and report',status:'pending'}];res.json({ok:true,goal,plan:{goal,steps,toolProposal:inferred}});});

app.post('/api/agent',async(req,res)=>{
  const message=typeof req.body?.message==='string'?req.body.message.trim():'';if(!message||message.length>MAX_CHARS)return res.status(400).json({ok:false,error:'Invalid message.'});
  const history=cleanHistory(req.body?.history);const language=req.body?.language==='hi-IN'?'Hindi':'English';const personality=String(req.body?.personality||'Male Best Friend').slice(0,80);const responseStyle=String(req.body?.responseStyle||'balanced').slice(0,30);const timeZone=String(req.body?.timeZone||'Asia/Kolkata').slice(0,80);const ctx=currentContext(timeZone);const tool=inferTool(message);
  let sources=[];let webUsed=false;
  if(WEB_SEARCH&&looksLikeWebRequest(message)){try{sources=compactWebResults(await tavilySearch(message,{topic:looksCurrent(message)?'news':'general',searchDepth:looksCurrent(message)?'basic':'fast',maxResults:5}));webUsed=sources.length>0;}catch{}}
  const action=tool&&tool.requiresConfirmation?{name:tool.name,args:tool.args,risk:tool.risk,requiresConfirmation:true,preview:tool.name==='dial_number'?`Prepare a call to ${tool.args.number}`:`Prepare an SMS draft: ${tool.args.body}`,status:'proposed'}:null;
  const webContext=sources.length?`\nLIVE WEB EVIDENCE:\n${sources.map(r=>`[${r.rank}] ${r.title}\nURL: ${r.url}\n${r.content}`).join('\n\n')}`:'';
  const system=`${BASE_INSTRUCTION}\nLanguage: ${language}. Personality: ${personality}. Response style: ${responseStyle}. Current time: ${ctx.formatted} (${ctx.timeZone}).\nIf an action proposal is supplied, do not say it executed; tell the user it is awaiting authorization.${webContext}`;
  const messages=[{role:'system',content:system},...history,{role:'user',content:message}];
  try{const result=await generateWithFailover({messages});res.json({ok:true,text:result.text,provider:result.provider,model:result.model,requestId:result.requestId,fallbackUsed:result.fallbackUsed,failures:result.failures,webUsed,sources:sources.map(({title,url,score})=>({title,url,score})),toolProposal:tool,actionProposal:action,plan:tool?{goal:message,steps:[{title:'Understand',status:'complete'},{title:`Prepare ${tool.name}`,status:'complete'},{title:action?'Await authorization':'Execute permitted tool',status:action?'blocked':'ready'},{title:'Verify and report',status:'pending'}]}:null});}
  catch(e){res.status(503).json({ok:false,error:'JARVIS AI is temporarily unavailable. Local tools remain available.',failures:e.failures||[]});}
});

// Backward-compatible V1.4 endpoint; V1.5 client should use /api/agent.
app.post('/api/chat',async(req,res)=>{req.url='/api/agent';return app._router?.handle?void app._router.handle(req,res,()=>{}):res.status(500).json({ok:false,error:'Routing unavailable'});});
app.use((_req,res)=>res.sendFile(path.join(__dirname,'index.html')));
app.listen(port,'0.0.0.0',()=>console.log(`JARVIS ${VERSION} running on port ${port}`));
