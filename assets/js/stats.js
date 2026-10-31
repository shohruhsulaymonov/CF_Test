// Сводная статистика для админ-панели. Чистые функции: игры → счётчики по наборам.
// Сводка одного пользователя хранится на сервере (коллекция stats), админ складывает сводки.
(function () {
  const blank = () => ({
    games: 0, modes: {}, answers: 0, correct: 0, pct_sum: 0, pct_n: 0, time_sum: 0, time_n: 0,
    cats: {}, qs: {}, days: {}, first_at: null, last_at: null
  });
  // Пара [ответов, верных] по ключу.
  const bump = (map, key, ok) => {
    const e = map[key] || (map[key] = [0, 0]);
    e[0]++;
    if (ok) e[1]++;
  };
  const addPairs = (into, from) => {
    for (const [k, [n, ok]] of Object.entries(from || {})) {
      const e = into[k] || (into[k] = [0, 0]);
      e[0] += n;
      e[1] += ok;
    }
  };
  const addCounts = (into, from) => {
    for (const [k, n] of Object.entries(from || {})) into[k] = (into[k] || 0) + n;
  };

  // Игры одного пользователя → { setId: сводка }. Повторные показы в Карточках не считаются, как в итогах.
  function summary(games) {
    const sets = {};
    for (const g of games) {
      if (!g.finished_at) continue;
      const s = sets[g.set_id] || (sets[g.set_id] = blank());
      s.games++;
      s.modes[g.mode] = (s.modes[g.mode] || 0) + 1;
      if (g.percent != null) { s.pct_sum += g.percent; s.pct_n++; }
      s.first_at = s.first_at == null ? g.started_at : Math.min(s.first_at, g.started_at);
      s.last_at = Math.max(s.last_at || 0, g.finished_at);
      for (const a of g.answers) {
        if (a.is_repeat) continue;
        s.answers++;
        if (a.correct) s.correct++;
        if (a.time_ms != null) { s.time_sum += a.time_ms; s.time_n++; }
        bump(s.cats, a.category_id_at_answer, a.correct);
        bump(s.qs, a.question_id, a.correct);
        const d = U.dayKey(a.answered_at);
        s.days[d] = (s.days[d] || 0) + 1;
      }
    }
    return sets;
  }

  // Сумма сводок одного набора (например, всех пользователей).
  function combine(list) {
    const t = blank();
    for (const s of list) {
      if (!s) continue;
      t.games += s.games;
      t.answers += s.answers;
      t.correct += s.correct;
      t.pct_sum += s.pct_sum;
      t.pct_n += s.pct_n;
      t.time_sum += s.time_sum || 0;
      t.time_n += s.time_n || 0;
      addCounts(t.modes, s.modes);
      addCounts(t.days, s.days);
      addPairs(t.cats, s.cats);
      addPairs(t.qs, s.qs);
      if (s.first_at != null) t.first_at = t.first_at == null ? s.first_at : Math.min(t.first_at, s.first_at);
      if (s.last_at) t.last_at = Math.max(t.last_at || 0, s.last_at);
    }
    return t;
  }

  // { ключ: [ответов, верных] } → строки таблицы, ключ — число (№ вопроса или id темы).
  const rows = map => Object.entries(map || {}).map(([k, [n, ok]]) => ({
    key: Number(k), answers: n, correct: ok, wrong: n - ok, percent: Engine.percent(ok, n)
  }));

  // Самый частый режим; при равенстве — первый по порядку режимов.
  const topMode = modes => {
    let best = null;
    for (const m of Games.MODE_IDS) if ((modes[m] || 0) > ((best && modes[best]) || 0)) best = m;
    return best;
  };

  // Рейтинг набора: entries — [{ user_id, name, sets: { setId: сводка } }].
  // Больше верных ответов — выше; при равенстве быстрее среднее время ответа, затем имя.
  // Равные по верным и времени делят место.
  function ranking(entries, setId) {
    const list = [];
    for (const e of entries) {
      const s = e && e.sets && e.sets[setId];
      if (!s || !s.answers) continue;
      list.push({
        user_id: e.user_id, name: e.name || e.user_id, correct: s.correct, answers: s.answers,
        percent: Engine.percent(s.correct, s.answers), avg_ms: s.time_n ? Math.round(s.time_sum / s.time_n) : null
      });
    }
    const t = x => (x.avg_ms == null ? Infinity : x.avg_ms);
    list.sort((a, b) => b.correct - a.correct || t(a) - t(b) || String(a.name).localeCompare(String(b.name), 'ru'));
    list.forEach((x, i) => {
      const prev = list[i - 1];
      x.place = prev && prev.correct === x.correct && t(prev) === t(x) ? prev.place : i + 1;
    });
    return list;
  }

  window.Stats = { blank, summary, combine, rows, topMode, ranking };
})();
