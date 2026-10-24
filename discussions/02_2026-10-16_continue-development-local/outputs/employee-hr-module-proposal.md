# Employee files: HR module proposal

Date: 2026-10-24 · Status: **built (2026-10-24), modules foundation and HR phase 1**

The two files sent hold real personal data (civil IDs, passports, salaries). They stay on this computer and out of git. This note describes only their structure.

## 1. What the files contain

**EMPLOYEE_DB.xlsx**
- **DB:** one row per employee (89 rows):
  - who they are: employee #, initials, name, company, branch, position, reports to, employment type, status;
  - documents: nationality, civil ID and its expiry, sponsor, passport and its expiry, with an **ALERT !!!** column when an expiry is near;
  - pay: salary, extra, housing, ticket, transport;
  - service: start / end date, reason for leaving, iqama dates, service days;
  - contact and family: phones, personal email, birth date, marital status, children.
- **Miraz:** one employee's attendance for 2026, one code per day (OK present, OFF, PH public holiday, …), with leave balances.
- **PAR:** the pick-lists:
  - request status: REQUEST / APPROVED / REJECTED;
  - payment: cash / bank, and banks;
  - leaving: resignation / termination / contract expiry;
  - employment type: full time / part time / freelance;
  - attendance codes.

**EMPLOYEE INFORMATION FORM.docx** is the joining form:
- the job;
- personal information: gender, birth date and place, religion, addresses and phones in Kuwait and the home country, education, health notes, criminal record, driving licence;
- two emergency contacts;
- a checklist of required documents: civil ID, passport, CV, work permit, medical certificate, criminal record certificate, IBAN certificate;
- the employee's signed declaration.

Their employee numbers (E2016001) already use the app's Employee ID format: E + year + 3 digits.

## 2. Recommended: an "Employees" area under Admin & IT

**Phase 1: employee records and expiry alerts**
1. **Employee profile:** every field of the joining form and the DB sheet, in sections: Job, Personal, Contact, Emergency contacts, Documents, Pay. The Employee ID links the profile to the person's sign-in, if they have one; drivers or cleaners may have no sign-in.
2. **Documents:**
   - upload the checklist items (civil ID, passport, CV, work permit, medical, criminal record, IBAN), with expiry dates where they apply;
   - open them in the watermarked viewer.
3. **Expiry alerts** (the ALERT !!! columns): a bell notification to HR and owners 60 and 30 days before a civil ID, passport, iqama or work permit expires, plus an "Expiring soon" list.
4. **Who sees what:**
   - a new **HR** right, defaulting to levels 1–2 plus the HR department;
   - pay, health and criminal-record fields only for people with that right;
   - people see their own profile (pay included) and can't edit it;
   - every view is logged.
5. **Import:** load EMPLOYEE_DB.xlsx once (the 89 employees), then keep the records in the app.
6. **Print** the filled joining form as a PDF for signing (or the blank form).

**Phase 2 (later): attendance, leave and end of service**
- **Attendance:** the monthly attendance grid with the Miraz codes.
- **Leave:** leave requests (request → approved / rejected) and balances.
- **End of service:** reason, last day and payment method.

## 3. Questions

1. Is phase 1 the right start, with attendance and leave later?
2. Who may see **salaries**: owners and HR only, or the employee's line manager too?
3. Alerts: are **60 and 30 days** before expiry right, and who receives them?
4. Should employees see their own profile, and may they update their contact details or emergency contacts themselves?
5. Is there a separate **HR department** to add under Departments, or does someone in Management handle HR?

## 4. Answers (2026-10-24)

1. **Scope:** phase 1 first (records, documents, expiry alerts); attendance and leave later.
2. **Salaries:** visible to **levels 1–3** and to the employee.
3. **Expiry alerts:** go to **HR and the employee's manager**.
4. **Own profile:** employees **see their own profile but can't edit it**. To change something, they ask HR from the app.
5. **HR department:** yes.

**Strategy:**
- SaaSERP is sold as **modules**: Sales & Contracts (today), HR, Finance, …
- A workspace **requests a subscription** to each module.
- Modules work together. Contracts use Finance and HR, with **limited capabilities** when a workspace doesn't subscribe to them.

## 5. Build plan

**A. Modules, the foundation for HR, Finance, …**
- **Storage:** each workspace has a list of active modules. **Sales & Contracts** is always on; **HR** is the first optional one, and **Finance** comes later.
- **Requesting:** workspace owners see the modules under **Admin & IT → Modules**: active, available, "Request subscription". A request notifies the platform operator.
- **Granting:** the operator turns modules on or off per workspace in the platform console, next to plan and user limit.
- **Enforcement:** the server refuses a module's pages and data when the workspace doesn't have it; menus and Home icons hide it.
- **Without HR:** people keep what they have today (Employee ID, department, level, job title, manager), so contracts, the org chart and permissions still work.
- **With HR:** the same people also get the full employee profile. Finance will follow the same pattern: without it, contracts keep today's simple payments and figures.

**B. HR module, phase 1**
- **Employees** list: name, employee #, company, branch, department, position, manager, type, status. Filters, plus expiry warnings.
- **Employee profile**, in sections from the joining form and the DB sheet:
  - Job: position, department, manager, company, branch, type, status, joining / end date, reason;
  - Personal: nationality, civil ID / iqama, sponsor, gender, birth date and place, marital status, religion, children, education, health notes, criminal record, driving licence;
  - Contact: Kuwait and home-country addresses, phones and emails;
  - Emergency contacts: two;
  - Documents: civil ID, passport, CV, work permit, medical, criminal record certificate, IBAN certificate, with expiry dates, opened in the watermarked viewer;
  - Pay: salary, extra, housing, ticket, transport.
- **A profile is optional per person:** an employee can have a profile without a sign-in, and a sign-in is linked by Employee ID.
- **Who sees what:**
  - **HR right:** create and edit profiles (the HR department, and levels 1–2 by default; adjustable under Permissions);
  - **Pay:** levels 1–3, HR and the employee themselves;
  - **Health and criminal record:** HR and owners only;
  - **Managers:** their team's profiles without pay;
  - **Employees:** their own profile, read only, with **"Ask HR to update"**, which creates a request HR sees in the bell and on the profile;
  - **Logging:** every view of a profile is logged.
- **Expiry alerts:** a daily check of civil ID, passport, iqama, work permit and other document expiry dates. Bell notifications go to HR and the employee's manager at **60 and 30 days** and on expiry, plus an "Expiring soon" list.
- **Import:** a one-time import of EMPLOYEE_DB.xlsx (the DB sheet), matched by employee #.
- **Print:** the filled joining form as a PDF for signing.
- **Departments:** **HR** is added to the default departments.

**Not in phase 1:** attendance, leave, end of service and payroll (phase 2), and Finance (its own module later).

## 6. Change after the first build (2026-10-24): basic vs full

**Feedback:** without the HR subscription, Melinda saw "no subscription"; she should get HR with limited functionality.

**Proposed model:**
- **Subscriptions:** every module is a subscription. **Contracts (Sales)** is the one Melinda's workspace has today.
- **Basic tier:** every other module is available in a **basic** form without a subscription.
- **Full tier:** "Request full module" asks for the subscription.

**HR basic, no subscription**
- **Employee directory:**
  - everyone with a sign-in, plus records HR adds;
  - fields: name, employee ID, position, department, reports to, company / branch, work phone and email, status, joined;
  - an org-chart view.
- **Who edits:** HR (levels 1–2 + HR department) adds and edits these basic fields. Everyone else views: the directory follows the existing team visibility, and each person sees their own record.

**HR full, subscription**
- **Records:** personal and identity data (civil ID, passport, residency, family, health, criminal record), emergency contacts and pay.
- **Documents:** uploads with expiry dates, and expiry alerts to HR and the manager.
- **Requests:** "Ask HR to update".
- **Import and print:** the EMPLOYEE_DB.xlsx import and the printable joining form.
- **Later:** attendance and leave (phase 2).

**When HR full ends or isn't subscribed:** the extra data stays stored but hidden, and comes back if the module is turned on again.

**Finance:** basic means today's contract payments and finance figures, which already work; Finance full is the later module.

**Contracts:** a workspace without the Contracts subscription would lose contracts, the diary and the dashboard (for future customers who buy only HR). Melinda's workspace keeps it.
