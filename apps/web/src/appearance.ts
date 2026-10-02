/**
 * Personal look & feel: theme, accent colour, density and text size. Applied
 * as attributes / CSS variables on <html>, so every page follows instantly.
 */
export interface Preferences {
  locale?: string;
  theme?: 'system' | 'light' | 'dark';
  accent?: string;
  density?: 'comfortable' | 'compact';
  fontScale?: number;
}

/** Accent presets: all dark enough for white text on buttons. */
export const ACCENTS: { name: string; hex: string }[] = [
  { name: 'Blue', hex: '#2a78d6' }, { name: 'Navy', hex: '#1f3a5f' }, { name: 'Teal', hex: '#0f766e' },
  { name: 'Green', hex: '#15803d' }, { name: 'Purple', hex: '#7c3aed' }, { name: 'Rose', hex: '#be185d' },
  { name: 'Orange', hex: '#c2410c' }, { name: 'Gold', hex: '#a16207' }, { name: 'Slate', hex: '#475569' },
];

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** Black or white, whichever reads better on the accent (WCAG contrast). */
export function textOn(hex: string) {
  const l = luminance(hex);
  return (1.05 / (l + 0.05)) >= ((l + 0.05) / 0.05) ? '#ffffff' : '#0b0b0b';
}

const CACHE = 'saaserp.appearance';

export function applyAppearance(p: Preferences, companyAccent?: string | null) {
  const root = document.documentElement;
  if (p.theme === 'light' || p.theme === 'dark') root.dataset.theme = p.theme;
  else delete root.dataset.theme;

  const accent = p.accent ?? companyAccent ?? null;
  if (accent && /^#[0-9a-fA-F]{6}$/.test(accent)) {
    root.style.setProperty('--accent', accent);
    root.style.setProperty('--on-accent', textOn(accent));
    root.dataset.accent = accent;
  } else {
    root.style.removeProperty('--accent');
    root.style.removeProperty('--on-accent');
    delete root.dataset.accent;
  }
  if (p.density === 'compact') root.dataset.density = 'compact';
  else delete root.dataset.density;
  root.style.setProperty('--font-scale', String(p.fontScale ?? 1));
  try {
    localStorage.setItem(CACHE, JSON.stringify({ p, companyAccent }));
  } catch {
    /* storage unavailable */
  }
}

/** Re-apply the last appearance before the app loads (no flash of the default look). */
export function applyCachedAppearance() {
  try {
    const raw = localStorage.getItem(CACHE);
    if (raw) {
      const { p, companyAccent } = JSON.parse(raw);
      applyAppearance(p ?? {}, companyAccent);
    }
  } catch {
    /* ignore */
  }
}
