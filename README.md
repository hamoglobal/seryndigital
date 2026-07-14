# Handoff: Seryn Digital — Brand Monitoring Dashboard

## Overview
"Seryn Digital" is a dashboard that aggregates daily brand-monitoring reports for
Phòng Khám Đa Khoa Seryn (Seryn Clinic) — one report per day, tracking where the
brand appears online (Google top results, press/PR, social channels), the
sentiment mix of that coverage, new sources discovered, and risk/alert status.
The dashboard lets a user view stats by **day / week / month / year**, drill
into the underlying source list behind any KPI number, and see which social
channels/pages the brand appears on.

The user's core outstanding request is **automation**: right now the app reads
a static, pre-processed data file. They want a real pipeline that, every day at
**11:00 AM**, ingests that day's new report file and updates the app — no manual
step. That requires real backend infrastructure, which is the main build task
this handoff describes.

## About the Design Files
Everything under `design_reference/` is an **HTML design reference** — a working,
high-fidelity interactive prototype built to show exact layout, behavior, and
visual style. It is **not production code to copy in verbatim**: your task is to
**recreate this design in your target stack** (React/Vue/Next.js/native/etc. —
whichever your project already uses, or the best fit if starting fresh), wired
to a real backend/data pipeline instead of the static JS file it currently reads.

## Fidelity
**High-fidelity.** Colors, type, spacing, component styling, and interaction
behavior in `design_reference/Seryn Digital.dc.html` are final — reproduce them
pixel-for-pixel using your codebase's styling approach.

---

## The core problem to solve: data pipeline + automation

### Current (prototype) state
- Raw input: one report file per day, named `Bao_cao_Seryn_Monitoring_YYYY-MM-DD.xlsx`
  (sometimes also a same-day `.csv`, a partial/alternate export — the `.xlsx` is
  authoritative). Sample files are in `source_data_samples/`.
- Each `.xlsx` has 5 sheets: **Tong Quan** (KPI summary), **Top10 Google** (source
  list), **Mang Xa Hoi** (social channel list), **Canh Bao** (risk alerts),
  **Nhat Ky** (activity log).
- ⚠️ **Important:** the report template changed multiple times over the date
  range in the sample data — column headers/labels for the same concept differ
  across files (e.g. the "total sources" KPI is labeled `Tổng nguồn tìm thấy` in
  some reports, `Tổng nguồn giám sát hôm nay` in others, `Tổng kết quả thu thập`
  in others, and in some reports the KPI table is laid out as a header row +
  value row instead of label+value same row). A production parser **cannot**
  assume fixed cell coordinates — it must locate rows/columns by matching a set
  of known label variants (case/diacritic-insensitive), the way the prototype's
  one-off Node/browser script did. Budget real engineering time for this; it
  was the majority of the effort building the prototype's dataset.
- The prototype pre-processed all 61 sample reports **once**, offline, into
  `design_reference/data/seryn-data.js`, which exports three objects the frontend
  reads directly: `days`, `latest`, `sourcesByDay` (schemas below). This file is
  a frozen snapshot — it will never update itself.

### What to build
1. **Ingestion job** — a scheduled job (cron / serverless scheduled function)
   that runs daily at **11:00 AM** (confirm timezone with the user — assume
   Asia/Ho_Chi_Minh unless told otherwise). It should:
   - Look for that day's new report file in wherever the client drops it
     (a watched folder, an email attachment inbox, a shared-drive sync, or an
     upload endpoint — clarify with the user which; the sample data's "Nhat Ky"
     sheet mentions the reports are also uploaded to a Google Sheet, which could
     be the actual source of truth to poll instead of files).
   - Parse the 5 sheets using the label-matching strategy above (an xlsx
     library like `openpyxl`/`exceljs`/`xlsx` (SheetJS) makes this far easier
     than the prototype's manual ZIP/XML parsing, which was only done that way
     because the prototyping sandbox had no npm access).
   - Normalize into the schemas below and **upsert** into a real datastore
     (Postgres/SQLite/etc. — one row per day is sufficient; a `sources` table
     keyed by `(date, url)` for the drill-down lists).
   - Handle a missing/late file gracefully (don't crash the whole job; alert/log).
2. **API layer** — endpoints the frontend calls instead of importing a static
   JS file, e.g.:
   - `GET /api/days?from&to` → array matching the `days` schema
   - `GET /api/sources?date=YYYY-MM-DD&category=positive|neutral|negative|new`
     (or a date-range variant for week/month/year) → array matching `sourcesByDay` rows
   - `GET /api/latest` → today's/most-recent full detail (top sources, social
     channels, alerts) matching the `latest` schema
3. **Frontend** — same UI/interactions as the prototype, now fetching from the
   API on load (and probably on a periodic poll or after the 11 AM job
   completes) instead of `import('./data/seryn-data.js')`.

This 3-piece split (ingestion job → API → frontend) is what makes "chọn xem
theo ngày/tuần/tháng/năm" and the click-to-see-sources modals keep working
exactly as designed, just backed by live data instead of a frozen file.

---

## Data schemas (must be preserved — the UI destructures these exact shapes)

### `days: Day[]` — one entry per calendar day, chronological
```ts
type Day = {
  date: string;        // "YYYY-MM-DD"
  total: number;       // total sources found that day
  positive: number;    // sentiment breakdown — positive+neutral+negative should ≈ total
  neutral: number;
  negative: number;
  newSources: number;  // sources newly discovered vs. the previous report
  riskRaw: string;     // original free-text risk status from the report, e.g. "XANH - AN TOÀN"
  riskLevel: 'green' | 'yellow' | 'red';
  riskNote: string;    // free-text note/caveat for that day's risk status
};
```

### `sourcesByDay: { [date: string]: Source[] }`
```ts
type Source = {
  date: string;                                  // "YYYY-MM-DD"
  title: string;
  url: string;
  domain: string;                                 // may be "" if not present in that day's report
  type: string;                                   // e.g. "Website chính thức", "Báo chí PR", "Mạng xã hội"
  sentiment: 'positive' | 'neutral' | 'negative' | 'unknown';
  isNew: boolean;                                 // true if flagged "Mới" / new vs. prior report
};
```

### `latest: LatestDetail` — full detail for the most recent report only
```ts
type LatestDetail = {
  date: string;
  topSources: Source[];        // same shape as above, from the "Top10 Google" sheet
  social: {
    platform: string;          // "Facebook", "YouTube", "TikTok", "LinkedIn", ...
    account: string;
    url: string;
    accountType: string;
    sentiment: string;         // raw Vietnamese label, e.g. "Tích cực"
    note: string;
  }[];
  alerts: {
    level: string;             // "XANH" | "VÀNG" | "VÀNG - CHỜ XÁC NHẬN NỘI BỘ" | "ĐỎ" (raw text)
    type: string;
    source: string;
    date: string;
    summary: string;
    action: string;
  }[];
  activityLog: { time: string; step: string; result: string; note: string }[];
};
```
In production, `latest` should probably become "detail for whichever day/period
is selected" rather than being hardcoded to the most recent day — the current
UI only ever shows the latest day's `topSources`/`social`/`alerts` regardless of
the day/week/month/year picker above it (a known simplification in the
prototype). Consider whether the client wants per-period detail here too, or
whether "always show the latest snapshot" is intentional.

---

## Screens / Views
Single-page dashboard, one scrolling view, sections top to bottom:

1. **Sticky top bar** — Seryn monogram (`assets/logo-mark.png`, 30px tall) +
   "SERYN" wordmark (Playfair Display, 17px, letter-spacing 0.14em, color
   `#1B2350`) + "digital" (Be Vietnam Pro, 13px, coral `var(--text-brand)`),
   right-aligned status pill showing last-updated date + risk label with a
   pulsing colored dot (`@keyframes pulseDot`).
2. **Hero** — eyebrow label, H1 headline ("Giám sát thương hiệu Seryn Clinic",
   Playfair Display, navy `#1B2350`), one-line description, a gold "kỳ báo cáo"
   date-range badge.
3. **Period selector** — segmented control (Ngày / Tuần / Tháng / Năm) + a
   custom dropdown (NOT a native `<select>` — see Gotchas below) listing every
   available period for the selected granularity, newest first.
4. **KPI row** — 6 cards: Tổng nguồn, Tích cực, Trung tính, Tiêu cực/Cảnh báo,
   Nguồn mới, Trạng thái rủi ro (color-coded green/gold/red). The first 5 are
   clickable and open a modal listing the underlying `Source[]` for that
   category + currently selected period (capped at 150 rows with a "và N nguồn
   khác" note — see Gotchas).
5. **Trend chart** — line/area chart of tích cực/trung tính/tiêu cực over time,
   built from custom SVG (no chart library), re-aggregates to the selected
   granularity; auto-falls back to a finer granularity if the current one would
   only produce 1–2 data points (a flat "trend" is meaningless). Below it, a
   small colored bar-strip mini-timeline of risk status per bucket (hover shows
   a tooltip via native `title`).
6. **Detail row** — two columns: (a) "Nguồn nổi bật hôm nay" scrollable list of
   `latest.topSources`; (b) stacked cards "Kênh hiện diện" (channel/platform
   counts, clickable → modal listing that platform's accounts) and "Cần theo
   dõi" (yellow-flagged watch items from `latest.alerts`).
7. **Footer** — one line, data-range + org name.
8. **Two modals** (source-list and channel-list) — same visual treatment:
   rounded card, header with title + count + close button, scrollable list of
   linked rows with a colored sentiment dot.

## Design Tokens
Pull these from the bound Seryn Design System (`_ds/.../tokens/*.css` in the
design reference) rather than re-guessing:
- **Colors**: coral `--coral-500 #F4937E` (brand/CTA), `--coral-600 #F0826B`
  (logo solid), ivory `--ivory-100 #FBF6F1` (page bg), ink `--ink-800 #2E2622`
  (body text), gold `--gold-600 #C29A57` (accent/neutral-sentiment), semantic
  `--success-500 #4C9A6E` / `--warning-500 #D99A3C` / `--danger-500 #D2553F`.
- **Brand navy override** (sampled directly from the real Seryn logo file,
  `assets/logo-seryn.png`, not part of the base design system): `#1B2350`,
  used for all headline/section-title text in this app specifically, to match
  the client's real wordmark color.
- **Type**: Playfair Display (display/headlines, weight 600, tight tracking)
  + Be Vietnam Pro (body/UI). Scale/weights per `tokens/typography.css`.
  **Note:** this app uses **sentence case** (first letter capitalized) for all
  UI copy, which deliberately overrides the base design system's "all-lowercase
  headline" convention — that was an explicit client request for this app.
- **Radius**: cards `--radius-xl 28px`, chips/buttons `--radius-pill 999px`.
- **Shadow**: `--shadow-sm/md/lg` per layout tokens — warm-tinted, soft, never harsh.

## Assets
- `assets/logo-seryn.png` — the client's actual logo file (monogram + "SERYN"
  wordmark), provided by the client.
- `assets/logo-mark.png` — the monogram cropped out of the above (used in the
  top bar); regenerate via crop if you need a different size/format.

## Gotchas worth knowing before you start
- **Native `<select>` did not work reliably** in the prototyping environment's
  rendering engine (controlled `value`/`onChange` on a real `<select>` silently
  failed to update). It was replaced with a custom button + absolutely
  positioned list-as-dropdown. Not a constraint on your stack — a real
  `<select>` (or any UI library's Select) should work fine in production; just
  don't be surprised the reference implementation avoids it.
- **Modal source lists are capped at 150 rows** with a "...và N nguồn khác"
  message, because a full year can have 1000+ source rows and rendering them
  all unvirtualized froze the prototype's preview. In production, prefer real
  pagination or virtualization (react-window etc.) over a hard cap.
- **A "red" risk flag with 0 negative sources is normalized to "yellow"**
  when aggregating (see `effectiveRiskLevel` in the reference JS) — some
  source reports have stale/carry-forward red flags not backed by an actual
  negative-sentiment source that period, which otherwise visually contradicts
  the "Tiêu cực: 0" KPI card. Keep this reconciliation rule (or replace it with
  a cleaner one) so the risk badge and the negative-count KPI never contradict.
- **"Kênh hiện diện" / "Cần theo dõi" / "Nguồn nổi bật hôm nay" always reflect
  the single most-recent day**, regardless of the day/week/month/year picker
  above them — only the KPI numbers and chart are period-aware. Confirm with
  the client whether that's intentional or should become period-aware too.

## Files
- `design_reference/Seryn Digital.dc.html` — full working prototype (markup +
  logic in one file; the `<script type="text/x-dc" data-dc-script">` block at
  the bottom is the component's state/behavior logic — read it like a React
  class component, it maps closely).
- `design_reference/data/seryn-data.js` — the static pre-processed dataset the
  prototype currently reads (`days`, `latest`, `sourcesByDay` — use this as a
  fixture/example of the exact shape your API should return).
- `design_reference/assets/` — logo files.
- `source_data_samples/` — a few real input files (`.xlsx`, `.csv`, and the
  client's written source-classification criteria doc) to build/test your
  parser against. Ask the client for the full historical set plus their actual
  daily-report delivery mechanism before building the ingestion job.
