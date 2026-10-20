# Customer comment 7 — data security, permission levels, users screen, corners

Date: 2026-10-20 · Status: **waiting for the customer's answers**

## 1. What exists today

| Topic | Today |
|---|---|
| Roles | 7: owner, admin, sales manager, sales, marketing, finance, viewer; plus "sees whole company / their team" and the reporting hierarchy |
| Excel exports | Contracts Excel: anyone signed in. CRM Excel: hidden in the app for non-managers but not blocked on the server. Full workspace export: owners and admins only. Every export is logged (Admin → IT) |
| Documents and attachments | Anyone who can see a contract can open and save its issued documents and uploaded files |
| Finance fields | Hidden per role under Admin & IT → Contract fields (enforced by the server) |
| Employee ID | Automatic (E + year + 3 digits); sign-in with it already works |

## 2. The 6 authority levels — draft for approval

| | 1. Owner & Admin (IT) | 2. Partners | 3. Directors / top management | 4. Mid-managers | 5. Sales & coordinators | 6. Data entry |
|---|---|---|---|---|---|---|
| Records they see | All | All | All | Their team | Own (coordinators: their team) | Own |
| Finance figures (cost, margin, profit) | ✓ | ✓ | ✓ | ✓ | — | — |
| Create / edit contracts and customers | ✓ | view only | ✓ | ✓ | ✓ | ✓ (own, not finance) |
| Confirm (DEF) / cancel / lost | ✓ | — | ✓ | ✓ | ✓ | — |
| Issue contracts and proposals | ✓ | — | ✓ | ✓ | ✓ | — |
| Deactivate records | ✓ | — | ✓ | ✓ | own early-stage | — |
| **Export Excel** | ✓ | ✓ | ✓ | — | — | — |
| **Download documents and attachments** | ✓ | ✓ | ✓ | ✓ | — (view on screen) | — (view on screen) |
| Users, settings, templates | ✓ | — | — | — | — | — |
| Watermark with their name on screen | — | — | — | — | ✓ | ✓ |

- Each cell becomes a tick box under Admin & IT → Permissions, so the table can be changed later without development.
- The server enforces every tick, not just the screen.
- **Finance, Marketing and Viewer** don't fit the 6 levels directly. Proposal: keep them as **departments** (Sales, Marketing, Finance, Operations) on top of the level, e.g. a finance mid-manager = level 4 + Finance.

## 3. View without download — and screenshots

**What can be done reliably**

1. **No file to save.** People without the download right never receive the file. Documents and attachments (PDF, Word, photos) are turned into page images on the server, with their **name, employee ID, date and time burned into every page**, and shown in an in-app viewer. Even technical tricks only give the watermarked images.
2. **In the viewer:** no download button; right-click, drag and Ctrl/⌘+S are switched off; **printing prints only a notice** ("Printing is not allowed"), not the document.
3. **Every view is logged** (who opened which document, when, from which IP) under Admin → IT.
4. **Phone app:** on **Android, screenshots and screen recordings can be blocked completely** (they come out black). On **iPhone** they can't be blocked, but the app can blur the screen during screen recording and log each screenshot.

**What can't be done:** a web browser can't stop the computer's own screenshot keys or a photo taken with another phone. That's why the **watermark** matters.

**Watermark (recommended):** a faint, tiled, diagonal text across the screen — *"Melinda Molnar · E2021001 · 20/10/2026 14:32"*. It's on the document viewer for everyone, and optionally on **every screen** for levels 5 and 6. Any screenshot, print or photo then shows who took it and when. It's light enough to work through, and can't be removed by the user.

## 4. Users screen

- **Totals at the top:** *Active users: 12 · Disabled users: 3* (and seats left on the plan).
- **Employee ID as the user ID:**
  - Today the ID is automatic.
  - Proposal: when registering a user, the admin can **type the Employee ID from HR** (checked for duplicates); left empty, it's generated as today.
  - People sign in with it already.
  - If some staff have **no email**, they can still get a login with Employee ID + password (today a login needs an email).

## 5. Straight or rounded corners

Screenshots of the same screens (light theme) are in this folder:

| | Dashboard | Home |
|---|---|---|
| Today (rounded, 8–10 px) | `corners-1-rounded-current.jpg` | `corners-4-home-rounded-current.jpg` |
| Slightly rounded (3 px) | `corners-2-slight-3px.jpg` | — |
| Square (0 px) | `corners-3-square.jpg` | `corners-5-home-square.jpg` |

**Recommendation: square or slightly rounded (2–3 px).** The CONF-X and DEAL-X logos are built from sharp triangles and straight strokes, so straight corners match the brand better and look more corporate. 2–3 px keeps it straight but slightly softer on screen. Round items (avatars, status dots) stay round. It's one setting for the whole platform, so it's quick to change either way.

## 6. Questions for the customer

1. Is the draft table in section 2 right? Mark any cells to change.
2. Where do **Finance**, **Marketing** and **Viewer** staff fit: as departments on top of a level (recommended), or as extra levels?
3. **Partners**: view only, or can they also edit and confirm contracts?
4. Watermark: on the **document viewer only**, or on **every screen** for levels 5 and 6?
5. Phone app: block screenshots on Android for levels without download? (Recommended.)
6. Employee ID: **typed by the admin from HR** (with automatic as the fallback), or always automatic?
7. Do all staff have an email, or must some sign in with Employee ID only?
8. Corners: **square** or **slightly rounded (2–3 px)**?
