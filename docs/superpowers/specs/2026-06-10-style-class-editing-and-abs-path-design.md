# Style/Class Editing + Absolute-Path Contract — Design

## Context

Two problems surfaced after the bookmarklet delivery shipped:

1. **ENOENT bug.** The overlay's `relativeToSrc()` strips `_debugSource`'s
   absolute path down to `src/...`, and the agent resolves that against
   `PROJECT_ROOT` — which, when the agent is started with `npm run agent` from
   this repo, is the **plugin repo**, not the target app. Every edit fails with
   `no such file or directory`. The bookmarklet made the agent target arbitrary
   apps, breaking the old "agent is rooted at the target project" assumption.

2. **Editing is too limited.** The panel has four fixed inputs (text, color,
   marginTop, `type` prop). The user wants to see the selected component's
   actual style and class from source and edit them freely.

Decisions made during brainstorming:

- Use `_debugSource`'s **absolute path** end-to-end; show it in the panel as an
  editable input with a Browse button (agent-backed file browser — browsers'
  native file dialogs never expose absolute paths, so a `GET /fs` listing
  endpoint is the only realistic implementation).
- Read style/class from **source** via a new `POST /inspect` endpoint, not from
  the DOM — DOM classes include antd-generated ones (`ant-btn`, `css-xxx`)
  that must never be written back into source.
- Editable scope: full `style` object (add/edit/remove), `className`, and text.
  The fixed color/marginTop/type inputs are removed.

## Architecture

Approach chosen: extend the existing agent API and make the panel dynamic.
Read (`/inspect`), write (`/edit`), and browse (`/fs`) share the same
ts-morph parsing (`locateJsxElement`) so what the panel shows is exactly what
write-back will touch.

```
overlay panel ── select element ──▶ POST /inspect {file,line,column}
      │                                   │ locateJsxElement → style/className/text
      │ ◀── source-truth values ──────────┘
      │ user edits rows
      └── Apply ──▶ POST /edit {file(abs), line, column, edits[]}
Browse button ──▶ GET /fs?path=... (read-only directory listing)
```

## 1. Path contract (bug fix)

- `EditRequest.file` is now an **absolute path** (`_debugSource.fileName`
  verbatim). Delete `relativeToSrc()` from `src/overlay/api.ts`.
- The server drops `PROJECT_ROOT` entirely. Validation on the received path:
  - File must exist → otherwise a clear error: `file not found: <path>`.
  - Extension allowlist: `.tsx`, `.jsx`, `.ts`, `.js` — minimal guard so the
    CORS-open localhost agent cannot write arbitrary files.
- Backups move to the **agent repo's** `.ui-modifier-backups`, resolved
  relative to the server module (same technique as `OVERLAY_BUNDLE`:
  `resolve(dirname(fileURLToPath(import.meta.url)), "../../.ui-modifier-backups")`)
  since `PROJECT_ROOT` no longer exists. The target repo stays clean —
  consistent with the bookmarklet design's zero-pollution goal.
- Panel gains a **file path input** (default = `_debugSource` absolute path)
  plus a **Browse** button. Both `/inspect` and `/edit` use this input's value.
- Landing page no longer shows `PROJECT_ROOT` (meaningless now); port only.
  `landingHtml(projectRoot, port)` becomes `landingHtml(port)`.

## 2. `POST /inspect` + dynamic panel

New pure module `src/agent/inspect.ts`:

- `inspectJsxElement(sf, line, column): InspectResult` — locates the JSX
  element and returns source truth:
  - `style`: entries of the `style` object literal as
    `{ property, value, editable }[]`. String/numeric literals are editable;
    anything else (e.g. `theme.color`) is returned as raw text with
    `editable: false`. Missing/non-object-literal `style` → empty list (plus a
    `styleEditable: false` flag when the attribute exists but isn't an object
    literal).
  - `className`: `{ value, editable }` — editable when a string literal,
    raw text read-only when an expression, absent when no attribute.
  - `text`: `{ value, editable }` — editable when the element has a single
    text child, otherwise absent.
  - Element not found → `{ status: "error", message }`.

Server route `POST /inspect` with body `{file, line, column}`: same path
validation as `/edit`, parses with an in-memory ts-morph project, returns the
`InspectResult` JSON.

Shared types (`src/shared/types.ts`):

- Add `{ kind: "styleRemove"; property: string }` to `Edit`.
- Add `InspectRequest` / `InspectResult`.

Write-back:

- `styleRemove`: new function in `applyStyle.ts` — removes the property from
  the `style` object literal; if it was the last property, removes the `style`
  attribute itself. Property absent → no-op.
- `className`: reuses `{ kind: "prop", name: "className", value }` via the
  existing `applyProp` (verify it creates the attribute when missing and
  replaces a string literal when present).
- Text: existing `applyText`, unchanged.

Panel rework (`src/overlay/panel.ts`):

- On element select, call `/inspect` and render:
  - One row per style property: property name, value input, remove (✕) button.
    An "add property" row (name + value inputs) appends new properties.
  - `className` input and `Text` input.
  - Read-only values render disabled/greyed with their raw source text.
- Apply diffs the rendered state against the inspect snapshot and emits the
  minimal `Edit[]` (changed style values, removed properties as `styleRemove`,
  changed className/text).
- The fixed color/marginTop/type inputs are removed.

## 3. `GET /fs` (Browse)

- `GET /fs?path=<absolute dir>` → `{ path, parent, entries: [{ name, path, dir }] }`,
  directories first, `node_modules` and dot-entries excluded; entries carry full
  absolute paths; `parent` is `""` at drive roots. No `path` param →
  list Windows drive roots. Read-only; never writes, never reads file contents.
  Browse intentionally has no directory allowlist — the user must reach arbitrary
  source trees; the write guard lives solely on `/edit`/`/inspect` (extension
  allowlist + existence).
- Panel's Browse button opens an in-panel mini file browser: click a directory
  to descend, click a file to fill the path input. Initial location: the
  directory of the current path input value.

## 4. Error handling & testing

- `/inspect` and `/edit` failures keep the existing
  `{ status: "error", message }` shape; the panel shows them in its output
  area.
- Unit tests (vitest, existing pure-function pattern):
  - `inspect.ts`: style literal + non-literal entries, className literal vs
    expression, text child present/absent, element not found.
  - `applyStyle`: `styleRemove` removes a property, removes the attribute when
    last, no-ops when absent.
  - `applyProp`: className create + replace.
  - Path validation: extension allowlist accept/reject (pure helper).
  - `bookmarklet.ts`: `landingHtml(port)` signature change.
- Server routes (`/inspect`, `/fs`) follow the existing pattern: thin wiring,
  manual smoke test (start agent, hit routes, full bookmarklet loop against a
  real antd app confirming inspect → edit → HMR reload).
- Implementation proceeds with TDD per project convention.

## Out of Scope (YAGNI)

- Editing arbitrary props beyond className (the old `type` input is dropped).
- Editing non-literal style values or expression classNames (shown read-only).
- DOM computed-style display.
- Auth on the agent; multi-root allowlists.
- Deriving the agent origin from the overlay `<script src>` (pre-existing
  known constraint, unchanged).

## Verification

**Date:** 2026-06-10

### Automated gate

- `npx tsc --noEmit`: pass (no errors)
- `npm test`: 11 test files, 75 tests — all pass
- `npm run build:overlay`: `dist/overlay.js` 11.7 kb — `git status --porcelain`
  shows no modification (committed bundle is identical to rebuilt output)

### HTTP E2E (abs-path bug regression)

Target file created at `C:\Users\minwoo\AppData\Local\Temp\ui-mod-e2e\Sample.tsx`
(outside this repo) with content:

```tsx
const C = () => (
  <button style={{ color: "red", marginTop: 8 }} className="old">hello</button>
);
export default C;
```

Agent started: `npx tsx src/agent/server.ts` → listening on port 4567.

**POST /inspect** `{file:"C:\\…\\Sample.tsx", line:2, column:3}`
→ `{status:"ok", styleEditable:true, style:[{property:"color",value:"red",editable:true},{property:"marginTop",value:"8",editable:true}], className:{value:"old",editable:true}, text:{value:"hello",editable:true}}`

**POST /edit** with edits `[styleRemove color, style marginTop→16, prop className→"new-cls", text→"world"]`
→ `{status:"applied", …}`. On-disk file after edit:

```tsx
const C = () => (
  <button style={{ marginTop: 16 }} className="new-cls">world</button>
);
export default C;
```

Confirms: `marginTop: 16` present, `color` removed, `className="new-cls"`, `>world<`.
The agent wrote to the ABSOLUTE path outside its own repo — the original ENOENT bug is fixed.

**Backup:** `Sample.tsx.1781084945968-105893963249000.bak` appeared in this
repo's `.ui-modifier-backups/`; target temp dir contained no backup files.

**Negative checks:**
- `POST /edit {file:"D:\\definitely\\missing\\X.tsx", …}` → 500 `{status:"error", message:"file not found: D:\\definitely\\missing\\X.tsx"}`
- `POST /edit {file:"…\\note.txt", …}` → 500 `{status:"error", message:"not an editable source file: C:\\…\\note.txt"}`

Agent stopped (PID killed); port 4567 confirmed free; temp dir deleted.

### Manual browser checklist (out of automated scope)

Suggested target app: `D:\Projects\test\test-multi-window` (antd5 + Vite).

- [x] Drop bookmarklet → overlay loads, click a component → path input auto-fills
      with `_debugSource` absolute path — **PARTIAL FAIL**: path fills correctly,
      but line/column are wrong on this stack (see Browser verification below)
- [x] `/inspect` round-trip: style rows render with correct property/value,
      className and Text fields populated
- [x] Edit style row value, remove a property, change className, change text →
      Apply → HMR reload shows the change in the browser
- [x] Browse button: navigate the file tree via `/fs`, select a `.tsx` file →
      path input updates, `/inspect` fires again
- [x] Read-only rendering: select an element with `style={styles}` (variable
      reference) or `className={cls}` (expression) — rows render greyed/disabled,
      Apply is a no-op for those fields

### Browser verification (2026-06-11, Playwright + Chromium)

Target: `D:\Projects\test\test-multi-window` (vite 5.4.21, @vitejs/plugin-react
4.7.0, react 18.3.1, antd 5). Agent on 4567, vite on 5173. Bookmarklet snippet
executed verbatim in-page (drag-to-bar not automatable).

**❌ BLOCKER FOUND — `_debugSource` line shift.** Clicking the FloatingBar
`<div>` (true source line 15) fills the path correctly but reports **line 34,
col 5**. Root cause confirmed by fetching the vite-transformed module
(`GET /src/components/FloatingBar.tsx`): the served code literally contains
`lineNumber: 34` — the JSX dev transform computes positions *after*
@vitejs/plugin-react's refresh preamble (~19 lines) is prepended, so every
`_debugSource` line is shifted by a constant per-file offset. The overlay's
verbatim pass-through then inspects the wrong line (here the file's closing
`}`), rendering an empty/garbage panel. Click-to-edit is therefore broken on
the stock Vite dev stack; only the file path survives.

**Everything downstream of a correct loc passes.** Verified through the real
panel UI by planting sacrificial components whose JSX sits exactly at the
reported loc 34:5, selected via the Browse tree (a genuine UI path):

- Landing page 200, draggable `javascript:` anchor; overlay injects, panel
  renders, hover-highlight + click-capture work; CORS fine across 5173→4567.
- Inspect round-trip: 7 style rows with correct values; non-literal value row
  (`zIndex: PT_Z`) rendered greyed with remove disabled; className and Text
  populated.
- Edit loop: value change + row remove + new-property add + className + text in
  one Apply → `✅ Applied` → vite HMR repainted the live element (computed
  background/outline/class/text all confirmed) → on-disk file matched →
  panel auto-re-inspected with fresh rows. Overlay survived HMR.
- Browse: drive-root/parent/descend navigation works; selecting a `.tsx`
  re-fires `/inspect`; bogus path shows `❌ fs: ENOENT …`.
- Read-only: `style={roStyle}` → no style rows (variable ref); template-literal
  className → greyed input showing the raw expression; Apply → `Nothing to
  apply.`; file untouched.
- Probes: Apply against a missing absolute path surfaces
  `❌ file not found: …` in the panel; Apply with no changes is a no-op.

Screenshots in `.verify-shots/` (untracked). Follow-up needed: correct the
preamble offset (e.g. map `_debugSource` through the served module's sourcemap,
or locate by nearest JSX whose tag matches) before the click-to-edit loop is
usable on Vite dev servers.

### Known limitations

1. **Mixed EOL after ts-morph insertion.** ts-morph inserts LF on newly added
   lines inside CRLF files, producing mixed line endings until a formatter
   normalizes them. Pre-existing behaviour; no fix planned here.
2. **Triplicated JSX helpers.** `getOpening`/`getAttribute` logic is repeated
   across `applyStyle.ts`, `classify.ts` (applyProp), and `inspect.ts` — a
   candidate for a future `jsxNodes.ts` refactor.
3. **Quoted style keys round-trip with quotes.** Style keys written as
   `"font-size"` (quoted) are returned and rewritten with the quotes intact.
   Functional but displays with literal quote characters in the panel.
