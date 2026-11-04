(() => {
  // ---------- constants ----------
  const MEALS = ["Завтрак","Обед","Ужин","Перекус"];
  const MICRO = [
    {k:"fib", n:"Клетчатка", u:"г", def:30},
    {k:"sug", n:"Сахар", u:"г", def:50, limit:true},
    {k:"na",  n:"Натрий", u:"мг", def:2300, limit:true},
    {k:"k",   n:"Калий", u:"мг", def:3500},
    {k:"ca",  n:"Кальций", u:"мг", def:1000},
    {k:"mg",  n:"Магний", u:"мг", def:400},
    {k:"fe",  n:"Железо", u:"мг", def:10},
    {k:"zn",  n:"Цинк", u:"мг", def:11},
    {k:"vc",  n:"Витамин C", u:"мг", def:90},
    {k:"vd",  n:"Витамин D", u:"мкг", def:15},
    {k:"b12", n:"Витамин B12", u:"мкг", def:2.4},
    {k:"va",  n:"Витамин A", u:"мкг", def:900},
    {k:"om3", n:"Омега-3", u:"г", def:1.6},
    {k:"fol", n:"Фолаты", u:"мкг", def:400},
  ];
  const DEFAULT_GOALS = {kcal:1900, p:160, f:60, c:180, water:1500, micro:Object.fromEntries(MICRO.map(m => [m.k, m.def]))};
  const defaultSups = () => ({
    start: todayIso(), retestMonths: 4,
    items: [
      {id:"b12", name:"Метилкобаламин", dose:"4,5 мкг", perDay:2, months:2},
      {id:"d3",  name:"Витамин D3", dose:"5000 МЕ", perDay:1, months:2},
      {id:"fa",  name:"Фолиевая кислота", dose:"1 мг", perDay:2, months:3},
    ],
  });

  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const fmt = (v, d=0) => { const n = num(v); return (d ? (Math.round(n*10**d)/10**d) : Math.round(n)).toLocaleString("ru-RU"); };
  const pad = n => String(n).padStart(2,"0");
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const parseIso = s => { const [y,m,d] = s.split("-").map(Number); return new Date(y, m-1, d); };
  const addDays = (s, n) => { const d = parseIso(s); d.setDate(d.getDate()+n); return iso(d); };
  const addMonths = (s, n) => { const d = parseIso(s); d.setMonth(d.getMonth()+n); return iso(d); };
  const todayIso = () => iso(new Date());
  const ruDate = s => parseIso(s).toLocaleDateString("ru-RU", {day:"numeric", month:"long"});
  const blank = date => ({date, water:0, items:[], sup:{}});

  // ---------- state ----------
  let cur = todayIso();
  let day = blank(cur);
  let goals = structuredClone(DEFAULT_GOALS);
  let sups = defaultSups();
  let weekDocs = {};
  let pendingWater = null, waterTimer = null;
  let queue = Promise.resolve(), inflight = 0;

  const setStatus = (t, e) => { const s = $("status"); s.textContent = t || ""; s.className = "status" + (e ? " err" : ""); };
  const fail = (what, e) => {
    if (e?.code === 401){ Store.clearToken(); showSetup("Токен не принят GitHub (401). Вставь новый."); return; }
    setStatus(`${what}: ${e?.message || e}`, true);
  };

  // ---------- totals ----------
  function totals(items){
    const t = {kcal:0, p:0, f:0, c:0, _has:{}};
    MICRO.forEach(m => t[m.k] = 0);
    (items || []).forEach(it => {
      ["kcal","p","f","c"].forEach(k => t[k] += num(it[k]));
      MICRO.forEach(m => { if (it[m.k] != null && it[m.k] !== ""){ t[m.k] += num(it[m.k]); t._has[m.k] = true; } });
    });
    return t;
  }

  // ---------- render ----------
  function renderDate(){
    const d = parseIso(cur), t = todayIso();
    const rel = cur === t ? "Сегодня" : cur === addDays(t,-1) ? "Вчера" : cur === addDays(t,1) ? "Завтра" : "";
    const wd = d.toLocaleDateString("ru-RU", {weekday:"long"});
    const long = d.toLocaleDateString("ru-RU", {day:"numeric", month:"long"});
    $("dateLbl").innerHTML = `${esc(rel || wd[0].toUpperCase() + wd.slice(1))}<small>${esc(rel ? wd + ", " + long : long)}</small>`;
  }

  function render(){
    renderDate();
    const items = day.items || [], t = totals(items), g = goals;
    const arc = $("ringArc");
    arc.style.strokeDashoffset = String(251.33 * (1 - Math.min(t.kcal / Math.max(g.kcal,1), 1)));
    arc.style.stroke = t.kcal > g.kcal ? "var(--warn)" : "var(--kcal)";
    const left = g.kcal - t.kcal;
    $("kLeft").textContent = fmt(Math.abs(left));
    $("kLeftLbl").textContent = left >= 0 ? "Осталось, ккал" : "Сверх нормы, ккал";
    $("eatenTxt").textContent = `${fmt(t.kcal)} из ${fmt(g.kcal)} ккал`;
    $("kPct").textContent = Math.round(t.kcal / Math.max(g.kcal,1) * 100) + "%";
    $("macros").innerHTML = [["Белки","p","--p"],["Углеводы","c","--c"],["Жиры","f","--f"]].map(([n,k,col]) => {
      const pct = Math.min(100, t[k] / Math.max(g[k],1) * 100);
      return `<div class="tile"><div class="cap">${n}</div><b>${fmt(t[k])}<small> / ${fmt(g[k])} г</small></b><div class="bar"><div style="width:${pct}%;background:var(${t[k] > g[k] * 1.05 ? "--warn" : col})"></div></div></div>`;
    }).join("");

    const water = pendingWater ?? num(day.water);
    $("wNum").innerHTML = `${fmt(water)} <small>/ ${fmt(g.water)} мл</small>`;

    renderSups();

    $("mealSum").innerHTML = MEALS.map(m => {
      const list = items.filter(it => (MEALS.includes(it.meal) ? it.meal : "Перекус") === m);
      const sum = list.reduce((s, it) => s + num(it.kcal), 0);
      return `<div class="ms" data-meal="${m}"><div class="nm">${m}<small>${list.length ? esc(list.map(it => it.name).join(", ")) : "—"}</small></div><span class="kc">${list.length ? fmt(sum) : ""}</span><button class="round sm" data-add="${m}" aria-label="Добавить в ${m}">+</button></div>`;
    }).join("");
    $("itemsCount").textContent = items.length ? `${items.length} поз.` : "";
    if (!items.length){
      $("meals").innerHTML = `<div class="empty">Пока ничего не записано</div>`;
    } else {
      const groups = {};
      items.forEach(it => { const m = MEALS.includes(it.meal) ? it.meal : "Перекус"; (groups[m] ||= []).push(it); });
      $("meals").innerHTML = MEALS.filter(m => groups[m]).map(m => {
        const list = groups[m].sort((a,b) => String(a.time||"").localeCompare(String(b.time||"")));
        const sum = list.reduce((s, it) => s + num(it.kcal), 0);
        return `<div class="meal"><div class="meal-h">${m}<span>${fmt(sum)} ккал</span></div>` +
          list.map(it => `<button class="item" data-id="${esc(it.id)}"><div class="nm"><div>${esc(it.name || "Без названия")}</div><small>${it.g?fmt(it.g)+" г · ":""}Б ${fmt(it.p)} · Ж ${fmt(it.f)} · У ${fmt(it.c)}${it.time?" · "+esc(it.time):""}</small></div><div class="kc">${fmt(it.kcal)}</div></button>`).join("") +
          `</div>`;
      }).join("");
    }

    const shown = MICRO.filter(m => t._has[m.k]);
    $("microCard").hidden = !shown.length;
    $("micro").innerHTML = shown.map(m => {
      const goal = num(g.micro?.[m.k] ?? m.def) || m.def, v = t[m.k];
      const over = m.limit && v > goal;
      return `<div class="mi${m.limit?" limit":""}${over?" over":""}"><div class="lbl"><span>${m.n}${m.limit?' <i style="font-size:11px">лимит</i>':""}</span><i>${fmt(v, v<10?1:0)} / ${fmt(goal, goal<10?1:0)} ${m.u}</i></div><div class="bar"><div style="width:${Math.min(100, v/goal*100)}%;background:${m.limit?"":"var(--kcal)"}"></div></div></div>`;
    }).join("");

    renderWeek();
  }

  function renderSups(){
    const end = it => addMonths(sups.start, it.months);
    $("sups").innerHTML = sups.items.map(it => {
      const n = num(day.sup?.[it.id]);
      const done = cur > end(it);
      const dots = Array.from({length: it.perDay}, (_, i) => `<button class="dot${i<n?" on":""}" data-sup="${esc(it.id)}" data-i="${i}" aria-label="Принято ${i+1}">${i<n?"✓":""}</button>`).join("");
      return `<div class="sup"><div class="nm">${esc(it.name)} ${esc(it.dose)}<small>${it.perDay}×/день · ${done ? "курс завершён" : "до " + ruDate(end(it))}</small></div><div class="dots">${dots}</div></div>`;
    }).join("");
    $("supTab").hidden = !sups.items.length;
    $("supInfo").textContent = "Анализы " + ruDate(addMonths(sups.start, sups.retestMonths));
  }

  // неделя пн–вс, в которую попадает cur; кольцо = доля нормы калорий
  const weekDays = () => { const wd = (parseIso(cur).getDay() + 6) % 7; return Array.from({length:7}, (_, i) => addDays(cur, i - wd)); };
  function renderWeek(){
    const t = todayIso();
    $("week").innerHTML = weekDays().map(d => {
      const k = totals(d === cur ? day.items : weekDocs[d]?.items).kcal;
      const pct = Math.min(k / Math.max(goals.kcal,1), 1);
      const col = k > goals.kcal * 1.05 ? "var(--warn)" : "var(--ink)";
      const wd = parseIso(d).toLocaleDateString("ru-RU", {weekday:"short"});
      return `<button class="day${d===cur?" sel":""}${d===t?" today":""}" data-d="${d}" aria-label="${esc(ruDate(d))}"><svg width="40" height="40" viewBox="0 0 40 40"><circle cx="20" cy="20" r="18" fill="none" stroke="var(--soft)" stroke-width="2.5"/><circle cx="20" cy="20" r="18" fill="none" stroke="${col}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="113.1" stroke-dashoffset="${113.1 * (1 - pct)}"/></svg>${esc(wd)}</button>`;
    }).join("");
  }

  // ---------- data ----------
  const dayPath = d => `days/${d}.json`;

  async function loadDay(){
    const d = cur;
    setStatus("Загрузка…");
    try {
      const r = await Store.read(dayPath(d));
      if (d !== cur) return;
      day = {...blank(d), ...(r?.data || {})};
      setStatus(""); render();
    } catch (e){ fail("Не загрузилось", e); }
    const others = weekDays().filter(x => x !== d && x <= todayIso());
    const docs = await Promise.all(others.map(x => Store.read(dayPath(x)).then(r => r?.data, () => null)));
    if (d !== cur) return;
    weekDocs = {}; others.forEach((x, i) => { if (docs[i]) weekDocs[x] = docs[i]; });
    renderWeek();
  }

  // Оптимистично меняем экран, пишем на сервер по очереди (каждая правка = коммит).
  function mutate(fn, msg){
    const d = cur;
    day = fn(day); render();
    inflight++;
    queue = queue.then(async () => {
      try {
        const saved = await Store.update(dayPath(d), cd => fn(cd || blank(d)), `${d}: ${msg}`);
        if (d === cur && inflight === 1) { day = {...blank(d), ...saved}; render(); }
        setStatus("");
      } catch (e){ fail("Не сохранилось", e); }
      inflight--;
    });
  }

  function bumpWater(delta){
    pendingWater = Math.max(0, (pendingWater ?? num(day.water)) + delta);
    render();
    clearTimeout(waterTimer);
    waterTimer = setTimeout(() => {
      const v = pendingWater; pendingWater = null;
      mutate(d => ({...d, water: v}), `вода ${v} мл`);
    }, 700);
  }

  const saveConf = (path, data, msg) => Store.update(path, () => data, msg).catch(e => fail("Не сохранилось", e));

  // ---------- sheets ----------
  function openSheet(html){ $("sheetBody").innerHTML = html; $("scrim").classList.add("on"); $("sheet").classList.add("on"); }
  function closeSheet(){ $("scrim").classList.remove("on"); $("sheet").classList.remove("on"); }
  $("scrim").onclick = closeSheet;

  const nowTime = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const guessMeal = () => { const h = new Date().getHours(); return h < 11 ? "Завтрак" : h < 16 ? "Обед" : h < 21 ? "Ужин" : "Перекус"; };

  function itemForm(it, meal){
    const v = k => it && it[k] != null ? esc(it[k]) : "";
    openSheet(`
      <h2>${it ? "Изменить" : "Добавить еду"}</h2>
      <form id="itemForm">
        <label class="fld"><span>Название</span><input name="name" value="${v("name")}" placeholder="Гречка с курицей" required></label>
        <div class="grid3 mt">
          <label class="fld"><span>Приём</span><select name="meal">${MEALS.map(m => `<option${(it?.meal||meal||guessMeal())===m?" selected":""}>${m}</option>`).join("")}</select></label>
          <label class="fld"><span>Время</span><input name="time" type="time" value="${v("time") || nowTime()}"></label>
          <label class="fld"><span>Вес, г</span><input name="g" inputmode="decimal" value="${v("g")}"></label>
        </div>
        <div class="grid4">
          <label class="fld"><span>Ккал</span><input name="kcal" inputmode="decimal" value="${v("kcal")}" required></label>
          <label class="fld"><span>Б, г</span><input name="p" inputmode="decimal" value="${v("p")}"></label>
          <label class="fld"><span>Ж, г</span><input name="f" inputmode="decimal" value="${v("f")}"></label>
          <label class="fld"><span>У, г</span><input name="c" inputmode="decimal" value="${v("c")}"></label>
        </div>
        <details${MICRO.some(m => it && it[m.k] != null) ? " open" : ""}><summary>Микроэлементы (необязательно)</summary>
          <div class="grid3">${MICRO.map(m => `<label class="fld"><span>${m.n}, ${m.u}</span><input name="${m.k}" inputmode="decimal" value="${v(m.k)}"></label>`).join("")}</div>
        </details>
        <button class="btn" type="submit">${it ? "Сохранить" : "Добавить"}</button>
        ${it ? `<button class="btn danger" type="button" id="delBtn">Удалить</button>` : ""}
      </form>`);
    $("itemForm").onsubmit = e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const out = {...(it || {}), id: it?.id || ("m" + Date.now().toString(36) + Math.random().toString(36).slice(2,6))};
      out.name = String(fd.get("name")).trim(); out.meal = fd.get("meal"); out.time = fd.get("time");
      ["g","kcal","p","f","c", ...MICRO.map(m => m.k)].forEach(k => {
        const raw = String(fd.get(k) ?? "").replace(",", ".").trim();
        if (raw === "") delete out[k]; else out[k] = num(raw);
      });
      closeSheet();
      mutate(d => ({...d, items: d.items.some(x => x.id === out.id) ? d.items.map(x => x.id === out.id ? out : x) : [...d.items, out]}), (it ? "правка: " : "добавлено: ") + out.name);
    };
    if (it){
      const b = $("delBtn");
      b.onclick = () => {
        if (!b.classList.contains("armed")){ b.classList.add("armed"); b.textContent = "Точно удалить?"; return; }
        closeSheet();
        mutate(d => ({...d, items: d.items.filter(x => x.id !== it.id)}), "удалено: " + it.name);
      };
    }
  }

  function itemDetails(id){
    const it = day.items.find(x => x.id === id); if (!it) return;
    const rows = [["Калории", fmt(it.kcal)+" ккал"],["Белки", fmt(it.p,1)+" г"],["Жиры", fmt(it.f,1)+" г"],["Углеводы", fmt(it.c,1)+" г"]];
    if (it.g) rows.unshift(["Вес", fmt(it.g)+" г"]);
    MICRO.forEach(m => { if (it[m.k] != null) rows.push([m.n, fmt(it[m.k], it[m.k] < 10 ? 1 : 0) + " " + m.u]); });
    openSheet(`<h2>${esc(it.name)}</h2>
      <div class="hint">${esc(it.meal||"")}${it.time ? " · " + esc(it.time) : ""}</div>
      <div>${rows.map(([k,v]) => `<div class="kv"><i>${k}</i><span>${v}</span></div>`).join("")}</div>
      <button class="btn ghost" id="editBtn" style="margin-top:14px">Изменить</button>`);
    $("editBtn").onclick = () => itemForm(it);
  }

  function settingsSheet(){
    const g = goals;
    openSheet(`<h2>Цели на день</h2>
      <form id="gForm">
        <div class="grid2">
          <label class="fld"><span>Калории, ккал</span><input name="kcal" inputmode="decimal" value="${g.kcal}"></label>
          <label class="fld"><span>Вода, мл</span><input name="water" inputmode="decimal" value="${g.water}"></label>
        </div>
        <div class="grid3">
          <label class="fld"><span>Белки, г</span><input name="p" inputmode="decimal" value="${g.p}"></label>
          <label class="fld"><span>Жиры, г</span><input name="f" inputmode="decimal" value="${g.f}"></label>
          <label class="fld"><span>Углеводы, г</span><input name="c" inputmode="decimal" value="${g.c}"></label>
        </div>
        <details><summary>Нормы микроэлементов</summary>
          <div class="grid3">${MICRO.map(m => `<label class="fld"><span>${m.n}, ${m.u}</span><input name="mi_${m.k}" inputmode="decimal" value="${g.micro?.[m.k] ?? m.def}"></label>`).join("")}</div>
        </details>
        <button class="btn" type="submit">Сохранить</button>
        <button class="btn ghost" type="button" id="logout">Сменить токен</button>
      </form>`);
    $("logout").onclick = () => { closeSheet(); Store.clearToken(); showSetup(); };
    $("gForm").onsubmit = e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const n = (k, d) => { const v = num(String(fd.get(k)).replace(",", ".")); return v > 0 ? v : d; };
      const ng = {kcal:n("kcal",g.kcal), water:n("water",g.water), p:n("p",g.p), f:n("f",g.f), c:n("c",g.c), micro:{}};
      MICRO.forEach(m => ng.micro[m.k] = n("mi_"+m.k, g.micro?.[m.k] ?? m.def));
      closeSheet(); goals = ng; render();
      saveConf("settings.json", ng, "цели");
    };
  }

  // ---------- events ----------
  function go(d){ cur = d; day = blank(d); weekDocs = {}; pendingWater = null; render(); loadDay(); }
  $("prev").onclick = () => go(addDays(cur,-7));
  $("next").onclick = () => go(addDays(cur,7));
  $("dateLbl").onclick = () => go(todayIso());
  $("wForm").onsubmit = e => {
    e.preventDefault();
    const v = Math.round(num($("wIn").value)) || 250; // пусто = стакан 250 мл
    $("wIn").value = ""; $("wIn").blur();
    if (v > 0 && v <= 5000) bumpWater(v);
  };
  $("wMinus").onclick = () => bumpWater(-250);
  $("addBtn2").onclick = () => itemForm(null);
  $("mealSum").onclick = e => {
    const a = e.target.closest("[data-add]"); if (a) return itemForm(null, a.dataset.add);
    if (e.target.closest(".ms")) document.querySelector('#tabbar [data-tab="food"]').click();
  };
  $("tabbar").onclick = e => {
    const b = e.target.closest("button"); if (!b) return;
    document.querySelectorAll("#tabbar button").forEach(x => x.classList.toggle("on", x === b));
    document.querySelectorAll("section[data-tab]").forEach(x => x.hidden = x.dataset.tab !== b.dataset.tab);
    scrollTo(0, 0);
  };
  $("settingsBtn").onclick = settingsSheet;
  $("meals").onclick = e => { const b = e.target.closest(".item"); if (b) itemDetails(b.dataset.id); };
  $("week").onclick = e => { const b = e.target.closest(".day"); if (b && b.dataset.d !== cur) go(b.dataset.d); };
  $("sups").onclick = e => {
    const b = e.target.closest(".dot"); if (!b) return;
    const id = b.dataset.sup, i = Number(b.dataset.i);
    const set = n => d => ({...d, sup: {...d.sup, [id]: n}});
    const n = num(day.sup?.[id]) === i + 1 ? i : i + 1;
    mutate(set(n), `добавка ${id}: ${n}`);
  };
  $("tokForm").onsubmit = async e => {
    e.preventDefault();
    Store.setToken($("tokInput").value); $("tokInput").value = "";
    $("tokErr").textContent = "Проверяю…";
    try { await Store.check(); $("tokErr").textContent = ""; boot(); }
    catch (er){ Store.clearToken(); $("tokErr").textContent = "Не вышло: " + er.message; }
  };

  function showSetup(msg){
    $("app").hidden = true; $("tabbar").hidden = true; $("setup").hidden = false;
    $("tokErr").textContent = msg || "";
  }

  // ---------- boot ----------
  async function boot(){
    if (!Store.hasToken()) return showSetup();
    $("setup").hidden = true; $("app").hidden = false; $("tabbar").hidden = false;
    render(); setStatus("Загрузка…");
    try {
      let s = await Store.read("settings.json");
      if (!s) await Store.update("settings.json", () => DEFAULT_GOALS, "начальные цели");
      else goals = {...DEFAULT_GOALS, ...s.data, micro: {...DEFAULT_GOALS.micro, ...(s.data.micro || {})}};
      let su = await Store.read("supplements.json");
      if (!su) await Store.update("supplements.json", () => sups, "добавки");
      else sups = su.data;
    } catch (e){ return fail("Не загрузилось", e); }
    render(); loadDay();
  }

  // записи с компьютера (Claude) подхватываются при каждом возврате в приложение
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && Store.hasToken() && !inflight && pendingWater == null) loadDay();
  });

  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js");
  boot();
})();
