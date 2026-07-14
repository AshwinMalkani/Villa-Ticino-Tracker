# Villa Ticino Rental Tracker

Income & expense tracker for the rental property at 626 Villa Ticino Drive, Manteca CA — two units (main house + in-law suite), with a live dashboard, Schedule E tax summary, and mortgage-statement ingestion.

**Production:** https://rental.ashwinmalkani.dev — hosted on Cloudflare Workers + D1 (free tier), gated by Cloudflare Access (Google OAuth; three allowed emails, 24h sessions).

## Features

- **Dashboard** — monthly cash-flow chart, expense breakdown, per-unit income split
- **Transactions** — add/delete income & expenses, categorized per unit (main / suite / shared)
- **Escrow payment splitter** — splits a mortgage payment into interest + escrow (deductible) and principal (non-deductible, tracked for cash flow only)
- **Mortgage statement PDF upload** — drop a Truist billing statement on the Add Entry tab; principal, interest, escrow, and due date are parsed in the browser (pdf.js) and logged as three line items after confirmation. Warns on duplicate months and validates line items against the statement total.
- **Tax summary** — Schedule E view (deductible expenses only), CSV export for the CPA
- **JSON export/import** — full backup and restore

## Architecture

```
Browser ── Cloudflare Access (Google OAuth) ── Worker (src/worker.js) ── D1 (SQLite)
                                                  └── static assets (public/index.html)
```

- `src/worker.js` — API routes (`/api/transactions`, `/api/assets`, `/api/export`, `/api/import`) against D1. Imports run as an atomic batch: a bad file rolls back completely.
- `public/index.html` — the entire front-end, a single file. Chart.js and pdf.js load from cdnjs.
- `migrations/` — D1 schema migrations.
- `server.js` — legacy Node/Express + sql.js server, kept as a local fallback (`npm start`, persists to `tracker.db`). Production does not use it.
- The Worker is **only** reachable through the custom domain: `workers_dev` and preview URLs are disabled in `wrangler.jsonc` because they would bypass Cloudflare Access.

## Development

```sh
npm install
npx wrangler d1 migrations apply villa-ticino-tracker --local   # first time
npm run dev                                                      # local Worker + D1 at localhost:8787
```

## Deploy

```sh
npm run deploy
```

That's the whole pipeline — wrangler bundles the Worker + assets and uploads them. Data lives in D1 and is untouched by deploys. Schema changes go in a new file under `migrations/`, applied with `npx wrangler d1 migrations apply villa-ticino-tracker --remote`.

## Data & backups

- Production data is in the D1 database `villa-ticino-tracker`. The free tier has no point-in-time recovery, so click **Export JSON** in the app occasionally and keep the file somewhere safe.
- `tracker.db` (local sql.js database) and its `.bak` snapshots are deliberately **not** committed — they contain real financial data.
- To restore from a backup: **Import JSON** in the app (replaces all data, atomically).

## History

Originally self-hosted on a Raspberry Pi 3 behind a Cloudflare Tunnel; retired July 2026 after chronic under-voltage outages and replaced by this Workers + D1 setup.
