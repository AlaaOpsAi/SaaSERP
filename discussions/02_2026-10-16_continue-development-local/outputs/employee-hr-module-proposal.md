# Employee files: HR module proposal

Date: 2026-10-24 · Status: **waiting for answers and go-ahead**

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
