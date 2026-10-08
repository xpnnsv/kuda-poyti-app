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

  // ---------- Яндекс Карты ----------
  const yandex = {
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
      this.map = new YMap(el, {
        location: { center: [o.center[1], o.center[0]], zoom: o.zoom },
        theme: o.dark ? 'dark' : 'light',
      });
      this.map.addChild(new YMapDefaultSchemeLayer({}));
      this.map.addChild(new YMapDefaultFeaturesLayer({}));
      this.map.addChild(new YMapListener({
        layer: 'any',
        onUpdate: () => {
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

    setMarkers(items) {
      const { YMapMarker } = ymaps3;
      const ids = new Set(items.map((i) => i.id));
      for (const [id, m] of this.markers) {
        if (!ids.has(id)) { this.map.removeChild(m); this.markers.delete(id); }
      }
      for (const it of items) {
        const old = this.markers.get(it.id);
        if (old) {
          if (old._z !== it.z) { old.update({ zIndex: it.z || 0 }); old._z = it.z; }
          continue;
        }
        const m = new YMapMarker({ coordinates: [it.lon, it.lat], zIndex: it.z || 0 }, it.el);
        m._z = it.z;
        this.map.addChild(m);
        this.markers.set(it.id, m);
      }
    },

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
      this.map = L.map(el, { zoomControl: false, attributionControl: true }).setView(o.center, o.zoom);
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

    view() { return this.impl.view(); },
    onMove(cb) { this.impl.onMove(cb); },
    setMarkers(items) { this.impl.setMarkers(items); },
    flyTo(lat, lon, zoom) { this.impl.flyTo(lat, lon, zoom); },
    setUser(lat, lon, el) { this.impl.setUser(lat, lon, el); },
    setDark(dark) { this.impl.setDark(dark); },
  };
})();
