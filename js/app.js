(() => {
  // ---------- constants ----------
  const VERSION = 65;
  // iOS отдаёт выбранный в настройках размер текста через системный шрифт -apple-system-body (17 px по умолчанию):
  // масштабируем интерфейс тем же коэффициентом, но не больше 1,3 — иначе главный экран перестанет помещаться
  (() => { const p = document.createElement("span"); p.style.font = "-apple-system-body"; p.style.position = "absolute"; p.style.visibility = "hidden"; p.textContent = "a";
    document.documentElement.appendChild(p); const fs = parseFloat(getComputedStyle(p).fontSize); p.remove();
    if (fs > 0 && p.style.font) document.documentElement.style.setProperty("--dt", Math.min(1.3, Math.max(1, fs / 17)).toFixed(3)); })();
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
  let weights = []; // [{date, kg}] — вес по дням, по возрастанию даты
  let measures = []; // [{date, waist, hips, chest, arm, thigh, neck}] — замеры тела, см
  let combos = []; // мои блюда: {id, name, items:[порции без id/meal/time]}
  let foods = []; // мои продукты: {id, name, brand, kcal, p, f, c — на 100 г, pc — вес 1 шт в г}
  let weekDocs = {};
  let pendingWater = null, waterTimer = null;
  let inflight = 0;

  const setStatus = (t, e) => { const s = $("status"); s.textContent = t || ""; s.className = "status" + (e ? " err" : ""); };
  // 1 блюдо, 2 блюда, 5 блюд
  const plural = (n, one, few, many) => { const a = Math.abs(n) % 100, b = a % 10; return a > 10 && a < 20 ? many : b === 1 ? one : b > 1 && b < 5 ? few : many; };
  const fail = (what, e) => {
    if (e?.code === 401){ Store.clearToken(); showSetup("Токен не принят GitHub (401). Вставь новый."); return; }
    // понятным языком, без кодов: что случилось и что делать
    setStatus(what === "Не сохранилось" ? "Не получилось сохранить. Проверь интернет — запись осталась на телефоне, отправлю позже."
      : "Не получилось загрузить данные. Проверь интернет и потяни экран вниз, чтобы повторить.", true);
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
    // крупно — сколько съедено, ниже — сколько осталось или сверх нормы
    $("kLeft").textContent = fmt(t.kcal);
    $("kLeftLbl").textContent = `Съедено из ${fmt(g.kcal)}, ккал`;
    $("eatenTxt").textContent = left >= 0 ? `Осталось ${fmt(left)} ккал` : `Сверх нормы ${fmt(-left)} ккал`;
    $("kPct").textContent = Math.round(t.kcal / Math.max(g.kcal,1) * 100) + "%";
    $("ringBox").setAttribute("aria-label", `Съедено ${fmt(t.kcal)} из ${fmt(g.kcal)} ккал, ${left >= 0 ? "осталось " + fmt(left) : "сверх нормы " + fmt(-left)}`);
    // полоса: до нормы — цвет нутриента; сверх нормы — белый хвост (без тревожного красного)
    $("macros").innerHTML = [["Белки","p","--p"],["Углеводы","c","--c"],["Жиры","f","--f"]].map(([n,k,col]) => {
      const v = t[k], gg = Math.max(g[k], 1);
      const fill = v > gg
        ? `<div class="cut" style="width:${gg / v * 100}%;background:var(${col})"></div><div class="ov" style="width:${(v - gg) / v * 100}%"></div>`
        : `<div style="width:${v / gg * 100}%;background:var(${col})"></div>`;
      return `<div class="tile" role="img" aria-label="${n}: ${fmt(v)} из ${fmt(g[k])} грамм${v > gg ? ", сверх нормы " + fmt(v - gg) : ""}"><div class="cap" aria-hidden="true">${n}</div><b>${fmt(v)}</b><small class="goal">из ${fmt(g[k])} г${v > gg ? ` <em>+${fmt(v - gg)}</em>` : ""}</small><div class="bar">${fill}</div></div>`;
    }).join("");

    const water = pendingWater ?? num(day.water);
    $("wNum").innerHTML = `${fmt(water)} <small>/ ${fmt(g.water)} мл</small>`;

    renderSups();

    $("mealSum").innerHTML = MEALS.map(m => {
      const list = items.filter(it => (MEALS.includes(it.meal) ? it.meal : "Перекус") === m);
      const sum = list.reduce((s, it) => s + num(it.kcal), 0);
      return `<div class="ms" data-meal="${m}"><button class="nm" aria-label="${m}${list.length ? `: ${fmt(sum)} ккал, ${list.length} ${plural(list.length, "блюдо", "блюда", "блюд")}` : ", пусто"}">${m}${list.length ? `<small>${esc(list.map(it => it.short || it.name).join(", "))}</small>` : ""}</button><span class="kc" aria-hidden="true">${list.length ? fmt(sum) : ""}</span><button class="round sm" data-add="${m}" aria-label="Добавить в ${m}">${ICON_PLUS}</button></div>`;
    }).join("");
    renderFoods();
    renderWeek();
    renderCur();
  }

  const r1 = v => Math.round(num(v) * 10) / 10;
  const per100 = f => `${fmt(f.kcal)} ккал · Б ${fmt(f.p,1)} · Ж ${fmt(f.f,1)} · У ${fmt(f.c,1)}`;
  // то же на одну штуку/порцию, если известен её вес: «1 штука · 110 г: 264 ккал · …»
  const perPc = f => { const k = num(f.pc) / 100; return k ? `1 ${f.pcName || "штука"} · ${fmt(f.pc)} г: ${fmt(f.kcal * k)} ккал · Б ${fmt(f.p * k, 1)} · Ж ${fmt(f.f * k, 1)} · У ${fmt(f.c * k, 1)}` : ""; };
  // как продукт называется везде: «Творог 5% · Простоквашино» (без фирмы семь творогов не различить)
  const foodName = f => f.brand ? `${f.name} · ${f.brand}` : f.name;
  // метки под названием: магазин; «без фирмы» — у общих справочных продуктов, чтобы не путать с конкретными
  // метки под названием: магазин; «≈ сверить» — КБЖУ примерные, их стоит сверить с упаковкой
  const storeTag = f => (f.store ? `<span class="tag">${esc(f.store)}</span>` : "") + (f.approx ? `<span class="tag warn">≈ сверить</span>` : "");
  const STORES = ["Пятёрочка", "Перекрёсток", "Самокат", "ВкусВилл", "Магнит", "Лента", "Ашан", "Яндекс Лавка", "Озон фреш"];
  // все слова запроса есть в названии или бренде
  // все слова запроса есть в названии, фирме или магазине (ё = е)
  const match = (f, q) => { const h = [f.name, f.brand, f.store].join(" ").toLowerCase().replace(/ё/g, "е"); return q.toLowerCase().replace(/ё/g, "е").split(/\s+/).every(w => h.includes(w)); };
  const STAR = `<svg viewBox="0 0 24 24" class="ico" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z"/></svg>`;
  // строка «Моих продуктов» со звёздочкой «в избранное» справа
  const favRow = f => `<div class="frow">${foodRow(f, `data-food="${esc(f.id)}"`)}<button class="star${f.fav ? " on" : ""}" data-star="${esc(f.id)}" aria-pressed="${!!f.fav}" aria-label="${f.fav ? "Убрать из избранного" : "В избранное"}">${STAR}</button></div>`;
  const foodRow = (f, attr) => `<button class="item" ${attr}><div class="nm"><div>${esc(foodName(f))}</div><small>${storeTag(f)}${per100(f)} на 100 г</small>${f.pc ? `<small class="pcl">${perPc(f)}</small>` : ""}</div></button>`;
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
    ["Другое", "соус|кетчуп|майонез|горчиц|приправ|специ"], // соусы — не готовая еда, хоть и «бургер-соус»
    ["Готовая еда", "суп|борщ|щи|пицц|бургер|шаурм|ролл|суши|пельмен|вареник|плов|котлет|лазань|сэндвич|бутерброд|салат цезарь|оливье"],
    ["Сладкое", "шоколад|конфет|печень|торт|пирож|морожен|пломбир|вафл|зефир|мармелад|халв|сахар|мёд|мед|варень|джем|десерт|батончик|круассан|пончик|сырок"],
    ["Снеки", "чипс|орех|сухарик|попкорн|крекер|семечк|миндал|арахис|кешью|фисташ|снек"],
    ["Напитки", "вода|газиров|кола|сок|морс|чай|кофе|лимонад|напит|энергет|квас|компот|пиво|вино|минерал"],
    ["Молочка", "молок|молоч|кефир|ряженк|йогурт|творог|творож|сыр|сметан|сливк|простокваш|айран|масло сливоч|снежок|варенец"],
    ["Мясо, рыба, яйца", "кур|цыпл|говя|свин|индей|мяс|фарш|рыб|лосос|сёмг|семг|форел|тунец|скумбр|кревет|яйц|яйк|колбас|сосис|ветчин|бекон|филе|грудк|печень куриная"],
    ["Крупы, хлеб, макароны", "греч|рис|овсян|овёс|макарон|спагет|паст|хлеб|батон|лаваш|круп|булгур|киноа|мук|хлопь|гранол|мюсли|лапш"],
    ["Овощи и фрукты", "банан|яблок|груш|апельсин|мандарин|виноград|ягод|клубни|малин|черник|голубик|огур|помидор|томат|морков|капуст|салат|лук|перец|кабач|брокколи|авокадо|лимон|киви|персик|абрикос|слив|арбуз|дын|гриб|шпинат|зелен|свекл|тыкв|фрукт|овощ|картоф|картош|пюре"],
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
  // «Другое» — только если по названию не угадывается ничего лучше (творог всегда в молочке)
  const catOf = f => CATS.includes(f.cat) && f.cat !== "Другое" ? f.cat : guessCat(f.name);
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
    const starterBtn = missing && !foods.length && !q && !foodCat ? /* только для пустого каталога */ `<button class="btn ghost" id="starterBtn">Добавить базовый набор (${missing} продуктов)</button>` : "";
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
          <label class="fld"><span>Фирма</span><input name="brand" value="${v("brand")}" placeholder="Простоквашино, Lay's…"></label>
          <label class="fld"><span>Магазин</span><input name="store" list="storeList" value="${v("store")}" placeholder="Пятёрочка…"><datalist id="storeList">${STORES.map(s => `<option value="${s}">`).join("")}</datalist></label>
        </div>
        <label class="fld"><span>Коротко для главного экрана</span><input name="short" value="${v("short")}" placeholder="напр. Ряженка — если название длинное"></label>
        <label class="fld"><span>Как я называю — для «Что съел?»</span><input name="alias" value="${v("alias")}" placeholder="через запятую: картошка, шарики"></label>
        <label class="fld"><span>Категория</span>${catSelect(f ? catOf(f) : "Другое")}</label>
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
      const out = {id: f?.id || newId("f"), name: String(fd.get("name")).trim(), brand: String(fd.get("brand")).trim(), store: String(fd.get("store") || "").trim(), cat: !touched && fd.get("cat") === "Другое" ? guessCat(fd.get("name")) : fd.get("cat"), kcal: n("kcal"), p: n("p"), f: n("f"), c: n("c")};
      if (n("pc") > 0){ out.pc = n("pc"); if (fd.get("pcName") !== "штука") out.pcName = fd.get("pcName"); }
      if (f?.code) out.code = f.code; // сохранили вручную — значения считаются проверенными (метки «≈» нет)
      if (!out.brand) delete out.brand;
      if (!out.store) delete out.store;
      const sh = String(fd.get("short") || "").trim(); if (sh) out.short = sh;
      const al = String(fd.get("alias") || "").trim(); if (al) out.alias = al;
      if (f?.fav) out.fav = true; // правка продукта не снимает звёздочку
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
  const bumpUsage = list => { const u = usage(); list.forEach(x => { const id = x?.food ?? x; if (!id) return;
    const o = typeof u[id] === "object" ? u[id] : {}, m = {...(o.m || {})}; if (x?.meal) m[x.meal] = (m[x.meal] || 0) + 1;
    u[id] = {...o, n: useN(u, id) + 1, g: x?.g ?? o.g, m}; }); localStorage.setItem(UKEY, JSON.stringify(u)); };
  // частые — первыми, при равенстве — прежний порядок
  const byUse = list => { const u = usage(); return list.map((f, i) => [f, i]).sort((a, b) => useN(u, b[0].id) - useN(u, a[0].id) || a[1] - b[1]).map(x => x[0]); };
  // частые: сначала то, что ели именно в этот приём, затем остальные по общей частоте
  const frequent = meal => { const u = usage(), inMeal = id => u[id]?.m?.[meal] || 0;
    return byUse(foods.filter(f => useN(u, f.id) > 0)).sort((a, b) => inMeal(b.id) - inMeal(a.id)).slice(0, 20); };
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
  const OFF_FIELDS = "code,product_name,product_name_ru,brands,nutriments,categories_tags,serving_quantity,product_quantity,quantity,stores";
  function offMap(x){
    const n = x.nutriments || {};
    let name = unent(x.product_name_ru || x.product_name).trim().replace(/\s+/g, " ");
    name = name.charAt(0).toUpperCase() + name.slice(1); // в базе названия пишут люди, часто строчными
    let brand = unent(x.brands).split(",")[0].trim(); brand = brand.charAt(0).toUpperCase() + brand.slice(1);
    const st = unent(x.stores).toLowerCase().replace(/ё/g, "е"), store = STORES.find(s => st.includes(s.toLowerCase().replace(/ё/g, "е")));
    return {name, brand, ...(store ? {store} : {}), cat: guessCat(name, x.categories_tags), code: x.code,
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
    const words = q.toLowerCase().replace(/ё/g, "е").split(/\s+/), myStores = new Set(foods.map(f => f.store).filter(Boolean));
    const score = x => { const n = x.name.toLowerCase().replace(/ё/g, "е"), h = n + " " + (x.brand || "").toLowerCase();
      return (n.startsWith(words[0]) ? 4 : 0) + (words.every(w => h.includes(w)) ? 3 : 0) + (x.brand ? 1 : 0) + (myStores.has(x.store) ? 2 : 0) + (x.pc ? 1 : 0); };
    const out = ((await r.json()).products || []).map(offMap).filter(x => x.name && x.kcal != null)
      .map((x, i) => [x, score(x), i]).sort((a, b) => b[1] - a[1] || a[2] - b[2]).map(x => x[0]);
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
    // окно приёма — постоянной высоты: при смене раздела («Молочка» → «Мясо») не прыгает
    setTimeout(() => $("sheet").classList.add("tall"));
    openSheet(`<h2>${esc(meal)}</h2>
      <div id="acur"></div>
      <div class="search-row"><input class="search" id="aq" type="search" placeholder="Ряженка, творог, банан…" aria-label="Поиск продукта" autocomplete="off"><button class="round" id="ascan" aria-label="Сканировать штрихкод">${SCAN_ICON}</button><button class="round" id="manual" aria-label="Ввести вручную"><svg viewBox="0 0 24 24" class="ico" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4"/></svg></button></div>
      <div class="chips scroll" id="asec"></div>
      <div id="ares"></div>`);
    // раздел по умолчанию: избранное, иначе недавние, иначе все
    let sec = frequent(meal).length ? "freq" : foods.some(f => f.fav) ? "fav" : rec.length ? "rec" : "all";
    const drawSecs = () => {
      const cats = CATS.filter(c => foods.some(f => catOf(f) === c));
      const list = [...(frequent(meal).length ? [["freq", "Частые"]] : []), ...(foods.some(f => f.fav) ? [["fav", "★ Избранное"]] : []), ...(rec.length ? [["rec", "Недавние"]] : []),
        ...(combos.length ? [["combos", "Мои блюда"]] : []), ["all", "Все"], ...cats.map(c => [c, c])];
      $("asec").innerHTML = list.map(([k, t]) => `<button class="chip${k === sec ? " on" : ""}" data-sec="${esc(k)}">${esc(t)}</button>`).join("");
      $("asec").hidden = !!$("aq").value.trim(); // при поиске разделы не нужны — ищем везде
    };
    hscroll($("asec"));
    $("asec").onclick = e => { const b = e.target.closest("[data-sec]"); if (!b) return; sec = b.dataset.sec; drawSecs(); draw(); };
    // строка продукта: нажатие — выбрать граммы; «+» справа — добавить сразу прошлой порцией (окно не закрывается)
    const quickRow = f => { const g = defaultG(f), c = portionOf(f, g);
      return `<div class="frow">${`<button class="item" data-my="${esc(f.id)}"><div class="nm"><div>${f.fav ? "★ " : ""}${esc(foodName(f))}</div><small>${storeTag(f)}${fmt(g)} г · ${fmt(c.kcal)} ккал · Б ${fmt(c.p)} · Ж ${fmt(c.f)} · У ${fmt(c.c)}</small></div></button>`}<button class="qadd" data-q="${esc(f.id)}" aria-label="Добавить ${esc(f.name)} ${fmt(g)} г">${ICON_PLUS}</button></div>`; };
    const draw = st => {
      if (!$("aq")) return; // окно уже закрыли, а ответ базы пришёл позже
      const q = $("aq").value.trim();
      const recRow = (r, i) => `<button class="item" data-rec="${i}"><div class="nm"><div>${esc(r.name)}</div><small>${r.g ? fmt(r.g) + " г · " : ""}Б ${fmt(r.p)} · Ж ${fmt(r.f)} · У ${fmt(r.c)}</small></div><div class="kc">${fmt(r.kcal)}</div><span class="plus">${ICON_PLUS}</span></button>`;
      let h = "";
      if (!q){
        // без поиска — «Как вчера» сверху и выбранный раздел
        const yItems = (weekDocs[addDays(cur, -1)]?.items || []).filter(x => (MEALS.includes(x.meal) ? x.meal : "Перекус") === meal);
        if (yItems.length) h += `<button class="quick" id="ayest"><span><b>Как вчера</b><small>${esc(yItems.map(x => x.name).join(", "))}</small></span><i>${fmt(yItems.reduce((s, x) => s + num(x.kcal), 0))} ккал</i></button>`;
        const sel = sec === "freq" ? frequent(meal) : sec === "fav" ? byUse(foods.filter(f => f.fav)) : sec === "all" ? byUse(foods) : CATS.includes(sec) ? byUse(foods.filter(f => catOf(f) === sec)).sort((a, b) => !!b.fav - !!a.fav) : null;
        if (sec === "rec") h += rec.length ? `<div class="list">${rec.map(recRow).join("")}</div>` : `<div class="empty">Пока нет недавних</div>`;
        else if (sec === "combos") h += `<div class="list" id="acombos">${combos.map(c => `<div class="swipe"><button class="del" data-cdel="${esc(c.id)}">Удалить</button><button class="item" data-combo="${esc(c.id)}"><div class="nm"><div>${esc(c.name)}</div><small>${esc(c.items.map(x => x.name).join(", "))}</small></div><div class="kc">${fmt(c.items.reduce((s, x) => s + num(x.kcal), 0))}</div><span class="plus">${ICON_PLUS}</span></button></div>`).join("") || `<div class="empty">Нет сохранённых блюд</div>`}</div>`;
        else h += sel.length ? `<div class="list">${sel.map(quickRow).join("")}</div>` : `<div class="empty">Здесь пусто</div>`;
      }
      const mine = q ? foods.filter(f => match(f, q)).slice(0, 30) : [];
      if (mine.length) h += `<div class="cap">Мои продукты</div><div class="list">${mine.map(quickRow).join("")}</div>`;
      if (q.length >= 2) h += `<div class="cap">База Open Food Facts</div>` + (st === "load" ? `<div class="empty">Ищу…</div>`
        : st === "err" ? `<div class="empty">База не ответила. Попробуй ещё раз или введи вручную.</div>`
        : off.length ? `<div class="list">${off.map((f, i) => foodRow(f, `data-off="${i}"`)).join("")}</div>` : `<div class="empty">В базе не нашлось · <button class="linkbtn inline" data-manual>Ввести вручную</button></div>`);
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
        addItem({id: newId("m"), name: foodName(f), ...(f.short ? {short: f.short} : {}), meal, time: nowTime(), g, ...portionOf(f, g), food: f.id});
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
    $("ares").addEventListener("click", e => { if (e.target.closest("[data-manual]")) itemForm(null, meal); });
  }

  // блок «Сколько»: граммы или штуки (порции). В штуках вес 1 шт берётся из продукта или вводится тут же
  const unitPref = id => usage()[id]?.u;
  const PORTIONS = ["штука", "порция", "пачка", "упаковка", "стакан", "кусок", "ложка"];
  const pcLabel = f => f.pcName || "штука";
  function amountBox(food, startG, onChange){
    const pref = unitPref(food.id);
    let unit = food.pc && pref !== "g" ? "pc" : "g"; // есть вес штуки и граммы не выбирали — сразу в порциях
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
    openSheet(`<h2>${esc(foodName(food))}</h2>
      <div class="hint">${storeTag(food)}на 100 г: ${per100(food)}${food.pc ? `<br>${perPc(food)}` : ""}</div>
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
        if (food.store) f.store = food.store;
        if (!f.brand) delete f.brand;
        foods = [f, ...foods]; renderFoods(); saveFoods("новый продукт: " + f.name);
      }
      const out = {id: newId("m"), name: foodName(food), meal, time: nowTime(), g: r1(g()), ...calc()};
      if (box.pcs()){ out.pcs = box.pcs(); out.pcName = pcLabel(food); }
      if (f.id) out.food = f.id;
      if (f.short) out.short = f.short;
      rememberUnit(f.id ? f : food, box);
      addItem(out);
      if (pick) closeSheet(); else addSheet(meal); // пришли из окна приёма — возвращаемся туда же
    };
  }

  // ---------- «Что съел?»: фраза → продукты из моего каталога (без ИИ и интернета) ----------
  // <parse>
  const sayNorm = s => String(s || "").toLowerCase().replace(/ё/g, "е").replace(/(\d)[,.](\d)/g, "$1.$2");
  const NUMW = {ноль:0, один:1, одна:1, одну:1, одно:1, два:2, две:2, три:3, четыре:4, пять:5, шесть:6, семь:7, восемь:8, девять:9, десять:10, одиннадцать:11, двенадцать:12, тринадцать:13, четырнадцать:14, пятнадцать:15, шестнадцать:16, семнадцать:17, восемнадцать:18, девятнадцать:19, двадцать:20, тридцать:30, сорок:40, пятьдесят:50, шестьдесят:60, семьдесят:70, восемьдесят:80, девяносто:90, сто:100, двести:200, триста:300, четыреста:400, пятьсот:500, шестьсот:600, семьсот:700, восемьсот:800, девятьсот:900,
    пол:0.5, половина:0.5, половину:0.5, половинка:0.5, половинку:0.5, полтора:1.5, полторы:1.5, треть:1/3, трети:1/3, четверть:0.25, четвертинку:0.25};
  const U_G = {г:1, гр:1, грамм:1, грамма:1, граммов:1, мл:1, миллилитров:1, миллилитра:1, кг:1000, килограмм:1000, килограмма:1000, л:1000, литр:1000, литра:1000, литров:1000};
  const U_PC = /^(шт|штук|кус|порци|пачк|пачек|упаков|стакан|ложк|ложек|банк|банок|бутыл|пакет|долк|долек|кружк|чашк|тарел|миск|горст|ломт|чл$)/;
  // бытовые меры — когда у продукта нет своего веса штуки или он про другое: «тарелка борща», «ложка сметаны»
  const MEASURES = [[/^тарел/, 300, "тарелка"], [/^миск/, 300, "миска"], [/^стакан/, 250, "стакан"], [/^кружк/, 300, "кружка"], [/^чашк/, 200, "чашка"],
    [/^чл$/, 5, "ч. ложка"], [/^ложк|^ложек/, 15, "ложка"], [/^горст/, 30, "горсть"], [/^ломт/, 20, "ломтик"]];
  const SAY_FILL = new Set("я мы съел съела съели поел поела ел ела выпил выпила попил попила запиши записать добавь добавить внеси внести занеси сегодня вчера позавчера утром днем вечером ночью на в во с со а также ну там вот это мне пожалуйста почти немного из по к за у был была было как около примерно уже отдельно тоже ещё".split(" "));
  const SAY_SYN = {яиц:"яйца", яйцо:"яйца"};
  const SAY_MEALS = [[/^завтрак/, "Завтрак"], [/^обед/, "Обед"], [/^ужин/, "Ужин"], [/^перекус/, "Перекус"]];
  // глагол в начале куска фразы: добавить (по умолчанию) / удалить / поправить граммы / перенести в другой приём
  const SAY_VERB = /^(добав|запиш|внес|занес|удал|убер|убра|поправ|исправ|замен|измен|перенес)/;
  const verbOf = t => /^(добав|запиш|внес|занес)/.test(t) ? "add" : /^(удал|убер|убра)/.test(t) ? "del" : /^перенес/.test(t) ? "move" : "set";
  // «как вчера», «то же, что в среду на ужин», «повтори вчерашний завтрак»
  const WD = {понедельник:1, вторник:2, среду:3, четверг:4, пятницу:5, субботу:6, воскресенье:0};
  const COPY_RE = /(?:^|[\s,;])(?:как|то же(?: самое)?,? что(?: и)?|тоже(?: самое)?,? что(?: и)?|так же,? как|такой же,? как|повтори|повторить)\s+(позавчера|вчера|в\s+(?:понедельник|вторник|среду|четверг|пятницу|субботу|воскресенье))(?![а-я])(?:\s+(?:на|в)?\s*(завтрак|обед|ужин|перекус)[а-я]*)?/;
  const COPY2_RE = /(?:^|[\s,;])(?:повтори\s+|повторить\s+|как\s+)?(позавчерашн|вчерашн)[а-я]*\s+(завтрак|обед|ужин|перекус)[а-я]*/;

  // справочник обычных блюд — когда в моём каталоге такого нет («тарелка борща»). Значения на 100 г, примерные
  const DISHES = `Борщ||55|2.5|3|5|300|тарелка
Щи||35|1.5|2|3|300|тарелка
Солянка мясная||70|4.5|4.5|2.5|300|тарелка
Рассольник||45|1.5|2|5.5|300|тарелка
Суп куриный с лапшой|лапша куриная|45|3|1.5|5|300|тарелка
Суп гороховый||65|4|2|8|300|тарелка
Уха||45|5|1.5|3|300|тарелка
Окрошка на кефире|окрошка|60|3|3|5|300|тарелка
Суп грибной||35|1.5|1.5|4|300|тарелка
Харчо||70|4|3.5|7|300|тарелка
Суп с фрикадельками||50|3|2.5|4|300|тарелка
Крем-суп грибной|суп-пюре|60|1.5|4|5|300|тарелка
Том ям||50|4|2.5|3|300|тарелка
Гречка варёная|гречка гречневая каша|110|4|1|21|200|порция
Рис варёный|рис|115|2.5|0.5|25|200|порция
Макароны варёные|макароны паста спагетти|115|4|0.5|23|200|порция
Картофельное пюре|пюре толченка|90|2|3.5|13|200|порция
Картофель жареный|жареная картошка|190|3|10|23|200|порция
Картофель отварной|вареная картошка|80|2|0.3|17|200|порция
Картофель фри|фри|300|3.5|15|37|100|порция
Овсянка на воде|овсянка овсяная каша|70|2.5|1.5|12|250|тарелка
Овсянка на молоке||105|3.5|3.5|14|250|тарелка
Каша рисовая молочная|рисовая каша|100|3|3|15|250|тарелка
Каша манная|манка|100|3|3|16|250|тарелка
Каша пшённая|пшенка|90|3|1|17|250|тарелка
Булгур варёный|булгур|85|3|0.3|18|200|порция
Котлета мясная|котлета котлеты|220|14|14|9|80|штука
Котлета куриная||190|15|11|8|80|штука
Котлета рыбная||170|12|8|12|80|штука
Куриная грудка отварная|грудка курица вареная|135|28|2|0|150|порция
Куриная грудка жареная|грудка жареная|160|28|5|0|150|порция
Курица запечённая|курица куриное бедро окорочок|210|21|14|0|200|порция
Гуляш||150|14|9|3|200|порция
Плов||180|7|8|20|250|порция
Шашлык свиной|шашлык|250|19|19|1|200|порция
Шашлык куриный||170|22|9|1|200|порция
Тефтели||160|10|9|10|200|порция
Голубцы||110|6|5|10|250|порция
Отбивная свиная|отбивная|260|18|19|5|150|штука
Бефстроганов||190|15|13|4|200|порция
Печень жареная|печень печенка|200|22|9|6|150|порция
Пельмени варёные|пельмени|250|12|12|25|250|порция
Вареники с картошкой|вареники|150|4|4|25|250|порция
Манты||220|10|10|22|250|порция
Хинкали||220|10|10|22|100|штука
Шаурма||220|9|11|21|350|штука
Бургер|гамбургер чизбургер|260|13|12|26|200|штука
Пицца|пиццы|260|11|10|31|120|кусок
Ролл Филадельфия|роллы суши|170|7|6|22|250|порция
Ролл Калифорния||150|5|5|21|250|порция
Лазанья||170|9|9|13|250|порция
Спагетти болоньезе|болоньезе|150|7|5|19|300|тарелка
Паста карбонара|карбонара|200|8|9|21|300|тарелка
Омлет||150|10|11|2|150|порция
Яичница|глазунья|200|13|16|1|110|порция
Яйцо варёное|яйцо яйца вареные|155|12.7|11|0.7|55|штука
Сырники||220|13|10|19|60|штука
Блины|блин блинчики|230|6|9|31|50|штука
Оладьи|оладушки|270|6|11|36|40|штука
Запеканка творожная|запеканка|170|14|6|15|150|порция
Гречка с мясом||150|9|6|15|250|порция
Рыба жареная|рыба|170|18|9|5|150|порция
Лосось запечённый|лосось семга форель|200|20|13|0|150|порция
Минтай отварной|минтай|80|17|1|0|150|порция
Сельдь солёная|селедка сельдь|220|17|17|0|50|порция
Оливье||200|5|17|7|150|порция
Цезарь с курицей|цезарь|190|10|14|7|200|порция
Винегрет||75|1.5|4.5|8|150|порция
Греческий салат||90|2.5|7|4|200|порция
Салат из свежих овощей|овощной салат огурцы помидоры|70|1|5|4|150|порция
Селёдка под шубой|шуба|180|6|14|7|150|порция
Салат из капусты|капустный салат|50|1.5|3|5|150|порция
Мимоза||210|8|17|5|150|порция
Пирожок с капустой|пирожок|230|5|8|33|80|штука
Пирожок с картошкой||240|5|9|35|80|штука
Беляш||290|10|17|25|100|штука
Круассан||410|8|21|45|60|штука
Пончик||380|6|20|44|70|штука
Пирожное картошка||380|6|19|47|50|штука
Торт медовик|медовик торт|400|5|20|50|100|кусок
Торт наполеон|наполеон|380|5|22|40|100|кусок
Шоколад молочный|шоколад|550|7|34|54|20|долька
Конфеты шоколадные|конфета конфеты|520|5|30|58|12|штука
Печенье|печенька|450|6|18|66|15|штука
Мороженое пломбир|мороженое|230|3.5|15|21|80|штука
Зефир||320|1|0|79|30|штука
Мармелад||320|0|0|80|10|штука
Вафли|вафля|520|5|30|60|15|штука
Халва||520|12|30|55|30|порция
Мёд||320|0.5|0|81|12|ложка
Варенье|джем|270|0.3|0|70|15|ложка
Сахар||400|0|0|100|5|ч. ложка
Молоко 2,5%|молоко|52|2.8|2.5|4.7|250|стакан
Кефир 1%|кефир|40|3|1|4|250|стакан
Кефир 2,5%||53|3|2.5|4|250|стакан
Йогурт питьевой||80|3|2|12|250|бутылка
Сметана 15%|сметана|160|2.6|15|3|20|ложка
Сметана 20%||205|2.5|20|3.4|20|ложка
Творог 5%||120|17|5|2|200|упаковка
Творог 9%||160|16|9|2|200|упаковка
Сыр твёрдый|сыр|360|25|28|0|20|ломтик
Сыр плавленый||250|10|20|5|20|ломтик
Моцарелла||250|18|19|1|125|упаковка
Брынза|фета|260|18|20|0|30|порция
Масло сливочное|масло|750|0.5|82|0.8|10|порция
Сливки 10%|сливки|120|3|10|4|10|порция
Сырок глазированный|сырок|410|8|25|38|45|штука
Хлеб белый|хлеб|260|8|3|50|30|ломтик
Хлеб чёрный|ржаной бородинский|210|6.5|1.5|42|30|ломтик
Лаваш||275|9|1|57|50|порция
Хлебцы||300|10|3|60|10|штука
Яблоко|яблоки|47|0.4|0.4|10|180|штука
Апельсин|апельсины|43|0.9|0.2|8|200|штука
Мандарин|мандарины|38|0.8|0.2|7.5|70|штука
Груша|груши|47|0.4|0.3|10|180|штука
Банан|бананы|89|1.1|0.3|23|120|штука
Виноград||70|0.6|0.2|17|150|порция
Киви||50|1|0.5|10|75|штука
Персик|персики|45|0.9|0.1|10|150|штука
Клубника||35|0.8|0.4|7.5|150|порция
Арбуз||30|0.6|0.2|7.5|300|кусок
Дыня||35|0.6|0.3|8|200|кусок
Огурец|огурцы|15|0.8|0.1|3|100|штука
Помидор|помидоры томат|20|0.9|0.2|4|120|штука
Морковь|морковка|35|1.3|0.1|7|80|штука
Капуста||27|1.8|0.1|5|100|порция
Авокадо||160|2|15|9|150|штука
Брокколи||34|2.8|0.4|7|150|порция
Кофе чёрный|кофе американо эспрессо|2|0.2|0|0.3|200|чашка
Капучино||45|2.5|2.3|4|250|чашка
Латте||50|2.6|2.4|4.3|300|стакан
Чай без сахара|чай|1|0|0|0.2|250|кружка
Сок апельсиновый|сок|45|0.7|0.2|10|250|стакан
Кола|кока-кола пепси|42|0|0|10.6|330|банка
Пиво||43|0.5|0|3.5|500|бутылка
Вино сухое|вино|70|0|0|0.3|150|бокал
Компот||60|0.2|0|15|250|стакан
Морс||40|0.1|0|10|250|стакан
Энергетик||45|0|0|11|450|банка
Орехи грецкие|орехи|650|15|65|7|30|горсть
Миндаль||600|19|53|13|30|горсть
Арахис||550|26|45|10|30|горсть
Семечки подсолнечника|семечки|580|21|50|10|30|горсть
Чипсы||530|6|33|52|140|пачка
Попкорн||400|8|20|55|50|порция
Батончик протеиновый|протеиновый батончик|360|30|12|35|50|штука
Батончик мюсли|мюсли|400|5|12|65|25|штука
Майонез||630|0.4|67|3|15|ложка
Кетчуп||100|1.5|0.2|23|15|ложка
Масло растительное|подсолнечное оливковое|900|0|100|0|10|ложка
Соевый соус||50|6|0|6|15|ложка
Хумус||250|8|15|20|50|порция
Арахисовая паста||600|25|50|20|15|ложка`.split("\n").map(l => { const [name, alias, kcal, p, f, c, pc, pcName] = l.split("|");
    return {id: "d:" + name, name, alias, kcal: +kcal, p: +p, f: +f, c: +c, ...(+pc ? {pc: +pc, pcName} : {}), ref: true}; });

  // слова считаются одинаковыми, если у них общее начало («банан» ~ «бананы», «сыр» ~ «сыром»)
  const stemEq = (a, b) => {
    if (a === b) return true;
    const [s, l] = a.length <= b.length ? [a, b] : [b, a];
    if (l.length - s.length > 3) return false;
    let cp = 0; while (cp < s.length && s[cp] === l[cp]) cp++;
    return s.length <= 4 ? cp >= 3 && (cp === s.length || a.length === b.length) : cp >= s.length - 1;
  };
  const wordEq = (w, x) => stemEq(w, x) || (/^картош(к|ек)/.test(w) && /^карто[фш]/.test(x)); // «картошка» — и картофель, и картошарики
  // ошибки диктовки: «карташарики», «карта шарики» → картошарики (сравнение с допуском 1–2 буквы)
  const lev = (a, b) => { const d = Array.from({length: b.length + 1}, (_, j) => j);
    for (let i = 1; i <= a.length; i++){ let prev = d[0]; d[0] = i;
      for (let j = 1; j <= b.length; j++){ const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; } }
    return d[b.length]; };
  const fuzzyEq = (w, x) => { const L = Math.min(w.length, x.length); if (L < 5 || Math.abs(w.length - x.length) > 3) return false;
    return lev(w.slice(0, L - 1), x.slice(0, L - 1)) <= (L >= 8 ? 2 : 1); };
  const wordsOf = s => (sayNorm(s).match(/[a-zа-я]+/g) || []).filter(w => w.length >= 3);
  const foodWords = f => wordsOf(f.name + " " + (f.brand || ""));
  // запомненный выбор: «сосиска» → продукт, который ты выбрал в прошлый раз (хранится на телефоне)
  const SAYKEY = "kcal_say";
  const sayMem = () => { try { return JSON.parse(localStorage.getItem(SAYKEY)) || {}; } catch { return {}; } };
  const sayKey = words => words.filter(w => /[a-zа-я]{3}/.test(w)).map(w => w.slice(0, 5)).sort().join(" ");
  // лучшие варианты для слов названия: сначала мой каталог (частые и недавние выше), справочник блюд — ниже.
  // list — искать в своём списке (записи дня для «убери банан»)
  function sayCands(words, list){
    const ws = words.filter(w => /[a-zа-я]{3}/.test(w));
    if (!ws.length) return [];
    const pool = list || [...foods, ...DISHES];
    const strict = sayScore(ws, pool, wordEq, !list, false);
    if (list || strict[0]?.m === ws.length) return strict;
    const fz = sayScore(ws, pool, fuzzyEq, true, true); // совпало не всё — может, диктовка исказила слово
    return fz[0]?.m > (strict[0]?.m || 0) ? fz : strict;
  }
  function sayScore(ws, pool, eq, mine, fuzzy){
    const u = usage(), rc = recent().map(r => r.name), want = mine ? sayMem()[sayKey(ws)] : null;
    const joined = fuzzy ? ws.slice(1).map((w, i) => ws[i] + w) : []; // «карта шарики» → «карташарики»
    return pool.map(f => {
      // «Как я называю» (alias) в карточке продукта — мои слова для него: «картошка», «шарики»
      const fw = foodWords(f), aw = wordsOf(f.alias || ""); let m = 0, ma = 0;
      for (const w of ws){ if (aw.some(x => eq(w, x))){ m++; ma++; } else if (fw.some(x => eq(w, x))) m++; }
      for (const w of joined) if (fw.some(x => eq(w, x)) || aw.some(x => eq(w, x))) m += 2;
      if (f.id === want) m = Math.max(m, ws.length); // выбирал его раньше на эти же слова
      if (!m) return null;
      m = Math.min(m, ws.length);
      const ri = rc.indexOf(foodName(f));
      const sc = m * 10 + (fw[0] && ws.some(w => eq(w, fw[0])) ? 5 : 0) + (ma ? 3 : 0) + (f.id === want ? 100 : 0) + (f.ref ? -6 : 0)
        - (ws.length - m) * 4 - Math.max(0, fw.length - m) * 0.4
        + Math.min(useN(u, f.id), 10) * 0.3 + (ri >= 0 ? 1 - ri * 0.05 : 0) + (f.fav ? 0.5 : 0);
      return {f, sc, m};
    }).filter(c => c && c.m / ws.length >= 0.5).sort((a, b) => b.sc - a.sc).slice(0, 5);
  }
  // сколько граммов: «150 г» — граммы, «2 куска» — штуки × вес штуки, «тарелка» — бытовая мера, голое «2» — штуки
  const sayPcs = q => q && (q.u === "pc" || (q.u === null && q.n <= 6)); // «1 сосиска», «яйца 2» — штуки
  function sayGrams(r){
    const f = r.cands[r.fi].f, q = r.q; r.est = false; r.pcs = null; r.mlab = null;
    if (!q){ r.g = defaultG(f); r.est = true; return; }
    if (q.u === "g"){ r.g = r1(q.n * q.k); return; }
    if (!sayPcs(q)){ r.g = r1(q.n); return; }
    const ms = q.mw && MEASURES.find(([re]) => re.test(q.mw));
    const own = f.pc && (!ms || sayNorm(f.pcName || "штука").slice(0, 4) === ms[2].slice(0, 4)); // «ложка сиропа» — его собственная ложка
    if (own){ r.g = r1(q.n * f.pc); r.pcs = q.n; }
    else if (ms){ r.g = r1(q.n * ms[1]); r.mlab = ms[2]; r.mn = q.n; }
    else { r.g = defaultG(f); r.est = true; }
  }
  // «343 г картошки, из них 1 сосиска»: вес вложенного вычитается из основного блюда
  function saySettle(rows){
    for (const p of rows) if (p.kids?.length){
      p.sub = p.kids.filter(k => k.on !== false).reduce((s, k) => s + num(k.g), 0);
      p.g = Math.max(0, r1(p.base - p.sub)); p.pcs = null; p.mlab = null;
    }
  }
  const sayKnown = w => [...foods, ...DISHES].some(f => foodWords(f).some(x => stemEq(w, x)));
  function sayParse(text){
    let tx = sayNorm(text).replace(/чайн[а-я]* ложк[а-я]*/g, "чл").replace(/столов[а-я]* ложк/g, "ложк");
    // «как вчера на завтрак» — скопировать приём из другого дня (вырезаем, чтобы «вчера» не стало датой записи)
    let copy = null; const cm = tx.match(COPY_RE), cm2 = !cm && tx.match(COPY2_RE);
    if (cm){ const d = cm[1]; copy = {ref: d === "вчера" ? -1 : d === "позавчера" ? -2 : "w" + WD[d.replace(/^в\s+/, "")], meal: cm[2] ? SAY_MEALS.find(([re]) => re.test(cm[2]))[1] : null}; tx = tx.replace(cm[0], " , "); }
    else if (cm2){ copy = {ref: cm2[1] === "вчерашн" ? -1 : -2, meal: SAY_MEALS.find(([re]) => re.test(cm2[2]))[1]}; tx = tx.replace(cm2[0], " , "); }
    const has1 = re => new RegExp("(^|[^а-я])(" + re + ")(?![а-я])").test(tx);
    const dayOff = has1("позавчера") ? -2 : has1("вчера") ? -1 : has1("сегодня") ? 0 : null; // от настоящего «сегодня»
    // «из них», «в том числе», «включая»… — следующий кусок фразы лежит внутри предыдущего (помечаем знаком §)
    const clauses = tx.replace(/(^|[\s,;])(из них|в том числе|включая|в них была|в них были|в них было|в них был|в них|в нем была|в нем были|в нем было|в нем был|в нем|в ней была|в ней были|в ней было|в ней был|в ней|там была|там были|там было|там был|среди них была|среди них были|из которых|из этого|вычти|вычесть|минус|не считая)(?=\s)/g, "$1, § ").split(/[,;\n!?]+|\.(?!\d)|\s(?:и|плюс|еще|потом|затем)\s/);
    const rows = [], miss = [], edits = []; let stick = null, lastMain = null, firstMeal = null, act = "add";
    for (const cl of clauses){
      const toks = cl.match(/§|\d+(?:\.\d+)?%?|[a-zа-я]+/g) || [], els = []; let clMeal = null, clFrom = null, inner = false;
      for (let i = 0; i < toks.length; i++){
        const t = toks[i];
        if (t === "§"){ inner = true; continue; }
        if (SAY_VERB.test(t)){ act = verbOf(t); continue; } // глагол действует и на следующие куски: «убери банан и творог»
        if (/^\d/.test(t)){ if (!t.endsWith("%")) els.push({n: parseFloat(t)}); continue; } // «0,3%» — часть названия
        if (NUMW.hasOwnProperty(t)){ let v = 0; while (i < toks.length && NUMW.hasOwnProperty(toks[i])) v += NUMW[toks[i++]]; i--; els.push({n: v}); continue; }
        // «полпачки», «полсамсы» — половина
        if (/^пол[а-я]{3,}/.test(t)){ const rest = t.slice(3); if (U_PC.test(rest) || U_G.hasOwnProperty(rest) || sayKnown(rest)){ els.push({n: 0.5}, {w: rest}); continue; } }
        const ml = SAY_MEALS.find(([re]) => re.test(t));
        if (ml){ if (["из", "с", "со"].includes(toks[i - 1])) clFrom = ml[1]; else clMeal = ml[1]; continue; }
        els.push({w: t});
      }
      if (clMeal && act === "add"){ stick = clMeal; firstMeal ||= clMeal; }
      const items = [];
      for (let i = 0; i < els.length; i++){
        const e = els[i];
        if (e.n !== undefined){
          const nx = els[i + 1]?.w; let u = null, k = 1, mw = null;
          if (nx && U_G.hasOwnProperty(nx)){ u = "g"; k = U_G[nx]; i++; } else if (nx && U_PC.test(nx)){ u = "pc"; mw = nx; i++; }
          items.push({q: {n: e.n, u, k, mw}});
        } else if (!SAY_FILL.has(e.w) && !U_G.hasOwnProperty(e.w)){
          if (U_PC.test(e.w)){ if (MEASURES.some(([re]) => re.test(e.w))) items.push({q: {n: 1, u: "pc", k: 1, mw: e.w}}); } // «тарелка борща» = 1 тарелка
          else items.push({w: SAY_SYN[e.w] || e.w});
        }
      }
      // «хлеб 2 куска» — количество после названия; «два куска хлеба» — перед названием
      const pairs = []; let run = [], pend = null;
      if (items[0]?.q){
        for (const x of items){ if (x.q){ if (run.length){ pairs.push([run, pend]); run = []; } pend = x.q; } else run.push(x.w); }
        if (run.length) pairs.push([run, pend]);
      } else {
        for (const x of items){ if (x.q){ if (run.length){ pairs.push([run, x.q]); run = []; } } else run.push(x.w); }
        if (run.length) pairs.push([run, null]);
      }
      for (const [words, q] of pairs){
        if (act !== "add"){ edits.push({act, words, q, from: clFrom || (act === "move" ? null : clMeal), to: act === "move" ? clMeal : null}); continue; }
        const cands = sayCands(words);
        if (!cands.length){ miss.push(words.join(" ")); continue; }
        // названы штуки — из одинаково подходящих берём тот, у которого известен вес штуки
        const fi = sayPcs(q) && !q.mw?.match(/^(тарел|миск|стакан|кружк|чашк|чл|ложк|ложек|горст|ломт)/) ? Math.max(0, cands.findIndex(c => c.m === cands[0].m && c.f.pc)) : 0;
        const has = x => cands.some(c => c.m === cands[0].m && c.f === x.cands[x.fi].f); // тот же продукт, что уже назван
        // «вычти сосиску», «запиши картошку отдельно» — это о том, что уже названо, а не новая еда
        if (inner && lastMain?.kids?.some(has)) continue;
        if (!q && rows.some(has)) continue;
        const r = {cands, fi, q, meal: stick, key: sayKey(words)}; sayGrams(r); r.base = r.g;
        if (inner && lastMain){ r.parent = lastMain; (lastMain.kids ||= []).push(r); } else lastMain = r;
        rows.push(r);
      }
    }
    rows.forEach(r => r.meal ||= firstMeal); // «… запиши в завтрак» в конце — тоже про всё сказанное раньше
    saySettle(rows);
    return {rows, miss, edits, dayOff, copy, meal: firstMeal};
  }
  // </parse>

  function saySheet(){
    let meal = guessMeal(), parsed = {rows: [], miss: [], edits: []}, tm, seq = 0;
    // куда писать: «вчера» / «позавчера» во фразе — от настоящего сегодня, иначе открытый день
    const targetOf = p => p.dayOff == null ? cur : addDays(todayIso(), p.dayOff), target = () => targetOf(parsed);
    const dayLabel = d => d === todayIso() ? "сегодня" : d === addDays(todayIso(), -1) ? "вчера, " + ruDate(d) : ruDate(d);
    const docOf = async d => d === cur ? day : weekDocs[d] || await Store.read(dayPath(d)).then(r => r?.data || blank(d), () => blank(d));
    const mealOf = it => MEALS.includes(it.meal) ? it.meal : "Перекус";
    // «как в среду»: ближайшая прошедшая среда
    const copyDate = ref => { if (typeof ref === "number") return addDays(todayIso(), ref);
      const wd = +ref.slice(1); for (let i = 1; i <= 7; i++){ const d = addDays(todayIso(), -i); if (parseIso(d).getDay() === wd) return d; } };
    openSheet(`<h2>Что съел?</h2>
      <div class="hint">Напиши или надиктуй (микрофон на клавиатуре). Например: «картошарики 150 г, два куска хлеба фитнес», «343 г картошариков, из них одна сосиска», «тарелка борща», «как вчера на завтрак». Исправить: «поправь творог на 200», «убери банан из перекуса», «перенеси творог в ужин».</div>
      <textarea class="say" id="sayT" rows="3" placeholder="Что и сколько съел…" aria-label="Что съел" autocomplete="off"></textarea>
      <div class="sayday" id="sayDay"></div>
      <div class="cap">Приём пищи</div>
      <div class="chips seg" id="sayMeal">${MEALS.map(m => `<button class="chip${m === meal ? " on" : ""}" data-m="${m}">${m}</button>`).join("")}</div>
      <div id="sayRows"></div>
      <div class="sayfoot"><button class="btn" id="sayAdd" disabled>Добавить</button></div>`);
    try { $("sayT").focus({preventScroll: true}); } catch {} // в том же нажатии — тогда iOS сразу открывает клавиатуру
    const X = `<svg viewBox="0 0 24 24" class="ico" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>`;
    const live = () => parsed.rows.filter(r => r.on !== false && r.g > 0);
    const plan = () => (parsed.plan || []).filter(x => !x.miss);
    const total = () => {
      const k = live().reduce((s, r) => s + portionOf(r.cands[r.fi].f, r.g).kcal, 0), n = live().length, e = plan().length;
      $("sayAdd").disabled = !n && !e;
      $("sayAdd").textContent = [n ? `Добавить · ${fmt(k)} ккал` : "", e ? `${n ? "изменить" : "Изменить"} · ${e}` : ""].filter(Boolean).join(" · ") || "Добавить";
    };
    const upd = i => {
      const r = parsed.rows[i], el = $("sayRows").querySelector(`[data-i="${i}"]`); if (!el) return;
      const f = r.cands[r.fi].f, c = portionOf(f, r.g);
      el.querySelector(".sres").textContent = `${fmt(c.kcal)} ккал · Б ${fmt(c.p, 1)} · Ж ${fmt(c.f, 1)} · У ${fmt(c.c, 1)}`;
      const n = el.querySelector(".snote");
      const kids = (r.kids || []).filter(k => k.on !== false);
      n.textContent = [r.meal && r.meal !== meal ? "→ " + r.meal.toLowerCase() : "",
        kids.length ? `${fmt(r.base)} г всего − ${kids.map(k => `${k.cands[k.fi].f.name.split(" ")[0].toLowerCase()} ${fmt(k.g)} г`).join(", ")}` : "",
        r.pcs ? `${fmt(r.pcs, 1)} × ${pcLabel(f)} ${fmt(f.pc)} г` : "",
        r.mlab ? `${fmt(r.mn, 1)} × ${r.mlab} ≈ ${fmt(r.g)} г` : "",
        f.ref ? "≈ справочные КБЖУ, не из каталога" : "",
        r.est ? (r.q ? "Вес порции у продукта не указан — поставил обычную, проверь граммы" : "Количество не названо — поставил обычную порцию, проверь граммы") : ""].filter(Boolean).join(" · ");
      n.hidden = !n.textContent; n.classList.toggle("warn", r.est);
    };
    const paintMeal = () => $("sayMeal").querySelectorAll(".chip").forEach(x => x.classList.toggle("on", x.dataset.m === meal));
    // после правки одной строки пересчитать связанные («всего − вложенное») и обновить цифры
    const sync = () => { saySettle(parsed.rows);
      $("sayRows").querySelectorAll("[data-i]").forEach(el => { const i = +el.dataset.i, inp = el.querySelector(".sg");
        if (inp !== document.activeElement) inp.value = r1(parsed.rows[i].g); upd(i); }); total(); };
    const draw = () => {
      const d = target(); $("sayDay").textContent = "Запишу в: " + dayLabel(d); $("sayDay").classList.toggle("other", d !== cur);
      const ms = new Set(parsed.rows.map(r => r.meal)); // во всей фразе один приём («на ужин …») — выбираем его
      if (ms.size === 1 && [...ms][0]){ meal = [...ms][0]; paintMeal(); }
      $("sayRows").innerHTML = (parsed.plan || []).map(x => x.miss ? `<div class="hint warnline">${esc(x.miss)}</div>` : `<div class="erow">${esc(x.text)}</div>`).join("")
        + (parsed.copyNote ? `<div class="hint ${parsed.copyEmpty ? "warnline" : ""}">${esc(parsed.copyNote)}</div>` : "")
        + parsed.rows.map((r, i) => `<div class="srow" data-i="${i}">
        <select class="sname" aria-label="Продукт">${r.cands.map((c, j) => `<option value="${j}"${j === r.fi ? " selected" : ""}>${esc(foodName(c.f))}${c.f.ref ? " · ≈" : ""}</option>`).join("")}</select>
        <div class="sline"><input class="sg" inputmode="decimal" value="${r1(r.g)}" aria-label="Граммы"><span class="su">г</span><span class="sres"></span><button class="sx" data-x="${i}" aria-label="Убрать">${X}</button></div>
        <small class="snote" hidden></small></div>`).join("")
        + (parsed.miss.length ? `<div class="hint warnline">Не нашёл ни в каталоге, ни в справочнике: ${esc(parsed.miss.join(", "))}. Добавь через «+» у приёма пищи.</div>` : "");
      parsed.rows.forEach((_, i) => upd(i)); total();
    };
    // строки из записей другого дня («как вчера на завтрак»): тот же продукт и вес
    const fromItem = (it, m) => {
      const g = num(it.g) || 100, k = 100 / g, real = foods.find(f => f.id === it.food);
      const f = real || {id: it.food, name: it.name, short: it.short, kcal: num(it.kcal) * k, p: num(it.p) * k, f: num(it.f) * k, c: num(it.c) * k, ...(it.pcs ? {pc: g / it.pcs, pcName: it.pcName} : {})};
      const r = {cands: [{f, m: 1}], fi: 0, q: null, meal: m, key: "", g, base: g};
      if (it.pcs && f.pc){ r.pcs = it.pcs; }
      return r;
    };
    // «убери банан», «поправь творог на 200», «перенеси творог в ужин» — ищем в записях дня
    const planEdits = async p => {
      const d = targetOf(p), items = (await docOf(d)).items || [], out = [], used = new Set();
      for (const e of p.edits){
        const what = e.words.join(" ");
        const pool = items.filter(it => !used.has(it.id) && (!e.from || mealOf(it) === e.from)).map(it => ({id: it.id, name: it.name, it}));
        const c = sayCands(e.words, pool)[0];
        if (!c){ out.push({miss: `Не нашёл в ${dayLabel(d)}${e.from ? " (" + e.from.toLowerCase() + ")" : ""}: ${what}`}); continue; }
        const it = c.f.it; used.add(it.id);
        if (e.act === "del"){ out.push({it, del: true, text: `Удалить: ${it.name} · ${mealOf(it).toLowerCase()} · ${fmt(it.kcal)} ккал`}); continue; }
        if (e.act === "move"){
          if (!e.to || e.to === mealOf(it)){ out.push({miss: `Куда перенести «${what}»? Скажи: «перенеси ${what} в ужин»`}); continue; }
          out.push({it, put: {...it, meal: e.to}, text: `${it.name}: ${mealOf(it).toLowerCase()} → ${e.to.toLowerCase()}`}); continue;
        }
        const g0 = num(it.g);
        if (!e.q || !g0){ out.push({miss: `Сколько должно быть «${what}»? Скажи: «поправь ${what} на 200 грамм»`}); continue; }
        const per = g0 / (num(it.pcs) || 1), pcs = e.q.u !== "g" && sayPcs(e.q) && it.pcs;
        const g = r1(e.q.u === "g" ? e.q.n * e.q.k : pcs ? e.q.n * per : e.q.n), k = g / g0;
        const put = {...it, g, kcal: Math.round(num(it.kcal) * k), p: r1(num(it.p) * k), f: r1(num(it.f) * k), c: r1(num(it.c) * k)};
        if (pcs) put.pcs = e.q.n; else { delete put.pcs; delete put.pcName; }
        out.push({it, put, text: `${it.name}: ${fmt(g0)} г → ${fmt(g)} г · ${fmt(it.kcal)} → ${fmt(put.kcal)} ккал`});
      }
      return out;
    };
    const rebuild = async () => {
      const my = ++seq, p = sayParse($("sayT").value);
      if (p.copy){
        const src = copyDate(p.copy.ref), its = ((await docOf(src)).items || []).filter(it => !p.copy.meal || mealOf(it) === p.copy.meal);
        const what = `${p.copy.meal ? p.copy.meal.toLowerCase() + " · " : ""}${dayLabel(src)}`;
        p.copyNote = its.length ? `Повторяю: ${what}` : `В ${what} ничего не записано`; p.copyEmpty = !its.length;
        if (!p.meal && p.copy.meal) p.rows.forEach(r => r.meal ||= p.copy.meal); // «как вчера на ужин и борщ» — борщ тоже в ужин
        p.rows = [...its.map(it => fromItem(it, p.meal || p.copy.meal || mealOf(it))), ...p.rows];
      }
      if (p.edits.length) p.plan = await planEdits(p);
      if (my !== seq) return; // пока ждали другой день, фразу уже поменяли
      parsed = p; draw();
    };
    $("sayT").oninput = () => { clearTimeout(tm); tm = setTimeout(rebuild, 200); };
    $("sayMeal").onclick = e => { const b = e.target.closest("[data-m]"); if (!b) return; meal = b.dataset.m; paintMeal();
      parsed.rows.forEach((r, i) => { r.meal = null; upd(i); }); }; // выбранный вручную приём важнее сказанного
    const rowOf = e => { const el = e.target.closest("[data-i]"); return el ? [parsed.rows[+el.dataset.i], +el.dataset.i, el] : []; };
    $("sayRows").onchange = e => { const [r] = rowOf(e); if (!r || !e.target.classList.contains("sname")) return;
      r.fi = +e.target.value; if (r.q){ sayGrams(r); r.base = r.g; } sync(); };
    $("sayRows").oninput = e => { const [r] = rowOf(e); if (!r || !e.target.classList.contains("sg")) return;
      r.g = num(String(e.target.value).replace(",", ".")); r.pcs = null; r.est = false; r.mlab = null;
      if (r.kids?.length) r.base = r.g + r.sub; // правим «осталось» у основного блюда — общий вес пересчитывается
      sync(); };
    $("sayRows").onclick = e => { const x = e.target.closest("[data-x]"); if (!x) return;
      const [r, , el] = rowOf(e); r.on = false; el.hidden = true; sync(); };
    $("sayAdd").onclick = () => {
      const d = target(), where = d === cur ? "" : ` · ${dayLabel(d)}`, msgs = [], undo = [];
      // исправления дня
      const ch = plan();
      if (ch.length){
        const puts = ch.filter(x => x.put).map(x => x.put), dels = ch.filter(x => x.del).map(x => x.it.id);
        if (puts.length) mutateDay(d, {t: "puts", items: puts}, `исправлено (фразой): ${puts.map(x => x.name).join(", ")}`);
        if (dels.length) mutateDay(d, {t: "dels", ids: dels}, `удалено (фразой): ${ch.filter(x => x.del).map(x => x.it.name).join(", ")}`);
        undo.push(() => mutateDay(d, {t: "puts", items: ch.map(x => x.it)}, "отменено: исправление фразой"));
        msgs.push(`Изменено ${ch.length}`);
      }
      // новая еда
      const rows = live();
      if (rows.length){
        const items = rows.map(r => { const f = r.cands[r.fi].f;
          const out = {id: newId("m"), name: foodName(f), meal: r.meal || meal, time: nowTime(), g: r1(r.g), ...portionOf(f, r.g)};
          if (f.id && !f.ref) out.food = f.id;
          if (r.pcs){ out.pcs = r.pcs; out.pcName = pcLabel(f); }
          if (f.short) out.short = f.short; return out; });
        // запомнить выбор там, где было из чего выбирать: в следующий раз подставится сразу
        const mem = sayMem(); rows.forEach(r => { if (r.cands.length > 1 && r.key) mem[r.key] = r.cands[r.fi].f.id; }); localStorage.setItem(SAYKEY, JSON.stringify(mem));
        items.forEach(remember); bumpUsage(items);
        mutateDay(d, {t: "puts", items}, `добавлено (фразой): ${items.map(x => x.name).join(", ")}`);
        undo.push(() => mutateDay(d, {t: "dels", ids: items.map(x => x.id)}, "отменено: что съел"));
        msgs.push(`Добавлено ${items.length} · ${fmt(items.reduce((s, x) => s + x.kcal, 0))} ккал`);
      }
      if (!msgs.length) return;
      closeSheet();
      toast(msgs.join(" · ") + where, "Отменить", () => undo.forEach(f => f()));
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
    const pickMeal = !meal; // открыли из шапки — приём выберем в окне граммов
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
      if (mine) return portionSheet(mine, pickMeal ? null : meal, false);
      openSheet(`<h2>Штрихкод ${esc(code)}</h2><div class="empty">Ищу в базе…</div>`);
      let p = null;
      try { p = await offByCode(code); }
      catch { return openSheet(`<h2>Штрихкод ${esc(code)}</h2><div class="empty">База не ответила. Проверь интернет и попробуй ещё раз.</div><button class="btn" id="sretry">Повторить</button>`), $("sretry").onclick = () => { alive = true; found(code); }; }
      const done = f => portionSheet(f, pickMeal ? null : meal, false);
      if (p && p.kcal != null) return portionSheet(p, pickMeal ? null : meal, true);
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

  // ================= ПРОГРЕСС: вес и неделя =================
  let wRange = 90; // период графика веса, дней (0 — всё время)
  // тренд веса — сглаживание (как в «умных» весах): не скачет от воды и соли
  const trendOf = list => { let t = null; return list.map(w => (t = t == null ? w.kg : t + 0.25 * (w.kg - t))); };
  const kgFmt = v => fmt(v, 1).replace(".", ",");
  // «+0,4» / «−1,2» / «0» — без «−0» из-за округления
  const signed = v => { const r = Math.round(v * 10) / 10; return r === 0 ? "0" : (r > 0 ? "+" : "−") + kgFmt(Math.abs(r)); };
  function weightAt(daysAgo){ const d = addDays(todayIso(), -daysAgo); let r = null; for (const w of weights) if (w.date <= d) r = w; return r; }

  function renderWeight(){
    const box = $("wCard"); if (!box) return;
    if (!weights.length){
      box.innerHTML = `<div class="cap">Вес</div><div class="empty">Добавь вес — здесь появится график и тренд</div><button class="btn" id="wAdd">Записать вес</button>`;
      return void ($("wAdd").onclick = () => weightSheet());
    }
    const trAll = trendOf(weights), from = wRange ? addDays(todayIso(), -wRange) : "", i0 = Math.max(0, weights.findIndex(w => w.date >= from));
    const list = weights.slice(i0), tr = trAll.slice(i0), last = list[list.length - 1], tNow = tr[tr.length - 1];
    const ago = weightAt(30), diff = ago && ago.date !== last.date ? last.kg - ago.kg : null;
    const goal = num(goals.weightGoal), rate = weeklyRate();
    // график: точки — замеры, линия — тренд
    const W = 300, Hh = 110, pad = 6, vals = [...list.map(w => w.kg), ...tr, ...(goal ? [goal] : [])];
    const lo = Math.min(...vals) - 0.5, hi = Math.max(...vals) + 0.5;
    const x = i => pad + (list.length === 1 ? (W - 2 * pad) / 2 : i * (W - 2 * pad) / (list.length - 1));
    const y = v => pad + (hi - v) / (hi - lo) * (Hh - 2 * pad);
    const line = tr.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
    box.innerHTML = `<div class="cap row">Вес<button class="addpill" id="wAdd" aria-label="Записать вес"><svg viewBox="0 0 24 24" class="ico" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>Записать</button></div>
      <div class="wrow"><b class="big2">${kgFmt(last.kg)}<small> кг</small></b>
        <span class="wmeta">${diff != null ? `<em class="${diff <= 0 ? "down" : "up"}">${signed(diff)} кг</em> за 30 дней<br>` : ""}тренд ${kgFmt(tNow)} кг${rate != null ? ` · ${signed(rate)} кг/нед` : ""}${goal ? `<br>до цели ${kgFmt(Math.max(0, tNow - goal))} кг${rate < 0 && tNow > goal ? ` · ≈ ${Math.ceil((tNow - goal) / -rate)} нед.` : ""}` : ""}</span></div>
      <svg class="wchart" viewBox="0 0 ${W} ${Hh}" preserveAspectRatio="none" role="img" aria-label="График веса: сейчас ${kgFmt(last.kg)} кг, тренд ${kgFmt(tNow)} кг">
        ${goal ? `<line x1="0" x2="${W}" y1="${y(goal)}" y2="${y(goal)}" class="goal"/>` : ""}
        <path d="${line}" class="trend"/>
        ${list.map((w, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(w.kg).toFixed(1)}" r="2.6" class="pt"/>`).join("")}
      </svg>
      <div class="chips seg three wrange" id="wRange">${[[30, "30 дней"], [90, "90 дней"], [0, "Всё"]].map(([v, t]) => `<button class="chip${v === wRange ? " on" : ""}" data-r="${v}">${t}</button>`).join("")}</div>
      <div class="wlegend"><span><i class="pt"></i>замеры</span><span><i class="tr"></i>тренд</span>${goal ? `<span><i class="gl"></i>цель ${kgFmt(goal)}</span>` : ""}</div>
      <button class="goalrow" id="wGoal">${goal ? `Цель: <b>${kgFmt(goal)} кг</b>` : "Задать цель по весу"}<svg viewBox="0 0 24 24" class="ico" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4"/></svg></button>
      <div class="whist">${weights.slice(-3).reverse().map(w => `<button class="whrow" data-wd="${w.date}"><span>${esc(w.date === todayIso() ? "Сегодня" : ruDate(w.date))}</span><b>${kgFmt(w.kg)} кг</b></button>`).join("")}</div>
      ${weights.length > 3 ? `<button class="goalrow" id="wAll">Вся история · ${weights.length}<svg viewBox="0 0 24 24" class="ico" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></button>` : ""}`;
    $("wAdd").onclick = () => weightSheet();
    if ($("wAll")) $("wAll").onclick = () => historySheet("w");
    $("wRange").onclick = e => { const b = e.target.closest("[data-r]"); if (b){ wRange = num(b.dataset.r); renderWeight(); } };
    $("wGoal").onclick = goalSheet;
    box.querySelector(".whist").onclick = e => { const b = e.target.closest("[data-wd]"); if (b) weightSheet(weights.find(w => w.date === b.dataset.wd)); };
  }

  // запись веса за любую дату (по умолчанию — сегодня); тот же день — заменяется; можно удалить
  function weightSheet(entry){
    const last = weights[weights.length - 1], date = entry?.date || todayIso(), same = weights.find(w => w.date === date);
    openSheet(`<h2>${entry ? "Вес" : "Записать вес"}</h2>
      <form id="wForm2">
        <div class="grid2"><label class="fld"><span>Дата</span><input id="wdate" type="date" max="${todayIso()}" value="${date}" required></label>
          <label class="fld"><span>Вес, кг</span><input id="wkg" inputmode="decimal" value="${same ? kgFmt(same.kg) : last ? kgFmt(last.kg) : ""}" placeholder="88,4" required></label></div>
        <div class="hint">Лучше взвешиваться утром натощак. Забыли вчера — выберите вчерашнюю дату.</div>
        <button class="btn" type="submit">Сохранить</button>
        ${entry ? `<button class="btn danger" type="button" id="wdel">Удалить запись</button>` : ""}
      </form>`);
    // при смене даты подставляем вес за этот день, если он уже записан
    $("wdate").onchange = () => { const w = weights.find(x => x.date === $("wdate").value); if (w) $("wkg").value = kgFmt(w.kg); };
    $("wForm2").onsubmit = e => {
      e.preventDefault();
      const d = $("wdate").value || todayIso(), kg = r1(String($("wkg").value).replace(",", "."));
      if (!(kg > 20 && kg < 400)) return $("wkg").focus();
      if (d > todayIso()) return $("wdate").focus();
      weights = [...weights.filter(w => w.date !== d && w.date !== entry?.date), {date: d, kg}].sort((a, b) => a.date.localeCompare(b.date));
      saveConf("weights.json", weights, `вес ${d}: ${kg} кг`);
      closeSheet(); renderProg(); toast(`Вес ${kgFmt(kg)} кг — ${d === todayIso() ? "сегодня" : ruDate(d)}`);
    };
    if (entry) $("wdel").onclick = () => {
      const old = weights; weights = weights.filter(w => w.date !== entry.date); saveConf("weights.json", weights, `удалён вес ${entry.date}`);
      closeSheet(); renderProg(); toast(`Удалено: вес ${ruDate(entry.date)}`, "Отменить", () => { weights = old; saveConf("weights.json", weights, "возвращён вес"); renderProg(); });
    };
    if (!entry) setTimeout(() => $("wkg")?.select(), 350);
  }

  // цель по весу — одна на всё время, задаётся отдельно (не при каждом взвешивании)
  function goalSheet(){
    openSheet(`<h2>Цель по весу</h2>
      <form id="gwForm"><label class="fld"><span>Цель, кг</span><input id="gw" inputmode="decimal" value="${goals.weightGoal ? kgFmt(goals.weightGoal) : ""}" placeholder="80"></label>
      <div class="hint">По ней считается, сколько осталось и примерный срок. Оставь пустым, чтобы убрать цель.</div>
      <button class="btn" type="submit">Сохранить</button></form>`);
    $("gwForm").onsubmit = e => {
      e.preventDefault();
      const g = r1(String($("gw").value).replace(",", "."));
      if ($("gw").value.trim() && !(g > 20 && g < 400)) return $("gw").focus();
      goals = {...goals, weightGoal: g > 0 ? g : undefined}; saveConf("settings.json", goals, "цель по весу");
      closeSheet(); renderWeight(); toast(g > 0 ? `Цель: ${kgFmt(g)} кг` : "Цель убрана");
    };
    setTimeout(() => $("gw")?.select(), 350);
  }

  // скорость по тренду: кг в неделю за последние ~2 недели
  function weeklyRate(){
    if (weights.length < 3) return null;
    const tr = trendOf(weights), lastD = weights[weights.length - 1].date, from = addDays(lastD, -14);
    let i0 = weights.findIndex(w => w.date >= from); if (i0 < 0 || i0 >= weights.length - 1) return null;
    const days = (parseIso(lastD) - parseIso(weights[i0].date)) / 864e5; if (days < 5) return null;
    return (tr[tr.length - 1] - tr[i0]) / days * 7;
  }

  // ---------- замеры тела ----------
  const MEAS = [["waist", "Талия"], ["hips", "Бёдра"], ["chest", "Грудь"], ["arm", "Бицепс"], ["thigh", "Бедро"], ["neck", "Шея"]];
  const spark = (vals, cls) => { if (vals.length < 2) return ""; const lo = Math.min(...vals), hi = Math.max(...vals), r = hi - lo || 1;
    return `<svg class="spark ${cls}" viewBox="0 0 60 18" preserveAspectRatio="none" aria-hidden="true"><path d="${vals.map((v, i) => `${i ? "L" : "M"}${(i * 60 / (vals.length - 1)).toFixed(1)},${(16 - (v - lo) / r * 14).toFixed(1)}`).join("")}"/></svg>`; };
  function renderMeasures(){
    const box = $("measCard"); if (!box) return;
    if (!measures.length){
      box.innerHTML = `<div class="cap row">Замеры тела<button class="addpill" id="mAdd" aria-label="Записать замеры"><svg viewBox="0 0 24 24" class="ico" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>Записать</button></div><div class="empty">Талия, бёдра, грудь, бицепс, бедро, шея — раз в 1–2 недели, утром</div>`;
      return void ($("mAdd").onclick = () => measSheet());
    }
    const last = measures[measures.length - 1];
    const rows = MEAS.map(([k, n]) => {
      const vals = measures.filter(m => m[k] > 0), cur = vals[vals.length - 1];
      if (!cur) return "";
      const first = vals[0], d = cur[k] - first[k];
      return `<div class="mrow"><span>${n}</span>${spark(vals.map(m => m[k]), d <= 0 ? "down" : "up")}<b>${fmt(cur[k], 1)}<small> см</small></b><em class="${d < 0 ? "down" : d > 0 ? "up" : ""}">${vals.length > 1 ? signed(d) : "—"}</em></div>`;
    }).join("");
    box.innerHTML = `<div class="cap row">Замеры тела<button class="addpill" id="mAdd" aria-label="Записать замеры"><svg viewBox="0 0 24 24" class="ico" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>Записать</button></div>
      <div class="hint">Последний раз — ${esc(ruDate(last.date))}. Изменение — с первого замера${measures.length > 1 ? ` (${esc(ruDate(measures[0].date))})` : ""}.</div>
      <div class="mlist">${rows}</div>
      <div class="whist" id="mHist">${measures.slice(-3).reverse().map(m => `<button class="whrow" data-md="${m.date}" aria-label="Замер ${esc(ruDate(m.date))}, изменить"><span>${esc(m.date === todayIso() ? "Сегодня" : ruDate(m.date))}</span><small>${esc(MEAS.filter(([k]) => m[k] > 0).slice(0, 2).map(([k, n]) => `${n.toLowerCase()} ${fmt(m[k], 1)}`).join(" · "))}</small></button>`).join("")}</div>
      ${measures.length > 3 ? `<button class="goalrow" id="mAll">Вся история · ${measures.length}<svg viewBox="0 0 24 24" class="ico" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></button>` : ""}`;
    $("mAdd").onclick = () => measSheet();
    if ($("mAll")) $("mAll").onclick = () => historySheet("m");
    $("mHist").onclick = e => { const b = e.target.closest("[data-md]"); if (b) measSheet(measures.find(m => m.date === b.dataset.md)); };
  }
  function measSheet(entry){
    const last = measures[measures.length - 1] || {}, src = entry || last, date = entry?.date || todayIso();
    openSheet(`<h2>Замеры тела</h2>
      <form id="mForm"><label class="fld"><span>Дата</span><input id="mdate" type="date" max="${todayIso()}" value="${date}" required></label>
      <div class="grid2">${MEAS.map(([k, n]) => `<label class="fld"><span>${n}, см</span><input name="${k}" inputmode="decimal" value="${src[k] ? fmt(src[k], 1) : ""}" placeholder="${last[k] ? fmt(last[k], 1) : "—"}"></label>`).join("")}</div>
      <div class="hint">Мерить утром, на одном и том же месте: талия — по пупку, бёдра — по самой широкой части. Можно заполнить не все.</div>
      <button class="btn" type="submit">Сохранить</button>
      ${entry ? `<button class="btn danger" type="button" id="mdel">Удалить замер</button>` : ""}</form>`);
    $("mdate").onchange = () => { const m = measures.find(x => x.date === $("mdate").value); if (m) MEAS.forEach(([k]) => { const el = $("mForm").elements[k]; if (el) el.value = m[k] ? fmt(m[k], 1) : ""; }); };
    $("mForm").onsubmit = e => {
      e.preventDefault();
      const fd = new FormData(e.target), d = $("mdate").value || todayIso(), m = {date: d};
      MEAS.forEach(([k]) => { const v = r1(String(fd.get(k) || "").replace(",", ".")); if (v > 0) m[k] = v; });
      if (Object.keys(m).length < 2) return e.target.querySelector("input[name]").focus();
      measures = [...measures.filter(x => x.date !== d && x.date !== entry?.date), m].sort((a, b) => a.date.localeCompare(b.date));
      saveConf("measures.json", measures, `замеры ${d}`); closeSheet(); renderProg(); toast("Замеры записаны");
    };
    if (entry) $("mdel").onclick = () => { measures = measures.filter(x => x.date !== entry.date); saveConf("measures.json", measures, `удалён замер ${entry.date}`); closeSheet(); renderProg(); };
  }

  // неделя: 7 дней до сегодня; пустые дни (без записей) в средние не входят
  async function renderWeekStats(){ // возвращает промис — после него считается блок «Анализы и добавки»
    const box = $("weekCard"); if (!box) return;
    const days28 = Array.from({length: 28}, (_, i) => addDays(todayIso(), i - 27)), days = days28.slice(-7);
    const docOf = d => d === cur ? day : weekDocs[d];
    const need = days28.filter(d => !docOf(d));
    if (need.length){
      box.innerHTML = `<div class="cap">Неделя</div><div class="empty">Считаю…</div>`;
      const got = await Promise.all(need.map(d => Store.read(dayPath(d)).then(r => r?.data, () => null)));
      need.forEach((d, i) => { weekDocs[d] = got[i] || {items: []}; });
    }
    const dayStat = d => { const doc = docOf(d) || {}; return {d, t: totals(doc.items), water: num(doc.water), has: (doc.items || []).length > 0}; };
    const st28 = days28.map(dayStat);
    const st = days.map(d => { const doc = docOf(d) || {}; return {d, t: totals(doc.items), water: num(doc.water), has: (doc.items || []).length > 0}; });
    const logged = st.filter(x => x.has), n = logged.length, g = goals;
    const avg = k => n ? logged.reduce((s, x) => s + x.t[k], 0) / n : 0;
    const inNorm = logged.filter(x => x.t.kcal <= g.kcal * 1.05).length;
    const avgWater = st.filter(x => x.water > 0).reduce((s, x, _, a) => s + x.water / a.length, 0);
    const maxK = Math.max(g.kcal * 1.25, ...st28.map(x => x.t.kcal));
    box.innerHTML = `<div class="cap row">Неделя<span>${n ? `записи за ${n} ${plural(n, "день", "дня", "дней")}` : "нет записей"}</span></div>
      <div class="wstats">
        <div><small>Ср. калории</small><b>${fmt(avg("kcal"))}</b><i>из ${fmt(g.kcal)}</i></div>
        <div><small>Ср. белок</small><b>${fmt(avg("p"))}<span> г</span></b><i>из ${fmt(g.p)} г</i></div>
        <div><small>В норме</small><b>${inNorm}<span> из ${n}</span></b><i>${plural(inNorm, "день", "дня", "дней")}</i></div>
        <div><small>Ср. вода</small><b>${fmt(avgWater / 1000, 1)}<span> л</span></b><i>из ${fmt(g.water / 1000, 1)} л</i></div>
      </div>
      <div class="cap row wsel"><span id="wSel">Калории по дням · листай влево</span></div>
      <div class="wbars-scroll" id="wbScroll"><div class="wbars" style="width:${days28.length * 40}px" role="img" aria-label="Калории по дням за 4 недели">
        <div class="gline" style="bottom:${32 + g.kcal / maxK * 100}px"></div>
        ${st28.map(x => { const h = x.t.kcal / maxK * 100, over = x.t.kcal > g.kcal * 1.05, gh = Math.min(x.t.kcal, g.kcal) / maxK * 100, dt = parseIso(x.d);
          const lbl = dt.getDate() === 1 ? dt.toLocaleDateString("ru-RU", {month: "short"}).replace(".", "") : esc(dt.toLocaleDateString("ru-RU", {weekday: "short"}));
          return `<button class="wb${x.d === todayIso() ? " today" : ""}" data-bd="${x.d}" aria-label="${esc(ruDate(x.d))}: ${fmt(x.t.kcal)} ккал"><div class="col${over ? " cut" : ""}" style="height:${gh}%"></div>${over ? `<div class="col ov" style="height:${h - gh}%;bottom:${gh}%"></div>` : ""}<span>${lbl}<b>${dt.getDate()}</b></span></button>`; }).join("")}
      </div></div>`;
    // лента открывается на сегодняшнем дне; нажатие на столбик — дата и калории
    const sc = $("wbScroll"); hscroll(sc); sc.scrollLeft = sc.scrollWidth;
    sc.onclick = e => { const b = e.target.closest("[data-bd]"); if (!b) return; const x = st28.find(y => y.d === b.dataset.bd);
      sc.querySelectorAll(".wb.sel").forEach(y => y.classList.remove("sel")); b.classList.add("sel");
      const dn = parseIso(x.d).toLocaleDateString("ru-RU", {weekday: "short", day: "numeric", month: "long"});
      $("wSel").innerHTML = `${esc(dn.charAt(0).toUpperCase() + dn.slice(1))} — <b>${x.has ? fmt(x.t.kcal) + " ккал" : "нет записей"}</b>${x.has ? ` · Б ${fmt(x.t.p)} · Ж ${fmt(x.t.f)} · У ${fmt(x.t.c)}` : ""}`; };
  }
  // серия: сколько дней подряд есть записи (сегодня ещё не начат — считаем со вчера)
  async function streak(){
    let d = todayIso(), n = 0;
    const has = x => ((x === cur ? day : weekDocs[x])?.items || []).length > 0;
    if (!has(d)) d = addDays(d, -1);
    for (let i = 0; i < 120; i++){
      if (!(d === cur ? day : weekDocs[d])){ const r = await Store.read(dayPath(d)).then(r => r?.data || {items: []}, () => null); if (!r) break; weekDocs[d] = r; }
      if (!has(d)) break; n++; d = addDays(d, -1);
    }
    return n;
  }

  // анализы и добавки: что приходит с едой за 7 дней по дефицитам из анализов, курс добавок и дата пересдачи
  const DEFICITS = ["fol", "b12", "fe", "vd"];
  async function renderHealth(){
    const box = $("healthCard"); if (!box) return;
    const days = Array.from({length: 7}, (_, i) => addDays(todayIso(), i - 6)), docOf = d => d === cur ? day : weekDocs[d];
    const logged = days.map(docOf).filter(x => (x?.items || []).length);
    const rows = DEFICITS.map(k => {
      const m = MICRO.find(x => x.k === k), goal = num(goals.micro?.[k] ?? m.def) || m.def;
      // учитываем только дни, где у этого показателя есть данные; иначе честно пишем «нет данных»
      const withData = logged.filter(doc => doc.items.some(it => it[k] != null && it[k] !== ""));
      const avg = withData.length ? withData.reduce((s, doc) => s + totals(doc.items)[k], 0) / withData.length : null;
      const pct = avg != null ? Math.min(100, avg / goal * 100) : 0;
      return `<div class="hrow"><div class="lbl"><span>${m.n}</span><i>${avg != null ? `${fmt(avg, avg < 10 ? 1 : 0)} из ${fmt(goal, goal < 10 ? 1 : 0)} ${m.u}` : "нет данных"}</i></div>
        <div class="bar"><div style="width:${pct}%;background:${pct >= 80 ? "#3ddc97" : pct >= 40 ? "#ffc53d" : "rgba(255,255,255,.45)"}"></div></div></div>`;
    }).join("");
    // курс добавок: отмечено приёмов за 7 дней из положенных
    const per = sups.items.reduce((s, it) => s + (cur <= addMonths(sups.start, it.months) ? it.perDay : 0), 0);
    const taken = days.reduce((s, d) => s + sups.items.reduce((a, it) => a + Math.min(it.perDay, num(docOf(d)?.sup?.[it.id])), 0), 0);
    const retest = addMonths(sups.start, sups.retestMonths), left = Math.max(0, Math.round((parseIso(retest) - parseIso(todayIso())) / 864e5));
    const st = await streak();
    box.innerHTML = `<div class="cap row">Анализы и добавки<span>серия ${st} ${plural(st, "день", "дня", "дней")}</span></div>
      <div class="hint">Среднее в день с едой за неделю — по продуктам, где указаны микроэлементы. Добавки сюда не входят.</div>
      ${rows}
      <div class="hsum">
        <div><small>Добавки за 7 дней</small><b>${per ? Math.round(taken / (per * 7) * 100) : 0}%</b><i>${taken} из ${per * 7} приёмов</i></div>
        <div><small>Повторные анализы</small><b>${left}<span> ${plural(left, "день", "дня", "дней")}</span></b><i>${esc(ruDate(retest))}</i></div>
      </div>`;
  }

  // последние 6 недель (пн–вс): средние калории по дням с записями, средний вес и изменение к прошлой неделе
  async function renderWeeks(){
    const box = $("weeksCard"); if (!box) return;
    const t = todayIso(), wd = (parseIso(t).getDay() + 6) % 7, mon0 = addDays(t, -wd);
    const weeks = Array.from({length: 6}, (_, i) => addDays(mon0, -7 * i));
    const allDays = weeks.flatMap(m => Array.from({length: 7}, (_, i) => addDays(m, i))).filter(d => d <= t);
    const need = allDays.filter(d => !(d === cur ? day : weekDocs[d]));
    if (need.length){
      box.innerHTML = `<div class="cap">По неделям</div><div class="empty">Считаю…</div>`;
      const got = await Promise.all(need.map(d => Store.read(dayPath(d)).then(r => r?.data || {items: []}, () => null)));
      need.forEach((d, i) => { if (got[i]) weekDocs[d] = got[i]; });
    }
    let prevW = null;
    const rows = weeks.slice().reverse().map(m => {
      const ds = Array.from({length: 7}, (_, i) => addDays(m, i)).filter(d => d <= t);
      const ks = ds.map(d => totals((d === cur ? day : weekDocs[d])?.items).kcal).filter(k => k > 0);
      const ws = weights.filter(w => w.date >= m && w.date <= addDays(m, 6)).map(w => w.kg);
      const avgK = ks.length ? ks.reduce((a, b) => a + b, 0) / ks.length : null, avgW = ws.length ? ws.reduce((a, b) => a + b, 0) / ws.length : null;
      const dW = avgW != null && prevW != null ? avgW - prevW : null; if (avgW != null) prevW = avgW;
      return {m, avgK, avgW, dW, n: ks.length};
    }).reverse().filter(r => r.avgK != null || r.avgW != null);
    box.innerHTML = `<div class="cap">По неделям</div>` + (rows.length ? `<div class="wtab"><div class="wth"><span>Неделя</span><span>Ккал/день</span><span>Вес</span><span>±</span></div>
      ${rows.map(r => `<div class="wtr"><span>${esc(parseIso(r.m).toLocaleDateString("ru-RU", {day: "numeric", month: "short"}))}${r.m === mon0 ? " · эта" : ""}</span>
        <span class="${r.avgK > goals.kcal * 1.05 ? "over" : ""}">${r.avgK != null ? fmt(r.avgK) : "—"}</span><span>${r.avgW != null ? kgFmt(r.avgW) : "—"}</span>
        <span class="${r.dW < 0 ? "down" : r.dW > 0 ? "up" : ""}">${r.dW != null ? signed(r.dW) : "—"}</span></div>`).join("")}</div>
      <div class="hint">Калории — среднее по дням с записями; вес — среднее за неделю; ± — к прошлой неделе.</div>` : `<div class="empty">Появится, когда будут записи за несколько недель</div>`);
  }
  // внутри «Прогресса» — по одной теме на экране, чтобы не листать длинную ленту
  let progSec = "w";
  const PROG_CARDS = {w: ["wCard"], m: ["measCard"], n: ["weekCard", "healthCard", "weeksCard"]};
  function renderProg(){
    $("progSeg").querySelectorAll("[data-ps]").forEach(b => { const on = b.dataset.ps === progSec; b.classList.toggle("on", on); b.setAttribute("aria-selected", on); });
    Object.entries(PROG_CARDS).forEach(([k, ids]) => ids.forEach(id => $(id).hidden = k !== progSec));
    if (progSec === "w") renderWeight(); else if (progSec === "m") renderMeasures(); else { renderWeekStats().then(renderHealth); renderWeeks(); }
  }

  // вся история (вес или замеры) — в отдельном окне, по месяцам; нажатие — правка
  function historySheet(kind){
    const list = (kind === "w" ? weights : measures).slice().reverse();
    let month = "";
    const rows = list.map(x => {
      const m = parseIso(x.date).toLocaleDateString("ru-RU", {month: "long", year: "numeric"});
      const head = m !== month ? `<div class="cap hist-m">${esc(m.charAt(0).toUpperCase() + m.slice(1))}</div>` : ""; month = m;
      const val = kind === "w" ? `<b>${kgFmt(x.kg)} кг</b>` : `<small>${esc(MEAS.filter(([k]) => x[k] > 0).map(([k, n]) => `${n.toLowerCase()} ${fmt(x[k], 1)}`).join(" · "))}</small>`;
      return `${head}<button class="whrow" data-hd="${x.date}"><span>${esc(parseIso(x.date).toLocaleDateString("ru-RU", {day: "numeric", month: "long", weekday: "short"}))}</span>${val}</button>`;
    }).join("");
    openSheet(`<h2>${kind === "w" ? "История веса" : "История замеров"}</h2><div class="hint">${list.length} ${plural(list.length, "запись", "записи", "записей")}. Нажми, чтобы исправить или удалить.</div><div class="whist" id="hAll">${rows}</div>`);
    $("hAll").onclick = e => { const b = e.target.closest("[data-hd]"); if (!b) return; kind === "w" ? weightSheet(weights.find(w => w.date === b.dataset.hd)) : measSheet(measures.find(m => m.date === b.dataset.hd)); };
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
      <div class="list cur" id="mlist">${list.map(it => `<div class="swipe"><button class="del" data-del="${esc(it.id)}" aria-label="Удалить ${esc(it.name || "блюдо")}">Удалить</button><button class="item" data-id="${esc(it.id)}"><div class="nm"><div>${esc(it.name || "Без названия")}</div><small>${it.pcs ? `${fmt(it.pcs, 1)} × ${esc(it.pcName || "шт")} · ` : ""}${it.g?fmt(it.g)+" г · ":""}Б ${fmt(it.p)} · Ж ${fmt(it.f)} · У ${fmt(it.c)}</small></div><div class="kc">${fmt(it.kcal)}</div></button></div>`).join("")}</div>
      ${list.length > 1 ? `<button class="linkbtn" id="mcombo">Сохранить как моё блюдо</button>` : ""}`;
    if ($("mcombo")) $("mcombo").onclick = () => comboSheet(list, m);
    $("mlist").onclick = e => {
      const del = e.target.closest("[data-del]");
      if (del) return removeItem(day.items.find(x => x.id === del.dataset.del));
      const row = e.target.closest(".swipe");
      if (row?.classList.contains("open")) return row.classList.remove("open"); // тап по открытой строке — закрыть
      const b = e.target.closest(".item"); if (!b) return;
      const it = day.items.find(x => x.id === b.dataset.id); if (it) it.g > 0 ? portionEdit(it) : itemForm(it);
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

  const supsTotal = () => sups.items.reduce((s, it) => s + it.perDay, 0);
  const supsTaken = () => sups.items.reduce((s, it) => s + Math.min(it.perDay, num(day.sup?.[it.id])), 0);
  function supSheet(){
    openSheet(`<h2>Добавки</h2><div class="cap">Повторные анализы — ${esc(ruDate(addMonths(sups.start, sups.retestMonths)))}</div><div id="sups2"></div>`);
    $("sups2").onclick = supClick; renderSups();
  }
  function renderSups(){
    const end = it => addMonths(sups.start, it.months);
    const tk = supsTaken(), tt = supsTotal();
    $("supBadge").textContent = tt ? `${tk}/${tt}` : ""; $("supBtn").hidden = !tt; $("supBtn").classList.toggle("done", tt > 0 && tk >= tt);
    const html = sups.items.map(it => {
      const n = num(day.sup?.[it.id]);
      const done = cur > end(it);
      const dots = Array.from({length: it.perDay}, (_, i) => `<button class="dot${i<n?" on":""}" data-sup="${esc(it.id)}" data-i="${i}" aria-label="Принято ${i+1}">${i<n?"✓":""}</button>`).join("");
      return `<div class="sup"><div class="nm">${esc(it.name)} ${esc(it.dose)}<small>${it.perDay}×/день · ${done ? "курс завершён" : "до " + ruDate(end(it))}</small></div><div class="dots">${dots}</div></div>`;
    }).join("");
    if ($("sups2")) $("sups2").innerHTML = html;
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
  // то же для любого дня (не открытого): правка уходит в очередь, полоса дней обновляется
  function mutateDay(d, op, msg){
    if (d === cur) return mutate(op, msg);
    weekDocs[d] = applyOp(weekDocs[d] || blank(d), op); renderWeek();
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
      else setStatus(`Нет связи — ${pending.length} ${plural(pending.length, "запись сохранена", "записи сохранены", "записей сохранено")} на телефоне, отправлю позже`);
    } finally { flushing = false; }
  }
  addEventListener("online", flush);

  let waterDelta = 0;
  // дата → добавленные порции воды; хранится на телефоне, чтобы «−» знал последнюю порцию и после перезапуска
  const WKEY = "kcal_water_log";
  const waterLog = (() => { try { return JSON.parse(localStorage.getItem(WKEY)) || {}; } catch { return {}; } })();
  const saveWaterLog = () => { for (const k of Object.keys(waterLog)) if (k < addDays(todayIso(), -14)) delete waterLog[k]; localStorage.setItem(WKEY, JSON.stringify(waterLog)); };
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
  let sheetOpener = null;
  function openSheet(html){
    stopScan?.(); const sh = $("sheet"), wasOpen = sh.classList.contains("on");
    if (!wasOpen) sheetOpener = document.activeElement;
    sh.classList.remove("tall"); const sb = $("sheetBody"); sb.innerHTML = html; sb.classList.remove("swap"); sb.offsetWidth; sb.classList.add("swap");
    const h = sb.querySelector("h2"); if (h){ h.id = "sheetTitle"; h.tabIndex = -1; }
    $("scrim").classList.add("on"); sh.classList.add("on");
    $("scroller").inert = true; $("tabbar").inert = true; // VoiceOver и Tab не уходят под окно
    // фокус на заголовок окна, когда окно уже видно (раньше — браузер не даёт сфокусировать)
    setTimeout(() => { const t = $("sheetTitle"); if (t && !sb.contains(document.activeElement)) t.focus({preventScroll: true}); }, 320);
  }
  function closeSheet(){
    curAddMeal = null; stopScan?.(); $("scrim").classList.remove("on"); $("sheet").classList.remove("on"); $("sheet").style.transform = "";
    $("scroller").inert = false; $("tabbar").inert = false;
    if (sheetOpener?.isConnected) sheetOpener.focus({preventScroll: true}); sheetOpener = null;
  }
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
  $("sheetX").onclick = closeSheet;
  addEventListener("keydown", e => { if (e.key === "Escape" && $("sheet").classList.contains("on")) closeSheet(); });

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
      mutate({t: "put", item: upd}, `правка: ${it.name} ${r1(g())} г`);
      addSheet(meal);
    };
    $("emanual").onclick = () => itemForm(it);
    $("edel").onclick = () => { removeItem(it); addSheet(MEALS.includes(it.meal) ? it.meal : "Перекус"); };
  }

  function settingsSheet(){
    const g = goals;
    openSheet(`<h2>Цели на день</h2>
      <form id="gForm">
        <div class="grid2">
          <label class="fld"><span>Калории, ккал</span><input name="kcal" inputmode="decimal" value="${g.kcal}"></label>
          <label class="fld"><span>Вода, мл</span><input name="water" inputmode="decimal" value="${g.water}"></label>
          <label class="fld"><span>Цель по весу, кг</span><input name="weightGoal" inputmode="decimal" value="${g.weightGoal ? String(g.weightGoal).replace(".", ",") : ""}" placeholder="необязательно"></label>
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
      const wg = num(String(fd.get("weightGoal") || "").replace(",", ".")); if (wg > 20 && wg < 400) ng.weightGoal = r1(wg);
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
  const addWater = v => { if (v > 0 && v <= 5000){ (waterLog[cur] ||= []).push(v); saveWaterLog(); bumpWater(v); } };
  // вода: ввёл мл и «+»; «−» убирает последнюю добавленную порцию
  $("wForm").onsubmit = e => {
    e.preventDefault();
    const v = Math.round(num($("wIn").value));
    if (!(v > 0)) return $("wIn").focus();
    $("wIn").value = ""; $("wIn").blur();
    addWater(v);
  };
  // «−»: число в поле — убрать его; поле пустое — убрать последнюю добавленную порцию; порций нет — спросить сколько
  $("wMinus").onclick = () => {
    const typed = Math.round(num($("wIn").value));
    if (typed > 0){
      $("wIn").value = ""; $("wIn").blur();
      const log = waterLog[cur] || [], i = log.lastIndexOf(typed); if (i >= 0){ log.splice(i, 1); saveWaterLog(); }
      return bumpWater(-typed);
    }
    const last = (waterLog[cur] || []).pop();
    if (last){ saveWaterLog(); return bumpWater(-last); }
    $("wIn").focus(); toast("Впиши, сколько мл убрать, и нажми «−»");
  };
  $("newFood").onclick = () => foodForm(null);
  $("foodQ").oninput = renderFoods;
  hscroll($("foodCats"));
  $("foodCats").onclick = e => { const b = e.target.closest("[data-cat]"); if (b){ foodCat = b.dataset.cat; renderFoods(); } };
  $("scanBtn").onclick = () => scanSheet();
  $("sayBtn").onclick = () => { try { saySheet(); } catch (e){ toast("«Что съел?» не открылось: " + e.message); } };
  // ошибка в коде — коротко на экран: на телефоне консоли нет, а так есть что прислать
  addEventListener("error", e => toast("Ошибка: " + (e.message || "неизвестная")));
  addEventListener("unhandledrejection", e => toast("Ошибка: " + (e.reason?.message || e.reason)));
  $("progSeg").onclick = e => { const b = e.target.closest("[data-ps]"); if (b && b.dataset.ps !== progSec){ progSec = b.dataset.ps; renderProg(); scrollTo(0, 0); } };
  $("supBtn").onclick = supSheet;
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
      if (b.dataset.tab === "prog") renderProg();
      scrollTo(0, 0);
    }, matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 140);
  };
  new ResizeObserver(() => { const b = document.querySelector("#tabbar button.on"); if (b) movePill(b); }).observe($("tabbar"));
  $("settingsBtn").onclick = settingsSheet;
  $("week").onclick = e => { const b = e.target.closest(".day"); if (b && b.dataset.d !== cur) go(b.dataset.d); };
  // отметки добавок — в окне по кнопке с капсулой в шапке (отдельной вкладки больше нет)
  function supClick(e){
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
      localStorage.setItem(CKEY, JSON.stringify({goals, sups, foods, combos, weights, measures, days: keep}));
    } catch {}
  }
  function readCache(){ try { return JSON.parse(localStorage.getItem(CKEY)); } catch { return null; } }

  async function boot(){
    if (!Store.hasToken()) return showSetup();
    $("setup").hidden = true; $("app").hidden = false; $("tabbar").hidden = false;
    const c = readCache();
    if (c){
      goals = {...DEFAULT_GOALS, ...c.goals}; sups = c.sups || sups; foods = c.foods || foods; combos = c.combos || []; weights = c.weights || []; measures = c.measures || []; weekDocs = c.days || {};
      if (weekDocs[cur]) day = {...blank(cur), ...weekDocs[cur]};
      render(); // мгновенно, без серых заготовок
    } else { $("app").classList.add("loading"); render(); } // самый первый запуск
    loadDay(!!c);
    try {
      // настройки, добавки и продукты — параллельно, а не по очереди
      const [s, su, fo, co, we, me] = await Promise.all(["settings.json", "supplements.json", "foods.json", "combos.json", "weights.json", "measures.json"].map(p => Store.read(p)));
      if (co) combos = co.data;
      if (we) weights = we.data;
      if (me) measures = me.data;
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
