-- Languages, personal appearance, company branding, and an in-database description of
-- every object (read by scripts/db-docs.ts to generate docs/DATABASE.md).

ALTER TABLE tenants
  ADD COLUMN default_locale text NOT NULL DEFAULT 'en',
  ADD COLUMN branding jsonb NOT NULL DEFAULT '{}';
ALTER TABLE users ADD COLUMN preferences jsonb NOT NULL DEFAULT '{}';
ALTER TABLE lookups ADD COLUMN translations jsonb NOT NULL DEFAULT '{}';

-- Arabic labels for the default pick-lists created at sign-up.
UPDATE lookups l SET translations = jsonb_build_object('ar', v.ar)
FROM (VALUES
  ('event_type', 'W', 'زفاف'), ('event_type', 'C', 'شركات ومؤتمرات'), ('event_type', 'E', 'مناسبة / عيد ميلاد / استقبال منزلي'),
  ('event_type', 'D', 'عشاء / طعام وشراب'), ('event_type', 'G', 'تخرج'), ('event_type', 'R', 'تأجير'), ('event_type', 'F', 'ورود'),
  ('event_type', 'T', 'خيام'), ('event_type', 'B', 'أجنحة معارض'), ('event_type', 'O', 'أخرى'),
  ('source', 'INSTA', 'إنستغرام'), ('source', 'SNAPCHAT', 'سناب شات'), ('source', 'TIKTOK', 'تيك توك'), ('source', 'YOUTUBE', 'يوتيوب'),
  ('source', 'WEBSITE', 'الموقع الإلكتروني'), ('source', 'CALL', 'اتصال هاتفي'), ('source', 'REFERRAL', 'توصية'),
  ('source', 'HOTEL', 'فندق شريك'), ('source', 'MINISTRY', 'وزارة / جهة حكومية'), ('source', 'ASSOC', 'جمعية'),
  ('source', 'JAMEYA', 'جمعية تعاونية'), ('source', 'OTHER', 'أخرى'),
  ('lost_reason', 'FOLLOWUP', 'ضعف المتابعة'), ('lost_reason', 'NO_ANSWER', 'العميل لا يرد'), ('lost_reason', 'BUDGET', 'الميزانية منخفضة'),
  ('lost_reason', 'PRICE', 'السعر مرتفع'), ('lost_reason', 'COMPETITOR', 'حجز مع مورد آخر'), ('lost_reason', 'SHOPPING', 'يسأل عن الأسعار فقط'),
  ('lost_reason', 'EVENT_CANCELLED', 'ألغى العميل المناسبة'), ('lost_reason', 'EVENT_DONE', 'المناسبة انتهت'), ('lost_reason', 'LATE', 'تأخر عرضنا'),
  ('lost_reason', 'NOT_INTERESTED', 'العميل غير مهتم'), ('lost_reason', 'FAKE', 'استفسار وهمي'), ('lost_reason', 'OTHER', 'أخرى'),
  ('payment_method', 'BANK', 'تحويل بنكي'), ('payment_method', 'CASH', 'نقداً'), ('payment_method', 'KNET', 'كي نت / بطاقة'), ('payment_method', 'CHEQUE', 'شيك'),
  ('setup_style', 'BANQUET', 'مأدبة (طاولات دائرية)'), ('setup_style', 'BUFFET', 'بوفيه'), ('setup_style', 'THEATRE', 'مسرح'),
  ('setup_style', 'CLASSROOM', 'فصل دراسي'), ('setup_style', 'U_SHAPE', 'حرف U'), ('setup_style', 'BOARDROOM', 'اجتماعات'),
  ('setup_style', 'RECEPTION', 'استقبال وقوف'), ('setup_style', 'CABARET', 'كباريه'),
  ('item_category', 'F&B', 'طعام وشراب'), ('item_category', 'DECOR', 'ديكور وورود'), ('item_category', 'RENTAL', 'تأجير قاعة / معدات'),
  ('item_category', 'AV', 'صوت وإضاءة وإنتاج'), ('item_category', 'MANPOWER', 'عمالة'), ('item_category', 'LOGISTICS', 'خدمات لوجستية'),
  ('item_category', 'OTHER', 'أخرى')
) AS v(type, code, ar)
WHERE l.type = v.type AND l.code = v.code AND l.translations = '{}';

-- ---------------------------------------------------------------------------
-- Documentation: tables
-- ---------------------------------------------------------------------------
COMMENT ON TABLE tenants IS 'A customer company (workspace). Every business row belongs to exactly one tenant; row-level security keeps tenants apart.';
COMMENT ON TABLE users IS 'People in a workspace: login users and account managers without a login. Holds role, reporting line (manager_id) and data scope.';
COMMENT ON TABLE business_units IS 'Brands or companies inside a workspace (the CO column of the daily report). The code prefixes booking numbers, e.g. W2026001.';
COMMENT ON TABLE booking_sequences IS 'Last booking number used per business unit and year; incremented atomically when a booking is created.';
COMMENT ON TABLE lookups IS 'Configurable pick-lists (the PAR sheet): event types, lead sources, lost reasons, payment methods, bank accounts, setup styles, line categories, business types.';
COMMENT ON TABLE venues IS 'Properties and locations where events take place (hotels, halls, client homes).';
COMMENT ON TABLE function_spaces IS 'Bookable rooms inside a venue. Exclusive rooms are protected against double-booking; shareable ones (allow_overlap) are not.';
COMMENT ON TABLE accounts IS 'Client companies (corporate, agency, government).';
COMMENT ON TABLE contacts IS 'Client people. A booking points at a contact; contacts are shared across the whole workspace.';
COMMENT ON TABLE bookings IS 'The sales record (one row of the CONTRACTS sheet): enquiry to actualised event, with status, client, venue, dates, owner and manual financial figures.';
COMMENT ON TABLE booking_status_history IS 'Every status change of a booking, with reason, who made it and on whose behalf.';
COMMENT ON TABLE booking_events IS 'Functions inside a booking placed on the function diary: room, start and end, setup and guest numbers.';
COMMENT ON TABLE booking_items IS 'Priced revenue / cost lines of a booking (F&B, decor, AV, manpower...). When present they drive revenue and cost.';
COMMENT ON TABLE activities IS 'Meetings, calls, follow-ups, site visits and tasks; usually linked to a booking.';
COMMENT ON TABLE payments IS 'Money received from the client against a booking.';
COMMENT ON TABLE booking_payouts IS 'Commission (to the account manager) and partner shares of a booking, as a percentage; amounts are computed by booking_payout_amounts.';
COMMENT ON TABLE booking_log IS 'Audit trail of changes to a booking (fields, events, lines, payments, follow-ups, transfers) with actor and on-behalf-of.';
COMMENT ON TABLE delegations IS 'Cover arrangements: a delegate may see (and optionally act on) a delegator''s records between two dates.';
COMMENT ON TABLE notifications IS 'In-app notifications shown under the bell (cover set-up, transfers...).';
COMMENT ON TABLE platform_admins IS 'Operators of the SaaS platform who approve and manage workspaces. Not tenant data.';
COMMENT ON TABLE schema_migrations IS 'Migrations already applied by scripts/migrate.ts.';

-- ---------------------------------------------------------------------------
-- Documentation: columns
-- ---------------------------------------------------------------------------
COMMENT ON COLUMN tenants.id IS 'Primary key.';
COMMENT ON COLUMN tenants.slug IS 'Workspace ID typed at sign-in when an email belongs to several workspaces. Unique.';
COMMENT ON COLUMN tenants.name IS 'Company name.';
COMMENT ON COLUMN tenants.plan IS 'Subscription plan: trial, starter, pro or enterprise.';
COMMENT ON COLUMN tenants.max_users IS 'How many active login users the plan allows.';
COMMENT ON COLUMN tenants.currency IS 'ISO currency for all amounts (KWD has 3 decimals).';
COMMENT ON COLUMN tenants.timezone IS 'IANA time zone; dates, diaries and "today" follow it.';
COMMENT ON COLUMN tenants.fixed_cost_pct IS 'Fixed overhead charged as a share of gross margin (default 0.20).';
COMMENT ON COLUMN tenants.credit_facility_pct IS 'Credit-facility cost charged as a share of gross margin on credit-facility bookings (default 0.20).';
COMMENT ON COLUMN tenants.status IS 'pending (awaiting operator approval), active, rejected or suspended.';
COMMENT ON COLUMN tenants.status_reason IS 'Reason given by the operator for rejecting or suspending; shown to the customer.';
COMMENT ON COLUMN tenants.reviewed_at IS 'When the operator last changed the status.';
COMMENT ON COLUMN tenants.reviewed_by IS 'Email of the operator who last changed the status.';
COMMENT ON COLUMN tenants.contact_phone IS 'Phone given at sign-up.';
COMMENT ON COLUMN tenants.signup_note IS '"Tell us about your business" text from the sign-up form.';
COMMENT ON COLUMN tenants.default_locale IS 'Language for users who have not chosen one (en, ar...).';
COMMENT ON COLUMN tenants.branding IS 'Company look: {"accent": "#hex"} used as everyone''s default accent colour.';
COMMENT ON COLUMN tenants.created_at IS 'Created.';
COMMENT ON COLUMN tenants.updated_at IS 'Last changed (trigger).';

COMMENT ON COLUMN users.id IS 'Primary key.';
COMMENT ON COLUMN users.tenant_id IS 'Workspace.';
COMMENT ON COLUMN users.email IS 'Login email; unique per workspace. Empty for account managers without a login.';
COMMENT ON COLUMN users.name IS 'Display name.';
COMMENT ON COLUMN users.code IS 'Initials used in reports (the AM column, e.g. JOU); unique per workspace.';
COMMENT ON COLUMN users.role IS 'owner, admin, manager, sales, finance or viewer; decides what actions are allowed.';
COMMENT ON COLUMN users.password_hash IS 'scrypt hash; never exported.';
COMMENT ON COLUMN users.is_active IS 'False = cannot sign in (left, or account manager without a login).';
COMMENT ON COLUMN users.last_login_at IS 'Last successful sign-in.';
COMMENT ON COLUMN users.manager_id IS 'Who this person reports to; builds the hierarchy used for team visibility.';
COMMENT ON COLUMN users.data_scope IS 'all = sees the whole workspace; team = own records plus everyone below them.';
COMMENT ON COLUMN users.preferences IS 'Personal settings: {"locale","theme","accent","density","fontScale"}.';
COMMENT ON COLUMN users.created_at IS 'Created.';
COMMENT ON COLUMN users.updated_at IS 'Last changed (trigger).';

COMMENT ON COLUMN business_units.code IS 'Booking-number prefix, unique per workspace.';
COMMENT ON COLUMN business_units.name IS 'Brand or company name.';
COMMENT ON COLUMN business_units.is_active IS 'Inactive units are hidden for new bookings.';
COMMENT ON COLUMN booking_sequences.year IS 'Event year the numbers belong to.';
COMMENT ON COLUMN booking_sequences.last_value IS 'Last sequence number issued.';

COMMENT ON COLUMN lookups.type IS 'Which pick-list: event_type, source, lost_reason, payment_method, bank_account, setup_style, item_category, business_type.';
COMMENT ON COLUMN lookups.code IS 'Stored value (unique per list), e.g. W or INSTA.';
COMMENT ON COLUMN lookups.label IS 'Display text in the workspace default language.';
COMMENT ON COLUMN lookups.translations IS 'Labels in other languages: {"ar": "..."}.';
COMMENT ON COLUMN lookups.sort_order IS 'Display order.';
COMMENT ON COLUMN lookups.is_active IS 'Hidden from new choices when false; old records keep the value.';

COMMENT ON COLUMN venues.kind IS 'hotel, hall, client_location, own or other.';
COMMENT ON COLUMN function_spaces.capacity IS 'Maximum guests.';
COMMENT ON COLUMN function_spaces.area_sqm IS 'Floor area in square metres.';
COMMENT ON COLUMN function_spaces.allow_overlap IS 'True for shareable spaces (e.g. client homes): no double-booking check.';

COMMENT ON COLUMN accounts.kind IS 'company, agency, government or individual.';
COMMENT ON COLUMN accounts.business_type IS 'Lookup code from business_type.';
COMMENT ON COLUMN accounts.owner_id IS 'Account manager responsible for the company.';
COMMENT ON COLUMN contacts.account_id IS 'Company the person belongs to, if any.';
COMMENT ON COLUMN contacts.social_handle IS 'Instagram or other social ID (the INSTA ID column).';
COMMENT ON COLUMN contacts.nationality IS 'Country / nationality.';

COMMENT ON COLUMN bookings.booking_no IS 'Human number: business-unit code + event year + sequence, e.g. W2026001.';
COMMENT ON COLUMN bookings.name IS 'Short description of the booking.';
COMMENT ON COLUMN bookings.status IS 'INQ inquiry, TEN tentative, DEF definite, ACT actualised, LOS lost, CXL cancelled.';
COMMENT ON COLUMN bookings.event_type IS 'Lookup code from event_type.';
COMMENT ON COLUMN bookings.source IS 'Lookup code from source (lead channel).';
COMMENT ON COLUMN bookings.owner_id IS 'Account manager who owns the booking; drives team visibility and commission.';
COMMENT ON COLUMN bookings.venue_id IS 'Main venue.';
COMMENT ON COLUMN bookings.function_space_id IS 'Main room.';
COMMENT ON COLUMN bookings.hall_text IS 'Free-text hall from the workbook when no room record exists.';
COMMENT ON COLUMN bookings.event_date IS 'Main event date; the period basis of reports.';
COMMENT ON COLUMN bookings.pax IS 'Guests or units.';
COMMENT ON COLUMN bookings.rate IS 'Rate per guest or unit.';
COMMENT ON COLUMN bookings.term_days IS 'Term days / room nights.';
COMMENT ON COLUMN bookings.inquiry_date IS 'When the enquiry arrived.';
COMMENT ON COLUMN bookings.decision_due_date IS 'When the client should decide.';
COMMENT ON COLUMN bookings.last_followup_date IS 'Last completed follow-up (kept in sync with activities).';
COMMENT ON COLUMN bookings.next_followup_date IS 'Next open follow-up (kept in sync with activities).';
COMMENT ON COLUMN bookings.lost_reason IS 'Required when status is LOS.';
COMMENT ON COLUMN bookings.cancel_reason IS 'Required when status is CXL.';
COMMENT ON COLUMN bookings.manual_revenue IS 'Revenue used when the booking has no priced lines.';
COMMENT ON COLUMN bookings.manual_cost IS 'Cost used when the booking has no priced lines.';
COMMENT ON COLUMN bookings.contract_value IS 'Agreed total with the client; what the client owes.';
COMMENT ON COLUMN bookings.credit_facility IS 'True = credit-facility cost applies.';
COMMENT ON COLUMN bookings.fully_paid_date IS 'Set automatically when payments cover the billable amount.';
COMMENT ON COLUMN bookings.created_by IS 'Who entered the booking (they keep visibility of it).';

COMMENT ON COLUMN booking_status_history.on_behalf_of IS 'Set when a delegate made the change while covering for the owner.';
COMMENT ON COLUMN booking_events.setup_style IS 'Lookup code from setup_style.';
COMMENT ON COLUMN booking_events.expected_pax IS 'Expected guests.';
COMMENT ON COLUMN booking_events.guaranteed_pax IS 'Guaranteed (billable) guests.';
COMMENT ON COLUMN booking_items.category IS 'Lookup code from item_category.';
COMMENT ON COLUMN booking_items.unit_price IS 'Selling price per unit.';
COMMENT ON COLUMN booking_items.unit_cost IS 'Cost per unit.';
COMMENT ON COLUMN activities.type IS 'meeting, call, followup, site_visit, email or task.';
COMMENT ON COLUMN activities.due_at IS 'When it is due.';
COMMENT ON COLUMN activities.outcome IS 'Result / client feedback recorded on completion.';
COMMENT ON COLUMN activities.completed_by IS 'Who completed it.';
COMMENT ON COLUMN activities.completed_on_behalf_of IS 'Whose follow-up it was, when completed by someone covering.';
COMMENT ON COLUMN payments.method IS 'Lookup code from payment_method.';
COMMENT ON COLUMN payments.bank_account IS 'Lookup code from bank_account.';
COMMENT ON COLUMN booking_payouts.kind IS 'commission (share of net profit) or share (share of what remains after commission).';
COMMENT ON COLUMN booking_payouts.pct IS 'Percentage as a fraction (0.10 = 10%).';
COMMENT ON COLUMN booking_payouts.status IS 'pending or paid.';
COMMENT ON COLUMN booking_log.action IS 'What happened, e.g. updated, event added, payment recorded, transferred.';
COMMENT ON COLUMN booking_log.details IS 'JSON details: changed fields, amounts, names.';
COMMENT ON COLUMN booking_log.on_behalf_of IS 'Set when the actor was covering for the booking owner.';
COMMENT ON COLUMN delegations.delegator_id IS 'Whose records are covered.';
COMMENT ON COLUMN delegations.delegate_id IS 'Who covers.';
COMMENT ON COLUMN delegations.ends_on IS 'Last day of cover; empty = until ended.';
COMMENT ON COLUMN delegations.access IS 'view (read only) or act (may change records; never money).';
COMMENT ON COLUMN delegations.include_team IS 'Also covers everyone who reports to the delegator.';
COMMENT ON COLUMN delegations.handover_activities IS 'The delegator''s open follow-ups appear in the delegate''s list.';
COMMENT ON COLUMN delegations.revoked_at IS 'Set when cover was ended early.';
COMMENT ON COLUMN notifications.link IS 'Screen to open from the notification.';
COMMENT ON COLUMN notifications.read_at IS 'When the user opened it.';

-- ---------------------------------------------------------------------------
-- Documentation: views and functions
-- ---------------------------------------------------------------------------
COMMENT ON VIEW booking_finance IS 'Per-booking profit model of the daily report: revenue, cost, gross margin, fixed cost, credit-facility cost, net profit, commission, shares, paid, outstanding and aging days. security_invoker, so row-level security applies.';
COMMENT ON VIEW booking_payout_amounts IS 'booking_payouts with the computed amount of each commission or share.';

COMMENT ON FUNCTION current_tenant_id() IS 'The tenant of the current transaction (app.tenant_id), used by every tenant-isolation policy.';
COMMENT ON FUNCTION touch_updated_at() IS 'Trigger function that sets updated_at on update.';
COMMENT ON FUNCTION app_sees_all() IS 'True when the signed-in user sees the whole workspace (owner, admin, or data_scope = all).';
COMMENT ON FUNCTION app_user_id() IS 'The signed-in user (app.user_id).';
COMMENT ON FUNCTION app_team_ids() IS 'Users whose records the signed-in user may READ: own team plus active cover.';
COMMENT ON FUNCTION app_write_ids() IS 'Users whose records the signed-in user may CHANGE: own team plus "view & act" cover.';
COMMENT ON FUNCTION app_can_see(uuid, uuid) IS 'Read rule for a record with this owner and creator.';
COMMENT ON FUNCTION app_can_write(uuid, uuid) IS 'Write rule for a record with this owner and creator.';
COMMENT ON FUNCTION app_booking_writable(uuid) IS 'Whether the signed-in user may change this booking (used by policies on child tables).';
COMMENT ON FUNCTION auth_find_users(citext) IS 'Login lookup across workspaces by email (SECURITY DEFINER); returns hash and workspace status.';
COMMENT ON FUNCTION auth_slug_taken(citext) IS 'Whether a workspace ID is already used (SECURITY DEFINER).';
COMMENT ON FUNCTION booking_conflicts(uuid, uuid, timestamptz, timestamptz, text[]) IS 'Room clashes for a booking or a proposed event, checked across the whole workspace (SECURITY DEFINER); reports whether each clash is visible to the caller.';
COMMENT ON FUNCTION diary_events(date, date, boolean, uuid) IS 'Function-diary events in a date window across the whole workspace, with clash flags and visibility (SECURITY DEFINER).';
COMMENT ON FUNCTION platform_tenants() IS 'Operator console list of all workspaces with owner and usage (SECURITY DEFINER).';
COMMENT ON FUNCTION platform_update_tenant(uuid, text, text, text, integer, citext) IS 'Operator action: change a workspace status, plan or user limit (SECURITY DEFINER).';
