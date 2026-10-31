// Проверка логики по критериям приёмки ТЗ §13. Запуск: node tests/engine.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.join(__dirname, '..');
const mem = {};
const writes = [];
const ctx = {
  console, Intl, Date, Math, JSON, setTimeout,
  localStorage: {
    getItem: k => (k in mem ? mem[k] : null),
    setItem: (k, v) => { mem[k] = String(v); writes.push(k); },
    removeItem: k => { delete mem[k]; }
  }
};
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ['assets/js/config.js', 'assets/js/util.js', 'assets/js/store.js', 'assets/js/sync.js', 'assets/js/sets.js',
  'assets/js/templates.js', 'assets/js/engine.js', 'assets/js/games.js', 'assets/js/stats.js', 'sets/corpfin.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
  // Тесты проверяют локальный режим: без Firebase, вход по имени.
  if (f === 'assets/js/config.js') ctx.APP_CONFIG.firebase = null;
}
const { Engine, Sets, Store, Auth, Games, SavedSets, Bookmarks, Stats, Sync } = ctx;

let passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
};
const ans = (cat, lvl, ok, time_ms = null) => ({ category_id_at_answer: cat, level_at_answer: lvl, correct: ok, time_ms });
// Массивы из vm-контекста имеют другой прототип — сравниваем через JSON.
const same = (a, b) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b));
const many = (n, cat, lvl, ok) => Array.from({ length: n }, () => ans(cat, lvl, ok, 4000));

console.log('Движок обратной связи');
test('Пример А: tier 2, слабая категория A, слабый уровень 3', () => {
  const answers = [
    ans(1, 2, true), ans(1, 2, false), ans(1, 2, false), ans(1, 3, false),
    ans(2, 2, true), ans(2, 2, false), ans(2, 3, false),
    ans(3, 2, true), ans(3, 3, false), ans(3, 3, false)
  ];
  const r = Engine.buildFeedback({ answers, mode: 'quiz', categoryName: id => 'ABC'[id - 1] });
  assert.strictEqual(r.percent, 30); assert.strictEqual(r.tier, 2);
  same(r.feedback.map(f => f.kind), ['tier', 'category', 'level']);
  assert.strictEqual(r.feedback[1].params.category_id, 1);
  assert.strictEqual(r.feedback[2].params.level, 3);
});
test('Пример Б: tier 3, слабый уровень 3, слабой категории нет', () => {
  const answers = [
    ...many(3, 1, 2, true), ans(1, 2, false), ans(1, 3, false),
    ...many(2, 2, 2, true), ans(2, 2, false), ans(2, 3, true), ans(2, 3, false)
  ];
  const r = Engine.buildFeedback({ answers, mode: 'board' });
  assert.strictEqual(r.percent, 60); assert.strictEqual(r.tier, 3);
  same(r.feedback.map(f => f.kind), ['tier', 'level']);
  assert.strictEqual(r.feedback[1].params.level, 3);
});
test('Пример В: 12 верных — только tier 5, без has_errors', () => {
  for (let i = 0; i < 200; i++) {
    const r = Engine.buildFeedback({ answers: many(12, 1, 2, true), mode: 'board' });
    assert.strictEqual(r.feedback.length, 1);
    assert.ok(['tier5-1', 'tier5-2', 'tier5-3', 'tier5-5', 'tier5-8', 'tier5-10'].includes(r.feedback[0].template_id), r.feedback[0].template_id);
  }
});
test('Процент — от всех вопросов игры, а не от отвеченных', () => {
  const r = Engine.buildFeedback({ answers: many(2, 1, 2, true), mode: 'quiz', questionCount: 10 });
  assert.strictEqual(r.percent, 20); assert.strictEqual(r.total, 10); assert.strictEqual(r.tier, 1);
  assert.ok(!r.feedback[0].template_id.startsWith('tier5'));
  assert.strictEqual(Engine.buildFeedback({ answers: many(2, 1, 2, true), mode: 'quiz' }).percent, 100);
});
test('Пример Г: 0 ответов', () => {
  const r = Engine.buildFeedback({ answers: [], mode: 'quiz' });
  assert.ok(r.empty); assert.strictEqual(r.message, 'В этой игре нет ответов, итоги не сформированы');
});
test('Исключение шаблонов из последних 5 игр', () => {
  const recent = new Set(['tier5-1', 'tier5-2', 'tier5-3', 'tier5-5', 'tier5-8']);
  for (let i = 0; i < 50; i++) {
    const r = Engine.buildFeedback({ answers: many(5, 1, 2, true), mode: 'board', recentTemplateIds: recent });
    assert.strictEqual(r.feedback[0].template_id, 'tier5-10');
  }
});
test('Процент: 0,5 округляется вверх; границы tier', () => {
  assert.strictEqual(Engine.percent(1, 8), 13);
  assert.strictEqual(Engine.percent(1, 3), 33);
  same([0, 20, 21, 40, 41, 60, 61, 80, 81, 100].map(Engine.tierOf), [1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
});
test('Викторина: 3 с → 1000, 12,5 с → 750, 19,9 с ≈ 500, таймаут/ошибка → 0', () => {
  assert.strictEqual(Engine.quizPoints(3000, true), 1000);
  assert.strictEqual(Engine.quizPoints(12500, true), 750);
  assert.ok(Math.abs(Engine.quizPoints(19900, true) - 500) <= 5);
  assert.strictEqual(Engine.quizPoints(20000, true), 0);
  assert.strictEqual(Engine.quizPoints(3000, false), 0);
});
test('Своя игра: уровень 3 → +300 / −300', () => {
  assert.strictEqual(Engine.jeopardyPoints(3, true), 300);
  assert.strictEqual(Engine.jeopardyPoints(3, false), -300);
});

console.log('Хранилище');
test('Старый ключ переносится в три части и удаляется', () => {
  mem['examTrainer.v1'] = JSON.stringify({ version: 1, users: [{ id: 'x', name: 'Старый' }], games: [{ id: 'g' }] });
  Store.load();
  assert.strictEqual(Store.state.users[0].name, 'Старый');
  assert.strictEqual(Store.state.users[0].id, 'старый');
  assert.ok(!('examTrainer.v1' in mem));
  same(Object.keys(mem).sort(), ['examTrainer.v1.games', 'examTrainer.v1.misc', 'examTrainer.v1.sets']);
  Store.load();
  assert.strictEqual(Store.state.games[0].id, 'g');
  assert.ok(!('games' in JSON.parse(mem['examTrainer.v1.misc'])));
  Object.keys(mem).forEach(k => delete mem[k]);
});

console.log('Импорт и данные');
Store.load();
Sets.syncFileSets();
test('Импорт CorpFin: 300 вопросов, 20 категорий, 20 источников', () => {
  const st = Sets.get('corpfin');
  assert.strictEqual(Sets.questions('corpfin').length, 300);
  assert.strictEqual(st.categories.length, 20);
  assert.strictEqual(st.sources.length, 20);
  same(Sets.levels('corpfin'), [2, 3, 4]);
});
test('Повторный импорт не создаёт дублей и изменений', () => {
  const parsed = Sets.parseQuestionRows(JSON.parse(JSON.stringify(Sets.questions('corpfin').map(q =>
    [q.number, q.text, q.a, q.b, q.c, q.d, q.correct, Sets.categoryName('corpfin', q.category_id), q.hint, q.level, q.mnemonic]))));
  const plan = Sets.planImport('corpfin', parsed);
  assert.strictEqual(plan.add.length + plan.update.length + plan.hide.length, 0);
  assert.strictEqual(plan.unchanged, 300);
});
test('Проверки строк: пустой вариант, буква E, сложность 7, дубль №', () => {
  const r = Sets.parseQuestionRows([
    [1, 'Q', 'a', 'b', 'c', '', 'A', 'K', '', 2, ''],
    [2, 'Q', 'a', 'b', 'c', 'd', 'E', 'K', '', 2, ''],
    [3, 'Q', 'a', 'b', 'c', 'd', 'A', 'K', '', 7, ''],
    [4, 'Q', 'a', 'b', 'c', 'd', 'А', ' к ', '', 3, ''],
    [4, 'Q', 'a', 'b', 'c', 'd', 'A', 'K', '', 3, '']
  ]);
  assert.strictEqual(r.valid.length, 1);
  assert.strictEqual(r.valid[0].correct, 'A'); // кириллическая «А» исправлена
  assert.strictEqual(r.errors.length, 4);
});
test('Вход: «Аня» и « аня » — один профиль; 1 и 31 символ отклоняются', () => {
  const u = Auth.login('Аня', true);
  assert.strictEqual(Auth.login(' аня ', false).id, u.id);
  assert.ok(Auth.validate('А')); assert.ok(Auth.validate('x'.repeat(31)));
  assert.strictEqual(Auth.login('Новый', false), null);
  assert.strictEqual(u.id, 'аня'); // id — ключ имени: тот же профиль на любом устройстве
  assert.ok(Auth.validate('a/b')); assert.ok(Auth.validate('..'));
});
test('Старые случайные id пользователей заменяются ключом имени во всех данных', () => {
  const saved = Store.exportAll();
  Store.importAll(JSON.stringify({
    users: [{ id: 'r1', name: 'Ёжик', name_key: 'ежик' }],
    games: [{ id: 'g1', user_id: 'r1', answers: [] }], reports: [{ id: 'p', user_id: 'r1' }],
    bookmarks: [{ user_id: 'r1' }], savedSets: [{ user_id: 'r1' }], notifications: [{ user_id: 'r1' }],
    modeSettings: { 'r1|corpfin|quiz': { repeat: false } }
  }));
  const s = Store.state;
  same([s.users[0].id, s.games[0].user_id, s.reports[0].user_id, s.bookmarks[0].user_id, s.savedSets[0].user_id, s.notifications[0].user_id],
    ['ежик', 'ежик', 'ежик', 'ежик', 'ежик', 'ежик']);
  same(Object.keys(s.modeSettings), ['ежик|corpfin|quiz']);
  Store.importAll(saved);
});
test('Без Firebase: очередь отправки пуста, админ входит по имени', () => {
  assert.strictEqual(Sync.configured(), false);
  Store.queue('games', 'x');
  assert.strictEqual(Store.state.outbox.length, 0);
  assert.strictEqual(Auth.role(Auth.login('Админ', false)), 'admin');
  Auth.login('Аня', false);
});
test('Google-аккаунт: профиль по uid, перенос истории входа по имени', () => {
  const saved = Store.exportAll();
  Store.importAll(JSON.stringify({
    users: [{ id: 'аня', name: 'Аня', name_key: 'аня' }, { id: 'пустой', name: 'Пустой', name_key: 'пустой' }],
    games: [{ id: 'g1', user_id: 'аня', finished_at: 1, answers: [] }], reports: [{ id: 'r1', user_id: 'аня' }]
  }));
  const u = Auth.enterAccount({ id: 'uid123', name: ' Анна К ', email: 'a@x.uz', created_at: 5 });
  same([u.id, u.name, u.email, u.created_at], ['uid123', 'Анна К', 'a@x.uz', 5]);
  assert.strictEqual(Auth.current().id, 'uid123');
  same(Auth.legacyProfiles().map(x => [x.user.id, x.games]), [['аня', 1]]); // без игр и аккаунты не предлагаются
  Auth.absorb('аня', 'uid123');
  same([Store.state.games[0].user_id, Store.state.reports[0].user_id], ['uid123', 'uid123']);
  same(Store.state.users.map(x => x.id), ['пустой', 'uid123']);
  assert.strictEqual(Auth.enterAccount({ id: 'uid123', name: 'Анна' }).created_at, 5); // повторный вход не создаёт профиль
  Store.importAll(saved);
  Auth.login('Аня', false);
});
test('Google-аккаунт переживает перезагрузку: id и закладки на месте', () => {
  const saved = Store.exportAll();
  try {
  Store.importAll(JSON.stringify({}));
  const u = Auth.enterAccount({ id: 'uidX', name: 'Шохрух', email: 's@x.uz' });
  Bookmarks.toggle(u.id, 'corpfin', 5);
  Store.load(); // как после обновления страницы
  same(Store.state.users.map(x => x.id), ['uidX']);
  assert.ok(Bookmarks.has('uidX', 'corpfin', 5));
  // Ремонт браузера, где старая миграция уже переименовала аккаунт в ключ имени.
  Store.importAll(JSON.stringify({
    users: [{ id: 'шохрух', name: 'Шохрух', name_key: 'шохрух', email: 's@x.uz' }],
    bookmarks: [{ user_id: 'шохрух', set_id: 'corpfin', question_id: 5 }, { user_id: 'uidX', set_id: 'corpfin', question_id: 5 }],
    games: [{ id: 'g', user_id: 'шохрух', finished_at: 1, answers: [] }]
  }));
  Auth.enterAccount({ id: 'uidX', name: 'Шохрух', email: 's@x.uz' });
  same(Store.state.users.map(x => x.id), ['uidX']);
  same(Store.state.bookmarks.map(b => [b.user_id, b.question_id]), [['uidX', 5]]);
  assert.strictEqual(Store.state.games[0].user_id, 'uidX');
  } finally {
    Store.importAll(saved);
    Auth.login('Аня', false);
  }
});
test('Слияние с сервером: новые игры добавляются, статус отчёта — с сервера, кроме неотправленных', () => {
  const state = { games: [{ id: 'a' }], reports: [{ id: 'r', status: 'new', admin_note: '' }, { id: 'q', status: 'new', admin_note: '' }],
    notifications: [{ id: 'n', read_at: null }] };
  const changed = Sync.merge(state, {
    games: [{ id: 'a', x: 1 }, { id: 'b' }],
    reports: [{ id: 'r', status: 'fixed', admin_note: 'ok' }, { id: 'q', status: 'fixed', admin_note: '' }],
    notifications: [{ id: 'n', read_at: 5 }, { id: 'm', read_at: null }]
  }, new Set(['reports/q']));
  assert.ok(changed);
  same(state.games.map(g => g.id), ['a', 'b']);
  assert.ok(!('x' in state.games[0])); // локальная игра не перезаписывается
  same(state.reports.map(r => r.status), ['fixed', 'new']);
  same(state.notifications.map(n => [n.id, n.read_at]), [['n', 5], ['m', null]]);
  assert.strictEqual(Sync.merge(state, { games: [{ id: 'b' }] }), false);
});
test('Синхронизация: продолженная на другом устройстве игра заменяет старую', () => {
  const state = { games: [{ id: 'a', finished_at: 10, percent: 40 }, { id: 'b', finished_at: 10 }, { id: 'c', finished_at: null }],
    reports: [], notifications: [] };
  const changed = Sync.merge(state, {
    games: [{ id: 'a', finished_at: 20, percent: 100 }, { id: 'b', finished_at: 5 }, { id: 'c', finished_at: 20 }]
  });
  assert.ok(changed);
  same(state.games.map(g => g.finished_at), [20, 10, null]); // новее — берём; старее или идёт сейчас — нет
  const s2 = { games: [{ id: 'a', finished_at: 10 }], reports: [], notifications: [] };
  assert.strictEqual(Sync.merge(s2, { games: [{ id: 'a', finished_at: 20 }] }, new Set(['games/a'])), false);
});
test('Диапазон 10–20 и Доска при 5 вопросах', () => {
  const u = Auth.current();
  const s = Games.settings(u.id, 'corpfin', 'board');
  Games.saveSettings(u.id, 'corpfin', 'board', Object.assign(s, { range_from: 10, range_to: 20 }));
  const p = Games.prepare(u.id, 'corpfin', 'board');
  assert.ok(p.questions.every(q => q.number >= 10 && q.number <= 20));
  assert.strictEqual(p.questions.length, 11);
  Games.saveSettings(u.id, 'corpfin', 'board', Object.assign(s, { range_from: 1, range_to: 5 }));
  assert.strictEqual(Games.prepare(u.id, 'corpfin', 'board').questions.length, 5);
});
test('Без повторов: отвеченный в Викторине не выпадает до исчерпания пула', () => {
  const u = Auth.current();
  const s = Games.settings(u.id, 'corpfin', 'quiz');
  Games.saveSettings(u.id, 'corpfin', 'quiz', Object.assign(s, { repeat: false, range_from: 1, range_to: 12, quizCount: 10 }));
  const p1 = Games.prepare(u.id, 'corpfin', 'quiz');
  const g = Games.start(u.id, 'corpfin', 'quiz');
  p1.questions.forEach(q => Games.record(g, q, { selected: 'A', correct: q.correct === 'A', time_ms: 1000 }));
  Games.finish(g);
  const p2 = Games.prepare(u.id, 'corpfin', 'quiz');
  assert.strictEqual(p2.questions.length, 2);
  assert.ok(p2.questions.every(q => !p1.questions.includes(q)));
  const g2 = Games.start(u.id, 'corpfin', 'quiz');
  p2.questions.forEach(q => Games.record(g2, q, { selected: 'B', correct: false, time_ms: 1000 }));
  Games.finish(g2);
  const p3 = Games.prepare(u.id, 'corpfin', 'quiz');
  assert.ok(p3.notices.some(n => n.includes('Все вопросы пройдены')));
  assert.strictEqual(p3.questions.length, 10);
  const pr = Games.progress(u.id, 'corpfin', 'quiz');
  same(pr, { total: 12, answered: 12, correct: p1.questions.filter(q => q.correct === 'A').length });
  assert.strictEqual(Games.progress(u.id, 'corpfin', 'cards').total, 300);
});
test('Прерванную игру можно продолжить, итоги пересчитываются', () => {
  const u = Auth.current();
  const qs = Sets.questions('corpfin').slice(100, 105);
  const g = Games.start(u.id, 'corpfin', 'board', { questions: qs });
  assert.strictEqual(g.question_count, 5);
  qs.slice(0, 2).forEach(q => Games.record(g, q, { selected: q.correct, correct: true }));
  Games.finish(g);
  assert.strictEqual(g.percent, 40);
  same(Games.remaining(g), qs.slice(2).map(q => q.number));
  assert.ok(Games.canResume(g, u.id));
  assert.ok(!Games.canResume(g, 'чужой'));
  assert.strictEqual(Games.cutShort(u.id, 'corpfin', 'board'), g);
  Games.resume(g);
  assert.strictEqual(g.finished_at, null); assert.strictEqual(g.percent, null);
  qs.slice(2).forEach(q => Games.record(g, q, { selected: q.correct, correct: true }));
  Games.finish(g);
  assert.strictEqual(g.percent, 100);
  assert.ok(!Games.canResume(g, u.id));
  assert.strictEqual(Games.cutShort(u.id, 'corpfin', 'board'), null);
});
test('Карточки: продолжить можно, пока есть карточки без «знаю»; старые игры без плана — нельзя', () => {
  const u = Auth.current();
  const qs = Sets.questions('corpfin').slice(110, 113);
  const g = Games.start(u.id, 'corpfin', 'cards', { questions: qs });
  Games.record(g, qs[0], { correct: true });
  Games.record(g, qs[1], { correct: false });
  Games.finish(g);
  same(Games.remaining(g), [qs[1].number, qs[2].number]);
  const old = Object.assign({}, g, { plan: undefined });
  assert.strictEqual(Games.remaining(old), null);
  assert.ok(!Games.canResume(old, u.id));
});
test('Брошенные игры при запуске: с ответами — завершаются, без ответов — удаляются', () => {
  const u = Auth.current();
  const qs = Sets.questions('corpfin').slice(120, 124);
  const a = Games.start(u.id, 'corpfin', 'quiz', { questions: qs });
  Games.record(a, qs[0], { selected: qs[0].correct, correct: true });
  const b = Games.start(u.id, 'corpfin', 'quiz', { questions: qs });
  Games.closeAbandoned();
  assert.ok(a.finished_at); assert.strictEqual(a.percent, 25);
  assert.strictEqual(Games.byId(b.id), null);
});
test('Новая игра после прерванной — только неотвеченные, даже с повторами', () => {
  const u = Auth.current();
  const s = Games.settings(u.id, 'corpfin', 'board');
  Games.saveSettings(u.id, 'corpfin', 'board', Object.assign(s, { repeat: true, range_from: 1, range_to: 20, cycle_started_at: Date.now() }));
  const first = Sets.questions('corpfin').slice(0, 6);
  const g = Games.start(u.id, 'corpfin', 'board', { questions: first });
  first.forEach(q => Games.record(g, q, { selected: q.correct, correct: true }));
  Games.finish(g);
  const p = Games.prepare(u.id, 'corpfin', 'board', { fresh: true });
  assert.strictEqual(p.questions.length, 14);
  assert.ok(p.questions.every(q => q.number > 6));
});
test('Повторы по умолчанию выключены', () => {
  assert.strictEqual(Games.settings('никто', 'corpfin', 'quiz').repeat, false);
});
test('Сохранённый набор из 12: удаление одного → 11 и уведомление', () => {
  const u = Auth.current();
  const ss = SavedSets.create(u.id, 'corpfin', 'Мой набор', 'any', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.strictEqual(Games.prepare(u.id, 'corpfin', 'quiz', { savedSetId: ss.id }).questions.length, 12);
  const before = Store.state.notifications.length;
  Sets.hideQuestion('corpfin', 5);
  assert.strictEqual(Games.prepare(u.id, 'corpfin', 'quiz', { savedSetId: ss.id }).questions.length, 11);
  assert.strictEqual(Store.state.notifications.length, before + 1);
  Sets.restoreQuestion('corpfin', 5);
});
test('Ответ в игре записывает только ключ игр', () => {
  const u = Auth.current();
  const g = Games.start(u.id, 'corpfin', 'quiz');
  writes.length = 0;
  Games.record(g, Sets.question('corpfin', 1), { selected: 'A', correct: true, time_ms: 1000 });
  same(writes, ['examTrainer.v1.games']);
  Games.discard(g);
});
test('Работа над ошибками: последний ответ решает, повторы Карточек не считаются', () => {
  const u = Auth.login('Ошибкин', true);
  const q = n => Sets.question('corpfin', n);
  const g1 = Games.start(u.id, 'corpfin', 'board');
  Games.record(g1, q(1), { selected: 'A', correct: false });
  Games.record(g1, q(2), { selected: 'A', correct: false });
  Games.record(g1, q(3), { selected: 'A', correct: true });
  Games.finish(g1);
  const g2 = Games.start(u.id, 'corpfin', 'cards');
  Games.record(g2, q(1), { correct: true });
  Games.record(g2, q(3), { correct: false });
  Games.record(g2, q(3), { correct: true, is_repeat: true });
  Games.finish(g2);
  same(Games.mistakes(u.id, 'corpfin').map(x => x.number), [2, 3]);
  same(Games.prepare(u.id, 'corpfin', 'quiz', { mistakes: true }).questions.map(x => x.number).sort(), [2, 3]);
  same(Games.prepare(u.id, 'corpfin', 'quiz', { gameId: g1.id }).questions.map(x => x.number).sort(), [1, 2]);
  assert.strictEqual(Games.prepare(Auth.login('Аня', false).id, 'corpfin', 'quiz', { gameId: g1.id }).questions.length, 0);
  Sets.hideQuestion('corpfin', 2);
  same(Games.mistakes(u.id, 'corpfin').map(x => x.number), [3]);
  Sets.restoreQuestion('corpfin', 2);
});
test('Проверка набора: самый длинный правильный, буквы, уровни, мелкие темы, дубли', () => {
  const rows = [
    [1, 'Вопрос один', 'длинный правильный ответ', 'b', 'c', 'd', 'A', 'Тема 1', 'h', 1, 'm'],
    [2, 'Вопрос два', 'a', 'длинный, но неверный', 'c', 'd', 'C', 'Тема 1', '', 2, ''],
    [3, ' вопрос  ОДИН ', 'a', 'b', 'c', 'dd', 'D', 'Тема 2', 'h', 2, 'm']
  ];
  Sets.applyImport('audit-test', Sets.planImport('audit-test', Sets.parseQuestionRows(rows)), { title: 'T' });
  const a = Sets.audit('audit-test');
  assert.strictEqual(a.total, 3);
  same(a.longest, [1, 3]);
  same(a.letters, { A: 1, B: 0, C: 1, D: 1 });
  same(a.levels, { 1: 1, 2: 2, 3: 0, 4: 0, 5: 0 });
  same(a.categories.map(c => [c.name, c.count]), [['Тема 2', 1], ['Тема 1', 2]]);
  same(a.duplicates, [[1, 3]]);
  assert.strictEqual(a.noHint, 1);
  delete Store.state.sets['audit-test'];
});
test('Своя игра: до 5 тем, у каждой ≥3 вопросов в пуле', () => {
  const b = Games.jeopardyBoard('corpfin', Sets.questions('corpfin'), null);
  assert.strictEqual(b.cats.length, 5);
  assert.ok(Object.keys(b.cells).length >= 5);
});
test('Своя игра: без пустых ячеек, без повторов, замена — ближайшей сложности той же темы', () => {
  for (let i = 0; i < 300; i++) {
    const b = Games.jeopardyBoard('corpfin', Sets.questions('corpfin'), null);
    const used = new Set();
    for (const id of b.cats) {
      const inCat = Sets.questions('corpfin').filter(q => q.category_id === id);
      for (const lv of b.levels) {
        const q = b.cells[`${id}|${lv}`];
        assert.ok(q, `пустая ячейка ${id}|${lv}`);
        assert.strictEqual(q.category_id, id);
        assert.ok(!used.has(q.number), 'вопрос повторяется');
        used.add(q.number);
      }
      // Вопрос своего уровня ставится всегда, когда он есть в теме.
      for (const lv of b.levels) {
        if (inCat.some(x => x.level === lv)) assert.strictEqual(b.cells[`${id}|${lv}`].level, lv);
      }
    }
  }
});
test('Итоги сохраняются в игре и не пересчитываются', () => {
  const g = Store.state.games.find(x => x.finished_at && x.percent != null);
  assert.ok(g.feedback.length >= 1 && g.aggregates.length >= 2);
  const text = g.feedback[0].text;
  Games.finish(g);
  assert.strictEqual(g.feedback[0].text, text);
});

test('Закладки/наборы/настройки: последняя запись побеждает в обе стороны', () => {
  const mk = () => ({
    bookmarks: [{ user_id: 'u', question_id: 1 }, { user_id: 'v', question_id: 9 }],
    savedSets: [{ id: 's1', user_id: 'u' }], modeSettings: { 'u|c|quiz': { repeat: true }, 'v|c|quiz': { repeat: true } },
    cloud: { userdataAt: { u: 100 } }
  });
  const remote = { updated_at: 200, data: { bookmarks: [{ user_id: 'u', question_id: 2 }], savedSets: [], modeSettings: { 'u|c|board': { repeat: false } } } };
  const a = mk();
  assert.strictEqual(Sync.mergeUserdata(a, 'u', remote), 'pulled');
  same(a.bookmarks.map(b => b.question_id), [9, 2]); // чужие записи не тронуты
  same(a.savedSets, []);
  same(Object.keys(a.modeSettings).sort(), ['u|c|board', 'v|c|quiz']);
  assert.strictEqual(a.cloud.userdataAt.u, 200);
  const b = mk();
  assert.strictEqual(Sync.mergeUserdata(b, 'u', Object.assign({}, remote, { updated_at: 50 })), 'push');
  same(b.bookmarks.map(x => x.question_id), [1, 9]);
  assert.strictEqual(Sync.mergeUserdata(mk(), 'u', null), 'push'); // на сервере ещё нет — отправить своё
  assert.strictEqual(Sync.mergeUserdata(mk(), 'w', null), 'same');
});
test('Набор на сервере: куски по 200 вопросов собираются обратно без потерь', () => {
  const set = Sets.get('corpfin');
  const { meta, chunks } = Sync.splitSet(set);
  same(chunks.map(c => c.length), [200, 100]);
  assert.ok(!('questions' in meta));
  const back = Sync.joinSet(JSON.parse(JSON.stringify(meta)), JSON.parse(JSON.stringify(chunks)));
  const sorted = x => JSON.stringify(x, Object.keys(x).sort()); // порядок ключей верхнего уровня не важен
  assert.strictEqual(sorted(back), sorted(set));
  same(back.questions, set.questions);
});
test('Набор с сервера: правки админа сохраняются, более новый файл применяется поверх', () => {
  const saved = JSON.stringify(Sets.get('corpfin'));
  const cloud = JSON.parse(saved);
  cloud.questions[1].text = 'Правка админа';
  cloud.questions[1].manual_edit = true;
  Sets.replaceFromCloud('corpfin', JSON.parse(JSON.stringify(cloud)));
  Sets.syncFileSets(); // хеш файла совпадает — ничего не меняется
  assert.strictEqual(Sets.question('corpfin', 1).text, 'Правка админа');
  // Админ опубликовал набор по старому файлу: строка 2 в файле с тех пор изменилась.
  cloud.syncedHash = 'старый';
  cloud.questions[2].text = 'Старый текст';
  cloud.questions[2].file_hash = 'старый';
  Sets.replaceFromCloud('corpfin', JSON.parse(JSON.stringify(cloud)));
  Sets.syncFileSets();
  const now = Sets.get('corpfin');
  assert.strictEqual(now.questions[1].text, 'Правка админа');
  assert.strictEqual(now.questions[2].text, JSON.parse(saved).questions[2].text);
  same(now.categories.map(c => c.id), JSON.parse(saved).categories.map(c => c.id));
  Sets.replaceFromCloud('corpfin', JSON.parse(saved));
});
test('Скрытый вопрос уходит из своих наборов с уведомлением владельцу', () => {
  const u = Auth.current();
  const ss = SavedSets.create(u.id, 'corpfin', 'Для скрытия', 'any', [7, 8]);
  Sets.dropFromSavedSets('corpfin', 7);
  same(ss.items, [8]);
  const notes = Store.state.notifications.filter(n => n.text.includes('«Для скрытия»'));
  assert.strictEqual(notes.length, 1);
  assert.strictEqual(notes[0].user_id, u.id);
  SavedSets.remove(ss.id);
});
test('Статистика: сводка без повторов Карточек и сумма по пользователям', () => {
  const t = Date.UTC(2026, 0, 10, 6);
  const a = (q, cat, ok, extra = {}) => Object.assign({ question_id: q, category_id_at_answer: cat, correct: ok, answered_at: t, is_repeat: false }, extra);
  const g1 = { set_id: 's', mode: 'quiz', started_at: t, finished_at: t + 1, percent: 50, answers: [a(1, 7, true), a(2, 8, false)] };
  const g2 = { set_id: 's', mode: 'cards', started_at: t, finished_at: t + 2, percent: 100, answers: [a(1, 7, true), a(1, 7, false, { is_repeat: true })] };
  const open = { set_id: 's', mode: 'quiz', started_at: t, finished_at: null, answers: [a(3, 7, false)] };
  const s = Stats.summary([g1, g2, open]).s;
  same([s.games, s.answers, s.correct, s.pct_sum, s.pct_n], [2, 3, 2, 150, 2]);
  same(s.modes, { quiz: 1, cards: 1 });
  same(s.cats, { 7: [2, 2], 8: [1, 0] });
  same(s.days, { '2026-01-10': 3 });
  const both = Stats.combine([s, Stats.summary([g1]).s, null]);
  same([both.games, both.answers, both.correct], [3, 5, 3]);
  same(both.qs, { 1: [3, 3], 2: [2, 0] });
  assert.strictEqual(Stats.topMode(both.modes), 'quiz');
  same(Stats.rows(both.cats).map(r => [r.key, r.wrong, r.percent]), [[7, 0, 100], [8, 2, 0]]);
});
test('Рейтинг: больше верных — выше, при равенстве — быстрее; равные делят место', () => {
  const t = Date.UTC(2026, 0, 10, 6);
  const a = (ok, time_ms, extra = {}) => Object.assign({ question_id: 1, category_id_at_answer: 1, correct: ok, answered_at: t, time_ms, is_repeat: false }, extra);
  const game = answers => ({ set_id: 's', mode: 'quiz', started_at: t, finished_at: t + 1, percent: 0, answers });
  const entry = (user_id, name, answers) => ({ user_id, name, sets: Stats.summary([game(answers)]) });
  const s = Stats.summary([game([a(true, 3000), a(false, 5000), a(true, 1000, { is_repeat: true })])]).s;
  same([s.time_sum, s.time_n], [8000, 2]);
  const list = Stats.ranking([
    entry('slow', 'Борис', [a(true, 9000), a(true, 9000)]),
    entry('fast', 'Анна', [a(true, 2000), a(true, 4000), a(false, 1000)]),
    entry('top', 'Вера', [a(true, 9000), a(true, 9000), a(true, 9000)]),
    entry('twin', 'Глеб', [a(true, 9000), a(true, 9000)]),
    entry('notime', 'Дина', [a(true, null), a(true, null)]),
    entry('none', 'Ева', []),
    { user_id: 'other', name: 'Жора', sets: { x: s } }
  ], 's');
  same(list.map(x => [x.user_id, x.place]), [['top', 1], ['fast', 2], ['slow', 3], ['twin', 3], ['notime', 5]]);
  same([list[1].percent, list[1].avg_ms, list[4].avg_ms], [67, 2333, null]);
});

console.log(`\n${passed} проверок пройдено${process.exitCode ? ', есть ошибки' : ''}`);
