/**
 * Amounts in words for contracts: English and Arabic, with the currency's
 * main unit and sub-unit (KWD: dinar / fils, 1000 fils to the dinar).
 */
const CURRENCIES: Record<string, { en: [string, string]; ar: [string, string]; sub: { en: string; ar: string }; minor: number }> = {
  KWD: { en: ['Kuwaiti Dinar', 'Kuwaiti Dinars'], ar: ['دينار كويتي', 'دينار كويتي'], sub: { en: 'Fils', ar: 'فلس' }, minor: 1000 },
  SAR: { en: ['Saudi Riyal', 'Saudi Riyals'], ar: ['ريال سعودي', 'ريال سعودي'], sub: { en: 'Halala', ar: 'هللة' }, minor: 100 },
  AED: { en: ['UAE Dirham', 'UAE Dirhams'], ar: ['درهم إماراتي', 'درهم إماراتي'], sub: { en: 'Fils', ar: 'فلس' }, minor: 100 },
  QAR: { en: ['Qatari Riyal', 'Qatari Riyals'], ar: ['ريال قطري', 'ريال قطري'], sub: { en: 'Dirham', ar: 'درهم' }, minor: 100 },
  BHD: { en: ['Bahraini Dinar', 'Bahraini Dinars'], ar: ['دينار بحريني', 'دينار بحريني'], sub: { en: 'Fils', ar: 'فلس' }, minor: 1000 },
  OMR: { en: ['Omani Rial', 'Omani Rials'], ar: ['ريال عماني', 'ريال عماني'], sub: { en: 'Baisa', ar: 'بيسة' }, minor: 1000 },
  USD: { en: ['US Dollar', 'US Dollars'], ar: ['دولار أمريكي', 'دولار أمريكي'], sub: { en: 'Cents', ar: 'سنت' }, minor: 100 },
  EUR: { en: ['Euro', 'Euros'], ar: ['يورو', 'يورو'], sub: { en: 'Cents', ar: 'سنت' }, minor: 100 },
};

const EN_ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen',
  'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function enBelow1000(n: number): string {
  const parts: string[] = [];
  if (n >= 100) { parts.push(`${EN_ONES[Math.floor(n / 100)]} hundred`); n %= 100; }
  if (n >= 20) parts.push(EN_TENS[Math.floor(n / 10)] + (n % 10 ? `-${EN_ONES[n % 10]}` : ''));
  else if (n > 0) parts.push(EN_ONES[n]);
  return parts.join(' and ');
}

export function numberToEnglish(n: number): string {
  if (n === 0) return 'zero';
  const scales = [[1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']] as const;
  const parts: string[] = [];
  for (const [size, name] of scales) {
    if (n >= size) { parts.push(`${enBelow1000(Math.floor(n / size))} ${name}`); n %= size; }
  }
  if (n) parts.push(enBelow1000(n));
  return parts.join(' ');
}

const AR_ONES = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة', 'عشرة',
  'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
const AR_TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
const AR_HUNDREDS = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة'];

function arBelow1000(n: number): string {
  const parts: string[] = [];
  if (n >= 100) { parts.push(AR_HUNDREDS[Math.floor(n / 100)]); n %= 100; }
  if (n >= 20) parts.push(n % 10 ? `${AR_ONES[n % 10]} و${AR_TENS[Math.floor(n / 10)]}` : AR_TENS[Math.floor(n / 10)]);
  else if (n > 0) parts.push(AR_ONES[n]);
  return parts.join(' و');
}

/** Thousands / millions with the Arabic singular, dual and plural forms. */
function arScale(count: number, one: string, two: string, few: string, many: string): string {
  if (count === 1) return one;
  if (count === 2) return two;
  if (count >= 3 && count <= 10) return `${arBelow1000(count)} ${few}`;
  return `${arBelow1000(count)} ${many}`;
}

export function numberToArabic(n: number): string {
  if (n === 0) return 'صفر';
  const parts: string[] = [];
  const scales = [[1e9, 'مليار', 'ملياران', 'مليارات', 'مليار'], [1e6, 'مليون', 'مليونان', 'ملايين', 'مليون'], [1e3, 'ألف', 'ألفان', 'آلاف', 'ألف']] as const;
  for (const [size, one, two, few, many] of scales) {
    if (n >= size) { parts.push(arScale(Math.floor(n / size), one, two, few, many)); n %= size; }
  }
  if (n) parts.push(arBelow1000(n));
  return parts.join(' و');
}

/** e.g. 2370.5 KWD → "Two thousand three hundred and seventy Kuwaiti Dinars and 500 Fils only". */
export function amountInWords(amount: number | null | undefined, currency = 'KWD') {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return { en: '', ar: '' };
  const c = CURRENCIES[currency] ?? { en: [currency, currency], ar: [currency, currency], sub: { en: '', ar: '' }, minor: 100 };
  const abs = Math.abs(amount);
  const whole = Math.floor(abs + 1e-9);
  const minor = Math.round((abs - whole) * c.minor) % c.minor;
  const en = `${numberToEnglish(whole)} ${whole === 1 ? c.en[0] : c.en[1]}${minor ? ` and ${minor} ${c.sub.en}` : ''} only`;
  const ar = `${numberToArabic(whole)} ${c.ar[0]}${minor ? ` و${minor} ${c.sub.ar}` : ''} فقط لا غير`;
  return { en: en.charAt(0).toUpperCase() + en.slice(1), ar };
}
