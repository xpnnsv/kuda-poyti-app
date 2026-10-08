(function () {
  const cfg = window.APP_CONFIG;
  const tg = window.Telegram && window.Telegram.WebApp;
  const inTelegram = !!(tg && tg.platform && tg.platform !== 'unknown');
  const supports = (v) => inTelegram && typeof tg.isVersionAtLeast === 'function' && tg.isVersionAtLeast(v);

  const CATS = {
    coffee: { label: 'Кофе и чай', emoji: '☕' },
    food: { label: 'Еда', emoji: '🍽️' },
    museum: { label: 'Музеи', emoji: '🏛️' },
    photo: { label: 'Красивые места', emoji: '📸' },
  };
  const BUDGETS = [
    { v: null, label: 'Любой' },
    { v: 0, label: 'Бесплатно' },
    { v: 500, label: 'до 500 ₽' },
    { v: 1500, label: 'до 1 500 ₽' },
    { v: 3000, label: 'до 3 000 ₽' },
  ];
  const SETTINGS = [
    { v: 'any', label: 'Неважно' },
    { v: 'outdoor', label: '🌳 На улице' },
    { v: 'indoor', label: '🏠 В помещении' },
  ];
  const SETTING_TEXT = { outdoor: '🌳 На улице', indoor: '🏠 В помещении', both: '🌳 Улица и помещение' };
  const MOSCOW = { lat: 55.7539, lon: 37.6208 };
  const MAX_OSM_MARKERS = 150;

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
    osmLoading: false,
  };

  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const curated = (window.CURATED_PLACES || []).map((p) => Object.assign({ source: 'curated' }, p));

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

  const money = (n) => n.toLocaleString('ru-RU');

  function priceText(p) {
    if (p.price === 0) return 'Бесплатно';
    if (p.cat === 'museum' || p.cat === 'photo') return `Билет ≈ ${money(p.price)} ₽`;
    return `≈ ${money(p.price)} ₽ на человека`;
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

  // ---------- Тема и Telegram ----------
  function isDark() {
    if (inTelegram) return tg.colorScheme === 'dark';
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  function applyTheme() {
    const dark = isDark();
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    if (MapView.impl) MapView.setDark(dark);
    if (supports('6.1')) {
      tg.setHeaderColor('bg_color');
      tg.setBackgroundColor('bg_color');
    }
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
    if (state.cat !== 'all' && p.cat !== state.cat) return false;
    if (state.budget !== null && p.price > state.budget) return false;
    if (state.setting !== 'any' && p.setting !== state.setting && p.setting !== 'both') return false;
    if (state.openNow && Hours.status(p.hours).state !== 'open') return false;
    return true;
  }

  // Места из OSM без тех, что уже есть в подборке
  let osmPlaces = [];
  const osmMatches = () => osmPlaces.filter(matches);
  const allMatches = () => curated.filter(matches).concat(osmMatches());

  function visibleOsm() {
    const v = state.view;
    if (!v || v.zoom < cfg.OSM_MIN_ZOOM) return [];
    const b = v.bounds;
    const center = { lat: (b.north + b.south) / 2, lon: (b.east + b.west) / 2 };
    return osmPlaces
      .filter((p) => p.lat >= b.south && p.lat <= b.north && p.lon >= b.west && p.lon <= b.east && matches(p))
      .sort((a, c) => distance(a, center) - distance(c, center))
      .slice(0, MAX_OSM_MARKERS);
  }

  // ---------- Маркеры ----------
  const markerEls = new Map();
  function markerEl(p) {
    let el = markerEls.get(p.id);
    if (!el) {
      el = document.createElement('button');
      el.type = 'button';
      el.className = `mk mk--${p.cat}` + (p.source === 'osm' ? ' mk--small' : '');
      el.setAttribute('aria-label', p.name);
      el.innerHTML = `<span>${CATS[p.cat].emoji}</span>`;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        haptic.tap();
        openPlace(p);
      });
      markerEls.set(p.id, el);
    }
    el.classList.toggle('mk--active', !!state.selected && state.selected.id === p.id);
    return el;
  }

  function userEl() {
    const el = document.createElement('div');
    el.className = 'me';
    return el;
  }

  function render() {
    if (!MapView.impl) return;
    const places = curated.filter(matches);
    const osm = visibleOsm();
    const sel = state.selected;
    const z = (p, base) => (sel && sel.id === p.id ? 1000 : base);
    const items = places.map((p) => ({ id: p.id, lat: p.lat, lon: p.lon, el: markerEl(p), z: z(p, 100) }))
      .concat(osm.map((p) => ({ id: p.id, lat: p.lat, lon: p.lon, el: markerEl(p), z: z(p, 0) })));
    if (sel && !items.some((i) => i.id === sel.id)) {
      items.push({ id: sel.id, lat: sel.lat, lon: sel.lon, el: markerEl(sel), z: 1000 });
    }
    for (const [id, el] of markerEls) el.classList.toggle('mk--active', !!sel && sel.id === id);
    MapView.setMarkers(items);
    updatePill(places.length + osm.length);
  }

  function updatePill(n) {
    const pill = $('#pill');
    const v = state.view;
    pill.classList.toggle('pill--warn', n === 0 && !state.osmLoading);
    if (state.osmLoading) {
      pill.innerHTML = '<span class="spinner"></span>Загружаю кафе и рестораны…';
    } else if (n === 0) {
      pill.textContent = 'Ничего не нашлось — попробуй смягчить фильтры';
    } else {
      let text = `${n} ${plural(n, 'место', 'места', 'мест')} на карте`;
      if (cfg.LOAD_OSM_PLACES && v && v.zoom < cfg.OSM_MIN_ZOOM) text += ' · приблизь, чтобы найти больше';
      pill.textContent = text;
    }
  }

  // ---------- Места из OpenStreetMap ----------
  async function loadOsm() {
    state.osmLoading = true;
    updatePill(0);
    try {
      const list = await OSM.load();
      osmPlaces = list.filter((p) => !curated.some((c) => c.cat === p.cat && distance(c, p) < 80));
    } catch (e) {
      console.warn('OSM:', e);
      toast('Не получилось загрузить кафе и рестораны. Подборка мест всё равно работает');
    }
    state.osmLoading = false;
    render();
    if ($('#filters-sheet').classList.contains('open')) syncFilters();
  }

  function onMove(view) {
    state.view = view;
    $('#map').classList.toggle('zoom-far', view.zoom < 13.5);
    render();
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
  function placeHtml(p) {
    const c = CATS[p.cat];
    const st = Hours.status(p.hours);
    const todayHours = Hours.today(p.hours);
    const d = state.user ? distance(state.user, p) : null;
    const site = p.website ? (/^https?:\/\//.test(p.website) ? p.website : 'https://' + p.website) : null;
    return `
      <div class="sheet-handle"></div>
      <div class="place-head">
        <div class="place-icon place-icon--${p.cat}">${c.emoji}</div>
        <div class="place-title">
          <div class="place-cat">${c.label}</div>
          <h2>${esc(p.name)}</h2>
        </div>
        <button class="icon-btn" data-action="close" aria-label="Закрыть">✕</button>
      </div>
      <div class="tags">
        <span class="tag tag--${st.state}">${st.text}</span>
        <span class="tag">${priceText(p)}</span>
        <span class="tag">${SETTING_TEXT[p.setting] || ''}</span>
        ${d !== null ? `<span class="tag">🚶 ${distanceText(d)}</span>` : ''}
      </div>
      ${p.desc ? `<p class="place-desc">${esc(p.desc)}</p>` : ''}
      <ul class="place-info">
        ${p.address ? `<li><span>📍</span>${esc(p.address)}</li>` : ''}
        ${todayHours ? `<li><span>🕒</span>Сегодня: ${todayHours}</li>` : ''}
        ${site ? `<li><span>🌐</span><a href="#" data-action="site" data-url="${esc(site)}">Сайт места</a></li>` : ''}
      </ul>
      ${p.priceEstimated && p.source === 'osm' ? '<p class="place-note">Место из OpenStreetMap. Цена — примерная оценка по типу заведения.</p>' : ''}
      <div class="place-actions">
        <button class="btn btn-primary" data-action="route">Проложить маршрут</button>
        ${state.lucky ? '<button class="btn btn-secondary" data-action="again">🎲 Ещё вариант</button>' : ''}
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
    const zoom = opts.lucky ? Math.max(current, 15) : current;
    const degPerPx = (1.40625 * Math.cos((p.lat * Math.PI) / 180)) / Math.pow(2, zoom);
    MapView.flyTo(p.lat - window.innerHeight * 0.2 * degPerPx, p.lon, zoom);
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
    const fromCurated = narrow(curated.filter(matches));
    const fromOsm = narrow(osmMatches());
    if (!fromCurated.length && !fromOsm.length) {
      haptic.notify('error');
      toast('Под такие фильтры ничего нет — попробуй их смягчить');
      return;
    }
    // Места из подборки выпадают чаще, чем случайные кафе из OSM
    const useCurated = fromCurated.length && (!fromOsm.length || Math.random() < 0.7);
    const pool = useCurated ? fromCurated : fromOsm;
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
      if (distance(pos, MOSCOW) > 60000) {
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
    const list = [{ id: 'all', label: 'Все', emoji: '✨' }].concat(
      Object.keys(CATS).map((id) => ({ id, label: CATS[id].label, emoji: CATS[id].emoji }))
    );
    const box = $('#chips');
    box.innerHTML = list.map((c) =>
      `<button type="button" class="chip" data-cat="${c.id}"><span>${c.emoji}</span>${c.label}</button>`
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
    const wait = Math.max(0, 1500 - (Date.now() - startedAt));
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
    $('#backdrop').addEventListener('click', () => closeSheets());
    $('#splash-retry').addEventListener('click', () => location.reload());
    $('#place-sheet').addEventListener('click', (e) => {
      const a = e.target.closest('[data-action]');
      if (!a) return;
      e.preventDefault();
      const p = state.selected;
      if (a.dataset.action === 'close') closeSheets();
      else if (a.dataset.action === 'again') lucky();
      else if (a.dataset.action === 'route' && p) { haptic.impact(); openLink(routeUrl(p)); }
      else if (a.dataset.action === 'site') openLink(a.dataset.url);
    });
    document.querySelectorAll('.sheet').forEach(enableSwipe);

    try {
      await MapView.init($('#map'), {
        apiKey: (cfg.YANDEX_MAPS_API_KEY || '').trim(),
        center: cfg.START_CENTER,
        zoom: cfg.START_ZOOM,
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
    hideSplash();
    if (cfg.LOAD_OSM_PLACES) loadOsm();
  }

  main();
})();
