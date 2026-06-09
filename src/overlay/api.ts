// src/overlay/api.ts
import type { EditRequest, EditResult } from "../shared/types.js";

const AGENT = "http://localhost:4567/edit";

export async function sendEdit(req: EditRequest): Promise<EditResult> {
  const res = await fetch(AGENT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  return (await res.json()) as EditResult;
}

/** Make a project-relative path from an absolute _debugSource fileName. */
export function relativeToSrc(absFile: string): string {
  const i = absFile.replace(/\\/g, "/").indexOf("/src/");
  return i >= 0 ? absFile.replace(/\\/g, "/").slice(i + 1) : absFile;
}
