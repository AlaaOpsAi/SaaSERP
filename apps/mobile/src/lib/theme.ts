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

export function useColors(): Colors {
  return useColorScheme() === 'dark' ? dark : light;
}

/** Status dots use the fixed status palette, always paired with a text label. */
export const STATUS_COLOR: Record<Status, string> = {
  INQ: '#898781', TEN: '#fab219', DEF: '#0ca30c', ACT: '#2a78d6', LOS: '#d03b3b', CXL: '#ec835a',
};
