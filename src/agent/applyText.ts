// src/agent/applyText.ts
import { Node } from "ts-morph";

/** Replace the text content of a JsxElement that has a single literal text child. */
export function applyText(el: Node, value: string): void {
  if (!Node.isJsxElement(el)) throw new Error("applyText requires a JsxElement");
  const open = el.getOpeningElement();
  const close = el.getClosingElement();
  // Replace everything between > and </ with the new value.
  const start = open.getEnd();
  const end = close.getStart();
  const sf = el.getSourceFile();
  sf.replaceText([start, end], value);
}
