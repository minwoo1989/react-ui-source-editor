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
