# Comment 10: implementation plan (resumable)

Date: 2026-11-19 · Status: **done** (2026-11-19)

How to resume:
- Each phase is built, checked and **committed on its own**, then ticked here (`[x]`) in the same commit.
- If work stops part-way, continue from the first unticked phase. `git log` shows the last phase done: commits are titled "Comment 10, phase N: …".
- To undo everything, revert to the tag from phase 0.

**Decisions** (answers of 2026-11-19, see [comment-10-recommendations.md](comment-10-recommendations.md)):
- **Columns:** everyone can resize them, remembered on their own device; the admin's saved view sets the starting widths.
- **Totals row:** sits above the columns and shows count + amount sums + PAX, following the search and filters.
- **Date filter:** on its own line under the toolbar.
- **Top bar:** "Melinda · CONF-X".
- **Spacing:** compact by default.
- **Notifications:** tagged CON / HR / ADM.
- **Button:** "NEW CONTRACT" in capitals.

---

- [x] **Phase 0: rollback point**
  - Tag `rollback/2026-11-19-before-comment-10` on the current commit (`7311713` or later) and push the tag.

- [x] **Phase 1: spacing, scrollbar, compact by default** (whole app)
  - `apps/web/src/styles.css`: page edges 12 px left / right, 16 px bottom; cards 10 px; table cells 5 px / 8 px; thin scrollbars (6 px, `scrollbar-width: thin` + `::-webkit-scrollbar`).
  - `apps/web/src/appearance.ts`: compact is the default when a person hasn't chosen; "comfortable" stays in Preferences.
  - Check: Home, Contracts, contract page, HR in the browser.

- [x] **Phase 2: top bar and logo frame**
  - `components/TopBar.tsx`: "First name · company".
  - Logo box: one fixed frame (about 120 × 44 px) for every company. The logo is scaled up or down to fit (`object-fit: contain`); with no logo, the company code shows in the same frame. The logo previews in Admin & IT use the same frame.
  - Check: with a wide logo, a tall logo and no logo.

- [x] **Phase 3: notification module tags**
  - Migration `017_notification_module.sql`: `notifications.module` (`CON` / `HR` / `ADM` / `FIN` / `SYS`). Existing rows get it from their link (`/bookings`, `/clients`, `/activities` → CON; `/hr` → HR; `/settings` → ADM).
  - `apps/api/src/lib/notify.ts`: a `module` argument. Every caller passes its module (13 calls: bookings, activities, delegations, HR, platform, auth, …).
  - Web bell (`components/Bell.tsx`): a short coloured tag before the text, with the full module name on hover.
  - API test: a new notification carries its module.

- [x] **Phase 4: contract page with less empty space**
  - `pages/BookingDetail.tsx` + styles: the field lists (`.kv`) become a grid of 3–4 fields per row (2 on a tablet, 1 on a phone), each with the label above its value. The sections Contract & payment / Follow-up / Client sit side by side on wide screens.
  - The edit form (`components/BookingForm.tsx`) gets the same tighter spacing.

- [x] **Phase 5: contracts toolbar on one line**
  - `pages/Bookings.tsx`: the line reads **CONTRACTS** · **NEW CONTRACT** (capitals) · free search · **EXPORT** · **Columns** (admins) · view list · **Save view** (admins).
  - The FROM / TO date filter moves to its own line under it.
  - Phones: the line wraps.

- [x] **Phase 6: table readability**
  - Separators: a thin vertical line between columns, a stronger line under the header, zebra rows.
  - Headers wrap onto at most 2 lines (cut with "…", full name on hover).
  - Columns start as wide as their values need; cells wrap long text (DETAILS and FEEDBACK start wider; numbers and codes on one line).

- [x] **Phase 7: resizable columns**
  - TanStack column sizing: a drag handle on each header's right edge; double-clicking it fits the column to its longest value.
  - Widths are remembered per person on their device (`localStorage`, keyed by workspace). They are saved into company views when an admin saves one, and those widths are everyone's starting widths.
  - The frozen first column and header still work.

- [x] **Phase 8: totals row on top**
  - A sticky row above the column names: number of contracts under the first column, a sum under every amount column (contract value, received, cash to collect, REV / COST / margin / profit / outstanding when shown), and total PAX.
  - It follows the search, date and column filters. The bottom totals row goes.

- [x] **Phase 9: Excel-like filter button**
  - `components/ContractGrid.tsx`: the header funnel becomes a small square ▾ button; when a filter is on, it shows the "filtered" sign, highlighted.
  - The menu (sort, tick-list, FROM / TO) stays as it is.

- [x] **Phase 10: finish**
  - Arabic labels for new texts; docs (`docs/ARCHITECTURE.md` if needed, `docs/DATABASE.md` via `npm run docs:db`).
  - Discussion record + `npm run discussions`.
  - Full API tests; web and API build; browser check as owner and as a sales user.
  - Push the last commit and give the VPS update command (the update runs migration 017).
