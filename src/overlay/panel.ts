// src/overlay/panel.ts
import type {
  EditRequest, EditResult, FsListing, InspectOk, InspectRequest, InspectResult,
} from "../shared/types.js";
import { buildEdits, type PanelState, type StyleRowState } from "./editsDiff.js";

export interface PanelTarget { file: string; line: number; column: number; tag?: string; }

export interface PanelHandlers {
  onInspect(req: InspectRequest): Promise<InspectResult>;
  onApply(req: EditRequest): Promise<EditResult>;
  onListDir(path?: string): Promise<FsListing>;
}

export function createPanel(handlers: PanelHandlers) {
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;top:16px;right:16px;z-index:2147483647;";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>
      .p{font:13px sans-serif;background:#fff;border:1px solid #ccc;border-radius:8px;
         box-shadow:0 4px 16px rgba(0,0,0,.15);width:320px;padding:12px;max-height:85vh;overflow:auto}
      .t{font-weight:600;margin-bottom:8px}
      label{display:block;margin:6px 0 2px;color:#555}
      input{box-sizing:border-box;padding:4px;font:inherit}
      input:disabled{background:#f5f5f5;color:#999}
      .full{width:100%}
      .row{display:flex;gap:4px;margin:2px 0}
      .row .k{width:42%}
      .row .v{flex:1;min-width:0}
      .row button{padding:0 6px;cursor:pointer}
      .row.removed input{text-decoration:line-through;color:#999}
      .pathrow{display:flex;gap:4px}
      .pathrow input{flex:1;min-width:0}
      .browser{border:1px solid #ddd;margin-top:4px;max-height:160px;overflow:auto;font-size:12px}
      .browser div{padding:2px 6px;cursor:pointer;white-space:nowrap}
      .browser div:hover{background:#f0f6ff}
      .apply{margin-top:10px;padding:6px 10px;cursor:pointer}
      .out{margin-top:8px;white-space:pre-wrap;font:11px monospace;color:#333;word-break:break-all}
    </style>
    <div class="p">
      <div class="t" id="who">No selection</div>
      <label>File</label>
      <div class="pathrow"><input id="file" placeholder="(absolute path)"><button id="browse" title="browse">&#128193;</button></div>
      <div class="browser" id="browser" style="display:none"></div>
      <label>style</label>
      <div id="styles"></div>
      <div class="row"><input class="k" id="newk" placeholder="property"><input class="v" id="newv" placeholder="value"></div>
      <label>className</label><input class="full" id="cls" placeholder="(none)">
      <label>Text</label><input class="full" id="text" placeholder="(none)">
      <button class="apply" id="apply">Apply</button>
      <div class="out" id="out"></div>
    </div>`;
  document.body.appendChild(host);

  const $ = <T extends HTMLElement = HTMLElement>(id: string) => root.getElementById(id) as T;
  const out = $("out");
  const stylesBox = $("styles");
  const browser = $("browser");

  let loc: { line: number; column: number; tag?: string } | null = null;
  let snapshot: InspectOk | null = null;
  let inspectGen = 0;

  function styleRow(property: string, value: string, editable: boolean): HTMLDivElement {
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `<input class="k" disabled><input class="v"><button title="remove">✕</button>`;
    const [k, v] = Array.from(row.querySelectorAll("input")) as HTMLInputElement[];
    const del = row.querySelector("button") as HTMLButtonElement;
    k.value = property;
    v.value = value;
    if (!editable) { v.disabled = true; del.disabled = true; }
    del.onclick = () => row.classList.toggle("removed"); // toggle so a misclick is reversible
    return row;
  }

  function clearEditors() {
    stylesBox.innerHTML = "";
    $<HTMLInputElement>("newk").value = "";
    $<HTMLInputElement>("newv").value = "";
  }

  function render(res: InspectResult) {
    clearEditors();
    if (res.status === "error") {
      snapshot = null;
      out.textContent = `❌ ${res.message}`;
      return;
    }
    snapshot = res;
    out.textContent = "";
    for (const e of res.style) {
      stylesBox.appendChild(styleRow(e.property, e.value, e.editable && res.styleEditable));
    }
    const cls = $<HTMLInputElement>("cls");
    cls.value = res.className?.value ?? "";
    cls.disabled = res.className ? !res.className.editable : false;
    const text = $<HTMLInputElement>("text");
    text.value = res.text?.value ?? "";
    text.disabled = !res.text?.editable;
  }

  function collectState(): PanelState {
    const style: StyleRowState[] = [];
    stylesBox.querySelectorAll(".row").forEach((row) => {
      const [k, v] = Array.from(row.querySelectorAll("input")) as HTMLInputElement[];
      style.push({
        property: k.value,
        value: v.value,
        removed: row.classList.contains("removed"),
        editable: !v.disabled,
      });
    });
    const cls = $<HTMLInputElement>("cls");
    const text = $<HTMLInputElement>("text");
    return {
      style,
      added: [{
        property: $<HTMLInputElement>("newk").value,
        value: $<HTMLInputElement>("newv").value,
      }],
      className: cls.disabled ? null : cls.value,
      text: text.disabled ? null : text.value,
    };
  }

  async function inspectInto(file: string) {
    if (!loc) return;
    const gen = ++inspectGen;
    try {
      const result = await handlers.onInspect({ file, line: loc.line, column: loc.column, tag: loc.tag });
      if (gen !== inspectGen) return;
      render(result);
    } catch (e) {
      if (gen !== inspectGen) return;
      out.textContent = `❌ agent unreachable: ${(e as Error).message}`;
    }
  }

  $("apply").onclick = async () => {
    if (!loc || !snapshot) { out.textContent = "No editable selection."; return; }
    // Apply intentionally pairs the live File value with the last-inspected loc; a stale pair lands on the server's clear error path (file not found / no JSX at position).
    const file = $<HTMLInputElement>("file").value.trim();
    const edits = buildEdits(snapshot, collectState());
    if (edits.length === 0) { out.textContent = "Nothing to apply."; return; }
    try {
      const res = await handlers.onApply({ file, line: loc.line, column: loc.column, tag: loc.tag, edits });
      out.textContent =
        res.status === "applied" ? "✅ Applied. HMR will reload."
        : res.status === "suggested" ? `\u{1F4CB} Suggested:\n${res.instruction}\n${res.reason}`
        : `❌ ${res.message}`;
      // Element start position is stable under our own edits (they only touch
      // text at/after the opening tag), so refresh rows from the new source.
      if (res.status === "applied") await inspectInto(file);
    } catch (e) {
      out.textContent = `❌ agent unreachable: ${(e as Error).message}`;
    }
  };

  async function showDir(path?: string) {
    let listing: FsListing;
    try {
      listing = await handlers.onListDir(path);
    } catch (e) {
      out.textContent = `❌ fs: ${(e as Error).message}`;
      return;
    }
    browser.style.display = "block";
    browser.innerHTML = "";
    if (listing.path) {
      const up = document.createElement("div");
      up.textContent = "⬆ ..";
      // parent === "" means we were at a root: go to the drive list.
      up.onclick = () => showDir(listing.parent || undefined);
      browser.appendChild(up);
    }
    for (const e of listing.entries) {
      const item = document.createElement("div");
      item.textContent = (e.dir ? "\u{1F4C1} " : "\u{1F4C4} ") + e.name;
      item.onclick = async () => {
        if (e.dir) { await showDir(e.path); return; }
        $<HTMLInputElement>("file").value = e.path;
        browser.style.display = "none";
        await inspectInto(e.path);
      };
      browser.appendChild(item);
    }
  }

  $("browse").onclick = async () => {
    if (browser.style.display !== "none") { browser.style.display = "none"; return; }
    const file = $<HTMLInputElement>("file").value.trim();
    const dir = file.replace(/[\\/][^\\/]*$/, "");
    await showDir(dir && dir !== file ? dir : undefined);
  };

  return {
    host,
    async setTarget(name: string, target: PanelTarget | null) {
      browser.style.display = "none";
      if (!target) {
        inspectGen++;
        $("who").textContent = `${name} — no source info`;
        loc = null;
        snapshot = null;
        clearEditors();
        return;
      }
      const short = target.file.split(/[\\/]/).pop();
      $("who").textContent = `${name} — ${short}:${target.line}`;
      loc = { line: target.line, column: target.column, tag: target.tag };
      $<HTMLInputElement>("file").value = target.file;
      await inspectInto(target.file);
    },
  };
}
