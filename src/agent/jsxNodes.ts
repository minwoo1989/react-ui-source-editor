// src/agent/jsxNodes.ts
import { Node, SyntaxKind } from "ts-morph";

/** The opening element of a JsxElement, or the self-closing/opening node itself. */
export function getOpening(el: Node): any {
  return el.getKind() === SyntaxKind.JsxElement ? (el as any).getOpeningElement() : el;
}

/** Find a JsxAttribute by name on the element's opening; undefined if absent. */
export function getAttribute(el: Node, name: string): any {
  return getOpening(el)
    .getAttributes()
    .find((a: Node) => Node.isJsxAttribute(a) && a.getNameNode().getText() === name);
}
