// Экраны: вход, панель набора и настройки режимов, «Другие наборы», вопросы, закладки,
// история, источники, уведомления.
(function () {
  const V = App.views;
  const esc = U.esc;
  const me = () => Auth.current();
  const qWord = n => U.plural(n, 'вопрос', 'вопроса', 'вопросов');

  // Заголовок раздела набора. Навигация по разделам — в боковом меню (app.js).
  const PAGE_NAMES = { questions: 'Вопросы и наборы', bookmarks: 'Закладки', history: 'История', analytics: 'Аналитика', sources: 'Источники' };
  V.setHeader = (setId, active) => {
    const st = Sets.get(setId);
    return `<section class="page-head">
      <p class="kicker">${esc(st.title)}</p>
      <h1>${PAGE_NAMES[active] || esc(st.title)}</h1></section>`;
  };

  const initials = t => esc(String(t).trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase());

  function greeting(name) {
    const h = +new Intl.DateTimeFormat('en-GB', { timeZone: APP_CONFIG.timeZone, hour: '2-digit', hourCycle: 'h23' }).format(new Date());
    const part = h < 5 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер';
    return `${part}, ${esc(name)}`;
  }

  // Кольцо вокруг аватара: доля — средний результат.
  function ring(pct, label) {
    const r = 46.3, c = 2 * Math.PI * r;
    const dash = pct == null ? 0 : (c * pct) / 100;
    return `<div class="ring" role="img" aria-label="${pct == null ? 'Средний результат пока не посчитан' : 'Средний результат ' + pct + '%'}">
      <svg width="100" height="100" viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r="${r}" class="ring-track"/>
        <circle cx="50" cy="50" r="${r}" class="ring-arc" stroke-dasharray="${dash.toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 50 50)"/>
      </svg><span class="avatar xl">${initials(label)}</span></div>`;
  }

  // Ответы пользователя в наборе (без повторов Карточек).
  const myAnswers = (userId, setId) => Store.state.games
    .filter(g => g.user_id === userId && g.set_id === setId)
    .flatMap(g => g.answers.filter(a => !a.is_repeat));

  // Темы с худшим результатом — минимум 3 ответа, как в разборе.
  function weakThemes(setId, answers) {
    const by = new Map();
    for (const a of answers) {
      const x = by.get(a.category_id_at_answer) || { answers: 0, correct: 0 };
      x.answers++;
      if (a.correct) x.correct++;
      by.set(a.category_id_at_answer, x);
    }
    const live = new Set(Sets.categories(setId).filter(c => c.count).map(c => c.id));
    return [...by.entries()].filter(([id, x]) => live.has(id) && x.answers >= 3)
      .map(([id, x]) => ({ id, ...x, pct: Engine.percent(x.correct, x.answers) }))
      .sort((a, b) => a.pct - b.pct || b.answers - a.answers);
  }

  // Ответы за последние 5 дней: верные и неверные — два слоя столбца.
  function activityBars(answers) {
    const today = U.dayKey(Date.now());
    const days = [-4, -3, -2, -1, 0].map(d => U.addDays(today, d));
    const rows = days.map(k => {
      const day = answers.filter(a => U.dayKey(a.answered_at) === k);
      return { k, ok: day.filter(a => a.correct).length, bad: day.filter(a => !a.correct).length };
    });
    const max = Math.max(1, ...rows.map(r => r.ok + r.bad));
    const wd = k => ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'][new Date(k + 'T00:00:00Z').getUTCDay()];
    return `<div class="bars" role="img" aria-label="Ответы за 5 дней: ${rows.map(r => `${U.keyToRu(r.k)} — ${r.ok} верных, ${r.bad} неверных`).join('; ')}">
      ${rows.map(r => `<div class="bar-col" title="${U.keyToRu(r.k)}: верных ${r.ok}, неверных ${r.bad}">
        <div class="bar-stack" style="height:${Math.round(((r.ok + r.bad) / max) * 100)}%">
          <span class="seg-bad" style="flex:${r.bad}"></span><span class="seg-ok" style="flex:${r.ok}"></span></div>
        <span class="bar-label">${wd(r.k)}</span></div>`).join('')}
    </div>
    <p class="legend"><span><i class="seg-ok"></i>верно</span><span><i class="seg-bad"></i>неверно</span></p>`;
  }

  V.notFound = (msg = 'Страница не найдена') => App.render(`<div class="card center"><h2>${esc(msg)}</h2><a class="btn" href="#/">На главную</a></div>`);

  V.noSets = () => App.render(`<div class="card"><h2>Нет ни одного набора вопросов</h2>
    <p>Создайте файл набора командой <code>python tools/build_set.py файл.xlsx --id имя --title "Название"</code>
    или загрузите Excel в админ-панели.</p>${Auth.isAdmin() ? '<a class="btn primary" href="#/admin/import">Админ-панель</a>' : ''}</div>`);

  // ---------- Вход ----------
  V.login = () => {
    if (me()) return App.go('#/');
    if (Sync.configured()) return googleLogin();
    const root = App.render(`<div class="login card">
      <h1>${esc(APP_CONFIG.appTitle)}</h1>
      <p class="muted">Введите имя, чтобы войти или создать профиль. Пароль не нужен.</p>
      <form id="login-form" novalidate>
        <label for="name">Ваше имя</label>
        <input id="name" name="name" maxlength="40" autocomplete="nickname" required>
        <p class="field-error" id="login-err" role="alert"></p>
        <button class="btn primary big" type="submit">Войти</button>
      </form></div>`);
    const form = U.$('#login-form', root);
    const err = U.$('#login-err', root);
    U.$('#name', root).focus();
    form.onsubmit = async e => {
      e.preventDefault();
      const name = form.name.value;
      const problem = Auth.validate(name);
      if (problem) { err.textContent = problem; return; }
      let user = Auth.login(name, false);
      if (!user) {
        const ok = await U.confirm(`Создать профиль «${name.trim()}»?`, 'Создать');
        if (!ok) return;
        user = Auth.login(name, true);
      }
      App.go('#/');
    };
  };

  // Вход через Google (Firebase). Кнопка доступна, когда Firebase загрузился.
  function googleLogin() {
    const root = App.render(`<div class="login card">
      <h1>${esc(APP_CONFIG.appTitle)}</h1>
      <p class="muted">Войдите через Google-аккаунт. История игр сохраняется в аккаунте и доступна на любом устройстве.</p>
      <p class="field-error" id="login-err" role="alert"></p>
      <button class="btn primary big" id="google" disabled>Загрузка…</button>
      <button class="btn ghost big" id="google-redirect" hidden>Войти через страницу Google</button></div>`);
    const btn = U.$('#google', root);
    const alt = U.$('#google-redirect', root);
    const err = U.$('#login-err', root);
    let off = () => {};
    Sync.ready.then(ok => {
      if (!ok) { err.textContent = 'Не удалось подключиться к серверу входа. Проверьте интернет и обновите страницу.'; return; }
      btn.disabled = false;
      btn.textContent = 'Войти через Google';
      if (Sync.redirectError) { err.textContent = Sync.redirectError; alt.hidden = false; }
      // Вход мог завершиться и без ответа окна — тогда продолжаем, как только Firebase сообщит о нём.
      off = Sync.onAuthChange(fb => {
        if (!root.isConnected) return off();
        if (fb && !me()) { off(); V.completeGoogle(fb); }
      });
    });
    const run = async redirect => {
      err.textContent = '';
      btn.disabled = alt.disabled = true;
      try {
        const fb = await Sync.signInGoogle(redirect);
        if (fb) await V.completeGoogle(fb);
      } catch (x) {
        err.textContent = x.message;
        if (x.code === 'closed') alt.hidden = false;
      }
      if (btn.isConnected) btn.disabled = alt.disabled = false;
    };
    btn.onclick = () => run(false);
    alt.onclick = () => run(true);
  }

  // После входа в Google: профиль с сервера или новый (спросить имя для админ-панели),
  // затем перенос истории прежнего входа по имени с этого устройства.
  let completing = false;
  V.completeGoogle = async fb => {
    if (completing || me()) return false; // окно и подписка на вход могут сработать одновременно
    completing = true;
    try {
      return await finishGoogle(fb);
    } finally {
      completing = false;
    }
  };

  async function finishGoogle(fb) {
    let profile = await Sync.findUser(fb.uid);
    if (!profile) {
      const name = await askName(fb.displayName || '');
      if (name == null) { await Sync.signOut(); return false; }
      profile = { id: fb.uid, name, created_at: Date.now() };
    }
    profile.email = fb.email;
    const user = Auth.enterAccount(profile);
    for (const { user: old, games } of Auth.legacyProfiles()) {
      const ok = await U.confirm(`На этом устройстве есть история профиля «${old.name}»: ${games} ${U.plural(games, 'игра', 'игры', 'игр')}. Перенести её в ваш аккаунт?`, 'Перенести');
      if (ok) Auth.absorb(old.id, user.id);
    }
    App.go('#/');
    App.pull();
    return true;
  };

  // Имя нового пользователя; null — отказался.
  const askName = suggested => new Promise(resolve => {
    let done = false;
    const m = U.modal(`<h2>Как вас зовут?</h2>
      <p class="muted">Имя увидит администратор в статистике. Например: «Анна Каримова».</p>
      <form id="name-form" novalidate><input name="name" maxlength="40" value="${esc(suggested)}" required>
        <p class="field-error" role="alert"></p>
        <div class="row end"><button class="btn primary">Продолжить</button></div></form>`,
    { onClose: () => { if (!done) resolve(null); } });
    const form = U.$('#name-form', m.root);
    form.onsubmit = e => {
      e.preventDefault();
      const problem = Auth.validate(form.name.value);
      if (problem) { U.$('.field-error', form).textContent = problem; return; }
      done = true;
      m.close();
      resolve(form.name.value.trim());
    };
  });

  // ---------- Панель набора ----------
  function poolSummary(setId, mode) {
    const s = Games.settings(me().id, setId, mode);
    if (s.active_set_id) {
      const ss = Store.state.savedSets.find(x => x.id === s.active_set_id);
      if (ss) return `Набор «${esc(ss.name)}» · ${ss.items.length} ${qWord(ss.items.length)}`;
    }
    const n = Games.pool(setId, s).length;
    const parts = [`Пул: ${n} ${qWord(n)}`];
    if (!s.repeat) parts.push('без повторов');
    if (mode === 'cards') parts.push(`колода ${s.deck}`);
    if (mode === 'quiz') parts.push(`${s.quizCount} вопросов`);
    return parts.join(' · ');
  }

  V.dashboard = setId => {
    const u = me();
    const st = Sets.get(setId);
    const qs = Sets.questions(setId);
    const themes = Sets.categories(setId).filter(c => c.count).length;
    const games = Games.userGames(u.id, setId);
    const scored = games.filter(g => g.percent != null);
    const avg = scored.length ? Math.round(scored.reduce((s, g) => s + g.percent, 0) / scored.length) : null;
    const wrong = Games.mistakes(u.id, setId);
    const answers = myAnswers(u.id, setId);
    const weak = weakThemes(setId, answers).slice(0, 5);
    const lastMode = games.length ? games[0].mode : 'quiz';
    const lastOf = m => games.find(g => g.mode === m && g.percent != null);
    const stars = `<img class="deco-star s1" src="assets/img/figma/star1.svg" width="80" height="80" alt="">
      <img class="deco-star s2" src="assets/img/figma/star2.svg" width="61" height="118" alt="">
      <img class="deco-star s3" src="assets/img/figma/star3.svg" width="61" height="60" alt="">
      <img class="deco-star s4" src="assets/img/figma/star4.svg" width="80" height="80" alt="">
      <img class="deco-star s5" src="assets/img/figma/star5.svg" width="80" height="118" alt="">`;
    const statCard = (href, icon, label, value) => `<a class="mini-card" href="${href}">
      <span class="icon-bubble">${Icons.svg(icon)}</span>
      <span class="mini-text"><small>${label}</small><b>${value}</b></span></a>`;

    const root = App.render(`<div class="dash">
      <div class="dash-main">
        <section class="hero-banner">
          ${stars}
          <p class="kicker">${setId === Sets.primaryId() ? 'Главный набор' : 'Набор вопросов'}</p>
          <h1>${esc(st.title)}</h1>
          ${st.description ? `<p class="hero-desc">${esc(st.description)}</p>` : ''}
          <a class="pill-dark" href="#/set/${setId}/play/${lastMode}">${games.length ? 'Продолжить: ' + Games.MODES[lastMode].title : 'Начать викторину'}
            <span class="play-dot">${Icons.svg('play')}</span></a>
        </section>

        <div class="mini-cards">
          ${statCard(`#/set/${setId}/questions`, 'folder-open', `${themes} ${U.plural(themes, 'тема', 'темы', 'тем')}`, `${qs.length} ${qWord(qs.length)}`)}
          ${statCard(`#/set/${setId}/history`, 'task-square', 'Сыграно', `${games.length} ${U.plural(games.length, 'игра', 'игры', 'игр')}`)}
          ${statCard(`#/set/${setId}/analytics`, 'chart', 'Средний результат', avg == null ? '—' : avg + '%')}
        </div>

        ${wrong.length ? `<section class="mistakes-strip">
          <span class="icon-bubble warn">${Icons.svg('task-square')}</span>
          <div class="mini-text"><small>Работа над ошибками</small>
            <b>${wrong.length} ${qWord(wrong.length)} с неверным последним ответом</b></div>
          <div class="row">${Games.MODE_IDS.map(m => `<a class="chip-btn" href="#/set/${setId}/play/${m}?mistakes=1" title="Повторить ошибки: ${Games.MODES[m].title}">${Icons.mode(m)}<span>${Games.MODES[m].title}</span></a>`).join('')}</div>
        </section>` : ''}

        <div class="section-head"><h2>Режимы</h2></div>
        <div class="mode-grid">${Games.MODE_IDS.map(m => {
          const last = lastOf(m);
          return `<article class="mode-card">
            <div class="mode-cover cover-${m}">${Icons.mode(m)}
              <button class="cover-btn" data-settings="${m}" aria-label="Настройки режима «${Games.MODES[m].title}»">${Icons.svg('setting-2')}</button></div>
            <span class="tag" title="${poolSummary(setId, m)}">${poolSummary(setId, m).split(' · ')[0]}</span>
            <h3>${Games.MODES[m].title}</h3>
            <p class="mode-desc">${Games.MODES[m].desc}</p>
            <div class="progress" role="img" aria-label="${last ? 'Последний результат ' + last.percent + '%' : 'Ещё не играли'}"><span style="width:${last ? last.percent : 0}%"></span></div>
            <div class="mode-foot"><small>${last ? 'Результат ' + last.percent + '%' : 'Ещё не играли'}</small>
              <a class="btn primary small" href="#/set/${setId}/play/${m}">Играть</a></div>
          </article>`;
        }).join('')}</div>

        ${games.length ? `<div class="section-head"><h2>Последние игры</h2><a class="see-link" href="#/set/${setId}/history">Вся история</a></div>
          ${gamesTable(games.slice(0, 5))}` : ''}
        ${st.origin === 'upload' ? '<p class="muted small">Набор загружен через админ-панель и хранится в этом браузере.</p>' : ''}
      </div>

      <aside class="profile-panel" aria-label="Ваш профиль">
        <div class="panel-head"><h2>Ваш профиль</h2></div>
        <div class="profile">
          ${ring(avg, u.name)}
          <p class="hello">${greeting(u.name)}</p>
          <p class="muted small">${avg == null ? 'Сыграйте первую игру — здесь появится ваш средний результат.' : `Средний результат — ${avg}%. Продолжайте подготовку к экзамену.`}</p>
          <div class="round-btns">
            <a class="icon-btn outline" href="#/notifications" aria-label="Уведомления" title="Уведомления">${Icons.svg('notification')}</a>
            <a class="icon-btn outline" href="#/set/${setId}/bookmarks" aria-label="Закладки" title="Закладки">${Icons.svg('bookmark')}</a>
            <a class="icon-btn outline" href="#/set/${setId}/history" aria-label="История" title="История">${Icons.svg('task-square')}</a>
          </div>
        </div>
        <div class="panel-block"><h3>Активность за 5 дней</h3>${activityBars(answers)}</div>
        <div class="panel-block">
          <div class="panel-head"><h3>Темы для повторения</h3></div>
          ${weak.length ? `<div class="list-card">${weak.map(t => `<div class="person">
            <span class="avatar" aria-hidden="true">${initials(Sets.categoryName(setId, t.id))}</span>
            <span class="person-text"><b>${esc(Sets.categoryName(setId, t.id))}</b><small>${t.pct}% верных из ${t.answers}</small></span>
            <a class="pill" href="#/set/${setId}/play/cards?cat=${t.id}">Повторить</a></div>`).join('')}</div>
            <a class="pill-soft" href="#/set/${setId}/analytics">Вся аналитика</a>`
            : '<p class="muted small">Когда по теме наберётся 3 ответа, она появится здесь — начиная с самой слабой.</p>'}
        </div>
      </aside>
    </div>`);
    U.$$('[data-settings]', root).forEach(b => { b.onclick = () => V.settingsModal(setId, b.dataset.settings); });
  };

  // ---------- Настройки режима ----------
  V.settingsModal = (setId, mode) => {
    const u = me();
    const s = Games.settings(u.id, setId, mode);
    const [lo, hi] = Sets.numberRange(setId);
    const cats = Sets.categories(setId).filter(c => c.count);
    const levels = Sets.levels(setId);
    const saved = SavedSets.list(u.id, setId).filter(x => x.mode === 'any' || x.mode === mode);
    const checked = (list, v) => (!list || list.includes(v) ? 'checked' : '');
    const m = U.modal(`<h2>Настройки: ${Games.MODES[mode].title}</h2>
      <form id="sf" class="settings">
        <fieldset><legend>Источник вопросов</legend>
          <select name="active_set_id">
            <option value="">Все вопросы по фильтрам ниже</option>
            ${saved.map(x => `<option value="${x.id}" ${s.active_set_id === x.id ? 'selected' : ''}>Набор «${esc(x.name)}» (${x.items.length})</option>`).join('')}
          </select>
          ${saved.length ? '' : '<p class="muted small">Свои наборы создаются на вкладке «Вопросы и наборы».</p>'}
        </fieldset>
        <div class="filters">
        <fieldset><legend>Диапазон номеров</legend>
          <div class="row"><label>от <input type="number" name="from" min="${lo}" max="${hi}" value="${s.range_from != null ? s.range_from : lo}"></label>
          <label>до <input type="number" name="to" min="${lo}" max="${hi}" value="${s.range_to != null ? s.range_to : hi}"></label></div>
        </fieldset>
        <fieldset><legend>Сложность</legend>
          <div class="row">${levels.map(l => `<label class="chk"><input type="checkbox" name="lvl" value="${l}" ${checked(s.levels, l)}> ${l}</label>`).join('')}</div>
        </fieldset>
        <fieldset><legend>Темы <button type="button" class="link" data-all>все</button> / <button type="button" class="link" data-none>ни одной</button></legend>
          <div class="checklist">${cats.map(c => `<label class="chk"><input type="checkbox" name="cat" value="${c.id}" ${checked(s.category_ids, c.id)}> ${esc(c.name)} <span class="muted">(${c.count})</span></label>`).join('')}</div>
        </fieldset>
        <fieldset><legend>Повторы</legend>
          <label class="chk"><input type="checkbox" name="repeat" ${s.repeat ? 'checked' : ''}> Повторять вопросы</label>
          <p class="muted small">Если выключено, отвеченные в этом режиме вопросы не появятся, пока не будет пройден весь пул.</p>
        </fieldset>
        ${mode === 'cards' ? `<fieldset><legend>Размер колоды</legend><input type="number" name="deck" min="1" max="300" value="${s.deck}"></fieldset>` : ''}
        ${mode === 'quiz' ? `<fieldset><legend>Число вопросов</legend><div class="row">${APP_CONFIG.modes.quiz.counts.map(n => `<label class="chk"><input type="radio" name="qc" value="${n}" ${s.quizCount === n ? 'checked' : ''}> ${n}</label>`).join('')}</div></fieldset>` : ''}
        ${mode === 'jeopardy' ? `<fieldset><legend>Темы на доске (до ${APP_CONFIG.modes.jeopardy.maxCategories})</legend>
          <p class="muted small">Не выбрано — 5 случайных тем, в которых не меньше ${APP_CONFIG.modes.jeopardy.minPerCategory} вопросов в пуле.</p>
          <div class="checklist" id="jcats"></div></fieldset>` : ''}
        </div>
        <p class="pool-count" aria-live="polite"></p>
        <div class="row end"><button type="button" class="btn ghost" data-reset>Сбросить</button><button class="btn primary">Сохранить</button></div>
      </form>`, { wide: true });

    const f = U.$('#sf', m.root);
    const read = () => {
      const next = { ...s };
      next.active_set_id = f.active_set_id.value || null;
      let from = parseInt(f.from.value, 10), to = parseInt(f.to.value, 10);
      if (isNaN(from)) from = lo;
      if (isNaN(to)) to = hi;
      from = Math.max(lo, Math.min(hi, from));
      to = Math.max(from, Math.min(hi, to));
      next.range_from = from === lo ? null : from;
      next.range_to = to === hi ? null : to;
      const lv = U.$$('[name=lvl]:checked', f).map(x => +x.value);
      next.levels = lv.length === levels.length ? null : lv;
      const cs = U.$$('[name=cat]:checked', f).map(x => +x.value);
      next.category_ids = cs.length === cats.length ? null : cs;
      next.repeat = f.repeat.checked;
      if (f.deck) next.deck = Math.max(1, parseInt(f.deck.value, 10) || APP_CONFIG.modes.cards.deck);
      if (mode === 'quiz') next.quizCount = +(U.$('[name=qc]:checked', f) || { value: s.quizCount }).value;
      if (mode === 'jeopardy') {
        const j = U.$$('[name=jcat]:checked', f).map(x => +x.value);
        next.jeopardyCats = j.length ? j : null;
      }
      return next;
    };
    const refresh = () => {
      const next = read();
      const n = Games.pool(setId, next).length;
      U.$('.pool-count', f).textContent = next.active_set_id ? 'Игра будет по сохранённому набору; фильтры не действуют.' : `Под настройки подходит ${n} ${qWord(n)}.`;
      const box = U.$('#jcats', f);
      if (box) {
        const p = Games.pool(setId, next);
        const counts = {};
        p.forEach(q => { counts[q.category_id] = (counts[q.category_id] || 0) + 1; });
        const chosen = new Set(U.$$('[name=jcat]:checked', f).map(x => +x.value).concat(box.dataset.init ? [] : (s.jeopardyCats || [])));
        box.dataset.init = '1';
        const elig = cats.filter(c => (counts[c.id] || 0) >= APP_CONFIG.modes.jeopardy.minPerCategory);
        box.innerHTML = elig.length ? elig.map(c => `<label class="chk"><input type="checkbox" name="jcat" value="${c.id}" ${chosen.has(c.id) ? 'checked' : ''}> ${esc(c.name)} <span class="muted">(${counts[c.id]})</span></label>`).join('')
          : '<p class="muted">В пуле нет тем с достаточным числом вопросов.</p>';
        U.$$('[name=jcat]', box).forEach(x => { x.onchange = limitJ; });
      }
    };
    const limitJ = () => {
      const all = U.$$('[name=jcat]', f);
      const n = all.filter(x => x.checked).length;
      all.forEach(x => { x.disabled = !x.checked && n >= APP_CONFIG.modes.jeopardy.maxCategories; });
    };
    f.addEventListener('input', e => { if (e.target.name !== 'jcat') refresh(); });
    U.$('[data-all]', f).onclick = () => { U.$$('[name=cat]', f).forEach(x => { x.checked = true; }); refresh(); };
    U.$('[data-none]', f).onclick = () => { U.$$('[name=cat]', f).forEach(x => { x.checked = false; }); refresh(); };
    U.$('[data-reset]', f).onclick = () => {
      Games.saveSettings(u.id, setId, mode, { cycle_started_at: s.cycle_started_at });
      m.close(); App.route();
    };
    f.onsubmit = e => {
      e.preventDefault();
      const next = read();
      if (!next.active_set_id && !Games.pool(setId, next).length) { U.toast('Под эти настройки не подходит ни один вопрос', 'error'); return; }
      Games.saveSettings(u.id, setId, mode, next);
      m.close();
      U.toast('Настройки сохранены');
      App.route();
    };
    refresh();
    limitJ();
  };

  // ---------- Другие наборы ----------
  function setCard(st) {
    const n = Sets.questions(st.id).length;
    const cats = Sets.categories(st.id).filter(c => c.count).length;
    return `<a class="set-card card" href="#/set/${st.id}">
      <h3>${esc(st.title)}</h3>
      ${st.description ? `<p class="muted">${esc(st.description)}</p>` : ''}
      <p class="pool">${n} ${qWord(n)} · ${cats} ${U.plural(cats, 'тема', 'темы', 'тем')}${st.origin === 'upload' ? ' · загружен в браузере' : ''}</p>
    </a>`;
  }

  V.otherSets = () => {
    const primary = Sets.primaryId();
    const others = Sets.list().filter(x => x.id !== primary);
    App.render(`<section class="set-head"><h1>Другие наборы</h1>
      <p class="muted">Каждый набор работает так же, как главный: четыре режима, настройки, закладки, свои наборы, история и аналитика.</p></section>
      ${others.length ? `<div class="set-grid">${others.map(setCard).join('')}</div>` :
        `<div class="card empty"><p>Других наборов пока нет.</p></div>`}
      <div class="card help">
        <h2>Как добавить набор</h2>
        <ol>
          <li>Подготовьте Excel-файл в том же формате, что <code>CorpFin_300.xlsx</code>: лист с вопросами (№, вопрос, варианты A–D, правильный вариант, категория, подсказка, сложность 1–5, мнемоника) и, по желанию, лист «Источники».</li>
          <li>Выполните <code>python tools/build_set.py путь/к/файлу.xlsx --id short-name --title "Название"</code>. Файл появится в <code>sets/</code>, список наборов обновится сам.</li>
          <li>Обновите страницу.</li>
        </ol>
        ${Auth.isAdmin() ? '<p>Или загрузите Excel прямо в браузере: <a class="btn small" href="#/admin/import?new=1">Новый набор из Excel</a></p>' : ''}
      </div>`);
  };

  // ---------- Таблица игр ----------
  function gamesTable(games) {
    return `<div class="table-card"><div class="table-wrap"><table class="table">
      <thead><tr><th>Режим и дата</th><th>Ответов</th><th>Результат</th><th>Очки</th><th class="right">Действие</th></tr></thead>
      <tbody>${games.map(g => {
        const n = g.answers.filter(a => !a.is_repeat).length;
        const scored = g.mode === 'quiz' || g.mode === 'jeopardy';
        return `<tr><td><div class="person"><span class="avatar soft" aria-hidden="true">${Icons.mode(g.mode)}</span>
            <span class="person-text"><b>${Games.MODES[g.mode].title}</b><small>${U.fmtDateTime(g.finished_at)}</small></span></div></td>
          <td>${n}</td>
          <td>${g.percent == null ? '—' : `<span class="tag pct t${Engine.tierOf(g.percent)}">${g.percent}%</span>`}</td>
          <td>${scored ? U.fmtNum(g.score) : '—'}</td><td class="right"><a class="tag info" href="#/game/${g.id}">Итоги</a></td></tr>`;
      }).join('')}</tbody></table></div></div>`;
  }
  V.gamesTable = gamesTable;

  V.history = setId => {
    const games = Games.userGames(me().id, setId);
    App.render(`${V.setHeader(setId, 'history')}
      ${games.length ? gamesTable(games) : '<div class="card empty"><p>Вы ещё не сыграли ни одной игры в этом наборе.</p></div>'}`);
  };

  // ---------- Вопросы и сохранённые наборы ----------
  V.questionDetails = (setId, q) => `<div class="qdetail">
      <ol class="opts-static" type="A">${Sets.LETTERS.map(L => `<li class="${q.correct === L ? 'right' : ''}">${esc(q[L.toLowerCase()])}${q.correct === L ? ' <b>✓</b>' : ''}</li>`).join('')}</ol>
      ${q.hint ? `<p><b>Подсказка.</b> ${esc(q.hint)}</p>` : ''}
      ${q.mnemonic ? `<p><b>Мнемоника.</b> ${esc(q.mnemonic)}</p>` : ''}
    </div>`;

  V.questions = (setId, query) => {
    const u = me();
    const cats = Sets.categories(setId).filter(c => c.count);
    const levels = Sets.levels(setId);
    const selected = new Set();
    const root = App.render(`${V.setHeader(setId, 'questions')}
      <div class="card"><h2>Мои наборы</h2><div id="saved"></div></div>
      <div class="toolbar">
        <input type="search" id="q" placeholder="Поиск по тексту или №" aria-label="Поиск" value="${esc(query.q || '')}">
        <select id="fc" aria-label="Тема"><option value="">Все темы</option>${cats.map(c => `<option value="${c.id}" ${+query.cat === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
        <select id="fl" aria-label="Сложность"><option value="">Любая сложность</option>${levels.map(l => `<option>${l}</option>`).join('')}</select>
        <label class="chk"><input type="checkbox" id="fb" ${query.bookmarks ? 'checked' : ''}> Только закладки</label>
      </div>
      <div class="selbar" id="selbar" hidden>
        <span id="selcount"></span>
        <button class="btn small" id="selall">Выбрать все найденные</button>
        <button class="btn small ghost" id="selclear">Снять выбор</button>
        <button class="btn small primary" id="selsave">Сохранить как набор</button>
      </div>
      <p class="muted small" id="found"></p>
      <div id="list" class="qlist"></div>`);

    const renderSaved = () => {
      const list = SavedSets.list(u.id, setId);
      U.$('#saved', root).innerHTML = list.length ? `<div class="table-wrap"><table class="table">
        <thead><tr><th>Название</th><th>Режим</th><th>Вопросов</th><th>Создан</th><th>Играть</th><th></th></tr></thead>
        <tbody>${list.map(ss => `<tr><td>${esc(ss.name)}</td><td>${ss.mode === 'any' ? 'любой' : Games.MODES[ss.mode].title}</td>
          <td>${ss.items.length}</td><td>${U.fmtDate(ss.created_at)}</td>
          <td class="row">${(ss.mode === 'any' ? Games.MODE_IDS : [ss.mode]).map(m => `<a class="btn small" href="#/set/${setId}/play/${m}?saved=${ss.id}" title="${Games.MODES[m].title}" aria-label="Играть: ${Games.MODES[m].title}">${Icons.mode(m)}</a>`).join('')}</td>
          <td><button class="btn small ghost" data-del="${ss.id}">Удалить</button></td></tr>`).join('')}</tbody></table></div>`
        : '<p class="muted">Отметьте вопросы галочками ниже и сохраните их как набор — игра по набору всегда использует ровно эти вопросы.</p>';
      U.$$('[data-del]', root).forEach(b => {
        b.onclick = async () => {
          if (await U.confirm('Удалить набор? Вопросы и история ответов не пострадают.', 'Удалить')) { SavedSets.remove(b.dataset.del); renderSaved(); }
        };
      });
    };

    let shown = [];
    const renderList = () => {
      const text = U.$('#q', root).value.trim().toLowerCase();
      const fc = U.$('#fc', root).value, fl = U.$('#fl', root).value, fb = U.$('#fb', root).checked;
      shown = Sets.questions(setId).filter(q =>
        (!fc || q.category_id === +fc) && (!fl || q.level === +fl) &&
        (!fb || Bookmarks.has(u.id, setId, q.number)) &&
        (!text || String(q.number) === text || q.text.toLowerCase().includes(text)));
      U.$('#found', root).textContent = `Найдено: ${shown.length}`;
      U.$('#list', root).innerHTML = shown.map(q => `<div class="qrow" data-n="${q.number}">
        <label class="chk sel"><input type="checkbox" data-sel="${q.number}" ${selected.has(q.number) ? 'checked' : ''} aria-label="Выбрать вопрос ${q.number}"></label>
        <button class="qmain" data-open="${q.number}" aria-expanded="false">
          <span class="num">№${q.number}</span> <span class="qt">${esc(q.text)}</span>
          <span class="tags"><span class="tag">${esc(Sets.categoryName(setId, q.category_id))}</span><span class="tag lvl">ур. ${q.level}</span></span>
        </button>
        <button class="star ${Bookmarks.has(u.id, setId, q.number) ? 'on' : ''}" data-star="${q.number}" aria-label="Закладка" aria-pressed="${Bookmarks.has(u.id, setId, q.number)}">${Icons.svg('bookmark')}</button>
        <div class="qmore" hidden></div></div>`).join('') || '<div class="card empty"><p>Ничего не найдено.</p></div>';
    };
    const renderSel = () => {
      U.$('#selbar', root).hidden = !selected.size;
      U.$('#selcount', root).textContent = `Выбрано: ${selected.size}`;
    };

    root.addEventListener('click', e => {
      const t = e.target.closest('[data-open],[data-star]');
      if (!t) return;
      if (t.dataset.star) {
        const on = Bookmarks.toggle(u.id, setId, +t.dataset.star);
        t.classList.toggle('on', on);
        t.setAttribute('aria-pressed', String(on));
        return;
      }
      const row = t.closest('.qrow');
      const more = U.$('.qmore', row);
      more.hidden = !more.hidden;
      t.setAttribute('aria-expanded', String(!more.hidden));
      if (!more.hidden) {
        const q = Sets.question(setId, +t.dataset.open);
        more.innerHTML = V.questionDetails(setId, q) + `<button class="btn small ghost" data-report="${q.number}">Сообщить об ошибке</button>`;
        U.$('[data-report]', more).onclick = () => V.reportModal(setId, q.number);
      }
    });
    root.addEventListener('change', e => {
      if (!e.target.dataset.sel) return;
      const n = +e.target.dataset.sel;
      if (e.target.checked) selected.add(n); else selected.delete(n);
      renderSel();
    });
    ['#q', '#fc', '#fl', '#fb'].forEach(id => U.$(id, root).addEventListener('input', renderList));
    U.$('#selall', root).onclick = () => { shown.forEach(q => selected.add(q.number)); renderList(); renderSel(); };
    U.$('#selclear', root).onclick = () => { selected.clear(); renderList(); renderSel(); };
    U.$('#selsave', root).onclick = () => V.saveSetModal(setId, [...selected].sort((a, b) => a - b), () => {
      selected.clear(); renderList(); renderSel(); renderSaved();
    });
    renderSaved();
    renderList();
  };

  V.saveSetModal = (setId, numbers, done) => {
    const m = U.modal(`<h2>Новый набор</h2><form id="ssf">
      <label for="ssname">Название</label><input id="ssname" name="name" maxlength="60" required>
      <label for="ssmode">Режим</label><select id="ssmode" name="mode"><option value="any">Любой режим</option>
      ${Games.MODE_IDS.map(m => `<option value="${m}">${Games.MODES[m].title}</option>`).join('')}</select>
      <p class="muted">${numbers.length} ${qWord(numbers.length)}, порядок — по номеру.</p>
      <div class="row end"><button class="btn primary">Сохранить</button></div></form>`);
    U.$('#ssf', m.root).onsubmit = e => {
      e.preventDefault();
      const name = e.target.name.value.trim();
      if (!name) return;
      SavedSets.create(me().id, setId, name, e.target.mode.value, numbers);
      m.close();
      U.toast(`Набор «${name}» сохранён`);
      if (done) done();
    };
  };

  V.reportModal = (setId, n) => {
    const q = Sets.question(setId, n);
    const m = U.modal(`<h2>Сообщить об ошибке</h2><p class="muted">Вопрос №${n}: ${esc(q.text)}</p>
      <form id="rf"><label for="rc">Что не так?</label><textarea id="rc" name="c" rows="4" required maxlength="1000"></textarea>
      <div class="row end"><button class="btn primary">Отправить</button></div></form>`);
    U.$('#rf', m.root).onsubmit = e => {
      e.preventDefault();
      const c = e.target.c.value.trim();
      if (!c) return;
      Reports.create(setId, n, me().id, c);
      m.close();
      U.toast('Спасибо, сообщение отправлено администратору');
    };
  };

  // ---------- Закладки ----------
  V.bookmarks = setId => {
    const u = me();
    const list = Bookmarks.list(u.id, setId);
    const root = App.render(`${V.setHeader(setId, 'bookmarks')}
      ${list.length ? `<div class="row">
          <a class="btn primary" href="#/set/${setId}/play/cards?bookmarks=1">Повторить в Карточках</a>
          <button class="btn" id="mk">Создать набор из выбранных</button>
          <a class="btn ghost" href="#/set/${setId}/questions?bookmarks=1">Открыть в списке вопросов</a></div>
        <div class="qlist">${list.map(q => `<div class="qrow">
          <label class="chk sel"><input type="checkbox" data-sel="${q.number}" checked aria-label="Выбрать"></label>
          <div class="qmain static"><span class="num">№${q.number}</span> <span class="qt">${esc(q.text)}</span>
            <span class="tags"><span class="tag">${esc(Sets.categoryName(setId, q.category_id))}</span><span class="tag lvl">ур. ${q.level}</span></span></div>
          <button class="btn small ghost" data-rm="${q.number}">Убрать</button>
          <div class="qmore">${V.questionDetails(setId, q)}</div></div>`).join('')}</div>`
        : '<div class="card empty"><p>Закладок пока нет. Отмечайте вопросы кнопкой «В закладки» во время игры или значком закладки в списке вопросов.</p></div>'}`);
    U.$$('[data-rm]', root).forEach(b => { b.onclick = () => { Bookmarks.toggle(u.id, setId, +b.dataset.rm); V.bookmarks(setId); }; });
    const mk = U.$('#mk', root);
    if (mk) {
      mk.onclick = () => {
        const nums = U.$$('[data-sel]:checked', root).map(x => +x.dataset.sel);
        if (!nums.length) return U.toast('Отметьте хотя бы один вопрос');
        V.saveSetModal(setId, nums);
      };
    }
  };

  // ---------- Источники ----------
  V.sources = setId => {
    const src = Sets.get(setId).sources || [];
    App.render(`${V.setHeader(setId, 'sources')}
      ${src.length ? `<div class="table-wrap"><table class="table">
        <thead><tr><th>№</th><th>Источник</th><th>Где используется</th><th>Ссылка</th></tr></thead>
        <tbody>${src.map(s => `<tr><td>${s.number}</td><td>${esc(s.title)}</td><td>${esc(s.usage)}</td>
          <td>${/^https?:\/\//.test(s.url) ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.url.replace(/^https?:\/\//, ''))}</a>` : esc(s.url)}</td></tr>`).join('')}
        </tbody></table></div>` : '<div class="card empty"><p>Для этого набора источники не указаны.</p></div>'}`);
  };

  // ---------- Уведомления ----------
  V.notifications = () => {
    const u = me();
    const list = Store.state.notifications.filter(n => n.user_id === u.id).sort((a, b) => b.created_at - a.created_at);
    App.render(`<section class="set-head"><h1>Уведомления</h1></section>
      ${list.length ? `<div class="card"><ul class="notes">${list.map(n => `<li class="${n.read_at ? '' : 'unread'}">
        <span class="muted small">${U.fmtDateTime(n.created_at)}</span><br>${esc(n.text)}</li>`).join('')}</ul></div>`
        : '<div class="card empty"><p>Уведомлений нет.</p></div>'}`);
    let changed = false;
    list.forEach(n => { if (!n.read_at) { n.read_at = Date.now(); Store.queue('notifications', n.id); changed = true; } });
    if (changed) { Store.save('misc'); App.header(); }
  };
})();
