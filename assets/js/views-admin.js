// Админ-панель (ТЗ §11): импорт, вопросы, категории, отчёты, пользователи.
(function () {
  const V = App.views;
  const esc = U.esc;
  const TABS = [['import', 'Импорт и наборы'], ['questions', 'Вопросы'], ['categories', 'Категории'], ['reports', 'Отчёты'], ['users', 'Пользователи']];

  V.admin = (tab, query) => {
    if (!TABS.some(t => t[0] === tab)) tab = 'import';
    const sets = Sets.list();
    const setId = sets.some(s => s.id === query.set) ? query.set : Sets.primaryId();
    const newReports = Store.state.reports.filter(r => r.status === 'new').length;
    const root = App.render(`<section class="set-head"><h1>Админ-панель</h1>
      <div class="toolbar"><label>Набор: <select id="aset">${sets.map(s => `<option value="${s.id}" ${s.id === setId ? 'selected' : ''}>${esc(s.title)}</option>`).join('')}</select></label></div>
      <nav class="tabs">${TABS.map(([k, l]) => `<a href="#/admin/${k}?set=${setId}" class="${k === tab ? 'active' : ''}">${l}${k === 'reports' && newReports ? ` <span class="badge">${newReports}</span>` : ''}</a>`).join('')}</nav>
      </section><div id="atab"></div>`);
    U.$('#aset', root).onchange = e => App.go(`#/admin/${tab}?set=${e.target.value}`);
    const host = U.$('#atab', root);
    ({ import: tabImport, questions: tabQuestions, categories: tabCategories, reports: tabReports, users: tabUsers })[tab](host, setId, query);
  };

  // ---------- Импорт ----------
  function tabImport(host, setId, query) {
    const st = Sets.get(setId);
    const isNew = query.new === '1';
    host.innerHTML = `
      <div class="card">
        <h2>${isNew ? 'Новый набор из Excel' : `Обновить «${esc(st.title)}» из Excel`}</h2>
        <p class="muted">Формат как у CorpFin_300.xlsx: лист с вопросами (№, вопрос, A, B, C, D, правильный вариант, категория, подсказка, сложность 1–5, мнемоника) и необязательный лист «Источники».
          Ключ строки — №: существующие обновляются, новые добавляются, пропавшие из файла скрываются.</p>
        <div class="row"><a class="btn small ${isNew ? 'ghost' : 'primary'}" href="#/admin/import?set=${setId}">Обновить выбранный набор</a>
          <a class="btn small ${isNew ? 'primary' : 'ghost'}" href="#/admin/import?set=${setId}&new=1">Создать новый набор</a></div>
        <form id="impf" class="settings">
          ${isNew ? `<div class="filters">
            <label>Название <input name="title" required maxlength="80"></label>
            <label>Код (латиница, для адреса) <input name="id" required pattern="[a-z0-9][a-z0-9\\-]{0,40}" placeholder="macro-2026"></label>
            <label class="span2">Описание <input name="description" maxlength="200"></label></div>` : ''}
          <label>Файл Excel <input type="file" name="file" accept=".xlsx,.xls" required></label>
          <div class="row end"><button class="btn primary">Предпросмотр</button></div>
        </form>
        <div id="preview"></div>
      </div>
      ${isNew ? '' : `<div class="card"><h2>Файл набора</h2>
        <p>${st.origin === 'file' ? `Набор загружается из <code>sets/${esc(st.id)}.js</code> (исходный Excel: ${esc(st.sourceFile || '—')}). Когда файл меняется, сайт применяет изменения автоматически; ваши правки сохраняются в строках, которых изменение файла не коснулось.`
          : 'Набор загружен в браузере и хранится только здесь. Скачайте файл набора, чтобы добавить его на сайт для всех.'}</p>
        <div class="row"><button class="btn" id="dl">Скачать файл набора (.js)</button>
          ${st.origin === 'upload' ? '<button class="btn bad" id="rmset">Удалить набор</button>' : ''}</div></div>
      <div class="card"><h2>Журнал импорта</h2>${importLog(st)}</div>`}
      <div class="card"><h2>Резервная копия данных</h2>
        <p class="muted">Все игры, пользователи, наборы и отчёты хранятся в этом браузере. Сохраните копию перед очисткой браузера или переносом на другой компьютер.</p>
        <div class="row"><button class="btn" id="bk">Скачать копию (.json)</button>
          <label class="btn ghost">Восстановить из копии<input type="file" id="rs" accept=".json" hidden></label></div></div>`;

    const form = U.$('#impf', host);
    form.onsubmit = async e => {
      e.preventDefault();
      const file = form.file.files[0];
      if (!file) return;
      let targetId = setId, meta = {};
      if (isNew) {
        targetId = form.id.value.trim();
        if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(targetId)) return U.toast('Код: строчная латиница, цифры и дефис', 'error');
        if (Sets.get(targetId) || Sets.hasDef(targetId)) return U.toast('Набор с таким кодом уже есть', 'error');
        meta = { title: form.title.value.trim(), description: form.description.value.trim(), origin: 'upload', sourceFile: file.name };
      } else {
        meta = { sourceFile: file.name };
      }
      let wb;
      try {
        wb = await Sets.readWorkbook(file);
      } catch (err) {
        return U.toast('Не удалось прочитать файл: ' + err.message, 'error');
      }
      const parsed = Sets.parseQuestionRows(wb.questions);
      const plan = Sets.planImport(targetId, parsed);
      const sources = wb.sources.length ? Sets.parseSourceRows(wb.sources) : null;
      showPreview(U.$('#preview', host), plan, sources, () => {
        const res = Sets.applyImport(targetId, plan, meta, sources);
        if (isNew) res.origin = 'upload';
        Store.save();
        U.toast('Импорт применён');
        App.go(`#/admin/import?set=${targetId}`);
      });
    };
    const dl = U.$('#dl', host);
    if (dl) dl.onclick = () => U.download(`${setId}.js`, Sets.exportSetFile(setId));
    const rm = U.$('#rmset', host);
    if (rm) {
      rm.onclick = async () => {
        if (!await U.confirm(`Удалить набор «${st.title}» вместе с вопросами? История игр останется, но открыть её будет нельзя.`, 'Удалить')) return;
        Sets.removeUploaded(setId);
        App.go('#/admin/import');
      };
    }
    U.$('#bk', host).onclick = () => U.download(`exam-trainer-backup-${U.dayKey(Date.now())}.json`, Store.exportAll(), 'application/json');
    U.$('#rs', host).onchange = async e => {
      const f = e.target.files[0];
      if (!f) return;
      if (!await U.confirm('Заменить все данные этого браузера данными из копии?', 'Заменить')) return;
      try {
        Store.importAll(await f.text());
        U.toast('Данные восстановлены');
        location.reload();
      } catch (err) {
        U.toast('Файл копии повреждён', 'error');
      }
    };
  }

  function showPreview(box, plan, sources, apply) {
    const stat = (n, l, cls = '') => `<div class="stat ${cls}"><b>${n}</b><span>${l}</span></div>`;
    box.innerHTML = `<h3>Предпросмотр</h3>
      <div class="stats">${stat(plan.add.length, 'добавится')}${stat(plan.update.length, 'изменится')}
        ${stat(plan.restore.length, 'вернётся')}${stat(plan.hide.length, 'будет скрыто', plan.hide.length ? 'warn' : '')}
        ${stat(plan.unchanged, 'без изменений')}${stat(plan.errors.length, 'строк с ошибками', plan.errors.length ? 'bad' : '')}</div>
      ${sources ? `<p>Лист «Источники»: ${sources.length} строк — заменит текущий список.</p>` : ''}
      ${plan.manualOverwrite.length ? `<p class="notice warn">Будут перезаписаны вопросы, изменённые вручную: №${plan.manualOverwrite.join(', №')}.</p>` : ''}
      ${plan.hide.length ? `<p class="notice">Скрыты будут №${plan.hide.slice(0, 50).join(', ')}${plan.hide.length > 50 ? '…' : ''}. Ответы и закладки сохранятся; из сохранённых наборов вопросы уйдут, владельцы получат уведомление.</p>` : ''}
      ${plan.errors.length ? `<details open><summary>Ошибки в строках (не будут импортированы)</summary><ul class="errlist">${plan.errors.map(e =>
        `<li>Строка ${e.line}${e.number ? ` (№${e.number})` : ''}: ${esc(e.messages.join('; '))}</li>`).join('')}</ul></details>` : ''}
      <div class="row end"><button class="btn primary" id="apply" ${plan.add.length + plan.update.length + plan.restore.length + plan.hide.length + (sources ? 1 : 0) ? '' : 'disabled'}>Применить</button></div>`;
    U.$('#apply', box).onclick = apply;
  }

  function importLog(st) {
    if (!st.importLog || !st.importLog.length) return '<p class="muted">Импортов не было.</p>';
    return `<div class="table-wrap"><table class="table"><thead><tr><th>Дата</th><th>Добавлено</th><th>Изменено</th><th>Возвращено</th><th>Скрыто</th><th>Ошибки</th></tr></thead>
      <tbody>${st.importLog.map(l => `<tr><td>${U.fmtDateTime(l.at)}</td><td>${l.added}</td><td>${l.updated}</td><td>${l.restored || 0}</td><td>${l.hidden}</td>
        <td>${l.errors.length ? `<details><summary>${l.errors.length}</summary><ul class="errlist">${l.errors.map(e => `<li>Строка ${e.line}: ${esc(e.messages.join('; '))}</li>`).join('')}</ul></details>` : '0'}</td></tr>`).join('')}</tbody></table></div>`;
  }

  // ---------- Вопросы ----------
  function tabQuestions(host, setId) {
    const cats = Sets.categories(setId);
    host.innerHTML = `<div class="toolbar">
        <input type="search" id="q" placeholder="Поиск по тексту или №" aria-label="Поиск">
        <select id="fc"><option value="">Все категории</option>${cats.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
        <select id="fs"><option value="">Все</option><option value="active">Активные</option><option value="hidden">Скрытые</option><option value="edited">Изменённые вручную</option></select>
      </div><p class="muted small" id="found"></p><div id="qt"></div>`;
    const draw = () => {
      const text = U.$('#q', host).value.trim().toLowerCase();
      const fc = U.$('#fc', host).value, fs = U.$('#fs', host).value;
      const list = Sets.questions(setId, { includeDeleted: true }).filter(q =>
        (!fc || q.category_id === +fc) &&
        (!fs || (fs === 'hidden' ? q.deleted_at : fs === 'edited' ? q.manual_edit : !q.deleted_at)) &&
        (!text || String(q.number) === text || q.text.toLowerCase().includes(text)));
      U.$('#found', host).textContent = `Найдено: ${list.length}`;
      U.$('#qt', host).innerHTML = `<div class="table-wrap"><table class="table">
        <thead><tr><th>№</th><th>Вопрос</th><th>Категория</th><th>Ур.</th><th>Ответ</th><th>Статус</th><th></th></tr></thead>
        <tbody>${list.slice(0, 300).map(q => `<tr class="${q.deleted_at ? 'hidden-row' : ''}"><td>${q.number}</td><td class="wrap">${esc(q.text)}</td>
          <td>${esc(Sets.categoryName(setId, q.category_id))}</td><td>${q.level}</td><td>${q.correct}</td>
          <td>${q.deleted_at ? `<span class="tag bad">скрыт${q.hidden_by === 'import' ? ' импортом' : ''}</span>` : ''}${q.manual_edit ? '<span class="tag">правка</span>' : ''}</td>
          <td class="row nowrap"><button class="btn small" data-edit="${q.number}">Изменить</button>
            ${q.deleted_at ? `<button class="btn small ghost" data-restore="${q.number}">Вернуть</button>` : `<button class="btn small ghost" data-hide="${q.number}">Скрыть</button>`}</td></tr>`).join('')}
        </tbody></table></div>`;
    };
    ['#q', '#fc', '#fs'].forEach(id => U.$(id, host).addEventListener('input', draw));
    host.addEventListener('click', async e => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.edit) editQuestion(setId, +b.dataset.edit, draw);
      if (b.dataset.hide && await U.confirm(`Скрыть вопрос №${b.dataset.hide}? Он исчезнет из игр и сохранённых наборов.`, 'Скрыть')) {
        Sets.hideQuestion(setId, +b.dataset.hide, 'admin'); draw();
      }
      if (b.dataset.restore) { Sets.restoreQuestion(setId, +b.dataset.restore); draw(); }
    });
    draw();
  }

  function editQuestion(setId, n, done) {
    const q = Sets.question(setId, n);
    const cats = Sets.categories(setId);
    const m = U.modal(`<h2>Вопрос №${n}</h2>
      <p class="muted small">Следующий импорт может перезаписать правку, если в файле изменится эта строка.</p>
      <form id="eq" class="settings">
        <label>Текст вопроса <textarea name="text" rows="3" required>${esc(q.text)}</textarea></label>
        ${Sets.LETTERS.map(L => `<label>Вариант ${L} <textarea name="${L.toLowerCase()}" rows="2" required>${esc(q[L.toLowerCase()])}</textarea></label>`).join('')}
        <div class="filters">
          <label>Правильный <select name="correct">${Sets.LETTERS.map(L => `<option ${q.correct === L ? 'selected' : ''}>${L}</option>`).join('')}</select></label>
          <label>Сложность <select name="level">${[1, 2, 3, 4, 5].map(l => `<option ${q.level === l ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="span2">Категория <input name="category" list="catlist" required value="${esc(Sets.categoryName(setId, q.category_id))}">
            <datalist id="catlist">${cats.map(c => `<option value="${esc(c.name)}">`).join('')}</datalist></label>
        </div>
        <label>Подсказка <textarea name="hint" rows="2">${esc(q.hint)}</textarea></label>
        <label>Мнемоника <textarea name="mnemonic" rows="2">${esc(q.mnemonic)}</textarea></label>
        <p class="field-error" role="alert"></p>
        <div class="row end"><button class="btn primary">Сохранить</button></div>
      </form>`, { wide: true });
    const f = U.$('#eq', m.root);
    f.onsubmit = e => {
      e.preventDefault();
      const v = k => f[k].value.trim();
      const opts = ['a', 'b', 'c', 'd'].map(v);
      const err = !v('text') ? 'Введите текст вопроса' : opts.some(o => !o) ? 'Заполните все варианты'
        : new Set(opts.map(o => o.toLowerCase())).size < 4 ? 'Варианты должны различаться' : !v('category') ? 'Укажите категорию' : '';
      if (err) { U.$('.field-error', f).textContent = err; return; }
      Sets.updateQuestion(setId, n, {
        text: v('text'), a: opts[0], b: opts[1], c: opts[2], d: opts[3], correct: f.correct.value,
        level: +f.level.value, category: v('category'), hint: v('hint'), mnemonic: v('mnemonic')
      });
      m.close();
      U.toast('Вопрос сохранён');
      done();
    };
  }

  // ---------- Категории ----------
  function tabCategories(host, setId) {
    const all = Sets.questions(setId, { includeDeleted: true });
    const cats = Sets.categories(setId).map(c => ({ ...c, total: all.filter(q => q.category_id === c.id).length }));
    host.innerHTML = `<div class="card"><p class="muted">Переименование и объединение не меняют итоги прошедших игр. Удалить можно только категорию без вопросов (включая скрытые).</p>
      <div class="table-wrap"><table class="table"><thead><tr><th>Категория</th><th>Активных</th><th>Всего</th><th></th></tr></thead>
      <tbody>${cats.map(c => `<tr><td>${esc(c.name)}</td><td>${c.count}</td><td>${c.total}</td>
        <td class="row nowrap"><button class="btn small" data-ren="${c.id}">Переименовать</button>
          <button class="btn small ghost" data-merge="${c.id}">Объединить…</button>
          ${c.total ? '' : `<button class="btn small bad" data-del="${c.id}">Удалить</button>`}</td></tr>`).join('')}</tbody></table></div></div>`;
    host.addEventListener('click', async e => {
      const b = e.target.closest('button');
      if (!b) return;
      const id = +(b.dataset.ren || b.dataset.merge || b.dataset.del);
      const c = cats.find(x => x.id === id);
      if (b.dataset.ren) {
        const m = U.modal(`<h2>Переименовать</h2><form id="rn"><input name="n" value="${esc(c.name)}" required maxlength="80">
          <p class="field-error"></p><div class="row end"><button class="btn primary">Сохранить</button></div></form>`);
        U.$('#rn', m.root).onsubmit = ev => {
          ev.preventDefault();
          try { Sets.renameCategory(setId, id, ev.target.n.value); m.close(); V.admin('categories', { set: setId }); } catch (err) { U.$('.field-error', m.root).textContent = err.message; }
        };
      }
      if (b.dataset.merge) {
        const m = U.modal(`<h2>Объединить «${esc(c.name)}»</h2><form id="mg"><label>Перенести все вопросы в
          <select name="to">${cats.filter(x => x.id !== id).map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></label>
          <div class="row end"><button class="btn primary">Объединить</button></div></form>`);
        U.$('#mg', m.root).onsubmit = ev => {
          ev.preventDefault();
          Sets.mergeCategory(setId, id, +ev.target.to.value);
          m.close();
          V.admin('categories', { set: setId });
        };
      }
      if (b.dataset.del && await U.confirm(`Удалить категорию «${c.name}»?`, 'Удалить')) {
        Sets.deleteCategory(setId, id);
        V.admin('categories', { set: setId });
      }
    });
  }

  // ---------- Отчёты ----------
  function tabReports(host, setId) {
    const users = Store.state.users;
    const draw = () => {
      const f = U.$('#rsf', host) ? U.$('#rsf', host).value : 'new';
      const list = Store.state.reports.filter(r => r.set_id === setId && (!f || r.status === f)).sort((a, b) => b.created_at - a.created_at);
      U.$('#rl', host).innerHTML = list.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Дата</th><th>Вопрос</th><th>Пользователь</th><th>Комментарий</th><th>Статус</th><th>Заметка админа</th></tr></thead>
        <tbody>${list.map(r => {
          const q = Sets.question(setId, r.question_id);
          return `<tr><td>${U.fmtDateTime(r.created_at)}</td><td class="wrap"><b>№${r.question_id}</b> ${q ? esc(q.text) : ''}<br><button class="link" data-editq="${r.question_id}">изменить вопрос</button></td>
            <td>${esc((users.find(u => u.id === r.user_id) || {}).name || '—')}</td><td class="wrap">${esc(r.comment)}</td>
            <td><select data-st="${r.id}">${Object.entries(Games.REPORT_STATUS).map(([k, l]) => `<option value="${k}" ${r.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
            <td><textarea data-note="${r.id}" rows="2">${esc(r.admin_note)}</textarea></td></tr>`;
        }).join('')}</tbody></table></div>` : '<p class="muted">Отчётов нет.</p>';
    };
    host.innerHTML = `<div class="card"><div class="toolbar"><label>Статус <select id="rsf"><option value="">все</option>
      ${Object.entries(Games.REPORT_STATUS).map(([k, l]) => `<option value="${k}" ${k === 'new' ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div><div id="rl"></div></div>`;
    U.$('#rsf', host).onchange = draw;
    host.addEventListener('change', e => {
      const r = Store.state.reports.find(x => x.id === (e.target.dataset.st || e.target.dataset.note));
      if (!r) return;
      if (e.target.dataset.st) r.status = e.target.value;
      else r.admin_note = e.target.value;
      Store.save();
      U.toast('Сохранено');
    });
    host.addEventListener('click', e => {
      const b = e.target.closest('[data-editq]');
      if (b) editQuestion(setId, +b.dataset.editq, draw);
    });
    draw();
  }

  // ---------- Пользователи ----------
  function tabUsers(host) {
    const users = Store.state.users.filter(u => Auth.role(u) !== 'admin').sort((a, b) => b.last_seen_at - a.last_seen_at);
    host.innerHTML = `<div class="card"><p class="muted">Хранится только имя и статистика. Администраторы задаются в <code>assets/js/config.js</code> и здесь не показываются.</p>
      ${users.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Имя</th><th>Роль</th><th>Создан</th><th>Последний вход</th><th>Игр</th><th>Средний %</th></tr></thead>
      <tbody>${users.map(u => {
        const gs = Store.state.games.filter(g => g.user_id === u.id && g.finished_at);
        const sc = gs.filter(g => g.percent != null);
        return `<tr><td>${esc(u.name)}</td><td>студент</td><td>${U.fmtDate(u.created_at)}</td><td>${U.fmtDateTime(u.last_seen_at)}</td>
          <td>${gs.length}</td><td>${sc.length ? Math.round(sc.reduce((s, g) => s + g.percent, 0) / sc.length) + '%' : '—'}</td></tr>`;
      }).join('')}</tbody></table></div>` : '<p class="muted">Пользователей пока нет.</p>'}</div>`;
  }
})();
