// Кафе, рестораны, музеи и смотровые площадки Москвы из OpenStreetMap.
// Данные лежат в data/osm-places.json (обновляются скриптом tools/update-osm.ps1),
// поэтому приложение не зависит от внешних серверов во время работы.
(function () {
  const CUISINE = {
    coffee_shop: 'кофейня', tea: 'чай', italian: 'итальянская', japanese: 'японская', sushi: 'суши',
    georgian: 'грузинская', russian: 'русская', french: 'французская', chinese: 'китайская',
    asian: 'азиатская', korean: 'корейская', vietnamese: 'вьетнамская', thai: 'тайская',
    uzbek: 'узбекская', caucasian: 'кавказская', pizza: 'пицца', burger: 'бургеры',
    steak_house: 'стейки', seafood: 'морепродукты', vegetarian: 'вегетарианская',
    vegan: 'веганская', mexican: 'мексиканская', indian: 'индийская', american: 'американская',
    european: 'европейская', mediterranean: 'средиземноморская', bakery: 'выпечка',
    dessert: 'десерты', cake: 'торты', breakfast: 'завтраки', pancake: 'блины',
  };

  let places = [];

  // Короткая запись из файла -> место в формате приложения
  function toPlace(r) {
    const cuisines = (r.c || '').split(';').map((c) => c.trim()).filter(Boolean);
    let cat, price, setting = 'indoor';
    if (r.k === 'cafe') {
      cat = 'coffee';
      price = cuisines.includes('coffee_shop') ? 400 : 700;
    } else if (r.k === 'restaurant') {
      cat = 'food';
      price = 2000;
    } else if (r.k === 'museum' || r.k === 'gallery') {
      cat = 'museum';
      price = r.f === 'no' ? 0 : 600;
    } else if (r.k === 'viewpoint') {
      cat = 'photo';
      price = 0;
      setting = 'outdoor';
    } else {
      return null;
    }
    if (r.o && (cat === 'coffee' || cat === 'food')) setting = 'both';

    const name = r.n || (cat === 'photo' ? 'Смотровая площадка' : null);
    if (!name) return null;

    const kitchen = cuisines.map((c) => CUISINE[c]).filter(Boolean);
    const desc = [];
    if (kitchen.length) desc.push('Кухня: ' + kitchen.join(', ') + '.');
    if (r.o) desc.push('Есть летняя веранда.');

    return {
      id: 'osm-' + r.i,
      name,
      cat,
      price,
      priceEstimated: price > 0,
      setting,
      hours: r.h || null,
      address: r.a || '',
      desc: desc.join(' '),
      website: r.w || null,
      lat: r.la,
      lon: r.lo,
      source: 'osm',
    };
  }

  async function load() {
    const res = await fetch('data/osm-places.json?v=' + encodeURIComponent(window.APP_VERSION || ''));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const raw = await res.json();
    places = raw.map(toPlace).filter(Boolean);
    return places;
  }

  window.OSM = {
    load,
    all: () => places,
  };
})();
