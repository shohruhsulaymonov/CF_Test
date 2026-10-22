// Общие помощники: экранирование, случайность, даты, модальные окна.
(function () {
  const U = {};

  U.esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  U.uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  // Ключ имени: без учёта регистра, пробелов по краям и различия е/ё (ТЗ §5).
  U.nameKey = s => String(s == null ? '' : s).trim().toLowerCase().replace(/ё/g, 'е');
  // Ключ категории: без учёта регистра и пробелов по краям (ТЗ §3).
  U.catKey = s => String(s == null ? '' : s).trim().replace(/\s+/g, ' ').toLowerCase();

  U.shuffle = arr => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  U.sample = (arr, n) => U.shuffle(arr).slice(0, n);
  U.pick = arr => arr[Math.floor(Math.random() * arr.length)];

  // FNV-1a: дешёвый хеш для обнаружения изменений в файлах наборов.
  U.hash = str => {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16);
  };

  U.plural = (n, one, few, many) => {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
  };

  U.fmtNum = (n, digits = 0) => Number(n).toLocaleString('ru-RU', {
    minimumFractionDigits: digits, maximumFractionDigits: digits
  });

  // Даты считаются в часовом поясе из настроек.
  const tz = (window.APP_CONFIG && APP_CONFIG.timeZone) || 'Asia/Tashkent';
  const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  const timeFmt = new Intl.DateTimeFormat('ru-RU', { timeZone: tz, hour: '2-digit', minute: '2-digit' });
  U.dayKey = ts => dayFmt.format(new Date(ts)); // ГГГГ-ММ-ДД
  U.addDays = (key, n) => new Date(Date.parse(key + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
  U.weekStart = key => {
    const d = new Date(key + 'T00:00:00Z');
    return U.addDays(key, -((d.getUTCDay() + 6) % 7));
  };
  U.keyToRu = key => { const [y, m, d] = key.split('-'); return `${d}.${m}.${y}`; };
  U.fmtDate = ts => U.keyToRu(U.dayKey(ts));
  U.fmtDateTime = ts => `${U.fmtDate(ts)} ${timeFmt.format(new Date(ts))}`;

  U.$ = (sel, root = document) => root.querySelector(sel);
  U.$$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  U.toast = (msg, kind = '') => {
    let box = U.$('#toasts');
    if (!box) {
      box = document.createElement('div');
      box.id = 'toasts';
      box.setAttribute('role', 'status');
      document.body.appendChild(box);
    }
    const t = document.createElement('div');
    t.className = 'toast ' + kind;
    t.textContent = msg;
    box.appendChild(t);
    setTimeout(() => t.remove(), 3500);
  };

  // Модальное окно. Возвращает { root, close }.
  U.modal = (html, { wide = false, onClose } = {}) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
      <button class="modal-x" aria-label="Закрыть">×</button>${html}</div>`;
    document.body.appendChild(wrap);
    const prevKeys = App.keyHandler;
    const close = () => {
      wrap.remove();
      App.keyHandler = prevKeys;
      if (onClose) onClose();
    };
    App.keyHandler = e => { if (e.key === 'Escape') close(); };
    wrap.addEventListener('mousedown', e => { if (e.target === wrap) close(); });
    U.$('.modal-x', wrap).onclick = close;
    const first = U.$('input, textarea, select', wrap);
    if (first) setTimeout(() => first.focus(), 0);
    return { root: U.$('.modal', wrap), close };
  };

  U.confirm = (text, okLabel = 'Да') => new Promise(resolve => {
    let done = false;
    const m = U.modal(`<p class="lead">${U.esc(text)}</p>
      <div class="row end"><button class="btn ghost" data-no>Отмена</button>
      <button class="btn primary" data-yes>${U.esc(okLabel)}</button></div>`,
    { onClose: () => { if (!done) resolve(false); } });
    U.$('[data-yes]', m.root).onclick = () => { done = true; m.close(); resolve(true); };
    U.$('[data-no]', m.root).onclick = () => { done = true; m.close(); resolve(false); };
    setTimeout(() => U.$('[data-yes]', m.root).focus(), 0);
  });

  U.download = (filename, text, type = 'text/javascript') => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: type + ';charset=utf-8' }));
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  window.U = U;
})();
