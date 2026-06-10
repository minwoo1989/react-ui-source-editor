# Style/Class Editing + Absolute-Path Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the ENOENT path bug by switching to an absolute-path contract end-to-end, and let the panel read & edit the selected component's source `style` object, `className`, and text via a new `POST /inspect` endpoint, with a `GET /fs` agent-backed file browser.

**Architecture:** The agent gains two routes — `POST /inspect` (parse the JSX element with ts-morph, return source-truth style/className/text) and `GET /fs` (read-only directory listing for the Browse button). `POST /edit` now takes the absolute `_debugSource` path verbatim (extension allowlist + existence check replace the old `PROJECT_ROOT` confinement). The overlay panel becomes dynamic: style rows with add/edit/remove, className and text inputs, a file-path input with Browse. A pure `buildEdits` diff function turns panel state into the minimal `Edit[]`.

**Tech Stack:** TypeScript (ESM, `type: module`), ts-morph, node:http, esbuild (overlay IIFE bundle), vitest (node env, pure functions only — server routes are manually smoke-tested per project convention).

**Spec:** `docs/superpowers/specs/2026-06-10-style-class-editing-and-abs-path-design.md`

**Conventions to follow:**
- Tests live in `tests/agent/*.test.ts` (and new `tests/overlay/`), import from `../../src/...` with `.js` extension.
- In test fixtures like `` `const C=()=>(<Button>x</Button>);` `` the JSX `<` is at **column 14** (1-based) — every existing test uses `(1, 14)`.
- Run a single test file: `npx vitest run tests/agent/<file>.test.ts`. All tests: `npm test`. Typecheck: `npx tsc --noEmit`.
- Commit after each task.

**File map:**

| File | Action | Responsibility |
|---|---|---|
| `src/shared/types.ts` | modify | add `styleRemove` Edit kind, `InspectRequest/Result`, `FsListing` |
| `src/agent/paths.ts` | create | extension allowlist check (pure) |
| `src/agent/applyStyle.ts` | modify | add `removeStyle` |
| `src/agent/classify.ts` | modify | classify `styleRemove` |
| `src/agent/apply.ts` | modify | dispatch/describe `styleRemove` |
| `src/agent/inspect.ts` | create | source-truth read of style/className/text (pure) |
| `src/agent/fsList.ts` | create | directory listing + Windows drive list |
| `src/agent/bookmarklet.ts` | modify | `landingHtml(port)` — drop projectRoot |
| `src/agent/server.ts` | modify | absolute-path contract, `/inspect`, `/fs`, backups beside agent repo |
| `src/overlay/api.ts` | modify | drop `relativeToSrc`, add `sendInspect`, `fetchFsListing` |
| `src/overlay/editsDiff.ts` | create | pure panel-state → `Edit[]` diff |
| `src/overlay/panel.ts` | modify | dynamic rows, path input, browse UI |
| `src/overlay/index.ts` | modify | pass absolute loc straight to panel |

---

### Task 1: Shared types — `styleRemove`, inspect, fs listing

**Files:**
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Replace the file content**

```ts
// src/shared/types.ts

/** A single requested change to a JSX element. */
export type Edit =
  | { kind: "style"; property: string; value: string | number }
  | { kind: "styleRemove"; property: string }
  | { kind: "prop"; name: string; value: string | number | boolean }
  | { kind: "text"; value: string };

/** Sent from overlay to agent. line/column are 1-based, from fiber._debugSource. */
export interface EditRequest {
  /** Absolute path, taken verbatim from _debugSource.fileName. */
  file: string;
  line: number;
  column: number;
  edits: Edit[];
}

/** Returned by the agent for each request. */
export type EditResult =
  | { status: "applied"; file: string; newText: string; diff: string }
  | { status: "suggested"; reason: string; instruction: string; diff: string }
  | { status: "error"; message: string };

/** Sent from overlay to agent to read source truth for the selected element. */
export interface InspectRequest {
  /** Absolute path, same contract as EditRequest.file. */
  file: string;
  line: number;
  column: number;
}

/** One entry of the style object literal. Non-literal values carry raw source text and editable: false. */
export interface InspectStyleEntry {
  property: string;
  value: string;
  editable: boolean;
}

/** className or text value. Raw source text when not editable. */
export interface InspectField {
  value: string;
  editable: boolean;
}

export interface InspectOk {
  status: "ok";
  /** false when a style attribute exists but is not an object literal (e.g. style={styles}). */
  styleEditable: boolean;
  style: InspectStyleEntry[];
  /** absent when the element has no className attribute */
  className?: InspectField;
  /** absent unless the element has a single literal text child */
  text?: InspectField;
}

export type InspectResult = InspectOk | { status: "error"; message: string };

/** GET /fs response. */
export interface FsEntry {
  name: string;
  /** Absolute path of the entry — the panel never joins paths itself. */
  path: string;
  dir: boolean;
}

export interface FsListing {
  path: string;
  /** Parent directory; "" when at a filesystem root (panel then requests the drive list). */
  parent: string;
  entries: FsEntry[];
}
```

- [ ] **Step 2: Typecheck (expect ONE known failure)**

Run: `npx tsc --noEmit`
Expected: errors only in `src/agent/apply.ts` (the `applyOne`/`describe` if/else chains don't handle `styleRemove` yet — `applyText(el, edit.value)` no longer narrows). If other files error, fix before continuing. To keep the tree compiling for this commit, patch `src/agent/apply.ts` minimally:

In `applyOne`, replace the body with:

```ts
function applyOne(el: Node, edit: Edit): void {
  if (edit.kind === "style") applyStyle(el, edit.property, edit.value);
  else if (edit.kind === "styleRemove") throw new Error("styleRemove not implemented yet");
  else if (edit.kind === "prop") applyProp(el, edit.name, edit.value);
  else applyText(el, edit.value);
}
```

In `describe`, replace the body with:

```ts
function describe(edit: Edit): string {
  if (edit.kind === "style") return `set style.${edit.property} = ${JSON.stringify(edit.value)}`;
  if (edit.kind === "styleRemove") return `remove style.${edit.property}`;
  if (edit.kind === "prop") return `set prop ${edit.name} = ${JSON.stringify(edit.value)}`;
  return `set text = ${JSON.stringify(edit.value)}`;
}
```

(The throw is replaced with the real call in Task 4; `classifyEdit` in Task 3 must also handle the kind — until then `classify.ts` compiles because it falls through to the text branch, which is acceptable for this intermediate commit.)

- [ ] **Step 3: Typecheck and full test run**

Run: `npx tsc --noEmit && npm test`
Expected: clean typecheck, all existing tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/shared/types.ts src/agent/apply.ts
git commit -m "feat: add styleRemove edit kind and inspect/fs contracts to shared types"
```

---

### Task 2: `paths.ts` — extension allowlist

**Files:**
- Create: `src/agent/paths.ts`
- Test: `tests/agent/paths.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/agent/paths.test.ts
import { describe, it, expect } from "vitest";
import { isEditableSourcePath } from "../../src/agent/paths.js";

describe("isEditableSourcePath", () => {
  it("accepts .tsx/.jsx/.ts/.js, case-insensitively", () => {
    expect(isEditableSourcePath("D:\\app\\src\\App.tsx")).toBe(true);
    expect(isEditableSourcePath("/home/u/app/src/App.jsx")).toBe(true);
    expect(isEditableSourcePath("C:/x/y.ts")).toBe(true);
    expect(isEditableSourcePath("C:/x/y.js")).toBe(true);
    expect(isEditableSourcePath("C:/x/Y.TSX")).toBe(true);
  });

  it("rejects everything else", () => {
    expect(isEditableSourcePath("C:\\Windows\\System32\\drivers\\etc\\hosts")).toBe(false);
    expect(isEditableSourcePath("D:/app/.env")).toBe(false);
    expect(isEditableSourcePath("D:/app/package.json")).toBe(false);
    expect(isEditableSourcePath("")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/agent/paths.test.ts`
Expected: FAIL — cannot resolve `../../src/agent/paths.js`.

- [ ] **Step 3: Write the implementation**

```ts
// src/agent/paths.ts

const EDITABLE_EXTENSIONS = [".tsx", ".jsx", ".ts", ".js"];

/**
 * Minimal write-guard for the CORS-open localhost agent: the absolute path
 * from the overlay may target any file the OS user can write, so only allow
 * JSX-bearing source extensions.
 */
export function isEditableSourcePath(file: string): boolean {
  const lower = file.toLowerCase();
  return EDITABLE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/agent/paths.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/agent/paths.ts tests/agent/paths.test.ts
git commit -m "feat: extension allowlist guard for editable source paths"
```

---

### Task 3: `removeStyle` + classify `styleRemove`

**Files:**
- Modify: `src/agent/applyStyle.ts`
- Modify: `src/agent/classify.ts` (insert before the existing `if (edit.kind === "style")` branch)
- Test: `tests/agent/applyStyle.test.ts`, `tests/agent/classify.test.ts`, `tests/agent/applyProp.test.ts`

- [ ] **Step 1: Write the failing tests for removeStyle**

Append to `tests/agent/applyStyle.test.ts` (the file already has the `elementAt` helper at the top — reuse it; add `removeStyle` to the existing import from `applyStyle.js`):

```ts
describe("removeStyle", () => {
  it("removes a property from the style object", () => {
    const { sf, el } = elementAt(`const C=()=>(<Button style={{ color: "red", marginTop: 8 }}>x</Button>);`, 1, 14);
    removeStyle(el, "marginTop");
    expect(sf.getFullText()).toContain(`color: "red"`);
    expect(sf.getFullText()).not.toContain("marginTop");
  });

  it("removes the style attribute when the last property is removed", () => {
    const { sf, el } = elementAt(`const C=()=>(<Button style={{ color: "red" }}>x</Button>);`, 1, 14);
    removeStyle(el, "color");
    expect(sf.getFullText()).not.toContain("style=");
  });

  it("is a no-op when the property is absent", () => {
    const { sf, el } = elementAt(`const C=()=>(<Button style={{ color: "red" }}>x</Button>);`, 1, 14);
    removeStyle(el, "marginTop");
    expect(sf.getFullText()).toContain(`style={{ color: "red" }}`);
  });

  it("is a no-op when there is no style attribute", () => {
    const { sf, el } = elementAt(`const C=()=>(<Button>x</Button>);`, 1, 14);
    removeStyle(el, "color");
    expect(sf.getFullText()).toBe(`const C=()=>(<Button>x</Button>);`);
  });

  it("throws when style is not an object literal", () => {
    const { el } = elementAt(`const C=()=>(<Button style={styles}>x</Button>);`, 1, 14);
    expect(() => removeStyle(el, "color")).toThrow("style is not an object literal");
  });
});
```

- [ ] **Step 2: Write the failing tests for classify**

Append to `tests/agent/classify.test.ts` (reuse that file's existing element-construction helper — open it first and match its helper name and call style; existing tests construct elements from fixture strings the same way as `applyStyle.test.ts`):

```ts
describe("classifyEdit: styleRemove", () => {
  it("is safe when style is an object literal", () => {
    const { el } = elementAt(`const C=()=>(<Button style={{ color: "red" }}>x</Button>);`, 1, 14);
    expect(classifyEdit(el, { kind: "styleRemove", property: "color" }).safe).toBe(true);
  });

  it("is safe (no-op) when there is no style attribute", () => {
    const { el } = elementAt(`const C=()=>(<Button>x</Button>);`, 1, 14);
    expect(classifyEdit(el, { kind: "styleRemove", property: "color" }).safe).toBe(true);
  });

  it("is unsafe when style is a dynamic expression", () => {
    const { el } = elementAt(`const C=()=>(<Button style={styles}>x</Button>);`, 1, 14);
    expect(classifyEdit(el, { kind: "styleRemove", property: "color" }).safe).toBe(false);
  });
});
```

- [ ] **Step 3: Pin down className behavior of applyProp (spec requirement)**

The panel writes className through the existing `applyProp`. Its code already creates a missing attribute and replaces a string literal, but the spec requires these cases verified by test. Append to `tests/agent/applyProp.test.ts` (reuse the file's existing element-construction helper — open it first and match its name; the fixtures below assume `elementAt` as in `applyStyle.test.ts`):

```ts
describe("applyProp: className", () => {
  it("adds className when the attribute is missing", () => {
    const { sf, el } = elementAt(`const C=()=>(<Button>x</Button>);`, 1, 14);
    applyProp(el, "className", "my-btn");
    expect(sf.getFullText()).toContain(`className="my-btn"`);
  });

  it("replaces an existing string-literal className", () => {
    const { sf, el } = elementAt(`const C=()=>(<Button className="old">x</Button>);`, 1, 14);
    applyProp(el, "className", "new-cls");
    expect(sf.getFullText()).toContain(`className="new-cls"`);
    expect(sf.getFullText()).not.toContain(`"old"`);
  });
});
```

These should pass against the current implementation — if either fails, fix `applyProp` (not the test).

- [ ] **Step 4: Run tests — removeStyle/classify fail, applyProp passes**

Run: `npx vitest run tests/agent/applyStyle.test.ts tests/agent/classify.test.ts tests/agent/applyProp.test.ts`
Expected: applyStyle FAIL — `removeStyle` is not exported; classify styleRemove FAIL — falls into the text branch and returns wrong results; applyProp className tests PASS.

- [ ] **Step 5: Implement removeStyle**

Append to `src/agent/applyStyle.ts`:

```ts
/** Remove a property from the style object literal; drop the attribute when it empties. */
export function removeStyle(el: Node, property: string): void {
  const opening = getOpening(el);
  const styleAttr = opening
    .getAttributes()
    .find((a: Node) => Node.isJsxAttribute(a) && a.getNameNode().getText() === "style");
  if (!styleAttr) return;

  const init = styleAttr.getInitializer();
  const obj = Node.isJsxExpression(init) ? init.getExpression() : undefined;
  if (!obj || !Node.isObjectLiteralExpression(obj)) {
    throw new Error("style is not an object literal");
  }

  const existing = obj.getProperty(property);
  if (!existing) return;
  existing.remove();
  if (obj.getProperties().length === 0) styleAttr.remove();
}
```

- [ ] **Step 6: Implement classify branch**

In `src/agent/classify.ts`, insert immediately before the `if (edit.kind === "style")` block:

```ts
  if (edit.kind === "styleRemove") {
    const attr = getAttribute(el, "style");
    if (!attr) return { safe: true, reason: "no style attr; remove is a no-op" };
    const init = (attr as any).getInitializer();
    const expr = Node.isJsxExpression(init) ? init.getExpression() : undefined;
    if (expr && Node.isObjectLiteralExpression(expr)) {
      return { safe: true, reason: "style is an object literal; can remove key" };
    }
    return { safe: false, reason: "style is a dynamic expression" };
  }
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run tests/agent/applyStyle.test.ts tests/agent/classify.test.ts tests/agent/applyProp.test.ts`
Expected: PASS, including all pre-existing tests.

- [ ] **Step 8: Commit**

```bash
git add src/agent/applyStyle.ts src/agent/classify.ts tests/agent/applyStyle.test.ts tests/agent/classify.test.ts tests/agent/applyProp.test.ts
git commit -m "feat: removeStyle transform, styleRemove classification, className prop coverage"
```

---

### Task 4: Wire `styleRemove` into `processEdits` + absolute-path file names

**Files:**
- Modify: `src/agent/apply.ts`
- Test: `tests/agent/apply.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/agent/apply.test.ts` (match the file's existing setup — it builds a `Project` with `useInMemoryFileSystem: true`, creates a source file, and calls `processEdits`; open it first and reuse its helper if one exists):

```ts
describe("processEdits: styleRemove", () => {
  it("removes a style property end-to-end", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile("F.tsx", `const C=()=>(<Button style={{ color: "red", marginTop: 8 }}>x</Button>);`);
    const res = processEdits(project, {
      file: "F.tsx", line: 1, column: 14,
      edits: [{ kind: "styleRemove", property: "marginTop" }],
    });
    expect(res.status).toBe("applied");
    if (res.status !== "applied") return;
    expect(res.newText).not.toContain("marginTop");
    expect(res.newText).toContain(`color: "red"`);
  });
});

describe("processEdits: absolute file paths", () => {
  it("works when the in-memory file is registered under a windows-style absolute path", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const file = "D:/app/src/App.tsx"; // server normalizes backslashes to forward slashes
    project.createSourceFile(file, `const C=()=>(<Button>x</Button>);`);
    const res = processEdits(project, {
      file, line: 1, column: 14,
      edits: [{ kind: "style", property: "color", value: "red" }],
    });
    expect(res.status).toBe("applied");
  });
});
```

- [ ] **Step 2: Run tests to verify the styleRemove one fails**

Run: `npx vitest run tests/agent/apply.test.ts`
Expected: styleRemove test FAILS with "styleRemove not implemented yet" (the Task 1 stub throws → caught → `status: "error"`). The absolute-path test should already PASS (ts-morph standardizes `D:/...` paths); if it fails instead, the server-side fallback is to register the in-memory file under a fixed name like `/edit.tsx` and pass that to `processEdits` — note it and adapt Task 8 accordingly.

- [ ] **Step 3: Replace the stub with the real call**

In `src/agent/apply.ts`: add `removeStyle` to the import from `./applyStyle.js`, then in `applyOne` replace

```ts
  else if (edit.kind === "styleRemove") throw new Error("styleRemove not implemented yet");
```

with

```ts
  else if (edit.kind === "styleRemove") removeStyle(el, edit.property);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/agent/apply.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent/apply.ts tests/agent/apply.test.ts
git commit -m "feat: processEdits handles styleRemove and absolute file paths"
```

---

### Task 5: `inspect.ts` — source-truth read

**Files:**
- Create: `src/agent/inspect.ts`
- Test: `tests/agent/inspect.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/agent/inspect.test.ts
import { describe, it, expect } from "vitest";
import { Project } from "ts-morph";
import { inspectJsxElement } from "../../src/agent/inspect.js";

function sfOf(text: string) {
  return new Project({ useInMemoryFileSystem: true }).createSourceFile("F.tsx", text);
}

describe("inspectJsxElement", () => {
  it("returns literal style entries as editable", () => {
    const sf = sfOf(`const C=()=>(<Button style={{ color: "red", marginTop: 8 }}>x</Button>);`);
    const res = inspectJsxElement(sf, 1, 14);
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.styleEditable).toBe(true);
    expect(res.style).toEqual([
      { property: "color", value: "red", editable: true },
      { property: "marginTop", value: "8", editable: true },
    ]);
  });

  it("marks non-literal style values read-only with raw source text", () => {
    const sf = sfOf(`const C=()=>(<Button style={{ color: theme.primary }}>x</Button>);`);
    const res = inspectJsxElement(sf, 1, 14);
    if (res.status !== "ok") throw new Error("expected ok");
    expect(res.style).toEqual([{ property: "color", value: "theme.primary", editable: false }]);
  });

  it("flags a non-object-literal style attribute as not editable", () => {
    const sf = sfOf(`const C=()=>(<Button style={styles}>x</Button>);`);
    const res = inspectJsxElement(sf, 1, 14);
    if (res.status !== "ok") throw new Error("expected ok");
    expect(res.styleEditable).toBe(false);
    expect(res.style).toEqual([]);
  });

  it("returns empty editable style when there is no style attribute", () => {
    const sf = sfOf(`const C=()=>(<Button>x</Button>);`);
    const res = inspectJsxElement(sf, 1, 14);
    if (res.status !== "ok") throw new Error("expected ok");
    expect(res.styleEditable).toBe(true);
    expect(res.style).toEqual([]);
  });

  it("returns editable className for a string literal", () => {
    const sf = sfOf(`const C=()=>(<Button className="a b">x</Button>);`);
    const res = inspectJsxElement(sf, 1, 14);
    if (res.status !== "ok") throw new Error("expected ok");
    expect(res.className).toEqual({ value: "a b", editable: true });
  });

  it("returns read-only className for an expression", () => {
    const sf = sfOf(`const C=()=>(<Button className={cls}>x</Button>);`);
    const res = inspectJsxElement(sf, 1, 14);
    if (res.status !== "ok") throw new Error("expected ok");
    expect(res.className?.editable).toBe(false);
  });

  it("omits className when the attribute is absent", () => {
    const sf = sfOf(`const C=()=>(<Button>x</Button>);`);
    const res = inspectJsxElement(sf, 1, 14);
    if (res.status !== "ok") throw new Error("expected ok");
    expect(res.className).toBeUndefined();
  });

  it("returns editable text for a single literal text child", () => {
    const sf = sfOf(`const C=()=>(<Button>hello</Button>);`);
    const res = inspectJsxElement(sf, 1, 14);
    if (res.status !== "ok") throw new Error("expected ok");
    expect(res.text).toEqual({ value: "hello", editable: true });
  });

  it("omits text when children include elements", () => {
    const sf = sfOf(`const C=()=>(<Button><i>x</i></Button>);`);
    const res = inspectJsxElement(sf, 1, 14);
    if (res.status !== "ok") throw new Error("expected ok");
    expect(res.text).toBeUndefined();
  });

  it("omits text for self-closing elements", () => {
    const sf = sfOf(`const C=()=>(<Input />);`);
    const res = inspectJsxElement(sf, 1, 14);
    if (res.status !== "ok") throw new Error("expected ok");
    expect(res.text).toBeUndefined();
  });

  it("errors when no JSX element exists at the position", () => {
    const sf = sfOf(`const x = 1;`);
    const res = inspectJsxElement(sf, 1, 1);
    expect(res).toEqual({ status: "error", message: "no JSX element at position" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/agent/inspect.test.ts`
Expected: FAIL — cannot resolve `../../src/agent/inspect.js`.

- [ ] **Step 3: Write the implementation**

```ts
// src/agent/inspect.ts
import { Node, SourceFile, SyntaxKind } from "ts-morph";
import { locateJsxElement } from "./locate.js";
import type { InspectField, InspectResult, InspectStyleEntry } from "../shared/types.js";

function getOpening(el: Node): any {
  return el.getKind() === SyntaxKind.JsxElement ? (el as any).getOpeningElement() : el;
}

function getAttribute(opening: any, name: string): Node | undefined {
  return opening
    .getAttributes()
    .find((a: Node) => Node.isJsxAttribute(a) && a.getNameNode().getText() === name);
}

function styleEntries(opening: any): { entries: InspectStyleEntry[]; editable: boolean } {
  const attr = getAttribute(opening, "style");
  if (!attr) return { entries: [], editable: true };

  const init = (attr as any).getInitializer();
  const obj = Node.isJsxExpression(init) ? init.getExpression() : undefined;
  if (!obj || !Node.isObjectLiteralExpression(obj)) return { entries: [], editable: false };

  const entries: InspectStyleEntry[] = [];
  for (const prop of obj.getProperties()) {
    if (!Node.isPropertyAssignment(prop)) {
      // spread / shorthand / method — show raw, never editable
      entries.push({ property: prop.getText(), value: "", editable: false });
      continue;
    }
    const name = prop.getName();
    const value = prop.getInitializer();
    if (value && Node.isStringLiteral(value)) {
      entries.push({ property: name, value: value.getLiteralText(), editable: true });
    } else if (value && Node.isNumericLiteral(value)) {
      entries.push({ property: name, value: value.getText(), editable: true });
    } else {
      entries.push({ property: name, value: value?.getText() ?? "", editable: false });
    }
  }
  return { entries, editable: true };
}

function classNameField(opening: any): InspectField | undefined {
  const attr = getAttribute(opening, "className");
  if (!attr) return undefined;
  const init = (attr as any).getInitializer();
  if (init && Node.isStringLiteral(init)) return { value: init.getLiteralText(), editable: true };
  return { value: init?.getText() ?? "", editable: false };
}

function textField(el: Node): InspectField | undefined {
  if (el.getKind() !== SyntaxKind.JsxElement) return undefined;
  const children = (el as any).getJsxChildren() as Node[];
  const meaningful = children.filter(
    (c) => !(Node.isJsxText(c) && c.getText().trim() === "")
  );
  if (meaningful.length === 1 && Node.isJsxText(meaningful[0])) {
    return { value: meaningful[0].getText().trim(), editable: true };
  }
  return undefined;
}

/** Read source truth (style object, className, text) for the JSX element at line/column. */
export function inspectJsxElement(sf: SourceFile, line: number, column: number): InspectResult {
  const opening = locateJsxElement(sf, line, column);
  if (!opening) return { status: "error", message: "no JSX element at position" };
  const el = opening.getParentIfKind(SyntaxKind.JsxElement) ?? opening;
  const op = getOpening(el);

  const { entries, editable } = styleEntries(op);
  return {
    status: "ok",
    styleEditable: editable,
    style: entries,
    className: classNameField(op),
    text: textField(el),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/agent/inspect.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add src/agent/inspect.ts tests/agent/inspect.test.ts
git commit -m "feat: inspectJsxElement reads source-truth style/className/text"
```

---

### Task 6: `fsList.ts` — directory listing for Browse

**Files:**
- Create: `src/agent/fsList.ts`
- Test: `tests/agent/fsList.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/agent/fsList.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { listDir, listDrives } from "../../src/agent/fsList.js";

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "fslist-"));
  mkdirSync(join(dir, "sub"));
  mkdirSync(join(dir, "node_modules"));
  writeFileSync(join(dir, "b.tsx"), "");
  writeFileSync(join(dir, "a.tsx"), "");
  writeFileSync(join(dir, ".hidden"), "");
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("listDir", () => {
  it("lists directories first, then files, alphabetically, with absolute paths", () => {
    const listing = listDir(dir);
    expect(listing.path).toBe(dir);
    expect(listing.entries.map((e) => e.name)).toEqual(["sub", "a.tsx", "b.tsx"]);
    expect(listing.entries[0]).toEqual({ name: "sub", path: join(dir, "sub"), dir: true });
  });

  it("excludes node_modules and dot-entries", () => {
    const names = listDir(dir).entries.map((e) => e.name);
    expect(names).not.toContain("node_modules");
    expect(names).not.toContain(".hidden");
  });

  it("reports the parent directory", () => {
    expect(listDir(dir).parent).toBe(dirname(dir));
  });

  it("reports empty parent at a filesystem root", () => {
    const root = dirname(dir).split(/[\\/]/)[0] + (process.platform === "win32" ? "\\" : "/");
    expect(listDir(root).parent).toBe("");
  });
});

describe("listDrives", () => {
  it("returns directory entries with empty path", () => {
    const listing = listDrives();
    expect(listing.path).toBe("");
    expect(listing.parent).toBe("");
    expect(Array.isArray(listing.entries)).toBe(true);
    for (const e of listing.entries) expect(e.dir).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/agent/fsList.test.ts`
Expected: FAIL — cannot resolve `../../src/agent/fsList.js`.

- [ ] **Step 3: Write the implementation**

```ts
// src/agent/fsList.ts
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { FsListing } from "../shared/types.js";

/** Read-only listing for the panel's Browse UI. Never reads file contents. */
export function listDir(absPath: string): FsListing {
  const parentDir = dirname(absPath);
  const entries = readdirSync(absPath, { withFileTypes: true })
    .filter((e) => !e.name.startsWith(".") && e.name !== "node_modules")
    .map((e) => ({ name: e.name, path: join(absPath, e.name), dir: e.isDirectory() }))
    .sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
  return {
    path: absPath,
    // "" signals the panel to request the drive list next.
    parent: parentDir === absPath ? "" : parentDir,
    entries,
  };
}

/** Windows drive roots (empty on other platforms — listDir handles "/" there). */
export function listDrives(): FsListing {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const entries = [...letters]
    .map((l) => `${l}:\\`)
    .filter((root) => existsSync(root))
    .map((root) => ({ name: root, path: root, dir: true }));
  return { path: "", parent: "", entries };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/agent/fsList.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/agent/fsList.ts tests/agent/fsList.test.ts
git commit -m "feat: read-only directory/drive listing for the Browse UI"
```

---

### Task 7: `landingHtml(port)` — drop projectRoot

**Files:**
- Modify: `src/agent/bookmarklet.ts`
- Test: `tests/agent/bookmarklet.test.ts`

- [ ] **Step 1: Update the tests (failing)**

Replace the entire `describe("landingHtml", ...)` block in `tests/agent/bookmarklet.test.ts` with:

```ts
describe("landingHtml", () => {
  it("includes the port and the bookmarklet href", () => {
    const html = landingHtml(4567);
    expect(html).toContain("4567");
    expect(html).toContain(bookmarkletHref(4567));
  });

  it("no longer renders a project root", () => {
    expect(landingHtml(4567)).not.toContain("Project root");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/agent/bookmarklet.test.ts`
Expected: FAIL — `landingHtml(4567)` called with one arg renders `undefined`-ish root / signature mismatch behavior.

- [ ] **Step 3: Update the implementation**

In `src/agent/bookmarklet.ts`:
- Delete the `escapeHtml` function and its doc comment (its only caller was the projectRoot interpolation; the remaining interpolations are `port` (a number) and `href` (generated, contains no `"` or `&` — guarded by existing tests)).
- Change the signature to `export function landingHtml(port: number): string`, delete the `const root = escapeHtml(projectRoot);` line, and replace the meta paragraph in the HTML with:

```html
<p class="meta">Agent port: <code>${port}</code></p>
```

Also update the function's doc comment to drop the "Shows the active project root" wording (it now shows only the port).

- [ ] **Step 4: Run tests + typecheck (expect server.ts error)**

Run: `npx vitest run tests/agent/bookmarklet.test.ts && npx tsc --noEmit`
Expected: bookmarklet tests PASS; `tsc` FAILS only in `src/agent/server.ts` (still calls `landingHtml(PROJECT_ROOT, PORT)`) — that is fixed in Task 8, so commit only if `server.ts` is the sole error. To keep the tree green for this commit, apply the one-line interim change in `src/agent/server.ts`: replace `landingHtml(PROJECT_ROOT, PORT)` with `landingHtml(PORT)`.

- [ ] **Step 5: Verify clean and commit**

Run: `npx tsc --noEmit && npm test`
Expected: clean, all PASS.

```bash
git add src/agent/bookmarklet.ts tests/agent/bookmarklet.test.ts src/agent/server.ts
git commit -m "feat: landing page drops project root display (absolute-path contract)"
```

---

### Task 8: `server.ts` — absolute-path contract, `/inspect`, `/fs`

**Files:**
- Modify: `src/agent/server.ts`

No unit tests (project convention: server is thin wiring, manually smoke-tested — Task 11). Typecheck is the gate here.

- [ ] **Step 1: Replace the file content**

```ts
// src/agent/server.ts
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { resolve, join, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Project } from "ts-morph";
import { processEdits } from "./apply.js";
import { inspectJsxElement } from "./inspect.js";
import { listDir, listDrives } from "./fsList.js";
import { isEditableSourcePath } from "./paths.js";
import type { EditRequest, InspectRequest } from "../shared/types.js";
import { landingHtml } from "./bookmarklet.js";

const PORT = Number(process.env.PORT ?? 4567);

// dist/ and the backup dir sit at this repo's root; this module lives in src/agent/.
// Backups deliberately live in THIS repo so the target repo stays clean.
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const OVERLAY_BUNDLE = resolve(MODULE_DIR, "../../dist/overlay.js");
const BACKUP_DIR = resolve(MODULE_DIR, "../../.ui-modifier-backups");

function readBody(req: any): Promise<string> {
  return new Promise((res) => {
    let data = "";
    req.on("data", (c: Buffer) => (data += c));
    req.on("end", () => res(data));
  });
}

function cors(res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

/** Validate the absolute path from the overlay and read it; throws a clear message. */
function readSource(file: string): string {
  if (!isEditableSourcePath(file)) throw new Error(`not an editable source file: ${file}`);
  try {
    return readFileSync(file, "utf8");
  } catch {
    throw new Error(`file not found: ${file}`);
  }
}

/** ts-morph's in-memory FS wants forward slashes, even for windows drive paths. */
function memPath(file: string): string {
  return file.replace(/\\/g, "/");
}

function sendJson(res: any, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") return res.writeHead(204).end();

  const pathname = (req.url ?? "").split("?")[0];

  if (req.method === "GET" && (pathname === "/" || pathname === "")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(landingHtml(PORT));
  }

  if (req.method === "GET" && pathname === "/overlay.js") {
    let bundle: Buffer | undefined;
    try {
      bundle = readFileSync(OVERLAY_BUNDLE);
    } catch {
      // Missing, or transiently unreadable (e.g. mid-rebuild) — degrade gracefully.
    }
    if (!bundle) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("overlay bundle not found — run: npm run build:overlay");
    }
    res.writeHead(200, { "Content-Type": "application/javascript" });
    return res.end(bundle);
  }

  if (req.method === "GET" && pathname === "/fs") {
    try {
      const path = new URL(req.url ?? "/fs", "http://localhost").searchParams.get("path");
      return sendJson(res, 200, path ? listDir(path) : listDrives());
    } catch (err) {
      return sendJson(res, 500, { status: "error", message: (err as Error).message });
    }
  }

  if (req.method === "POST" && pathname === "/inspect") {
    try {
      const body = JSON.parse(await readBody(req)) as InspectRequest;
      const sf = new Project({ useInMemoryFileSystem: true })
        .createSourceFile(memPath(body.file), readSource(body.file));
      return sendJson(res, 200, inspectJsxElement(sf, body.line, body.column));
    } catch (err) {
      return sendJson(res, 500, { status: "error", message: (err as Error).message });
    }
  }

  if (req.method !== "POST" || pathname !== "/edit") return res.writeHead(404).end();

  try {
    const reqBody = JSON.parse(await readBody(req)) as EditRequest;
    const original = readSource(reqBody.file);
    const mem = memPath(reqBody.file);
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile(mem, original);

    const result = processEdits(project, { ...reqBody, file: mem });

    if (result.status === "applied") {
      mkdirSync(BACKUP_DIR, { recursive: true });
      copyFileSync(reqBody.file, join(BACKUP_DIR, `${basename(reqBody.file)}.${Date.now()}.bak`));
      writeFileSync(reqBody.file, result.newText, "utf8");
    }
    sendJson(res, 200, result);
  } catch (err) {
    sendJson(res, 500, { status: "error", message: (err as Error).message });
  }
});

server.listen(PORT, () => {
  console.log(`[ui-modifier] agent on http://localhost:${PORT}  (absolute-path mode; backups in ${BACKUP_DIR})`);
});
```

Notes on what changed vs. the old file:
- `PROJECT_ROOT` (argv) and the `startsWith` escape check are gone — the path IS absolute now, guarded by `isEditableSourcePath` + existence.
- `BACKUP_DIR` is resolved relative to this module (same technique as `OVERLAY_BUNDLE`).
- All routes match on `pathname` so query strings never break matching.
- If Task 4's absolute-path test failed (ts-morph rejecting `D:/...` in-memory paths), instead register the file as `/edit.tsx`: `const mem = "/edit.tsx";` in both `/edit` and `/inspect` — everything else stays the same (error messages will then cite the request body's real path via `readSource`).

- [ ] **Step 2: Typecheck and full test run**

Run: `npx tsc --noEmit && npm test`
Expected: clean, all PASS.

- [ ] **Step 3: Quick server smoke (routes only)**

Run (PowerShell):
```powershell
npm run agent &
# wait for "agent on" line, then:
curl.exe -s http://localhost:4567/fs | Select-Object -First 1
curl.exe -s -X POST http://localhost:4567/inspect -H "Content-Type: application/json" -d '{\"file\":\"D:/nope.tsx\",\"line\":1,\"column\":1}'
```
Expected: `/fs` returns JSON drive list; `/inspect` returns `{"status":"error","message":"file not found: D:/nope.tsx"}`. Stop the agent afterwards.

- [ ] **Step 4: Commit**

```bash
git add src/agent/server.ts
git commit -m "feat: absolute-path contract, /inspect and /fs routes on the agent"
```

---

### Task 9: `editsDiff.ts` — pure panel-state → Edit[] diff

**Files:**
- Create: `src/overlay/editsDiff.ts`
- Test: `tests/overlay/editsDiff.test.ts` (new directory; vitest picks it up — config has no `include` restriction, verify in `vitest.config.ts` and widen `include` if it restricts to `tests/agent`)

- [ ] **Step 1: Write the failing tests**

```ts
// tests/overlay/editsDiff.test.ts
import { describe, it, expect } from "vitest";
import { buildEdits, parseStyleValue } from "../../src/overlay/editsDiff.js";
import type { InspectOk } from "../../src/shared/types.js";

const snapshot: InspectOk = {
  status: "ok",
  styleEditable: true,
  style: [
    { property: "color", value: "red", editable: true },
    { property: "marginTop", value: "8", editable: true },
    { property: "width", value: "theme.w", editable: false },
  ],
  className: { value: "a b", editable: true },
  text: { value: "hello", editable: true },
};

function stateFrom(overrides: Partial<Parameters<typeof buildEdits>[1]> = {}) {
  return {
    style: [
      { property: "color", value: "red", removed: false, editable: true },
      { property: "marginTop", value: "8", removed: false, editable: true },
      { property: "width", value: "theme.w", removed: false, editable: false },
    ],
    added: [],
    className: "a b" as string | null,
    text: "hello" as string | null,
    ...overrides,
  };
}

describe("parseStyleValue", () => {
  it("parses plain numbers as numbers", () => {
    expect(parseStyleValue("8")).toBe(8);
    expect(parseStyleValue("-1.5")).toBe(-1.5);
    expect(parseStyleValue(" 8 ")).toBe(8);
  });
  it("keeps everything else a string", () => {
    expect(parseStyleValue("8px")).toBe("8px");
    expect(parseStyleValue("red")).toBe("red");
  });
});

describe("buildEdits", () => {
  it("emits nothing when state matches the snapshot", () => {
    expect(buildEdits(snapshot, stateFrom())).toEqual([]);
  });

  it("emits a style edit for a changed value, parsing numbers", () => {
    const state = stateFrom();
    state.style[1] = { ...state.style[1], value: "16" };
    expect(buildEdits(snapshot, state)).toEqual([{ kind: "style", property: "marginTop", value: 16 }]);
  });

  it("emits styleRemove for removed rows", () => {
    const state = stateFrom();
    state.style[0] = { ...state.style[0], removed: true };
    expect(buildEdits(snapshot, state)).toEqual([{ kind: "styleRemove", property: "color" }]);
  });

  it("never emits for read-only rows, even if mutated", () => {
    const state = stateFrom();
    state.style[2] = { ...state.style[2], value: "999", removed: true };
    expect(buildEdits(snapshot, state)).toEqual([]);
  });

  it("emits style edits for added rows, skipping blanks", () => {
    const state = stateFrom({ added: [
      { property: "padding", value: "4" },
      { property: "", value: "" },
      { property: "  ", value: "x" },
    ]});
    expect(buildEdits(snapshot, state)).toEqual([{ kind: "style", property: "padding", value: 4 }]);
  });

  it("emits a className prop edit on change", () => {
    expect(buildEdits(snapshot, stateFrom({ className: "a b c" })))
      .toEqual([{ kind: "prop", name: "className", value: "a b c" }]);
  });

  it("adds className when the snapshot had none and the user typed one", () => {
    const snap: InspectOk = { ...snapshot, className: undefined };
    expect(buildEdits(snap, stateFrom({ className: "new" })))
      .toEqual([{ kind: "prop", name: "className", value: "new" }]);
  });

  it("does not emit className when absent in snapshot and left empty", () => {
    const snap: InspectOk = { ...snapshot, className: undefined };
    expect(buildEdits(snap, stateFrom({ className: "" }))).toEqual([]);
  });

  it("skips className when the panel field was disabled (null)", () => {
    expect(buildEdits(snapshot, stateFrom({ className: null }))).toEqual([]);
  });

  it("emits a text edit on change, and skips when disabled (null)", () => {
    expect(buildEdits(snapshot, stateFrom({ text: "bye" }))).toEqual([{ kind: "text", value: "bye" }]);
    expect(buildEdits(snapshot, stateFrom({ text: null }))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/overlay/editsDiff.test.ts`
Expected: FAIL — cannot resolve `../../src/overlay/editsDiff.js`. (If vitest reports "no test files found", widen `include` in `vitest.config.ts` to cover `tests/**/*.test.ts` first.)

- [ ] **Step 3: Write the implementation**

```ts
// src/overlay/editsDiff.ts
import type { Edit, InspectOk } from "../shared/types.js";

export interface StyleRowState {
  property: string;
  value: string;
  removed: boolean;
  editable: boolean;
}

/** What the panel DOM holds at Apply time. null fields were disabled (not editable / absent). */
export interface PanelState {
  style: StyleRowState[];
  added: { property: string; value: string }[];
  className: string | null;
  text: string | null;
}

/** Inputs hold strings; bare numbers become numeric literals (matches applyStyle's literal()). */
export function parseStyleValue(raw: string): string | number {
  const t = raw.trim();
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : t;
}

/** Diff panel state against the inspect snapshot into the minimal Edit[]. */
export function buildEdits(snapshot: InspectOk, state: PanelState): Edit[] {
  const edits: Edit[] = [];

  for (const row of state.style) {
    if (!row.editable) continue;
    if (row.removed) {
      edits.push({ kind: "styleRemove", property: row.property });
      continue;
    }
    const orig = snapshot.style.find((s) => s.property === row.property);
    if (orig && row.value !== orig.value) {
      edits.push({ kind: "style", property: row.property, value: parseStyleValue(row.value) });
    }
  }

  for (const a of state.added) {
    if (a.property.trim() === "" || a.value.trim() === "") continue;
    edits.push({ kind: "style", property: a.property.trim(), value: parseStyleValue(a.value) });
  }

  if (state.className !== null) {
    const orig = snapshot.className?.value;
    const changed = orig === undefined ? state.className !== "" : state.className !== orig;
    if (changed) edits.push({ kind: "prop", name: "className", value: state.className });
  }

  if (state.text !== null && snapshot.text && state.text !== snapshot.text.value) {
    edits.push({ kind: "text", value: state.text });
  }

  return edits;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/overlay/editsDiff.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add src/overlay/editsDiff.ts tests/overlay/editsDiff.test.ts
git commit -m "feat: pure diff from panel state to minimal Edit[]"
```

(If `vitest.config.ts` needed widening, include it in the commit.)

---

### Task 10: Overlay API — inspect + fs calls, absolute paths

**Files:**
- Modify: `src/overlay/api.ts`

`relativeToSrc` is still imported by `src/overlay/index.ts`, which Task 11 rewrites — so it is deleted there, not here, to keep every commit compiling.

- [ ] **Step 1: Add the new calls**

In `src/overlay/api.ts`, replace the `const AGENT = ...` line with an origin constant and add two functions (keep `sendEdit` and, for now, `relativeToSrc`):

```ts
const AGENT_ORIGIN = "http://localhost:4567";

export async function sendEdit(req: EditRequest): Promise<EditResult> {
  const res = await fetch(`${AGENT_ORIGIN}/edit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  return (await res.json()) as EditResult;
}

export async function sendInspect(req: InspectRequest): Promise<InspectResult> {
  const res = await fetch(`${AGENT_ORIGIN}/inspect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  return (await res.json()) as InspectResult;
}

export async function fetchFsListing(path?: string): Promise<FsListing> {
  const url = path
    ? `${AGENT_ORIGIN}/fs?path=${encodeURIComponent(path)}`
    : `${AGENT_ORIGIN}/fs`;
  const res = await fetch(url);
  return (await res.json()) as FsListing;
}
```

Update the type import to:

```ts
import type {
  EditRequest, EditResult, FsListing, InspectRequest, InspectResult,
} from "../shared/types.js";
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/overlay/api.ts
git commit -m "feat: overlay api gains inspect and fs-listing calls"
```

---

### Task 11: Panel rework + index wiring

**Files:**
- Modify: `src/overlay/panel.ts` (full rewrite)
- Modify: `src/overlay/index.ts` (full rewrite)
- Modify: `src/overlay/api.ts` (delete `relativeToSrc`, now unreferenced)

- [ ] **Step 1: Rewrite `src/overlay/panel.ts`**

```ts
// src/overlay/panel.ts
import type {
  EditRequest, EditResult, FsListing, InspectOk, InspectRequest, InspectResult,
} from "../shared/types.js";
import { buildEdits, type PanelState, type StyleRowState } from "./editsDiff.js";

export interface PanelTarget { file: string; line: number; column: number; }

export interface PanelHandlers {
  onInspect(req: InspectRequest): Promise<InspectResult>;
  onApply(req: EditRequest): Promise<EditResult>;
  onListDir(path?: string): Promise<FsListing>;
}

export function createPanel(handlers: PanelHandlers) {
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;top:16px;right:16px;z-index:2147483647;";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>
      .p{font:13px sans-serif;background:#fff;border:1px solid #ccc;border-radius:8px;
         box-shadow:0 4px 16px rgba(0,0,0,.15);width:320px;padding:12px;max-height:85vh;overflow:auto}
      .t{font-weight:600;margin-bottom:8px}
      label{display:block;margin:6px 0 2px;color:#555}
      input{box-sizing:border-box;padding:4px;font:inherit}
      input:disabled{background:#f5f5f5;color:#999}
      .full{width:100%}
      .row{display:flex;gap:4px;margin:2px 0}
      .row .k{width:42%}
      .row .v{flex:1;min-width:0}
      .row button{padding:0 6px;cursor:pointer}
      .row.removed input{text-decoration:line-through;color:#999}
      .pathrow{display:flex;gap:4px}
      .pathrow input{flex:1;min-width:0}
      .browser{border:1px solid #ddd;margin-top:4px;max-height:160px;overflow:auto;font-size:12px}
      .browser div{padding:2px 6px;cursor:pointer;white-space:nowrap}
      .browser div:hover{background:#f0f6ff}
      .apply{margin-top:10px;padding:6px 10px;cursor:pointer}
      .out{margin-top:8px;white-space:pre-wrap;font:11px monospace;color:#333;word-break:break-all}
    </style>
    <div class="p">
      <div class="t" id="who">No selection</div>
      <label>File</label>
      <div class="pathrow"><input id="file" placeholder="(absolute path)"><button id="browse" title="browse">&#128193;</button></div>
      <div class="browser" id="browser" style="display:none"></div>
      <label>style</label>
      <div id="styles"></div>
      <div class="row"><input class="k" id="newk" placeholder="property"><input class="v" id="newv" placeholder="value"></div>
      <label>className</label><input class="full" id="cls" placeholder="(none)">
      <label>Text</label><input class="full" id="text" placeholder="(none)">
      <button class="apply" id="apply">Apply</button>
      <div class="out" id="out"></div>
    </div>`;
  document.body.appendChild(host);

  const $ = <T extends HTMLElement = HTMLElement>(id: string) => root.getElementById(id) as T;
  const out = $("out");
  const stylesBox = $("styles");
  const browser = $("browser");

  let loc: { line: number; column: number } | null = null;
  let snapshot: InspectOk | null = null;

  function styleRow(property: string, value: string, editable: boolean): HTMLDivElement {
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `<input class="k" disabled><input class="v"><button title="remove">✕</button>`;
    const [k, v] = Array.from(row.querySelectorAll("input")) as HTMLInputElement[];
    const del = row.querySelector("button") as HTMLButtonElement;
    k.value = property;
    v.value = value;
    if (!editable) { v.disabled = true; del.disabled = true; }
    del.onclick = () => row.classList.toggle("removed"); // toggle so a misclick is reversible
    return row;
  }

  function clearEditors() {
    stylesBox.innerHTML = "";
    ($("newk") as HTMLInputElement).value = "";
    ($("newv") as HTMLInputElement).value = "";
  }

  function render(res: InspectResult) {
    clearEditors();
    if (res.status === "error") {
      snapshot = null;
      out.textContent = `❌ ${res.message}`;
      return;
    }
    snapshot = res;
    out.textContent = "";
    for (const e of res.style) {
      stylesBox.appendChild(styleRow(e.property, e.value, e.editable && res.styleEditable));
    }
    const cls = $<HTMLInputElement>("cls");
    cls.value = res.className?.value ?? "";
    cls.disabled = res.className ? !res.className.editable : false;
    const text = $<HTMLInputElement>("text");
    text.value = res.text?.value ?? "";
    text.disabled = !res.text?.editable;
  }

  function collectState(): PanelState {
    const style: StyleRowState[] = [];
    stylesBox.querySelectorAll(".row").forEach((row) => {
      const [k, v] = Array.from(row.querySelectorAll("input")) as HTMLInputElement[];
      style.push({
        property: k.value,
        value: v.value,
        removed: row.classList.contains("removed"),
        editable: !v.disabled,
      });
    });
    const cls = $<HTMLInputElement>("cls");
    const text = $<HTMLInputElement>("text");
    return {
      style,
      added: [{
        property: $<HTMLInputElement>("newk").value,
        value: $<HTMLInputElement>("newv").value,
      }],
      className: cls.disabled ? null : cls.value,
      text: text.disabled ? null : text.value,
    };
  }

  async function inspectInto(file: string) {
    if (!loc) return;
    render(await handlers.onInspect({ file, line: loc.line, column: loc.column }));
  }

  $("apply").onclick = async () => {
    if (!loc || !snapshot) { out.textContent = "No editable selection."; return; }
    const file = $<HTMLInputElement>("file").value.trim();
    const edits = buildEdits(snapshot, collectState());
    if (edits.length === 0) { out.textContent = "Nothing to apply."; return; }
    const res = await handlers.onApply({ file, line: loc.line, column: loc.column, edits });
    out.textContent =
      res.status === "applied" ? "✅ Applied. HMR will reload."
      : res.status === "suggested" ? `\u{1F4CB} Suggested:\n${res.instruction}\n${res.reason}`
      : `❌ ${res.message}`;
    // Element start position is stable under our own edits (they only touch
    // text at/after the opening tag), so refresh rows from the new source.
    if (res.status === "applied") await inspectInto(file);
  };

  async function showDir(path?: string) {
    let listing: FsListing;
    try {
      listing = await handlers.onListDir(path);
    } catch (e) {
      out.textContent = `❌ fs: ${(e as Error).message}`;
      return;
    }
    browser.style.display = "block";
    browser.innerHTML = "";
    if (listing.path) {
      const up = document.createElement("div");
      up.textContent = "⬆ ..";
      // parent === "" means we were at a root: go to the drive list.
      up.onclick = () => showDir(listing.parent || undefined);
      browser.appendChild(up);
    }
    for (const e of listing.entries) {
      const item = document.createElement("div");
      item.textContent = (e.dir ? "\u{1F4C1} " : "\u{1F4C4} ") + e.name;
      item.onclick = async () => {
        if (e.dir) { await showDir(e.path); return; }
        $<HTMLInputElement>("file").value = e.path;
        browser.style.display = "none";
        await inspectInto(e.path);
      };
      browser.appendChild(item);
    }
  }

  $("browse").onclick = async () => {
    if (browser.style.display !== "none") { browser.style.display = "none"; return; }
    const file = $<HTMLInputElement>("file").value.trim();
    const dir = file.replace(/[\\/][^\\/]*$/, "");
    await showDir(dir && dir !== file ? dir : undefined);
  };

  return {
    host,
    async setTarget(name: string, target: PanelTarget | null) {
      browser.style.display = "none";
      if (!target) {
        $("who").textContent = `${name} — no source info`;
        loc = null;
        snapshot = null;
        clearEditors();
        return;
      }
      const short = target.file.split(/[\\/]/).pop();
      $("who").textContent = `${name} — ${short}:${target.line}`;
      loc = { line: target.line, column: target.column };
      $<HTMLInputElement>("file").value = target.file;
      await inspectInto(target.file);
    },
  };
}
```

- [ ] **Step 2: Rewrite `src/overlay/index.ts`**

```ts
// src/overlay/index.ts
import { sourceLocFor, componentNameFor } from "./fiber.js";
import { createPanel } from "./panel.js";
import { createInspector } from "./inspector.js";
import { sendEdit, sendInspect, fetchFsListing } from "./api.js";

const panel = createPanel({
  onInspect: sendInspect,
  onApply: sendEdit,
  onListDir: fetchFsListing,
});

createInspector((el) => {
  // _debugSource gives the absolute path; it is passed through verbatim.
  const loc = sourceLocFor(el);
  void panel.setTarget(componentNameFor(el), loc ?? null);
}, panel.host);

console.log("[ui-modifier] overlay ready");
```

- [ ] **Step 3: Delete `relativeToSrc` from `src/overlay/api.ts`**

Remove the function and its doc comment — nothing imports it anymore.

- [ ] **Step 4: Typecheck, full tests, build the bundle**

Run: `npx tsc --noEmit && npm test && npm run build:overlay`
Expected: clean typecheck, all tests PASS, esbuild writes `dist/overlay.js` without errors.

- [ ] **Step 5: Commit**

```bash
git add src/overlay/panel.ts src/overlay/index.ts src/overlay/api.ts dist/overlay.js
git commit -m "feat: dynamic style/className/text panel with path input and browse"
```

---

### Task 12: End-to-end smoke + verification

**Files:** none (manual verification; follow superpowers:verification-before-completion)

- [ ] **Step 1: Full automated gate**

Run: `npx tsc --noEmit && npm test && npm run build:overlay`
Expected: everything green. Paste the actual output into the session before claiming success.

- [ ] **Step 2: Manual smoke checklist (needs a running antd dev app)**

1. `npm run agent` (from this repo — no argv needed anymore).
2. Open `http://localhost:4567/` → landing page shows port, NO project root line; drag the bookmarklet to the bookmarks bar.
3. Open the target antd app tab (its dev server, e.g. `localhost:3000`), click the bookmarklet.
4. Click a component → panel shows: absolute file path in the File input, style rows from source, className, text.
5. Change a style value + add a new property + remove one → Apply → `✅`, target `.tsx` on disk updated at its real absolute path (THE bug fix), HMR reloads, panel rows refresh.
6. Edit className and text → Apply → source updated.
7. Click 📁, navigate up to the drive list and back down, pick a file → File input updates.
8. Check the target repo's `git status` → clean except the intended source edit; backups appear in this repo's `.ui-modifier-backups/`.
9. Select a component styled via a non-literal (`style={styles}` or `className={cls}`) → rows/fields render disabled.

- [ ] **Step 3: Record results**

Append a short verification note (what was run, observed results) to `docs/superpowers/specs/2026-06-10-style-class-editing-and-abs-path-design.md` under a `## Verification` heading, or as a separate `docs/superpowers/` note matching the repo's existing `verification results` doc pattern.

- [ ] **Step 4: Commit**

```bash
git add -A docs
git commit -m "docs: record style/class editing + abs-path verification results"
```
