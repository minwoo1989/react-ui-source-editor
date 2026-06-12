# Extract shared JSX node helpers (`jsxNodes.ts`) — Design

**Date:** 2026-06-12
**Status:** approved, awaiting implementation plan
**Feature:** #7 of the improvement series (tech-debt cleanup)

## Problem

`getOpening(el)` is duplicated in four agent modules (`applyProp.ts`,
`applyStyle.ts`, `classify.ts`, `inspect.ts`) and the "find a JsxAttribute by
name" logic exists as two `getAttribute` copies (`classify.ts`, `inspect.ts`)
plus inline `.getAttributes().find(...)` in `applyStyle.ts`. This is the
"known limitation #2" recorded in the 2026-06-10 spec.

## Goal

Extract the shared helpers into one module and have all consumers import them.
**Pure refactor — no behavior change.** The existing test suite is the safety net.

## Component

### `src/agent/jsxNodes.ts` (new)

```ts
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

The `any` return on `getOpening` matches the existing code (it is used for
`.getAttributes()` / `.addAttribute()` which are not on the generic `Node`),
keeping the extraction zero-change. `getAttribute` takes the element **or** an
opening node — `getOpening` is idempotent on an opening, so existing
`getAttribute(opening, name)` call sites keep working.

## Migration

- `src/agent/applyStyle.ts`: delete the local `getOpening`; import both helpers;
  keep `const opening = getOpening(el)` (needed for `opening.addAttribute(...)`);
  replace each inline `opening.getAttributes().find(... "style" ...)` (in
  `applyStyle` and `removeStyle`) with `getAttribute(el, "style")`.
- `src/agent/applyProp.ts`: delete the local `getOpening`; import both helpers;
  use `getOpening(el)` for `addAttribute` and `getAttribute(el, name)` for the
  existing-attr lookup.
- `src/agent/classify.ts`: delete the local `getOpening` and `getAttribute`;
  import them.
- `src/agent/inspect.ts`: delete the local `getOpening` and `getAttribute`;
  import them. (Its `getAttribute(op, name)` calls still work — `getOpening`
  is idempotent on an opening node.)

No change to function signatures, behavior, or any other file.

## Testing

- The existing **125-test suite** exercises `applyStyle`, `removeStyle`,
  `applyProp`, `classifyEdit`, and `inspectJsxElement` — it must stay fully green
  through the refactor (that is the primary safety net).
- A small **`tests/agent/jsxNodes.test.ts`** directly covers the extracted
  helpers: `getOpening` returns the opening element for a `JsxElement` and the
  node itself for a self-closing element; `getAttribute` finds an existing
  attribute by name and returns `undefined` for an absent one.

## Out of scope (YAGNI)

- Changing the helper signatures or tightening the `any` return type.
- Touching the overlay bundle (these are agent-only modules, not bundled) — no
  `build:overlay`, no browser smoke (behavior is unchanged).
- Any further consolidation beyond `getOpening`/`getAttribute`.
