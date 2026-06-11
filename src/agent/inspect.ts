// src/agent/inspect.ts
import { Node, SourceFile, SyntaxKind } from "ts-morph";
import { resolveJsxElement } from "./locate.js";
import type { InspectField, InspectResult, InspectStyleEntry } from "../shared/types.js";

function getOpening(el: Node): any {
  return el.getKind() === SyntaxKind.JsxElement ? (el as any).getOpeningElement() : el;
}

function getAttribute(opening: any, name: string): Node | undefined {
  return opening
    .getAttributes()
    .find((a: Node) => Node.isJsxAttribute(a) && a.getNameNode().getText() === name);
}

function styleEntries(opening: any): { entries: InspectStyleEntry[]; editable: boolean } {
  const attr = getAttribute(opening, "style");
  if (!attr) return { entries: [], editable: true };

  const init = (attr as any).getInitializer();
  const obj = Node.isJsxExpression(init) ? init.getExpression() : undefined;
  if (!obj || !Node.isObjectLiteralExpression(obj)) return { entries: [], editable: false };

  const entries: InspectStyleEntry[] = [];
  for (const prop of obj.getProperties()) {
    if (!Node.isPropertyAssignment(prop)) {
      // spread / shorthand / method — show raw, never editable
      entries.push({ property: prop.getText(), value: "", editable: false });
      continue;
    }
    const name = prop.getName();
    const value = prop.getInitializer();
    if (value && Node.isStringLiteral(value)) {
      entries.push({ property: name, value: value.getLiteralText(), editable: true });
    } else if (value && Node.isNumericLiteral(value)) {
      entries.push({ property: name, value: value.getText(), editable: true });
    } else {
      entries.push({ property: name, value: value?.getText() ?? "", editable: false });
    }
  }
  return { entries, editable: true };
}

function classNameField(opening: any): InspectField | undefined {
  const attr = getAttribute(opening, "className");
  if (!attr) return undefined;
  const init = (attr as any).getInitializer();
  if (init && Node.isStringLiteral(init)) return { value: init.getLiteralText(), editable: true };
  return { value: init?.getText() ?? "", editable: false };
}

function textField(el: Node): InspectField | undefined {
  if (el.getKind() !== SyntaxKind.JsxElement) return undefined;
  const children = (el as any).getJsxChildren() as Node[];
  const meaningful = children.filter(
    (c) => !(Node.isJsxText(c) && c.getText().trim() === "")
  );
  if (meaningful.length === 1 && Node.isJsxText(meaningful[0])) {
    return { value: meaningful[0].getText().trim(), editable: true };
  }
  return undefined;
}

/** Read source truth (style object, className, text) for the JSX element at line/column. */
export function inspectJsxElement(sf: SourceFile, line: number, column: number, tag?: string): InspectResult {
  const opening = resolveJsxElement(sf, line, column, tag);
  if (!opening) return { status: "error", message: `no ${tag ?? "JSX"} element near line ${line}` };
  const el = opening.getParentIfKind(SyntaxKind.JsxElement) ?? opening;
  const op = getOpening(el);

  const { entries, editable } = styleEntries(op);
  return {
    status: "ok",
    line: opening.getStartLineNumber(),
    styleEditable: editable,
    style: entries,
    className: classNameField(op),
    text: textField(el),
  };
}
