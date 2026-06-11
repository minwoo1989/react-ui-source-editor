import { describe, it, expect } from "vitest";
import { detectEol, normalizeEol } from "../../src/agent/eol.js";
import { Project } from "ts-morph";
import { processEdits } from "../../src/agent/apply.js";
import type { EditRequest } from "../../src/shared/types.js";

describe("detectEol", () => {
  it("detects CRLF", () => {
    expect(detectEol("a\r\nb\r\nc")).toBe("\r\n");
  });
  it("detects LF", () => {
    expect(detectEol("a\nb\nc")).toBe("\n");
  });
  it("returns the majority ending for mixed text (CRLF majority)", () => {
    expect(detectEol("a\r\nb\r\nc\n")).toBe("\r\n");
  });
  it("returns the majority ending for mixed text (LF majority)", () => {
    expect(detectEol("a\r\nb\nc\n")).toBe("\n");
  });
  it("defaults to LF when there is no line break", () => {
    expect(detectEol("single line")).toBe("\n");
  });
});

describe("normalizeEol", () => {
  it("converts mixed text to all-CRLF", () => {
    expect(normalizeEol("a\r\nb\nc", "\r\n")).toBe("a\r\nb\r\nc");
  });
  it("converts mixed text to all-LF", () => {
    expect(normalizeEol("a\r\nb\nc", "\n")).toBe("a\nb\nc");
  });
  it("is idempotent", () => {
    const once = normalizeEol("a\r\nb\nc", "\r\n");
    expect(normalizeEol(once, "\r\n")).toBe(once);
  });
  it("leaves single-line text unchanged", () => {
    expect(normalizeEol("one line", "\r\n")).toBe("one line");
  });
});

describe("processEdits output normalized to the source EOL", () => {
  it("yields no lone \\n after normalizing a CRLF source edit", () => {
    const original = [
      "const C = () => (",
      "  <button",
      "    style={{",
      '      color: "red",',
      "    }}",
      "  >hi</button>",
      ");",
    ].join("\r\n");

    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile("/F.tsx", original);
    const req: EditRequest = {
      file: "/F.tsx", line: 2, column: 3,
      edits: [{ kind: "style", property: "padding", value: 8 }],
    };

    const result = processEdits(project, req);
    expect(result.status).toBe("applied");
    if (result.status !== "applied") return;

    const normalized = normalizeEol(result.newText, detectEol(original));
    expect(normalized).toContain("padding");
    // every \n must be preceded by \r — i.e. no lone LF remains
    expect(/(?<!\r)\n/.test(normalized)).toBe(false);
  });
});
