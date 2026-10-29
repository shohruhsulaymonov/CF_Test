// Хранилище данных в localStorage и вход по имени.
// Вся работа с постоянными данными идёт через Store; копия на сервере — через Sync (sync.js).
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
    users: [],          // { id (= name_key), name, name_key, created_at, last_seen_at }
    sets: {},           // setId -> состояние набора (см. sets.js)
    games: [],          // { id, user_id, set_id, mode, started_at, finished_at, saved_set_id, score, percent, answers[], aggregates[], feedback[] }
    modeSettings: {},   // `${user}|${set}|${mode}` -> настройки режима
    savedSets: [],      // { id, user_id, set_id, name, mode, created_at, items: [questionNumber] }
    bookmarks: [],      // { user_id, set_id, question_id, created_at }
    reports: [],        // { id, set_id, question_id, user_id, user_name, comment, status, created_at, admin_note }
    notifications: [],  // { id, user_id, text, created_at, read_at }
    outbox: [],         // { coll, id } — ещё не отправлено на сервер (sync.js)
    // Что уже взято с сервера: версии наборов, время закладок/наборов/настроек пользователя, курсоры загрузки.
    cloud: { setVersions: {}, userdataAt: {}, cursors: {} }
  });

  const queue = (coll, id) => { if (window.Sync) Sync.queue(coll, id); };

  // Раньше id пользователя был случайным; теперь это ключ имени — один и тот же на любом устройстве.
  function remapUser(from, to) {
    const fix = x => { if (x.user_id === from) x.user_id = to; };
    ['games', 'savedSets', 'bookmarks', 'reports', 'notifications'].forEach(k => state[k].forEach(fix));
    for (const k of Object.keys(state.modeSettings)) {
      const [u, ...rest] = k.split('|');
      if (u !== from) continue;
      state.modeSettings[[to, ...rest].join('|')] = state.modeSettings[k];
      delete state.modeSettings[k];
    }
  }
  function migrateUserIds() {
    let changed = false;
    for (const u of state.users) {
      const key = u.name_key || U.nameKey(u.name);
      if (u.id === key && u.name_key === key) continue;
      remapUser(u.id, key);
      u.id = u.name_key = key;
      changed = true;
    }
    return changed;
  }

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
        migrateUserIds();
        if (Store.save()) {
          try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
        }
        return;
      }
      for (const p of PARTS) {
        try { Object.assign(state, JSON.parse(localStorage.getItem(partKey(p))) || {}); } catch (e) { /* часть повреждена — пропускаем */ }
      }
      if (migrateUserIds()) Store.save();
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
      migrateUserIds();
      Store.save();
    },

    notify(userId, text) {
      const n = { id: U.uid(), user_id: userId, text, created_at: Date.now(), read_at: null };
      state.notifications.push(n);
      queue('notifications', n.id);
    },

    // Отправить запись на сервер, когда будет связь (без Firebase — ничего не делает).
    queue,

    // Закладки, свои наборы или настройки режимов пользователя изменились.
    touchUserdata(userId) {
      state.cloud.userdataAt[userId] = Date.now();
      queue('userdata', userId);
    }
  };

  const ROLE_ADMIN = 'admin';
  const adminKeys = () => (APP_CONFIG.adminNames || []).map(U.nameKey);

  const Auth = {
    validate(name) {
      const n = String(name || '').trim();
      if (n.length < 2) return 'Имя должно содержать не менее 2 символов';
      if (n.length > 30) return 'Имя должно содержать не более 30 символов';
      if (n.includes('/')) return 'Имя не может содержать «/»';
      if (!/[\p{L}\p{N}]/u.test(n)) return 'Имя должно содержать букву или цифру';
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
        user = { id: key, name: String(name).trim(), name_key: key, created_at: Date.now(), last_seen_at: Date.now() };
        state.users.push(user);
      }
      return Auth._enter(user);
    },

    // Вход через Google (sync.js): профиль { id: uid, name, email, created_at }.
    enterAccount(profile) {
      let user = state.users.find(u => u.id === profile.id);
      if (!user) {
        user = { id: profile.id, created_at: profile.created_at || Date.now() };
        state.users.push(user);
      }
      Object.assign(user, { name: String(profile.name).trim(), name_key: U.nameKey(profile.name), email: profile.email || '' });
      return Auth._enter(user);
    },

    // Профили входа по имени на этом устройстве с завершёнными играми — их можно перенести в аккаунт.
    legacyProfiles: () => state.users.filter(u => !u.email && u.id === u.name_key)
      .map(u => ({ user: u, games: state.games.filter(g => g.user_id === u.id && g.finished_at).length }))
      .filter(x => x.games),

    // Перенести историю профиля по имени в аккаунт; старый профиль удаляется.
    absorb(fromId, toId) {
      remapUser(fromId, toId);
      state.users = state.users.filter(u => u.id !== fromId);
      Store.save();
      state.games.filter(g => g.user_id === toId && g.finished_at).forEach(g => queue('games', g.id));
      state.reports.filter(r => r.user_id === toId).forEach(r => queue('reports', r.id));
      queue('stats', toId);
    },

    _enter(user) {
      user.last_seen_at = Date.now();
      Store.save('misc');
      queue('users', user.id);
      try { localStorage.setItem(USER_KEY, user.id); } catch (e) { /* без запоминания */ }
      Auth._current = user;
      return user;
    },

    restore() {
      let saved = null;
      try { saved = localStorage.getItem(USER_KEY); } catch (e) { /* нет доступа */ }
      if (!saved) return null;
      // Раньше здесь хранилось имя, теперь — id.
      const user = state.users.find(u => u.id === saved) || Auth.find(saved);
      if (user) {
        user.last_seen_at = Date.now();
        Store.save('misc');
        queue('users', user.id);
      }
      Auth._current = user;
      return user;
    },

    logout() {
      try { localStorage.removeItem(USER_KEY); } catch (e) { /* ignore */ }
      Auth._current = null;
    },

    current: () => Auth._current || null,
    // С Firebase админ — Google-аккаунт из adminEmails; без него — имя из adminNames.
    role(user) {
      if (!user) return 'student';
      if (window.Sync && Sync.configured()) {
        const fb = Sync.authUser();
        return fb && fb.uid === user.id && Sync.isAdminSession() ? ROLE_ADMIN : 'student';
      }
      return Auth.isAdminKey(user.name_key) ? ROLE_ADMIN : 'student';
    },
    isAdmin: () => Auth.role(Auth.current()) === ROLE_ADMIN,
    _current: null
  };

  window.Store = Store;
  window.Auth = Auth;
})();
