# General Prop Editing — Design

**Date:** 2026-06-12
**Status:** approved, awaiting implementation plan
**Feature:** #6 of the improvement series

## Problem

The panel only edits `style`, `className`, and `text`. The 2026-06-10 work
deliberately dropped the old generic prop input. The agent, however, already
applies arbitrary props: `applyProp` writes any attribute (string → `"v"`,
number/boolean → `{v}`) and `classifyEdit` already classifies `{kind:"prop"}`
edits for string / literal-expression / boolean / new attributes. The only gap
is the **read side and the UI**: `inspect` surfaces only `className`, and the
panel has no general prop editor. This restores editing of other props.

## Goal

Surface an element's editable props in the panel and let the user change
existing literal props and add new ones, preserving each value's original kind
(a string prop stays a string; a `{number}`/`{boolean}` stays an expression).
Dynamic/expression props are shown read-only. No prop removal (out of scope).

## Scope of surfaced attributes

`inspect` returns all `JsxAttribute`s **except**: `style` and `className`
(handled by their own fields), `key`/`ref` (React-special), `css` (emotion —
`classifyEdit` blocks edits when present anyway), and `on*` event handlers.
`JsxSpreadAttribute` (`{...x}`) is skipped (no name, not editable).

## Components

### `src/shared/types.ts`

```ts
export interface InspectPropEntry {
  name: string;
  value: string;     // display string; for round-trip, see `isExpr`
  editable: boolean; // false for dynamic expressions (shown read-only)
  isExpr: boolean;   // true when the source value was `{…}` (number/boolean/dynamic)
}
```

Add `props: InspectPropEntry[]` to `InspectOk`. `Edit`'s `{kind:"prop"}` is unchanged.

### `src/agent/inspect.ts`

Add a `propEntries(opening)` that reads the opening element's `JsxAttribute`s,
filters out the excluded names (above) and spreads, and maps each:

- string literal `p="x"` → `{name:"p", value:"x", editable:true, isExpr:false}`
- numeric/boolean literal expr `p={42}` / `p={true}` → `{value:"42"/"true", editable:true, isExpr:true}`
- boolean shorthand `p` (no initializer) → `{value:"true", editable:true, isExpr:true}`
- dynamic expr `p={foo}` → `{value:<raw text>, editable:false, isExpr:true}`

Return it as `props` on the ok result. `className`/`style`/`text` handling is unchanged.

### `src/overlay/editsDiff.ts`

- New `parsePropValue(raw): string | number | boolean` — `"true"`→`true`,
  `"false"`→`false`, numeric→`Number`, else the trimmed string.
- `PanelState` gains `props: PropRowState[]` (`{ name; value; editable; isExpr }`)
  and `addedProps: { name: string; value: string }[]`.
- `buildEdits` emits, after the existing className/text logic:
  - for each editable existing prop whose value changed →
    `{ kind:"prop", name, value: row.isExpr ? parsePropValue(row.value) : row.value }`
    (string props round-trip verbatim — `type="true"` stays the string `"true"`;
    only `{…}` props are parsed to number/boolean).
  - for each added prop with non-empty name+value →
    `{ kind:"prop", name: name.trim(), value: parsePropValue(value) }`.
  - read-only (`!editable`) rows are skipped.

### `src/overlay/panel.ts`

Add a **props** section between `style` and `className`:
- A `propRow(name, value, editable)` (name input disabled, value input;
  disabled when not editable) — mirrors `styleRow` but with **no remove button**.
- An "add prop" row: `<input id="newpk" placeholder="prop">` +
  `<input id="newpv" placeholder="value">`.
- `render()` populates prop rows from `res.props` (carrying `isExpr` via a data
  attribute on the row so `collectState` can read it back).
- `collectState()` gathers `props` (from the rows, including `isExpr`) and
  `addedProps` (from `newpk`/`newpv`).
- `clearEditors()` also clears the prop rows + the add-prop inputs.

### Agent apply path

No change. `applyProp` (string → quoted, number/boolean → `{…}`) and
`classifyEdit`'s `prop` branch already handle every case the panel can emit.

## Data flow

`/inspect` → `props[]` rendered as rows → user edits/adds → `buildEdits` →
`{kind:"prop", …}` edits → `/edit` → `applyProp` writes each → HMR.

## Error handling / edge cases

- Read-only (dynamic) props render greyed and are skipped by `buildEdits`.
- A string prop whose text is `"true"`/`"42"` stays a string because `isExpr`
  is false (kind preserved); only `{…}` props parse to boolean/number.
- Adding a prop that already exists → `applyProp` overwrites it (existing
  behavior); not specially guarded.
- `classifyEdit` still blocks the whole apply when `css` is present or the
  element is inside `.map()` (unchanged safety net).

## Testing

- **Unit — `tests/agent/inspect.test.ts`:** props surfaced — string (editable,
  `isExpr:false`), `{number}`/`{true}` (editable, `isExpr:true`), boolean
  shorthand (editable, value `"true"`), dynamic `{x}` (read-only); `style`,
  `className`, `key`, `onClick` excluded.
- **Unit — `tests/overlay/editsDiff.test.ts`:** `parsePropValue` (true/false/
  number/string); `buildEdits` — changed string prop → string value; changed
  `isExpr` prop → parsed number/boolean; added prop → parsed; unchanged → no
  edit; read-only row → no edit.
- **Browser smoke:** click an antd element with props (e.g. a `<Button size=…
  type=…>`); change an existing prop value and add a new one; Apply → HMR
  reload + on-disk source reflects both.

## Out of scope (YAGNI)

- Prop removal (no `propRemove` edit kind / ✕ button).
- Editing event handlers, `key`/`ref`, `css`, or spread attributes.
- Folding `className` into the generic prop list (kept as its own field).
- Feature #7 (the `jsxNodes.ts` helper refactor).

## Verification (2026-06-12)

**Automated gate:** `npx vitest run` — 125/125 (inspect prop-surfacing tests +
`parsePropValue`/`buildEdits` prop tests). `npx tsc --noEmit` — clean.
`npm run build:overlay` rebuilt `dist/overlay.js` (committed). The agent
apply path (`applyProp`/`classify`) was left untouched.

**Browser smoke (Playwright + Chromium)** against `D:\Projects\test\test-multi-window`:
clicking a FloatingBar icon button resolves (via `_debugSource`) to the inner
`<MinusOutlined/>` (no props); pressing the **↑** nav button (feature #5) climbs
to the wrapping `<Button>`, whose `size` prop then appears in the new **props**
section. Editing `size` → `large` and adding a new `data-test="x"` prop, then
Apply, produced on disk: `size="large": true` and `data-test="x": true`.
Confirms existing-prop edit + new-prop add round-trip through the panel to the
source file (and exercises #5 + #6 together). Target file restored; smoke script
removed; servers stopped; ports freed.
