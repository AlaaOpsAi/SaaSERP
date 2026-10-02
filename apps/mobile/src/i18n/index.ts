import { I18nManager, Platform } from 'react-native';
import { useSyncExternalStore } from 'react';
import { getItem, setItem } from '../lib/storage';
import ar from './ar';

/*
 * Same approach as the web app: the English text is the key, t('Text {n}', { n }) looks it up
 * in the active language's dictionary and falls back to English. See docs/I18N.md.
 */
export interface Language { code: string; name: string; rtl: boolean; intl: string; dict: Record<string, string> | null }

export const LANGUAGES: Language[] = [
  { code: 'en', name: 'English', rtl: false, intl: 'en-GB', dict: null },
  { code: 'ar', name: 'العربية', rtl: true, intl: 'ar-KW-u-nu-latn', dict: ar },
];

const KEY = 'saaserp.lang';
let current = LANGUAGES[0];
const listeners = new Set<() => void>();

export const lang = () => current;
export const intlLocale = () => current.intl;

function find(code: string | null | undefined) {
  if (!code) return undefined;
  return LANGUAGES.find((l) => l.code === code) ?? LANGUAGES.find((l) => l.code === code.slice(0, 2));
}

export function deviceLanguage() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    return 'en';
  }
}

export async function storedLanguage() {
  return getItem(KEY);
}

/**
 * Switch language. Returns true when the phone must restart the app to flip the
 * layout direction (React Native only applies right-to-left at start-up).
 */
export function setLanguage(code: string | null | undefined): boolean {
  const next = find(code) ?? LANGUAGES[0];
  let restart = false;
  if (Platform.OS === 'web') {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = next.code;
      document.documentElement.dir = next.rtl ? 'rtl' : 'ltr';
    }
  } else if (I18nManager.isRTL !== next.rtl) {
    I18nManager.allowRTL(next.rtl);
    I18nManager.forceRTL(next.rtl);
    restart = true;
  }
  if (next !== current) {
    current = next;
    setItem(KEY, next.code);
    listeners.forEach((l) => l());
  }
  return restart;
}

/** Re-renders the caller when the language changes. */
export function useLanguage() {
  return useSyncExternalStore((cb) => (listeners.add(cb), () => listeners.delete(cb)), () => current);
}

export function t(text: string, vars?: Record<string, string | number>): string {
  let out = current.dict?.[text] ?? text;
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return out;
}

/** Pick-list label in the active language (admins translate them under Settings → Lists). */
export function lookupLabel(l: { label: string; translations?: Record<string, string> | null }) {
  return l.translations?.[current.code] || l.label;
}

/** Mirror arrow-like icons (chevrons) in right-to-left languages. */
export const mirrored = () => (current.rtl ? { transform: [{ scaleX: -1 }] } : undefined);
