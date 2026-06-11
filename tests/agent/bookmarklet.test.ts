// tests/agent/bookmarklet.test.ts
import { describe, it, expect } from "vitest";
import { bookmarkletHref, landingHtml } from "../../src/agent/bookmarklet.js";

describe("bookmarkletHref", () => {
  it("starts with javascript: and targets /overlay.js on the given port", () => {
    const href = bookmarkletHref(4567);
    expect(href.startsWith("javascript:")).toBe(true);
    expect(href).toContain("localhost:4567/overlay.js");
  });

  it("embeds Date.now() as a runtime cache-buster expression, not a frozen value", () => {
    const href = bookmarkletHref(4567);
    expect(href).toContain("Date.now()");
  });

  it("contains no characters that would break a double-quoted href attribute", () => {
    const href = bookmarkletHref(4567);
    expect(href).not.toContain('"');
    expect(href).not.toContain("&");
  });
});

describe("landingHtml", () => {
  it("includes the port and the bookmarklet href", () => {
    const html = landingHtml(4567);
    expect(html).toContain("4567");
    expect(html).toContain(bookmarkletHref(4567));
  });

  it("no longer renders a project root", () => {
    expect(landingHtml(4567)).not.toContain("Project root");
  });
});
