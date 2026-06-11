// src/overlay/index.ts
import { sourceLocFor, componentNameFor } from "./fiber.js";
import { createPanel } from "./panel.js";
import { createInspector } from "./inspector.js";
import { sendEdit, sendInspect } from "./api.js";

const panel = createPanel({
  onInspect: sendInspect,
  onApply: sendEdit,
});

createInspector((el) => {
  // _debugSource gives the absolute path; it is passed through verbatim.
  const loc = sourceLocFor(el);
  void panel.setTarget(componentNameFor(el), loc ?? null);
}, panel.host);

console.log("[ui-modifier] overlay ready");
