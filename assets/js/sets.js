// Наборы вопросов: регистрация файлов из sets/, проверка строк, импорт по правилам ТЗ §3,
// мягкое удаление, категории. Состояние набора хранится в Store.state.sets[setId]:
// { id, title, description, origin: 'file' | 'upload', sourceFile, questions: { [№]: Q },
//   categories: [{ id, name, key, aliases }], nextCatId, sources: [], syncedHash, importLog: [] }
// Q: { number, text, a, b, c, d, correct, category_id, level, hint, mnemonic,
//      updated_at, deleted_at, hidden_by: 'import' | 'admin' | null, file_hash, manual_edit }
(function () {
  const defs = {};
  const defOrder = [];

  window.registerQuestionSet = def => {
    if (!def || !def.id) return;
    if (!defs[def.id]) defOrder.push(def.id);
    defs[def.id] = def;
  };

  const LETTERS = ['A', 'B', 'C', 'D'];
  // Кириллические А, В, С часто попадают в столбец правильного ответа вместо латинских.
  const LETTER_FIX = { 'А': 'A', 'В': 'B', 'С': 'C' };
  const str = v => (v == null ? '' : String(v).trim());

  // Строки вопросов в порядке столбцов: №, Вопрос, A, B, C, D, Правильный, Категория,
  // Подсказка, Сложность, Мнемоника. firstLine — номер строки в Excel для сообщений об ошибках.
  function parseQuestionRows(rows, firstLine = 2) {
    const valid = [], errors = [], seen = new Set();
    rows.forEach((r, i) => {
      if (!r || r.every(c => str(c) === '')) return;
      const line = firstLine + i;
      const errs = [];
      const num = Number(str(r[0]));
      const numOk = Number.isInteger(num) && num > 0;
      if (!numOk) errs.push('№ должен быть целым положительным числом');
      else if (seen.has(num)) errs.push(`№ ${num} уже встречался выше`);
      const text = str(r[1]);
      if (!text) errs.push('пустой текст вопроса');
      const opts = [2, 3, 4, 5].map(k => str(r[k]));
      if (opts.some(o => !o)) errs.push('не все варианты A–D заполнены');
      else if (new Set(opts.map(o => o.toLowerCase())).size < 4) errs.push('варианты ответа совпадают');
      let correct = str(r[6]).toUpperCase();
      correct = LETTER_FIX[correct] || correct;
      if (!LETTERS.includes(correct)) errs.push('правильный вариант должен быть одной из букв A–D');
      const category = str(r[7]).replace(/\s+/g, ' ');
      if (!category) errs.push('пустая категория');
      const level = Number(str(r[9]));
      if (!Number.isInteger(level) || level < 1 || level > 5) errs.push('сложность должна быть целым числом от 1 до 5');
      if (numOk) seen.add(num);
      if (errs.length) {
        errors.push({ line, number: numOk ? num : null, messages: errs });
        return;
      }
      valid.push({
        number: num, text, a: opts[0], b: opts[1], c: opts[2], d: opts[3], correct,
        category, hint: str(r[8]), level, mnemonic: str(r[10])
      });
    });
    return { valid, errors };
  }

  function parseSourceRows(rows) {
    return (rows || [])
      .filter(r => r && r.some(c => str(c) !== ''))
      .map((r, i) => ({ number: Number(str(r[0])) || i + 1, title: str(r[1]), usage: str(r[2]), url: str(r[3]) }));
  }

  const rowHash = r => U.hash(JSON.stringify([r.text, r.a, r.b, r.c, r.d, r.correct, r.category, r.hint, r.level, r.mnemonic]));

  function skeleton(id, meta) {
    return {
      id, title: meta.title || id, description: meta.description || '', origin: meta.origin || 'file',
      sourceFile: meta.sourceFile || '', created_at: Date.now(),
      questions: {}, categories: [], nextCatId: 1, sources: [], syncedHash: null, importLog: []
    };
  }

  const S = () => Store.state.sets;

  function findCategory(st, name) {
    const key = U.catKey(name);
    return st.categories.find(c => c.key === key || (c.aliases || []).includes(key)) || null;
  }

  function ensureCategory(st, name) {
    let c = findCategory(st, name);
    if (!c) {
      c = { id: st.nextCatId++, name: name.trim().replace(/\s+/g, ' '), key: U.catKey(name), aliases: [] };
      st.categories.push(c);
    }
    return c;
  }

  // Предпросмотр импорта: что добавится, изменится, скроется. Ничего не меняет.
  function planImport(setId, parsed) {
    const st = S()[setId] || skeleton(setId, {});
    const plan = { add: [], update: [], restore: [], hide: [], unchanged: 0, manualOverwrite: [], errors: parsed.errors };
    const incoming = new Set();
    for (const row of parsed.valid) {
      incoming.add(row.number);
      const h = rowHash(row);
      const ex = st.questions[row.number];
      if (!ex) plan.add.push({ row, h });
      else if (ex.file_hash === h) {
        if (ex.deleted_at && ex.hidden_by === 'import') plan.restore.push({ row, h });
        else plan.unchanged++;
      } else {
        plan.update.push({ row, h });
        if (ex.manual_edit) plan.manualOverwrite.push(row.number);
      }
    }
    for (const q of Object.values(st.questions)) {
      if (!incoming.has(q.number) && !q.deleted_at) plan.hide.push(q.number);
    }
    return plan;
  }

  function applyImport(setId, plan, meta = {}, sources = null) {
    if (!S()[setId]) S()[setId] = skeleton(setId, meta);
    const st = S()[setId];
    ['title', 'description', 'sourceFile'].forEach(k => { if (meta[k] != null) st[k] = meta[k]; });
    const now = Date.now();
    const put = ({ row, h }, restore) => {
      const ex = st.questions[row.number] || {};
      const keepHidden = ex.deleted_at && ex.hidden_by === 'admin';
      st.questions[row.number] = Object.assign(ex, {
        number: row.number, text: row.text, a: row.a, b: row.b, c: row.c, d: row.d,
        correct: row.correct, category_id: ensureCategory(st, row.category).id, level: row.level,
        hint: row.hint, mnemonic: row.mnemonic, updated_at: now,
        deleted_at: keepHidden ? ex.deleted_at : null,
        hidden_by: keepHidden ? 'admin' : null,
        file_hash: h, manual_edit: false
      });
      if (restore) st.questions[row.number].deleted_at = null;
    };
    plan.add.forEach(x => put(x));
    plan.update.forEach(x => put(x));
    plan.restore.forEach(x => put(x, true));
    plan.hide.forEach(n => hideQuestion(setId, n, 'import', false));
    if (sources) st.sources = sources;
    st.importLog.unshift({
      at: now, added: plan.add.length, updated: plan.update.length, restored: plan.restore.length,
      hidden: plan.hide.length, errors: plan.errors
    });
    st.importLog = st.importLog.slice(0, 20);
    Store.save(); // скрытие вопросов меняет и сохранённые наборы, и уведомления
    return st;
  }

  // Мягкое удаление: вопрос пропадает из игр и сохранённых наборов, владельцы наборов получают уведомление.
  function hideQuestion(setId, number, by = 'admin', save = true) {
    const st = S()[setId];
    const q = st && st.questions[number];
    if (!q || q.deleted_at) return;
    q.deleted_at = Date.now();
    q.hidden_by = by;
    for (const ss of Store.state.savedSets) {
      if (ss.set_id !== setId || !ss.items.includes(number)) continue;
      ss.items = ss.items.filter(n => n !== number);
      Store.notify(ss.user_id, `Вопрос №${number} удалён администратором и убран из набора «${ss.name}» (${st.title}).`);
    }
    if (save) Store.save();
  }

  function restoreQuestion(setId, number) {
    const q = S()[setId] && S()[setId].questions[number];
    if (!q) return;
    q.deleted_at = null;
    q.hidden_by = null;
    Store.save('sets');
  }

  // Синхронизация файлов из sets/ при загрузке: изменился файл — применяем импорт автоматически.
  function syncFileSets() {
    const report = [];
    for (const id of defOrder) {
      const def = defs[id];
      const h = U.hash(JSON.stringify([def.questions, def.sources]));
      const st = S()[id];
      const meta = { title: def.title, description: def.description, sourceFile: def.sourceFile, origin: 'file' };
      if (st && st.origin === 'upload') continue; // набор из браузера с тем же id — не перезаписываем
      if (st && st.syncedHash === h) {
        Object.assign(st, { title: def.title, description: def.description || '' });
        continue;
      }
      const parsed = parseQuestionRows(def.questions || []);
      const plan = planImport(id, parsed);
      const after = applyImport(id, plan, meta, parseSourceRows(def.sources));
      after.syncedHash = h;
      report.push({ id, plan });
    }
    Store.save('sets');
    return report;
  }

  const Sets = {
    parseQuestionRows, parseSourceRows, planImport, applyImport, hideQuestion, restoreQuestion, syncFileSets,
    findCategory, ensureCategory, skeleton, LETTERS,

    hasDef: id => !!defs[id],

    get(id) { return S()[id] || null; },

    // Видимые наборы: из файлов и загруженные в браузере. Главный — первым.
    list() {
      const ids = defOrder.filter(id => S()[id]);
      for (const id of Object.keys(S())) if (!ids.includes(id) && S()[id].origin === 'upload') ids.push(id);
      const primary = Sets.primaryId();
      return ids.map(id => S()[id])
        .sort((a, b) => (b.id === primary) - (a.id === primary));
    },

    primaryId() {
      const want = APP_CONFIG.primarySetId;
      if (want && S()[want]) return want;
      return defOrder.find(id => S()[id]) || Object.keys(S())[0] || null;
    },

    questions(setId, { includeDeleted = false } = {}) {
      const st = S()[setId];
      if (!st) return [];
      return Object.values(st.questions)
        .filter(q => includeDeleted || !q.deleted_at)
        .sort((a, b) => a.number - b.number);
    },

    question: (setId, n) => (S()[setId] ? S()[setId].questions[n] || null : null),

    categoryName(setId, id) {
      const c = S()[setId] && S()[setId].categories.find(x => x.id === id);
      return c ? c.name : '—';
    },

    // Категории с числом активных вопросов, по алфавиту.
    categories(setId) {
      const qs = Sets.questions(setId);
      const st = S()[setId];
      if (!st) return [];
      return st.categories
        .map(c => ({ ...c, count: qs.filter(q => q.category_id === c.id).length }))
        .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    },

    levels: setId => [...new Set(Sets.questions(setId).map(q => q.level))].sort((a, b) => a - b),

    numberRange(setId) {
      const qs = Sets.questions(setId, { includeDeleted: true });
      if (!qs.length) return [1, 1];
      return [qs[0].number, qs[qs.length - 1].number];
    },

    updateQuestion(setId, n, fields) {
      const st = S()[setId];
      const q = st.questions[n];
      const { category, ...rest } = fields;
      Object.assign(q, rest, { updated_at: Date.now(), manual_edit: true });
      if (category) q.category_id = ensureCategory(st, category).id;
      Store.save('sets');
    },

    renameCategory(setId, id, name) {
      const st = S()[setId];
      const c = st.categories.find(x => x.id === id);
      const other = findCategory(st, name);
      if (other && other.id !== id) throw new Error('Категория с таким названием уже есть — используйте объединение');
      if (!c.aliases.includes(c.key)) c.aliases.push(c.key); // файл со старым названием попадёт сюда же
      c.name = name.trim().replace(/\s+/g, ' ');
      c.key = U.catKey(name);
      Store.save('sets');
    },

    // Объединение: вопросы переходят в target, ответы прошлых игр не меняются (ТЗ §11).
    mergeCategory(setId, fromId, toId) {
      const st = S()[setId];
      const from = st.categories.find(x => x.id === fromId);
      const to = st.categories.find(x => x.id === toId);
      Object.values(st.questions).forEach(q => { if (q.category_id === fromId) q.category_id = toId; });
      to.aliases = [...new Set([...to.aliases, from.key, ...from.aliases])];
      from.merged_into = toId;
      st.categories = st.categories.filter(x => x.id !== fromId);
      st.mergedCategories = [...(st.mergedCategories || []), from];
      Store.save('sets');
    },

    deleteCategory(setId, id) {
      const st = S()[setId];
      if (Object.values(st.questions).some(q => q.category_id === id)) throw new Error('В категории есть вопросы');
      st.categories = st.categories.filter(x => x.id !== id);
      Store.save('sets');
    },

    // Имя категории для истории: учитывает объединённые категории.
    categoryNameAny(setId, id) {
      const st = S()[setId];
      if (!st) return '—';
      const c = st.categories.find(x => x.id === id) || (st.mergedCategories || []).find(x => x.id === id);
      return c ? c.name : '—';
    },

    removeUploaded(setId) {
      const st = S()[setId];
      if (!st || st.origin !== 'upload') return;
      delete S()[setId];
      Store.save('sets');
    },

    // Текст файла sets/<id>.js с текущими (видимыми) вопросами — для переноса в репозиторий.
    exportSetFile(setId) {
      const st = S()[setId];
      const rows = Sets.questions(setId).map(q => [
        q.number, q.text, q.a, q.b, q.c, q.d, q.correct, Sets.categoryName(setId, q.category_id),
        q.hint, q.level, q.mnemonic
      ]);
      const sources = (st.sources || []).map(s => [s.number, s.title, s.usage, s.url]);
      const payload = { id: st.id, title: st.title, description: st.description, sourceFile: st.sourceFile, questions: rows, sources };
      return '// Экспортировано из админ-панели. Положите файл в sets/ и добавьте его имя в sets/manifest.js.\n' +
        `registerQuestionSet(${JSON.stringify(payload, null, 1)});\n`;
    },

    // Проверка содержания набора (ничего не меняет): подсказки на правильный ответ, дубли,
    // распределение по буквам, сложности и темам.
    audit(setId) {
      const qs = Sets.questions(setId);
      const longest = qs.filter(q => {
        const lens = LETTERS.map(L => q[L.toLowerCase()].length);
        const i = LETTERS.indexOf(q.correct);
        return lens.every((n, j) => j === i || n < lens[i]);
      });
      const byText = new Map();
      for (const q of qs) {
        const k = U.catKey(q.text);
        byText.set(k, [...(byText.get(k) || []), q.number]);
      }
      return {
        total: qs.length,
        longest: longest.map(q => q.number),
        letters: Object.fromEntries(LETTERS.map(L => [L, qs.filter(q => q.correct === L).length])),
        levels: Object.fromEntries([1, 2, 3, 4, 5].map(l => [l, qs.filter(q => q.level === l).length])),
        categories: Sets.categories(setId).filter(c => c.count).sort((a, b) => a.count - b.count),
        duplicates: [...byText.values()].filter(ns => ns.length > 1),
        noHint: qs.filter(q => !q.hint).length,
        noMnemonic: qs.filter(q => !q.mnemonic).length
      };
    },

    // SheetJS (~900 КБ) нужен только админу — подгружаем при первом чтении файла.
    loadXlsx: () => (window.XLSX ? Promise.resolve() : new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'assets/vendor/xlsx.full.min.js';
      s.onload = resolve;
      s.onerror = () => reject(new Error('не удалось загрузить библиотеку для Excel'));
      document.head.appendChild(s);
    })),

    // Чтение xlsx в браузере (SheetJS). Возвращает { questions: rows, sources: rows }.
    async readWorkbook(file) {
      await Sets.loadXlsx();
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const qName = wb.SheetNames.includes('Лист1') ? 'Лист1' : wb.SheetNames[0];
      const toRows = name => XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', blankrows: false });
      // Первая строка — заголовок, если в первом столбце нет номера.
      const dropHeader = rows => (rows.length && !/^\d+$/.test(str(rows[0][0])) ? rows.slice(1) : rows);
      const qRows = dropHeader(toRows(qName));
      const sRows = wb.SheetNames.includes('Источники') ? dropHeader(toRows('Источники')) : [];
      return { questions: qRows, sources: sRows };
    }
  };

  window.Sets = Sets;
})();
