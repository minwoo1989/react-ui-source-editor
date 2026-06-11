# Repo-Free Overlay Delivery (Bookmarklet + Landing Page) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve the overlay bundle from the agent and inject it via a one-click bookmarklet, so the overlay loads into any target app tab with zero files added to the target repo.

**Architecture:** Add a pure `bookmarklet.ts` helper that builds the `javascript:` bookmarklet href and the landing-page HTML (string generation only, fully unit-testable). Rework `server.ts`'s single-route guard into a small dispatcher that serves `GET /` (landing page) and `GET /overlay.js` (the built bundle, resolved relative to the server module), while leaving `POST /edit` and `OPTIONS` behavior untouched.

**Tech Stack:** Node `node:http`, TypeScript (ESM, `.js` import specifiers), esbuild (`build:overlay`), vitest (node).

---

## File Structure

- **Create `src/agent/bookmarklet.ts`** — pure string generation: `bookmarkletHref(port)` and `landingHtml(projectRoot, port)`. No file or network I/O.
- **Create `tests/agent/bookmarklet.test.ts`** — unit tests for both helpers, matching the existing `tests/agent/*.test.ts` style.
- **Modify `src/agent/server.ts`** — rework the request dispatch to add `GET /` and `GET /overlay.js`; import the helpers and the bundle-path utilities.

`POST /edit` and `src/overlay/api.ts` are intentionally **not** changed (see Out of Scope in the spec — the hardcoded `4567` endpoint is a deferred follow-up).

---

## Task 1: Pure bookmarklet/landing-page helper

**Files:**
- Create: `src/agent/bookmarklet.ts`
- Test: `tests/agent/bookmarklet.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/agent/bookmarklet.test.ts`:

```typescript
// tests/agent/bookmarklet.test.ts
import { describe, it, expect } from "vitest";
import { bookmarkletHref, landingHtml } from "../../src/agent/bookmarklet.js";

describe("bookmarkletHref", () => {
  it("starts with javascript: and targets /overlay.js on the given port", () => {
    const href = bookmarkletHref(4567);
    expect(href.startsWith("javascript:")).toBe(true);
    expect(href).toContain("localhost:4567/overlay.js");
  });

  it("embeds Date.now() as a runtime cache-buster expression, not a frozen value", () => {
    const href = bookmarkletHref(4567);
    // The literal call must survive into the emitted snippet so it runs at click time.
    expect(href).toContain("Date.now()");
  });
});

describe("landingHtml", () => {
  it("includes the project root, the port, and the bookmarklet href", () => {
    const html = landingHtml("/some/root", 4567);
    expect(html).toContain("/some/root");
    expect(html).toContain("4567");
    expect(html).toContain(bookmarkletHref(4567));
  });

  it("HTML-escapes the project root", () => {
    const html = landingHtml("/a<b>&c/root", 4567);
    expect(html).not.toContain("/a<b>&c/root");
    expect(html).toContain("/a&lt;b&gt;&amp;c/root");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/agent/bookmarklet.test.ts`
Expected: FAIL — cannot resolve `../../src/agent/bookmarklet.js` (module not found).

- [ ] **Step 3: Write the helper**

Create `src/agent/bookmarklet.ts`:

```typescript
// src/agent/bookmarklet.ts

/** Minimal HTML-escape for text interpolated into the landing page. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Returns the `javascript:` bookmarklet that injects the served overlay bundle
 * as a <script> into the current page. `Date.now()` runs at click time so each
 * click pulls a fresh (uncached) copy of the bundle.
 */
export function bookmarkletHref(port: number): string {
  const snippet =
    `(function(){` +
    `var s=document.createElement('script');` +
    `s.src='http://localhost:${port}/overlay.js?'+Date.now();` +
    `document.body.appendChild(s);` +
    `})();`;
  return "javascript:" + snippet;
}

/**
 * Full landing-page HTML. Shows the active project root and port, and offers a
 * draggable bookmarklet anchor (browsers strip `javascript:` pasted into the
 * address bar, so drag-to-bookmarks-bar is required).
 */
export function landingHtml(projectRoot: string, port: number): string {
  const href = bookmarkletHref(port);
  const root = escapeHtml(projectRoot);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>antd UI Modifier — overlay</title>
<style>
  body { font: 15px/1.5 system-ui, sans-serif; max-width: 40rem; margin: 3rem auto; padding: 0 1rem; }
  code { background: #f2f2f2; padding: 0 .3em; border-radius: 3px; }
  .bm { display: inline-block; padding: .5em 1em; margin: 1rem 0; background: #1677ff; color: #fff;
        border-radius: 6px; text-decoration: none; font-weight: 600; }
  ol { padding-left: 1.2rem; }
  .meta { color: #555; font-size: 13px; }
</style>
</head>
<body>
<h1>antd UI Modifier</h1>
<p class="meta">Project root: <code>${root}</code><br />Agent port: <code>${port}</code></p>
<p><strong>Drag this to your bookmarks bar:</strong></p>
<p><a class="bm" href="${href}">UI Modifier</a></p>
<ol>
  <li>Open your running app tab (e.g. <code>localhost:3000</code>).</li>
  <li>Click the <strong>UI Modifier</strong> bookmark.</li>
  <li>Click an element and edit it.</li>
</ol>
</body>
</html>`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/agent/bookmarklet.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/agent/bookmarklet.ts tests/agent/bookmarklet.test.ts
git commit -m "feat: pure bookmarklet href + landing-page HTML helper"
```

---

## Task 2: Serve the overlay bundle and landing page from the agent

**Files:**
- Modify: `src/agent/server.ts`

The server has no test harness (all `tests/agent/*` are pure-function tests), so this task is verified by manual smoke steps in Task 3, matching the project's "server is smoke-tested" pattern.

- [ ] **Step 1: Add imports for the bundle path and the helpers**

In `src/agent/server.ts`, modify the import block. Add `existsSync` to the `node:fs` import, add `dirname` to the `node:path` import, and add new imports for `fileURLToPath` and the helpers.

Change line 2:

```typescript
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
```

Change line 4:

```typescript
import { resolve, join, basename, dirname } from "node:path";
```

Add after the existing imports (after line 7, the `EditRequest` import):

```typescript
import { fileURLToPath } from "node:url";
import { bookmarkletHref, landingHtml } from "./bookmarklet.js";
```

- [ ] **Step 2: Resolve the bundle path relative to the server module**

After line 11 (`const BACKUP_DIR = ...`), add:

```typescript
// dist/overlay.js sits at the repo root; this module lives in src/agent/.
const OVERLAY_BUNDLE = resolve(dirname(fileURLToPath(import.meta.url)), "../../dist/overlay.js");
```

- [ ] **Step 3: Rework the request dispatch to add the two GET routes**

Replace the current guard (lines 28-30) — which 404s every non-`POST /edit` request:

```typescript
  cors(res);
  if (req.method === "OPTIONS") return res.writeHead(204).end();
  if (req.method !== "POST" || req.url !== "/edit") return res.writeHead(404).end();
```

with a dispatcher that handles the new GET routes first, then falls through to the unchanged `POST /edit` logic:

```typescript
  cors(res);
  if (req.method === "OPTIONS") return res.writeHead(204).end();

  if (req.method === "GET" && (req.url === "/" || req.url === "")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(landingHtml(PROJECT_ROOT, PORT));
  }

  // Match on pathname so the bookmarklet's `?<cachebuster>` query is ignored.
  if (req.method === "GET" && (req.url ?? "").split("?")[0] === "/overlay.js") {
    if (!existsSync(OVERLAY_BUNDLE)) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("overlay bundle not found — run: npm run build:overlay");
    }
    res.writeHead(200, { "Content-Type": "application/javascript" });
    return res.end(readFileSync(OVERLAY_BUNDLE));
  }

  if (req.method !== "POST" || req.url !== "/edit") return res.writeHead(404).end();
```

Everything below this (the `try { ... }` block handling `POST /edit`) is unchanged.

- [ ] **Step 4: Typecheck the server**

Run: `npx tsc --noEmit`
Expected: no errors. (Confirms the new imports and `import.meta.url` usage are valid under the project's ESM config.)

- [ ] **Step 5: Build the overlay bundle (prerequisite for the smoke test)**

Run: `npm run build:overlay`
Expected: writes `dist/overlay.js`.

- [ ] **Step 6: Commit**

```bash
git add src/agent/server.ts
git commit -m "feat: serve overlay bundle and bookmarklet landing page from agent"
```

---

## Task 3: Manual smoke verification

**Files:** none (verification only).

These mirror the spec's manual smoke checklist. Run them from the repo root in one terminal, with the agent started in another.

- [ ] **Step 1: Start the agent**

Run (in its own terminal): `npm run agent`
Expected: logs `[ui-modifier] agent on http://localhost:4567  root=<repo>`.

- [ ] **Step 2: Landing page returns 200 + HTML with the bookmarklet**

Run: `curl -i http://localhost:4567/`
Expected: `200`, `Content-Type: text/html`, body contains `class="bm"` and `javascript:(function()`.

- [ ] **Step 3: Bundle route returns 200 + JS of the right size**

Run: `curl -i "http://localhost:4567/overlay.js?123"`
Expected: `200`, `Content-Type: application/javascript`, `Content-Length` ≈ the size of `dist/overlay.js` (currently ~5.6 KB). The `?123` query must not break the match.

- [ ] **Step 4: Missing bundle returns 404 + build hint**

Temporarily rename the bundle, request it, then restore:

```bash
mv dist/overlay.js dist/overlay.js.bak
curl -i "http://localhost:4567/overlay.js?123"   # expect 404 + "run: npm run build:overlay"
mv dist/overlay.js.bak dist/overlay.js
```

Expected: `404` with body `overlay bundle not found — run: npm run build:overlay`.

- [ ] **Step 5: `POST /edit` still works (regression check)**

Confirm the existing contract is intact:

Run: `npx vitest run`
Expected: all suites pass, including the pre-existing `tests/agent/apply*.test.ts` and the new `bookmarklet.test.ts`.

- [ ] **Step 6: Full browser loop**

With the agent running and `dist/overlay.js` present:
1. Open `http://localhost:4567/` in the browser.
2. Drag the **UI Modifier** anchor to the bookmarks bar.
3. Open the target app tab (e.g. `localhost:3000`).
4. Click the **UI Modifier** bookmark — the overlay should appear in the app tab.
5. Click an element, make an edit, and confirm the `.tsx` is written and HMR reloads.

Expected: edit lands in the target file with **no new files** in the target repo's `git status`.

---

## Self-Review Notes

- **Spec coverage:** `GET /overlay.js` (Task 2 §3), `GET /` landing page with draggable bookmarklet + project root + port + usage (Task 1 §3, Task 2 §3), bundle resolved relative to server module (Task 2 §2), 404 build hint (Task 2 §3), pure `bookmarklet.ts` with both functions + HTML-escaping (Task 1), unit + manual smoke tests (Tasks 1 & 3). `POST /edit` left unchanged (Task 2 §3 note).
- **Deferred (not in this plan, per spec Out of Scope / Known Constraint):** reverse-proxy/HMR relay, auto-build on missing bundle, agent auth, and the `src/overlay/api.ts` hardcoded `4567` endpoint.
- **Port assumption:** the plan assumes default port `4567` so the bookmarklet and the overlay's hardcoded edit endpoint agree, exactly as the spec's Known Constraint states.
