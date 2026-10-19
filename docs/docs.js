// Подставляет в документы оператора и e-mail из js/config.js. Пока поля пустые — заметная пометка «не указано»
(function () {
  const cfg = window.APP_CONFIG || {};
  const fill = (sel, value, empty) => document.querySelectorAll(sel).forEach((el) => {
    if (value) { el.textContent = value; el.classList.remove('todo'); }
    else { el.textContent = empty; el.classList.add('todo'); }
  });
  fill('[data-op="name"]', cfg.OPERATOR_NAME, '[ФИО или название оператора — не указано]');
  fill('[data-op="email"]', cfg.OPERATOR_EMAIL, '[e-mail для обращений — не указан]');
  fill('[data-op="app"]', cfg.APP_NAME || 'Куда пойти', '');
  fill('[data-op="bot"]', cfg.BOT_USERNAME ? '@' + cfg.BOT_USERNAME : '', '[бот — не указан]');
  const v = cfg.LEGAL_VERSION || '';
  document.querySelectorAll('[data-op="version"]').forEach((el) => {
    const [y, m, d] = v.split('-');
    el.textContent = d ? `${d}.${m}.${y}` : v;
  });
})();
