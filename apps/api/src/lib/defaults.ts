import type { Db } from '../db.js';

/**
 * Starter pick-lists for a new tenant, taken from the PAR sheet of the
 * reference daily report. Tenants edit them under Settings.
 */
export const DEFAULT_LOOKUPS: Record<string, [code: string, label: string][]> = {
  event_type: [
    ['W', 'Wedding'],
    ['C', 'Corporate & Conference'],
    ['E', 'Event / Birthday / Home Reception'],
    ['D', 'Dinner / F&B'],
    ['G', 'Graduation'],
    ['R', 'Rent'],
    ['F', 'Flower'],
    ['T', 'Tent'],
    ['B', 'Booth'],
    ['O', 'Other'],
  ],
  source: [
    ['INSTA', 'Instagram'],
    ['SNAPCHAT', 'Snapchat'],
    ['TIKTOK', 'TikTok'],
    ['YOUTUBE', 'YouTube'],
    ['WEBSITE', 'Website'],
    ['CALL', 'Phone call'],
    ['REFERRAL', 'Referral'],
    ['HOTEL', 'Hotel partner'],
    ['MINISTRY', 'Ministry / Government'],
    ['ASSOC', 'Association'],
    ['JAMEYA', 'Co-op (Jameya)'],
    ['OTHER', 'Other'],
  ],
  lost_reason: [
    ['FOLLOWUP', 'Poor follow-up'],
    ['NO_ANSWER', 'Client not answering'],
    ['BUDGET', 'Budget too low'],
    ['PRICE', 'Price too high'],
    ['COMPETITOR', 'Booked another supplier'],
    ['SHOPPING', 'Only asking about prices / shopping around'],
    ['EVENT_CANCELLED', 'Client event cancelled'],
    ['EVENT_DONE', 'Event already done'],
    ['LATE', 'Our offer was late'],
    ['NOT_INTERESTED', 'Client not interested'],
    ['FAKE', 'Fake / spam enquiry'],
    ['OTHER', 'Other'],
  ],
  business_type: [
    ['W', 'Wedding'],
    ['B', 'Birthday, Baby Shower'],
    ['E', 'Events, Receptions, Dinners with venue'],
    ['C', 'OSC / Industrial Catering'],
    ['G', 'Graduation'],
    ['P', 'Production, Tents, Booths'],
    ['H', 'Hotel Room Booking, Restaurant'],
    ['M', 'Manpower'],
    ['L', 'Logistics, Corporate Support Services'],
    ['R', 'Real Estate'],
    ['O', 'Other'],
  ],
  payment_method: [
    ['BANK', 'Bank transfer'],
    ['CASH', 'Cash'],
    ['KNET', 'KNET / Card'],
    ['CHEQUE', 'Cheque'],
  ],
  setup_style: [
    ['BANQUET', 'Banquet (rounds)'],
    ['BUFFET', 'Buffet'],
    ['THEATRE', 'Theatre'],
    ['CLASSROOM', 'Classroom'],
    ['U_SHAPE', 'U-shape'],
    ['BOARDROOM', 'Boardroom'],
    ['RECEPTION', 'Cocktail / Reception'],
    ['CABARET', 'Cabaret'],
  ],
  item_category: [
    ['F&B', 'Food & Beverage'],
    ['DECOR', 'Decoration & Flowers'],
    ['RENTAL', 'Venue / Equipment rental'],
    ['AV', 'Audio-visual & Production'],
    ['MANPOWER', 'Manpower'],
    ['LOGISTICS', 'Logistics'],
    ['OTHER', 'Other'],
  ],
};

export async function seedTenantDefaults(db: Db) {
  for (const [type, values] of Object.entries(DEFAULT_LOOKUPS)) {
    for (const [i, [code, label]] of values.entries()) {
      await db.query(
        `INSERT INTO lookups (tenant_id, type, code, label, sort_order)
         VALUES (current_tenant_id(), $1, $2, $3, $4)
         ON CONFLICT (tenant_id, type, code) DO NOTHING`,
        [type, code, label, i],
      );
    }
  }
}
