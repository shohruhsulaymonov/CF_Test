// Игровые режимы (ТЗ §7) и экран итогов.
(function () {
  const V = App.views;
  const esc = U.esc;
  const me = () => Auth.current();
  const SHOWN = ['A', 'B', 'C', 'D'];

  // Подсказка, мнемоника, закладка и «Сообщить об ошибке» — после ответа во всех режимах.
  function revealHtml(setId, q) {
    const marked = Bookmarks.has(me().id, setId, q.number);
    return `<div class="reveal">
      ${q.hint ? `<p><b>Подсказка.</b> ${esc(q.hint)}</p>` : ''}
      ${q.mnemonic ? `<p><b>Мнемоника.</b> ${esc(q.mnemonic)}</p>` : ''}
      <div class="row">
        <button class="btn small ghost star-btn ${marked ? 'on' : ''}" data-mark aria-pressed="${marked}">${Icons.svg('bookmark')}<span>${marked ? 'В закладках' : 'В закладки'}</span></button>
        <button class="btn small ghost" data-report>Сообщить об ошибке</button>
      </div></div>`;
  }

  function bindReveal(root, setId, q) {
    const mark = U.$('[data-mark]', root);
    if (mark) {
      mark.onclick = () => {
        const on = Bookmarks.toggle(me().id, setId, q.number);
        mark.classList.toggle('on', on);
        mark.setAttribute('aria-pressed', String(on));
        U.$('span:last-child', mark).textContent = on ? 'В закладках' : 'В закладки';
      };
    }
    const rep = U.$('[data-report]', root);
    if (rep) rep.onclick = () => V.reportModal(setId, q.number);
  }

  const qMeta = (setId, q) => `<div class="tags"><span class="tag">№${q.number}</span>
    <span class="tag">${esc(Sets.categoryName(setId, q.category_id))}</span><span class="tag lvl">уровень ${q.level}</span></div>`;

  /**
   * Вопрос с четырьмя вариантами в случайном порядке. Клавиши A–D или 1–4, Enter — далее.
   * opts: { timerSec, head, onAnswer({selected, correct, time_ms}) -> строка для показа (необязательно),
   *         nextLabel, onNext(), onEscape(answered) }
   */
  function mcq(host, setId, q, opts) {
    const order = U.shuffle(SHOWN);
    const t0 = performance.now();
    let answered = false, timerId = null, raf = null;

    host.innerHTML = `<div class="mcq">
      ${opts.head || ''}${qMeta(setId, q)}
      ${opts.timerSec ? '<div class="timer" aria-hidden="true"><div class="timer-fill"></div></div><p class="timer-text" aria-live="off"></p>' : ''}
      <h2 class="qtext">${esc(q.text)}</h2>
      <div class="options" role="group" aria-label="Варианты ответа">
        ${order.map((orig, i) => `<button class="opt" data-orig="${orig}"><span class="letter">${SHOWN[i]}</span><span>${esc(q[orig.toLowerCase()])}</span></button>`).join('')}
      </div>
      <div class="after" aria-live="polite"></div></div>`;

    const finish = (orig, timeMs) => {
      if (answered) return;
      answered = true;
      clearTimeout(timerId);
      cancelAnimationFrame(raf);
      const correct = orig === q.correct;
      U.$$('.opt', host).forEach(b => {
        b.disabled = true;
        if (b.dataset.orig === q.correct) b.classList.add('right');
        else if (b.dataset.orig === orig) b.classList.add('wrong');
      });
      const extra = opts.onAnswer({ selected: orig, correct, time_ms: timeMs }) || '';
      const rightText = q[q.correct.toLowerCase()];
      U.$('.after', host).innerHTML = `
        <p class="verdict ${correct ? 'ok' : 'bad'}">${orig == null ? '⏰ Время вышло.' : correct ? '✓ Верно!' : '✗ Неверно.'} ${extra}</p>
        ${correct ? '' : `<p>Правильный ответ: <b>${esc(rightText)}</b></p>`}
        ${revealHtml(setId, q)}
        <div class="row end"><button class="btn primary" data-next>${opts.nextLabel || 'Далее'} <kbd>Enter</kbd></button></div>`;
      bindReveal(host, setId, q);
      const next = U.$('[data-next]', host);
      next.onclick = () => opts.onNext();
      next.focus({ preventScroll: true });
    };

    U.$$('.opt', host).forEach(b => { b.onclick = () => finish(b.dataset.orig, Math.round(performance.now() - t0)); });

    if (opts.timerSec) {
      const total = opts.timerSec * 1000;
      const fill = U.$('.timer-fill', host), txt = U.$('.timer-text', host);
      const tick = () => {
        const left = Math.max(0, total - (performance.now() - t0));
        fill.style.transform = `scaleX(${left / total})`;
        fill.classList.toggle('low', left < 5000);
        txt.textContent = `Осталось ${Math.ceil(left / 1000)} с`;
        if (left > 0 && !answered) raf = requestAnimationFrame(tick);
      };
      tick();
      timerId = setTimeout(() => finish(null, total), total);
    }

    App.keyHandler = e => {
      if (e.key === 'Escape' && opts.onEscape) { e.preventDefault(); opts.onEscape(answered); return; }
      if (answered) {
        if (e.key === 'Enter') { e.preventDefault(); opts.onNext(); }
        return;
      }
      const k = e.key.toUpperCase();
      let i = SHOWN.indexOf(k);
      if (i < 0) i = ['1', '2', '3', '4'].indexOf(e.key);
      // Русская раскладка: Ф, И, С, В на месте A, B, C, D.
      if (i < 0) i = ['Ф', 'И', 'С', 'В'].indexOf(k);
      if (i >= 0) { e.preventDefault(); U.$$('.opt', host)[i].click(); }
    };

    return { stop: () => { clearTimeout(timerId); cancelAnimationFrame(raf); } };
  }

  // ---------- Запуск игры ----------
  V.play = (setId, mode, query) => {
    if (!Games.MODES[mode]) return V.notFound();
    const u = me();
    const title = `${Icons.mode(mode)} ${Games.MODES[mode].title}`;
    const base = `#/set/${setId}/play/${mode}`;
    let g, questions, jboard = null, notices;

    if (query.resume) {
      // «Продолжить»: та же игра, те же вопросы; отвеченные остаются отвеченными.
      g = Games.byId(query.resume);
      if (!g || g.set_id !== setId || g.mode !== mode || !Games.canResume(g, u.id)) return App.go(base);
      const left = Games.remaining(g).length;
      notices = [`Продолжение игры: ${left === 1 ? 'остался' : 'осталось'} ${left} ${U.plural(left, 'вопрос', 'вопроса', 'вопросов')}.`];
      const live = n => { const q = Sets.question(setId, n); return q && !q.deleted_at ? q : null; };
      if (g.plan.cells) {
        const cells = {};
        for (const [k, n] of Object.entries(g.plan.cells)) if (live(n)) cells[k] = live(n);
        jboard = { cats: g.plan.cats, levels: g.plan.levels, cells };
        questions = Object.values(cells);
      } else {
        questions = g.plan.questions.map(live).filter(Boolean);
      }
      Games.resume(g);
    } else {
      const fresh = !!query.new;
      const source = query.saved ? { savedSetId: query.saved } : query.bookmarks ? { bookmarks: true }
        : query.mistakes ? { mistakes: true } : query.game ? { gameId: query.game } : query.cat ? { categoryId: +query.cat } : {};
      const listed = Object.keys(source).length > 0;
      // Последняя игра режима прервана — сначала спросить: продолжить её или начать новую.
      const prev = !listed && !fresh && Games.cutShort(u.id, setId, mode);
      if (prev) return resumeChoice(setId, mode, prev);

      const prep = Games.prepare(u.id, setId, mode, fresh && !listed ? { fresh: true } : source);
      if (mode === 'jeopardy' && prep.questions.length) {
        jboard = Games.jeopardyBoard(setId, prep.questions, prep.fixed ? null : prep.settings, prep.fixed);
        if (!jboard.cats.length) {
          prep.notices.push(`Для доски нужна хотя бы одна тема с ${APP_CONFIG.modes.jeopardy.minPerCategory}+ вопросами в пуле.`);
          prep.questions = [];
        }
      }
      if (!prep.questions.length) {
        return App.render(`<div class="card center"><h1 class="with-icon">${title}</h1>${prep.notices.map(n => `<p>${esc(n)}</p>`).join('')}
          <div class="row center"><a class="btn" href="#/set/${setId}">К набору</a></div></div>`);
      }
      questions = prep.questions;
      notices = prep.notices;
      g = Games.start(u.id, setId, mode, {
        savedSetId: prep.savedSet ? prep.savedSet.id : null, source: source.savedSetId || !listed ? null : source,
        notices, questions, board: jboard
      });
    }

    App.leave = () => {
      if (g.finished_at) return;
      if (g.answers.length) Games.finish(g);
      else Games.discard(g);
    };
    const root = App.render(`<div class="play">
      <div class="play-head"><a href="#/set/${setId}" class="muted">← ${esc(Sets.get(setId).title)}</a>
        <h1 class="with-icon">${title}</h1><div class="score" id="score" aria-live="polite"></div>
        <button class="btn small ghost" id="end">Завершить</button></div>
      ${notices.map(n => `<p class="notice">${esc(n)}</p>`).join('')}
      <div id="stage"></div></div>`);
    const ctx = { setId, g, stage: U.$('#stage', root), scoreEl: U.$('#score', root), cleanup: null };
    const end = () => {
      if (ctx.cleanup) ctx.cleanup();
      App.leave = null;
      Games.finish(g);
      App.go('#/game/' + g.id);
    };
    U.$('#end', root).onclick = async () => {
      if (!g.answers.length || await U.confirm('Завершить игру и посмотреть итоги?', 'Завершить')) end();
    };
    ctx.end = end;
    ({ cards: playCards, board: playBoard, jeopardy: playJeopardy, quiz: playQuiz })[mode](ctx, questions, jboard);
  };

  // Выбор после прерванной игры: продолжить её или начать новую из ещё не отвеченных вопросов.
  function resumeChoice(setId, mode, g) {
    const left = Games.remaining(g).length;
    const n = g.answers.filter(a => !a.is_repeat).length;
    const base = `#/set/${setId}/play/${mode}`;
    const root = App.render(`<div class="card center resume-choice">
      <h1 class="with-icon">${Icons.mode(mode)} ${Games.MODES[mode].title}</h1>
      <p class="lead">Прошлая игра прервана: отвечено ${n} из ${g.question_count}, ${left === 1 ? 'остался' : 'осталось'} ${left} ${U.plural(left, 'вопрос', 'вопроса', 'вопросов')}.</p>
      <p class="muted">${U.fmtDateTime(g.finished_at)}</p>
      <div class="row center">
        <a class="btn primary" href="${base}?resume=${g.id}">Продолжить игру</a>
        <a class="btn" href="${base}?new=1">Новая игра</a>
      </div>
      <p class="muted small">Новая игра — из вопросов, на которые вы ещё не отвечали в этом режиме.</p></div>`);
    U.$('.btn.primary', root).focus({ preventScroll: true });
  }

  // ---------- Карточки ----------
  function playCards(ctx, questions) {
    const { setId, g, stage, scoreEl, end } = ctx;
    // При продолжении: карточки со «знаю» уже сняты, показанные ранее идут как повторы.
    const seen = new Set(g.answers.map(a => a.question_id));
    const knownIds = new Set(g.answers.filter(a => a.correct).map(a => a.question_id));
    const queue = questions.filter(q => !knownIds.has(q.number)).map(q => ({ q, marked: seen.has(q.number) }));
    const total = questions.length;
    let known = total - queue.length;
    const progress = () => { scoreEl.textContent = `Знаю: ${known} из ${total} · в колоде ${queue.length}`; };

    const show = () => {
      progress();
      if (!queue.length) return end();
      const card = queue[0];
      const q = card.q;
      const t0 = performance.now();
      let flipped = false;
      stage.innerHTML = `<div class="flashcard" tabindex="-1">
        ${qMeta(setId, q)}${card.marked ? '<span class="tag repeat">повтор</span>' : ''}
        <h2 class="qtext">${esc(q.text)}</h2>
        <div class="back" hidden>
          <p class="answer">${esc(q[q.correct.toLowerCase()])}</p>
          ${revealHtml(setId, q)}
        </div>
        <div class="row center actions">
          <button class="btn primary big" data-flip>Показать ответ <kbd>Пробел</kbd></button>
        </div></div>`;
      const flip = () => {
        if (flipped) return;
        flipped = true;
        U.$('.back', stage).hidden = false;
        bindReveal(stage, setId, q);
        U.$('.actions', stage).innerHTML = `<button class="btn bad big" data-no>Не знаю <kbd>1</kbd></button>
          <button class="btn ok big" data-yes>Знаю <kbd>2</kbd></button>`;
        U.$('[data-no]', stage).onclick = () => mark(false);
        U.$('[data-yes]', stage).onclick = () => mark(true);
        U.$('[data-yes]', stage).focus({ preventScroll: true });
      };
      const mark = know => {
        queue.shift();
        Games.record(g, q, { selected: null, correct: know, time_ms: Math.round(performance.now() - t0), is_repeat: card.marked });
        card.marked = true;
        if (know) known++;
        else queue.splice(Math.min(queue.length, 3 + Math.floor(Math.random() * 3)), 0, card);
        show();
      };
      U.$('[data-flip]', stage).onclick = flip;
      App.keyHandler = e => {
        if (e.key === ' ' || e.key === 'Enter') { if (!flipped) { e.preventDefault(); flip(); } return; }
        if (!flipped) return;
        if (e.key === '1' || e.key === 'ArrowLeft') { e.preventDefault(); mark(false); }
        if (e.key === '2' || e.key === 'ArrowRight') { e.preventDefault(); mark(true); }
      };
    };
    show();
  }

  // ---------- Доска ----------
  function playBoard(ctx, questions) {
    const { setId, g, stage, scoreEl, end } = ctx;
    const prev = new Map(g.answers.map(a => [a.question_id, a.correct])); // при продолжении — уже открытые
    const tiles = questions.map(q => ({ q, state: !prev.has(q.number) ? 'closed' : prev.get(q.number) ? 'right' : 'wrong' }));
    const draw = () => {
      const done = tiles.filter(t => t.state !== 'closed');
      const ok = done.filter(t => t.state === 'right').length;
      scoreEl.textContent = `Открыто ${done.length} из ${tiles.length} · верных ${done.length ? Engine.percent(ok, done.length) : 0}%`;
      stage.innerHTML = `<div class="board" style="--cols:${Math.min(4, tiles.length)}">${tiles.map((t, i) => `
        <button class="tile ${t.state}" data-i="${i}" ${t.state !== 'closed' ? 'disabled' : ''}
          aria-label="Плитка ${i + 1}${t.state === 'right' ? ', верно' : t.state === 'wrong' ? ', неверно' : ''}">
          ${t.state === 'closed' ? i + 1 : t.state === 'right' ? '✓' : '✗'}</button>`).join('')}</div>
        <p class="muted small center">Выберите плитку. Клавиши: A–D — ответ, Enter — дальше, Esc — закрыть.</p>`;
      U.$$('.tile', stage).forEach(b => { b.onclick = () => open(+b.dataset.i); });
      App.keyHandler = null;
      if (done.length === tiles.length) end();
    };
    const open = i => {
      const t = tiles[i];
      const m = U.modal('<div class="mstage"></div>', { wide: true, onClose: draw });
      const close = () => m.close();
      mcq(U.$('.mstage', m.root), setId, t.q, {
        head: `<p class="muted">Плитка ${i + 1}</p>`,
        onAnswer: r => {
          Games.record(g, t.q, r);
          t.state = r.correct ? 'right' : 'wrong';
        },
        nextLabel: 'К доске',
        onNext: close,
        onEscape: close
      });
    };
    draw();
  }

  // ---------- Своя игра ----------
  function playJeopardy(ctx, _questions, board) {
    const { setId, g, stage, scoreEl, end } = ctx;
    const keys = Object.keys(board.cells);
    const opened = {}; // при продолжении — уже открытые ячейки
    const prev = new Map(g.answers.map(a => [a.question_id, a.correct]));
    keys.filter(k => prev.has(board.cells[k].number)).forEach(k => { opened[k] = prev.get(board.cells[k].number) ? 'right' : 'wrong'; });
    const draw = () => {
      scoreEl.innerHTML = `Счёт: <b class="${g.score < 0 ? 'neg' : ''}">${U.fmtNum(g.score)}</b>`;
      stage.innerHTML = `<div class="jboard" style="--cols:${board.cats.length}">
        ${board.cats.map(id => `<div class="jcat">${esc(Sets.categoryName(setId, id))}</div>`).join('')}
        ${board.levels.map(lv => board.cats.map(id => {
          const k = `${id}|${lv}`;
          if (!board.cells[k]) return '<div class="jcell empty" aria-hidden="true"></div>';
          const st = opened[k];
          return `<button class="jcell ${st || ''}" data-k="${k}" ${st ? 'disabled' : ''}
            aria-label="${esc(Sets.categoryName(setId, id))}, ${lv * 100}${st ? (st === 'right' ? ', верно' : ', неверно') : ''}">
            ${st ? (st === 'right' ? '+' : '−') + lv * 100 : lv * 100}</button>`;
        }).join('')).join('')}
      </div><p class="muted small center">Верный ответ добавляет цену вопроса, неверный — отнимает.</p>`;
      U.$$('.jcell[data-k]', stage).forEach(b => { b.onclick = () => open(b.dataset.k); });
      App.keyHandler = null;
      if (Object.keys(opened).length === keys.length) end();
    };
    const open = k => {
      const q = board.cells[k];
      const rowLevel = +k.split('|')[1]; // цена — по строке, даже если вопрос взят с соседнего уровня
      const price = rowLevel * 100;
      const m = U.modal('<div class="mstage"></div>', { wide: true, onClose: draw });
      const close = () => m.close();
      mcq(U.$('.mstage', m.root), setId, q, {
        head: `<p class="price">${esc(Sets.categoryName(setId, q.category_id))} · ${price}</p>`,
        onAnswer: r => {
          const pts = Engine.jeopardyPoints(rowLevel, r.correct);
          Games.record(g, q, { ...r, points: pts });
          opened[k] = r.correct ? 'right' : 'wrong';
          return `<b>${pts > 0 ? '+' : '−'}${Math.abs(pts)}</b>`;
        },
        nextLabel: 'К доске',
        onNext: close,
        onEscape: close
      });
    };
    draw();
  }

  // ---------- Викторина ----------
  function playQuiz(ctx, questions) {
    const { setId, g, stage, scoreEl, end } = ctx;
    const timer = APP_CONFIG.modes.quiz.timerSec;
    let i = 0;
    let current = null;
    ctx.cleanup = () => { if (current) current.stop(); };
    App.leave = (prev => () => { ctx.cleanup(); prev(); })(App.leave);
    const answered = new Set(g.answers.map(a => a.question_id)); // при продолжении — пропустить отвеченные
    const next = () => {
      while (i < questions.length && answered.has(questions[i].number)) i++;
      if (i >= questions.length) return end();
      const q = questions[i];
      scoreEl.innerHTML = `Вопрос ${i + 1} из ${questions.length} · <b>${U.fmtNum(g.score)}</b> баллов`;
      current = mcq(stage, setId, q, {
        timerSec: timer,
        onAnswer: r => {
          const pts = Engine.quizPoints(r.time_ms, r.correct, timer);
          Games.record(g, q, { ...r, points: pts });
          scoreEl.innerHTML = `Вопрос ${i + 1} из ${questions.length} · <b>${U.fmtNum(g.score)}</b> баллов`;
          return `<b>+${U.fmtNum(pts)}</b> за ${U.fmtNum(r.time_ms / 1000, 1)} с`;
        },
        nextLabel: i === questions.length - 1 ? 'К итогам' : 'Следующий вопрос',
        onNext: () => { i++; next(); }
      });
    };
    next();
  }

  // ---------- Итоги ----------
  V.results = gameId => {
    const g = Games.byId(gameId) || Sync.cachedGame(gameId);
    if (!g || !g.finished_at) return V.notFound('Игра не найдена');
    const u = me();
    if (g.user_id !== u.id && !Auth.isAdmin()) return V.notFound('Игра не найдена');
    const setId = g.set_id;
    const counted = g.answers.filter(a => !a.is_repeat);
    const ok = counted.filter(a => a.correct).length;
    const scored = g.mode === 'quiz' || g.mode === 'jeopardy';
    const catName = id => (g.category_names && g.category_names[id]) || Sets.categoryNameAny(setId, id);
    const aggTable = (scope, label, col, nameOf) => {
      const rows = g.aggregates.filter(a => a.scope === scope).sort((a, b) => b.answers - a.answers);
      if (!rows.length) return '';
      return `<div class="card"><h3>${label}</h3><div class="table-wrap"><table class="table">
        <thead><tr><th>${col}</th><th>Ответов</th><th>Верных</th><th>%</th></tr></thead>
        <tbody>${rows.map(a => {
          const p = Engine.percent(a.correct, a.answers);
          const weak = a.answers >= 3 && a.correct * 2 < a.answers;
          return `<tr class="${weak ? 'weak' : ''}"><td>${esc(nameOf(a.key))}${weak ? ' <span class="tag bad">слабое место</span>' : ''}</td>
            <td>${a.answers}</td><td>${a.correct}</td><td class="pctcell"><div class="meter"><span style="width:${p}%"></span></div> ${p}%</td></tr>`;
        }).join('')}</tbody></table></div></div>`;
    };
    const src = g.source || {};
    const againQuery = g.saved_set_id ? 'saved=' + g.saved_set_id : src.bookmarks ? 'bookmarks=1'
      : src.mistakes ? 'mistakes=1' : src.gameId ? 'game=' + src.gameId : src.categoryId ? 'cat=' + src.categoryId : '';
    const again = `#/set/${setId}/play/${g.mode}${againQuery ? '?' + againQuery : ''}`;
    const wrong = new Set(counted.filter(a => !a.correct).map(a => a.question_id)).size;
    const resumable = Games.byId(g.id) && Games.canResume(g, u.id);
    const left = resumable ? Games.remaining(g).length : 0;
    const root = App.render(`<div class="results">
      <div class="crumbs"><a href="#/set/${setId}">${esc(Sets.get(setId) ? Sets.get(setId).title : '')}</a> › Итоги</div>
      <h1 class="with-icon">${Icons.mode(g.mode)} ${Games.MODES[g.mode].title}: итоги</h1>
      <p class="muted">${U.fmtDateTime(g.finished_at)}${g.user_id !== u.id ? ' · игрок: ' + esc((Store.state.users.find(x => x.id === g.user_id) || {}).name || g.user_id) : ''}</p>
      ${g.empty_message ? `<div class="card center"><p class="lead">${esc(g.empty_message)}</p></div>` : `
      <div class="hero card">
        <div class="big-pct t${Engine.tierOf(g.percent)}">${g.percent}%</div>
        <div><p class="lead">Верно ${ok} из ${Math.max(g.question_count || 0, counted.length)}</p>
          ${g.question_count > counted.length ? `<p class="muted">Отвечено ${counted.length} из ${g.question_count}</p>` : ''}
          ${scored ? `<p class="lead">${g.mode === 'quiz' ? 'Баллы' : 'Счёт'}: <b>${U.fmtNum(g.score)}</b></p>` : ''}</div>
      </div>
      <div class="card feedback"><h2>Разбор</h2>${g.feedback.map(f => `<p class="fb fb-${f.kind}">${esc(f.text)}</p>`).join('')}</div>
      <div class="grid2">${aggTable('category', 'По темам', 'Тема', catName)}${aggTable('level', 'По уровням', 'Уровень', k => 'Уровень ' + k)}</div>`}
      <div class="row">${resumable ? `<a class="btn primary" href="#/set/${setId}/play/${g.mode}?resume=${g.id}">Продолжить игру (${left})</a>
        <a class="btn" href="${again}${againQuery ? '&' : '?'}new=1">Новая игра</a>` : `<a class="btn primary" href="${again}">Сыграть ещё</a>`}
        ${wrong && g.user_id === u.id ? `<a class="btn" href="#/set/${setId}/play/${g.mode}?game=${g.id}">Повторить ошибки (${wrong})</a>` : ''}
        <a class="btn" href="#/set/${setId}">К набору</a>
        <a class="btn ghost" href="#/set/${setId}/history">История</a></div>
      ${counted.length ? `<h2 class="section-title">Ответы</h2><div class="answers">${counted.map((a, i) => {
        const q = Sets.question(setId, a.question_id);
        if (!q) return '';
        const yours = g.mode === 'cards' ? (a.correct ? 'знаю' : 'не знаю')
          : a.selected ? esc(q[a.selected.toLowerCase()]) : 'нет ответа';
        return `<details class="ans ${a.correct ? 'ok' : 'bad'}"><summary><span class="mark">${a.correct ? '✓' : '✗'}</span>
          <span>${i + 1}. ${esc(q.text)}</span>${a.points ? `<span class="pts">${a.points > 0 ? '+' : ''}${U.fmtNum(a.points)}</span>` : ''}</summary>
          <p>Ваш ответ: <b>${yours}</b>${a.time_ms != null && g.mode === 'quiz' ? ` · ${U.fmtNum(a.time_ms / 1000, 1)} с` : ''}</p>
          <p>Правильный ответ: <b>${esc(q[q.correct.toLowerCase()])}</b></p>
          <div data-q="${q.number}">${revealHtml(setId, q)}</div></details>`;
      }).join('')}</div>` : ''}</div>`);
    U.$$('[data-q]', root).forEach(box => bindReveal(box, setId, Sets.question(setId, +box.dataset.q)));
  };
})();
