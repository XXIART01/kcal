// Отладочная сетка: открыть приложение с ?grid (и ?iphone для зон iPhone 13).
// Рисует линии каждые 8 px, рамки блоков с их высотой и расстояния между блоками.
(() => {
  const BLOCKS = ".top,.days,.hero,.tiles,.row-card,#mealSum,section:not([hidden]) .sec,#foodQ,#foodCats:not(:empty),#foodList>*,#supCard,.tabbar";
  const layer = document.createElement("div");
  layer.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:9999;font:600 10px/1 -apple-system,Segoe UI,sans-serif";
  document.body.appendChild(layer);
  const box = (x, y, w, h, css) => { const d = document.createElement("div"); d.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;${css}`; layer.appendChild(d); return d; };
  const tag = (x, y, text, bg) => { const d = box(x, y, 0, 0, ""); d.innerHTML = `<span style="position:absolute;transform:translate(-50%,-50%);white-space:nowrap;background:${bg};color:#fff;padding:2px 4px;border-radius:4px">${text}</span>`; };

  function draw(){
    layer.innerHTML = "";
    // линии сетки 8 px (каждая 4-я ярче = 32 px)
    layer.appendChild(Object.assign(document.createElement("div"), {style: "position:absolute;inset:0;background-image:repeating-linear-gradient(to bottom,rgba(255,80,80,.10) 0 1px,transparent 1px 8px),repeating-linear-gradient(to bottom,rgba(255,80,80,.22) 0 1px,transparent 1px 32px)"}));
    const sat = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--sat")) || 0;
    const sab = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--sab")) || 0;
    if (document.documentElement.classList.contains("sim-iphone")){
      box(0, 0, innerWidth, sat, "background:rgba(255,200,0,.18)"); tag(innerWidth / 2, sat / 2, `статус-бар ${sat}`, "#a80");
      box(0, innerHeight - sab, innerWidth, sab, "background:rgba(255,200,0,.18)"); tag(innerWidth / 2, innerHeight - sab / 2, `домой ${sab}`, "#a80");
    }
    const els = [...document.querySelectorAll(BLOCKS)].filter(e => e.offsetParent || getComputedStyle(e).position === "fixed")
      .map(e => ({e, r: e.getBoundingClientRect()})).filter(o => o.r.height > 0).sort((a, b) => a.r.top - b.r.top);
    let prev = null;
    for (const o of els){
      const {r} = o;
      box(r.left, r.top, r.width, r.height, "outline:1px dashed rgba(80,200,255,.9)");
      tag(r.right - 14, r.top + r.height / 2, Math.round(r.height), "#0a7");
      if (prev && r.top >= prev.bottom - 0.5){
        const g = Math.round(r.top - prev.bottom);
        box(r.left + 24, prev.bottom, 2, r.top - prev.bottom, "background:#f0f");
        tag(r.left + 24, prev.bottom + (r.top - prev.bottom) / 2, g, "#b0b");
      }
      prev = r.top >= (prev?.bottom ?? -1) ? r : prev;
    }
    // поля экрана
    const app = document.querySelector(".wrap").getBoundingClientRect();
    tag(app.left / 2, 120, Math.round(app.left), "#b0b");
  }
  draw();
  setInterval(draw, 600);
})();
