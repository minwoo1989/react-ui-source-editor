import { describe, it, expect } from "vitest";
import { buildEdits, parseStyleValue } from "../../src/overlay/editsDiff.js";
import type { InspectOk } from "../../src/shared/types.js";

const snapshot: InspectOk = {
  status: "ok",
  line: 1,
  styleEditable: true,
  style: [
    { property: "color", value: "red", editable: true },
    { property: "marginTop", value: "8", editable: true },
    { property: "width", value: "theme.w", editable: false },
  ],
  props: [],
  className: { value: "a b", editable: true },
  text: { value: "hello", editable: true },
};

function stateFrom(overrides: Partial<Parameters<typeof buildEdits>[1]> = {}) {
  return {
    style: [
      { property: "color", value: "red", removed: false, editable: true },
      { property: "marginTop", value: "8", removed: false, editable: true },
      { property: "width", value: "theme.w", removed: false, editable: false },
    ],
    added: [],
    className: "a b" as string | null,
    text: "hello" as string | null,
    ...overrides,
  };
}

describe("parseStyleValue", () => {
  it("parses plain numbers as numbers", () => {
    expect(parseStyleValue("8")).toBe(8);
    expect(parseStyleValue("-1.5")).toBe(-1.5);
    expect(parseStyleValue(" 8 ")).toBe(8);
  });
  it("keeps everything else a string", () => {
    expect(parseStyleValue("8px")).toBe("8px");
    expect(parseStyleValue("red")).toBe("red");
  });
});

describe("buildEdits", () => {
  it("emits nothing when state matches the snapshot", () => {
    expect(buildEdits(snapshot, stateFrom())).toEqual([]);
  });

  it("emits a style edit for a changed value, parsing numbers", () => {
    const state = stateFrom();
    state.style[1] = { ...state.style[1], value: "16" };
    expect(buildEdits(snapshot, state)).toEqual([{ kind: "style", property: "marginTop", value: 16 }]);
  });

  it("emits styleRemove for removed rows", () => {
    const state = stateFrom();
    state.style[0] = { ...state.style[0], removed: true };
    expect(buildEdits(snapshot, state)).toEqual([{ kind: "styleRemove", property: "color" }]);
  });

  it("never emits for read-only rows, even if mutated", () => {
    const state = stateFrom();
    state.style[2] = { ...state.style[2], value: "999", removed: true };
    expect(buildEdits(snapshot, state)).toEqual([]);
  });

  it("emits style edits for added rows, skipping blanks", () => {
    const state = stateFrom({ added: [
      { property: "padding", value: "4" },
      { property: "", value: "" },
      { property: "  ", value: "x" },
    ]});
    expect(buildEdits(snapshot, state)).toEqual([{ kind: "style", property: "padding", value: 4 }]);
  });

  it("emits a className prop edit on change", () => {
    expect(buildEdits(snapshot, stateFrom({ className: "a b c" })))
      .toEqual([{ kind: "prop", name: "className", value: "a b c" }]);
  });

  it("adds className when the snapshot had none and the user typed one", () => {
    const snap: InspectOk = { ...snapshot, className: undefined };
    expect(buildEdits(snap, stateFrom({ className: "new" })))
      .toEqual([{ kind: "prop", name: "className", value: "new" }]);
  });

  it("does not emit className when absent in snapshot and left empty", () => {
    const snap: InspectOk = { ...snapshot, className: undefined };
    expect(buildEdits(snap, stateFrom({ className: "" }))).toEqual([]);
  });

  it("skips className when the panel field was disabled (null)", () => {
    expect(buildEdits(snapshot, stateFrom({ className: null }))).toEqual([]);
  });

  it("emits a text edit on change, and skips when disabled (null)", () => {
    expect(buildEdits(snapshot, stateFrom({ text: "bye" }))).toEqual([{ kind: "text", value: "bye" }]);
    expect(buildEdits(snapshot, stateFrom({ text: null }))).toEqual([]);
  });

  it("pins ordering: added row duplicating a changed row emits both, added last", () => {
    const state = stateFrom({ added: [{ property: "color", value: "blue" }] });
    state.style[0] = { ...state.style[0], value: "green" };
    expect(buildEdits(snapshot, state)).toEqual([
      { kind: "style", property: "color", value: "green" },
      { kind: "style", property: "color", value: "blue" },
    ]);
  });

  it("pins ordering: removed row plus added row of the same name emits styleRemove then style", () => {
    const state = stateFrom({ added: [{ property: "color", value: "blue" }] });
    state.style[0] = { ...state.style[0], removed: true };
    expect(buildEdits(snapshot, state)).toEqual([
      { kind: "styleRemove", property: "color" },
      { kind: "style", property: "color", value: "blue" },
    ]);
  });
});
