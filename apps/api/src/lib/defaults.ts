import type { Db } from '../db.js';

/**
 * Starter pick-lists for a new tenant, taken from the PAR sheet of the
 * reference daily report. Tenants edit them under Settings.
 */
export const DEFAULT_LOOKUPS: Record<string, [code: string, label: string, arabic?: string][]> = {
  event_type: [
    ['W', 'Wedding', 'زفاف'],
    ['C', 'Corporate & Conference', 'شركات ومؤتمرات'],
    ['E', 'Event / Birthday / Home Reception', 'مناسبة / عيد ميلاد / استقبال منزلي'],
    ['D', 'Dinner / F&B', 'عشاء / طعام وشراب'],
    ['G', 'Graduation', 'تخرج'],
    ['R', 'Rent', 'تأجير'],
    ['F', 'Flower', 'ورود'],
    ['T', 'Tent', 'خيام'],
    ['B', 'Booth', 'أجنحة معارض'],
    ['O', 'Other', 'أخرى'],
  ],
  source: [
    ['INSTA', 'Instagram', 'إنستغرام'],
    ['SNAPCHAT', 'Snapchat', 'سناب شات'],
    ['TIKTOK', 'TikTok', 'تيك توك'],
    ['YOUTUBE', 'YouTube', 'يوتيوب'],
    ['WEBSITE', 'Website', 'الموقع الإلكتروني'],
    ['CALL', 'Phone call', 'اتصال هاتفي'],
    ['REFERRAL', 'Referral', 'توصية'],
    ['HOTEL', 'Hotel partner', 'فندق شريك'],
    ['MINISTRY', 'Ministry / Government', 'وزارة / جهة حكومية'],
    ['ASSOC', 'Association', 'جمعية'],
    ['JAMEYA', 'Co-op (Jameya)', 'جمعية تعاونية'],
    ['OTHER', 'Other', 'أخرى'],
  ],
  lost_reason: [
    ['FOLLOWUP', 'Poor follow-up', 'ضعف المتابعة'],
    ['NO_ANSWER', 'Client not answering', 'العميل لا يرد'],
    ['BUDGET', 'Budget too low', 'الميزانية منخفضة'],
    ['PRICE', 'Price too high', 'السعر مرتفع'],
    ['COMPETITOR', 'Booked another supplier', 'حجز مع مورد آخر'],
    ['SHOPPING', 'Only asking about prices / shopping around', 'يسأل عن الأسعار فقط'],
    ['EVENT_CANCELLED', 'Client event cancelled', 'ألغى العميل المناسبة'],
    ['EVENT_DONE', 'Event already done', 'المناسبة انتهت'],
    ['LATE', 'Our offer was late', 'تأخر عرضنا'],
    ['NOT_INTERESTED', 'Client not interested', 'العميل غير مهتم'],
    ['FAKE', 'Fake / spam enquiry', 'استفسار وهمي'],
    ['OTHER', 'Other', 'أخرى'],
  ],
  business_type: [
    ['W', 'Wedding', 'أعراس'],
    ['B', 'Birthday, Baby Shower', 'أعياد ميلاد واستقبال مواليد'],
    ['E', 'Events, Receptions, Dinners with venue', 'مناسبات واستقبالات وعشاء مع قاعة'],
    ['C', 'OSC / Industrial Catering', 'تموين صناعي'],
    ['G', 'Graduation', 'تخرج'],
    ['P', 'Production, Tents, Booths', 'إنتاج وخيام وأجنحة'],
    ['H', 'Hotel Room Booking, Restaurant', 'حجوزات فنادق ومطاعم'],
    ['M', 'Manpower', 'عمالة'],
    ['L', 'Logistics, Corporate Support Services', 'لوجستيات وخدمات مساندة'],
    ['R', 'Real Estate', 'عقارات'],
    ['O', 'Other', 'أخرى'],
  ],
  payment_method: [
    ['BANK', 'Bank transfer', 'تحويل بنكي'],
    ['CASH', 'Cash', 'نقداً'],
    ['KNET', 'KNET / Card', 'كي نت / بطاقة'],
    ['CHEQUE', 'Cheque', 'شيك'],
  ],
  setup_style: [
    ['BANQUET', 'Banquet (rounds)', 'مأدبة (طاولات دائرية)'],
    ['BUFFET', 'Buffet', 'بوفيه'],
    ['THEATRE', 'Theatre', 'مسرح'],
    ['CLASSROOM', 'Classroom', 'فصل دراسي'],
    ['U_SHAPE', 'U-shape', 'حرف U'],
    ['BOARDROOM', 'Boardroom', 'اجتماعات'],
    ['RECEPTION', 'Cocktail / Reception', 'استقبال وقوف'],
    ['CABARET', 'Cabaret', 'كباريه'],
  ],
  item_category: [
    ['F&B', 'Food & Beverage', 'طعام وشراب'],
    ['DECOR', 'Decoration & Flowers', 'ديكور وورود'],
    ['RENTAL', 'Venue / Equipment rental', 'تأجير قاعة / معدات'],
    ['AV', 'Audio-visual & Production', 'صوت وإضاءة وإنتاج'],
    ['MANPOWER', 'Manpower', 'عمالة'],
    ['LOGISTICS', 'Logistics', 'خدمات لوجستية'],
    ['OTHER', 'Other', 'أخرى'],
  ],
};

export async function seedTenantDefaults(db: Db) {
  for (const [type, values] of Object.entries(DEFAULT_LOOKUPS)) {
    for (const [i, [code, label, arabic]] of values.entries()) {
      await db.query(
        `INSERT INTO lookups (tenant_id, type, code, label, sort_order, translations)
         VALUES (current_tenant_id(), $1, $2, $3, $4, $5)
         ON CONFLICT (tenant_id, type, code) DO NOTHING`,
        [type, code, label, i, JSON.stringify(arabic ? { ar: arabic } : {})],
      );
    }
  }
}
