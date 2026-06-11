# Agent-Origin Auto-Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the overlay fetch the agent at the origin it was loaded from (derived from `document.currentScript.src`) instead of a hardcoded `localhost:4567`, with an explicit panel error when the origin can't be determined.

**Architecture:** A new pure helper `originFromSrc` + a load-time `AGENT_ORIGIN` constant (read from the loading `<script>`). `api.ts` fetches against it and throws if absent; `index.ts` shows a panel error and skips wiring the click inspector when it's absent.

**Tech Stack:** TypeScript, esbuild (overlay IIFE bundle), vitest, browser DOM (`document.currentScript`, `URL`).

**Spec:** `docs/superpowers/specs/2026-06-11-agent-origin-autodetect-design.md`

**Conventions:** Run tests `npx vitest run`; typecheck `npx tsc --noEmit`; build overlay `npm run build:overlay`. Overlay tests live in `tests/overlay/` and import from `../../src/overlay/*.js`. The agent reads its port from `process.env.PORT` (default 4567); the bookmarklet bakes that port into the injected script src.

---

## File Structure

- `src/overlay/agentOrigin.ts` — **new**: pure `originFromSrc` + load-time `AGENT_ORIGIN` const.
- `tests/overlay/agentOrigin.test.ts` — **new**: unit tests for `originFromSrc`.
- `src/overlay/api.ts` — **modify**: import `AGENT_ORIGIN`; throw if null; use it in both fetches.
- `src/overlay/panel.ts` — **modify**: add a `setError(message)` method to the returned object.
- `src/overlay/index.ts` — **modify**: on null origin, call `panel.setError(...)` and skip `createInspector`.
- `dist/overlay.js` — **rebuild + commit**.

---

## Task 1: `agentOrigin.ts` — origin helper (TDD)

**Files:**
- Create: `src/overlay/agentOrigin.ts`
- Test: `tests/overlay/agentOrigin.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/overlay/agentOrigin.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { originFromSrc } from "../../src/overlay/agentOrigin.js";

describe("originFromSrc", () => {
  it("extracts the origin from a script src with query string", () => {
    expect(originFromSrc("http://localhost:4567/overlay.js?123")).toBe("http://localhost:4567");
  });

  it("works for any port", () => {
    expect(originFromSrc("http://localhost:9999/overlay.js")).toBe("http://localhost:9999");
  });

  it("works for a non-localhost host", () => {
    expect(originFromSrc("http://192.168.0.5:4600/overlay.js")).toBe("http://192.168.0.5:4600");
  });

  it("returns null for empty / nullish input", () => {
    expect(originFromSrc("")).toBeNull();
    expect(originFromSrc(null)).toBeNull();
    expect(originFromSrc(undefined)).toBeNull();
  });

  it("returns null for an unparseable src", () => {
    expect(originFromSrc("not a url")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/overlay/agentOrigin.test.ts`
Expected: FAIL — module `agentOrigin.ts` does not exist.

- [ ] **Step 3: Write the implementation**

Create `src/overlay/agentOrigin.ts`:

```ts
// src/overlay/agentOrigin.ts

/** Parse the origin from a script src; null when empty or unparseable. */
export function originFromSrc(src: string | null | undefined): string | null {
  if (!src) return null;
  try {
    return new URL(src).origin;
  } catch {
    return null;
  }
}

/**
 * Agent origin, derived from the <script> that loaded this overlay bundle.
 * The bookmarklet injects a classic <script src="http://host:PORT/overlay.js">,
 * so document.currentScript is valid during this bundle's synchronous run.
 * null when it cannot be determined (no currentScript, or a non-browser env).
 */
export const AGENT_ORIGIN: string | null =
  typeof document !== "undefined"
    ? originFromSrc((document.currentScript as HTMLScriptElement | null)?.src)
    : null;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/overlay/agentOrigin.test.ts`
Expected: PASS (5 tests). Importing the module also evaluates `AGENT_ORIGIN`; under vitest it resolves to `null` (no real loading script) without throwing, thanks to the `typeof document` guard.

- [ ] **Step 5: Full suite + typecheck**

Run: `npx vitest run` then `npx tsc --noEmit`
Expected: all pass; no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/overlay/agentOrigin.ts tests/overlay/agentOrigin.test.ts
git -c user.name=minwoo -c user.email=minwoo1989@gmail.com commit -m "feat: originFromSrc helper + AGENT_ORIGIN from currentScript

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 2: Wire the origin through api / panel / index + rebuild bundle

**Files:**
- Modify: `src/overlay/api.ts`
- Modify: `src/overlay/panel.ts`
- Modify: `src/overlay/index.ts`
- Rebuild: `dist/overlay.js`

(No unit tests: this is DOM/browser wiring with no testable pure logic — `originFromSrc` is already covered in Task 1, and the end-to-end behavior is verified by the browser smoke in Task 3. Verify here with typecheck + a clean bundle build.)

- [ ] **Step 1: Update `api.ts` to use `AGENT_ORIGIN`**

Replace the entire contents of `src/overlay/api.ts` with:

```ts
// src/overlay/api.ts
import type {
  EditRequest, EditResult, InspectRequest, InspectResult,
} from "../shared/types.js";
import { AGENT_ORIGIN } from "./agentOrigin.js";

/** The detected agent origin, or throw a clear error if it was never determined. */
function origin(): string {
  if (AGENT_ORIGIN === null) throw new Error("agent origin not detected");
  return AGENT_ORIGIN;
}

export async function sendEdit(req: EditRequest): Promise<EditResult> {
  const res = await fetch(`${origin()}/edit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  return (await res.json()) as EditResult;
}

export async function sendInspect(req: InspectRequest): Promise<InspectResult> {
  const res = await fetch(`${origin()}/inspect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  return (await res.json()) as InspectResult;
}
```

- [ ] **Step 2: Add a `setError` method to the panel**

In `src/overlay/panel.ts`, the `createPanel` function ends with a `return { host, async setTarget(...) {...} };` block. Add a `setError` method to that returned object (after `setTarget`). The new return block becomes:

```ts
  return {
    host,
    async setTarget(name: string, target: PanelTarget | null) {
      if (!target) {
        inspectGen++;
        $("who").textContent = `${name} — no source info`;
        file = null;
        loc = null;
        snapshot = null;
        clearEditors();
        return;
      }
      whoName = name;
      whoShort = target.file.split(/[\\/]/).pop() ?? "";
      $("who").textContent = `${whoName} — ${whoShort}:${target.line}`;
      file = target.file;
      loc = { line: target.line, column: target.column, tag: target.tag };
      await inspectInto();
    },
    /** Render a persistent, selection-independent error (e.g. agent origin not found). */
    setError(message: string) {
      inspectGen++;
      file = null;
      loc = null;
      snapshot = null;
      clearEditors();
      $("who").textContent = "⚠ agent 연결 불가";
      out.textContent = `❌ ${message}`;
    },
  };
```

(Everything above the `return` block — state vars, `inspectInto`, the apply handler, etc. — is unchanged.)

- [ ] **Step 3: Guard the inspector wiring in `index.ts`**

Replace the entire contents of `src/overlay/index.ts` with:

```ts
// src/overlay/index.ts
import { sourceLocFor, componentNameFor } from "./fiber.js";
import { createPanel } from "./panel.js";
import { createInspector } from "./inspector.js";
import { sendEdit, sendInspect } from "./api.js";
import { AGENT_ORIGIN } from "./agentOrigin.js";

const panel = createPanel({
  onInspect: sendInspect,
  onApply: sendEdit,
});

if (AGENT_ORIGIN === null) {
  // Loaded without a detectable script origin — fetches can't be aimed anywhere.
  panel.setError("에이전트 origin을 감지하지 못했습니다 — 북마클릿으로 다시 여세요.");
  console.error("[ui-modifier] agent origin not detected from document.currentScript");
} else {
  createInspector((el) => {
    // _debugSource gives the absolute path; it is passed through verbatim.
    const loc = sourceLocFor(el);
    void panel.setTarget(componentNameFor(el), loc ?? null);
  }, panel.host);
}

console.log("[ui-modifier] overlay ready");
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Rebuild the overlay bundle**

Run: `npm run build:overlay`
Expected: `dist/overlay.js` rewritten.

- [ ] **Step 6: Confirm the hardcoded origin is gone**

Run: `grep -n "localhost:4567" src/overlay/*.ts`
Expected: NO matches in `src/overlay/` (the only remaining `4567` references are the agent default in `src/agent/server.ts` and docs — not the overlay).

- [ ] **Step 7: Full suite + typecheck**

Run: `npx vitest run` then `npx tsc --noEmit`
Expected: all pass; no type errors.

- [ ] **Step 8: Commit**

```bash
git add src/overlay/api.ts src/overlay/panel.ts src/overlay/index.ts dist/overlay.js
git -c user.name=minwoo -c user.email=minwoo1989@gmail.com commit -m "feat: overlay targets its loading origin; explicit error when absent

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 3: Browser smoke on a non-default port

Verifies the real win: the overlay follows whatever port the agent runs on.

- [ ] **Step 1: Start the agent on PORT 4600**

Run (background, from repo root, PowerShell): `$env:PORT=4600; npx tsx src/agent/server.ts`
Expected: `[ui-modifier] agent on http://localhost:4600`.

- [ ] **Step 2: Start the target app dev server**

Run (background, from `D:\Projects\test\test-multi-window`): `npm run dev`
Expected: `VITE ... Local: http://localhost:5173/`.

- [ ] **Step 3: Write the smoke driver**

Create `D:\Projects\test\test-multi-window\verify-origin.mjs`:

```js
// Verify the overlay fetches the agent on :4600 (its loading origin), not :4567.
import { chromium } from 'playwright';
import fs from 'node:fs';

const PANEL = `
  const host = [...document.body.children].find(d => d.shadowRoot && d.shadowRoot.getElementById('apply'));
  const root = host && host.shadowRoot;
  const rows = () => [...root.getElementById('styles').querySelectorAll('.row')].map(r => {
    const [k, v] = r.querySelectorAll('input'); return { property: k.value, value: v.value };
  });
  const panel = () => ({ who: root.getElementById('who').textContent, styleRows: rows(), out: root.getElementById('out').textContent });
`;
const read = (p) => p.evaluate(`(() => { ${PANEL}; return panel(); })()`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const fetchedOrigins = new Set();
page.on('request', (r) => {
  const u = r.url();
  if (u.includes('/inspect') || u.includes('/edit')) fetchedOrigins.add(new URL(u).origin);
});

const href = (await (await fetch('http://localhost:4600/')).text()).match(/href="(javascript:[^"]+)"/)[1];
console.log('bookmarklet href:', href);  // expect it to reference :4600
await page.goto('http://localhost:5173/');
await page.waitForSelector('text=창', { timeout: 20000 });
await page.waitForTimeout(2500);
await page.evaluate((s) => { (0, eval)(s); }, href.replace(/^javascript:/, ''));
await page.waitForFunction(() => [...document.body.children].some((d) => d.shadowRoot && d.shadowRoot.getElementById('apply')));

const box = await page.evaluate(() => {
  const el = [...document.querySelectorAll('div')].find((d) => d.style.position === 'fixed' && d.style.top === '12px' && d.style.boxShadow);
  const r = el.getBoundingClientRect();
  return { x: r.left + 6, y: r.top + r.height / 2 };
});
await page.mouse.click(box.x, box.y);
await page.waitForFunction(`(() => { ${PANEL}; return root.getElementById('styles').querySelectorAll('.row').length > 0 || root.getElementById('out').textContent; })()`, { timeout: 5000 });
const p = await read(page);
console.log('who:', p.who, '| styleRows:', p.styleRows.length);

// edit + apply so an /edit request also fires
await page.evaluate(`(() => { ${PANEL};
  const rowEls = [...root.getElementById('styles').querySelectorAll('.row')];
  const idx = rows().findIndex(r => r.property === 'background');
  rowEls[idx].querySelectorAll('input')[1].value = '#ffe4c4';
})()`);
await page.evaluate(`(() => { ${PANEL}; root.getElementById('apply').click(); })()`);
await page.waitForTimeout(1500);

console.log('fetched origins:', [...fetchedOrigins]);
console.log('PASS origin-follows-port:', fetchedOrigins.has('http://localhost:4600') && !fetchedOrigins.has('http://localhost:4567'));
console.log('disk has #ffe4c4:', fs.readFileSync('src/components/FloatingBar.tsx', 'utf8').includes('#ffe4c4'));
await browser.close();
console.log('DONE');
```

- [ ] **Step 4: Run the smoke**

Run (from `D:\Projects\test\test-multi-window`): `node verify-origin.mjs`
Expected output includes:
- `bookmarklet href:` references `localhost:4600`
- `who:` shows `div — FloatingBar.tsx:15`, styleRows > 0
- `fetched origins: [ 'http://localhost:4600' ]`
- `PASS origin-follows-port: true`
- `disk has #ffe4c4: true`

If any `/inspect` or `/edit` hit `:4567`, the wiring is wrong — stop and debug.

- [ ] **Step 5: Restore target app + clean up**

```bash
cd /d D:\Projects\test\test-multi-window
git checkout -- src/components/FloatingBar.tsx
del verify-origin.mjs
```

Stop the background agent and vite servers. Confirm ports 4600 / 5173 are free.

- [ ] **Step 6: Record verification in the spec**

Append a short "Verification (2026-06-11)" section to
`docs/superpowers/specs/2026-06-11-agent-origin-autodetect-design.md`: note that
with the agent on `:4600`, the bookmarklet href and both `/inspect` + `/edit`
fetches targeted `:4600` (never `:4567`), and the edit applied; `npx vitest run`
/ `npx tsc --noEmit` green.

- [ ] **Step 7: Commit**

```bash
cd /d D:\Projects\test\react-ui-source-editor
git add docs/superpowers/specs/2026-06-11-agent-origin-autodetect-design.md
git -c user.name=minwoo -c user.email=minwoo1989@gmail.com commit -m "docs: record agent-origin auto-detection verification

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Self-Review Notes

- **Spec coverage:** `originFromSrc` + `AGENT_ORIGIN` (Task 1); api.ts uses it + throws when null, panel `setError`, index.ts guard + skip inspector (Task 2); explicit-error path and non-default-port behavior verified (Tasks 2–3). All spec sections mapped.
- **Type consistency:** `originFromSrc(src: string | null | undefined): string | null` and `AGENT_ORIGIN: string | null` are used identically in api.ts and index.ts; `panel.setError(message: string)` matches its index.ts call.
- **No placeholders:** every code step shows complete code; the `typeof document` guard keeps the module import-safe under vitest.
