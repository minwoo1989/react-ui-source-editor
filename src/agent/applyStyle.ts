// src/agent/applyStyle.ts
import { Node, SyntaxKind } from "ts-morph";

function getOpening(el: Node): any {
  return el.getKind() === SyntaxKind.JsxElement ? (el as any).getOpeningElement() : el;
}

function literal(value: string | number): string {
  return typeof value === "number" ? String(value) : JSON.stringify(value);
}

export function applyStyle(el: Node, property: string, value: string | number): void {
  const opening = getOpening(el);
  const styleAttr = opening
    .getAttributes()
    .find((a: Node) => Node.isJsxAttribute(a) && a.getNameNode().getText() === "style");

  if (!styleAttr) {
    opening.addAttribute({ name: "style", initializer: `{{ ${property}: ${literal(value)} }}` });
    return;
  }

  const init = styleAttr.getInitializer();
  const obj = Node.isJsxExpression(init) ? init.getExpression() : undefined;
  if (!obj || !Node.isObjectLiteralExpression(obj)) {
    throw new Error("style is not an object literal");
  }

  const existing = obj.getProperty(property);
  if (existing && Node.isPropertyAssignment(existing)) {
    existing.setInitializer(literal(value));
  } else {
    obj.addPropertyAssignment({ name: property, initializer: literal(value) });
  }
}
