// src/agent/applyProp.ts
import { Node, SyntaxKind } from "ts-morph";

function getOpening(el: Node): any {
  return el.getKind() === SyntaxKind.JsxElement ? (el as any).getOpeningElement() : el;
}

function initializerFor(value: string | number | boolean): string {
  if (typeof value === "string") return JSON.stringify(value); // "value"
  return `{${String(value)}}`; // {40} or {true}
}

export function applyProp(el: Node, name: string, value: string | number | boolean): void {
  const opening = getOpening(el);
  const attr = opening
    .getAttributes()
    .find((a: Node) => Node.isJsxAttribute(a) && a.getNameNode().getText() === name);

  const initText = initializerFor(value);
  if (!attr) {
    opening.addAttribute({ name, initializer: initText });
    return;
  }
  attr.setInitializer(initText);
}
