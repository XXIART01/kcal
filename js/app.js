(() => {
  // ---------- constants ----------
  const VERSION = 20;
  // отладка вёрстки: ?iphone — зоны iPhone 13, ?grid — сетка и размеры блоков
  if (/[?&]iphone/.test(location.search)) document.documentElement.classList.add("sim-iphone");
  if (/[?&]grid/.test(location.search)) addEventListener("load", () => document.head.appendChild(Object.assign(document.createElement("script"), {src: "js/grid.js"})));
  const ICON_PLUS = `<svg viewBox="0 0 24 24" class="ico" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>`, ICON_ARROW = `<svg viewBox="0 0 24 24" class="ico" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`; // поднимать вместе с CACHE в sw.js
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
  let foods = []; // мои продукты: {id, name, brand, kcal, p, f, c — на 100 г, pc — вес 1 шт в г}
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
    // кольцо: прогресс — мягкий зелёный; сверх нормы — белый хвост (как у полос БЖУ: белое = «сверх», без тревоги)
    const C = 251.33, arc = $("ringArc"), over = $("ringOver");
    if (t.kcal <= g.kcal){
      arc.style.strokeDasharray = `${C * t.kcal / Math.max(g.kcal,1)} ${C}`;
      arc.style.stroke = "var(--ring)";
      over.style.strokeDasharray = `0 ${C}`;
    } else {
      const gl = C * g.kcal / t.kcal;
      arc.style.strokeDasharray = `${gl} ${C}`; arc.style.stroke = "var(--ring)";
      const gap = 7; // скруглённые концы (радиус 4,5) не налезают друг на друга
      over.style.strokeDasharray = `0 ${gl + gap} ${Math.max(0, C - gl - 2 * gap)} ${C}`; // хвост — сразу после нормы
    }
    const left = g.kcal - t.kcal;
    $("kLeft").textContent = fmt(Math.abs(left));
    $("kLeftLbl").textContent = left >= 0 ? "Осталось, ккал" : "Сверх нормы, ккал";
    $("eatenTxt").textContent = `${fmt(t.kcal)} из ${fmt(g.kcal)} ккал`;
    $("kPct").textContent = Math.round(t.kcal / Math.max(g.kcal,1) * 100) + "%";
    $("ringBox").setAttribute("aria-label", `Съедено ${fmt(t.kcal)} из ${fmt(g.kcal)} ккал, ${left >= 0 ? "осталось " + fmt(left) : "сверх нормы " + fmt(-left)}`);
    // полоса: до нормы — цвет нутриента; сверх нормы — белый хвост (без тревожного красного)
    $("macros").innerHTML = [["Белки","p","--p"],["Углеводы","c","--c"],["Жиры","f","--f"]].map(([n,k,col]) => {
      const v = t[k], gg = Math.max(g[k], 1);
      const fill = v > gg
        ? `<div style="width:${gg / v * 100}%;background:var(${col})"></div><div class="ov" style="width:${(v - gg) / v * 100}%"></div>`
        : `<div style="width:${v / gg * 100}%;background:var(${col})"></div>`;
      return `<div class="tile" role="img" aria-label="${n}: ${fmt(v)} из ${fmt(g[k])} грамм${v > gg ? ", сверх нормы " + fmt(v - gg) : ""}"><div class="cap" aria-hidden="true">${n}</div><b>${fmt(v)}</b><small class="goal">из ${fmt(g[k])} г${v > gg ? ` <em>+${fmt(v - gg)}</em>` : ""}</small><div class="bar">${fill}</div></div>`;
    }).join("");

    const water = pendingWater ?? num(day.water);
    $("wNum").innerHTML = `${fmt(water)} <small>/ ${fmt(g.water)} мл</small>`;

    renderSups();

    $("mealSum").innerHTML = MEALS.map(m => {
      const list = items.filter(it => (MEALS.includes(it.meal) ? it.meal : "Перекус") === m);
      const sum = list.reduce((s, it) => s + num(it.kcal), 0);
      return `<div class="ms" data-meal="${m}"><div class="nm">${m}${list.length ? `<small>${esc(list.map(it => it.name).join(", "))}</small>` : ""}</div><span class="kc">${list.length ? fmt(sum) : ""}</span><button class="round sm" data-add="${m}" aria-label="Добавить в ${m}">${ICON_PLUS}</button></div>`;
    }).join("");
    renderFoods();
    renderWeek();
  }

  const r1 = v => Math.round(num(v) * 10) / 10;
  const per100 = f => `${fmt(f.kcal)} ккал · Б ${fmt(f.p,1)} · Ж ${fmt(f.f,1)} · У ${fmt(f.c,1)}`;
  const foodName = f => f.brand ? `${f.name}, ${f.brand}` : f.name;
  // все слова запроса есть в названии или бренде
  const match = (f, q) => { const h = (f.name + " " + (f.brand || "")).toLowerCase(); return q.toLowerCase().split(/\s+/).every(w => h.includes(w)); };
  const foodRow = (f, attr) => `<button class="item" ${attr}><div class="nm"><div>${esc(f.name)}</div><small>${f.brand ? esc(f.brand) + " · " : ""}${per100(f)} на 100 г</small></div></button>`;
  const newId = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2,6);

  // базовый набор: справочные КБЖУ на 100 г (крупы и макароны — сухие)
  const STARTER = [
    ["Молочка", "Творог 5%", 121, 17, 5, 1.8], ["Молочка", "Творог обезжиренный", 71, 16.5, 0.5, 1.3], ["Молочка", "Кефир 1%", 40, 3, 1, 4],
    ["Молочка", "Молоко 2,5%", 52, 2.8, 2.5, 4.7], ["Молочка", "Ряженка 2,5%", 54, 2.9, 2.5, 4.2], ["Молочка", "Йогурт греческий 2%", 66, 8, 2, 4],
    ["Молочка", "Сыр твёрдый 45%", 360, 23, 29, 0], ["Молочка", "Сметана 15%", 158, 2.6, 15, 3],
    ["Мясо, рыба, яйца", "Куриное филе", 110, 23, 1.2, 0], ["Мясо, рыба, яйца", "Яйцо куриное", 157, 12.7, 11.5, 0.7, 55],
    ["Мясо, рыба, яйца", "Филе индейки", 114, 23.6, 1.5, 0], ["Мясо, рыба, яйца", "Говядина", 187, 18.9, 12.4, 0],
    ["Мясо, рыба, яйца", "Сёмга", 202, 20, 13, 0], ["Мясо, рыба, яйца", "Тунец в собственном соку", 96, 21, 1, 0],
    ["Крупы, хлеб, макароны", "Гречка", 313, 12.6, 3.3, 62], ["Крупы, хлеб, макароны", "Рис белый", 344, 6.7, 0.7, 78.9],
    ["Крупы, хлеб, макароны", "Овсяные хлопья", 352, 12.3, 6.2, 61.8], ["Крупы, хлеб, макароны", "Макароны из твёрдых сортов", 350, 12, 1.5, 71],
    ["Крупы, хлеб, макароны", "Хлеб цельнозерновой", 245, 8.5, 3, 45, 30], ["Крупы, хлеб, макароны", "Картофель", 77, 2, 0.4, 16.3],
    ["Овощи и фрукты", "Банан", 96, 1.5, 0.2, 21.8, 120], ["Овощи и фрукты", "Яблоко", 47, 0.4, 0.4, 9.8, 180],
    ["Овощи и фрукты", "Апельсин", 43, 0.9, 0.2, 8.1, 200], ["Овощи и фрукты", "Огурец", 15, 0.8, 0.1, 2.8, 120],
    ["Овощи и фрукты", "Помидор", 20, 1.1, 0.2, 3.7, 120],
    ["Сладкое", "Шоколад молочный", 535, 7, 30, 57], ["Сладкое", "Мёд", 329, 0.8, 0, 81.5],
    ["Снеки", "Миндаль", 609, 18.6, 53.7, 13], ["Снеки", "Грецкий орех", 654, 15.2, 65.2, 7], ["Снеки", "Чипсы картофельные", 520, 6.5, 30, 53],
    ["Напитки", "Кола", 42, 0, 0, 10.6], ["Напитки", "Сок апельсиновый", 45, 0.7, 0.1, 10.4],
    ["Другое", "Масло оливковое", 898, 0, 99.8, 0], ["Другое", "Арахисовая паста", 588, 25, 50, 20],
  ].map(([cat, name, kcal, p, f, c, pc], i) => ({id: "s" + (i + 1), name, cat, kcal, p, f, c, ...(pc ? {pc} : {})}));
  function addStarter(){
    const have = new Set(foods.map(f => f.id)), add = STARTER.filter(s => !have.has(s.id));
    if (!add.length) return;
    foods = [...foods, ...add]; renderFoods(); saveFoods("базовые продукты");
  }

  // ---------- категории ----------
  const CATS = ["Молочка","Мясо, рыба, яйца","Крупы, хлеб, макароны","Овощи и фрукты","Сладкое","Снеки","Напитки","Готовая еда","Другое"];
  // порядок важен: первое совпадение побеждает («кофе с молоком» — напиток, «шоколадное молоко» — сладкое)
  const CAT_WORDS = [
    ["Готовая еда", "суп|борщ|щи|пицц|бургер|шаурм|ролл|суши|пельмен|вареник|плов|котлет|лазань|сэндвич|бутерброд|салат цезарь|оливье"],
    ["Сладкое", "шоколад|конфет|печень|торт|пирож|морожен|пломбир|вафл|зефир|мармелад|халв|сахар|мёд|мед|варень|джем|десерт|батончик|круассан|пончик|сырок"],
    ["Снеки", "чипс|орех|сухарик|попкорн|крекер|семечк|миндал|арахис|кешью|фисташ|снек"],
    ["Напитки", "вода|газиров|кола|сок|морс|чай|кофе|лимонад|напит|энергет|квас|компот|пиво|вино|минерал"],
    ["Молочка", "молок|молоч|кефир|ряженк|йогурт|творог|творож|сыр|сметан|сливк|простокваш|айран|масло сливоч|снежок|варенец"],
    ["Мясо, рыба, яйца", "кур|цыпл|говя|свин|индей|мяс|фарш|рыб|лосос|сёмг|семг|форел|тунец|скумбр|кревет|яйц|яйк|колбас|сосис|ветчин|бекон|филе|грудк|печень куриная"],
    ["Крупы, хлеб, макароны", "греч|рис|овсян|овёс|макарон|спагет|паст|хлеб|батон|лаваш|круп|булгур|киноа|мук|хлопь|гранол|мюсли|картоф|пюре|лапш"],
    ["Овощи и фрукты", "банан|яблок|груш|апельсин|мандарин|виноград|ягод|клубни|малин|черник|голубик|огур|помидор|томат|морков|капуст|салат|лук|перец|кабач|брокколи|авокадо|лимон|киви|персик|абрикос|слив|арбуз|дын|гриб|шпинат|зелен|свекл|тыкв|фрукт|овощ"],
  ].map(([c, w]) => [c, new RegExp("(^|[^а-яё])(" + w + ")", "i")]);
  const TAG_CATS = [
    ["Готовая еда", /^en:(meals|soups|pizzas|sandwiches|prepared)/], ["Сладкое", /^en:(sweet-snacks|chocolates|confectioneries|biscuits|desserts|ice-creams|cakes|candies)/],
    ["Снеки", /^en:(salty-snacks|chips|crisps|nuts|appetizers)/], ["Молочка", /^en:(dairies|milks|cheeses|yogurts|fermented-milk)/],
    ["Напитки", /^en:(beverages|waters|sodas|juices|teas|coffees)/], ["Мясо, рыба, яйца", /^en:(meats|fishes|seafood|eggs|poultry)/],
    ["Крупы, хлеб, макароны", /^en:(cereals|breads|pastas|rices|groats)/], ["Овощи и фрукты", /^en:(fruits|vegetables|fresh-|mushrooms)/],
  ];
  function guessCat(name, tags){
    for (const [c, re] of TAG_CATS) if ((tags || []).some(t => re.test(t))) return c;
    const s = String(name || "").toLowerCase();
    for (const [c, re] of CAT_WORDS) if (re.test(s)) return c;
    return "Другое";
  }
  const catOf = f => CATS.includes(f.cat) ? f.cat : guessCat(f.name);
  const catSelect = (sel, id) => `<select ${id ? `id="${id}"` : 'name="cat"'}>${CATS.map(c => `<option${c === sel ? " selected" : ""}>${c}</option>`).join("")}</select>`;

  let foodCat = "";
  function renderFoods(){
    const q = $("foodQ").value.trim();
    const have = CATS.filter(c => foods.some(f => catOf(f) === c));
    if (foodCat && !have.includes(foodCat)) foodCat = "";
    $("foodCats").innerHTML = have.length > 1 ? ["", ...have].map(c => `<button class="chip${c === foodCat ? " on" : ""}" data-cat="${esc(c)}">${c || "Все"}</button>`).join("") : "";
    const list = foods.filter(f => (!q || match(f, q)) && (!foodCat || catOf(f) === foodCat));
    const missing = STARTER.filter(s => !foods.some(f => f.id === s.id)).length;
    const starterBtn = missing && !q && !foodCat ? `<button class="btn ghost" id="starterBtn">Добавить базовый набор (${missing} продуктов)</button>` : "";
    if (!list.length){
      $("foodList").innerHTML = `<div class="card"><div class="empty">${q || foodCat ? "Ничего не нашлось" : "Здесь будут сохранённые продукты. Найди продукт через «+» у приёма пищи, отсканируй штрихкод или добавь свой."}</div></div>` + starterBtn;
      return;
    }
    $("foodList").innerHTML = starterBtn + CATS.filter(c => list.some(f => catOf(f) === c)).map(c =>
      `<div class="cap">${c}</div><div class="card">${list.filter(f => catOf(f) === c).map(f => foodRow(f, `data-food="${esc(f.id)}"`)).join("")}</div>`).join("");
  }

  const saveFoods = msg => saveConf("foods.json", foods, msg);

  // after(f) — что делать после сохранения (например, сразу ввести порцию)
  function foodForm(f, after){
    const v = k => f && f[k] != null ? esc(f[k]) : "";
    const isNew = !f?.id;
    openSheet(`<h2>${isNew ? "Новый продукт" : "Продукт"}</h2>
      ${f?.code && isNew ? `<div class="hint">Штрихкод ${esc(f.code)}: ${f.name ? "в базе нет калорий" : "в базе не нашёлся"}. Впиши данные с упаковки — в следующий раз он найдётся сразу.</div>` : ""}
      <form id="foodForm">
        <label class="fld"><span>Название</span><input name="name" value="${v("name")}" placeholder="Творог 5%" required></label>
        <div class="grid2">
          <label class="fld"><span>Бренд</span><input name="brand" value="${v("brand")}" placeholder="необязательно"></label>
          <label class="fld"><span>Категория</span>${catSelect(f ? catOf(f) : "Другое")}</label>
        </div>
        <label class="fld"><span>Вес 1 шт, г</span><input name="pc" inputmode="decimal" value="${v("pc")}" placeholder="если штучный: банан ≈ 120"></label>
        <div class="hint">На 100 г</div>
        <div class="grid4">
          <label class="fld"><span>Ккал</span><input name="kcal" inputmode="decimal" value="${v("kcal")}" required></label>
          <label class="fld"><span>Б, г</span><input name="p" inputmode="decimal" value="${v("p")}"></label>
          <label class="fld"><span>Ж, г</span><input name="f" inputmode="decimal" value="${v("f")}"></label>
          <label class="fld"><span>У, г</span><input name="c" inputmode="decimal" value="${v("c")}"></label>
        </div>
        <button class="btn" type="submit">Сохранить</button>
        ${!isNew ? `<button class="btn danger" type="button" id="delFood">Удалить</button>` : ""}
      </form>`);
    const form = $("foodForm"), sel = form.elements.cat;
    let touched = !isNew;
    sel.onchange = () => touched = true;
    form.elements.name.oninput = e => { if (!touched) sel.value = guessCat(e.target.value); };
    form.onsubmit = e => {
      e.preventDefault();
      const fd = new FormData(form), n = k => r1(String(fd.get(k) ?? "").replace(",", "."));
      const out = {id: f?.id || newId("f"), name: String(fd.get("name")).trim(), brand: String(fd.get("brand")).trim(), cat: fd.get("cat"), kcal: n("kcal"), p: n("p"), f: n("f"), c: n("c")};
      if (n("pc") > 0) out.pc = n("pc");
      if (f?.code) out.code = f.code;
      if (!out.brand) delete out.brand;
      foods = isNew ? [out, ...foods] : foods.map(x => x.id === f.id ? out : x);
      renderFoods(); saveFoods((isNew ? "новый продукт: " : "продукт: ") + out.name);
      if (after) after(out); else closeSheet();
    };
    if (!isNew){
      const b = $("delFood");
      b.onclick = () => {
        if (!b.classList.contains("armed")){ b.classList.add("armed"); b.textContent = "Точно удалить?"; return; }
        foods = foods.filter(x => x.id !== f.id);
        closeSheet(); renderFoods(); saveFoods("удалён продукт: " + f.name);
      };
    }
  }

  // ---------- недавние (на этом устройстве) ----------
  const RKEY = "kcal_recent";
  const recent = () => { try { return JSON.parse(localStorage.getItem(RKEY)) || []; } catch { return []; } };
  function remember(it){
    const {id, meal, time, ...r} = it;
    localStorage.setItem(RKEY, JSON.stringify([r, ...recent().filter(x => x.name !== r.name)].slice(0, 12)));
  }
  function addItem(it, msg){
    remember(it);
    mutate(d => ({...d, items: [...d.items, it]}), msg || "добавлено: " + it.name);
  }

  // ---------- Open Food Facts ----------
  // база иногда отдаёт &quot; и т.п.; textarea раскодирует без выполнения разметки
  const unent = v => { const t = document.createElement("textarea"); t.innerHTML = String(v ?? ""); return t.value; };
  const OFF_FIELDS = "code,product_name,product_name_ru,brands,nutriments,categories_tags";
  function offMap(x){
    const n = x.nutriments || {};
    const name = unent(x.product_name_ru || x.product_name).trim();
    return {name, brand: unent(x.brands).split(",")[0].trim(), cat: guessCat(name, x.categories_tags), code: x.code,
      kcal: n["energy-kcal_100g"] != null ? r1(n["energy-kcal_100g"]) : null, p: r1(n.proteins_100g), f: r1(n.fat_100g), c: r1(n.carbohydrates_100g)};
  }
  // база ограничивает частоту запросов: 503 приходит без CORS и выглядит как обрыв сети — повторяем
  async function offFetch(u, sig){
    let r;
    for (let i = 0; i < 3; i++){
      try { r = await fetch(u, {signal: sig}); } catch (e){ if (e.name === "AbortError") throw e; r = null; }
      if (r && r.status !== 503 && r.status !== 429) break;
      await new Promise(ok => setTimeout(ok, 1000 * (i + 1)));
      if (sig?.aborted) throw new DOMException("", "AbortError");
    }
    if (!r) throw new Error("OFF сеть");
    return r;
  }
  let offCtl, offTimer;
  const offCache = new Map();
  async function offSearch(q){
    if (offCache.has(q)) return offCache.get(q);
    offCtl?.abort(); offCtl = new AbortController();
    const r = await offFetch("https://world.openfoodfacts.org/cgi/search.pl?" + new URLSearchParams({search_terms: q, search_simple: 1, json: 1, page_size: 40, fields: OFF_FIELDS}), offCtl.signal);
    if (!r.ok) throw new Error("OFF " + r.status);
    const out = ((await r.json()).products || []).map(offMap).filter(x => x.name && x.kcal != null);
    offCache.set(q, out);
    return out;
  }
  // -> продукт | null (нет в базе или нет калорий)
  async function offByCode(code){
    const r = await offFetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=${OFF_FIELDS}`);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error("OFF " + r.status);
    const j = await r.json();
    if (j.status !== 1 || !j.product) return null;
    const p = offMap({...j.product, code});
    return p.kcal == null ? {...p, kcal: undefined} : p;
  }

  function addSheet(meal){
    let off = [];
    const rec = recent();
    openSheet(`<h2>${esc(meal)}</h2>
      <div class="search-row"><input class="search" id="aq" type="search" placeholder="Ряженка, творог, банан…" autocomplete="off"><button class="round" id="ascan" aria-label="Сканировать штрихкод">${SCAN_ICON}</button></div>
      <div id="ares"></div>
      <button class="btn ghost" id="manual">Ввести вручную</button>`);
    const draw = st => {
      if (!$("aq")) return; // окно уже закрыли, а ответ базы пришёл позже
      const q = $("aq").value.trim();
      const mine = foods.filter(f => !q || match(f, q)).slice(0, q ? 30 : 8);
      let h = "";
      if (!q && rec.length) h += `<div class="cap">Недавние — нажми, чтобы повторить</div><div class="list">${rec.map((r, i) => `<button class="item" data-rec="${i}"><div class="nm"><div>${esc(r.name)}</div><small>${r.g ? fmt(r.g) + " г · " : ""}Б ${fmt(r.p)} · Ж ${fmt(r.f)} · У ${fmt(r.c)}</small></div><div class="kc">${fmt(r.kcal)}</div><span class="plus">${ICON_PLUS}</span></button>`).join("")}</div>`;
      if (mine.length) h += `<div class="cap">Мои продукты</div><div class="list">${mine.map(f => foodRow(f, `data-my="${esc(f.id)}"`)).join("")}</div>`;
      if (q.length >= 2) h += `<div class="cap">База Open Food Facts</div>` + (st === "load" ? `<div class="empty">Ищу…</div>`
        : st === "err" ? `<div class="empty">База не ответила. Попробуй ещё раз или введи вручную.</div>`
        : off.length ? `<div class="list">${off.map((f, i) => foodRow(f, `data-off="${i}"`)).join("")}</div>` : `<div class="empty">В базе не нашлось</div>`);
      if (!h) h = `<div class="empty">Начни вводить название или отсканируй штрихкод</div>`;
      $("ares").innerHTML = h;
    };
    draw();
    $("aq").oninput = () => {
      const q = $("aq").value.trim(); off = [];
      clearTimeout(offTimer); offCtl?.abort();
      draw(q.length >= 2 ? "load" : "");
      if (q.length >= 2) offTimer = setTimeout(() => offSearch(q).then(r => { off = r; draw(); }, e => { if (e.name !== "AbortError") draw("err"); }), 450);
    };
    $("ares").onclick = e => {
      const b = e.target.closest("[data-my],[data-off],[data-rec]"); if (!b) return;
      if (b.dataset.rec){
        closeSheet();
        return addItem({...rec[Number(b.dataset.rec)], id: newId("m"), meal, time: nowTime()}, "повтор: " + rec[Number(b.dataset.rec)].name);
      }
      if (b.dataset.my) portionSheet(foods.find(f => f.id === b.dataset.my), meal, false);
      else portionSheet(off[Number(b.dataset.off)], meal, true);
    };
    $("ascan").onclick = () => scanSheet(meal);
    $("manual").onclick = () => itemForm(null, meal);
  }

  function portionSheet(food, meal, fromBase){
    openSheet(`<h2>${esc(food.name)}</h2>
      <div class="hint">${food.brand ? esc(food.brand) + " · " : ""}на 100 г: ${per100(food)}</div>
      <label class="fld"><span>Сколько, г</span><input id="pg" inputmode="decimal" value="${food.pc || 100}"></label>
      ${food.pc ? `<div class="chips">${[1,2,3].map(n => `<button class="chip" data-n="${n}">${n} шт</button>`).join("")}</div>` : ""}
      <div class="res" id="pres"></div>
      ${fromBase ? `<label class="chk"><input type="checkbox" id="psave" checked> Сохранить в мои продукты</label>
        <label class="fld" id="pcatW"><span>Категория</span>${catSelect(food.cat || guessCat(food.name), "pcat")}</label>` : ""}
      <button class="btn" id="padd">Добавить в ${esc(meal.toLowerCase())}</button>`);
    const g = () => num(String($("pg").value).replace(",", "."));
    const calc = () => { const k = g() / 100; return {kcal: Math.round(food.kcal * k), p: r1(food.p * k), f: r1(food.f * k), c: r1(food.c * k)}; };
    const show = () => { const c = calc(); $("pres").innerHTML = `<b>${fmt(c.kcal)}</b> ккал · Б ${fmt(c.p,1)} · Ж ${fmt(c.f,1)} · У ${fmt(c.c,1)}`; };
    show(); $("pg").oninput = show;
    if (fromBase) $("psave").onchange = e => $("pcatW").hidden = !e.target.checked;
    $("sheetBody").querySelectorAll(".chip").forEach(b => b.onclick = () => { $("pg").value = r1(food.pc * b.dataset.n); show(); });
    $("padd").onclick = () => {
      if (!(g() > 0)) return $("pg").focus();
      let f = food;
      if (fromBase && $("psave").checked){
        f = {id: newId("f"), name: food.name, brand: food.brand, cat: $("pcat").value, kcal: food.kcal, p: food.p, f: food.f, c: food.c};
        if (food.code) f.code = food.code;
        if (!f.brand) delete f.brand;
        foods = [f, ...foods]; renderFoods(); saveFoods("новый продукт: " + f.name);
      }
      const out = {id: newId("m"), name: foodName(food), meal, time: nowTime(), g: r1(g()), ...calc()};
      if (f.id) out.food = f.id;
      closeSheet();
      addItem(out);
    };
  }

  // ---------- штрихкод ----------
  const SCAN_ICON = `<svg viewBox="0 0 24 24" class="ico"><path d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2M8 8v8M11 8v8M14 8v8M17 8v8"/></svg>`;
  let stopScan = null;
  // Safari не умеет BarcodeDetector — подгружаем полифил (zxing-wasm) только при первом сканировании
  let detP;
  const detector = () => detP ||= ("BarcodeDetector" in window
    ? Promise.resolve(window.BarcodeDetector)
    : import("https://cdn.jsdelivr.net/npm/barcode-detector@3.2.3/ponyfill/+esm").then(m => m.BarcodeDetector)
  ).then(BD => new BD({formats: ["ean_13", "ean_8", "upc_a", "upc_e"]})).catch(e => { detP = null; throw e; });

  function scanSheet(meal){
    meal ||= guessMeal();
    openSheet(`<h2>Штрихкод</h2>
      <div class="scan"><video id="sv" playsinline muted></video><div class="scan-frame"></div></div>
      <div class="hint" id="sst">Включаю камеру…</div>
      <form id="scode" class="search-row"><input class="search" name="code" inputmode="numeric" pattern="[0-9]{6,14}" placeholder="или введи цифры под штрихкодом" autocomplete="off"><button class="round add" aria-label="Найти">${ICON_ARROW}</button></form>`);
    let alive = true, stream = null, timer = null;
    stopScan = () => { alive = false; clearTimeout(timer); stream?.getTracks().forEach(t => t.stop()); stopScan = null; };
    const st = t => { if ($("sst")) $("sst").textContent = t; };
    $("scode").onsubmit = e => { e.preventDefault(); const c = String(new FormData(e.target).get("code")).replace(/\D/g, ""); if (c.length >= 6) found(c); };
    async function found(code){
      if (!alive) return;
      stopScan?.();
      const mine = foods.find(f => f.code === code);
      if (mine) return portionSheet(mine, meal, false);
      openSheet(`<h2>Штрихкод ${esc(code)}</h2><div class="empty">Ищу в базе…</div>`);
      let p = null;
      try { p = await offByCode(code); }
      catch { return openSheet(`<h2>Штрихкод ${esc(code)}</h2><div class="empty">База не ответила. Проверь интернет и попробуй ещё раз.</div><button class="btn" id="sretry">Повторить</button>`), $("sretry").onclick = () => { alive = true; found(code); }; }
      const done = f => portionSheet(f, meal, false);
      if (p && p.kcal != null) return portionSheet(p, meal, true);
      foodForm(p ? {...p, id: undefined} : {code}, done); // нет в базе или нет калорий — заполнить с упаковки
    }
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({video: {facingMode: "environment"}, audio: false});
        if (!alive) return stopScanTracks();
        const v = $("sv"); v.srcObject = stream; await v.play();
        st("Наведи камеру на штрихкод");
        const det = await detector();
        const tick = async () => {
          if (!alive) return;
          try { const r = await det.detect(v); if (r[0]?.rawValue) return found(r[0].rawValue); } catch {}
          timer = setTimeout(tick, 200);
        };
        tick();
      } catch (e){
        st(e?.name === "NotAllowedError" ? "Нет доступа к камере. Разреши камеру для приложения или введи цифры вручную." : "Камера недоступна. Введи цифры под штрихкодом.");
      }
    })();
    function stopScanTracks(){ stream?.getTracks().forEach(t => t.stop()); }
  }

  function mealSheet(m){
    const list = (day.items || []).filter(it => (MEALS.includes(it.meal) ? it.meal : "Перекус") === m).sort((a,b) => String(a.time||"").localeCompare(String(b.time||"")));
    openSheet(`<h2>${m}</h2>
      <div id="mlist">${list.length ? list.map(it => `<div class="swipe"><button class="del" data-del="${esc(it.id)}">Удалить</button><button class="item" data-id="${esc(it.id)}"><div class="nm"><div>${esc(it.name || "Без названия")}</div><small>${it.g?fmt(it.g)+" г · ":""}Б ${fmt(it.p)} · Ж ${fmt(it.f)} · У ${fmt(it.c)}${it.time?" · "+esc(it.time):""}</small></div><div class="kc">${fmt(it.kcal)}</div></button></div>`).join("") : `<div class="empty">Пока пусто</div>`}</div>
      <div class="hint">Смахни блюдо влево, чтобы удалить</div>
      <button class="btn" id="madd">Добавить</button>`);
    $("mlist").onclick = e => {
      const del = e.target.closest("[data-del]");
      if (del){
        const it = day.items.find(x => x.id === del.dataset.del);
        mutate(d => ({...d, items: d.items.filter(x => x.id !== del.dataset.del)}), "удалено: " + (it?.name || ""));
        return mealSheet(m);
      }
      const row = e.target.closest(".swipe");
      if (row?.classList.contains("open")) return row.classList.remove("open"); // тап по открытой строке — закрыть
      const b = e.target.closest(".item"); if (b) itemDetails(b.dataset.id);
    };
    swipeRows($("mlist"));
    $("madd").onclick = () => addSheet(m);
  }

  // смахивание строк влево открывает кнопку «Удалить»
  function swipeRows(root){
    let row = null, x0 = 0, y0 = 0, dx = 0, horiz = null;
    root.addEventListener("touchstart", e => {
      row = e.target.closest(".swipe"); if (!row) return;
      root.querySelectorAll(".swipe.open").forEach(r => r !== row && r.classList.remove("open"));
      x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dx = 0; horiz = null;
    }, {passive: true});
    root.addEventListener("touchmove", e => {
      if (!row) return;
      const mx = e.touches[0].clientX - x0, my = e.touches[0].clientY - y0;
      if (horiz === null && Math.abs(mx) + Math.abs(my) > 8) horiz = Math.abs(mx) > Math.abs(my);
      if (!horiz) return;
      dx = Math.max(-96, Math.min(0, mx + (row.classList.contains("open") ? -96 : 0)));
      row.querySelector(".item").style.transform = `translateX(${dx}px)`; row.classList.add("drag");
    }, {passive: true});
    root.addEventListener("touchend", () => {
      if (!row) return;
      if (horiz){ row.classList.toggle("open", dx < -48); row.querySelector(".item").style.transform = ""; row.classList.remove("drag"); }
      row = null;
    });
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
  // лента дней: выбранный всегда в центре, по 3 дня слева и справа
  const weekDays = () => Array.from({length:7}, (_, i) => addDays(cur, i - 3));
  let stripAt = null;
  function renderWeek(){
    const t = todayIso(), strip = $("week");
    const shift = stripAt && stripAt !== cur ? Math.sign(parseIso(cur) - parseIso(stripAt)) : 0;
    stripAt = cur;
    strip.innerHTML = weekDays().map((d, i) => {
      const k = totals(d === cur ? day.items : weekDocs[d]?.items).kcal;
      const pct = Math.min(k / Math.max(goals.kcal,1), 1);
      const col = k > goals.kcal * 1.05 ? "rgba(255,69,58,.55)" : "rgba(255,255,255,.42)"; // прошлые дни приглушены, акцент — на выбранном
      const wd = parseIso(d).toLocaleDateString("ru-RU", {weekday:"short"});
      return `<button class="day d${Math.abs(i - 3)}${d===cur?" sel":""}${d===t?" today":""}" data-d="${d}" aria-label="${esc(ruDate(d))}"${d===cur?' aria-current="date"':""}><svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="18" fill="none" stroke="var(--soft)" stroke-width="2.5"/><circle cx="20" cy="20" r="18" fill="none" stroke="${col}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="113.1" stroke-dashoffset="${113.1 * (1 - pct)}"/></svg>${esc(wd)}</button>`;
    }).join("");
    // сдвиг как у слайдера: лента приезжает с той стороны, откуда пришёл день
    if (shift){
      strip.style.transition = "none"; strip.style.transform = `translateX(${shift * strip.offsetWidth / 7}px)`;
      strip.offsetWidth; // применить стартовое положение до анимации
      strip.style.transition = ""; strip.style.transform = "";
    }
  }

  // ---------- data ----------
  const dayPath = d => `days/${d}.json`;

  async function loadDay(quiet){
    const d = cur;
    if (!quiet) $("app").classList.add("loading");
    try {
      const r = await Store.read(dayPath(d));
      if (d !== cur) return;
      day = {...blank(d), ...(r?.data || {})};
      setStatus(""); render();
    } catch (e){ fail("Не загрузилось", e); }
    finally { if (d === cur) $("app").classList.remove("loading"); }
    const others = weekDays().filter(x => x !== d && x <= todayIso());
    const docs = await Promise.all(others.map(x => Store.read(dayPath(x)).then(r => r?.data, () => null)));
    if (d !== cur) return;
    others.forEach((x, i) => { if (docs[i]) weekDocs[x] = docs[i]; });
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
  function openSheet(html){ stopScan?.(); const sb = $("sheetBody"); sb.innerHTML = html; sb.classList.remove("swap"); sb.offsetWidth; sb.classList.add("swap"); $("scrim").classList.add("on"); $("sheet").classList.add("on"); }
  function closeSheet(){ stopScan?.(); $("scrim").classList.remove("on"); $("sheet").classList.remove("on"); $("sheet").style.transform = ""; }
  (() => {
    const sh = $("sheet"); let y0 = null, dy = 0;
    sh.addEventListener("touchstart", e => { y0 = sh.scrollTop <= 0 && !e.target.closest(".swipe") ? e.touches[0].clientY : null; dy = 0; }, {passive: true});
    sh.addEventListener("touchmove", e => {
      if (y0 === null) return;
      dy = e.touches[0].clientY - y0;
      if (dy > 0){ sh.style.transition = "none"; sh.style.transform = `translateY(${dy}px)`; }
    }, {passive: true});
    sh.addEventListener("touchend", () => {
      if (y0 === null) return;
      sh.style.transition = ""; y0 = null;
      if (dy > 110) closeSheet(); else sh.style.transform = "";
    });
  })();
  (() => {
    let y0 = null, dy = 0; const ptr = $("ptr");
    addEventListener("touchstart", e => { y0 = $("scroller").scrollTop <= 0 && !$("sheet").classList.contains("on") && !$("app").hidden ? e.touches[0].clientY : null; dy = 0; }, {passive: true});
    addEventListener("touchmove", e => {
      if (y0 === null) return;
      dy = Math.max(0, e.touches[0].clientY - y0);
      ptr.style.opacity = Math.min(1, dy / 80); ptr.style.transform = `translate(-50%, ${Math.min(dy, 90) * .5}px) rotate(${dy * 3}deg)`;
    }, {passive: true});
    addEventListener("touchend", async () => {
      if (y0 === null) return;
      y0 = null;
      if (dy > 80 && !inflight){ ptr.classList.add("spin"); await loadDay(true); }
      ptr.classList.remove("spin"); ptr.style.opacity = 0; ptr.style.transform = "";
    });
  })();
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
      if (!it) remember(out);
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
        <button class="btn ghost" type="button" id="hardUpdate">Обновить приложение</button>
        <div class="hint" style="text-align:center;margin-top:10px">Версия ${VERSION}</div>
      </form>`);
    $("logout").onclick = () => { closeSheet(); Store.clearToken(); showSetup(); };
    // аварийный выход, если иконка на экране «Домой» застряла на старой версии
    $("hardUpdate").onclick = async () => {
      const regs = await navigator.serviceWorker?.getRegistrations?.() || [];
      await Promise.all(regs.map(r => r.unregister()));
      if (window.caches) await Promise.all((await caches.keys()).map(k => caches.delete(k)));
      location.replace(location.pathname + "?u=" + Date.now());
    };
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
  function go(d){ weekDocs[cur] = day; cur = d; day = weekDocs[d] ? {...blank(d), ...weekDocs[d]} : blank(d); pendingWater = null; render(); loadDay(); }
  $("prev").onclick = () => go(addDays(cur,-1));
  $("next").onclick = () => go(addDays(cur,1));
  // смахнуть ленту дней влево/вправо — следующий/предыдущий день
  (() => { let x0 = null;
    $("week").addEventListener("touchstart", e => { x0 = e.touches[0].clientX; }, {passive: true});
    $("week").addEventListener("touchend", e => { if (x0 === null) return; const dx = e.changedTouches[0].clientX - x0; x0 = null;
      if (Math.abs(dx) > 40) go(addDays(cur, dx < 0 ? 1 : -1)); });
  })();
  $("dateLbl").onclick = () => go(todayIso());
  $("wForm").onsubmit = e => {
    e.preventDefault();
    const v = Math.round(num($("wIn").value)) || 250; // пусто = стакан 250 мл
    $("wIn").value = ""; $("wIn").blur();
    if (v > 0 && v <= 5000) bumpWater(v);
  };
  $("wMinus").onclick = () => bumpWater(-250);
  $("newFood").onclick = () => foodForm(null);
  $("foodQ").oninput = renderFoods;
  // лента категорий: своя горизонтальная прокрутка — упирается в края без «резинки», вертикальный жест уходит странице
  (() => { const el = $("foodCats"); let x0 = null, y0 = 0, s0 = 0, horiz = null;
    el.addEventListener("touchstart", e => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; s0 = el.scrollLeft; horiz = null; }, {passive: true});
    el.addEventListener("touchmove", e => {
      if (x0 === null) return;
      const dx = e.touches[0].clientX - x0, dy = e.touches[0].clientY - y0;
      if (horiz === null && Math.abs(dx) + Math.abs(dy) > 6) horiz = Math.abs(dx) > Math.abs(dy);
      if (horiz) el.scrollLeft = s0 - dx; // браузер сам ограничит 0…max
    }, {passive: true});
    el.addEventListener("touchend", () => { x0 = null; }, {passive: true});
  })();
  $("foodCats").onclick = e => { const b = e.target.closest("[data-cat]"); if (b){ foodCat = b.dataset.cat; renderFoods(); } };
  $("scanBtn").onclick = () => scanSheet();
  $("foodList").onclick = e => { if (e.target.closest("#starterBtn")) return addStarter(); const b = e.target.closest("[data-food]"); if (b) foodForm(foods.find(f => f.id === b.dataset.food)); };
  $("mealSum").onclick = e => {
    const a = e.target.closest("[data-add]"); if (a) return addSheet(a.dataset.add);
    const r = e.target.closest(".ms"); if (r) mealSheet(r.dataset.meal);
  };
  // подложка выбранной вкладки переезжает к нажатой (сама анимация — в CSS)
  const movePill = b => { const p = $("tabPill"); p.style.width = b.offsetWidth + "px"; p.style.transform = `translateX(${b.offsetLeft}px)`; };
  // смена вкладки: текущая мягко гаснет, затем новая мягко проявляется (без резкого исчезновения)
  let tabTimer;
  $("tabbar").onclick = e => {
    const b = e.target.closest("button"); if (!b || b.classList.contains("on")) return;
    document.querySelectorAll("#tabbar button").forEach(x => x.classList.toggle("on", x === b));
    movePill(b);
    const cur = document.querySelector("section[data-tab]:not([hidden])");
    cur?.classList.add("leaving");
    clearTimeout(tabTimer);
    tabTimer = setTimeout(() => {
      document.querySelectorAll("section[data-tab]").forEach(x => { x.classList.remove("leaving"); x.hidden = x.dataset.tab !== b.dataset.tab; });
      $("scroller").scrollTop = 0;
    }, matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 140);
  };
  new ResizeObserver(() => { const b = document.querySelector("#tabbar button.on"); if (b) movePill(b); }).observe($("tabbar"));
  $("settingsBtn").onclick = settingsSheet;
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
    $("app").classList.add("loading"); render();
    try {
      let s = await Store.read("settings.json");
      if (!s) await Store.update("settings.json", () => DEFAULT_GOALS, "начальные цели");
      else goals = {...DEFAULT_GOALS, ...s.data, micro: {...DEFAULT_GOALS.micro, ...(s.data.micro || {})}};
      let su = await Store.read("supplements.json");
      if (!su) await Store.update("supplements.json", () => sups, "добавки");
      else sups = su.data;
      const fo = await Store.read("foods.json");
      if (fo) foods = fo.data;
      else { foods = [...STARTER]; await Store.update("foods.json", () => foods, "базовые продукты"); }
    } catch (e){ return fail("Не загрузилось", e); }
    render(); loadDay();
  }

  $("scroller").addEventListener("scroll", e => document.documentElement.classList.toggle("scrolled", e.target.scrollTop > 4), {passive: true});

  // записи с компьютера (Claude) подхватываются при каждом возврате в приложение
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && Store.hasToken() && !inflight && pendingWater == null) loadDay(true);
  });

  if ("serviceWorker" in navigator && location.protocol === "https:"){
    // пришла новая версия — перезагрузить один раз (при первой установке контроллера ещё нет)
    if (navigator.serviceWorker.controller) navigator.serviceWorker.addEventListener("controllerchange", () => location.reload(), {once: true});
    navigator.serviceWorker.register("sw.js", {updateViaCache: "none"});
  }
  boot();
})();
