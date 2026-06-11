// src/agent/locate.ts
import { SourceFile, Node, ts, SyntaxKind, JsxOpeningElement, JsxSelfClosingElement } from "ts-morph";

function isJsxOpening(node: Node): node is JsxOpeningElement | JsxSelfClosingElement {
  const k = node.getKind();
  return k === SyntaxKind.JsxOpeningElement || k === SyntaxKind.JsxSelfClosingElement;
}

function tagText(node: JsxOpeningElement | JsxSelfClosingElement): string {
  return node.getTagNameNode().getText();
}

function lineColOf(sf: SourceFile, node: Node): { line: number; column: number } {
  const lc = ts.getLineAndCharacterOfPosition(sf.compilerNode, node.getStart());
  return { line: lc.line + 1, column: lc.character + 1 };
}

/** Exact position lookup — the original behavior, used when _debugSource is accurate. */
function exactAt(sf: SourceFile, line: number, column: number): JsxOpeningElement | JsxSelfClosingElement | undefined {
  let pos: number;
  try {
    pos = ts.getPositionOfLineAndCharacter(sf.compilerNode, line - 1, column - 1);
  } catch {
    return undefined; // reported position is past EOF (offset pushed it out) — fall to tolerant phase
  }
  let node: Node | undefined = sf.getDescendantAtPos(pos);
  while (node) {
    if (isJsxOpening(node)) return node;
    node = node.getParent();
  }
  return undefined;
}

/**
 * Resolve the JSX opening/self-closing element a fiber._debugSource points at.
 *
 * Dev stacks that prepend a module preamble (e.g. @vitejs/plugin-react's
 * react-refresh preamble) shift the reported LINE down by a constant per file
 * while the COLUMN is preserved. We trust the column (and tag, when supplied)
 * and pick the matching element nearest at-or-above the reported line.
 */
export function resolveJsxElement(
  sf: SourceFile,
  line: number,
  column: number,
  tag?: string
): JsxOpeningElement | JsxSelfClosingElement | undefined {
  // 1. Exact phase — accurate _debugSource (no offset).
  const exact = exactAt(sf, line, column);
  if (exact && (tag === undefined || tagText(exact) === tag)) return exact;

  // 2. Tolerant phase — column preserved, line shifted by a positive constant.
  const all = [
    ...sf.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
    ...sf.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
  ];
  const sameColumn = all.filter((n) => lineColOf(sf, n).column === column);
  const byTag = tag === undefined ? [] : sameColumn.filter((n) => tagText(n) === tag);
  const candidates = byTag.length > 0 ? byTag : sameColumn;

  // The true element is at or above the reported line; take the closest from below.
  const ranked = candidates
    .map((n) => ({ n, line: lineColOf(sf, n).line }))
    .filter((c) => c.line <= line)
    .sort((a, b) => b.line - a.line);
  return ranked.length > 0 ? ranked[0].n : undefined;
}
