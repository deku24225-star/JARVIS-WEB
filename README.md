# JARVIS Web V1.3

V1.3 builds on V1.2 instead of rebuilding it from scratch.

## V1.3 upgrades

- Current-information web grounding for current/latest/news/office-holder questions through the OpenRouter web plugin.
- Improved tool/command routing while preserving time, date, weather, Google search, YouTube, Maps, memory, messaging and call preparation.
- Authorization dialog hardened so cancel/authorize cannot leave the interface stuck.
- Settings and memory dialogs use defensive open/close handling.
- Voice output is now source-aware: automatic speech happens only for voice-input commands. Text commands remain silent.
- Speech sanitizer removes Markdown artifacts, URLs, decorative symbols and common emoji/pictographic ranges before TTS.
- JARVIS identity guard prevents invented origins such as a fictional company or founding year.
- Memory and history remain local/browser-side; only explicit memories are persisted.
- API key remains server-side.

## Important browser limitation

The web app cannot silently place a phone call or access private contacts. A phone command with a numeric phone number requests authorization and then prepares the device dialer using a `tel:` URI. The user still controls the final call. Private contact lookup is not claimed.

## OpenRouter live search

`OPENROUTER_WEB_SEARCH=true` enables the web plugin only for requests detected as current/live or office-holder queries. OpenRouter documents the `web` plugin as model-agnostic grounding and notes that web search can add search-provider costs even when a free model is used. `openrouter/free` is a free router that selects from compatible free models.

## Render environment

Set:

- `OPENROUTER_API_KEY` = your secret key
- `OPENROUTER_MODEL` = `openrouter/free`
- `OPENROUTER_WEB_SEARCH` = `true`
- `OPENROUTER_SITE_URL` = your Render URL
- `OPENROUTER_SITE_NAME` = `JARVIS Web V1.3`

Never commit the API key to GitHub.

## Test endpoints

- `/api/health`
- `/api/time`

## V1.3 acceptance tests

1. AI chat answers normal questions.
2. Current UK PM / latest news questions use live grounding when enabled.
3. Text command responses do not auto-speak.
4. Voice command responses do auto-speak.
5. Emoji/Markdown decoration is not spoken.
6. Settings opens and closes reliably.
7. Authorization Cancel and Authorize are responsive.
8. Call preparation only proceeds after authorization and only for a valid numeric number.
9. JARVIS does not invent a Milimax origin or founding year.
10. Memory save/show/forget/clear works.
11. PWA loads correctly.
