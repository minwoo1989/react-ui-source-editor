// src/agent/apply.ts
import { Project, Node, SyntaxKind } from "ts-morph";
import type { EditRequest, EditResult, Edit } from "../shared/types.js";
import { resolveJsxElement } from "./locate.js";
import { classifyEdit } from "./classify.js";
import { applyStyle, removeStyle } from "./applyStyle.js";
import { applyProp } from "./applyProp.js";
import { applyText } from "./applyText.js";
import { unifiedDiff } from "./diff.js";

function elementFromOpening(opening: Node): Node {
  return opening.getParentIfKind(SyntaxKind.JsxElement) ?? opening;
}

function applyOne(el: Node, edit: Edit): void {
  if (edit.kind === "style") applyStyle(el, edit.property, edit.value);
  else if (edit.kind === "styleRemove") removeStyle(el, edit.property);
  else if (edit.kind === "prop") applyProp(el, edit.name, edit.value);
  else applyText(el, edit.value);
}

function describe(edit: Edit): string {
  if (edit.kind === "style") return `set style.${edit.property} = ${JSON.stringify(edit.value)}`;
  if (edit.kind === "styleRemove") return `remove style.${edit.property}`;
  if (edit.kind === "prop") return `set prop ${edit.name} = ${JSON.stringify(edit.value)}`;
  return `set text = ${JSON.stringify(edit.value)}`;
}

/** Pure transform on an in-memory Project. The server wraps this with disk I/O. */
export function processEdits(project: Project, req: EditRequest): EditResult {
  const sf = project.getSourceFile(req.file);
  if (!sf) return { status: "error", message: `file not loaded: ${req.file}` };

  const opening = resolveJsxElement(sf, req.line, req.column, req.tag);
  if (!opening) return { status: "error", message: `no ${req.tag ?? "JSX"} element near line ${req.line}` };
  const el = elementFromOpening(opening);

  const before = sf.getFullText();

  // If any edit is unsafe, produce guidance for all and write nothing.
  const resolvedLine = opening.getStartLineNumber();
  const unsafe = req.edits
    .map((e) => ({ e, c: classifyEdit(el, e) }))
    .filter((x) => !x.c.safe);
  if (unsafe.length > 0) {
    const reason = unsafe.map((x) => x.c.reason).join("; ");
    const instruction =
      `In ${req.file}:${resolvedLine}, manually ` +
      unsafe.map((x) => describe(x.e)).join(", ") + ".";
    return { status: "suggested", reason, instruction, diff: "" };
  }

  try {
    for (const edit of req.edits) applyOne(el, edit);
    // Re-parse guard: throws if we produced invalid syntax.
    const after = sf.getFullText();
    new Project({ useInMemoryFileSystem: true })
      .createSourceFile("/check.tsx", after);
    return { status: "applied", file: req.file, newText: after, diff: unifiedDiff(before, after, req.file) };
  } catch (err) {
    sf.replaceWithText(before); // rollback in-memory
    return { status: "error", message: `edit produced invalid code: ${(err as Error).message}` };
  }
}
