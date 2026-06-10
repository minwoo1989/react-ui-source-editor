// tests/agent/applyStyle.test.ts
import { describe, it, expect } from "vitest";
import { Project, SyntaxKind } from "ts-morph";
import { locateJsxElement } from "../../src/agent/locate.js";
import { applyStyle, removeStyle } from "../../src/agent/applyStyle.js";

function elementAt(text: string, line: number, col: number) {
  const sf = new Project({ useInMemoryFileSystem: true }).createSourceFile("F.tsx", text);
  const opening = locateJsxElement(sf, line, col)!;
  const el = opening.getParentIfKind(SyntaxKind.JsxElement) ?? opening;
  return { sf, el };
}

describe("applyStyle", () => {
  it("adds a style attribute when none exists", () => {
    const { sf, el } = elementAt(`const C=()=>(<Button>x</Button>);`, 1, 14);
    applyStyle(el, "marginTop", 8);
    expect(sf.getFullText()).toContain(`style={{ marginTop: 8 }}`);
  });

  it("merges into an existing object-literal style", () => {
    const { sf, el } = elementAt(`const C=()=>(<Button style={{ color: "red" }}>x</Button>);`, 1, 14);
    applyStyle(el, "marginTop", 8);
    const out = sf.getFullText();
    expect(out).toContain("color:");
    expect(out).toContain("marginTop: 8");
  });

  it("overwrites an existing key", () => {
    const { sf, el } = elementAt(`const C=()=>(<Button style={{ marginTop: 4 }}>x</Button>);`, 1, 14);
    applyStyle(el, "marginTop", 8);
    expect(sf.getFullText()).toContain("marginTop: 8");
    expect(sf.getFullText()).not.toContain("marginTop: 4");
  });

  it("quotes string values", () => {
    const { sf, el } = elementAt(`const C=()=>(<Button>x</Button>);`, 1, 14);
    applyStyle(el, "color", "red");
    expect(sf.getFullText()).toContain(`color: "red"`);
  });
});

describe("removeStyle", () => {
  it("removes a property from the style object", () => {
    const { sf, el } = elementAt(`const C=()=>(<Button style={{ color: "red", marginTop: 8 }}>x</Button>);`, 1, 14);
    removeStyle(el, "marginTop");
    expect(sf.getFullText()).toContain(`color: "red"`);
    expect(sf.getFullText()).not.toContain("marginTop");
  });

  it("removes the style attribute when the last property is removed", () => {
    const { sf, el } = elementAt(`const C=()=>(<Button style={{ color: "red" }}>x</Button>);`, 1, 14);
    removeStyle(el, "color");
    expect(sf.getFullText()).not.toContain("style=");
  });

  it("is a no-op when the property is absent", () => {
    const { sf, el } = elementAt(`const C=()=>(<Button style={{ color: "red" }}>x</Button>);`, 1, 14);
    removeStyle(el, "marginTop");
    expect(sf.getFullText()).toContain(`style={{ color: "red" }}`);
  });

  it("is a no-op when there is no style attribute", () => {
    const { sf, el } = elementAt(`const C=()=>(<Button>x</Button>);`, 1, 14);
    removeStyle(el, "color");
    expect(sf.getFullText()).toBe(`const C=()=>(<Button>x</Button>);`);
  });

  it("throws when style is not an object literal", () => {
    const { el } = elementAt(`const C=()=>(<Button style={styles}>x</Button>);`, 1, 14);
    expect(() => removeStyle(el, "color")).toThrow("style is not an object literal");
  });
});
