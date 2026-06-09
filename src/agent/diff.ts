// src/agent/diff.ts
/** Minimal unified-ish diff for preview/guidance. Good enough for human reading. */
export function unifiedDiff(before: string, after: string, file: string): string {
  const a = before.split("\n");
  const b = after.split("\n");
  const max = Math.max(a.length, b.length);
  const lines: string[] = [`--- ${file}`, `+++ ${file}`];
  for (let i = 0; i < max; i++) {
    if (a[i] === b[i]) continue;
    if (a[i] !== undefined) lines.push(`- ${a[i]}`);
    if (b[i] !== undefined) lines.push(`+ ${b[i]}`);
  }
  return lines.join("\n");
}
