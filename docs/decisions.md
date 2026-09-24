# Decisions log

Short "why" notes written as each feature closes. They feed DESIGN.md (Turkish).
Format: `- **YYYY-MM-DD · topic** - decision. Why.`

## Pre-build

- **2026-09-24 · Runtime** - Node 22/24 LTS, `engines >= 20.19`. Node 18/20 are EOL and better-sqlite3 12.x ships prebuilt binaries for Node 20–26 (contract note N1).
- **2026-09-24 · HTTP framework** - Express 5. We own the 401→403→404→400→409 pipeline; schema-first frameworks validate before the handler and would answer 400 before 404.
- **2026-09-24 · Imports** - relative imports use the real `.ts` extension; `tsc` rewrites them (`rewriteRelativeImportExtensions`). Same code runs under tsx, Vitest and compiled Node.
- **2026-09-24 · Single package** - server and UI share one `package.json` so `npm install && npm start` is the whole setup; Vite builds the UI into `dist/web`, Express serves it.
- **2026-09-24 · Env bootstrap** - `scripts/ensure-env.mjs` creates `.env` and a random `JWT_SECRET` on first run, so a clean machine needs no manual step and no secret is committed.
- **2026-09-24 · Line endings** - `.gitattributes` forces LF so Windows checkouts lint and format the same as Unix.
- **2026-09-24 · Vitest 4.0.18 pin** - Vitest 4.1.x makes npm 10.9 (bundled with Node 22) crash while resolving dependencies (`Cannot read properties of null (reading 'edgesOut')`), so a clean `npm install` on Node 22 would fail. 4.0.18 installs cleanly on npm 10 and 11.
- **2026-09-24 · allowScripts** - npm 11 warns about install scripts that are not listed in `allowScripts`. better-sqlite3 needs its install script to fetch the prebuilt binary, so it is allowed explicitly (plus esbuild). `@scarf/scarf` (swagger-ui telemetry) is denied.
