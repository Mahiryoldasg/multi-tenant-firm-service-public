# Decisions log

Short "why" notes written as each feature closes. They feed DESIGN.md (Turkish).
Format: `- **YYYY-MM-DD · topic** - decision. Why.`

## Pre-build

- **2026-09-24 · Runtime** - Node 22/24 LTS, `engines >= 20.19`. Node 18/20 are EOL and better-sqlite3 12.x ships prebuilt binaries for Node 20-26 (contract note N1).
- **2026-09-24 · HTTP framework** - Express 5. We own the 401→403→404→400→409 pipeline; schema-first frameworks validate before the handler and would answer 400 before 404.
- **2026-09-24 · Imports** - relative imports use the real `.ts` extension; `tsc` rewrites them (`rewriteRelativeImportExtensions`). Same code runs under tsx, Vitest and compiled Node.
- **2026-09-24 · Single package** - server and UI share one `package.json` so `npm install && npm start` is the whole setup; Vite builds the UI into `dist/web`, Express serves it.
- **2026-09-24 · Env bootstrap** - `scripts/ensure-env.mjs` creates `.env` and a random `JWT_SECRET` on first run, so a clean machine needs no manual step and no secret is committed.
- **2026-09-24 · Line endings** - `.gitattributes` forces LF so Windows checkouts lint and format the same as Unix.
- **2026-09-24 · Vitest 4.0.18 pin** - Vitest 4.1.x makes npm 10.9 (bundled with Node 22) crash while resolving dependencies (`Cannot read properties of null (reading 'edgesOut')`), so a clean `npm install` on Node 22 would fail. 4.0.18 installs cleanly on npm 10 and 11.
- **2026-09-24 · allowScripts** - npm 11 warns about install scripts that are not listed in `allowScripts`. better-sqlite3 needs its install script to fetch the prebuilt binary, so it is allowed explicitly (plus esbuild). `@scarf/scarf` (swagger-ui telemetry) is denied.

## Feature 1 - Persistence & idempotent seed

- **2026-09-25 · SQLite connection** - `openDatabase` creates the `DB_PATH` folder, then enables `journal_mode=WAL` and `foreign_keys=ON` before migrating. better-sqlite3 does not create folders (a fresh clone has no `data/`), and SQLite keeps foreign keys off unless each connection turns them on.
- **2026-09-25 · Migrations** - ordered SQL strings tracked by `PRAGMA user_version`; each migration and its version bump share one transaction, and a committed migration is never edited. Strings, not `.sql` files, because `tsc` emits only TypeScript into `dist/server`.
- **2026-09-25 · Initial schema** - migration 1 creates the whole locked data model, including `display_tokens` and `firms.active_mode_id` (used from feature 7), because features 2-13 depend on these shapes.
- **2026-09-25 · NOT NULL primary keys** - every TEXT primary key is declared `NOT NULL`, because SQLite otherwise accepts NULL in any primary key that is not `INTEGER PRIMARY KEY`.
- **2026-09-25 · Password hashing** - async `node:crypto` scrypt with a 16-byte salt and a 64-byte key, stored as `<salt>:<key>` hex and compared with `timingSafeEqual`; async so request handlers never block the event loop. Node's default cost (N=16384, r=8, p=1) keeps logins and tests fast; OWASP suggests more, and raising it later needs a format version or a reseed.
- **2026-09-25 · Seed config** - the 8 `SEED_*` values are required on every boot, with no defaults in code: they are credentials, the contract keeps secrets out of code, and a broken `.env` fails at once. `.env.example` holds the documented values.
- **2026-09-25 · Idempotent seed** - a `meta` marker (`seeded_at`), not row counts, records the seed, so deleting the seed firms never re-seeds. Passwords are hashed before the synchronous better-sqlite3 transaction; one `BEGIN IMMEDIATE` transaction re-checks the marker and inserts everything, so a failed seed leaves nothing behind. Exactly 2 firms.

## Feature 2 - Error contract & login

- **2026-09-25 · Error envelope** - handlers throw `HttpError(code, message)` and one central error handler writes every `{ error: { code, message } }` body. Status comes from the code, so a handler cannot pair a contract code with the wrong status, and no route builds an error body by hand.
- **2026-09-25 · Unknown routes** - a final fallback answers `404 NOT_FOUND` for any path and method, with no `405`: the contract's code list has no 405 (project-plan §10 decision 4).
- **2026-09-25 · Unreadable bodies** - every body-parser client error (malformed JSON, over 100 kB, unsupported charset) becomes `400 VALIDATION_ERROR`, because the contract has no 413 or 415 and its 400 covers a broken body. These errors are not logged: they carry the raw request text, which can hold a password.
- **2026-09-25 · INTERNAL_ERROR** - an unexpected failure answers `500` with code `INTERNAL_ERROR` and a generic Turkish message, and logs the details. The contract defines no server-error code, so this is a marked extension that keeps the envelope shape the same everywhere.
- **2026-09-25 · Token lifetime** - `USER_TOKEN_TTL` accepts only `<n>s|m|h|d`, fails at boot otherwise, and is passed to `jsonwebtoken` as whole seconds. jsonwebtoken reads a bare numeric string such as `"3600"` as milliseconds, which would silently issue 3.6-second tokens.
- **2026-09-25 · Login validation** - login checks only that `email` and `password` are non-blank strings (`400`); there is no email format check. A malformed email matches no one and gets the ordinary `401`, and login stores nothing that a format rule would protect.
- **2026-09-25 · Identical login failure** - an unknown email, a wrong password, a deleted user and a deleted firm all get the same `401` body. An unknown email is still checked against a dummy scrypt hash, so response time does not reveal which emails exist either.
- **2026-09-25 · Credential lookup** - login finds users through `findActiveUserByEmail` in `modules/platform`, which excludes deleted users and users of deleted firms in SQL. Feature 4's cascade already deletes a firm's users; the firm check keeps login correct on its own.
- **2026-09-25 · Platform admin firmId** - the login response and the token omit `firmId` for the platform admin instead of sending `null` (contract §2: "platform_admin'de firmId yoktur").
- **2026-09-25 · Email normalization** - `normalizeEmail` (trim + lower-case) is the single rule behind `email_normalized`, shared by the seed and login now and by employee writes in feature 6, so stored and looked-up emails can never disagree.
