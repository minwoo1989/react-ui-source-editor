// tests/agent/locate.test.ts
import { describe, it, expect } from "vitest";
import { Project } from "ts-morph";
import { locateJsxElement } from "../../src/agent/locate.js";

function sourceFileFrom(text: string) {
  const project = new Project({ useInMemoryFileSystem: true });
  return project.createSourceFile("F.tsx", text);
}

describe("locateJsxElement", () => {
  it("finds the opening element at the given 1-based line/column", () => {
    const text = [
      "const C = () => (",
      "  <Button type=\"default\">Save</Button>",
      ");",
    ].join("\n");
    const sf = sourceFileFrom(text);
    // "<Button" starts at line 2, column 3 (1-based)
    const node = locateJsxElement(sf, 2, 3);
    expect(node).toBeDefined();
    expect(node!.getKindName()).toMatch(/JsxOpeningElement|JsxSelfClosingElement/);
  });
});
