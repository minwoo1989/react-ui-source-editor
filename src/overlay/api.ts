// src/overlay/api.ts
import type {
  EditRequest, EditResult, HistoryResult, InspectRequest, InspectResult,
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

export async function sendUndo(): Promise<HistoryResult> {
  const res = await fetch(`${origin()}/undo`, { method: "POST" });
  return (await res.json()) as HistoryResult;
}

export async function sendRedo(): Promise<HistoryResult> {
  const res = await fetch(`${origin()}/redo`, { method: "POST" });
  return (await res.json()) as HistoryResult;
}

export async function fetchHistory(): Promise<{ canUndo: boolean; canRedo: boolean }> {
  const res = await fetch(`${origin()}/history`);
  const body = (await res.json()) as { canUndo: boolean; canRedo: boolean };
  return { canUndo: body.canUndo, canRedo: body.canRedo };
}
