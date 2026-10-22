// Расчёт результатов и движок обратной связи (ТЗ §7–8). Чистые функции, без доступа к хранилищу.
(function (root) {
  // Округление до целого, 0,5 — вверх.
  const percent = (correct, total) => (total ? Math.floor((correct * 100) / total + 0.5) : 0);

  const tierOf = p => (p <= 20 ? 1 : p <= 40 ? 2 : p <= 60 ? 3 : p <= 80 ? 4 : 5);

  // Викторина: полный балл за первые 5 секунд, затем линейно до половины к концу таймера.
  function quizPoints(timeMs, correct, timerSec = 20, base = 1000) {
    if (!correct || timeMs == null || timeMs >= timerSec * 1000) return 0;
    const s = timeMs / 1000;
    if (s <= 5) return base;
    return Math.round(base - (base / 2) * (s - 5) / (timerSec - 5));
  }

  const jeopardyPoints = (level, correct) => (correct ? level * 100 : -level * 100);

  // Агрегаты по уровням и категориям из учитываемых ответов.
  function aggregates(answers) {
    const out = { level: new Map(), category: new Map() };
    for (const a of answers) {
      for (const [scope, key] of [['level', a.level_at_answer], ['category', a.category_id_at_answer]]) {
        const m = out[scope];
        if (!m.has(key)) m.set(key, { key, answers: 0, correct: 0 });
        const e = m.get(key);
        e.answers++;
        if (a.correct) e.correct++;
      }
    }
    return out;
  }

  // Слабое место: ≥3 ответов и верных меньше половины. Наименьший %, затем больше ошибок,
  // затем: категории — меньший id, уровни — высший уровень.
  function pickWeak(map, scope) {
    const cands = [...map.values()].filter(e => e.answers >= 3 && e.correct * 2 < e.answers);
    cands.sort((x, y) => {
      const byPct = x.correct * y.answers - y.correct * x.answers;
      if (byPct) return byPct;
      const byErr = (y.answers - y.correct) - (x.answers - x.correct);
      if (byErr) return byErr;
      return scope === 'level' ? y.key - x.key : x.key - y.key;
    });
    return cands[0] || null;
  }

  const fmt1 = x => x.toFixed(1).replace('.', ',');
  const fill = (text, params) => text.replace(/\{([^}]+)\}/g, (m, k) => (params[k] != null ? params[k] : m));

  /**
   * ctx: {
   *   answers      — учитываемые ответы (без повторов): { correct, time_ms, level_at_answer, category_id_at_answer }
   *   mode         — 'cards' | 'board' | 'jeopardy' | 'quiz'
   *   isFirstGame  — первая игра пользователя
   *   prevGame     — { percent, weakCategoryId } предыдущей игры этого режима или null
   *   recentTemplateIds — Set id шаблонов из последних 5 игр пользователя
   *   categoryName — id -> название
   *   templates, random
   * }
   */
  function buildFeedback(ctx) {
    const answers = ctx.answers;
    const n = answers.length;
    if (!n) return { empty: true, message: 'В этой игре нет ответов, итоги не сформированы' };

    const random = ctx.random || Math.random;
    const templates = ctx.templates || root.FEEDBACK_TEMPLATES;
    const recent = ctx.recentTemplateIds || new Set();
    const correct = answers.filter(a => a.correct).length;
    const wrong = n - correct;
    const pct = percent(correct, n);
    const tier = tierOf(pct);
    const agg = aggregates(answers);
    const weakCat = pickWeak(agg.category, 'category');
    const weakLvl = pickWeak(agg.level, 'level');
    const timed = answers.filter(a => a.time_ms != null);
    const worstLevel = [...agg.level.values()].sort((x, y) =>
      (x.correct * y.answers - y.correct * x.answers) || (y.key - x.key))[0];

    const base = {
      'процент': pct, 'верных': correct, 'неверных': wrong, 'всего': n,
      'прошлый_процент': ctx.prevGame ? ctx.prevGame.percent : null,
      'среднее_время': timed.length ? fmt1(timed.reduce((s, a) => s + a.time_ms, 0) / timed.length / 1000) : null,
      'худший_уровень': worstLevel ? worstLevel.key : null
    };

    const conditions = (kind, extra) => ({
      prev_game: !!ctx.prevGame && ctx.prevGame.percent != null,
      first_game: !!ctx.isFirstGame,
      mode_quiz: ctx.mode === 'quiz',
      perfect: wrong === 0,
      has_errors: wrong > 0,
      prev_weak_cat: kind === 'category' && !!ctx.prevGame && extra && ctx.prevGame.weakCategoryId === extra.key,
      multi_scope: kind === 'category' ? agg.category.size >= 2 : agg.level.size >= 2
    });

    const choose = (kind, tierNo, extra) => {
      const cond = conditions(kind, extra);
      const cands = templates.filter(t => t.kind === kind && (kind !== 'tier' || t.tier === tierNo) &&
        t.requires.every(r => cond[r]));
      const fresh = cands.filter(t => !recent.has(t.id));
      const pool = fresh.length ? fresh : cands;
      return pool[Math.floor(random() * pool.length)];
    };

    const feedback = [];
    const tierT = choose('tier', tier);
    feedback.push({ kind: 'tier', template_id: tierT.id, text: fill(tierT.text, base), params: { ...base, tier } });

    if (weakCat) {
      const p = {
        ...base, 'категория': ctx.categoryName ? ctx.categoryName(weakCat.key) : String(weakCat.key),
        'кат_верных': weakCat.correct, 'кат_неверных': weakCat.answers - weakCat.correct,
        'кат_всего': weakCat.answers, 'кат_процент': percent(weakCat.correct, weakCat.answers),
        category_id: weakCat.key
      };
      const t = choose('category', null, weakCat);
      feedback.push({ kind: 'category', template_id: t.id, text: fill(t.text, p), params: p });
    }
    if (weakLvl) {
      const p = {
        ...base, 'уровень': weakLvl.key, 'ур_верных': weakLvl.correct,
        'ур_неверных': weakLvl.answers - weakLvl.correct, 'ур_всего': weakLvl.answers,
        'ур_процент': percent(weakLvl.correct, weakLvl.answers), level: weakLvl.key
      };
      const t = choose('level', null, weakLvl);
      feedback.push({ kind: 'level', template_id: t.id, text: fill(t.text, p), params: p });
    }

    const aggList = [];
    for (const scope of ['level', 'category']) {
      for (const e of agg[scope].values()) aggList.push({ scope, key: e.key, answers: e.answers, correct: e.correct });
    }

    return { empty: false, percent: pct, correct, wrong, total: n, tier, aggregates: aggList, feedback };
  }

  const Engine = { percent, tierOf, quizPoints, jeopardyPoints, aggregates, pickWeak, buildFeedback, fill };
  root.Engine = Engine;
  if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
})(typeof window !== 'undefined' ? window : globalThis);
