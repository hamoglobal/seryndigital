# Seryn Digital — Brand Monitoring Dashboard

Production build of the "Seryn Digital" dashboard, recreated from the design
handoff in `../Seryn Digital APP dashboard/design_handoff_seryn_digital_dashboard/`.
Next.js (App Router) + SQLite (Node's built-in `node:sqlite`, no native build
step) + a daily report-ingestion pipeline, replacing the design prototype's
static `data/seryn-data.js` file with a real backend.

## Quick start

```bash
npm install
npm run build
npm start        # or `npm run dev` while iterating
```

Open http://localhost:3000 — `data/seryn.db` already ships pre-seeded with
**63 real days** of history (2026-05-05 through today), parsed straight from
the actual report archive. No `npm run seed` needed unless you're setting this
up somewhere that archive isn't reachable (see below).

## Where the data comes from

There's already a separate scheduled task (**`seryn-brand-monitoring-daily`**,
runs 8:00 AM) that researches Seryn Clinic's brand presence and writes
`Bao_cao_Seryn_Monitoring_YYYY-MM-DD.xlsx` (+ sometimes a same-day `.csv`) to
**`D:\Seryn Digital\Seryn Digital\`**. This app doesn't touch that task — it
just reads its output.

A second scheduled task, **`seryn-daily-report-ingest`**, runs at **11:00**
(giving the 8:00 job a comfortable buffer to finish) and does:
```bash
node scripts/watch-ingest.mjs
```
This scans `D:\Seryn Digital\Seryn Digital\` for any `Bao_cao_Seryn_Monitoring_*`
file it hasn't seen before (tracked in the `ingested_files` table, so nothing
is ever double-ingested), parses it, and upserts the result into
`data/seryn.db`. `.xlsx` always wins over a same-day `.csv` if both exist (the
`.csv` is a partial/alternate export per the design handoff). The dashboard's
API routes read straight from that database — no redeploy, no manual step.

You can also run it by hand any time:
```bash
node scripts/watch-ingest.mjs                 # scan for anything new
node scripts/ingest.mjs "D:\Seryn Digital\Seryn Digital\Bao_cao_Seryn_Monitoring_2026-07-15.xlsx"   # ingest one specific file
npm run seed                                  # re-run the full historical backfill (safe — everything is an upsert)
```

If the report-generation job's save location ever changes, set
`SERYN_INCOMING_DIR` (env var) and both `watch-ingest.mjs` and `seed.mjs` will
use it instead of the hardcoded default.

## Architecture

```
lib/parser.mjs       Label-matching parser. The report template has gone
                      through (at least) 3 generations across the real
                      historical files — Vietnamese sheet names with same-row
                      label:value KPIs, numbered English sheet names with a
                      header-row-then-value-row-below KPI layout, and two
                      different flat-CSV export shapes. The parser never
                      assumes fixed cell coordinates or a fixed sheet name —
                      it locates sheets/headers/columns by matching known
                      label variants (case/diacritic/language-insensitive).
lib/db.js             SQLite schema + upsert/read helpers (node:sqlite — no
                      native compile step, so `npm install` never needs a
                      network-fetched binary or C++ toolchain).
lib/aggregate.js       Day/week/month/year bucketing, risk-level reconciliation,
                      chart geometry — ported 1:1 from the design prototype's
                      Component logic so behavior matches exactly.
app/api/*/route.js    GET /api/days, /api/sources, /api/latest — replace the
                      prototype's static data/seryn-data.js import.
components/Dashboard.jsx   The UI, ported section-by-section from
                      design_reference/Seryn Digital.dc.html (topbar, hero,
                      period selector, KPI row, SVG trend chart, source/channel
                      lists, both modals).
scripts/seed.mjs      Historical backfill — bulk-ingests every file in the
                      real archive if reachable; otherwise falls back to the
                      design prototype's frozen snapshot + 3 sample files
                      (for portability, e.g. handing this project to someone
                      without that folder connected).
scripts/ingest.mjs    Parse + upsert one report file.
scripts/watch-ingest.mjs   The daily automated job.
```

## Parsing approach (why KPI numbers may not perfectly sum to the total)

Where a report's KPI section has its own authoritative numbers (total /
positive / neutral / negative / new sources / risk status), the parser
label-matches and uses those directly — including handling a "%"-based rate
(some templates report a positive/neutral *rate* instead of a count, which
would badly inflate the total if summed as if they were raw counts; the parser
detects and skips those). Where a template doesn't carry a given figure at all
(the earliest sample report has no positive/neutral breakdown), the parser
falls back to counting the parsed source rows. Real reports are analyst-curated
and don't always reconcile perfectly across sections — this mirrors the
handoff README's own note that positive+neutral+negative should only "≈"
total, not sum exactly.

Two of the 94 historical files (`2026-05-18.csv`, `2026-05-24.csv`) don't parse
— both have a same-day `.xlsx` that parses fine and wins on ingest, so no data
is lost; only relevant if you ever need that CSV specifically.

## Design fidelity notes

The actual Seryn Design System token files (`_ds/.../tokens/*.css`) referenced
by the prototype's `<link>` tags weren't included in the design handoff folder
— only the prototype's own inline overrides and the README's written token
values were available. Colors/spacing/shadows in `app/globals.css` are
reconstructed from those written values plus the visual description; a few
tints not explicitly specified (e.g. `--coral-100`, `--coral-300`) are
best-effort approximations. Swap in the real design-system CSS variables if/when
that repo is available for a pixel-exact match.

## What's intentionally unchanged from the prototype

Per the design handoff, "Kênh hiện diện" / "Cần theo dõi" / "Nguồn nổi bật hôm
nay" always reflect the single most-recent day regardless of the day/week/
month/year picker (only the KPI numbers and chart are period-aware) — this
matches the original design. `/api/latest` does accept an optional `?date=`
query param already, so wiring the picker to it later is a small frontend change
if the client wants that to become period-aware.
