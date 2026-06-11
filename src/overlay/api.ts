// src/overlay/api.ts
import type {
  EditRequest, EditResult, InspectRequest, InspectResult,
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
