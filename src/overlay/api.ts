// src/overlay/api.ts
import type {
  EditRequest, EditResult, FsListing, InspectRequest, InspectResult,
} from "../shared/types.js";

const AGENT_ORIGIN = "http://localhost:4567";

export async function sendEdit(req: EditRequest): Promise<EditResult> {
  const res = await fetch(`${AGENT_ORIGIN}/edit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  return (await res.json()) as EditResult;
}

export async function sendInspect(req: InspectRequest): Promise<InspectResult> {
  const res = await fetch(`${AGENT_ORIGIN}/inspect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  return (await res.json()) as InspectResult;
}

export async function fetchFsListing(path?: string): Promise<FsListing> {
  const url = path
    ? `${AGENT_ORIGIN}/fs?path=${encodeURIComponent(path)}`
    : `${AGENT_ORIGIN}/fs`;
  const res = await fetch(url);
  return (await res.json()) as FsListing;
}

/** Make a project-relative path from an absolute _debugSource fileName. */
export function relativeToSrc(absFile: string): string {
  const i = absFile.replace(/\\/g, "/").indexOf("/src/");
  return i >= 0 ? absFile.replace(/\\/g, "/").slice(i + 1) : absFile;
}
