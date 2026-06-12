// src/plugin/sourceAttrs.ts
import type { PluginObj, PluginPass, NodePath, types as T } from "@babel/core";

/**
 * Babel plugin: stamp `data-source-file/line/column` onto host JSX elements so a
 * version-independent overlay can map a clicked DOM node back to its source —
 * needed on React 19+ where `fiber._debugSource` is gone. DEV ONLY: the absolute
 * file paths must not ship to production.
 */
export default function sourceAttrs({ types: t }: { types: typeof T }): PluginObj<PluginPass> {
  return {
    name: "ui-modifier-source-attrs",
    visitor: {
      JSXOpeningElement(path: NodePath<T.JSXOpeningElement>, state: PluginPass) {
        const name = path.node.name;
        if (name.type !== "JSXIdentifier" || !/^[a-z]/.test(name.name)) return; // host elements only
        const loc = path.node.loc;
        if (!loc) return;
        const has = (n: string) =>
          path.node.attributes.some(
            (a) => a.type === "JSXAttribute" && a.name.type === "JSXIdentifier" && a.name.name === n,
          );
        const add = (n: string, v: string) => {
          if (has(n)) return;
          path.node.attributes.push(t.jsxAttribute(t.jsxIdentifier(n), t.stringLiteral(v)));
        };
        add("data-source-file", state.filename ?? "");
        add("data-source-line", String(loc.start.line));
        add("data-source-column", String(loc.start.column + 1));
      },
    },
  };
}
