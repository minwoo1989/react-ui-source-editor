# JSX Tree Navigation (parent ↑ / child ↓) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add ↑ (parent) / ↓ (child) buttons that move the selection through the source-bearing JSX fiber tree, re-inspecting and highlighting each target, disabling at the boundaries.

**Architecture:** `fiber.ts` gains pure fiber-tree helpers; `inspector.ts` exposes its highlight box; `index.ts` holds the current fiber and drives navigation; the panel stays fiber-agnostic, exposing ↑/↓ buttons that call an `onNavigate` handler and a `setNav` state setter.

**Tech Stack:** TypeScript, React fibers, esbuild (overlay bundle), vitest.

**Spec:** `docs/superpowers/specs/2026-06-12-jsx-tree-navigation-design.md`

**Conventions:** Run tests `npx vitest run`; typecheck `npx tsc --noEmit`; build overlay `npm run build:overlay`. Overlay unit tests in `tests/overlay/`. Commit after each task.

---

## File Structure

- `src/overlay/fiber.ts` — **rewrite**: add fiber-level helpers (`FiberLike`, `fiberOf`, `nearestSourceFiber`, `parentSourceFiber`, `childSourceFiber`, `locOf`, `domNodeOf`, `nameOf`); drop the now-unused `sourceLocFor`/`componentNameFor` in Task 3 once `index.ts` migrates.
- `tests/overlay/fiber.test.ts` — **new**: unit tests for the helpers (mock fibers).
- `src/overlay/inspector.ts` — **modify**: return `{ highlight, hide }`.
- `src/overlay/panel.ts` — **modify**: ↑/↓ buttons, `onNavigate`, `setNav`.
- `src/overlay/index.ts` — **rewrite**: navigation state + wiring.
- `dist/overlay.js` — **rebuild + commit** (Task 3).

---

## Task 1: `fiber.ts` — fiber-tree helpers (TDD)

**Files:**
- Modify: `src/overlay/fiber.ts` (add helpers; keep existing exports for now)
- Test: `tests/overlay/fiber.test.ts` (new)

- [ ] **Step 1: Write the failing tests**

Create `tests/overlay/fiber.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  fiberOf, nearestSourceFiber, parentSourceFiber, childSourceFiber,
  locOf, domNodeOf, nameOf, type FiberLike,
} from "../../src/overlay/fiber.js";

type Loc = { f: string; l: number; c: number };
function mk(opts: { type?: unknown; loc?: Loc; stateNode?: unknown } = {}): FiberLike {
  return {
    type: opts.type,
    _debugSource: opts.loc ? { fileName: opts.loc.f, lineNumber: opts.loc.l, columnNumber: opts.loc.c } : undefined,
    return: null, child: null, sibling: null, stateNode: opts.stateNode,
  };
}
/** Link `children` under `parent` (sets return + sibling chain). */
function link(parent: FiberLike, ...children: FiberLike[]): FiberLike {
  parent.child = children[0] ?? null;
  children.forEach((c, i) => { c.return = parent; c.sibling = children[i + 1] ?? null; });
  return parent;
}

describe("nearestSourceFiber", () => {
  it("walks up (inclusive) to the first fiber with _debugSource", () => {
    const root = mk({ loc: { f: "/A.tsx", l: 1, c: 1 } });
    const mid = mk();
    const leaf = mk();
    link(root, mid); link(mid, leaf);
    expect(nearestSourceFiber(leaf)).toBe(root);
    expect(nearestSourceFiber(undefined)).toBeUndefined();
  });
});

describe("parentSourceFiber", () => {
  it("returns the nearest distinct source ancestor, skipping non-source fibers", () => {
    const root = mk({ loc: { f: "/A.tsx", l: 1, c: 1 } });
    const mid = mk(); // no source
    const leaf = mk({ loc: { f: "/A.tsx", l: 9, c: 3 } });
    link(root, mid); link(mid, leaf);
    expect(parentSourceFiber(leaf)).toBe(root);
  });
  it("skips an ancestor with the same loc and returns undefined at the root", () => {
    const a = mk({ loc: { f: "/A.tsx", l: 5, c: 2 } });
    const b = mk({ loc: { f: "/A.tsx", l: 5, c: 2 } }); // same loc as a
    link(a, b);
    expect(parentSourceFiber(b)).toBeUndefined();
  });
});

describe("childSourceFiber", () => {
  it("returns the depth-first first distinct source descendant", () => {
    const root = mk({ loc: { f: "/A.tsx", l: 1, c: 1 } });
    const m1 = mk(); // no source
    const leaf1 = mk({ loc: { f: "/A.tsx", l: 4, c: 5 } });
    const m2 = mk({ loc: { f: "/A.tsx", l: 8, c: 5 } });
    link(root, m1, m2); link(m1, leaf1);
    expect(childSourceFiber(root)).toBe(leaf1); // descends m1 before reaching m2
  });
  it("skips a same-loc child and returns a distinct grandchild", () => {
    const root = mk({ loc: { f: "/A.tsx", l: 1, c: 1 } });
    const child = mk({ loc: { f: "/A.tsx", l: 1, c: 1 } }); // same loc
    const gc = mk({ loc: { f: "/A.tsx", l: 6, c: 2 } });
    link(root, child); link(child, gc);
    expect(childSourceFiber(root)).toBe(gc);
  });
  it("returns undefined when no distinct source descendant exists", () => {
    const root = mk({ loc: { f: "/A.tsx", l: 1, c: 1 } });
    link(root, mk(), mk());
    expect(childSourceFiber(root)).toBeUndefined();
  });
});

describe("locOf", () => {
  it("maps _debugSource + type to a SourceLoc", () => {
    expect(locOf(mk({ type: "div", loc: { f: "/A.tsx", l: 5, c: 3 } })))
      .toEqual({ file: "/A.tsx", line: 5, column: 3, tag: "div" });
  });
  it("returns undefined without _debugSource", () => {
    expect(locOf(mk({ type: "div" }))).toBeUndefined();
  });
});

describe("nameOf", () => {
  it("uses the host tag", () => { expect(nameOf(mk({ type: "section" }))).toBe("section"); });
  it("uses a function component name", () => {
    function Foo() { return null; }
    expect(nameOf(mk({ type: Foo }))).toBe("Foo");
  });
  it("falls back to 'element' for an unknown type", () => {
    expect(nameOf(mk({ type: undefined }))).toBe("element");
  });
});

describe("domNodeOf", () => {
  it("returns an element stateNode directly", () => {
    const el = { nodeType: 1 };
    expect(domNodeOf(mk({ stateNode: el }))).toBe(el);
  });
  it("returns the nearest host descendant when the fiber has no element stateNode", () => {
    const el = { nodeType: 1 };
    const comp = mk({ stateNode: null });
    const host = mk({ stateNode: el });
    link(comp, host);
    expect(domNodeOf(comp)).toBe(el);
  });
});

describe("fiberOf", () => {
  it("reads the __reactFiber$ key", () => {
    const f = mk();
    const node = { ["__reactFiber$abc"]: f } as unknown as Element;
    expect(fiberOf(node)).toBe(f);
  });
  it("returns undefined when no fiber key is present", () => {
    expect(fiberOf({} as Element)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/overlay/fiber.test.ts`
Expected: FAIL — the new helpers are not exported yet.

- [ ] **Step 3: Add the helpers to `fiber.ts`**

Edit `src/overlay/fiber.ts`: keep the existing `SourceLoc`, `sourceLocFor`, and
`componentNameFor` exports unchanged (they are removed in Task 3 after `index.ts`
migrates). Add the following — and add a `FiberLike` interface and an `isElement`
duck-type check. Replace the existing private `fiberTypeName` with an exported-free
`typeName(t: unknown)` used by both old and new code (update `sourceLocFor` to call
`typeName(fiber.type)`):

```ts
// Minimal shape of a React fiber we rely on.
export interface FiberLike {
  type?: unknown;
  _debugSource?: { fileName?: string; lineNumber?: number; columnNumber?: number };
  return?: FiberLike | null;
  child?: FiberLike | null;
  sibling?: FiberLike | null;
  stateNode?: unknown;
}

function typeName(t: unknown): string | undefined {
  if (typeof t === "string") return t;
  if (typeof t === "function") return (t as { displayName?: string; name?: string }).displayName || (t as { name?: string }).name || undefined;
  if (t && typeof t === "object") {
    const o = t as { displayName?: string; render?: { displayName?: string; name?: string }; type?: { displayName?: string; name?: string } };
    return o.displayName
      || (o.render && (o.render.displayName || o.render.name))
      || (o.type && typeof o.type === "function" && (o.type.displayName || o.type.name))
      || undefined;
  }
  return undefined;
}

function hasSource(f: FiberLike): boolean {
  return !!(f._debugSource && f._debugSource.fileName);
}

function sameLoc(a: FiberLike, b: FiberLike): boolean {
  const x = a._debugSource, y = b._debugSource;
  return !!x && !!y && x.fileName === y.fileName && x.lineNumber === y.lineNumber && x.columnNumber === y.columnNumber;
}

function isElement(x: unknown): x is Element {
  return !!x && typeof x === "object" && (x as { nodeType?: number }).nodeType === 1;
}

/** The React fiber attached to a DOM node, if any. */
export function fiberOf(node: Element): FiberLike | undefined {
  const key = Object.keys(node).find((k) => k.startsWith("__reactFiber$"));
  return key ? (node as unknown as Record<string, FiberLike>)[key] : undefined;
}

/** From `fiber` upward (inclusive), the first fiber carrying _debugSource. */
export function nearestSourceFiber(fiber: FiberLike | undefined): FiberLike | undefined {
  let f: FiberLike | null | undefined = fiber;
  while (f) { if (hasSource(f)) return f; f = f.return; }
  return undefined;
}

/** First distinct source-bearing ancestor of `fiber` (different loc). */
export function parentSourceFiber(fiber: FiberLike): FiberLike | undefined {
  let f: FiberLike | null | undefined = fiber.return;
  while (f) { if (hasSource(f) && !sameLoc(f, fiber)) return f; f = f.return; }
  return undefined;
}

/** First distinct source-bearing descendant of `fiber`, depth-first. */
export function childSourceFiber(fiber: FiberLike): FiberLike | undefined {
  function dfs(start: FiberLike | null | undefined): FiberLike | undefined {
    for (let c = start; c; c = c.sibling) {
      if (hasSource(c) && !sameLoc(c, fiber)) return c;
      const deeper = dfs(c.child);
      if (deeper) return deeper;
    }
    return undefined;
  }
  return dfs(fiber.child);
}

/** {file,line,column,tag} from a fiber's _debugSource + type; undefined when no source. */
export function locOf(fiber: FiberLike): SourceLoc | undefined {
  const s = fiber._debugSource;
  if (!s || !s.fileName) return undefined;
  return { file: s.fileName, line: s.lineNumber ?? 0, column: s.columnNumber ?? 0, tag: typeName(fiber.type) };
}

/** The fiber's host DOM element (its stateNode, or the nearest host descendant). */
export function domNodeOf(fiber: FiberLike): Element | undefined {
  if (isElement(fiber.stateNode)) return fiber.stateNode;
  function dfs(start: FiberLike | null | undefined): Element | undefined {
    for (let c = start; c; c = c.sibling) {
      if (isElement(c.stateNode)) return c.stateNode;
      const deeper = dfs(c.child);
      if (deeper) return deeper;
    }
    return undefined;
  }
  return dfs(fiber.child);
}

/** Display name for a fiber (host tag / composite name). */
export function nameOf(fiber: FiberLike): string {
  return typeName(fiber.type) ?? "element";
}
```

Also update the existing `fiberTypeName` usage: delete the old `fiberTypeName`
function and change `sourceLocFor`'s `tag: fiberTypeName(fiber)` to
`tag: typeName(fiber.type)`. Leave `sourceLocFor`/`componentNameFor` otherwise
intact for this task.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/overlay/fiber.test.ts`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Full suite + typecheck**

Run: `npx vitest run` then `npx tsc --noEmit`
Expected: all pass; no type errors (`index.ts` still uses `sourceLocFor`/`componentNameFor`, which remain).

- [ ] **Step 6: Commit**

```bash
git add src/overlay/fiber.ts tests/overlay/fiber.test.ts
git -c user.name=minwoo -c user.email=minwoo1989@gmail.com commit -m "feat: fiber-tree navigation helpers"
```

(End the commit message with the standard `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` trailer.)

---

## Task 2: `inspector.ts` — expose the highlight box

**Files:**
- Modify: `src/overlay/inspector.ts`

(No unit test — DOM behavior; verified by the Task 4 browser smoke + tsc.)

- [ ] **Step 1: Return a highlight API**

In `src/overlay/inspector.ts`, add a `return` at the END of `createInspector`
(after the two `addEventListener` calls), exposing the existing `show` plus a
`hide`:

```ts
  return {
    highlight: show,
    hide() { hl.style.display = "none"; },
  };
```

(No other change — `show(el)` already positions the box over an element.)

- [ ] **Step 2: Typecheck + full suite**

Run: `npx tsc --noEmit` then `npx vitest run`
Expected: no type errors (the existing `createInspector(...)` call ignores the
new return value); all tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/overlay/inspector.ts
git -c user.name=minwoo -c user.email=minwoo1989@gmail.com commit -m "feat: inspector exposes highlight/hide"
```

(Standard `Co-Authored-By` trailer.)

---

## Task 3: panel buttons + index wiring + remove legacy helpers + rebuild

**Files:**
- Modify: `src/overlay/panel.ts`
- Modify: `src/overlay/index.ts` (full rewrite)
- Modify: `src/overlay/fiber.ts` (remove now-unused `sourceLocFor`/`componentNameFor`)
- Rebuild: `dist/overlay.js`

(No unit tests — DOM/wiring; verified by Task 4 browser smoke + tsc.)

- [ ] **Step 1: panel.ts — buttons, handler, setNav**

In `src/overlay/panel.ts`:

(a) Extend `PanelHandlers` (it currently ends with `onHistory`):

```ts
  onNavigate(dir: "up" | "down"): void;
```

(b) In the `<style>` block, after the `.t{...}` rule, add:

```
      .nav{display:flex;gap:6px;margin-bottom:6px}
      .nav button{padding:1px 8px;cursor:pointer;font:inherit}
      .nav button:disabled{opacity:.4;cursor:default}
```

(c) In the markup, immediately AFTER `<div class="t" id="who">No selection</div>`, add:

```
      <div class="nav"><button id="nav-up" disabled title="parent (↑)">↑</button><button id="nav-down" disabled title="child (↓)">↓</button></div>
```

(d) Add a nav-button state helper near `setHistoryButtons` (in the closure):

```ts
  function setNavButtons(canUp: boolean, canDown: boolean) {
    $<HTMLButtonElement>("nav-up").disabled = !canUp;
    $<HTMLButtonElement>("nav-down").disabled = !canDown;
  }

  $("nav-up").onclick = () => handlers.onNavigate("up");
  $("nav-down").onclick = () => handlers.onNavigate("down");
```

(e) In `setTarget`, the no-target branch (`if (!target) { ... }`) currently
disables editors; add `setNavButtons(false, false);` inside it.

(f) In `setError`, add `setNavButtons(false, false);` (alongside the existing resets).

(g) Expose `setNav` on the returned object (add to the `return { host, ... }` block):

```ts
    setNav: setNavButtons,
```

- [ ] **Step 2: index.ts — navigation state + wiring (full rewrite)**

Replace the entire contents of `src/overlay/index.ts` with:

```ts
// src/overlay/index.ts
import {
  fiberOf, nearestSourceFiber, parentSourceFiber, childSourceFiber,
  locOf, domNodeOf, nameOf, type FiberLike,
} from "./fiber.js";
import { createPanel } from "./panel.js";
import { createInspector } from "./inspector.js";
import { sendEdit, sendInspect, sendUndo, sendRedo, fetchHistory } from "./api.js";
import { AGENT_ORIGIN } from "./agentOrigin.js";

let current: FiberLike | undefined;
let inspector: ReturnType<typeof createInspector> | undefined;

function selectFiber(fiber: FiberLike) {
  current = fiber;
  const dom = domNodeOf(fiber);
  if (dom) inspector?.highlight(dom);
  void panel.setTarget(nameOf(fiber), locOf(fiber) ?? null);
  panel.setNav(!!parentSourceFiber(fiber), !!childSourceFiber(fiber));
}

const panel = createPanel({
  onInspect: sendInspect,
  onApply: sendEdit,
  onUndo: sendUndo,
  onRedo: sendRedo,
  onHistory: fetchHistory,
  onNavigate: (dir) => {
    if (!current) return;
    const next = dir === "up" ? parentSourceFiber(current) : childSourceFiber(current);
    if (next) selectFiber(next);
  },
});

if (AGENT_ORIGIN === null) {
  // Loaded without a detectable script origin — fetches can't be aimed anywhere.
  panel.setError("에이전트 origin을 감지하지 못했습니다 — 북마클릿으로 다시 여세요.");
  console.error("[ui-modifier] agent origin not detected from document.currentScript");
} else {
  inspector = createInspector((el) => {
    const f = nearestSourceFiber(fiberOf(el));
    if (f) selectFiber(f);
    else void panel.setTarget(el.tagName.toLowerCase(), null);
  }, panel.host);
}

console.log("[ui-modifier] overlay ready");
```

- [ ] **Step 3: fiber.ts — remove the now-unused legacy helpers**

In `src/overlay/fiber.ts`, delete the `sourceLocFor` and `componentNameFor`
functions (no longer imported anywhere). Keep `SourceLoc`, `FiberLike`, the
private helpers, and all the Task-1 exports. Confirm with
`grep -rn "sourceLocFor\|componentNameFor" src tests` → no matches.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (no remaining references to the deleted functions; `onNavigate`
and `setNav` are wired).

- [ ] **Step 5: Rebuild the overlay bundle**

Run: `npm run build:overlay`
Expected: `dist/overlay.js` rewritten.

- [ ] **Step 6: Full suite + typecheck**

Run: `npx vitest run` then `npx tsc --noEmit`
Expected: all pass; no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/overlay/panel.ts src/overlay/index.ts src/overlay/fiber.ts dist/overlay.js
git -c user.name=minwoo -c user.email=minwoo1989@gmail.com commit -m "feat: parent/child JSX navigation buttons wired to fiber walk"
```

(Standard `Co-Authored-By` trailer.)

---

## Task 4: Browser smoke — climb up and down the tree

- [ ] **Step 1: Start the agent**

Run (background, repo root): `npx tsx src/agent/server.ts`
Expected: `[ui-modifier] agent on http://localhost:4567`. (If it fails with
`EADDRINUSE`, kill the stale listener on 4567 first, then retry.)

- [ ] **Step 2: Start the target app dev server**

Run (background, from `D:\Projects\test\test-multi-window`): `npm run dev`
Expected: `VITE ... Local: http://localhost:5173/`.

- [ ] **Step 3: Write the smoke driver**

Create `D:\Projects\test\test-multi-window\verify-nav.mjs`:

```js
// Click a deep element, climb ↑ to ancestors, descend ↓; check who-line + button states.
import { chromium } from 'playwright';

const PANEL = `
  const host = [...document.body.children].find(d => d.shadowRoot && d.shadowRoot.getElementById('apply'));
  const root = host && host.shadowRoot;
  const who = () => root.getElementById('who').textContent;
  const rows = () => root.getElementById('styles').querySelectorAll('.row').length;
  const up = () => root.getElementById('nav-up').disabled;
  const down = () => root.getElementById('nav-down').disabled;
  const clickUp = () => root.getElementById('nav-up').click();
  const clickDown = () => root.getElementById('nav-down').click();
`;
const snap = (page) => page.evaluate(`(() => { ${PANEL}; return { who: who(), rows: rows(), upDisabled: up(), downDisabled: down() }; })()`);
const act = (page, fn) => page.evaluate(`(() => { ${PANEL}; ${fn}; })()`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const href = (await (await fetch('http://localhost:4567/')).text()).match(/href="(javascript:[^"]+)"/)[1];
await page.goto('http://localhost:5173/');
await page.waitForSelector('text=창', { timeout: 20000 });
await page.waitForTimeout(2500);
await page.evaluate((s) => { (0, eval)(s); }, href.replace(/^javascript:/, ''));
await page.waitForFunction(() => [...document.body.children].some((d) => d.shadowRoot && d.shadowRoot.getElementById('apply')));

// Click the Segmented control inside the FloatingBar (a deep element).
const seg = await page.evaluate(() => {
  const el = document.querySelector('.ant-segmented');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + 4, y: r.top + r.height / 2 };
});
if (!seg) { console.log('FAIL: no .ant-segmented found'); await browser.close(); process.exit(0); }
await page.mouse.click(seg.x, seg.y);
await page.waitForFunction(`(() => { ${PANEL}; return who().includes(':'); })()`, { timeout: 5000 });
console.log('after click:', JSON.stringify(await snap(page)));

await act(page, 'clickUp()'); await page.waitForTimeout(400);
console.log('after ↑ #1:', JSON.stringify(await snap(page)));
await act(page, 'clickUp()'); await page.waitForTimeout(400);
console.log('after ↑ #2:', JSON.stringify(await snap(page)));

await act(page, 'clickDown()'); await page.waitForTimeout(400);
console.log('after ↓ #1:', JSON.stringify(await snap(page)));

console.log('NOTE: who-line should change at each step; up/down disabled flags flip at the tree boundaries.');
await browser.close();
console.log('DONE');
```

- [ ] **Step 4: Run the smoke**

Run (from `D:\Projects\test\test-multi-window`): `node verify-nav.mjs`
Expected (qualitative — read the captured lines):
- `after click` shows a `who` like `Segmented — FloatingBar.tsx:NN`, `downDisabled`
  may be true (leaf-ish), `upDisabled` false.
- `after ↑ #1` / `#2` show the `who` line changing to ancestor elements (e.g. the
  FloatingBar `<div>`, then the `<FloatingBar>` usage in `App.tsx`), with `rows`
  updating — confirming re-inspect on navigation.
- `after ↓ #1` moves back down (who-line changes again).
- At least one step shows a button `disabled` flag flipping (boundary reached).

If the `who` line does not change on ↑/↓, or both buttons are always disabled,
the wiring is wrong — stop and debug.

- [ ] **Step 5: Clean up**

```bash
cd /d D:\Projects\test\test-multi-window
del verify-nav.mjs
```

(The smoke makes no edits, so no target-file restore is needed.) Stop the
background agent and vite servers; confirm ports 4567 / 5173 are free.

- [ ] **Step 6: Record verification in the spec**

Append a short "Verification (2026-06-12)" section to
`docs/superpowers/specs/2026-06-12-jsx-tree-navigation-design.md`: note the unit
tests pass and the browser smoke showed the selection climbing from the Segmented
control up through the FloatingBar `<div>` to the `<FloatingBar>` usage (who-line
+ rows updating each step) and descending again, with ↑/↓ disabling at the
boundaries; `npx vitest run` / `npx tsc --noEmit` green.

- [ ] **Step 7: Commit**

```bash
cd /d D:\Projects\test\react-ui-source-editor
git add docs/superpowers/specs/2026-06-12-jsx-tree-navigation-design.md
git -c user.name=minwoo -c user.email=minwoo1989@gmail.com commit -m "docs: record JSX tree navigation verification"
```

(Standard `Co-Authored-By` trailer.)

---

## Self-Review Notes

- **Spec coverage:** fiber helpers (Task 1); highlight exposure (Task 2);
  buttons + `onNavigate` + `setNav` + index navigation state + legacy removal
  (Task 3); climb-up/down browser proof (Task 4). All spec sections mapped.
- **Type consistency:** `FiberLike` shape is shared; `parentSourceFiber`/
  `childSourceFiber`/`nearestSourceFiber` take/return `FiberLike`; `locOf` returns
  `SourceLoc | undefined` (consumed by `panel.setTarget`); `nameOf`→string;
  `domNodeOf`→`Element | undefined` (consumed by `inspector.highlight`);
  `onNavigate(dir: "up"|"down")` and `setNav(canUp, canDown)` match index's calls.
- **No placeholders:** every code step is complete; `isElement` duck-types
  `nodeType === 1` so `domNodeOf` is unit-testable in node (no `instanceof Element`).
