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

/** Contrast ratio between two colours (WCAG). */
function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
/** Mix a colour towards black (amount < 0) or white (amount > 0). */
function mix(hex: string, amount: number) {
  const target = amount < 0 ? 0 : 255;
  const k = Math.abs(amount);
  return '#' + [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - k) + target * k)
    .toString(16).padStart(2, '0')).join('');
}
/**
 * The accent as text on a background: darker (light theme) or lighter (dark theme) until it
 * reads at 4.5:1, so light brand colours like neon green stay readable as links and labels.
 */
export function readableOn(accent: string, background: string, direction: -1 | 1) {
  for (let k = 0; k <= 1; k += 0.05) {
    const c = mix(accent, direction * k);
    if (contrast(c, background) >= 4.5) return c;
  }
  return direction < 0 ? '#000000' : '#ffffff';
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
    root.style.setProperty('--accent-text-light', readableOn(accent, '#fcfcfb', -1));
    root.style.setProperty('--accent-text-dark', readableOn(accent, '#1a1a19', 1));
    root.dataset.accent = accent;
  } else {
    root.style.removeProperty('--accent');
    root.style.removeProperty('--on-accent');
    root.style.removeProperty('--accent-text-light');
    root.style.removeProperty('--accent-text-dark');
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
