// Админ-панель (ТЗ §11): статистика пользователей, отчёты, импорт, вопросы, категории, проверка.
(function () {
  const V = App.views;
  const esc = U.esc;
  const TABS = [['stats', 'Статистика'], ['reports', 'Отчёты'], ['import', 'Импорт и наборы'], ['questions', 'Вопросы'], ['categories', 'Категории'], ['audit', 'Проверка']];

  V.admin = (tab, query) => {
    if (!TABS.some(t => t[0] === tab)) tab = 'stats';
    const sets = Sets.list();
    const setId = sets.some(s => s.id === query.set) ? query.set : Sets.primaryId();
    const newReports = Store.state.reports.filter(r => r.status === 'new').length;
    const root = App.render(`<section class="set-head"><h1>Админ-панель</h1>
      <div class="toolbar"><label>Набор: <select id="aset">${sets.map(s => `<option value="${s.id}" ${s.id === setId ? 'selected' : ''}>${esc(s.title)}</option>`).join('')}</select></label></div>
      <nav class="tabs">${TABS.map(([k, l]) => `<a href="#/admin/${k}?set=${setId}" class="${k === tab ? 'active' : ''}">${l}${k === 'reports' && newReports ? ` <span class="badge">${newReports}</span>` : ''}</a>`).join('')}</nav>
      </section><div id="atab"></div>`);
    U.$('#aset', root).onchange = e => App.go(`#/admin/${tab}?set=${e.target.value}`);
    const host = U.$('#atab', root);
    ({ stats: tabStats, import: tabImport, questions: tabQuestions, categories: tabCategories, audit: tabAudit, reports: tabReports })[tab](host, setId, query);
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
          : Sync.configured() ? 'Набор загружен в браузере и опубликован на сервере — его видят все пользователи. Файл набора можно скачать для репозитория или резервной копии.'
          : 'Набор загружен в браузере и хранится только здесь. Скачайте файл набора, чтобы добавить его на сайт для всех.'}
          ${Sync.configured() ? ' Правки, импорт и скрытие вопросов публикуются на сервере и доходят до всех пользователей при следующем открытии сайта.' : ''}</p>
        <div class="row"><button class="btn" id="dl">Скачать файл набора (.js)</button>
          ${st.origin === 'upload' ? '<button class="btn bad" id="rmset">Удалить набор</button>' : ''}</div></div>
      <div class="card"><h2>Журнал импорта</h2>${importLog(st)}</div>`}
      <div class="card"><h2>Резервная копия данных</h2>
        <p class="muted">${Sync.configured() ? 'Все данные хранятся на сервере (Firebase); здесь — копия данных этого браузера.'
          : 'Все игры, пользователи, наборы и отчёты хранятся в этом браузере. Сохраните копию перед очисткой браузера или переносом на другой компьютер.'}</p>
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

  // ---------- Проверка содержания ----------
  function tabAudit(host, setId) {
    const a = Sets.audit(setId);
    const pct = n => (a.total ? Engine.percent(n, a.total) : 0);
    const minPer = APP_CONFIG.modes.jeopardy.minPerCategory;
    const longPct = pct(a.longest.length);
    const missingLevels = Object.keys(a.levels).filter(l => !a.levels[l]);
    const stat = (n, l, cls = '') => `<div class="stat ${cls}"><b>${n}</b><span>${l}</span></div>`;
    const qLink = n => `<button class="link" data-edit="${n}">№${n}</button>`;
    host.innerHTML = `<div class="card"><h2>Сводка</h2>
        <p class="muted">Подсказки для автора вопросов. Данные не меняются; правьте вопросы здесь или в Excel.</p>
        <div class="stats">${stat(a.total, 'вопросов')}
          ${stat(longPct + '%', 'правильный — самый длинный', longPct > 40 ? 'warn' : '')}
          ${stat(a.duplicates.length, 'дублей текста', a.duplicates.length ? 'bad' : '')}
          ${stat(a.noHint, 'без подсказки', a.noHint ? 'warn' : '')}${stat(a.noMnemonic, 'без мнемоники', a.noMnemonic ? 'warn' : '')}</div></div>
      <div class="card"><h2>Самый длинный вариант — правильный</h2>
        <p>${a.longest.length} из ${a.total} (${longPct}%). Случайно ожидается около 25%. Когда доля заметно выше, ответ можно угадать по длине, не зная материала —
          уравняйте длину неверных вариантов.</p>
        ${a.longest.length ? `<details><summary>Список вопросов</summary><p>${a.longest.map(qLink).join(' ')}</p></details>` : ''}</div>
      <div class="grid2">
        <div class="card"><h2>Правильная буква</h2><div class="table-wrap"><table class="table"><thead><tr><th>Буква</th><th>Вопросов</th><th>%</th></tr></thead>
          <tbody>${Object.entries(a.letters).map(([L, n]) => `<tr><td>${L}</td><td>${n}</td><td>${pct(n)}%</td></tr>`).join('')}</tbody></table></div></div>
        <div class="card"><h2>Сложность</h2><div class="table-wrap"><table class="table"><thead><tr><th>Уровень</th><th>Вопросов</th><th>%</th></tr></thead>
          <tbody>${Object.entries(a.levels).map(([l, n]) => `<tr class="${n ? '' : 'weak'}"><td>${l}</td><td>${n}</td><td>${pct(n)}%</td></tr>`).join('')}</tbody></table></div>
          ${missingLevels.length ? `<p class="muted small">Нет вопросов уровня ${missingLevels.join(', ')}: в «Своей игре» не будет этих строк, фильтр сложности почти не помогает.</p>` : ''}</div>
      </div>
      <div class="card"><h2>Темы по числу вопросов</h2>
        <p class="muted small">Тема с менее чем ${minPer} вопросами не попадает на доску «Своей игры» и редко становится «слабым местом» в разборе.</p>
        <div class="table-wrap"><table class="table"><thead><tr><th>Тема</th><th>Вопросов</th></tr></thead>
        <tbody>${a.categories.map(c => `<tr class="${c.count < minPer ? 'weak' : ''}"><td>${esc(c.name)}${c.count < minPer ? ' <span class="tag bad">мало</span>' : ''}</td><td>${c.count}</td></tr>`).join('')}</tbody></table></div></div>
      ${a.duplicates.length ? `<div class="card"><h2>Одинаковый текст вопроса</h2><ul>${a.duplicates.map(ns => `<li>${ns.map(qLink).join(', ')}</li>`).join('')}</ul></div>` : ''}`;
    host.addEventListener('click', e => {
      const b = e.target.closest('[data-edit]');
      if (b) editQuestion(setId, +b.dataset.edit, () => V.admin('audit', { set: setId }));
    });
  }

  // ---------- Отчёты ----------
  function tabReports(host, setId) {
    const users = Store.state.users;
    const nameOf = r => r.user_name || (users.find(u => u.id === r.user_id) || {}).name || r.user_id || '—';
    const draw = () => {
      const f = U.$('#rsf', host) ? U.$('#rsf', host).value : 'new';
      const list = Store.state.reports.filter(r => r.set_id === setId && (!f || r.status === f)).sort((a, b) => b.created_at - a.created_at);
      U.$('#rl', host).innerHTML = list.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Дата</th><th>Вопрос</th><th>Пользователь</th><th>Комментарий</th><th>Статус</th><th>Заметка админа</th></tr></thead>
        <tbody>${list.map(r => {
          const q = Sets.question(setId, r.question_id);
          return `<tr><td>${U.fmtDateTime(r.created_at)}</td><td class="wrap"><b>№${r.question_id}</b> ${q ? esc(q.text) : ''}<br><button class="link" data-editq="${r.question_id}">изменить вопрос</button></td>
            <td>${esc(nameOf(r))}</td><td class="wrap">${esc(r.comment)}</td>
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
      if (e.target.dataset.st) {
        r.status = e.target.value;
        // Автор отчёта узнаёт о смене статуса в «Уведомлениях» (с Firebase — на любом устройстве).
        const st = Sets.get(r.set_id);
        Store.notify(r.user_id, `Ваше сообщение об ошибке в вопросе №${r.question_id}${st ? ` («${st.title}»)` : ''}: статус «${Games.REPORT_STATUS[r.status]}».${r.admin_note ? ' Комментарий: ' + r.admin_note : ''}`);
      } else {
        r.admin_note = e.target.value;
      }
      Store.save('misc');
      Store.queue('reports', r.id);
      U.toast('Сохранено');
    });
    host.addEventListener('click', e => {
      const b = e.target.closest('[data-editq]');
      if (b) editQuestion(setId, +b.dataset.editq, draw);
    });
    draw();
    Sync.pullReports().then(changed => { if (changed && host.isConnected) draw(); });
  }

  // ---------- Статистика ----------
  // Сводки пользователей (Sync.adminData): с Firebase — всех, без него — этого браузера.
  const stat = (n, l, cls = '') => `<div class="stat ${cls}"><b>${n}</b><span>${l}</span></div>`;
  const pctOf = (ok, n) => (n ? Engine.percent(ok, n) + '%' : '—');
  const modeTitle = m => (m ? (Games.MODES[m] || { title: m }).title : '—');
  const ACTIVITY_DAYS = 30;
  const HARD_LIMIT = 15;

  function tabStats(host, setId, query) {
    const load = force => {
      host.innerHTML = '<div class="card"><p class="muted">Загрузка статистики…</p></div>';
      Promise.all([Sync.adminData(force), Sync.pullReports()]).then(([data]) => {
        if (!host.isConnected) return;
        if (query.user) userStats(host, setId, data, query.user);
        else allStats(host, setId, data);
        U.$('#reload', host).onclick = () => load(true);
      }).catch(e => {
        host.innerHTML = `<div class="card error-box"><p>${esc(e.message)}</p><button class="btn" id="retry">Повторить</button></div>`;
        U.$('#retry', host).onclick = () => load(true);
      });
    };
    load(false);
  }

  const statsHead = data => `<div class="toolbar"><span class="muted small">${data.remote ? 'Данные всех пользователей с сервера' : 'Firebase не настроен: данные только этого браузера'}
    · обновлено ${U.fmtDateTime(data.at)}</span><button class="btn small ghost" id="reload">Обновить</button></div>`;

  const setSummary = (data, userId, setId) => {
    const doc = data.stats.get(userId);
    return (doc && doc.sets && doc.sets[setId]) || Stats.blank();
  };

  function allStats(host, setId, data) {
    const admins = (APP_CONFIG.adminEmails || []).map(e => e.toLowerCase());
    const isAdminUser = u => (u.email ? admins.includes(u.email.toLowerCase()) : Auth.isAdminKey(u.name_key || U.nameKey(u.name)));
    const per = data.users.filter(u => !isAdminUser(u))
      .map(u => ({ u, s: setSummary(data, u.id, setId) }));
    const total = Stats.combine(per.map(p => p.s));
    const weekAgo = U.addDays(U.dayKey(Date.now()), -6);
    const active7 = per.filter(p => Object.keys(p.s.days).some(d => d >= weekAgo)).length;
    const newReports = Store.state.reports.filter(r => r.set_id === setId && r.status === 'new').length;
    host.innerHTML = `${statsHead(data)}
      <div class="stats">${stat(per.length, U.plural(per.length, 'пользователь', 'пользователя', 'пользователей'))}
        ${stat(active7, 'активны за 7 дней')}${stat(total.games, U.plural(total.games, 'игра', 'игры', 'игр'))}
        ${stat(total.answers, U.plural(total.answers, 'ответ', 'ответа', 'ответов'))}
        ${stat(pctOf(total.correct, total.answers), 'верных ответов')}${stat(total.answers - total.correct, 'ошибок', 'bad')}
        ${stat(newReports, 'новых отчётов', newReports ? 'warn' : '')}</div>
      <div class="grid2">
        <div class="card"><h2>Активные пользователи</h2><p class="muted small">Сколько человек отвечали на вопросы в этот день, за ${ACTIVITY_DAYS} дней.</p><div id="act"></div></div>
        <div class="card"><h2>Популярные режимы</h2><p class="muted small">Число завершённых игр.${total.games ? ` Чаще всего играют в «${esc(modeTitle(Stats.topMode(total.modes)))}».` : ''}</p><div id="modes"></div></div>
      </div>
      <div class="card"><h2>Пользователи</h2><p class="muted small">Нажмите на имя, чтобы открыть статистику пользователя.</p>${usersTable(per, setId)}</div>
      <div class="card"><h2>По темам</h2><p class="muted small">Ответы всех пользователей; сначала темы с наименьшей долей верных.</p>${catTable(total, setId)}</div>
      <div class="card"><h2>Самые трудные вопросы</h2><p class="muted small">Вопросы, на которые ответили хотя бы 3 раза, по доле ошибок.</p>${hardTable(total, setId, 3)}</div>`;
    activityChart(U.$('#act', host), per.map(p => p.s), 'users');
    modesChart(U.$('#modes', host), total);
  }

  function userStats(host, setId, data, userId) {
    const u = data.users.find(x => x.id === userId) || { id: userId, name: userId };
    const s = setSummary(data, userId, setId);
    const reports = Store.state.reports.filter(r => r.user_id === userId).sort((a, b) => b.created_at - a.created_at);
    host.innerHTML = `${statsHead(data)}
      <p><a href="#/admin/stats?set=${setId}">← Все пользователи</a></p>
      <div class="card"><h2>${esc(u.name)}</h2>${u.email ? `<p><a href="mailto:${esc(u.email)}">${esc(u.email)}</a></p>` : ''}
        <p class="muted">${u.created_at ? `Профиль создан ${U.fmtDate(u.created_at)}` : ''}${u.last_seen_at ? ` · последний визит ${U.fmtDateTime(u.last_seen_at)}` : ''}</p>
        <div class="stats">${stat(s.games, U.plural(s.games, 'игра', 'игры', 'игр'))}${stat(s.answers, U.plural(s.answers, 'ответ', 'ответа', 'ответов'))}
          ${stat(s.correct, 'верно')}${stat(s.answers - s.correct, 'ошибок', 'bad')}${stat(pctOf(s.correct, s.answers), 'верных ответов')}
          ${stat(s.pct_n ? Math.round(s.pct_sum / s.pct_n) + '%' : '—', 'средний результат игры')}${stat(esc(modeTitle(Stats.topMode(s.modes))), 'любимый режим')}</div></div>
      <div class="grid2">
        <div class="card"><h2>Активность</h2><p class="muted small">Ответов в день за ${ACTIVITY_DAYS} дней.</p><div id="act"></div></div>
        <div class="card"><h2>Режимы</h2><p class="muted small">Число завершённых игр.</p><div id="modes"></div></div>
      </div>
      <div class="card"><h2>По темам</h2>${catTable(s, setId)}</div>
      <div class="card"><h2>Ошибки</h2><p class="muted small">Вопросы, в которых пользователь ошибался, по доле ошибок.</p>${hardTable(s, setId, 1)}</div>
      <div class="card"><h2>Последние игры</h2><div id="ugames"><p class="muted">Загрузка…</p></div></div>
      <div class="card"><h2>Сообщения об ошибках</h2>${reports.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Дата</th><th>Вопрос</th><th>Комментарий</th><th>Статус</th></tr></thead>
        <tbody>${reports.map(r => `<tr><td>${U.fmtDateTime(r.created_at)}</td><td>№${r.question_id}</td><td class="wrap">${esc(r.comment)}</td>
          <td>${esc(Games.REPORT_STATUS[r.status] || r.status)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Сообщений нет.</p>'}</div>`;
    activityChart(U.$('#act', host), [s], 'answers');
    modesChart(U.$('#modes', host), s);
    const box = U.$('#ugames', host);
    Sync.userGames(userId).then(games => {
      const list = games.filter(g => g.set_id === setId).sort((a, b) => b.finished_at - a.finished_at).slice(0, 20);
      box.innerHTML = list.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Дата</th><th>Режим</th><th>Ответов</th><th>Верно</th><th>Результат</th><th></th></tr></thead>
        <tbody>${list.map(g => {
          const counted = g.answers.filter(a => !a.is_repeat);
          return `<tr><td>${U.fmtDateTime(g.finished_at)}</td><td>${esc(modeTitle(g.mode))}</td><td>${counted.length}</td>
            <td>${counted.filter(a => a.correct).length}</td><td>${g.percent != null ? g.percent + '%' : '—'}</td><td><a href="#/game/${g.id}">Итоги</a></td></tr>`;
        }).join('')}</tbody></table></div>` : '<p class="muted">Игр в этом наборе нет.</p>';
    }).catch(e => { box.innerHTML = `<p class="muted">Не удалось загрузить игры: ${esc(e.message)}</p>`; });
  }

  function usersTable(per, setId) {
    if (!per.length) return '<p class="muted">Пользователей пока нет.</p>';
    const reports = Store.state.reports;
    const seen = p => Math.max(p.u.last_seen_at || 0, p.s.last_at || 0);
    return `<div class="table-wrap"><table class="table"><thead><tr><th>Имя</th><th>Создан</th><th>Последний визит</th><th>Игр</th><th>Ответов</th>
      <th>Верно</th><th>Ошибок</th><th>% верных</th><th>Любимый режим</th><th>Сообщений</th></tr></thead>
      <tbody>${per.slice().sort((a, b) => seen(b) - seen(a)).map(p => {
        const s = p.s;
        return `<tr><td><a href="#/admin/stats?set=${setId}&user=${encodeURIComponent(p.u.id)}">${esc(p.u.name)}</a>${p.u.email ? `<br><span class="muted small">${esc(p.u.email)}</span>` : ''}</td>
          <td>${p.u.created_at ? U.fmtDate(p.u.created_at) : '—'}</td><td>${seen(p) ? U.fmtDateTime(seen(p)) : '—'}</td>
          <td>${s.games}</td><td>${s.answers}</td><td>${s.correct}</td><td>${s.answers - s.correct}</td><td>${pctOf(s.correct, s.answers)}</td>
          <td>${esc(modeTitle(Stats.topMode(s.modes)))}</td><td>${reports.filter(r => r.user_id === p.u.id).length}</td></tr>`;
      }).join('')}</tbody></table></div>`;
  }

  const meter = p => `<span class="meter" aria-hidden="true"><span style="width:${p}%"></span></span>`;

  function catTable(s, setId) {
    const rows = Stats.rows(s.cats).sort((a, b) => (a.percent - b.percent) || (b.answers - a.answers));
    if (!rows.length) return '<p class="muted">Ответов пока нет.</p>';
    return `<div class="table-wrap"><table class="table"><thead><tr><th>Тема</th><th>Ответов</th><th>Верно</th><th>Ошибок</th><th>% верных</th></tr></thead>
      <tbody>${rows.map(r => `<tr class="${r.answers >= 3 && r.percent < 50 ? 'weak' : ''}"><td>${esc(Sets.categoryNameAny(setId, r.key))}</td>
        <td>${r.answers}</td><td>${r.correct}</td><td>${r.wrong}</td><td>${meter(r.percent)} ${r.percent}%</td></tr>`).join('')}</tbody></table></div>`;
  }

  function hardTable(s, setId, minAnswers) {
    const rows = Stats.rows(s.qs).filter(r => r.answers >= minAnswers && r.wrong > 0)
      .sort((a, b) => (b.wrong / b.answers - a.wrong / a.answers) || (b.wrong - a.wrong)).slice(0, HARD_LIMIT);
    if (!rows.length) return '<p class="muted">Таких вопросов нет.</p>';
    return `<div class="table-wrap"><table class="table"><thead><tr><th>№</th><th>Вопрос</th><th>Тема</th><th>Ответов</th><th>Ошибок</th><th>Доля ошибок</th></tr></thead>
      <tbody>${rows.map(r => {
        const q = Sets.question(setId, r.key);
        return `<tr><td>${r.key}</td><td class="wrap">${q ? esc(q.text) : '(удалён)'}</td><td>${q ? esc(Sets.categoryNameAny(setId, q.category_id)) : '—'}</td>
          <td>${r.answers}</td><td>${r.wrong}</td><td>${Engine.percent(r.wrong, r.answers)}%</td></tr>`;
      }).join('')}</tbody></table></div>`;
  }

  // kind: 'users' — число пользователей с ответами в этот день; 'answers' — число ответов.
  function activityChart(el, summaries, kind) {
    const today = U.dayKey(Date.now());
    const days = [];
    for (let i = ACTIVITY_DAYS - 1; i >= 0; i--) days.push(U.addDays(today, -i));
    const value = d => (kind === 'users' ? summaries.filter(s => s.days[d]).length : summaries.reduce((n, s) => n + (s.days[d] || 0), 0));
    Charts.line(el, {
      title: kind === 'users' ? 'Активные пользователи' : 'Ответов в день',
      labels: days.map(d => d.slice(8, 10) + '.' + d.slice(5, 7)),
      tipLabels: days.map(U.keyToRu),
      series: [{ name: kind === 'users' ? 'Пользователей' : 'Ответов', color: Charts.color(0), values: days.map(value) }],
      hollowZero: true
    });
  }

  function modesChart(el, s) {
    Charts.bar(el, {
      title: 'Игры по режимам',
      labels: Games.MODE_IDS.map(modeTitle),
      values: Games.MODE_IDS.map(m => s.modes[m] || 0),
      color: Charts.color(0),
      valueName: 'Игр'
    });
  }
})();
