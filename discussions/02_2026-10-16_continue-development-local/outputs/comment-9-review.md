# Customer comment 9: review against the current version

Date: 2026-10-24 · Status: **built (2026-10-24)**. Login sentence and date picture use the recommendation until the customer answers.

The customer may have written some of these on an older version. Under each comment: what the app does **today** (after commits up to `cf3b599`) and what is still to do.

**Legend:**
- ✅ already done
- 🟡 partly done
- 🆕 new work
- ⚠️ changes an earlier decision, so needs confirming

The source Excel these comments refer to is `SALES_Daily Report.xlsx`; its **SYSTEM** sheet has the column headers and codes.

---

### Top bar and login

**1. Language button: show only one language, one box; hide the other options.** 🆕
> Today: two boxes side by side (EN | AR), the active one highlighted. To do: one box showing the current language, which switches or opens the other on click.

**2. The LOGO box frame should be as thin as the menu box frame.** 🆕
> Small style fix.

**3. Delete the greeting "Good evening Melinda". Line 1: first name - CONF-X (company). Line 2: user ID and date only.** 🟡
> Today:
> - The greeting already moved from the page into the top bar (comment 7).
> - Line 1 reads "Good afternoon, Demo Owner".
> - Line 2 reads "Saturday, 24 October 2026 · workspace · figures in KWD".
>
> To do: "Melinda - CONF-X" on line 1 and "E2016001 · 24/10/2026" on line 2.

**20. LOGIN page:**
- **Capitals:** everything shown in capitals should be capitals. 🆕
- **Sign-up line:** replace "Your company is not on XSELL ERP yet?". 🆕
  > Today: "Your company is not on SaaSERP yet?" (the comment says "XSELL ERP"). The replacement text isn't given: see the questions.
- **Subtitle:** becomes "BUSINESS MANAGEMENT SYSTEM | CONF-X GROUP". 🆕

---

### Contracts page: header, search, export

**4. Search bar next to EXPORT. The button says just EXPORT, in capitals.** 🆕
> Today:
> - The search box is in the filter row.
> - The buttons say "Export this view" and "Full year workbook" (comment 8).
>
> To do: search next to one **EXPORT** button. Suggested: EXPORT exports what is on screen (list or pivot), and the full-year workbook moves into a small menu on it.

**7. CONTRACTS in capitals; remove "Every enquiry from …".** 🆕
> Small change.

**8. KPI boxes next to CONTRACTS**, styled like the EXPORT button: two cells, name then figure, following the filters:
- TOTAL;
- DEF, plus a third cell with the conversion rate DEF / TOTAL;
- PAYMENT: TOTAL | PAID | TO COLLECT, for the DEF contracts;
- ENQ, TEN, LOS;
- "Per Company | Per Branch | Per Employee".

> 🟡 Today:
> - The table's last row shows the count "11 of 70" and sums of the money columns, following the filters (comment 8).
> - The pivot gives counts per status, company, account manager …
>
> To do: the KPI strip itself. 🆕

**Questions:**
- Should "Per Company | Per Branch | Per Employee" be three quick selectors (CO / BRANCH / AM) that the KPIs follow, or KPIs broken down by each?
- Conversion rate: the recommendation is to calculate it on all statuses in the current filters except the status filter. Filtering on DEF then still shows the real rate.

---

### Filters

**5. The filter section can be closed up to save space, even with filters set. Filter buttons all the same size, using the abbreviations and codes of the Excel source.** 🆕
> Today:
> - The filter row is always open.
> - The column filters (comment 8) sit in the table headers and take no space.
>
> To do: a "FILTERS ▾" bar that folds away. While folded it shows the number of active filters.

**9. Each filter box with a chosen value is framed in pink.** 🟡
> Today: a column's funnel turns pink when it has a filter, and active filters show as pink chips. To do: the same pink frame on the new filter boxes.

**10. FILTER BOXES, named exactly: CO | BRANCH | STATUS | PERIOD from-to | LOC | PAYMENT | ENQ DT from-to | AM | SOURCE** 🟡
> Today: CO, BRANCH, STATUS, LOC (hotel), AM and SOURCE can already be filtered from the column filters (Excel-style), but not as fixed boxes with these names. PERIOD (event date) and ENQ DT can be filtered with from / to.
>
> To do: a fixed second filter line with these 9 boxes. The column filters stay for anything else.
>
> **Question:** what are PAYMENT's values: fully paid / part paid / not paid / to collect?

**12. QUICK FILTERS, first line above all filters: UPCOMING EVENTS (from-to) | MEETINGS (from-to) | FOLLOWUP (from-to)** 🆕
> Today: meetings and follow-ups are activities, with their own pages (Activities, the meetings calendar); the contract list can't filter by them. To do: a first filter line with these three ranges.

**13. DATE FILTERS: FROM-TO as Y | M | D cells, like the Excel; months as numbers (not names); a popup calendar to pick exact dates. With no date chosen the list shows everything and scrolls to the last 10 registered contracts.** 🆕
> Today:
> - Date filters use the browser's date box, whose format depends on the phone or computer.
> - The "Month" column shows month names ("Mar 2026"), and the pivot does too: this changes to numbers (2026-03).
> - The list opens on the current year, newest enquiries first.
>
> **Question:** the picture mentioned ("see attached picture") wasn't included; please send it. *(Received 2026-10-25 and built: FROM / TO rows of Y | M | D drop-downs.)*

**15. Remove the filters "Follow-up due" and "Signed contract missing".** 🆕
> Two check boxes; quick to remove. The dashboard's "signed contract missing" tile and the contract's warning stay unless asked.

---

### Columns

**6. Headlines of the contract list exactly as in the source Excel; the same for every cell, parameter and filter.** 🟡
> Today: the columns use the app's own names: "Booking / client", "Event date", "Venue", "AM" …
>
> To do: use the SYSTEM sheet headers in capitals: CONTRACT ID, CO, BRANCH, STATUS, Y | M | D, HOTEL LOC, HALL AREA, PAX UNITS, TOTAL CONTRACT VALUE, MONEY RECEIVED DP, CASH TO COLLECT, SOURCE, AM, DETAILS, ENQUIRY DATE, LAST FOLLOWUP, FOLLOWUP CLIENT FEEDBACK, LOST REASON …
>
> Code values already match the Excel (W, RB, INSTA, JOU, LOS …).

**14. Default columns as in the SYSTEM sheet, headers in capitals.** 🟡
- **DETAILS column:** country (nationality) - client full name - phone, then a second line with the contract description. "CLIENT" when the name is missing.
- **Shown:** enquiry date and last follow-up date (without details), and the next meeting date.
- **Not shown:** lost reason and meeting history.
- **The rest:** opens from the contract ID.

> Today:
> - The column chooser (comment 8) has most of these. The "Booking / client" column shows name and phone, but not nationality or description.
> - The next meeting date isn't a column yet.
>
> To do: the DETAILS column, a NEXT MEETING column, and this default layout.

**18. "Remove these columns from the current display:"** ❓
> The list of columns is missing from the comment: see the questions. Meanwhile, each person can already hide any column with **Columns**, and it's remembered.

**19. Freeze the first column when scrolling right. Freeze the header too?** 🆕
> Today neither is frozen. Recommended: freeze both (CONTRACT ID column and the header row); there is room.

---

### Follow-ups and status

**11. FOLLOW-UP: logged automatically with its text.** 🟡
- The last follow-up date and details show in the list. It can be a future date with to-do notes, as a planned follow-up.
- Follow-ups repeat until DEF / LOS / CXL.
- Every follow-up is recorded with its actual date in the contract's history.
- The list shows only the last one; the contract shows them all.

> Today:
> - Follow-ups are activities with a date, notes and an outcome.
> - Completing one updates the contract's "last follow-up date", and a planned one sets the "next follow-up".
> - All of them show in the contract (activities and history).
>
> To do:
> - LAST FOLLOWUP plus its feedback text as list columns;
> - one follow-up timeline in the contract's history;
> - stop asking for follow-ups once the contract is DEF / LOS / CXL.

**16. STATUS CONDITIONS**

| Status | Customer's rule | Today | |
|---|---|---|---|
| ENQ | Default for every new lead | ✅ New contracts start as ENQ | ✅ |
| TEN | Offer **attached or printed** in the system first; then the change is automatic | Automatic when an offer or contract is issued (printed) from the app. Uploading an offer the customer made elsewhere does not count yet, and staff can still set TEN by hand without an offer | 🟡 |
| DEF | **Signed** offer / contract must be attached; the change is **always manual** (human evaluation) | Uploading the signed copy moves it to DEF **automatically**; by hand, DEF is allowed without a signed copy (flagged "No signed copy") | ⚠️ |
| CXL | Manual; **any** status can be cancelled | Manual with a reason, from every status except Lost | 🟡 |
| LOS | Lost reason from the list required; each reason has a **SPECIFY** text; once a reason is added, the change is automatic | Lost needs a reason from the list; there is no "specify" text yet | 🟡 |
| ACT / PAID | Not in this comment | Built at the last go-ahead: ACT = part paid, PAID = fully paid, automatic from payments | ⚠️ |

To do:
- **TEN:** also from an uploaded offer; no manual TEN without an offer.
- **DEF:** manual only, and only once a signed copy is attached; uploading no longer changes the status.
- **CXL:** from Lost too.
- **LOS:** a SPECIFY text box with the reason; choosing a reason moves the contract to LOS.

**17. STATUS HISTORY: every contract keeps Date | Status | User abbreviation (FTM …), to follow conversion speed, the lead's life span and how many people worked on it.** ✅🟡
> Today:
> - Every status change is stored with date, from → to, who, and on whose behalf.
> - The History tab shows the person's name and Employee ID.
> - Automatic changes are marked.
>
> To do: show the user abbreviation (FTM) and put the history in a compact Date | Status | User table. Optional: days in each status, the total life span and the number of people involved, shown on the contract.

---

### Already done from earlier comments (for reference)
- ✅ Excel-like filters on every column, column chooser, personal saved views, pivot with totals: comment 8.
- ✅ ENQ default, automatic TEN when an offer is issued, status history with date and user: comment 8.
- ✅ The greeting moved out of the page into the top bar: comment 7 (now to be shortened, item 3).

## Questions

1. **Status rules:** comment 16 says DEF is **always manual** and doesn't list ACT / PAID. Should we:
   - (a) make DEF manual-only (signed copy required), keeping **ACT / PAID automatic from payments**, as agreed last time; or
   - (b) drop ACT / PAID and go back to ENQ / TEN / DEF / CXL / LOS only?
2. **KPIs:** what does "Per Company | Per Branch | Per Employee" mean, three selectors or breakdowns? And should the conversion rate ignore the STATUS filter, as recommended?
3. **PAYMENT filter box:** which values (fully paid / part paid / not paid / to collect)?
4. **Removed columns:** the list after "Remove these columns from the current display:" is missing. Which columns?
5. **Login:** what should replace "Your company is not on XSELL ERP yet?" (another sentence, or remove the sign-up link)? And is the product name **XSELL ERP** (shown on login and in the browser tab instead of SaaSERP)?
6. **Date filter picture:** please send the picture referred to in comment 13.
7. **Header:** freeze the header row as well as the first column (recommended)?

## Answers found in `SALES_Daily Report.xlsx` (2026-10-24)

The user pointed to the workbook (sheets CONTRACTS, SYSTEM, PAR) for the answers.

1. **Statuses:**
   - **Status list:** the PAR sheet's STATUS list is **ENQ, TEN, DEF, CXL, LOS**, and the data uses only these (SYSTEM: 77 LOS, 65 TEN, 3 DEF, 3 CXL). There is **no ACT or PAID status**.
   - **Payment:** this is a separate **PAYMENT STATUS** list: **PAID** ("Fully Paid"), **DP** ("Downpayment"), **INVOICED**, **TO INVOICE !**, **TO PAY !!!**, **REJECTED !!**, **CANCELED**.
   - **Answer:** option (b). The status goes back to ENQ / TEN / DEF / CXL / LOS, with the STATUS CONDITIONS from comment 16:

     | Status | Rule |
     |---|---|
     | ENQ | the default |
     | TEN | automatic once an offer is printed or attached |
     | DEF | manual only, with a signed copy attached |
     | CXL | manual, from any status |
     | LOS | automatic when a lost reason (with "specify") is chosen |

     Today's ACT / PAID contracts go back to DEF.
   - **Payment status:** shown separately. DP / PAID follow the money received automatically.
2. **KPIs:**
   - The SYSTEM sheet's top row is the KPI row:
     - **TOTAL** = count of contracts (A1);
     - **DEF** = count of DEF (B1);
     - **conversion** = DEF ÷ TOTAL (C1 = B1/A1);
     - **CASH TO COLLECT** = money received − contract value, for DEF (column S);
     - **CLIENT OUTSTAND.** for DEF.
   - The money totals use SUBTOTAL, which follows the filters.
   - **Answer:** the KPIs follow whatever is filtered, including the CO / BRANCH / AM boxes ("Per Company | Per Branch | Per Employee"). The conversion rate is DEF ÷ TOTAL of the filtered list, as in the Excel.
3. **PAYMENT filter box:** the PAYMENT STATUS list above (PAID, DP, INVOICED, TO INVOICE !, TO PAY !!!, REJECTED !!, CANCELED). DP and PAID come from the money received; the rest are set by Finance.
4. **Columns to remove:** the SYSTEM sheet **hides** these columns:
   - money: REV, COST, GROSS MARGIN, P %, FIX COST, CF COST, NET PROFIT;
   - payouts: COMM % / COMM to PAY / STATUS / PAID DT, SHARE % / to PAY / STATUS / PAID DT, SHARE #1 % / to PAY / NAME / PAID DT;
   - FULLY PAID Y | M | D, CLIENT OUTSTAND., AGING DAYS, and the helper columns.

   **Default columns shown:**
   - CONTRACT ID, CO, BRANCH, STATUS, event Y | M | D, HOTEL LOC, HALL AREA, PAX UNITS, RATE PP | PU, TERM DAYS RN;
   - TOTAL CONTRACT VALUE, MONEY RECEIVED DP, CASH TO COLLECT;
   - SOURCE, AM, DETAILS, ENQUIRY DATE Y | M | D, LAST FOLLOWUP Y | M | D, FOLLOWUP CLIENT FEEDBACK;
   - client: COUNTRY NATIONALITY, ALIAS | INSTA ID, first / family name, phone, email, address;
   - meetings.

   Comment 14 refines this: DETAILS combines nationality, name, phone and the description; there is no LOST REASON; there is a NEXT MEETING but no meeting history.
5. **Login and product name:**
   - The customer's task list (`ERP_TODO.xlsx`) calls the product **X-SELL ERP**.
   - **Still open:** the sentence that replaces "Your company is not on X-SELL ERP yet?".
6. **Date filter picture:** **still open**. The workbook keeps dates as separate **Y | M | D** number columns (event, enquiry, last follow-up, fully paid, meetings), which confirms the Y | M | D cells with numeric months.
7. **Freezing:** both sheets freeze the **two header rows and the first 9 columns** (CONTRACT ID to HALL AREA). **Answer:** freeze the header, and the first columns up to STATUS (all 9 if the screen is wide enough).

**Still to confirm:** the login sentence (5), the date picture (6), and the go-ahead to build.

## Built (2026-10-24)

| # | Comment | Done |
|---|---|---|
| 1 | Language button | One box with the current language (EN / AR); a click switches. Same on the login page |
| 2 | Logo frame | Same thin line as the menu box |
| 3 | Greeting | "First name - company" / "employee ID · dd/mm/yyyy" |
| 4 | Search, EXPORT | Search box next to **EXPORT** (exports the list or the pivot on screen). The full-year workbook sits in the small ▾ menu |
| 5 | Folding filters | **FILTERS** folds away (remembered per person) and shows how many filters are active; chips stay visible. Boxes are the same size, with the Excel codes |
| 6, 14 | Excel names, default columns | CONTRACT ID, CO, BRANCH, STATUS, EVENT Y\|M\|D, HOTEL LOC, HALL AREA, PAX UNITS, RATE PP\|PU, TERM DAYS RN, TOTAL CONTRACT VALUE, MONEY RECEIVED DP, CASH TO COLLECT, PAYMENT, SOURCE, AM, DETAILS, ENQUIRY DATE, LAST FOLLOWUP, FOLLOWUP CLIENT FEEDBACK, NEXT MEETING (details below the table) |
| 7 | Heading | CONTRACTS, without the sentence |
| 8 | KPI strip | TOTAL · DEF + conversion DEF÷TOTAL · PAYMENT TOTAL \| PAID \| TO COLLECT (signed contracts) · ENQ · TEN · LOS, following every filter (CO / BRANCH / AM …) |
| 9 | Active filters | Boxes framed in the highlight colour (pink for CONF-X) |
| 10 | Filter boxes | CO \| BRANCH \| STATUS \| PERIOD from-to \| LOC \| PAYMENT \| ENQ DT from-to \| AM \| SOURCE |
| 11 | Follow-ups | Partly: see below |
| 12 | Quick filters | UPCOMING EVENTS \| MEETINGS \| FOLLOWUP (from-to) on the first filter line |
| 13 | Date filters | FROM / TO as **Y \| M \| D** cells with numeric months, plus a calendar button; dates in the list show as 2026-12-13. With no date chosen, the list shows everything in registration order, opened at the latest contracts; "Show … earlier" loads older ones |
| 15 | Removed filters | "Follow-up due" and "Signed contract missing" are gone (dashboard links still work as chips) |
| 16 | Status conditions | ENQ / TEN / DEF / CXL / LOS as in the workbook; ACT / PAID removed (migration 015 moves them to DEF), payment shown as **PAYMENT** (DP / PAID automatic; Finance sets INVOICED …) |
| 17 | Status history | Date \| Status \| User code \| days in status, plus the lead's life span and number of people |
| 18 | Removed columns | The SYSTEM sheet's hidden columns are not standard any more (still available under Columns) |
| 19 | Freezing | The header row and the CONTRACT ID column stay in place while scrolling |
| 20 | Login | Capitals, "BUSINESS MANAGEMENT SYSTEM \| CONF-X GROUP" (changeable with `VITE_LOGIN_TAGLINE`), "NEW TO X-SELL ERP?" |

Rows 6 and 14 in detail:
- **DETAILS column:** nationality - client name (CLIENT when missing) - phone, then the description on a second line.
- **Other columns:** REV, COST, margin, profit, outstanding, aging, lost reason, nationality, client, phone, email … can still be added under **Columns**.
- **Saved layouts:** layouts from before reset once to the new standard.

Details of row 16:
- **TEN:** automatic once an offer is printed or attached (new file kind "Offer sent to the client"); refused without one.
- **DEF:** only by hand, and only with the signed copy attached.
- **CXL:** from any status.
- **LOS:** a lost reason from the list is required, plus a **Specify** text.
- **New contracts:** always start as ENQ.

**Comment 11, partly done:**
- **Done:** LAST FOLLOWUP (the latest follow-up registered, planned or done) and its text show in the list, and every follow-up stays in the contract (activities and history).
- **Not yet:** stopping follow-up reminders once a contract is DEF / LOS / CXL.

**Checks:**
- **API tests 76/76:** tests now reach TEN / DEF by attaching an offer and a signed copy, and a new status-conditions test was added.
- **Browser:** checked the filter boxes, pink frame, KPIs, Y|M|D period and status buttons.
