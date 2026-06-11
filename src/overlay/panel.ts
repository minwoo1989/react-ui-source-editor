// src/overlay/panel.ts
import type {
  EditRequest, EditResult, HistoryResult, InspectOk, InspectRequest, InspectResult,
} from "../shared/types.js";
import { buildEdits, type PanelState, type StyleRowState } from "./editsDiff.js";

export interface PanelTarget { file: string; line: number; column: number; tag?: string; }

export interface PanelHandlers {
  onInspect(req: InspectRequest): Promise<InspectResult>;
  onApply(req: EditRequest): Promise<EditResult>;
  onUndo(): Promise<HistoryResult>;
  onRedo(): Promise<HistoryResult>;
  onHistory(): Promise<{ canUndo: boolean; canRedo: boolean }>;
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
      .apply{margin-top:10px;padding:6px 10px;cursor:pointer}
      .hist{margin-top:6px;display:flex;gap:6px}
      .hist button{padding:2px 10px;cursor:pointer;font:inherit}
      .hist button:disabled{opacity:.4;cursor:default}
      .out{margin-top:8px;white-space:pre-wrap;font:11px monospace;color:#333;word-break:break-all}
    </style>
    <div class="p">
      <div class="t" id="who">No selection</div>
      <label>style</label>
      <div id="styles"></div>
      <div class="row"><input class="k" id="newk" placeholder="property"><input class="v" id="newv" placeholder="value"></div>
      <label>className</label><input class="full" id="cls" placeholder="(none)">
      <label>Text</label><input class="full" id="text" placeholder="(none)">
      <button class="apply" id="apply">Apply</button>
      <div class="hist"><button id="undo" disabled title="undo">↶</button><button id="redo" disabled title="redo">↷</button></div>
      <div class="out" id="out"></div>
    </div>`;
  document.body.appendChild(host);

  const $ = <T extends HTMLElement = HTMLElement>(id: string) => root.getElementById(id) as T;
  const out = $("out");
  const stylesBox = $("styles");

  // The clicked element's source path + position. `file` comes from
  // _debugSource (via fiber.ts) on selection — there is no manual file entry.
  let file: string | null = null;
  let loc: { line: number; column: number; tag?: string } | null = null;
  let snapshot: InspectOk | null = null;
  let inspectGen = 0;
  let whoName = "";
  let whoShort = "";

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
    $("who").textContent = `${whoName} — ${whoShort}:${res.line}`;
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

  async function inspectInto() {
    if (file === null || !loc) return;
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
    if (file === null || !loc || !snapshot) { out.textContent = "No editable selection."; return; }
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
      if (res.status === "applied") {
        setHistoryButtons(true, false);
        await inspectInto();
      }
    } catch (e) {
      out.textContent = `❌ agent unreachable: ${(e as Error).message}`;
    }
  };

  function setHistoryButtons(canUndo: boolean, canRedo: boolean) {
    $<HTMLButtonElement>("undo").disabled = !canUndo;
    $<HTMLButtonElement>("redo").disabled = !canRedo;
  }

  async function runHistory(kind: "undo" | "redo") {
    try {
      const r = kind === "undo" ? await handlers.onUndo() : await handlers.onRedo();
      if (r.status === "error") {
        out.textContent = `❌ ${r.message}`;
        // Error carries no stack state — re-sync buttons from the agent's truth.
        void handlers.onHistory().then((s) => setHistoryButtons(s.canUndo, s.canRedo)).catch(() => {});
        return;
      }
      setHistoryButtons(r.canUndo, r.canRedo);
      if (r.status === "noop") {
        out.textContent = kind === "undo" ? "↶ 더 되돌릴 내용이 없습니다." : "↷ 다시 적용할 내용이 없습니다.";
        return;
      }
      const short = r.file.split(/[\\/]/).pop();
      out.textContent = kind === "undo" ? `↶ ${short} 되돌림` : `↷ ${short} 다시 적용`;
      // Refresh rows only if the affected file is the one currently shown.
      if (r.file === file) await inspectInto();
    } catch (e) {
      out.textContent = `❌ agent unreachable: ${(e as Error).message}`;
    }
  }

  $("undo").onclick = () => void runHistory("undo");
  $("redo").onclick = () => void runHistory("redo");

  // Initial button state from the agent (a prior session may have a stack).
  void handlers.onHistory()
    .then((s) => setHistoryButtons(s.canUndo, s.canRedo))
    .catch(() => { /* origin not detected / agent down — leave disabled */ });

  return {
    host,
    async setTarget(name: string, target: PanelTarget | null) {
      if (!target) {
        inspectGen++;
        $("who").textContent = `${name} — no source info`;
        file = null;
        loc = null;
        snapshot = null;
        clearEditors();
        return;
      }
      whoName = name;
      whoShort = target.file.split(/[\\/]/).pop() ?? "";
      $("who").textContent = `${whoName} — ${whoShort}:${target.line}`;
      file = target.file;
      loc = { line: target.line, column: target.column, tag: target.tag };
      await inspectInto();
    },
    /** Render a persistent, selection-independent error (e.g. agent origin not found). */
    setError(message: string) {
      inspectGen++;
      file = null;
      loc = null;
      snapshot = null;
      clearEditors();
      $("who").textContent = "⚠ agent 연결 불가";
      out.textContent = `❌ ${message}`;
    },
  };
}
