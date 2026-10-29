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

- **Run the app:** with `firebase` set in `config.js` (as it is now), Google sign-in needs http(s). Run `python -m http.server` in the repo root and open `http://localhost:8000/`. Opening `index.html` from `file://` only works with `firebase: null` (name login, local data).
- **Deploy (main site):** Firebase Hosting serves https://corp-finances.firebaseapp.com.
  - `npx firebase-tools deploy --only hosting` uploads the repo root. `firebase.json` excludes `files/`, `tests/`, `tools/`, `*.md` and dotfiles; `.firebaserc` names the project.
  - That is the auth domain, so Google sign-in runs on the same domain as the site; that's the reason for the move.
  - `APP_CONFIG.siteUrl` is the canonical address. On any other http(s) host except `localhost` (GitHub Pages, `*.web.app`), `boot()` flushes that origin's outbox (at most 5 s) and then `location.replace`s to `siteUrl`, keeping the hash. Each origin has its own localStorage, which is why it flushes first.
  - Deploying needs a one-time interactive `npx firebase-tools login` by the user.
- **Deploy (GitHub Pages):** it still serves `main` at https://shohruhsulaymonov.github.io/CF_Test/, but only to forward visitors to `siteUrl`. Pushing `main` doesn't update the real site; keep pushing so the forward and the repo stay current. No custom domain is set. A CNAME was added and then removed, and browsers that cached the old 301 redirect need their cache cleared.
- **Firebase:** the project is `corp-finances`; its config is in `config.js`.
  - `firestore.rules` (with the real admin email) and `firestore.indexes.json` are the source of truth. Deploy them with `npx firebase-tools deploy --only firestore`. The first version was pasted into the console by hand.
  - Authorized domains: `localhost`, `corp-finances.firebaseapp.com`, `corp-finances.web.app`, `shohruhsulaymonov.github.io`. Serving a copy on `localhost` therefore works against the real project. Google sign-in can't be done headless, and it doesn't work from `file://`.
- **Visual check without a browser session:** headless Chrome can screenshot `file:///…/index.html#/…`.
  - Pass `--allow-file-access-from-files` and a scratch `--user-data-dir`.
  - Add `--blink-settings=preferredColorScheme=1` to force the light theme.
  - The app needs a logged-in user. Seed one from a separate scratch HTML page: load the same `assets/js/*.js` and `sets/corpfin.js` by absolute `file:///` URL, call `Store.load(); Sets.syncFileSets(); Auth.login(name, true)`, then redirect to `index.html`. All `file://` pages share one localStorage in that profile.
  - Headless windows have a minimum width of about 500 px. For phone widths, screenshot the app inside a 390 px `<iframe>` instead of shrinking `--window-size`.
- **Single test:** the test runner is a minimal `test(name, fn)` with no filtering. Run the whole file, or comment out other tests temporarily.
- **Linter and formatter:** none configured.
- **Syntax check:** `node --check assets/js/<file>.js`.

`tests/engine.test.js` loads the browser scripts into a Node `vm` context with a fake `localStorage`, so the real `config.js` / `util.js` / `store.js` / `sync.js` / `sets.js` / `engine.js` / `games.js` / `stats.js` and `sets/corpfin.js` are tested as-is. The runner sets `APP_CONFIG.firebase = null` right after loading `config.js`, so the tests always run in local (name-login) mode whatever the real config says. Arrays from the vm context have a different prototype, so compare them with the file's `same()` (JSON) helper, not `assert.deepStrictEqual`.

## Architecture

Script load order in `index.html` matters: each file attaches globals (`APP_CONFIG`, `U`, `Store`, `Auth`, `Sync`, `Sets`, `FEEDBACK_TEMPLATES`, `Engine`, `Games`, `Bookmarks`, `SavedSets`, `Reports`, `Stats`, `Charts`, `App`). The view files register screens on `App.views`.

**Question sets: the core extensibility point.**
- `sets/<id>.js` calls `registerQuestionSet({id, title, description, sourceFile, questions: [raw rows], sources: [raw rows]})`. Rows are raw spreadsheet arrays in a fixed column order: №, question, A, B, C, D, correct letter, category, hint, level 1–5, mnemonic.
- `sets/manifest.js` lists the files. `app.js` injects them as scripts at boot.
- `APP_CONFIG.primarySetId` picks the home-page set. Every other set appears under «Другие наборы». All routes are parameterised by `setId`, so every set gets every feature.
- On boot, `Sets.syncFileSets()` hashes each file and re-imports it when the hash changes, using the spec §3 rules:
  - rows are keyed by №;
  - new rows are added and changed rows updated;
  - rows missing from the file are soft-hidden (`deleted_at`, `hidden_by: 'import'`).
- Each question stores `file_hash`, so an admin's manual edit survives until that specific row changes in the file.
- Browser uploads (admin panel, SheetJS in `assets/vendor/`) go through the same `parseQuestionRows → planImport → applyImport` path. Sets created this way have `origin: 'upload'`. They live in localStorage, and with Firebase they are also published to `sets/` for everyone.

**Persistence.** Everything (users, sets state, games with answers, mode settings, saved sets, bookmarks, reports, notifications) is one in-memory object owned by `store.js`. It is persisted in three localStorage keys: `examTrainer.v1.sets`, `.games` and `.misc` (everything else). The old single `examTrainer.v1` key is migrated on load. `Store.save()` writes all three; hot paths pass the part they touched (`Store.save('games')`). Use the no-arg form when a change spans parts (e.g. `hideQuestion` touches saved sets and notifications). Backups (`exportAll`/`importAll`) stay one JSON object. SheetJS is loaded lazily by `Sets.loadXlsx()`, not by `index.html`. Correct answers are visible client-side (spec §12 can't be met without a backend).

**Sync (`sync.js`, optional Firebase).** With `APP_CONFIG.firebase` set, the app is cloud-first. The compat SDK is injected lazily from gstatic (no `import`). Firestore is the source of truth; localStorage is the offline cache plus the outbox. With it unset, `Sync` is a no-op and everything stays local.
- **Writes:** mutations call `Store.queue(coll, id)`, which appends to `state.outbox` (persisted in `misc`); `Sync.flush()` sends the items with `set(..., {merge: true})`. Large or nested values go in as a JSON string in `data`, because Firestore rejects nested arrays and `undefined`.
- **Collections:**
  - `users` (doc id = user id);
  - `games` (finished only, JSON string);
  - `stats` (per-user `Stats.summary`, JSON string);
  - `reports`, `notifications`;
  - `userdata/{uid}`: bookmarks, saved sets and mode settings, last-write-wins on `updated_at` vs `state.cloud.userdataAt[uid]` (`Sync.mergeUserdata`). Mutations call `Store.touchUserdata(uid)`.
  - `sets/{id}` + `sets/{id}/chunks/{i}`: question sets. Meta without questions plus chunks of 200 questions (`Sync.splitSet`/`joinSet`), all stamped with the same `version`.
- **Who writes sets:** only the admin. `sets.js` calls `publish(id)` after admin mutations, and `flush` writes `sets` items as one batch (`writeSet`). For a non-admin, `flush` drops `sets` items.
- **`Sync.pullSets`:** reads all metas and fetches chunks only when `version` > `state.cloud.setVersions[id]`. It then calls `Sets.replaceFromCloud`, `Sets.dropFromSavedSets` for newly hidden questions, and `Sets.syncFileSets()` again (a newer repo file applies locally on top). For an admin session, it also queues every set whose `syncedHash` differs from the cloud copy, so `build_set.py` updates reach the cloud on the admin's next visit.
- **When pulls run:** `App.pull()` runs `pullUser` and then `pullSets`, on boot, after login, and on `visibilitychange` (at most every 5 min).
- **Incremental pulls:** `pullUser` uses `fetchSince` (`user_id` + `_ts` > cursor in `state.cloud.cursors`). That needs the composite indexes in `firestore.indexes.json`; without them it falls back to a full fetch and logs the index link once.
- With Firebase, login is Google sign-in, and the user id is the Firebase uid.
  - `Sync.signInGoogle()` uses a popup. When the popup closes without a result (blocked third-party storage, popup blockers), it throws an error with `code: 'closed'`; it no longer returns `null` silently.
  - The login screen then shows «Войти через страницу Google», which calls `signInGoogle(true)` and signs in by redirect. `init()` handles the redirect result with `getRedirectResult` and stores any error in `Sync.redirectError`.
  - The login screen also subscribes to `Sync.onAuthChange`, so a sign-in that succeeded without the popup reporting back still completes. `V.completeGoogle` is guarded against running twice.
- `V.completeGoogle` loads `users/{uid}` or asks for a display name (names need not be unique), then `Auth.enterAccount`. It also offers to move local name-login history into the account (`Auth.legacyProfiles` / `Auth.absorb`). On boot the Google session wins: a stored local user whose uid doesn't match is logged out. `Sync.start()` must run before the first `App.route()`, because the login screen awaits `Sync.ready`.
- Without Firebase, login is by name and the user id is the name key. `Store.load` migrates older random ids (`migrateUserIds`).
- `Sync.pullUser` merges games, reports and notifications (`Sync.merge`, pure and tested). On a device's first pull, it queues local items the server is missing. `flush` skips queued items owned by another account; they wait for that account's login.
- Admin = Google account whose verified email is in `APP_CONFIG.adminEmails` (`Sync.isAdminSession`; `Auth.role` checks it). `firestore.rules` holds the same list. In the rules each user reads and writes only docs with their own `user_id`, and the admin reads everything.
- The admin «Статистика» tab reads every user's `stats` doc plus `users` (≈2 reads per user per refresh, cached for 5 minutes in memory, never written to localStorage). Per-user games are fetched on demand (`Sync.userGames`), and `Sync.cachedGame` lets `V.results` open them.

**Game flow.**
- `Games.prepare(user, set, mode, source)` builds the question list from one of these sources:
  - the mode settings (range, categories, levels, repeat/cycle reset);
  - a fixed list: `?saved=` (a saved set), `?bookmarks=1`, `?mistakes=1`, `?game=<id>` or `?cat=<id>`.

  `?mistakes=1` is `Games.mistakes()`: questions whose latest non-repeat answer was wrong. `?game=<id>` is the wrong answers of one game; `?cat=<id>` is one theme.
- `V.play` maps the query to a source. `Games.start` stores it as `g.source`, which «Сыграть ещё» on the results page uses to rebuild the same link.
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
- Admin access: with Firebase, Google accounts in `APP_CONFIG.adminEmails` (user decision: everyone signs in with Google); without Firebase, the names in `APP_CONFIG.adminNames`.
- Headless Chrome's `--virtual-time-budget` doesn't wait for the Firebase SDK to load from the network. To check the Google login screen, serve a copy over `python -m http.server` and drive Chrome over CDP in real time.
- The admin «Проверка» tab (`Sets.audit`) only reports content problems and never changes data. CorpFin's known problems: the correct option is the longest one ~70% of the time, levels are only 2–4, and some themes have fewer than 3 questions. Fixes belong in the xlsx, not in code.
- Chart colours are the CSS variables `--s1…--s8`, with separate light and dark values in `style.css`.
- Visual design follows the Figma file "Dashboard — Online Learning" (`H9qTDznteJyGvB82XDIQIL`). It has:
  - a left sidebar (`App.header()` renders `#sidebar` and the top bar);
  - a purple `#702DFF` accent, white cards with the `--shadow` token, and 20/12/40 px radii;
  - the Inter font.
  The dashboard uses the design's three-column layout (main column and a right `.profile-panel`). Set pages show a `V.setHeader` title; section navigation lives in the sidebar, not in tabs.
- Icons: use `Icons.svg(name)` / `Icons.mode(mode)` from `icons.js`, never emoji.
  - The design icons are generated from `assets/img/figma/*.svg`. Only the colour is changed to `currentColor`. There is no generator script in the repo. To add one, strip the `id`/`style`/`preserveAspectRatio`/`overflow` attributes, replace hex `stroke`/`fill` values with `currentColor`, and keep the `<g>` structure and the root width and height.
  - Other icons are hand-drawn in the same 1.5-stroke line style.
  - Decorative images (logo, stars) stay as `<img>` from `assets/img/figma/`.
