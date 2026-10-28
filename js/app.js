(function () {
  const cfg = window.APP_CONFIG;
  const tg = window.Telegram && window.Telegram.WebApp;
  const inTelegram = !!(tg && tg.platform && tg.platform !== 'unknown');
  const supports = (v) => inTelegram && typeof tg.isVersionAtLeast === 'function' && tg.isVersionAtLeast(v);

  const CATS = {
    coffee: { label: 'Кофе и чай' },
    food: { label: 'Еда' },
    museum: { label: 'Музеи' },
    photo: { label: 'Красивые места' },
    mall: { label: 'ТЦ и фудкорты' },
    night: { label: 'Бары и кальянные', short: 'Бары', adult: true },
  };
  const AGE_BADGE = '<span class="age-badge">18+</span>';
  // Иконка из набора в app.html (<symbol id="i-…">)
  const icon = (name, cls) => `<svg class="ic${cls ? ' ' + cls : ''}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const STAR = icon('star', 'ic-star'); // звезда оценки — иконкой (символа ★ нет в шрифте)
  // Эмодзи — картинками Twemoji (img/emoji/<код>.svg): на любом телефоне они цветные и одинаковые
  // (иначе часть эмодзи — 🏛 🍽 ☀ — на некоторых телефонах выходит чёрным значком шрифта).
  // Обычная картинка <img>: браузер один раз превращает её в растр и дальше просто показывает —
  // это заметно легче для телефона, чем живой SVG. Картинки нет в наборе — показываем сам символ
  const EMOJI_SET = new Set('23f0 23f1 2600 2601 2614 2615 267e 26a1 26c5 26c8 26ea 26f2 26f8 2728 2764 1f193 1f306 1f307 1f30d 1f319 1f321 1f324 1f326 1f327 1f328 1f32b 1f333 1f338 1f33f 1f342 1f35d 1f362 1f363 1f370 1f377 1f378 1f37d 1f389 1f3a0 1f3a8 1f3b2 1f3c5 1f3c6 1f3d9 1f3db 1f3e0 1f3ed 1f3ef 1f3f0 1f44d 1f44e 1f463 1f465 1f46f 1f48e 1f495 1f4b0 1f4b3 1f4b8 1f4c5 1f4cd 1f4f8 1f50a 1f52d 1f551 1f5bc 1f5d3 1f5fa 1f60c 1f64b 1f680 1f687 1f6b6 1f6cb 1f6cd 1f91d 1f957 1f959 1f95e 1f95f 1f964 1f966 1f969 1f976 1f97e 1f9a2 1f9ed 1f9f1 1f9f8'.split(' '));
  const emojiCode = (e) => [...String(e)].map((c) => c.codePointAt(0).toString(16)).filter((h) => h !== 'fe0f').join('-');
  function emo(e, cls) {
    if (!e) return '';
    const code = emojiCode(e);
    if (!EMOJI_SET.has(code)) return esc(e);
    return `<img class="emo${cls ? ' ' + cls : ''}" src="img/emoji/${code}.svg" alt="" draggable="false" decoding="async">`;
  }
  const catLabel = (p) => (p.kind === 'food_court' ? 'Фудкорт' : p.kind === 'mall' ? 'Торговый центр' : CATS[p.cat].label);
  // Сколько названий показывать в списках «Где поесть» / «Развлечения»
  const LIST_LIMIT = 12;
  // Ползунок бюджета: шаги неравномерные — как люди думают о деньгах; последний шаг — «любой»
  const BUDGET_STOPS = [0, 300, 500, 800, 1000, 1500, 2000, 3000, 5000, 7000, 10000, null];
  const budgetLabel = (v) => (v === null ? 'Любой' : v === 0 ? 'Только бесплатное' : `до ${v.toLocaleString('ru-RU')} ₽`);
  const SETTINGS = [
    { v: 'any', label: 'Неважно' },
    { v: 'outdoor', label: 'На улице' },
    { v: 'indoor', label: 'В помещении' },
  ];
  const SETTING_TEXT = { outdoor: 'На улице', indoor: 'В помещении', both: 'Улица и помещение' };

  const state = {
    cats: new Set(), // выбранные категории; пусто — «Все»
    budget: null,
    setting: 'any',
    openNow: false,
    user: null,
    view: null,
    selected: null,
    lucky: false,
    recent: [],
    collection: null, // открытая подборка из collections.js
  };

  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const curated = (window.CURATED_PLACES || []).map((p) => Object.assign({ source: 'curated' }, p));
  const byId = new Map(curated.map((p) => [p.id, p]));
  // Подборки: только места, которые есть на карте
  const COLLECTIONS = (window.COLLECTIONS || []).map((c) => Object.assign({}, c, {
    set: new Set(c.ids.filter((id) => byId.has(id))),
  }));

  // ---------- Утилиты ----------
  function distance(a, b) {
    const R = 6371000, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function plural(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }


  // Цены — как в Яндекс Картах: средний чек или стоимость билета
  function priceText(p) {
    if (p.bill) return `Средний чек ${p.bill}`;
    if (p.tickets) return `Билет ${p.tickets}`;
    if (p.cup) return `Капучино ${p.cup}`;
    if (p.kind === 'mall') return 'Вход свободный';
    if (p.free) return 'Бесплатно';
    return p.cat === 'museum' || p.cat === 'photo' ? 'Цена входа неизвестна' : 'Средний чек неизвестен';
  }
  const priceUnknown = (p) => minPrice(p) === null;

  // Минимальная цена для фильтра «Бюджет»: «600–800 ₽» → 600, «от 499 ₽» → 499, «до 2000 ₽» → 2000.
  // null — цена неизвестна: такое место показываем при любом бюджете с пометкой «Средний чек неизвестен»,
  // но не в режиме «Только бесплатное» (мы не знаем, что там бесплатно).
  const minCache = new WeakMap();
  function minPrice(p) {
    let m = minCache.get(p);
    if (m === undefined) minCache.set(p, (m = parseMinPrice(p)));
    return m;
  }
  function parseMinPrice(p) {
    if (p.free || p.kind === 'mall') return 0;
    const s = p.bill || p.tickets || p.cup;
    if (s) {
      const n = parseInt(s.replace(/\s/g, '').match(/\d+/), 10);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }

  // Оценка из Яндекс Карт: «4,8 · 624 оценки»
  function ratingText(p) {
    const r = p.rating.toFixed(1).replace('.', ',');
    return p.pop ? `${r} · ${p.pop.toLocaleString('ru-RU')} ${plural(p.pop, 'оценка', 'оценки', 'оценок')}` : r;
  }

  // Ближайшая станция метро/МЦК (из Яндекс Карт, js/metro.js): { name, min } или null, если дальше 2,5 км
  function nearestMetro(p) {
    let best = null, bestD = Infinity;
    for (const s of window.METRO || []) {
      const d = distance(p, { lat: s[1], lon: s[2] });
      if (d < bestD) { bestD = d; best = s; }
    }
    return best && bestD < 2500 ? { name: best[0], min: Math.max(1, Math.round((bestD * 1.3) / 70)) } : null;
  }
  // Значок метро — нарисованная «М» на красном круге (буква шрифта выглядела кривой)
  const METRO_ICON = '<svg class="metro-m" viewBox="0 0 20 20" aria-label="Метро"><circle cx="10" cy="10" r="10" fill="#d52b1e"/><path d="M3.9 14.6 7 5.4 10 11.1 13 5.4 16.1 14.6H13.95L12.5 10.25 10 14.2 7.5 10.25 6.05 14.6Z" fill="#fff"/></svg>';
  const metroHtml = (m) => `${METRO_ICON}${esc(m.name)} · ${m.min} мин пешком`;

  function distanceText(d) {
    const dist = d < 1000 ? `${Math.round(d / 10) * 10} м` : `${(d / 1000).toFixed(1).replace('.', ',')} км`;
    return d < 5000 ? `${dist} · ${Math.max(1, Math.round(d / 75))} мин пешком` : dist;
  }

  const haptic = {
    tap() { if (supports('6.1')) tg.HapticFeedback.selectionChanged(); },
    impact(style) { if (supports('6.1')) tg.HapticFeedback.impactOccurred(style || 'light'); },
    notify(type) { if (supports('6.1')) tg.HapticFeedback.notificationOccurred(type); },
  };

  function openLink(url) {
    if (inTelegram) tg.openLink(url);
    else window.open(url, '_blank', 'noopener');
  }

  let toastTimer;
  // e — эмодзи картинкой перед текстом (например, «🎉 Маршрут пройден!»); ms — сколько показывать
  function toast(text, e, ms) {
    const t = $('#toast');
    if (e) t.innerHTML = emo(e) + ' ' + esc(text); else t.textContent = text;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms || 3200);
  }

  // ---------- Избранное ----------
  // Хранится в телефоне, а в Telegram — ещё и в облаке: видно на всех устройствах пользователя
  const favs = new Set();
  try { JSON.parse(localStorage.getItem('favs') || '[]').forEach((id) => favs.add(id)); } catch (e) { /* хранилище недоступно */ }

  function saveFavs() {
    const s = JSON.stringify([...favs].slice(-200)); // облако Telegram хранит до 4096 символов в ключе
    try { localStorage.setItem('favs', s); } catch (e) { /* хранилище недоступно */ }
    if (supports('6.9')) tg.CloudStorage.setItem('favs', s);
  }

  // В Telegram главная копия — облачная (там уже учтены изменения с других устройств)
  function loadCloudFavs() {
    if (!supports('6.9')) return;
    tg.CloudStorage.getItem('favs', (err, value) => {
      if (err) return;
      if (!value) { if (favs.size) saveFavs(); return; }
      let list;
      try { list = JSON.parse(value); } catch (e) { return; }
      if (!Array.isArray(list)) return;
      favs.clear();
      list.forEach((id) => favs.add(id));
      try { localStorage.setItem('favs', value); } catch (e) { /* хранилище недоступно */ }
      updateFavButton();
      render();
    });
  }

  function updateFavButton() {
    const n = [...favs].filter((id) => byId.has(id)).length;
    $('#open-favs').classList.toggle('has-favs', n > 0);
    $('#open-favs use').setAttribute('href', n ? '#i-heart-fill' : '#i-heart');
    $('#fav-count').textContent = n;
    $('#fav-count').hidden = !n;
  }

  function toggleFav(p) {
    const on = !favs.has(p.id);
    if (on) favs.add(p.id);
    else favs.delete(p.id);
    saveFavs();
    haptic.impact(on ? 'medium' : 'light');
    toast(on ? 'Сохранено в избранное' : 'Убрано из избранного');
    updateFavButton();
    render(); // сердечко на метке
  }

  // ---------- Подтверждение возраста (бары и кальянные 18+) ----------
  // Пока человек не подтвердил, что ему есть 18, бары нигде не показываются. Ответ «да» запоминается
  // в телефоне и в облаке Telegram; «нет» не запоминается — спросим снова при следующем нажатии.
  let adultOk = false;
  try { adultOk = localStorage.getItem('age18') === 'yes'; } catch (e) { /* хранилище недоступно */ }
  let ageResolve = null;

  function loadCloudAge() {
    if (!supports('6.9') || adultOk) return;
    tg.CloudStorage.getItem('age18', (err, value) => {
      if (err || value !== 'yes') return;
      adultOk = true;
      try { localStorage.setItem('age18', 'yes'); } catch (e) { /* хранилище недоступно */ }
      render();
    });
  }

  // Возвращает Promise<boolean>: можно ли показывать бары
  function askAdult() {
    if (adultOk) return Promise.resolve(true);
    haptic.tap();
    return new Promise((resolve) => {
      openSheet('age');
      ageResolve = resolve;
    });
  }

  function answerAge(yes) {
    const resolve = ageResolve;
    ageResolve = null;
    if (yes) {
      adultOk = true;
      try { localStorage.setItem('age18', 'yes'); } catch (e) { /* хранилище недоступно */ }
      if (supports('6.9')) tg.CloudStorage.setItem('age18', 'yes');
      haptic.notify('success');
    }
    closeSheets();
    if (!yes) toast('Бары и кальянные — только для тех, кому есть 18');
    if (resolve) resolve(yes);
  }

  // ---------- Тема и Telegram ----------
  // Тема: 'auto' — как в Telegram (или в системе), 'light', 'dark'. Выбор запоминается.
  const THEMES = ['auto', 'light', 'dark'];
  const THEME_NAMES = { auto: inTelegram ? 'как в Telegram' : 'как в системе', light: 'светлая', dark: 'тёмная' };
  const THEME_ICONS = {
    auto: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor"/></svg>',
    light: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="12" r="4.5" fill="currentColor"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    dark: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" fill="currentColor"/></svg>',
  };
  let themePref = 'auto';
  try { themePref = localStorage.getItem('theme') || 'auto'; } catch (e) { /* хранилище недоступно */ }
  if (!THEMES.includes(themePref)) themePref = 'auto';

  function isDark() {
    if (themePref === 'light') return false;
    if (themePref === 'dark') return true;
    if (inTelegram) return tg.colorScheme === 'dark';
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  function updateThemeButton() {
    const btn = $('#theme');
    btn.innerHTML = THEME_ICONS[themePref];
    btn.setAttribute('aria-label', 'Тема: ' + THEME_NAMES[themePref]);
  }

  function setTheme(pref, silent) {
    themePref = pref;
    try { localStorage.setItem('theme', pref); } catch (e) { /* хранилище недоступно */ }
    applyTheme();
    updateThemeButton();
    if (!silent) {
      if (supports('6.9')) tg.CloudStorage.setItem('theme', pref);
      haptic.tap();
      toast('Тема: ' + THEME_NAMES[pref]);
      const btn = $('#theme');
      btn.classList.remove('spin');
      void btn.offsetWidth;
      btn.classList.add('spin');
      setTimeout(() => btn.classList.remove('spin'), 400);
    }
  }

  function cycleTheme() {
    setTheme(THEMES[(THEMES.indexOf(themePref) + 1) % THEMES.length]);
  }

  // В Telegram тема синхронизируется между устройствами через облачное хранилище
  function loadCloudTheme() {
    if (!supports('6.9')) return;
    tg.CloudStorage.getItem('theme', (err, value) => {
      if (!err && THEMES.includes(value) && value !== themePref) setTheme(value, true);
    });
  }

  function applyTheme() {
    const dark = isDark();
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    if (MapView.impl) MapView.setDark(dark);
    // Шапка и фон Telegram в цветах приложения
    const bg = dark ? '#1b1719' : '#ffffff';
    if (supports('6.9')) {
      tg.setHeaderColor(bg);
      tg.setBackgroundColor(bg);
    } else if (supports('6.1')) {
      tg.setHeaderColor('bg_color');
      tg.setBackgroundColor('bg_color');
    }
    if (supports('7.10')) tg.setBottomBarColor(bg);
  }

  function initTelegram() {
    if (!inTelegram) {
      if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
      return;
    }
    tg.ready();
    tg.expand();
    if (supports('7.7')) tg.disableVerticalSwipes(); // чтобы свайп по карте не сворачивал приложение
    tg.onEvent('themeChanged', applyTheme);
    // «Назад» в Telegram: сначала закрывает открытый документ, потом шторки
    if (supports('6.1')) tg.BackButton.onClick(() => { if (!$('#doc-view').hidden) $('#doc-view').hidden = true; else closeSheets(); });
  }

  // ---------- Фильтрация ----------
  function matches(p) {
    if (state.route) return state.route.includes(p.id); // открыт маршрут — на карте только его места
    if (p.cat === 'night' && !adultOk) return false; // бары — только после подтверждения возраста
    if (state.collection && !state.collection.set.has(p.id)) return false;
    if (state.cats.size && !state.cats.has(p.cat)) return false;
    return passesFilters(p);
  }

  // Только фильтры из шторки «Фильтры» (без категории и подборки)
  function passesFilters(p) {
    if (state.budget !== null) {
      const m = minPrice(p);
      if (m === null ? state.budget === 0 : m > state.budget) return false;
    }
    if (state.setting !== 'any' && p.setting !== state.setting && p.setting !== 'both') return false;
    if (state.openNow && Hours.status(p.hours).state !== 'open') return false;
    return true;
  }

  // Места, найденные живым поиском Яндекса (кнопка «Найти здесь»)
  let livePlaces = [];
  const allPlaces = () => (livePlaces.length ? curated.concat(livePlaces) : curated);
  const allMatches = () => allPlaces().filter(matches);

  // ---------- Живой поиск: «API поиска по организациям» Яндекса ----------
  // Ищет в видимой части карты по выбранной категории. Результаты не сохраняются — только показываются.
  const LIVE_QUERY = { all: 'кафе', coffee: 'кофейня', food: 'ресторан', museum: 'музей', photo: 'достопримечательность', mall: 'торговый центр', night: 'бар' };
  const DAY_KEYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const OSM_DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

  // Часы из формата Яндекса (Availabilities) в формат, который понимает hours.js
  function hoursFromYandex(h) {
    const av = h && h.Availabilities;
    if (!av || !av.length) return null;
    const week = Array(7).fill(null);
    for (const a of av) {
      let days = [];
      if (a.Everyday) days = [0, 1, 2, 3, 4, 5, 6];
      else {
        if (a.Weekdays) days.push(0, 1, 2, 3, 4);
        if (a.Weekend) days.push(5, 6);
        DAY_KEYS.forEach((k, i) => { if (a[k]) days.push(i); });
      }
      const iv = a.TwentyFourHours ? ['00:00-24:00'] : (a.Intervals || []).map((x) => {
        const to = String(x.to).slice(0, 5);
        return String(x.from).slice(0, 5) + '-' + (to === '00:00' ? '24:00' : to);
      });
      for (const d of days) week[d] = iv.join(',');
    }
    if (week.every((d) => d === null)) return null;
    if (week.every((d) => d === '00:00-24:00')) return '24/7';
    const groups = [];
    week.forEach((v, i) => {
      v = v || 'off';
      const g = groups[groups.length - 1];
      if (g && g.v === v) g.e = i; else groups.push({ s: i, e: i, v });
    });
    return groups.map((g) => (g.s === g.e ? OSM_DAYS[g.s] : OSM_DAYS[g.s] + '-' + OSM_DAYS[g.e]) + ' ' + g.v).join('; ');
  }

  function catFromYandex(cats, fallback) {
    const s = cats.join(' ').toLowerCase();
    if (/кофейн|чайн/.test(s)) return 'coffee';
    if (/музей|галере|выставочн/.test(s)) return 'museum';
    if (/торговый центр|фудмолл|гастромаркет|фудкорт/.test(s)) return 'mall';
    if (/(^|[^а-яё])парк(?!овк)|сквер|достопримечательн|смотров|набережн|памятник/.test(s)) return 'photo';
    if (/ресторан|кафе|бар|столов|пиццери|суши|бургер|быстрое питание|пекарн|кондитерск/.test(s)) return 'food';
    return fallback === 'all' ? 'food' : fallback;
  }

  // Одна выбранная категория (для живого поиска Яндекса) или 'all'
  const oneCat = () => (state.cats.size === 1 ? [...state.cats][0] : 'all');

  let liveBusy = false;
  async function liveSearch() {
    if (liveBusy || !state.view) return;
    liveBusy = true;
    const btn = $('#search-here');
    btn.classList.add('loading');
    haptic.tap();
    const b = state.view.bounds;
    const params = new URLSearchParams({
      apikey: cfg.PLACES_API_KEY.trim(),
      text: LIVE_QUERY[oneCat()] || 'кафе',
      lang: 'ru_RU',
      type: 'biz',
      results: '50',
      rspn: '1',
      bbox: `${b.west.toFixed(5)},${b.south.toFixed(5)}~${b.east.toFixed(5)},${b.north.toFixed(5)}`,
    });
    try {
      const res = await fetch('https://search-maps.yandex.ru/v1/?' + params);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      const known = new Set(curated.map((p) => p.ym));
      livePlaces = (data.features || []).map((f) => {
        const m = f.properties.CompanyMetaData || {};
        const cats = (m.Categories || []).map((c) => c.name);
        return {
          id: 'live-' + m.id,
          ym: m.id,
          name: m.name || f.properties.name,
          cat: catFromYandex(cats, oneCat()),
          setting: 'indoor',
          hours: hoursFromYandex(m.Hours),
          address: (m.address || f.properties.description || '').replace(/^Россия,\s*/, '').replace(/^Москва,\s*/, ''),
          desc: cats.slice(0, 3).join(' · '),
          lat: f.geometry.coordinates[1],
          lon: f.geometry.coordinates[0],
          source: 'live',
        };
      }).filter((p) => p.ym && !known.has(p.ym));
      render();
      toast(livePlaces.length ? `Нашлось ещё ${livePlaces.length} ${plural(livePlaces.length, 'место', 'места', 'мест')} рядом` : 'Здесь ничего не нашлось — попробуй сдвинуть карту');
    } catch (e) {
      console.warn('Живой поиск:', e);
      toast('Поиск сейчас недоступен — попробуй позже');
    } finally {
      liveBusy = false;
      btn.classList.remove('loading');
    }
  }

  function updateSearchHere() {
    const show = !!(cfg.PLACES_API_KEY || '').trim() && !!state.view && state.view.zoom >= 13;
    $('#search-here').hidden = !show;
  }

  // ---------- Маркеры ----------
  const markerEls = new Map();
  function markerEl(p) {
    let el = markerEls.get(p.id);
    if (!el) {
      el = document.createElement('button');
      el.type = 'button';
      el.className = `mk mk--${p.cat} mk--named` + (p.source === 'live' ? ' mk--small' : '');
      el.setAttribute('aria-label', p.name);
      el.innerHTML = `${icon(p.cat)}<b class="mk-label">${esc(p.name)}</b>${icon('heart-fill', 'mk-fav')}`;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        haptic.tap();
        openPlace(p);
      });
      markerEls.set(p.id, el);
    }
    el.classList.toggle('mk--active', !!state.selected && state.selected.id === p.id);
    el.classList.toggle('mk--fav', favs.has(p.id));
    return el;
  }

  // Метка «Ты здесь»: пульсирующая точка с подписью
  function userEl() {
    const el = document.createElement('div');
    el.className = 'me-wrap';
    el.innerHTML = '<div class="me"></div><b class="me-label">Ты здесь</b>';
    return el;
  }

  // Перерисовка меток: при смене фильтров, выбранного места и после движения карты
  // ---------- Метки «по мере приближения» ----------
  // Метки раскладываются от самых популярных мест (по числу оценок в Яндексе) к менее популярным.
  // Метка, которая налезла бы на уже поставленную, пропускается; подпись показывается, только
  // если ей хватает места. Поэтому издалека видны главные места, а при приближении — всё больше
  // заведений и их названий.
  const merc = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  // У ТЦ оценок на порядок больше, чем у парков и музеев, — без весов издалека карта состояла бы
  // из одних торговых центров. Для прогулок важнее красивые места и музеи.
  const CAT_WEIGHT = { photo: 2.5, museum: 2, coffee: 1.5, food: 1, night: 1, mall: 0.5 };
  const priority = (p) => (p.pop || 0) * (CAT_WEIGHT[p.cat] || 1);
  // Порог важности по масштабу: издалека — только самые известные места, с 14-го масштаба — всё
  const minPriority = (z) => (z < 10.5 ? 100000 : z < 11.5 ? 40000 : z < 12.5 ? 15000 : z < 13.5 ? 5000 : 0);

  // Размер карты запоминаем, а не читаем при каждой раскладке: чтение clientWidth сразу после
  // правок DOM заставляет браузер посреди кадра заново считать вёрстку всей страницы
  let mapSize = null;
  function getMapSize() {
    if (!mapSize) {
      const el = $('#map');
      mapSize = { w: el.clientWidth || window.innerWidth, h: el.clientHeight || window.innerHeight };
    }
    return mapSize;
  }
  if (window.ResizeObserver) new ResizeObserver(() => { mapSize = null; }).observe($('#map'));
  else window.addEventListener('resize', () => { mapSize = null; });

  // Слабый телефон (до 4 ГБ памяти или до 4 ядер) — меньше меток и подписей: карта двигается плавнее
  const LOW_END = (navigator.deviceMemory && navigator.deviceMemory <= 4) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4);

  // Лёгкий режим: телефон в энергосбережении (или просто не тянет) — кадры идут реже 40 в секунду.
  // Тогда плитки карты легче, меток меньше, без пульсации. Замеряем частоту кадров, пока человек
  // двигает карту, и запоминаем вывод до следующего запуска (плитки меняются только при запуске)
  let LITE = /[?&]lite=1/.test(location.search);
  try { LITE = LITE || localStorage.getItem('lite') === '1'; } catch (e) { /* хранилище недоступно */ }
  document.documentElement.classList.toggle('lite', LITE);
  const fpsSamples = [];
  let fpsBusy = false;
  function measureFps() {
    if (fpsBusy || fpsSamples.length >= 5) return;
    fpsBusy = true;
    const d = [];
    let last = 0;
    const end = performance.now() + 1500;
    const step = (t) => {
      if (last) d.push(t - last);
      last = t;
      if (t < end) { requestAnimationFrame(step); return; }
      fpsBusy = false;
      if (d.length < 10) return;
      d.sort((a, b) => a - b);
      fpsSamples.push(d[d.length >> 1]);
      if (fpsSamples.length < 3) return;
      const med = fpsSamples.slice().sort((a, b) => a - b)[fpsSamples.length >> 1];
      const slow = med > 25; // меньше 40 кадров в секунду
      if (slow && !LITE) {
        LITE = true;
        document.documentElement.classList.add('lite');
        render();
      }
      try { if (slow) localStorage.setItem('lite', '1'); else if (med < 19) localStorage.removeItem('lite'); } catch (e) { /* хранилище недоступно */ }
    };
    requestAnimationFrame(step);
  }
  $('#map').addEventListener('pointerdown', measureFps, { passive: true });

  function layout(places, view) {
    const { w, h } = getMapSize();
    const b = view.bounds;
    const mN = merc(b.north), mS = merc(b.south);
    const far = view.zoom < 13.5;
    const R = far ? 13 : 19;                 // радиус метки, px
    const GAP = far ? 32 : 46;               // минимальное расстояние между центрами меток, px
    const MAX_MARKERS = LITE ? 30 : LOW_END ? 45 : 70;   // больше меток телефону рисовать тяжело
    const MAX_LABELS = LITE ? 12 : LOW_END ? 18 : 30;
    const sel = state.selected;

    const pts = [];
    for (const p of places) {
      const x = ((p.lon - b.west) / (b.east - b.west)) * w;
      if (p._my === undefined) p._my = merc(p.lat); // проекция широты не меняется — считаем один раз
      const y = ((mN - p._my) / (mN - mS)) * h;
      // считаем и чуть за краем экрана (четверть), чтобы при сдвиге карты метки не «выпрыгивали»
      if (x < -w / 4 || x > w * 1.25 || y < -h / 4 || y > h * 1.25) continue;
      const selected = !!sel && sel.id === p.id;
      pts.push({ p, x, y, selected, inView: x >= 0 && x <= w && y >= 0 && y <= h, prio: selected ? Infinity : priority(p) });
    }
    pts.sort((a, c) => (c.inView - a.inView) || (c.prio - a.prio));

    // Порог — только в режиме «Все»: если выбрана категория, показываем её места сразу (без наложений)
    const fewPlaces = state.collection || state.route; // подборка или маршрут — мест немного
    const minP = !state.cats.size && !fewPlaces ? minPriority(view.zoom) : 0;
    // В подборке и маршруте показываем все места, даже если метки накладываются (например, башни Сити)
    const gap = fewPlaces ? 0 : GAP;
    const shown = [];
    for (const t of pts) {
      if (t.prio < minP && t.p.source !== 'live') continue; // найденное через «Найти здесь» показываем всегда
      if (!t.selected && shown.length >= MAX_MARKERS) continue;
      if (!t.selected && shown.some((s) => Math.abs(s.x - t.x) < gap && Math.abs(s.y - t.y) < gap)) continue;
      shown.push(t);
    }

    // Подписи: только с масштаба 12 и только если не налезают на метки и другие подписи
    const boxes = shown.map((s) => [s.x - R, s.y - R, s.x + R, s.y + R]);
    let labels = 0;
    const hit = (a) => boxes.some((bx) => a[0] < bx[2] && a[2] > bx[0] && a[1] < bx[3] && a[3] > bx[1]);
    for (const s of shown) {
      s.label = false;
      if (view.zoom < 12 || (!s.selected && (!s.inView || labels >= MAX_LABELS))) continue;
      const lw = Math.min(130, s.p.name.length * 6.2 + 16);
      const box = [s.x - lw / 2, s.y + R + 2, s.x + lw / 2, s.y + R + 20];
      if (s.selected || !hit(box)) { s.label = true; boxes.push(box); labels++; }
    }
    const inView = pts.filter((t) => t.inView).length;
    const shownInView = shown.filter((t) => t.inView).length;
    return { shown, inView, shownInView };
  }

  function render() {
    if (!MapView.impl || !state.view) return;
    const places = allPlaces().filter(matches);
    const sel = state.selected;
    if (sel && !places.includes(sel)) places.push(sel);
    const { shown, inView, shownInView } = layout(places, state.view);
    const far = state.view.zoom < 13.5;
    const items = shown.map((s) => {
      // в маршруте у меток номера остановок
      const n = state.route ? state.route.indexOf(s.p.id) + 1 : 0;
      const z = s.selected ? 1000 : Math.min(999, Math.round(Math.log10((s.p.pop || 0) + 1) * 100));
      // Яндекс Карты: метки рисуются на холсте — передаём не элемент, а что нарисовать
      if (MapView.canvasMarkers) {
        return {
          id: s.p.id, lat: s.p.lat, lon: s.p.lon, z, cat: s.p.cat, name: s.p.name, label: s.label, num: n,
          active: s.selected, fav: favs.has(s.p.id), far, small: s.p.source === 'live',
          onClick: () => { haptic.tap(); openPlace(s.p); },
        };
      }
      const el = markerEl(s.p);
      el.classList.toggle('mk--label', s.label);
      el.classList.toggle('mk--route', n > 0);
      if (n) el.dataset.num = n;
      return { id: s.p.id, lat: s.p.lat, lon: s.p.lon, el, z };
    });
    MapView.setMarkers(items);
    // Кэш меток не растёт бесконечно: за долгую прогулку по карте набегали бы тысячи элементов
    if (markerEls.size > 400) {
      const keep = new Set(items.map((it) => it.id));
      for (const id of markerEls.keys()) if (!keep.has(id)) markerEls.delete(id);
    }
    updatePill(places.length, inView, shownInView);
  }

  function updatePill(total, inView, shownInView) {
    const pill = $('#pill');
    pill.classList.toggle('pill--warn', total === 0);
    if (state.route) pill.textContent = `Маршрут · ${placesWord(state.route.length)}`;
    else if (total === 0) pill.textContent = 'Ничего не нашлось — попробуй смягчить фильтры';
    else if (state.collection && inView < total) pill.textContent = `Здесь ${inView} из ${total} · отдали карту, чтобы увидеть все`;
    else if (shownInView < inView) pill.textContent = `${shownInView} из ${inView} · приблизь — покажу больше`;
    else pill.textContent = `${inView} ${plural(inView, 'место', 'места', 'мест')} здесь`;
  }

  // После движения карты — новая раскладка меток под масштаб
  let curBounds = null;
  function onMove(view) {
    state.view = view;
    // рамку «не дальше МКАД» подгоняем под масштаб: так в приближении за МКАД не уехать,
    // а при полном отдалении Москва остаётся по центру экрана
    const nb = viewBounds(view.zoom);
    if (!curBounds || ['south', 'north', 'west', 'east'].some((k) => Math.abs(nb[k] - curBounds[k]) > 0.002)) {
      curBounds = nb;
      try { MapView.setBounds(nb); } catch (e) { /* карта ещё не готова */ }
      // Яндекс сам не возвращает карту в рамку после её смены — если экран вылез за рамку
      // (например, при резком отдалении Москва прижалась к краю), плавно сдвигаем обратно
      const v = view.bounds, mN = merc(v.north), mS = merc(v.south), bN = merc(nb.north), bS = merc(nb.south);
      let dy = 0, dx = 0;
      if (mN - mS >= bN - bS - 1e-6) dy = (bN + bS) / 2 - (mN + mS) / 2;
      else if (mN > bN) dy = bN - mN;
      else if (mS < bS) dy = bS - mS;
      if (v.east - v.west >= nb.east - nb.west - 1e-6) dx = (nb.east + nb.west) / 2 - (v.east + v.west) / 2;
      else if (v.east > nb.east) dx = nb.east - v.east;
      else if (v.west < nb.west) dx = nb.west - v.west;
      if (Math.abs(dy) > 1e-4 || Math.abs(dx) > 1e-4) {
        const cy = (mN + mS) / 2 + dy;
        MapView.flyTo((Math.atan(Math.exp(cy)) * 360) / Math.PI - 90, (v.east + v.west) / 2 + dx, view.zoom);
      }
    }
    const map = $('#map');
    map.classList.toggle('zoom-far', view.zoom < 13.5);
    updateSearchHere();
    render(); // раскладка меток под новый масштаб — быстро (около 1 мс на 250 мест)
  }

  // ---------- Шторки ----------
  let openSheetName = null;

  function openSheet(name) {
    // открыли что-то другое (поиск, фильтры…) поверх маршрута — убираем маршрут с карты
    if (activeRoute && !['route', 'place', 'age'].includes(name)) closeRoute();
    if (openSheetName !== name) {
      document.querySelectorAll('.sheet.open').forEach(hideSheet);
      const el = $(`#${name}-sheet`);
      el.scrollTop = 0;
      // Шторка выезжает уже готовой: сначала браузер верстает и рисует её содержимое, пока она
      // ещё за краем экрана (отдельным слоем), и только через два кадра начинается анимация.
      // Раньше вся эта работа приходилась на первые кадры выезда — отсюда рывок
      clearTimeout(el._prepTimer);
      el.classList.add('sheet--prep');
      void el.offsetHeight;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (openSheetName === name) el.classList.add('open');
      }));
      openSheetName = name;
    }
    $('#backdrop').classList.add('show');
    $('#backdrop').classList.toggle('backdrop--light', name === 'place' || name === 'route' || name === 'near');
    document.body.classList.add('sheet-open');
    if (supports('6.1')) tg.BackButton.show();
  }

  // Убрать шторку; отдельный слой для анимации держим, пока она не уедет, потом освобождаем память
  function hideSheet(s) {
    s.classList.remove('open');
    s.style.transform = '';
    clearTimeout(s._prepTimer);
    s._prepTimer = setTimeout(() => { if (!s.classList.contains('open')) s.classList.remove('sheet--prep'); }, 450);
  }

  function closeSheets() {
    document.querySelectorAll('.sheet.open, .sheet--prep').forEach(hideSheet);
    $('#backdrop').classList.remove('show');
    document.body.classList.remove('sheet-open');
    $('#search-input').blur();
    // Окно «есть 18?» закрыли без ответа — считаем, что «нет»
    if (ageResolve) { const r = ageResolve; ageResolve = null; r(false); }
    const was = openSheetName;
    if (was === 'place') {
      state.selected = null;
      state.lucky = false;
      render();
    }
    openSheetName = null;
    if (supports('6.1')) tg.BackButton.hide();
    if (was === 'route') closeRoute();
    // закрыли фильтры маршрутов — возвращаемся к списку маршрутов
    else if (was === 'rfilters') { renderRoutes(); openSheet('routes'); }
    // закрыли карточку места, открытую из маршрута, — возвращаемся к маршруту
    else if (was === 'place' && activeRoute) openSheet('route');
    // карточку открыли из «Куда сегодня?» или достижений — возвращаемся туда же
    else if (was === 'place' && placeBack) {
      const back = placeBack;
      placeBack = null;
      if (back === 'today') renderToday();
      else if (back === 'awards') rerenderAwards();
      openSheet(back);
      // туда же, где был список, — а не наверх (шторка уже свёрстана в openSheet)
      $(`#${back}-sheet`).scrollTop = backScroll;
    }
  }
  let backScroll = 0; // где был список «Куда сегодня?» или профиля, когда открыли место

  // Закрытие шторки свайпом вниз
  function enableSwipe(sheet) {
    let startY = null, dy = 0;
    sheet.addEventListener('touchstart', (e) => {
      // ползунок бюджета тянут пальцем — это не жест закрытия шторки
      if (sheet.scrollTop > 0 || e.target.closest('input[type=range]')) return;
      startY = e.touches[0].clientY;
      dy = 0;
      sheet.style.transition = 'none';
    }, { passive: true });
    sheet.addEventListener('touchmove', (e) => {
      if (startY === null) return;
      dy = Math.max(0, e.touches[0].clientY - startY);
      sheet.style.transform = `translateY(${dy}px)`;
    }, { passive: true });
    sheet.addEventListener('touchend', () => {
      if (startY === null) return;
      sheet.style.transition = '';
      sheet.style.transform = '';
      startY = null;
      if (dy > 90) closeSheets();
    });
  }

  // ---------- Карточка места ----------
  function infoHtml(p, todayHours, site) {
    const rows = [];
    if (p.address) rows.push(`<li>${icon('pin')}<span>${esc(p.address)}${p.district ? `<small class="place-district">${esc(p.district)}</small>` : ''}</span></li>`);
    const metro = nearestMetro(p);
    if (metro) rows.push(`<li class="metro-row">${metroHtml(metro)}</li>`);
    if (todayHours) rows.push(`<li>${icon('clock')}<span>Сегодня: ${todayHours}</span></li>`);
    if (site) rows.push(`<li>${icon('globe')}<a href="#" data-action="site" data-url="${esc(site)}">Сайт места</a></li>`);
    return rows.length ? `<ul class="place-info">${rows.join('')}</ul>` : '';
  }

  function listHtml(title, items) {
    if (!items.length) return '';
    const shown = items.slice(0, LIST_LIMIT).map((t) => `<span class="mini-tag">${esc(t)}</span>`).join('');
    const more = items.length > LIST_LIMIT ? `<span class="mini-tag mini-tag--more">и ещё ${items.length - LIST_LIMIT}</span>` : '';
    return `<div class="inside"><div class="inside-title">${title}</div><div class="inside-list">${shown}${more}</div></div>`;
  }

  // Что внутри ТЦ или фудкорта
  // Фото места (свободные лицензии с Wikimedia Commons) с подписью автора — так требует лицензия
  function photoHtml(p) {
    const ph = (window.PLACE_PHOTOS || {})[p.id];
    if (!ph) return '';
    const credit = ['Фото: ' + (ph.author || 'Wikimedia Commons'), ph.license].filter(Boolean).join(' · ');
    const link = ph.page ? ` data-action="site" data-url="${esc(ph.page)}"` : '';
    return `
      <figure class="place-photo is-loading">
        <img src="${esc(ph.src)}?v=${encodeURIComponent(window.APP_VERSION || '')}" alt="${esc(p.name)}" decoding="async"
             onload="this.parentNode.classList.remove('is-loading')" onerror="this.parentNode.remove()">
        <figcaption><a href="#"${link}>${esc(credit)}</a></figcaption>
      </figure>`;
  }

  // Кухни, а для ТЦ и фудкортов — что внутри (данные из Яндекс Карт)
  function insideHtml(p) {
    const eat = p.eat || [], cuisine = p.cuisine || [];
    const fun = (p.fun || []).map(([name, label]) => (label ? `${name} · ${label}` : name));
    if (p.kind === 'food_court') {
      return listHtml('Кухни', cuisine) + listHtml('Места внутри', eat) + listHtml('Развлечения', fun);
    }
    if (p.kind === 'mall') {
      if (!eat.length && !fun.length) return '<p class="place-note">Что внутри — смотри в карточке Яндекс Карт ниже.</p>';
      return listHtml('Развлечения', fun) + listHtml('Где поесть', eat);
    }
    return listHtml('Кухня', cuisine);
  }

  function favButtonHtml(p) {
    const on = favs.has(p.id);
    return `<button class="icon-btn${on ? ' is-fav' : ''}" data-action="fav" aria-pressed="${on}" aria-label="${on ? 'Убрать из избранного' : 'В избранное'}">${icon(on ? 'heart-fill' : 'heart')}</button>`;
  }

  function placeHtml(p) {
    const st = Hours.status(p.hours);
    const todayHours = Hours.today(p.hours);
    const d = state.user ? distance(state.user, p) : null;
    const site = p.website ? (/^https?:\/\//.test(p.website) ? p.website : 'https://' + p.website) : null;
    return `
      <div class="sheet-handle"></div>
      ${photoHtml(p)}
      <div class="place-head">
        <div class="place-title">
          <div class="place-cat cat--${p.cat}">${icon(p.cat)}${catLabel(p)}${CATS[p.cat].adult ? AGE_BADGE : ''}</div>
          <h2>${esc(p.name)}</h2>
          ${p.fullName ? `<div class="place-full">${esc(p.fullName)}</div>` : ''}
          ${p.note ? `<div class="place-full">${esc(p.note)}</div>` : ''}
        </div>
        <div class="head-actions">
          ${p.source === 'live' ? '' : `<button class="icon-btn" data-action="share" aria-label="Позвать друга">${icon('share')}</button>${favButtonHtml(p)}`}
          <button class="icon-btn" data-action="close" aria-label="Закрыть">${icon('close')}</button>
        </div>
      </div>
      <div class="tags">
        <span class="tag tag--${st.state}">${st.text}</span>
        <span class="tag${priceUnknown(p) ? ' tag--unknown' : ''}">${priceText(p)}</span>
        <span class="tag">${SETTING_TEXT[p.setting] || ''}</span>
        ${d !== null ? `<span class="tag">${distanceText(d)}</span>` : ''}
        ${p.source === 'live' ? '' : visitButtonHtml(p)}
      </div>
      ${p.source === 'live' ? '' : `<div class="rate-slot">${rateHtml(p)}</div>`}
      ${p.desc ? `<p class="place-desc">${esc(p.desc)}</p>` : ''}
      ${insideHtml(p)}
      ${infoHtml(p, todayHours, site)}
      <button class="ya-link" data-action="yandex">
        <span class="ya-star">${icon('star')}</span>
        <span class="ya-text">${p.rating
          ? `<b>${ratingText(p)}</b><small>Отзывы и фото — в Яндекс Картах</small>`
          : '<b>Оценка, отзывы и фото</b><small>Откроется в Яндекс Картах</small>'}</span>
        <span class="ya-arrow">›</span>
      </button>
      <div class="place-actions">
        <button class="btn btn-primary" data-action="route">Как добраться</button>
        ${p.source === 'live' ? '' : draftButtonHtml(p)}
      </div>
      ${state.lucky ? `<button class="btn btn-secondary btn-wide" data-action="again">${icon('dice')} Ещё вариант</button>` : ''}`;
  }

  function draftButtonHtml(p) {
    const inDraft = draft.includes(p.id);
    return `<button class="btn btn-secondary" data-action="add-route">${inDraft ? `${icon('check')} В маршруте` : `${icon('plus')} В маршрут`}</button>`;
  }

  function openPlace(p, opts) {
    opts = opts || {};
    placeBack = null;
    state.selected = p;
    state.lucky = !!opts.lucky;
    $('#place-sheet').innerHTML = placeHtml(p);
    openSheet('place');
    afterSheet(() => {
      if (state.selected !== p) return; // карточку уже закрыли или открыли другую
      render(); // выделить метку
      // Сдвигаем карту так, чтобы место было видно над карточкой
      const current = state.view ? state.view.zoom : cfg.START_ZOOM;
      const zoom = opts.lucky || opts.focus ? Math.max(current, 15) : current;
      const degPerPx = (1.40625 * Math.cos((p.lat * Math.PI) / 180)) / Math.pow(2, zoom);
      MapView.flyTo(p.lat - window.innerHeight * 0.2 * degPerPx, p.lon, zoom);
    });
  }

  // Работа с картой после открытия шторки — отдельной задачей: шторка начинает выезжать сразу
  // (анимацию ведёт видеокарта), а перестройка карты не задерживает касание и первый кадр
  function afterSheet(fn) {
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(fn, 0)));
  }

  // Поиск места в Яндекс Картах рядом с его координатами — откроется карточка с оценкой, отзывами и фото
  // С адресом (улица + дом) Яндекс сразу открывает карточку места, а не список результатов
  function yandexPlaceUrl(p) {
    // У мест из подборки есть номер организации в Яндексе — открываем ровно её карточку
    if (p.ym) return `https://yandex.ru/maps/org/${p.ym}/`;
    let text = p.name.replace(/[«»"]/g, '');
    const parts = (p.address || '').split(',').map((s) => s.trim());
    const house = parts.findIndex((s, i) => i > 0 && /^\d/.test(s));
    if (house > 0) text += ', ' + parts.slice(0, house + 1).join(', ');
    return `https://yandex.ru/maps/213/moscow/?text=${encodeURIComponent(text)}&ll=${p.lon},${p.lat}&z=17`;
  }

  function routeUrl(p) {
    const d = state.user ? distance(state.user, p) : null;
    const from = state.user ? `${state.user.lat.toFixed(5)},${state.user.lon.toFixed(5)}` : '';
    const mode = d !== null && d < 3000 ? 'pd' : 'mt';
    return `https://yandex.ru/maps/?rtext=${from}~${p.lat},${p.lon}&rtt=${mode}`;
  }

  // ---------- «Мне повезёт» ----------
  // Сужает список: сначала места рядом (если знаем, где пользователь), потом те, что ещё не выпадали
  function narrow(list) {
    if (state.user) {
      const near = list.filter((p) => distance(state.user, p) < 4000);
      if (near.length >= 3) list = near;
    }
    const fresh = list.filter((p) => !state.recent.includes(p.id));
    return fresh.length ? fresh : list;
  }

  function lucky() {
    // Бары (18+) выпадают, только если человек сам выбрал эту категорию
    const pool = narrow(allPlaces().filter((p) => matches(p) && !disliked(p) && (p.cat !== 'night' || state.cats.has('night'))));
    if (!pool.length) {
      haptic.notify('error');
      toast('Под такие фильтры ничего нет — попробуй их смягчить');
      return;
    }
    // случайно, но с учётом профиля и оценок: что тебе ближе, выпадает чаще
    let pick = pool[Math.floor(Math.random() * pool.length)];
    if (profile || taste().size) {
      const w = pool.map((p) => profileK(p) * tasteK(p));
      let r = Math.random() * w.reduce((s, x) => s + x, 0);
      for (let i = 0; i < pool.length; i++) { r -= w[i]; if (r <= 0) { pick = pool[i]; break; } }
    }
    state.recent.push(pick.id);
    if (state.recent.length > 15) state.recent.shift();

    const btn = $('#lucky');
    btn.classList.remove('rolling');
    void btn.offsetWidth;
    btn.classList.add('rolling');
    haptic.impact('medium');
    openPlace(pick, { lucky: true });
  }

  // ---------- Списки мест (поиск, избранное) ----------
  const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е');
  // Парк, сквер, сад, усадьба, заповедник — с начала слова: иначе «фасад» считался садом, а «парковка» — парком
  // (текст уже в нижнем регистре и с «е» вместо «ё», см. norm)
  const PARK_RE = /(^|[^а-я])(парк(?!овк)|сквер|сад|заповедник|усадьб)|лесопарк/;
  // Бар, паб, кальянная — по целым словам: «бариста», «Барвиха», «барашек», «беш-бармак» — не бары,
  // и «суши-бар» — это ресторан, а не бар
  const BAR_RE = /(^|[^а-я])(бар[аеуы]?|баром|барах|паб|пабъ|спортбар|гастробар)(?![а-я])|кальян/;
  const barPlace = (p) => { if (p.cat === 'night') return true; const t = placeText(p); return BAR_RE.test(t.includes('суши-бар') ? t.replace(/суши-бар/g, '') : t); };
  const NOISE_RE = /караоке|(^|[^а-я])клуб(а|е|у|ы|ом)?(?![а-я])/;
  // Улицы и достопримечательности: «площадь» — но не «площадка» (детская, смотровая — это не достопримечательность)
  const SIGHTS_RE = /достопримечательн|улица|площад(ь|и|ью|ей|ям|ях)(?![а-я])|бульвар|набережн|мост|переул/;

  // Подсвечивает найденное слово в названии
  function highlight(name, q) {
    const w = norm(q).trim().split(/\s+/)[0];
    const i = w ? norm(name).indexOf(w) : -1;
    if (i < 0) return esc(name);
    return esc(name.slice(0, i)) + '<mark>' + esc(name.slice(i, i + w.length)) + '</mark>' + esc(name.slice(i + w.length));
  }

  // note — почему место нашлось, если не по названию («Кухня: грузинская», «Внутри: Шоколадница»)
  function rowHtml(p, q, note) {
    const st = Hours.status(p.hours).state;
    const sub = note || p.address;
    return `<button class="row" type="button" data-id="${esc(p.id)}">
      <span class="row-icon cat--${p.cat}">${icon(p.cat)}</span>
      <span class="row-text"><b>${q ? highlight(p.name, q) : esc(p.name)}</b><small>${p.rating ? `<span class="row-rating">${STAR}${p.rating.toFixed(1).replace('.', ',')}</span> · ` : ''}${esc(catLabel(p))}${sub ? ' · ' + esc(sub) : ''}${state.budget !== null && priceUnknown(p) ? ' · <span class="row-unknown">чек неизвестен</span>' : ''}</small></span>
      ${st === 'unknown' ? '' : `<span class="row-state row-state--${st}">${st === 'open' ? 'Открыто' : 'Закрыто'}</span>`}
    </button>`;
  }

  const collTileHtml = (c) => `<button class="coll${c.season ? ' coll--season' : ''}" type="button" data-coll="${c.id}">
      ${emo(c.emoji, 'coll-emoji')}<span class="coll-text"><b>${esc(c.title)}</b><small>${c.season ? 'По сезону · ' : ''}${c.set.size} ${plural(c.set.size, 'место', 'места', 'мест')}</small></span>
    </button>`;

  // ---------- Сезонная подборка ----------
  // Собирается сама из мест на карте — по рубрикам и описаниям из Яндекс Карт, лучшие по оценкам.
  // Осенью — парки, сады и усадьбы; зимой — катки; весной — сады; летом — набережные, пруды, парки
  const SEASON_COLLS = {
    autumn: { emoji: '🍂', title: 'Золотая осень', test: (p, t) => p.cat === 'photo' && p.setting !== 'indoor' && (PARK_RE.test(t) || /роща/.test(t)) },
    winter: { emoji: '⛸', title: 'Катки', test: (p, t) => /каток|катки/.test(t) || (p.fun || []).some((f) => /каток/i.test(f.join(' '))) },
    spring: { emoji: '🌸', title: 'Весенние сады', test: (p, t) => p.cat === 'photo' && /(^|[^а-я])сад|ботаническ|оранжере/.test(t) },
    summer: { emoji: '☀️', title: 'Лето на воздухе', test: (p, t) => p.cat === 'photo' && p.setting !== 'indoor' && (PARK_RE.test(t) || /набережн|пруд|пляж|смотров/.test(t)) },
  };
  let seasonFor = 0;
  function refreshSeasonColl() {
    if (seasonFor === curated.length) return;
    seasonFor = curated.length;
    const def = SEASON_COLLS[SEASON];
    const i = COLLECTIONS.findIndex((c) => c.season);
    if (i >= 0) COLLECTIONS.splice(i, 1);
    const q = (p) => Math.sqrt(p.pop || 30) * (p.rating >= 4.8 ? 1.3 : 1);
    const top = curated.filter((p) => p.rating >= 4.5 && def.test(p, placeText(p))).sort((a, b) => q(b) - q(a)).slice(0, 16);
    if (top.length >= 3) COLLECTIONS.unshift({ id: 'season', season: true, emoji: def.emoji, title: def.title, set: new Set(top.map((p) => p.id)) });
  }

  // ---------- Поиск ----------
  // Сначала ищем в названии, потом в кухнях, заведениях внутри ТЦ, адресе и описании
  const indexItem = (p) => ({
    p,
    name: norm(p.name + ' ' + (p.fullName || '')),
    rest: norm([(p.cuisine || []).join(' '), (p.eat || []).join(' '), (p.fun || []).map((f) => f[0]).join(' '),
      p.address, p.district, catLabel(p), p.desc].join(' ')),
  });
  // Индекс строится при первом поиске, а не при запуске: так телефону меньше работы, пока грузится карта
  let searchIndex = null;
  const getSearchIndex = () => searchIndex || (searchIndex = curated.map(indexItem));
  // После загрузки мест индекс достраивается понемногу в паузах, когда телефон свободен, —
  // тогда и первый поиск мгновенный, и запуск не тормозит
  function warmSearchIndex() {
    if (searchIndex) return;
    const idle = window.requestIdleCallback || ((cb) => setTimeout(() => cb({ timeRemaining: () => 6 }), 60));
    const list = curated.slice(), built = [];
    let i = 0;
    const work = (dl) => {
      if (searchIndex) return; // поиск успел построить индекс сам
      while (i < list.length && dl.timeRemaining() > 1) built.push(indexItem(list[i++]));
      if (i < list.length) idle(work);
      else searchIndex = built;
    };
    idle(work);
  }

  // ---------- Места по районам (js/places-districts.js) ----------
  // ~1700 мест грузятся уже после появления карты, чтобы не задерживать запуск
  const SETTING_CODES = { i: 'indoor', o: 'outdoor', b: 'both' };
  function loadDistrictPlaces() {
    return new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = 'js/places-districts.js?v=' + encodeURIComponent(window.APP_VERSION || '');
      s.onload = () => {
        const data = window.DISTRICT_PLACES;
        if (!data) return resolve();
        const col = {};
        data.cols.forEach((c, i) => (col[c] = i));
        const rows = data.rows;
        // Разбираем порциями по 300 мест: на слабом телефоне 2000 мест за раз подвешивали бы карту
        let i = 0;
        const step = () => {
          const end = Math.min(rows.length, i + 300);
          for (; i < end; i++) {
            const r = rows[i];
            const v = (k) => r[col[k]];
            if (byId.has('y' + v('ym'))) continue;
            const p = {
              id: 'y' + v('ym'), ym: v('ym'), pop: v('pop'), name: v('name'), cat: v('cat'),
              setting: SETTING_CODES[v('setting')], hours: v('hours') || null, address: v('address'),
              district: data.districts[v('district')], lat: v('lat'), lon: v('lon'), desc: v('desc'), source: 'curated',
            };
            if (v('rating')) p.rating = v('rating');
            if (v('bill')) p.bill = v('bill');
            if (v('cup')) p.cup = v('cup');
            if (v('free')) p.free = true;
            if (v('cuisine')) p.cuisine = v('cuisine').split(', ');
            if (v('fullName')) p.fullName = v('fullName');
            curated.push(p);
            byId.set(p.id, p);
            if (searchIndex) searchIndex.push(indexItem(p));
          }
          if (i < rows.length) setTimeout(step, 0);
          else { window.DISTRICT_PLACES = null; resolve(); }
        };
        step();
      };
      s.onerror = () => resolve(); // без мест по районам приложение всё равно работает
      document.head.appendChild(s);
    });
  }

  function search(q) {
    const words = norm(q).split(/[\s,.«»"]+/).filter(Boolean);
    if (!words.length) return [];
    const res = [];
    for (const it of getSearchIndex()) {
      if (it.p.cat === 'night' && !adultOk) continue;
      let score = 0;
      for (const w of words) {
        const s = it.name.startsWith(w) ? 30 : it.name.includes(' ' + w) ? 20 : it.name.includes(w) ? 12 : it.rest.includes(w) ? 4 : 0;
        if (!s) { score = 0; break; }
        score += s;
      }
      if (score) res.push({ p: it.p, note: it.name.includes(words[0]) ? null : matchNote(it.p, words[0]), score: score + Math.log10((it.p.pop || 0) + 1) });
    }
    return res.sort((a, b) => b.score - a.score).slice(0, 40);
  }

  function matchNote(p, w) {
    const hit = (arr) => (arr || []).find((x) => norm(x).includes(w));
    let h;
    if ((h = hit(p.cuisine))) return 'Кухня: ' + h;
    if ((h = hit(p.eat) || hit((p.fun || []).map((f) => f[0])))) return 'Внутри: ' + h;
    if (p.district && norm(p.district).includes(w)) return p.district;
    return null;
  }

  function renderSearch() {
    const q = $('#search-input').value.trim();
    $('#search-clear').hidden = !q;
    const body = $('#search-body');
    if (!q) {
      body.innerHTML = `<div class="section-title">Подборки</div><div class="colls">${COLLECTIONS.map(collTileHtml).join('')}</div>`;
      return;
    }
    const colls = COLLECTIONS.filter((c) => norm(c.title).includes(norm(q)));
    const found = search(q);
    body.innerHTML =
      (colls.length ? `<div class="colls">${colls.map(collTileHtml).join('')}</div>` : '') +
      (found.length
        ? `<div class="section-title">Места <small>${found.length}</small></div><div class="rows">${found.map((r) => rowHtml(r.p, q, r.note)).join('')}</div>`
        : colls.length ? '' : '<p class="empty">Ничего не нашлось. Попробуй название места, кухню или улицу.</p>');
  }

  function openSearch() {
    haptic.tap();
    renderSearch();
    openSheet('search');
    $('#search-input').focus({ preventScroll: true }); // в том же нажатии — иначе iPhone не покажет клавиатуру
  }

  // ---------- Избранное: список ----------
  function renderFavs() {
    const list = [...favs].reverse().map((id) => byId.get(id)).filter(Boolean);
    $('#favs-sheet').innerHTML = '<div class="sheet-handle"></div><h2 class="sheet-title">Избранное</h2>' +
      (list.length
        ? `<div class="rows">${list.map((p) => rowHtml(p)).join('')}</div>`
        : '<p class="empty">Здесь будут места, которые ты сохранишь. Открой любое место на карте и нажми на сердечко.</p>');
  }

  // ---------- Рядом со мной ----------
  // Ближайшие места выбранного типа, отсортированные по расстоянию. Если геолокация недоступна — от центра карты.
  const NEAR_TABS = [
    { v: 'coffee', label: 'Кофе' },
    { v: 'food', label: 'Еда' },
    { v: 'photo', label: 'Красиво' },
    { v: 'night', label: 'Бары 18+' },
    { v: 'all', label: 'Всё' },
  ];
  let nearTab = 'coffee';
  let nearFrom = null; // { lat, lon, me: true/false }
  let nearOutside = false; // геолокация есть, но ты за МКАД

  function renderNear() {
    document.querySelectorAll('#near-tabs .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.v === nearTab));
    if (!nearFrom) return;
    const list = curated
      .filter((p) => (nearTab === 'all' ? p.cat !== 'night' : p.cat === nearTab) && passesFilters(p))
      .map((p) => ({ p, d: distance(nearFrom, p) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 20);
    $('#near-note').textContent = nearFrom.me ? '' : nearOutside ? 'Похоже, ты за МКАД — показываю места рядом с центром карты' : 'Не получилось узнать, где ты, — показываю места рядом с центром карты';
    $('#near-list').innerHTML = list.length
      ? list.map(({ p, d }) => rowHtml(p, null, distanceText(d))).join('')
      : '<p class="empty">Под твои фильтры рядом ничего нет — попробуй их смягчить.</p>';
  }

  async function openNear() {
    haptic.tap();
    $('#near-list').innerHTML = '<p class="empty">Ищу, где ты…</p>';
    $('#near-note').textContent = '';
    nearFrom = null;
    nearOutside = false;
    renderNear();
    openSheet('near');
    try {
      const pos = state.user || (await Promise.race([getPosition(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 6000))]));
      state.user = pos;
      MapView.setUser(pos.lat, pos.lon, userEl());
      const b = cfg.MAP_BOUNDS;
      const inMoscow = pos.lat > b.south && pos.lat < b.north && pos.lon > b.west && pos.lon < b.east;
      nearFrom = inMoscow ? { lat: pos.lat, lon: pos.lon, me: true } : null;
      nearOutside = !inMoscow;
      // Показываем тебя на карте — над шторкой, между верхней панелью и её краем
      if (inMoscow && openSheetName === 'near') {
        const zoom = Math.max(state.view ? state.view.zoom : 0, 15);
        const H = getMapSize().h, sheetTop = window.innerHeight - $('#near-sheet').offsetHeight;
        const target = (150 + sheetTop) / 2; // где на экране должна оказаться метка «Ты здесь»
        const degPerPx = (1.40625 * Math.cos((pos.lat * Math.PI) / 180)) / Math.pow(2, zoom);
        MapView.flyTo(pos.lat - (H / 2 - target) * degPerPx, pos.lon, zoom);
      }
    } catch (e) { /* нет доступа к геолокации */ }
    if (!nearFrom) {
      const v = state.view.bounds;
      nearFrom = { lat: (v.north + v.south) / 2, lon: (v.east + v.west) / 2, me: false };
    }
    renderNear();
  }

  // ---------- Маршруты ----------
  // Готовые маршруты (routes.js) и свой: «+ В маршрут» в карточке места. Время = дорога пешком + время в местах.
  // Лайки и сохранённые маршруты пока хранятся у пользователя (телефон + облако Telegram); общий счётчик — на сервере позже.
  const ROUTE_MAX = 10;
  const WALK_M_PER_MIN = 70; // прогулочный шаг, ~4,2 км/ч
  // Сезон по московскому месяцу: сезонные маршруты видны только в своё время года
  const MSK_OFFSET = 3 * 3600000; // Москва — UTC+3 круглый год
  const pad2 = (n) => String(n).padStart(2, '0');
  const SEASON = (() => {
    const m = new Date(Date.now() + MSK_OFFSET).getUTCMonth() + 1;
    return m === 12 || m <= 2 ? 'winter' : m <= 5 ? 'spring' : m <= 8 ? 'summer' : 'autumn';
  })();
  const SEASON_LABEL = { winter: 'Зима', spring: 'Весна', summer: 'Лето', autumn: 'Осень' };
  const inSeason = (r) => !r.season || r.season === SEASON;

  // Сколько обычно проводят в месте (мин): зависит от типа и «размера» места
  // Подбор маршрута спрашивает время и цену у сотен мест по много раз — считаем один раз на место
  const stayCache = new WeakMap(), priceCache = new WeakMap();
  function stayFor(p, r) {
    if (r && r.stay && r.stay[p.id]) return r.stay[p.id]; // у готового маршрута может быть своё время (короткая прогулка)
    let m = stayCache.get(p);
    if (m === undefined) stayCache.set(p, (m = baseStay(p)));
    return m;
  }
  function baseStay(p) {
    const desc = (p.desc || '') + ' ' + p.name;
    switch (p.cat) {
      case 'coffee': return 25;
      case 'food': {
        if (/Быстрое питание|Столовая|Шаурма|Пекарня/i.test(desc)) return 40;
        const lo = priceRange(p);
        return lo && lo[0] >= 2000 ? 90 : 60;
      }
      case 'museum': return p.pop >= 40000 ? 120 : p.pop >= 15000 ? 90 : 60; // Третьяковка — 2 ч, Булгаков — 1 ч
      case 'photo': return p.pop >= 50000 || (PARK_RE.test(norm(desc)) || /вднх|выставка/.test(norm(desc))) && p.pop >= 15000 ? 60 : 30;
      case 'mall': return p.kind === 'food_court' ? 45 : 60;
      case 'night': return 60;
      default: return 40;
    }
  }
  const stayText = (m) => (m >= 60 ? `${String(m / 60).replace('.', ',')} ч` : `${m} мин`);

  // Цена на человека «от–до» по данным Яндекса: [от, до] или null, если неизвестна (результат только читают)
  function priceRange(p) {
    let r = priceCache.get(p);
    if (r === undefined) priceCache.set(p, (r = parsePrice(p)));
    return r;
  }
  function parsePrice(p) {
    if (p.free || p.kind === 'mall') return [0, 0];
    const s = p.bill || p.tickets || p.cup;
    if (!s) return null;
    const nums = (s.replace(/(\d)\s(?=\d)/g, '$1').match(/\d+/g) || []).map(Number);
    if (!nums.length) return null;
    if (/^до\s/i.test(s)) return [Math.round(nums[0] / 2), nums[0]];
    return [nums[0], nums[nums.length - 1]];
  }

  const rub = (n) => Math.round(n / 50) * 50; // до 50 ₽ — точнее всё равно не бывает
  function priceText2(lo, hi) {
    const f = (n) => rub(n).toLocaleString('ru-RU');
    if (hi === 0) return 'бесплатно';
    return rub(lo) === rub(hi) ? `≈ ${f(hi)} ₽` : `≈ ${f(lo)}–${f(hi)} ₽`;
  }
  const READY_ROUTES = window.ROUTES || [];
  let draft = [];          // id мест «моего маршрута» по порядку
  let savedRoutes = [];    // [{ id, title, ids }]
  const likedRoutes = new Set();
  let routesTab = 'ready';
  let activeRoute = null;  // маршрут, который сейчас на карте

  const readJson = (key, fallback) => { try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; } catch (e) { return fallback; } };
  draft = readJson('route_draft', []);
  savedRoutes = readJson('routes_saved', []);
  readJson('routes_liked', []).forEach((id) => likedRoutes.add(id));

  function saveRoutesData(key) {
    const data = { route_draft: draft, routes_saved: savedRoutes, routes_liked: [...likedRoutes] }[key];
    const s = JSON.stringify(data);
    try { localStorage.setItem(key, s); } catch (e) { /* хранилище недоступно */ }
    if (supports('6.9') && s.length < 4000) tg.CloudStorage.setItem(key, s);
  }

  function loadCloudRoutes() {
    if (!supports('6.9')) return;
    tg.CloudStorage.getItems(['route_draft', 'routes_saved', 'routes_liked', 'visited', 'routes_done', 'visit_days', 'rates'], (err, v) => {
      if (err || !v) return;
      const parse = (s) => { try { return JSON.parse(s); } catch (e) { return null; } };
      const d = parse(v.route_draft), s = parse(v.routes_saved), l = parse(v.routes_liked);
      const vis = parse(v.visited), done = parse(v.routes_done), days = parse(v.visit_days), rt = parse(v.rates);
      if (Array.isArray(d)) draft = d;
      if (Array.isArray(s)) savedRoutes = s;
      if (Array.isArray(l)) { likedRoutes.clear(); l.forEach((id) => likedRoutes.add(id)); }
      if (Array.isArray(vis)) vis.forEach((id) => visited.add(id));
      if (Array.isArray(done)) routesDone = done;
      // с другого устройства: добавляем то, чего здесь нет (здешнее новее — оставляем)
      if (days && typeof days === 'object' && !Array.isArray(days)) for (const [id, day] of Object.entries(days)) if (!(id in visitDays) && typeof day === 'number') visitDays[id] = day;
      if (rt && typeof rt === 'object' && !Array.isArray(rt)) { for (const [id, r] of Object.entries(rt)) if (!(id in rates) && (r === 1 || r === -1)) rates[id] = r; tasteMap = null; }
      updateDraftBadge();
      updateAwardBadge();
    });
  }

  const routePlaces = (ids) => ids.map((id) => byId.get(id)).filter(Boolean);

  // Цена одной остановки для списка: « · 500–700 ₽», « · бесплатно» или ничего
  function stopPrice(p) {
    const r = priceRange(p);
    if (!r) return '';
    return ' · ' + priceText2(r[0], r[1]).replace('≈ ', '');
  }

  const legMin = (a, b) => Math.max(1, Math.round((distance(a, b) * 1.3) / WALK_M_PER_MIN)); // улицы не прямые — +30%

  // Для списка маршрутов (без «от меня») результат не меняется — считаем один раз на маршрут
  const statsCache = new Map();
  function routeStats(ps, from, route) {
    const key = !from && route ? route.id + '|' + ps.map((p) => p.id).join(',') : null;
    if (key && statsCache.has(key)) return statsCache.get(key);
    const st = calcRouteStats(ps, from, route);
    if (key) statsCache.set(key, st);
    return st;
  }
  function calcRouteStats(ps, from, route) {
    let m = 0, walk = 0, lo = 0, hi = 0, unknown = 0;
    if (from && ps.length) { m += distance(from, ps[0]) * 1.3; walk += legMin(from, ps[0]); }
    for (let i = 1; i < ps.length; i++) { m += distance(ps[i - 1], ps[i]) * 1.3; walk += legMin(ps[i - 1], ps[i]); }
    for (const p of ps) {
      const r = priceRange(p);
      if (r) { lo += r[0]; hi += r[1]; } else unknown++;
    }
    const stay = ps.reduce((s, p) => s + stayFor(p, route), 0);
    return { km: m / 1000, walk, total: walk + stay, lo, hi, unknown };
  }
  // Время округляем до 15 минут: «~3 ч 45 мин»
  function durText(min) {
    if (min < 50) return `~${Math.max(10, Math.round(min / 10) * 10)} мин`;
    const q = Math.round(min / 15) * 15, h = Math.floor(q / 60), mm = q % 60;
    return `~${h} ч${mm ? ' ' + mm + ' мин' : ''}`;
  }
  function routePriceText(st) {
    const known = st.hi > 0 || st.unknown === 0 ? priceText2(st.lo, st.hi) : '';
    if (!st.unknown) return known === 'бесплатно' ? 'бесплатно' : `${known} на человека`;
    return known ? `${known} + где-то цена неизвестна` : 'цена неизвестна';
  }
  const kmText = (km) => (km < 1 ? `${Math.max(10, Math.round((km * 1000) / 10) * 10)} м` : `${km.toFixed(1).replace('.', ',')} км`);
  const placesWord = (n) => `${n} ${plural(n, 'место', 'места', 'мест')}`;

  function updateDraftBadge() {
    const n = routePlaces(draft).length;
    $('#draft-badge').textContent = n;
    $('#draft-badge').hidden = !n;
  }

  function routeCardHtml(r, kind) {
    const ps = routePlaces(r.ids);
    if (ps.length < 2) return '';
    const st = routeStats(ps, null, r);
    const liked = likedRoutes.has(r.id);
    const locked = r.adult && !adultOk;
    const done = routesDone.some((d) => d.id === r.id);
    // Обложка — фото первой остановки, у которой оно есть (с автором — так требует лицензия)
    const coverId = locked ? null : ps.map((p) => p.id).find((id) => (window.PLACE_PHOTOS || {})[id]);
    const ph = coverId && window.PLACE_PHOTOS[coverId];
    // для обложки — лёгкое превью 720×240 (img/thumbs), а не полное фото: список листается без рывков
    const cover = ph ? `<div class="route-cover"><img src="${esc(ph.src.replace('img/places/', 'img/thumbs/'))}?v=${encodeURIComponent(window.APP_VERSION || '')}" alt="" loading="lazy" decoding="async">
        <span>Фото: ${esc(ph.author || 'Wikimedia Commons')}${ph.license ? ' · ' + esc(ph.license) : ''}</span></div>` : '';
    return `<div class="route-card${locked ? ' route-card--locked' : ''}${ph ? ' route-card--cover' : ''}" data-route="${kind}:${esc(r.id)}" role="button" tabindex="0">
      ${cover}
      <div class="route-top">
        ${emo(r.emoji || '🚶', 'route-emoji')}
        <div class="route-title"><b>${esc(r.title)}${r.adult ? AGE_BADGE : ''}${r.season ? `<span class="season-badge">${SEASON_LABEL[r.season]}</span>` : ''}</b>
          <small>${durText(st.total)} · ${kmText(st.km)} пешком · ${placesWord(ps.length)}</small>
          <small class="route-price">${routePriceText(st)}${done ? ' · <span class="route-done">' + icon('check', 'ic-inline') + 'пройден</span>' : ''}</small></div>
        ${kind === 'saved'
          ? `<button class="icon-btn" type="button" data-del="${esc(r.id)}" aria-label="Удалить маршрут">${icon('close')}</button>`
          : `<button class="icon-btn${liked ? ' is-fav' : ''}" type="button" data-like="${esc(r.id)}" aria-pressed="${liked}" aria-label="Нравится">${icon(liked ? 'heart-fill' : 'heart')}</button>`}
      </div>
      ${r.desc ? `<p class="route-desc">${esc(r.desc)}</p>` : ''}
      <div class="route-chain">${locked ? 'Маршрут с барами — нажми, чтобы подтвердить возраст' : ps.map((p) => esc(p.name)).join(' → ')}</div>
    </div>`;
  }

  function draftHtml() {
    const ps = routePlaces(draft);
    if (!ps.length) {
      return `<div class="route-empty"><b>Собери свой маршрут</b>
        <p>Открой место на карте и нажми «+ В маршрут». Добавь 2–${ROUTE_MAX} мест — я посчитаю время и расстояние, а Яндекс Карты проведут по ним.</p></div>`;
    }
    const st = routeStats(ps);
    const stops = ps.map((p, i) => `<li class="draft-stop">
        <span class="stop-num cat--${p.cat}">${i + 1}</span>
        <span class="stop-name"><b>${esc(p.name)}</b><small>${esc(catLabel(p))} · ~${stayText(stayFor(p))}${stopPrice(p)}</small></span>
        <button class="icon-btn" type="button" data-move="${i}:-1" aria-label="Выше" ${i === 0 ? 'disabled' : ''}>${icon('up')}</button>
        <button class="icon-btn" type="button" data-move="${i}:1" aria-label="Ниже" ${i === ps.length - 1 ? 'disabled' : ''}>${icon('down')}</button>
        <button class="icon-btn" type="button" data-remove="${i}" aria-label="Убрать">${icon('close')}</button>
      </li>`).join('');
    return `<div class="draft">
      <div class="section-title">Мой маршрут <small>${ps.length > 1 ? `${durText(st.total)} · ${kmText(st.km)} пешком` : 'добавь ещё хотя бы одно место'}</small></div>
      ${ps.length > 1 ? `<div class="route-price draft-price">${routePriceText(st)}</div>` : ''}
      <ol class="draft-list">${stops}</ol>
      <div class="draft-actions">
        <button class="btn btn-primary" type="button" data-draft="show" ${ps.length < 2 ? 'disabled' : ''}>Показать на карте</button>
        <button class="btn btn-secondary" type="button" data-draft="save" ${ps.length < 2 ? 'disabled' : ''}>Сохранить</button>
      </div>
      <div class="draft-links">
        ${ps.length > 2 ? '<button type="button" data-draft="optimize">Удобный порядок</button>' : ''}
        <button type="button" data-draft="clear">Очистить</button>
      </div>
    </div>`;
  }

  function renderRoutes() {
    document.querySelectorAll('#routes-tabs .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.v === routesTab));
    const doneN = new Set(routesDone.map((d) => d.id)).size;
    $('#routes-stat').textContent = doneN ? `Пройдено маршрутов: ${doneN} · мест отмечено: ${visited.size}` : '';
    const body = $('#routes-body');
    if (routesTab === 'ready') {
      // понравившиеся — сверху; фильтр по времени и цене
      const list = READY_ROUTES.slice()
        .filter((r) => inSeason(r) && routeMatches(r))
        // сезонный — первым, потом понравившиеся
        .sort((a, b) => (!!b.season - !!a.season) || (likedRoutes.has(b.id) - likedRoutes.has(a.id)));
      const n = rfActive();
      body.innerHTML = genFormHtml() + `<div class="route-filter-bar">
          <button type="button" class="btn btn-surface route-filter-btn" data-rfilters>${icon('filters')} Фильтры${n ? ` <span class="badge">${n}</span>` : ''}</button>
          ${n ? '<button type="button" class="route-filter-reset" data-rfilters-reset>Сбросить</button>' : ''}
          <span class="route-filter-count">${list.length} ${plural(list.length, 'маршрут', 'маршрута', 'маршрутов')}</span>
        </div>
        <div class="route-list">${list.length ? list.map((r) => routeCardHtml(r, 'ready')).join('') : '<p class="empty">Под эти фильтры готовых маршрутов нет — смягчи их или попробуй «Собери маршрут за меня».</p>'}</div>
        <p class="f-note">Скоро: маршруты от других людей и «Популярные» по лайкам.</p>`;
    } else {
      body.innerHTML = draftHtml() + (savedRoutes.length
        ? `<div class="section-title">Сохранённые</div><div class="route-list">${savedRoutes.map((r) => routeCardHtml(r, 'saved')).join('')}</div>`
        : '');
    }
  }

  function openRoutes(tab) {
    haptic.tap();
    if (tab) routesTab = tab;
    renderRoutes();
    openSheet('routes');
  }

  function findRoute(key) {
    const [kind, id] = key.split(':');
    if (kind === 'ready') return READY_ROUTES.find((r) => r.id === id);
    if (kind === 'saved') return savedRoutes.find((r) => r.id === id);
    if (kind === 'draft') return { id: 'draft', title: 'Мой маршрут', emoji: '🚶', ids: draft.slice(), draft: true };
    return null;
  }

  // Показать маршрут на карте: только его места, номера и пунктир; снизу — список остановок
  function showRoute(r) {
    if (r.adult && !adultOk) { askAdult().then((ok) => ok && showRoute(r)); return; }
    const ps = routePlaces(r.ids);
    if (ps.length < 2) { toast('В маршруте должно быть хотя бы два места'); return; }
    activeRoute = Object.assign({}, r, { ids: ps.map((p) => p.id) });
    state.route = activeRoute.ids;
    state.selected = null;
    renderRouteSheet();
    openSheet('route');
    const cur = activeRoute;
    afterSheet(() => {
      if (activeRoute !== cur) return; // маршрут уже закрыли или показали другой
      drawRouteLine();
      render();
      fitPlaces(cur.fromMe ? [cur.fromMe].concat(ps) : ps, Math.round(window.innerHeight * 0.45));
    });
  }

  // ---------- «Когда идёшь?» ----------
  // Время по Москве: «сегодня в 19:00» считаем от московской даты, где бы ни был телефон.
  // Москва живёт по UTC+3 круглый год (без перехода на летнее время с 2014) — считаем простой арифметикой.
  // Intl с часовым поясом не нужен: его первое создание на слабом телефоне — пауза в десятки миллисекунд
  const mskDate = (d) => new Date(d.getTime() + MSK_OFFSET);
  const mskParts = (d) => {
    const m = mskDate(d);
    return { year: String(m.getUTCFullYear()), month: pad2(m.getUTCMonth() + 1), day: pad2(m.getUTCDate()), hour: pad2(m.getUTCHours()) };
  };
  const clock = (d) => { const m = mskDate(d); return pad2(m.getUTCHours()) + ':' + pad2(m.getUTCMinutes()); };

  // «Выхожу через …» — ползунок: шаги в минутах от «сейчас»
  // дальше — каждый час, до полутора суток: так можно спланировать и «завтра днём»
  const START_STEPS = [0, 15, 30, 45, 60, 90].concat(Array.from({ length: 35 }, (_, i) => (i + 2) * 60));
  const inText = (m) => (m < 60 ? `${m} мин` : `${String(m / 60).replace('.', ',')} ч`);
  function startLabel(m) {
    if (!m) return 'Сейчас';
    const at = new Date(Date.now() + m * 60000);
    const sameDay = mskParts(at).day === mskParts(new Date()).day;
    return `через ${m === 1440 ? 'сутки' : inText(m)} · в ${clock(at)}${sameDay ? '' : ', завтра'}`;
  }

  // Для каждой остановки: во сколько придёшь и успеешь ли, пока открыто
  function routeTimeline(r, ps) {
    let t = Date.now() + (r.startIn || 0) * 60000;
    if (r.fromMe) t += legMin(r.fromMe, ps[0]) * 60000;
    return ps.map((p, i) => {
      if (i) t += legMin(ps[i - 1], p) * 60000;
      const arrive = new Date(t);
      const stay = stayFor(p, r);
      const left = Hours.minutesLeft(p.hours, arrive);
      let warn = '';
      if (left === 0) {
        const open = Hours.minutesToOpen(p.hours, arrive);
        warn = open === null ? 'будет закрыто' : `будет закрыто — откроется в ${clock(new Date(t + open * 60000))}`;
      } else if (left !== null && left !== Infinity && left < stay) {
        warn = `закроется в ${clock(new Date(t + left * 60000))} — успеешь ~${Math.max(5, Math.round(left / 5) * 5)} мин`;
      }
      t += stay * 60000;
      return { arrive: clock(arrive), warn };
    });
  }

  // ---------- Пройденные места и маршруты ----------
  const visited = new Set(readJson('visited', []));
  let routesDone = readJson('routes_done', []); // [{ id, title, ts }]
  const asObj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  // В какой день отмечено место (номер дня по Москве) — для «Моего месяца». Отметки до этой версии — без дня
  let visitDays = asObj(readJson('visit_days', {}));
  // Оценка после посещения: 1 — понравилось, -1 — не моё. По ним подбор учится (см. tasteK)
  let rates = asObj(readJson('rates', {}));
  // Москва живёт по UTC+3 круглый год — день считаем без календарных библиотек
  const mskDay = (t) => Math.floor(((t === undefined ? Date.now() : t) + MSK_OFFSET) / 86400000);
  // Облако Telegram хранит до 4096 символов в ключе: берём последние записи, пока влезают
  const lastEntries = (obj, max) => Object.fromEntries(Object.entries(obj).slice(-max));
  function saveVisited() {
    const days = Object.fromEntries(Object.entries(visitDays).sort((a, b) => a[1] - b[1]).slice(-150));
    const data = { visited: [...visited].slice(-300), routes_done: routesDone.slice(-50), visit_days: days, rates: lastEntries(rates, 180) };
    for (const [k, val] of Object.entries(data)) {
      const s = JSON.stringify(val);
      try { localStorage.setItem(k, s); } catch (e) { /* хранилище недоступно */ }
      if (supports('6.9') && s.length < 4000) tg.CloudStorage.setItem(k, s);
    }
  }

  function setRate(id, v) {
    const was = rates[id];
    delete rates[id]; // новая оценка — в конец списка (при обрезке по размеру старые уйдут первыми)
    if (was !== v) rates[id] = v;
    tasteMap = null;
    saveVisited();
    haptic.impact(v === 1 ? 'medium' : 'light');
    if (was === v) toast('Оценка убрана');
    else if (v === 1) toast('Учту — похожие места будут выше в подборе', '👍');
    else toast('Понял — это место больше не предложу, похожие — ниже', '👎');
  }

  function toggleVisited(id) {
    const before = awardsGot(awardStats());
    if (visited.has(id)) { visited.delete(id); delete visitDays[id]; if (rates[id]) { delete rates[id]; tasteMap = null; } }
    else { visited.add(id); visitDays[id] = mskDay(); }
    haptic.tap();
    const r = activeRoute;
    let routeDone = false;
    if (r && r.ids.every((x) => visited.has(x)) && !routesDone.some((d) => d.id === r.id && Date.now() - d.ts < 12 * 3600000)) {
      routesDone.push({ id: r.id, title: r.title, ts: Date.now() });
      haptic.notify('success');
      const n = routesDone.length;
      toast(`Маршрут пройден! Это твой ${n}-й маршрут`, '🎉');
      routeDone = true;
    }
    saveVisited();
    checkNewAwards(before, routeDone ? 2600 : 0);
    return routeDone;
  }

  // Метро у старта и финиша маршрута
  function routeMetroHtml(ps) {
    const a = nearestMetro(ps[0]), b = nearestMetro(ps[ps.length - 1]);
    if (!a && !b) return '';
    if (a && b && a.name === b.name) return `<p class="route-metro">${metroHtml(a)} — у старта и финиша</p>`;
    return `<p class="route-metro">${a ? `Старт: ${metroHtml(a)}` : ''}${a && b ? '<br>' : ''}${b ? `Финиш: ${metroHtml(b)}` : ''}</p>`;
  }

  function drawRouteLine() {
    const r = activeRoute;
    const pts = routePlaces(r.ids).map((p) => [p.lat, p.lon]);
    if (r.fromMe) pts.unshift([r.fromMe.lat, r.fromMe.lon]);
    MapView.setLine(pts);
  }

  // Остановки с временем прихода — отдельно, чтобы ползунок «Выхожу через» обновлял только их
  function routeStopsHtml(r, ps) {
    const meStop = r.fromMe ? `<li class="route-stop route-stop--me"><span class="stop-num stop-num--me">${icon('locate')}</span>
        <span class="stop-name"><b>Ты здесь</b><small>начало маршрута</small></span></li>
        <li class="route-leg">${legMin(r.fromMe, ps[0])} мин пешком</li>` : '';
    const tl = routeTimeline(r, ps);
    return meStop + ps.map((p, i) => {
      const leg = i ? `<li class="route-leg">${legMin(ps[i - 1], p)} мин пешком</li>` : '';
      const been = visited.has(p.id);
      return `${leg}<li class="route-stop${been ? ' route-stop--done' : ''}" data-id="${esc(p.id)}">
        <span class="stop-num cat--${p.cat}">${i + 1}</span>
        <span class="stop-name"><b>${esc(p.name)}</b><small>в ${tl[i].arrive} · ~${stayText(stayFor(p, r))}${stopPrice(p)}</small>
          ${tl[i].warn ? `<small class="stop-closed">${tl[i].warn}</small>` : ''}</span>
        <button class="stop-check${been ? ' is-on' : ''}" type="button" data-visit="${esc(p.id)}" aria-pressed="${been}" aria-label="Был здесь">${icon('check')}</button>
      </li>`;
    }).join('');
  }

  function renderRouteSheet() {
    const r = activeRoute;
    const ps = routePlaces(r.ids);
    const st = routeStats(ps, r.fromMe, r);
    const liked = likedRoutes.has(r.id);
    const stops = routeStopsHtml(r, ps);
    const si = Math.max(0, START_STEPS.indexOf(r.startIn || 0));
    const doneCount = r.ids.filter((id) => visited.has(id)).length;
    $('#route-sheet').innerHTML = `
      <div class="sheet-handle"></div>
      <div class="place-head">
        <div class="place-title">
          <div class="place-cat">${icon('route')}Маршрут${r.adult ? AGE_BADGE : ''}</div>
          <h2>${r.emoji ? emo(r.emoji, 'emo-title') + ' ' : ''}${esc(r.title)}</h2>
          <div class="place-full">${durText(st.total)} · ${kmText(st.km)} пешком · ${placesWord(ps.length)}</div>
          <div class="route-price">${routePriceText(st)}</div>
        </div>
        <div class="head-actions">
          <button class="icon-btn" type="button" data-raction="share" aria-label="Поделиться маршрутом">${icon('share')}</button>
          ${r.draft || r.shared ? '' : `<button class="icon-btn${liked ? ' is-fav' : ''}" type="button" data-raction="like" aria-pressed="${liked}" aria-label="Нравится">${icon(liked ? 'heart-fill' : 'heart')}</button>`}
          <button class="icon-btn" type="button" data-raction="close" aria-label="Закрыть">${icon('close')}</button>
        </div>
      </div>
      ${r.desc ? `<p class="place-desc">${esc(r.desc)}</p>` : ''}
      ${routeMetroHtml(ps)}
      <div class="route-when">
        <div class="f-label budget-head">Выхожу <b id="start-value">${startLabel(r.startIn || 0)}</b></div>
        <input class="budget-range" type="range" min="0" max="${START_STEPS.length - 1}" step="1" value="${si}" data-rstart
          style="--fill:${(si / (START_STEPS.length - 1)) * 100}%" aria-label="Через сколько выходишь">
        <div class="budget-scale"><span>Сейчас</span><span>Через 1,5 суток</span></div>
      </div>
      <ol class="route-stops" id="route-stops">${stops}</ol>
      ${doneCount ? `<p class="route-progress">Отмечено ${doneCount} из ${r.ids.length}${doneCount === r.ids.length ? ' — маршрут пройден ' + emo('🎉') : ''}</p>` : ''}
      <div class="draft-links"><button type="button" data-raction="from-me">${r.fromMe ? 'Начать с первого места' : 'Начать отсюда'}</button></div>
      <p class="place-note">Время — примерное: дорога пешком и сколько обычно проводят в таком месте.</p>
      <div class="place-actions">
        <button class="btn btn-primary" type="button" data-raction="go">Идти — Яндекс Карты</button>
        ${r.shared || r.gen ? '<button class="btn btn-secondary" type="button" data-raction="keep">Сохранить</button>' : ''}
      </div>
      ${r.gen ? `<button class="btn btn-secondary btn-wide" type="button" data-raction="regen">${icon('dice')} Ещё вариант</button>` : ''}
      <div class="route-more">
        <button class="btn btn-surface" type="button" data-raction="cal">${emo('🗓')} В календарь</button>
        ${STORY_TG ? `<button class="btn btn-surface" type="button" data-raction="story">${emo('📸')} В историю</button>` : ''}
      </div>
      ${inTelegram ? '' : `<div class="cal-opts" hidden>
        <button type="button" data-raction="cal-google">Google Календарь</button>
        <button type="button" data-raction="cal-ics">Файл .ics — Apple, Яндекс, Outlook</button>
      </div>`}`;
  }

  // ---------- План в календарь ----------
  // Событие: начало — когда выходишь (ползунок «Выхожу»), конец — через всё время маршрута;
  // в описании — места со временем прихода и ссылка на маршрут в Яндекс Картах
  function calEvent(r) {
    const ps = routePlaces(r.ids);
    const st = routeStats(ps, r.fromMe, r), tl = routeTimeline(r, ps);
    const start = new Date(Math.round((Date.now() + (r.startIn || 0) * 60000) / 60000) * 60000);
    const end = new Date(start.getTime() + st.total * 60000);
    const at = (p) => p.name + (p.address ? ', ' + p.address : '');
    const ready = READY_ROUTES.some((x) => x.id === r.id);
    const details = ps.map((p, i) => `${tl[i].arrive} — ${at(p)}`)
      .concat(['', 'Маршрут в Яндекс Картах: ' + routeGoUrl(ps, r.fromMe), `${cfg.APP_NAME}: https://t.me/${cfg.BOT_USERNAME}`]).join('\n');
    return { title: `${cfg.APP_NAME}: ${ready ? r.title : ps.map((p) => p.name).join(' → ')}`, start, end, location: at(ps[0]), details };
  }
  const utcStamp = (d) => `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}00Z`;
  function googleCalUrl(ev) {
    const q = (s) => encodeURIComponent(s);
    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${q(ev.title)}&dates=${utcStamp(ev.start)}/${utcStamp(ev.end)}&details=${q(ev.details)}&location=${q(ev.location)}&ctz=Europe%2FMoscow`;
  }
  // Файл календаря по стандарту iCalendar (RFC 5545): строки длиннее 75 байт переносятся с пробелом в начале
  function icsText(ev) {
    const escI = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
    const enc = new TextEncoder();
    const fold = (line) => {
      let out = '', n = 0;
      for (const ch of line) {
        const b = enc.encode(ch).length;
        if (n + b > 74) { out += '\r\n '; n = 1; }
        out += ch; n += b;
      }
      return out;
    };
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Kuda poyti//RU', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
      `UID:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}@kuda-poyti`, `DTSTAMP:${utcStamp(new Date())}`,
      `DTSTART:${utcStamp(ev.start)}`, `DTEND:${utcStamp(ev.end)}`, `SUMMARY:${escI(ev.title)}`, `LOCATION:${escI(ev.location)}`,
      `DESCRIPTION:${escI(ev.details)}`, 'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escI(ev.title)}`, 'TRIGGER:-PT30M', 'END:VALARM',
      'END:VEVENT', 'END:VCALENDAR'].map(fold).join('\r\n') + '\r\n';
  }
  function downloadIcs(ev) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([icsText(ev)], { type: 'text/calendar;charset=utf-8' }));
    a.download = 'kuda-poyti.ics';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  // В Telegram файл скачать нельзя (только по https-ссылке) — сразу Google Календарь; в браузере — выбор
  function addToCalendar(r, how) {
    haptic.impact();
    const ev = calEvent(r);
    if (how === 'ics') { downloadIcs(ev); toast('Файл календаря скачан — открой его, и событие добавится', '🗓'); }
    else openLink(googleCalUrl(ev));
  }
  function routeStoryText(r) {
    const ps = routePlaces(r.ids);
    return `Мой маршрут по Москве: ${ps.map((p) => p.name).join(' → ')} (${durText(routeStats(ps, null, r).total).replace('~', '≈ ')})`;
  }

  function closeRoute() {
    activeRoute = null;
    state.route = null;
    MapView.setLine(null);
    render();
  }

  // Весь маршрут пешком в Яндекс Картах (Яндекс сам проложит путь по улицам)
  function routeGoUrl(ps, from) {
    return 'https://yandex.ru/maps/?rtext=' + (from ? [from].concat(ps) : ps).map((p) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`).join('~') + '&rtt=pd';
  }

  // Ссылка на маршрут: готовый — по названию (r-<id>), свой — по номерам мест в Яндексе (m-<коды>).
  // В ссылку Telegram влезает 64 символа, поэтому свой маршрут — до 6 мест (до сервера).
  function routeShareCode(r) {
    if (READY_ROUTES.some((x) => x.id === r.id)) return 'r-' + r.id;
    const parts = routePlaces(r.ids).map((p) => (p.ym ? Number(p.ym).toString(36) : null));
    if (parts.some((x) => !x)) return null;
    const code = 'm-' + parts.join('_');
    return code.length <= 64 ? code : null;
  }

  function shareRoute(r) {
    const code = routeShareCode(r);
    if (!code) { toast('Поделиться ссылкой можно маршрутом до 6 мест — для длинных скоро сделаем'); return; }
    const ps = routePlaces(r.ids);
    const link = `https://t.me/${cfg.BOT_USERNAME}?startapp=${code}`;
    const text = `Пойдём? Маршрут «${r.title}»: ${durText(routeStats(ps, null, r).total)}, ${placesWord(ps.length)} — ${ps.map((p) => p.name).join(' → ')}`;
    haptic.impact();
    if (inTelegram) tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`);
    else if (navigator.share) navigator.share({ title: r.title, text, url: link }).catch(() => {});
    else if (navigator.clipboard) navigator.clipboard.writeText(link).then(() => toast('Ссылка скопирована'), () => toast(link));
    else toast(link);
  }

  function toggleRouteLike(id) {
    const on = !likedRoutes.has(id);
    if (on) likedRoutes.add(id); else likedRoutes.delete(id);
    saveRoutesData('routes_liked');
    haptic.impact(on ? 'medium' : 'light');
    toast(on ? 'Маршрут понравился — он теперь сверху списка' : 'Лайк убран');
    return on;
  }

  // «+ В маршрут» в карточке места
  function toggleDraft(p) {
    const i = draft.indexOf(p.id);
    if (i >= 0) { draft.splice(i, 1); toast('Убрано из маршрута'); }
    else {
      if (draft.length >= ROUTE_MAX) { toast(`В маршруте может быть до ${ROUTE_MAX} мест`); return; }
      draft.push(p.id);
      const n = routePlaces(draft).length;
      toast(n === 1 ? 'Первое место в маршруте! Добавь ещё — кнопка «Маршруты» внизу' : `В маршруте ${placesWord(n)}`);
    }
    haptic.impact();
    saveRoutesData('route_draft');
    updateDraftBadge();
  }

  // Удобный порядок: от первой точки каждый раз идём к ближайшей из оставшихся
  function optimizeDraft() {
    const ps = routePlaces(draft);
    const out = [ps.shift()];
    while (ps.length) {
      const last = out[out.length - 1];
      let best = 0;
      ps.forEach((p, i) => { if (distance(last, p) < distance(last, ps[best])) best = i; });
      out.push(ps.splice(best, 1)[0]);
    }
    const before = routeStats(routePlaces(draft)).km;
    draft = out.map((p) => p.id);
    saveRoutesData('route_draft');
    const after = routeStats(out).km;
    toast(after < before - 0.05 ? `Путь стал короче на ${kmText(before - after)}` : 'Порядок уже удобный');
  }

  // ---------- Планировщик прогулки: общий для «Собери маршрут за меня» и «Куда сегодня?» ----------
  // Цепочка мест недалеко друг от друга. Каждое будет открыто, когда до него дойдёшь, и в нём успеешь
  // побыть; еда — к обеду или ужину, музеи — пораньше (закрываются раньше), бар — в конце; в непогоду
  // прогулки меняются на места под крышей. Всё — по данным Яндекс Карт (часы, цены, оценки, рубрики)
  const PLAN_DUR = [
    { v: 'short', label: '1–2 ч', max: 130, n: 2 },
    { v: 'mid', label: '2–3 ч', max: 200, n: 3 },
    { v: 'long', label: 'Полдня', max: 330, n: 4 },
    { v: 'day', label: 'Весь день', max: 540, n: 6 },
  ];
  const PLAN_WHEN = [
    { v: 'now', label: 'Сейчас' },
    { v: 'hour', label: 'Через час' },
    { v: 'evening', label: 'Вечером' },
    { v: 'tomorrow', label: 'Завтра днём' },
  ];
  const PLAN_NAMES = { coffee: 'кофе', photo: 'прогулка', food: 'еда', museum: 'музей', night: 'бар', mall: 'ТЦ' };

  // Через сколько минут выходим — ровно по шагам ползунка «Выхожу» в карточке маршрута
  function whenOffset(v) {
    const now = new Date();
    const cur = +mskParts(now).hour * 60 + now.getUTCMinutes(); // у Москвы сдвиг ровно в часах — минуты как в UTC
    let target = 0;
    if (v === 'hour') target = 60;
    else if (v === 'evening') target = Math.max(0, 19 * 60 - cur);   // к 19:00 (если уже вечер — сразу)
    else if (v === 'tomorrow') target = 1440 - cur + 12 * 60;         // завтра к полудню
    return START_STEPS.reduce((best, s) => (Math.abs(s - target) < Math.abs(best - target) ? s : best), 0);
  }

  const isIndoor = (p) => p.cat === 'museum' || p.cat === 'mall' || (p.cat === 'photo' && p.setting === 'indoor');
  // 'indoor' — любое место под крышей для прогулки в непогоду
  const slotMatch = (p, slot) => (slot === 'indoor' ? isIndoor(p) : p.cat === slot);
  // Если для шага ничего не нашлось — чем можно заменить
  const SLOT_ALT = { museum: ['photo', 'indoor'], photo: ['indoor'], indoor: ['museum', 'mall'], mall: ['indoor'], coffee: ['food'], food: ['coffee'], night: [] };
  // Сети («Кофемания», «Даблби»…) — не больше одной точки за прогулку
  const chainKeys = new Map();
  const chainKey = (p) => chainKeys.get(p.id) || chainKeys.set(p.id, norm(p.name).replace(/[^a-zа-я0-9]/g, '')).get(p.id);
  // Места по типу шага — раскладываем один раз (и заново, когда догрузились места по районам)
  let typeIndex = null, typeIndexFor = 0;
  function placesOfType(type) {
    if (typeIndexFor !== curated.length) {
      typeIndex = { indoor: [] };
      for (const p of curated) { (typeIndex[p.cat] = typeIndex[p.cat] || []).push(p); if (isIndoor(p)) typeIndex.indoor.push(p); }
      typeIndexFor = curated.length;
    }
    return typeIndex[type] || [];
  }

  // Оценка места: число и средняя оценка в Яндексе, профиль человека (интересы, кухни, что утомляет),
  // его оценки похожих мест; где уже был — ниже (если там понравилось — не так сильно).
  // prefer — поправки конкретного подбора (с кем, погода)
  function placeQuality(p, prefer) {
    let q = Math.sqrt(p.pop || 30) * (p.rating >= 4.8 ? 1.3 : p.rating >= 4.6 ? 1.1 : 1) * profileK(p) * tasteK(p);
    if (visited.has(p.id)) q *= rates[p.id] === 1 ? 0.8 : 0.5;
    return prefer ? q * prefer(p) : q;
  }

  // Из каких шагов состоит прогулка. want — что человек хочет: 'coffee', 'food', 'photo', 'museum', 'mall', 'night'
  function planSlots(want, n, startAt, bad) {
    const has = (t) => want.has(t);
    const acts = ['museum', 'mall', 'photo'].filter(has); // музеи — первыми: закрываются раньше
    const coffee = has('coffee') && +mskParts(startAt).hour < 20 ? 1 : 0;
    const meals = has('food') ? (n >= 6 ? 2 : 1) : 0;
    const bar = has('night') ? 1 : 0;
    const body = [];
    for (let i = 0; body.length < n - coffee - meals - bar; i++) {
      // прогулки можно повторять, остальное — по кругу из выбранного
      body.push(acts.length ? acts[i % acts.length] : 'photo');
    }
    const out = coffee ? ['coffee'] : [];
    if (meals === 2) { const k = Math.ceil(body.length / 2); out.push(...body.slice(0, k), 'food', ...body.slice(k), 'food'); }
    else if (meals && n >= 4) { const k = Math.ceil(body.length / 2); out.push(...body.slice(0, k), 'food', ...body.slice(k)); }
    else { out.push(...body); if (meals) out.push('food'); }
    if (bar) out.push('night');
    return bad ? out.map((t) => (t === 'photo' ? 'indoor' : t)) : out;
  }

  // Выбор места для шага: рядом с предыдущим (радиус растёт, если рядом пусто), открыто к приходу,
  // в бюджете; из лучших — случайное, но лучшие выпадают чаще — так «Ещё вариант» даёт новое
  // reserve — сколько денег оставить на еду дальше по маршруту (чтобы кофе и музеи не съели весь бюджет)
  function choosePlace(type, cur, t, walking, o, spent, reserve) {
    const near = [];
    for (const p of placesOfType(type)) {
      // сначала дешёвая проверка «не дальше ~3,3 км» по координатам — точное расстояние только для ближних
      if (Math.abs(p.lat - cur.lat) > 0.03 || Math.abs(p.lon - cur.lon) > 0.053) continue;
      if (o.exclude.has(p.id) || o.chains.has(chainKey(p)) || disliked(p)) continue;
      if (p.cat === 'night' && (!adultOk || o.noNight)) continue;
      if (p.rating && p.rating < 4.4) continue;
      if (o.newOnly && visited.has(p.id)) continue;
      if (o.budget !== null && o.budget !== undefined) {
        const r = priceRange(p); // бесплатное ничего не стоит — подходит при любом остатке бюджета
        if (!r || (r[1] > 0 && spent + (r[0] + r[1]) / 2 + (reserve || 0) > o.budget)) continue;
      }
      const d = distance(cur, p);
      if (d <= 3200) near.push({ p, d });
    }
    for (const radius of [800, 1400, 2200, 3200]) {
      const ok = near.filter(({ p, d }) => {
        if (d > radius) return false;
        const arrive = new Date(t + (walking ? Math.max(1, Math.round((d * 1.3) / WALK_M_PER_MIN)) : 0) * 60000);
        const left = Hours.minutesLeft(p.hours, arrive);
        return left === null ? p.cat === 'photo' : left >= stayFor(p) * 0.7; // успеть побыть хотя бы 70% времени
      });
      if (ok.length >= 3 || (ok.length && radius === 3200)) {
        // близость к предыдущему месту важнее, если человека утомляет долгая дорога
        const nearScale = prefersNear() ? 320 : 450;
        const top = ok.map((x) => ({ p: x.p, s: placeQuality(x.p, o.prefer) / (1 + x.d / nearScale) })).sort((a, b) => b.s - a.s).slice(0, 5);
        if (!o.random) return top[0].p; // по умолчанию — лучшее по сумме оценок, без случайностей
        let r = Math.random() * top.reduce((s, x) => s + x.s, 0);
        for (const x of top) { r -= x.s; if (r <= 0) return x.p; }
        return top[0].p;
      }
    }
    return null;
  }

  // o: { from, me, startAt, slots, max, budget, spent, prefer, exclude, chains, newOnly, noNight }
  function planRoute(o) {
    o = Object.assign({ exclude: new Set(), chains: new Set(), spent: 0 }, o);
    o.exclude = new Set(o.exclude); o.chains = new Set(o.chains);
    const ids = [], skipped = [];
    let subs = 0; // сколько шагов пришлось заменить (вместо еды — кофе и т. п.)
    let cur = o.from, t = o.startAt.getTime(), spent = o.spent, total = 0;
    for (let si = 0; si < o.slots.length; si++) {
      const slot = o.slots[si];
      const walking = ids.length > 0 || o.me;
      let pick = null;
      const reserve = o.budget ? o.slots.slice(si + 1).filter((s) => s === 'food').length * Math.min(800, o.budget * 0.45) : 0;
      for (const type of [slot].concat(SLOT_ALT[slot] || [])) { pick = choosePlace(type, cur, t, walking, o, spent, reserve); if (pick) { if (type !== slot) subs++; break; } }
      if (!pick) { skipped.push(slot); continue; }
      const leg = walking ? legMin(cur, pick) : 0, stay = stayFor(pick);
      if (total + leg + stay > o.max && ids.length >= 2) break;
      ids.push(pick.id); o.exclude.add(pick.id); o.chains.add(chainKey(pick));
      const r = priceRange(pick); if (r) spent += (r[0] + r[1]) / 2;
      total += leg + stay; t += (leg + stay) * 60000; cur = pick;
    }
    return { ids, skipped, subs };
  }
  // Из нескольких попыток лучше та, где больше мест, а при равенстве — меньше замен
  function betterPlan(a, b) {
    return a.ids.length !== b.ids.length ? a.ids.length > b.ids.length : a.subs < b.subs;
  }

  // ---------- «Собери маршрут за меня» ----------
  const GEN_WANT = [
    { v: 'coffee', e: '☕', label: 'Кофе' },
    { v: 'food', e: '🍽', label: 'Еда' },
    { v: 'photo', e: '🌳', label: 'Прогулки' },
    { v: 'museum', e: '🏛', label: 'Музеи' },
    { v: 'mall', e: '🛍', label: 'ТЦ' },
    { v: 'night', e: '🍸', label: 'Бар 18+' },
  ];
  const GEN_BUDGET = [
    { v: 0, label: 'Бесплатно' },
    { v: 1000, label: 'до 1 000 ₽' },
    { v: 2500, label: 'до 2 500 ₽' },
    { v: 5000, label: 'до 5 000 ₽' },
    { v: 10000, label: 'до 10 000 ₽' },
    { v: null, label: 'Любой' },
  ];
  const gen = { dur: 'mid', when: 'now', budget: 2500, want: new Set(['coffee', 'photo', 'food']), indoor: false, newOnly: false, open: false };
  // Выбор запоминаем: в следующий раз форма уже настроена
  (() => {
    const s = readJson('gen', null);
    if (!s) return;
    if (PLAN_DUR.some((d) => d.v === s.dur)) gen.dur = s.dur;
    if (GEN_BUDGET.some((b) => b.v === s.budget)) gen.budget = s.budget;
    if (Array.isArray(s.want) && s.want.length) gen.want = new Set(s.want.filter((w) => GEN_WANT.some((x) => x.v === w)));
    gen.indoor = !!s.indoor; gen.newOnly = !!s.newOnly;
  })();
  function saveGen() {
    try { localStorage.setItem('gen', JSON.stringify({ dur: gen.dur, budget: gen.budget, want: [...gen.want], indoor: gen.indoor, newOnly: gen.newOnly })); } catch (e) { /* хранилище недоступно */ }
  }

  // random — «Ещё вариант»: из лучших мест, но не обязательно самых лучших; иначе — лучшее по сумме оценок
  async function generateRoute(random) {
    haptic.impact();
    const { from, me, outside } = await startPoint();
    const startIn = whenOffset(gen.when);
    const startAt = new Date(Date.now() + startIn * 60000);
    const wx = weatherAt(startAt);
    const bad = gen.indoor || !!(wx && wx.bad);
    const dur = PLAN_DUR.find((d) => d.v === gen.dur);
    const want = new Set([...gen.want].filter((w) => w !== 'night' || adultOk));
    // бесплатно — только прогулки и бесплатные музеи
    if (gen.budget === 0) { want.delete('coffee'); want.delete('food'); want.delete('night'); want.add('photo'); }
    const slots = planSlots(want, dur.n, startAt, bad);
    // первая попытка — лучшее по оценкам; если в ней пришлось что-то заменить, пробуем ещё и берём ту, где больше мест и меньше замен
    let best = null;
    for (let i = 0; i < 6; i++) {
      const pl = planRoute({ from, me, startAt, slots, max: dur.max + (want.has('night') ? 60 : 0), budget: gen.budget, newOnly: gen.newOnly, random: random || i > 0,
        prefer: bad ? (p) => (isIndoor(p) || p.setting === 'indoor' ? 1.3 : 1) : null });
      if (!best || betterPlan(pl, best)) best = pl;
      if (pl.ids.length === slots.length && !pl.subs) break;
    }
    if (best.ids.length < 2) { toast('Рядом не нашлось подходящих мест — сдвинь карту, выбери другое время или смягчи условия'); return; }
    const title = best.ids.map((id) => PLAN_NAMES[byId.get(id).cat]).join(' → ');
    showRoute({ id: 'gen', title: title[0].toUpperCase() + title.slice(1), emoji: '✨', ids: best.ids, gen: true, fromMe: me ? from : null, startIn });
    const why = { museum: 'Музеи', coffee: 'Кофейни', food: 'Места с едой', night: 'Бары', photo: 'Парки и красивые места', mall: 'ТЦ', indoor: 'Места под крышей' };
    const got = new Set(best.ids.map((id) => byId.get(id).cat));
    const miss = [...new Set(best.skipped)].filter((c) => !got.has(c) && why[c]);
    if (miss.length) toast(`${miss.map((c) => why[c]).join(' и ')} рядом в это время закрыты или не по бюджету — собрал без них`);
    else if (bad && !gen.indoor && gen.want.has('photo')) toast(`${wx.tip.split(' — ')[0]} — вместо прогулок места под крышей`, wx.e);
    else if (outside) toast('Похоже, ты за МКАД — маршрут собран от центра карты');
  }

  // Перерисовать только форму, а не весь список маршрутов (там два десятка карточек с фото)
  function renderGen() {
    const g = $('#routes-body .gen');
    if (g) g.outerHTML = genFormHtml(); else renderRoutes();
  }

  function genFormHtml() {
    const seg = (list, key) => list.map((o) => `<button type="button" class="seg-btn${gen[key] === o.v ? ' active' : ''}" data-gen="${key}" data-val="${o.v}">${o.label}</button>`).join('');
    const tog = (key, label, e) => `<button type="button" class="seg-btn${gen[key] ? ' active' : ''}" data-gen-toggle="${key}">${emo(e)} ${label}</button>`;
    const wants = GEN_WANT.map((o) => `<button type="button" class="seg-btn${gen.want.has(o.v) ? ' active' : ''}" data-gen-want="${o.v}">${emo(o.e)} ${o.label}</button>`).join('');
    const wx = gen.open ? weatherAt(new Date(Date.now() + whenOffset(gen.when) * 60000)) : null;
    const wxNote = wx ? `<p class="gen-wx">${emo(wx.e)} ${wx.label} ${wx.temp}${wx.t ? ', ' + wx.t : ''}${wx.bad && gen.want.has('photo') && !gen.indoor ? ' — прогулки заменю на места под крышей' : ''}</p>` : '';
    return `<div class="gen${gen.open ? ' gen--open' : ''}">
      <button type="button" class="gen-head" data-gen-open>
        ${emo('✨', 'route-emoji')}
        <span class="route-title"><b>Собери маршрут за меня</b><small>Выбери, что хочется, — соберу цепочку мест рядом под время, погоду и бюджет</small></span>
        <span class="ya-arrow">${gen.open ? '−' : '+'}</span>
      </button>
      ${gen.open ? `<div class="gen-body">
        <div class="f-label">Что включить</div><div class="seg">${wants}</div>
        <div class="f-label">Сколько времени</div><div class="seg">${seg(PLAN_DUR, 'dur')}</div>
        <div class="f-label">Когда</div><div class="seg">${seg(PLAN_WHEN, 'when')}</div>
        <div class="f-label">Бюджет на человека</div><div class="seg">${seg(GEN_BUDGET, 'budget')}</div>
        <div class="f-label">Ещё</div><div class="seg">${tog('indoor', 'Только под крышей', '☔')}${tog('newOnly', 'Только новые места', '✨')}</div>
        ${wxNote}
        <button type="button" class="btn btn-primary btn-wide" data-gen-go>Собрать маршрут</button>
        <p class="f-note">Еда — к обеду или ужину, музеи — пока открыты, бар — в конце. Начну от тебя (если разрешишь геолокацию) или от центра карты.</p>
      </div>` : ''}
    </div>`;
  }

  // ---------- Фильтры маршрутов (шторка как у карты) ----------
  const RF_BUDGET = [0, 500, 1000, 1500, 2000, 3000, 5000, 7000, 10000, null];
  const RF_TIME = [120, 180, 240, 300, null]; // минут
  const RF_SETTING = [
    { v: 'any', label: 'Неважно' },
    { v: 'outdoor', label: 'Больше на улице' },
    { v: 'indoor', label: 'В помещении' },
  ];
  const rf = { budget: null, time: null, setting: 'any', openNow: false };
  const rfBudgetLabel = (v) => (v === null ? 'Любой' : v === 0 ? 'Бесплатно' : `до ${v.toLocaleString('ru-RU')} ₽`);
  const rfTimeLabel = (v) => (v === null ? 'Любое' : `до ${v / 60} ч`);
  const isOutdoor = (p) => p.setting === 'outdoor' || (p.cat === 'photo' && p.setting !== 'indoor');
  const rfActive = () => (rf.budget !== null) + (rf.time !== null) + (rf.setting !== 'any') + rf.openNow;

  function routeMatches(r) {
    const ps = routePlaces(r.ids);
    if (ps.length < 2) return false;
    const st = routeStats(ps, null, r);
    if (rf.budget !== null) {
      if (rf.budget === 0 ? st.hi > 0 || st.unknown > 0 : (st.lo + st.hi) / 2 > rf.budget) return false;
    }
    if (rf.time !== null && st.total > rf.time) return false;
    const outdoor = ps.filter(isOutdoor).length;
    if (rf.setting === 'indoor' && outdoor > 0) return false;
    if (rf.setting === 'outdoor' && outdoor < ps.length / 2) return false;
    if (rf.openNow && ps.some((p) => Hours.minutesLeft(p.hours, new Date()) === 0)) return false;
    return true;
  }
  const rfCount = () => READY_ROUTES.filter((r) => inSeason(r) && routeMatches(r)).length;

  function syncRouteFilters() {
    const set = (id, stops, value, label) => {
      const r = $(id), i = Math.max(0, stops.indexOf(value));
      r.max = stops.length - 1; r.value = i;
      r.style.setProperty('--fill', (i / (stops.length - 1)) * 100 + '%');
      r.setAttribute('aria-valuetext', label(value));
      $(id + '-value').textContent = label(value);
    };
    set('#rf-budget', RF_BUDGET, rf.budget, rfBudgetLabel);
    set('#rf-time', RF_TIME, rf.time, rfTimeLabel);
    document.querySelectorAll('#rf-setting .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.v === rf.setting));
    $('#rf-open').checked = rf.openNow;
    const n = rfCount();
    $('#rf-apply').textContent = n ? `Показать ${n} ${plural(n, 'маршрут', 'маршрута', 'маршрутов')}` : 'Ничего не нашлось';
  }

  function buildRouteFilters() {
    $('#rf-setting').innerHTML = RF_SETTING.map((o) => `<button type="button" class="seg-btn" data-v="${o.v}">${o.label}</button>`).join('');
    const slider = (id, stops, key) => $(id).addEventListener('input', (e) => {
      const v = stops[+e.target.value];
      if (v === rf[key]) return;
      rf[key] = v; haptic.tap(); syncRouteFilters();
    });
    slider('#rf-budget', RF_BUDGET, 'budget');
    slider('#rf-time', RF_TIME, 'time');
    $('#rf-setting').addEventListener('click', (e) => {
      const b = e.target.closest('.seg-btn');
      if (!b) return;
      rf.setting = b.dataset.v; haptic.tap(); syncRouteFilters();
    });
    $('#rf-open').addEventListener('change', (e) => { rf.openNow = e.target.checked; haptic.tap(); syncRouteFilters(); });
    $('#rf-reset').addEventListener('click', () => { Object.assign(rf, { budget: null, time: null, setting: 'any', openNow: false }); haptic.tap(); syncRouteFilters(); });
    $('#rf-apply').addEventListener('click', () => closeSheets()); // закрытие вернёт к списку маршрутов
  }

  function routeFromCode(code) {
    if (code.startsWith('r-')) return READY_ROUTES.find((r) => r.id === code.slice(2)) || null;
    if (!code.startsWith('m-')) return null;
    const byYm = new Map(curated.filter((p) => p.ym).map((p) => [String(p.ym), p]));
    const ids = code.slice(2).split('_').map((c) => byYm.get(String(parseInt(c, 36)))).filter(Boolean).map((p) => p.id);
    return ids.length > 1 ? { id: 'shared', title: 'Маршрут от друга', emoji: '🤝', ids, shared: true } : null;
  }

  // ---------- Подборки ----------
  function openCollection(id) {
    const c = COLLECTIONS.find((x) => x.id === id);
    if (!c) return;
    haptic.tap();
    state.collection = c;
    state.cats.clear();
    syncChips();
    closeSheets();
    $('#chips').hidden = true;
    $('#coll-bar').hidden = false;
    $('#coll-title').innerHTML = `${emo(c.emoji)} ${esc(c.title)} · ${c.set.size} ${plural(c.set.size, 'место', 'места', 'мест')}`;
    render();
    syncFilters();
    fitPlaces([...c.set].map((pid) => byId.get(pid)));
  }

  function closeCollection() {
    haptic.tap();
    state.collection = null;
    $('#chips').hidden = false;
    $('#coll-bar').hidden = true;
    render();
    syncFilters();
  }

  // Показать все места на экране целиком (с полями под верхнюю панель; bottom — сколько px снизу закрыто шторкой)
  function fitPlaces(list, bottom) {
    bottom = bottom || 0;
    if (!list.length) return;
    let s = 90, n = -90, w = 180, e = -180;
    for (const p of list) {
      s = Math.min(s, p.lat); n = Math.max(n, p.lat);
      w = Math.min(w, p.lon); e = Math.max(e, p.lon);
    }
    const size = getMapSize(); // из кэша: чтение размеров сразу после правок DOM заставило бы браузер пересчитать вёрстку
    const top = 150; // поиск и чипсы
    const W = size.w - 60, H = Math.max(120, size.h - top - bottom - 40);
    const zx = Math.log2((W * 360) / (256 * Math.max(e - w, 0.002)));
    const zy = Math.log2((H * 2 * Math.PI) / (256 * Math.max(merc(n) - merc(s), 0.00005)));
    const zoom = Math.max(maxViewZoom(), Math.min(16, zx, zy));
    // Сдвигаем центр так, чтобы места оказались посередине видимой части (между верхней панелью и шторкой)
    const shiftPx = (bottom - top) / 2 + 20;
    const cy = (merc(n) + merc(s)) / 2 - (shiftPx * 2 * Math.PI) / (256 * Math.pow(2, zoom));
    MapView.flyTo((Math.atan(Math.exp(cy)) * 360) / Math.PI - 90, (w + e) / 2, zoom);
  }

  // Наименьший масштаб (самое сильное отдаление): Москва в МКАД целиком помещается на экран — дальше не отдаляем
  function maxViewZoom() {
    const v = cfg.MAX_VIEW;
    if (!v) return cfg.MIN_ZOOM || 9;
    const { w: W, h: H } = getMapSize(); // размер из кэша: вызывается при каждом движении карты
    const zx = Math.log2((W * 360) / (256 * (v.east - v.west)));
    const zy = Math.log2((H * 2 * Math.PI) / (256 * (merc(v.north) - merc(v.south))));
    return Math.max(cfg.MIN_ZOOM || 9, Math.round(Math.min(zx, zy) * 100) / 100);
  }

  // Рамка, за которую нельзя увести карту: МКАД с небольшим запасом. При самом сильном отдалении
  // вытянутый экран телефона видит больше, чем МКАД по высоте, — тогда рамку расширяем ровно
  // настолько, чтобы Москва стояла по центру, а не прижималась к краю
  // zoom — для какого масштаба: в приближении рамка ровно по МКАД, запас — только у самого отдаления
  function viewBounds(zoom) {
    const b = cfg.MAP_BOUNDS;
    const { w, h } = getMapSize();
    const scale = 256 * Math.pow(2, Math.max(zoom || 0, maxViewZoom()));
    const out = { ...b };
    const lonSpan = (w * 360) / scale;
    if (lonSpan > b.east - b.west) {
      const c = (b.east + b.west) / 2;
      out.west = c - lonSpan / 2 - 0.001; out.east = c + lonSpan / 2 + 0.001;
    }
    const mSpan = (h * 2 * Math.PI) / scale, mN = merc(b.north), mS = merc(b.south);
    if (mSpan > mN - mS) {
      const c = (mN + mS) / 2, lat = (m) => (Math.atan(Math.exp(m)) * 360) / Math.PI - 90;
      out.south = lat(c - mSpan / 2) - 0.001; out.north = lat(c + mSpan / 2) + 0.001;
    }
    return out;
  }

  // ---------- Позвать друга ----------
  // Ссылка открывает мини-апп сразу на этом месте (нужно «Main Mini App» в @BotFather)
  function sharePlace(p) {
    const link = `https://t.me/${cfg.BOT_USERNAME}?startapp=p-${p.id}`;
    const text = `Пойдём сюда? ${p.name}${p.address ? ', ' + p.address : ''}`;
    haptic.impact();
    if (inTelegram) {
      tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`);
    } else if (navigator.share) {
      navigator.share({ title: p.name, text, url: link }).catch(() => {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(link).then(() => toast('Ссылка скопирована'), () => toast(link));
    } else {
      toast(link);
    }
  }

  // Параметр из ссылки t.me/<бот>?startapp=… : «p-<id>» — открыть место, «lucky» — «Мне повезёт»
  function startParam() {
    const qs = new URLSearchParams(location.search);
    return (inTelegram && tg.initDataUnsafe && tg.initDataUnsafe.start_param) || qs.get('tgWebAppStartParam') || qs.get('startapp') || '';
  }

  // ---------- Геолокация ----------
  function browserPosition() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error('Геолокация недоступна'));
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
        reject,
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
      );
    });
  }

  function getPosition() {
    const lm = supports('8.0') ? tg.LocationManager : null;
    if (!lm) return browserPosition();
    return new Promise((resolve, reject) => {
      const go = () => {
        if (!lm.isLocationAvailable) return browserPosition().then(resolve, reject);
        lm.getLocation((d) => (d ? resolve({ lat: d.latitude, lon: d.longitude }) : reject(new Error('Нет доступа'))));
      };
      if (lm.isInited) go();
      else lm.init(go);
    });
  }

  async function locate() {
    const btn = $('#locate');
    btn.classList.add('loading');
    haptic.tap();
    try {
      const pos = await getPosition();
      state.user = pos;
      MapView.setUser(pos.lat, pos.lon, userEl());
      const b = cfg.MAP_BOUNDS;
      if (pos.lat < b.south || pos.lat > b.north || pos.lon < b.west || pos.lon > b.east) {
        toast('Похоже, ты за МКАД — на карте только места внутри МКАД');
      } else {
        MapView.flyTo(pos.lat, pos.lon, 15);
      }
      if (state.selected) $('#place-sheet').innerHTML = placeHtml(state.selected);
    } catch (e) {
      toast('Не получилось определить, где ты. Разреши доступ к геолокации');
    } finally {
      btn.classList.remove('loading');
    }
  }

  // ---------- Чипсы категорий и фильтры ----------
  function buildChips() {
    const list = [{ id: 'all', label: 'Все' }].concat(Object.keys(CATS).map((id) => ({ id, label: CATS[id].short || CATS[id].label, adult: CATS[id].adult })));
    const box = $('#chips');
    // первой — «Куда сегодня?» с погодой: это не категория, а подбор мест
    box.innerHTML = '<button type="button" class="chip chip--today" data-today></button>' + list.map((c) =>
      `<button type="button" class="chip cat--${c.id}" data-cat="${c.id}">${icon(c.id)}${c.label}${c.adult ? AGE_BADGE : ''}</button>`
    ).join('');
    updateTodayChip();
    box.addEventListener('click', (e) => {
      if (e.target.closest('[data-today]')) { openToday(); return; }
      const b = e.target.closest('.chip');
      if (!b) return;
      const cat = b.dataset.cat;
      // Можно выбрать несколько категорий сразу; «Все» сбрасывает выбор
      const apply = () => {
        if (cat === 'all') state.cats.clear();
        else if (state.cats.has(cat)) state.cats.delete(cat);
        else state.cats.add(cat);
        // выбраны все категории — это то же самое, что «Все»
        if (state.cats.size === Object.keys(CATS).length) state.cats.clear();
        haptic.tap();
        syncChips();
        render();
        syncFilters();
      };
      const adding = cat !== 'all' && !state.cats.has(cat);
      if (adding && CATS[cat].adult) askAdult().then((ok) => ok && apply());
      else apply();
    });
    syncChips();
  }

  function syncChips() {
    document.querySelectorAll('.chip[data-cat]').forEach((b) => {
      const on = b.dataset.cat === 'all' ? !state.cats.size : state.cats.has(b.dataset.cat);
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on);
    });
  }

  function segment(sel, options, key) {
    const box = $(sel);
    box.innerHTML = options.map((o, i) => `<button type="button" class="seg-btn" data-i="${i}">${o.label}</button>`).join('');
    box.addEventListener('click', (e) => {
      const b = e.target.closest('.seg-btn');
      if (!b) return;
      state[key] = options[+b.dataset.i].v;
      haptic.tap();
      onFiltersChanged();
    });
  }

  function syncFilters() {
    const mark = (sel, options, value) => {
      document.querySelectorAll(`${sel} .seg-btn`).forEach((b) =>
        b.classList.toggle('active', options[+b.dataset.i].v === value)
      );
    };
    syncBudget();
    mark('#f-setting', SETTINGS, state.setting);
    $('#f-open').checked = state.openNow;

    const active = (state.budget !== null) + (state.setting !== 'any') + state.openNow;
    const badge = $('#filter-badge');
    badge.textContent = active;
    badge.hidden = !active;

    const n = allMatches().length;
    $('#f-apply').textContent = n ? `Показать ${n} ${plural(n, 'место', 'места', 'мест')}` : 'Ничего не нашлось';
  }

  function onFiltersChanged() {
    syncFilters();
    render();
  }

  // Ползунок и подпись бюджета; заливка дорожки до ползунка — через переменную --fill
  function syncBudget() {
    const r = $('#f-budget');
    const i = Math.max(0, BUDGET_STOPS.indexOf(state.budget));
    r.value = i;
    r.style.setProperty('--fill', (i / (BUDGET_STOPS.length - 1)) * 100 + '%');
    r.setAttribute('aria-valuetext', budgetLabel(state.budget));
    $('#budget-value').textContent = budgetLabel(state.budget);
  }

  function buildFilters() {
    const range = $('#f-budget');
    range.max = BUDGET_STOPS.length - 1;
    let frame = 0;
    range.addEventListener('input', () => {
      const v = BUDGET_STOPS[+range.value];
      if (v === state.budget) return;
      state.budget = v;
      haptic.tap(); // лёгкий щелчок на каждом шаге
      syncFilters(); // подпись и «Показать N мест» — сразу
      // карту перерисовываем не чаще раза за кадр, пока тянут ползунок
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(render);
    });
    segment('#f-setting', SETTINGS, 'setting');
    $('#f-open').addEventListener('change', (e) => {
      state.openNow = e.target.checked;
      haptic.tap();
      onFiltersChanged();
    });
    $('#f-reset').addEventListener('click', () => {
      state.budget = null;
      state.setting = 'any';
      state.openNow = false;
      haptic.tap();
      onFiltersChanged();
    });
    $('#f-apply').addEventListener('click', () => closeSheets());
    syncFilters();
  }

  // ---------- Погода (Open-Meteo: бесплатно, без ключа и регистрации) ----------
  // Погоду берём для центра Москвы — где ты, никуда не отправляется. Прогноз по часам — на полтора дня
  // вперёд: подбор «на вечер» или «завтра днём» смотрит погоду на то время
  const WEATHER_URL = 'https://api.open-meteo.com/v1/forecast?latitude=55.75&longitude=37.62'
    + '&current=temperature_2m,weather_code,is_day&hourly=temperature_2m,precipitation_probability,weather_code&forecast_hours=40&timezone=Europe%2FMoscow';
  // Код погоды (WMO) → значок и слова; wet — осадки
  function weatherKind(code, day) {
    if (code === 0) return { e: day ? '☀️' : '🌙', t: 'ясно' };
    if (code === 1) return { e: day ? '🌤' : '🌙', t: 'почти ясно' };
    if (code === 2) return { e: '⛅', t: 'переменная облачность' };
    if (code === 3) return { e: '☁️', t: 'пасмурно' };
    if (code === 45 || code === 48) return { e: '🌫', t: 'туман' };
    if (code >= 51 && code <= 57) return { e: '🌦', t: 'морось', wet: true };
    if (code >= 61 && code <= 67) return { e: '🌧', t: code === 65 ? 'сильный дождь' : 'дождь', wet: true };
    if (code >= 71 && code <= 77) return { e: '🌨', t: 'снег', wet: true };
    if (code >= 80 && code <= 82) return { e: '🌧', t: 'ливень', wet: true };
    if (code === 85 || code === 86) return { e: '🌨', t: 'снегопад', wet: true };
    if (code >= 95) return { e: '⛈', t: 'гроза', wet: true };
    return { e: '🌡', t: '' };
  }
  const tempText = (t) => (t > 0 ? '+' : t < 0 ? '−' : '') + Math.abs(t) + '°';

  // weather: { temp, e, t, bad, tip, hours: Map('2026-10-19T19' → { code, prob, temp }) }; bad — непогода
  let weather = null;
  function parseWeather(d) {
    const c = d.current, k = weatherKind(c.weather_code, c.is_day);
    const temp = Math.round(c.temperature_2m);
    const h = d.hourly || {}, nowH = c.time.slice(0, 13);
    const hours = new Map();
    let soon = null, ahead = 0;
    for (let i = 0; i < (h.time || []).length; i++) {
      hours.set(h.time[i].slice(0, 13), { code: h.weather_code[i], prob: h.precipitation_probability[i] || 0, temp: Math.round(h.temperature_2m[i]) });
      // осадки в ближайшие 6 часов
      if (soon || h.time[i].slice(0, 13) <= nowH || ++ahead > 6) continue;
      if (weatherKind(h.weather_code[i]).wet || (h.precipitation_probability[i] || 0) >= 60) soon = { at: h.time[i].slice(11, 16), ahead };
    }
    let tip, bad = false;
    if (k.wet) { tip = `Сейчас ${k.t} — лучше места под крышей`; bad = true; }
    else if (temp <= -10) { tip = 'Морозно — грейся в кафе и музеях'; bad = true; }
    else if (soon) { tip = `Около ${soon.at} обещают осадки — возьми зонт или выбирай места под крышей`; bad = soon.ahead <= 3; }
    else if (temp >= 28) tip = 'Жарко — ищи тень в парках или прохладу в музеях';
    else tip = c.is_day ? 'Без осадков — хорошо для прогулки' : 'Без осадков — можно погулять по вечернему городу';
    return { temp: tempText(temp), e: k.e, t: k.t, bad, tip, hours };
  }

  // Погода на время выхода: { label, e, t, bad, tip } или null, если прогноза нет
  function weatherAt(date) {
    if (!weather) return null;
    if (date.getTime() - Date.now() < 45 * 60000) return Object.assign({ label: 'Сейчас в Москве' }, weather);
    const p = mskParts(date);
    const h = weather.hours.get(`${p.year}-${p.month}-${p.day}T${p.hour}`);
    if (!h) return null;
    const hour = +p.hour, k = weatherKind(h.code, hour >= 7 && hour < 19);
    const wet = k.wet || h.prob >= 60;
    const bad = wet || h.temp <= -10;
    const tip = wet ? `Обещают ${k.wet ? k.t : 'осадки'} — лучше места под крышей`
      : h.temp <= -10 ? 'Будет морозно — лучше кафе и музеи'
      : h.temp >= 28 ? 'Будет жарко — ищи тень и прохладу' : 'Без осадков — хорошо для прогулки';
    const sameDay = p.day === mskParts(new Date()).day;
    return { label: `${sameDay ? 'Сегодня' : 'Завтра'} в ${clock(date)} в Москве`, e: k.e, temp: tempText(h.temp), t: k.t, bad, tip };
  }

  // Прогноз храним 20 минут, чтобы не спрашивать при каждом открытии; старше — обновляем
  // (приложение может быть открыто часами — «Сейчас в Москве» не должно показывать утреннюю погоду)
  const WEATHER_TTL = 20 * 60000;
  let weatherTs = 0, weatherBusy = false;
  const weatherStale = () => !weather || Date.now() - weatherTs > WEATHER_TTL;
  function loadWeather() {
    const cached = readJson('weather', null);
    if (cached && cached.d && Date.now() - cached.ts < WEATHER_TTL) {
      try { weather = parseWeather(cached.d); weatherTs = cached.ts; updateTodayChip(); return; } catch (e) { /* старый или испорченный кэш — спросим заново */ }
    }
    if (!window.fetch || weatherBusy) return;
    weatherBusy = true;
    const ctl = window.AbortController ? new AbortController() : null;
    const timer = setTimeout(() => ctl && ctl.abort(), 8000);
    fetch(WEATHER_URL, ctl ? { signal: ctl.signal } : {})
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
      .then((d) => {
        weather = parseWeather(d);
        weatherTs = Date.now();
        try { localStorage.setItem('weather', JSON.stringify({ ts: weatherTs, d })); } catch (e) { /* хранилище недоступно */ }
        updateTodayChip();
        if (openSheetName === 'today') renderToday();
        else if (openSheetName === 'routes' && gen.open) renderGen();
      })
      .catch(() => { /* без погоды всё работает, просто без подсказки */ })
      .finally(() => { clearTimeout(timer); weatherBusy = false; });
  }

  function updateTodayChip() {
    const b = $('#chips [data-today]');
    if (b) b.innerHTML = `<span class="chip-wx">${weather ? `${emo(weather.e)} ${weather.temp}` : emo('✨')}</span>Куда сегодня?`;
  }

  function wxHtml(w) {
    return w ? `<div class="wx${w.bad ? ' wx--bad' : ''}">${emo(w.e, 'wx-e')}
      <span class="wx-text"><b>${w.label} ${w.temp}${w.t ? ', ' + w.t : ''}</b><small>${esc(w.tip)}</small></span></div>` : '';
  }

  const inMkad = (pos) => { const b = cfg.MAP_BOUNDS; return pos.lat > b.south && pos.lat < b.north && pos.lon > b.west && pos.lon < b.east; };
  const mapCenter = () => { const v = state.view.bounds; return { lat: (v.north + v.south) / 2, lon: (v.east + v.west) / 2 }; };

  // Откуда начинаем: от тебя (если разрешишь геолокацию и ты внутри МКАД) или от центра карты
  async function startPoint() {
    try {
      const pos = state.user || (await Promise.race([getPosition(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 6000))]));
      if (inMkad(pos)) { state.user = pos; MapView.setUser(pos.lat, pos.lon, userEl()); return { from: pos, me: true }; }
      return { from: mapCenter(), me: false, outside: true }; // ты за МКАД — места только внутри, считаем от центра карты
    } catch (e) { /* без геолокации — от центра карты */ }
    return { from: mapCenter(), me: false };
  }

  // ---------- «Куда сегодня?»: несколько быстрых вопросов → лучшие места и готовый план ----------
  // Всё подбирается только по данным Яндекс Карт: категория и рубрики, кухни, оценка, часы, цены,
  // «на улице / в помещении», плюс погода на время выхода и наши подборки («На свидание», «Лучшие виды»)
  // Текст места для правил (название, рубрики, описание) — считаем один раз на место
  const placeTexts = new Map();
  const placeTextRaw = (p) => norm([p.name, p.note, p.desc, p.fullName].filter(Boolean).join(' '));
  const placeText = (p) => (p.id ? placeTexts.get(p.id) || placeTexts.set(p.id, placeTextRaw(p)).get(p.id) : placeTextRaw(p));
  const cuisineText = (p) => norm((p.cuisine || []).join(' '));
  const collSet = (id) => (COLLECTIONS.find((c) => c.id === id) || { set: new Set() }).set;
  const KIDS_RE = /детск|зоопарк|планетари|океанариум|аквариум|аттракцион|экспериментариум|экспериментаниум|дарвин|космонавт|макет|игров|кукол/;
  const FAST_RE = /быстрое питание|столов|шаурм|бургер|пекарн|фудкорт|раздач/;
  const kidsPlace = (p) => KIDS_RE.test(placeText(p)) || (p.fun || []).some((f) => KIDS_RE.test(norm(f.join(' '))));

  const Q_MOOD = { key: 'mood', title: 'Чего хочется?', opts: [
    { v: 'coffee', e: '☕', label: 'Кофе и поболтать', cats: ['coffee'], want: ['coffee', 'photo'] },
    { v: 'food', e: '🍽', label: 'Вкусно поесть', cats: ['food'], want: ['food', 'photo'] },
    { v: 'walk', e: '🌳', label: 'Погулять', cats: ['photo'], want: ['photo', 'coffee', 'food'] },
    { v: 'culture', e: '🏛', label: 'Что-то культурное', cats: ['museum'], want: ['museum', 'coffee', 'photo'] },
    { v: 'shop', e: '🛍', label: 'Шопинг', cats: ['mall'], want: ['mall', 'coffee', 'food'] },
    { v: 'bar', e: '🍸', label: 'Бар или кальян', cats: ['night'], want: ['night', 'food', 'photo'], adult: true },
    { v: 'any', e: '🎲', label: 'Удиви меня', cats: ['coffee', 'food', 'photo', 'museum', 'mall'], want: ['coffee', 'photo', 'museum', 'food'] },
  ] };
  // Уточнение — только там, где у Яндекса есть данные: кухни, рубрики кофеен и мест для прогулок
  const Q_DETAIL = {
    food: { key: 'detail', title: 'Какую кухню?', opts: [
      { v: 'georgian', e: '🥟', label: 'Грузинская', chip: 'Грузинская кухня', test: (p) => /грузин|кавказ/.test(cuisineText(p)) },
      { v: 'italian', e: '🍝', label: 'Итальянская', chip: 'Итальянская кухня', test: (p) => /итальян|пицц/.test(cuisineText(p) + ' ' + placeText(p)) },
      { v: 'asian', e: '🍣', label: 'Японская и азиатская', chip: 'Азиатская кухня', test: (p) => /япон|паназиат|китай|корей|вьетнам|тай|азиат/.test(cuisineText(p)) },
      { v: 'russian', e: '🥞', label: 'Русская', chip: 'Русская кухня', test: (p) => /русск|домашн/.test(cuisineText(p)) },
      { v: 'fast', e: '🥙', label: 'Быстро и недорого', chip: 'Быстро и недорого', test: (p) => p.kind === 'food_court' || FAST_RE.test(placeText(p)) },
      { v: 'any', e: '🍽', label: 'Неважно' },
    ] },
    coffee: { key: 'detail', title: 'Какую кофейню?', opts: [
      // главная рубрика в Яндексе — не «кофе с собой», а кофейня или кафе
      { v: 'sit', e: '🛋', label: 'Посидеть внутри', chip: 'Можно посидеть', test: (p) => { const d = norm(p.desc || ''); return p.setting !== 'outdoor' && !d.startsWith('кофе с собой') && /кофейня|кафе|чайная/.test(d); } },
      { v: 'sweet', e: '🍰', label: 'С десертами и выпечкой', chip: 'Десерты и выпечка', test: (p) => /кондитерск|пекарн|десерт|выпечк|эклер|торт/.test(placeText(p)) },
      { v: 'togo', e: '🥤', label: 'Взять с собой', chip: 'Кофе с собой', test: (p) => /кофе с собой/.test(placeText(p)) },
      { v: 'any', e: '☕', label: 'Неважно' },
    ] },
    walk: { key: 'detail', title: 'Где погулять?', opts: [
      { v: 'park', e: '🌳', label: 'Парк или сквер', chip: 'Парк', test: (p) => PARK_RE.test(placeText(p)) },
      { v: 'view', e: '🌇', label: 'Красивые виды', chip: 'Красивый вид', test: (p) => collSet('views').has(p.id) || /смотров|панорам|вид на/.test(placeText(p)) },
      { v: 'sights', e: '🏙', label: 'Улицы и достопримечательности', chip: 'Достопримечательность', test: (p) => SIGHTS_RE.test(placeText(p)) },
      { v: 'any', e: '🚶', label: 'Неважно' },
    ] },
  };
  const Q_WHO = { key: 'who', title: 'С кем идёшь?', opts: [
    { v: 'solo', e: '🙋', label: 'Только я' },
    { v: 'date', e: '💕', label: 'Вдвоём, на свидание' },
    { v: 'friends', e: '👯', label: 'С друзьями' },
    { v: 'kids', e: '🧸', label: 'С детьми' },
  ] };
  // Где искать: радиус пешком от тебя, центр (ЦАО), видимая часть карты или вся Москва.
  // scale — насколько важна близость: чем больше, тем сильнее решает качество места, а не расстояние
  const KREMLIN = { lat: 55.752, lon: 37.6175 };
  const Q_WHERE = { key: 'where', title: 'Где искать?', opts: [
    { v: 'near', e: '📍', label: 'Рядом со мной', hint: 'до 15 минут пешком', radius: 1200, scale: 500 },
    { v: 'close', e: '🚶', label: 'Недалеко', hint: 'до 40 минут пешком', radius: 3000, scale: 1100 },
    { v: 'center', e: '🏰', label: 'В центре', hint: 'Кремль, Арбат, Китай-город и вокруг', scale: 2500 },
    { v: 'map', e: '🗺', label: 'Где сейчас карта', hint: 'то, что видно на экране', scale: 1500 },
    { v: 'any', e: '🌍', label: 'Неважно', hint: 'лучшее по всей Москве', scale: 15000 },
  ] };
  const Q_WHEN = { key: 'when', title: 'Когда выходишь?', opts: [
    { v: 'now', e: '⚡', label: 'Прямо сейчас' },
    { v: 'hour', e: '⏰', label: 'Через час' },
    { v: 'evening', e: '🌆', label: 'Вечером' },
    { v: 'tomorrow', e: '📅', label: 'Завтра днём' },
  ] };
  const Q_TIME = { key: 'time', title: 'Сколько есть времени?', opts: [
    { v: 'short', e: '⏱', label: 'Около часа' },
    { v: 'mid', e: '🕑', label: '2–3 часа' },
    { v: 'long', e: '☀️', label: 'Полдня' },
    { v: 'day', e: '🗓', label: 'Весь день' },
  ] };
  const Q_BUDGET = { key: 'budget', title: 'Бюджет на человека?', opts: [
    { v: 0, e: '🆓', label: 'Бесплатно' },
    { v: 1000, e: '💸', label: 'До 1 000 ₽' },
    { v: 2500, e: '💳', label: 'До 2 500 ₽' },
    { v: 5000, e: '💰', label: 'До 5 000 ₽' },
    { v: 10000, e: '💎', label: 'До 10 000 ₽' },
    { v: null, e: '♾️', label: 'Неважно' },
  ] };
  const PAID_MOODS = ['coffee', 'food', 'bar']; // тут «бесплатно» не бывает — такой ответ не предлагаем

  let today = { step: 0, ans: {}, picks: null, plan: null, seen: new Set() };
  let placeBack = null; // карточку места открыли из «Куда сегодня?» — после неё вернёмся туда
  // Защита от случайного двойного касания: после ответа следующий вопрос появляется прямо под пальцем,
  // и второе касание выбрало бы ответ за человека. Касание раньше чем через 0,4 с после ответа не считаем
  let lastAnswerAt = 0;
  const tooFast = () => { const t = Date.now(); if (t - lastAnswerAt < 400) return true; lastAnswerAt = t; return false; };

  function todaySteps() {
    const s = [Q_MOOD];
    if (Q_DETAIL[today.ans.mood]) s.push(Q_DETAIL[today.ans.mood]);
    return s.concat([Q_WHERE, Q_WHO, Q_WHEN, Q_TIME, Q_BUDGET]);
  }

  // Сколько добираться до места: пешком, если оно рядом с тобой; иначе — примерно полчаса на метро
  function travelMin(p) {
    if (!today.user) return 20;
    return distance(today.user, p) <= 2500 ? legMin(today.user, p) : 35;
  }
  const todayOpt = (q, v) => q.opts.find((o) => o.v === v);
  const todayAns = (key) => { const q = todaySteps().find((x) => x.key === key); return q && todayOpt(q, today.ans[key]); };
  // Этот ответ совпадает с профилем («С кем обычно ходишь», «Сколько тратишь») — подсказываем
  const fromProfile = (q, o) => !!profile && (q.key === 'who' || q.key === 'budget') && profile[q.key] !== undefined && profile[q.key] === o.v;
  // Варианты ответа, которые подходят к уже выбранному
  function todayOptions(q) {
    return q.opts.filter((o) => !(q.key === 'budget' && o.v === 0 && PAID_MOODS.includes(today.ans.mood))
      && !(q.key === 'who' && o.v === 'kids' && today.ans.mood === 'bar'));
  }

  // Насколько место подходит под «с кем» и погоду — множитель к качеству места
  function todayPrefer(bad) {
    const who = today.ans.who, date = collSet('date'), views = collSet('views');
    return (p) => {
      let k = 1;
      if (who === 'date') { if (date.has(p.id) || views.has(p.id)) k *= 1.8; if (p.rating >= 4.8) k *= 1.2; if (FAST_RE.test(placeText(p))) k *= 0.5; }
      else if (who === 'friends') { if (p.kind === 'food_court' || barPlace(p)) k *= 1.4; }
      else if (who === 'kids') { if (kidsPlace(p)) k *= 2; if (barPlace(p)) k *= 0.3; if (p.cat === 'photo' && PARK_RE.test(placeText(p))) k *= 1.2; }
      if (bad) k *= isIndoor(p) || p.setting === 'indoor' ? 1.4 : p.setting === 'outdoor' || p.cat === 'photo' ? 0.3 : 1;
      return k;
    };
  }

  // Почему это место: только проверяемые факты (часы, кухня, подборка, «под крышей», бесплатно)
  function whyChips(p, arrive, bad) {
    const out = [];
    const det = todayAns('detail');
    if (det && det.test && det.test(p)) {
      const c = today.ans.mood === 'food' && (p.cuisine || []).find((x) => det.test({ cuisine: [x], name: '' }));
      out.push(c ? `Кухня: ${c}` : det.chip);
    } else {
      const fc = favCuisine(p); // любимая кухня из профиля
      if (fc) out.push(`Твоя кухня: ${(p.cuisine || []).find((x) => CUISINE_RE[fc].test(norm(x))) || 'из профиля'}`);
    }
    // по твоим оценкам: здесь понравилось — или похоже на место, которое понравилось
    if (rates[p.id] === 1) out.push('Тебе здесь понравилось');
    else { const like = likedLike(p); if (like) out.push(`Как «${shortName(like.name)}» — тебе понравилось`); }
    const left = Hours.minutesLeft(p.hours, arrive);
    if (left === Infinity) out.push('Круглосуточно');
    else if (left) { const c = clock(new Date(arrive.getTime() + left * 60000)); out.push(c === '00:00' ? 'Открыто до полуночи' : `Открыто до ${c}`); }
    if (today.ans.who === 'kids' && kidsPlace(p)) out.push('Для детей');
    if (today.ans.who === 'date' && collSet('date').has(p.id)) out.push('Из подборки «На свидание»');
    else if (collSet('views').has(p.id)) out.push('Из подборки «Лучшие виды»');
    else if (collSet('season').has(p.id)) out.push(`Из подборки «${COLLECTIONS.find((c) => c.id === 'season').title}»`);
    if (bad && (isIndoor(p) || p.setting === 'indoor')) out.push('Под крышей');
    if (p.free) out.push('Бесплатно');
    if (visited.size && !visited.has(p.id)) out.push('Новое для тебя');
    return out.slice(0, 3);
  }

  function pickCardHtml(p, i, arrive, bad) {
    const ph = (window.PLACE_PHOTOS || {})[p.id];
    const img = ph ? `<img src="${esc(ph.src.replace('img/places/', 'img/thumbs/'))}?v=${encodeURIComponent(window.APP_VERSION || '')}" alt="" loading="lazy" decoding="async">` : icon(p.cat);
    const why = whyChips(p, arrive, bad).map((t) => `<span>${esc(t)}</span>`).join('');
    return `<button class="pick${i === 0 ? ' pick--best' : ''}" type="button" data-id="${esc(p.id)}">
      <span class="pick-img cat--${p.cat}${ph ? ' pick-img--photo' : ''}">${img}</span>
      <span class="pick-body">
        ${i === 0 ? '<span class="pick-badge">Лучший вариант</span>' : ''}
        <b>${esc(p.name)}</b>
        <small>${p.rating ? `<span class="row-rating">${STAR}${p.rating.toFixed(1).replace('.', ',')}</span> · ` : ''}${esc(catLabel(p))}${stopPrice(p)}</small>
        ${today.user ? `<small>${distanceText(distance(today.user, p))}</small>` : ''}
        ${why ? `<span class="why">${why}</span>` : ''}
      </span></button>`;
  }

  function planHtml() {
    const pl = today.plan;
    if (!pl) return '';
    const ps = routePlaces(pl.ids);
    if (ps.length < 2) return '<p class="near-note">Целый план рядом не собрался — смягчи бюджет или выбери другое время.</p>';
    const r = { startIn: today.startIn, fromMe: today.me ? today.user : null };
    const st = routeStats(ps, r.fromMe, r), tl = routeTimeline(r, ps);
    const stops = ps.map((p, i) => `${i ? `<li class="route-leg">${legMin(ps[i - 1], p)} мин пешком</li>` : ''}
      <li class="route-stop plan-stop" data-id="${esc(p.id)}"><span class="plan-time">${tl[i].arrive}</span>
        <span class="stop-num cat--${p.cat}">${i + 1}</span>
        <span class="stop-name"><b>${esc(p.name)}</b><small>${esc(catLabel(p))} · ~${stayText(stayFor(p))}${stopPrice(p)}</small>
        ${tl[i].warn ? `<small class="stop-closed">${tl[i].warn}</small>` : ''}</span></li>`).join('');
    return `<div class="section-title">План на ${durText(st.total).replace('~', '≈ ')} <small>${kmText(st.km)} пешком · ${placesWord(ps.length)}</small></div>
      <div class="route-price plan-price">${routePriceText(st)}</div>
      <ol class="route-stops plan">${stops}</ol>
      <div class="place-actions">
        <button class="btn btn-primary" type="button" data-today="route">Идём по плану</button>
        <button class="btn btn-secondary" type="button" data-today="replan">${icon('dice')} Другой план</button>
      </div>`;
  }

  function todayHtml() {
    const head = `<div class="sheet-handle"></div>
      <div class="place-head">
        <div class="place-title"><h2>Куда сегодня?</h2></div>
        <div class="head-actions"><button class="icon-btn" type="button" data-today="close" aria-label="Закрыть">${icon('close')}</button></div>
      </div>`;
    const steps = todaySteps();
    if (today.step < steps.length) {
      const q = steps[today.step];
      return head + wxHtml(weatherAt(new Date())) + `<div class="today-dots">${steps.map((_, i) => `<i${i <= today.step ? ' class="on"' : ''}></i>`).join('')}</div>
        <h3 class="today-q">${q.title} <small>${today.step + 1} из ${steps.length}</small></h3>
        <div class="today-opts">${todayOptions(q).map((o) => `<button type="button" class="today-opt" data-answer="${q.key}" data-val="${o.v}">
          ${emo(o.e, 'today-e')}<b>${o.label}${o.adult ? AGE_BADGE : ''}</b>${o.hint || fromProfile(q, o) ? `<small>${o.hint || 'как в твоём профиле'}</small>` : ''}</button>`).join('')}</div>
        ${today.step ? '<div class="draft-links"><button type="button" data-today="back">← Назад</button></div>' : ''}`;
    }
    const startAt = new Date(Date.now() + today.startIn * 60000);
    const wx = weatherAt(startAt);
    if (!today.picks) return head + wxHtml(wx) + '<p class="empty">Подбираю места…</p>';
    const bad = !!(wx && wx.bad);
    const sum = steps.map((q) => { const o = todayOpt(q, today.ans[q.key]); return o ? `<span class="tag">${emo(o.e)} ${o.label}</span>` : ''; }).join('');
    const ps = today.picks;
    const arrive = (p) => new Date(startAt.getTime() + travelMin(p) * 60000);
    const w = today.ans.where;
    const area = (w === 'near' || w === 'close') && !today.me ? 'от центра карты'
      : { near: 'рядом с тобой', close: 'недалеко от тебя', center: 'в центре Москвы', map: 'там, где сейчас карта', any: 'по всей Москве' }[w];
    const notes = [today.locNote, today.note].filter(Boolean).map((n) => `<p class="near-note">${esc(n)}</p>`).join('');
    return head + wxHtml(wx) + `<div class="tags today-sum">${sum}</div>
      ${notes}
      ${ps.length
        ? `<div class="section-title">Лучшие варианты <small>${area}</small></div>
           <p class="today-basis">Каждое место оценено по ${profile ? 'твоему профилю, ' : ''}${taste().size ? 'твоим оценкам мест, где ты был, ' : ''}ответам, оценкам в Яндекс Картах, часам работы к твоему приходу, бюджету, расстоянию и погоде. Первое — с лучшей суммой.${profile ? '' : ' <button type="button" class="link-btn" data-today="profile">Настроить рекомендации</button>'}</p>
           <div class="picks">${ps.map((p, i) => pickCardHtml(p, i, arrive(p), bad)).join('')}</div>
           <div class="draft-links"><button type="button" data-today="more">Другие варианты</button><button type="button" data-today="restart">Ответить заново</button></div>
           ${planHtml()}`
        : `<p class="empty">Под такие ответы рядом ничего не нашлось — попробуй другой бюджет или время.</p>
           <div class="draft-links"><button type="button" data-today="restart">Ответить заново</button></div>`}`;
  }

  function renderToday() { $('#today-sheet').innerHTML = todayHtml(); }

  function openToday() {
    haptic.tap();
    renderToday();
    openSheet('today');
    if (weatherStale()) loadWeather();
  }

  // Лучшие варианты: открыто к твоему приходу (и хватит времени побыть), по бюджету, недалеко;
  // уточнение (кухня, тип кофейни, где гулять) — строго, если таких мест хватает, иначе — мягко.
  // Из лучших берём случайные, но лучшие — чаще, чтобы «Другие варианты» давали новое
  function pickToday() {
    const a = today.ans, mood = todayAns('mood'), where = todayAns('where'), det = todayAns('detail');
    const startAt = new Date(Date.now() + today.startIn * 60000);
    const wx = weatherAt(startAt), bad = !!(wx && wx.bad);
    const prefer = todayPrefer(bad);
    const fits = (p) => {
      if (!mood.cats.includes(p.cat) || (p.cat === 'night' && (!adultOk || a.who === 'kids')) || disliked(p)) return false;
      if (p.rating && p.rating < 4.4) return false;
      if (a.budget !== null) { const m = minPrice(p); if (m === null || m > a.budget) return false; }
      if (bad && a.mood === 'any' && (isOutdoor(p) || p.setting === 'both')) return false; // «Удиви меня» в непогоду — только под крышей
      return true;
    };
    const openFor = (p) => {
      const left = Hours.minutesLeft(p.hours, new Date(startAt.getTime() + travelMin(p) * 60000));
      if (left === null) return p.cat === 'photo'; // часы неизвестны — годится только для улиц и парков
      return left >= Math.min(60, stayFor(p) * 0.7);
    };
    // Зона поиска по шагам: сначала ровно то, что выбрано; если там пусто — чуть шире (и говорим об этом)
    const vb = today.bounds, half = distance({ lat: vb.north, lon: vb.east }, { lat: vb.south, lon: vb.west }) / 2;
    const stages = {
      near: [(x) => x.d <= 1200, (x) => x.d <= 2000],
      close: [(x) => x.d <= 3000, (x) => x.d <= 4500],
      center: [(x) => CENTER_DISTRICTS.has(x.p.district), (x) => x.d <= 5000],
      map: [(x) => x.p.lat <= vb.north && x.p.lat >= vb.south && x.p.lon <= vb.east && x.p.lon >= vb.west, (x) => x.d <= Math.max(2000, half * 2)],
      any: [() => true],
    }[where.v];
    const base = [];
    for (const p of curated) if (fits(p)) base.push({ p, d: distance(today.from, p) });
    const strict = det && det.test;
    let wider = false;
    const collect = (useDet) => {
      let c = [];
      for (let k = 0; k < stages.length; k++) {
        c = base.filter((x) => stages[k](x) && (!useDet || det.test(x.p)));
        // по всей Москве мест тысячи: сначала берём 500 лучших по простой оценке (оценки в Яндексе и
        // расстояние), и уже их проверяем по часам и считаем полностью — так подбор не подтормаживает
        // (если утомляют толпы — без учёта числа оценок, чтобы не потерять малоизвестные места)
        if (c.length > 500) c = c.map((x) => ({ x, s: (tiredOf('crowds') ? 1 : Math.sqrt(x.p.pop || 30)) * (x.p.rating >= 4.8 ? 1.3 : 1) / (1 + x.d / where.scale) })).sort((u, v) => v.s - u.s).slice(0, 500).map((y) => y.x);
        c = c.filter((x) => openFor(x.p));
        if (c.length >= (useDet ? 3 : 4)) { if (k) wider = true; break; }
        if (k === stages.length - 1 && c.length && k) wider = true;
      }
      return c;
    };
    today.note = '';
    let cands = strict ? collect(true) : collect(false);
    if (strict && cands.length < 3) {
      const more = collect(false).filter((x) => !cands.includes(x));
      if (more.length) today.note = cands.length ? `Мест «${det.label.toLowerCase()}» здесь мало — добавил и другие` : `«${det.label}» здесь сейчас не нашлось — вот другие хорошие места`;
      cands = cands.concat(more);
    }
    if (!cands.length) {
      // поздно ночью почти всё закрыто — покажем, что откроется в ближайшие часы
      const last = stages[stages.length - 1];
      cands = base.filter((x) => last(x) && (Hours.minutesToOpen(x.p.hours, startAt) || Infinity) <= 720);
      if (cands.length) today.note = 'В это время почти всё закрыто — вот что откроется в ближайшие часы';
    } else if (wider && !today.note) today.note = where.v === 'map' ? 'На видимой части карты мест мало — добавил вокруг' : where.v === 'center' ? 'В центре подходящего мало — добавил рядом с ним' : 'Совсем рядом подходящего мало — добавил чуть дальше';
    else if (bad && (a.mood === 'walk' || a.mood === 'any')) today.note = 'Погода не для прогулок — выше места под крышей';
    const scale = prefersNear() ? where.scale * 0.6 : where.scale; // утомляет дорога или «недалеко» — ближнее важнее
    const score = (x) => placeQuality(x.p, prefer) * (strict && det.test(x.p) ? 1.5 : 1) / (1 + x.d / scale);
    let top = cands.map((x) => ({ p: x.p, s: score(x) })).sort((x, y) => y.s - x.s).slice(0, 14);
    const fresh = top.filter((x) => !today.seen.has(x.p.id));
    if (fresh.length >= 3) top = fresh;
    // 3 места строго по оценке: лучшие по сумме правил; без двух точек одной сети;
    // в «Удиви меня» сначала лучшее каждого типа, чтобы варианты были разными.
    // «Другие варианты» исключают уже показанные — получаются следующие по оценке
    const picks = [], chains = new Set();
    const take = (x) => { chains.add(chainKey(x.p)); picks.push(x); };
    if (a.mood === 'any') for (const x of top) if (picks.length < 3 && !chains.has(chainKey(x.p)) && !picks.some((q) => q.p.cat === x.p.cat)) take(x);
    for (const x of top) if (picks.length < 3 && !picks.includes(x) && !chains.has(chainKey(x.p))) take(x);
    picks.sort((x, y) => y.s - x.s);
    // уточнённых мест не хватило (например, два филиала одной сети) — добираем лучшими из остальных
    if (picks.length < 3 && strict) {
      const rest = collect(false).filter((x) => !picks.some((q) => q.p === x.p) && !chains.has(chainKey(x.p)))
        .map((x) => ({ p: x.p, s: score(x) })).sort((x, y) => y.s - x.s);
      const had = picks.length;
      for (const x of rest) { if (picks.length >= 3) break; if (chains.has(chainKey(x.p))) continue; chains.add(chainKey(x.p)); picks.push(x); }
      if (picks.length > had && !today.note) today.note = `Мест «${det.label.toLowerCase()}» здесь мало — добавил и другие`;
    }
    picks.forEach((x) => today.seen.add(x.p.id));
    today.picks = picks.map((x) => x.p);
    buildTodayPlan();
  }

  // План на всё время: начинаем с лучшего варианта, дальше — то, что к нему подходит
  // (к еде — прогулка, к музею — кофе и прогулка и т. д.), по часам работы и погоде
  function buildTodayPlan(random) {
    const a = today.ans;
    today.plan = null;
    if (a.time === 'short' || !today.picks.length) return;
    const dur = PLAN_DUR.find((d) => d.v === a.time);
    const anchor = today.picks[0];
    const startAt = new Date(Date.now() + today.startIn * 60000);
    const wx = weatherAt(startAt), bad = !!(wx && wx.bad);
    const want = new Set(todayAns('mood').want.filter((t) => !(t === 'night' && (a.who === 'kids' || !adultOk))));
    // бесплатно — вместо кафе прогулки и бесплатные музеи
    if (a.budget === 0) { ['coffee', 'food', 'night'].forEach((t) => want.delete(t)); want.add('photo'); want.add('museum'); }
    const slots = planSlots(want, dur.n, startAt, bad);
    // первый шаг — само выбранное место
    const i = slots.findIndex((s) => slotMatch(anchor, s));
    if (i >= 0) slots.splice(i, 1); else slots.pop();
    const lead = (today.me ? legMin(today.user, anchor) : 0) + stayFor(anchor);
    const r = priceRange(anchor);
    let best = null;
    for (let k = 0; k < 5; k++) {
      const pl = planRoute({
        from: anchor, me: true, startAt: new Date(startAt.getTime() + lead * 60000), slots, max: dur.max - lead, random: random || k > 0,
        budget: a.budget, spent: r ? (r[0] + r[1]) / 2 : 0, prefer: todayPrefer(bad), exclude: new Set([anchor.id]), chains: new Set([chainKey(anchor)]),
        noNight: a.who === 'kids',
      });
      if (!best || betterPlan(pl, best)) best = pl;
      if (pl.ids.length === slots.length && !pl.subs) break;
    }
    today.plan = { ids: [anchor.id].concat(best.ids) };
  }

  async function finishToday() {
    today.picks = null;
    today.plan = null;
    today.seen = new Set();
    today.startIn = whenOffset(today.ans.when);
    renderToday();
    // Где ты — спрашиваем только для «рядом» и «недалеко»; для остального хватит, если уже знаем
    const w = today.ans.where;
    let user = state.user && inMkad(state.user) ? state.user : null;
    today.locNote = '';
    if (w === 'near' || w === 'close') {
      const sp = await startPoint();
      user = sp.me ? sp.from : null;
      if (!user) today.locNote = sp.outside ? 'Похоже, ты за МКАД — ищу от центра карты' : 'Не получилось узнать, где ты, — ищу от центра карты';
    }
    today.user = user;
    today.me = (w === 'near' || w === 'close') && !!user;
    today.from = w === 'center' ? KREMLIN : w === 'map' ? mapCenter() : w === 'any' ? (user || KREMLIN) : (user || mapCenter());
    today.bounds = state.view.bounds;
    pickToday();
    if (openSheetName === 'today') renderToday();
  }

  function answerToday(key, raw) {
    const q = todaySteps()[today.step];
    if (!q || q.key !== key) return;
    const o = q.opts.find((x) => String(x.v) === raw);
    if (!o) return;
    const go = () => {
      if (key === 'mood' && today.ans.mood !== o.v) delete today.ans.detail; // другое настроение — другое уточнение
      today.ans[key] = o.v;
      today.step++;
      haptic.tap();
      if (today.step >= todaySteps().length) finishToday();
      else renderToday();
      $('#today-sheet').scrollTop = 0;
    };
    if (o.adult && !adultOk) askAdult().then((ok) => { openSheet('today'); if (ok) go(); });
    else go();
  }

  function todayRoute() {
    const pl = today.plan;
    if (!pl || pl.ids.length < 2) return;
    const ps = routePlaces(pl.ids);
    const names = { coffee: 'кофе', photo: 'прогулка', food: 'еда', museum: 'музей', night: 'бар', mall: 'ТЦ' };
    const title = ps.map((p) => names[p.cat]).join(' → ');
    showRoute({ id: 'today', title: title[0].toUpperCase() + title.slice(1), emoji: todayAns('mood').e, ids: pl.ids, gen: true, regen: 'today',
      fromMe: today.me ? today.user : null, startIn: today.startIn });
  }

  function onTodayClick(e) {
    const ans = e.target.closest('[data-answer]');
    if (ans) { if (!tooFast()) answerToday(ans.dataset.answer, ans.dataset.val); return; }
    const act = e.target.closest('[data-today]');
    if (act) {
      const x = act.dataset.today;
      if (x === 'close') closeSheets();
      else if (x === 'back') { today.step = Math.max(0, today.step - 1); haptic.tap(); renderToday(); }
      else if (x === 'restart') { today = { step: 0, ans: {}, picks: null, plan: null, seen: new Set() }; haptic.tap(); renderToday(); }
      else if (x === 'more') { haptic.impact(); pickToday(); renderToday(); }
      else if (x === 'replan') { haptic.impact(); buildTodayPlan(true); renderToday(); }
      else if (x === 'route') { haptic.impact(); todayRoute(); }
      else if (x === 'profile') openProfile(false);
      return;
    }
    const row = e.target.closest('[data-id]');
    const p = row && byId.get(row.dataset.id);
    if (p) { haptic.tap(); backScroll = $('#today-sheet').scrollTop; openPlace(p, { focus: true }); placeBack = 'today'; }
  }

  // ---------- Достижения ----------
  // Считаются по отмеченным местам: «Отметить посещение» в карточке места и галочки в маршрутах
  const CENTER_DISTRICTS = new Set(['район Арбат', 'Басманный район', 'район Замоскворечье', 'Красносельский район', 'Мещанский район',
    'Пресненский район', 'Таганский район', 'Тверской район', 'район Хамовники', 'район Якиманка']);
  const AWARDS = [
    { id: 'first', e: '👣', title: 'Первый шаг', text: 'Первое место', of: 'places', need: 1 },
    { id: 'places10', e: '🧭', title: 'Иссле­дова­тель', text: '10 мест', of: 'places', need: 10 },
    { id: 'places50', e: '🏆', title: 'Знаток Москвы', text: '50 мест', of: 'places', need: 50 },
    { id: 'coffee', e: '☕', title: 'Кофеман', text: '5 кофеен', of: 'coffee', need: 5 },
    { id: 'food', e: '🍽', title: 'Гурман', text: '5 мест с едой', of: 'food', need: 5 },
    { id: 'museum', e: '🏛', title: 'Ценитель искусства', text: '5 музеев', of: 'museum', need: 5 },
    { id: 'photo', e: '📸', title: 'Фотограф', text: '10 красивых мест', of: 'photo', need: 10 },
    { id: 'mall', e: '🛍', title: 'Шопоголик', text: '3 ТЦ или фудкорта', of: 'mall', need: 3 },
    { id: 'night', e: '🍸', title: 'Ночная жизнь', text: '3 бара', of: 'night', need: 3, adult: true },
    { id: 'center', e: '🏰', title: 'Сердце города', text: '10 мест в центре', of: 'center', need: 10 },
    { id: 'districts5', e: '🗺', title: 'Путе­шест­венник', text: '5 районов', of: 'districts', need: 5 },
    { id: 'districts20', e: '🌍', title: 'Вся Москва', text: '20 районов', of: 'districts', need: 20 },
    { id: 'route1', e: '🚶', title: 'На маршруте', text: 'Первый маршрут', of: 'routes', need: 1 },
    { id: 'route5', e: '🥾', title: 'Бывалый', text: '5 маршрутов', of: 'routes', need: 5 },
  ];
  const awardsShown = () => AWARDS.filter((a) => !a.adult || adultOk);

  // ids и done — какие отметки считать (по умолчанию все); для «Моего месяца» — только до нужного дня
  function awardStats(ids, done) {
    const s = { places: 0, districts: 0, center: 0, routes: new Set((done || routesDone).map((d) => d.id)).size, coffee: 0, food: 0, museum: 0, photo: 0, mall: 0, night: 0 };
    const ds = new Set();
    for (const id of ids || visited) {
      const p = byId.get(id);
      if (!p) continue;
      s.places++;
      s[p.cat] = (s[p.cat] || 0) + 1;
      if (p.district) { ds.add(p.district); if (CENTER_DISTRICTS.has(p.district)) s.center++; }
    }
    s.districts = ds.size;
    return s;
  }
  const awardsGot = (s) => new Set(awardsShown().filter((a) => s[a.of] >= a.need).map((a) => a.id));

  // Сколько всего районов с нашими местами — для «открыто районов: 7 из …»
  let districtTotal = 0, districtTotalFor = 0;
  function totalDistricts() {
    if (districtTotalFor !== curated.length) { districtTotal = new Set(curated.map((p) => p.district).filter(Boolean)).size; districtTotalFor = curated.length; }
    return districtTotal;
  }

  function updateAwardBadge() {
    const n = awardsGot(awardStats()).size;
    $('#award-count').textContent = n;
    $('#award-count').hidden = !n;
    $('#open-awards').classList.toggle('has-favs', n > 0);
  }

  // ---------- «Мой месяц»: итоги по отметкам с датой ----------
  const MONTH_NOM = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
  const MONTH_PREP = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];
  const CAT_MANY = { coffee: 'кофейни', food: 'места с едой', museum: 'музеи', photo: 'красивые места', mall: 'ТЦ и фудкорты', night: 'бары' };
  // Месяц по номеру дня: дни [start, end)
  function monthOf(day) {
    const d = new Date(day * 86400000), y = d.getUTCFullYear(), m = d.getUTCMonth();
    return { m, key: y * 12 + m, start: Date.UTC(y, m, 1) / 86400000, end: Date.UTC(y, m + 1, 1) / 86400000 };
  }
  const doneDay = (r) => mskDay(r.ts);
  function monthStats(mo) {
    const inMonth = (d) => d >= mo.start && d < mo.end;
    const ps = Object.keys(visitDays).filter((id) => visited.has(id) && inMonth(visitDays[id])).map((id) => byId.get(id)).filter(Boolean);
    const count = (list) => { const c = new Map(); list.forEach((x) => c.set(x, (c.get(x) || 0) + 1)); return [...c].sort((a, b) => b[1] - a[1])[0] || null; };
    const topCat = count(ps.map((p) => p.cat));
    const topCuisine = count(ps.filter((p) => p.cat === 'food').flatMap((p) => p.cuisine || []));
    const districts = new Set(ps.map((p) => p.district).filter(Boolean));
    // новые районы — где раньше отметок не было (отметки без даты — старые, из прошлых версий)
    const upTo = (lim) => [...visited].filter((id) => !(id in visitDays) || visitDays[id] < lim);
    const earlier = new Set(upTo(mo.start).map((id) => byId.get(id)).filter(Boolean).map((p) => p.district));
    const doneTo = (lim) => routesDone.filter((r) => doneDay(r) < lim);
    const got0 = awardsGot(awardStats(upTo(mo.start), doneTo(mo.start))), got1 = awardsGot(awardStats(upTo(mo.end), doneTo(mo.end)));
    return {
      places: ps.length, districts: districts.size, routes: routesDone.filter((r) => inMonth(doneDay(r))).length,
      topCat: topCat && topCat[1] >= 2 ? topCat : null, topCuisine: topCuisine && topCuisine[1] >= 2 ? topCuisine : null,
      newDistricts: [...districts].filter((d) => !earlier.has(d)),
      liked: ps.filter((p) => rates[p.id] === 1).length, rated: ps.filter((p) => rates[p.id]).length,
      awards: awardsShown().filter((a) => got1.has(a.id) && !got0.has(a.id)),
    };
  }
  let monthSel = null; // какой месяц смотрим; null — по умолчанию
  // Месяцы с отметками: текущий и до двух прошлых. В первую неделю месяца сначала показываем итоги прошлого
  function monthList() {
    const cur = monthOf(mskDay()), out = [cur];
    let mo = cur;
    for (let i = 0; i < 2; i++) {
      mo = monthOf(mo.start - 1);
      const s = monthStats(mo);
      if (s.places || s.routes) out.push(mo); else break;
    }
    return out;
  }
  function monthHtml() {
    const list = monthList(), today0 = mskDay();
    const def = list[1] && today0 - list[0].start < 7 ? list[1] : list[0];
    const mo = list.find((x) => x.key === monthSel) || def;
    const s = monthStats(mo), isCur = mo.key === list[0].key;
    const tabs = list.length > 1 ? `<div class="seg month-tabs">${list.slice().reverse().map((x) => `<button type="button" class="seg-btn${x.key === mo.key ? ' active' : ''}" data-month="${x.key}">${MONTH_NOM[x.m][0].toUpperCase() + MONTH_NOM[x.m].slice(1)}</button>`).join('')}</div>` : '';
    const head = `<div class="month-head"><b>${emo('🗓')} Мой ${MONTH_NOM[mo.m]}</b>${isCur ? '<small>итоги собираются</small>' : ''}</div>`;
    if (!s.places && !s.routes) {
      return `<div class="month">${head}${tabs}<p class="month-empty">В ${MONTH_PREP[mo.m]} пока ничего не отмечено. Отмечай места, в которых побываешь, — здесь соберутся итоги месяца: сколько мест и районов, что чаще всего, новые значки.</p></div>`;
    }
    const facts = [];
    if (s.topCat) facts.push(`Чаще всего — ${CAT_MANY[s.topCat[0]]}: ${s.topCat[1]}`);
    if (s.topCuisine) facts.push(`Любимая кухня — ${s.topCuisine[0].toLowerCase()}`);
    if (s.newDistricts.length) facts.push(`Новые районы: ${s.newDistricts.slice(0, 3).join(', ')}${s.newDistricts.length > 3 ? ` и ещё ${s.newDistricts.length - 3}` : ''}`);
    if (s.rated) facts.push(`Понравилось ${s.liked} из ${s.rated} оценённых`);
    const aw = s.awards.length ? `<div class="month-awards">${s.awards.map((a) => `<span>${emo(a.e)} ${a.title}</span>`).join('')}</div>` : '';
    return `<div class="month">${head}${tabs}
      <div class="aw-stats">
        <div class="aw-stat"><b>${s.places}</b><small>${plural(s.places, 'место', 'места', 'мест')}</small></div>
        <div class="aw-stat"><b>${s.districts}</b><small>${plural(s.districts, 'район', 'района', 'районов')}</small></div>
        <div class="aw-stat"><b>${s.routes}</b><small>${plural(s.routes, 'маршрут', 'маршрута', 'маршрутов')}</small></div>
      </div>
      ${facts.length ? `<ul class="month-facts">${facts.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
      ${aw ? `<div class="f-label">Новые значки</div>${aw}` : ''}
      ${STORY_TG ? `<button class="btn btn-secondary btn-wide" type="button" data-awards="story-month" data-key="${mo.key}">${emo('📸')} Поделиться в истории</button>` : ''}
    </div>`;
  }
  function monthStoryText(key) {
    const mo = monthList().find((x) => x.key === key);
    if (!mo) return null;
    const s = monthStats(mo);
    const parts = [`${s.places} ${plural(s.places, 'место', 'места', 'мест')}`, `${s.districts} ${plural(s.districts, 'район', 'района', 'районов')}`];
    if (s.routes) parts.push(`${s.routes} ${plural(s.routes, 'маршрут', 'маршрута', 'маршрутов')}`);
    return `Мой ${MONTH_NOM[mo.m]} в Москве: ${parts.join(', ')}${s.topCat ? `. Чаще всего — ${CAT_MANY[s.topCat[0]]}` : ''}`;
  }

  // ---------- Истории Telegram ----------
  // Картинка — готовая, с сайта (img/story/*.jpg: Telegram берёт её по ссылке), подробности — в подписи.
  // Выложить историю можно только из Telegram на телефоне (версия 7.8+) — в других местах кнопки нет
  const STORY_TG = supports('7.8') && /^(ios|android|android_x)$/.test(tg.platform) && typeof tg.shareToStory === 'function';
  function shareStory(img, text) {
    const url = new URL(`img/story/${img}.jpg?v=${encodeURIComponent(window.APP_VERSION || '')}`, location.href).href;
    const tail = ` · @${cfg.BOT_USERNAME}`; // в подписи без Premium — до 200 знаков
    const body = text.length + tail.length > 200 ? text.slice(0, 199 - tail.length).trim() + '…' : text;
    haptic.impact();
    try { tg.shareToStory(url, { text: body + tail }); } catch (e) { toast('Не получилось открыть редактор историй'); }
  }

  function awardsHtml() {
    const s = awardStats(), got = awardsGot(s), list = awardsShown();
    const total = totalDistricts();
    const bar = (v, max) => `<div class="aw-bar"><i style="width:${Math.min(100, (v / max) * 100)}%"></i></div>`;
    const badges = list.map((a) => {
      const on = got.has(a.id), v = Math.min(s[a.of] || 0, a.need);
      // полученный значок можно выложить в историю — тогда он кнопка
      const tag = on && STORY_TG ? 'button' : 'div';
      return `<${tag} class="award${on ? ' award--on' : ''}"${tag === 'button' ? ` type="button" data-award-story="${a.id}"` : ''}>${emo(a.e, 'award-e')}<b>${a.title}</b>
        <small>${on ? (STORY_TG ? 'В историю ›' : 'Получено') : a.text}</small>${on || a.need === 1 ? '' : `<div class="aw-mini">${bar(v, a.need)}<em>${v}/${a.need}</em></div>`}</${tag}>`;
    }).join('');
    const nr = Object.values(rates), likes = nr.filter((v) => v === 1).length;
    const been = [...visited].reverse().map((id) => byId.get(id)).filter(Boolean);
    return `<div class="sheet-handle"></div>
      <div class="place-head">
        <div class="place-title"><h2>Профиль и достижения</h2></div>
        <div class="head-actions"><button class="icon-btn" type="button" data-awards="close" aria-label="Закрыть">${icon('close')}</button></div>
      </div>
      <div class="prof-card">
        <b>Рекомендации</b>
        <small>${profile ? esc(profileSummary()) : 'Ответь на 6 коротких вопросов — подбор будет учитывать твои интересы, любимые кухни, бюджет и то, что тебя утомляет.'}</small>
        ${nr.length ? `<small class="prof-rates">${emo('👍')} ${likes} · ${emo('👎')} ${nr.length - likes} — оценки мест тоже учитываются: похожее на то, что понравилось, — выше, «не моё» больше не предлагаю</small>` : ''}
        <button class="btn btn-secondary btn-wide" type="button" data-awards="profile">${profile ? 'Изменить ответы' : 'Настроить рекомендации'}</button>
      </div>
      ${monthHtml()}
      <div class="section-title">За всё время</div>
      <div class="aw-stats">
        <div class="aw-stat"><b>${s.places}</b><small>${plural(s.places, 'место', 'места', 'мест')}</small></div>
        <div class="aw-stat"><b>${s.districts}</b><small>${plural(s.districts, 'район', 'района', 'районов')}</small></div>
        <div class="aw-stat"><b>${s.routes}</b><small>${plural(s.routes, 'маршрут', 'маршрута', 'маршрутов')}</small></div>
      </div>
      ${total ? `<div class="aw-progress"><div class="f-label budget-head">Открыто районов Москвы <b>${s.districts} из ${total}</b></div>${bar(s.districts, total)}</div>` : ''}
      <div class="section-title">Значки <small>${got.size} из ${list.length}</small></div>
      <div class="awards">${badges}</div>
      ${rateListHtml()}
      <div class="section-title">Посещённые места${been.length ? ` <small>${been.length}</small>` : ''}</div>
      ${been.length
        ? `<div class="rows">${been.slice(0, 60).map((p) => rowHtml(p, null, p.district || p.address)).join('')}</div>`
        : '<p class="empty">Пока пусто. Открой место на карте и нажми «Отметить посещение» — или ставь галочки, когда идёшь по маршруту.</p>'}
      <div class="section-title">Документы</div>
      <div class="doc-links">
        <a href="#" data-doc="terms">Пользовательское соглашение</a>
        <a href="#" data-doc="privacy">Политика обработки персональных данных</a>
        <a href="#" data-doc="consent">Согласие на обработку персональных данных</a>
      </div>
      <button class="link-btn link-btn--danger" type="button" data-awards="withdraw">Отозвать согласие и удалить мои данные</button>
      <p class="f-note credits">Значки эмодзи — Twemoji (© Twitter, Inc. и другие авторы), лицензия CC BY 4.0. Шрифт — Nunito (© The Nunito Project Authors), лицензия SIL OFL 1.1. Фото мест — Wikimedia Commons, автор и лицензия указаны у каждого фото.</p>`;
  }

  // Перерисовать профиль на том же месте прокрутки (после оценки, смены месяца)
  function rerenderAwards() {
    const sh = $('#awards-sheet'), top = sh.scrollTop;
    sh.innerHTML = awardsHtml();
    sh.scrollTop = top;
  }

  function openAwards() {
    haptic.tap();
    monthSel = null;
    $('#awards-sheet').innerHTML = awardsHtml();
    openSheet('awards');
  }

  // Новый значок после отметки — поздравляем (если только что пройден маршрут — чуть позже, после его тоста)
  function checkNewAwards(before, delay) {
    const after = awardsGot(awardStats());
    const fresh = awardsShown().find((a) => after.has(a.id) && !before.has(a.id));
    updateAwardBadge();
    if (fresh) setTimeout(() => { haptic.notify('success'); toast(`Новый значок: «${fresh.title}»!`, fresh.e); }, delay || 0);
  }

  function visitButtonHtml(p) {
    const on = visited.has(p.id);
    return `<button class="tag tag--btn${on ? ' tag--open' : ''}" type="button" data-action="visit" aria-pressed="${on}">${on ? icon('check', 'ic-inline') + 'Посещено' : icon('plus', 'ic-inline') + 'Отметить посещение'}</button>`;
  }

  // «Как тебе?» — появляется, когда место отмечено. attr — data-атрибут кнопок (в карточке места и в профиле разные)
  function rateButtons(p, attr) {
    const r = rates[p.id];
    const b = (v, e, label) => `<button type="button" class="rate-btn${r === v ? ' is-on' : ''}" ${attr}="${v}" aria-pressed="${r === v}"${label ? '' : ` aria-label="${v === 1 ? 'Понравилось' : 'Не моё'}"`}>${emo(e)}${label ? ' ' + label : ''}</button>`;
    return { like: b(1, '👍', attr === 'data-rate' ? 'Понравилось' : ''), dislike: b(-1, '👎', attr === 'data-rate' ? 'Не моё' : '') };
  }
  function rateHtml(p) {
    if (!visited.has(p.id)) return '';
    const b = rateButtons(p, 'data-rate');
    return `<div class="rate"><span>Как тебе?</span>${b.like}${b.dislike}</div>`;
  }
  // В профиле: отмеченные места без оценки — оценить в одно касание
  function rateListHtml() {
    const list = [...visited].reverse().map((id) => byId.get(id)).filter((p) => p && !rates[p.id]).slice(0, 5);
    if (!list.length) return '';
    return `<div class="section-title">Оцени отмеченные места <small>подбор учтёт</small></div>
      <div class="rate-list">${list.map((p) => { const b = rateButtons(p, 'data-rate-v'); return `<div class="rate-row" data-rate-id="${esc(p.id)}">
        <button type="button" class="rate-name" data-id="${esc(p.id)}"><b>${esc(p.name)}</b><small>${esc(catLabel(p))}${p.district ? ' · ' + esc(p.district) : ''}</small></button>${b.like}${b.dislike}</div>`; }).join('')}</div>`;
  }

  // ---------- Документы и согласие ----------
  // До входа человек принимает пользовательское соглашение, политику и даёт согласие на обработку
  // персональных данных (docs/*.html). Ответ помним по версии документов: поменялись — спросим снова
  const LEGAL_V = cfg.LEGAL_VERSION || '1';
  const DOC_TITLES = { terms: 'Пользовательское соглашение', privacy: 'Политика обработки персональных данных', consent: 'Согласие на обработку персональных данных' };
  const legalAccepted = () => { try { return localStorage.getItem('legal') === LEGAL_V; } catch (e) { return false; } };
  let legalDone = null;

  // Оператор и e-mail — из config.js; пока не заполнены, видна пометка «не указано»
  function fillOperator(root) {
    const set = (sel, value, empty) => root.querySelectorAll(sel).forEach((el) => {
      el.textContent = value || empty;
      el.classList.toggle('todo', !value);
    });
    set('[data-op="name"]', cfg.OPERATOR_NAME, '[ФИО или название оператора — не указано]');
    set('[data-op="email"]', cfg.OPERATOR_EMAIL, '[e-mail для обращений — не указан]');
    set('[data-op="app"]', cfg.APP_NAME, 'Куда пойти');
    set('[data-op="bot"]', cfg.BOT_USERNAME ? '@' + cfg.BOT_USERNAME : '', '[бот — не указан]');
    const [y, m, d] = LEGAL_V.split('-');
    root.querySelectorAll('[data-op="version"]').forEach((el) => { el.textContent = d ? `${d}.${m}.${y}` : LEGAL_V; });
  }

  async function openDoc(name) {
    if (!DOC_TITLES[name]) return;
    haptic.tap();
    $('#doc-title').textContent = DOC_TITLES[name];
    const body = $('#doc-body');
    body.innerHTML = '<p class="empty">Загружаю…</p>';
    $('#doc-view').hidden = false;
    try {
      const r = await fetch(`docs/${name}.html?v=${encodeURIComponent(window.APP_VERSION || '')}`);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const main = new DOMParser().parseFromString(await r.text(), 'text/html').querySelector('main');
      main.querySelectorAll('h1').forEach((h) => h.remove());
      fillOperator(main);
      body.innerHTML = main.innerHTML;
    } catch (e) {
      body.innerHTML = '<p class="empty">Не получилось загрузить документ. Проверь интернет и попробуй ещё раз.</p>';
    }
    body.scrollTop = 0;
  }

  function syncLegal() {
    $('#legal-ok').disabled = ![...document.querySelectorAll('[data-legal]')].every((c) => c.checked);
  }

  function showLegal(done) {
    legalDone = done;
    const g = $('#legal');
    g.hidden = false;
    void g.offsetWidth;
    g.classList.add('show');
    syncLegal();
  }

  function acceptLegal() {
    try { localStorage.setItem('legal', LEGAL_V); localStorage.setItem('legal_at', new Date().toISOString()); } catch (e) { /* хранилище недоступно */ }
    if (supports('6.9')) tg.CloudStorage.setItem('legal', LEGAL_V);
    haptic.notify('success');
    const g = $('#legal');
    g.classList.remove('show');
    setTimeout(() => { g.hidden = true; }, 300);
    const d = legalDone;
    legalDone = null;
    if (d) d();
  }

  // Согласие уже дано на этом телефоне или в Telegram на другом устройстве — не спрашиваем
  function ensureLegal(done) {
    if (legalAccepted()) { done(); return; }
    if (supports('6.9') && !withdrawPending) {
      tg.CloudStorage.getItem('legal', (err, v) => {
        if (!err && v === LEGAL_V) { try { localStorage.setItem('legal', LEGAL_V); } catch (e) { /* хранилище недоступно */ } done(); }
        else showLegal(done);
      });
    } else showLegal(done);
  }

  // Отзыв согласия: удаляем всё, что приложение хранит о человеке, — на телефоне и в облаке Telegram
  const USER_KEYS = ['favs', 'age18', 'theme', 'route_draft', 'routes_saved', 'routes_liked', 'visited', 'routes_done', 'visit_days', 'rates', 'onboarded', 'legal', 'profile', 'profile_skip'];
  // Пока облако не подтвердило удаление (например, не было сети), на телефоне лежит отметка:
  // при следующем запуске сначала дочищаем облако и ничего из него не берём — ни данные, ни согласие
  const WITHDRAW_KEY = 'withdraw_pending';
  const withdrawPending = (() => { try { return localStorage.getItem(WITHDRAW_KEY) === '1'; } catch (e) { return false; } })();
  function clearCloud(done) {
    tg.CloudStorage.removeItems(USER_KEYS, (err) => {
      if (!err) { try { localStorage.removeItem(WITHDRAW_KEY); } catch (e) { /* хранилище недоступно */ } }
      if (done) done();
    });
  }
  function withdrawConsent() {
    const go = () => {
      try { USER_KEYS.concat(['legal_at', 'gen', 'weather', 'lite']).forEach((k) => localStorage.removeItem(k)); } catch (e) { /* хранилище недоступно */ }
      if (supports('6.9')) {
        try { localStorage.setItem(WITHDRAW_KEY, '1'); } catch (e) { /* хранилище недоступно */ }
        clearCloud(() => location.reload());
        setTimeout(() => location.reload(), 4000); // облако не ответило (нет сети) — дочистим при следующем запуске
      } else location.reload();
    };
    const text = 'Отозвать согласие? Избранное, маршруты, отметки, ответы и настройки удалятся с этого устройства и из облака Telegram. Чтобы снова пользоваться приложением, нужно будет заново принять документы.';
    if (supports('6.2')) tg.showConfirm(text, (ok) => ok && go());
    else if (window.confirm(text)) go();
  }

  // ---------- Профиль рекомендаций: интересы и вопросы о предпочтениях ----------
  // Ответы превращаются в понятные правила оценки мест (profileK): каждое правило опирается
  // на данные Яндекс Карт — категорию и рубрики, кухни, цену, «на улице / в помещении», число оценок
  const CUISINE_RE = {
    georgian: /грузин|кавказ|армян|азербайдж/, italian: /итальян|пицц/, asian: /япон|паназиат|китай|корей|вьетнам|тай|азиат/,
    russian: /русск|домашн/, european: /европ/, east: /узбек|восточ|турец|арабск|ливан/, meat: /мясн|стейк|гриль/, veg: /вегет|веган/,
  };
  const PROFILE_Q = [
    { key: 'interests', multi: true, title: 'Что тебе интересно?', sub: 'Выбери всё, что нравится', opts: [
      { v: 'coffee', e: '☕', label: 'Кофейни' },
      { v: 'food', e: '🍽', label: 'Рестораны и кафе' },
      { v: 'parks', e: '🌳', label: 'Парки и прогулки' },
      { v: 'views', e: '🌇', label: 'Виды и смотровые' },
      { v: 'museum', e: '🏛', label: 'Музеи и выставки' },
      { v: 'sights', e: '🏙', label: 'Улицы и достопримечательности' },
      { v: 'mall', e: '🛍', label: 'ТЦ и шопинг' },
      { v: 'night', e: '🍸', label: 'Бары и кальянные', adult: true },
    ] },
    { key: 'evening', multi: true, title: 'Как выглядит твой идеальный вечер?', sub: 'Можно выбрать один вариант или несколько', opts: [
      { v: 'dinner', e: '🍷', label: 'Ужин в хорошем ресторане' },
      { v: 'walk', e: '🌆', label: 'Долгая прогулка по городу' },
      { v: 'talk', e: '☕', label: 'Кофе и разговоры' },
      { v: 'culture', e: '🖼', label: 'Выставка или музей' },
      { v: 'bar', e: '🍸', label: 'Бар с друзьями', adult: true },
      { v: 'short', e: '🏠', label: 'Выбраться ненадолго и недалеко' },
    ] },
    { key: 'tired', multi: true, title: 'Что тебя утомляет?', sub: 'Такие места будут ниже в подборе', opts: [
      { v: 'crowds', e: '👥', label: 'Толпы и самые раскрученные места' },
      { v: 'travel', e: '🚇', label: 'Долгая дорога' },
      { v: 'noise', e: '🔊', label: 'Шумные бары и фудкорты' },
      { v: 'pricey', e: '💸', label: 'Дорогие места' },
      { v: 'outdoor', e: '🥶', label: 'Долго быть на улице' },
      { v: 'none', e: '😌', label: 'Ничего из этого', exclusive: true },
    ] },
    { key: 'who', title: 'С кем ты обычно ходишь?', opts: [
      { v: 'solo', e: '🙋', label: 'Чаще один или одна' },
      { v: 'date', e: '💕', label: 'Вдвоём' },
      { v: 'friends', e: '👯', label: 'С друзьями' },
      { v: 'kids', e: '🧸', label: 'С детьми' },
    ] },
    { key: 'budget', title: 'Сколько обычно тратишь за выход?', sub: 'На человека', opts: [
      { v: 0, e: '🆓', label: 'Стараюсь бесплатно' },
      { v: 1000, e: '💸', label: 'До 1 000 ₽' },
      { v: 2500, e: '💳', label: 'До 2 500 ₽' },
      { v: 5000, e: '💰', label: 'До 5 000 ₽' },
      { v: 10000, e: '💎', label: 'До 10 000 ₽' },
      { v: null, e: '♾️', label: 'Не считаю' },
    ] },
    { key: 'cuisines', multi: true, title: 'Какую кухню любишь?', sub: 'Если ничего не выбрать — подойдёт любая', opts: [
      { v: 'georgian', e: '🥟', label: 'Грузинская и кавказская' },
      { v: 'italian', e: '🍝', label: 'Итальянская' },
      { v: 'asian', e: '🍣', label: 'Японская и азиатская' },
      { v: 'russian', e: '🥞', label: 'Русская' },
      { v: 'european', e: '🥗', label: 'Европейская' },
      { v: 'east', e: '🍢', label: 'Восточная' },
      { v: 'meat', e: '🥩', label: 'Мясо и стейки' },
      { v: 'veg', e: '🥦', label: 'Вегетарианская' },
    ] },
  ];

  let profile = readJson('profile', null);
  function saveProfile() {
    const s = JSON.stringify(profile);
    try { localStorage.setItem('profile', s); } catch (e) { /* хранилище недоступно */ }
    if (supports('6.9')) tg.CloudStorage.setItem('profile', s);
  }
  function loadCloudProfile() {
    if (!supports('6.9')) return;
    tg.CloudStorage.getItem('profile', (err, v) => {
      if (err || !v) return;
      let p;
      try { p = JSON.parse(v); } catch (e) { return; }
      if (p && typeof p === 'object' && (!profile || (p.ts || 0) > (profile.ts || 0))) {
        profile = p;
        try { localStorage.setItem('profile', v); } catch (e) { /* хранилище недоступно */ }
      }
    });
  }

  // Подходит ли место под интерес из профиля
  function interestMatch(p, v) {
    const t = placeText(p);
    switch (v) {
      case 'parks': return p.cat === 'photo' && PARK_RE.test(t);
      case 'views': return collSet('views').has(p.id) || /смотров|панорам/.test(t);
      case 'sights': return p.cat === 'photo' && SIGHTS_RE.test(t);
      default: return p.cat === v;
    }
  }
  const favCuisine = (p) => p.cat === 'food' && profile && (profile.cuisines || []).find((c) => CUISINE_RE[c] && CUISINE_RE[c].test(cuisineText(p)));
  const tiredOf = (v) => !!(profile && (profile.tired || []).includes(v));
  // Идеальный вечер — список (раньше был один ответ строкой: такие профили тоже понимаем)
  const evenings = () => (profile ? [].concat(profile.evening || []) : []);
  // Ближнее важнее: утомляет долгая дорога или идеальный вечер — «выбраться ненадолго и недалеко»
  const prefersNear = () => tiredOf('travel') || evenings().includes('short');

  // Множитель к оценке места по профилю: каждое правило — отдельная строчка, без случайностей
  function profileK(p) {
    if (!profile) return 1;
    let k = 1;
    const ints = profile.interests || [];
    if (ints.length) k *= ints.some((v) => interestMatch(p, v)) ? 1.35 : 0.8;          // твои интересы — выше
    const ev = { dinner: p.cat === 'food' && (minPrice(p) || 0) >= 1000, walk: p.cat === 'photo', talk: p.cat === 'coffee', culture: p.cat === 'museum', bar: p.cat === 'night' };
    if (evenings().some((v) => ev[v])) k *= 1.2;                                      // похоже на идеальный вечер
    if (tiredOf('crowds')) {                                                           // меньше всего на слуху, но с высокой оценкой
      if ((p.pop || 0) > 20000) k *= 0.6;
      else if ((p.pop || 0) < 3000 && p.rating >= 4.7) k *= 1.15;
    }
    if (tiredOf('noise') && (p.kind === 'food_court' || (barPlace(p) || NOISE_RE.test(placeText(p))))) k *= 0.5;
    if (tiredOf('pricey')) { const r = priceRange(p); if (r && (r[0] + r[1]) / 2 > 2500) k *= 0.5; }
    if (tiredOf('outdoor')) k *= p.setting === 'outdoor' ? 0.6 : p.setting === 'indoor' ? 1.15 : 1;
    if (favCuisine(p)) k *= 1.4;                                                       // любимая кухня
    return k;
  }

  // ---------- Чему подбор научился по оценкам «Понравилось / Не моё» ----------
  // У места — признаки из данных Яндекса: сеть (одинаковое название), кухни, тип (парк, вид, фастфуд…),
  // уровень цен, категория, «улица или помещение». По оценкам для каждого признака считаем
  // «понравилось − не моё», и место получает множитель за общие признаки. Чем конкретнее признак
  // (сеть, кухня), тем сильнее он влияет; категория и «улица/помещение» — чуть-чуть
  const TASTE_W = { n: 0.5, k: 0.25, t: 0.2, $: 0.15, c: 0.1, s: 0.08 };
  const featCache = new Map();
  function placeFeatures(p) {
    let f = featCache.get(p.id);
    if (f) return f;
    const t = placeText(p);
    f = ['c:' + p.cat, 'n:' + chainKey(p)];
    if (p.setting) f.push('s:' + p.setting);
    for (const c of p.cuisine || []) f.push('k:' + norm(c));
    if (p.cat === 'food' && (p.kind === 'food_court' || FAST_RE.test(t))) f.push('t:fast');
    if (p.cat === 'photo') for (const v of ['parks', 'views', 'sights']) if (interestMatch(p, v)) f.push('t:' + v);
    if (p.cat === 'coffee' && /кондитерск|пекарн|десерт/.test(t)) f.push('t:sweet');
    if (kidsPlace(p)) f.push('t:kids');
    const r = priceRange(p);
    if (r && r[1] > 0) { const m = (r[0] + r[1]) / 2; f.push('$:' + (m >= 2500 ? 'hi' : m >= 1000 ? 'mid' : 'lo')); }
    featCache.set(p.id, f);
    return f;
  }
  let tasteMap = null; // признак → «понравилось − не моё»; null — пересчитать при следующем подборе
  function taste() {
    if (tasteMap) return tasteMap;
    tasteMap = new Map();
    for (const [id, v] of Object.entries(rates)) {
      const p = byId.get(id);
      if (p) for (const f of placeFeatures(p)) tasteMap.set(f, (tasteMap.get(f) || 0) + v);
    }
    return tasteMap;
  }
  // Множитель к оценке места по твоим оценкам (оценок нет — 1). Один признак сдвигает не больше чем
  // на свой вес (две оценки в одну сторону — уже предел), всё вместе — от 0,3 до 2,2.
  // Сеть — отдельно: «не моё» в одной точке — и другие точки этой сети заметно ниже (×0,4)
  function tasteK(p) {
    const m = taste();
    if (!m.size) return 1;
    let k = 1;
    for (const f of placeFeatures(p)) {
      const v = m.get(f);
      if (!v) continue;
      if (f[0] === 'n') k *= v < 0 ? 0.4 : 1.25;
      else k *= 1 + (TASTE_W[f[0]] * Math.max(-2, Math.min(2, v))) / 2;
    }
    return Math.max(0.3, Math.min(2.2, k));
  }
  // «Не моё» — такое место больше не предлагаем (на карте и в поиске оно остаётся)
  const disliked = (p) => rates[p.id] === -1;
  // На какое понравившееся место похоже: та же сеть, кухня или тип — для объяснения «почему это место»
  function likedLike(p) {
    const mine = new Set(placeFeatures(p).filter((f) => 'nkt'.includes(f[0])));
    let best = null, bw = 0;
    for (const [id, v] of Object.entries(rates)) {
      const q = v === 1 && id !== p.id && byId.get(id);
      if (!q) continue;
      let w = 0;
      for (const f of placeFeatures(q)) if (mine.has(f)) w = Math.max(w, TASTE_W[f[0]]);
      if (w > bw) { bw = w; best = q; }
    }
    return best;
  }
  const shortName = (s) => (s.length > 22 ? s.slice(0, 21).trim() + '…' : s);

  let prof = { step: 0, ans: {}, first: false };

  function profileSummary() {
    if (!profile) return '';
    const label = (key, v) => { const o = PROFILE_Q.find((q) => q.key === key).opts.find((x) => x.v === v); return o ? o.label.toLowerCase() : ''; };
    const parts = [];
    if ((profile.interests || []).length) parts.push('Интересы: ' + profile.interests.map((v) => label('interests', v)).join(', '));
    if (evenings().length) parts.push('идеальный вечер: ' + evenings().map((v) => label('evening', v)).join(', '));
    if ((profile.cuisines || []).length) parts.push('кухни: ' + profile.cuisines.map((v) => label('cuisines', v)).join(', '));
    if (profile.budget !== undefined) parts.push('бюджет: ' + label('budget', profile.budget));
    return parts.join(' · ');
  }

  function profileHtml() {
    const head = `<div class="sheet-handle"></div>
      <div class="place-head">
        <div class="place-title"><h2>Настроить рекомендации</h2></div>
        <div class="head-actions"><button class="icon-btn" type="button" data-prof="close" aria-label="Закрыть">${icon('close')}</button></div>
      </div>`;
    if (prof.step >= PROFILE_Q.length) {
      return head + `<p class="place-desc">Готово! Теперь «Куда сегодня?», «Собери маршрут за меня» и «Мне повезёт» учитывают твои ответы.</p>
        <p class="near-note">${esc(profileSummary())}</p>
        <button class="btn btn-primary btn-wide" type="button" data-prof="done">Отлично</button>`;
    }
    const q = PROFILE_Q[prof.step];
    const cur = prof.ans[q.key];
    const on = (o) => (q.multi ? (cur || []).includes(o.v) : cur === o.v);
    return head + (prof.step === 0 && prof.first ? '<p class="near-note">6 коротких вопросов — и подбор будет учитывать твои вкусы. Ответы хранятся только на твоём телефоне и в твоём Telegram.</p>' : '')
      + `<div class="today-dots">${PROFILE_Q.map((_, i) => `<i${i <= prof.step ? ' class="on"' : ''}></i>`).join('')}</div>
      <h3 class="today-q">${q.title} <small>${prof.step + 1} из ${PROFILE_Q.length}</small></h3>
      ${q.sub ? `<p class="near-note">${q.sub}</p>` : ''}
      <div class="today-opts">${q.opts.map((o) => `<button type="button" class="today-opt${on(o) ? ' today-opt--on' : ''}" data-prof-ans="${q.key}" data-val="${o.v}" aria-pressed="${on(o)}">
        ${emo(o.e, 'today-e')}<b>${o.label}${o.adult ? AGE_BADGE : ''}</b></button>`).join('')}</div>
      ${q.multi ? `<button class="btn btn-primary btn-wide" type="button" data-prof="next">${(cur || []).length ? 'Дальше' : 'Пропустить вопрос'}</button>` : ''}
      <div class="draft-links">${prof.step ? '<button type="button" data-prof="back">← Назад</button>' : ''}<button type="button" data-prof="skip">${profile ? 'Отмена' : 'Заполню потом'}</button></div>`;
  }

  function renderProfile() { $('#profile-sheet').innerHTML = profileHtml(); }

  function openProfile(first) {
    prof = { step: 0, ans: profile ? JSON.parse(JSON.stringify(profile)) : {}, first: !!first };
    if (typeof prof.ans.evening === 'string') prof.ans.evening = [prof.ans.evening]; // старый профиль: был один ответ
    renderProfile();
    openSheet('profile');
  }

  function profileNext() {
    prof.step++;
    if (prof.step >= PROFILE_Q.length) {
      profile = Object.assign({ interests: [], evening: [], tired: [], cuisines: [] }, prof.ans, { ts: Date.now() });
      saveProfile();
      haptic.notify('success');
    }
    renderProfile();
    $('#profile-sheet').scrollTop = 0;
  }

  function onProfileClick(e) {
    const a = e.target.closest('[data-prof-ans]');
    if (a) {
      const q = PROFILE_Q.find((x) => x.key === a.dataset.profAns);
      const o = q.opts.find((x) => String(x.v) === a.dataset.val);
      if (!q.multi && tooFast()) return; // двойное касание не отвечает на следующий вопрос
      const apply = () => {
        haptic.tap();
        if (q.multi) {
          let list = (prof.ans[q.key] || []).slice();
          if (list.includes(o.v)) list = list.filter((v) => v !== o.v);
          else list = o.exclusive ? [o.v] : list.filter((v) => !q.opts.some((x) => x.exclusive && x.v === v)).concat(o.v);
          prof.ans[q.key] = list;
          renderProfile();
        } else { prof.ans[q.key] = o.v; profileNext(); }
      };
      if (o.adult && !adultOk) askAdult().then((ok) => { openSheet('profile'); if (ok) apply(); });
      else apply();
      return;
    }
    const act = e.target.closest('[data-prof]');
    if (!act) return;
    const x = act.dataset.prof;
    if (x === 'next') { if (tooFast()) return; haptic.tap(); profileNext(); }
    else if (x === 'back') { prof.step = Math.max(0, prof.step - 1); haptic.tap(); renderProfile(); }
    else if (x === 'skip') {
      if (!profile) try { localStorage.setItem('profile_skip', '1'); } catch (err) { /* хранилище недоступно */ }
      closeSheets();
      if (!profile) toast('Настроить можно в любой момент: кубок вверху → «Настроить рекомендации»');
    }
    else if (x === 'close' || x === 'done') closeSheets();
  }

  // После знакомства — предложить настроить рекомендации (один раз; «Заполню потом» — больше не навязываем)
  function maybeProfile() {
    let skipped = false;
    try { skipped = localStorage.getItem('profile_skip') === '1'; } catch (e) { /* хранилище недоступно */ }
    if (!profile && !skipped && !openSheetName) openProfile(true);
  }

  // ---------- Знакомство при первом запуске ----------
  const ONBOARD = [
    { e: '🗺', title: 'Лучшие места Москвы на одной карте', text: 'Почти 2 000 кафе, музеев, парков и красивых мест внутри МКАД — с высокой оценкой в Яндекс Картах. Нажми на метку: часы работы, цены и как добраться.' },
    { e: '✨', title: 'Не знаешь, куда пойти?', text: 'Нажми «Куда сегодня?» над картой: несколько коротких вопросов — и подберу места с учётом погоды, часов работы и бюджета. А кубик внизу выберет место наугад.' },
    { e: '🚶', title: 'Рядом и маршруты', text: '«Рядом» покажет, что вокруг тебя. В «Маршрутах» — готовые прогулки, или собери свою из любых мест.' },
    { e: '🏅', title: 'Собирай значки', text: 'Отмечай посещённые места и оценивай их — подбор учтёт. За отметки дают значки, а в конце месяца — итоги. Любимое сохраняй в ' + emo('❤️') + '.' },
  ];
  let obIndex = 0;

  function markOnboarded() {
    try { localStorage.setItem('onboarded', '1'); } catch (e) { /* хранилище недоступно */ }
    if (supports('6.9')) tg.CloudStorage.setItem('onboarded', '1');
  }

  function showOnboardSlide(i) {
    obIndex = Math.max(0, Math.min(ONBOARD.length - 1, i));
    const ob = $('#onboard');
    ob.querySelector('.onboard-track').style.transform = `translateX(${-obIndex * 100}%)`;
    ob.querySelectorAll('.onboard-dots i').forEach((d, k) => d.classList.toggle('on', k === obIndex));
    ob.querySelector('.onboard-next').textContent = obIndex === ONBOARD.length - 1 ? 'Начать' : 'Далее';
    ob.querySelector('.onboard-skip').style.visibility = obIndex === ONBOARD.length - 1 ? 'hidden' : '';
  }

  function closeOnboard() {
    const ob = $('#onboard');
    ob.classList.remove('show');
    markOnboarded();
    setTimeout(() => { ob.hidden = true; maybeProfile(); }, 350); // после знакомства — предложить настроить рекомендации
  }

  function openOnboard() {
    const ob = $('#onboard');
    ob.querySelector('.onboard-track').innerHTML = ONBOARD.map((s) => `<div class="onboard-slide">
        <div class="onboard-art">${emo(s.e)}</div><h2>${s.title}</h2><p>${s.text}</p></div>`).join('');
    ob.querySelector('.onboard-dots').innerHTML = ONBOARD.map(() => '<i></i>').join('');
    showOnboardSlide(0);
    ob.hidden = false;
    void ob.offsetWidth;
    ob.classList.add('show');
    ob.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ob]');
      if (!b || tooFast()) return; // двойное касание «Далее» не перелистывает два экрана сразу
      haptic.tap();
      if (b.dataset.ob === 'skip' || obIndex === ONBOARD.length - 1) closeOnboard();
      else showOnboardSlide(obIndex + 1);
    });
    // листание пальцем
    let x0 = null;
    ob.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
    ob.addEventListener('touchend', (e) => {
      if (x0 === null) return;
      const dx = e.changedTouches[0].clientX - x0;
      x0 = null;
      if (Math.abs(dx) > 50) { haptic.tap(); showOnboardSlide(obIndex + (dx < 0 ? 1 : -1)); }
    });
  }

  // Показываем один раз; в Telegram помним и в облаке — на другом телефоне не покажем снова
  function maybeOnboard() {
    let done = false;
    try { done = localStorage.getItem('onboarded') === '1'; } catch (e) { /* хранилище недоступно */ }
    if (/[?&]onboard=0/.test(location.search)) return;
    if (done) { setTimeout(maybeProfile, 1200); return; } // знакомство уже было — один раз предложим анкету
    const show = () => setTimeout(() => { if (!openSheetName) openOnboard(); else markOnboarded(); }, 900);
    if (supports('6.9') && !withdrawPending) {
      tg.CloudStorage.getItem('onboarded', (err, v) => {
        if (!err && v === '1') { try { localStorage.setItem('onboarded', '1'); } catch (e) { /* хранилище недоступно */ } setTimeout(maybeProfile, 1200); return; }
        show();
      });
    } else show();
  }

  // Картинки эмодзи заранее загружаем и раскодируем, пока телефон свободен (по несколько за раз):
  // в шторках «Куда сегодня?», «Маршруты», «Достижения» они тогда появляются сразу, без мигания.
  const warmedEmoji = [];
  // Прогрев шрифта. Браузер готовит шрифт отдельно для каждого сочетания «жирность + размер»: при
  // первом показе это 1–2 мс на сочетание (на слабом телефоне — до 8), а в шторке их 5–10 — отсюда
  // заметная пауза при первом открытии карточки, профиля, маршрутов. Готовим все сочетания из
  // style.css заранее, по два за раз в свободное время. Буквы — из всех частей шрифта Nunito
  // (кириллица, латиница, знаки), иначе прогреется только одна из них. Шрифт — тот же, что у страницы
  const FONT_WARM = ('600 11.5,600 12,600 12.5,600 13.5,600 14,600 15,600 15.5,700 9.5,700 10.5,700 11.5,700 12,700 12.5,700 13,'
    + '700 13.5,700 14,700 14.5,700 15,700 16,700 24,800 10.5,800 11,800 11.5,800 12.5,800 13,800 13.5,800 14,800 14.5,800 15,'
    + '800 15.5,800 16,800 16.5,800 17,800 19,800 22,800 24,800 26,400 12,400 13,400 14.5,800 11.5 0.03em,600 10.5').split(',');
  // браузер готовит каждую букву для каждого размера — поэтому весь алфавит, цифры и знаки
  // (в две порции: на слабом телефоне весь алфавит в одном размере — около 30 мс, а порция должна быть короткой)
  const WARM_TEXT = ['АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ абвгдеёжзийклмнопрстуфхцчшщъыьэюя № «»',
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz 0123456789 ₽ — – · , . : ; ! ? ( ) / % + − ~ … ° & "'];
  const idle = window.requestIdleCallback || ((cb) => setTimeout(() => cb({ timeRemaining: () => 8 }), 60));
  function warmFonts() {
    const box = document.createElement('div');
    box.setAttribute('aria-hidden', 'true');
    box.style.cssText = 'position:fixed;left:0;top:0;width:300px;opacity:0;pointer-events:none;z-index:-1';
    document.body.appendChild(box);
    let i = 0; // порция: сочетание i >> 1, половина алфавита i & 1
    const step = () => {
      const [w, s, ls] = FONT_WARM[i >> 1].split(' ');
      const el = document.createElement('div');
      el.style.cssText = `font-weight:${w};font-size:${s}px${ls ? ';letter-spacing:' + ls : ''}`;
      el.textContent = WARM_TEXT[i & 1];
      box.appendChild(el);
      void box.offsetHeight; // раскладка сейчас, малыми порциями — а не в момент открытия шторки
      if (++i < FONT_WARM.length * 2) idle(step);
      else { box.remove(); idle(warmEmoji); }
    };
    idle(step);
  }

  function warmEmoji() {
    const codes = [...EMOJI_SET];
    let i = 0;
    const step = (dl) => {
      do {
        const img = new Image();
        img.decoding = 'async';
        img.src = `img/emoji/${codes[i++]}.svg`;
        if (img.decode) img.decode().catch(() => {});
        warmedEmoji.push(img); // держим ссылку, чтобы картинка осталась в памяти
      } while (i < codes.length && dl.timeRemaining() > 4);
      if (i < codes.length) idle(step);
    };
    idle(step);
  }

  // ---------- Заставка ----------
  const startedAt = Date.now();
  function hideSplash() {
    const wait = Math.max(0, 700 - (Date.now() - startedAt)); // заставка не дольше, чем нужно
    setTimeout(() => {
      const s = $('#splash');
      s.classList.add('hide');
      setTimeout(() => s.remove(), 600);
    }, wait);
  }

  function splashError(text) {
    $('#splash-text').textContent = text;
    $('#splash').classList.add('error');
    $('#splash-retry').hidden = false;
  }

  // ---------- Запуск ----------
  async function main() {
    initTelegram();
    applyTheme();
    document.querySelectorAll('[data-app-name]').forEach((el) => (el.textContent = cfg.APP_NAME));
    document.title = cfg.APP_NAME;
    // Согласие с документами спрашиваем сразу (поверх заставки): человек читает их, пока грузится карта
    let legalOk = null;
    const legalReady = new Promise((res) => { legalOk = res; });
    $('.legal-mark').innerHTML = emo('📍');
    ensureLegal(() => legalOk());

    refreshSeasonColl();
    buildChips();
    buildFilters();
    $('#open-filters').addEventListener('click', () => { haptic.tap(); syncFilters(); openSheet('filters'); });
    $('#lucky').addEventListener('click', lucky);
    $('#locate').addEventListener('click', locate);
    $('#theme').addEventListener('click', cycleTheme);
    $('#search-here').addEventListener('click', liveSearch);
    $('#open-search').addEventListener('click', openSearch);
    $('#search-input').addEventListener('input', renderSearch);
    $('#search-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
    $('#search-clear').addEventListener('click', () => {
      $('#search-input').value = '';
      renderSearch();
      $('#search-input').focus();
    });
    $('#open-favs').addEventListener('click', () => { haptic.tap(); renderFavs(); openSheet('favs'); });
    $('#open-awards').addEventListener('click', openAwards);
    $('#profile-sheet').addEventListener('click', onProfileClick);
    // Документы: ссылки где угодно (окно согласия, профиль) открывают их внутри приложения
    document.addEventListener('click', (e) => {
      const d = e.target.closest('[data-doc]');
      if (d) { e.preventDefault(); openDoc(d.dataset.doc); }
    });
    $('#doc-view').addEventListener('click', (e) => {
      if (e.target.closest('[data-doc-close]')) { $('#doc-view').hidden = true; return; }
      const a = e.target.closest('a[href$=".html"]');
      if (a) { e.preventDefault(); openDoc(a.getAttribute('href').replace('.html', '')); }
    });
    $('#legal').addEventListener('change', syncLegal);
    $('#legal-all').addEventListener('click', () => { document.querySelectorAll('[data-legal]').forEach((c) => { c.checked = true; }); haptic.tap(); syncLegal(); });
    $('#legal-ok').addEventListener('click', acceptLegal);
    $('#today-sheet').addEventListener('click', onTodayClick);
    $('#awards-sheet').addEventListener('click', (e) => {
      if (e.target.closest('[data-awards="close"]')) { closeSheets(); return; }
      if (e.target.closest('[data-awards="profile"]')) { haptic.tap(); openProfile(false); return; }
      if (e.target.closest('[data-awards="withdraw"]')) { withdrawConsent(); return; }
      const mon = e.target.closest('[data-month]');
      if (mon) { monthSel = +mon.dataset.month; haptic.tap(); rerenderAwards(); return; }
      const ms = e.target.closest('[data-awards="story-month"]');
      if (ms) { const t = monthStoryText(+ms.dataset.key); if (t) shareStory('month', t); return; }
      const as = e.target.closest('[data-award-story]');
      if (as) {
        const a = AWARDS.find((x) => x.id === as.dataset.awardStory);
        if (a) shareStory('award-' + a.id, `Мой новый значок «${a.title.replace(/­/g, '')}» — ${a.text.toLowerCase()}. Ищу, куда пойти в Москве`);
        return;
      }
      const rv = e.target.closest('[data-rate-v]');
      if (rv) { setRate(rv.closest('[data-rate-id]').dataset.rateId, +rv.dataset.rateV); rerenderAwards(); return; }
      const row = e.target.closest('[data-id]');
      const p = row && byId.get(row.dataset.id);
      if (p) { haptic.tap(); backScroll = $('#awards-sheet').scrollTop; openPlace(p, { focus: true }); placeBack = 'awards'; }
    });
    $('#coll-close').addEventListener('click', closeCollection);
    $('#near-tabs').innerHTML = NEAR_TABS.map((t) => `<button type="button" class="seg-btn" data-v="${t.v}">${t.label}</button>`).join('');
    $('#near-tabs').addEventListener('click', (e) => {
      const b = e.target.closest('.seg-btn');
      if (!b) return;
      const pick = () => { nearTab = b.dataset.v; haptic.tap(); renderNear(); $('#near-sheet').scrollTop = 0; };
      if (b.dataset.v === 'night' && !adultOk) {
        askAdult().then((ok) => { openSheet('near'); if (ok) pick(); });
      } else pick();
    });
    $('#open-near').addEventListener('click', openNear);
    // ----- Маршруты -----
    buildRouteFilters();
    $('#open-routes').addEventListener('click', () => openRoutes());
    $('#routes-tabs').addEventListener('click', (e) => {
      const b = e.target.closest('.seg-btn');
      if (!b) return;
      routesTab = b.dataset.v;
      haptic.tap();
      renderRoutes();
    });
    $('#routes-body').addEventListener('click', (e) => {
      const t = e.target;
      // «Собери маршрут за меня» и фильтры
      const gOpen = t.closest('[data-gen-open]'), gSet = t.closest('[data-gen]'), gTog = t.closest('[data-gen-toggle]');
      const gGo = t.closest('[data-gen-go]'), gWant = t.closest('[data-gen-want]');
      if (gOpen) { gen.open = !gen.open; haptic.tap(); renderGen(); if (gen.open && weatherStale()) loadWeather(); return; }
      if (gSet) {
        const v = gSet.dataset.val;
        gen[gSet.dataset.gen] = gSet.dataset.gen === 'budget' ? (v === 'null' ? null : +v) : v;
        saveGen(); haptic.tap(); renderGen(); return;
      }
      if (gTog) { const k = gTog.dataset.genToggle; gen[k] = !gen[k]; saveGen(); haptic.tap(); renderGen(); return; }
      if (gWant) {
        const w = gWant.dataset.genWant;
        const flip = () => {
          if (gen.want.has(w)) { if (gen.want.size === 1) { toast('Оставь хотя бы что-то одно'); return; } gen.want.delete(w); }
          else gen.want.add(w);
          saveGen(); haptic.tap(); renderGen();
        };
        if (w === 'night' && !gen.want.has(w) && !adultOk) askAdult().then((ok) => { openSheet('routes'); if (ok) flip(); });
        else flip();
        return;
      }
      if (gGo) { gGo.disabled = true; gGo.textContent = 'Собираю…'; generateRoute().finally(() => { gGo.disabled = false; gGo.textContent = 'Собрать маршрут'; }); return; }
      if (t.closest('[data-rfilters]')) { haptic.tap(); syncRouteFilters(); openSheet('rfilters'); return; }
      if (t.closest('[data-rfilters-reset]')) { Object.assign(rf, { budget: null, time: null, setting: 'any', openNow: false }); haptic.tap(); renderRoutes(); return; }
      const like = t.closest('[data-like]'), del = t.closest('[data-del]'), move = t.closest('[data-move]');
      const remove = t.closest('[data-remove]'), act = t.closest('[data-draft]'), card = t.closest('[data-route]');
      if (like) { toggleRouteLike(like.dataset.like); renderRoutes(); return; }
      if (del) {
        savedRoutes = savedRoutes.filter((r) => r.id !== del.dataset.del);
        saveRoutesData('routes_saved'); haptic.tap(); renderRoutes(); return;
      }
      if (move) {
        const [i, d] = move.dataset.move.split(':').map(Number);
        const j = i + d;
        if (j < 0 || j >= draft.length) return;
        [draft[i], draft[j]] = [draft[j], draft[i]];
        saveRoutesData('route_draft'); haptic.tap(); renderRoutes(); return;
      }
      if (remove) {
        draft.splice(+remove.dataset.remove, 1);
        saveRoutesData('route_draft'); updateDraftBadge(); haptic.tap(); renderRoutes(); return;
      }
      if (act) {
        const a = act.dataset.draft;
        if (a === 'show') showRoute(findRoute('draft'));
        else if (a === 'optimize') { optimizeDraft(); renderRoutes(); }
        else if (a === 'clear') { draft = []; saveRoutesData('route_draft'); updateDraftBadge(); haptic.tap(); renderRoutes(); }
        else if (a === 'save') {
          const ps = routePlaces(draft);
          savedRoutes.unshift({ id: 's' + Date.now().toString(36), title: `${ps[0].name} → ${ps[ps.length - 1].name}`, emoji: '📍', ids: draft.slice() });
          savedRoutes = savedRoutes.slice(0, 10);
          draft = [];
          saveRoutesData('routes_saved'); saveRoutesData('route_draft'); updateDraftBadge();
          haptic.notify('success'); toast('Маршрут сохранён'); renderRoutes();
        }
        return;
      }
      if (card) { const r = findRoute(card.dataset.route); if (r) showRoute(r); }
    });
    $('#route-sheet').addEventListener('input', (e) => {
      if (!e.target.matches('[data-rstart]') || !activeRoute) return;
      const m = START_STEPS[+e.target.value];
      if (m === (activeRoute.startIn || 0)) return;
      activeRoute.startIn = m;
      haptic.tap();
      e.target.style.setProperty('--fill', (+e.target.value / (START_STEPS.length - 1)) * 100 + '%');
      $('#start-value').textContent = startLabel(m);
      $('#route-stops').innerHTML = routeStopsHtml(activeRoute, routePlaces(activeRoute.ids));
    });
    $('#route-sheet').addEventListener('click', (e) => {
      const visit = e.target.closest('[data-visit]');
      if (visit) { toggleVisited(visit.dataset.visit); renderRouteSheet(); return; }
      if (e.target.closest('input, select, label')) return;
      const a = e.target.closest('[data-raction]');
      const stop = e.target.closest('.route-stop');
      const r = activeRoute;
      if (!r) return;
      if (a) {
        const x = a.dataset.raction;
        if (x === 'close') closeSheets();
        else if (x === 'share') shareRoute(r);
        else if (x === 'go') { haptic.impact(); openLink(routeGoUrl(routePlaces(r.ids), r.fromMe)); }
        else if (x === 'like') { toggleRouteLike(r.id); renderRouteSheet(); }
        else if (x === 'cal') {
          if (inTelegram) addToCalendar(r, 'google');
          else { const o = $('#route-sheet .cal-opts'); o.hidden = !o.hidden; haptic.tap(); if (!o.hidden) o.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
        }
        else if (x === 'cal-google') addToCalendar(r, 'google');
        else if (x === 'cal-ics') addToCalendar(r, 'ics');
        else if (x === 'story') shareStory('route', routeStoryText(r));
        else if (x === 'regen') { if (r.regen === 'today' && today.picks) { buildTodayPlan(true); todayRoute(); } else generateRoute(true); }
        else if (x === 'from-me') {
          if (r.fromMe) { r.fromMe = null; drawRouteLine(); renderRouteSheet(); return; }
          a.textContent = 'Ищу, где ты…';
          getPosition().then((pos) => {
            state.user = pos;
            MapView.setUser(pos.lat, pos.lon, userEl());
            if (activeRoute !== r) return;
            r.fromMe = pos;
            drawRouteLine(); renderRouteSheet(); haptic.tap();
          }, () => { a.textContent = 'Начать отсюда'; toast('Не получилось определить, где ты. Разреши доступ к геолокации'); });
        }
        else if (x === 'keep') {
          savedRoutes.unshift({ id: 's' + Date.now().toString(36), title: r.title, emoji: r.emoji || '🤝', ids: r.ids.slice() });
          savedRoutes = savedRoutes.slice(0, 10);
          saveRoutesData('routes_saved'); haptic.notify('success'); toast('Сохранено в «Маршруты → Мои»');
        }
        return;
      }
      if (stop) { const p = byId.get(stop.dataset.id); if (p) { haptic.tap(); openPlace(p); } }
    });
    $('#age-yes').addEventListener('click', () => answerAge(true));
    $('#age-no').addEventListener('click', () => answerAge(false));
    if (!withdrawPending) loadCloudAge();
    // Строки мест и плитки подборок в поиске и избранном
    for (const sel of ['#search-body', '#favs-sheet', '#near-list']) {
      $(sel).addEventListener('click', (e) => {
        const coll = e.target.closest('[data-coll]');
        if (coll) return openCollection(coll.dataset.coll);
        const row = e.target.closest('[data-id]');
        const p = row && byId.get(row.dataset.id);
        if (p) { haptic.tap(); openPlace(p, { focus: true }); }
      });
    }
    updateThemeButton();
    updateFavButton();
    updateDraftBadge();
    updateAwardBadge();
    // облако: подтягиваем данные с других устройств — или дочищаем его после отзыва согласия без сети
    if (withdrawPending) { if (supports('6.9')) clearCloud(); }
    else { loadCloudTheme(); loadCloudFavs(); loadCloudRoutes(); loadCloudProfile(); }
    $('#backdrop').addEventListener('click', () => closeSheets());
    $('#splash-retry').addEventListener('click', () => location.reload());
    $('#place-sheet').addEventListener('click', (e) => {
      const rb = e.target.closest('[data-rate]');
      if (rb && state.selected) { setRate(state.selected.id, +rb.dataset.rate); $('#place-sheet .rate-slot').innerHTML = rateHtml(state.selected); return; }
      const a = e.target.closest('[data-action]');
      if (!a) return;
      e.preventDefault();
      const p = state.selected;
      if (a.dataset.action === 'close') closeSheets();
      else if (a.dataset.action === 'again') lucky();
      else if (a.dataset.action === 'fav' && p) { toggleFav(p); a.outerHTML = favButtonHtml(p); }
      else if (a.dataset.action === 'share' && p) sharePlace(p);
      else if (a.dataset.action === 'add-route' && p) { toggleDraft(p); a.outerHTML = draftButtonHtml(p); }
      else if (a.dataset.action === 'visit' && p) {
        const on = !visited.has(p.id);
        const routeDone = toggleVisited(p.id);
        a.outerHTML = visitButtonHtml(p);
        const slot = $('#place-sheet .rate-slot');
        if (slot) slot.innerHTML = rateHtml(p);
        if (on && !routeDone) toast('Отмечено! Оцени ниже — подбор учтёт', '🏆');
      }
      else if (a.dataset.action === 'route' && p) { haptic.impact(); openLink(routeUrl(p)); }
      else if (a.dataset.action === 'site') openLink(a.dataset.url);
      else if (a.dataset.action === 'yandex' && p) { haptic.impact(); openLink(yandexPlaceUrl(p)); }
    });
    document.querySelectorAll('.sheet').forEach(enableSwipe);

    // Карта долго грузится (VPN, слабый интернет) — объясняем на заставке, что происходит
    const slowMap = setTimeout(() => {
      if (!$('#splash').classList.contains('error')) $('#splash-text').textContent = 'Карта грузится дольше обычного — так бывает с VPN или слабым интернетом…';
    }, 7000);
    try {
      await MapView.init($('#map'), {
        apiKey: (cfg.YANDEX_MAPS_API_KEY || '').trim(),
        center: cfg.START_CENTER,
        zoom: Math.max(cfg.START_ZOOM, maxViewZoom()),
        bounds: viewBounds(),
        minZoom: maxViewZoom(),
        dark: isDark(),
        pixelRatio: LITE ? 1.5 : 2,      // плитки карты — облегчённые
        markerRatio: LITE ? 2 : 3,       // метки и подписи — в полной чёткости экрана
      });
    } catch (e) {
      clearTimeout(slowMap);
      console.error(e);
      splashError('Не удалось загрузить карту. Проверь интернет и попробуй ещё раз.');
      return;
    }
    clearTimeout(slowMap);
    document.body.dataset.map = MapView.provider;
    // Яндекс не успел — показана запасная карта (OpenStreetMap). Говорим об этом, а не молча меняем карту
    if (MapView.provider === 'leaflet' && (cfg.YANDEX_MAPS_API_KEY || '').trim()) {
      setTimeout(() => toast('Яндекс Карты не успели загрузиться — часто так бывает из-за VPN или слабого интернета. Пока показана запасная карта. Чтобы вернуть Яндекс, закрой и снова открой приложение (лучше без VPN)', null, 9000), 1200);
    }
    // Экран поменял размер (поворот, Telegram развернул окно) — пересчитываем предел отдаления
    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        try { curBounds = viewBounds(state.view && state.view.zoom); MapView.setBounds(curBounds); MapView.setMinZoom(maxViewZoom()); } catch (e) { /* карта ещё не готова */ }
      }, 300);
    });
    MapView.onMove(onMove);
    onMove(MapView.view()); // здесь же и первая расстановка меток
    hideSplash();
    // Ссылка от друга (startapp=p-<id>) — сразу открываем это место.
    // Кнопка «🎲 Мне повезёт» в боте открывает приложение с ?lucky=1 — сразу выбираем место
    const districtsReady = loadDistrictPlaces().then(() => {
      tasteMap = null; // оценки мест по районам теперь тоже учитываются
      refreshSeasonColl();
      render(); syncFilters(); updateFavButton(); updateDraftBadge(); updateAwardBadge(); warmSearchIndex();
      // время и цену готовых маршрутов считаем заранее, в паузе, — «Маршруты» открываются быстрее
      (window.requestIdleCallback || setTimeout)(() => READY_ROUTES.forEach((r) => { const ps = routePlaces(r.ids); if (ps.length > 1) routeStats(ps, null, r); }));
      idle(warmFonts); // потом эмодзи
    });
    const sp = startParam();
    if (sp.startsWith('r-') || sp.startsWith('m-')) {
      // ссылка на маршрут от друга
      districtsReady.then(() => {
        const r = routeFromCode(sp);
        if (r) setTimeout(() => showRoute(r), 300);
        else toast('Маршрут по ссылке не найден');
      });
    } else if (sp.startsWith('p-')) {
      districtsReady.then(() => {
        const shared = byId.get(sp.slice(2));
        if (!shared) return;
        const open = () => setTimeout(() => openPlace(shared, { focus: true }), 300);
        if (shared.cat === 'night') askAdult().then((ok) => ok && open());
        else open();
      });
    } else if (sp === 'lucky' || new URLSearchParams(location.search).get('lucky') === '1') {
      districtsReady.then(() => setTimeout(lucky, 900));
    } else if (sp === 'routes' || new URLSearchParams(location.search).get('routes') === '1') {
      // кнопка «🚶 Маршруты» в приветствии бота — сразу открываем список маршрутов
      districtsReady.then(() => setTimeout(() => openRoutes('ready'), 400));
    }
    // Сначала — согласие с документами (для всех, и по ссылкам от друзей тоже); потом знакомство и анкета —
    // только для тех, кто открыл приложение сам
    const deepLink = !!sp || /[?&](lucky|routes)=1/.test(location.search);
    legalReady.then(() => { if (!deepLink) maybeOnboard(); });
    loadWeather();
    // вернулись в приложение спустя время — обновим погоду на кнопке «Куда сегодня?»
    document.addEventListener('visibilitychange', () => { if (!document.hidden && weatherStale()) loadWeather(); });
  }

  main();
})();
