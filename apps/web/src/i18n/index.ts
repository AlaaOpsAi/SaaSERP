/**
 * Translations. The English text is the key: t('New booking') looks the
 * sentence up in the active language's dictionary and falls back to English.
 *
 * To add a language: create i18n/<code>.ts exporting a Record<string, string>
 * (copy ar.ts), and add it to LANGUAGES below. See docs/I18N.md.
 */
import ar from './ar';

export interface Language {
  code: string;
  /** Name shown in the language picker, in that language. */
  name: string;
  dir: 'ltr' | 'rtl';
  /** Locale for numbers and dates; "-u-nu-latn" keeps Western digits (0-9). */
  intl: string;
  dict: Record<string, string>;
}

export const LANGUAGES: Language[] = [
  { code: 'en', name: 'English', dir: 'ltr', intl: 'en-GB', dict: {} },
  { code: 'ar', name: 'العربية', dir: 'rtl', intl: 'ar-KW-u-nu-latn', dict: ar },
];

let current: Language = LANGUAGES[0];

export const languageOf = (code: string | null | undefined) => LANGUAGES.find((l) => l.code === code) ?? null;

/** Switch language: updates <html lang/dir> so the whole layout mirrors for right-to-left. */
export function setLanguage(code: string | null | undefined) {
  current = languageOf(code) ?? languageOf(code?.slice(0, 2)) ?? LANGUAGES[0];
  if (typeof document !== 'undefined') {
    document.documentElement.lang = current.code;
    document.documentElement.dir = current.dir;
  }
  return current;
}

export const lang = () => current;
export const intlLocale = () => current.intl;

/** Translate an English sentence; {name} placeholders are filled from vars. */
export function t(text: string, vars?: Record<string, string | number | null | undefined>): string {
  let out = current.dict[text] ?? text;
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, String(v ?? ''));
  return out;
}

/** Label of a pick-list value in the active language. */
export function lookupLabel(l: { label: string; translations?: Record<string, string> | null } | undefined | null, fallback = '—') {
  if (!l) return fallback;
  return l.translations?.[current.code] ?? l.label;
}

/** Language chosen before sign-in (login page), remembered on this browser. */
const KEY = 'saaserp.lang';
export function storedLanguage(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
export function storeLanguage(code: string) {
  try {
    localStorage.setItem(KEY, code);
  } catch {
    /* ignore */
  }
}
