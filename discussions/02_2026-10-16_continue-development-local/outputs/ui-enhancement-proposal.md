# UI enhancement proposal — SaaSERP web app

Date: 2026-10-16 · Status: **waiting for approval** · Tools: UI UX Pro Max 2.15.0, 21st.dev Magic MCP

## 1. Where the UI stands today

- React 19 + Vite, **plain CSS** with design tokens on `:root` (`apps/web/src/styles.css`, 623 lines), no Tailwind, no component library.
- Light / dark / device theme, accent colour, density and text size per user; full Arabic RTL.
- Already good: tokens instead of raw colours in most places, visible focus on inputs and buttons,
  `prefers-reduced-motion` respected, SVG icons on the home screen, tabular numbers.

## 2. What UI UX Pro Max recommends

| Topic | Recommendation | Fit |
|---|---|---|
| Style | **Minimalism & Swiss** (enterprise apps, dashboards, SaaS tools) | Matches today's look — refine, don't replace |
| Density | Dashboard density (8–32px spacing scale) | Matches the "density" preference already in the app |
| Colours | Professional blue primary + green for "deal won" | Close to today's `--accent #2a78d6`; add a semantic success token |
| Fonts | Latin: a single clean sans (Inter); Arabic: **Noto Sans Arabic** body, Noto Naskh Arabic optional for headings | Today relies on system fonts — loading them gives the same look on every device |
| Motion | Subtle only, 150–300 ms, reduced-motion respected | Already mostly true |

The first query (event/catering) returned a consumer "vibrant, purple, hero page" direction. It was rejected as wrong for an internal B2B tool; the second query (B2B CRM dashboard) is the one used here.

## 3. Findings to fix (from the UI UX Pro Max checklist)

1. **Text characters used as icons** — `✕`, `⚠`, `✓`, `⚙︎`, `↺` and `🎉` in ~15 places (TopBar, Bell, dialogs, Bookings, Activities, Dashboard, Settings, Platform). Replace with one small SVG icon set (Lucide-style) with `aria-hidden` and labelled buttons.
2. **Touch targets** — `button.sm` is ~26px tall; rule is 44×44 on touch screens. Enlarge hit areas on phones / coarse pointers only, keeping the desktop density.
3. **Base text size** 14px (rule: 16px body on mobile). Raise to 16px under 640px; desktop stays 14px.
4. **Focus ring** on links, chips, menu items and table rows (currently only inputs/buttons/SVG).
5. **Status colours** — some states shown by colour alone (overdue date in red). Pair with an icon or text.
6. **Font loading** — add Inter + Noto Sans Arabic with `font-display: swap`.

## 4. How to use 21st.dev Magic

Every 21st.dev component found (KPI cards, event calendars, booking calendars) is **shadcn + Tailwind**. Two ways forward:

| Option | What it means | Effort / risk |
|---|---|---|
| **A. Reference & port (recommended)** | Use 21st.dev as the design source: pick a component, fetch its code, rewrite it into our CSS tokens and React components. No new framework. | Small–medium; nothing else in the app changes; RTL and themes keep working |
| B. Adopt Tailwind + shadcn | Add Tailwind and shadcn/ui, map our tokens into the Tailwind theme, install 21st.dev components directly, migrate screens gradually. | Large; two styling systems side by side during migration; RTL needs `rtl:` variants everywhere |

Candidate components for option A: *Charts & KPI Cards* (KPI cards that know whether "up" is good, with screen-reader tables) for the Dashboard; *ReUI Event Calendar* as reference for the Function diary; *Insight Cards* for the home-screen summary.
Note: `get_component` (code retrieval) uses the 21st.dev daily quota.

## 5. Proposed order

1. Icon set + replace text icons (finding 1) — quick, visible everywhere.
2. Fonts, mobile text size, touch targets, focus rings (findings 2–4, 6).
3. Dashboard KPI cards refreshed from a 21st.dev reference.
4. Function diary / event calendar refresh from a 21st.dev reference.
5. Save the design system as `design-system/saaserp/MASTER.md` so later sessions follow the same rules.

Each step is checked in the browser in light, dark and Arabic before moving on.
