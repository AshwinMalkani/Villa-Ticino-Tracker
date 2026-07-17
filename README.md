# Villa Ticino Rental Tracker

Income & expense tracker for a rental property — two units (main house + in-law suite), with a live dashboard, investment metrics, Schedule E tax summary, depreciation schedule, and document storage.

**Production:** https://rental.ashwinmalkani.dev — hosted on Cloudflare Workers + D1 + R2 (free tier), gated by Cloudflare Access (Google OAuth; three allowed emails, 24h sessions).

## Features

- **Dashboard** — monthly cash-flow chart, expense breakdown, per-unit income split, one-tap quick-add buttons that log each unit's rent using its most recent amount (with duplicate-month warning)
- **Investment metrics** — NOI and cap rate for the selected tax year, annualized for partial years and labeled with the data basis. NOI excludes debt service, escrow contributions, and capital expenditures per convention; property value is editable and persisted
- **Transactions** — add, edit (loads into the form as "Save changes"), and delete; filter by unit and tax year; attach a receipt in one step from the Add form (on mobile the picker includes taking a photo) or later via the paperclip on any row
- **Tax-year filter** — a header dropdown drives the dashboard, table, tax summary, and exports; defaults to the current year
- **Mortgage statement PDF upload** — drop a Truist billing statement on the Add Entry tab; principal, interest, escrow, and due date are parsed in the browser (pdf.js) and logged as three line items after confirmation, and the original PDF is auto-archived to Documents. Warns on duplicate months and validates against the statement total
- **Correct escrow accounting** — monthly escrow contributions are tracked as non-deductible cash flow; deductions are recorded when the servicer actually disburses property tax/insurance (dedicated form, "paid from escrow" categories that appear on Schedule E but not in cash-flow metrics)
- **Depreciation schedule** — 27.5-year straight-line MACRS with the mid-month convention, computed per tax year from the assets table, feeding Schedule E line 18
- **Tax summary** — Schedule E view with form line numbers, deductible expenses only, year-scoped CSV export for the CPA
- **Documents** — upload mortgage statements, utility bills, receipts, and insurance docs (≤15 MB) to a private R2 bucket; inline category editing; per-transaction receipt attachment; one-click zip export of everything, organized in folders by category
- **Backups** — automatic weekly JSON snapshot of the database to R2 (cron, keeps the newest 12) plus manual JSON export/import (atomic restore)
- **Money handling** — all amounts rounded to cents on input (client and server) and displayed with two decimals

## Architecture

```
Browser ── Cloudflare Access (Google OAuth) ── Worker (src/worker.js) ─┬─ D1 (SQLite: transactions, assets, documents metadata, settings)
                                                  │                    └─ R2 (document files + weekly backups)
                                                  └── static assets (public/index.html)
```

- `src/worker.js` — all API routes plus a `scheduled` handler for the weekly backup. Imports run as an atomic D1 batch: a bad file rolls back completely. Document downloads stream through the Worker (never public URLs), with active content types forced to download.
- `public/index.html` — the entire front-end, a single file. Chart.js, pdf.js, and JSZip load from cdnjs.
- `migrations/` — D1 schema migrations.
- `server.js` — legacy Node/Express + sql.js server, kept as a local fallback (`npm start`, persists to `tracker.db`; no R2 features). Production does not use it.
- The Worker is **only** reachable through the custom domain: `workers_dev` and preview URLs are disabled in `wrangler.jsonc` because they would bypass Cloudflare Access. The R2 bucket has no public access; the account-level workers.dev subdomain exists only because Cloudflare's cron-trigger API requires it.

## Development

```sh
npm install
npx wrangler d1 migrations apply villa-ticino-tracker --local   # first time
npm run dev                                                      # local Worker + D1 + R2 at localhost:8787
```

## Deploy

```sh
npm run deploy
```

That's the whole pipeline — wrangler bundles the Worker + assets and uploads them. Data lives in D1/R2 and is untouched by deploys. Schema changes go in a new file under `migrations/`, applied with `npx wrangler d1 migrations apply villa-ticino-tracker --remote`.

## Data & backups

- Production data: D1 database `villa-ticino-tracker`, documents in R2 bucket `villa-ticino-docs`.
- A cron trigger (`0 9 * * 1`) snapshots the database to `backups/` in the R2 bucket weekly, keeping the newest 12.
- `tracker.db` (local sql.js database) and its `.bak` snapshots are deliberately **not** committed — they contain real financial data.
- To restore: **Import JSON** in the app (replaces all data, atomically).

## Tax model notes

- The property is fully rented (both units) — no owner-occupancy proration.
- Escrow contributions are not deductions; property tax and insurance are deducted when disbursed from escrow (see the escrow disbursement form).
- Depreciation basis: building cost basis excluding land (from the lender appraisal's site value), in service June 2026.
- This is bookkeeping support, not tax advice — figures should be reviewed by a CPA before filing.

## History

Originally self-hosted on a Raspberry Pi 3 behind a Cloudflare Tunnel; retired July 2026 after chronic under-voltage outages and replaced by this Workers + D1 + R2 setup.
