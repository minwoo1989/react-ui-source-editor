# Undo / Redo — Design

**Date:** 2026-06-11
**Status:** approved, awaiting implementation plan
**Feature:** #3 of the improvement series (#2 deferred)

## Problem

Every `Apply` overwrites a source file (after backing up the prior content to
`.ui-modifier-backups/`), but there is no in-overlay way to revert. A user who
makes a wrong edit must dig a `.bak` out by hand. We want **Undo / Redo buttons
in the overlay panel**, operating as a global "last change" stack across all
files edited this session (Ctrl-Z feel), since the user clicks around many
components.

## Goal

One Apply = one undoable step. Undo restores the file to its pre-Apply content;
Redo re-applies. The stack is global (file-agnostic ordering) and lives in the
agent (the single writer). Buttons reflect availability and disable when empty.

## Approach (chosen)

Agent-side in-memory global undo/redo stack of `{ file, before, after }`
records. Rejected: backup-file-based undo (no redo; filename ordering fiddly);
overlay-side inverse edits (lost on reload; hard to invert text/style-remove).

## Components

### `src/agent/history.ts` (new — pure, no filesystem; unit-tested)

A factory holding two arrays (undo, redo):

- `record(file: string, before: string, after: string): void` — push
  `{ file, before, after }` onto the undo stack; **clear the redo stack**.
- `undo(): { file: string; content: string } | null` — pop the newest undo
  record, move it to the redo stack, return `{ file, content: before }`; `null`
  if the undo stack is empty.
- `redo(): { file: string; content: string } | null` — pop the newest redo
  record, move it back to the undo stack, return `{ file, content: after }`;
  `null` if the redo stack is empty.
- `state(): { canUndo: boolean; canRedo: boolean }`.

### `src/shared/types.ts`

```ts
export type HistoryResult =
  | { status: "ok"; file: string; canUndo: boolean; canRedo: boolean }
  | { status: "noop"; canUndo: boolean; canRedo: boolean }
  | { status: "error"; message: string };
```

### `src/agent/server.ts`

- In the `/edit` handler, after a successful write (`result.status === "applied"`),
  call `history.record(reqBody.file, original, result.newText)` (where `original`
  is the pre-edit content already read via `readSource`).
- `POST /undo` (no body): `const u = history.undo()`; if `null` →
  `{ status: "noop", ...history.state() }`. Else `writeFileSync(u.file, u.content)`
  and return `{ status: "ok", file: u.file, ...history.state() }`. Errors →
  `{ status: "error", message }`.
- `POST /redo`: symmetric, using `history.redo()`.
- `GET /history`: return `{ status: "ok", ...history.state() }`-shaped counts so
  the overlay can set initial button state. (Returns canUndo/canRedo; no file.)
- Undo/redo writes do NOT create new `.bak` files — the in-memory stack is the
  source of truth for redo; the per-Apply `.bak` trail is an independent
  disk-level safety net, unchanged.

### `src/overlay/api.ts`

`sendUndo(): Promise<HistoryResult>`, `sendRedo(): Promise<HistoryResult>`,
`fetchHistory(): Promise<{ canUndo: boolean; canRedo: boolean }>` — all against
the detected `AGENT_ORIGIN` (POST for undo/redo, GET for history).

### `src/overlay/panel.ts`

- Add **Undo (↶)** and **Redo (↷)** buttons, both `disabled` by default.
- New handlers `onUndo`/`onRedo` on `PanelHandlers`, plus `onHistory` for the
  initial state.
- After a successful Apply (`applied`): enable Undo, disable Redo (deterministic
  — Apply always makes undo available and clears redo).
- On Undo/Redo click: call the handler; set both buttons' `disabled` from the
  returned `canUndo`/`canRedo`; write a status line to `#out`
  (e.g. `↶ FloatingBar.tsx 되돌림`). If the returned `file` equals the currently
  selected `file`, re-inspect to refresh the rows.
- On panel creation, call `onHistory()` to set the initial button state.

## Data flow

`Apply (applied)` → `history.record` → Undo enabled. ↶ → `/undo` → writes
`before` → Vite HMR reloads the app showing the revert → Redo enabled. ↷ →
`/redo` → writes `after`.

## Error handling / edge cases

- Empty stack undo/redo → `noop` (buttons are disabled anyway; defensive).
- **Agent restart** loses the in-memory stacks → buttons disable; `.bak` files
  remain for manual recovery. Accepted for v1.
- **External edit between Apply and Undo** → Undo writes the recorded `before`,
  clobbering the external change. Accepted and documented; a content-match guard
  is intentionally omitted because feature #4 (EOL normalization) will change
  on-disk content after a write, which would make such a guard misfire.
- Stack size is unbounded (edits are small text; not a practical concern).

## Testing

- **Unit — `tests/agent/history.test.ts`:**
  - record → undo restores `before`; redo restores `after`.
  - `canUndo`/`canRedo` transitions across record/undo/redo.
  - a new `record` after an undo clears the redo stack.
  - undo on empty → `null`; redo on empty → `null`.
  - global ordering across two different files (undo targets the most recent
    Apply regardless of file).
- **Browser smoke:** apply edits to two different elements; click Undo twice
  (each reverts in LIFO order, confirmed via HMR + on-disk content); click Redo
  (re-applies); assert Undo/Redo button `disabled` states at the stack
  boundaries.

## Out of scope (YAGNI)

- Cross-restart persistence of the undo/redo stack.
- Content-match / external-edit conflict detection.
- Per-file undo scope, stack-size caps, keyboard shortcuts.
- Features #4–#7 and the security boundary (#2, deferred).
