// src/overlay/api.ts
import type {
  EditRequest, EditResult, InspectRequest, InspectResult,
} from "../shared/types.js";
import { AGENT_ORIGIN } from "./agentOrigin.js";

/** The detected agent origin, or throw a clear error if it was never determined. */
function origin(): string {
  if (AGENT_ORIGIN === null) throw new Error("agent origin not detected");
  return AGENT_ORIGIN;
}

export async function sendEdit(req: EditRequest): Promise<EditResult> {
  const res = await fetch(`${origin()}/edit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  return (await res.json()) as EditResult;
}

export async function sendInspect(req: InspectRequest): Promise<InspectResult> {
  const res = await fetch(`${origin()}/inspect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  return (await res.json()) as InspectResult;
}
