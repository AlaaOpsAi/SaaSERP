# Modules and the customer's plan

The customer's module plan from 13 Oct 2026:
- **Dashboard, Contracts, Event Calendar, Activities, CRM:** built.
- **Finance and Admin:** partly built.
- **Operations, Inventory, Marketing, Procurement, HR:** planned.

Phase 1, described below, puts that plan on screen and reshapes Contracts and Activities around how the sales team works today.

## Home screen

After sign-in, the welcome line sits above the modules, shown as iPhone-style icons. The phone app has the same screen.

| Icon | Opens | Who sees it |
|---|---|---|
| Dashboard | KPIs, monthly performance, pipeline (`/dashboard`) | everyone |
| Contracts | the contracts list and contract page (`/bookings`) | everyone |
| Event calendar | rooms and events, or meetings (`/diary`) | everyone; the icon shows today's date |
| Activities | follow-ups and the daily report; red badge = due today or overdue | everyone |
| CRM | clients and companies (`/clients`) | everyone |
| Finance | receivables, commissions, shares | owner, admin, manager, finance |
| Admin | company settings, team, lists, contract fields, import, export | owner, admin, manager |
| Operations, Inventory, Marketing, Procurement, HR | "Coming soon" | owner, admin, manager |

- **Changing the order:** an admin clicks **Arrange icons**, then drags the icons (or uses the arrows) and clicks **Done**.
- **Who it applies to:** the order is saved for the whole company in `tenants.home_order`. **Default order** resets it.
- **Code:** the icon list is `apps/web/src/modules.tsx` (web) and `apps/mobile/src/components/modules.tsx` (phone).

## Contracts: one page, three groups

The contract page follows the groups the customer uses in the daily report. They're all on one page, with jump links at the top.

1. **Contract & payment details:**
   - contract ID and status, company, **branch** (your own outlet), event date
   - **hotel / location** (the venue of the event), hall / area
   - pax, rate, term days, event type, **design**, source, account manager, credit facility
   - **total contract value**, **money received (DP)**, **difference** (DIFF CTRL = received − contract value, for confirmed contracts)
   - **Record down payment**: the salesperson records it themselves. It's stored as a payment of kind `deposit`.
2. **Follow-up details:**
   - request and notes, enquiry date, decision due, last and next follow-up, client feedback, lost reason
   - every meeting and follow-up, with its outcome
3. **Client details:** first name / contact, **family name**, phone, email, country / nationality, **Instagram ID**, address details.

The edit dialog uses the same three groups and saves the client record too.

- **Lists to fill in:** **Branch** and **Design** are pick-lists under **Admin → Pick-lists**. The Excel import fills them from the PAR sheet.
- **The finance columns** hidden in the daily report are calculated from what Finance records, never typed by sales: revenue, cost, margin, fixed cost, CF cost, net profit, commission, shares, outstanding and aging.

## Who sees which contract fields

**Admin → Contract fields** is a matrix of fields × roles (manager, sales, finance, viewer). Owners and admins always see everything.
- By default, **sales and viewers don't see the finance figures.**
- Source, account manager, branch, design, pax, rate, contract value, money received and credit facility can each be hidden per role too.

**Hiding is done by the server, not just on screen** (`apps/api/src/lib/fields.ts`):
- A hidden field is left out of the contract page, the contracts list and its totals, and the contracts Excel export, and the API never sends it.
- Changes to a hidden field are ignored.
- The full workspace export includes the matrix (sheet `field_visibility`).

## Activities and the daily report

- **Meeting outcome is required.** A meeting or site visit can't be marked done until the outcome is written. Other follow-ups can still be ticked off in one tap.
- **Activities → Daily report:** for one day, each salesperson's:
  - calls, meetings and follow-ups done
  - what's still planned and what's overdue
  - contracts opened, won and lost
  - a timeline with **every meeting's outcome**

  Managers see their whole team, and a salesperson sees their own day. **Download Excel** gives a Summary sheet and a Details sheet. API: `GET /api/reports/daily-activity?date=YYYY-MM-DD[&format=xlsx]`.
- **Event calendar → Meetings:** everyone's client meetings and site visits per day, for one week, two weeks or four. It shows who, where, the client, the contract and the outcome. Past meetings without an outcome are flagged in red. You can filter by salesperson.

## Excel import of the newer workbook

The importer finds columns **by their headers** (row 2, with the group names of row 1: EVENT, ENQUIRY DATE, LAST FOLLOWUP, MEETING #1…). Both the original and the 2026 layouts work, as do future column moves. See [EXCEL-MAPPING.md](EXCEL-MAPPING.md).

## Next phases

| Phase | Module | Content |
|---|---|---|
| 2 | Operations | Per-event orders for the operations team: menus, setup, timings, staffing |
| 3 | Finance & Accounting | Invoices, receipts, expenses (PAR categories), bank accounts; fills the finance columns automatically |
| 4 | Procurement + Inventory | Suppliers, purchase orders, stock in and out, linked to Finance |
| 5 | Marketing, then HR | Campaigns and lead-source return, Instagram leads into CRM; staff records |

Each phase gets its own short design for approval before development starts.
