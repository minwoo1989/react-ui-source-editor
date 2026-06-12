import type { Edit, InspectOk } from "../shared/types.js";

export interface StyleRowState {
  property: string;
  value: string;
  removed: boolean;
  editable: boolean;
}

export interface PropRowState {
  name: string;
  value: string;
  editable: boolean;
  isExpr: boolean;
}

/** What the panel DOM holds at Apply time. null fields were disabled (not editable / absent). */
export interface PanelState {
  style: StyleRowState[];
  added: { property: string; value: string }[];
  className: string | null;
  text: string | null;
  props?: PropRowState[];
  addedProps?: { name: string; value: string }[];
}

/** Inputs hold strings; bare numbers become numeric literals (matches applyStyle's literal()). */
export function parseStyleValue(raw: string): string | number {
  const t = raw.trim();
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : t;
}

/** Like parseStyleValue but also recognizes booleans (for `{true}`/`{false}` props). */
export function parsePropValue(raw: string): string | number | boolean {
  const t = raw.trim();
  if (t === "true") return true;
  if (t === "false") return false;
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : t;
}

/** Diff panel state against the inspect snapshot into the minimal Edit[]. */
export function buildEdits(snapshot: InspectOk, state: PanelState): Edit[] {
  const edits: Edit[] = [];

  for (const row of state.style) {
    if (!row.editable) continue;
    if (row.removed) {
      edits.push({ kind: "styleRemove", property: row.property });
      continue;
    }
    const orig = snapshot.style.find((s) => s.property === row.property);
    if (orig && row.value !== orig.value) {
      edits.push({ kind: "style", property: row.property, value: parseStyleValue(row.value) });
    }
  }

  // Added rows are emitted after style rows on purpose: on a property-name collision, applyStyle's last-write-wins makes the added value win.
  for (const a of state.added) {
    if (a.property.trim() === "" || a.value.trim() === "") continue;
    edits.push({ kind: "style", property: a.property.trim(), value: parseStyleValue(a.value) });
  }

  for (const row of state.props ?? []) {
    if (!row.editable) continue;
    const orig = snapshot.props.find((p) => p.name === row.name);
    if (orig && row.value !== orig.value) {
      edits.push({ kind: "prop", name: row.name, value: row.isExpr ? parsePropValue(row.value) : row.value });
    }
  }
  for (const a of state.addedProps ?? []) {
    if (a.name.trim() === "" || a.value.trim() === "") continue;
    edits.push({ kind: "prop", name: a.name.trim(), value: parsePropValue(a.value) });
  }

  if (state.className !== null) {
    const orig = snapshot.className?.value;
    const changed = orig === undefined ? state.className !== "" : state.className !== orig;
    if (changed) edits.push({ kind: "prop", name: "className", value: state.className });
  }

  // text gates on snapshot.text (unlike className) because there is no text-add path: only an existing single text child is editable.
  if (state.text !== null && snapshot.text && state.text !== snapshot.text.value) {
    edits.push({ kind: "text", value: state.text });
  }

  return edits;
}
