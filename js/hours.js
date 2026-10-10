// Часы работы в формате OpenStreetMap: "Mo-Fr 09:00-21:00; Sa,Su 10:00-22:00", "24/7", "Mo off".
// Время считается по Москве, где бы ни находился пользователь.
(function () {
  const DAY_CODES = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
  const DAY_ON = ['в понедельник', 'во вторник', 'в среду', 'в четверг', 'в пятницу', 'в субботу', 'в воскресенье'];
  const DAY_RE = '(?:Mo|Tu|We|Th|Fr|Sa|Su)';
  const RULE_RE = new RegExp(`^(${DAY_RE}(?:-${DAY_RE})?(?:,${DAY_RE}(?:-${DAY_RE})?)*)?\\s*(.*)$`);
  const cache = new Map();

  function expandDays(spec) {
    const days = new Set();
    for (const part of spec.split(',')) {
      const [a, b] = part.split('-');
      const from = DAY_CODES.indexOf(a);
      const to = b ? DAY_CODES.indexOf(b) : from;
      if (from < 0 || to < 0) return null;
      // диапазон может переходить через воскресенье: "Su-Th"
      for (let d = from; ; d = (d + 1) % 7) {
        days.add(d);
        if (d === to) break;
      }
    }
    return [...days];
  }

  function parseTimes(spec) {
    const out = [];
    for (const part of spec.split(',')) {
      const m = part.trim().match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\+?$/);
      if (!m) return null;
      const start = +m[1] * 60 + +m[2];
      let end = +m[3] * 60 + +m[4];
      if (end <= start) end += 1440; // работает после полуночи
      out.push([start, end]);
    }
    return out;
  }

  // Неделя: 7 элементов (пн..вс), в каждом список интервалов [начало, конец] в минутах от полуночи.
  // null — если строку не удалось разобрать.
  function parse(str) {
    if (!str) return null;
    if (cache.has(str)) return cache.get(str);
    let week = null;
    const s = String(str).trim();
    if (s === '24/7') {
      week = Array.from({ length: 7 }, () => [[0, 1440]]);
    } else {
      const w = Array.from({ length: 7 }, () => []);
      let parsed = false;
      for (let rule of s.split(';')) {
        rule = rule.replace(/"[^"]*"/g, '').trim();
        if (!rule || /^(PH|SH)\b/.test(rule)) continue; // праздники пропускаем
        rule = rule.replace(/,\s*PH\b/g, '');
        const m = rule.match(RULE_RE);
        const days = m[1] ? expandDays(m[1]) : [0, 1, 2, 3, 4, 5, 6];
        const timePart = m[2].trim();
        if (!days) continue;
        let intervals;
        if (/^(off|closed)$/i.test(timePart)) intervals = [];
        else if (timePart === '24/7') intervals = [[0, 1440]];
        else intervals = parseTimes(timePart);
        if (!intervals) continue;
        for (const d of days) w[d] = intervals;
        parsed = true;
      }
      week = parsed ? w : null;
    }
    cache.set(str, week);
    return week;
  }

  let formatter = null;
  // Текущее московское время пересчитываем не чаще раза в 20 секунд: при тысячах мест на карте
  // это заметно ускоряет фильтр «Открыто сейчас»
  let nowCache = null, nowCacheAt = 0;
  function moscowNow(date) {
    if (!date) {
      const t = Date.now();
      if (!nowCache || t - nowCacheAt > 20000) { nowCache = moscowNow(new Date(t)); nowCacheAt = t; }
      return nowCache;
    }
    formatter = formatter || new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Moscow', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    });
    const parts = {};
    for (const p of formatter.formatToParts(date)) parts[p.type] = p.value;
    const day = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(parts.weekday);
    return { day, minutes: (+parts.hour % 24) * 60 + +parts.minute };
  }

  const fmt = (min) => {
    min = ((min % 1440) + 1440) % 1440;
    return String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0');
  };

  const isAllDay = (week) => week.every((d) => d.some(([s, e]) => s === 0 && e >= 1440));

  // { state: 'open' | 'closed' | 'unknown', text }
  function status(str, date) {
    const week = parse(str);
    if (!week) return { state: 'unknown', text: 'Часы работы неизвестны' };
    if (isAllDay(week)) return { state: 'open', text: 'Открыто круглосуточно' };

    const { day, minutes } = moscowNow(date);
    const prev = (day + 6) % 7;
    const ends = [];
    for (const [s, e] of week[day]) if (minutes >= s && minutes < e) ends.push(e);
    for (const [, e] of week[prev]) if (e > 1440 && minutes < e - 1440) ends.push(e - 1440);
    if (week[day].some(([s, e]) => s === 0 && e >= 1440)) return { state: 'open', text: 'Открыто круглосуточно' };
    if (ends.length) return { state: 'open', text: 'Открыто до ' + fmt(Math.max(...ends)) };

    for (let offset = 0; offset < 7; offset++) {
      const d = (day + offset) % 7;
      const starts = week[d].map(([s]) => s).filter((s) => offset > 0 || s > minutes).sort((a, b) => a - b);
      if (starts.length) {
        const when = offset === 0 ? '' : offset === 1 ? 'завтра ' : DAY_ON[d] + ' ';
        return { state: 'closed', text: `Закрыто · откроется ${when}в ${fmt(starts[0])}` };
      }
    }
    return { state: 'closed', text: 'Закрыто' };
  }

  // Строка с часами на сегодня: "10:00–22:00", "выходной"
  function today(str, date) {
    const week = parse(str);
    if (!week) return null;
    if (isAllDay(week)) return 'круглосуточно';
    const { day } = moscowNow(date);
    if (!week[day].length) return 'выходной';
    return week[day].map(([s, e]) => (s === 0 && e >= 1440 ? 'круглосуточно' : fmt(s) + '–' + fmt(e))).join(', ');
  }

  window.Hours = { parse, status, today };
})();
