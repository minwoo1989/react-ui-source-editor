import { describe, it, expect } from "vitest";
import { isEditableSourcePath } from "../../src/agent/paths.js";

describe("isEditableSourcePath", () => {
  it("accepts .tsx/.jsx/.ts/.js, case-insensitively", () => {
    expect(isEditableSourcePath("D:\\app\\src\\App.tsx")).toBe(true);
    expect(isEditableSourcePath("/home/u/app/src/App.jsx")).toBe(true);
    expect(isEditableSourcePath("C:/x/y.ts")).toBe(true);
    expect(isEditableSourcePath("C:/x/y.js")).toBe(true);
    expect(isEditableSourcePath("C:/x/Y.TSX")).toBe(true);
  });

  it("rejects everything else", () => {
    expect(isEditableSourcePath("C:\\Windows\\System32\\drivers\\etc\\hosts")).toBe(false);
    expect(isEditableSourcePath("D:/app/.env")).toBe(false);
    expect(isEditableSourcePath("D:/app/package.json")).toBe(false);
    expect(isEditableSourcePath("")).toBe(false);
    expect(isEditableSourcePath("D:/app/foo.tsx.bak")).toBe(false);
  });

  it("returns false for non-string input (unvalidated JSON body)", () => {
    expect(isEditableSourcePath(undefined as unknown as string)).toBe(false);
  });
});
