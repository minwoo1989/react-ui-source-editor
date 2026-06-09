// src/overlay/inspector.ts
export function createInspector(onSelect: (el: Element) => void) {
  const hl = document.createElement("div");
  hl.style.cssText =
    "position:fixed;pointer-events:none;z-index:2147483646;border:2px solid #1677ff;" +
    "background:rgba(22,119,255,.08);display:none";
  document.body.appendChild(hl);

  function show(el: Element) {
    const r = el.getBoundingClientRect();
    hl.style.display = "block";
    hl.style.left = `${r.left}px`; hl.style.top = `${r.top}px`;
    hl.style.width = `${r.width}px`; hl.style.height = `${r.height}px`;
  }

  function onMove(e: MouseEvent) {
    const el = e.target as Element;
    if (el && el !== hl) show(el);
  }
  function onClick(e: MouseEvent) {
    const el = e.target as Element;
    if (!el) return;
    // ignore clicks inside our own shadow-host panel
    if ((el as HTMLElement).closest && (el as any).getRootNode() instanceof ShadowRoot) return;
    e.preventDefault(); e.stopPropagation();
    onSelect(el);
  }

  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("click", onClick, true);
}
