-- Customer comment 9: the status list of the daily report (SALES_Daily Report.xlsx, PAR sheet)
-- is ENQ / TEN / DEF / CXL / LOS. Payment progress is a separate PAYMENT STATUS:
-- DP (down payment) and PAID (fully paid) follow the money received; Finance can also set
-- INVOICED, TO INVOICE, TO PAY, REJECTED or CANCELED.
--   ENQ default · TEN automatic once an offer is printed or attached · DEF by hand, signed copy required
--   CXL by hand, from any status · LOS with a lost reason from the list (+ "specify" text)

INSERT INTO booking_status_history (tenant_id, booking_id, from_status, to_status, reason)
SELECT tenant_id, id, status, 'DEF', 'Statuses follow the daily report: payment is now shown as PAYMENT (DP / PAID)'
FROM bookings WHERE status IN ('ACT', 'PAID');
UPDATE bookings SET status = 'DEF' WHERE status IN ('ACT', 'PAID');

ALTER TABLE bookings DROP CONSTRAINT bookings_status_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_status_check CHECK (status IN ('ENQ', 'TEN', 'DEF', 'LOS', 'CXL'));
COMMENT ON COLUMN bookings.status IS 'ENQ enquiry · TEN offer sent (automatic once an offer is printed or attached) · DEF signed (by hand, signed copy required) · LOS lost · CXL cancelled.';

ALTER TABLE bookings
  ADD COLUMN payment_status text CHECK (payment_status IN ('INVOICED', 'TO INVOICE', 'TO PAY', 'REJECTED', 'CANCELED')),
  ADD COLUMN lost_reason_note text;
COMMENT ON COLUMN bookings.payment_status IS 'PAYMENT STATUS set by Finance. DP and PAID are worked out from the money received.';
COMMENT ON COLUMN bookings.lost_reason_note IS 'The "specify" text that goes with the lost reason.';

-- An offer the client was sent, attached as a file (moves an enquiry to TEN).
ALTER TABLE booking_files DROP CONSTRAINT booking_files_kind_check;
ALTER TABLE booking_files ADD CONSTRAINT booking_files_kind_check CHECK (kind IN ('offer', 'signed_contract', 'signed_proposal', 'annex', 'other'));

CREATE OR REPLACE VIEW booking_finance WITH (security_invoker = true) AS
WITH items AS (
  SELECT booking_id,
         sum(quantity * unit_price) AS revenue,
         sum(quantity * unit_cost)  AS cost,
         count(*)                   AS n
  FROM booking_items GROUP BY booking_id
), paid AS (
  SELECT booking_id, sum(amount) AS paid, max(paid_on) AS last_paid_on
  FROM payments GROUP BY booking_id
), pay AS (
  SELECT booking_id,
         coalesce(sum(pct) FILTER (WHERE kind = 'commission'), 0) AS commission_pct,
         coalesce(sum(pct) FILTER (WHERE kind = 'share'), 0)      AS share_pct
  FROM booking_payouts GROUP BY booking_id
), base AS (
  SELECT b.id AS booking_id, b.tenant_id, b.status, b.event_date, b.fully_paid_date,
         CASE WHEN coalesce(i.n, 0) > 0 THEN i.revenue ELSE coalesce(b.manual_revenue, 0) END AS revenue,
         CASE WHEN coalesce(i.n, 0) > 0 THEN i.cost    ELSE coalesce(b.manual_cost, 0)    END AS cost,
         b.contract_value,
         b.credit_facility,
         t.fixed_cost_pct, t.credit_facility_pct,
         coalesce(p.paid, 0) AS paid,
         p.last_paid_on,
         coalesce(pay.commission_pct, 0) AS commission_pct,
         coalesce(pay.share_pct, 0) AS share_pct
  FROM bookings b
  JOIN tenants t ON t.id = b.tenant_id
  LEFT JOIN items i ON i.booking_id = b.id
  LEFT JOIN paid p  ON p.booking_id = b.id
  LEFT JOIN pay     ON pay.booking_id = b.id
), calc AS (
  SELECT base.*,
         revenue - cost AS gross_margin,
         (revenue - cost) * fixed_cost_pct AS fixed_cost,
         CASE WHEN credit_facility THEN (revenue - cost) * credit_facility_pct ELSE 0 END AS cf_cost,
         coalesce(contract_value, revenue) AS billable
  FROM base
), net AS (
  SELECT calc.*,
         gross_margin - fixed_cost - cf_cost AS net_profit
  FROM calc
)
SELECT booking_id, tenant_id, status,
       round(revenue, 3)                       AS revenue,
       round(cost, 3)                          AS cost,
       round(gross_margin, 3)                  AS gross_margin,
       CASE WHEN revenue = 0 THEN NULL ELSE round(gross_margin / revenue, 4) END AS margin_pct,
       contract_value,
       CASE WHEN contract_value IS NULL THEN NULL ELSE round(revenue - contract_value, 3) END AS diff,
       round(fixed_cost, 3)                    AS fixed_cost,
       round(cf_cost, 3)                       AS cf_cost,
       round(net_profit, 3)                    AS net_profit,
       round(net_profit * commission_pct, 3)   AS commission,
       round((net_profit - net_profit * commission_pct) * share_pct, 3) AS shares,
       round(paid, 3)                          AS paid,
       CASE WHEN status IN ('DEF') THEN round(billable - paid, 3) ELSE 0 END AS outstanding,
       CASE WHEN status NOT IN ('DEF') OR event_date IS NULL THEN 0
            ELSE greatest(0, coalesce(fully_paid_date, current_date) - event_date) END AS aging_days,
       last_paid_on
FROM net;

CREATE OR REPLACE FUNCTION diary_events(p_from date, p_to date, p_include_lost boolean, p_venue uuid)
RETURNS TABLE (id uuid, name text, function_space_id uuid, start_at timestamptz, end_at timestamptz, expected_pax int,
               setup_style text, booking_id uuid, booking_no text, booking_name text, status text, owner_code text,
               overlaps boolean, visible boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH win AS (
    SELECT (p_from::timestamp AT TIME ZONE t.timezone) AS lo, ((p_to + 1)::timestamp AT TIME ZONE t.timezone) AS hi
    FROM tenants t WHERE t.id = current_tenant_id()
  )
  SELECT e.id, e.name, e.function_space_id, e.start_at, e.end_at, e.expected_pax, e.setup_style,
         b.id, b.booking_no, b.name, b.status, u.code,
         EXISTS (
           SELECT 1 FROM booking_events o
           JOIN bookings ob ON ob.id = o.booking_id
           JOIN function_spaces os ON os.id = o.function_space_id AND NOT os.allow_overlap
           WHERE o.function_space_id = e.function_space_id AND o.id <> e.id AND ob.id <> b.id
             AND ob.status IN ('TEN', 'DEF') AND ob.tenant_id = current_tenant_id()
             AND ob.deactivated_at IS NULL
             AND tstzrange(o.start_at, o.end_at) && tstzrange(e.start_at, e.end_at)
         ),
         app_can_see(b.owner_id, b.created_by)
  FROM booking_events e
  JOIN bookings b ON b.id = e.booking_id
  JOIN function_spaces s ON s.id = e.function_space_id
  LEFT JOIN users u ON u.id = b.owner_id
  CROSS JOIN win
  WHERE e.tenant_id = current_tenant_id()
    AND tstzrange(e.start_at, e.end_at) && tstzrange(win.lo, win.hi)
    AND (p_include_lost OR b.status NOT IN ('LOS', 'CXL'))
    AND (p_venue IS NULL OR s.venue_id = p_venue)
    AND b.deactivated_at IS NULL
  ORDER BY e.start_at
$$;
