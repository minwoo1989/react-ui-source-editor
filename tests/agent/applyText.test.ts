// tests/agent/applyText.test.ts
import { describe, it, expect } from "vitest";
import { Project, SyntaxKind } from "ts-morph";
import { resolveJsxElement } from "../../src/agent/locate.js";
import { applyText } from "../../src/agent/applyText.js";

function elementAt(text: string, line: number, col: number) {
  const sf = new Project({ useInMemoryFileSystem: true }).createSourceFile("F.tsx", text);
  const opening = resolveJsxElement(sf, line, col)!;
  const el = opening.getParentIfKind(SyntaxKind.JsxElement)!;
  return { sf, el };
}

describe("applyText", () => {
  it("replaces literal text children", () => {
    const { sf, el } = elementAt(`const C=()=>(<Button>Save</Button>);`, 1, 14);
    applyText(el, "저장");
    expect(sf.getFullText()).toContain(`<Button>저장</Button>`);
  });

  it("trims surrounding whitespace of the original text", () => {
    const { sf, el } = elementAt(`const C=()=>(<Button>  Save  </Button>);`, 1, 14);
    applyText(el, "저장");
    expect(sf.getFullText()).toContain(`>저장<`);
  });
});
