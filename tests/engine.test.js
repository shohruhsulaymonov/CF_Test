// Проверка логики по критериям приёмки ТЗ §13. Запуск: node tests/engine.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.join(__dirname, '..');
const mem = {};
const ctx = {
  console, Intl, Date, Math, JSON, setTimeout,
  localStorage: {
    getItem: k => (k in mem ? mem[k] : null),
    setItem: (k, v) => { mem[k] = String(v); },
    removeItem: k => { delete mem[k]; }
  }
};
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ['assets/js/config.js', 'assets/js/util.js', 'assets/js/store.js', 'assets/js/sets.js',
  'assets/js/templates.js', 'assets/js/engine.js', 'assets/js/games.js', 'sets/corpfin.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
}
const { Engine, Sets, Store, Auth, Games, SavedSets } = ctx;

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

console.log(`\n${passed} проверок пройдено${process.exitCode ? ', есть ошибки' : ''}`);
