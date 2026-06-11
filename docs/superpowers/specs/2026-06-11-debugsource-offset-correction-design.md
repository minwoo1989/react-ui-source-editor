# `_debugSource` Line-Offset Correction — Design

**Date:** 2026-06-11
**Status:** approved, awaiting implementation plan
**Branch:** `feat/overlay-bookmarklet-delivery`

## Problem

The overlay's click-to-edit loop reads React's `fiber._debugSource`
(`{fileName, lineNumber, columnNumber}`) to learn which source file + position
the clicked element came from, then sends that to the agent's `/inspect` and
`/edit` routes. On a **Vite dev server with `@vitejs/plugin-react`**, the
reported `lineNumber` is wrong: `@vitejs/plugin-react` prepends a react-refresh
preamble to every JSX module *before* the JSX dev transform computes positions,
so every `_debugSource` line is shifted down by the preamble's line count. The
overlay passes the line through verbatim (`src/overlay/fiber.ts`), so the agent
locates the wrong element — often an empty/garbage position — and click-to-edit
is unusable on the stock Vite dev stack. The file path and column are correct;
only the line is off.

This blocker is independent of the bookmarklet-delivery and style/class-editing
features on this branch; it is a pre-existing defect in how the overlay trusts
`_debugSource`. It surfaced during the 2026-06-11 browser verification
(`docs/superpowers/specs/2026-06-10-style-class-editing-and-abs-path-design.md`).

## Empirical findings (measured 2026-06-11)

Probe against `D:\Projects\test\test-multi-window` (vite 5.4.21, plugin-react
4.7.0, react 18.3.1), comparing true source positions to reported `_debugSource`:

| File | Element | True (line,col) | Reported (line,col) | Line offset | Column |
|---|---|---|---|---|---|
| App.tsx | `<div inset:0>` | 57, 5 | 76, 5 | +19 | preserved |
| App.tsx | `<FloatingBar` | 58, 7 | 77, 7 | +19 | preserved |
| App.tsx | `<WindowToggleBar` | 65, 7 | 84, 7 | +19 | preserved |
| App.tsx | `<PerfOverlay` | 69, 7 | 88, 7 | +19 | preserved |
| App.tsx | `<Inner/>` | 77, 7 | 96, 7 | +19 | preserved |
| App.tsx | `<PerfProvider>` | 76, 5 | 95, 5 | +19 | preserved |
| FloatingBar.tsx | `<div>` | 15, 5 | 34, 5 | +19 | preserved |
| FloatingBar.tsx | `<Segmented` | 22, 7 | 41, 7 | +19 | preserved |

Conclusions that drive the design:

1. **The offset is constant within a file** — App.tsx is +19 for six elements
   spanning two components, so TS-type-stripping does not introduce intra-file
   variance here.
2. **The offset is the same +19 across files** — it is the react-refresh
   preamble length (a fixed plugin template). **But it is coupled to the
   plugin/bundler version**, so hard-coding it is fragile.
3. **The column is always exactly preserved** (5→5, 7→7, no exceptions). This is
   the key lever for a mechanism-agnostic correction.
4. Inline sourcemaps are served on every transformed module, but
   `_debugSource.lineNumber` is babel's *input* line (original + preamble), not
   the served *output* position, so the served sourcemap does not map it
   directly. Sourcemap reverse-mapping is therefore not a usable path.

## Goal

Make click-to-inspect/edit target the correct JSX element on the Vite dev stack,
**without hard-coding the offset**, so the fix survives plugin/bundler version
bumps and other transforms (e.g. SWC).

## Chosen approach: agent-side tolerant resolver (column + tag, nearest line)

Rejected alternatives (decided with the user):

- **Constant offset subtraction (`line - 19`)** — works today, breaks on any
  plugin/bundler change. Rejected as too fragile.
- **Sourcemap reverse-mapping** — does not apply (finding #4).
- **Sending the whole ancestor fiber chain so the agent solves the offset** —
  more robust against the ambiguity below, but heavier overlay payload/logic;
  rejected as over-engineering for the common case.

The agent is the only side that holds the true original source (it reads it for
`/inspect` and `/edit`). It corrects the position there, so both routes are
fixed by one shared change.

### Resolver algorithm — `resolveJsxElement(sf, line, column, tag?)`

Replaces the current exact-only `locateJsxElement(sf, line, column)` in
`src/agent/locate.ts`. Both `inspect.ts` and `apply.ts` call it.

1. **Exact phase (unchanged behavior, offset-0 path):** the current
   `getPositionOfLineAndCharacter` → walk up to the enclosing
   `JsxOpeningElement`/`JsxSelfClosingElement`. If it lands on one and (`tag` is
   absent **or** its tag-name text matches `tag`), return it. This keeps correct
   behavior when `_debugSource` is accurate (non-Vite, SWC, or a future-fixed
   transform) — zero change there.
2. **Tolerant phase (exact fails):** enumerate all `JsxOpeningElement` +
   `JsxSelfClosingElement` in the file; for each, take its start `(line, col)`
   (col = the `<`, which `_debugSource.columnNumber` matches per finding #3).
   - **Candidates** = elements with `col === column`.
   - If `tag` is given, prefer the subset whose tag-name text equals `tag`; if
     that subset is empty, fall back to all column matches. (The soft fallback
     handles member-expression tags like `Typography.Text` and antd wrappers
     whose runtime fiber name differs from the source identifier.)
   - Among candidates with `line <= reportedLine` (the offset is positive):
     **exactly one → return it**; **several → return the closest from below**
     (best-effort); **none → return `undefined`**.

`tag`-name text comes from `node.getTagNameNode().getText()` (`"div"`,
`"FloatingBar"`, `"Typography.Text"`).

## Wire protocol + overlay changes

- `src/shared/types.ts`: add optional `tag?: string` to `InspectRequest` and
  `EditRequest`.
- `src/overlay/fiber.ts`: return the **same fiber's** `type` name (string tag for
  host elements; `displayName`/function name for composites) alongside the
  existing `_debugSource` loc, so the tag belongs to the element that produced
  the loc.
- `src/overlay/panel.ts` + `index.ts`: `PanelTarget` gains `tag`; thread it into
  both the inspect and edit request bodies.
- `src/overlay/api.ts`: unchanged — it already forwards the whole request body.
- `src/agent/server.ts`: pass `body.tag` into the resolver for both routes.

## Error behavior

When the resolver returns `undefined`, both `/inspect` and `/edit` return an
explicit `{status: "error", message: "no <tag> JSX element near line N"}`
(falling back to a generic message when `tag` is absent). This fixes the
advisor-flagged case where an out-of-position lookup returned a silent empty
`ok` instead of a visible error — the panel now always shows why nothing
resolved.

## Edge cases / backward compatibility

- Requests without `tag` still work via the column-only tolerant match.
- `_debugSource` absent (production builds, non-instrumented) → the click yields
  no loc and the panel shows "no source info", as today. Click-to-edit is a
  dev-only capability; unchanged.

## Known limitation (accepted)

A single click carries one data point, so the resolver cannot disambiguate two
JSX elements that share **both** the same opening column **and** the same tag
name within the offset window (~19 lines) above the reported line. In that case
it best-guesses the nearest match from below. This is rare in practice — clicks
land on distinctive elements, and per-component root elements are typically
unique by (column, tag). Eliminating it would require sending the ancestor chain
(the rejected approach), which is out of scope. A narrow superset of the same shape: in the column-only fallback (tag absent or unmatched), a same-column element whose tag text coincidentally equals the clicked element's runtime name and sits above it can be preferred over the true twin — same rarity, same nearest-below best-guess.

## Testing

**Unit (the substance; no browser) — `tests/agent/locate.test.ts`:**
- Exact match still resolves when `_debugSource` is accurate (offset 0).
- Shifted line + correct column + tag resolves to the true element, for several
  arbitrary offsets (e.g. +19, +16) — proving mechanism-independence.
- Column-only fallback resolves when `tag` is a member expression / unknown.
- Repeated identical `(column, tag)` pins the documented nearest-below behavior.
- No column match → `undefined`.

Fixtures are synthetic source strings with known JSX positions; assertions check
the resolved node's true line.

**Regression (browser):** re-run `verify-overlay.mjs` **without** the line-34
workaround used in the prior verification — click the real FloatingBar `<div>`
(true line 15) and confirm the panel inspects line 15 with correct style rows
and that the edit → Apply → HMR loop works end to end.

## Out of scope (YAGNI)

- Ancestor-chain offset solving.
- Fixing the upstream `@vitejs/plugin-react` transform.
- Production / non-dev support for click-to-edit.
- Any change to the bookmarklet-delivery or style/class-editing features.

## Verification (2026-06-11)

**Automated gate:** `npx vitest run` — 85/85 across 11 files (incl. the new
`resolveJsxElement` suite and shifted-line inspect tests). `npx tsc --noEmit` —
clean. `npm run build:overlay` rebuilt `dist/overlay.js` (12.4 kb, committed).

**Browser regression** (Playwright + Chromium, against
`D:\Projects\test\test-multi-window`, vite 5.4.21 + plugin-react 4.7.0, agent on
4567): clicked the **real** FloatingBar `<div>` (true source line 15) — no
line-34 workaround. Before the fix this inspected line 34 with an empty style
list. After the fix:

- Panel header reads `div — FloatingBar.tsx:15` (was `:34`) — the resolved line
  now surfaces in the UI.
- `/inspect` returned the FloatingBar div's 12 real style rows (`position:fixed`,
  `top:12`, `background:#fff`, `boxShadow:…`, etc.), confirming the agent
  resolved the correct element from the shifted line + preserved column (5) +
  tag (`div`).
- Edited `background` → `#ffe4c4`, Apply → `✅ Applied`; Vite HMR repainted the
  live element (computed `background-color: rgb(255,228,196)`); the on-disk
  `FloatingBar.tsx` contained `#ffe4c4`.

A latent gap surfaced during verification and was fixed in the same branch: the
panel header had displayed the raw `_debugSource` line; `InspectOk` now carries
the resolved `line` and the panel renders it (commit `e22c9d3`). Target app
restored; verification scripts removed; ports freed.
