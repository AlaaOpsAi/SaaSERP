# Customer comment 8 — Excel-like contract list, statuses that follow the customer

Date: 2026-10-23 · Status: **item 1 and item 2 built (2026-10-24)**

## 1. Today

- **Contract list:** fixed filters (search, status, year, account manager, source, sort, "follow-up due", "signed contract missing") and fixed columns; up to 200 contracts per page.
- **Statuses:** changed by hand only. Inquiry → Tentative → Definite → Actualised, or Lost / Cancelled (with a reason). Definite and Actualised hold the room on the diary and count as revenue.

## 2. Excel-like filtering and pivot (recommended)

1. **Filter on every column**, like Excel's AutoFilter: a small funnel in each column header opens:
   - a tick-list of the values in that column, with a search box;
   - "from / to" for numbers and dates (pax, contract value, event date …);
   - sort A→Z / Z→A.

   Active filters show as chips above the table, with **Clear all**.
2. **Choose your columns:** show / hide and drag to reorder, from all contract fields (finance columns only for people allowed to see them). The layout is remembered per person.
3. **Saved views:** save a set of filters and columns under a name ("My open enquiries", "December weddings"), for yourself or the whole team.
4. **Pivot view**, like an Excel pivot table:
   - **Rows:** e.g. account manager, month, venue, event type, source, business unit.
   - **Columns (optional):** e.g. status.
   - **Values:** count of contracts, sum of contract value, revenue, margin, money received, outstanding.

   Totals show at the bottom and on the right. Clicking a number opens the contracts behind it. The pivot exports to Excel, for people with the export right.

How: the list loads the whole year's contracts the person may see (thousands are fine), and filtering and pivoting happen instantly in the browser. Built with TanStack Table (free, MIT licence, fits the current design). The server still decides which contracts and fields each person sees.

## 3. Statuses that follow what the customer does

| Code | Meaning | How a contract gets there |
|---|---|---|
| **ENQ** | Enquiry, no offer sent | New contract (today's "INQ", renamed) |
| **TEN** | Offer sent | **Automatically** when a proposal or contract is issued from the app |
| **DEF** | Signed contract / offer | **Automatically** when the client's signed copy is uploaded |
| **PAID** | Fully paid | **Automatically** when payments received reach the contract value; back to DEF if a payment is removed or the value goes up |
| **CXL** | Cancelled | By hand, with a reason |
| **LOS** | Lost | By hand, with a reason |

- Every automatic change is written in the contract's history as "automatic: proposal issued / signed copy uploaded / fully paid".
- DEF and PAID hold the room on the diary and count as revenue on the dashboard.
- Issuing a proposal becomes possible from ENQ, since that is what moves it to TEN; today it needs TEN or DEF.
- Existing contracts: INQ becomes ENQ; fully-paid DEF contracts become PAID.
- The phone app, Excel import / export, reports and Arabic labels follow the new statuses.

## 4. Questions

1. **ACT (Actualised, event done)** isn't in the new list. Drop it, with today's ACT contracts becoming PAID if fully paid or DEF otherwise, or keep it?
2. **DEF:** does a signed **proposal** also make it DEF, or only a signed **contract**?
3. **Manual changes:** besides the automatic moves, may staff still change the status by hand (e.g. the client signed on paper and the copy comes later)? Recommended: yes for managers (levels 1–4), with a note in the history.
4. **PAID:** fully paid means money received ≥ contract value. Confirm, or should it compare with the revenue lines?
5. **Pivot:** are the rows, columns and values listed above the right ones, and are other fields needed?
6. **Saved views:** personal only, or also shared with the team?

## 5. Answers and the final status plan (2026-10-24)

**Item 1: built.**
- Filter on every column; column chooser; personal saved views.
- Pivot: rows / columns / values, totals, click-through, Excel export.

**Item 2: built after the go-ahead (2026-10-24).**

| Code | Meaning | Gets there automatically when … |
|---|---|---|
| **ENQ** | Enquiry, no offer sent | a contract is created (today's INQ, renamed) |
| **TEN** | Offer sent | a proposal or contract is issued from the app (from ENQ) |
| **DEF** | Signed contract / offer | the client's signed contract **or** signed proposal is uploaded (from ENQ or TEN) |
| **ACT** | Actualised: partly paid | money received is more than 0 but less than the contract value |
| **PAID** | Fully paid | money received ≥ contract value (the fully-paid date is filled in) |
| **CXL / LOS** | Cancelled / lost | by hand only, with a reason |

**How it works**
- **Payments:** adding, changing or removing a payment, or changing the contract value, moves a confirmed contract between DEF, ACT and PAID, both ways.
- **Documents:** issuing or uploading a document only moves a contract forward, never back.
- **Manual changes:** these stay, under today's rules for who may change a status. The next automatic event can move the status on again.
- **History:** every automatic move is written as "automatic: proposal issued / signed copy uploaded / part payment / fully paid".
- **Diary and revenue:** DEF, ACT and PAID hold the room on the diary and count as revenue.
- **Existing contracts:**
  - INQ becomes ENQ;
  - today's DEF and ACT contracts are set to DEF, ACT or PAID from the money received.
- **Everywhere else:** the phone app, Excel import / export, reports, the dashboard and the Arabic labels follow the new statuses.
