// Синхронизация с Firebase (Firestore). Главная копия данных — на сервере; localStorage — кэш
// для работы без сети, изменения копятся в очереди Store.state.outbox и отправляются при связи.
// Вход — через Google (Firebase Auth); id пользователя — uid Firebase.
// Коллекции: users (id = uid), games, stats (сводка пользователя), reports, notifications,
// userdata (закладки, свои наборы, настройки режимов), sets + sets/{id}/chunks (наборы вопросов, пишет админ).
// Без настроек firebase в config.js модуль ничего не делает.
(function () {
  const SDK = 'https://www.gstatic.com/firebasejs/10.14.1/';
  const TIMEOUT_MS = 6000;
  const ADMIN_TTL_MS = 5 * 60 * 1000;
  const CHUNK = 200; // вопросов в одном документе (лимит Firestore — 1 МБ на документ)
  const st = () => Store.state;
  const configured = () => !!(window.APP_CONFIG && APP_CONFIG.firebase && APP_CONFIG.firebase.projectId);

  let db = null, auth = null, settled = !configured(), flushing = false, timer = null;
  let adminCache = null;              // { at, users, stats } — только в памяти
  const remoteGames = new Map();      // игры других пользователей, открытые админом

  const withTimeout = (p, ms = TIMEOUT_MS) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error('timeout')), ms))]);

  const loadScript = src => new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Не удалось загрузить ' + src));
    document.head.appendChild(s);
  });

  async function init() {
    if (!window.firebase) {
      for (const part of ['app', 'auth', 'firestore']) await loadScript(`${SDK}firebase-${part}-compat.js`);
    }
    if (!firebase.apps.length) firebase.initializeApp(APP_CONFIG.firebase);
    auth = firebase.auth();
    await new Promise(resolve => { const off = auth.onAuthStateChanged(() => { off(); resolve(); }); });
    db = firebase.firestore();
    return true;
  }

  // ---------- Слияние (чистые функции, без сети) ----------
  // remote: { games, reports, notifications }; pending — id из очереди, их локальная версия новее.
  function merge(state, remote, pending = new Set()) {
    let changed = false;
    const byId = list => new Map(list.map(x => [x.id, x]));
    const games = byId(state.games);
    for (const g of remote.games || []) {
      if (!games.has(g.id)) { state.games.push(g); changed = true; }
    }
    const reports = byId(state.reports);
    for (const r of remote.reports || []) {
      const mine = reports.get(r.id);
      if (!mine) { state.reports.push(r); changed = true; } else if (!pending.has('reports/' + r.id) &&
        (mine.status !== r.status || mine.admin_note !== r.admin_note)) {
        mine.status = r.status;
        mine.admin_note = r.admin_note;
        changed = true;
      }
    }
    const notes = byId(state.notifications);
    for (const n of remote.notifications || []) {
      const mine = notes.get(n.id);
      if (!mine) { state.notifications.push(n); changed = true; } else if (n.read_at && !mine.read_at) { mine.read_at = n.read_at; changed = true; }
    }
    return changed;
  }

  // Закладки, свои наборы и настройки режимов одного пользователя.
  function userdataOf(state, uid) {
    const prefix = uid + '|';
    return {
      bookmarks: state.bookmarks.filter(b => b.user_id === uid),
      savedSets: state.savedSets.filter(x => x.user_id === uid),
      modeSettings: Object.fromEntries(Object.entries(state.modeSettings).filter(([k]) => k.startsWith(prefix)))
    };
  }

  // Последняя запись побеждает. remote: { updated_at, data } или null.
  // Возвращает 'pulled' (взяли с сервера), 'push' (локальное новее) или 'same'.
  function mergeUserdata(state, uid, remote) {
    const localAt = state.cloud.userdataAt[uid] || 0;
    if (remote && remote.updated_at > localAt) {
      const prefix = uid + '|';
      state.bookmarks = state.bookmarks.filter(b => b.user_id !== uid).concat(remote.data.bookmarks || []);
      state.savedSets = state.savedSets.filter(x => x.user_id !== uid).concat(remote.data.savedSets || []);
      for (const k of Object.keys(state.modeSettings)) if (k.startsWith(prefix)) delete state.modeSettings[k];
      Object.assign(state.modeSettings, remote.data.modeSettings || {});
      state.cloud.userdataAt[uid] = remote.updated_at;
      return 'pulled';
    }
    const mine = userdataOf(state, uid);
    const hasLocal = mine.bookmarks.length || mine.savedSets.length || Object.keys(mine.modeSettings).length;
    if (remote ? localAt > remote.updated_at : hasLocal) return 'push';
    return 'same';
  }

  // Набор вопросов ↔ документы: метаданные без вопросов и куски по CHUNK вопросов.
  function splitSet(set) {
    const rest = Object.assign({}, set);
    delete rest.questions;
    const qs = Object.values(set.questions || {}).sort((a, b) => a.number - b.number);
    const chunks = [];
    for (let i = 0; i < qs.length; i += CHUNK) chunks.push(qs.slice(i, i + CHUNK));
    return { meta: rest, chunks };
  }
  function joinSet(meta, chunks) {
    const set = Object.assign({}, meta, { questions: {} });
    for (const part of chunks) for (const q of part) set.questions[q.number] = q;
    return set;
  }

  // ---------- Документы для отправки ----------
  const clean = x => JSON.parse(JSON.stringify(x));
  function docFor(coll, id) {
    const s = st();
    if (coll === 'users') {
      const u = s.users.find(x => x.id === id);
      return u && { id: u.id, name: u.name, email: u.email || '', created_at: u.created_at, last_seen_at: u.last_seen_at };
    }
    if (coll === 'games') {
      // Игра целиком — строкой JSON: Firestore не принимает вложенные массивы и undefined.
      const g = s.games.find(x => x.id === id);
      return g && g.finished_at && {
        id: g.id, user_id: g.user_id, set_id: g.set_id, mode: g.mode, started_at: g.started_at,
        finished_at: g.finished_at, percent: g.percent, data: JSON.stringify(g)
      };
    }
    if (coll === 'stats') {
      const u = s.users.find(x => x.id === id);
      const games = s.games.filter(g => g.user_id === id);
      return { user_id: id, name: u ? u.name : id, updated_at: Date.now(), data: JSON.stringify(Stats.summary(games)) };
    }
    if (coll === 'userdata') {
      return { user_id: id, updated_at: s.cloud.userdataAt[id] || Date.now(), data: JSON.stringify(userdataOf(s, id)) };
    }
    const item = (coll === 'reports' ? s.reports : s.notifications).find(x => x.id === id);
    return item && clean(item);
  }

  const parseGame = d => { try { return JSON.parse(d.data); } catch (e) { return null; } };
  const parseStats = d => { try { return Object.assign({ user_id: d.user_id, name: d.name, updated_at: d.updated_at }, { sets: JSON.parse(d.data) }); } catch (e) { return null; } };
  const strip = d => { const x = Object.assign({}, d); delete x._ts; return x; };
  const fetchAll = async (coll, field, value) => {
    let q = db.collection(coll);
    if (field) q = q.where(field, '==', value);
    const snap = await withTimeout(q.get(), 20000);
    return snap.docs.map(d => strip(d.data()));
  };

  // Только изменённое после cursor (мс серверного времени _ts). Нужен составной индекс
  // user_id + _ts (firestore.indexes.json); без него — полная загрузка и ссылка на индекс в консоли.
  let indexWarned = false;
  async function fetchSince(coll, uid, cursor) {
    const base = db.collection(coll).where('user_id', '==', uid);
    let snap;
    try {
      snap = await withTimeout((cursor ? base.where('_ts', '>', firebase.firestore.Timestamp.fromMillis(cursor)) : base).get(), 20000);
    } catch (e) {
      if (e.code !== 'failed-precondition') throw e;
      if (!indexWarned) { indexWarned = true; console.warn('Нет индекса Firestore, загружаю всё:', e.message); }
      snap = await withTimeout(base.get(), 20000);
    }
    let max = cursor || 0;
    const rows = snap.docs.map(d => {
      const ts = d.get('_ts');
      if (ts && ts.toMillis) max = Math.max(max, ts.toMillis());
      return strip(d.data());
    });
    return { rows, max };
  }

  async function writeSet(id) {
    const set = st().sets[id];
    const ref = db.collection('sets').doc(id);
    const version = Date.now();
    const old = await ref.get();
    const oldChunks = old.exists ? old.get('chunks') || 0 : 0;
    const batch = db.batch();
    const ts = firebase.firestore.FieldValue.serverTimestamp();
    if (!set) {
      batch.set(ref, { id, version, deleted: true, chunks: 0, data: '{}', _ts: ts });
    } else {
      const { meta, chunks } = splitSet(set);
      batch.set(ref, { id, version, deleted: false, chunks: chunks.length, data: JSON.stringify(meta), _ts: ts });
      chunks.forEach((part, i) => batch.set(ref.collection('chunks').doc(String(i)), { version, data: JSON.stringify(part) }));
    }
    const keep = set ? Math.ceil(Object.keys(set.questions).length / CHUNK) : 0;
    for (let i = keep; i < oldChunks; i++) batch.delete(ref.collection('chunks').doc(String(i)));
    await batch.commit();
    st().cloud.setVersions[id] = version;
  }

  const Sync = {
    configured,
    get online() { return !!(db && auth && auth.currentUser); },
    // Пользователь Firebase этого браузера (null — не вошёл или Firebase не загружен).
    authUser: () => (auth && auth.currentUser) || null,
    // Пока Firebase загружается, админ-права ещё не известны.
    get pending() { return !settled; },
    ready: Promise.resolve(false),
    merge, mergeUserdata, userdataOf, splitSet, joinSet,

    start() {
      if (!configured()) return Sync.ready;
      Sync.ready = init().catch(e => { console.warn('Синхронизация недоступна:', e.message || e); db = null; return false; })
        .then(ok => { settled = true; return ok; });
      window.addEventListener('online', () => Sync.flush());
      return Sync.ready;
    },

    // ---------- Очередь отправки ----------
    queue(coll, id) {
      if (!configured() || id == null) return;
      const s = st();
      if (!s.outbox.some(x => x.coll === coll && x.id === id)) s.outbox.push({ coll, id });
      Store.save('misc');
      clearTimeout(timer);
      timer = setTimeout(() => Sync.flush(), 800);
    },

    async flush() {
      if (!Sync.online || flushing) return;
      flushing = true;
      try {
        const ts = firebase.firestore.FieldValue.serverTimestamp();
        const uid = auth.currentUser.uid, admin = Sync.isAdminSession();
        for (const item of st().outbox.slice()) {
          const sets = item.coll === 'sets';
          const doc = sets ? null : docFor(item.coll, item.id);
          // Записи другого аккаунта ждут его входа: правила всё равно их отклонят.
          const owner = doc && (item.coll === 'users' ? doc.id : doc.user_id);
          if (doc && owner !== uid && !admin) continue;
          try {
            if (sets) {
              if (admin) await writeSet(item.id); // наборы публикует только админ; у ученика запись просто убирается
            } else if (doc) {
              await db.collection(item.coll).doc(String(item.id)).set(Object.assign(doc, { _ts: ts }), { merge: true });
            }
          } catch (e) {
            // Сеть — повторим позже; отказ правил или неверные данные — повтор не поможет.
            if (e.code !== 'permission-denied' && e.code !== 'invalid-argument') break;
            console.warn('Не отправлено', item, e.message);
          }
          st().outbox = st().outbox.filter(x => !(x.coll === item.coll && x.id === item.id));
          Store.save('misc');
        }
      } finally {
        flushing = false;
      }
    },

    // ---------- Пользователь ----------
    async signInGoogle() {
      if (!(await Sync.ready) || !auth) throw new Error('Нет связи с сервером входа. Проверьте интернет и обновите страницу.');
      if (location.protocol === 'file:') throw new Error('Вход через Google работает только на сайте (https://), а не из файла.');
      const provider = new firebase.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      try {
        return (await auth.signInWithPopup(provider)).user;
      } catch (e) {
        if (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request') return null;
        if (e.code === 'auth/popup-blocked') throw new Error('Браузер заблокировал окно входа. Разрешите всплывающие окна для сайта и попробуйте ещё раз.');
        if (e.code === 'auth/unauthorized-domain') throw new Error('Этот адрес сайта не добавлен в Firebase → Authentication → Authorized domains.');
        throw new Error('Не удалось войти: ' + (e.message || e.code));
      }
    },

    async signOut() {
      await withTimeout(Sync.flush(), 3000).catch(() => {});
      adminCache = null;
      remoteGames.clear();
      if (auth && auth.currentUser) await auth.signOut();
    },

    // Профиль на сервере; null — ещё не создан или нет связи.
    async findUser(uid) {
      if (!(await Sync.ready) || !Sync.online) return null;
      try {
        const d = await withTimeout(db.collection('users').doc(uid).get());
        return d.exists ? strip(d.data()) : null;
      } catch (e) {
        return null;
      }
    },

    // Свои игры, отчёты, уведомления (только новое с прошлого раза) и закладки/наборы/настройки.
    // При первой загрузке на устройстве локальное, чего нет на сервере, ставится в очередь.
    async pullUser(userId) {
      if (!(await Sync.ready) || !Sync.online) return false;
      try {
        const cur = st().cloud.cursors[userId] || (st().cloud.cursors[userId] = {});
        const first = !cur.games;
        const [g, r, n, ud] = await Promise.all([
          fetchSince('games', userId, cur.games), fetchSince('reports', userId, cur.reports),
          fetchSince('notifications', userId, cur.notifications),
          withTimeout(db.collection('userdata').doc(userId).get(), 20000)]);
        const pending = new Set(st().outbox.map(x => x.coll + '/' + x.id));
        let changed = merge(st(), { games: g.rows.map(parseGame).filter(Boolean), reports: r.rows, notifications: n.rows }, pending);
        Object.assign(cur, { games: g.max, reports: r.max, notifications: n.max });

        let remote = null;
        if (ud.exists) { try { remote = { updated_at: ud.get('updated_at'), data: JSON.parse(ud.get('data')) }; } catch (e) { /* повреждён */ } }
        const how = pending.has('userdata/' + userId) ? 'push' : mergeUserdata(st(), userId, remote);
        if (how === 'pulled') changed = true;
        if (how === 'push') Sync.queue('userdata', userId);

        let missing = [];
        if (first) {
          const have = new Set(g.rows.map(x => x.id));
          missing = st().games.filter(x => x.user_id === userId && x.finished_at && !have.has(x.id));
          missing.forEach(x => Sync.queue('games', x.id));
          const haveR = new Set(r.rows.map(x => x.id));
          st().reports.filter(x => x.user_id === userId && !haveR.has(x.id)).forEach(x => Sync.queue('reports', x.id));
        }
        if (g.rows.length || missing.length) Sync.queue('stats', userId);
        Store.save();
        return changed;
      } catch (e) {
        console.warn('Не удалось загрузить данные пользователя:', e.message || e);
        return false;
      }
    },

    // Наборы вопросов с сервера: метаданные всегда, куски — только у изменившихся.
    // Затем файлы из sets/ применяются поверх (если файл новее того, что опубликовал админ).
    // Админ публикует наборы, которых на сервере нет или которые обновились из файла.
    async pullSets() {
      if (!(await Sync.ready) || !Sync.online) return false;
      try {
        const s = st();
        const metas = await fetchAll('sets');
        const pending = new Set(s.outbox.map(x => x.coll + '/' + x.id));
        let changed = false;
        for (const m of metas) {
          if ((s.cloud.setVersions[m.id] || 0) >= m.version || pending.has('sets/' + m.id)) continue;
          if (m.deleted) {
            if (s.sets[m.id]) { delete s.sets[m.id]; changed = true; }
            s.cloud.setVersions[m.id] = m.version;
            continue;
          }
          const snap = await withTimeout(db.collection('sets').doc(m.id).collection('chunks').get(), 20000);
          const parts = snap.docs.filter(d => d.get('version') === m.version)
            .sort((a, b) => +a.id - +b.id).map(d => JSON.parse(d.get('data')));
          if (parts.length !== m.chunks) continue; // админ как раз публикует — возьмём в следующий раз
          const before = s.sets[m.id];
          const set = joinSet(JSON.parse(m.data), parts);
          const hidden = Object.values(set.questions).filter(q => q.deleted_at && !(before && before.questions[q.number] && before.questions[q.number].deleted_at));
          Sets.replaceFromCloud(m.id, set);
          hidden.forEach(q => Sets.dropFromSavedSets(m.id, q.number));
          s.cloud.setVersions[m.id] = m.version;
          changed = true;
        }
        if (changed) Sets.syncFileSets();
        if (Sync.isAdminSession()) {
          const cloud = new Map(metas.map(m => [m.id, m]));
          for (const [id, set] of Object.entries(s.sets)) {
            const m = cloud.get(id);
            let hash = null;
            try { hash = m && !m.deleted ? JSON.parse(m.data).syncedHash : null; } catch (e) { /* повреждён */ }
            if (!m || m.deleted || hash !== set.syncedHash) Sync.queue('sets', id);
          }
        }
        Store.save();
        return changed;
      } catch (e) {
        console.warn('Не удалось загрузить наборы:', e.message || e);
        return false;
      }
    },

    // ---------- Администратор ----------
    isAdminSession() {
      const u = auth && auth.currentUser;
      const list = (APP_CONFIG.adminEmails || []).map(e => e.trim().toLowerCase());
      return !!(u && u.email && u.emailVerified && list.includes(u.email.toLowerCase()));
    },

    // Пользователи и сводки для «Статистики». Без Firebase — из данных этого браузера.
    // Возвращает { users, stats: Map(userId → { name, sets }), at, remote }.
    async adminData(force) {
      if (!configured()) {
        const users = st().users.map(u => Object.assign({}, u));
        const stats = new Map(users.map(u => [u.id, { user_id: u.id, name: u.name, sets: Stats.summary(st().games.filter(g => g.user_id === u.id)) }]));
        return { users, stats, at: Date.now(), remote: false };
      }
      if (!force && adminCache && Date.now() - adminCache.at < ADMIN_TTL_MS) return adminCache;
      if (!(await Sync.ready) || !Sync.isAdminSession()) throw new Error('Нет связи с сервером или вход администратора не подтверждён.');
      await Sync.flush();
      const [users, stats] = await Promise.all([fetchAll('users'), fetchAll('stats')]);
      adminCache = {
        users, at: Date.now(), remote: true,
        stats: new Map(stats.map(parseStats).filter(Boolean).map(s => [s.user_id, s]))
      };
      return adminCache;
    },

    // Все отчёты — в локальные данные админа (их немного).
    async pullReports() {
      if (!configured() || !(await Sync.ready) || !Sync.isAdminSession()) return false;
      try {
        await Sync.flush();
        const pending = new Set(st().outbox.map(x => x.coll + '/' + x.id));
        const changed = merge(st(), { reports: await fetchAll('reports') }, pending);
        if (changed) Store.save('misc');
        return changed;
      } catch (e) {
        console.warn('Не удалось загрузить отчёты:', e.message || e);
        return false;
      }
    },

    // Игры одного пользователя (для админа). Без Firebase — локальные.
    async userGames(userId) {
      const local = st().games.filter(g => g.user_id === userId && g.finished_at);
      if (!configured() || !(await Sync.ready) || !Sync.isAdminSession()) return local;
      const games = (await fetchAll('games', 'user_id', userId)).map(parseGame).filter(Boolean);
      games.forEach(g => remoteGames.set(g.id, g));
      const ids = new Set(games.map(g => g.id));
      return games.concat(local.filter(g => !ids.has(g.id)));
    },

    cachedGame: id => remoteGames.get(id) || null
  };

  window.Sync = Sync;
})();
