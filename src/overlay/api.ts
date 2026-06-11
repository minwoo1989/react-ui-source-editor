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
  const body = await res.json();
  if (!res.ok) throw new Error((body as { message?: string }).message ?? `fs request failed (${res.status})`);
  return body as FsListing;
}
