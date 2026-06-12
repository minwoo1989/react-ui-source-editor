import { describe, it, expect } from "vitest";
import { Project, SyntaxKind } from "ts-morph";
import { getOpening, getAttribute } from "../../src/agent/jsxNodes.js";

function jsx(text: string) {
  const sf = new Project({ useInMemoryFileSystem: true }).createSourceFile("F.tsx", `const X = () => (${text});`);
  const el = sf.getFirstDescendant(
    (n) => n.getKind() === SyntaxKind.JsxElement || n.getKind() === SyntaxKind.JsxSelfClosingElement
  );
  return el!;
}

describe("getOpening", () => {
  it("returns the opening element for a JsxElement", () => {
    expect(getOpening(jsx('<div className="a">hi</div>')).getKind()).toBe(SyntaxKind.JsxOpeningElement);
  });
  it("returns the node itself for a self-closing element", () => {
    const el = jsx("<br/>");
    expect(getOpening(el)).toBe(el);
  });
});

describe("getAttribute", () => {
  it("finds an existing attribute by name", () => {
    const attr = getAttribute(jsx('<div id="x" className="a">hi</div>'), "className");
    expect(attr).toBeDefined();
    expect(attr!.getText()).toContain("className");
  });
  it("returns undefined for an absent attribute", () => {
    expect(getAttribute(jsx("<div>hi</div>"), "style")).toBeUndefined();
  });
  it("accepts an opening element too (idempotent getOpening)", () => {
    const op = getOpening(jsx('<div id="x">hi</div>'));
    expect(getAttribute(op, "id")).toBeDefined();
  });
});
