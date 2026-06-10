import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { listDir, listDrives } from "../../src/agent/fsList.js";

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "fslist-"));
  mkdirSync(join(dir, "sub"));
  mkdirSync(join(dir, "node_modules"));
  writeFileSync(join(dir, "b.tsx"), "");
  writeFileSync(join(dir, "a.tsx"), "");
  writeFileSync(join(dir, ".hidden"), "");
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("listDir", () => {
  it("lists directories first, then files, alphabetically, with absolute paths", () => {
    const listing = listDir(dir);
    expect(listing.path).toBe(dir);
    expect(listing.entries.map((e) => e.name)).toEqual(["sub", "a.tsx", "b.tsx"]);
    expect(listing.entries[0]).toEqual({ name: "sub", path: join(dir, "sub"), dir: true });
  });

  it("excludes node_modules and dot-entries", () => {
    const names = listDir(dir).entries.map((e) => e.name);
    expect(names).not.toContain("node_modules");
    expect(names).not.toContain(".hidden");
  });

  it("reports the parent directory", () => {
    expect(listDir(dir).parent).toBe(dirname(dir));
  });

  it("reports empty parent at a filesystem root", () => {
    const root = dirname(dir).split(/[\\/]/)[0] + (process.platform === "win32" ? "\\" : "/");
    expect(listDir(root).parent).toBe("");
  });
});

describe("listDrives", () => {
  it("returns directory entries with empty path", () => {
    const listing = listDrives();
    expect(listing.path).toBe("");
    expect(listing.parent).toBe("");
    expect(Array.isArray(listing.entries)).toBe(true);
    for (const e of listing.entries) expect(e.dir).toBe(true);
  });
});
