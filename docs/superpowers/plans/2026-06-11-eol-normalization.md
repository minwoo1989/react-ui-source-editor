# EOL Normalization on Write Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After an Apply, write the file with line endings matching the original file's convention, so ts-morph's `\n` insertions never leave a CRLF file with mixed line endings.

**Architecture:** A pure `eol.ts` (`detectEol`, `normalizeEol`) normalizes `processEdits`' output to the original file's EOL; `server.ts` calls it in the `/edit` applied branch before backup/write/record.

**Tech Stack:** TypeScript, Node http + fs (agent), ts-morph (existing edit path), vitest.

**Spec:** `docs/superpowers/specs/2026-06-11-eol-normalization-design.md`

**Conventions:** Run tests `npx vitest run`; typecheck `npx tsc --noEmit`. Agent tests in `tests/agent/`. Commit after each task.

---

## File Structure

- `src/agent/eol.ts` — **new**: `detectEol`, `normalizeEol` (pure).
- `tests/agent/eol.test.ts` — **new**: unit tests + one integration test.
- `src/agent/server.ts` — **modify**: normalize in the `/edit` applied branch.

---

## Task 1: `eol.ts` — detect + normalize (TDD)

**Files:**
- Create: `src/agent/eol.ts`
- Test: `tests/agent/eol.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/agent/eol.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { detectEol, normalizeEol } from "../../src/agent/eol.js";

describe("detectEol", () => {
  it("detects CRLF", () => {
    expect(detectEol("a\r\nb\r\nc")).toBe("\r\n");
  });
  it("detects LF", () => {
    expect(detectEol("a\nb\nc")).toBe("\n");
  });
  it("returns the majority ending for mixed text (CRLF majority)", () => {
    expect(detectEol("a\r\nb\r\nc\n")).toBe("\r\n");
  });
  it("returns the majority ending for mixed text (LF majority)", () => {
    expect(detectEol("a\r\nb\nc\n")).toBe("\n");
  });
  it("defaults to LF when there is no line break", () => {
    expect(detectEol("single line")).toBe("\n");
  });
});

describe("normalizeEol", () => {
  it("converts mixed text to all-CRLF", () => {
    expect(normalizeEol("a\r\nb\nc", "\r\n")).toBe("a\r\nb\r\nc");
  });
  it("converts mixed text to all-LF", () => {
    expect(normalizeEol("a\r\nb\nc", "\n")).toBe("a\nb\nc");
  });
  it("is idempotent", () => {
    const once = normalizeEol("a\r\nb\nc", "\r\n");
    expect(normalizeEol(once, "\r\n")).toBe(once);
  });
  it("leaves single-line text unchanged", () => {
    expect(normalizeEol("one line", "\r\n")).toBe("one line");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/agent/eol.test.ts`
Expected: FAIL — module `eol.ts` does not exist.

- [ ] **Step 3: Write the implementation**

Create `src/agent/eol.ts`:

```ts
// src/agent/eol.ts

export type Eol = "\r\n" | "\n";

/** The file's dominant line ending; "\n" when there are no line breaks. */
export function detectEol(text: string): Eol {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lfOnly = (text.match(/\n/g) ?? []).length - crlf;
  return crlf > lfOnly ? "\r\n" : "\n";
}

/** Rewrite every line ending in `text` to `eol`. */
export function normalizeEol(text: string, eol: Eol): string {
  return text.replace(/\r\n/g, "\n").replace(/\n/g, eol);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/agent/eol.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Full suite + typecheck**

Run: `npx vitest run` then `npx tsc --noEmit`
Expected: all pass; no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/agent/eol.ts tests/agent/eol.test.ts
git -c user.name=minwoo -c user.email=minwoo1989@gmail.com commit -m "feat: eol detect + normalize helpers

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 2: Wire normalization into `/edit` + integration test

**Files:**
- Modify: `src/agent/server.ts`
- Test: `tests/agent/eol.test.ts` (append integration test)

- [ ] **Step 1: Write the failing integration test**

First, add these imports to the TOP of `tests/agent/eol.test.ts` (so all imports
stay at module top level — do NOT place them mid-file). The existing top import
is `import { detectEol, normalizeEol } from "../../src/agent/eol.js";`; add below it:

```ts
import { Project } from "ts-morph";
import { processEdits } from "../../src/agent/apply.js";
import type { EditRequest } from "../../src/shared/types.js";
```

Then append this `describe` block at the END of the file:

```ts
describe("processEdits output normalized to the source EOL", () => {
  it("yields no lone \\n after normalizing a CRLF source edit", () => {
    const original = [
      "const C = () => (",
      "  <button",
      "    style={{",
      '      color: "red",',
      "    }}",
      "  >hi</button>",
      ");",
    ].join("\r\n");

    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile("/F.tsx", original);
    const req: EditRequest = {
      file: "/F.tsx", line: 2, column: 3,
      edits: [{ kind: "style", property: "padding", value: 8 }],
    };

    const result = processEdits(project, req);
    expect(result.status).toBe("applied");
    if (result.status !== "applied") return;

    const normalized = normalizeEol(result.newText, detectEol(original));
    expect(normalized).toContain("padding");
    // every \n must be preceded by \r — i.e. no lone LF remains
    expect(/(?<!\r)\n/.test(normalized)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to confirm it passes against the helpers but exercises real ts-morph output**

Run: `npx vitest run tests/agent/eol.test.ts`
Expected: PASS. (The assertion proves `normalizeEol` makes real `processEdits`
output uniformly CRLF; if `processEdits` left a lone `\n` and normalization were
skipped, the regex check would fail.)

- [ ] **Step 3: Add the `eol` import to `server.ts`**

In `src/agent/server.ts`, add after the `import { createHistory } from "./history.js";` line:

```ts
import { detectEol, normalizeEol } from "./eol.js";
```

- [ ] **Step 4: Normalize in the `/edit` applied branch**

In `server.ts`, the applied branch currently reads:

```ts
    if (result.status === "applied") {
      mkdirSync(BACKUP_DIR, { recursive: true });
      copyFileSync(reqBody.file, join(BACKUP_DIR, `${basename(reqBody.file)}.${Date.now()}-${process.hrtime.bigint()}.bak`));
      writeFileSync(reqBody.file, result.newText, "utf8");
      history.record(reqBody.file, original, result.newText);
    }
```

Replace it with (normalize once, then write + record the normalized text):

```ts
    if (result.status === "applied") {
      const normalized = normalizeEol(result.newText, detectEol(original));
      mkdirSync(BACKUP_DIR, { recursive: true });
      copyFileSync(reqBody.file, join(BACKUP_DIR, `${basename(reqBody.file)}.${Date.now()}-${process.hrtime.bigint()}.bak`));
      writeFileSync(reqBody.file, normalized, "utf8");
      history.record(reqBody.file, original, normalized);
    }
```

- [ ] **Step 5: Typecheck + full suite**

Run: `npx tsc --noEmit` then `npx vitest run`
Expected: no type errors; all pass (the new integration test included).

- [ ] **Step 6: Commit**

```bash
git add src/agent/server.ts tests/agent/eol.test.ts
git -c user.name=minwoo -c user.email=minwoo1989@gmail.com commit -m "feat: normalize edit output to the source file EOL

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 3: HTTP E2E — a CRLF file stays all-CRLF on disk after /edit

Confirms the server wiring end-to-end (the integration test in Task 2 calls the
helpers directly; this proves `server.ts` actually applies them to a real file).

- [ ] **Step 1: Start the agent**

Run (background, repo root): `npx tsx src/agent/server.ts`
Expected: `[ui-modifier] agent on http://localhost:4567`.

- [ ] **Step 2: Write the E2E driver**

Create `verify-eol.mjs` in the repo root:

```js
// POST /edit against a real CRLF temp file; assert the written file is all-CRLF.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-mod-eol-'));
const file = path.join(dir, 'Sample.tsx');
const original = [
  'const C = () => (',
  '  <button',
  '    style={{',
  '      color: "red",',
  '    }}',
  '  >hi</button>',
  ');',
].join('\r\n');
fs.writeFileSync(file, original, 'utf8');

const res = await fetch('http://localhost:4567/edit', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ file, line: 2, column: 3, edits: [{ kind: 'style', property: 'padding', value: 8 }] }),
});
const body = await res.json();
console.log('edit status:', body.status);

const after = fs.readFileSync(file, 'utf8');
console.log('on-disk has padding:', after.includes('padding'));
console.log('on-disk lone-LF count:', (after.match(/(?<!\r)\n/g) ?? []).length, '(expect 0)');
console.log('PASS all-CRLF:', body.status === 'applied' && after.includes('padding') && !/(?<!\r)\n/.test(after));

fs.rmSync(dir, { recursive: true, force: true });
console.log('DONE');
```

- [ ] **Step 3: Run it**

Run (repo root): `node verify-eol.mjs`
Expected:
- `edit status: applied`
- `on-disk has padding: true`
- `on-disk lone-LF count: 0 (expect 0)`
- `PASS all-CRLF: true`

If lone-LF count > 0, the server is not normalizing — stop and debug.

- [ ] **Step 4: Clean up**

```bash
del verify-eol.mjs
```

Stop the background agent. Confirm port 4567 is free (kill any stale listener if needed).

- [ ] **Step 5: Record verification in the spec**

Append a short "Verification (2026-06-11)" section to
`docs/superpowers/specs/2026-06-11-eol-normalization-design.md`: note unit tests
(detect/normalize) + the integration test pass, and the HTTP E2E on a real CRLF
temp file produced an all-CRLF on-disk result after an edit that adds a line
(lone-LF count 0); `npx vitest run` / `npx tsc --noEmit` green.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-06-11-eol-normalization-design.md
git -c user.name=minwoo -c user.email=minwoo1989@gmail.com commit -m "docs: record EOL normalization verification

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Self-Review Notes

- **Spec coverage:** `detectEol`/`normalizeEol` (Task 1); `/edit` wiring + record-the-normalized-text + real-ts-morph integration test (Task 2); end-to-end on-disk proof (Task 3). All spec sections mapped.
- **Type consistency:** `detectEol(text): Eol` and `normalizeEol(text, eol): string` used identically in the integration test and `server.ts`; `Eol = "\r\n" | "\n"`.
- **No placeholders:** every step has complete code; the lone-LF regex `(?<!\r)\n` is the precise "mixed-EOL" detector used in both the integration test and the E2E.
