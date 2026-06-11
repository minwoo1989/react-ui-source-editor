// src/agent/server.ts
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { resolve, join, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Project } from "ts-morph";
import { processEdits } from "./apply.js";
import { inspectJsxElement } from "./inspect.js";
import { listDir, listDrives } from "./fsList.js";
import { isEditableSourcePath } from "./paths.js";
import type { EditRequest, InspectRequest } from "../shared/types.js";
import { landingHtml } from "./bookmarklet.js";

const PORT = Number(process.env.PORT ?? 4567);

// dist/ and the backup dir sit at this repo's root; this module lives in src/agent/.
// Backups deliberately live in THIS repo so the target repo stays clean.
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const OVERLAY_BUNDLE = resolve(MODULE_DIR, "../../dist/overlay.js");
const BACKUP_DIR = resolve(MODULE_DIR, "../../.ui-modifier-backups");

function readBody(req: any): Promise<string> {
  return new Promise((res) => {
    let data = "";
    req.on("data", (c: Buffer) => (data += c));
    req.on("end", () => res(data));
  });
}

function cors(res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

/** Validate the absolute path from the overlay and read it; throws a clear message. */
function readSource(file: string): string {
  if (!isEditableSourcePath(file)) throw new Error(`not an editable source file: ${file}`);
  try {
    return readFileSync(file, "utf8");
  } catch {
    throw new Error(`file not found: ${file}`);
  }
}

/** ts-morph's in-memory FS wants forward slashes, even for windows drive paths. */
function memPath(file: string): string {
  return file.replace(/\\/g, "/");
}

function sendJson(res: any, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") return res.writeHead(204).end();

  const pathname = (req.url ?? "").split("?")[0];

  if (req.method === "GET" && (pathname === "/" || pathname === "")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(landingHtml(PORT));
  }

  if (req.method === "GET" && pathname === "/overlay.js") {
    let bundle: Buffer | undefined;
    try {
      bundle = readFileSync(OVERLAY_BUNDLE);
    } catch {
      // Missing, or transiently unreadable (e.g. mid-rebuild) — degrade gracefully.
    }
    if (!bundle) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("overlay bundle not found — run: npm run build:overlay");
    }
    res.writeHead(200, { "Content-Type": "application/javascript" });
    return res.end(bundle);
  }

  if (req.method === "GET" && pathname === "/fs") {
    try {
      const path = new URL(req.url ?? "/fs", "http://localhost").searchParams.get("path");
      return sendJson(res, 200, path ? listDir(path) : listDrives());
    } catch (err) {
      return sendJson(res, 500, { status: "error", message: (err as Error).message });
    }
  }

  if (req.method === "POST" && pathname === "/inspect") {
    try {
      const body = JSON.parse(await readBody(req)) as InspectRequest;
      const sf = new Project({ useInMemoryFileSystem: true })
        .createSourceFile(memPath(body.file), readSource(body.file));
      return sendJson(res, 200, inspectJsxElement(sf, body.line, body.column, body.tag));
    } catch (err) {
      return sendJson(res, 500, { status: "error", message: (err as Error).message });
    }
  }

  if (req.method !== "POST" || pathname !== "/edit") return res.writeHead(404).end();

  try {
    const reqBody = JSON.parse(await readBody(req)) as EditRequest;
    const original = readSource(reqBody.file);
    const mem = memPath(reqBody.file);
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile(mem, original);

    const result = processEdits(project, { ...reqBody, file: mem });

    if (result.status === "applied") {
      mkdirSync(BACKUP_DIR, { recursive: true });
      copyFileSync(reqBody.file, join(BACKUP_DIR, `${basename(reqBody.file)}.${Date.now()}-${process.hrtime.bigint()}.bak`));
      writeFileSync(reqBody.file, result.newText, "utf8");
    }
    sendJson(res, 200, result);
  } catch (err) {
    sendJson(res, 500, { status: "error", message: (err as Error).message });
  }
});

server.listen(PORT, () => {
  console.log(`[ui-modifier] agent on http://localhost:${PORT}  (absolute-path mode; backups in ${BACKUP_DIR})`);
});
