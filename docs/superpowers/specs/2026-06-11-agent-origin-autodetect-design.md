# Agent-Origin Auto-Detection — Design

**Date:** 2026-06-11
**Status:** approved, awaiting implementation plan
**Feature:** #1 of the 7-item improvement series (portability)

## Problem

The overlay's API client hardcodes the agent origin:
`src/overlay/api.ts` — `const AGENT_ORIGIN = "http://localhost:4567"`. If the
agent runs on any other port, every `/inspect` and `/edit` fetch targets the
wrong origin and silently fails, even though the bookmarklet itself already
loaded the overlay from the correct origin.

The bookmarklet (`src/agent/bookmarklet.ts`) bakes the agent's real port into
the injected `<script src>` (`http://localhost:${port}/overlay.js`), so the
overlay bundle is **always** served from the correct origin. Only the
hardcoded constant in `api.ts` is wrong. Deriving the origin from the script
that loaded the overlay makes the fetch target follow whatever port the
bookmarklet used — "works on any port" with no code edit.

## Goal

Make the overlay call the agent at the origin it was loaded from, so changing
the agent's `PORT` (already configurable via `process.env.PORT`) needs no
overlay change. When the origin cannot be determined, fail with an explicit,
visible error rather than silently falling back to `localhost:4567`.

## Approach (chosen)

Derive the origin from `document.currentScript.src`. The bookmarklet injects a
classic `<script>` element, so `document.currentScript` is valid during the
overlay bundle's synchronous top-level execution. Rejected alternatives:
scanning `document.scripts` for `/overlay.js` (fragile — query strings, multiple
matches; and the user chose an explicit error over a heuristic fallback);
templating the origin into the served bundle (invasive — the agent serves
`dist/overlay.js` as a static file and would have to become a dynamic template).

## Components

- **New `src/overlay/agentOrigin.ts`:**
  - Pure, testable: `originFromSrc(src: string | null | undefined): string | null`
    — returns `new URL(src).origin`, or `null` for empty/unparseable input.
  - Load-time wrapper: reads `document.currentScript?.src` (a thin, DOM-bound
    line) and exports `const AGENT_ORIGIN: string | null = originFromSrc(...)`.
    Evaluated during the bundle's synchronous run, when `currentScript` is valid.
- **`src/overlay/api.ts`:** drop the hardcoded constant; import `AGENT_ORIGIN`.
  `sendInspect`/`sendEdit` throw a clear `Error("agent origin not detected")`
  if `AGENT_ORIGIN` is `null` (defensive — index.ts prevents reaching here).
- **`src/overlay/panel.ts`:** add `setError(message: string)` — renders a
  persistent error in the panel (`who` + `out`) independent of any selection.
- **`src/overlay/index.ts`:** on init, if `AGENT_ORIGIN` is `null`, call
  `panel.setError(...)` and do NOT wire the click inspector (click-to-edit can't
  work without an origin). Otherwise proceed as today.

## Data flow

Bookmarklet injects `<script src="http://host:PORT/overlay.js?ts">` → bundle
runs → `agentOrigin.ts` captures `currentScript.src` → `AGENT_ORIGIN` =
`http://host:PORT` → `api.ts` fetches `${AGENT_ORIGIN}/inspect|/edit`.

## Error behavior

- Origin undetectable (`currentScript` null, or src unparseable) → panel shows
  "에이전트 origin을 감지하지 못했습니다 — 북마클릿으로 다시 여세요", click
  inspector not wired, edits impossible. Also `console.error` for diagnostics.
- Network failure at a *detected* origin → unchanged; the existing
  inspect/apply `catch` shows "❌ agent unreachable: …". Out of scope here.

## Testing

- **Unit — `tests/overlay/agentOrigin.test.ts`:** `originFromSrc`
  - `"http://localhost:4567/overlay.js?123"` → `"http://localhost:4567"`
  - `"http://localhost:9999/overlay.js"` → `"http://localhost:9999"` (any port)
  - `""` / `null` / `undefined` → `null`
  - unparseable (`"not a url"`) → `null`
- **Browser smoke:** start the agent on a NON-4567 port (e.g. `PORT=4600`),
  drag the bookmarklet from that landing page, click an element, confirm the
  `/inspect` and `/edit` fetches hit `:4600` and the edit applies.

## Out of scope (YAGNI)

- Cross-origin / remote agents (origin is always the bookmarklet's host).
- The agent `PORT` config mechanism (already `process.env.PORT`).
- Network-failure UX (already handled).
- Any of features #2–#7.
