// Карта. Если в config.js указан ключ — Яндекс Карты (API v3),
// иначе (или если Яндекс не загрузился) — бесплатная карта OpenStreetMap через Leaflet.
(function () {
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Не удалось загрузить ' + src));
      document.head.appendChild(s);
    });
  }

  function loadCss(href) {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = href;
    document.head.appendChild(l);
  }

  function withTimeout(promise, ms) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
    ]);
  }

  function boundsFromCorners(a, b) {
    // a, b — [lon, lat]
    return {
      west: Math.min(a[0], b[0]), east: Math.max(a[0], b[0]),
      south: Math.min(a[1], b[1]), north: Math.max(a[1], b[1]),
    };
  }

  // ---------- Метки на холсте (для Яндекс Карт) ----------
  // Раньше каждая метка была HTML-элементом: карта двигала их по одному в каждом кадре, и телефон
  // 60 раз в секунду заново перерисовывал весь слой меток — отсюда рывки. Теперь все метки
  // рисуются на одном <canvas>: картинка каждой метки и подписи готовится один раз, а в кадре
  // только копируется на своё место (доли миллисекунды). Рисуем в том же кадре, что и карта
  // (Яндекс сообщает о сдвиге внутри своего кадра), поэтому метки не отстают от улиц.
  const merc = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));

  // Значки категорий берём из того же SVG-спрайта, что и в остальном приложении (app.html)
  const glyphCache = {};
  function glyph(name) {
    if (glyphCache[name]) return glyphCache[name];
    const parts = [];
    const sym = document.getElementById('i-' + name);
    if (sym) {
      for (const n of sym.children) {
        let p = null;
        if (n.tagName === 'path') p = new Path2D(n.getAttribute('d'));
        else if (n.tagName === 'circle') {
          p = new Path2D();
          p.arc(+n.getAttribute('cx'), +n.getAttribute('cy'), +n.getAttribute('r'), 0, Math.PI * 2);
        }
        if (p) parts.push({ p, fill: n.getAttribute('fill') === 'currentColor', stroke: n.getAttribute('stroke') === 'currentColor', dash: n.getAttribute('stroke-dasharray') });
      }
    }
    return (glyphCache[name] = parts);
  }

  function drawGlyph(g, name, cx, cy, size, color) {
    const k = size / 24;
    g.save();
    g.translate(cx - size / 2, cy - size / 2);
    g.scale(k, k);
    g.strokeStyle = g.fillStyle = color;
    g.lineWidth = 2;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const part of glyph(name)) {
      if (part.fill) g.fill(part.p);
      if (part.stroke) g.stroke(part.p);
    }
    g.restore();
  }

  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  function CanvasMarkers(map, el) {
    this.map = map;
    this.el = el;
    this.items = [];
    this.placed = [];
    this.sprites = new Map();
    this.labels = new Map();
    const c = (this.canvas = document.createElement('canvas'));
    c.className = 'mk-canvas';
    el.appendChild(c);
    this.ctx = c.getContext('2d');
    this.resize();
    if (window.ResizeObserver) new ResizeObserver(() => { this.resize(); this.draw(); }).observe(el);
    // Шрифт подписей мог догрузиться позже — перерисуем подписи им
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { this.labels.clear(); this.draw(); });

    // Нажатие на метку: короткое касание без сдвига пальца (иначе это движение карты)
    let down = null;
    el.addEventListener('pointerdown', (e) => { down = e.isPrimary ? { x: e.clientX, y: e.clientY, t: Date.now() } : null; }, true);
    el.addEventListener('pointerup', (e) => {
      const d = down;
      down = null;
      if (!d || !e.isPrimary || Date.now() - d.t > 600 || Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 12) return;
      const r = el.getBoundingClientRect();
      const hit = this.hitTest(e.clientX - r.left, e.clientY - r.top);
      if (hit && hit.onClick) hit.onClick();
    }, true);
  }

  CanvasMarkers.prototype.resize = function () {
    this.w = this.el.clientWidth || window.innerWidth;
    this.h = this.el.clientHeight || window.innerHeight;
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
  };

  // Сменилась тема — картинки меток и подписей нужно нарисовать заново
  CanvasMarkers.prototype.reset = function () {
    this.sprites.clear();
    this.labels.clear();
    this.draw();
  };

  CanvasMarkers.prototype.colors = function () {
    const cs = getComputedStyle(document.documentElement);
    const v = (n, d) => (cs.getPropertyValue(n) || '').trim() || d;
    return {
      coffee: v('--c-coffee', '#d98a5b'), food: v('--c-food', '#ff4059'), museum: v('--c-museum', '#8f72d6'),
      photo: v('--c-photo', '#2fa58f'), mall: v('--c-mall', '#5f7fe0'), night: v('--c-night', '#b23a8c'),
      accent: v('--accent', '#ff4059'), surface: v('--surface', '#fff'), text: v('--text', '#221c1f'), bg: v('--bg', '#fff'),
    };
  };

  // Картинка метки: цветной круг с белой обводкой и значком, у выбранной — крупнее и с ореолом,
  // у избранной — сердечко, в маршруте — номер остановки
  CanvasMarkers.prototype.sprite = function (it) {
    const key = [it.cat, it.small || it.far ? 's' : 'n', it.active ? 'a' : '', it.fav ? 'f' : '', it.num || ''].join('|');
    let s = this.sprites.get(key);
    if (s) return s;
    const col = this.colors();
    const color = col[it.cat] || col.accent;
    const base = it.active ? 17 : it.small || it.far ? 13 : 17; // радиус, как у прежних HTML-меток
    const k = it.active ? 1.25 : 1;
    const r = base * k;
    const half = Math.ceil(r + 12 * k);
    const size = half * 2, dpr = this.dpr;
    const c = document.createElement('canvas');
    c.width = c.height = Math.ceil(size * dpr);
    const g = c.getContext('2d');
    g.scale(dpr, dpr);
    const cx = half, cy = half;
    if (it.active) {
      // ореол вокруг выбранной метки
      g.beginPath();
      g.arc(cx, cy, r + 6 * k, 0, Math.PI * 2);
      g.globalAlpha = 0.25;
      g.fillStyle = color;
      g.fill();
      g.globalAlpha = 1;
    }
    g.save();
    g.shadowColor = it.active ? 'rgba(0,0,0,0.25)' : 'rgba(0,0,0,0.22)';
    g.shadowBlur = it.active ? 12 : 4;
    g.shadowOffsetY = it.active ? 4 : 1;
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fillStyle = '#fff';
    g.fill();
    g.restore();
    g.beginPath();
    g.arc(cx, cy, r - 2 * k, 0, Math.PI * 2);
    g.fillStyle = color;
    g.fill();
    drawGlyph(g, it.cat, cx, cy, (base === 13 ? 14 : 18) * k, '#fff');
    if (it.fav) {
      // сердечко у избранного — справа сверху
      const fx = cx + (base - 2.5) * k, fy = cy - (base - 2.5) * k, fr = 8.5 * k;
      g.save();
      g.shadowColor = 'rgba(0,0,0,0.2)';
      g.shadowBlur = 3;
      g.shadowOffsetY = 1;
      g.beginPath();
      g.arc(fx, fy, fr, 0, Math.PI * 2);
      g.fillStyle = '#fff';
      g.fill();
      g.restore();
      drawGlyph(g, 'heart-fill', fx, fy, 11 * k, col.accent);
    }
    if (it.num) {
      // номер остановки маршрута — слева сверху
      const txt = String(it.num);
      g.font = `800 ${11 * k}px Nunito, -apple-system, Roboto, Arial, sans-serif`;
      const bw = Math.max(18 * k, g.measureText(txt).width + 12 * k), bh = 18 * k;
      const bx = cx - base * k - 8 * k, by = cy - base * k - 8 * k;
      roundRect(g, bx, by, bw, bh, bh / 2);
      g.fillStyle = col.text;
      g.fill();
      g.lineWidth = 2 * k;
      g.strokeStyle = '#fff';
      g.stroke();
      g.fillStyle = col.bg;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(txt, bx + bw / 2, by + bh / 2 + 0.5);
    }
    s = { c, size, half, r };
    this.sprites.set(key, s);
    return s;
  };

  // Картинка подписи под меткой (название в «пилюле», длинное — с многоточием)
  CanvasMarkers.prototype.label = function (it) {
    let l = this.labels.get(it.id);
    if (l && l.name === it.name) return l;
    const col = this.colors();
    const font = '800 11px Nunito, -apple-system, Roboto, Arial, sans-serif';
    const m = document.createElement('canvas').getContext('2d');
    m.font = font;
    let text = it.name;
    const maxW = 130 - 14;
    if (m.measureText(text).width > maxW) {
      while (text.length > 1 && m.measureText(text + '…').width > maxW) text = text.slice(0, -1);
      text = text.trimEnd() + '…';
    }
    const w = Math.ceil(m.measureText(text).width + 14), h = 19, pad = 4, dpr = this.dpr;
    const c = document.createElement('canvas');
    c.width = Math.ceil((w + pad * 2) * dpr);
    c.height = Math.ceil((h + pad * 2) * dpr);
    const g = c.getContext('2d');
    g.scale(dpr, dpr);
    g.save();
    g.shadowColor = 'rgba(34,28,31,0.18)';
    g.shadowBlur = 3;
    g.shadowOffsetY = 1;
    roundRect(g, pad, pad, w, h, 7);
    g.fillStyle = col.surface;
    g.fill();
    g.restore();
    g.font = font;
    g.fillStyle = col.text;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, pad + w / 2, pad + h / 2 + 0.5);
    l = { c, w, h, pad, name: it.name };
    this.labels.set(it.id, l);
    return l;
  };

  CanvasMarkers.prototype.set = function (items) {
    for (const it of items) if (it._my === undefined) it._my = merc(it.lat);
    this.items = items.slice().sort((a, b) => (a.z || 0) - (b.z || 0));
    // подписи тех, кого больше нет на карте, не держим в памяти
    if (this.labels.size > 300) {
      const keep = new Set(items.map((i) => i.id));
      for (const id of this.labels.keys()) if (!keep.has(id)) this.labels.delete(id);
    }
    this.draw();
  };

  CanvasMarkers.prototype.draw = function () {
    const g = this.ctx, w = this.w, h = this.h;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    this.placed = [];
    if (!this.items.length) return;
    const b = boundsFromCorners(this.map.bounds[0], this.map.bounds[1]);
    const mN = merc(b.north), mS = merc(b.south), kx = w / (b.east - b.west), ky = h / (mN - mS);
    for (const it of this.items) {
      const x = (it.lon - b.west) * kx, y = (mN - it._my) * ky;
      if (x < -80 || x > w + 80 || y < -50 || y > h + 50) continue;
      const s = this.sprite(it);
      g.drawImage(s.c, x - s.half, y - s.half, s.size, s.size);
      let lb = null;
      if (it.label) {
        const l = this.label(it);
        const lx = x - l.w / 2, ly = y + s.r + 4;
        g.drawImage(l.c, lx - l.pad, ly - l.pad, l.w + l.pad * 2, l.h + l.pad * 2);
        lb = [lx, ly, lx + l.w, ly + l.h];
      }
      this.placed.push({ it, x, y, r: s.r, lb });
    }
  };

  // Какая метка под пальцем: сверху вниз, с запасом в 8 px — по метке легко попасть
  CanvasMarkers.prototype.hitTest = function (px, py) {
    for (let i = this.placed.length - 1; i >= 0; i--) {
      const p = this.placed[i];
      const dx = px - p.x, dy = py - p.y, rr = p.r + 8;
      if (dx * dx + dy * dy <= rr * rr) return p.it;
      if (p.lb && px >= p.lb[0] && px <= p.lb[2] && py >= p.lb[1] && py <= p.lb[3]) return p.it;
    }
    return null;
  };

  // ---------- Яндекс Карты ----------
  const yandex = {
    canvasMarkers: true,
    map: null,
    markers: new Map(),
    userMarker: null,
    cancelled: false,
    moveCb: null,
    moveTimer: null,

    async init(el, o) {
      await loadScript('https://api-maps.yandex.ru/v3/?apikey=' + encodeURIComponent(o.apiKey) + '&lang=ru_RU');
      await ymaps3.ready;
      if (this.cancelled) return;
      const { YMap, YMapDefaultSchemeLayer, YMapDefaultFeaturesLayer, YMapListener } = ymaps3;
      const props = {
        location: { center: [o.center[1], o.center[0]], zoom: o.zoom },
        theme: o.dark ? 'dark' : 'light',
        // Растровые плитки вместо векторной отрисовки: выглядит так же, а движение карты
        // в 3–4 раза легче для телефона (векторная карта считает каждый кадр на JS)
        mode: 'raster',
      };
      // Порядок углов: юго-запад, затем северо-восток (проверено на живой карте)
      if (o.bounds) props.restrictMapArea = [[o.bounds.west, o.bounds.south], [o.bounds.east, o.bounds.north]];
      if (o.minZoom) props.zoomRange = { min: o.minZoom, max: 21 };
      this.map = new YMap(el, props);
      this.map.addChild(new YMapDefaultSchemeLayer({}));
      this.map.addChild(new YMapDefaultFeaturesLayer({}));
      this.cm = new CanvasMarkers(this.map, el);
      this.map.addChild(new YMapListener({
        layer: 'any',
        onUpdate: () => {
          this.cm.draw(); // метки — в том же кадре, что и карта
          clearTimeout(this.moveTimer);
          this.moveTimer = setTimeout(() => this.moveCb && this.moveCb(this.view()), 350);
        },
      }));
    },

    view() {
      const b = this.map.bounds;
      return { bounds: boundsFromCorners(b[0], b[1]), zoom: this.map.zoom };
    },

    onMove(cb) { this.moveCb = cb; },

    setMarkers(items) { this.cm.set(items); },

    flyTo(lat, lon, zoom) {
      const location = { center: [lon, lat], zoom: zoom || this.map.zoom, duration: 500 };
      if (typeof this.map.setLocation === 'function') this.map.setLocation(location);
      else this.map.update({ location });
    },

    setUser(lat, lon, el) {
      const { YMapMarker } = ymaps3;
      if (this.userMarker) this.map.removeChild(this.userMarker);
      this.userMarker = new YMapMarker({ coordinates: [lon, lat], zIndex: 2000 }, el);
      this.map.addChild(this.userMarker);
    },

    setDark(dark) {
      try { this.map.update({ theme: dark ? 'dark' : 'light' }); } catch (e) { /* старые версии API */ }
      if (this.cm) this.cm.reset(); // цвета подписей зависят от темы
    },

    // Линия маршрута (пунктир по точкам). coords — [[lat, lon], …] или null, чтобы убрать
    setLine(coords) {
      if (this.line) { this.map.removeChild(this.line); this.line = null; }
      if (!coords || coords.length < 2) return;
      this.line = new ymaps3.YMapFeature({
        geometry: { type: 'LineString', coordinates: coords.map(([lat, lon]) => [lon, lat]) },
        style: { stroke: [{ color: '#ff4059', width: 4, dash: [2, 8] }], zIndex: 5 },
      });
      this.map.addChild(this.line);
    },

    setBounds(b) {
      this.map.update({ restrictMapArea: [[b.west, b.south], [b.east, b.north]] });
    },

    setMinZoom(z) {
      this.map.update({ zoomRange: { min: z, max: 21 } });
      if (this.map.zoom < z) this.map.update({ location: { center: this.map.center, zoom: z } });
    },
  };

  // ---------- OpenStreetMap (Leaflet) ----------
  // Тёмная тема для этой карты делается CSS-фильтром (см. style.css)
  const leaflet = {
    map: null,
    markers: new Map(),
    userMarker: null,

    async init(el, o) {
      loadCss('https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css');
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js');
      const opts = { zoomControl: false, attributionControl: true, minZoom: o.minZoom || 0 };
      if (o.bounds) {
        opts.maxBounds = [[o.bounds.south, o.bounds.west], [o.bounds.north, o.bounds.east]];
        opts.maxBoundsViscosity = 1;
      }
      this.map = L.map(el, opts).setView(o.center, o.zoom);
      this.map.attributionControl.setPrefix(false);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(this.map);
    },

    view() {
      const b = this.map.getBounds();
      return {
        bounds: { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() },
        zoom: this.map.getZoom(),
      };
    },

    onMove(cb) { this.map.on('moveend', () => cb(this.view())); },

    icon(el) { return L.divIcon({ html: el, className: 'mk-wrap', iconSize: [0, 0] }); },

    setMarkers(items) {
      const ids = new Set(items.map((i) => i.id));
      for (const [id, m] of this.markers) {
        if (!ids.has(id)) { m.remove(); this.markers.delete(id); }
      }
      for (const it of items) {
        const old = this.markers.get(it.id);
        if (old) {
          old.setZIndexOffset(it.z || 0);
          continue;
        }
        const m = L.marker([it.lat, it.lon], { icon: this.icon(it.el), zIndexOffset: it.z || 0, keyboard: false });
        m.addTo(this.map);
        this.markers.set(it.id, m);
      }
    },

    flyTo(lat, lon, zoom) {
      this.map.flyTo([lat, lon], zoom || this.map.getZoom(), { duration: 0.6 });
    },

    setUser(lat, lon, el) {
      if (this.userMarker) this.userMarker.remove();
      this.userMarker = L.marker([lat, lon], { icon: this.icon(el), zIndexOffset: 2000, interactive: false }).addTo(this.map);
    },

    setDark() { /* тема переключается через CSS */ },

    setMinZoom(z) { this.map.options.zoomSnap = 0; this.map.setMinZoom(z); },

    setBounds(b) { this.map.setMaxBounds([[b.south, b.west], [b.north, b.east]]); },

    setLine(coords) {
      if (this.line) { this.line.remove(); this.line = null; }
      if (!coords || coords.length < 2) return;
      this.line = L.polyline(coords, { color: '#ff4059', weight: 4, dashArray: '2 10', lineCap: 'round', interactive: false }).addTo(this.map);
    },
  };

  // ---------- Общий интерфейс ----------
  window.MapView = {
    impl: null,
    provider: null,

    async init(el, o) {
      if (o.apiKey) {
        try {
          await withTimeout(yandex.init(el, o), 10000);
          this.impl = yandex;
          this.provider = 'yandex';
          return;
        } catch (e) {
          console.warn('Яндекс Карты не загрузились, переключаюсь на OpenStreetMap:', e);
          yandex.cancelled = true;
          el.innerHTML = '';
        }
      }
      await leaflet.init(el, o);
      this.impl = leaflet;
      this.provider = 'leaflet';
    },

    // true — метки рисуются на холсте (Яндекс), им нужны данные, а не HTML-элементы
    get canvasMarkers() { return !!(this.impl && this.impl.canvasMarkers); },
    view() { return this.impl.view(); },
    onMove(cb) { this.impl.onMove(cb); },
    setMarkers(items) { this.impl.setMarkers(items); },
    flyTo(lat, lon, zoom) { this.impl.flyTo(lat, lon, zoom); },
    setUser(lat, lon, el) { this.impl.setUser(lat, lon, el); },
    setDark(dark) { this.impl.setDark(dark); },
    setMinZoom(z) { this.impl.setMinZoom(z); },
    setBounds(b) { this.impl.setBounds(b); },
    setLine(coords) { try { this.impl.setLine(coords); } catch (e) { console.warn('Линия маршрута:', e); } },
  };
})();
