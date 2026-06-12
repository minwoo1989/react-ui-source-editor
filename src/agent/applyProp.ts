// src/agent/applyProp.ts
import { Node } from "ts-morph";
import { getAttribute, getOpening } from "./jsxNodes.js";

function initializerFor(value: string | number | boolean): string {
  if (typeof value === "string") return JSON.stringify(value); // "value"
  return `{${String(value)}}`; // {40} or {true}
}

export function applyProp(el: Node, name: string, value: string | number | boolean): void {
  const opening = getOpening(el);
  const attr = getAttribute(el, name);

  const initText = initializerFor(value);
  if (!attr) {
    opening.addAttribute({ name, initializer: initText });
    return;
  }
  attr.setInitializer(initText);
}
