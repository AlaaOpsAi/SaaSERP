import { useSyncExternalStore } from 'react';
import { useColorScheme } from 'react-native';
import type { Status } from './api';

/* The web app's tokens, for light and dark. */
const light = {
  bg: '#f6f6f3', surface: '#fcfcfb', surface2: '#f0efec', border: 'rgba(11,11,11,0.1)', borderStrong: 'rgba(11,11,11,0.18)',
  text: '#0b0b0b', text2: '#52514e', muted: '#898781', accent: '#2a78d6', accentSoft: '#e6f0fc', onAccent: '#ffffff',
  danger: '#d03b3b', dangerSoft: '#fbe9e9', good: '#006300', brand: '#1f3a5f',
};
const dark: typeof light = {
  bg: '#0d0d0d', surface: '#1a1a19', surface2: '#232322', border: 'rgba(255,255,255,0.1)', borderStrong: 'rgba(255,255,255,0.2)',
  text: '#ffffff', text2: '#c3c2b7', muted: '#898781', accent: '#3987e5', accentSoft: '#1c2a3d', onAccent: '#ffffff',
  danger: '#e66767', dangerSoft: '#3a1d1d', good: '#0ca30c', brand: '#3987e5',
};
export type Colors = typeof light;

/* The user's look (Preferences in the web app, or More → Appearance here), synced through the server. */
export const ACCENTS: { name: string; hex: string }[] = [
  { name: 'Blue', hex: '#2a78d6' }, { name: 'Navy', hex: '#1f3a5f' }, { name: 'Teal', hex: '#0f766e' },
  { name: 'Green', hex: '#15803d' }, { name: 'Purple', hex: '#7c3aed' }, { name: 'Rose', hex: '#be185d' },
  { name: 'Orange', hex: '#c2410c' }, { name: 'Gold', hex: '#a16207' }, { name: 'Slate', hex: '#475569' },
];

interface Look { theme: 'light' | 'dark' | null; accent: string | null }
let look: Look = { theme: null, accent: null };
const listeners = new Set<() => void>();

export function setAppearance(theme: string | null | undefined, accent: string | null | undefined) {
  const next: Look = { theme: theme === 'light' || theme === 'dark' ? theme : null, accent: /^#[0-9a-f]{6}$/i.test(accent ?? '') ? accent! : null };
  if (next.theme === look.theme && next.accent === look.accent) return;
  look = next;
  listeners.forEach((l) => l());
}
const useLook = () => useSyncExternalStore((cb) => (listeners.add(cb), () => listeners.delete(cb)), () => look);

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** Black or white, whichever reads better on the accent. */
export const textOn = (hex: string) => ((luminance(hex) + 0.05) / 0.05 > 1.05 / (luminance(hex) + 0.05) ? '#0b0b0b' : '#ffffff');
function mix(hex: string, bg: string, amount: number) {
  const ch = (h: string, i: number) => parseInt(h.slice(i, i + 2), 16);
  return `#${[1, 3, 5].map((i) => Math.round(ch(hex, i) * amount + ch(bg, i) * (1 - amount)).toString(16).padStart(2, '0')).join('')}`;
}

/** 'light' or 'dark' after the user's choice (or the phone's setting). */
export function useScheme(): 'light' | 'dark' {
  const device = useColorScheme();
  return useLook().theme ?? (device === 'dark' ? 'dark' : 'light');
}

export function useColors(): Colors {
  const scheme = useScheme();
  const { accent } = useLook();
  const base = scheme === 'dark' ? dark : light;
  if (!accent) return base;
  return { ...base, accent, onAccent: textOn(accent), accentSoft: mix(accent, base.surface, scheme === 'dark' ? 0.25 : 0.14), brand: accent };
}

/** Status dots use the fixed status palette, always paired with a text label. */
export const STATUS_COLOR: Record<Status, string> = {
  INQ: '#898781', TEN: '#fab219', DEF: '#0ca30c', ACT: '#2a78d6', LOS: '#d03b3b', CXL: '#ec835a',
};
