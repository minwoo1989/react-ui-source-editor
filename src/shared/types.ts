// src/shared/types.ts

/** A single requested change to a JSX element. */
export type Edit =
  | { kind: "style"; property: string; value: string | number }
  | { kind: "styleRemove"; property: string }
  | { kind: "prop"; name: string; value: string | number | boolean }
  | { kind: "text"; value: string };

/** Sent from overlay to agent. line/column are 1-based, from fiber._debugSource. */
export interface EditRequest {
  /** Absolute path, taken verbatim from _debugSource.fileName. */
  file: string;
  line: number;
  column: number;
  /** JSX tag/component name of the clicked element, used to disambiguate after line-offset correction. */
  tag?: string;
  edits: Edit[];
}

/** Returned by the agent for each request. */
export type EditResult =
  | { status: "applied"; file: string; newText: string; diff: string }
  | { status: "suggested"; reason: string; instruction: string; diff: string }
  | { status: "error"; message: string };

/** Sent from overlay to agent to read source truth for the selected element. */
export interface InspectRequest {
  /** Absolute path, same contract as EditRequest.file. */
  file: string;
  line: number;
  column: number;
  /** JSX tag/component name of the clicked element, used to disambiguate after line-offset correction. */
  tag?: string;
}

/** One entry of the style object literal. Non-literal values carry raw source text and editable: false. */
export interface InspectStyleEntry {
  property: string;
  value: string;
  editable: boolean;
}

/** className or text value. Raw source text when not editable. */
export interface InspectField {
  value: string;
  editable: boolean;
}

export interface InspectOk {
  status: "ok";
  /** 1-based source line of the resolved opening element (after line-offset correction). */
  line: number;
  /** false when a style attribute exists but is not an object literal (e.g. style={styles}). */
  styleEditable: boolean;
  style: InspectStyleEntry[];
  /** absent when the element has no className attribute */
  className?: InspectField;
  /** absent unless the element has a single literal text child */
  text?: InspectField;
}

export type InspectResult = InspectOk | { status: "error"; message: string };

/** GET /fs response. */
export interface FsEntry {
  name: string;
  /** Absolute path of the entry — the panel never joins paths itself. */
  path: string;
  dir: boolean;
}

export interface FsListing {
  path: string;
  /** Parent directory; "" when at a filesystem root (panel then requests the drive list). */
  parent: string;
  entries: FsEntry[];
}
