// tests/agent/applyProp.test.ts
import { describe, it, expect } from "vitest";
import { Project, SyntaxKind } from "ts-morph";
import { locateJsxElement } from "../../src/agent/locate.js";
import { applyProp } from "../../src/agent/applyProp.js";

function elementAt(text: string, line: number, col: number) {
  const sf = new Project({ useInMemoryFileSystem: true }).createSourceFile("F.tsx", text);
  const opening = locateJsxElement(sf, line, col)!;
  const el = opening.getParentIfKind(SyntaxKind.JsxElement) ?? opening;
  return { sf, el };
}

describe("applyProp", () => {
  it("replaces a string-literal prop value", () => {
    const { sf, el } = elementAt(`const C=()=>(<Button type="default" />);`, 1, 14);
    applyProp(el, "type", "primary");
    expect(sf.getFullText()).toContain(`type="primary"`);
  });

  it("adds a new string prop when absent", () => {
    const { sf, el } = elementAt(`const C=()=>(<Button />);`, 1, 14);
    applyProp(el, "type", "primary");
    expect(sf.getFullText()).toContain(`type="primary"`);
  });

  it("writes numeric values inside braces", () => {
    const { sf, el } = elementAt(`const C=()=>(<Avatar />);`, 1, 14);
    applyProp(el, "size", 40);
    expect(sf.getFullText()).toContain(`size={40}`);
  });

  it("writes boolean values inside braces", () => {
    const { sf, el } = elementAt(`const C=()=>(<Button />);`, 1, 14);
    applyProp(el, "disabled", true);
    expect(sf.getFullText()).toContain(`disabled={true}`);
  });
});
