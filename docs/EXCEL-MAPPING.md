# Daily report workbook → SaaSERP

The importer (`apps/api/src/lib/importer.ts`) reads the `CONTRACTS` sheet (headers in row 2, data from
row 3 until a row whose first cell is `end`) and, if present, the `PAR` sheet.

## CONTRACTS

| Column | Header | Goes to |
|---|---|---|
| A | CONTRACT ID | `bookings.booking_no`, used to match on re-import |
| B | CO | business unit (created if missing) |
| C | CAT | event type pick-list |
| D | STATUS | status (DEF/TEN/LOS/CXL; blank → INQ) |
| E–G | Y/M/D | event date |
| H | HALL | function space under the LOC venue for TEN/DEF/ACT bookings; otherwise kept as free text |
| I, J | REV, COST | manual revenue and cost |
| K, L, N, P–R, T, X, AB, AH, AI | margin, P %, diff, fix cost, CF cost, net profit, amounts to pay, outstanding, aging | **calculated** by the `booking_finance` view, not imported |
| M | TOTAL CONTRACT VALUE | contract value |
| O | CREDIT FACILITY | `CF` → credit facility on |
| S, U, V | COMM % / STATUS / PAID DT | commission payout (payee = AM) |
| W, Y, Z | SHARE % / STATUS / PAID DT | partner share payout |
| AA, AC, AD | SHARE #1 % / NAME / PAID DT | second partner share |
| AE–AG | fully paid Y/M/D | fully-paid date, plus one payment for the billable amount |
| AJ | SOURCE | lead-source pick-list |
| AK | AM | account manager (a user by initials; created without a login if new) |
| AL | REQUEST DESCRIPTION & NOTES | description; also part of the booking name |
| AM | LOC | venue (HOME / CLIENT LOC become shareable client locations) |
| AN–AP | PAX, RATE, TERM DAYS | pax, rate, term days |
| AQ–AS | ENQUIRY DATE | enquiry date |
| AT–AV | LAST FOLLOWUP | last follow-up date |
| AW | FOLLOWUP CLIENT FEEDBACK | follow-up notes |
| AX | LOST REASON | lost reason (free text is kept) |
| AY–BD | email, country, address, insta ID, name, phone | contact, matched on phone |
| BE–CH | MEETING #1…#5 (Y, M, D, TIME, LOC, NOTES) | activities of type *meeting* (completed if in the past) |

## PAR

| PAR column | Becomes |
|---|---|
| CO + name | business units |
| CONTRACT TYPE | event types |
| SOURCE | lead sources |
| AM | account managers |
| Business Type | business types (for companies) |
| BANK ACC | bank-account pick-list |
| TYPE (BANK/CASH) | payment methods |
| LOC | venues |

## Header row → dashboard

| Workbook cell | Dashboard KPI |
|---|---|
| A1 count, B1 DEF count, C1 ratio | Bookings, Conversion (DEF ÷ all) |
| H1 / I1 revenue, J1 cost, K1 margin | Definite revenue, Gross margin |
| T1 / V1 commission | Net profit, Finance → Commission & shares |
| AH1 outstanding | Client outstanding (Finance → Receivables with aging buckets) |
