import { describe, it, expect } from "vitest";
import {
  fiberOf, nearestSourceFiber, parentSourceFiber, childSourceFiber,
  locOf, domNodeOf, nameOf, type FiberLike,
} from "../../src/overlay/fiber.js";

type Loc = { f: string; l: number; c: number };
function mk(opts: { type?: unknown; loc?: Loc; stateNode?: unknown } = {}): FiberLike {
  return {
    type: opts.type,
    _debugSource: opts.loc ? { fileName: opts.loc.f, lineNumber: opts.loc.l, columnNumber: opts.loc.c } : undefined,
    return: null, child: null, sibling: null, stateNode: opts.stateNode,
  };
}
function link(parent: FiberLike, ...children: FiberLike[]): FiberLike {
  parent.child = children[0] ?? null;
  children.forEach((c, i) => { c.return = parent; c.sibling = children[i + 1] ?? null; });
  return parent;
}

describe("nearestSourceFiber", () => {
  it("walks up (inclusive) to the first fiber with _debugSource", () => {
    const root = mk({ loc: { f: "/A.tsx", l: 1, c: 1 } });
    const mid = mk();
    const leaf = mk();
    link(root, mid); link(mid, leaf);
    expect(nearestSourceFiber(leaf)).toBe(root);
    expect(nearestSourceFiber(undefined)).toBeUndefined();
  });
});

describe("parentSourceFiber", () => {
  it("returns the nearest distinct source ancestor, skipping non-source fibers", () => {
    const root = mk({ loc: { f: "/A.tsx", l: 1, c: 1 } });
    const mid = mk();
    const leaf = mk({ loc: { f: "/A.tsx", l: 9, c: 3 } });
    link(root, mid); link(mid, leaf);
    expect(parentSourceFiber(leaf)).toBe(root);
  });
  it("skips an ancestor with the same loc and returns undefined at the root", () => {
    const a = mk({ loc: { f: "/A.tsx", l: 5, c: 2 } });
    const b = mk({ loc: { f: "/A.tsx", l: 5, c: 2 } });
    link(a, b);
    expect(parentSourceFiber(b)).toBeUndefined();
  });
});

describe("childSourceFiber", () => {
  it("returns the depth-first first distinct source descendant", () => {
    const root = mk({ loc: { f: "/A.tsx", l: 1, c: 1 } });
    const m1 = mk();
    const leaf1 = mk({ loc: { f: "/A.tsx", l: 4, c: 5 } });
    const m2 = mk({ loc: { f: "/A.tsx", l: 8, c: 5 } });
    link(root, m1, m2); link(m1, leaf1);
    expect(childSourceFiber(root)).toBe(leaf1);
  });
  it("skips a same-loc child and returns a distinct grandchild", () => {
    const root = mk({ loc: { f: "/A.tsx", l: 1, c: 1 } });
    const child = mk({ loc: { f: "/A.tsx", l: 1, c: 1 } });
    const gc = mk({ loc: { f: "/A.tsx", l: 6, c: 2 } });
    link(root, child); link(child, gc);
    expect(childSourceFiber(root)).toBe(gc);
  });
  it("returns undefined when no distinct source descendant exists", () => {
    const root = mk({ loc: { f: "/A.tsx", l: 1, c: 1 } });
    link(root, mk(), mk());
    expect(childSourceFiber(root)).toBeUndefined();
  });
});

describe("locOf", () => {
  it("maps _debugSource + type to a SourceLoc", () => {
    expect(locOf(mk({ type: "div", loc: { f: "/A.tsx", l: 5, c: 3 } })))
      .toEqual({ file: "/A.tsx", line: 5, column: 3, tag: "div" });
  });
  it("returns undefined without _debugSource", () => {
    expect(locOf(mk({ type: "div" }))).toBeUndefined();
  });
});

describe("nameOf", () => {
  it("uses the host tag", () => { expect(nameOf(mk({ type: "section" }))).toBe("section"); });
  it("uses a function component name", () => {
    function Foo() { return null; }
    expect(nameOf(mk({ type: Foo }))).toBe("Foo");
  });
  it("falls back to 'element' for an unknown type", () => {
    expect(nameOf(mk({ type: undefined }))).toBe("element");
  });
});

describe("domNodeOf", () => {
  it("returns an element stateNode directly", () => {
    const el = { nodeType: 1 };
    expect(domNodeOf(mk({ stateNode: el }))).toBe(el);
  });
  it("returns the nearest host descendant when the fiber has no element stateNode", () => {
    const el = { nodeType: 1 };
    const comp = mk({ stateNode: null });
    const host = mk({ stateNode: el });
    link(comp, host);
    expect(domNodeOf(comp)).toBe(el);
  });
});

describe("fiberOf", () => {
  it("reads the __reactFiber$ key", () => {
    const f = mk();
    const node = { ["__reactFiber$abc"]: f } as unknown as Element;
    expect(fiberOf(node)).toBe(f);
  });
  it("returns undefined when no fiber key is present", () => {
    expect(fiberOf({} as Element)).toBeUndefined();
  });
});
