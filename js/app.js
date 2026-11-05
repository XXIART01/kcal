(() => {
  // ---------- constants ----------
  const VERSION = 36;
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
  let combos = []; // мои блюда: {id, name, items:[порции без id/meal/time]}
  let foods = []; // мои продукты: {id, name, brand, kcal, p, f, c — на 100 г, pc — вес 1 шт в г}
  let weekDocs = {};
  let pendingWater = null, waterTimer = null;
  let inflight = 0;

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
    renderCur();
  }

  const r1 = v => Math.round(num(v) * 10) / 10;
  const per100 = f => `${fmt(f.kcal)} ккал · Б ${fmt(f.p,1)} · Ж ${fmt(f.f,1)} · У ${fmt(f.c,1)}`;
  const foodName = f => f.brand ? `${f.name}, ${f.brand}` : f.name;
  // все слова запроса есть в названии или бренде
  const match = (f, q) => { const h = (f.name + " " + (f.brand || "")).toLowerCase(); return q.toLowerCase().split(/\s+/).every(w => h.includes(w)); };
  const STAR = `<svg viewBox="0 0 24 24" class="ico" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z"/></svg>`;
  // строка «Моих продуктов» со звёздочкой «в избранное» справа
  const favRow = f => `<div class="frow">${foodRow(f, `data-food="${esc(f.id)}"`)}<button class="star${f.fav ? " on" : ""}" data-star="${esc(f.id)}" aria-pressed="${!!f.fav}" aria-label="${f.fav ? "Убрать из избранного" : "В избранное"}">${STAR}</button></div>`;
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
    if (foodCat && foodCat !== "fav" && !have.includes(foodCat)) foodCat = "";
    const favs = foods.some(f => f.fav);
    if (foodCat === "fav" && !favs) foodCat = "";
    $("foodCats").innerHTML = have.length > 1 || favs ? ["", ...(favs ? ["fav"] : []), ...have].map(c => `<button class="chip${c === foodCat ? " on" : ""}" data-cat="${esc(c)}">${c === "fav" ? "★ Избранное" : c || "Все"}</button>`).join("") : "";
    const list = foods.filter(f => (!q || match(f, q)) && (!foodCat || (foodCat === "fav" ? f.fav : catOf(f) === foodCat)));
    const missing = STARTER.filter(s => !foods.some(f => f.id === s.id)).length;
    const starterBtn = missing && !q && !foodCat ? `<button class="btn ghost" id="starterBtn">Добавить базовый набор (${missing} продуктов)</button>` : "";
    if (!list.length){
      $("foodList").innerHTML = `<div class="card"><div class="empty">${q || foodCat ? "Ничего не нашлось" : "Здесь будут сохранённые продукты. Найди продукт через «+» у приёма пищи, отсканируй штрихкод или добавь свой."}</div></div>` + starterBtn;
      return;
    }
    // во «Все» избранное — отдельной группой сверху; в категориях избранное первым
    const group = (title, arr) => `<div class="cap">${title}</div><div class="card">${arr.map(favRow).join("")}</div>`;
    const sortFav = arr => byUse(arr).sort((a, b) => !!b.fav - !!a.fav);
    $("foodList").innerHTML = foodCat === "fav" ? group("★ Избранное", byUse(list))
      : starterBtn + (!foodCat && !q && favs ? group("★ Избранное", byUse(list.filter(f => f.fav))) : "")
        + CATS.filter(c => list.some(f => catOf(f) === c)).map(c => group(c, sortFav(list.filter(f => catOf(f) === c)))).join("");
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
        <div class="grid2">
          <label class="fld"><span>Порция</span><select name="pcName">${PORTIONS.map(p => `<option${p === (f?.pcName || "штука") ? " selected" : ""}>${p}</option>`).join("")}</select></label>
          <label class="fld"><span>Вес порции, г</span><input name="pc" inputmode="decimal" value="${v("pc")}" placeholder="пачка чипсов ≈ 140"></label>
        </div>
        <div class="hint">На 100 г</div>
        <div class="grid4">
          <label class="fld"><span>Ккал</span><input name="kcal" inputmode="decimal" value="${v("kcal")}" required></label>
          <label class="fld"><span>Б, г</span><input name="p" inputmode="decimal" value="${v("p")}"></label>
          <label class="fld"><span>Ж, г</span><input name="f" inputmode="decimal" value="${v("f")}"></label>
          <label class="fld"><span>У, г</span><input name="c" inputmode="decimal" value="${v("c")}"></label>
        </div>
        ${!after ? `<button class="btn" type="submit" data-then="add">Сохранить и добавить в день</button>` : ""}
        <button class="btn${!after ? " ghost" : ""}" type="submit">Сохранить</button>
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
      if (n("pc") > 0){ out.pc = n("pc"); if (fd.get("pcName") !== "штука") out.pcName = fd.get("pcName"); }
      if (f?.code) out.code = f.code;
      if (!out.brand) delete out.brand;
      foods = isNew ? [out, ...foods] : foods.map(x => x.id === f.id ? out : x);
      renderFoods(); saveFoods((isNew ? "новый продукт: " : "продукт: ") + out.name);
      if (after) after(out);
      else if (e.submitter?.dataset.then === "add") portionSheet(out, null, false);
      else closeSheet();
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
  const UKEY = "kcal_usage";
  const usage = () => { try { return JSON.parse(localStorage.getItem(UKEY)) || {}; } catch { return {}; } };
  const useN = (u, id) => typeof u[id] === "number" ? u[id] : u[id]?.n || 0;
  const lastG = id => usage()[id]?.g; // сколько граммов брали в прошлый раз
  // items — порции [{food, g}] или id продуктов
  const bumpUsage = list => { const u = usage(); list.forEach(x => { const id = x?.food ?? x; if (!id) return; u[id] = {...(typeof u[id] === "object" ? u[id] : {}), n: useN(u, id) + 1, g: x?.g ?? u[id]?.g}; }); localStorage.setItem(UKEY, JSON.stringify(u)); };
  // частые — первыми, при равенстве — прежний порядок
  const byUse = list => { const u = usage(); return list.map((f, i) => [f, i]).sort((a, b) => useN(u, b[0].id) - useN(u, a[0].id) || a[1] - b[1]).map(x => x[0]); };
  const frequent = () => { const u = usage(); return byUse(foods.filter(f => useN(u, f.id) > 0)).slice(0, 20); };
  // порция продукта: на сколько граммов и что получится
  const portionOf = (f, g) => { const k = g / 100; return {kcal: Math.round(f.kcal * k), p: r1(f.p * k), f: r1(f.f * k), c: r1(f.c * k)}; };
  const defaultG = f => lastG(f.id) || f.pc || 100;

  // добавить сразу несколько порций в приём (моё блюдо, «как вчера»)
  function addMany(list, meal, label){
    const items = list.map(x => { const {id, meal: _m, time, ...r} = x; return {...r, id: newId("m"), meal, time: nowTime()}; });
    if (!items.length) return;
    bumpUsage(items);
    const kcal = items.reduce((s, x) => s + num(x.kcal), 0);
    mutate({t: "puts", items}, `добавлено (${label}): ${items.map(x => x.name).join(", ")}`);
    toast(`${label} → ${meal.toLowerCase()} · ${fmt(kcal)} ккал`, "Отменить", () => mutate({t: "dels", ids: items.map(x => x.id)}, "отменено: " + label));
  }

  function addItem(it, msg){
    remember(it); bumpUsage([it]);
    toast(`Добавлено в ${String(it.meal).toLowerCase()} · ${fmt(it.kcal)} ккал`, "Отменить", () => mutate({t: "del", id: it.id}, "отменено: " + it.name));
    mutate({t: "put", item: it}, msg || "добавлено: " + it.name);
  }

  // ---------- Open Food Facts ----------
  // база иногда отдаёт &quot; и т.п.; textarea раскодирует без выполнения разметки
  const unent = v => { const t = document.createElement("textarea"); t.innerHTML = String(v ?? ""); return t.value; };
  const OFF_FIELDS = "code,product_name,product_name_ru,brands,nutriments,categories_tags,serving_quantity,product_quantity,quantity";
  function offMap(x){
    const n = x.nutriments || {};
    let name = unent(x.product_name_ru || x.product_name).trim().replace(/\s+/g, " ");
    name = name.charAt(0).toUpperCase() + name.slice(1); // в базе названия пишут люди, часто строчными
    return {name, brand: unent(x.brands).split(",")[0].trim(), cat: guessCat(name, x.categories_tags), code: x.code,
      kcal: n["energy-kcal_100g"] != null ? r1(n["energy-kcal_100g"]) : null, p: r1(n.proteins_100g), f: r1(n.fat_100g), c: r1(n.carbohydrates_100g),
      ...offPortion(x)};
  }
  // вес упаковки: product_quantity или текст quantity («140», «0.14» кг, «70г», «0,5 л»)
  function packGrams(x){
    if (num(x.product_quantity) > 0) return num(x.product_quantity);
    const m = String(x.quantity || "").replace(",", ".").match(/^\s*([\d.]+)\s*(кг|kg|гр|г|g|л|l|мл|ml)?\.?\s*$/i); // только «число + единица», «1pcs» не считается
    if (!m) return 0;
    const v = num(m[1]), u = (m[2] || "").toLowerCase();
    return u === "кг" || u === "kg" || u === "л" || u === "l" || (!u && v < 5) ? v * 1000 : v; // голое «0.14» — это килограммы
  }
  // порция по умолчанию: вся упаковка (до 1 кг), иначе порция производителя, если она не формальные 100 г
  function offPortion(x){
    const q = packGrams(x), s = num(x.serving_quantity);
    if (q >= 10 && q <= 1000) return {pc: r1(q), pcName: "упаковка"};
    if (s > 0 && s !== 100 && s < 1000) return {pc: r1(s), pcName: "порция"};
    return {};
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
    curAddMeal = meal;
    openSheet(`<h2>${esc(meal)}</h2>
      <div id="acur"></div>
      <div class="search-row"><input class="search" id="aq" type="search" placeholder="Ряженка, творог, банан…" autocomplete="off"><button class="round" id="ascan" aria-label="Сканировать штрихкод">${SCAN_ICON}</button></div>
      <div class="chips scroll" id="asec"></div>
      <div id="ares"></div>
      <button class="btn ghost" id="manual">Ввести вручную</button>`);
    // раздел по умолчанию: избранное, иначе недавние, иначе все
    let sec = frequent().length ? "freq" : foods.some(f => f.fav) ? "fav" : rec.length ? "rec" : "all";
    const drawSecs = () => {
      const cats = CATS.filter(c => foods.some(f => catOf(f) === c));
      const list = [...(frequent().length ? [["freq", "Частые"]] : []), ...(foods.some(f => f.fav) ? [["fav", "★ Избранное"]] : []), ...(rec.length ? [["rec", "Недавние"]] : []),
        ...(combos.length ? [["combos", "Мои блюда"]] : []), ["all", "Все"], ...cats.map(c => [c, c])];
      $("asec").innerHTML = list.map(([k, t]) => `<button class="chip${k === sec ? " on" : ""}" data-sec="${esc(k)}">${esc(t)}</button>`).join("");
      $("asec").hidden = !!$("aq").value.trim(); // при поиске разделы не нужны — ищем везде
    };
    hscroll($("asec"));
    $("asec").onclick = e => { const b = e.target.closest("[data-sec]"); if (!b) return; sec = b.dataset.sec; drawSecs(); draw(); };
    // строка продукта: нажатие — выбрать граммы; «+» справа — добавить сразу прошлой порцией (окно не закрывается)
    const quickRow = f => { const g = defaultG(f), c = portionOf(f, g);
      return `<div class="frow">${`<button class="item" data-my="${esc(f.id)}"><div class="nm"><div>${f.fav ? "★ " : ""}${esc(f.name)}</div><small>${fmt(g)} г · ${fmt(c.kcal)} ккал · Б ${fmt(c.p)} · Ж ${fmt(c.f)} · У ${fmt(c.c)}</small></div></button>`}<button class="qadd" data-q="${esc(f.id)}" aria-label="Добавить ${esc(f.name)} ${fmt(g)} г">${ICON_PLUS}</button></div>`; };
    const draw = st => {
      if (!$("aq")) return; // окно уже закрыли, а ответ базы пришёл позже
      const q = $("aq").value.trim();
      const recRow = (r, i) => `<button class="item" data-rec="${i}"><div class="nm"><div>${esc(r.name)}</div><small>${r.g ? fmt(r.g) + " г · " : ""}Б ${fmt(r.p)} · Ж ${fmt(r.f)} · У ${fmt(r.c)}</small></div><div class="kc">${fmt(r.kcal)}</div><span class="plus">${ICON_PLUS}</span></button>`;
      let h = "";
      if (!q){
        // без поиска — «Как вчера» сверху и выбранный раздел
        const yItems = (weekDocs[addDays(cur, -1)]?.items || []).filter(x => (MEALS.includes(x.meal) ? x.meal : "Перекус") === meal);
        if (yItems.length) h += `<button class="quick" id="ayest"><span><b>Как вчера</b><small>${esc(yItems.map(x => x.name).join(", "))}</small></span><i>${fmt(yItems.reduce((s, x) => s + num(x.kcal), 0))} ккал</i></button>`;
        const sel = sec === "freq" ? frequent() : sec === "fav" ? byUse(foods.filter(f => f.fav)) : sec === "all" ? byUse(foods) : CATS.includes(sec) ? byUse(foods.filter(f => catOf(f) === sec)).sort((a, b) => !!b.fav - !!a.fav) : null;
        if (sec === "rec") h += rec.length ? `<div class="list">${rec.map(recRow).join("")}</div>` : `<div class="empty">Пока нет недавних</div>`;
        else if (sec === "combos") h += `<div class="list" id="acombos">${combos.map(c => `<div class="swipe"><button class="del" data-cdel="${esc(c.id)}">Удалить</button><button class="item" data-combo="${esc(c.id)}"><div class="nm"><div>${esc(c.name)}</div><small>${esc(c.items.map(x => x.name).join(", "))}</small></div><div class="kc">${fmt(c.items.reduce((s, x) => s + num(x.kcal), 0))}</div><span class="plus">${ICON_PLUS}</span></button></div>`).join("") || `<div class="empty">Нет сохранённых блюд</div>`}</div>`;
        else h += sel.length ? `<div class="list">${sel.map(quickRow).join("")}</div>` : `<div class="empty">Здесь пусто</div>`;
      }
      const mine = q ? foods.filter(f => match(f, q)).slice(0, 30) : [];
      if (mine.length) h += `<div class="cap">Мои продукты</div><div class="list">${mine.map(quickRow).join("")}</div>`;
      if (q.length >= 2) h += `<div class="cap">База Open Food Facts</div>` + (st === "load" ? `<div class="empty">Ищу…</div>`
        : st === "err" ? `<div class="empty">База не ответила. Попробуй ещё раз или введи вручную.</div>`
        : off.length ? `<div class="list">${off.map((f, i) => foodRow(f, `data-off="${i}"`)).join("")}</div>` : `<div class="empty">В базе не нашлось</div>`);
      if (!h) h = `<div class="empty">Начни вводить название или отсканируй штрихкод</div>`;
      $("ares").innerHTML = h; drawSecs(); renderCur();
      if ($("acombos")) swipeRows($("acombos"));
    };
    draw();
    $("aq").oninput = () => {
      const q = $("aq").value.trim(); off = [];
      clearTimeout(offTimer); offCtl?.abort();
      draw(q.length >= 2 ? "load" : "");
      if (q.length >= 2) offTimer = setTimeout(() => offSearch(q).then(r => { off = r; draw(); }, e => { if (e.name !== "AbortError") draw("err"); }), 450);
    };
    $("ares").onclick = e => {
      const qa = e.target.closest("[data-q]");
      if (qa){
        const f = foods.find(x => x.id === qa.dataset.q), g = defaultG(f);
        addItem({id: newId("m"), name: foodName(f), meal, time: nowTime(), g, ...portionOf(f, g), food: f.id});
        qa.classList.add("done"); setTimeout(() => qa.classList.remove("done"), 700);
        return;
      }
      if (e.target.closest("#ayest")){ return addMany((weekDocs[addDays(cur, -1)]?.items || []).filter(x => (MEALS.includes(x.meal) ? x.meal : "Перекус") === meal), meal, "Как вчера"); }
      const cd = e.target.closest("[data-cdel]");
      if (cd){ const c = combos.find(x => x.id === cd.dataset.cdel); combos = combos.filter(x => x.id !== cd.dataset.cdel); saveConf("combos.json", combos, "удалено блюдо: " + (c?.name || "")); return draw(); }
      const row = e.target.closest(".swipe.open"); if (row) return row.classList.remove("open");
      const cb = e.target.closest("[data-combo]");
      if (cb){ const c = combos.find(x => x.id === cb.dataset.combo); return addMany(c.items, meal, c.name); }
      const b = e.target.closest("[data-my],[data-off],[data-rec]"); if (!b) return;
      if (b.dataset.rec){
        return addItem({...rec[Number(b.dataset.rec)], id: newId("m"), meal, time: nowTime()}, "повтор: " + rec[Number(b.dataset.rec)].name);
      }
      if (b.dataset.my) portionSheet(foods.find(f => f.id === b.dataset.my), meal, false);
      else portionSheet(off[Number(b.dataset.off)], meal, true);
    };
    $("ascan").onclick = () => scanSheet(meal);
    $("manual").onclick = () => itemForm(null, meal);
  }

  // блок «Сколько»: граммы или штуки (порции). В штуках вес 1 шт берётся из продукта или вводится тут же
  const unitPref = id => usage()[id]?.u;
  const PORTIONS = ["штука", "порция", "пачка", "упаковка", "стакан", "кусок", "ложка"];
  const pcLabel = f => f.pcName || "штука";
  function amountBox(food, startG, onChange){
    let unit = (unitPref(food.id) === "pc" && food.pc) ? "pc" : "g";
    let pc = num(food.pc) || 0;
    const html = `<div class="chips seg two" id="aunit"><button class="chip" data-u="g">Граммы</button><button class="chip" data-u="pc">Порции</button></div>
      <div class="amt-row"><label class="fld"><span id="alab"></span><input id="pg" inputmode="decimal"></label>
        <label class="fld" id="apcw"><span>Вес 1 порции, г</span><input id="apc" inputmode="decimal" placeholder="напр. 134"></label></div>
      <div class="chips" id="aquick"></div>
      <div class="hint" id="anote"></div>`;
    const val = () => num(String($("pg").value).replace(",", "."));
    const grams = () => unit === "g" ? val() : val() * pc;
    const paint = () => {
      $("aunit").querySelectorAll(".chip").forEach(b => b.classList.toggle("on", b.dataset.u === unit));
      const nm = pcLabel(food);
      $("alab").textContent = unit === "g" ? "Сколько, г" : (nm === "штука" ? "Сколько, шт" : `Сколько (${nm})`);
      $("apcw").hidden = unit === "g" || !!food.pc; // вес порции спрашиваем, только если он неизвестен
      $("aquick").innerHTML = unit === "pc" ? [0.5, 1, 2, 3].map(n => `<button class="chip" data-n="${n}">${n === 0.5 ? "½" : n}</button>`).join("")
        : (pc ? [1, 2].map(n => `<button class="chip" data-n="${n}">${n} ${esc(nm)} · ${fmt(pc * n)} г</button>`).join("") : "");
      $("anote").textContent = unit === "pc" ? (pc ? `${fmt(val(), 1)} × ${nm} ${fmt(pc)} г = ${fmt(grams())} г` : "Укажи вес одной порции — дальше считай порциями") : "";
      onChange();
    };
    const bind = () => {
      $("pg").value = unit === "g" ? r1(startG) : (pc ? r1(startG / pc) : 1);
      $("aunit").onclick = e => { const b = e.target.closest("[data-u]"); if (!b || b.dataset.u === unit) return;
        const g0 = grams(); unit = b.dataset.u;
        $("pg").value = unit === "g" ? r1(g0 || 100) : (pc ? r1(g0 / pc) || 1 : 1); paint(); };
      $("aquick").onclick = e => { const b = e.target.closest("[data-n]"); if (!b) return;
        $("pg").value = unit === "pc" ? b.dataset.n : r1(pc * b.dataset.n); paint(); };
      $("pg").oninput = paint;
      $("apc").oninput = () => { pc = num(String($("apc").value).replace(",", ".")); paint(); };
      paint();
    };
    return {html, bind, grams, unit: () => unit, pcs: () => unit === "pc" ? r1(val()) : null, pc: () => pc};
  }
  // вес штуки, введённый при добавлении, запоминаем в продукте; единицу — на телефоне
  function rememberUnit(food, box){
    const u = usage(); if (food.id){ u[food.id] = {...(typeof u[food.id] === "object" ? u[food.id] : {n: useN(u, food.id)}), u: box.unit()}; localStorage.setItem(UKEY, JSON.stringify(u)); }
    if (box.unit() === "pc" && box.pc() && !food.pc && food.id){
      foods = foods.map(f => f.id === food.id ? {...f, pc: box.pc()} : f); food.pc = box.pc();
      renderFoods(); saveFoods("вес 1 шт: " + food.name);
    }
  }

  function portionSheet(food, meal, fromBase){
    const pick = !meal; // пришли из «Моих продуктов»: приём выбирается здесь
    meal ||= guessMeal();
    const dayName = cur === todayIso() ? "сегодня" : ruDate(cur);
    const box = amountBox(food, food.id ? defaultG(food) : food.pc || 100, () => show());
    openSheet(`<h2>${esc(food.name)}</h2>
      <div class="hint">${food.brand ? esc(food.brand) + " · " : ""}на 100 г: ${per100(food)}</div>
      ${pick ? `<div class="cap">Приём пищи · ${esc(dayName)}</div><div class="chips seg" id="pmeal">${MEALS.map(m => `<button class="chip${m === meal ? " on" : ""}" data-m="${m}">${m}</button>`).join("")}</div>` : ""}
      ${box.html}
      <div class="res" id="pres"></div>
      ${fromBase ? `<label class="chk"><input type="checkbox" id="psave" checked> Сохранить в мои продукты</label>
        <label class="fld" id="pcatW"><span>Категория</span>${catSelect(food.cat || guessCat(food.name), "pcat")}</label>` : ""}
      <button class="btn" id="padd">Добавить в ${esc(meal.toLowerCase())}</button>
      ${pick && food.id ? `<button class="btn ghost" id="pedit">Изменить продукт</button>` : ""}`);
    if (pick){
      $("pmeal").onclick = e => { const b = e.target.closest("[data-m]"); if (!b) return; meal = b.dataset.m;
        $("pmeal").querySelectorAll(".chip").forEach(x => x.classList.toggle("on", x === b)); $("padd").textContent = "Добавить в " + meal.toLowerCase(); };
      if ($("pedit")) $("pedit").onclick = () => foodForm(food);
    }
    const g = box.grams;
    const calc = () => { const k = g() / 100; return {kcal: Math.round(food.kcal * k), p: r1(food.p * k), f: r1(food.f * k), c: r1(food.c * k)}; };
    function show(){ if (!$("pres")) return; const c = calc(); $("pres").innerHTML = `<b>${fmt(c.kcal)}</b> ккал · Б ${fmt(c.p,1)} · Ж ${fmt(c.f,1)} · У ${fmt(c.c,1)}`; }
    box.bind();
    if (fromBase) $("psave").onchange = e => $("pcatW").hidden = !e.target.checked;
    $("padd").onclick = () => {
      if (!(g() > 0)) return $(box.unit() === "pc" && !box.pc() ? "apc" : "pg").focus();
      let f = food;
      if (fromBase && $("psave").checked){
        f = {id: newId("f"), name: food.name, brand: food.brand, cat: $("pcat").value, kcal: food.kcal, p: food.p, f: food.f, c: food.c};
        if (food.code) f.code = food.code;
        if (food.pc){ f.pc = food.pc; if (food.pcName) f.pcName = food.pcName; }
        if (!f.brand) delete f.brand;
        foods = [f, ...foods]; renderFoods(); saveFoods("новый продукт: " + f.name);
      }
      const out = {id: newId("m"), name: foodName(food), meal, time: nowTime(), g: r1(g()), ...calc()};
      if (box.pcs()){ out.pcs = box.pcs(); out.pcName = pcLabel(food); }
      if (f.id) out.food = f.id;
      rememberUnit(f.id ? f : food, box);
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

  // сохранить набор порций одним блюдом («Мой завтрак»)
  function comboSheet(list, m){
    openSheet(`<h2>Моё блюдо</h2>
      <div class="hint">${esc(list.map(x => `${x.name}${x.g ? " " + fmt(x.g) + " г" : ""}`).join(" · "))}</div>
      <form id="comboForm"><label class="fld"><span>Название</span><input name="name" value="Мой ${esc(m.toLowerCase())}" required></label>
      <button class="btn" type="submit">Сохранить</button></form>`);
    $("comboForm").onsubmit = e => {
      e.preventDefault();
      const name = String(new FormData(e.target).get("name")).trim() || "Моё блюдо";
      combos = [{id: newId("b"), name, items: list.map(({id, meal, time, ...r}) => r)}, ...combos];
      closeSheet(); saveConf("combos.json", combos, "моё блюдо: " + name);
      toast(`Сохранено: ${name}. Оно появится по «+» у приёма пищи`);
    };
  }

  // нажатие на приём пищи и «+» открывают одно окно (раньше было два шага)
  function mealSheet(m){ addSheet(m); }

  // что уже съедено в этом приёме — сверху окна; обновляется само после любой правки
  let curAddMeal = null;
  function renderCur(){
    const box = $("acur"); if (!box || !curAddMeal) return;
    const m = curAddMeal;
    const list = (day.items || []).filter(it => (MEALS.includes(it.meal) ? it.meal : "Перекус") === m).sort((a,b) => String(a.time||"").localeCompare(String(b.time||"")));
    if (!list.length){ box.innerHTML = ""; return; }
    box.innerHTML = `<div class="cap row">Уже в ${esc(m.toLowerCase())}е<span>${fmt(list.reduce((s, x) => s + num(x.kcal), 0))} ккал</span></div>
      <div class="list cur" id="mlist">${list.map(it => `<div class="swipe"><button class="del" data-del="${esc(it.id)}">Удалить</button><button class="item" data-id="${esc(it.id)}"><div class="nm"><div>${esc(it.name || "Без названия")}</div><small>${it.pcs ? `${fmt(it.pcs, 1)} × ${esc(it.pcName || "шт")} · ` : ""}${it.g?fmt(it.g)+" г · ":""}Б ${fmt(it.p)} · Ж ${fmt(it.f)} · У ${fmt(it.c)}</small></div><div class="kc">${fmt(it.kcal)}</div></button></div>`).join("")}</div>
      ${list.length > 1 ? `<button class="linkbtn" id="mcombo">Сохранить как моё блюдо</button>` : ""}`;
    if ($("mcombo")) $("mcombo").onclick = () => comboSheet(list, m);
    $("mlist").onclick = e => {
      const del = e.target.closest("[data-del]");
      if (del) return removeItem(day.items.find(x => x.id === del.dataset.del));
      const row = e.target.closest(".swipe");
      if (row?.classList.contains("open")) return row.classList.remove("open"); // тап по открытой строке — закрыть
      const b = e.target.closest(".item"); if (b) itemDetails(b.dataset.id);
    };
    swipeRows($("mlist"));
  }

  // ---------- всплывающая плашка с действием (как в iOS: «Удалено · Отменить») ----------
  let toastTimer;
  function toast(text, action, fn){
    const t = $("toast");
    t.innerHTML = `<span>${esc(text)}</span>${action ? `<button>${esc(action)}</button>` : ""}`;
    t.classList.toggle("top", $("sheet").classList.contains("on"));
    t.classList.add("on");
    if (action) t.querySelector("button").onclick = () => { t.classList.remove("on"); fn(); };
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("on"), 4000);
  }
  function removeItem(it){
    if (!it) return;
    mutate({t: "del", id: it.id}, "удалено: " + it.name);
    toast(`Удалено: ${it.name}`, "Отменить", () => mutate({t: "put", item: it}, "возвращено: " + it.name));
  }

  // лента чипов: своя горизонтальная прокрутка — упирается в края без «резинки», вертикальный жест уходит странице;
  // мышью (компьютер, превью) — тянуть и крутить колёсиком; после перетаскивания клик по чипу не срабатывает
  function hscroll(el){
    let x0 = null, y0 = 0, s0 = 0, horiz = null, mx = null, ms = 0, dragged = false;
    el.addEventListener("touchstart", e => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; s0 = el.scrollLeft; horiz = null; }, {passive: true});
    el.addEventListener("touchmove", e => {
      if (x0 === null) return;
      const dx = e.touches[0].clientX - x0, dy = e.touches[0].clientY - y0;
      if (horiz === null && Math.abs(dx) + Math.abs(dy) > 6) horiz = Math.abs(dx) > Math.abs(dy);
      if (horiz) el.scrollLeft = s0 - dx; // браузер сам ограничит 0…max
    }, {passive: true});
    el.addEventListener("touchend", () => { x0 = null; }, {passive: true});
    // захват мыши — только когда началось перетаскивание: иначе клик уходит ленте, а не чипу, и чип не выбирается
    el.addEventListener("pointerdown", e => { if (e.pointerType !== "mouse") return; mx = e.clientX; ms = el.scrollLeft; dragged = false; });
    el.addEventListener("pointermove", e => { if (mx === null) return; const dx = e.clientX - mx;
      if (!dragged && Math.abs(dx) > 4){ dragged = true; el.setPointerCapture(e.pointerId); }
      if (dragged) el.scrollLeft = ms - dx; });
    el.addEventListener("pointerup", () => { mx = null; });
    el.addEventListener("click", e => { if (dragged){ e.stopImmediatePropagation(); e.preventDefault(); dragged = false; } }, true);
    el.addEventListener("wheel", e => { const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY; if (!d) return; el.scrollLeft += d; e.preventDefault(); }, {passive: false});
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
    // мышь (компьютер, превью): зажать строку и потянуть влево; после перетаскивания клик не открывает блюдо
    let mrow = null, mx0 = 0, mdx = 0, mdrag = false;
    root.addEventListener("pointerdown", e => {
      if (e.pointerType !== "mouse" || e.target.closest(".del")) return;
      mrow = e.target.closest(".swipe"); if (!mrow) return;
      root.querySelectorAll(".swipe.open").forEach(r => r !== mrow && r.classList.remove("open"));
      mx0 = e.clientX; mdx = 0; mdrag = false;
    });
    root.addEventListener("pointermove", e => {
      if (!mrow) return;
      const m = e.clientX - mx0; if (!mdrag && Math.abs(m) > 6){ mdrag = true; root.setPointerCapture(e.pointerId); } if (!mdrag) return;
      mdx = Math.max(-96, Math.min(0, m + (mrow.classList.contains("open") ? -96 : 0)));
      mrow.querySelector(".item").style.transform = `translateX(${mdx}px)`; mrow.classList.add("drag");
    });
    root.addEventListener("pointerup", () => {
      if (!mrow) return;
      if (mdrag){ mrow.classList.toggle("open", mdx < -48); mrow.querySelector(".item").style.transform = ""; mrow.classList.remove("drag"); }
      mrow = null;
    });
    root.addEventListener("click", e => { if (mdrag && !e.target.closest(".del")){ e.stopImmediatePropagation(); mdrag = false; } }, true);
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
  let stripAt = null, stripFrom = null;
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
      strip.style.transition = "none"; strip.style.transform = `translateX(${stripFrom ?? shift * strip.offsetWidth / 7}px)`; stripFrom = null;
      strip.offsetWidth; // применить стартовое положение до анимации
      strip.style.transition = ""; strip.style.transform = "";
    }
  }

  // ---------- data ----------
  const dayPath = d => `days/${d}.json`;

  async function loadDay(quiet){
    const d = cur;
    // заготовки — только если загрузка заметно долгая; быстрый ответ не мигает серым
    const slow = quiet ? 0 : setTimeout(() => d === cur && $("app").classList.add("loading"), 250);
    try {
      const r = await Store.read(dayPath(d));
      if (d !== cur) return;
      day = pendingFor(d).reduce(applyOp, {...blank(d), ...(r?.data || {})});
      if (!pending.length) setStatus(""); render();
    } catch (e){ fail("Не загрузилось", e); }
    finally { clearTimeout(slow); if (d === cur) $("app").classList.remove("loading"); }
    const others = weekDays().filter(x => x !== d && x <= todayIso());
    const docs = await Promise.all(others.map(x => Store.read(dayPath(x)).then(r => r?.data, () => null)));
    if (d !== cur) return;
    others.forEach((x, i) => { if (docs[i]) weekDocs[x] = docs[i]; });
    renderWeek(); saveCache();
  }

  // ---------- правки дня как простые операции: их можно сохранить на телефоне и отправить позже ----------
  // put — добавить/заменить блюдо по id; del — удалить; water — прибавить мл; sup — отметки добавки
  function applyOp(doc, op){
    const d = {...doc, items: [...(doc.items || [])], sup: {...(doc.sup || {})}};
    if (op.t === "put") d.items = d.items.some(x => x.id === op.item.id) ? d.items.map(x => x.id === op.item.id ? op.item : x) : [...d.items, op.item];
    if (op.t === "del") d.items = d.items.filter(x => x.id !== op.id);
    if (op.t === "puts") d.items = [...d.items.filter(x => !op.items.some(n => n.id === x.id)), ...op.items];
    if (op.t === "dels") d.items = d.items.filter(x => !op.ids.includes(x.id));
    if (op.t === "water") d.water = Math.max(0, num(d.water) + op.add); // shortcut: при обрыве связи после записи прибавка может задвоиться — для воды допустимо
    if (op.t === "sup") d.sup[op.id] = op.n;
    return d;
  }
  const PKEY = "kcal_pending";
  let pending = (() => { try { return JSON.parse(localStorage.getItem(PKEY)) || []; } catch { return []; } })();
  const savePending = () => { localStorage.setItem(PKEY, JSON.stringify(pending)); inflight = pending.length; };
  inflight = pending.length;
  const pendingFor = d => pending.filter(p => p.date === d).map(p => p.op);

  // Оптимистично меняем экран; правка сначала ложится в очередь на телефоне, потом уходит на GitHub (каждая = коммит)
  function mutate(op, msg){
    const d = cur;
    day = applyOp(day, op); render();
    pending.push({date: d, op, msg}); savePending(); saveCache();
    flush();
  }
  let flushing = false;
  async function flush(){
    if (flushing || !pending.length) return;
    flushing = true;
    try {
      while (pending.length){
        const {date, op, msg} = pending[0];
        const saved = await Store.update(dayPath(date), cd => applyOp(cd || blank(date), op), `${date}: ${msg}`);
        pending.shift(); savePending();
        weekDocs[date] = saved;
        if (date === cur && !pendingFor(date).length){ day = {...blank(date), ...saved}; render(); }
      }
      setStatus(""); saveCache();
    } catch (e){
      if (e?.code === 401) fail("Не сохранилось", e);
      else setStatus(`Нет связи — ${pending.length} ${pending.length === 1 ? "запись сохранена" : "записей сохранено"} на телефоне, отправлю позже`);
    } finally { flushing = false; }
  }
  addEventListener("online", flush);

  let waterDelta = 0;
  const waterLog = {}; // дата → стек добавленных порций за эту сессию
  function bumpWater(delta){
    const before = pendingWater ?? num(day.water);
    pendingWater = Math.max(0, before + delta);
    waterDelta += pendingWater - before;
    render();
    clearTimeout(waterTimer);
    waterTimer = setTimeout(() => {
      const add = waterDelta; waterDelta = 0; pendingWater = null;
      if (add) mutate({t: "water", add}, `вода ${add > 0 ? "+" : ""}${add} мл`);
    }, 700);
  }

  const saveConf = (path, data, msg) => { saveCache(); return Store.update(path, () => data, msg).catch(e => fail("Не сохранилось", e)); };

  // ---------- sheets ----------
  function openSheet(html){ stopScan?.(); const sb = $("sheetBody"); sb.innerHTML = html; sb.classList.remove("swap"); sb.offsetWidth; sb.classList.add("swap"); $("scrim").classList.add("on"); $("sheet").classList.add("on"); }
  function closeSheet(){ curAddMeal = null; stopScan?.(); $("scrim").classList.remove("on"); $("sheet").classList.remove("on"); $("sheet").style.transform = ""; }
  (() => {
    const sh = $("sheet"); let y0 = null, dy = 0;
    sh.addEventListener("touchstart", e => { y0 = sh.scrollTop <= 0 && !e.target.closest(".swipe,.chips") ? e.touches[0].clientY : null; dy = 0; }, {passive: true});
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
    let x0 = 0;
    addEventListener("touchstart", e => { y0 = scrollY <= 0 && !$("sheet").classList.contains("on") && !$("app").hidden && !e.target.closest(".days,.chips") ? e.touches[0].clientY : null; x0 = e.touches[0].clientX; dy = 0; }, {passive: true});
    addEventListener("touchmove", e => {
      if (y0 === null) return;
      if (Math.abs(e.touches[0].clientX - x0) > Math.abs(e.touches[0].clientY - y0)){ dy = 0; ptr.style.opacity = 0; return; } // боковое движение — не обновление
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
      mutate({t: "put", item: out}, (it ? "правка: " : "добавлено: ") + out.name);
    };
    if (it){
      const b = $("delBtn");
      b.onclick = () => {
        if (!b.classList.contains("armed")){ b.classList.add("armed"); b.textContent = "Точно удалить?"; return; }
        closeSheet();
        removeItem(it);
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
    $("editBtn").onclick = () => it.g > 0 ? portionEdit(it) : itemForm(it);
  }

  // правка порции: меняем граммы и приём — калории и БЖУ пересчитываются сами
  function portionEdit(it){
    const prod = foods.find(f => f.id === it.food);
    // на 1 г: из продукта (точнее), иначе из самой записи
    const per = prod ? {kcal: prod.kcal / 100, p: prod.p / 100, f: prod.f / 100, c: prod.c / 100}
                     : {kcal: it.kcal / it.g, p: num(it.p) / it.g, f: num(it.f) / it.g, c: num(it.c) / it.g};
    let meal = MEALS.includes(it.meal) ? it.meal : "Перекус";
    const unitSrc = prod || {pc: it.pcs ? it.g / it.pcs : 0, pcName: it.pcName};
    const box = amountBox(unitSrc, it.g, () => show());
    openSheet(`<h2>${esc(it.name)}</h2>
      <div class="chips seg" id="emeal">${MEALS.map(m => `<button class="chip${m === meal ? " on" : ""}" data-m="${m}">${m}</button>`).join("")}</div>
      ${box.html}
      <div class="res" id="eres"></div>
      <button class="btn" id="esave">Сохранить</button>
      <button class="btn ghost" id="emanual">Править вручную</button>
      <button class="btn danger" id="edel">Удалить</button>`);
    const g = box.grams;
    const calc = () => ({kcal: Math.round(per.kcal * g()), p: r1(per.p * g()), f: r1(per.f * g()), c: r1(per.c * g())});
    function show(){ if (!$("eres")) return; const c = calc(); $("eres").innerHTML = `<b>${fmt(c.kcal)}</b> ккал · Б ${fmt(c.p,1)} · Ж ${fmt(c.f,1)} · У ${fmt(c.c,1)}`; }
    box.bind();
    $("emeal").onclick = e => { const b = e.target.closest("[data-m]"); if (!b) return; meal = b.dataset.m; $("emeal").querySelectorAll(".chip").forEach(x => x.classList.toggle("on", x === b)); };
    $("esave").onclick = () => {
      if (!(g() > 0)) return $("pg").focus();
      if (prod) rememberUnit(prod, box);
      const upd = {...it, meal, g: r1(g()), ...calc()};
      if (box.pcs()){ upd.pcs = box.pcs(); upd.pcName = pcLabel(unitSrc); } else { delete upd.pcs; delete upd.pcName; }
      closeSheet();
      mutate({t: "put", item: upd}, `правка: ${it.name} ${r1(g())} г`);
    };
    $("emanual").onclick = () => itemForm(it);
    $("edel").onclick = () => { closeSheet(); removeItem(it); };
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
    $("logout").onclick = () => { closeSheet(); Store.clearToken(); localStorage.removeItem(CKEY); localStorage.removeItem(PKEY); pending = []; savePending(); showSetup(); };
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
  // день уже загружали — показываем сразу и тихо обновляем в фоне, без серых заготовок
  function go(d){ weekDocs[cur] = day; cur = d; const known = weekDocs[d]; day = known ? {...blank(d), ...known} : blank(d); pendingWater = null; render(); loadDay(!!known); }
  $("prev").onclick = () => go(addDays(cur,-1));
  $("next").onclick = () => go(addDays(cur,1));
  // смахнуть ленту дней влево/вправо — следующий/предыдущий день
  // лента едет за пальцем и встаёт на ближайший день
  (() => { const el = $("week"); let x0 = null, dx = 0;
    el.addEventListener("touchstart", e => { x0 = e.touches[0].clientX; dx = 0; el.style.transition = "none"; }, {passive: true});
    el.addEventListener("touchmove", e => { if (x0 === null) return; dx = e.touches[0].clientX - x0; el.style.transform = `translateX(${dx}px)`; }, {passive: true});
    el.addEventListener("touchend", () => { if (x0 === null) return; x0 = null; el.style.transition = "";
      const slot = el.offsetWidth / 7, steps = Math.max(-3, Math.min(3, Math.round(-dx / slot)));
      if (steps){ stripFrom = dx + steps * slot; go(addDays(cur, steps)); } else el.style.transform = ""; });
  })();
  $("dateLbl").onclick = () => go(todayIso());
  $("wForm").onsubmit = e => {
    e.preventDefault();
    const v = Math.round(num($("wIn").value)) || 250; // пусто = стакан 250 мл
    $("wIn").value = ""; $("wIn").blur();
    if (v > 0 && v <= 5000){ (waterLog[cur] ||= []).push(v); bumpWater(v); }
  };
  $("wMinus").onclick = () => bumpWater(-((waterLog[cur] || []).pop() || 250)); // убрать последнюю порцию, иначе 250
  $("newFood").onclick = () => foodForm(null);
  $("foodQ").oninput = renderFoods;
  hscroll($("foodCats"));
  $("foodCats").onclick = e => { const b = e.target.closest("[data-cat]"); if (b){ foodCat = b.dataset.cat; renderFoods(); } };
  $("scanBtn").onclick = () => scanSheet();
  $("foodList").onclick = e => {
    if (e.target.closest("#starterBtn")) return addStarter();
    const s = e.target.closest("[data-star]");
    if (s){ const f = foods.find(x => x.id === s.dataset.star); f.fav = !f.fav; if (!f.fav) delete f.fav; renderFoods(); return saveFoods((f.fav ? "в избранное: " : "из избранного: ") + f.name); }
    const b = e.target.closest("[data-food]"); if (b) portionSheet(foods.find(f => f.id === b.dataset.food), null, false); };
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
      scrollTo(0, 0);
    }, matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 140);
  };
  new ResizeObserver(() => { const b = document.querySelector("#tabbar button.on"); if (b) movePill(b); }).observe($("tabbar"));
  $("settingsBtn").onclick = settingsSheet;
  $("week").onclick = e => { const b = e.target.closest(".day"); if (b && b.dataset.d !== cur) go(b.dataset.d); };
  $("sups").onclick = e => {
    const b = e.target.closest(".dot"); if (!b) return;
    const id = b.dataset.sup, i = Number(b.dataset.i);
    const n = num(day.sup?.[id]) === i + 1 ? i : i + 1;
    mutate({t: "sup", id, n}, `добавка ${id}: ${n}`);
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
  // ---------- кэш на телефоне: при открытии показываем последнее сразу, свежее подтягиваем в фоне ----------
  const CKEY = "kcal_cache";
  function saveCache(){
    try {
      if (day.date) weekDocs[day.date] = day;
      // держим только дни около текущего, чтобы кэш не рос
      const keep = Object.fromEntries(Object.entries(weekDocs).filter(([k]) => Math.abs(parseIso(k) - parseIso(cur)) <= 10 * 864e5));
      localStorage.setItem(CKEY, JSON.stringify({goals, sups, foods, combos, days: keep}));
    } catch {}
  }
  function readCache(){ try { return JSON.parse(localStorage.getItem(CKEY)); } catch { return null; } }

  async function boot(){
    if (!Store.hasToken()) return showSetup();
    $("setup").hidden = true; $("app").hidden = false; $("tabbar").hidden = false;
    const c = readCache();
    if (c){
      goals = {...DEFAULT_GOALS, ...c.goals}; sups = c.sups || sups; foods = c.foods || foods; combos = c.combos || []; weekDocs = c.days || {};
      if (weekDocs[cur]) day = {...blank(cur), ...weekDocs[cur]};
      render(); // мгновенно, без серых заготовок
    } else { $("app").classList.add("loading"); render(); } // самый первый запуск
    loadDay(!!c);
    try {
      // настройки, добавки и продукты — параллельно, а не по очереди
      const [s, su, fo, co] = await Promise.all(["settings.json", "supplements.json", "foods.json", "combos.json"].map(p => Store.read(p)));
      if (co) combos = co.data;
      if (!s) await Store.update("settings.json", () => DEFAULT_GOALS, "начальные цели");
      else goals = {...DEFAULT_GOALS, ...s.data, micro: {...DEFAULT_GOALS.micro, ...(s.data.micro || {})}};
      if (!su) await Store.update("supplements.json", () => sups, "добавки");
      else sups = su.data;
      if (fo) foods = fo.data;
      else { foods = [...STARTER]; await Store.update("foods.json", () => foods, "базовые продукты"); }
    } catch (e){ return fail("Не загрузилось", e); }
    render(); saveCache(); flush();
  }

  addEventListener("scroll", () => document.documentElement.classList.toggle("scrolled", scrollY > 4), {passive: true});

  // записи с компьютера (Claude) подхватываются при каждом возврате в приложение
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && Store.hasToken()) flush();
    if (!document.hidden && Store.hasToken() && !inflight && pendingWater == null) loadDay(true);
  });

  if ("serviceWorker" in navigator && location.protocol === "https:"){
    // пришла новая версия — перезагрузить один раз (при первой установке контроллера ещё нет)
    if (navigator.serviceWorker.controller) navigator.serviceWorker.addEventListener("controllerchange", () => location.reload(), {once: true});
    navigator.serviceWorker.register("sw.js", {updateViaCache: "none"});
  }
  boot();
})();
