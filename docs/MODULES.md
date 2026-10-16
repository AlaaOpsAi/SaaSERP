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

## Phase 1b (customer comment 4)

**Home · ☰ Menu · EN | AR on every page.**
- **Web:** a top bar replaces the left sidebar. The ☰ Menu panel holds every module you may use, Cover & delegation, notifications, Preferences and Sign out. EN | AR switches language at once and is saved to your account.
- **Phone app:** the same three buttons in the header of every screen, with no bottom tab bar. Switching to or from Arabic asks for one restart (right-to-left layout).

**Admin & IT** is one icon. Admin has two new tabs:
- **IT:** app version, database and schema version, last backup (size, age, warning after 36 h), and the sign-in and export log (`access_log`).
- **Deactivated records:** see the last section below.

**New company:** a button on the sign-in page opens the workspace request. The operator still approves every request.

**Customer ID:** every person and company in CRM gets an automatic number (**C0000000001**, C + 10 digits, one series per company). You can search by it in CRM, Contracts and the activity link search.

**Activities:**
- **Linked:** every client activity (call, meeting, site visit, follow-up, email, task) must be linked to a **Contract ID** or a **Customer ID**. Search by number, name or phone. The API refuses unlinked ones. Older unlinked activities are listed as "not linked" so you can link them.
- **Marketing:** the new **Marketing** role logs its own work: campaigns, social media posts, exhibitions / events, advertisements and content. These may stand alone. Marketing can't create or change contracts, and doesn't see finance figures by default.
- **Plan (future):** a week per person, Sunday to Saturday. Each day has **+ Add**. **Move unfinished to the next week** shifts open items by seven days. Managers pick any person in their team.
- **Log (present):** **Log activity** records something already done, with its outcome. The outcome is required for meetings and site visits.
- **Report:** **Daily** or **Monthly**, per person or the whole team. **Print** gives a clean page; use Save as PDF in the print dialog. **Download Excel** gives the same report as a workbook. API: `GET /api/reports/daily-activity?from=YYYY-MM-DD&to=YYYY-MM-DD[&owner_id][&format=xlsx]`.

**Save / Cancel / Delete** on every data entry dialog: contracts, clients, companies, activities.
- Delete sits on one side; Cancel and Save on the other.
- Closing with unsaved changes asks "Discard your changes?".

**Delete = Deactivate.** Delete asks for a reason, then **deactivates** the record:
- The database hides it from every screen, list, calendar, report, dashboard and export (policy `hide_deactivated`). It also no longer blocks a room.
- It's kept with who, when and why, and its number is never reused.

| Who | Contracts | Customers | Activities |
|---|---|---|---|
| Sales | own, while Inquiry/Tentative, no payment | only if no contract uses them | own |
| Marketing | — | — | own |
| Managers, admins | any | any | any |

- **Managers** restore records under **Admin → Deactivated records**.
- **Admins** can **delete for good**, but only records that are already deactivated.

## Contract documents (customer comment 5)

Every contract has a **Documents** tab (phone: a Documents card on the contract).

**Signed contract upload:**
- A picture (JPEG, PNG) or PDF, up to 15 MB, at **every status**. Kinds: signed contract, signed proposal, annex, other.
- On the phone: **Take photo**, **Choose photo** or **Choose PDF**.
- Moving a contract to **Definite** asks for the signed copy straight away. It can wait: the contract is then **flagged**, never blocked:
  - "Not signed" in the contracts list, with a **Signed contract missing** filter
  - a warning on the contract and on the dashboard
- The type is checked from the file's content, not its name. Files open through links that expire after 10 minutes.
- Removing a file deactivates it, as with other records (Admin → Deactivated records).

**Issuing a contract or proposal** (the salesperson, from **Tentative** or **Definite**):
1. Fill in **Services & prices** (type of work, details, qty, price) and, for weddings, the **Annex details**. **Add the standard list** loads the business type's annex checklist; fill in quantities and notes.
2. **Issue contract / proposal**: choose Contract, Proposal or Annex and the template, and add notes if needed.
3. The system fills the template and makes a Word file and a PDF:
   - the client, event date and day, venue, guests, services, total, down payment and remaining
   - the total in words, in English and in Arabic
4. Each issued document is numbered (**W2026052-C1**, **-P1**, **-A1**) and kept exactly as issued. Issuing again creates the next number.
5. When the client's signed copy is uploaded, the document shows **Signed**.

**Templates** (**Admin & IT → Templates**):
- Ordinary Word files with `{placeholders}`. The company's letterhead, wording and layout stay as designed.
- Each template is set for:
  - contract, proposal and/or annex
  - one or more **business types** (business units), or all
  - **Arabic**, **English** or **both**
- An upload is test-filled first. A broken placeholder is refused with a message.
- Until a company uploads its own, a **standard English & Arabic** contract/proposal and annex are used. Both can be downloaded as a starting point. The list of placeholders is on the same page.
- **Annex checklist per business type:** one service per line, with the second language after `|`.
- PDFs are made by LibreOffice inside the app container (included in the Docker image).

**WEDX:**
- The wedding contract and the Wedding Details annex were turned into templates. The blanks became placeholders, and the items table became a repeating row.
- They are uploaded under Templates for business type **W**.
- The 31 annex services are the wedding checklist.

## CRM database (customer workbook DB_CRM_Segm)

- **Customer ID:**
  - C + 10 digits (C0000000001), one series for people and companies
  - the earlier C-00001 numbers were converted, keeping their order
  - the ID from the workbook (C000001) is kept as **Earlier ID**, shown under the new one and searchable
- **One customer per email and per mobile:**
  - every customer needs an email or a mobile number
  - typing an existing one shows **"Already exists under customer: C… Name"**, with a button to open that customer
  - saving a duplicate is refused
  - mobiles match with or without the country code
- **Customer fields:**
  - person: title, gender, position / profession, civil ID (also printed in contracts), date of birth
  - company: parent company, registration no., license no., tax ID, legal representative, established on
  - both: second mobile, landline, city, ZIP, web page, segment, industry, newsletter consent (with its date), preferred contact
  - the registration date and who registered it are automatic
- **Relationships:**
  - one customer can have several: Client, Applicant, Supplier, Partner, Enquiry, Sales Blitz, Owner, Buyer, Seller, Employee, Attendee, LinkedIn
  - each has a segment, an optional contract, the registration date and user, and comments
  - the earlier relation list (MEET, MBS, BMB, …) is kept as an optional second field
  - the CRM list filters by relationship and segment
- **Applicant profile** (in the CRM): education, degree industry and name, year, country, years of experience, management experience, companies worked for, fields of experience, languages, driving license.
- **Pick-lists** (Admin → Pick-lists, from the workbook's PAR sheet): Relationships, Relationships (earlier list), Segments, Industries, Titles, Contact modes, Education levels.
- **Employee ID:**
  - each user gets E + year of hiring + 4-digit serial (E20250001)
  - set the hiring date under Admin → Team; the initials stay as the short code
- **Excel:**
  - **Admin → Import from Excel → Import the CRM workbook** reads sheet DB (row 2 headers, columns in their usual order)
    - rows with the same email or mobile become one customer with several relationships
    - re-importing adds nothing twice
  - the import report lists:
    - joined names to check (e.g. "A B D U L A Z I Z")
    - users and contract IDs it couldn't match (kept in the comments)
    - skipped rows
  - **CRM → Export Excel** (managers) writes the same 56 columns in the same order, one row per relationship

## Next phases

| Phase | Module | Content |
|---|---|---|
| 2 | Operations | Per-event orders for the operations team: menus, setup, timings, staffing |
| 3 | Finance & Accounting | Invoices, receipts, expenses (PAR categories), bank accounts; fills the finance columns automatically |
| 4 | Procurement + Inventory | Suppliers, purchase orders, stock in and out, linked to Finance |
| 5 | Marketing, then HR | Campaigns and lead-source return, Instagram leads into CRM; staff records |

Each phase gets its own short design for approval before development starts.
