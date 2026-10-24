# Modules and the HR module

## Modules

SaaSERP is sold as modules, each a subscription (`tenants.modules`). HR and Finance also work in a **basic** form without one:

| Module | Without a subscription | With a subscription |
|---|---|---|
| Contracts | not available | contracts, CRM, activities, the function diary, documents, dashboard and reports |
| HR | **basic:** employee directory and org chart | **full:** personal records, pay, documents with expiry alerts, change requests, Excel import, printed form |
| Finance | **basic:** the payments and figures on contracts (today's features) | **full:** planned |

Existing workspaces, Melinda's included, have the Contracts subscription; new sign-ups start with Contracts.

**Getting a subscription**
1. A workspace owner or admin asks under **Admin & IT → Modules** ("Request subscription").
2. The platform operator ticks it in the operator console (`/platform`, *Modules* column). Requested modules are highlighted there.
3. The workspace owners get a bell notification when it is active.

**Enforcement:** the server refuses subscribed features without the subscription (`403` with `details.module`):
- **Contracts:** its routes are listed in `CONTRACT_ROUTES` (`apps/api/src/auth.ts`). Without it, its Home icons show *Not subscribed* and leave the menu.
- **HR full:** checked in `routes/hr.ts`.

**If a subscription ends:** HR full data stays stored but is hidden, and comes back when it is turned on again.

**Code:** `apps/api/src/lib/modules.ts`, `routes/modules.ts`, `module_requests` (migrations 013–014).

## HR module, phase 1

**HR basic (every workspace).**
- **Directory:** everyone with a sign-in, plus the records HR adds.
- **Fields:** employee ID, name, position, department, reports to, company / branch, type, status, joined / left, work phone and email.
- **Org chart:** who reports to whom.
- **Editing:** HR adds and edits these fields; everyone else views them, under the visibility rules below.

**HR full (subscription)** adds everything below.


**Employee records.** Each record holds the fields of the joining form (EMPLOYEE INFORMATION FORM) and the employee register (EMPLOYEE_DB.xlsx):
- **Job:** employee ID, position, department, reports to, company, branch, type, status, joined / left;
- **Identity & residency:** nationality, civil ID / iqama, sponsor, passport, expiry dates, work permit;
- **Personal:** gender, birth, marital status, religion, children, education, driving licence, health and criminal record;
- **Contact:** Kuwait and home-country addresses, phones and emails;
- **Emergency contacts:** two;
- **Pay:** salary, extra, housing, ticket, transport.

**Sign-ins.** A record can exist without a sign-in (e.g. drivers). A sign-in is linked by Employee ID, the same E + year + 3 digits as the register. A new record without an ID takes the sign-in's ID, or the next free one for its joining year.

**Who sees what**

| | Sees records | Pay | Health & criminal record | Edits |
|---|---|---|---|---|
| HR right: levels 1–2, the **HR** department, or a personal exception | everyone | yes | yes | yes |
| Level 3 | everyone | yes | no (owners: yes) | no |
| Manager | their team (reporting line, or "reports to" in HR) | no | no | no |
| Employee | their own record | yes | yes | no: "Ask HR to update" |

Every view of a record is logged under Admin & IT → IT ("Viewed an employee record").

**Documents.**
- Upload the civil ID, passport, CV, work permit, medical certificate, criminal record certificate, IBAN certificate, employment contract and others.
- Each can have a number and an expiry date.
- Documents open in the watermarked viewer, for anyone who may see the record.

**Expiry alerts.**
- What is checked: civil ID, passport and work permit expiry dates, and document expiry dates, for active employees.
- When: a bell notification goes to HR and the employee's manager 60 days before, 30 days before, and on or after the expiry date, once per stage.
- How: the server checks every 6 hours. *HR → Expiring soon* lists what is coming.

**Change requests.**
1. Employees see their record but can't edit it: *Ask HR to update* sends HR a notification.
2. HR updates the record and marks the request done.
3. The employee is told.

**Import.**
- *HR → Import from Excel* reads EMPLOYEE_DB.xlsx: sheet DB, headers in row 1.
- Records are matched on the employee ID, so the import can run again to update them.
- Sign-ins with the same ID are linked.
- "Report to" (a position, e.g. CEO) links the manager when exactly one active employee holds that position.

**Print.** *Print form* gives the filled joining form on paper or as a PDF, with the declaration and signature lines.

**Later (phase 2):** attendance (the monthly codes of the Miraz sheet), leave requests and balances, end of service.

**Code:** `apps/api/src/lib/hr.ts`, `routes/hr.ts`, tables `employees`, `employee_documents`, `employee_requests`, `employee_alerts`; web `pages/HR.tsx`.
