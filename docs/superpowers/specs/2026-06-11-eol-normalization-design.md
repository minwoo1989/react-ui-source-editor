# EOL Normalization on Write — Design

**Date:** 2026-06-11
**Status:** approved, awaiting implementation plan
**Feature:** #4 of the improvement series

## Problem

ts-morph inserts `\n` on newly added lines. When the edited file uses CRLF
(`\r\n`) line endings — common on Windows source — an Apply that adds lines
yields a file with **mixed line endings** (existing `\r\n` lines plus new `\n`
lines) until some formatter normalizes them. This is the "known limitation #1"
recorded in the 2026-06-10 spec.

## Goal

After an Apply, the written file has **consistent line endings matching the
original file's convention** (preserve CRLF or LF as the file already used; do
not impose a project-wide choice).

## Approach

Normalize `processEdits`' output to the original file's EOL just before writing,
in the agent. A small pure module does the detection and conversion; `server.ts`
calls it in the `/edit` applied branch.

## Components

### `src/agent/eol.ts` (new — pure, unit-tested)

```ts
export type Eol = "\r\n" | "\n";

/** The file's dominant line ending; "\n" when there are no line breaks. */
export function detectEol(text: string): Eol;

/** Rewrite every line ending in `text` to `eol`. */
export function normalizeEol(text: string, eol: Eol): string;
```

- `detectEol`: count `\r\n` occurrences vs lone `\n` occurrences; return `"\r\n"`
  if CRLF is the majority, else `"\n"` (default `"\n"` when no newline present).
- `normalizeEol`: `text.replace(/\r\n/g, "\n").replace(/\n/g, eol)` — collapses
  everything to LF first, then expands to the target. Idempotent.

### `src/agent/server.ts`

In the `/edit` applied branch, normalize before backing up / writing / recording:

```ts
if (result.status === "applied") {
  const normalized = normalizeEol(result.newText, detectEol(original));
  mkdirSync(BACKUP_DIR, { recursive: true });
  copyFileSync(reqBody.file, join(BACKUP_DIR, `${basename(reqBody.file)}.${Date.now()}-${process.hrtime.bigint()}.bak`));
  writeFileSync(reqBody.file, normalized, "utf8");
  history.record(reqBody.file, original, normalized);
}
```

- Normalization applies only to the **edit output**. `original` (the pre-edit
  content read via `readSource`) keeps its native EOL, so it remains correct as
  the undo `before`. Recording the **normalized** text as `after` keeps redo
  consistent with what is on disk.

## Data flow

`readSource` (native EOL) → `processEdits` (possibly mixed EOL) →
`normalizeEol(newText, detectEol(original))` (consistent EOL) → backup + write +
`history.record(file, original, normalized)`.

## Edge cases

- Original file already consistent (all CRLF or all LF) → output matches it.
- Original with no newline (single line) → `detectEol` returns `"\n"`;
  normalization is a no-op when the output is also single-line.
- Original with pre-existing mixed EOL → `detectEol` picks the majority and the
  output becomes uniform (a net improvement; not a regression).

## Testing

- **Unit — `tests/agent/eol.test.ts`:**
  - `detectEol`: pure-CRLF text → `"\r\n"`; pure-LF text → `"\n"`; majority-CRLF
    mixed → `"\r\n"`; majority-LF mixed → `"\n"`; no-newline → `"\n"`.
  - `normalizeEol`: mixed → all-CRLF; mixed → all-LF; idempotent
    (normalizing already-normalized text is unchanged); single-line unchanged.
- **Integration — `tests/agent/eol.test.ts` (or `apply.test.ts`):** run
  `processEdits` on a CRLF multi-line source with an edit that adds a line, apply
  `normalizeEol(result.newText, detectEol(original))`, and assert the result has
  **no lone `\n`** (every `\n` is preceded by `\r`).

## Out of scope (YAGNI)

- A project-wide / configurable EOL choice (always preserve the file's own).
- Normalizing files the tool did not edit; trailing-newline policy; BOM handling.
- Features #5–#7.

## Verification (2026-06-11)

**Automated gate:** `npx vitest run` — 104/104 (9 `eol` unit tests + 1 integration
test). `npx tsc --noEmit` — clean. The integration test asserts that real
`processEdits` output on a multi-line **CRLF** source with a line-adding edit
(`{kind:"style", property:"padding"}`) **does** contain a lone `\n` before
normalization, and **none** after `normalizeEol(newText, detectEol(original))` —
proving the normalization is load-bearing.

**HTTP E2E:** with the agent running, `POST /edit` against a real CRLF temp file
(`Sample.tsx`, outside the repo) with the same line-adding edit →
`status: "applied"`; the on-disk file afterward had `padding` present and a
**lone-LF count of 0** (uniformly CRLF). Confirms the server actually normalizes
to the source EOL on write. Temp file/script removed; agent stopped; port freed.
