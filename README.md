# 🦾 JARVIS Web V1.4

V1.4 upgrades the V1.3 web prototype into a provider-aware JARVIS Core foundation while preserving the earlier UI, memory, voice, authorization, time/date, weather, Maps, YouTube, search, and PWA behavior.

## What changed

- OpenRouter is the primary AI provider.
- Gemini is a real automatic fallback provider.
- Tavily is the dedicated live-web provider.
- `WEB_SEARCH=true` enables automatic web grounding for current/latest/news/price/weather/office-holder style requests and explicit web-search requests.
- A central server-side provider/orchestration layer now routes AI requests and web research.
- Current web results are passed into the AI with source attribution.
- `/api/health` exposes non-secret provider configuration status.
- `/api/diagnostics` exposes non-secret core/tool diagnostics.
- `/api/web-search` provides a structured Tavily search endpoint.
- Provider failures are logged on the server and returned to the UI as user-safe messages.
- API keys remain server-side.

## Environment variables

Required/optional server variables:

```text
OPENROUTER_API_KEY
OPENROUTER_MODEL
GEMINI_API_KEY
GEMINI_MODEL
TAVILY_API_KEY
WEB_SEARCH
PUBLIC_APP_URL
OPENROUTER_SITE_NAME
PORT
```

At least one AI provider should be configured. For full V1.4 behavior configure all three providers and set `WEB_SEARCH=true`.

## Provider order

1. OpenRouter
2. Gemini fallback

Tavily is used independently when live research is needed; it is not an AI fallback.

## Security boundary

The web app still cannot bypass browser/Android security boundaries. Calls/messages remain confirmation-gated and private contacts are not magically available to a browser. V2 will move the device-control layer into the native Android APK.

## Acceptance tests

1. Normal question -> OpenRouter answer when configured.
2. Disable/break OpenRouter -> Gemini answers automatically when configured.
3. Ask a current question -> Tavily search is invoked when `WEB_SEARCH=true`; answer includes sources when results exist.
4. `POST /api/web-search` with a query -> structured Tavily results.
5. `/api/health` and `/api/diagnostics` never return API keys.
6. Text input does not auto-speak.
7. Voice input auto-speaks when voice output is enabled.
8. Authorization cancel does not execute sensitive actions.
9. Authorized call/message intents execute only through browser-supported URI handling.
10. Local time/date and other local tools continue without AI when possible.
