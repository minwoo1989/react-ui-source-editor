// tests/agent/locate.test.ts
import { describe, it, expect } from "vitest";
import { Project } from "ts-morph";
import { resolveJsxElement } from "../../src/agent/locate.js";

function sourceFileFrom(text: string) {
  const project = new Project({ useInMemoryFileSystem: true });
  return project.createSourceFile("F.tsx", text);
}

// <div> at true line 4 col 5, <span> at true line 5 col 7, <br/> at line 6 col 7.
const NESTED = [
  "import x from 'y';",          // 1
  "export function C() {",       // 2
  "  return (",                  // 3
  '    <div className="a">',     // 4
  "      <span>hi</span>",       // 5
  "      <br/>",                 // 6
  "    </div>",                  // 7
  "  );",                        // 8
  "}",                           // 9
].join("\n");

describe("resolveJsxElement", () => {
  it("exact phase: resolves an accurate (offset-0) position", () => {
    const sf = sourceFileFrom(NESTED);
    const node = resolveJsxElement(sf, 4, 5, "div");
    expect(node).toBeDefined();
    expect(node!.getKindName()).toMatch(/JsxOpeningElement|JsxSelfClosingElement/);
    expect(sf.compilerNode.getLineAndCharacterOfPosition(node!.getStart()).line + 1).toBe(4);
  });

  it("tolerant phase: resolves a line-shifted position via column + tag", () => {
    const sf = sourceFileFrom(NESTED);
    // simulate a +10 preamble shift: <span> reported at line 15, col preserved (7)
    const node = resolveJsxElement(sf, 15, 7, "span");
    expect(node).toBeDefined();
    expect(sf.compilerNode.getLineAndCharacterOfPosition(node!.getStart()).line + 1).toBe(5);
  });

  it("tolerant phase: works for self-closing elements", () => {
    const sf = sourceFileFrom(NESTED);
    const node = resolveJsxElement(sf, 16, 7, "br"); // <br/> true line 6
    expect(node).toBeDefined();
    expect(sf.compilerNode.getLineAndCharacterOfPosition(node!.getStart()).line + 1).toBe(6);
  });

  it("falls back to column-only when the tag does not match (e.g. member expr)", () => {
    const sf = sourceFileFrom(NESTED);
    // only one element at column 5 (the div); unknown tag -> column-only fallback
    const node = resolveJsxElement(sf, 14, 5, "Some.Member");
    expect(node).toBeDefined();
    expect(sf.compilerNode.getLineAndCharacterOfPosition(node!.getStart()).line + 1).toBe(4);
  });

  it("ambiguous identical (column,tag): returns the nearest from below (documented limitation)", () => {
    const sf = sourceFileFrom([
      "export function C(one: boolean) {",  // 1
      "  return one ? (",                   // 2
      "    <div>a</div>",                   // 3  div col5
      "  ) : (",                            // 4
      "    <div>b</div>",                   // 5  div col5
      "  );",                               // 6
      "}",                                  // 7
    ].join("\n"));
    const node = resolveJsxElement(sf, 16, 5, "div"); // reported 16; both 3 and 5 are above
    expect(sf.compilerNode.getLineAndCharacterOfPosition(node!.getStart()).line + 1).toBe(5);
  });

  it("returns undefined when no element matches the column", () => {
    const sf = sourceFileFrom(NESTED);
    expect(resolveJsxElement(sf, 100, 99, "div")).toBeUndefined();
  });

  it("does not throw when the reported line is past end-of-file", () => {
    const sf = sourceFileFrom(NESTED);
    // line 9 is the last line; a shifted report could exceed it
    expect(() => resolveJsxElement(sf, 999, 5, "div")).not.toThrow();
  });
});
