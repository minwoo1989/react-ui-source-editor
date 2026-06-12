# Extract shared JSX node helpers (`jsxNodes.ts`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the duplicated `getOpening`/`getAttribute` JSX helpers into `src/agent/jsxNodes.ts` and migrate the four consumers, with zero behavior change.

**Architecture:** One new module exports the two helpers; `applyStyle`, `applyProp`, `classify`, and `inspect` import them and drop their local copies. The existing 125-test suite is the regression safety net.

**Tech Stack:** TypeScript, ts-morph, vitest.

**Spec:** `docs/superpowers/specs/2026-06-12-jsxnodes-refactor-design.md`

**Conventions:** Run tests `npx vitest run`; typecheck `npx tsc --noEmit`. Agent-only modules (no overlay bundle / no browser). End commit messages with the `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` trailer.

---

## File Structure

- `src/agent/jsxNodes.ts` — **new**: `getOpening`, `getAttribute`.
- `tests/agent/jsxNodes.test.ts` — **new**: unit tests for the two helpers.
- `src/agent/applyStyle.ts`, `applyProp.ts`, `classify.ts`, `inspect.ts` — **modify**: import the helpers, delete local copies.

---

## Task 1: Extract `jsxNodes.ts` and migrate consumers

**Files:** create `src/agent/jsxNodes.ts` + `tests/agent/jsxNodes.test.ts`; modify the four agent modules above.

- [ ] **Step 1: Write the failing test**

Create `tests/agent/jsxNodes.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { Project, SyntaxKind } from "ts-morph";
import { getOpening, getAttribute } from "../../src/agent/jsxNodes.js";

function jsx(text: string) {
  const sf = new Project({ useInMemoryFileSystem: true }).createSourceFile("F.tsx", `const X = () => (${text});`);
  const el = sf.getFirstDescendant(
    (n) => n.getKind() === SyntaxKind.JsxElement || n.getKind() === SyntaxKind.JsxSelfClosingElement
  );
  return el!;
}

describe("getOpening", () => {
  it("returns the opening element for a JsxElement", () => {
    expect(getOpening(jsx('<div className="a">hi</div>')).getKind()).toBe(SyntaxKind.JsxOpeningElement);
  });
  it("returns the node itself for a self-closing element", () => {
    const el = jsx("<br/>");
    expect(getOpening(el)).toBe(el);
  });
});

describe("getAttribute", () => {
  it("finds an existing attribute by name", () => {
    const attr = getAttribute(jsx('<div id="x" className="a">hi</div>'), "className");
    expect(attr).toBeDefined();
    expect(attr!.getText()).toContain("className");
  });
  it("returns undefined for an absent attribute", () => {
    expect(getAttribute(jsx("<div>hi</div>"), "style")).toBeUndefined();
  });
  it("accepts an opening element too (idempotent getOpening)", () => {
    const op = getOpening(jsx('<div id="x">hi</div>'));
    expect(getAttribute(op, "id")).toBeDefined();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/agent/jsxNodes.test.ts`
Expected: FAIL — `src/agent/jsxNodes.ts` does not exist.

- [ ] **Step 3: Create `src/agent/jsxNodes.ts`**

```ts
// src/agent/jsxNodes.ts
import { Node, SyntaxKind } from "ts-morph";

/** The opening element of a JsxElement, or the self-closing/opening node itself. */
export function getOpening(el: Node): any {
  return el.getKind() === SyntaxKind.JsxElement ? (el as any).getOpeningElement() : el;
}

/** Find a JsxAttribute by name on the element's opening; undefined if absent. */
export function getAttribute(el: Node, name: string): Node | undefined {
  return getOpening(el)
    .getAttributes()
    .find((a: Node) => Node.isJsxAttribute(a) && a.getNameNode().getText() === name);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/agent/jsxNodes.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Migrate `src/agent/applyStyle.ts`**

- Change the import line `import { Node, SyntaxKind } from "ts-morph";` to
  `import { Node } from "ts-morph";` (SyntaxKind was only used by the local
  `getOpening`) and add `import { getAttribute, getOpening } from "./jsxNodes.js";`.
- Delete the local `function getOpening(el: Node): any { ... }`.
- In `applyStyle`, replace:
  ```ts
  const opening = getOpening(el);
  const styleAttr = opening
    .getAttributes()
    .find((a: Node) => Node.isJsxAttribute(a) && a.getNameNode().getText() === "style");
  ```
  with:
  ```ts
  const opening = getOpening(el);
  const styleAttr = getAttribute(el, "style");
  ```
  (`opening` stays — it is used by `opening.addAttribute(...)`.)
- In `removeStyle`, replace:
  ```ts
  const opening = getOpening(el);
  const styleAttr = opening
    .getAttributes()
    .find((a: Node) => Node.isJsxAttribute(a) && a.getNameNode().getText() === "style");
  ```
  with:
  ```ts
  const styleAttr = getAttribute(el, "style");
  ```
  (`removeStyle` does not use `opening` elsewhere, so drop it.)

- [ ] **Step 6: Migrate `src/agent/applyProp.ts`**

- Change `import { Node, SyntaxKind } from "ts-morph";` to `import { Node } from "ts-morph";`
  and add `import { getAttribute, getOpening } from "./jsxNodes.js";`.
- Delete the local `function getOpening(el: Node): any { ... }`.
- In `applyProp`, replace:
  ```ts
  const opening = getOpening(el);
  const attr = opening
    .getAttributes()
    .find((a: Node) => Node.isJsxAttribute(a) && a.getNameNode().getText() === name);
  ```
  with:
  ```ts
  const opening = getOpening(el);
  const attr = getAttribute(el, name);
  ```
  (`opening` stays — used by `opening.addAttribute(...)`.)

- [ ] **Step 7: Migrate `src/agent/classify.ts`**

- Keep `import { Node, SyntaxKind } from "ts-morph";` (both still used elsewhere in
  the file). Add `import { getAttribute } from "./jsxNodes.js";`.
- Delete the local `function getOpening(el: Node): Node { ... }` and the local
  `function getAttribute(el: Node, name: string): Node | undefined { ... }`.
  The body already calls `getAttribute(el, ...)`, which now resolves to the import.

- [ ] **Step 8: Migrate `src/agent/inspect.ts`**

- Keep `import { Node, SourceFile, SyntaxKind } from "ts-morph";` (all still used).
  Add `import { getAttribute, getOpening } from "./jsxNodes.js";`.
- Delete the local `function getOpening(el: Node): any { ... }` and the local
  `function getAttribute(opening: any, name: string): Node | undefined { ... }`.
  Existing calls (`getOpening(el)`, `getAttribute(op, "style")`, etc.) now resolve
  to the imports — `getAttribute` accepting an opening is fine (`getOpening` is
  idempotent on an opening node). `propEntries` keeps its own
  `opening.getAttributes()` iteration (it enumerates all attributes, not a lookup).

- [ ] **Step 9: Typecheck + full suite**

Run: `npx tsc --noEmit` then `npx vitest run`
Expected: no type errors (no unused `SyntaxKind` imports; no remaining local
`getOpening`/`getAttribute`); all tests pass — the count is **130** (125 prior +
5 new `jsxNodes` tests). Confirm zero failures: the unchanged behavior of
`applyStyle`/`removeStyle`/`applyProp`/`classifyEdit`/`inspectJsxElement` is the
proof this refactor is behavior-preserving.

- [ ] **Step 10: Confirm the duplication is gone**

Run: `grep -rn "function getOpening\|function getAttribute" src/agent`
Expected: matches ONLY in `src/agent/jsxNodes.ts` (one of each).

- [ ] **Step 11: Commit**

```bash
git add src/agent/jsxNodes.ts tests/agent/jsxNodes.test.ts src/agent/applyStyle.ts src/agent/applyProp.ts src/agent/classify.ts src/agent/inspect.ts
git -c user.name=minwoo -c user.email=minwoo1989@gmail.com commit -m "refactor: extract shared getOpening/getAttribute into jsxNodes.ts"
```

---

## Self-Review Notes

- **Spec coverage:** `jsxNodes.ts` with both helpers (Steps 1–4); all four
  consumers migrated and local copies deleted (Steps 5–8); duplication-gone check
  (Step 10). Matches the spec's migration list exactly.
- **Behavior preservation:** no signature/logic change; the 125 existing tests
  (applyStyle/removeStyle/applyProp/classify/inspect) must stay green — that is
  the refactor's contract.
- **Import hygiene:** `SyntaxKind` is dropped from `applyStyle.ts`/`applyProp.ts`
  (only the deleted `getOpening` used it) but kept in `classify.ts`/`inspect.ts`
  (still used). With `strict` on but no `noUnusedLocals`, a stray unused import
  would not fail `tsc` — Step 5/6 explicitly remove it to keep the code clean.
- **No placeholders:** every step shows the exact before/after.
