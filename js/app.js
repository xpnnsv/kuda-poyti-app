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
  const catLabel = (p) => (p.kind === 'food_court' ? 'Фудкорт' : p.kind === 'mall' ? 'Торговый центр' : CATS[p.cat].label);
  // Сколько названий показывать в списках «Где поесть» / «Развлечения»
  const LIST_LIMIT = 12;
  // Ползунок бюджета: шаги неравномерные — как люди думают о деньгах; последний шаг — «любой»
  const BUDGET_STOPS = [0, 300, 500, 800, 1000, 1500, 2000, 3000, 5000, null];
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
  function minPrice(p) {
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
  function toast(text) {
    const t = $('#toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
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
    const el = markerEls.get(p.id);
    if (el) el.classList.toggle('mk--fav', on);
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
    if (supports('6.1')) tg.BackButton.onClick(() => closeSheets());
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
    if (/парк|сквер|достопримечательн|смотров|набережн|памятник/.test(s)) return 'photo';
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

  function userEl() {
    const el = document.createElement('div');
    el.className = 'me';
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

  function layout(places, view) {
    const { w, h } = getMapSize();
    const b = view.bounds;
    const mN = merc(b.north), mS = merc(b.south);
    const far = view.zoom < 13.5;
    const R = far ? 13 : 19;                 // радиус метки, px
    const GAP = far ? 32 : 46;               // минимальное расстояние между центрами меток, px
    const MAX_MARKERS = LOW_END ? 45 : 70;   // больше меток телефону рисовать тяжело
    const MAX_LABELS = LOW_END ? 18 : 30;
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
    const items = shown.map((s) => {
      const el = markerEl(s.p);
      el.classList.toggle('mk--label', s.label);
      // в маршруте у меток номера остановок
      const n = state.route ? state.route.indexOf(s.p.id) + 1 : 0;
      el.classList.toggle('mk--route', n > 0);
      if (n) el.dataset.num = n;
      return { id: s.p.id, lat: s.p.lat, lon: s.p.lon, el, z: s.selected ? 1000 : Math.min(999, Math.round(Math.log10((s.p.pop || 0) + 1) * 100)) };
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
      document.querySelectorAll('.sheet.open').forEach((s) => s.classList.remove('open'));
      $(`#${name}-sheet`).classList.add('open');
      $(`#${name}-sheet`).scrollTop = 0;
      openSheetName = name;
    }
    $('#backdrop').classList.add('show');
    $('#backdrop').classList.toggle('backdrop--light', name === 'place' || name === 'route');
    document.body.classList.add('sheet-open');
    if (supports('6.1')) tg.BackButton.show();
  }

  function closeSheets() {
    document.querySelectorAll('.sheet.open').forEach((s) => {
      s.classList.remove('open');
      s.style.transform = '';
    });
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
  }

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
        ${visited.has(p.id) ? '<span class="tag tag--open">✓ Ты здесь был</span>' : ''}
      </div>
      ${p.desc ? `<p class="place-desc">${esc(p.desc)}</p>` : ''}
      ${insideHtml(p)}
      ${infoHtml(p, todayHours, site)}
      <button class="ya-link" data-action="yandex">
        <span class="ya-star">★</span>
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
    return `<button class="btn btn-secondary" data-action="add-route">${inDraft ? '✓ В маршруте' : `${icon('plus')} В маршрут`}</button>`;
  }

  function openPlace(p, opts) {
    opts = opts || {};
    state.selected = p;
    state.lucky = !!opts.lucky;
    $('#place-sheet').innerHTML = placeHtml(p);
    openSheet('place');
    render();

    // Сдвигаем карту так, чтобы место было видно над карточкой
    const current = state.view ? state.view.zoom : cfg.START_ZOOM;
    const zoom = opts.lucky || opts.focus ? Math.max(current, 15) : current;
    const degPerPx = (1.40625 * Math.cos((p.lat * Math.PI) / 180)) / Math.pow(2, zoom);
    MapView.flyTo(p.lat - window.innerHeight * 0.2 * degPerPx, p.lon, zoom);
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
    const pool = narrow(allPlaces().filter((p) => matches(p) && (p.cat !== 'night' || state.cats.has('night'))));
    if (!pool.length) {
      haptic.notify('error');
      toast('Под такие фильтры ничего нет — попробуй их смягчить');
      return;
    }
    const pick = pool[Math.floor(Math.random() * pool.length)];
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
      <span class="row-text"><b>${q ? highlight(p.name, q) : esc(p.name)}</b><small>${p.rating ? `<span class="row-rating">★ ${p.rating.toFixed(1).replace('.', ',')}</span> · ` : ''}${esc(catLabel(p))}${sub ? ' · ' + esc(sub) : ''}${state.budget !== null && priceUnknown(p) ? ' · <span class="row-unknown">чек неизвестен</span>' : ''}</small></span>
      ${st === 'unknown' ? '' : `<span class="row-state row-state--${st}">${st === 'open' ? 'Открыто' : 'Закрыто'}</span>`}
    </button>`;
  }

  const collTileHtml = (c) => `<button class="coll" type="button" data-coll="${c.id}">
      <span class="coll-emoji">${c.emoji}</span><b>${esc(c.title)}</b><small>${c.set.size} ${plural(c.set.size, 'место', 'места', 'мест')}</small>
    </button>`;

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

  function renderNear() {
    document.querySelectorAll('#near-tabs .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.v === nearTab));
    if (!nearFrom) return;
    const list = curated
      .filter((p) => (nearTab === 'all' ? p.cat !== 'night' : p.cat === nearTab) && passesFilters(p))
      .map((p) => ({ p, d: distance(nearFrom, p) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 20);
    $('#near-note').textContent = nearFrom.me ? '' : 'Не получилось узнать, где ты, — показываю места рядом с центром карты';
    $('#near-list').innerHTML = list.length
      ? list.map(({ p, d }) => rowHtml(p, null, distanceText(d))).join('')
      : '<p class="empty">Под твои фильтры рядом ничего нет — попробуй их смягчить.</p>';
  }

  async function openNear() {
    haptic.tap();
    $('#near-list').innerHTML = '<p class="empty">Ищу, где ты…</p>';
    $('#near-note').textContent = '';
    nearFrom = null;
    renderNear();
    openSheet('near');
    try {
      const pos = state.user || (await getPosition());
      state.user = pos;
      MapView.setUser(pos.lat, pos.lon, userEl());
      const b = cfg.MAP_BOUNDS;
      const inMoscow = pos.lat > b.south && pos.lat < b.north && pos.lon > b.west && pos.lon < b.east;
      nearFrom = inMoscow ? { lat: pos.lat, lon: pos.lon, me: true } : null;
    } catch (e) { /* нет доступа к геолокации */ }
    if (!nearFrom) {
      const v = state.view.bounds;
      nearFrom = { lat: (v.north + v.south) / 2, lon: (v.east + v.west) / 2, me: false };
    }
    renderNear();
  }

  // ---------- Маршруты ----------
  // Готовые маршруты (routes.js) и свой: «＋ В маршрут» в карточке места. Время = дорога пешком + время в местах.
  // Лайки и сохранённые маршруты пока хранятся у пользователя (телефон + облако Telegram); общий счётчик — на сервере позже.
  const ROUTE_MAX = 10;
  const WALK_M_PER_MIN = 70; // прогулочный шаг, ~4,2 км/ч
  // Сезон по московскому месяцу: сезонные маршруты видны только в своё время года
  const SEASON = (() => {
    const m = +new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', month: 'numeric' }).format(new Date());
    return m === 12 || m <= 2 ? 'winter' : m <= 5 ? 'spring' : m <= 8 ? 'summer' : 'autumn';
  })();
  const SEASON_LABEL = { winter: 'Зима', spring: 'Весна', summer: 'Лето', autumn: 'Осень' };
  const inSeason = (r) => !r.season || r.season === SEASON;

  // Сколько обычно проводят в месте (мин): зависит от типа и «размера» места
  function stayFor(p, r) {
    if (r && r.stay && r.stay[p.id]) return r.stay[p.id]; // у готового маршрута может быть своё время (короткая прогулка)
    const desc = (p.desc || '') + ' ' + p.name;
    switch (p.cat) {
      case 'coffee': return 25;
      case 'food': {
        if (/Быстрое питание|Столовая|Шаурма|Пекарня/i.test(desc)) return 40;
        const lo = priceRange(p);
        return lo && lo[0] >= 2000 ? 90 : 60;
      }
      case 'museum': return p.pop >= 40000 ? 120 : p.pop >= 15000 ? 90 : 60; // Третьяковка — 2 ч, Булгаков — 1 ч
      case 'photo': return p.pop >= 50000 || /парк|сад|усадьб|заповедник|ВДНХ|Выставка/i.test(desc) && p.pop >= 15000 ? 60 : 30;
      case 'mall': return p.kind === 'food_court' ? 45 : 60;
      case 'night': return 60;
      default: return 40;
    }
  }
  const stayText = (m) => (m >= 60 ? `${String(m / 60).replace('.', ',')} ч` : `${m} мин`);

  // Цена на человека «от–до» по данным Яндекса: [от, до] или null, если неизвестна
  function priceRange(p) {
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
    tg.CloudStorage.getItems(['route_draft', 'routes_saved', 'routes_liked', 'visited', 'routes_done'], (err, v) => {
      if (err || !v) return;
      const parse = (s) => { try { return JSON.parse(s); } catch (e) { return null; } };
      const d = parse(v.route_draft), s = parse(v.routes_saved), l = parse(v.routes_liked);
      const vis = parse(v.visited), done = parse(v.routes_done);
      if (Array.isArray(d)) draft = d;
      if (Array.isArray(s)) savedRoutes = s;
      if (Array.isArray(l)) { likedRoutes.clear(); l.forEach((id) => likedRoutes.add(id)); }
      if (Array.isArray(vis)) vis.forEach((id) => visited.add(id));
      if (Array.isArray(done)) routesDone = done;
      updateDraftBadge();
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

  function routeStats(ps, from, route) {
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
        <span class="route-emoji">${r.emoji || '🚶'}</span>
        <div class="route-title"><b>${esc(r.title)}${r.adult ? AGE_BADGE : ''}${r.season ? `<span class="season-badge">${SEASON_LABEL[r.season]}</span>` : ''}</b>
          <small>${durText(st.total)} · ${kmText(st.km)} пешком · ${placesWord(ps.length)}</small>
          <small class="route-price">${routePriceText(st)}${done ? ' · <span class="route-done">✓ пройден</span>' : ''}</small></div>
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
        <p>Открой место на карте и нажми «＋ В маршрут». Добавь 2–${ROUTE_MAX} мест — я посчитаю время и расстояние, а Яндекс Карты проведут по ним.</p></div>`;
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
    drawRouteLine();
    renderRouteSheet();
    openSheet('route');
    render();
    fitPlaces(activeRoute.fromMe ? [activeRoute.fromMe].concat(ps) : ps, Math.round(window.innerHeight * 0.45));
  }

  // ---------- «Когда идёшь?» ----------
  // Время по Москве: «сегодня в 19:00» считаем от московской даты, где бы ни был телефон (Москва — UTC+3)
  const mskParts = (d) => {
    const p = {};
    for (const x of new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', hourCycle: 'h23' }).formatToParts(d)) p[x.type] = x.value;
    return p;
  };
  const clock = (d) => new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' }).format(d);

  // «Выхожу через …» — ползунок: шаги в минутах от «сейчас» до суток
  const START_STEPS = [0, 15, 30, 45, 60, 90].concat(Array.from({ length: 23 }, (_, i) => (i + 2) * 60)); // дальше — каждый час до суток
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
  function saveVisited() {
    const v = JSON.stringify([...visited].slice(-300)), d = JSON.stringify(routesDone.slice(-50));
    try { localStorage.setItem('visited', v); localStorage.setItem('routes_done', d); } catch (e) { /* хранилище недоступно */ }
    if (supports('6.9')) { if (v.length < 4000) tg.CloudStorage.setItem('visited', v); if (d.length < 4000) tg.CloudStorage.setItem('routes_done', d); }
  }

  function toggleVisited(id) {
    if (visited.has(id)) visited.delete(id); else visited.add(id);
    haptic.tap();
    const r = activeRoute;
    if (r && r.ids.every((x) => visited.has(x)) && !routesDone.some((d) => d.id === r.id && Date.now() - d.ts < 12 * 3600000)) {
      routesDone.push({ id: r.id, title: r.title, ts: Date.now() });
      haptic.notify('success');
      const n = routesDone.length;
      toast(`Маршрут пройден! Это твой ${n}-й маршрут 🎉`);
    }
    saveVisited();
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
        <button class="stop-check${been ? ' is-on' : ''}" type="button" data-visit="${esc(p.id)}" aria-pressed="${been}" aria-label="Был здесь">✓</button>
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
          <h2>${r.emoji ? r.emoji + ' ' : ''}${esc(r.title)}</h2>
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
        <div class="budget-scale"><span>Сейчас</span><span>Через сутки</span></div>
      </div>
      <ol class="route-stops" id="route-stops">${stops}</ol>
      ${doneCount ? `<p class="route-progress">Отмечено ${doneCount} из ${r.ids.length}${doneCount === r.ids.length ? ' — маршрут пройден 🎉' : ''}</p>` : ''}
      <div class="draft-links"><button type="button" data-raction="from-me">${r.fromMe ? 'Начать с первого места' : 'Начать отсюда'}</button></div>
      <p class="place-note">Время — примерное: дорога пешком и сколько обычно проводят в таком месте.</p>
      <div class="place-actions">
        <button class="btn btn-primary" type="button" data-raction="go">Идти — Яндекс Карты</button>
        ${r.shared || r.gen ? '<button class="btn btn-secondary" type="button" data-raction="keep">Сохранить</button>' : ''}
      </div>
      ${r.gen ? `<button class="btn btn-secondary btn-wide" type="button" data-raction="regen">${icon('dice')} Ещё вариант</button>` : ''}`;
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

  // «＋ В маршрут» в карточке места
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

  // ---------- «Собери маршрут за меня» ----------
  // Цепочка «кофе → прогулка → еда» из хороших мест рядом: каждое следующее — недалеко от предыдущего,
  // укладывается в бюджет и будет открыто, когда до него дойдёшь.
  const GEN_DUR = [
    { v: 'short', label: '1–2 ч', max: 130, steps: ['coffee', 'photo'] },
    { v: 'mid', label: '2–3 ч', max: 200, steps: ['coffee', 'photo', 'food'] },
    { v: 'long', label: 'Полдня', max: 330, steps: ['coffee', 'photo', 'photo', 'food'] },
  ];
  const GEN_BUDGET = [
    { v: 0, label: 'Бесплатно' },
    { v: 1000, label: 'до 1 000 ₽' },
    { v: 2500, label: 'до 2 500 ₽' },
    { v: null, label: 'Любой' },
  ];
  const gen = { dur: 'mid', budget: 2500, museum: false, rain: false, bar: false, open: false };

  function genStepsFor() {
    let steps = GEN_DUR.find((d) => d.v === gen.dur).steps.slice();
    if (gen.rain) steps = steps.map((c) => (c === 'photo' ? 'museum' : c)); // в дождь — вместо прогулки музей
    else if (gen.museum) { const i = steps.indexOf('photo'); if (i >= 0) steps[i] = 'museum'; else steps.splice(1, 0, 'museum'); }
    if (gen.budget === 0) steps = steps.map((c) => (c === 'coffee' || c === 'food' ? 'photo' : c)); // бесплатно — только прогулки и бесплатные музеи
    if (gen.bar && adultOk) steps.push('night');
    return steps;
  }

  async function generateRoute() {
    haptic.impact();
    let from = null, me = false;
    try {
      const pos = state.user || (await Promise.race([getPosition(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 6000))]));
      const b = cfg.MAP_BOUNDS;
      if (pos.lat > b.south && pos.lat < b.north && pos.lon > b.west && pos.lon < b.east) { from = pos; me = true; state.user = pos; MapView.setUser(pos.lat, pos.lon, userEl()); }
    } catch (e) { /* без геолокации — от центра карты */ }
    if (!from) { const v = state.view.bounds; from = { lat: (v.north + v.south) / 2, lon: (v.east + v.west) / 2 }; }

    const steps = genStepsFor();
    const max = GEN_DUR.find((d) => d.v === gen.dur).max + (gen.bar ? 60 : 0);
    const used = new Set(), ids = [], skipped = [];
    let cur = from, clock = new Date(), spent = 0, total = 0;
    for (const cat of steps) {
      let pick = null;
      for (const radius of [900, 1600, 2600]) {
        const cands = curated.filter((p) => {
          if (p.cat !== cat || used.has(p.id) || (p.rating && p.rating < 4.4)) return false;
          if (cat === 'night' && !adultOk) return false;
          const d = distance(cur, p);
          if (d > radius) return false;
          const r = priceRange(p);
          if (gen.budget !== null && (!r || spent + (r[0] + r[1]) / 2 > gen.budget)) return false; // по середине вилки цен
          const arrive = new Date(clock.getTime() + (ids.length || me ? legMin(cur, p) : 0) * 60000);
          const left = Hours.minutesLeft(p.hours, arrive);
          return left === null ? cat === 'photo' : left >= stayFor(p) * 0.7; // успеть побыть хотя бы 70% времени
        });
        if (cands.length) {
          // из лучших вариантов — случайный, чтобы «Ещё вариант» давал новый маршрут
          const score = (p) => Math.sqrt(p.pop || 1) * (p.rating >= 4.8 ? 1.3 : 1) / (1 + distance(cur, p) / 600);
          const top = cands.sort((a, b) => score(b) - score(a)).slice(0, 6);
          pick = top[Math.floor(Math.random() * top.length)];
          break;
        }
      }
      if (!pick) { skipped.push(cat); continue; }
      const leg = ids.length || me ? legMin(cur, pick) : 0;
      if (total + leg + stayFor(pick) > max && ids.length >= 2) break;
      ids.push(pick.id); used.add(pick.id);
      const r = priceRange(pick); if (r) spent += (r[0] + r[1]) / 2;
      total += leg + stayFor(pick);
      clock = new Date(clock.getTime() + (leg + stayFor(pick)) * 60000);
      cur = pick;
    }
    if (ids.length < 2) { toast('Рядом не нашлось подходящих мест — сдвинь карту или смягчи условия'); return; }
    const names = { coffee: 'кофе', photo: 'прогулка', food: 'еда', museum: 'музей', night: 'бар' };
    const title = ids.map((id) => names[byId.get(id).cat]).join(' → ');
    showRoute({ id: 'gen', title: title[0].toUpperCase() + title.slice(1), emoji: '✨', ids, gen: true, fromMe: me ? from : null });
    const why = { museum: 'Музеи', coffee: 'Кофейни', food: 'Места с едой', night: 'Бары', photo: 'Парки и красивые места' };
    const miss = [...new Set(skipped)].filter((c) => !ids.some((id) => byId.get(id).cat === c));
    if (miss.length) toast(`${miss.map((c) => why[c]).join(' и ')} рядом сейчас закрыты или не по бюджету — собрал без них`);
  }

  function genFormHtml() {
    const seg = (list, key) => list.map((o) => `<button type="button" class="seg-btn${gen[key] === o.v ? ' active' : ''}" data-gen="${key}" data-val="${o.v}">${o.label}</button>`).join('');
    const tog = (key, label) => `<button type="button" class="seg-btn${gen[key] ? ' active' : ''}" data-gen-toggle="${key}">${label}</button>`;
    return `<div class="gen${gen.open ? ' gen--open' : ''}">
      <button type="button" class="gen-head" data-gen-open>
        <span class="route-emoji">✨</span>
        <span class="route-title"><b>Собери маршрут за меня</b><small>Кофе, прогулка и еда рядом — под твоё время и бюджет</small></span>
        <span class="ya-arrow">${gen.open ? '−' : '+'}</span>
      </button>
      ${gen.open ? `<div class="gen-body">
        <div class="f-label">Сколько времени</div><div class="seg">${seg(GEN_DUR, 'dur')}</div>
        <div class="f-label">Бюджет на человека</div><div class="seg">${seg(GEN_BUDGET, 'budget')}</div>
        <div class="f-label">Ещё</div><div class="seg">${tog('museum', 'С музеем')}${tog('rain', 'Если дождь')}${tog('bar', 'Закончить в баре 18+')}</div>
        <button type="button" class="btn btn-primary btn-wide" data-gen-go>Собрать маршрут</button>
        <p class="f-note">Начнём от тебя (если разрешишь геолокацию) или от центра карты.</p>
      </div>` : ''}
    </div>`;
  }

  // ---------- Фильтры маршрутов (шторка как у карты) ----------
  const RF_BUDGET = [0, 500, 1000, 1500, 2000, 3000, 5000, null];
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
    $('#coll-title').textContent = `${c.emoji} ${c.title} · ${c.set.size} ${plural(c.set.size, 'место', 'места', 'мест')}`;
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
    const el = $('#map');
    const top = 150; // поиск и чипсы
    const W = el.clientWidth - 60, H = Math.max(120, el.clientHeight - top - bottom - 40);
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
    const v = cfg.MAX_VIEW, el = $('#map');
    if (!v) return cfg.MIN_ZOOM || 9;
    const W = el.clientWidth || window.innerWidth, H = el.clientHeight || window.innerHeight;
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
    box.innerHTML = list.map((c) =>
      `<button type="button" class="chip cat--${c.id}" data-cat="${c.id}">${icon(c.id)}${c.label}${c.adult ? AGE_BADGE : ''}</button>`
    ).join('');
    box.addEventListener('click', (e) => {
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
    document.querySelectorAll('.chip').forEach((b) => {
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
      const gGo = t.closest('[data-gen-go]');
      if (gOpen) { gen.open = !gen.open; haptic.tap(); renderRoutes(); return; }
      if (gSet) {
        const v = gSet.dataset.val;
        gen[gSet.dataset.gen] = gSet.dataset.gen === 'budget' ? (v === 'null' ? null : +v) : v;
        haptic.tap(); renderRoutes(); return;
      }
      if (gTog) {
        const k = gTog.dataset.genToggle;
        const flip = () => { gen[k] = !gen[k]; if (k === 'rain' && gen.rain) gen.museum = false; if (k === 'museum' && gen.museum) gen.rain = false; haptic.tap(); renderRoutes(); };
        if (k === 'bar' && !gen.bar && !adultOk) askAdult().then((ok) => { openSheet('routes'); if (ok) flip(); });
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
        else if (x === 'regen') generateRoute();
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
    loadCloudAge();
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
    loadCloudTheme();
    loadCloudFavs();
    loadCloudRoutes();
    $('#backdrop').addEventListener('click', () => closeSheets());
    $('#splash-retry').addEventListener('click', () => location.reload());
    $('#place-sheet').addEventListener('click', (e) => {
      const a = e.target.closest('[data-action]');
      if (!a) return;
      e.preventDefault();
      const p = state.selected;
      if (a.dataset.action === 'close') closeSheets();
      else if (a.dataset.action === 'again') lucky();
      else if (a.dataset.action === 'fav' && p) { toggleFav(p); a.outerHTML = favButtonHtml(p); }
      else if (a.dataset.action === 'share' && p) sharePlace(p);
      else if (a.dataset.action === 'add-route' && p) { toggleDraft(p); a.outerHTML = draftButtonHtml(p); }
      else if (a.dataset.action === 'route' && p) { haptic.impact(); openLink(routeUrl(p)); }
      else if (a.dataset.action === 'site') openLink(a.dataset.url);
      else if (a.dataset.action === 'yandex' && p) { haptic.impact(); openLink(yandexPlaceUrl(p)); }
    });
    document.querySelectorAll('.sheet').forEach(enableSwipe);

    try {
      await MapView.init($('#map'), {
        apiKey: (cfg.YANDEX_MAPS_API_KEY || '').trim(),
        center: cfg.START_CENTER,
        zoom: Math.max(cfg.START_ZOOM, maxViewZoom()),
        bounds: viewBounds(),
        minZoom: maxViewZoom(),
        dark: isDark(),
      });
    } catch (e) {
      console.error(e);
      splashError('Не удалось загрузить карту. Проверь интернет и попробуй ещё раз.');
      return;
    }
    document.body.dataset.map = MapView.provider;
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
    const districtsReady = loadDistrictPlaces().then(() => { render(); syncFilters(); updateFavButton(); updateDraftBadge(); warmSearchIndex(); });
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
  }

  main();
})();
