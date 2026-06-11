// src/overlay/fiber.ts
export interface SourceLoc { file: string; line: number; column: number; tag?: string; }

// Minimal shape of a React fiber we rely on.
export interface FiberLike {
  type?: unknown;
  _debugSource?: { fileName?: string; lineNumber?: number; columnNumber?: number };
  return?: FiberLike | null;
  child?: FiberLike | null;
  sibling?: FiberLike | null;
  stateNode?: unknown;
}

function typeName(t: unknown): string | undefined {
  if (typeof t === "string") return t;
  if (typeof t === "function") return (t as { displayName?: string; name?: string }).displayName || (t as { name?: string }).name || undefined;
  if (t && typeof t === "object") {
    const o = t as { displayName?: string; render?: { displayName?: string; name?: string }; type?: unknown };
    if (o.displayName) return o.displayName;
    if (o.render) { const n = o.render.displayName || o.render.name; if (n) return n; }
    if (o.type && typeof o.type === "function") {
      const ft = o.type as { displayName?: string; name?: string };
      const n = ft.displayName || ft.name;
      if (n) return n;
    }
    return undefined;
  }
  return undefined;
}

function hasSource(f: FiberLike): boolean {
  return !!(f._debugSource && f._debugSource.fileName);
}

function sameLoc(a: FiberLike, b: FiberLike): boolean {
  const x = a._debugSource, y = b._debugSource;
  return !!x && !!y && x.fileName === y.fileName && x.lineNumber === y.lineNumber && x.columnNumber === y.columnNumber;
}

function isElement(x: unknown): x is Element {
  return !!x && typeof x === "object" && (x as { nodeType?: number }).nodeType === 1;
}

/** The React fiber attached to a DOM node, if any. */
export function fiberOf(node: Element): FiberLike | undefined {
  const key = Object.keys(node).find((k) => k.startsWith("__reactFiber$"));
  return key ? (node as unknown as Record<string, FiberLike>)[key] : undefined;
}

/** From `fiber` upward (inclusive), the first fiber carrying _debugSource. */
export function nearestSourceFiber(fiber: FiberLike | undefined): FiberLike | undefined {
  let f: FiberLike | null | undefined = fiber;
  while (f) { if (hasSource(f)) return f; f = f.return; }
  return undefined;
}

/** First distinct source-bearing ancestor of `fiber` (different loc). */
export function parentSourceFiber(fiber: FiberLike): FiberLike | undefined {
  let f: FiberLike | null | undefined = fiber.return;
  while (f) { if (hasSource(f) && !sameLoc(f, fiber)) return f; f = f.return; }
  return undefined;
}

/** First distinct source-bearing descendant of `fiber`, depth-first. */
export function childSourceFiber(fiber: FiberLike): FiberLike | undefined {
  function dfs(start: FiberLike | null | undefined): FiberLike | undefined {
    for (let c = start; c; c = c.sibling) {
      if (hasSource(c) && !sameLoc(c, fiber)) return c;
      const deeper = dfs(c.child);
      if (deeper) return deeper;
    }
    return undefined;
  }
  return dfs(fiber.child);
}

/** {file,line,column,tag} from a fiber's _debugSource + type; undefined when no source. */
export function locOf(fiber: FiberLike): SourceLoc | undefined {
  const s = fiber._debugSource;
  if (!s || !s.fileName) return undefined;
  return { file: s.fileName, line: s.lineNumber ?? 0, column: s.columnNumber ?? 0, tag: typeName(fiber.type) };
}

/** The fiber's host DOM element (its stateNode, or the nearest host descendant). */
export function domNodeOf(fiber: FiberLike): Element | undefined {
  if (isElement(fiber.stateNode)) return fiber.stateNode;
  function dfs(start: FiberLike | null | undefined): Element | undefined {
    for (let c = start; c; c = c.sibling) {
      if (isElement(c.stateNode)) return c.stateNode;
      const deeper = dfs(c.child);
      if (deeper) return deeper;
    }
    return undefined;
  }
  return dfs(fiber.child);
}

/** Display name for a fiber (host tag / composite name). */
export function nameOf(fiber: FiberLike): string {
  return typeName(fiber.type) ?? "element";
}

