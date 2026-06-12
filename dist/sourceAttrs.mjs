// src/plugin/sourceAttrs.ts
function sourceAttrs({ types: t }) {
  return {
    name: "ui-modifier-source-attrs",
    visitor: {
      JSXOpeningElement(path, state) {
        const name = path.node.name;
        if (name.type !== "JSXIdentifier" || !/^[a-z]/.test(name.name)) return;
        const loc = path.node.loc;
        if (!loc) return;
        const has = (n) => path.node.attributes.some(
          (a) => a.type === "JSXAttribute" && a.name.type === "JSXIdentifier" && a.name.name === n
        );
        const add = (n, v) => {
          if (has(n)) return;
          path.node.attributes.push(t.jsxAttribute(t.jsxIdentifier(n), t.stringLiteral(v)));
        };
        add("data-source-file", (state.filename ?? "").replace(/\\/g, "/"));
        add("data-source-line", String(loc.start.line));
        add("data-source-column", String(loc.start.column + 1));
      }
    }
  };
}
export {
  sourceAttrs as default
};
