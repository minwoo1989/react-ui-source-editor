// src/overlay/panel.ts
import type { Edit, EditResult } from "../shared/types.js";

export interface PanelHandlers {
  onApply: (edits: Edit[]) => Promise<EditResult>;
}

export function createPanel(handlers: PanelHandlers) {
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

  const $ = (id: string) => root.getElementById(id) as HTMLInputElement;
  const out = root.getElementById("out") as HTMLElement;

  (root.getElementById("apply") as HTMLButtonElement).onclick = async () => {
    const edits: Edit[] = [];
    if ($("text").value) edits.push({ kind: "text", value: $("text").value });
    if ($("color").value) edits.push({ kind: "style", property: "color", value: $("color").value });
    if ($("mt").value) edits.push({ kind: "style", property: "marginTop", value: Number($("mt").value) });
    if ($("type").value) edits.push({ kind: "prop", name: "type", value: $("type").value });
    if (edits.length === 0) { out.textContent = "Nothing to apply."; return; }
    const res = await handlers.onApply(edits);
    out.textContent =
      res.status === "applied" ? "✅ Applied. HMR will reload."
      : res.status === "suggested" ? `📋 Suggested:\n${res.instruction}\n${res.reason}`
      : `❌ ${res.message}`;
  };

  return {
    host,
    setTarget(name: string, loc: string) {
      (root.getElementById("who") as HTMLElement).textContent = `${name} — ${loc}`;
    },
  };
}
