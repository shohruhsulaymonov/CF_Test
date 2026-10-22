// Аналитика (ТЗ §10): ошибочные вопросы, активность по дням, режимы, динамика по темам.
(function () {
  const V = App.views;
  const esc = U.esc;
  const PERIODS = [['7', '7 дней'], ['30', '30 дней'], ['90', '90 дней'], ['all', 'Всё время']];
  const MAX_CATS = 5;

  V.analytics = (setId, query) => {
    const u = Auth.current();
    const period = PERIODS.some(p => p[0] === query.p) ? query.p : '30';
    const everyone = Auth.isAdmin() && query.all === '1';
    const games = Store.state.games.filter(g => g.set_id === setId && (everyone || g.user_id === u.id));
    const today = U.dayKey(Date.now());

    const answers = games.flatMap(g => g.answers.filter(a => !a.is_repeat).map(a => ({ ...a, day: U.dayKey(a.answered_at) })));
    let startKey;
    if (period === 'all') {
      startKey = answers.length ? answers.reduce((m, a) => (a.day < m ? a.day : m), today) : today;
    } else {
      startKey = U.addDays(today, -(+period - 1));
    }
    const inPeriod = answers.filter(a => a.day >= startKey);
    const gamesIn = games.filter(g => g.finished_at && U.dayKey(g.started_at) >= startKey);

    const q = (k, v) => {
      const p = { p: period, all: everyone ? '1' : '' };
      p[k] = v;
      const s = Object.entries(p).filter(([, x]) => x).map(([a, b]) => `${a}=${b}`).join('&');
      return `#/set/${setId}/analytics${s ? '?' + s : ''}`;
    };

    const root = App.render(`${V.setHeader(setId, 'analytics')}
      <div class="toolbar">
        <div class="seg" role="group" aria-label="Период">${PERIODS.map(([k, l]) => `<a href="${q('p', k)}" class="${k === period ? 'active' : ''}">${l}</a>`).join('')}</div>
        ${Auth.isAdmin() ? `<div class="seg" role="group" aria-label="Чьи данные"><a href="${q('all', '')}" class="${everyone ? '' : 'active'}">Мои</a><a href="${q('all', '1')}" class="${everyone ? 'active' : ''}">Все пользователи</a></div>` : ''}
        <span class="muted small">${U.keyToRu(startKey)} — ${U.keyToRu(today)} · ${inPeriod.length} ${U.plural(inPeriod.length, 'ответ', 'ответа', 'ответов')}</span>
      </div>
      <div class="card"><h2>Чаще всего ошибочные вопросы</h2><div id="errs"></div></div>
      <div class="grid2">
        <div class="card"><h2>Активность по дням</h2><p class="muted small">Число ответов в день. Пустые кружки — дни без игр.</p><div id="act"></div></div>
        <div class="card"><h2>Режимы игры</h2><p class="muted small">Число завершённых игр.</p><div id="modes"></div></div>
      </div>
      <div class="card"><h2>Динамика по темам</h2>
        <p class="muted small">Процент верных ответов по неделям; недели, где меньше 3 ответов по теме, показаны разрывом. Не более ${MAX_CATS} тем.</p>
        <div id="cats-pick" class="checklist inline"></div><div id="cats"></div></div>`);

    // 1. Ошибочные вопросы: ≥2 ответов за период, сортировка по доле, затем по числу ошибок.
    const byQ = new Map();
    for (const a of inPeriod) {
      if (!byQ.has(a.question_id)) byQ.set(a.question_id, { n: a.question_id, answers: 0, errors: 0, last: 0 });
      const e = byQ.get(a.question_id);
      e.answers++;
      if (!a.correct) { e.errors++; e.last = Math.max(e.last, a.answered_at); }
    }
    const errs = [...byQ.values()].filter(e => e.answers >= 2 && e.errors > 0)
      .sort((a, b) => (b.errors / b.answers - a.errors / a.answers) || (b.errors - a.errors)).slice(0, 20);
    U.$('#errs', root).innerHTML = errs.length ? `<div class="table-wrap"><table class="table">
      <thead><tr><th>№</th><th>Вопрос</th><th>Тема</th><th>Уровень</th><th>Ошибок</th><th>Доля ошибок</th><th>Последняя ошибка</th></tr></thead>
      <tbody>${errs.map(e => {
        const qq = Sets.question(setId, e.n) || { text: '(удалён)', category_id: null, level: '—' };
        return `<tr><td>${e.n}</td><td class="wrap">${esc(qq.text)}</td><td>${esc(Sets.categoryNameAny(setId, qq.category_id))}</td><td>${qq.level}</td>
          <td>${e.errors}</td><td>${Engine.percent(e.errors, e.answers)}% <span class="muted">(${e.errors}/${e.answers})</span></td><td>${U.fmtDate(e.last)}</td></tr>`;
      }).join('')}</tbody></table></div>` : '<p class="muted">Недостаточно данных: в таблицу попадают вопросы, на которые ответили хотя бы дважды и ошиблись хотя бы раз.</p>';

    // 2. Активность по дням.
    const days = [];
    for (let d = startKey; d <= today; d = U.addDays(d, 1)) days.push(d);
    const perDay = {};
    inPeriod.forEach(a => { perDay[a.day] = (perDay[a.day] || 0) + 1; });
    Charts.line(U.$('#act', root), {
      title: 'Активность по дням',
      labels: days.map(d => d.slice(8, 10) + '.' + d.slice(5, 7)),
      tipLabels: days.map(U.keyToRu),
      series: [{ name: 'Ответов', color: Charts.color(0), values: days.map(d => perDay[d] || 0) }],
      hollowZero: true
    });

    // 3. Игры по режимам.
    Charts.bar(U.$('#modes', root), {
      title: 'Игры по режимам',
      labels: Games.MODE_IDS.map(m => Games.MODES[m].title),
      values: Games.MODE_IDS.map(m => gamesIn.filter(g => g.mode === m).length),
      color: Charts.color(0),
      valueName: 'Игр'
    });

    // 4. Динамика по темам: по умолчанию 5 тем с наибольшим числом ответов.
    const weeks = [];
    for (let w = U.weekStart(startKey); w <= U.weekStart(today); w = U.addDays(w, 7)) weeks.push(w);
    const catStats = new Map();
    for (const a of inPeriod) {
      const c = a.category_id_at_answer;
      if (!catStats.has(c)) catStats.set(c, { id: c, total: 0, weeks: {} });
      const s = catStats.get(c);
      s.total++;
      const w = U.weekStart(a.day);
      s.weeks[w] = s.weeks[w] || { n: 0, ok: 0 };
      s.weeks[w].n++;
      if (a.correct) s.weeks[w].ok++;
    }
    const catList = [...catStats.values()].sort((a, b) => b.total - a.total);
    // Цвет закрепляется за темой при выборе и не меняется, когда выбор других тем меняется.
    const slots = {};
    const colorOf = id => (slots[id] != null ? Charts.color(slots[id]) : 'var(--muted)');
    const assign = id => {
      const used = new Set(Object.values(slots));
      let i = 0;
      while (used.has(i)) i++;
      slots[id] = i;
    };
    let chosen = catList.slice(0, MAX_CATS).map(c => c.id);
    chosen.forEach(assign);
    const drawCats = () => {
      const pick = U.$('#cats-pick', root);
      pick.innerHTML = catList.map(c => `<label class="chk"><input type="checkbox" value="${c.id}" ${chosen.includes(c.id) ? 'checked' : ''}
        ${!chosen.includes(c.id) && chosen.length >= MAX_CATS ? 'disabled' : ''}> <i class="swatch" style="background:${colorOf(c.id)}"></i>${esc(Sets.categoryNameAny(setId, c.id))} <span class="muted">(${c.total})</span></label>`).join('');
      U.$$('input', pick).forEach(x => {
        x.onchange = () => {
          const id = +x.value;
          if (x.checked) { chosen = [...chosen, id]; assign(id); }
          else { chosen = chosen.filter(v => v !== id); delete slots[id]; }
          drawCats();
        };
      });
      const host = U.$('#cats', root);
      if (!catList.length) { host.innerHTML = '<p class="muted">Нет ответов за период.</p>'; return; }
      if (!chosen.length) { host.innerHTML = '<p class="muted">Отметьте хотя бы одну тему.</p>'; return; }
      Charts.line(host, {
        title: 'Динамика по темам',
        labels: weeks.map(w => 'с ' + w.slice(8, 10) + '.' + w.slice(5, 7)),
        tipLabels: weeks.map(w => `Неделя с ${U.keyToRu(w)}`),
        yMax: 100, unit: '%', yFormat: v => U.fmtNum(v),
        series: chosen.map(id => {
          const s = catStats.get(id);
          return {
            name: Sets.categoryNameAny(setId, id), color: colorOf(id),
            values: weeks.map(w => (s.weeks[w] && s.weeks[w].n >= 3 ? Engine.percent(s.weeks[w].ok, s.weeks[w].n) : null))
          };
        })
      });
    };
    drawCats();
  };
})();
