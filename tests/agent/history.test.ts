import { describe, it, expect } from "vitest";
import { createHistory } from "../../src/agent/history.js";

describe("createHistory", () => {
  it("starts empty", () => {
    const h = createHistory();
    expect(h.state()).toEqual({ canUndo: false, canRedo: false });
    expect(h.undo()).toBeNull();
    expect(h.redo()).toBeNull();
  });

  it("record enables undo and disables redo", () => {
    const h = createHistory();
    h.record("/a.tsx", "before", "after");
    expect(h.state()).toEqual({ canUndo: true, canRedo: false });
  });

  it("undo returns the before content and enables redo", () => {
    const h = createHistory();
    h.record("/a.tsx", "B", "A");
    expect(h.undo()).toEqual({ file: "/a.tsx", content: "B" });
    expect(h.state()).toEqual({ canUndo: false, canRedo: true });
  });

  it("redo returns the after content and re-enables undo", () => {
    const h = createHistory();
    h.record("/a.tsx", "B", "A");
    h.undo();
    expect(h.redo()).toEqual({ file: "/a.tsx", content: "A" });
    expect(h.state()).toEqual({ canUndo: true, canRedo: false });
  });

  it("a new record after undo clears the redo stack", () => {
    const h = createHistory();
    h.record("/a.tsx", "B", "A");
    h.undo();
    expect(h.state().canRedo).toBe(true);
    h.record("/b.tsx", "Y", "Z");
    expect(h.state()).toEqual({ canUndo: true, canRedo: false });
    expect(h.redo()).toBeNull();
  });

  it("undoes in global LIFO order across different files", () => {
    const h = createHistory();
    h.record("/a.tsx", "a0", "a1");
    h.record("/b.tsx", "b0", "b1");
    expect(h.undo()).toEqual({ file: "/b.tsx", content: "b0" });
    expect(h.undo()).toEqual({ file: "/a.tsx", content: "a0" });
    expect(h.undo()).toBeNull();
  });
});
