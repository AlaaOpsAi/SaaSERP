# Architecture

```
apps/
  api/   Fastify + TypeScript + PostgreSQL (pg, zod, exceljs)
    migrations/   plain SQL, applied in order by scripts/migrate.ts
    src/routes/   auth, settings, crm, bookings, activities, diary, reports, import
    src/lib/      booking rules, importer, SQL helpers, password hashing
    test/         integration tests (vitest + real Postgres)
  web/   React + Vite + TanStack Query + React Router, plain CSS (light/dark)
```

## Multi-tenancy

Shared database, shared schema, `tenant_id` on every business table.

- **Row-level security** is the enforcement layer. Every request runs inside a transaction that sets
  `app.tenant_id` (see `withTenant` in `src/db.ts`). The policies on every table only expose rows of
  that tenant, so a query that forgets a `WHERE tenant_id = …` still cannot leak or write across tenants.
- Two database roles:
  - `saaserp_owner` owns the tables and runs migrations.
  - `saaserp_app` is what the API connects as. It is not a superuser, has no `BYPASSRLS`, and is always subject to the policies.
- Login has to find a user before the tenant is known. It does that through `SECURITY DEFINER` functions
  (`auth_find_users`, `auth_slug_taken`) owned by the owner role, which expose only what login needs.
- The finance views are `security_invoker`, so they respect RLS too.
- Plans: `tenants.plan` and `max_users`. Creating login users beyond the allowance is rejected.

Moving a large customer onto a dedicated database later needs no code changes: point that deployment's
`DATABASE_URL` at it.

## Data model

```
tenants ─┬─ users (roles; inactive users = account managers without a login)
         ├─ business_units (booking-number prefix: W, X, …) ── booking_sequences
         ├─ lookups (event_type, source, lost_reason, item_category, setup_style, payment_method, bank_account, business_type)
         ├─ venues ── function_spaces (capacity, allow_overlap)
         ├─ accounts ── contacts
         └─ bookings ─┬─ booking_events (function space + start/end → function diary)
                      ├─ booking_items (qty × unit price / unit cost)
                      ├─ activities (meetings, calls, follow-ups)
                      ├─ payments
                      ├─ booking_payouts (commission / share %)
                      └─ booking_status_history
views: booking_finance, booking_payout_amounts
```

### Finance (`booking_finance` view)

The formulas come from the workbook, with the percentages configurable per tenant:

| Figure | Formula |
|---|---|
| revenue / cost | sum of lines, or the manual figures when a booking has no lines |
| gross margin | revenue − cost |
| fixed cost | gross margin × `fixed_cost_pct` (default 20%) |
| CF cost | gross margin × `credit_facility_pct` (default 20%) when the booking has a credit facility |
| net profit | gross margin − fixed cost − CF cost |
| commission | net profit × commission % |
| shares | (net profit − commission) × share % |
| outstanding | (contract value or revenue) − payments, for DEF/ACT only |
| aging days | event date → fully-paid date (or today) |

Amounts are `numeric(14,3)`, because KWD has three decimals.

### Status workflow

```
INQ ⇄ TEN → DEF → ACT
 ↓     ↓     ↓
LOS   LOS   CXL        LOS → INQ/TEN (reactivate), CXL → TEN (reinstate), ACT → DEF (managers only)
```

- LOS needs a lost reason and CXL needs a cancellation reason; the database enforces this with `CHECK` constraints.
- Moving to DEF or ACT checks the function diary for clashes: an overlapping DEF/ACT event in the same non-shareable room returns `409` with the conflicting bookings. Owners, admins and managers can pass `force: true`.

## API

Every endpoint is under `/api` and needs `Authorization: Bearer <jwt>`, except signup and login.

| Method | Path | Notes |
|---|---|---|
| POST | `/auth/signup`, `/auth/login` | signup creates the tenant, a business unit, the default pick-lists and the owner |
| GET | `/auth/me` | |
| GET/POST/PATCH/DELETE | `/bookings`, `/bookings/:id` | list filters: status, year, month, owner_id, source, event_type, venue_id, q, from/to, followup_due, sort |
| POST | `/bookings/:id/status` | `{status, reason?, force?}` |
| POST/PATCH/DELETE | `/bookings/:id/events`, `/booking-events/:id` | conflict-checked |
| POST/PATCH/DELETE | `/bookings/:id/items`, `/booking-items/:id` | |
| POST/DELETE | `/bookings/:id/payments`, `/payments/:id` | finance roles |
| POST/PATCH/DELETE | `/bookings/:id/payouts`, `/booking-payouts/:id` | finance roles |
| GET/POST/PATCH/DELETE | `/activities`, `/activities/:id`, `/activities/:id/complete` | |
| GET/POST/PATCH/DELETE | `/contacts`, `/accounts` | |
| GET | `/diary?from&to&venue_id` | at most 3 months |
| GET | `/reports/dashboard?year`, `/reports/receivables`, `/reports/payouts`, `/reports/contracts.xlsx?year` | |
| GET/POST/PATCH | `/users`, `/business-units`, `/lookups`, `/venues`, `/function-spaces`, `/tenant` | admin |
| POST | `/import/workbook` | multipart `.xlsx`, admin |

## Roles

| Role | Can |
|---|---|
| owner / admin | everything, including settings, users and import |
| manager | sell, finance, venues, delete, override diary clashes, reopen actualised bookings |
| sales | create and edit bookings, events, lines, activities and clients |
| finance | payments and payouts |
| viewer | read only |
