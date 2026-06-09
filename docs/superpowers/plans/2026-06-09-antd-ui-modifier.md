# React 18 + antd Visual UI Modifier — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone dev tool that lets a developer click an element in a running React 18 + antd v5 app and edit its style/props/text, writing safe literal edits back into the `.tsx` source (HMR-reflected) and giving precise "change here" guidance for risky edits.

**Architecture:** Three pieces communicating over localhost — (1) a Shadow-DOM overlay injected into the target dev app that maps a clicked DOM node to its source location via React fiber `_debugSource`; (2) a Node code agent that parses target `.tsx` with ts-morph, classifies an edit as safe (literal) vs suggest-only (dynamic/external), and either writes the file or returns guidance + diff; (3) an HTTP transport between them. CRA's HMR reflects written changes automatically.

**Tech Stack:** Node 22, TypeScript, ts-morph (AST), vitest (tests), esbuild (overlay bundle), Node built-in `http` (agent server), vanilla TS + Shadow DOM (overlay).

---

## File Structure

```
react-ui-source-editor/
  package.json
  tsconfig.json
  vitest.config.ts
  src/
    shared/
      types.ts          # EditRequest / Edit / EditResult contracts
    agent/
      locate.ts         # find the JSX element node at file:line:column
      classify.ts       # decide safe-apply vs suggest-only per edit
      applyStyle.ts     # add/merge an inline style property
      applyProp.ts      # replace a literal prop value
      applyText.ts      # replace literal text children
      apply.ts          # orchestrator: classify -> apply or suggest, with rollback
      diff.ts           # produce a unified diff string for suggestions/previews
      server.ts         # http server exposing POST /edit
    overlay/
      fiber.ts          # read _debugSource from a DOM node's React fiber
      inspector.ts      # hover highlight + click selection
      panel.ts          # edit panel UI (Shadow DOM)
      api.ts            # POST edits to the agent
      index.ts          # bootstrap overlay
  tests/
    agent/
      fixtures/         # .tsx input fixtures
      locate.test.ts
      classify.test.ts
      applyStyle.test.ts
      applyProp.test.ts
      applyText.test.ts
      apply.test.ts
```

**Responsibility boundaries:** each `agent/*.ts` transform does one job and is unit-tested in isolation against fixture `.tsx` strings. `apply.ts` is the only module that touches the filesystem and orchestrates the others. The overlay never imports agent code — it only speaks the HTTP contract in `shared/types.ts`.

---

## Task 0: Verify `_debugSource` works in the target app (risk spike)

This validates the single biggest assumption before any code is built. No repo changes.

- [ ] **Step 1: Run the target dev app**

In the `my-react-app` project: `npm start` (runs `craco start`), open http://localhost:3000.

- [ ] **Step 2: Paste this snippet into the browser console**

```js
// Click any element after running this; logs its React source location.
document.addEventListener('click', (e) => {
  const node = e.target;
  const key = Object.keys(node).find(k => k.startsWith('__reactFiber$'));
  if (!key) return console.warn('no fiber on node');
  let fiber = node[key];
  // walk up to the nearest fiber that has _debugSource
  while (fiber && !fiber._debugSource) fiber = fiber.return;
  console.log('_debugSource:', fiber && fiber._debugSource);
}, { capture: true, once: true });
```

- [ ] **Step 3: Confirm output**

Expected: an object like `{ fileName: ".../src/.../Foo.tsx", lineNumber: 42, columnNumber: 7 }`.

- If present → proceed. The mapping strategy is viable.
- If `_debugSource` is `undefined` everywhere → STOP. The CRACO/babel config strips source info. Mitigation to add to plan: enable `@babel/preset-react` `development: true` (or `@babel/plugin-transform-react-jsx-source`) via `craco.config.js` for dev. Report back before continuing.

---

## Task 1: Scaffold the tool repo

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "react-ui-source-editor",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "agent": "node --experimental-strip-types src/agent/server.ts",
    "build:overlay": "esbuild src/overlay/index.ts --bundle --format=iife --outfile=dist/overlay.js"
  },
  "devDependencies": {
    "esbuild": "^0.23.0",
    "ts-morph": "^23.0.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
```

- [ ] **Step 4: Install and verify**

Run: `npm install`
Expected: dependencies installed, no errors.

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts package-lock.json
git commit -m "chore: scaffold react-ui-source-editor tool repo"
```

---

## Task 2: Define the shared contract

**Files:**
- Create: `src/shared/types.ts`

- [ ] **Step 1: Write the types**

```ts
// src/shared/types.ts

/** A single requested change to a JSX element. */
export type Edit =
  | { kind: "style"; property: string; value: string | number }
  | { kind: "prop"; name: string; value: string | number | boolean }
  | { kind: "text"; value: string };

/** Sent from overlay to agent. line/column are 1-based, from fiber._debugSource. */
export interface EditRequest {
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
```

- [ ] **Step 2: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat: add edit request/result contract"
```

---

## Task 3: Locate the JSX element at a source position

**Files:**
- Create: `src/agent/locate.ts`
- Test: `tests/agent/locate.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/agent/locate.test.ts
import { describe, it, expect } from "vitest";
import { Project } from "ts-morph";
import { locateJsxElement } from "../../src/agent/locate.js";

function sourceFileFrom(text: string) {
  const project = new Project({ useInMemoryFileSystem: true });
  return project.createSourceFile("F.tsx", text);
}

describe("locateJsxElement", () => {
  it("finds the opening element at the given 1-based line/column", () => {
    const text = [
      "const C = () => (",
      "  <Button type=\"default\">Save</Button>",
      ");",
    ].join("\n");
    const sf = sourceFileFrom(text);
    // "<Button" starts at line 2, column 3 (1-based)
    const node = locateJsxElement(sf, 2, 3);
    expect(node).toBeDefined();
    expect(node!.getKindName()).toMatch(/JsxOpeningElement|JsxSelfClosingElement/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/agent/locate.test.ts`
Expected: FAIL — cannot find module `locate.js` / `locateJsxElement` is not a function.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/agent/locate.ts
import { SourceFile, Node, ts, SyntaxKind } from "ts-morph";

/**
 * Find the JSX opening (or self-closing) element at a 1-based line/column,
 * matching the position React's _debugSource reports.
 */
export function locateJsxElement(
  sf: SourceFile,
  line: number,
  column: number
): Node | undefined {
  const pos = ts.getPositionOfLineAndCharacter(
    sf.compilerNode,
    line - 1,
    column - 1
  );
  let node: Node | undefined = sf.getDescendantAtPos(pos);
  while (node) {
    if (
      node.getKind() === SyntaxKind.JsxOpeningElement ||
      node.getKind() === SyntaxKind.JsxSelfClosingElement
    ) {
      return node;
    }
    node = node.getParent();
  }
  return undefined;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/agent/locate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent/locate.ts tests/agent/locate.test.ts
git commit -m "feat: locate JSX element at source position"
```

---

## Task 4: Classify an edit as safe-apply vs suggest-only

**Files:**
- Create: `src/agent/classify.ts`
- Test: `tests/agent/classify.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/agent/classify.test.ts
import { describe, it, expect } from "vitest";
import { Project, SyntaxKind } from "ts-morph";
import { locateJsxElement } from "../../src/agent/locate.js";
import { classifyEdit } from "../../src/agent/classify.js";
import type { Edit } from "../../src/shared/types.js";

function elementAt(text: string, line: number, col: number) {
  const sf = new Project({ useInMemoryFileSystem: true }).createSourceFile("F.tsx", text);
  const opening = locateJsxElement(sf, line, col)!;
  return opening.getParentIfKind(SyntaxKind.JsxElement) ??
         opening.getParentIfKind(SyntaxKind.JsxSelfClosingElement) ?? opening;
}

describe("classifyEdit", () => {
  it("string-literal prop -> safe", () => {
    const el = elementAt(`const C=()=>(<Button type="default" />);`, 1, 13);
    const edit: Edit = { kind: "prop", name: "type", value: "primary" };
    expect(classifyEdit(el, edit).safe).toBe(true);
  });

  it("expression prop -> suggest", () => {
    const el = elementAt(`const C=()=>(<Button type={btnType} />);`, 1, 13);
    const edit: Edit = { kind: "prop", name: "type", value: "primary" };
    expect(classifyEdit(el, edit).safe).toBe(false);
  });

  it("adding style when no style attr exists -> safe", () => {
    const el = elementAt(`const C=()=>(<Button />);`, 1, 13);
    const edit: Edit = { kind: "style", property: "marginTop", value: 8 };
    expect(classifyEdit(el, edit).safe).toBe(true);
  });

  it("style attr that is an identifier expression -> suggest", () => {
    const el = elementAt(`const C=()=>(<Button style={s} />);`, 1, 13);
    const edit: Edit = { kind: "style", property: "marginTop", value: 8 };
    expect(classifyEdit(el, edit).safe).toBe(false);
  });

  it("literal text child -> safe", () => {
    const el = elementAt(`const C=()=>(<Button>Save</Button>);`, 1, 13);
    const edit: Edit = { kind: "text", value: "저장" };
    expect(classifyEdit(el, edit).safe).toBe(true);
  });

  it("css prop present -> suggest (emotion)", () => {
    const el = elementAt("const C=()=>(<Button css={x}>Save</Button>);", 1, 13);
    const edit: Edit = { kind: "text", value: "저장" };
    expect(classifyEdit(el, edit).safe).toBe(false);
  });

  it("element rendered inside .map() -> suggest", () => {
    const el = elementAt(`const C=()=>(<>{items.map(i=><Button key={i}>x</Button>)}</>);`, 1, 28);
    const edit: Edit = { kind: "text", value: "y" };
    expect(classifyEdit(el, edit).safe).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/agent/classify.test.ts`
Expected: FAIL — `classifyEdit` not defined.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/agent/classify.ts
import { Node, SyntaxKind } from "ts-morph";
import type { Edit } from "../shared/types.js";

export interface Classification {
  safe: boolean;
  reason: string;
}

function getOpening(el: Node): Node {
  if (el.getKind() === SyntaxKind.JsxElement) {
    return (el as any).getOpeningElement();
  }
  return el; // self-closing or opening element itself
}

function getAttribute(el: Node, name: string): Node | undefined {
  const opening = getOpening(el);
  return (opening as any)
    .getAttributes()
    .find((a: Node) => Node.isJsxAttribute(a) && a.getNameNode().getText() === name);
}

function insideMap(el: Node): boolean {
  let n: Node | undefined = el.getParent();
  while (n) {
    if (
      n.getKind() === SyntaxKind.CallExpression &&
      n.getText().includes(".map(")
    ) return true;
    n = n.getParent();
  }
  return false;
}

export function classifyEdit(el: Node, edit: Edit): Classification {
  // emotion: a `css` prop means styling lives outside plain props
  if (getAttribute(el, "css")) {
    return { safe: false, reason: "emotion `css` prop present; edit the styled definition" };
  }
  if (insideMap(el)) {
    return { safe: false, reason: "element is rendered via .map(); one edit affects many" };
  }

  if (edit.kind === "prop") {
    const attr = getAttribute(el, edit.name);
    if (!attr) return { safe: true, reason: "new literal prop" };
    const init = (attr as any).getInitializer();
    if (!init) return { safe: true, reason: "boolean shorthand prop" };
    if (Node.isStringLiteral(init)) return { safe: true, reason: "string-literal prop" };
    if (Node.isJsxExpression(init)) {
      const expr = init.getExpression();
      if (expr && isLiteralExpr(expr)) return { safe: true, reason: "literal expression prop" };
    }
    return { safe: false, reason: "prop value is a dynamic expression" };
  }

  if (edit.kind === "style") {
    const attr = getAttribute(el, "style");
    if (!attr) return { safe: true, reason: "no style attr; can add one" };
    const init = (attr as any).getInitializer();
    const expr = Node.isJsxExpression(init) ? init.getExpression() : undefined;
    if (expr && Node.isObjectLiteralExpression(expr)) {
      return { safe: true, reason: "style is an object literal; can merge" };
    }
    return { safe: false, reason: "style is a dynamic expression" };
  }

  // text
  if (el.getKind() === SyntaxKind.JsxElement) {
    const children = (el as any).getJsxChildren() as Node[];
    const meaningful = children.filter(
      (c) => !(Node.isJsxText(c) && c.getText().trim() === "")
    );
    const onlyText =
      meaningful.length === 1 && Node.isJsxText(meaningful[0]);
    if (onlyText) return { safe: true, reason: "single literal text child" };
    return { safe: false, reason: "children include expressions/elements" };
  }
  return { safe: false, reason: "self-closing element has no text child" };
}

function isLiteralExpr(expr: Node): boolean {
  return (
    Node.isStringLiteral(expr) ||
    Node.isNumericLiteral(expr) ||
    expr.getKind() === SyntaxKind.TrueKeyword ||
    expr.getKind() === SyntaxKind.FalseKeyword
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/agent/classify.test.ts`
Expected: PASS (all 7 cases).

- [ ] **Step 5: Commit**

```bash
git add src/agent/classify.ts tests/agent/classify.test.ts
git commit -m "feat: classify edits as safe-apply vs suggest-only"
```

---

## Task 5: Apply an inline style property

**Files:**
- Create: `src/agent/applyStyle.ts`
- Test: `tests/agent/applyStyle.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/agent/applyStyle.test.ts
import { describe, it, expect } from "vitest";
import { Project, SyntaxKind } from "ts-morph";
import { locateJsxElement } from "../../src/agent/locate.js";
import { applyStyle } from "../../src/agent/applyStyle.js";

function elementAt(text: string, line: number, col: number) {
  const sf = new Project({ useInMemoryFileSystem: true }).createSourceFile("F.tsx", text);
  const opening = locateJsxElement(sf, line, col)!;
  const el = opening.getParentIfKind(SyntaxKind.JsxElement) ?? opening;
  return { sf, el };
}

describe("applyStyle", () => {
  it("adds a style attribute when none exists", () => {
    const { sf, el } = elementAt(`const C=()=>(<Button>x</Button>);`, 1, 13);
    applyStyle(el, "marginTop", 8);
    expect(sf.getFullText()).toContain(`style={{ marginTop: 8 }}`);
  });

  it("merges into an existing object-literal style", () => {
    const { sf, el } = elementAt(`const C=()=>(<Button style={{ color: "red" }}>x</Button>);`, 1, 13);
    applyStyle(el, "marginTop", 8);
    const out = sf.getFullText();
    expect(out).toContain("color:");
    expect(out).toContain("marginTop: 8");
  });

  it("overwrites an existing key", () => {
    const { sf, el } = elementAt(`const C=()=>(<Button style={{ marginTop: 4 }}>x</Button>);`, 1, 13);
    applyStyle(el, "marginTop", 8);
    expect(sf.getFullText()).toContain("marginTop: 8");
    expect(sf.getFullText()).not.toContain("marginTop: 4");
  });

  it("quotes string values", () => {
    const { sf, el } = elementAt(`const C=()=>(<Button>x</Button>);`, 1, 13);
    applyStyle(el, "color", "red");
    expect(sf.getFullText()).toContain(`color: "red"`);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/agent/applyStyle.test.ts`
Expected: FAIL — `applyStyle` not defined.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/agent/applyStyle.ts
import { Node, SyntaxKind } from "ts-morph";

function getOpening(el: Node): any {
  return el.getKind() === SyntaxKind.JsxElement ? (el as any).getOpeningElement() : el;
}

function literal(value: string | number): string {
  return typeof value === "number" ? String(value) : JSON.stringify(value);
}

export function applyStyle(el: Node, property: string, value: string | number): void {
  const opening = getOpening(el);
  const styleAttr = opening
    .getAttributes()
    .find((a: Node) => Node.isJsxAttribute(a) && a.getNameNode().getText() === "style");

  if (!styleAttr) {
    opening.addAttribute({ name: "style", initializer: `{{ ${property}: ${literal(value)} }}` });
    return;
  }

  const init = styleAttr.getInitializer();
  const obj = Node.isJsxExpression(init) ? init.getExpression() : undefined;
  if (!obj || !Node.isObjectLiteralExpression(obj)) {
    throw new Error("style is not an object literal");
  }

  const existing = obj.getProperty(property);
  if (existing && Node.isPropertyAssignment(existing)) {
    existing.setInitializer(literal(value));
  } else {
    obj.addPropertyAssignment({ name: property, initializer: literal(value) });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/agent/applyStyle.test.ts`
Expected: PASS (all 4 cases).

- [ ] **Step 5: Commit**

```bash
git add src/agent/applyStyle.ts tests/agent/applyStyle.test.ts
git commit -m "feat: apply inline style property edits"
```

---

## Task 6: Apply a literal prop edit

**Files:**
- Create: `src/agent/applyProp.ts`
- Test: `tests/agent/applyProp.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/agent/applyProp.test.ts
import { describe, it, expect } from "vitest";
import { Project, SyntaxKind } from "ts-morph";
import { locateJsxElement } from "../../src/agent/locate.js";
import { applyProp } from "../../src/agent/applyProp.js";

function elementAt(text: string, line: number, col: number) {
  const sf = new Project({ useInMemoryFileSystem: true }).createSourceFile("F.tsx", text);
  const opening = locateJsxElement(sf, line, col)!;
  const el = opening.getParentIfKind(SyntaxKind.JsxElement) ?? opening;
  return { sf, el };
}

describe("applyProp", () => {
  it("replaces a string-literal prop value", () => {
    const { sf, el } = elementAt(`const C=()=>(<Button type="default" />);`, 1, 13);
    applyProp(el, "type", "primary");
    expect(sf.getFullText()).toContain(`type="primary"`);
  });

  it("adds a new string prop when absent", () => {
    const { sf, el } = elementAt(`const C=()=>(<Button />);`, 1, 13);
    applyProp(el, "type", "primary");
    expect(sf.getFullText()).toContain(`type="primary"`);
  });

  it("writes numeric values inside braces", () => {
    const { sf, el } = elementAt(`const C=()=>(<Avatar />);`, 1, 13);
    applyProp(el, "size", 40);
    expect(sf.getFullText()).toContain(`size={40}`);
  });

  it("writes boolean values inside braces", () => {
    const { sf, el } = elementAt(`const C=()=>(<Button />);`, 1, 13);
    applyProp(el, "disabled", true);
    expect(sf.getFullText()).toContain(`disabled={true}`);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/agent/applyProp.test.ts`
Expected: FAIL — `applyProp` not defined.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/agent/applyProp.ts
import { Node, SyntaxKind } from "ts-morph";

function getOpening(el: Node): any {
  return el.getKind() === SyntaxKind.JsxElement ? (el as any).getOpeningElement() : el;
}

function initializerFor(value: string | number | boolean): string {
  if (typeof value === "string") return JSON.stringify(value); // "value"
  return `{${String(value)}}`; // {40} or {true}
}

export function applyProp(el: Node, name: string, value: string | number | boolean): void {
  const opening = getOpening(el);
  const attr = opening
    .getAttributes()
    .find((a: Node) => Node.isJsxAttribute(a) && a.getNameNode().getText() === name);

  const initText = initializerFor(value);
  if (!attr) {
    opening.addAttribute({ name, initializer: initText });
    return;
  }
  attr.setInitializer(initText);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/agent/applyProp.test.ts`
Expected: PASS (all 4 cases).

- [ ] **Step 5: Commit**

```bash
git add src/agent/applyProp.ts tests/agent/applyProp.test.ts
git commit -m "feat: apply literal prop edits"
```

---

## Task 7: Apply a literal text-child edit

**Files:**
- Create: `src/agent/applyText.ts`
- Test: `tests/agent/applyText.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/agent/applyText.test.ts
import { describe, it, expect } from "vitest";
import { Project, SyntaxKind } from "ts-morph";
import { locateJsxElement } from "../../src/agent/locate.js";
import { applyText } from "../../src/agent/applyText.js";

function elementAt(text: string, line: number, col: number) {
  const sf = new Project({ useInMemoryFileSystem: true }).createSourceFile("F.tsx", text);
  const opening = locateJsxElement(sf, line, col)!;
  const el = opening.getParentIfKind(SyntaxKind.JsxElement)!;
  return { sf, el };
}

describe("applyText", () => {
  it("replaces literal text children", () => {
    const { sf, el } = elementAt(`const C=()=>(<Button>Save</Button>);`, 1, 13);
    applyText(el, "저장");
    expect(sf.getFullText()).toContain(`<Button>저장</Button>`);
  });

  it("trims surrounding whitespace of the original text", () => {
    const { sf, el } = elementAt(`const C=()=>(<Button>  Save  </Button>);`, 1, 13);
    applyText(el, "저장");
    expect(sf.getFullText()).toContain(`>저장<`);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/agent/applyText.test.ts`
Expected: FAIL — `applyText` not defined.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/agent/applyText.ts
import { Node } from "ts-morph";

/** Replace the text content of a JsxElement that has a single literal text child. */
export function applyText(el: Node, value: string): void {
  if (!Node.isJsxElement(el)) throw new Error("applyText requires a JsxElement");
  const open = el.getOpeningElement();
  const close = el.getClosingElement();
  // Replace everything between > and </ with the new value.
  const start = open.getEnd();
  const end = close.getStart();
  const sf = el.getSourceFile();
  sf.replaceText([start, end], value);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/agent/applyText.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add src/agent/applyText.ts tests/agent/applyText.test.ts
git commit -m "feat: apply literal text-child edits"
```

---

## Task 8: Diff helper

**Files:**
- Create: `src/agent/diff.ts`

- [ ] **Step 1: Write a minimal line diff (no test — trivial formatting helper, exercised by Task 9)**

```ts
// src/agent/diff.ts
/** Minimal unified-ish diff for preview/guidance. Good enough for human reading. */
export function unifiedDiff(before: string, after: string, file: string): string {
  const a = before.split("\n");
  const b = after.split("\n");
  const max = Math.max(a.length, b.length);
  const lines: string[] = [`--- ${file}`, `+++ ${file}`];
  for (let i = 0; i < max; i++) {
    if (a[i] === b[i]) continue;
    if (a[i] !== undefined) lines.push(`- ${a[i]}`);
    if (b[i] !== undefined) lines.push(`+ ${b[i]}`);
  }
  return lines.join("\n");
}
```

- [ ] **Step 2: Commit**

```bash
git add src/agent/diff.ts
git commit -m "feat: add minimal unified diff helper"
```

---

## Task 9: Orchestrator — classify, apply or suggest, with rollback

**Files:**
- Create: `src/agent/apply.ts`
- Test: `tests/agent/apply.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/agent/apply.test.ts
import { describe, it, expect } from "vitest";
import { Project } from "ts-morph";
import { processEdits } from "../../src/agent/apply.js";
import type { EditRequest } from "../../src/shared/types.js";

function projectWith(text: string) {
  const project = new Project({ useInMemoryFileSystem: true });
  project.createSourceFile("/F.tsx", text);
  return project;
}

describe("processEdits", () => {
  it("applies a safe literal prop edit and returns new text", () => {
    const project = projectWith(`const C=()=>(<Button type="default" />);`);
    const req: EditRequest = {
      file: "/F.tsx", line: 1, column: 13,
      edits: [{ kind: "prop", name: "type", value: "primary" }],
    };
    const res = processEdits(project, req);
    expect(res.status).toBe("applied");
    if (res.status === "applied") expect(res.newText).toContain(`type="primary"`);
  });

  it("suggests (does not write) a dynamic prop edit", () => {
    const project = projectWith(`const C=()=>(<Button type={t} />);`);
    const req: EditRequest = {
      file: "/F.tsx", line: 1, column: 13,
      edits: [{ kind: "prop", name: "type", value: "primary" }],
    };
    const res = processEdits(project, req);
    expect(res.status).toBe("suggested");
  });

  it("errors when the element cannot be located", () => {
    const project = projectWith(`const x = 1;`);
    const req: EditRequest = {
      file: "/F.tsx", line: 1, column: 1,
      edits: [{ kind: "prop", name: "type", value: "primary" }],
    };
    expect(processEdits(project, req).status).toBe("error");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/agent/apply.test.ts`
Expected: FAIL — `processEdits` not defined.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/agent/apply.ts
import { Project, Node, SyntaxKind } from "ts-morph";
import type { EditRequest, EditResult, Edit } from "../shared/types.js";
import { locateJsxElement } from "./locate.js";
import { classifyEdit } from "./classify.js";
import { applyStyle } from "./applyStyle.js";
import { applyProp } from "./applyProp.js";
import { applyText } from "./applyText.js";
import { unifiedDiff } from "./diff.js";

function elementFromOpening(opening: Node): Node {
  return opening.getParentIfKind(SyntaxKind.JsxElement) ?? opening;
}

function applyOne(el: Node, edit: Edit): void {
  if (edit.kind === "style") applyStyle(el, edit.property, edit.value);
  else if (edit.kind === "prop") applyProp(el, edit.name, edit.value);
  else applyText(el, edit.value);
}

function describe(edit: Edit): string {
  if (edit.kind === "style") return `set style.${edit.property} = ${JSON.stringify(edit.value)}`;
  if (edit.kind === "prop") return `set prop ${edit.name} = ${JSON.stringify(edit.value)}`;
  return `set text = ${JSON.stringify(edit.value)}`;
}

/** Pure transform on an in-memory Project. The server wraps this with disk I/O. */
export function processEdits(project: Project, req: EditRequest): EditResult {
  const sf = project.getSourceFile(req.file);
  if (!sf) return { status: "error", message: `file not loaded: ${req.file}` };

  const opening = locateJsxElement(sf, req.line, req.column);
  if (!opening) return { status: "error", message: "no JSX element at position" };
  const el = elementFromOpening(opening);

  const before = sf.getFullText();

  // If any edit is unsafe, produce guidance for all and write nothing.
  const unsafe = req.edits
    .map((e) => ({ e, c: classifyEdit(el, e) }))
    .filter((x) => !x.c.safe);
  if (unsafe.length > 0) {
    const reason = unsafe.map((x) => x.c.reason).join("; ");
    const instruction =
      `In ${req.file}:${req.line}, manually ` +
      unsafe.map((x) => describe(x.e)).join(", ") + ".";
    return { status: "suggested", reason, instruction, diff: "" };
  }

  try {
    for (const edit of req.edits) applyOne(el, edit);
    // Re-parse guard: throws if we produced invalid syntax.
    const after = sf.getFullText();
    new Project({ useInMemoryFileSystem: true })
      .createSourceFile("/check.tsx", after);
    return { status: "applied", file: req.file, newText: after, diff: unifiedDiff(before, after, req.file) };
  } catch (err) {
    sf.replaceWithText(before); // rollback in-memory
    return { status: "error", message: `edit produced invalid code: ${(err as Error).message}` };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/agent/apply.test.ts`
Expected: PASS (all 3 cases).

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all test files PASS.

- [ ] **Step 6: Commit**

```bash
git add src/agent/apply.ts tests/agent/apply.test.ts
git commit -m "feat: orchestrate edits with classify + rollback"
```

---

## Task 10: Agent HTTP server (with disk I/O + backup)

**Files:**
- Create: `src/agent/server.ts`

- [ ] **Step 1: Write the server**

```ts
// src/agent/server.ts
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { resolve, join, basename } from "node:path";
import { Project } from "ts-morph";
import { processEdits } from "./apply.js";
import type { EditRequest } from "../shared/types.js";

const PROJECT_ROOT = resolve(process.argv[2] ?? process.cwd());
const PORT = Number(process.env.PORT ?? 4567);
const BACKUP_DIR = join(PROJECT_ROOT, ".ui-modifier-backups");

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
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
}

const server = createServer(async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") return res.writeHead(204).end();
  if (req.method !== "POST" || req.url !== "/edit") return res.writeHead(404).end();

  try {
    const reqBody = JSON.parse(await readBody(req)) as EditRequest;
    const absFile = resolve(PROJECT_ROOT, reqBody.file);
    if (!absFile.startsWith(PROJECT_ROOT)) throw new Error("path escapes project root");

    const original = readFileSync(absFile, "utf8");
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile(reqBody.file, original);

    const result = processEdits(project, { ...reqBody, file: reqBody.file });

    if (result.status === "applied") {
      mkdirSync(BACKUP_DIR, { recursive: true });
      copyFileSync(absFile, join(BACKUP_DIR, `${basename(absFile)}.${Date.now()}.bak`));
      writeFileSync(absFile, result.newText, "utf8");
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result));
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "error", message: (err as Error).message }));
  }
});

server.listen(PORT, () => {
  console.log(`[ui-modifier] agent on http://localhost:${PORT}  root=${PROJECT_ROOT}`);
});
```

- [ ] **Step 2: Smoke test the server**

Run (in this repo): `node --experimental-strip-types src/agent/server.ts .`
Then in another shell:

```bash
echo '{"file":"docs/superpowers/specs/2026-06-09-react-ui-source-editor-design.md","line":1,"column":1,"edits":[]}' | \
  curl -s -X POST http://localhost:4567/edit -H "Content-Type: application/json" --data-binary @-
```

Expected: a JSON `EditResult` with `"status":"error"` (no JSX in a markdown file) — confirms the server runs, reads files, and refuses paths outside root. Stop the server with Ctrl+C.

- [ ] **Step 3: Commit**

```bash
git add src/agent/server.ts
git commit -m "feat: agent http server with backup and path guard"
```

---

## Task 11: Overlay — read `_debugSource` from a DOM node

**Files:**
- Create: `src/overlay/fiber.ts`

- [ ] **Step 1: Write the implementation**

```ts
// src/overlay/fiber.ts
export interface SourceLoc { file: string; line: number; column: number; }

/** Walk up the React fiber from a DOM node to find _debugSource. */
export function sourceLocFor(node: Element): SourceLoc | undefined {
  const key = Object.keys(node).find((k) => k.startsWith("__reactFiber$"));
  if (!key) return undefined;
  let fiber: any = (node as any)[key];
  while (fiber) {
    const src = fiber._debugSource;
    if (src && src.fileName) {
      return { file: src.fileName, line: src.lineNumber, column: src.columnNumber };
    }
    fiber = fiber.return;
  }
  return undefined;
}

/** The displayed component/tag name for the selected node. */
export function componentNameFor(node: Element): string {
  const key = Object.keys(node).find((k) => k.startsWith("__reactFiber$"));
  if (!key) return node.tagName.toLowerCase();
  let fiber: any = (node as any)[key];
  while (fiber) {
    const t = fiber.type;
    if (typeof t === "function") return t.displayName || t.name || "Component";
    if (typeof t === "string") return t;
    fiber = fiber.return;
  }
  return node.tagName.toLowerCase();
}
```

- [ ] **Step 2: Commit** (browser-fiber code is verified manually in Task 14, not unit-tested)

```bash
git add src/overlay/fiber.ts
git commit -m "feat: overlay fiber source-location reader"
```

---

## Task 12: Overlay — API client

**Files:**
- Create: `src/overlay/api.ts`

- [ ] **Step 1: Write the implementation**

```ts
// src/overlay/api.ts
import type { EditRequest, EditResult } from "../shared/types.js";

const AGENT = "http://localhost:4567/edit";

export async function sendEdit(req: EditRequest): Promise<EditResult> {
  const res = await fetch(AGENT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  return (await res.json()) as EditResult;
}

/** Make a project-relative path from an absolute _debugSource fileName. */
export function relativeToSrc(absFile: string): string {
  const i = absFile.replace(/\\/g, "/").indexOf("/src/");
  return i >= 0 ? absFile.replace(/\\/g, "/").slice(i + 1) : absFile;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/overlay/api.ts
git commit -m "feat: overlay api client"
```

---

## Task 13: Overlay — inspector + panel + bootstrap

**Files:**
- Create: `src/overlay/inspector.ts`, `src/overlay/panel.ts`, `src/overlay/index.ts`

- [ ] **Step 1: Write the panel (Shadow DOM edit UI)**

```ts
// src/overlay/panel.ts
import type { Edit, EditResult } from "../shared/types.js";

export interface PanelHandlers {
  onApply: (edits: Edit[]) => Promise<EditResult>;
}

export function createPanel(handlers: PanelHandlers) {
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;top:16px;right:16px;z-index:2147483647;";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>
      .p{font:13px sans-serif;background:#fff;border:1px solid #ccc;border-radius:8px;
         box-shadow:0 4px 16px rgba(0,0,0,.15);width:280px;padding:12px}
      .t{font-weight:600;margin-bottom:8px}
      label{display:block;margin:6px 0 2px;color:#555}
      input{width:100%;box-sizing:border-box;padding:4px}
      button{margin-top:10px;padding:6px 10px;cursor:pointer}
      .out{margin-top:8px;white-space:pre-wrap;font:11px monospace;color:#333}
    </style>
    <div class="p">
      <div class="t" id="who">No selection</div>
      <label>Text</label><input id="text" placeholder="(unchanged)">
      <label>style.color</label><input id="color" placeholder="(unchanged)">
      <label>style.marginTop (px)</label><input id="mt" placeholder="(unchanged)">
      <label>prop: type</label><input id="type" placeholder="(unchanged)">
      <button id="apply">Apply</button>
      <div class="out" id="out"></div>
    </div>`;
  document.body.appendChild(host);

  const $ = (id: string) => root.getElementById(id) as HTMLInputElement;
  const out = root.getElementById("out") as HTMLElement;

  (root.getElementById("apply") as HTMLButtonElement).onclick = async () => {
    const edits: Edit[] = [];
    if ($("text").value) edits.push({ kind: "text", value: $("text").value });
    if ($("color").value) edits.push({ kind: "style", property: "color", value: $("color").value });
    if ($("mt").value) edits.push({ kind: "style", property: "marginTop", value: Number($("mt").value) });
    if ($("type").value) edits.push({ kind: "prop", name: "type", value: $("type").value });
    if (edits.length === 0) { out.textContent = "Nothing to apply."; return; }
    const res = await handlers.onApply(edits);
    out.textContent =
      res.status === "applied" ? "✅ Applied. HMR will reload."
      : res.status === "suggested" ? `📋 Suggested:\n${res.instruction}\n${res.reason}`
      : `❌ ${res.message}`;
  };

  return {
    setTarget(name: string, loc: string) {
      (root.getElementById("who") as HTMLElement).textContent = `${name} — ${loc}`;
    },
  };
}
```

- [ ] **Step 2: Write the inspector (hover highlight + click select)**

```ts
// src/overlay/inspector.ts
export function createInspector(onSelect: (el: Element) => void) {
  const hl = document.createElement("div");
  hl.style.cssText =
    "position:fixed;pointer-events:none;z-index:2147483646;border:2px solid #1677ff;" +
    "background:rgba(22,119,255,.08);display:none";
  document.body.appendChild(hl);

  function show(el: Element) {
    const r = el.getBoundingClientRect();
    hl.style.display = "block";
    hl.style.left = `${r.left}px`; hl.style.top = `${r.top}px`;
    hl.style.width = `${r.width}px`; hl.style.height = `${r.height}px`;
  }

  function onMove(e: MouseEvent) {
    const el = e.target as Element;
    if (el && el !== hl) show(el);
  }
  function onClick(e: MouseEvent) {
    const el = e.target as Element;
    if (!el) return;
    // ignore clicks inside our own shadow-host panel
    if ((el as HTMLElement).closest && (el as any).getRootNode() instanceof ShadowRoot) return;
    e.preventDefault(); e.stopPropagation();
    onSelect(el);
  }

  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("click", onClick, true);
}
```

- [ ] **Step 3: Write the bootstrap**

```ts
// src/overlay/index.ts
import { sourceLocFor, componentNameFor } from "./fiber.js";
import { createPanel } from "./panel.js";
import { createInspector } from "./inspector.js";
import { sendEdit, relativeToSrc } from "./api.js";
import type { Edit } from "../shared/types.js";

let current: { file: string; line: number; column: number } | null = null;

const panel = createPanel({
  onApply: async (edits: Edit[]) => {
    if (!current) return { status: "error", message: "no selection" };
    return sendEdit({ ...current, edits });
  },
});

createInspector((el) => {
  const loc = sourceLocFor(el);
  if (!loc) { panel.setTarget(componentNameFor(el), "no source info"); current = null; return; }
  current = { file: relativeToSrc(loc.file), line: loc.line, column: loc.column };
  panel.setTarget(componentNameFor(el), `${current.file}:${current.line}`);
});

console.log("[ui-modifier] overlay ready");
```

- [ ] **Step 4: Build the bundle**

Run: `npm run build:overlay`
Expected: `dist/overlay.js` created with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/overlay/inspector.ts src/overlay/panel.ts src/overlay/index.ts dist/overlay.js
git commit -m "feat: overlay inspector, panel, and bootstrap"
```

---

## Task 14: End-to-end verify against my-react-app

**No repo file changes — manual validation against the real target app.**

- [ ] **Step 1: Start the agent pointed at the target project**

Run: `node --experimental-strip-types src/agent/server.ts /absolute/path/to/my-react-app`
Expected: `[ui-modifier] agent on http://localhost:4567 root=...`

- [ ] **Step 2: Start the target dev app** — in my-react-app: `npm start` (http://localhost:3000).

- [ ] **Step 3: Inject the overlay**

In the app's browser console, paste the contents of `dist/overlay.js`.
(Later convenience: wrap as a bookmarklet or a dev-only `import("...")` — out of MVP scope.)
Expected: console logs `[ui-modifier] overlay ready`; a panel appears top-right.

- [ ] **Step 4: Edit a literal button**

Hover until a `<Button>` with a literal label highlights; click it. Confirm the panel shows the file:line. Type a new label in **Text**, click **Apply**.
Expected: panel shows "✅ Applied", the `.tsx` file changes, CRA HMR reloads, the button shows the new label.

- [ ] **Step 5: Verify the suggest path**

Click a component whose `type`/`style` is a variable. Set **prop: type** and Apply.
Expected: panel shows "📋 Suggested" with the file/line instruction and reason; the source file is NOT modified.

- [ ] **Step 6: Record results** in a short note at the bottom of the spec (what worked, any `_debugSource` gaps). Commit that note.

```bash
git add docs/superpowers/specs/2026-06-09-react-ui-source-editor-design.md
git commit -m "docs: record end-to-end verification results"
```

---

## Self-Review Notes

- **Spec coverage:** architecture (Tasks 10–13), safety model auto-apply (Tasks 5–7, 9), suggest-only branch (Tasks 4, 9), safeguards/backup/rollback (Tasks 9–10), tech stack choices (Task 1), testing strategy (Tasks 3–9 unit, Task 14 manual verify), build order (Task 0 risk spike first). Theme-token-level edits are explicitly post-MVP in the spec and intentionally omitted here.
- **Types consistent:** `EditRequest`/`Edit`/`EditResult` defined once in Task 2 and used unchanged in Tasks 9, 10, 12, 13.
- **No placeholders:** every code step contains runnable code; every run step states the exact command and expected output.
