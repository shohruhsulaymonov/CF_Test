# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A static exam-practice website (UI and content in Russian) built from the spec `ТЗ платформа тренировки экзаменационных вопросов (v2).md`. Section numbers in code comments (e.g. «ТЗ §7») refer to that spec. When behaviour is in doubt, check the spec first, especially §6 (question selection), §7 (game rules), §8–9 (feedback engine and templates) and §13 (acceptance criteria).

There is no build step, no package.json, and no framework. Plain `<script>` tags (not ES modules) are used on purpose so `index.html` works from `file://` as well as from static hosting such as GitHub Pages. Keep it that way: no `import`/`export` and no `fetch` of local files.

## Commands

```
node tests/engine.test.js        # all tests (acceptance criteria from spec §13)
python tools/build_set.py files/CorpFin_300.xlsx --id corpfin --title "Корпоративные финансы"   # xlsx → sets/<id>.js + regenerate sets/manifest.js (needs openpyxl)
```

- **Run the app:** open `index.html` in a browser.
- **Single test:** the test runner is a minimal `test(name, fn)` with no filtering. Run the whole file, or comment out other tests temporarily.
- **Linter and formatter:** none configured.
- **Syntax check:** `node --check assets/js/<file>.js`.

`tests/engine.test.js` loads the browser scripts into a Node `vm` context with a fake `localStorage`, so the real `config.js` / `util.js` / `store.js` / `sets.js` / `engine.js` / `games.js` and `sets/corpfin.js` are tested as-is. Arrays from the vm context have a different prototype, so compare them with the file's `same()` (JSON) helper, not `assert.deepStrictEqual`.

## Architecture

Script load order in `index.html` matters: each file attaches globals (`APP_CONFIG`, `U`, `Store`, `Auth`, `Sets`, `FEEDBACK_TEMPLATES`, `Engine`, `Games`, `Bookmarks`, `SavedSets`, `Reports`, `Charts`, `App`). The view files register screens on `App.views`.

**Question sets: the core extensibility point.**
- `sets/<id>.js` calls `registerQuestionSet({id, title, description, sourceFile, questions: [raw rows], sources: [raw rows]})`. Rows are raw spreadsheet arrays in a fixed column order: №, question, A, B, C, D, correct letter, category, hint, level 1–5, mnemonic.
- `sets/manifest.js` lists the files. `app.js` injects them as scripts at boot.
- `APP_CONFIG.primarySetId` picks the home-page set. Every other set appears under «Другие наборы». All routes are parameterised by `setId`, so every set gets every feature.
- On boot, `Sets.syncFileSets()` hashes each file and re-imports it when the hash changes, using the spec §3 rules:
  - rows are keyed by №;
  - new rows are added and changed rows updated;
  - rows missing from the file are soft-hidden (`deleted_at`, `hidden_by: 'import'`).
- Each question stores `file_hash`, so an admin's manual edit survives until that specific row changes in the file.
- Browser uploads (admin panel, SheetJS in `assets/vendor/`) go through the same `parseQuestionRows → planImport → applyImport` path. Sets created this way have `origin: 'upload'` and live only in localStorage.

**Persistence.** Everything (users, sets state, games with answers, mode settings, saved sets, bookmarks, reports, notifications) is one in-memory object owned by `store.js`. It is persisted in three localStorage keys: `examTrainer.v1.sets`, `.games` and `.misc` (everything else). The old single `examTrainer.v1` key is migrated on load. `Store.save()` writes all three; hot paths pass the part they touched (`Store.save('games')`). Use the no-arg form when a change spans parts (e.g. `hideQuestion` touches saved sets and notifications). Backups (`exportAll`/`importAll`) stay one JSON object. SheetJS is loaded lazily by `Sets.loadXlsx()`, not by `index.html`. No server exists; `store.js` is the seam for adding one. Known consequences: per-browser data, and correct answers are visible client-side (spec §12 can't be met without a backend).

**Game flow.**
- `Games.prepare(user, set, mode, source)` builds the question list. It applies the mode settings (range, categories, levels, repeat/cycle reset), or a saved set or bookmarks as the source.
- `V.play` (`views-play.js`) calls `Games.start`, then the mode renderer.
- The shared `mcq()` component shuffles the A–D options per display. `answer.selected` stores the *file* letter, not the displayed letter.
- `Games.record()` saves each answer with `level_at_answer` / `category_id_at_answer` snapshots.
- `Games.finish()` runs `Engine.buildFeedback` once and stores the aggregates and rendered feedback text on the game. Results are never recomputed on reopen.
- `App.leave` finishes (or discards, if there are no answers) a game when the user navigates away.
- In Cards, repeat showings are marked `is_repeat` and excluded from the percentage and aggregates.

**Engine** (`engine.js`, pure functions):
- percent is rounded half up; tiers are 0–20/21–40/…;
- quiz points: 1000 within 5 s, then linear down to 500 at 20 s;
- Своя игра points: ± level×100 of the cell's *row*, not of the question, because empty cells are filled with the same theme's question of the closest level;
- weak category/level: ≥3 answers and correct×2 < answers, with the spec's tie-breaks;
- template choice: honours the `requires` conditions and skips templates used in the user's last 5 games.

**Routing:** hash-based in `app.js` (`#/set/:id/play/:mode?saved=…`, `#/game/:id`, `#/admin/:tab?set=…`, `#/sets`, …). `App.keyHandler` holds the single active keyboard handler. `U.modal` saves and restores it.

## Conventions

- All user-facing text is Russian. Dates are ДД.ММ.ГГГГ in `APP_CONFIG.timeZone` (Asia/Tashkent) via `U.dayKey`/`U.fmtDate`. Use `U.plural` for Russian plurals.
- Escape all interpolated content with `U.esc` (views build HTML with template strings).
- Admin access comes from `APP_CONFIG.adminNames` (name-only login, no passwords, by spec decision).
- Chart colours are the CSS variables `--s1…--s8`, with separate light and dark values in `style.css`.
- Visual design follows the Figma file "Dashboard — Online Learning" (`H9qTDznteJyGvB82XDIQIL`). It has:
  - a left sidebar (`App.header()` renders `#sidebar` and the top bar);
  - a purple `#702DFF` accent, white cards with the `--shadow` token, and 20/12/40 px radii;
  - the Inter font.
  The dashboard uses the design's three-column layout (main column and a right `.profile-panel`). Set pages show a `V.setHeader` title; section navigation lives in the sidebar, not in tabs.
- Icons: use `Icons.svg(name)` / `Icons.mode(mode)` from `icons.js`, never emoji.
  - The design icons are generated from `assets/img/figma/*.svg`. Only the colour is changed to `currentColor`.
  - Other icons are hand-drawn in the same 1.5-stroke line style.
  - Decorative images (logo, stars) stay as `<img>` from `assets/img/figma/`.
