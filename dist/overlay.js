"use strict";
(() => {
  // src/overlay/fiber.ts
  function typeName(t) {
    if (typeof t === "string") return t;
    if (typeof t === "function") return t.displayName || t.name || void 0;
    if (t && typeof t === "object") {
      const o = t;
      if (o.displayName) return o.displayName;
      if (o.render) {
        const n = o.render.displayName || o.render.name;
        if (n) return n;
      }
      if (o.type && typeof o.type === "function") {
        const ft = o.type;
        const n = ft.displayName || ft.name;
        if (n) return n;
      }
      return void 0;
    }
    return void 0;
  }
  function hasSource(f) {
    return !!(f._debugSource && f._debugSource.fileName);
  }
  function sameLoc(a, b) {
    const x = a._debugSource, y = b._debugSource;
    return !!x && !!y && x.fileName === y.fileName && x.lineNumber === y.lineNumber && x.columnNumber === y.columnNumber;
  }
  function isElement(x) {
    return !!x && typeof x === "object" && x.nodeType === 1;
  }
  function fiberOf(node) {
    const key = Object.keys(node).find((k) => k.startsWith("__reactFiber$"));
    return key ? node[key] : void 0;
  }
  function nearestSourceFiber(fiber) {
    let f = fiber;
    while (f) {
      if (hasSource(f)) return f;
      f = f.return;
    }
    return void 0;
  }
  function parentSourceFiber(fiber) {
    let f = fiber.return;
    while (f) {
      if (hasSource(f) && !sameLoc(f, fiber)) return f;
      f = f.return;
    }
    return void 0;
  }
  function childSourceFiber(fiber) {
    function dfs(start) {
      for (let c = start; c; c = c.sibling) {
        if (hasSource(c) && !sameLoc(c, fiber)) return c;
        const deeper = dfs(c.child);
        if (deeper) return deeper;
      }
      return void 0;
    }
    return dfs(fiber.child);
  }
  function locOf(fiber) {
    const s = fiber._debugSource;
    if (!s || !s.fileName) return void 0;
    return { file: s.fileName, line: s.lineNumber ?? 0, column: s.columnNumber ?? 0, tag: typeName(fiber.type) };
  }
  function domNodeOf(fiber) {
    if (isElement(fiber.stateNode)) return fiber.stateNode;
    function dfs(start) {
      for (let c = start; c; c = c.sibling) {
        if (isElement(c.stateNode)) return c.stateNode;
        const deeper = dfs(c.child);
        if (deeper) return deeper;
      }
      return void 0;
    }
    return dfs(fiber.child);
  }
  function nameOf(fiber) {
    return typeName(fiber.type) ?? "element";
  }

  // src/overlay/editsDiff.ts
  function parseStyleValue(raw) {
    const t = raw.trim();
    return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : t;
  }
  function parsePropValue(raw) {
    const t = raw.trim();
    if (t === "true") return true;
    if (t === "false") return false;
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
      .nav{display:flex;gap:6px;margin-bottom:6px}
      .nav button{padding:1px 8px;cursor:pointer;font:inherit}
      .nav button:disabled{opacity:.4;cursor:default}
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
      <div class="nav"><button id="nav-up" disabled title="parent (\u2191)">\u2191</button><button id="nav-down" disabled title="child (\u2193)">\u2193</button></div>
      <label>style</label>
      <div id="styles"></div>
      <div class="row"><input class="k" id="newk" placeholder="property"><input class="v" id="newv" placeholder="value"></div>
      <label>props</label>
      <div id="props"></div>
      <div class="row"><input class="k" id="newpk" placeholder="prop"><input class="v" id="newpv" placeholder="value"></div>
      <label>className</label><input class="full" id="cls" placeholder="(none)">
      <label>Text</label><input class="full" id="text" placeholder="(none)">
      <button class="apply" id="apply">Apply</button>
      <div class="hist"><button id="undo" disabled title="undo">\u21B6</button><button id="redo" disabled title="redo">\u21B7</button></div>
      <div class="out" id="out"></div>
    </div>`;
    document.body.appendChild(host);
    const $ = (id) => root.getElementById(id);
    const out = $("out");
    const stylesBox = $("styles");
    const propsBox = $("props");
    let file = null;
    let loc = null;
    let snapshot = null;
    let inspectGen = 0;
    let whoName = "";
    let whoShort = "";
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
    function propRow(name, value, editable, isExpr) {
      const row = document.createElement("div");
      row.className = "row";
      row.dataset.expr = isExpr ? "1" : "";
      row.innerHTML = `<input class="k" disabled><input class="v">`;
      const [k, v] = Array.from(row.querySelectorAll("input"));
      k.value = name;
      v.value = value;
      if (!editable) v.disabled = true;
      return row;
    }
    function clearEditors() {
      stylesBox.innerHTML = "";
      $("newk").value = "";
      $("newv").value = "";
      propsBox.innerHTML = "";
      $("newpk").value = "";
      $("newpv").value = "";
    }
    function render(res) {
      clearEditors();
      if (res.status === "error") {
        snapshot = null;
        out.textContent = `\u274C ${res.message}`;
        return;
      }
      snapshot = res;
      $("who").textContent = `${whoName} \u2014 ${whoShort}:${res.line}`;
      out.textContent = "";
      for (const e of res.style) {
        stylesBox.appendChild(styleRow(e.property, e.value, e.editable && res.styleEditable));
      }
      for (const p of res.props) {
        propsBox.appendChild(propRow(p.name, p.value, p.editable, p.isExpr));
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
      const props = [];
      propsBox.querySelectorAll(".row").forEach((row) => {
        const [k, v] = Array.from(row.querySelectorAll("input"));
        props.push({
          name: k.value,
          value: v.value,
          editable: !v.disabled,
          isExpr: row.dataset.expr === "1"
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
        text: text.disabled ? null : text.value,
        props,
        addedProps: [{ name: $("newpk").value, value: $("newpv").value }]
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
        out.textContent = `\u274C agent unreachable: ${e.message}`;
      }
    }
    $("apply").onclick = async () => {
      if (file === null || !loc || !snapshot) {
        out.textContent = "No editable selection.";
        return;
      }
      const edits = buildEdits(snapshot, collectState());
      if (edits.length === 0) {
        out.textContent = "Nothing to apply.";
        return;
      }
      try {
        const res = await handlers.onApply({ file, line: loc.line, column: loc.column, tag: loc.tag, edits });
        out.textContent = res.status === "applied" ? "\u2705 Applied. HMR will reload." : res.status === "suggested" ? `\u{1F4CB} Suggested:
${res.instruction}
${res.reason}` : `\u274C ${res.message}`;
        if (res.status === "applied") {
          setHistoryButtons(true, false);
          await inspectInto();
        }
      } catch (e) {
        out.textContent = `\u274C agent unreachable: ${e.message}`;
      }
    };
    function setHistoryButtons(canUndo, canRedo) {
      $("undo").disabled = !canUndo;
      $("redo").disabled = !canRedo;
    }
    async function runHistory(kind) {
      try {
        const r = kind === "undo" ? await handlers.onUndo() : await handlers.onRedo();
        if (r.status === "error") {
          out.textContent = `\u274C ${r.message}`;
          void handlers.onHistory().then((s) => setHistoryButtons(s.canUndo, s.canRedo)).catch(() => {
          });
          return;
        }
        setHistoryButtons(r.canUndo, r.canRedo);
        if (r.status === "noop") {
          out.textContent = kind === "undo" ? "\u21B6 \uB354 \uB418\uB3CC\uB9B4 \uB0B4\uC6A9\uC774 \uC5C6\uC2B5\uB2C8\uB2E4." : "\u21B7 \uB2E4\uC2DC \uC801\uC6A9\uD560 \uB0B4\uC6A9\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.";
          return;
        }
        const short = r.file.split(/[\\/]/).pop();
        out.textContent = kind === "undo" ? `\u21B6 ${short} \uB418\uB3CC\uB9BC` : `\u21B7 ${short} \uB2E4\uC2DC \uC801\uC6A9`;
        if (r.file === file) await inspectInto();
      } catch (e) {
        out.textContent = `\u274C agent unreachable: ${e.message}`;
      }
    }
    $("undo").onclick = () => void runHistory("undo");
    $("redo").onclick = () => void runHistory("redo");
    void handlers.onHistory().then((s) => setHistoryButtons(s.canUndo, s.canRedo)).catch(() => {
    });
    function setNavButtons(canUp, canDown) {
      $("nav-up").disabled = !canUp;
      $("nav-down").disabled = !canDown;
    }
    $("nav-up").onclick = () => handlers.onNavigate("up");
    $("nav-down").onclick = () => handlers.onNavigate("down");
    return {
      host,
      async setTarget(name, target) {
        if (!target) {
          inspectGen++;
          $("who").textContent = `${name} \u2014 no source info`;
          file = null;
          loc = null;
          snapshot = null;
          clearEditors();
          setNavButtons(false, false);
          return;
        }
        whoName = name;
        whoShort = target.file.split(/[\\/]/).pop() ?? "";
        $("who").textContent = `${whoName} \u2014 ${whoShort}:${target.line}`;
        file = target.file;
        loc = { line: target.line, column: target.column, tag: target.tag };
        await inspectInto();
      },
      /** Render a persistent, selection-independent error (e.g. agent origin not found). */
      setError(message) {
        inspectGen++;
        file = null;
        loc = null;
        snapshot = null;
        clearEditors();
        setNavButtons(false, false);
        $("who").textContent = "\u26A0 agent \uC5F0\uACB0 \uBD88\uAC00";
        out.textContent = `\u274C ${message}`;
      },
      setNav: setNavButtons
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
    return {
      highlight: show,
      hide() {
        hl.style.display = "none";
      }
    };
  }

  // src/overlay/agentOrigin.ts
  function originFromSrc(src) {
    if (!src) return null;
    try {
      return new URL(src).origin;
    } catch {
      return null;
    }
  }
  var AGENT_ORIGIN = typeof document !== "undefined" ? originFromSrc(document.currentScript?.src) : null;

  // src/overlay/api.ts
  function origin() {
    if (AGENT_ORIGIN === null) throw new Error("agent origin not detected");
    return AGENT_ORIGIN;
  }
  async function sendEdit(req) {
    const res = await fetch(`${origin()}/edit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req)
    });
    return await res.json();
  }
  async function sendInspect(req) {
    const res = await fetch(`${origin()}/inspect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req)
    });
    return await res.json();
  }
  async function sendUndo() {
    const res = await fetch(`${origin()}/undo`, { method: "POST" });
    return await res.json();
  }
  async function sendRedo() {
    const res = await fetch(`${origin()}/redo`, { method: "POST" });
    return await res.json();
  }
  async function fetchHistory() {
    const res = await fetch(`${origin()}/history`);
    const body = await res.json();
    return { canUndo: body.canUndo, canRedo: body.canRedo };
  }

  // src/overlay/index.ts
  var current;
  var inspector;
  function selectFiber(fiber) {
    current = fiber;
    const dom = domNodeOf(fiber);
    if (dom) inspector?.highlight(dom);
    void panel.setTarget(nameOf(fiber), locOf(fiber) ?? null);
    panel.setNav(!!parentSourceFiber(fiber), !!childSourceFiber(fiber));
  }
  var panel = createPanel({
    onInspect: sendInspect,
    onApply: sendEdit,
    onUndo: sendUndo,
    onRedo: sendRedo,
    onHistory: fetchHistory,
    onNavigate: (dir) => {
      if (!current) return;
      const next = dir === "up" ? parentSourceFiber(current) : childSourceFiber(current);
      if (next) selectFiber(next);
    }
  });
  if (AGENT_ORIGIN === null) {
    panel.setError("\uC5D0\uC774\uC804\uD2B8 origin\uC744 \uAC10\uC9C0\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4 \u2014 \uBD81\uB9C8\uD074\uB9BF\uC73C\uB85C \uB2E4\uC2DC \uC5EC\uC138\uC694.");
    console.error("[ui-modifier] agent origin not detected from document.currentScript");
  } else {
    inspector = createInspector((el) => {
      const f = nearestSourceFiber(fiberOf(el));
      if (f) selectFiber(f);
      else void panel.setTarget(el.tagName.toLowerCase(), null);
    }, panel.host);
  }
  console.log("[ui-modifier] overlay ready");
})();
