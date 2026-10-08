// Места Москвы из OpenStreetMap: кафе, рестораны, фастфуд, музеи, смотровые, ТЦ и фудкорты.
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
    dessert: 'десерты', cake: 'торты', breakfast: 'завтраки', pancake: 'блины', crepe: 'блины',
    chicken: 'курица', greek: 'греческая', turkish: 'турецкая', armenian: 'армянская',
    azerbaijani: 'азербайджанская', ukrainian: 'украинская', jewish: 'еврейская', arab: 'арабская',
    lebanese: 'ливанская', spanish: 'испанская', german: 'немецкая', noodle: 'лапша', ramen: 'рамен',
    kebab: 'кебаб', shawarma: 'шаурма', donut: 'пончики', waffle: 'вафли', ice_cream: 'мороженое',
    sandwich: 'сэндвичи', hot_dog: 'хот-доги', potato: 'картошка', pasta: 'паста', dumplings: 'пельмени',
    grill: 'гриль', fish: 'рыба', bubble_tea: 'бабл-ти', juice: 'соки', pita: 'пита', wok: 'вок',
  };
  const translate = (raw) => (raw || '').split(';').map((c) => CUISINE[c.trim()]).filter(Boolean);

  // «Торгово-развлекательный центр "Европейский"» -> «Европейский»
  function cleanMallName(name) {
    const short = name
      .replace(/^(торгово[- ]развлекательный|торгово[- ]офисный|торгово[- ]выставочный|торговый|развлекательный)\s+(центр|комплекс)\s*/i, '')
      .replace(/^(ТРЦ|ТЦ|ТРК|ТК|ТОЦ)\s+/, '')
      .replace(/^["«„](.*)["»“]$/, '$1')
      .trim();
    return short ? `«${short.replace(/^[«"]|[»"]$/g, '')}»` : name;
  }

  let places = [];

  // Короткая запись из файла -> место в формате приложения
  function toPlace(r) {
    const cuisines = (r.c || '').split(';').map((c) => c.trim()).filter(Boolean);
    let cat, price, setting = 'indoor', name = r.n;
    if (r.k === 'cafe') {
      cat = 'coffee';
      price = cuisines.includes('coffee_shop') ? 400 : 700;
    } else if (r.k === 'restaurant') {
      cat = 'food';
      price = 2000;
    } else if (r.k === 'fast_food') {
      cat = 'food';
      price = 450;
    } else if (r.k === 'museum' || r.k === 'gallery') {
      cat = 'museum';
      price = r.f === 'no' ? 0 : 600;
    } else if (r.k === 'viewpoint') {
      cat = 'photo';
      price = 0;
      setting = 'outdoor';
    } else if (r.k === 'mall' || r.k === 'food_court') {
      cat = 'mall';
      price = r.k === 'mall' ? 0 : 700;
      if (r.k === 'mall' && name) name = cleanMallName(name);
    } else {
      return null;
    }
    if (r.o && (cat === 'coffee' || cat === 'food')) setting = 'both';

    name = name || (cat === 'photo' ? 'Смотровая площадка' : null);
    if (!name) return null;

    const eat = (r.eat || []).map((s) => {
      const [n, c] = s.split('|');
      return { name: n, cuisines: translate(c) };
    });
    const fun = (r.fun || []).map((s) => {
      const [n, label] = s.split('|');
      return { name: n, label };
    });

    const desc = [];
    const kitchen = translate(r.c);
    if (cat !== 'mall' && kitchen.length) desc.push('Кухня: ' + kitchen.join(', ') + '.');
    if (r.o) desc.push('Есть летняя веранда.');

    return {
      id: 'osm-' + r.i,
      name,
      cat,
      kind: r.k,
      price,
      priceEstimated: price > 0,
      setting,
      hours: r.h || null,
      address: r.a || '',
      desc: desc.join(' '),
      website: r.w || null,
      eat,
      fun,
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
