# JSX Tree Navigation (parent ↑ / child ↓) — Design

**Date:** 2026-06-12
**Status:** approved, awaiting implementation plan
**Feature:** #5 of the improvement series

## Problem

Clicking a DOM element selects the nearest source-bearing ancestor fiber
(`sourceLocFor` walks `.return` to the first `_debugSource`). When the clicked
element is not the one the user wants to edit — they want a wrapping
parent/component, or a specific child — there is no way to move the selection
through the JSX tree.

## Goal

Two panel buttons, **↑ (parent)** and **↓ (child)**, that move the selection to
the adjacent source-bearing JSX element, re-inspect it, and highlight it. Buttons
disable at the tree boundaries. Navigation unit = a React fiber that carries
`_debugSource` (i.e. an editable JSX element).

## Architecture

Keep the existing separation: **`index.ts` owns the React-fiber work; the panel
stays fiber/DOM-agnostic and only receives `{file,line,column,tag}`.** The panel's
↑/↓ buttons invoke an `onNavigate(dir)` handler supplied by `index.ts`, which
holds the currently-selected fiber, computes the adjacent fiber, then re-inspects
and re-highlights.

## Components

### `src/overlay/fiber.ts` (extend — pure logic, unit-tested with mock fibers)

A minimal `Fiber`-ish shape is `{ type, _debugSource?, return?, child?, sibling?, stateNode? }`.

- `fiberOf(node: Element): Fiber | undefined` — read the `__reactFiber$…` key.
- `nearestSourceFiber(fiber): Fiber | undefined` — from `fiber` upward via
  `.return` (inclusive), the first with a truthy `_debugSource.fileName`.
- `parentSourceFiber(fiber): Fiber | undefined` — from `fiber.return` upward, the
  first source-bearing fiber whose loc **differs** from `fiber`'s.
- `childSourceFiber(fiber): Fiber | undefined` — depth-first over the subtree
  (`.child` then `.sibling`), the first source-bearing fiber whose loc differs
  from `fiber`'s.
- `locOf(fiber): SourceLoc | undefined` — `{ file, line, column, tag }` from
  `_debugSource` + the fiber's type name (reuses the existing `fiberTypeName`).
- `domNodeOf(fiber): Element | undefined` — `fiber.stateNode` when it is an
  Element, else the nearest host descendant's element (DFS), for the highlight box.
- `nameOf(fiber): string` — display name (the current `componentNameFor` logic,
  generalized to take a fiber).

The existing `sourceLocFor(node)` / `componentNameFor(node)` are re-expressed in
terms of these (click handler: `fiberOf(el)` → `nearestSourceFiber` → the helpers).

### `src/overlay/inspector.ts` (expose highlight)

`createInspector(onSelect, ignore)` currently keeps its highlight box `hl`
private. Change it to **return** `{ highlight(el: Element): void; hide(): void }`
so navigation can highlight a programmatically-selected element (hover behavior
unchanged).

### `src/overlay/panel.ts`

- Add **↑ (id `nav-up`)** and **↓ (id `nav-down`)** buttons, both `disabled`.
- `PanelHandlers` gains `onNavigate(dir: "up" | "down"): void`.
- Add a `setNav(canUp: boolean, canDown: boolean)` method on the returned object
  (sets each button's `.disabled`).
- `setTarget(name, null)` disables both nav buttons.

### `src/overlay/index.ts`

- Hold `let current: Fiber | undefined`.
- `selectFiber(fiber)`: set `current`; `inspector.highlight(domNodeOf(fiber))`
  (skip if none); `panel.setTarget(nameOf(fiber), locOf(fiber) ?? null)`;
  `panel.setNav(!!parentSourceFiber(fiber), !!childSourceFiber(fiber))`.
- Click handler: `const f = nearestSourceFiber(fiberOf(el)); if (f) selectFiber(f)
  else panel.setTarget(<dom tag name>, null)`.
- `onNavigate(dir)`: from `current`, pick `parentSourceFiber`/`childSourceFiber`;
  if found, `selectFiber(next)`; else no-op (button is already disabled).

## Data flow

click → `fiberOf` → `nearestSourceFiber` → `selectFiber` (highlight + inspect +
nav-state). ↑/↓ → `parent/childSourceFiber(current)` → `selectFiber`.

## Error handling / edge cases

- At a boundary (no parent/child source fiber) the corresponding button is
  disabled; `onNavigate` is a no-op.
- Composite fiber (no host `stateNode`) → highlight uses the nearest host
  descendant's rect; if none, skip highlight (inspect still works).
- After an edit → HMR reload (or any re-render) the retained `current` fiber can
  be stale; re-clicking resets it. Accepted; navigation is meant for a single
  pre-edit selection session.
- `_debugSource` absent on the whole subtree (production) → click yields no
  source; nav buttons disabled — unchanged dev-only behavior.

## Testing

- **Unit — `tests/overlay/fiberNav.test.ts`:** build mock fiber graphs
  (`{type,_debugSource,return,child,sibling,stateNode}`) and assert:
  - `parentSourceFiber` skips non-source fibers and same-loc fibers, returns the
    next distinct source ancestor; `null` at the root.
  - `childSourceFiber` returns the depth-first first distinct source descendant;
    `null` when none.
  - `locOf` maps `_debugSource` + type → `{file,line,column,tag}`.
  - `nameOf` returns host tag / composite displayName/name.
  - `domNodeOf` returns the element `stateNode`, or the nearest host descendant.
- **Browser smoke:** click a deep element (e.g. the `<Segmented>` inside
  FloatingBar); press ↑ to reach the FloatingBar `<div>` then the `<FloatingBar>`
  usage in App.tsx (highlight + panel `who`/rows update each step); press ↓ to
  descend again; confirm the ↑/↓ `disabled` states at the top/leaf boundaries.

## Out of scope (YAGNI)

- Sibling navigation (← →); a breadcrumb/tree view; keyboard shortcuts.
- Choosing among multiple children (↓ always takes the depth-first first match).
- Persisting the selected fiber across HMR reloads.
- Features #6–#7.
