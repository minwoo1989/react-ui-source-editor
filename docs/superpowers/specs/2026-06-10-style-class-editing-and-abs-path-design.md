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

- `GET /fs?path=<absolute dir>` → `{ path, entries: [{ name, dir }] }`,
  directories first, `node_modules` and dot-entries excluded. No `path` param →
  list Windows drive roots. Read-only; never writes, never reads file contents.
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
