// src/agent/server.ts
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { resolve, join, basename, dirname } from "node:path";
import { Project } from "ts-morph";
import { processEdits } from "./apply.js";
import { fileURLToPath } from "node:url";
import type { EditRequest } from "../shared/types.js";
import { landingHtml } from "./bookmarklet.js";

const PROJECT_ROOT = resolve(process.argv[2] ?? process.cwd());
const PORT = Number(process.env.PORT ?? 4567);
const BACKUP_DIR = join(PROJECT_ROOT, ".ui-modifier-backups");

// dist/overlay.js sits at the repo root; this module lives in src/agent/.
const OVERLAY_BUNDLE = resolve(dirname(fileURLToPath(import.meta.url)), "../../dist/overlay.js");

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
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
}

const server = createServer(async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") return res.writeHead(204).end();

  if (req.method === "GET" && (req.url === "/" || req.url === "")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(landingHtml(PROJECT_ROOT, PORT));
  }

  // Match on pathname so the bookmarklet's `?<cachebuster>` query is ignored.
  if (req.method === "GET" && (req.url ?? "").split("?")[0] === "/overlay.js") {
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

  if (req.method !== "POST" || req.url !== "/edit") return res.writeHead(404).end();

  try {
    const reqBody = JSON.parse(await readBody(req)) as EditRequest;
    const absFile = resolve(PROJECT_ROOT, reqBody.file);
    if (!absFile.startsWith(PROJECT_ROOT)) throw new Error("path escapes project root");

    const original = readFileSync(absFile, "utf8");
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile(reqBody.file, original);

    const result = processEdits(project, { ...reqBody, file: reqBody.file });

    if (result.status === "applied") {
      mkdirSync(BACKUP_DIR, { recursive: true });
      copyFileSync(absFile, join(BACKUP_DIR, `${basename(absFile)}.${Date.now()}.bak`));
      writeFileSync(absFile, result.newText, "utf8");
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result));
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "error", message: (err as Error).message }));
  }
});

server.listen(PORT, () => {
  console.log(`[ui-modifier] agent on http://localhost:${PORT}  root=${PROJECT_ROOT}`);
});
