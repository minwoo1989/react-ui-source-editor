import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { FsListing } from "../shared/types.js";

/** Read-only listing for the panel's Browse UI. Never reads file contents. */
export function listDir(absPath: string): FsListing {
  const parentDir = dirname(absPath);
  const entries = readdirSync(absPath, { withFileTypes: true })
    .filter((e) => !e.name.startsWith(".") && e.name !== "node_modules")
    .map((e) => ({ name: e.name, path: join(absPath, e.name), dir: e.isDirectory() }))
    .sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
  return {
    path: absPath,
    // "" signals the panel to request the drive list next.
    parent: parentDir === absPath ? "" : parentDir,
    entries,
  };
}

/** Windows drive roots (empty on other platforms — listDir handles "/" there). */
export function listDrives(): FsListing {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const entries = [...letters]
    .map((l) => `${l}:\\`)
    .filter((root) => existsSync(root))
    .map((root) => ({ name: root, path: root, dir: true }));
  return { path: "", parent: "", entries };
}
