// src/agent/locate.ts
import { SourceFile, Node, ts, SyntaxKind } from "ts-morph";

/**
 * Find the JSX opening (or self-closing) element at a 1-based line/column,
 * matching the position React's _debugSource reports.
 */
export function locateJsxElement(
  sf: SourceFile,
  line: number,
  column: number
): Node | undefined {
  const pos = ts.getPositionOfLineAndCharacter(
    sf.compilerNode,
    line - 1,
    column - 1
  );
  let node: Node | undefined = sf.getDescendantAtPos(pos);
  while (node) {
    if (
      node.getKind() === SyntaxKind.JsxOpeningElement ||
      node.getKind() === SyntaxKind.JsxSelfClosingElement
    ) {
      return node;
    }
    node = node.getParent();
  }
  return undefined;
}
