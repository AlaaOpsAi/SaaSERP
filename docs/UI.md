# Web UI stack: Tailwind, shadcn and 21st.dev

The web app (`apps/web`) uses **Tailwind CSS v4** and **shadcn/ui** for new components, and installs
ready-made components from **21st.dev**. The app's original stylesheet is kept, so existing screens
look the same while they are moved over one by one.

## How the styles fit together

`src/index.css` is the entry point. Cascade layers decide who wins:

| Layer | Contents | Wins over |
|---|---|---|
| `base` | Tailwind's reset | — |
| `legacy` | `src/styles.css`, the app's own stylesheet (all existing screens) | the reset |
| `components`, `utilities` | shadcn / 21st.dev classes | the app's element styles (`button`, `input` …) |

- **Colours:** shadcn's variable names (`--primary`, `--card`, `--muted-foreground` …) point at the app's tokens
  (`--accent`, `--surface`, `--muted` …), so light / dark, the user's accent colour and the company brand
  colour apply to new components with no extra work.
- **Dark mode:** `dark:` classes follow the app theme (`data-theme="dark"`, or the device when no theme is set).
- **Arabic:** `components.json` has `"rtl": true`, so shadcn writes logical classes (`ms-`, `ps-`, `text-start`).
  Check components copied from 21st.dev for `ml-` / `pl-` / `left-` and change them to the logical form.
- **Size:** Tailwind's `rem` follows the app's text size (14px × the user's text-size setting), so new
  components grow and shrink with that preference.
- Two app tokens share a name with shadcn's: our `--accent` is the **brand colour** and `--muted` is a **text
  colour**. shadcn's versions are `--accent-bg` and `--muted-bg`. Code copied from elsewhere that uses
  `var(--accent)` for a pale hover background must use `var(--accent-bg)` instead.

## Adding components

```bash
npm run ui:add -w apps/web -- button dialog            # shadcn components
npm run ui:add -w apps/web -- "https://21st.dev/r/<author>/<name>?api_key=$API_KEY_21ST"
```

`ui:add` runs `shadcn add` and then fixes a CLI quirk in this monorepo (it imports `cn` from an npm package
instead of `src/lib/utils.ts`). Components land in `src/components/ui/` and are ours to edit.

Without a 21st.dev API key, fetch the code with the 21st.dev Magic MCP (`get_component`) and save it under
`src/components/ui/`.

## Components in use

| Component | Source | Used on |
|---|---|---|
| `button`, `card`, `badge` | shadcn | (ready for new screens) |
| `revenue-charts-kpi` — `KpiCard`, `ChartCard`, `AreaTrend`, `BarCompare`, `DonutBreakdown`, `Sparkline` | 21st.dev `@uvain/revenue-charts-kpi` (Recharts) | Dashboard KPI tiles |
| `number-ticker` — `NumberTicker` | 21st.dev `@danielpetho/basic-number-ticker` (motion), adapted | Dashboard figures count up |
| `skeleton` | shadcn | Loading placeholders (`SkeletonRows`, `SkeletonPage` in `components/ui.tsx`) |

Local changes to `revenue-charts-kpi`: `KpiCard` takes `onClick` (whole card is a button, for drill-down) and a
`footer`; Recharts 3 types; logical spacing for Arabic; bar hover uses `--accent-bg`.

Local changes to `number-ticker`: takes a `format` function (keeps money, %, "60.8k" and Arabic digits),
re-animates from the current value when the figure changes, jumps straight to the value under reduced motion,
and gives screen readers the final text only.

## Header and company identity

- **The header never mirrors** (`dir="ltr"` on `.topbar`): logo + the user's full name on the left, Home · Menu ·
  EN | AR on the right, in every language. The menu always opens from the right. Only the page below switches
  to right-to-left in Arabic.
- **Logo box** (`LogoBox` in `components/TopBar.tsx`): the logo in a box framed by a thin line in the logo's own
  colour (`var(--text)`: black on the light theme, white on the dark theme). Each company uploads a black version
  (light theme) and a white version (dark theme) under Admin & IT → Business units; the group's logo is under
  Admin & IT → Company and shows for users without a company. Until a logo is uploaded, the company code stands in.
- **Highlight colour** follows the user's company (`companyAccent()` in `api.ts`): company colour → workspace brand
  colour → default blue. A personal accent under Preferences still wins.
- **Name card** at the top of the menu: full name, then "JOB TITLE - E2021001". The permission level is shown only
  in Admin & IT → Team.

## Motion

| Where | What moves | How |
|---|---|---|
| Every page | Fades and rises 8px in when the route changes (0.28 s) | `PageTransition` in `components/motion.tsx` |
| Dashboard | Cards appear one after another; figures count up to their value | `enter` + `stagger(i)`; `NumberTicker` |
| Home screen | Icons pop in one after another; springy lift on hover; icons glide to their new place when rearranged | tw-animate-css; motion `layout` |
| Dialogs | Backdrop fades, dialog zooms in slightly | tw-animate-css classes on `Modal` |
| Loading | Pulsing placeholders in the shape of the content | `Skeleton` |

Rules:

- Use `enter` / `stagger()` from `components/motion.tsx` for entrances, and `EASE_OUT` for motion-driven ones,
  so timings stay consistent.
- **Reduced motion is respected everywhere:** `MotionConfig reducedMotion="user"` (main.tsx) for motion, and the
  `prefers-reduced-motion` rule in `styles.css`, which switches off every CSS animation and transition.
- Animate `opacity` and `transform` only, never width / height / top.

## Icons

Icons are [lucide-react](https://lucide.dev). Inline icons use the `ico` class (sized to the text around them);
add `flip` to arrows and chevrons that should point the other way in Arabic. Don't use text characters or emoji
(✕ ⚠ ✓ 🎉) as icons.

## Bundle size

Pages are loaded when first opened (`React.lazy` in `App.tsx`). The first screen downloads 565 kB
(181 kB gzipped); the Dashboard and its charts load separately (320 kB, 97 kB gzipped).

## Notes

- Design guidance comes from the UI UX Pro Max plugin: Minimalism & Swiss style at dashboard density.
