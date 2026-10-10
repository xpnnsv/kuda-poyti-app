// Подборки — готовые наборы мест с карты (все места уже сверены с Яндекс Картами, см. places.js).
// ids — id мест из places.js. Порядок не важен: на карте показываются все места подборки сразу.
window.COLLECTIONS = [
  {
    id: 'views', emoji: '🌇', title: 'Лучшие виды',
    ids: ['vorobyovy', 'zaryadye', 'patriarshy-bridge', 'panorama360', 'ruski', 'sixty', 'white-rabbit',
      'ran-viewpoint', 'city-embankment', 'cdm', 'krasnogvardeyskie-prudy', 'kolomenskoe', 'novodevichi-prudy'],
  },
  {
    id: 'rain', emoji: '☔', title: 'Если дождь',
    ids: ['tretyakov', 'pushkin-museum', 'ges2', 'historical', 'darwin', 'planetarium', 'experimentanium',
      'cosmonautics', 'mamm', 'tsar-maket', 'depo', 'dream-island', 'mayakovskaya'],
  },
  {
    id: 'date', emoji: '💕', title: 'На свидание',
    ids: ['patriki', 'chistye', 'neskuchny', 'gorky', 'aptekarsky', 'sad-ermitazh', 'huamin-park',
      'city-embankment', 'coffeemania', 'dr-zhivago', 'pushkin-cafe', 'white-rabbit', 'impressionism'],
  },
  {
    id: 'free', emoji: '🆓', title: 'Бесплатно',
    ids: ['red-square', 'zaryadye', 'nikolskaya', 'aleksandrovsky-sad', 'vdnh', 'ges2', 'vorobyovy', 'patriki',
      'neskuchny', 'sokolniki', 'izmailovo', 'river-station', 'flacon', 'huamin-park'],
  },
];
