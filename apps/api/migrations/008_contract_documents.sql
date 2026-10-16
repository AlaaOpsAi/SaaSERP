-- Contract documents (customer comment 5):
--  * the agreed services & prices printed in the contract (contract_lines)
--  * the annex details, e.g. Wedding Specifications (annex_lines), with a checklist per business type
--  * Word templates per business type and language (document_templates)
--  * contracts / proposals / annexes issued from the system (documents)
--  * files uploaded to a contract: signed contract, signed proposal, annex, other (booking_files)
-- Files live on disk (UPLOAD_DIR); the database keeps who, when, what and where.

CREATE TABLE contract_lines (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL DEFAULT current_tenant_id() REFERENCES tenants(id) ON DELETE CASCADE,
  booking_id  uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  sort_order  int NOT NULL DEFAULT 0,
  work_type   text NOT NULL,
  details     text,
  quantity    numeric(12,3),
  unit_price  numeric(14,3),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX contract_lines_booking_idx ON contract_lines (booking_id, sort_order);
COMMENT ON TABLE contract_lines IS 'The services and prices agreed with the client, printed in the contract or proposal (نوع العمل / التفاصيل / عدد / السعر). Entered by sales; separate from the revenue & cost lines of Finance.';

CREATE TABLE annex_lines (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL DEFAULT current_tenant_id() REFERENCES tenants(id) ON DELETE CASCADE,
  booking_id  uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  sort_order  int NOT NULL DEFAULT 0,
  service     text NOT NULL,
  service_alt text,
  quantity    numeric(12,3),
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX annex_lines_booking_idx ON annex_lines (booking_id, sort_order);
COMMENT ON TABLE annex_lines IS 'Annex details of a contract (e.g. Wedding Specifications): each service with quantity and notes, for the operations team. The client signs them.';
COMMENT ON COLUMN annex_lines.service_alt IS 'The service name in the second language (Arabic / English).';

CREATE TABLE annex_checklists (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL DEFAULT current_tenant_id() REFERENCES tenants(id) ON DELETE CASCADE,
  business_unit_id uuid REFERENCES business_units(id) ON DELETE CASCADE,
  items            jsonb NOT NULL DEFAULT '[]',
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX annex_checklists_unit_idx ON annex_checklists (tenant_id, coalesce(business_unit_id, '00000000-0000-0000-0000-000000000000'));
COMMENT ON TABLE annex_checklists IS 'Standard annex services per business type ([{service, service_alt}]); sales load them into a contract and fill quantity and notes.';

CREATE TABLE document_templates (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL DEFAULT current_tenant_id() REFERENCES tenants(id) ON DELETE CASCADE,
  name              text NOT NULL,
  kinds             text[] NOT NULL CHECK (kinds <@ ARRAY['contract', 'proposal', 'annex'] AND cardinality(kinds) > 0),
  business_unit_ids uuid[] NOT NULL DEFAULT '{}',
  language          text NOT NULL DEFAULT 'ar' CHECK (language IN ('ar', 'en', 'bilingual')),
  file_name         text NOT NULL,
  storage_key       text NOT NULL,
  size_bytes        int NOT NULL,
  is_active         boolean NOT NULL DEFAULT true,
  created_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE document_templates IS 'Word (.docx) templates with {placeholders}, per business type (business_unit_ids, empty = all) and language. Admin → Templates.';

CREATE TABLE documents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL DEFAULT current_tenant_id() REFERENCES tenants(id) ON DELETE CASCADE,
  booking_id    uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  template_id   uuid REFERENCES document_templates(id) ON DELETE SET NULL,
  kind          text NOT NULL CHECK (kind IN ('contract', 'proposal', 'annex')),
  doc_no        text NOT NULL,
  language      text NOT NULL,
  docx_key      text NOT NULL,
  pdf_key       text,
  data          jsonb NOT NULL,
  issued_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  issued_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, doc_no)
);
CREATE INDEX documents_booking_idx ON documents (booking_id, issued_at);
COMMENT ON TABLE documents IS 'Contracts, proposals and annexes issued from the system: a frozen copy (Word + PDF) of what the client received, numbered W2026052-C1, -P1, -A1.';
COMMENT ON COLUMN documents.data IS 'The values filled into the template at issue time.';

CREATE TABLE booking_files (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL DEFAULT current_tenant_id() REFERENCES tenants(id) ON DELETE CASCADE,
  booking_id        uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  kind              text NOT NULL CHECK (kind IN ('signed_contract', 'signed_proposal', 'annex', 'other')),
  document_id       uuid REFERENCES documents(id) ON DELETE SET NULL,
  file_name         text NOT NULL,
  mime              text NOT NULL CHECK (mime IN ('image/jpeg', 'image/png', 'application/pdf')),
  size_bytes        int NOT NULL,
  storage_key       text NOT NULL,
  uploaded_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at       timestamptz NOT NULL DEFAULT now(),
  deactivated_at    timestamptz,
  deactivated_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  deactivate_reason text
);
CREATE INDEX booking_files_booking_idx ON booking_files (booking_id, uploaded_at);
COMMENT ON TABLE booking_files IS 'Files uploaded to a contract (JPEG, PNG or PDF): the signed contract, a signed proposal, annexes, other. Allowed at every status; a DEF contract without a signed contract is flagged.';
COMMENT ON COLUMN booking_files.document_id IS 'The issued document this signed copy belongs to; a document with a signed copy shows as Signed.';

-- Row-level security: company isolation, team visibility through the contract, and
-- deactivated files hidden like other deactivated records.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['contract_lines', 'annex_lines', 'annex_checklists', 'document_templates', 'documents', 'booking_files'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['contract_lines', 'annex_lines', 'documents', 'booking_files'] LOOP
    EXECUTE format('CREATE POLICY team_read ON %I AS RESTRICTIVE FOR SELECT
                      USING (EXISTS (SELECT 1 FROM bookings b WHERE b.id = booking_id))', t);
    EXECUTE format('CREATE POLICY team_insert ON %I AS RESTRICTIVE FOR INSERT WITH CHECK (app_booking_writable(booking_id))', t);
    EXECUTE format('CREATE POLICY team_update ON %I AS RESTRICTIVE FOR UPDATE
                      USING (app_booking_writable(booking_id)) WITH CHECK (app_booking_writable(booking_id))', t);
    EXECUTE format('CREATE POLICY team_delete ON %I AS RESTRICTIVE FOR DELETE USING (app_booking_writable(booking_id))', t);
  END LOOP;
END $$;

CREATE POLICY hide_deactivated ON booking_files AS RESTRICTIVE FOR SELECT
  USING (deactivated_at IS NULL OR current_setting('app.show_deactivated', true) = 'on');
