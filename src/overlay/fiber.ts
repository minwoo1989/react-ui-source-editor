// src/overlay/fiber.ts
export interface SourceLoc { file: string; line: number; column: number; tag?: string; }

function fiberTypeName(fiber: any): string | undefined {
  const t = fiber.type;
  if (typeof t === "string") return t;                       // host element: "div"
  if (typeof t === "function") return t.displayName || t.name || undefined; // composite
  if (t && typeof t === "object") {
    // memo/forwardRef: prefer an explicit displayName, then the inner render (forwardRef)
    // or wrapped type (memo) function name.
    return (
      t.displayName ||
      (t.render && (t.render.displayName || t.render.name)) ||
      (t.type && typeof t.type === "function" && (t.type.displayName || t.type.name)) ||
      undefined
    );
  }
  return undefined;
}

/** Walk up the React fiber from a DOM node to find _debugSource. */
export function sourceLocFor(node: Element): SourceLoc | undefined {
  const key = Object.keys(node).find((k) => k.startsWith("__reactFiber$"));
  if (!key) return undefined;
  let fiber: any = (node as any)[key];
  while (fiber) {
    const src = fiber._debugSource;
    if (src && src.fileName) {
      return { file: src.fileName, line: src.lineNumber, column: src.columnNumber, tag: fiberTypeName(fiber) };
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
