// Выбор вопросов (ТЗ §6), жизненный цикл игры, закладки, наборы, отчёты об ошибках.
(function () {
  const MODES = {
    cards: { title: 'Карточки', desc: 'Вопрос — переворот — «знаю / не знаю». Незнакомые карточки возвращаются в колоду.' },
    board: { title: 'Доска', desc: 'Сетка скрытых плиток, за каждой — вопрос с четырьмя вариантами.' },
    jeopardy: { title: 'Своя игра', desc: 'Темы в столбцах, цена по сложности. Ошибка отнимает цену вопроса.' },
    quiz: { title: 'Викторина', desc: 'Таймер 20 секунд, баллы за скорость верного ответа.' }
  };
  const MODE_IDS = Object.keys(MODES);
  const st = () => Store.state;
  const cfg = () => APP_CONFIG.modes;

  // ---------- Настройки режима ----------
  const sKey = (u, s, m) => `${u}|${s}|${m}`;

  function settings(userId, setId, mode) {
    const saved = st().modeSettings[sKey(userId, setId, mode)] || {};
    return Object.assign({
      repeat: true, range_from: null, range_to: null, category_ids: null, levels: null,
      active_set_id: null, cycle_started_at: 0,
      deck: cfg().cards.deck, quizCount: cfg().quiz.count, jeopardyCats: null
    }, saved);
  }

  function saveSettings(userId, setId, mode, s) {
    st().modeSettings[sKey(userId, setId, mode)] = s;
    Store.save('misc');
  }

  // Пул вопросов режима: диапазон ∩ категории ∩ сложность.
  function pool(setId, s) {
    const [lo, hi] = Sets.numberRange(setId);
    const from = s.range_from != null ? s.range_from : lo;
    const to = s.range_to != null ? s.range_to : hi;
    return Sets.questions(setId).filter(q =>
      q.number >= from && q.number <= to &&
      (!s.category_ids || s.category_ids.includes(q.category_id)) &&
      (!s.levels || s.levels.includes(q.level)));
  }

  function answeredSince(userId, setId, mode, since) {
    const done = new Set();
    for (const g of st().games) {
      if (g.user_id !== userId || g.set_id !== setId || g.mode !== mode) continue;
      for (const a of g.answers) if (a.answered_at >= since) done.add(a.question_id);
    }
    return done;
  }

  // Работа над ошибками: вопросы, на которые последний ответ пользователя (в любом режиме) неверный.
  // Повторные показы в Карточках не считаются — как и в итогах.
  function mistakes(userId, setId) {
    const last = new Map();
    for (const g of st().games) {
      if (g.user_id !== userId || g.set_id !== setId) continue;
      for (const a of g.answers) {
        if (a.is_repeat) continue;
        const prev = last.get(a.question_id);
        if (!prev || a.answered_at >= prev.answered_at) last.set(a.question_id, a);
      }
    }
    return liveQuestions(setId, [...last.values()].filter(a => !a.correct).map(a => a.question_id));
  }

  // Ошибки одной игры — для кнопки «Повторить ошибки» в итогах.
  function gameMistakes(userId, setId, gameId) {
    const g = byId(gameId);
    if (!g || g.user_id !== userId || g.set_id !== setId) return [];
    return liveQuestions(setId,g.answers.filter(a => !a.is_repeat && !a.correct).map(a => a.question_id));
  }

  const liveQuestions = (setId, numbers) => [...new Set(numbers)]
    .map(n => Sets.question(setId, n)).filter(q => q && !q.deleted_at)
    .sort((a, b) => a.number - b.number);

  const needFor = (mode, s) => ({ cards: s.deck, board: cfg().board.tiles, quiz: s.quizCount, jeopardy: Infinity }[mode]);

  /**
   * Вопросы для новой игры.
   * source: { savedSetId } | { bookmarks: true } | { mistakes: true } | { gameId } | { categoryId } | {} — по настройкам режима.
   * Возвращает { questions, notices, savedSet, fixed } (fixed — набор с фиксированным порядком).
   */
  function prepare(userId, setId, mode, source = {}) {
    const s = settings(userId, setId, mode);
    const notices = [];
    const listSource = source.bookmarks || source.mistakes || source.gameId || source.categoryId;
    const savedSetId = source.savedSetId || (!listSource && s.active_set_id) || null;

    if (savedSetId) {
      const ss = st().savedSets.find(x => x.id === savedSetId && x.set_id === setId);
      if (ss) {
        const qs = ss.items.map(n => Sets.question(setId, n)).filter(q => q && !q.deleted_at);
        notices.push(`Игра по набору «${ss.name}»: ${qs.length} ${U.plural(qs.length, 'вопрос', 'вопроса', 'вопросов')}.`);
        return { questions: qs, notices, savedSet: ss, fixed: true };
      }
    }
    if (listSource) {
      const [label, qs, none] = source.bookmarks ? ['Повторение закладок', Bookmarks.list(userId, setId), 'закладок нет']
        : source.mistakes ? ['Работа над ошибками', mistakes(userId, setId), 'ошибок нет — повторять нечего']
        : source.gameId ? ['Повтор ошибок игры', gameMistakes(userId, setId, source.gameId), 'ошибок нет — повторять нечего']
        : [`Тема «${Sets.categoryName(setId, source.categoryId)}»`, Sets.questions(setId).filter(q => q.category_id === source.categoryId), 'вопросов нет'];
      notices.push(`${label}: ${qs.length ? `${qs.length} ${U.plural(qs.length, 'вопрос', 'вопроса', 'вопросов')}` : none}.`);
      return { questions: mode === 'board' ? qs.slice(0, cfg().board.tiles) : U.shuffle(qs), notices, savedSet: null, fixed: true };
    }

    const p = pool(setId, s);
    if (!p.length) return { questions: [], notices: ['Под текущие настройки не подходит ни один вопрос. Измените настройки режима.'], savedSet: null };

    let avail = p;
    if (!s.repeat) {
      const done = answeredSince(userId, setId, mode, s.cycle_started_at || 0);
      avail = p.filter(q => !done.has(q.number));
      if (!avail.length) {
        s.cycle_started_at = Date.now();
        saveSettings(userId, setId, mode, s);
        avail = p;
        notices.push('Все вопросы пройдены, начинаем сначала.');
      }
    }
    const need = needFor(mode, s);
    if (need !== Infinity && avail.length < need) {
      notices.push(`Доступно только ${avail.length} ${U.plural(avail.length, 'вопрос', 'вопроса', 'вопросов')} из ${need} — игра будет короче.`);
    }
    return { questions: need === Infinity ? avail : U.sample(avail, need), notices, savedSet: null, settings: s };
  }

  // Доска «Своей игры»: до 5 тем с ≥3 вопросами, ячейка на каждую пару (тема, уровень).
  function jeopardyBoard(setId, questions, s, relaxed) {
    const minPer = relaxed ? 1 : cfg().jeopardy.minPerCategory;
    const byCat = new Map();
    for (const q of questions) {
      if (!byCat.has(q.category_id)) byCat.set(q.category_id, []);
      byCat.get(q.category_id).push(q);
    }
    const eligible = [...byCat.keys()].filter(id => byCat.get(id).length >= minPer);
    let cats = (s && s.jeopardyCats ? s.jeopardyCats.filter(id => eligible.includes(id)) : []);
    if (!cats.length) cats = U.sample(eligible, cfg().jeopardy.maxCategories);
    cats = cats.slice(0, cfg().jeopardy.maxCategories)
      .sort((a, b) => Sets.categoryName(setId, a).localeCompare(Sets.categoryName(setId, b), 'ru'));
    const levels = [...new Set(cats.flatMap(id => byCat.get(id).map(q => q.level)))].sort((a, b) => a - b);
    // Сначала ячейки получают вопросы своего уровня. Пустые затем заполняются неиспользованными
    // вопросами той же темы с ближайшей сложностью (при равенстве — более лёгким).
    // Цена ячейки остаётся ценой строки.
    const cells = {};
    for (const id of cats) {
      const left = U.shuffle(byCat.get(id));
      const take = q => left.splice(left.indexOf(q), 1)[0];
      for (const lv of levels) {
        const exact = left.find(q => q.level === lv);
        if (exact) cells[`${id}|${lv}`] = take(exact);
      }
      for (const lv of levels) {
        const k = `${id}|${lv}`;
        if (cells[k] || !left.length) continue;
        const near = left.reduce((best, q) => {
          const d = Math.abs(q.level - lv), bd = Math.abs(best.level - lv);
          return d < bd || (d === bd && q.level < best.level) ? q : best;
        });
        cells[k] = take(near);
      }
    }
    return { cats, levels, cells, eligibleCount: eligible.length };
  }

  // ---------- Игра ----------
  // source — откуда взяты вопросы ({ bookmarks } | { mistakes } | { gameId } | { categoryId }), для «Сыграть ещё».
  function start(userId, setId, mode, { savedSetId = null, source = null, notices = [] } = {}) {
    const g = {
      id: U.uid(), user_id: userId, set_id: setId, mode, started_at: Date.now(), finished_at: null,
      saved_set_id: savedSetId, source, score: 0, percent: null, answers: [], aggregates: [], feedback: [], notices
    };
    st().games.push(g);
    Store.save('games');
    return g;
  }

  // q — вопрос; selected — буква из файла или null; correct — да/нет.
  function record(g, q, { selected = null, correct, time_ms = null, points = 0, is_repeat = false }) {
    if (g.finished_at) return;
    g.answers.push({
      question_id: q.number, selected, correct: !!correct, time_ms, points,
      answered_at: Date.now(), level_at_answer: q.level, category_id_at_answer: q.category_id, is_repeat
    });
    g.score += points;
    Store.save('games');
  }

  function finish(g) {
    if (g.finished_at) return g;
    const games = st().games;
    const mine = games.filter(x => x.user_id === g.user_id && x.finished_at && x.id !== g.id)
      .sort((a, b) => a.finished_at - b.finished_at);
    const prev = mine.filter(x => x.set_id === g.set_id && x.mode === g.mode && x.percent != null).pop();
    const recentIds = new Set(mine.slice(-5).flatMap(x => (x.feedback || []).map(f => f.template_id)));
    const prevWeak = prev && (prev.feedback || []).find(f => f.kind === 'category');

    const res = Engine.buildFeedback({
      answers: g.answers.filter(a => !a.is_repeat),
      mode: g.mode,
      isFirstGame: mine.length === 0,
      prevGame: prev ? { percent: prev.percent, weakCategoryId: prevWeak ? prevWeak.params.category_id : null } : null,
      recentTemplateIds: recentIds,
      categoryName: id => Sets.categoryNameAny(g.set_id, id)
    });
    g.finished_at = Date.now();
    if (res.empty) {
      g.empty_message = res.message;
    } else {
      g.percent = res.percent;
      g.aggregates = res.aggregates;
      g.feedback = res.feedback;
      g.category_names = {}; // названия на момент игры — для повторного открытия
      res.aggregates.filter(a => a.scope === 'category')
        .forEach(a => { g.category_names[a.key] = Sets.categoryNameAny(g.set_id, a.key); });
    }
    Store.save('games');
    return g;
  }

  // Ушли из игры без единого ответа — игру не сохраняем.
  function discard(g) {
    st().games = st().games.filter(x => x.id !== g.id);
    Store.save('games');
  }

  const byId = id => st().games.find(g => g.id === id) || null;

  const userGames = (userId, setId) => st().games
    .filter(g => g.user_id === userId && g.set_id === setId && g.finished_at)
    .sort((a, b) => b.finished_at - a.finished_at);

  // ---------- Закладки ----------
  const Bookmarks = {
    has: (u, s, n) => st().bookmarks.some(b => b.user_id === u && b.set_id === s && b.question_id === n),
    toggle(u, s, n) {
      if (Bookmarks.has(u, s, n)) {
        st().bookmarks = st().bookmarks.filter(b => !(b.user_id === u && b.set_id === s && b.question_id === n));
      } else {
        st().bookmarks.push({ user_id: u, set_id: s, question_id: n, created_at: Date.now() });
      }
      Store.save('misc');
      return Bookmarks.has(u, s, n);
    },
    list: (u, s) => st().bookmarks.filter(b => b.user_id === u && b.set_id === s)
      .map(b => Sets.question(s, b.question_id)).filter(q => q && !q.deleted_at)
      .sort((a, b) => a.number - b.number)
  };

  // ---------- Сохранённые наборы ----------
  const SavedSets = {
    list: (u, s) => st().savedSets.filter(x => x.user_id === u && x.set_id === s),
    create(u, s, name, mode, numbers) {
      const ss = { id: U.uid(), user_id: u, set_id: s, name: name.trim(), mode, created_at: Date.now(), items: [...numbers] };
      st().savedSets.push(ss);
      Store.save('misc');
      return ss;
    },
    remove(id) {
      st().savedSets = st().savedSets.filter(x => x.id !== id);
      for (const k of Object.keys(st().modeSettings)) {
        if (st().modeSettings[k].active_set_id === id) st().modeSettings[k].active_set_id = null;
      }
      Store.save('misc');
    }
  };

  // ---------- Отчёты об ошибках ----------
  const REPORT_STATUS = { new: 'новый', in_progress: 'в работе', fixed: 'исправлен', rejected: 'отклонён' };
  const Reports = {
    create(setId, n, userId, comment) {
      st().reports.push({
        id: U.uid(), set_id: setId, question_id: n, user_id: userId, comment: comment.trim(),
        status: 'new', created_at: Date.now(), admin_note: ''
      });
      Store.save('misc');
    }
  };

  window.Games = {
    MODES, MODE_IDS, settings, saveSettings, pool, mistakes, prepare, jeopardyBoard,
    start, record, finish, discard, byId, userGames, REPORT_STATUS
  };
  window.Bookmarks = Bookmarks;
  window.SavedSets = SavedSets;
  window.Reports = Reports;
})();
