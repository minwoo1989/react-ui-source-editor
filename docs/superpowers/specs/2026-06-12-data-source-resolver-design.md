# Version-Independent Source Resolver (`data-source-*`) — Design

**Date:** 2026-06-12
**Status:** approved, awaiting implementation plan
**Feature:** the "universal" item (React-19 support)

## Problem

The overlay maps a clicked DOM element to its source location by walking the
React fiber tree and reading `fiber._debugSource`. **React 19 removed
`_debugSource`**, so the tool cannot locate elements on React 19+ at all. A
runtime fix is impossible for a bookmarklet (the overlay is injected *after* the
app has rendered, so the `jsxDEV(..., source)` calls that carry source info have
already run). The version-independent fix is to inject the source location at
**build time** as DOM attributes the overlay can read.

## Goal

Click → inspect → edit works on **any React version** when a small build-time
Babel plugin is enabled in the target app, while **React ≤18 keeps working with
zero target setup** (the existing `_debugSource` path). The deliverable is a
**Babel plugin** (toolchain-agnostic) plus a documented wiring path and a README.

## Approach (chosen)

A self-contained Babel plugin injects `data-source-file/line/column` onto host
JSX elements. The overlay reads the nearest such DOM ancestor when fibers carry
no source. Babel is the portable layer — the same plugin works in any toolchain
that runs Babel; only the wiring location differs. SWC-only toolchains
(`@vitejs/plugin-react-swc`, Next.js default) do **not** run Babel plugins and
are out of scope (a future SWC plugin).

## Components

### `src/plugin/sourceAttrs.ts` (new — the Babel plugin)

A standard Babel `PluginObj` visiting `JSXOpeningElement`:

- Only **host elements** (tag is a `JSXIdentifier` starting lowercase, e.g.
  `div`/`span`/`button`). Composite components (`<FloatingBar>`) and
  member/namespaced tags are skipped — an attribute on a composite is a prop that
  does not reliably reach the DOM.
- Adds, when absent, `data-source-file` = `state.filename` (absolute path),
  `data-source-line` = `node.loc.start.line`, `data-source-column` =
  `node.loc.start.column + 1` (1-based, at the `<` — matching the agent's column
  convention and `_debugSource`). Skips an element that already has the attrs.
- No-op when `node.loc` is absent.

### Packaging + wiring

- `npm run build:plugin` — esbuild `src/plugin/sourceAttrs.ts` →
  `dist/sourceAttrs.mjs` (ESM default export of the plugin function).
- Target apps enable it in their **build config** (dev only — the absolute paths
  must not ship to production):
  - **Vite** (`@vitejs/plugin-react`, Babel-based):
    `react({ babel: { plugins: [sourceAttrs] } })`.
  - **webpack + babel-loader / Rollup + @rollup/plugin-babel / CRA(craco)**: add
    `sourceAttrs` to that toolchain's Babel `plugins`.
- `@babel/core` (+ `@types/babel__core`) added as **devDependencies** of this
  repo (for authoring + the plugin's unit test; the runtime Babel is the target's).

### Overlay resolution — `src/overlay/fiber.ts` + `src/overlay/index.ts`

- New `locFromDataAttr(el: Element): SourceLoc | undefined` — reads
  `el.closest("[data-source-file]")`; returns `{ file, line, column, tag }` where
  `tag` is the host element's `tagName.toLowerCase()`; `undefined` when no such
  ancestor or missing data.
- **Resolution order in the click handler: fiber first, data-attr fallback.**
  `nearestSourceFiber(fiberOf(el))` (React ≤18, keeps tree navigation) → if none,
  `locFromDataAttr(el)` (React 19+). If neither, `setTarget(tag, null)`.
- A debug/test toggle `window.__uiModifierForceDataSource`: when truthy, the
  fiber lookup is skipped so resolution goes straight to `locFromDataAttr`. This
  lets the data-attr (React-19) path be exercised on any React version — used by
  the fiber-independence smoke. Documented in the README as a debug aid.
- New `selectLoc(loc, el)` in `index.ts` (the data-attr path): highlight `el`,
  `panel.setTarget(loc.tag, loc)`, `panel.setNav(false, false)` — there is no
  fiber, so tree navigation is disabled in this mode. `selectFiber` (fiber mode)
  is unchanged.

### Agent

**Unchanged.** It receives `{file, line, column, tag}` and resolves with the
existing tolerant resolver. A build-injected line may be exact or preamble-
shifted (same as `_debugSource`); either way the column + tag resolver handles it.

### README (`README.md`, new — required)

Document: what the tool is and the agent + bookmarklet quick start; the **React
≤18 (zero-config)** vs **React 19+ (add the Babel plugin)** split; per-bundler
wiring (Vite, webpack/babel-loader, Rollup) with the dev-only caveat; the
support matrix (Babel toolchains ✅ / SWC + Next default ❌ future); and known
limitations (tree navigation is fiber-mode/React ≤18 only).

## Data flow (React 19, data-attr mode)

build: Babel plugin stamps `data-source-*` on host elements → click → fiber has
no `_debugSource` → `locFromDataAttr(el.closest(...))` → `selectLoc` → `/inspect`
→ agent resolves → edit → HMR.

## Error handling / edge cases

- Plugin not enabled on a React 19 app → no data-attrs, no `_debugSource` → click
  shows "no source info" (graceful, unchanged).
- Tree navigation (↑/↓) is disabled in data-attr mode (no fiber tree) — documented.
- Production builds must not include the plugin (absolute-path leak) — the wiring
  is dev-gated; the README states this.
- Host-only injection means a click resolves to the nearest user-authored host
  element (the same granularity the fiber path effectively uses).

## Testing

- **Unit — `tests/plugin/sourceAttrs.test.ts`** (uses `@babel/core`): transform a
  JSX snippet and assert host elements gain `data-source-file/line/column` with
  correct 1-based line/column and the `filename`; composite/member tags are
  untouched; an element with pre-existing attrs is not double-stamped.
- **Unit — `tests/overlay/fiber.test.ts`** (append): `locFromDataAttr` returns the
  loc from the nearest `[data-source-file]` ancestor (mock DOM with `closest`/
  `dataset`), and `undefined` when absent.
- **Browser smoke (React 18, fiber-independence proof):** add the plugin to
  `test-multi-window`'s vite.config (dev), inject the overlay, set
  `window.__uiModifierForceDataSource = true` (fiber path off), click an element,
  and confirm the panel resolved via `data-source-*` (the `who`/rows populate and
  nav buttons are disabled — data-attr mode) and that an edit → Apply → HMR lands
  on disk. Restore the target's vite.config and edited files afterward.

## Out of scope (YAGNI)

- An SWC plugin (Next.js default / `plugin-react-swc`).
- Tree navigation in data-attr mode (React 19+).
- Publishing the plugin to npm (tracked separately under "npx distribution").
- Stripping data-attrs in production (handled by dev-only wiring, not the plugin).
