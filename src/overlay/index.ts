// src/overlay/index.ts
import {
  fiberOf, nearestSourceFiber, parentSourceFiber, childSourceFiber,
  locOf, domNodeOf, nameOf, locFromDataAttr, type FiberLike, type SourceLoc,
} from "./fiber.js";
import { createPanel } from "./panel.js";
import { createInspector } from "./inspector.js";
import { sendEdit, sendInspect, sendUndo, sendRedo, fetchHistory } from "./api.js";
import { AGENT_ORIGIN } from "./agentOrigin.js";

let current: FiberLike | undefined;
let inspector: ReturnType<typeof createInspector> | undefined;

function selectFiber(fiber: FiberLike) {
  current = fiber;
  const dom = domNodeOf(fiber);
  if (dom) inspector?.highlight(dom);
  void panel.setTarget(nameOf(fiber), locOf(fiber) ?? null);
  panel.setNav(!!parentSourceFiber(fiber), !!childSourceFiber(fiber));
}

// Data-attr mode (React 19+ / no fiber source): no fiber → tree navigation off.
function selectLoc(loc: SourceLoc, el: Element) {
  current = undefined;
  inspector?.highlight(el);
  void panel.setTarget(loc.tag ?? el.tagName.toLowerCase(), loc);
  panel.setNav(false, false);
}

const panel = createPanel({
  onInspect: sendInspect,
  onApply: sendEdit,
  onUndo: sendUndo,
  onRedo: sendRedo,
  onHistory: fetchHistory,
  onNavigate: (dir) => {
    if (!current) return;
    const next = dir === "up" ? parentSourceFiber(current) : childSourceFiber(current);
    if (next) selectFiber(next);
  },
});

if (AGENT_ORIGIN === null) {
  // Loaded without a detectable script origin — fetches can't be aimed anywhere.
  panel.setError("에이전트 origin을 감지하지 못했습니다 — 북마클릿으로 다시 여세요.");
  console.error("[ui-modifier] agent origin not detected from document.currentScript");
} else {
  inspector = createInspector((el) => {
    const forceData = !!(window as unknown as { __uiModifierForceDataSource?: unknown }).__uiModifierForceDataSource;
    const f = forceData ? undefined : nearestSourceFiber(fiberOf(el));
    if (f) { selectFiber(f); return; }
    const dl = locFromDataAttr(el);
    if (dl) { selectLoc(dl, el.closest("[data-source-file]") ?? el); return; }
    void panel.setTarget(el.tagName.toLowerCase(), null);
  }, panel.host);
}

console.log("[ui-modifier] overlay ready");
