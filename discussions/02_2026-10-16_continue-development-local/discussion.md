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
- `discussions/ALL_DISCUSSIONS.md` keeps every discussion in full; each folder keeps its own part. Rebuilt with `npm run discussions` (2026-10-17).
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

## Customer comment 6: header, magenta, name card, Employee ID, company logos (2026-10-17)

**Customer (Melinda), summarised:**
1. The header must not mirror when switching language; everything in it stays in place (logo coming).
2. Highlighted text (e.g. "Contracts" selected in the menu) in **magenta**, the corporate colour.
3. Top of the menu: full name, then **Job title – Employee ID** (e.g. "Melinda Molnar / OWNER - E2021001").
4. Permission level not shown to users; only in the IT module.
5. The Employee ID is the username and user ID, so every action is traceable by it.
6. Upper-left corner: company logo + user's full name. The logo follows the user's company (Wedding → WED-X, …); logos white on black.
7. Colour identity: WED-X and CONF-X black + magenta; DEAL-X dark brown + neon green; REAL-X dark brown + neon orange; SELL-X dark brown + bright turquoise.

**What exists today:** Employee ID (E + hiring year + 4 digits, automatic); company brand colour for the whole workspace; business units (W = WEDX, X = CONFX …) on contracts only. Missing: job title on users, a user's company, logos, sign-in by Employee ID. The role shows in one place (menu header).

**Recommendations:**
1. **Fixed header** in every language: logo + full name on the left, Home · Menu · EN|AR on the right; the menu always opens from the right. Pages below still switch to right-to-left in Arabic.
2. **Company per user** (Admin → Team): each user belongs to one company (business unit). It sets their logo and colours. Users who work for several pick a main one.
3. **Company identity** per business unit (Admin & IT): logo (white-on-black file), dark colour, accent colour. The header shows the logo on its dark colour; highlights (selected menu item, active tab, buttons, links) use the accent. Neon green / orange / turquoise are too light for text on white, so text uses a darker shade of the same colour automatically, and the bright colour stays for fills and underlines.
4. **Menu name card:** full name, then "Job title – E2021001". New *Job title* field under Admin → Team. Role and record scope move to Admin & IT → Team only.
5. **Sign in with Employee ID or email.** Employee IDs repeat across workspaces in a SaaS, so if one matches several workspaces the sign-in asks which (as it already does for email). Email stays for password resets.
6. **Traceability:** the Employee ID is shown next to the name everywhere actions are logged (history, audit log, exports, "on behalf of"). Internally the user's record stays the key, so a later ID correction never breaks the history.

**Questions for the customer:**
1. Employee ID format: today E + year + 4 digits (E20210001). The example has 3 (E2021001). Keep 4, or switch to 3 (max 999 hires per year)?
2. "Real estate employees will see CONFX logo": is Real estate REAL-X, with CONF-X as the group / conferences company?
3. Exact colour codes (hex) for magenta, neon green, neon orange, turquoise and dark brown, or take them from the logo files?
4. Whole header dark (black / dark brown) with the white logo, or a light header with the logo in a dark tile?
5. Owners and admins who manage all companies: group logo (CONF-X) in their header?

**Answers (2026-10-17):**
1. Colour codes: only WED-X and CONF-X for now (to be sent); the others later, so colours must be editable.
2. Employee ID: **3 digits** (E2021001).
3. **CONF-X GROUP is the mother company** of all the others.
4. An Excel with the companies and their activities is coming; logos are coming.
5. **Header stays as it is, no colour change.** Only the logo changes with the theme (light theme: the black version; dark theme: the white version).
6. The logo sits in a **box framed by a thin line in the logo's own colour** (black on light, white on dark), a bit bigger than today's mark, not very big.

**Build now (without logos / colour codes):** fixed header in every language, framed logo box (company code until logos are uploaded), company per user, logo + accent per company with group (CONF-X) fallback, job title, name card "JOB TITLE - E2021001", role hidden outside Admin & IT, 3-digit Employee IDs, sign-in with Employee ID or email, Employee ID next to names in history.

**Delivered (2026-10-17):**
- Header fixed in every language (logo + full name left, buttons right); the menu always opens from the right.
- Framed logo box, black logo on the light theme and white on the dark theme, frame in the same colour; header colours unchanged. Company code shows until a logo is uploaded.
- Admin & IT → Business units: colour (picker or code) and the two logo versions per company; Company tab: the group logo (CONF-X GROUP), shown to users without a company.
- Admin & IT → Team: *Job title* and *Company* per user; the list shows both.
- Menu name card "OWNER - E2026001"; permission level removed from the menu (web and phone).
- Employee IDs now E + year + 3 digits; existing ones converted (E20260001 → E2026001).
- Sign in with the employee ID or the email (web and phone); when an ID exists in several workspaces, the sign-in asks which.
- History, audit trail, documents, deactivations and completed activities show "Name (E2026001)".
- Fixed in passing: updating a user without sending the role reset it to Sales (the web form always sent it, so it never showed).
- Checks: API tests 65/65; web typecheck; checked in the browser (sign-in with an employee ID, header in English and Arabic, light and dark, menu, Admin → Business units). Phone app: files syntax-checked only (its packages aren't installed here).

- Committed and pushed with the combined discussion file (2026-10-17); VPS update pending (migration 010 runs on start).

**Logos received (2026-10-17):** `Wed-x-all-logos.pdf`, `Conf-x-all-logos.pdf`, `Deal-x-all-logos.pdf` (Illustrator sheets with every version).
- Short logos cut out as small vector SVGs with [scripts/make-logo-icons.py](scripts/make-logo-icons.py): WED-X = the TwinFlame (calligraphy + magenta letter, without the WED·X lettering); CONF-X = magenta triangle + black X; DEAL-X = neon-green triangle + dark-brown X. Each in two versions: `-light.svg` (dark ink + accent) and `-dark.svg` (white + accent, made from the coloured one).
- Saved in `templates/logos/` (git-ignored, like all customer files), with the original PDFs.
- Brand colours read from the files: magenta **#EB028D** (WED-X, CONF-X), neon green **#5EC232** (DEAL-X), black #231F20, dark brown #221A13.
- Checked locally: uploaded to the demo companies and the group (CONF-X), shown in the header box in light and dark, and in Admin → Business units.
- Logo box made a bit bigger (44 → 48 px, logo 40 px tall) so the tall TwinFlame reads clearly.
- New: readable shades of the company colour for text (e.g. neon green links become #3D7E21 on white); filled buttons pick black or white text.
- Still missing: REAL-X and SELL-X logos and colours.

**Live site check and setup (2026-10-17):**
- User: "something missing, it's not like the local interface". The live site serves exactly the same build as local (same file fingerprints), every page file loads, and migration 010 is applied with a clean start.
- Differences were setup only: Melinda's personal accent (Navy #1F3A5F) overrode the company colour and was hard to read on the dark theme; no logos, company colours, job titles or companies were set.
- With the user's go-ahead, done in Melinda's signed-in session: removed her personal accent; colours MelindaX (W) and CONFX HOLD (X) #EB028D, DEALX (D) #5EC232; logos (light + dark) for W = WED-X TwinFlame, X = CONF-X, D = DEAL-X, and CONF-X as the group logo; Melinda job title "Owner", company CONFX HOLD.
- Checked live: CONF-X logo in the framed box, menu name card "OWNER - E2026001", magenta highlights, all home icons shown.
- Left to the customer: rename company W "MelindaX" to "WED-X" if wanted; job titles and companies for the other 9 users; REALX, SELLX, AK Signature and Bi-TREND logos and colours.

**Demo workspace on the live site (2026-10-18):**
- Request: share the demo data to create a demo workspace on app.opsaibridge.eu.
- The seed script (`apps/api/scripts/seed.ts`) was unsafe on a live server: it creates a platform operator `admin@platform.test` / `platform12345` and demo users with `demo12345`, both published in the README.
- New safe mode: `SEED_OWNER_EMAIL` + `SEED_OWNER_PASSWORD` + `SEED_WORKSPACE` + `SEED_USER_PASSWORD` fills an existing, approved workspace through the API (owner/admin only). It creates no operator and no other sign-up, refuses a workspace that already has contracts, and needs a staff password of at least 8 characters. The old local-demo mode refuses to run with `NODE_ENV=production`.
- Tested locally: new workspace filled (96 contracts, 7 people, staff sign-in works); refused on a second run, on the existing demo workspace, without a staff password, and in production mode.

**Passwords (2026-10-18):**
- Question: how can a user reset their password? Answer at the time: only an admin can set a new one (Admin & IT → Team); there was no self-service and no email reset (correcting an earlier remark that email "stays for password resets").
- Built: **Change password** under Preferences (current password required; new one 8+ characters, typed twice), recorded in Admin → IT as "Changed own password".
- Built: server command `reset-user-password.js <workspace> <email or employee ID> <password>` for when nobody who could reset it can sign in; recorded as "Password reset on the server". Deactivated users are refused.
- Admin → IT now labels every access-log entry properly (password entries were going to show as "Exported").
- Checks: API tests 66/66; compiled command run locally; the Preferences card tried in the browser (mismatch blocked, change works, old password refused).
- Later: **Forgot password?** by email, once a sending mailbox (e.g. no-reply@opsaibridge.eu on Hostinger) is chosen. The phone app has no Change password screen yet.

**Waiting for the customer:** logo files (black and white versions per company), colour codes (WED-X and CONF-X now, the rest later), the companies Excel, and job titles for the users.

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
