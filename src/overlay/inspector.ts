// src/overlay/inspector.ts
export function createInspector(onSelect: (el: Element) => void, ignore?: Element) {
  const hl = document.createElement("div");
  hl.style.cssText =
    "position:fixed;pointer-events:none;z-index:2147483646;border:2px solid #1677ff;" +
    "background:rgba(22,119,255,.08);display:none";
  document.body.appendChild(hl);

  // True when the event originates from our own overlay UI. Uses composedPath
  // so it works through shadow-DOM retargeting (e.target becomes the host).
  function isOwn(e: Event): boolean {
    const path = e.composedPath();
    return path.includes(hl) || (!!ignore && path.includes(ignore));
  }

  function show(el: Element) {
    const r = el.getBoundingClientRect();
    hl.style.display = "block";
    hl.style.left = `${r.left}px`; hl.style.top = `${r.top}px`;
    hl.style.width = `${r.width}px`; hl.style.height = `${r.height}px`;
  }

  function onMove(e: MouseEvent) {
    if (isOwn(e)) return;
    const el = e.target as Element;
    if (el) show(el);
  }
  function onClick(e: MouseEvent) {
    if (isOwn(e)) return; // let clicks inside our panel reach its own handlers
    const el = e.target as Element;
    if (!el) return;
    e.preventDefault(); e.stopPropagation();
    onSelect(el);
  }

  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("click", onClick, true);

  return {
    highlight: show,
    hide() { hl.style.display = "none"; },
  };
}
