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
          if (!Auth.isAdmin()) {
            // Права админа подтверждает Firebase — ждём его загрузки, а не уводим на главную.
            if (Sync.pending) {
              App.render('<p class="muted center">Проверка входа администратора…</p>');
              Sync.ready.then(() => { if (location.hash.startsWith('#/admin')) App.route(); });
              return;
            }
            return App.go('#/');
          }
          return V.admin(parts[1] || 'stats', query);
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

    // Набор, к которому относится текущая страница (для меню и поиска).
    currentSetId() {
      const { parts, query } = App.parse();
      if (parts[0] === 'set' && Sets.get(parts[1])) return parts[1];
      if (parts[0] === 'game') {
        const g = Games.byId(parts[1]);
        if (g && Sets.get(g.set_id)) return g.set_id;
      }
      if (parts[0] === 'admin' && Sets.get(query.set)) return query.set;
      return Sets.primaryId();
    },

    // Боковое меню и верхняя панель (ТЗ: навигация по набору, наборы, уведомления, выход).
    header() {
      const user = Auth.current();
      const side = document.getElementById('sidebar');
      const top = document.getElementById('header');
      document.body.classList.toggle('no-nav', !user);
      document.body.classList.remove('nav-open');
      const brand = `<a class="brand" href="#/"><img src="assets/img/figma/logo.svg" width="40" height="40" alt=""><span>${U.esc(APP_CONFIG.brand || APP_CONFIG.appTitle)}</span></a>`;
      if (!user) {
        side.innerHTML = '';
        top.innerHTML = '';
        return;
      }
      const esc = U.esc;
      const { parts } = App.parse();
      const setId = App.currentSetId();
      const st = setId && Sets.get(setId);
      // Активный раздел: '' — главная набора; null — страница вне разделов (игра, админка…).
      const page = !parts.length ? ''
        : parts[0] === 'set' && parts[1] === setId && parts[2] !== 'play' ? (parts[2] || '') : null;
      const unread = Store.state.notifications.filter(n => n.user_id === user.id && !n.read_at).length;
      const item = (href, icon, label, active, extra = '') =>
        `<a href="${href}" class="nav-item ${active ? 'active' : ''}" ${active ? 'aria-current="page"' : ''}>${Icons.svg(icon)}<span>${label}</span>${extra}</a>`;
      const setNav = st ? [
        ['', 'home', 'Главная'], ['questions', 'folder-open', 'Вопросы'], ['bookmarks', 'bookmark', 'Закладки'],
        ['history', 'task-square', 'История'], ['analytics', 'chart', 'Аналитика'], ['sources', 'book', 'Источники']
      ].map(([p, icon, label]) => item(`#/set/${setId}${p ? '/' + p : ''}`, icon, label, page === p)).join('') : '';
      const sets = Sets.list();
      const initials = t => esc(String(t).trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase());
      const setRow = s => {
        const n = Sets.questions(s.id).length;
        return `<a href="#/set/${s.id}" class="person ${s.id === setId ? 'active' : ''}">
          <span class="avatar" aria-hidden="true">${initials(s.title)}</span>
          <span class="person-text"><b>${esc(s.title)}</b><small>${n} ${U.plural(n, 'вопрос', 'вопроса', 'вопросов')}</small></span></a>`;
      };
      side.innerHTML = `<div class="side-top">${brand}
          ${st ? `<nav class="nav-group" aria-label="Разделы набора"><p class="nav-label">Набор</p>${setNav}</nav>` : ''}
          <div class="nav-group"><p class="nav-label">Наборы</p>
            <div class="people">${sets.slice(0, 4).map(setRow).join('')}</div>
            ${sets.length > 1 ? `<a class="see-all" href="#/sets">Все наборы</a>` : ''}
          </div>
        </div>
        <div class="nav-group side-bottom"><p class="nav-label">Настройки</p>
          ${item('#/notifications', 'notification', 'Уведомления', parts[0] === 'notifications', unread ? `<span class="badge" aria-label="${unread} новых">${unread}</span>` : '')}
          ${Auth.isAdmin() ? item('#/admin', 'setting-2', 'Админ-панель', parts[0] === 'admin') : ''}
          <button class="nav-item danger" id="logout">${Icons.svg('logout')}<span>Выйти</span></button>
        </div>`;
      top.innerHTML = `<button class="icon-btn menu-btn" id="menu" aria-label="Открыть меню" aria-expanded="false">${Icons.svg('menu')}</button>
        ${st ? `<form class="search" id="search" role="search">
          <label class="search-field">${Icons.svg('search-normal')}
            <input type="search" name="q" placeholder="Поиск по вопросам…" aria-label="Поиск вопросов в наборе «${esc(st.title)}»"></label>
        </form>
        <a class="icon-btn" href="#/set/${setId}/questions" title="Фильтры вопросов" aria-label="Фильтры вопросов">${Icons.svg('filter')}</a>` : ''}`;
      side.querySelector('#logout').onclick = async () => {
        await Sync.signOut().catch(() => {});
        Auth.logout();
        App.go('#/login');
      };
      const menu = top.querySelector('#menu');
      menu.onclick = () => {
        const open = document.body.classList.toggle('nav-open');
        menu.setAttribute('aria-expanded', String(open));
      };
      const search = top.querySelector('#search');
      if (search) {
        search.onsubmit = e => {
          e.preventDefault();
          const q = search.q.value.trim();
          App.go(`#/set/${setId}/questions${q ? '?q=' + encodeURIComponent(q) : ''}`);
        };
      }
    }
  };

  // Мобильное меню закрывается по клику мимо него и по Esc.
  document.addEventListener('click', e => {
    if (!document.body.classList.contains('nav-open')) return;
    if (e.target.closest('#sidebar, #menu')) return;
    document.body.classList.remove('nav-open');
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && document.body.classList.contains('nav-open')) {
      document.body.classList.remove('nav-open');
      return;
    }
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
    // Сайт открыт не на основном адресе (GitHub Pages, <project>.web.app): переводим на siteUrl —
    // там вход Google на одном домене с сайтом. Сначала отправляем то, что ещё не ушло на сервер:
    // localStorage у каждого адреса свой.
    const site = APP_CONFIG.siteUrl && new URL(APP_CONFIG.siteUrl);
    if (site && /^https?:$/.test(location.protocol) && location.hostname !== 'localhost' && location.host !== site.host) {
      App.render('<p class="muted center">Сайт переехал — открываем новый адрес…</p>');
      if (Store.state.outbox.length && await Sync.start()) await Promise.race([Sync.flush(), new Promise(r => setTimeout(r, 5000))]);
      location.replace(site.origin + site.pathname + location.search + location.hash);
      return;
    }
    await loadSetFiles();
    Sets.syncFileSets();
    Auth.restore();
    const syncing = Sync.start(); // до первой отрисовки: экран входа ждёт Sync.ready
    window.addEventListener('hashchange', App.route);
    App.route();
    if (await syncing) {
      // Сессия Google главнее сохранённого входа: вышли в другой вкладке — выходим и здесь.
      const fb = Sync.authUser();
      let u = Auth.current();
      if (u && (!fb || fb.uid !== u.id)) {
        Auth.logout();
        u = null;
        App.go('#/login');
      }
      if (fb && !u) return App.views.completeGoogle(fb);
      Sync.flush();
      App.pull();
      // Вернулись на вкладку — подтянуть изменения с других устройств и правки админа.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && Date.now() - lastPull > PULL_EVERY_MS) App.pull();
      });
    }
  }

  // Загрузить с сервера данные пользователя и наборы вопросов, затем перерисовать.
  const PULL_EVERY_MS = 5 * 60 * 1000;
  let lastPull = 0;
  App.pull = async () => {
    const u = Auth.current();
    if (!u) return;
    lastPull = Date.now();
    const [mine, sets] = [await Sync.pullUser(u.id), await Sync.pullSets()];
    App.refresh(mine || sets);
  };

  // Перерисовать после загрузки данных с сервера. Идущую игру не трогаем — только меню.
  App.refresh = changed => {
    if (!Auth.current()) return;
    if (changed && !/\/play\//.test(location.hash)) App.route();
    else App.header();
  };

  window.App = App;
  document.addEventListener('DOMContentLoaded', boot);
})();
