// src/shared/types.ts

/** A single requested change to a JSX element. */
export type Edit =
  | { kind: "style"; property: string; value: string | number }
  | { kind: "prop"; name: string; value: string | number | boolean }
  | { kind: "text"; value: string };

/** Sent from overlay to agent. line/column are 1-based, from fiber._debugSource. */
export interface EditRequest {
  file: string;
  line: number;
  column: number;
  edits: Edit[];
}

/** Returned by the agent for each request. */
export type EditResult =
  | { status: "applied"; file: string; newText: string; diff: string }
  | { status: "suggested"; reason: string; instruction: string; diff: string }
  | { status: "error"; message: string };
