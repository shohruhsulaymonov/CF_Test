// Экран «Рейтинг»: место по числу верных ответов в наборе, при равенстве — по среднему времени ответа.
(function () {
  const V = App.views;
  const esc = U.esc;
  const TOP = 50;
  const initials = t => esc(String(t).trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase());
  const secs = ms => (ms == null ? '—' : `${U.fmtNum(ms / 1000, 1)} с`);

  function row(x, me) {
    const medal = x.place <= 3 ? ` medal m${x.place}` : '';
    return `<tr class="${x.user_id === me ? 'me' : ''}">
      <td><span class="place${medal}">${x.place}</span></td>
      <td><div class="person"><span class="avatar soft" aria-hidden="true">${initials(x.name)}</span>
        <span class="person-text"><b>${esc(x.name)}</b>${x.user_id === me ? '<small>Это вы</small>' : ''}</span></div></td>
      <td><b>${U.fmtNum(x.correct)}</b></td>
      <td>${U.fmtNum(x.answers)}</td>
      <td><span class="tag pct t${Engine.tierOf(x.percent)}">${x.percent}%</span></td>
      <td>${secs(x.avg_ms)}</td></tr>`;
  }

  V.leaderboard = (setId, query) => {
    const me = Auth.current().id;
    const hash = location.hash;
    const root = App.render(`${V.setHeader(setId, 'leaderboard')}
      <div class="toolbar">
        <span class="muted small">Место — по числу верных ответов за всё время; при равенстве выше тот, кто отвечает быстрее. Повторы в Карточках не считаются.</span>
        <button class="btn small ghost" id="lb-refresh">Обновить</button>
      </div>
      <div id="lb"><p class="muted center">Загрузка рейтинга…</p></div>`);

    const show = async force => {
      const box = U.$('#lb', root);
      let list;
      try {
        list = Stats.ranking(await Sync.leaderboard(force), setId);
      } catch (e) {
        if (location.hash !== hash) return;
        box.innerHTML = `<div class="card error-box"><p>Не удалось загрузить рейтинг: ${esc(e.message || e)}</p></div>`;
        return;
      }
      if (location.hash !== hash) return; // пользователь уже ушёл со страницы
      if (!list.length) {
        box.innerHTML = '<div class="card empty"><p>В этом наборе ещё никто не отвечал. Сыграйте первую игру — и вы на первом месте.</p></div>';
        return;
      }
      const top = list.slice(0, TOP);
      const mine = list.find(x => x.user_id === me);
      const extra = mine && !top.includes(mine) ? row(mine, me) : '';
      box.innerHTML = `${mine ? '' : '<p class="muted small">Вас пока нет в рейтинге этого набора — ответьте хотя бы на один вопрос.</p>'}
        <div class="table-card"><div class="table-wrap"><table class="table leaderboard">
        <thead><tr><th>Место</th><th>Участник</th><th>Верных</th><th>Ответов</th><th>Точность</th><th>Ср. время</th></tr></thead>
        <tbody>${top.map(x => row(x, me)).join('')}${extra ? `<tr class="gap"><td colspan="6">…</td></tr>${extra}` : ''}</tbody>
        </table></div></div>
        <p class="muted small">${list.length} ${U.plural(list.length, 'участник', 'участника', 'участников')}</p>`;
    };

    U.$('#lb-refresh', root).onclick = () => show(true);
    show(false);
  };
})();
