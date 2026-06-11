// src/agent/classify.ts
import { Node, SyntaxKind } from "ts-morph";
import type { Edit } from "../shared/types.js";

export interface Classification {
  safe: boolean;
  reason: string;
}

function getOpening(el: Node): Node {
  if (el.getKind() === SyntaxKind.JsxElement) {
    return (el as any).getOpeningElement();
  }
  return el; // self-closing or opening element itself
}

function getAttribute(el: Node, name: string): Node | undefined {
  const opening = getOpening(el);
  return (opening as any)
    .getAttributes()
    .find((a: Node) => Node.isJsxAttribute(a) && a.getNameNode().getText() === name);
}

function insideMap(el: Node): boolean {
  let n: Node | undefined = el.getParent();
  while (n) {
    if (
      n.getKind() === SyntaxKind.CallExpression &&
      n.getText().includes(".map(")
    ) return true;
    n = n.getParent();
  }
  return false;
}

export function classifyEdit(el: Node, edit: Edit): Classification {
  // emotion: a `css` prop means styling lives outside plain props
  if (getAttribute(el, "css")) {
    return { safe: false, reason: "emotion `css` prop present; edit the styled definition" };
  }
  if (insideMap(el)) {
    return { safe: false, reason: "element is rendered via .map(); one edit affects many" };
  }

  if (edit.kind === "prop") {
    const attr = getAttribute(el, edit.name);
    if (!attr) return { safe: true, reason: "new literal prop" };
    const init = (attr as any).getInitializer();
    if (!init) return { safe: true, reason: "boolean shorthand prop" };
    if (Node.isStringLiteral(init)) return { safe: true, reason: "string-literal prop" };
    if (Node.isJsxExpression(init)) {
      const expr = init.getExpression();
      if (expr && isLiteralExpr(expr)) return { safe: true, reason: "literal expression prop" };
    }
    return { safe: false, reason: "prop value is a dynamic expression" };
  }

  if (edit.kind === "styleRemove") {
    const attr = getAttribute(el, "style");
    if (!attr) return { safe: true, reason: "no style attr; remove is a no-op" };
    const init = (attr as any).getInitializer();
    const expr = Node.isJsxExpression(init) ? init.getExpression() : undefined;
    if (expr && Node.isObjectLiteralExpression(expr)) {
      return { safe: true, reason: "style is an object literal; can remove key" };
    }
    return { safe: false, reason: "style is a dynamic expression" };
  }

  if (edit.kind === "style") {
    const attr = getAttribute(el, "style");
    if (!attr) return { safe: true, reason: "no style attr; can add one" };
    const init = (attr as any).getInitializer();
    const expr = Node.isJsxExpression(init) ? init.getExpression() : undefined;
    if (expr && Node.isObjectLiteralExpression(expr)) {
      return { safe: true, reason: "style is an object literal; can merge" };
    }
    return { safe: false, reason: "style is a dynamic expression" };
  }

  // text
  if (el.getKind() === SyntaxKind.JsxElement) {
    const children = (el as any).getJsxChildren() as Node[];
    const meaningful = children.filter(
      (c) => !(Node.isJsxText(c) && c.getText().trim() === "")
    );
    const onlyText =
      meaningful.length === 1 && Node.isJsxText(meaningful[0]);
    if (onlyText) return { safe: true, reason: "single literal text child" };
    return { safe: false, reason: "children include expressions/elements" };
  }
  return { safe: false, reason: "self-closing element has no text child" };
}

function isLiteralExpr(expr: Node): boolean {
  return (
    Node.isStringLiteral(expr) ||
    Node.isNumericLiteral(expr) ||
    expr.getKind() === SyntaxKind.TrueKeyword ||
    expr.getKind() === SyntaxKind.FalseKeyword
  );
}
