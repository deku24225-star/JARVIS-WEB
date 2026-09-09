# JARVIS Web V1.5 — Agent Core

V1.5 is the next incremental JARVIS Web release. It keeps the V1.4 provider foundation and adds a real agent/tool orchestration layer instead of treating every capability as a loose shortcut.

## Core loop

PERCEIVE → UNDERSTAND → REMEMBER → REASON → PLAN → PERMISSION → ACT → VERIFY → REPORT

## V1.5 additions

- Central Agent Core endpoint: `/api/agent`
- Standardized Tool Registry: `/api/tools`
- Structured task planning: `/api/plan`
- Live claim verification: `/api/verify`
- Risk-aware tool metadata (risk, permission, confirmation, verification)
- Action proposals are separate from execution
- High-impact call/SMS actions remain confirmation-gated in the client
- Activity Trail showing decisions, tools, planning and authorization events
- Action Preview UI with risk, action and consequence information
- OpenRouter primary → Gemini fallback remains intact
- Tavily remains the dedicated live-web tool
- Current-information requests are grounded with live search when configured
- Browser/device limitations are explicitly respected
- No hidden chain-of-thought is exposed; the UI shows concise decision summaries and tool activity
- Existing memory, voice, text, weather, time/date, search, YouTube, Maps and PWA features are preserved

## Tool model

Each registered tool has:

- name
- description
- risk level
- required permission
- confirmation requirement
- verification method

Risk levels are conceptually:

- Level 0 — information
- Level 1 — low-risk
- Level 2 — sensitive
- Level 3 — high-impact

The web client cannot bypass browser or Android security. V2 remains the native Android destination.

## Environment

```text
OPENROUTER_API_KEY=your_openrouter_api_key
OPENROUTER_MODEL=openrouter/free
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-3.7-flash
TAVILY_API_KEY=your_tavily_api_key
WEB_SEARCH=true
PUBLIC_APP_URL=https://your-render-service.onrender.com
OPENROUTER_SITE_NAME=JARVIS Web V1.5
PORT=3000
```

Keep all API keys server-side. Never commit `.env`.

## Local run

```bash
npm install
npm start
```

Then open the local server in a browser.

## API surface

- `GET /api/health` — non-secret provider status
- `GET /api/tools` — tool registry
- `GET /api/diagnostics` — non-secret diagnostics
- `GET /api/time` — timezone-aware current time
- `POST /api/web-search` — direct Tavily search
- `POST /api/verify` — evidence lookup for a claim
- `POST /api/plan` — structured task plan
- `POST /api/agent` — central JARVIS agent orchestration

## Acceptance tests

1. Normal question uses OpenRouter when configured.
2. OpenRouter failure automatically falls back to Gemini when configured.
3. Current/latest questions use Tavily when live search is enabled.
4. `/api/tools` returns risk-aware tool metadata without secrets.
5. `/api/plan` returns steps and a tool proposal for recognized actions.
6. `/api/verify` returns evidence or a clear unavailable/error state.
7. `/api/agent` returns provider metadata and structured tool/action proposals.
8. Text input stays silent; voice input can speak automatically.
9. Call and SMS remain authorization-gated and are never auto-sent/auto-called.
10. Canceling authorization never executes the action.
11. Activity Trail records plan/proposal/authorization events.
12. No API key is exposed to the browser.
13. No unsupported Android/device capability is claimed.

## Version boundary

V1.x is the web/PWA development and orchestration platform. **V2 is a separate native Android Kotlin application**, not a WebView wrapper.
