// src/overlay/fiber.ts
export interface SourceLoc { file: string; line: number; column: number; }

/** Walk up the React fiber from a DOM node to find _debugSource. */
export function sourceLocFor(node: Element): SourceLoc | undefined {
  const key = Object.keys(node).find((k) => k.startsWith("__reactFiber$"));
  if (!key) return undefined;
  let fiber: any = (node as any)[key];
  while (fiber) {
    const src = fiber._debugSource;
    if (src && src.fileName) {
      return { file: src.fileName, line: src.lineNumber, column: src.columnNumber };
    }
    fiber = fiber.return;
  }
  return undefined;
}

/** The displayed component/tag name for the selected node. */
export function componentNameFor(node: Element): string {
  const key = Object.keys(node).find((k) => k.startsWith("__reactFiber$"));
  if (!key) return node.tagName.toLowerCase();
  let fiber: any = (node as any)[key];
  while (fiber) {
    const t = fiber.type;
    if (typeof t === "function") return t.displayName || t.name || "Component";
    if (typeof t === "string") return t;
    fiber = fiber.return;
  }
  return node.tagName.toLowerCase();
}
