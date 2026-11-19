# Customer comment 10: contracts list, contract page, top bar, notifications

Date: 2026-11-19 · Status: **answered; plan waiting for "build it"**

The app today is at `7311713` (the date filter). The rollback point before that change is `rollback/2026-10-25-before-date-filter`. A new rollback point will be taken before these changes are built.

## Contracts list

**2 and 3, columns hard to tell apart and fixed widths; 8, flexible columns**
- **Separation:** a thin vertical line between columns, a stronger line under the header, and every other row lightly shaded (zebra), so the eye follows a row across.
- **Resizing:** drag the right edge of any column header to resize it; double-click the edge to fit the column to its longest value.
- **Long text:** all cells wrap onto more lines instead of being cut. DETAILS and FOLLOWUP CLIENT FEEDBACK start wider; numbers and codes stay on one line.
- **Who resizes:** everyone can resize for themselves, remembered on their own computer or phone. The widths an admin has when saving a company view become everyone's starting widths.

**6, header at most 2 lines; width from the values**
- **Header:** header text wraps onto at most 2 lines (e.g. "TOTAL CONTRACT / VALUE", "MONEY RECEIVED / DP"), with the full name on hover.
- **Width:** each column starts as wide as its values need (a short code like CO or W stays narrow), not as wide as its header.

**7, totals on top**
- **Totals row:** a row just above the column names, fixed in place with the header while scrolling. It shows the number of contracts in the first column and the sum under every amount column (TOTAL CONTRACT VALUE, MONEY RECEIVED DP, CASH TO COLLECT, and REV / COST / margin / profit / CLIENT OUTSTAND. when shown), plus total PAX.
- **What it follows:** the totals change with the search, the date filter and the column filters.
- **Bottom row:** the totals row at the bottom goes.

**11, filter icon like Excel**
- **Button:** each header gets a small square ▾ button at its right, like Excel's AutoFilter.
- **Active:** when a filter is on, it shows the Excel "filtered" sign (funnel with arrow), highlighted.
- **Menu:** the menu itself stays: sort, tick-list with search, FROM / TO.

**13, one toolbar line, in this order**
- **Order:** **New contract** · free search · **EXPORT** · **Columns** · view list ("Basic columns" / company views) · **Save view**, on the first line above the totals row and the columns. Columns and Save view show for owners and admins only, as today.
- **Heading:** CONTRACTS stays at the start of the same line.
- **Date filter:** the FROM / TO date filter wasn't in the list. Recommended: keep it at the end of the same line (it wraps to the next line on narrow screens).
- **Phones:** the line wraps.

**9, thinner scrollbar** (whole app)
- **Thin:** 6 px, in the border colour, darker on hover.

**10, smaller margins** (whole app)
- **Page edges:** from 28 px to 12 px on the left and right, and from 48 px to 16 px at the bottom.
- **Cards:** inner spacing from 16 px to 10 px.
- **Rows:** cell padding from 10 / 12 px to 5 / 8 px.
- **Default:** the "compact" density in Preferences becomes the default for everyone, and people who like more space can still choose "comfortable".

## Contract page (edit / details)

**1, too much empty space**
- **Layout:** fields go into a grid of **3–4 per row** on a wide screen (2 on a tablet, 1 on a phone), each with the **label above its value**, instead of one long label / value line per field.
- **Groups:**
  - "Contract & payment details", "Follow-up" and "Client" sit side by side on wide screens;
  - the money strip stays a single row;
  - the edit form already uses a grid, and it gets the same tighter spacing.

## Top bar, logo, notifications

**5, name and company separated by "."**
- **Format:** "Melinda · CONF-X". Recommended: a middle dot (·), which reads better than a full stop. Say if you want exactly ".".

**12, logo in a fixed frame**
- **Frame:** the logo box gets one fixed size (about 120 × 44 px) for every company.
- **Logo:** the logo is scaled up or down to fit inside it without stretching.
- **No logo:** the company code shows in the same frame.
- **Other places:** the logo previews in Admin & IT use the same frame.

**4, notifications start with the module**
- **Tag:** each notification starts with a short coloured tag for its module: **CON** (Contracts), **HR**, **ADM** (Admin & IT), **FIN** (Finance, later), **SYS** (workspace / subscription). The full module name shows on hover.
- **Storage:** new notifications store their module. Older ones get it from their link (/bookings → CON, /hr → HR, /settings → ADM).

## Questions
1. **Column widths:** everyone resizes for themselves (remembered on their device), and the admin's saved view sets the starting widths. OK, or admins only?
2. **Totals row:** count + sums of amounts + total PAX. Anything else?
3. **Date filter:** keep the FROM / TO date filter at the end of the toolbar line?
4. **Separator:** "·" (middle dot) or exactly "."?
5. **Compact by default:** make compact the default for everyone, with "comfortable" still available in Preferences?
6. **Module tags:** short tags (CON, HR, ADM) or full names (CONTRACTS, HR, ADMIN)?

## Answers (2026-11-19)
1. Yes: everyone resizes, remembered on their device; the admin's saved view sets the starting widths.
2. Yes, and the totals follow the filters.
3. No: the date filter is not at the end of the toolbar line. Planned: its own line under the toolbar, above the totals row.
4. Yes: "Melinda · CONF-X" (middle dot).
5. Yes: compact is the default.
6. Short tags: CON, HR, ADM.
