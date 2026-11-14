// ── Change markers: the Before / Changes / After switch ─────────────
// The switch starts hidden because it needs this script. It swaps the am-view-* class of its diagram; the delta styles show the colors and badges only in
// the Changes view and hide the items that do not exist in the view.
(() => {
  const VIEWS = ["before", "changes", "after"];
  const setView = (el: Element, view: string | undefined) => {
    el.classList.remove(...VIEWS.map((v) => `am-view-${v}`));
    el.classList.add(`am-view-${view}`);
  };
  for (const bar of document.querySelectorAll<HTMLElement>(".am-delta-bar")) {
    const view = bar.parentElement;
    if (!view) continue;
    const group = bar.querySelector<HTMLElement>(".am-delta-switch");
    if (!group) continue;
    group.hidden = false;
    group.addEventListener("click", (e) => {
      const btn =
        e.target instanceof Element
          ? e.target.closest<HTMLButtonElement>("button[data-view]")
          : null;
      if (!btn) return;
      setView(view, btn.dataset.view);
      for (const b of group.querySelectorAll<HTMLButtonElement>("button"))
        b.setAttribute("aria-pressed", String(b === btn));
    });
  }
  // The expand button copies only the drawing into the viewer; the viewer shows the view the diagram is in.
  document.addEventListener("click", (e) => {
    const host =
      e.target instanceof Element ? e.target.closest(".am-diagram-expand")?.parentElement : null;
    const canvas = document.querySelector<HTMLElement>(".am-lightbox-canvas");
    const view = host && VIEWS.find((v) => host.classList.contains(`am-view-${v}`));
    if (view && canvas) setView(canvas, view);
  });
})();
