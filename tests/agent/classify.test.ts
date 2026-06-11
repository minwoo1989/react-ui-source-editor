// tests/agent/classify.test.ts
import { describe, it, expect } from "vitest";
import { Project, SyntaxKind } from "ts-morph";
import { resolveJsxElement } from "../../src/agent/locate.js";
import { classifyEdit } from "../../src/agent/classify.js";
import type { Edit } from "../../src/shared/types.js";

function elementAt(text: string, line: number, col: number) {
  const sf = new Project({ useInMemoryFileSystem: true }).createSourceFile("F.tsx", text);
  const opening = resolveJsxElement(sf, line, col)!;
  return opening.getParentIfKind(SyntaxKind.JsxElement) ??
         opening.getParentIfKind(SyntaxKind.JsxSelfClosingElement) ?? opening;
}

describe("classifyEdit", () => {
  it("string-literal prop -> safe", () => {
    const el = elementAt(`const C=()=>(<Button type="default" />);`, 1, 14);
    const edit: Edit = { kind: "prop", name: "type", value: "primary" };
    expect(classifyEdit(el, edit).safe).toBe(true);
  });

  it("expression prop -> suggest", () => {
    const el = elementAt(`const C=()=>(<Button type={btnType} />);`, 1, 14);
    const edit: Edit = { kind: "prop", name: "type", value: "primary" };
    expect(classifyEdit(el, edit).safe).toBe(false);
  });

  it("adding style when no style attr exists -> safe", () => {
    const el = elementAt(`const C=()=>(<Button />);`, 1, 14);
    const edit: Edit = { kind: "style", property: "marginTop", value: 8 };
    expect(classifyEdit(el, edit).safe).toBe(true);
  });

  it("style attr that is an identifier expression -> suggest", () => {
    const el = elementAt(`const C=()=>(<Button style={s} />);`, 1, 14);
    const edit: Edit = { kind: "style", property: "marginTop", value: 8 };
    expect(classifyEdit(el, edit).safe).toBe(false);
  });

  it("literal text child -> safe", () => {
    const el = elementAt(`const C=()=>(<Button>Save</Button>);`, 1, 14);
    const edit: Edit = { kind: "text", value: "저장" };
    expect(classifyEdit(el, edit).safe).toBe(true);
  });

  it("css prop present -> suggest (emotion)", () => {
    const el = elementAt("const C=()=>(<Button css={x}>Save</Button>);", 1, 14);
    const edit: Edit = { kind: "text", value: "저장" };
    expect(classifyEdit(el, edit).safe).toBe(false);
  });

  it("element rendered inside .map() -> suggest", () => {
    const el = elementAt(`const C=()=>(<>{items.map(i=><Button key={i}>x</Button>)}</>);`, 1, 30);
    const edit: Edit = { kind: "text", value: "y" };
    expect(classifyEdit(el, edit).safe).toBe(false);
  });
});

describe("classifyEdit: styleRemove", () => {
  it("is safe when style is an object literal", () => {
    const el = elementAt(`const C=()=>(<Button style={{ color: "red" }}>x</Button>);`, 1, 14);
    expect(classifyEdit(el, { kind: "styleRemove", property: "color" }).safe).toBe(true);
  });

  it("is safe (no-op) when there is no style attribute", () => {
    const el = elementAt(`const C=()=>(<Button>x</Button>);`, 1, 14);
    expect(classifyEdit(el, { kind: "styleRemove", property: "color" }).safe).toBe(true);
  });

  it("is unsafe when style is a dynamic expression", () => {
    const el = elementAt(`const C=()=>(<Button style={styles}>x</Button>);`, 1, 14);
    expect(classifyEdit(el, { kind: "styleRemove", property: "color" }).safe).toBe(false);
  });
});
