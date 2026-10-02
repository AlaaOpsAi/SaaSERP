# SaaSERP — Events & Catering Sales (multi-tenant SaaS)

A multi-tenant **Sales & Event Management** platform for event, wedding and catering companies, modelled on
Oracle OPERA Cloud Sales & Event Management and on the team's existing *daily report* workbook
(`CONTRACTS` + `PAR` sheets). Each customer company gets its own isolated workspace.

| Area | What it does |
|---|---|
| **Bookings** | Enquiry → Tentative → Definite → Actualised, or Lost / Cancelled (reason required). Numbers like `W2026001` per business unit and year. Full status history. |
| **Function diary** | Rooms across venues × days. Definite bookings cannot double-book an exclusive room (managers can override); tentative clashes are flagged. |
| **Revenue & cost** | Priced lines (F&B, décor, AV, manpower …) or manual figures → gross margin, fixed cost %, credit-facility cost %, net profit — the same formulas as the workbook. |
| **Money** | Client payments, outstanding balance and aging; commission and partner shares with paid/unpaid tracking. |
| **Activities** | Meetings, calls, follow-ups and site visits; they keep each booking's last/next follow-up dates up to date. |
| **CRM** | Contacts and companies with booking history. |
| **Dashboard** | Year / business unit / account-manager filters; KPIs with change vs last year and sparklines; monthly revenue, margin, profit or bookings vs last year (chart or table); pipeline by stage, lead sources, lost reasons, team leaderboard, top deals and upcoming events. Every chart drills down into the matching bookings. |
| **Excel** | Import the daily-report workbook (idempotent) and export a `CONTRACTS`-style sheet. |
| **Team hierarchy** | Users report to managers, to any depth (e.g. Director → Manager → Team lead → Account manager). Managers see their own records plus everyone below them; account managers see their own. Enforced by the database for bookings, everything inside them, activities, dashboards, finance and exports. Room clashes are still checked company-wide, and other teams' rooms show as anonymous "Booked" blocks. |
| **Cover & transfer** | Time-boxed cover for colleagues on leave (view & act, or view only), with follow-up hand-over, an "on behalf of" audit trail, manager notifications (bell) and no money actions for the person covering. Transfer moves a leaver's work to a colleague and deactivates them. |
| **Approvals** | New companies request a workspace; a platform operator approves (choosing plan and user limit), rejects with a reason, suspends or reactivates it in the operator console at `/platform`. Optional Slack/Teams webhook on each sign-up. |
| **Mobile app** | iOS & Android app (Expo): home KPIs, bookings with search, one-tap call/WhatsApp, status changes, follow-ups, quick new enquiry, room diary and notifications. See [docs/MOBILE.md](docs/MOBILE.md). |
| **Languages** | English and Arabic (full right-to-left layout, Arabic dates), on web and mobile; more can be added without code changes to the screens. Each user picks a language; admins set the company default and translate pick-lists. See [docs/I18N.md](docs/I18N.md). |
| **Look & feel** | Per-user theme (light / dark / device), accent colour, density and text size, saved to the account; a company brand colour as everyone's default. |
| **Data export** | Admins download the whole workspace — bookings with finance, events, payments, commissions, activities, history and audit log, clients, venues, pick-lists with translations, users, reporting lines, cover and a permissions matrix — as Excel (one sheet per table) or JSON. |
| **SaaS** | Self-service workspace requests, roles (owner/admin/manager/sales/finance/viewer), plan user limits, per-tenant currency, time zone and profit percentages. |

## Quick start (local)

Requirements: Node 22, PostgreSQL 16.

```bash
npm install
sudo -u postgres apps/api/scripts/setup-db.sh saaserp     # roles + database
cp apps/api/.env.example apps/api/.env
npm run db:migrate
npm run db:seed          # demo workspace owner@demo.test / demo12345, operator admin@platform.test / platform12345
npm run dev:api          # http://localhost:4000
npm run dev:web          # http://localhost:5173  (proxies /api)
```

Import your workbook either from **Settings → Import from Excel**, or from the CLI:

```bash
npm run import:xlsx -w apps/api -- <workspace-id> path/to/REPORT_Daily.xlsx
```

### Docker (e.g. on a Mac)

```bash
git clone https://github.com/AlaaOpsAi/SaaSERP.git && cd SaaSERP
git checkout claude/affectionate-sagan-hru2m7
echo "JWT_SECRET=$(openssl rand -hex 32)" > .env
docker compose up -d --build        # first build takes a few minutes
open http://localhost:4000          # create your workspace, then Settings → Import from Excel
```

- Create your operator account, then sign in at http://localhost:4000/platform to approve workspaces:
  `docker compose exec app node apps/api/dist/scripts/create-platform-admin.js you@company.com 'a-long-password' "Your Name"`
- Port 4000 busy? Add `APP_PORT=8080` to `.env` and open http://localhost:8080.
- Logs: `docker compose logs -f app`
- Stop: `docker compose down`. Your data stays in the `pgdata` volume.
- Update: `git pull && docker compose up -d --build`. Migrations run automatically on start.
- Backups: the `backup` service takes a nightly backup into `./backups` (14 days kept). Back up now with `./scripts/backup.sh`; restore with `./scripts/restore.sh backups/<file>.dump`. To connect a database tool (read-only login `saaserp_readonly` on `127.0.0.1:5433`), see [docs/OPERATIONS.md](docs/OPERATIONS.md).
- Wipe everything: `docker compose down -v`. This deletes all data.

The image runs migrations on start and serves the web app and the API from one process.

## Tests

```bash
sudo -u postgres apps/api/scripts/setup-db.sh saaserp_test
npm test            # API integration tests against a real Postgres
npm run typecheck
```

The tests cover tenant isolation (including at the database level), booking numbering, the finance formulas,
the status workflow, diary conflicts, roles and plan limits, reports and the workbook import.

## Docs

- [Architecture](docs/ARCHITECTURE.md): stack, multi-tenancy, data model, API.
- [Workbook mapping](docs/EXCEL-MAPPING.md): how every column of the daily report maps into the system.
- [Team hierarchy, cover & transfer](docs/HIERARCHY.md): who sees which records.
- [Mobile app](docs/MOBILE.md): run it on your phone, build for the stores.
- [Workspace approval](docs/APPROVALS.md): the sign-up review workflow and operator console.
- [Database reference](docs/DATABASE.md): ER diagrams and every table, column, view, function, policy and role, with its purpose (generated: `npm run docs:db -w apps/api`).
- [Operations](docs/OPERATIONS.md): connect to the database, automatic and manual backups, restore.
- [Languages, look & feel](docs/I18N.md): how translation works, adding a language, themes.
- [Roadmap](docs/ROADMAP.md): OPERA S&E capabilities still to build.
