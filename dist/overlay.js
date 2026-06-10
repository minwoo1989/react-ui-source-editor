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

  // src/overlay/editsDiff.ts
  function parseStyleValue(raw) {
    const t = raw.trim();
    return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : t;
  }
  function buildEdits(snapshot, state) {
    const edits = [];
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
    for (const a of state.added) {
      if (a.property.trim() === "" || a.value.trim() === "") continue;
      edits.push({ kind: "style", property: a.property.trim(), value: parseStyleValue(a.value) });
    }
    if (state.className !== null) {
      const orig = snapshot.className?.value;
      const changed = orig === void 0 ? state.className !== "" : state.className !== orig;
      if (changed) edits.push({ kind: "prop", name: "className", value: state.className });
    }
    if (state.text !== null && snapshot.text && state.text !== snapshot.text.value) {
      edits.push({ kind: "text", value: state.text });
    }
    return edits;
  }

  // src/overlay/panel.ts
  function createPanel(handlers) {
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
    const $ = (id) => root.getElementById(id);
    const out = $("out");
    const stylesBox = $("styles");
    const browser = $("browser");
    let loc = null;
    let snapshot = null;
    let inspectGen = 0;
    function styleRow(property, value, editable) {
      const row = document.createElement("div");
      row.className = "row";
      row.innerHTML = `<input class="k" disabled><input class="v"><button title="remove">\u2715</button>`;
      const [k, v] = Array.from(row.querySelectorAll("input"));
      const del = row.querySelector("button");
      k.value = property;
      v.value = value;
      if (!editable) {
        v.disabled = true;
        del.disabled = true;
      }
      del.onclick = () => row.classList.toggle("removed");
      return row;
    }
    function clearEditors() {
      stylesBox.innerHTML = "";
      $("newk").value = "";
      $("newv").value = "";
    }
    function render(res) {
      clearEditors();
      if (res.status === "error") {
        snapshot = null;
        out.textContent = `\u274C ${res.message}`;
        return;
      }
      snapshot = res;
      out.textContent = "";
      for (const e of res.style) {
        stylesBox.appendChild(styleRow(e.property, e.value, e.editable && res.styleEditable));
      }
      const cls = $("cls");
      cls.value = res.className?.value ?? "";
      cls.disabled = res.className ? !res.className.editable : false;
      const text = $("text");
      text.value = res.text?.value ?? "";
      text.disabled = !res.text?.editable;
    }
    function collectState() {
      const style = [];
      stylesBox.querySelectorAll(".row").forEach((row) => {
        const [k, v] = Array.from(row.querySelectorAll("input"));
        style.push({
          property: k.value,
          value: v.value,
          removed: row.classList.contains("removed"),
          editable: !v.disabled
        });
      });
      const cls = $("cls");
      const text = $("text");
      return {
        style,
        added: [{
          property: $("newk").value,
          value: $("newv").value
        }],
        className: cls.disabled ? null : cls.value,
        text: text.disabled ? null : text.value
      };
    }
    async function inspectInto(file) {
      if (!loc) return;
      const gen = ++inspectGen;
      try {
        const result = await handlers.onInspect({ file, line: loc.line, column: loc.column });
        if (gen !== inspectGen) return;
        render(result);
      } catch (e) {
        if (gen !== inspectGen) return;
        out.textContent = `\u274C agent unreachable: ${e.message}`;
      }
    }
    $("apply").onclick = async () => {
      if (!loc || !snapshot) {
        out.textContent = "No editable selection.";
        return;
      }
      const file = $("file").value.trim();
      const edits = buildEdits(snapshot, collectState());
      if (edits.length === 0) {
        out.textContent = "Nothing to apply.";
        return;
      }
      try {
        const res = await handlers.onApply({ file, line: loc.line, column: loc.column, edits });
        out.textContent = res.status === "applied" ? "\u2705 Applied. HMR will reload." : res.status === "suggested" ? `\u{1F4CB} Suggested:
${res.instruction}
${res.reason}` : `\u274C ${res.message}`;
        if (res.status === "applied") await inspectInto(file);
      } catch (e) {
        out.textContent = `\u274C agent unreachable: ${e.message}`;
      }
    };
    async function showDir(path) {
      let listing;
      try {
        listing = await handlers.onListDir(path);
      } catch (e) {
        out.textContent = `\u274C fs: ${e.message}`;
        return;
      }
      browser.style.display = "block";
      browser.innerHTML = "";
      if (listing.path) {
        const up = document.createElement("div");
        up.textContent = "\u2B06 ..";
        up.onclick = () => showDir(listing.parent || void 0);
        browser.appendChild(up);
      }
      for (const e of listing.entries) {
        const item = document.createElement("div");
        item.textContent = (e.dir ? "\u{1F4C1} " : "\u{1F4C4} ") + e.name;
        item.onclick = async () => {
          if (e.dir) {
            await showDir(e.path);
            return;
          }
          $("file").value = e.path;
          browser.style.display = "none";
          await inspectInto(e.path);
        };
        browser.appendChild(item);
      }
    }
    $("browse").onclick = async () => {
      if (browser.style.display !== "none") {
        browser.style.display = "none";
        return;
      }
      const file = $("file").value.trim();
      const dir = file.replace(/[\\/][^\\/]*$/, "");
      await showDir(dir && dir !== file ? dir : void 0);
    };
    return {
      host,
      async setTarget(name, target) {
        browser.style.display = "none";
        if (!target) {
          inspectGen++;
          $("who").textContent = `${name} \u2014 no source info`;
          loc = null;
          snapshot = null;
          clearEditors();
          return;
        }
        const short = target.file.split(/[\\/]/).pop();
        $("who").textContent = `${name} \u2014 ${short}:${target.line}`;
        loc = { line: target.line, column: target.column };
        $("file").value = target.file;
        await inspectInto(target.file);
      }
    };
  }

  // src/overlay/inspector.ts
  function createInspector(onSelect, ignore) {
    const hl = document.createElement("div");
    hl.style.cssText = "position:fixed;pointer-events:none;z-index:2147483646;border:2px solid #1677ff;background:rgba(22,119,255,.08);display:none";
    document.body.appendChild(hl);
    function isOwn(e) {
      const path = e.composedPath();
      return path.includes(hl) || !!ignore && path.includes(ignore);
    }
    function show(el) {
      const r = el.getBoundingClientRect();
      hl.style.display = "block";
      hl.style.left = `${r.left}px`;
      hl.style.top = `${r.top}px`;
      hl.style.width = `${r.width}px`;
      hl.style.height = `${r.height}px`;
    }
    function onMove(e) {
      if (isOwn(e)) return;
      const el = e.target;
      if (el) show(el);
    }
    function onClick(e) {
      if (isOwn(e)) return;
      const el = e.target;
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();
      onSelect(el);
    }
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("click", onClick, true);
  }

  // src/overlay/api.ts
  var AGENT_ORIGIN = "http://localhost:4567";
  async function sendEdit(req) {
    const res = await fetch(`${AGENT_ORIGIN}/edit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req)
    });
    return await res.json();
  }
  async function sendInspect(req) {
    const res = await fetch(`${AGENT_ORIGIN}/inspect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req)
    });
    return await res.json();
  }
  async function fetchFsListing(path) {
    const url = path ? `${AGENT_ORIGIN}/fs?path=${encodeURIComponent(path)}` : `${AGENT_ORIGIN}/fs`;
    const res = await fetch(url);
    const body = await res.json();
    if (!res.ok) throw new Error(body.message ?? `fs request failed (${res.status})`);
    return body;
  }

  // src/overlay/index.ts
  var panel = createPanel({
    onInspect: sendInspect,
    onApply: sendEdit,
    onListDir: fetchFsListing
  });
  createInspector((el) => {
    const loc = sourceLocFor(el);
    void panel.setTarget(componentNameFor(el), loc ?? null);
  }, panel.host);
  console.log("[ui-modifier] overlay ready");
})();
