// Маршрутизатор, шапка и запуск приложения.
(function () {
  const App = {
    views: {},
    keyHandler: null,
    leave: null,          // вызывается при уходе со страницы (например, завершить игру)
    main: () => document.getElementById('main'),

    go(hash) {
      if (location.hash === hash) App.route();
      else location.hash = hash;
    },

    render(html) {
      App.main().innerHTML = html;
      window.scrollTo(0, 0);
      return App.main();
    },

    parse() {
      const raw = location.hash.replace(/^#/, '') || '/';
      const [p, q = ''] = raw.split('?');
      const parts = p.split('/').filter(Boolean).map(decodeURIComponent);
      const query = Object.fromEntries(new URLSearchParams(q));
      return { parts, query };
    },

    route() {
      if (App.leave) {
        const fn = App.leave;
        App.leave = null;
        fn();
      }
      App.keyHandler = null;
      document.querySelectorAll('.modal-backdrop').forEach(m => m.remove());

      const { parts, query } = App.parse();
      const user = Auth.current();
      if (!user && parts[0] !== 'login') return App.go('#/login');
      App.header();

      const V = App.views;
      const primary = Sets.primaryId();
      try {
        if (parts[0] === 'login') return V.login();
        if (!primary) return V.noSets();
        if (!parts.length) return V.dashboard(primary);
        if (parts[0] === 'sets') return V.otherSets();
        if (parts[0] === 'notifications') return V.notifications();
        if (parts[0] === 'game') return V.results(parts[1]);
        if (parts[0] === 'admin') {
          if (!Auth.isAdmin()) return App.go('#/');
          return V.admin(parts[1] || 'import', query);
        }
        if (parts[0] === 'set') {
          const setId = parts[1];
          if (!Sets.get(setId)) return V.notFound('Набор не найден');
          const page = parts[2] || '';
          if (!page) return V.dashboard(setId);
          if (page === 'play') return V.play(setId, parts[3], query);
          if (V[page]) return V[page](setId, query);
        }
        V.notFound();
      } catch (e) {
        console.error(e);
        App.render(`<div class="card error-box"><h2>Ошибка</h2><p>${U.esc(e.message)}</p>
          <a class="btn" href="#/">На главную</a></div>`);
      }
    },

    header() {
      const user = Auth.current();
      const h = document.getElementById('header');
      if (!user) {
        h.innerHTML = `<div class="bar"><a class="brand" href="#/login">${U.esc(APP_CONFIG.appTitle)}</a></div>`;
        return;
      }
      const { parts } = App.parse();
      const primary = Sets.primaryId();
      const onSet = parts[0] === 'set' ? parts[1] : (!parts.length ? primary : null);
      const unread = Store.state.notifications.filter(n => n.user_id === user.id && !n.read_at).length;
      const link = (href, label, active) => `<a href="${href}" class="${active ? 'active' : ''}">${label}</a>`;
      h.innerHTML = `<div class="bar">
        <a class="brand" href="#/">${U.esc(APP_CONFIG.appTitle)}</a>
        <nav class="topnav" aria-label="Основная навигация">
          ${link('#/', 'Главный набор', onSet === primary && primary)}
          ${link('#/sets', 'Другие наборы', parts[0] === 'sets' || (onSet && onSet !== primary))}
          ${Auth.isAdmin() ? link('#/admin', 'Админ-панель', parts[0] === 'admin') : ''}
        </nav>
        <div class="userbox">
          <a href="#/notifications" class="bell" aria-label="Уведомления${unread ? ': ' + unread + ' новых' : ''}">🔔${unread ? `<span class="badge">${unread}</span>` : ''}</a>
          <span class="uname" title="Вы вошли как ${U.esc(user.name)}">${U.esc(user.name)}</span>
          <button class="btn small ghost" id="logout">Выйти</button>
        </div></div>`;
      h.querySelector('#logout').onclick = () => { Auth.logout(); App.go('#/login'); };
    }
  };

  document.addEventListener('keydown', e => {
    if (!App.keyHandler) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if ((tag === 'input' || tag === 'textarea' || tag === 'select') && e.key !== 'Escape') return;
    App.keyHandler(e);
  });

  // Загрузка файлов наборов из sets/manifest.js (обычные <script>, работают и с file://).
  function loadSetFiles() {
    const files = window.SET_MANIFEST || [];
    return Promise.all(files.map(f => new Promise(resolve => {
      const s = document.createElement('script');
      s.src = 'sets/' + f + '?v=' + Date.now();
      s.onload = resolve;
      s.onerror = () => { console.warn('Не удалось загрузить набор', f); resolve(); };
      document.head.appendChild(s);
    })));
  }

  async function boot() {
    document.title = APP_CONFIG.appTitle;
    Store.load();
    await loadSetFiles();
    Sets.syncFileSets();
    Auth.restore();
    window.addEventListener('hashchange', App.route);
    App.route();
  }

  window.App = App;
  document.addEventListener('DOMContentLoaded', boot);
})();
