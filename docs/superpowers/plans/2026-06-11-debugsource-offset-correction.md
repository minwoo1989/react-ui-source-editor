# `_debugSource` Line-Offset Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make click-to-inspect/edit target the correct JSX element on a Vite dev server, where `fiber._debugSource` reports a line shifted by the react-refresh preamble, without hard-coding the offset.

**Architecture:** The agent (the only side holding the true original source) gains a tolerant resolver `resolveJsxElement` that keys on the always-correct column and the element tag, picking the matching JSX element nearest at-or-above the reported line. The overlay sends the element's tag alongside the existing loc. Both `/inspect` and `/edit` route through the one resolver.

**Tech Stack:** TypeScript, ts-morph (AST), vitest (tests), esbuild (overlay bundle), Node http (agent), React fibers (overlay).

**Spec:** `docs/superpowers/specs/2026-06-11-debugsource-offset-correction-design.md`

**Conventions (verified in this repo):**
- 1-based line/column; column points at the `<` of the opening tag (matches `_debugSource.columnNumber`).
- Run tests: `npx vitest run`. Typecheck: `npx tsc --noEmit`. Build overlay: `npm run build:overlay`.
- In-memory ts-morph source files in tests use `new Project({ useInMemoryFileSystem: true }).createSourceFile("F.tsx", text)`.
- Commit after each task.

---

## File Structure

- `src/agent/locate.ts` — **rewrite**: add `resolveJsxElement` (exact phase + tolerant column/tag phase). Keep a thin `locateJsxElement` delegate until callers migrate (Task 3).
- `src/shared/types.ts` — **modify**: add optional `tag?: string` to `InspectRequest` and `EditRequest`.
- `src/agent/inspect.ts` — **modify**: take `tag?`, call `resolveJsxElement`, return an explicit error when nothing resolves.
- `src/agent/apply.ts` — **modify**: call `resolveJsxElement` with `req.tag`, explicit error message.
- `src/agent/server.ts` — **modify**: pass `body.tag` to `inspectJsxElement`.
- `src/overlay/fiber.ts` — **modify**: return the producing fiber's type name as `tag`.
- `src/overlay/panel.ts` — **modify**: `PanelTarget` gains `tag`; thread into inspect/edit requests.
- `dist/overlay.js` — **rebuild + commit** (the agent serves this bundle).
- `tests/agent/locate.test.ts` — **rewrite**: cover `resolveJsxElement`.
- `tests/agent/inspect.test.ts` — **append**: shifted-line resolution + explicit-error tests.

---

## Task 1: `resolveJsxElement` resolver core

**Files:**
- Modify: `src/agent/locate.ts` (full rewrite)
- Test: `tests/agent/locate.test.ts` (full rewrite)

- [ ] **Step 1: Write the failing tests**

Replace the entire contents of `tests/agent/locate.test.ts` with:

```ts
// tests/agent/locate.test.ts
import { describe, it, expect } from "vitest";
import { Project } from "ts-morph";
import { resolveJsxElement } from "../../src/agent/locate.js";

function sourceFileFrom(text: string) {
  const project = new Project({ useInMemoryFileSystem: true });
  return project.createSourceFile("F.tsx", text);
}

// <div> at true line 4 col 5, <span> at true line 5 col 7, <br/> at line 6 col 7.
const NESTED = [
  "import x from 'y';",          // 1
  "export function C() {",       // 2
  "  return (",                  // 3
  '    <div className="a">',     // 4
  "      <span>hi</span>",       // 5
  "      <br/>",                 // 6
  "    </div>",                  // 7
  "  );",                        // 8
  "}",                           // 9
].join("\n");

describe("resolveJsxElement", () => {
  it("exact phase: resolves an accurate (offset-0) position", () => {
    const sf = sourceFileFrom(NESTED);
    const node = resolveJsxElement(sf, 4, 5, "div");
    expect(node).toBeDefined();
    expect(node!.getKindName()).toMatch(/JsxOpeningElement|JsxSelfClosingElement/);
    expect(sf.compilerNode.getLineAndCharacterOfPosition(node!.getStart()).line + 1).toBe(4);
  });

  it("tolerant phase: resolves a line-shifted position via column + tag", () => {
    const sf = sourceFileFrom(NESTED);
    // simulate a +10 preamble shift: <span> reported at line 15, col preserved (7)
    const node = resolveJsxElement(sf, 15, 7, "span");
    expect(node).toBeDefined();
    expect(sf.compilerNode.getLineAndCharacterOfPosition(node!.getStart()).line + 1).toBe(5);
  });

  it("tolerant phase: works for self-closing elements", () => {
    const sf = sourceFileFrom(NESTED);
    const node = resolveJsxElement(sf, 16, 7, "br"); // <br/> true line 6
    expect(node).toBeDefined();
    expect(sf.compilerNode.getLineAndCharacterOfPosition(node!.getStart()).line + 1).toBe(6);
  });

  it("falls back to column-only when the tag does not match (e.g. member expr)", () => {
    const sf = sourceFileFrom(NESTED);
    // only one element at column 5 (the div); unknown tag -> column-only fallback
    const node = resolveJsxElement(sf, 14, 5, "Some.Member");
    expect(node).toBeDefined();
    expect(sf.compilerNode.getLineAndCharacterOfPosition(node!.getStart()).line + 1).toBe(4);
  });

  it("ambiguous identical (column,tag): returns the nearest from below (documented limitation)", () => {
    const sf = sourceFileFrom([
      "export function C(one: boolean) {",  // 1
      "  return one ? (",                   // 2
      "    <div>a</div>",                   // 3  div col5
      "  ) : (",                            // 4
      "    <div>b</div>",                   // 5  div col5
      "  );",                               // 6
      "}",                                  // 7
    ].join("\n"));
    const node = resolveJsxElement(sf, 16, 5, "div"); // reported 16; both 3 and 5 are above
    expect(sf.compilerNode.getLineAndCharacterOfPosition(node!.getStart()).line + 1).toBe(5);
  });

  it("returns undefined when no element matches the column", () => {
    const sf = sourceFileFrom(NESTED);
    expect(resolveJsxElement(sf, 100, 99, "div")).toBeUndefined();
  });

  it("does not throw when the reported line is past end-of-file", () => {
    const sf = sourceFileFrom(NESTED);
    // line 9 is the last line; a shifted report could exceed it
    expect(() => resolveJsxElement(sf, 999, 5, "div")).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/agent/locate.test.ts`
Expected: FAIL — `resolveJsxElement` is not exported from `locate.ts`.

- [ ] **Step 3: Rewrite the implementation**

Replace the entire contents of `src/agent/locate.ts` with:

```ts
// src/agent/locate.ts
import { SourceFile, Node, ts, SyntaxKind } from "ts-morph";

function isJsxOpening(node: Node): boolean {
  const k = node.getKind();
  return k === SyntaxKind.JsxOpeningElement || k === SyntaxKind.JsxSelfClosingElement;
}

function tagText(node: Node): string {
  return (node as unknown as { getTagNameNode(): Node }).getTagNameNode().getText();
}

function lineColOf(sf: SourceFile, node: Node): { line: number; column: number } {
  const lc = ts.getLineAndCharacterOfPosition(sf.compilerNode, node.getStart());
  return { line: lc.line + 1, column: lc.character + 1 };
}

/** Exact position lookup — the original behavior, used when _debugSource is accurate. */
function exactAt(sf: SourceFile, line: number, column: number): Node | undefined {
  let pos: number;
  try {
    pos = ts.getPositionOfLineAndCharacter(sf.compilerNode, line - 1, column - 1);
  } catch {
    return undefined; // reported position is past EOF (offset pushed it out) — fall to tolerant phase
  }
  let node: Node | undefined = sf.getDescendantAtPos(pos);
  while (node) {
    if (isJsxOpening(node)) return node;
    node = node.getParent();
  }
  return undefined;
}

/**
 * Resolve the JSX opening/self-closing element a fiber._debugSource points at.
 *
 * Dev stacks that prepend a module preamble (e.g. @vitejs/plugin-react's
 * react-refresh preamble) shift the reported LINE down by a constant per file
 * while the COLUMN is preserved. We trust the column (and tag, when supplied)
 * and pick the matching element nearest at-or-above the reported line.
 */
export function resolveJsxElement(
  sf: SourceFile,
  line: number,
  column: number,
  tag?: string
): Node | undefined {
  // 1. Exact phase — accurate _debugSource (no offset).
  const exact = exactAt(sf, line, column);
  if (exact && (tag === undefined || tagText(exact) === tag)) return exact;

  // 2. Tolerant phase — column preserved, line shifted by a positive constant.
  const all = [
    ...sf.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
    ...sf.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
  ];
  const sameColumn = all.filter((n) => lineColOf(sf, n).column === column);
  const byTag = tag === undefined ? [] : sameColumn.filter((n) => tagText(n) === tag);
  const candidates = byTag.length > 0 ? byTag : sameColumn;

  // The true element is at or above the reported line; take the closest from below.
  const ranked = candidates
    .map((n) => ({ n, line: lineColOf(sf, n).line }))
    .filter((c) => c.line <= line)
    .sort((a, b) => b.line - a.line);
  return ranked.length > 0 ? ranked[0].n : undefined;
}

/**
 * Backward-compatible exact-only entry point. Temporary delegate so existing
 * callers compile until they migrate to resolveJsxElement in Task 3.
 */
export function locateJsxElement(sf: SourceFile, line: number, column: number): Node | undefined {
  return resolveJsxElement(sf, line, column);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/agent/locate.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Run the full suite + typecheck to confirm no breakage**

Run: `npx vitest run` then `npx tsc --noEmit`
Expected: all tests pass (existing `inspect`/`apply` callers still use `locateJsxElement` delegate); no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/agent/locate.ts tests/agent/locate.test.ts
git commit -m "feat: tolerant resolveJsxElement (column+tag, line-shift safe)"
```

---

## Task 2: Add optional `tag` to request types

**Files:**
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Add `tag?` to `InspectRequest`**

In `src/shared/types.ts`, change the `InspectRequest` interface to:

```ts
/** Sent from overlay to agent to read source truth for the selected element. */
export interface InspectRequest {
  /** Absolute path, same contract as EditRequest.file. */
  file: string;
  line: number;
  column: number;
  /** JSX tag/component name of the clicked element, used to disambiguate after line-offset correction. */
  tag?: string;
}
```

- [ ] **Step 2: Add `tag?` to `EditRequest`**

In the same file, change the `EditRequest` interface to:

```ts
/** Sent from overlay to agent. line/column are 1-based, from fiber._debugSource. */
export interface EditRequest {
  /** Absolute path, taken verbatim from _debugSource.fileName. */
  file: string;
  line: number;
  column: number;
  /** JSX tag/component name of the clicked element, used to disambiguate after line-offset correction. */
  tag?: string;
  edits: Edit[];
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (the field is optional; nothing else changes yet).

- [ ] **Step 4: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat: optional tag on Inspect/EditRequest"
```

---

## Task 3: Agent routes through the resolver with explicit errors

**Files:**
- Modify: `src/agent/inspect.ts`
- Modify: `src/agent/apply.ts`
- Modify: `src/agent/server.ts:96-98` (inspect route)
- Modify: `src/agent/locate.ts` (remove the now-unused delegate)
- Test: `tests/agent/inspect.test.ts` (append)

- [ ] **Step 1: Write the failing tests (append to `tests/agent/inspect.test.ts`)**

Add these two tests inside the existing top-level `describe` block in `tests/agent/inspect.test.ts` (use the file's existing `sourceFileFrom`/`inspectJsxElement` imports):

```ts
  it("resolves a line-shifted selection via column + tag", () => {
    const sf = sourceFileFrom([
      "import x from 'y';",                 // 1
      "export const C = () => (",           // 2
      '  <button style={{ color: "red" }}>hi</button>', // 3  <button col 3
      ");",                                 // 4
    ].join("\n"));
    // report line 13 (a +10 shift), correct column 3, tag "button"
    const res = inspectJsxElement(sf, 13, 3, "button");
    expect(res.status).toBe("ok");
    if (res.status === "ok") {
      expect(res.style.find((s) => s.property === "color")?.value).toBe("red");
    }
  });

  it("returns an explicit error (not an empty ok) when nothing resolves", () => {
    const sf = sourceFileFrom('const C = () => (<button>hi</button>);');
    const res = inspectJsxElement(sf, 999, 99, "button");
    expect(res.status).toBe("error");
    if (res.status === "error") expect(res.message).toMatch(/near line 999/);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/agent/inspect.test.ts`
Expected: FAIL — `inspectJsxElement` does not yet accept a `tag` argument / the shifted lookup returns an error rather than ok.

- [ ] **Step 3: Update `inspect.ts` to use the resolver + `tag`**

In `src/agent/inspect.ts`, change the import line:

```ts
import { resolveJsxElement } from "./locate.js";
```

and change the `inspectJsxElement` function signature + first two lines to:

```ts
/** Read source truth (style object, className, text) for the JSX element at line/column. */
export function inspectJsxElement(sf: SourceFile, line: number, column: number, tag?: string): InspectResult {
  const opening = resolveJsxElement(sf, line, column, tag);
  if (!opening) return { status: "error", message: `no ${tag ?? "JSX"} element near line ${line}` };
```

(Leave the rest of the function body unchanged.)

- [ ] **Step 4: Update `apply.ts` to use the resolver + `req.tag`**

In `src/agent/apply.ts`, change the import line:

```ts
import { resolveJsxElement } from "./locate.js";
```

and change the locate + guard lines inside `processEdits` (currently `locateJsxElement(sf, req.line, req.column)` and `"no JSX element at position"`) to:

```ts
  const opening = resolveJsxElement(sf, req.line, req.column, req.tag);
  if (!opening) return { status: "error", message: `no ${req.tag ?? "JSX"} element near line ${req.line}` };
```

- [ ] **Step 5: Pass `tag` through the server inspect route**

In `src/agent/server.ts`, in the `/inspect` handler, change:

```ts
      return sendJson(res, 200, inspectJsxElement(sf, body.line, body.column));
```

to:

```ts
      return sendJson(res, 200, inspectJsxElement(sf, body.line, body.column, body.tag));
```

(The `/edit` route already forwards the whole body via `{ ...reqBody, file: mem }`, so `req.tag` reaches `processEdits` unchanged.)

- [ ] **Step 6: Remove the now-unused `locateJsxElement` delegate**

In `src/agent/locate.ts`, delete the entire `locateJsxElement` function (the backward-compat delegate added in Task 1). `resolveJsxElement` is now the only export.

- [ ] **Step 7: Run the full suite + typecheck**

Run: `npx vitest run` then `npx tsc --noEmit`
Expected: all tests pass (including the two new inspect tests); no type errors (no remaining references to `locateJsxElement`).

- [ ] **Step 8: Commit**

```bash
git add src/agent/inspect.ts src/agent/apply.ts src/agent/server.ts src/agent/locate.ts tests/agent/inspect.test.ts
git commit -m "feat: agent resolves via tag and errors on no-match"
```

---

## Task 4: Overlay sends the element tag

**Files:**
- Modify: `src/overlay/fiber.ts`
- Modify: `src/overlay/panel.ts`

- [ ] **Step 1: Capture the producing fiber's type name in `fiber.ts`**

In `src/overlay/fiber.ts`, change the `SourceLoc` interface and `sourceLocFor` function to:

```ts
// src/overlay/fiber.ts
export interface SourceLoc { file: string; line: number; column: number; tag?: string; }

function fiberTypeName(fiber: any): string | undefined {
  const t = fiber.type;
  if (typeof t === "string") return t;                       // host element: "div"
  if (typeof t === "function") return t.displayName || t.name || undefined; // composite
  if (t && typeof t === "object") {
    return t.displayName || (t.render && (t.render.displayName || t.render.name)) || undefined; // memo/forwardRef
  }
  return undefined;
}

/** Walk up the React fiber from a DOM node to find _debugSource. */
export function sourceLocFor(node: Element): SourceLoc | undefined {
  const key = Object.keys(node).find((k) => k.startsWith("__reactFiber$"));
  if (!key) return undefined;
  let fiber: any = (node as any)[key];
  while (fiber) {
    const src = fiber._debugSource;
    if (src && src.fileName) {
      return { file: src.fileName, line: src.lineNumber, column: src.columnNumber, tag: fiberTypeName(fiber) };
    }
    fiber = fiber.return;
  }
  return undefined;
}
```

(Leave `componentNameFor` unchanged.)

- [ ] **Step 2: Thread `tag` through `panel.ts`**

In `src/overlay/panel.ts`:

(a) Change the `PanelTarget` interface:

```ts
export interface PanelTarget { file: string; line: number; column: number; tag?: string; }
```

(b) Change the `loc` declaration (currently `let loc: { line: number; column: number } | null = null;`):

```ts
  let loc: { line: number; column: number; tag?: string } | null = null;
```

(c) In `inspectInto`, change the `onInspect` call to include `tag`:

```ts
      const result = await handlers.onInspect({ file, line: loc.line, column: loc.column, tag: loc.tag });
```

(d) In the `$("apply").onclick` handler, change the `onApply` call to include `tag`:

```ts
      const res = await handlers.onApply({ file, line: loc.line, column: loc.column, tag: loc.tag, edits });
```

(e) In `setTarget`, where `loc` is assigned (currently `loc = { line: target.line, column: target.column };`):

```ts
      loc = { line: target.line, column: target.column, tag: target.tag };
```

(`src/overlay/index.ts` needs no change: `sourceLocFor` now returns `tag`, and that `SourceLoc` is passed straight into `setTarget` whose `PanelTarget` now carries `tag`.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Rebuild the overlay bundle**

Run: `npm run build:overlay`
Expected: `dist/overlay.js` rewritten (the agent serves this file).

- [ ] **Step 5: Commit**

```bash
git add src/overlay/fiber.ts src/overlay/panel.ts dist/overlay.js
git commit -m "feat: overlay sends clicked element tag to the agent"
```

---

## Task 5: Browser regression — verify the real click resolves correctly

This task exercises the end-to-end loop against a real antd + Vite app WITHOUT the
line-34 workaround used in the prior verification. It is a manual smoke run; capture
the output.

**Target app:** `D:\Projects\test\test-multi-window` (vite 5.4 + @vitejs/plugin-react, antd 5).

- [ ] **Step 1: Start the agent (this repo)**

Run (background): `npx tsx src/agent/server.ts`
Expected: `[ui-modifier] agent on http://localhost:4567`.

- [ ] **Step 2: Start the target app dev server**

Run (background, from the target app dir): `cd /d D:\Projects\test\test-multi-window && npm run dev`
Expected: `VITE ... Local: http://localhost:5173/`.

- [ ] **Step 3: Write the regression driver**

Create `D:\Projects\test\test-multi-window\verify-offset.mjs`:

```js
// Regression: the REAL FloatingBar <div> (true source line 15) must inspect line 15.
import { chromium } from 'playwright';
import fs from 'node:fs';

const PANEL = `
  const host = [...document.body.children].find(d => d.shadowRoot && d.shadowRoot.getElementById('apply'));
  const root = host && host.shadowRoot;
  const rows = () => [...root.getElementById('styles').querySelectorAll('.row')].map(r => {
    const [k, v] = r.querySelectorAll('input'); return { property: k.value, value: v.value };
  });
  const panel = () => ({ who: root.getElementById('who').textContent, file: root.getElementById('file').value,
    styleRows: rows(), out: root.getElementById('out').textContent });
`;
const read = (p) => p.evaluate(`(() => { ${PANEL}; return panel(); })()`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

const href = (await (await fetch('http://localhost:4567/')).text()).match(/href="(javascript:[^"]+)"/)[1];
await page.goto('http://localhost:5173/');
await page.waitForSelector('text=창', { timeout: 20000 });
await page.waitForTimeout(2500);
await page.evaluate((s) => { (0, eval)(s); }, href.replace(/^javascript:/, ''));
await page.waitForFunction(() => [...document.body.children].some((d) => d.shadowRoot && d.shadowRoot.getElementById('apply')));

// Click the real FloatingBar outer div (top:12px, has boxShadow). True source: FloatingBar.tsx line 15.
const box = await page.evaluate(() => {
  const el = [...document.querySelectorAll('div')].find((d) => d.style.position === 'fixed' && d.style.top === '12px' && d.style.boxShadow);
  const r = el.getBoundingClientRect();
  return { x: r.left + 6, y: r.top + r.height / 2 };
});
await page.mouse.click(box.x, box.y);
await page.waitForFunction(`(() => { ${PANEL}; return root.getElementById('styles').querySelectorAll('.row').length > 0 || root.getElementById('out').textContent; })()`, { timeout: 5000 });
const p = await read(page);
console.log('who:', p.who);                 // expect "div — FloatingBar.tsx:15"
console.log('styleRows:', JSON.stringify(p.styleRows));
console.log('PASS inspect-line-15:', /FloatingBar\.tsx:15$/.test(p.who) && p.styleRows.length > 0);

// Edit + HMR round-trip on the real element.
await page.evaluate(`(() => { ${PANEL};
  const rowEls = [...root.getElementById('styles').querySelectorAll('.row')];
  const idx = rows().findIndex(r => r.property === 'background');
  rowEls[idx].querySelectorAll('input')[1].value = '#ffe4c4';
})()`);
await page.evaluate(`(() => { ${PANEL}; root.getElementById('apply').click(); })()`);
await page.waitForFunction(`(() => { ${PANEL}; return root.getElementById('out').textContent.length > 0; })()`, { timeout: 8000 });
console.log('apply out:', (await read(page)).out);
await page.waitForFunction(() => {
  const el = [...document.querySelectorAll('div')].find((d) => d.style.position === 'fixed' && d.style.top === '12px');
  return el && getComputedStyle(el).backgroundColor === 'rgb(255, 228, 196)';
}, { timeout: 15000 }).then(() => console.log('PASS hmr-repaint: true')).catch(() => console.log('PASS hmr-repaint: false'));
console.log('disk has #ffe4c4:', fs.readFileSync('src/components/FloatingBar.tsx', 'utf8').includes('#ffe4c4'));

await browser.close();
console.log('DONE');
```

- [ ] **Step 4: Run the regression**

Run (from the target app dir): `node verify-offset.mjs`
Expected output includes:
- `who: div — FloatingBar.tsx:15` (NOT `:34`)
- `PASS inspect-line-15: true`
- `apply out: ✅ Applied. HMR will reload.`
- `PASS hmr-repaint: true`
- `disk has #ffe4c4: true`

If `who` still shows `:34` or `inspect-line-15` is false, the resolver wiring is wrong — stop and debug before proceeding.

- [ ] **Step 5: Restore the target app and clean up**

```bash
cd /d D:\Projects\test\test-multi-window
git checkout -- src/components/FloatingBar.tsx
del verify-offset.mjs
```

Stop the background agent and vite servers. Confirm ports 4567/5173 are free.

- [ ] **Step 6: Record the verification result in the spec**

Append a short "Verification (2026-06-11)" section to
`docs/superpowers/specs/2026-06-11-debugsource-offset-correction-design.md` noting:
the real FloatingBar div now inspects `FloatingBar.tsx:15` (was `:34`), the edit→HMR
loop works, and `npx vitest run` / `npx tsc --noEmit` are green.

- [ ] **Step 7: Commit**

```bash
cd /d D:\Projects\test\react-ui-source-editor
git add docs/superpowers/specs/2026-06-11-debugsource-offset-correction-design.md
git commit -m "docs: record _debugSource offset-correction verification"
```

---

## Self-Review Notes

- **Spec coverage:** resolver algorithm (Task 1), wire protocol/types (Task 2), agent routing + explicit error (Task 3), overlay tag capture (Task 4), browser regression without the line-34 workaround (Task 5). All spec sections mapped.
- **Type consistency:** `resolveJsxElement(sf, line, column, tag?)` used identically in Tasks 1/3; `tag?: string` on `InspectRequest`/`EditRequest` (Task 2) consumed in Task 3 and produced in Task 4; `SourceLoc.tag` → `PanelTarget.tag` → request `tag` chain is consistent.
- **Known limitation** (ambiguous identical column+tag) is pinned by a test in Task 1, not silently ignored.
```
