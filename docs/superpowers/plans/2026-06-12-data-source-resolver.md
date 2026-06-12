# Version-Independent Source Resolver (`data-source-*`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Babel plugin stamps `data-source-file/line/column` onto host JSX elements so the overlay can locate a clicked element without `fiber._debugSource` (gone in React 19); the overlay reads them as a fallback after fibers. React ≤18 keeps working with zero target setup.

**Architecture:** Babel plugin (`src/plugin/sourceAttrs.ts`, toolchain-agnostic) → target build injects DOM attrs → overlay `locFromDataAttr` (fiber-first, data-attr fallback) → existing agent resolver. Plus a README and a fiber-independence browser proof.

**Tech Stack:** TypeScript, Babel (`@babel/core`, dev), ts-morph (agent), esbuild, vitest, React fibers.

**Spec:** `docs/superpowers/specs/2026-06-12-data-source-resolver-design.md`

**Conventions:** Run tests `npx vitest run`; typecheck `npx tsc --noEmit`; build overlay `npm run build:overlay`. Commit after each task; end messages with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

## File Structure

- `src/plugin/sourceAttrs.ts` — **new**: the Babel plugin.
- `tests/plugin/sourceAttrs.test.ts` — **new**: plugin transform tests.
- `package.json` — **modify**: `@babel/core` + `@types/babel__core` devDeps; `build:plugin` script.
- `src/overlay/fiber.ts` — **modify**: add `locFromDataAttr`.
- `tests/overlay/fiber.test.ts` — **modify**: `locFromDataAttr` tests.
- `src/overlay/index.ts` — **modify**: `selectLoc` + fiber-first/data-attr fallback + force toggle.
- `README.md` — **new**.
- `dist/overlay.js`, `dist/sourceAttrs.mjs` — **build + commit**.

---

## Task 1: Babel plugin `sourceAttrs` (TDD)

**Files:** create `src/plugin/sourceAttrs.ts` + `tests/plugin/sourceAttrs.test.ts`; modify `package.json`.

- [ ] **Step 1: Add the dev dependencies**

Run: `npm install --save-dev @babel/core @types/babel__core`
Expected: both appear under `devDependencies`.

- [ ] **Step 2: Add the `build:plugin` script**

In `package.json` `scripts`, add:
```json
"build:plugin": "esbuild src/plugin/sourceAttrs.ts --bundle --format=esm --outfile=dist/sourceAttrs.mjs"
```
(The plugin imports `@babel/core` only as types, so the bundle has no runtime dep.)

- [ ] **Step 3: Write the failing test** — create `tests/plugin/sourceAttrs.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { transformSync } from "@babel/core";
import sourceAttrs from "../../src/plugin/sourceAttrs.js";

function run(code: string, filename = "/abs/App.tsx"): string {
  const out = transformSync(code, {
    filename,
    plugins: [sourceAttrs],
    parserOpts: { plugins: ["jsx"] },
    configFile: false,
    babelrc: false,
  });
  return out!.code!;
}

describe("sourceAttrs babel plugin", () => {
  it("stamps data-source-* on a host element", () => {
    const code = run(`const x = <div className="a">hi</div>;`, "/abs/App.tsx");
    expect(code).toContain('data-source-file="/abs/App.tsx"');
    expect(code).toContain('data-source-line="1"');
    expect(code).toMatch(/data-source-column="\d+"/);
  });

  it("skips composite components and member tags", () => {
    expect(run(`const x = <Foo a={1}/>;`)).not.toContain("data-source");
    expect(run(`const x = <ns.Thing/>;`)).not.toContain("data-source");
  });

  it("does not double-stamp an element that already has the attrs", () => {
    const code = run(`const x = <div data-source-file="keep"/>;`);
    expect((code.match(/data-source-file/g) ?? []).length).toBe(1);
    expect(code).toContain('data-source-file="keep"');
  });

  it("reports a 1-based column at the `<`", () => {
    // `<span>` opens at index 10 (0-based) on line 1 → column 11
    const code = run(`const y = (<span/>);`);
    expect(code).toContain('data-source-column="12"'); // "const y = (" is 10 chars, `<` at idx 11 → col 12
  });
});
```

- [ ] **Step 4: Run to verify failure**

Run: `npx vitest run tests/plugin/sourceAttrs.test.ts`
Expected: FAIL — `src/plugin/sourceAttrs.ts` does not exist.

- [ ] **Step 5: Write the plugin** — create `src/plugin/sourceAttrs.ts`:

```ts
// src/plugin/sourceAttrs.ts
import type { PluginObj, PluginPass, NodePath, types as T } from "@babel/core";

/**
 * Babel plugin: stamp `data-source-file/line/column` onto host JSX elements so a
 * version-independent overlay can map a clicked DOM node back to its source —
 * needed on React 19+ where `fiber._debugSource` is gone. DEV ONLY: the absolute
 * file paths must not ship to production.
 */
export default function sourceAttrs({ types: t }: { types: typeof T }): PluginObj<PluginPass> {
  return {
    name: "ui-modifier-source-attrs",
    visitor: {
      JSXOpeningElement(path: NodePath<T.JSXOpeningElement>, state: PluginPass) {
        const name = path.node.name;
        if (name.type !== "JSXIdentifier" || !/^[a-z]/.test(name.name)) return; // host elements only
        const loc = path.node.loc;
        if (!loc) return;
        const has = (n: string) =>
          path.node.attributes.some(
            (a) => a.type === "JSXAttribute" && a.name.type === "JSXIdentifier" && a.name.name === n,
          );
        const add = (n: string, v: string) => {
          if (has(n)) return;
          path.node.attributes.push(t.jsxAttribute(t.jsxIdentifier(n), t.stringLiteral(v)));
        };
        add("data-source-file", state.filename ?? "");
        add("data-source-line", String(loc.start.line));
        add("data-source-column", String(loc.start.column + 1));
      },
    },
  };
}
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/plugin/sourceAttrs.test.ts`
Expected: PASS. (If the column test value is off, fix the EXPECTED number in the
test to the actual `<` column — the plugin's `loc.start.column + 1` is correct;
do not change the plugin.)

- [ ] **Step 7: Build the plugin + full gate**

Run: `npm run build:plugin` (expect `dist/sourceAttrs.mjs` written), then
`npx vitest run` and `npx tsc --noEmit`.
Expected: all pass; no type errors.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json src/plugin/sourceAttrs.ts tests/plugin/sourceAttrs.test.ts dist/sourceAttrs.mjs
git -c user.name=minwoo -c user.email=minwoo1989@gmail.com commit -m "feat: sourceAttrs babel plugin stamps data-source-* on host JSX"
```

---

## Task 2: Overlay `locFromDataAttr` (TDD)

**Files:** modify `src/overlay/fiber.ts`; modify `tests/overlay/fiber.test.ts`.

- [ ] **Step 1: Write the failing tests** — append to `tests/overlay/fiber.test.ts`
  (add `locFromDataAttr` to the existing import from `../../src/overlay/fiber.js`):

```ts
describe("locFromDataAttr", () => {
  it("reads the loc from the nearest data-source ancestor", () => {
    const src = { tagName: "DIV", dataset: { sourceFile: "/A.tsx", sourceLine: "5", sourceColumn: "3" } };
    const el = { closest: (s: string) => (s === "[data-source-file]" ? src : null) } as unknown as Element;
    expect(locFromDataAttr(el)).toEqual({ file: "/A.tsx", line: 5, column: 3, tag: "div" });
  });
  it("returns undefined when no ancestor has the attribute", () => {
    const el = { closest: () => null } as unknown as Element;
    expect(locFromDataAttr(el)).toBeUndefined();
  });
  it("returns undefined when the line is missing/invalid", () => {
    const src = { tagName: "DIV", dataset: { sourceFile: "/A.tsx" } };
    const el = { closest: () => src } as unknown as Element;
    expect(locFromDataAttr(el)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/overlay/fiber.test.ts`
Expected: FAIL — `locFromDataAttr` not exported.

- [ ] **Step 3: Implement** — add to `src/overlay/fiber.ts` (after `nameOf`):

```ts
/** Source loc from the nearest DOM ancestor carrying build-injected data-source-* attrs. */
export function locFromDataAttr(el: Element): SourceLoc | undefined {
  const src = el.closest("[data-source-file]") as HTMLElement | null;
  if (!src) return undefined;
  const file = src.dataset.sourceFile;
  const line = Number(src.dataset.sourceLine);
  if (!file || !Number.isFinite(line) || line <= 0) return undefined;
  const column = Number(src.dataset.sourceColumn);
  return { file, line, column: Number.isFinite(column) && column > 0 ? column : 1, tag: src.tagName.toLowerCase() };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/overlay/fiber.test.ts`
Expected: PASS.

- [ ] **Step 5: Full gate**

Run: `npx vitest run` then `npx tsc --noEmit`
Expected: all pass; no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/overlay/fiber.ts tests/overlay/fiber.test.ts
git -c user.name=minwoo -c user.email=minwoo1989@gmail.com commit -m "feat: locFromDataAttr reads build-injected data-source attrs"
```

---

## Task 3: Wire the data-attr path into `index.ts` + rebuild

**Files:** modify `src/overlay/index.ts`; rebuild `dist/overlay.js`.

(No unit test — DOM/wiring; verified by Task 5.)

- [ ] **Step 1: Update imports**

In `src/overlay/index.ts`, change the fiber import to add `locFromDataAttr` and the `SourceLoc` type:
```ts
import {
  fiberOf, nearestSourceFiber, parentSourceFiber, childSourceFiber,
  locOf, domNodeOf, nameOf, locFromDataAttr, type FiberLike, type SourceLoc,
} from "./fiber.js";
```

- [ ] **Step 2: Add `selectLoc`**

Add after the `selectFiber` function:
```ts
// Data-attr mode (React 19+ / no fiber source): no fiber → tree navigation off.
function selectLoc(loc: SourceLoc, el: Element) {
  current = undefined;
  inspector?.highlight(el);
  void panel.setTarget(loc.tag ?? el.tagName.toLowerCase(), loc);
  panel.setNav(false, false);
}
```

- [ ] **Step 3: Update the click handler (fiber-first, data-attr fallback, force toggle)**

Replace the `inspector = createInspector(...)` callback body:
```ts
  inspector = createInspector((el) => {
    const forceData = !!(window as unknown as { __uiModifierForceDataSource?: unknown }).__uiModifierForceDataSource;
    const f = forceData ? undefined : nearestSourceFiber(fiberOf(el));
    if (f) { selectFiber(f); return; }
    const dl = locFromDataAttr(el);
    if (dl) { selectLoc(dl, el.closest("[data-source-file]") ?? el); return; }
    void panel.setTarget(el.tagName.toLowerCase(), null);
  }, panel.host);
```

- [ ] **Step 4: Typecheck + rebuild + gate**

Run: `npx tsc --noEmit`, then `npm run build:overlay`, then `npx vitest run`.
Expected: no type errors; `dist/overlay.js` rewritten; all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/overlay/index.ts dist/overlay.js
git -c user.name=minwoo -c user.email=minwoo1989@gmail.com commit -m "feat: overlay falls back to data-source attrs when fibers lack source"
```

---

## Task 4: README

**Files:** create `README.md`.

- [ ] **Step 1: Write `README.md`**

Create `README.md` covering exactly these sections (keep it accurate to the code):

1. **What it is** — a dev tool: run a local agent, drop a bookmarklet on your running React/antd app, click an element, edit its style/className/props/text in the panel; changes are written back to the source file (HMR reloads).
2. **Quick start** — `npm install`; `npm run build:overlay`; `npm run agent` (serves `http://localhost:4567`, prints the port); open `http://localhost:4567/`, drag the **UI Modifier** bookmarklet to your bookmarks bar; open your app tab and click the bookmarklet.
3. **React ≤18 — zero setup.** Works as-is via React's `_debugSource`. Tree navigation (↑/↓) available.
4. **React 19+ — add the Babel plugin** (React 19 removed `_debugSource`):
   - `npm run build:plugin` (produces `dist/sourceAttrs.mjs`).
   - **Vite** (`@vitejs/plugin-react`, dev only):
     ```ts
     import react from '@vitejs/plugin-react';
     import sourceAttrs from '<path-to>/dist/sourceAttrs.mjs';
     export default defineConfig(({ command }) => ({
       plugins: [react(command === 'serve' ? { babel: { plugins: [sourceAttrs] } } : {})],
     }));
     ```
   - **webpack + babel-loader / CRA(craco) / Rollup(@rollup/plugin-babel)** — add `sourceAttrs` to that toolchain's Babel `plugins` (dev only).
   - Tree navigation (↑/↓) is disabled in this mode (no fiber tree).
5. **Support matrix** — Babel toolchains (Vite plugin-react, webpack+babel-loader, Rollup, CRA) ✅. **SWC-based (`@vitejs/plugin-react-swc`, Next.js default) ❌** — needs a future SWC plugin.
6. **Debug aid** — `window.__uiModifierForceDataSource = true` forces the data-source path on any React version (useful for testing React-19 behavior on a React-18 app).
7. **Notes / limitations** — dev-only (the plugin injects absolute paths; do not ship to production); the agent writes to the absolute path from the element and keeps backups in this repo's `.ui-modifier-backups/`; edits to elements rendered via `.map()` or styled with emotion `css` are surfaced as manual suggestions, not auto-applied.

- [ ] **Step 2: Commit**

```bash
git add README.md
git -c user.name=minwoo -c user.email=minwoo1989@gmail.com commit -m "docs: README — usage, React 18 vs 19, bundler matrix"
```

---

## Task 5: Browser smoke — fiber-independence on React 18

- [ ] **Step 1: Enable the plugin in the target app (temporary)**

Read `D:\Projects\test\test-multi-window\vite.config.ts`. Add an import of the
built plugin and wire it into the `react(...)` call's Babel plugins (dev). For
example, change the `react()` usage to
`react({ babel: { plugins: [sourceAttrs] } })` and add at the top:
`import sourceAttrs from 'D:/Projects/test/react-ui-source-editor/dist/sourceAttrs.mjs';`
(Note the exact change to revert it in Step 6.)

- [ ] **Step 2: Start the agent + the target dev server**

Agent (repo root, background): `npx tsx src/agent/server.ts` → `:4567` (kill a
stale 4567 listener first if needed).
Target (background, from the target dir): `npm run dev` → `:5173`.

- [ ] **Step 3: Write the smoke driver** — create `D:\Projects\test\test-multi-window\verify-datasource.mjs`:

```js
// Force the data-source path (fiber off) and prove inspect→edit works without fibers.
import { chromium } from 'playwright';
import fs from 'node:fs';

const FB = 'src/components/FloatingBar.tsx';
const PANEL = `
  const host = [...document.body.children].find(d => d.shadowRoot && d.shadowRoot.getElementById('apply'));
  const root = host && host.shadowRoot;
  const who = () => root.getElementById('who').textContent;
  const styleN = () => root.getElementById('styles').querySelectorAll('.row').length;
  const navUp = () => root.getElementById('nav-up').disabled;
  const out = () => root.getElementById('out').textContent;
`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
const href = (await (await fetch('http://localhost:4567/')).text()).match(/href="(javascript:[^"]+)"/)[1];
await page.goto('http://localhost:5173/');
await page.waitForSelector('text=창', { timeout: 20000 });
await page.waitForTimeout(2500);

// sanity: the build plugin actually injected data-source-* into the DOM
const sample = await page.evaluate(() => {
  const el = document.querySelector('[data-source-file]');
  return el ? { file: el.getAttribute('data-source-file'), line: el.getAttribute('data-source-line'), col: el.getAttribute('data-source-column') } : null;
});
console.log('data-source present in DOM:', JSON.stringify(sample));

await page.evaluate(() => { (window).__uiModifierForceDataSource = true; });
await page.evaluate((s) => { (0, eval)(s); }, href.replace(/^javascript:/, ''));
await page.waitForFunction(() => [...document.body.children].some((d) => d.shadowRoot && d.shadowRoot.getElementById('apply')));

// click the FloatingBar outer div (a host element with the data-source attr + a style object)
const box = await page.evaluate(() => {
  const el = [...document.querySelectorAll('div')].find((d) => d.style.position === 'fixed' && d.style.top === '12px' && d.style.boxShadow);
  const r = el.getBoundingClientRect(); return { x: r.left + 6, y: r.top + r.height / 2 };
});
await page.mouse.click(box.x, box.y);
await page.waitForFunction(`(() => { ${PANEL}; return styleN() > 0 || out(); })()`, { timeout: 5000 });
console.log('who:', await page.evaluate(`(() => { ${PANEL}; return who(); })()`));
console.log('styleN:', await page.evaluate(`(() => { ${PANEL}; return styleN(); })()`));
console.log('nav-up disabled (expect true in data-attr mode):', await page.evaluate(`(() => { ${PANEL}; return navUp(); })()`));

// edit background and apply
await page.evaluate(`(() => { ${PANEL};
  const rows = [...root.getElementById('styles').querySelectorAll('.row')];
  const i = rows.findIndex(r => r.querySelectorAll('input')[0].value === 'background');
  if (i >= 0) rows[i].querySelectorAll('input')[1].value = '#ffe4c4';
  root.getElementById('apply').click();
})()`);
await page.waitForTimeout(2000);
const disk = fs.readFileSync(FB, 'utf8');
console.log('disk has #ffe4c4:', disk.includes('#ffe4c4'));
await browser.close();
console.log('DONE');
```

- [ ] **Step 4: Run the smoke**

Run (from the target dir): `node verify-datasource.mjs`
Expected:
- `data-source present in DOM:` shows a `data-source-file` pointing into the
  target's `src/...` (proves the Babel plugin ran).
- `who:` shows `div — FloatingBar.tsx:NN`, `styleN` > 0 (resolved via data-attr,
  fiber forced off).
- `nav-up disabled (expect true …): true` (data-attr mode has no tree nav).
- `disk has #ffe4c4: true` (edit landed, fiber-free).

If `data-source present` is null, the plugin wiring in Step 1 is wrong. If
`styleN` is 0 with fiber forced off, the data-attr resolution path is broken —
stop and debug.

- [ ] **Step 5: Restore the target app + clean up**

```bash
cd /d D:\Projects\test\test-multi-window
git checkout -- vite.config.ts src/components/FloatingBar.tsx
del verify-datasource.mjs
```
Stop the agent + vite; confirm ports 4567 / 5173 free.

- [ ] **Step 6: Record verification in the spec**

Append a "Verification (2026-06-12)" section to
`docs/superpowers/specs/2026-06-12-data-source-resolver-design.md`: note the
plugin unit tests + `locFromDataAttr` tests pass, and the React-18 smoke with
`__uiModifierForceDataSource` (fiber off) resolved a clicked element purely from
`data-source-*` and applied an edit to disk (nav disabled in this mode) —
proving fiber-independence; `npx vitest run` / `npx tsc --noEmit` green.

- [ ] **Step 7: Commit**

```bash
cd /d D:\Projects\test\react-ui-source-editor
git add docs/superpowers/specs/2026-06-12-data-source-resolver-design.md
git -c user.name=minwoo -c user.email=minwoo1989@gmail.com commit -m "docs: record data-source resolver verification"
```

---

## Self-Review Notes

- **Spec coverage:** Babel plugin + build:plugin + dep (Task 1); `locFromDataAttr`
  (Task 2); index fiber-first/data-attr fallback + `selectLoc` + force toggle
  (Task 3); README with bundler matrix + React 18/19 split + SWC limitation
  (Task 4); React-18 fiber-independence proof (Task 5). Agent intentionally
  unchanged (spec §Agent).
- **Type consistency:** `locFromDataAttr(el): SourceLoc | undefined` (same
  `SourceLoc` as `locOf`); `selectLoc(loc: SourceLoc, el: Element)` feeds
  `panel.setTarget(name, loc)` (loc is a valid `PanelTarget`); `setNav(false,false)`
  matches the panel API.
- **No placeholders:** every step is concrete; the column test value note (Task 1
  Step 6) tells the engineer to align the expected number to the real `<` column
  rather than touch the (correct) plugin.
