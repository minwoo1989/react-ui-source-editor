# Repo-Free Overlay Delivery (Bookmarklet + Landing Page) — Design

## Context

The antd UI Modifier overlay must run inside the target app's page (same origin
as React) to read `_debugSource` from fibers — so it cannot drive the app from
a separate cross-origin window or iframe. During end-to-end verification the
overlay was injected by copying `dist/overlay.js` into the target app's
`public/` directory. That works but **pollutes the target repo** with a file
the developer then has to remember to delete (and it shows up in their
`git status`).

This design removes that friction: the agent serves the overlay itself, and a
one-click **bookmarklet** injects it into any app tab. Nothing is ever written
to the target repo. The agent already runs rooted at the target project
(`PROJECT_ROOT` from argv) and already sends permissive CORS headers, so this is
a thin addition on top of the existing server.

A heavier "everything inside our tool" variant (a reverse proxy that rewrites
the app's HTML to inject the overlay, proxying the HMR websocket too) was
considered and explicitly deferred — see *Out of Scope*.

## Goal

Inject the overlay into the running target app with **zero files added to the
target repo** and no manual console paste, while keeping the existing
`POST /edit` contract unchanged.

## Architecture

Two new read-only routes on the existing agent server (`src/agent/server.ts`,
`http://localhost:<PORT>`), plus one new pure helper module. The overlay bundle
(`dist/overlay.js`) continues to be produced by `npm run build:overlay`.

```
Browser (app tab, localhost:3000)
  │  click bookmarklet
  ▼
<script src="http://localhost:4567/overlay.js?<cachebuster>">   ── GET ──▶ agent
  │  overlay runs in-page, reads _debugSource                              │
  ▼                                                                        ▼
POST http://localhost:4567/edit  ◀───────────────────────────────  serves dist/overlay.js
```

### Components

**1. `GET /overlay.js`** — serves the built overlay bundle.
- Resolves the bundle **relative to the server module**, not `PROJECT_ROOT`:
  `resolve(dirname(fileURLToPath(import.meta.url)), "../../dist/overlay.js")`
  (server lives in `src/agent/`, `dist/` is at the repo root).
- Responds `200` with `Content-Type: application/javascript` and the file bytes.
- If the bundle is missing, responds `404` with a short body telling the
  developer to run `npm run build:overlay`.

**2. `GET /`** — a small static landing page (HTML string).
- A **draggable bookmarklet anchor** whose `href` is the `javascript:` snippet
  that injects `http://localhost:<PORT>/overlay.js?<Date.now()>` as a `<script>`.
  (Drag-to-bookmarks-bar is required because browsers strip `javascript:` pasted
  into the address bar.)
- Shows the active `PROJECT_ROOT` and `PORT` so the developer can confirm the
  agent is pointed at the right project.
- Three-line usage: open the app tab → click the bookmarklet → click an element
  and edit.

**3. `POST /edit`** — unchanged.

### New pure helper: `src/agent/bookmarklet.ts`

String generation only — no file or network I/O, so it is unit-testable in the
existing vitest (node) setup, matching the project's "pure functions are
unit-tested, the server is smoke-tested" pattern.

- `bookmarkletHref(port: number): string` — returns the `javascript:(function(){…})();`
  string targeting `/overlay.js` on the given port, with a `Date.now()`
  cache-buster.
- `landingHtml(projectRoot: string, port: number): string` — returns the full
  landing-page HTML, embedding `bookmarkletHref(port)`, the project root, and
  the usage steps. HTML-escapes the interpolated `projectRoot`.

`server.ts` only wires routes and reads the bundle file; all string building
lives in `bookmarklet.ts`.

## Testing

**Unit (`tests/agent/bookmarklet.test.ts`):**
- `bookmarkletHref(4567)` starts with `javascript:`, contains
  `localhost:4567/overlay.js`, and includes a cache-buster expression.
- `landingHtml("/some/root", 4567)` contains the project root, the port, and the
  bookmarklet href.

**Manual smoke (as in the original Task 10):**
- `GET /` → `200`, HTML containing the bookmarklet.
- `GET /overlay.js` → `200`, `application/javascript`, body length ≈ bundle size.
- Rename/remove `dist/overlay.js` → `GET /overlay.js` returns `404` with the
  build hint.
- Full loop: start agent, open `localhost:<PORT>/`, drag bookmarklet to the
  bookmarks bar, open the target app, click the bookmarklet, edit an element,
  confirm the `.tsx` is written and HMR reloads.

## Out of Scope (YAGNI)

- **Reverse-proxy / HMR-websocket relay** ("everything inside our tool"
  variant). Deferred; this design keeps the developer in the app tab.
- Auto-building the overlay when missing (we only return a hint).
- Any authentication on the agent (localhost dev tool).
- Changing the `POST /edit` request/result contract.

## Known Constraint

`src/overlay/api.ts` currently hardcodes the edit endpoint as
`http://localhost:4567/edit`. The bookmarklet, by contrast, targets
`/overlay.js` on whatever `PORT` the agent runs on. If the agent is started on a
non-default port, the served overlay would still POST edits to `4567` and fail.
For this design we assume the **default port 4567** (the bookmarklet and the
overlay agree there). Making the overlay derive the agent origin from its own
`<script src>` (so any port works) is a small, separate follow-up and is not
required here.
