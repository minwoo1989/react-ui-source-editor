"use strict";
(() => {
  // src/overlay/fiber.ts
  function sourceLocFor(node) {
    const key = Object.keys(node).find((k) => k.startsWith("__reactFiber$"));
    if (!key) return void 0;
    let fiber = node[key];
    while (fiber) {
      const src = fiber._debugSource;
      if (src && src.fileName) {
        return { file: src.fileName, line: src.lineNumber, column: src.columnNumber };
      }
      fiber = fiber.return;
    }
    return void 0;
  }
  function componentNameFor(node) {
    const key = Object.keys(node).find((k) => k.startsWith("__reactFiber$"));
    if (!key) return node.tagName.toLowerCase();
    let fiber = node[key];
    while (fiber) {
      const t = fiber.type;
      if (typeof t === "function") return t.displayName || t.name || "Component";
      if (typeof t === "string") return t;
      fiber = fiber.return;
    }
    return node.tagName.toLowerCase();
  }

  // src/overlay/panel.ts
  function createPanel(handlers) {
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;top:16px;right:16px;z-index:2147483647;";
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
    <style>
      .p{font:13px sans-serif;background:#fff;border:1px solid #ccc;border-radius:8px;
         box-shadow:0 4px 16px rgba(0,0,0,.15);width:280px;padding:12px}
      .t{font-weight:600;margin-bottom:8px}
      label{display:block;margin:6px 0 2px;color:#555}
      input{width:100%;box-sizing:border-box;padding:4px}
      button{margin-top:10px;padding:6px 10px;cursor:pointer}
      .out{margin-top:8px;white-space:pre-wrap;font:11px monospace;color:#333}
    </style>
    <div class="p">
      <div class="t" id="who">No selection</div>
      <label>Text</label><input id="text" placeholder="(unchanged)">
      <label>style.color</label><input id="color" placeholder="(unchanged)">
      <label>style.marginTop (px)</label><input id="mt" placeholder="(unchanged)">
      <label>prop: type</label><input id="type" placeholder="(unchanged)">
      <button id="apply">Apply</button>
      <div class="out" id="out"></div>
    </div>`;
    document.body.appendChild(host);
    const $ = (id) => root.getElementById(id);
    const out = root.getElementById("out");
    root.getElementById("apply").onclick = async () => {
      const edits = [];
      if ($("text").value) edits.push({ kind: "text", value: $("text").value });
      if ($("color").value) edits.push({ kind: "style", property: "color", value: $("color").value });
      if ($("mt").value) edits.push({ kind: "style", property: "marginTop", value: Number($("mt").value) });
      if ($("type").value) edits.push({ kind: "prop", name: "type", value: $("type").value });
      if (edits.length === 0) {
        out.textContent = "Nothing to apply.";
        return;
      }
      const res = await handlers.onApply(edits);
      out.textContent = res.status === "applied" ? "\u2705 Applied. HMR will reload." : res.status === "suggested" ? `\u{1F4CB} Suggested:
${res.instruction}
${res.reason}` : `\u274C ${res.message}`;
    };
    return {
      setTarget(name, loc) {
        root.getElementById("who").textContent = `${name} \u2014 ${loc}`;
      }
    };
  }

  // src/overlay/inspector.ts
  function createInspector(onSelect) {
    const hl = document.createElement("div");
    hl.style.cssText = "position:fixed;pointer-events:none;z-index:2147483646;border:2px solid #1677ff;background:rgba(22,119,255,.08);display:none";
    document.body.appendChild(hl);
    function show(el) {
      const r = el.getBoundingClientRect();
      hl.style.display = "block";
      hl.style.left = `${r.left}px`;
      hl.style.top = `${r.top}px`;
      hl.style.width = `${r.width}px`;
      hl.style.height = `${r.height}px`;
    }
    function onMove(e) {
      const el = e.target;
      if (el && el !== hl) show(el);
    }
    function onClick(e) {
      const el = e.target;
      if (!el) return;
      if (el.closest && el.getRootNode() instanceof ShadowRoot) return;
      e.preventDefault();
      e.stopPropagation();
      onSelect(el);
    }
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("click", onClick, true);
  }

  // src/overlay/api.ts
  var AGENT = "http://localhost:4567/edit";
  async function sendEdit(req) {
    const res = await fetch(AGENT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req)
    });
    return await res.json();
  }
  function relativeToSrc(absFile) {
    const i = absFile.replace(/\\/g, "/").indexOf("/src/");
    return i >= 0 ? absFile.replace(/\\/g, "/").slice(i + 1) : absFile;
  }

  // src/overlay/index.ts
  var current = null;
  var panel = createPanel({
    onApply: async (edits) => {
      if (!current) return { status: "error", message: "no selection" };
      return sendEdit({ ...current, edits });
    }
  });
  createInspector((el) => {
    const loc = sourceLocFor(el);
    if (!loc) {
      panel.setTarget(componentNameFor(el), "no source info");
      current = null;
      return;
    }
    current = { file: relativeToSrc(loc.file), line: loc.line, column: loc.column };
    panel.setTarget(componentNameFor(el), `${current.file}:${current.line}`);
  });
  console.log("[ui-modifier] overlay ready");
})();
