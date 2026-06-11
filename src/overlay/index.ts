// src/overlay/index.ts
import { sourceLocFor, componentNameFor } from "./fiber.js";
import { createPanel } from "./panel.js";
import { createInspector } from "./inspector.js";
import { sendEdit, sendInspect, sendUndo, sendRedo, fetchHistory } from "./api.js";
import { AGENT_ORIGIN } from "./agentOrigin.js";

const panel = createPanel({
  onInspect: sendInspect,
  onApply: sendEdit,
  onUndo: sendUndo,
  onRedo: sendRedo,
  onHistory: fetchHistory,
});

if (AGENT_ORIGIN === null) {
  // Loaded without a detectable script origin — fetches can't be aimed anywhere.
  panel.setError("에이전트 origin을 감지하지 못했습니다 — 북마클릿으로 다시 여세요.");
  console.error("[ui-modifier] agent origin not detected from document.currentScript");
} else {
  createInspector((el) => {
    // _debugSource gives the absolute path; it is passed through verbatim.
    const loc = sourceLocFor(el);
    void panel.setTarget(componentNameFor(el), loc ?? null);
  }, panel.host);
}

console.log("[ui-modifier] overlay ready");
