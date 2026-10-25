// Хранилище данных в localStorage и вход по имени.
// Вся работа с постоянными данными идёт через Store — его можно заменить серверным API.
(function () {
  const KEY = 'examTrainer.v1';            // старый формат: всё одним объектом
  const USER_KEY = 'examTrainer.user';
  // Данные лежат в трёх ключах, чтобы ответ в игре не переписывал наборы вопросов (сотни КБ).
  // misc — всё, кроме sets и games.
  const PARTS = ['sets', 'games', 'misc'];
  const partKey = p => `${KEY}.${p}`;
  const partOf = p => {
    if (p !== 'misc') return { [p]: state[p] };
    const { sets, games, ...rest } = state;
    return rest;
  };

  const empty = () => ({
    version: 1,
    users: [],          // { id, name, name_key, created_at, last_seen_at }
    sets: {},           // setId -> состояние набора (см. sets.js)
    games: [],          // { id, user_id, set_id, mode, started_at, finished_at, saved_set_id, score, percent, answers[], aggregates[], feedback[] }
    modeSettings: {},   // `${user}|${set}|${mode}` -> настройки режима
    savedSets: [],      // { id, user_id, set_id, name, mode, created_at, items: [questionNumber] }
    bookmarks: [],      // { user_id, set_id, question_id, created_at }
    reports: [],        // { id, set_id, question_id, user_id, comment, status, created_at, admin_note }
    notifications: []   // { id, user_id, text, created_at, read_at }
  });

  let state = empty();

  const Store = {
    get state() { return state; },

    load() {
      state = empty();
      let legacy = null;
      try { legacy = localStorage.getItem(KEY); } catch (e) { return; }
      if (legacy != null) {
        // Перенос из одного ключа в три; старый ключ удаляем, только если запись удалась.
        try { Object.assign(state, JSON.parse(legacy)); } catch (e) { /* повреждён — начинаем с пустых данных */ }
        if (Store.save()) {
          try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
        }
        return;
      }
      for (const p of PARTS) {
        try { Object.assign(state, JSON.parse(localStorage.getItem(partKey(p))) || {}); } catch (e) { /* часть повреждена — пропускаем */ }
      }
    },

    // Store.save() пишет всё; Store.save('games') — только изменённые части. Возвращает успех.
    save(...parts) {
      try {
        for (const p of parts.length ? parts : PARTS) localStorage.setItem(partKey(p), JSON.stringify(partOf(p)));
        return true;
      } catch (e) {
        U.toast('Не удалось сохранить данные: хранилище браузера недоступно или переполнено', 'error');
        return false;
      }
    },

    // Резервная копия всех данных и восстановление из неё.
    exportAll: () => JSON.stringify(state),
    importAll(json) {
      state = Object.assign(empty(), JSON.parse(json));
      Store.save();
    },

    notify(userId, text) {
      state.notifications.push({ id: U.uid(), user_id: userId, text, created_at: Date.now(), read_at: null });
    }
  };

  const ROLE_ADMIN = 'admin';
  const adminKeys = () => (APP_CONFIG.adminNames || []).map(U.nameKey);

  const Auth = {
    validate(name) {
      const n = String(name || '').trim();
      if (n.length < 2) return 'Имя должно содержать не менее 2 символов';
      if (n.length > 30) return 'Имя должно содержать не более 30 символов';
      return null;
    },

    isAdminKey: key => adminKeys().includes(key),

    find(name) {
      const key = U.nameKey(name);
      return state.users.find(u => u.name_key === key) || null;
    },

    // Возвращает пользователя; создаёт его, если create = true или это админ из конфигурации.
    login(name, create) {
      const err = Auth.validate(name);
      if (err) throw new Error(err);
      const key = U.nameKey(name);
      let user = Auth.find(name);
      if (!user) {
        if (!create && !Auth.isAdminKey(key)) return null;
        user = { id: U.uid(), name: String(name).trim(), name_key: key, created_at: Date.now(), last_seen_at: Date.now() };
        state.users.push(user);
      }
      user.last_seen_at = Date.now();
      Store.save('misc');
      try { localStorage.setItem(USER_KEY, user.name); } catch (e) { /* без запоминания */ }
      Auth._current = user;
      return user;
    },

    restore() {
      let name = null;
      try { name = localStorage.getItem(USER_KEY); } catch (e) { /* нет доступа */ }
      if (!name) return null;
      const user = Auth.find(name);
      if (user) {
        user.last_seen_at = Date.now();
        Store.save('misc');
      }
      Auth._current = user;
      return user;
    },

    logout() {
      try { localStorage.removeItem(USER_KEY); } catch (e) { /* ignore */ }
      Auth._current = null;
    },

    current: () => Auth._current || null,
    role: user => (user && Auth.isAdminKey(user.name_key) ? ROLE_ADMIN : 'student'),
    isAdmin: () => Auth.role(Auth.current()) === ROLE_ADMIN,
    _current: null
  };

  window.Store = Store;
  window.Auth = Auth;
})();
