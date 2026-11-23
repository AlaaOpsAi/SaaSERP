# Customer comment 11: home icons, contract table, date filter, Admin & IT

Date: 2026-11-23 · Status: **built (2026-11-23)**

The app today is at `fb04657` (one-line rows). A rollback point will be taken before these changes are built.

| # | Comment | Today | Recommendation |
|---|---|---|---|
| 1 | Home page icon titles in CAPITALS | Normal case ("Contracts", "Event calendar") | All Home icon labels in capitals, also in the menu. Arabic is unaffected (no capitals). |
| 2 | Column header in the **middle** of the column | Left for text, right for numbers | Headers centred over every column. The values keep Excel's alignment: numbers right, text left. |
| 3 | "Basic columns" → **"Default columns"** inside the **Columns** window, plus **Select all** | "Basic columns" / company views in a list on the toolbar | The Columns window gets a **Select all / none** tick at the top and a **Default columns** button (back to the company's standard view) at the bottom. The view list leaves the toolbar; company views can be picked inside the Columns window (see question 1). |
| 4 | The scrollbar is the edge of the data; no space after it, nothing below it | The table ends 16 px above the bottom of the screen (page padding) | The table reaches the very bottom of the screen, its horizontal scrollbar the last thing on the page, with no margin below and no extra space to the side. |
| 5 | Bigger font for the summary (totals) row | 12 px | 14 px, bold; the row a little taller. |
| 6 | Admin & IT → Team opens as a **list**, not the org chart | Opens on the org chart | Opens on the list; the org chart stays one click away. |
| 7 | "All icons inside must be fixed" | — | **Needs clarifying:** see question 2. |
| 8 | Date filter: after choosing FROM it applies at once; we need time to choose TO as well | Each Y / M / D change filters straight away | In the ▾ menu of a date column, FROM and TO are applied only when **OK** is pressed. Closing without OK leaves the filter as it was. |
| 9 | The **Done** button of the date filter: "OK" or an icon | "Done" | **OK** with a ✓ icon, in every column filter menu. |
| 10 | PAX UNITS always on 2 lines | One line when it fits | "PAX" / "UNITS" on 2 lines. |
| 11 | Headers on 2 lines exactly as in the Excel | Lines broken wherever the width runs out | Each header uses the line breaks of the SYSTEM sheet (see the table below); a one-line header in the Excel stays one line. |
| 12 | Date filter years in order: choosing 2028 shows 2027 before it, 2028 highlighted, then 2029 … | Years newest first (2028, 2027, 2026 …) | Years in **ascending** order (oldest at the top), from 2017 to next year + 2. The chosen year is highlighted, with the years before and after it around it. Months 1–12 and days 1–31 are already in order. |

**Headers as in the Excel SYSTEM sheet** (item 11; "/" marks the line break):

| Column | Excel header |
|---|---|
| CONTRACT ID | CONTRACT / ID |
| HOTEL LOC | HOTEL / LOC |
| HALL AREA | HALL / AREA |
| PAX UNITS | PAX / UNITS |
| RATE PP \| PU | RATE / PP \| PU |
| TERM DAYS RN | TERM / DAYS / RN (**3 lines** in the Excel: see question 3) |
| MONEY RECEIVED DP | MONEY RECEIVED / DP |
| FIX COST, CF COST, NET PROFIT, COMM % … | FIX / COST, CF / COST, NET / PROFIT, COMM / % |
| FOLLOWUP CLIENT FEEDBACK | FOLLOWUP / CLIENT FEEDBACK |
| COUNTRY NATIONALITY | COUNTRY / NATIONALITY |
| CO, BRANCH, STATUS, SOURCE, AM, DETAILS, TOTAL CONTRACT VALUE, CASH TO COLLECT, LOST REASON … | one line, as in the Excel |

Headers the app adds (EVENT Y \| M \| D, ENQUIRY DATE, LAST FOLLOWUP, NEXT MEETING, PAYMENT) stay one line.

## Questions
1. **Company views:** with "Default columns" inside the Columns window, should the other saved company views also be picked inside that window (recommended), or keep a view list on the toolbar?
2. **"All icons inside must be fixed":** which icons, and fixed how?
   - (a) The **Home page icons** stay in one fixed order and can't be rearranged.
   - (b) The icons **inside the table**, such as the ▾ filter buttons and the ⚠ sign, keep one fixed size and position.
   - (c) Something else.
3. **TERM DAYS RN** is 3 lines in the Excel: keep 3 lines, or 2 ("TERM DAYS / RN")?

## Answers (2026-11-23)
1. Yes: company views go inside the Columns window, with no view list on the toolbar.
2. Not icons: **company logos bigger** on every page that shows them. The top-bar logo frame becomes 160 × 52 px (fixed frame, logo scaled to fit), and the bar about 58 px tall.
3. TERM DAYS RN on 2 lines: "TERM DAYS / RN".
