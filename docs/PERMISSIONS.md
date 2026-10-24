# Levels, departments and data rights

Every person has three settings under **Admin & IT → Team**:

| Setting | What it's for |
|---|---|
| **Department** | The org chart (Management, Sales, Marketing, Finance, Operations, Partners; editable under Admin & IT → Departments) |
| **Level 1–6** (persona category) | Their default data rights |
| **Personal exceptions** | Override one right for one person, e.g. a junior on probation who may not download |

The levels: 1 Owner & Admin (IT) · 2 Partners · 3 Directors / top management · 4 Mid-managers ·
5 Sales & sales coordinators · 6 Data entry (probation, secretaries, interns).

## Data rights

| Right | What it allows | Default levels |
|---|---|---|
| Export Excel | Contracts, CRM, daily activity report, full workspace export | 1, 2, 3 |
| Download documents & files | Issued contracts / proposals / annexes and uploaded files, as the file | 1, 2, 3, 4 |
| Print documents | Printing from the document viewer | 1, 2, 3, 4 |
| Manage employee records (HR) | Create and edit employee records, documents and requests (HR module) | 1, 2, and anyone in the **HR** department |

- **Rights for a person:** the level's defaults, then the workspace's choices under **Admin & IT → Permissions**, then that person's exceptions.
- **Owners** always have every right, so nobody can lock the workspace out.
- **HR records:** who sees which part of an employee record is in [MODULES-AND-HR.md](MODULES-AND-HR.md).
- **Their own settings:** people can't change their own level or exceptions (owners excepted).
- **Enforcement:** the server checks every right, not just the buttons. Code: `apps/api/src/lib/permissions.ts`.

What people *can see* and *change* (own / team / everything, confirming contracts, finance fields) still follows their
**role**, their **reporting line** and **Contract fields**, as before.

## View without download

People without the download right open documents in the **viewer**. Each page is drawn on the server as an image
with *their name · employee ID · date and time* written diagonally across it, so there is no clean file to save:

- **In the viewer:** no download button; right-click, dragging and Ctrl/⌘+S are off; without the print right, printing produces only a notice.
- **Logging:** every view is logged under Admin & IT → IT ("Viewed a document").
- **Screenshots:** a browser can't block them, or a photo taken with another phone; the watermark shows who took them.
- **Code:** `apps/api/src/routes/viewer.ts` and `src/lib/viewer.ts` (pdf.js and @napi-rs/canvas); web `components/DocumentViewer.tsx`; phone app `src/components/viewer.tsx`.

## Not yet

- Redacting sensitive fields (e.g. contract value shown as •••) per level: waiting for the list of sensitive fields.
