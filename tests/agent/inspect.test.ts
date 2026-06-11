// tests/agent/inspect.test.ts
import { describe, it, expect } from "vitest";
import { Project } from "ts-morph";
import { inspectJsxElement } from "../../src/agent/inspect.js";

function sfOf(text: string) {
  return new Project({ useInMemoryFileSystem: true }).createSourceFile("F.tsx", text);
}

describe("inspectJsxElement", () => {
  it("returns literal style entries as editable", () => {
    const sf = sfOf(`const C=()=>(<Button style={{ color: "red", marginTop: 8 }}>x</Button>);`);
    const res = inspectJsxElement(sf, 1, 14);
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.styleEditable).toBe(true);
    expect(res.style).toEqual([
      { property: "color", value: "red", editable: true },
      { property: "marginTop", value: "8", editable: true },
    ]);
  });

  it("marks non-literal style values read-only with raw source text", () => {
    const sf = sfOf(`const C=()=>(<Button style={{ color: theme.primary }}>x</Button>);`);
    const res = inspectJsxElement(sf, 1, 14);
    if (res.status !== "ok") throw new Error("expected ok");
    expect(res.style).toEqual([{ property: "color", value: "theme.primary", editable: false }]);
  });

  it("flags a non-object-literal style attribute as not editable", () => {
    const sf = sfOf(`const C=()=>(<Button style={styles}>x</Button>);`);
    const res = inspectJsxElement(sf, 1, 14);
    if (res.status !== "ok") throw new Error("expected ok");
    expect(res.styleEditable).toBe(false);
    expect(res.style).toEqual([]);
  });

  it("returns empty editable style when there is no style attribute", () => {
    const sf = sfOf(`const C=()=>(<Button>x</Button>);`);
    const res = inspectJsxElement(sf, 1, 14);
    if (res.status !== "ok") throw new Error("expected ok");
    expect(res.styleEditable).toBe(true);
    expect(res.style).toEqual([]);
  });

  it("returns editable className for a string literal", () => {
    const sf = sfOf(`const C=()=>(<Button className="a b">x</Button>);`);
    const res = inspectJsxElement(sf, 1, 14);
    if (res.status !== "ok") throw new Error("expected ok");
    expect(res.className).toEqual({ value: "a b", editable: true });
  });

  it("returns read-only className for an expression", () => {
    const sf = sfOf(`const C=()=>(<Button className={cls}>x</Button>);`);
    const res = inspectJsxElement(sf, 1, 14);
    if (res.status !== "ok") throw new Error("expected ok");
    expect(res.className?.editable).toBe(false);
  });

  it("omits className when the attribute is absent", () => {
    const sf = sfOf(`const C=()=>(<Button>x</Button>);`);
    const res = inspectJsxElement(sf, 1, 14);
    if (res.status !== "ok") throw new Error("expected ok");
    expect(res.className).toBeUndefined();
  });

  it("returns editable text for a single literal text child", () => {
    const sf = sfOf(`const C=()=>(<Button>hello</Button>);`);
    const res = inspectJsxElement(sf, 1, 14);
    if (res.status !== "ok") throw new Error("expected ok");
    expect(res.text).toEqual({ value: "hello", editable: true });
  });

  it("omits text when children include elements", () => {
    const sf = sfOf(`const C=()=>(<Button><i>x</i></Button>);`);
    const res = inspectJsxElement(sf, 1, 14);
    if (res.status !== "ok") throw new Error("expected ok");
    expect(res.text).toBeUndefined();
  });

  it("omits text for self-closing elements", () => {
    const sf = sfOf(`const C=()=>(<Input />);`);
    const res = inspectJsxElement(sf, 1, 14);
    if (res.status !== "ok") throw new Error("expected ok");
    expect(res.text).toBeUndefined();
  });

  it("errors when no JSX element exists at the position", () => {
    const sf = sfOf(`const x = 1;`);
    const res = inspectJsxElement(sf, 1, 1);
    expect(res).toEqual({ status: "error", message: "no JSX element near line 1" });
  });

  it("returns spread entries as raw read-only rows", () => {
    const sf = sfOf(`const C=()=>(<Button style={{ ...base, color: "red" }}>x</Button>);`);
    const res = inspectJsxElement(sf, 1, 14);
    if (res.status !== "ok") throw new Error("expected ok");
    expect(res.style).toEqual([
      { property: "...base", value: "", editable: false },
      { property: "color", value: "red", editable: true },
    ]);
  });

  it("resolves a line-shifted selection via column + tag", () => {
    const sf = sfOf([
      "import x from 'y';",                 // 1
      "export const C = () => (",           // 2
      '  <button style={{ color: "red" }}>hi</button>', // 3  <button col 3
      ");",                                 // 4
    ].join("\n"));
    // report line 13 (a +10 shift), correct column 3, tag "button"
    const res = inspectJsxElement(sf, 13, 3, "button");
    expect(res.status).toBe("ok");
    if (res.status === "ok") {
      expect(res.style.find((s) => s.property === "color")?.value).toBe("red");
    }
  });

  it("returns an explicit error (not an empty ok) when nothing resolves", () => {
    const sf = sfOf('const C = () => (<button>hi</button>);');
    const res = inspectJsxElement(sf, 999, 99, "button");
    expect(res.status).toBe("error");
    if (res.status === "error") expect(res.message).toMatch(/near line 999/);
  });
});
