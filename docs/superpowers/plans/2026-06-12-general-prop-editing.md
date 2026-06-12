# General Prop Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface an element's editable props in the panel and let the user change existing literal props and add new ones (preserving each value's original string-vs-expression kind), reusing the agent's existing prop-apply path.

**Architecture:** `inspect` returns a `props[]` list; `editsDiff.buildEdits` turns changed/added prop rows into `{kind:"prop"}` edits; the panel renders a props section. The agent's `applyProp`/`classifyEdit` are unchanged.

**Tech Stack:** TypeScript, ts-morph (read), esbuild (overlay bundle), vitest.

**Spec:** `docs/superpowers/specs/2026-06-12-general-prop-editing-design.md`

**Conventions:** Run tests `npx vitest run`; typecheck `npx tsc --noEmit`; build overlay `npm run build:overlay`. Commit after each task. End commit messages with the `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` trailer.

---

## File Structure

- `src/shared/types.ts` — **modify**: `InspectPropEntry` + `InspectOk.props`.
- `src/agent/inspect.ts` — **modify**: `propEntries(opening)`.
- `src/overlay/editsDiff.ts` — **modify**: `parsePropValue`, optional `PanelState.props`/`addedProps`, `buildEdits` prop logic.
- `src/overlay/panel.ts` — **modify**: props section UI + `collectState`/`render`/`clearEditors`.
- `tests/agent/inspect.test.ts`, `tests/overlay/editsDiff.test.ts` — **modify**: tests.
- `dist/overlay.js` — **rebuild + commit** (Task 3).
- The agent apply path (`applyProp.ts`, `classify.ts`) is **unchanged**.

---

## Task 1: Read side — `InspectPropEntry` + `inspect` props

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/agent/inspect.ts`
- Test: `tests/agent/inspect.test.ts` (append)
- Modify: `tests/overlay/editsDiff.test.ts` (fixture only — add `props: []`)

- [ ] **Step 1: Add the type**

In `src/shared/types.ts`, add this interface just above `InspectOk`:

```ts
/** A non-style, non-className JSX attribute surfaced for editing. */
export interface InspectPropEntry {
  name: string;
  value: string;     // display string
  editable: boolean; // false for dynamic expressions (read-only)
  isExpr: boolean;   // true when the source value was `{…}` (number/boolean/dynamic)
}
```

and add a `props` field to `InspectOk` (after `style`):

```ts
  props: InspectPropEntry[];
```

- [ ] **Step 2: Keep the editsDiff fixture compiling**

`InspectOk` now requires `props`. In `tests/overlay/editsDiff.test.ts`, the
top-level `const snapshot: InspectOk = { status: "ok", line: 1, styleEditable: true, ... }`
fixture is missing it. Add `props: [],` to that fixture object (e.g. right after
its `style: [...]` entry). Make no other change to that file in this task.

- [ ] **Step 3: Write the failing inspect tests**

Append to `tests/agent/inspect.test.ts` (inside the existing top-level `describe`,
using the file's existing `sourceFileFrom`/`inspectJsxElement` helpers):

```ts
  it("surfaces editable props with original-kind, excluding special attrs", () => {
    const sf = sourceFileFrom(
      'const C = () => (<Button type="primary" size={2} danger disabled={false} ' +
      'onClick={fn} className="x" style={{ color: "red" }} title={dynamic}>hi</Button>);'
    );
    const res = inspectJsxElement(sf, 1, 17, "Button"); // "<Button" — column of "<"
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    const byName = Object.fromEntries(res.props.map((p) => [p.name, p]));
    // excluded entirely:
    expect(byName.className).toBeUndefined();
    expect(byName.style).toBeUndefined();
    expect(byName.onClick).toBeUndefined();
    // string literal -> editable, not expr:
    expect(byName.type).toEqual({ name: "type", value: "primary", editable: true, isExpr: false });
    // numeric literal expr -> editable expr:
    expect(byName.size).toEqual({ name: "size", value: "2", editable: true, isExpr: true });
    // boolean shorthand -> editable expr, value "true":
    expect(byName.danger).toEqual({ name: "danger", value: "true", editable: true, isExpr: true });
    // boolean literal expr:
    expect(byName.disabled).toEqual({ name: "disabled", value: "false", editable: true, isExpr: true });
    // dynamic expression -> read-only:
    expect(byName.title.editable).toBe(false);
    expect(byName.title.isExpr).toBe(true);
  });
```

(The `<Button` opening tag's `<` is at column 17 in that single-line source —
verify if the test fails on location; the resolver also accepts the tag name.)

- [ ] **Step 4: Run to verify failure**

Run: `npx vitest run tests/agent/inspect.test.ts`
Expected: FAIL — `res.props` is undefined (not yet populated).

- [ ] **Step 5: Implement `propEntries` in `inspect.ts`**

In `src/agent/inspect.ts`, add the import type and a helper, then include it in the
result. First add `InspectPropEntry` to the type import:

```ts
import type { InspectField, InspectPropEntry, InspectResult, InspectStyleEntry } from "../shared/types.js";
```

Add this helper (near the other field helpers):

```ts
const EXCLUDED_PROPS = new Set(["style", "className", "key", "ref", "css"]);

function propEntries(opening: any): InspectPropEntry[] {
  const out: InspectPropEntry[] = [];
  for (const a of opening.getAttributes()) {
    if (!Node.isJsxAttribute(a)) continue; // skip spreads {...x}
    const name = (a as any).getNameNode().getText();
    if (EXCLUDED_PROPS.has(name) || /^on[A-Z]/.test(name)) continue;
    const init = (a as any).getInitializer();
    if (!init) { out.push({ name, value: "true", editable: true, isExpr: true }); continue; } // boolean shorthand
    if (Node.isStringLiteral(init)) { out.push({ name, value: init.getLiteralText(), editable: true, isExpr: false }); continue; }
    if (Node.isJsxExpression(init)) {
      const expr = init.getExpression();
      if (expr && Node.isNumericLiteral(expr)) { out.push({ name, value: expr.getText(), editable: true, isExpr: true }); continue; }
      if (expr && (expr.getKind() === SyntaxKind.TrueKeyword || expr.getKind() === SyntaxKind.FalseKeyword)) {
        out.push({ name, value: expr.getText(), editable: true, isExpr: true }); continue;
      }
      out.push({ name, value: init.getText(), editable: false, isExpr: true }); continue; // dynamic → raw {…}, read-only
    }
    out.push({ name, value: init.getText?.() ?? "", editable: false, isExpr: true });
  }
  return out;
}
```

Then add `props` to the returned ok object in `inspectJsxElement` (after `style:`):

```ts
    props: propEntries(op),
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/agent/inspect.test.ts`
Expected: PASS. If the location/column is off, adjust the test's column to the
`<` of `<Button` (the resolver also matches by the `Button` tag).

- [ ] **Step 7: Full suite + typecheck**

Run: `npx vitest run` then `npx tsc --noEmit`
Expected: all pass; no type errors (the editsDiff fixture now has `props: []`).

- [ ] **Step 8: Commit**

```bash
git add src/shared/types.ts src/agent/inspect.ts tests/agent/inspect.test.ts tests/overlay/editsDiff.test.ts
git -c user.name=minwoo -c user.email=minwoo1989@gmail.com commit -m "feat: inspect surfaces editable props (kind-preserving)"
```

---

## Task 2: Diff — `parsePropValue` + `buildEdits` prop logic

**Files:**
- Modify: `src/overlay/editsDiff.ts`
- Test: `tests/overlay/editsDiff.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `tests/overlay/editsDiff.test.ts` (it already imports `buildEdits`,
`parseStyleValue`, and `InspectOk`; add `parsePropValue` to the import from
`../../src/overlay/editsDiff.js`). Use a snapshot with `props`:

```ts
describe("parsePropValue", () => {
  it("parses booleans, numbers, and strings", () => {
    expect(parsePropValue("true")).toBe(true);
    expect(parsePropValue("false")).toBe(false);
    expect(parsePropValue("42")).toBe(42);
    expect(parsePropValue("primary")).toBe("primary");
  });
});

describe("buildEdits — props", () => {
  const snap: InspectOk = {
    status: "ok", line: 1, styleEditable: true, style: [],
    props: [
      { name: "type", value: "default", editable: true, isExpr: false },
      { name: "size", value: "2", editable: true, isExpr: true },
      { name: "title", value: "{x}", editable: false, isExpr: true },
    ],
  };
  const base = { style: [], added: [], className: null, text: null };

  it("emits a string prop verbatim (kind preserved) when changed", () => {
    const edits = buildEdits(snap, { ...base,
      props: [{ name: "type", value: "primary", editable: true, isExpr: false }], addedProps: [] });
    expect(edits).toContainEqual({ kind: "prop", name: "type", value: "primary" });
  });

  it("parses an isExpr prop to a number when changed", () => {
    const edits = buildEdits(snap, { ...base,
      props: [{ name: "size", value: "4", editable: true, isExpr: true }], addedProps: [] });
    expect(edits).toContainEqual({ kind: "prop", name: "size", value: 4 });
  });

  it("does not emit for an unchanged or read-only prop", () => {
    const edits = buildEdits(snap, { ...base, props: [
      { name: "type", value: "default", editable: true, isExpr: false }, // unchanged
      { name: "title", value: "{y}", editable: false, isExpr: true },    // read-only
    ], addedProps: [] });
    expect(edits.filter((e) => e.kind === "prop")).toHaveLength(0);
  });

  it("emits an added prop, parsed", () => {
    const edits = buildEdits(snap, { ...base, props: [],
      addedProps: [{ name: "danger", value: "true" }] });
    expect(edits).toContainEqual({ kind: "prop", name: "danger", value: true });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/overlay/editsDiff.test.ts`
Expected: FAIL — `parsePropValue` not exported / `PanelState` has no `props`.

- [ ] **Step 3: Implement in `editsDiff.ts`**

In `src/overlay/editsDiff.ts`:

(a) Add a `PropRowState` interface (after `StyleRowState`):

```ts
export interface PropRowState {
  name: string;
  value: string;
  editable: boolean;
  isExpr: boolean;
}
```

(b) Add optional fields to `PanelState` (the panel always provides them; optional
keeps the type backward-compatible for existing tests):

```ts
  props?: PropRowState[];
  addedProps?: { name: string; value: string }[];
```

(c) Add `parsePropValue`:

```ts
/** Like parseStyleValue but also recognizes booleans (for `{true}`/`{false}` props). */
export function parsePropValue(raw: string): string | number | boolean {
  const t = raw.trim();
  if (t === "true") return true;
  if (t === "false") return false;
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : t;
}
```

(d) In `buildEdits`, after the `className` block and before the `text` block (or
after `text` — order is not significant for props), add:

```ts
  for (const row of state.props ?? []) {
    if (!row.editable) continue;
    const orig = snapshot.props.find((p) => p.name === row.name);
    if (orig && row.value !== orig.value) {
      edits.push({ kind: "prop", name: row.name, value: row.isExpr ? parsePropValue(row.value) : row.value });
    }
  }
  for (const a of state.addedProps ?? []) {
    if (a.name.trim() === "" || a.value.trim() === "") continue;
    edits.push({ kind: "prop", name: a.name.trim(), value: parsePropValue(a.value) });
  }
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/overlay/editsDiff.test.ts`
Expected: PASS (new prop tests + existing tests).

- [ ] **Step 5: Full suite + typecheck**

Run: `npx vitest run` then `npx tsc --noEmit`
Expected: all pass; no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/overlay/editsDiff.ts tests/overlay/editsDiff.test.ts
git -c user.name=minwoo -c user.email=minwoo1989@gmail.com commit -m "feat: buildEdits emits prop edits (kind-preserving) + parsePropValue"
```

---

## Task 3: Panel — props section UI + rebuild

**Files:**
- Modify: `src/overlay/panel.ts`
- Rebuild: `dist/overlay.js`

(No unit test — DOM/UI; verified by Task 4 browser smoke + tsc.)

- [ ] **Step 1: Imports + markup**

In `src/overlay/panel.ts`:

(a) Add `PropRowState` to the editsDiff import (currently
`import { buildEdits, type PanelState, type StyleRowState } from "./editsDiff.js";`):

```ts
import { buildEdits, type PanelState, type PropRowState, type StyleRowState } from "./editsDiff.js";
```

(b) In the markup, between the style add-row and the `<label>className</label>`
line (i.e. after `<div class="row"><input class="k" id="newk" ...><input class="v" id="newv" ...></div>`),
insert a props section:

```
      <label>props</label>
      <div id="props"></div>
      <div class="row"><input class="k" id="newpk" placeholder="prop"><input class="v" id="newpv" placeholder="value"></div>
```

- [ ] **Step 2: propsBox handle + propRow helper**

After `const stylesBox = $("styles");`, add:

```ts
  const propsBox = $("props");
```

Add a `propRow` helper next to `styleRow` (no remove button; carries `isExpr` via
a data attribute so `collectState` can read it back):

```ts
  function propRow(name: string, value: string, editable: boolean, isExpr: boolean): HTMLDivElement {
    const row = document.createElement("div");
    row.className = "row";
    row.dataset.expr = isExpr ? "1" : "";
    row.innerHTML = `<input class="k" disabled><input class="v">`;
    const [k, v] = Array.from(row.querySelectorAll("input")) as HTMLInputElement[];
    k.value = name;
    v.value = value;
    if (!editable) v.disabled = true;
    return row;
  }
```

- [ ] **Step 3: clearEditors, render, collectState**

(a) In `clearEditors`, add prop clearing:

```ts
  function clearEditors() {
    stylesBox.innerHTML = "";
    $<HTMLInputElement>("newk").value = "";
    $<HTMLInputElement>("newv").value = "";
    propsBox.innerHTML = "";
    $<HTMLInputElement>("newpk").value = "";
    $<HTMLInputElement>("newpv").value = "";
  }
```

(b) In `render`, after the style-rows loop (before the `cls` block), add:

```ts
    for (const p of res.props) {
      propsBox.appendChild(propRow(p.name, p.value, p.editable, p.isExpr));
    }
```

(c) In `collectState`, gather prop rows + the add-prop inputs, and include them in
the returned object. Add before the `return`:

```ts
    const props: PropRowState[] = [];
    propsBox.querySelectorAll(".row").forEach((row) => {
      const [k, v] = Array.from(row.querySelectorAll("input")) as HTMLInputElement[];
      props.push({
        name: k.value,
        value: v.value,
        editable: !v.disabled,
        isExpr: (row as HTMLElement).dataset.expr === "1",
      });
    });
```

and add these two fields to the returned `PanelState` object:

```ts
      props,
      addedProps: [{ name: $<HTMLInputElement>("newpk").value, value: $<HTMLInputElement>("newpv").value }],
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Rebuild the overlay bundle**

Run: `npm run build:overlay`
Expected: `dist/overlay.js` rewritten.

- [ ] **Step 6: Full suite + typecheck**

Run: `npx vitest run` then `npx tsc --noEmit`
Expected: all pass; no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/overlay/panel.ts dist/overlay.js
git -c user.name=minwoo -c user.email=minwoo1989@gmail.com commit -m "feat: props section in the overlay panel"
```

---

## Task 4: Browser smoke — edit + add a prop

- [ ] **Step 1: Start the agent**

Run (background, repo root): `npx tsx src/agent/server.ts`
Expected: `[ui-modifier] agent on http://localhost:4567`. (If `EADDRINUSE`, kill
the stale listener on 4567 first.)

- [ ] **Step 2: Start the target app dev server**

Run (background, from `D:\Projects\test\test-multi-window`): `npm run dev`
Expected: `VITE ... Local: http://localhost:5173/`.

- [ ] **Step 3: Write the smoke driver**

Create `D:\Projects\test\test-multi-window\verify-prop.mjs`:

```js
// Edit an existing prop on a Button and add a new one; check disk reflects both.
import { chromium } from 'playwright';
import fs from 'node:fs';

const FB = 'src/components/FloatingBar.tsx';
const PANEL = `
  const host = [...document.body.children].find(d => d.shadowRoot && d.shadowRoot.getElementById('apply'));
  const root = host && host.shadowRoot;
  const propRows = () => [...root.getElementById('props').querySelectorAll('.row')].map(r => {
    const [k, v] = r.querySelectorAll('input'); return { name: k.value, value: v.value, disabled: v.disabled };
  });
`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const href = (await (await fetch('http://localhost:4567/')).text()).match(/href="(javascript:[^"]+)"/)[1];
await page.goto('http://localhost:5173/');
await page.waitForSelector('text=창', { timeout: 20000 });
await page.waitForTimeout(2500);
await page.evaluate((s) => { (0, eval)(s); }, href.replace(/^javascript:/, ''));
await page.waitForFunction(() => [...document.body.children].some((d) => d.shadowRoot && d.shadowRoot.getElementById('apply')));

// Click one of the +/- Buttons in the FloatingBar (they carry size="small").
const btn = await page.evaluate(() => {
  const bar = [...document.querySelectorAll('div')].find((d) => d.style.position === 'fixed' && d.style.top === '12px' && d.style.boxShadow);
  const b = bar && bar.querySelector('button');
  if (!b) return null;
  const r = b.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
if (!btn) { console.log('FAIL: no button in FloatingBar'); await browser.close(); process.exit(0); }
await page.mouse.click(btn.x, btn.y);
await page.waitForFunction(`(() => { ${PANEL}; return propRows().length > 0 || root.getElementById('out').textContent; })()`, { timeout: 5000 });
console.log('prop rows:', JSON.stringify(await page.evaluate(`(() => { ${PANEL}; return propRows(); })()`)));

// Edit the existing `size` prop value to "large" and add a new prop `data-test="x"`.
await page.evaluate(`(() => { ${PANEL};
  const rowEls = [...root.getElementById('props').querySelectorAll('.row')];
  const idx = propRows().findIndex(r => r.name === 'size');
  if (idx >= 0) rowEls[idx].querySelectorAll('input')[1].value = 'large';
  root.getElementById('newpk').value = 'data-test';
  root.getElementById('newpv').value = 'x';
  root.getElementById('apply').click();
})()`);
await page.waitForFunction(`(() => { ${PANEL}; return root.getElementById('out').textContent.includes('Applied') || root.getElementById('out').textContent.includes('❌') || root.getElementById('out').textContent.includes('Suggested'); })()`, { timeout: 8000 });
await page.waitForTimeout(800);
const disk = fs.readFileSync(FB, 'utf8');
console.log('disk has size="large":', disk.includes('size="large"'));
console.log('disk has data-test="x":', disk.includes('data-test="x"'));
await browser.close();
console.log('DONE');
```

- [ ] **Step 4: Run the smoke**

Run (from `D:\Projects\test\test-multi-window`): `node verify-prop.mjs`
Expected:
- `prop rows:` lists the Button's props (e.g. `size`), value editable.
- `disk has size="large": true`
- `disk has data-test="x": true`

If the FloatingBar buttons turn out to carry `size` as `{...}` expr rather than a
string, adjust expectations (the edit still round-trips per its `isExpr`); the
key assertions are that an existing prop changed and a new prop was added on disk.
If neither disk assertion holds, stop and debug.

- [ ] **Step 5: Restore the target app + clean up**

```bash
cd /d D:\Projects\test\test-multi-window
git checkout -- src/components/FloatingBar.tsx
del verify-prop.mjs
```

Stop the background agent and vite servers; confirm ports 4567 / 5173 are free.

- [ ] **Step 6: Record verification in the spec**

Append a short "Verification (2026-06-12)" section to
`docs/superpowers/specs/2026-06-12-general-prop-editing-design.md`: note unit
tests (inspect surfacing + buildEdits/parsePropValue) pass and the browser smoke
changed an existing prop and added a new one, both reflected on disk after Apply;
`npx vitest run` / `npx tsc --noEmit` green.

- [ ] **Step 7: Commit**

```bash
cd /d D:\Projects\test\react-ui-source-editor
git add docs/superpowers/specs/2026-06-12-general-prop-editing-design.md
git -c user.name=minwoo -c user.email=minwoo1989@gmail.com commit -m "docs: record general prop editing verification"
```

---

## Self-Review Notes

- **Spec coverage:** `InspectPropEntry` + `inspect` props with exclusions/kind
  (Task 1); `parsePropValue` + `buildEdits` prop logic with kind preservation
  (Task 2); panel props section incl. add-row + `collectState` (Task 3); on-disk
  edit+add proof (Task 4). Agent apply path intentionally untouched (spec §Agent).
- **Type consistency:** `InspectPropEntry{name,value,editable,isExpr}` is produced
  by `inspect`, mirrored by `PropRowState` in the panel/diff, and consumed by
  `buildEdits` (`row.isExpr ? parsePropValue : verbatim`); `PanelState.props`/
  `addedProps` are optional and defaulted with `?? []` in `buildEdits`.
- **No placeholders:** every code step is complete. The Task-4 driver note flags
  one unused line to delete before running so the script is clean.
