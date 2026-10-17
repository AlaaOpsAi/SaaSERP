# 02 — Continue development in a new local session

- **Started:** 2026-10-16 · **Status:** Open

## Request

Complete the remaining development in a new local Claude Code session, so the installed plugins
(UI/UX Pro Max, Magic, Hostinger, Notion, …) can be used.

## Starting point

- Branch `claude/affectionate-sagan-hru2m7`, last commit `aaa5a5a` (CRM database).
- History and decisions: [discussion 01](../01_2026-09-30_platform-build-to-crm-database/discussion.md) and [docs/session-transcript.md](../../docs/session-transcript.md).
- Remaining work: open items listed in discussion 01, [docs/MODULES.md](../../docs/MODULES.md#next-phases) and [docs/ROADMAP.md](../../docs/ROADMAP.md).

## Decisions

- Discussions live in `discussions/` inside the repository (tracked in git); the repository root is not changed.
- Development continues in this session (user chose "Do it here" over a new session).
- First item: **enhance the web UI** using the *UI UX Pro Max* plugin (design guidance) and the *21st.dev Magic* MCP (ready-made components).

## Findings

- UI UX Pro Max recommends Minimalism & Swiss style at dashboard density — close to today's look, so refine rather than redesign.
- Six fixes found: text characters used as icons, small touch targets, 14px mobile text, missing focus rings on links/chips, colour-only states, no loaded fonts.
- All 21st.dev components found are shadcn + Tailwind; the app uses plain CSS tokens. Recommended: use them as reference and port into our CSS (option A).
- Full proposal: [outputs/ui-enhancement-proposal.md](outputs/ui-enhancement-proposal.md).
- **Decision (2026-10-16): option B** — adopt Tailwind + shadcn and install 21st.dev components directly.

## Delivered (option B, step 1)

- Tailwind v4 + shadcn in `apps/web`, with the old stylesheet in a `legacy` cascade layer so existing screens are unchanged.
- shadcn variables mapped to the app's tokens: light/dark, accent colour and Arabic RTL work for new components.
- `npm run ui:add -w apps/web -- <component>` wrapper (fixes a shadcn CLI import quirk in this monorepo).
- First 21st.dev component: *Charts & KPI Cards* (`@uvain/revenue-charts-kpi`, Recharts). The Dashboard KPI tiles now use its `KpiCard`, keeping drill-down, "vs last year" deltas and Arabic text.
- shadcn `button`, `card`, `badge` added for new screens.
- Guide: [docs/UI.md](../../docs/UI.md).
- Checked locally in the browser (demo workspace): Dashboard in light, dark and Arabic; KPI click opens the matching bookings; Bookings page unchanged; no console errors. Typecheck and production build pass.
- Not checked: a full Docker image build.

## Delivered (more animation, 2026-10-17)

Request: "more animated and better interface", plus recommendations.

- Page transitions on every route change; staggered card entrances on the Dashboard; figures count up (21st.dev *Number Ticker*, adapted for money / % / Arabic).
- Home screen: icons pop in one by one, springy hover, and glide into place when an admin rearranges them.
- Dialogs fade and zoom in; loading text replaced by skeleton placeholders (tables, Dashboard, contract page, diary).
- All text-character icons (✕ ⚠ ✓ ⚙︎ ↺ 🎉 ‹ › ▲ ▼) replaced by lucide icons; arrows mirror in Arabic.
- Pages load on demand: first download 565 kB (was 1,061 kB with the new libraries, 598 kB originally).
- Reduced motion respected (motion's MotionConfig + the existing CSS rule).
- Checked in the browser: end states in light, dark, Arabic and phone width; dialog; no new console errors. The motion itself could not be timed in the pane (it runs at about 1 frame per second when the window isn't in front), so smoothness still needs a look by eye.

## Recommendations (not built yet)

1. Toast messages for save / delete (for example *sonner*), with undo for deactivate.
2. Command palette (Ctrl/⌘ K) to jump to any contract, customer or page.
3. Function diary as a 21st.dev / shadcn event calendar with drag-to-reschedule.
4. Monthly performance chart on the 21st.dev `AreaTrend` / `BarCompare`, so all charts share one look.
5. Brand fonts: Inter + Noto Sans Arabic, self-hosted.
6. Empty states with an illustration and a next step ("No contracts yet. Create the first one").
7. Mobile: 16px body text and 44px touch targets; bottom tab bar on phones.
8. Optimistic updates (status changes show instantly, roll back on error).

## Push and deployment (2026-10-17)

- Pushed `d6a5557` to `claude/affectionate-sagan-hru2m7` on GitHub.
- VPS (Hostinger KVM 2, `app.opsaibridge.eu`): Docker projects `saaserp` (/root/SaaSERP) and `goalpace` (/opt/goalpace).
- The Hostinger API can't run commands on the VPS, and its Docker "update" only pulls prebuilt images (this app is built from source), so it can't deploy this app.
- Decision: no SSH key added; the user runs the update in hPanel → VPS → Browser terminal:
  `cd /root/SaaSERP && ./scripts/backup.sh && git pull --ff-only && docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build`
- [ ] Live site checked after the update.

## Template check (2026-10-17)

Checked with [scripts/check-templates.mts](scripts/check-templates.mts), which uses the app's own engine (the same test-fill as an upload):

| File | Placeholders | Result |
|---|---|---|
| `templates/WEDX_Wedding Contract_TOPRINT OK.docx` | 0 | Customer's original blank form; would print empty every time |
| `templates/Wedding Details_Annex.docx` | 0 | Customer's original annex; same |
| `templates/W2025047_Qortuba_2025.10.09_SAMPLE.docx` | 0 | A filled-in client contract (reference only, personal data) |
| `apps/api/templates/standard-contract.docx` | 32 | OK, all known to the app |
| `apps/api/templates/standard-annex.docx` | 24 | OK, all known to the app |

- The copies in Downloads and in the older project folder are the same originals; the WEDX templates prepared in the earlier session (with placeholders) are not on this Mac.
- `templates/` is not ignored by git, so the SAMPLE contract could be committed by mistake.

## WEDX templates prepared (2026-10-17)

Request: turn the WEDX contract and annex into templates with placeholders, keep the layout, and keep `templates/` out of git.

- `/templates/` added to `.gitignore` (customer files and the filled client sample are never committed).
- Built with [scripts/make-wedx-templates.py](scripts/make-wedx-templates.py) into `templates/prepared/` (git-ignored):
  - `WEDX_Wedding_Contract_template.docx`: number box (`# {doc_no}`), date, client name, civil ID, address, phone, venue, guests, weekday + event date, total / down payment / remaining with currency, notes, the services table, and the trust receipt (name, amount, "(اسم العميل)", name and civil ID). Signature lines stay blank.
  - `WEDX_Wedding_Annex_template.docx`: number box, date, address, phone, venue, guests, event date, and the services table (Arabic name, English name, quantity, notes).
  - `WEDX_annex_checklist.txt`: the 31 wedding services, in the "Arabic | English" format to paste under Admin & IT → Templates → annex checklist.
- Unknown values print the original underscores, so they can still be written by hand.
- Tables keep their printed length: new template feature `{#lines_pad_N}` / `{#annex_pad_N}` adds blank rows up to N (contract 7, annex 32). Code in `apps/api/src/lib/docgen.ts`, with a test; API tests 63/63 pass.
- Mixed Arabic/English lines: values are wrapped in direction marks (RLE…PDF; the phone in RLM + LRE…PDF), otherwise English names and phone numbers scramble the Arabic lines. Four variants were compared on rendered PDFs before choosing.
- The form's own date digits are printed in white in the original; the template recolours that slot.
- Checked: filled with English, Arabic and empty sample data through the app's engine and converted to PDF with the production image's LibreOffice; page counts match the originals (contract 2, annex 3); samples in `templates/prepared/samples/`.
- Note: a filled contract runs a little shorter than the blank form (underscores wrapped to two lines), so the last clause and the sales signature line move up to page 1.
- The production Docker image now builds cleanly from the current code (checked locally).
- [ ] Commit, push and deploy (the padding needs the new API on the server; without it the template still works, but the table shrinks to the number of services).
- [ ] Upload both templates (Admin & IT → Templates, business type Weddings, Arabic) and paste the checklist.

## Local test setup used

- Docker Desktop started; `docker compose up -d db` (Postgres on port 5433), migrations 008–009 applied and demo data seeded.
- The old `app` container was stopped to free port 4000 for the dev API (`docker compose up -d app` restarts it).
- `apps/api/.env` created from the example (git-ignored), pointing at port 5433.
- `.claude/launch.json` added with `api` and `web` dev servers.

## Open items

- [x] Agree the first piece of work — UI enhancement (2026-10-16).
- [x] UI enhancement proposal approved — option B (2026-10-16).
- [ ] Next 21st.dev pieces: Function diary / event calendar, then the Monthly performance chart (AreaTrend / BarCompare).
- [x] Replace text-character icons with lucide-react icons (2026-10-17).
- [ ] Mobile: 16px body text and 44px touch targets; focus rings on links and chips.
- [x] Code-split pages to win back the bundle size (2026-10-17).

## Where things go

Deliverables in `outputs/`, any scripts in `scripts/`, and this file updated as the discussion goes.
