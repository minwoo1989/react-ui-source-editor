import { describe, it, expect } from "vitest";
import { originFromSrc } from "../../src/overlay/agentOrigin.js";

describe("originFromSrc", () => {
  it("extracts the origin from a script src with query string", () => {
    expect(originFromSrc("http://localhost:4567/overlay.js?123")).toBe("http://localhost:4567");
  });

  it("works for any port", () => {
    expect(originFromSrc("http://localhost:9999/overlay.js")).toBe("http://localhost:9999");
  });

  it("works for a non-localhost host", () => {
    expect(originFromSrc("http://192.168.0.5:4600/overlay.js")).toBe("http://192.168.0.5:4600");
  });

  it("returns null for empty / nullish input", () => {
    expect(originFromSrc("")).toBeNull();
    expect(originFromSrc(null)).toBeNull();
    expect(originFromSrc(undefined)).toBeNull();
  });

  it("returns null for an unparseable src", () => {
    expect(originFromSrc("not a url")).toBeNull();
  });
});
