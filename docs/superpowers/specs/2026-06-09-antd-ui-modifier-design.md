# Design: React 18 + antd Visual UI Modifier Tool

- **Date:** 2026-06-09
- **Status:** Approved (design); pending implementation plan
- **Author:** minwoo1989@gmail.com (with Claude Code / superpowers)

## 1. Problem & Goal

We have an existing React 18 + antd v5 application (`my-react-app`) and want a tool
that lets us **modify the UI from the rendered screen and have those edits flow
back into the source code** — or, when an edit is too risky to apply
automatically, **tell us exactly which file/line to change and how**.

The tool is built as a **standalone dev tool** (in `react-ui-source-editor`) that
points at a target project's source directory, so it can be reused on other
React + antd projects later.

### Target project facts (my-react-app)

| Item | Value | Implication |
|---|---|---|
| React | ^18.2.0 | React 18 |
| antd | 5.27.4 | antd v5 — CSS-in-JS + design tokens (ConfigProvider) |
| Language | TypeScript 4.8 (`.tsx`) | AST work must handle TS |
| Build | CRACO + react-scripts 5.0.1 | dev mode provides JSX source info by default |
| Styling sources | antd props/tokens, @emotion/styled, craco-less, inline style | styles originate from several places |
| State | MobX | dynamic/observable values are common |

**Key constraint:** antd v5 generates hashed class names (`.ant-btn-css-xxxx`)
via CSS-in-JS, so editing global CSS is fragile. Edits are made at the **JSX
source level** (component props / `style` / `className` / emotion / theme
tokens), located via the rendered element.

## 2. Scope

**In scope (edit types):** styling + props/text.

- inline `style` values, literal props (string/number/boolean), literal text
  children, and *guidance* for dynamic/external styles.

**Out of scope (for MVP):**

- Structural changes (add/remove/move components, layout re-arrangement).
- Automatic editing of dynamic expressions, emotion `styled` blocks, `.less`,
  conditional/MobX-driven values (these are *suggested*, not auto-applied).
- Theme-token-level (ConfigProvider) automatic edits — suggestion only for MVP,
  full support is a later extension.

## 3. Architecture

Three pieces. The target app's production code is essentially untouched
(dev-mode only).

```
[Browser: my-react-app dev app on localhost:3000]
        | (1) overlay injected (bookmarklet or dev-only import)
        v
  (1) Inspector Overlay  (panel floating over the screen)
      - hover/click to select an element
      - read source location from React fiber (_debugSource: file/line)
      - edit panel for style / props / text
        | (2) edit request {file, line, edits} over HTTP
        v
  (2) Local Code Agent  (separate Node process)
      - parse target .tsx with AST (ts-morph)
      - safe edits -> write file directly
      - risky edits -> return "change this here" guidance + diff
        | (3) file saved -> CRA HMR auto-reloads
        v
  [change appears on screen]
```

### How it attaches (minimal intrusion)

- Overlay runs via an **injection script** (bookmarklet, or a dev-only one-line
  import). No effect on the production bundle; development only.
- `fiber._debugSource` (file/line) is provided by **CRA dev mode by default** —
  to be verified as the first implementation step; minimal/no babel config
  change expected.
- The code agent is configured only with the target project's source path
  (`src`).

## 4. Safety Model (auto-apply vs suggest-only)

When an edit request arrives, the agent inspects the shape of the target code
and branches:

### Auto-apply (one click -> writes .tsx)

Target value is a **static literal**, safely editable via AST:

| Kind | Example | Action |
|---|---|---|
| inline style add/modify | `style={{ marginTop: 8 }}` | add/replace key in style object |
| string-literal prop | `type="primary"`, `placeholder="검색"` | replace literal |
| literal text child | `<Button>저장</Button>` | replace text node |
| number/boolean literal prop | `size={40}`, `disabled={true}` | replace literal |

Then file save -> CRA HMR reflects immediately.

### Suggest-only (no auto-edit; show "change here" + diff)

| Situation | Reason |
|---|---|
| value is a variable/expression (`type={btnType}`) | changing the variable affects elsewhere |
| emotion `styled.div`...`` / css prop styles | style lives in a separate definition |
| `.less` / global styles | outside JSX |
| conditional / MobX observable values | intent must be confirmed |
| same component rendered via `.map()` | one edit affects many elements |

The panel shows guidance (e.g., "change `btnType` on line 42 of `src/...tsx`")
plus a proposed diff; the user confirms before anything is applied.

### Safeguards

- Back up original (or recommend `git stash`) before auto-edits.
- Optional "preview modified code -> user confirms" before final write.
- Re-parse after write; if AST is broken, roll back.
- antd v5 theme-token-wide changes (primary color, borderRadius, etc.) are
  surfaced as a **suggestion** ("this should change the ConfigProvider theme,
  not a single element"); full support is post-MVP.

## 5. Tech Stack

| Piece | Choice | Reason |
|---|---|---|
| Overlay | Vanilla TS + Shadow DOM | avoid style clash with target's antd CSS-in-JS; do not inject into target React tree (no duplicate React) |
| Element -> source mapping | DOM node `__reactFiber$*` -> `fiber._debugSource` | provided by CRA dev; no extra babel config (verify step 1) |
| Code agent | Node + TypeScript, AST via **ts-morph** | strong `.tsx` parsing/editing with reasonable format preservation |
| Overlay <-> agent | localhost HTTP (POST) + response | simple; WebSocket later if real-time needed |
| Run | agent `node` process + overlay injection script | target dev server (`craco start`) stays as-is |

Build: agent via ts-node/tsc; overlay bundled with esbuild into a single JS file.

## 6. Testing Strategy (TDD)

The agent's code-transformation logic is the most important part; tests
concentrate there.

- **AST transform unit tests (core):** fixture-based "this .tsx in -> this out".
  - inline style add/merge, literal prop replace, text replace
  - **safety classification:** dynamic expressions / emotion / mapped renders are
    excluded from auto-apply
  - rollback on parse failure
- **Mapping logic:** unit tests for parsing `fiber._debugSource` (file/line).
- **Manual verify:** attach to the real `my-react-app` dev app, change one
  button's color/text, confirm both screen and code update.
- Overlay UI: light manual checks (automation cost not worth it).

## 7. Build Order (implementation plan preview)

1. Verify element -> source mapping actually works (highest risk first).
2. Code agent AST transforms + safety classification (TDD).
3. Overlay selection/highlight + edit panel.
4. Wire communication + HMR reflection end-to-end.
5. Suggest/diff mode, backup & rollback.

---

## 8. End-to-end verification results (2026-06-09)

Verified against the real `my-react-app/web` app (React 18.2 + antd 5.27.4,
react-scripts 5.0.1 via CRACO; agent rooted at `web/`, app on :3000).

**`_debugSource` (risk spike) — PASS.** Fibers for the app's own JSX carry
`_debugSource` in CRACO dev (e.g. `LoginPage.tsx:123`). Walking up from a
clicked DOM node via `fiber.return` reaches the nearest source-bearing fiber,
which is the JSX element in the user's `src/`. No babel config change needed.
Confirmed `columnNumber` is 1-based at the `<` — consistent with `locate`'s
`column - 1` offset.

**Safe-apply path — PASS.** Clicked the login `<Button>`, set Text, Apply →
agent rewrote the `.tsx`, created a timestamped backup under
`.ui-modifier-backups/`, and CRA HMR reflected the new label. Panel showed
"✅ Applied".

**Bug found & fixed during verify:** the inspector listened on `document` in
the capture phase and called `stopPropagation` on every click. Clicks inside
the Shadow-DOM panel are retargeted to the host at the document level, so the
old `getRootNode() instanceof ShadowRoot` guard never matched — the Apply
button never received its click. Fixed by detecting own-UI events via
`composedPath()` (sees through shadow retargeting) and skipping them.

**Environment notes:** the agent runs via `tsx` (native
`node --experimental-strip-types` does not resolve `.js` import specifiers to
`.ts` sources); `@types/node` was added so the agent typechecks under `tsc`.

**Not yet exercised in-browser:** the suggest-only path (dynamic prop / emotion
`css` / `.map()` renders). Its logic is covered by `classify` + `apply` unit
tests; a live click-through remains a nice-to-have.
