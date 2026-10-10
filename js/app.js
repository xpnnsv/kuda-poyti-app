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
  };
  // Иконка из набора в app.html (<symbol id="i-…">)
  const icon = (name, cls) => `<svg class="ic${cls ? ' ' + cls : ''}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const catLabel = (p) => (p.kind === 'food_court' ? 'Фудкорт' : p.kind === 'mall' ? 'Торговый центр' : CATS[p.cat].label);
  // Сколько названий показывать в списках «Где поесть» / «Развлечения»
  const LIST_LIMIT = 12;
  const BUDGETS = [
    { v: null, label: 'Любой' },
    { v: 0, label: 'Бесплатно' },
    { v: 500, label: 'до 500 ₽' },
    { v: 1500, label: 'до 1 500 ₽' },
    { v: 3000, label: 'до 3 000 ₽' },
  ];
  const SETTINGS = [
    { v: 'any', label: 'Неважно' },
    { v: 'outdoor', label: 'На улице' },
    { v: 'indoor', label: 'В помещении' },
  ];
  const SETTING_TEXT = { outdoor: 'На улице', indoor: 'В помещении', both: 'Улица и помещение' };

  const state = {
    cat: 'all',
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
    if (p.metro) return 'Вход по билету на метро';
    return 'Цена — в Яндекс Картах';
  }

  // Минимальная цена для фильтра «Бюджет»: «600–800 ₽» → 600, «от 499 ₽» → 499, «до 2000 ₽» → 2000.
  // null — цена неизвестна, такое место при включённом фильтре бюджета не показываем.
  function minPrice(p) {
    if (p.free || p.kind === 'mall') return 0;
    const s = p.bill || p.tickets || p.cup;
    if (s) {
      const n = parseInt(s.replace(/\s/g, '').match(/\d+/), 10);
      return Number.isFinite(n) ? n : null;
    }
    if (p.metro) return 100;
    return null;
  }

  // Оценка из Яндекс Карт: «4,8 · 624 оценки»
  function ratingText(p) {
    const r = p.rating.toFixed(1).replace('.', ',');
    return p.pop ? `${r} · ${p.pop.toLocaleString('ru-RU')} ${plural(p.pop, 'оценка', 'оценки', 'оценок')}` : r;
  }

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
    if (state.collection && !state.collection.set.has(p.id)) return false;
    if (state.cat !== 'all' && p.cat !== state.cat) return false;
    return passesFilters(p);
  }

  // Только фильтры из шторки «Фильтры» (без категории и подборки)
  function passesFilters(p) {
    if (state.budget !== null) {
      const m = minPrice(p);
      if (m === null || m > state.budget) return false;
    }
    if (state.setting !== 'any' && p.setting !== state.setting && p.setting !== 'both') return false;
    if (state.openNow && Hours.status(p.hours).state !== 'open') return false;
    return true;
  }

  // Места, найденные живым поиском Яндекса (кнопка «Найти здесь»)
  let livePlaces = [];
  const allPlaces = () => curated.concat(livePlaces);
  const allMatches = () => allPlaces().filter(matches);

  // ---------- Живой поиск: «API поиска по организациям» Яндекса ----------
  // Ищет в видимой части карты по выбранной категории. Результаты не сохраняются — только показываются.
  const LIVE_QUERY = { all: 'кафе', coffee: 'кофейня', food: 'ресторан', museum: 'музей', photo: 'достопримечательность', mall: 'торговый центр' };
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
      text: LIVE_QUERY[state.cat] || 'кафе',
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
          cat: catFromYandex(cats, state.cat),
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
  const CAT_WEIGHT = { photo: 2.5, museum: 2, coffee: 1.5, food: 1, mall: 0.5 };
  const priority = (p) => (p.pop || 0) * (CAT_WEIGHT[p.cat] || 1);
  // Порог важности по масштабу: издалека — только самые известные места, с 14-го масштаба — всё
  const minPriority = (z) => (z < 10.5 ? 100000 : z < 11.5 ? 40000 : z < 12.5 ? 15000 : z < 13.5 ? 5000 : 0);

  function layout(places, view) {
    const mapEl = $('#map');
    const w = mapEl.clientWidth || window.innerWidth, h = mapEl.clientHeight || window.innerHeight;
    const b = view.bounds;
    const mN = merc(b.north), mS = merc(b.south);
    const far = view.zoom < 13.5;
    const R = far ? 13 : 19;                 // радиус метки, px
    const GAP = far ? 32 : 46;               // минимальное расстояние между центрами меток, px
    const MAX_MARKERS = 70;                  // больше меток телефону рисовать тяжело
    const MAX_LABELS = 30;
    const sel = state.selected;

    const pts = [];
    for (const p of places) {
      const x = ((p.lon - b.west) / (b.east - b.west)) * w;
      const y = ((mN - merc(p.lat)) / (mN - mS)) * h;
      // считаем и чуть за краем экрана (четверть), чтобы при сдвиге карты метки не «выпрыгивали»
      if (x < -w / 4 || x > w * 1.25 || y < -h / 4 || y > h * 1.25) continue;
      const selected = !!sel && sel.id === p.id;
      pts.push({ p, x, y, selected, inView: x >= 0 && x <= w && y >= 0 && y <= h, prio: selected ? Infinity : priority(p) });
    }
    pts.sort((a, c) => (c.inView - a.inView) || (c.prio - a.prio));

    // Порог — только в режиме «Все»: если выбрана категория, показываем её места сразу (без наложений)
    const minP = state.cat === 'all' && !state.collection ? minPriority(view.zoom) : 0;
    // В подборке мест немного — показываем их все, даже если метки накладываются (например, башни Сити)
    const gap = state.collection ? 0 : GAP;
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
      return { id: s.p.id, lat: s.p.lat, lon: s.p.lon, el, z: s.selected ? 1000 : Math.min(999, Math.round(Math.log10((s.p.pop || 0) + 1) * 100)) };
    });
    for (const [id, el] of markerEls) el.classList.toggle('mk--active', !!sel && sel.id === id);
    MapView.setMarkers(items);
    updatePill(places.length, inView, shownInView);
  }

  function updatePill(total, inView, shownInView) {
    const pill = $('#pill');
    pill.classList.toggle('pill--warn', total === 0);
    if (total === 0) pill.textContent = 'Ничего не нашлось — попробуй смягчить фильтры';
    else if (state.collection && inView < total) pill.textContent = `Здесь ${inView} из ${total} · отдали карту, чтобы увидеть все`;
    else if (shownInView < inView) pill.textContent = `${shownInView} из ${inView} · приблизь — покажу больше`;
    else pill.textContent = `${inView} ${plural(inView, 'место', 'места', 'мест')} здесь`;
  }

  // После движения карты — новая раскладка меток под масштаб
  function onMove(view) {
    state.view = view;
    const map = $('#map');
    map.classList.toggle('zoom-far', view.zoom < 13.5);
    updateSearchHere();
    render(); // раскладка меток под новый масштаб — быстро (около 1 мс на 250 мест)
  }

  // ---------- Шторки ----------
  let openSheetName = null;

  function openSheet(name) {
    if (openSheetName !== name) {
      document.querySelectorAll('.sheet.open').forEach((s) => s.classList.remove('open'));
      $(`#${name}-sheet`).classList.add('open');
      $(`#${name}-sheet`).scrollTop = 0;
      openSheetName = name;
    }
    $('#backdrop').classList.add('show');
    $('#backdrop').classList.toggle('backdrop--light', name === 'place');
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
    if (openSheetName === 'place') {
      state.selected = null;
      state.lucky = false;
      render();
    }
    openSheetName = null;
    if (supports('6.1')) tg.BackButton.hide();
  }

  // Закрытие шторки свайпом вниз
  function enableSwipe(sheet) {
    let startY = null, dy = 0;
    sheet.addEventListener('touchstart', (e) => {
      if (sheet.scrollTop > 0) return;
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
          <div class="place-cat cat--${p.cat}">${icon(p.cat)}${catLabel(p)}</div>
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
        <span class="tag">${priceText(p)}</span>
        <span class="tag">${SETTING_TEXT[p.setting] || ''}</span>
        ${d !== null ? `<span class="tag">${distanceText(d)}</span>` : ''}
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
        <button class="btn btn-primary" data-action="route">Проложить маршрут</button>
        ${state.lucky ? `<button class="btn btn-secondary" data-action="again">${icon('dice')} Ещё вариант</button>` : ''}
      </div>`;
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
    const pool = narrow(allPlaces().filter(matches));
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
      <span class="row-text"><b>${q ? highlight(p.name, q) : esc(p.name)}</b><small>${p.rating ? `<span class="row-rating">★ ${p.rating.toFixed(1).replace('.', ',')}</span> · ` : ''}${esc(catLabel(p))}${sub ? ' · ' + esc(sub) : ''}</small></span>
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
  const searchIndex = curated.map(indexItem);

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
        for (const r of data.rows) {
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
          searchIndex.push(indexItem(p));
        }
        resolve();
      };
      s.onerror = () => resolve(); // без мест по районам приложение всё равно работает
      document.head.appendChild(s);
    });
  }

  function search(q) {
    const words = norm(q).split(/[\s,.«»"]+/).filter(Boolean);
    if (!words.length) return [];
    const res = [];
    for (const it of searchIndex) {
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
    { v: 'all', label: 'Всё' },
  ];
  let nearTab = 'coffee';
  let nearFrom = null; // { lat, lon, me: true/false }

  function renderNear() {
    document.querySelectorAll('#near-tabs .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.v === nearTab));
    if (!nearFrom) return;
    const list = curated
      .filter((p) => (nearTab === 'all' || p.cat === nearTab) && passesFilters(p))
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

  // ---------- Подборки ----------
  function openCollection(id) {
    const c = COLLECTIONS.find((x) => x.id === id);
    if (!c) return;
    haptic.tap();
    state.collection = c;
    state.cat = 'all';
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

  // Показать все места на экране целиком (с полями под верхнюю панель)
  function fitPlaces(list) {
    if (!list.length) return;
    let s = 90, n = -90, w = 180, e = -180;
    for (const p of list) {
      s = Math.min(s, p.lat); n = Math.max(n, p.lat);
      w = Math.min(w, p.lon); e = Math.max(e, p.lon);
    }
    const el = $('#map');
    const W = el.clientWidth - 60, H = el.clientHeight - 220;
    const zx = Math.log2((W * 360) / (256 * Math.max(e - w, 0.002)));
    const zy = Math.log2((H * 2 * Math.PI) / (256 * Math.max(merc(n) - merc(s), 0.00005)));
    const zoom = Math.max(cfg.MIN_ZOOM || 9, Math.min(15, zx, zy));
    // Центр чуть выше середины мест: верх карты закрыт поиском и чипсами
    const cy = (merc(n) + merc(s)) / 2 + (70 * 2 * Math.PI) / (256 * Math.pow(2, zoom));
    MapView.flyTo((Math.atan(Math.exp(cy)) * 360) / Math.PI - 90, (w + e) / 2, zoom);
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
        toast('Похоже, ты не в Москве — пока на карте только московские места');
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
    const list = [{ id: 'all', label: 'Все' }].concat(Object.keys(CATS).map((id) => ({ id, label: CATS[id].label })));
    const box = $('#chips');
    box.innerHTML = list.map((c) =>
      `<button type="button" class="chip cat--${c.id}" data-cat="${c.id}">${icon(c.id)}${c.label}</button>`
    ).join('');
    box.addEventListener('click', (e) => {
      const b = e.target.closest('.chip');
      if (!b) return;
      state.cat = b.dataset.cat;
      haptic.tap();
      syncChips();
      render();
      b.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    });
    syncChips();
  }

  function syncChips() {
    document.querySelectorAll('.chip').forEach((b) => b.classList.toggle('active', b.dataset.cat === state.cat));
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
    mark('#f-budget', BUDGETS, state.budget);
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

  function buildFilters() {
    segment('#f-budget', BUDGETS, 'budget');
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
      nearTab = b.dataset.v;
      haptic.tap();
      renderNear();
      $('#near-sheet').scrollTop = 0;
    });
    $('#open-near').addEventListener('click', openNear);
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
    loadCloudTheme();
    loadCloudFavs();
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
      else if (a.dataset.action === 'route' && p) { haptic.impact(); openLink(routeUrl(p)); }
      else if (a.dataset.action === 'site') openLink(a.dataset.url);
      else if (a.dataset.action === 'yandex' && p) { haptic.impact(); openLink(yandexPlaceUrl(p)); }
    });
    document.querySelectorAll('.sheet').forEach(enableSwipe);

    try {
      await MapView.init($('#map'), {
        apiKey: (cfg.YANDEX_MAPS_API_KEY || '').trim(),
        center: cfg.START_CENTER,
        zoom: cfg.START_ZOOM,
        bounds: cfg.MAP_BOUNDS,
        minZoom: cfg.MIN_ZOOM,
        dark: isDark(),
      });
    } catch (e) {
      console.error(e);
      splashError('Не удалось загрузить карту. Проверь интернет и попробуй ещё раз.');
      return;
    }
    document.body.dataset.map = MapView.provider;
    MapView.onMove(onMove);
    onMove(MapView.view());
    render();
    hideSplash();
    // Ссылка от друга (startapp=p-<id>) — сразу открываем это место.
    // Кнопка «🎲 Мне повезёт» в боте открывает приложение с ?lucky=1 — сразу выбираем место
    const districtsReady = loadDistrictPlaces().then(() => { render(); syncFilters(); });
    const sp = startParam();
    if (sp.startsWith('p-')) {
      districtsReady.then(() => {
        const shared = byId.get(sp.slice(2));
        if (shared) setTimeout(() => openPlace(shared, { focus: true }), 300);
      });
    } else if (sp === 'lucky' || new URLSearchParams(location.search).get('lucky') === '1') {
      districtsReady.then(() => setTimeout(lucky, 900));
    }
  }

  main();
})();
