# Team hierarchy and record visibility

## Set-up (Settings → Team)

- **Reports to:** each user can have a manager. Chains can be any depth, for example:

  ```
  Owner                       sees the whole company
  └─ Melinda   Sales manager  sees Melinda + Lojain + Joumana
     └─ Lojain   Team lead    sees Lojain + Joumana
        └─ Joumana  Account manager   sees Joumana only
  └─ Ahmad     Sales manager  sees Ahmad + Ghada
     └─ Ghada    Account manager      sees Ghada only
  Faisal  Finance             sees the whole company
  ```

- **Can see:**
  - **Their team:** their own records plus records owned by anyone below them, at every level.
  - **Whole company:** everything.
  - Owners and admins always see the whole company.
  - New users default by role: owner, admin and finance see the whole company; manager, sales and viewer see their team.
  - Users who existed before this feature keep seeing the whole company until you change them.
- The **org chart** view draws the tree. The list view shows each person's manager and scope.
- Loops are refused: someone can't report to themselves or to a person below them.
- Merging duplicate users moves the duplicate's direct reports to the user you keep.

## What is restricted

| Data | Rule |
|---|---|
| Bookings | visible if owned by someone in your team, or created by you |
| Events, revenue lines, payments, commissions, status history | follow their booking |
| Activities | follow their booking; stand-alone ones follow their owner |
| Dashboard, receivables, payouts, Excel export | computed only from the bookings you can see |
| Clients (contacts and companies), venues, rooms, pick-lists | shared by the whole company |
| Function diary | every occupied room is shown, but other teams' bookings appear as anonymous "Booked" blocks |
| Room clash checks | always company-wide, so another team's booking still blocks the room; the clash message hides its details |

Team-scoped users can only assign bookings to themselves or to someone below them.

## How it is enforced

- Each request loads the signed-in user's scope and team. The team is the user plus everyone below them, found by walking `users.manager_id`.
- It stores these for the transaction (`app.see_all`, `app.user_id`, `app.team_ids`).
- **Restrictive** row-level-security policies (migration `003_team_hierarchy.sql`) require both the tenant match and team visibility on every query. A missed filter in application code therefore cannot leak another team's records.
- Clash detection and the diary use `SECURITY DEFINER` functions (`booking_conflicts`, `diary_events`). They read the whole workspace and return only whether each row is visible; the API hides details of the rows that aren't.
