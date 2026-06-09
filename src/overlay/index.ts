// src/overlay/index.ts
import { sourceLocFor, componentNameFor } from "./fiber.js";
import { createPanel } from "./panel.js";
import { createInspector } from "./inspector.js";
import { sendEdit, relativeToSrc } from "./api.js";
import type { Edit } from "../shared/types.js";

let current: { file: string; line: number; column: number } | null = null;

const panel = createPanel({
  onApply: async (edits: Edit[]) => {
    if (!current) return { status: "error", message: "no selection" };
    return sendEdit({ ...current, edits });
  },
});

createInspector((el) => {
  const loc = sourceLocFor(el);
  if (!loc) { panel.setTarget(componentNameFor(el), "no source info"); current = null; return; }
  current = { file: relativeToSrc(loc.file), line: loc.line, column: loc.column };
  panel.setTarget(componentNameFor(el), `${current.file}:${current.line}`);
}, panel.host);

console.log("[ui-modifier] overlay ready");
