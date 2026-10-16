import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { authed, can, hiddenFields, requireRole, tx } from '../auth.js';
import type { Db } from '../db.js';
import { BUILTIN, checkTemplate, docNoFor, fillTemplate, PLACEHOLDERS, readBuiltin, templateData, toPdf, type DocKind } from '../lib/docgen.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { redactBooking } from '../lib/fields.js';
import { logChange, writable } from '../lib/guard.js';
import { cleanName, fileLink, MIME, openLink, readStored, removeStored, saveFile, sniff } from '../lib/storage.js';

/**
 * Contract documents (customer comment 5):
 *  - upload the client's signed contract (JPEG, PNG or PDF) at any status; DEF without one is flagged
 *  - issue a contract or proposal (TEN or DEF) and its annexes from the company's Word templates,
 *    one set per business type and language, filled with the contract's data
 *  - the services & prices of the contract and the annex details (e.g. Wedding Specifications)
 */
const id = z.object({ id: z.string().uuid() });
const kind = z.enum(['contract', 'proposal', 'annex']);
const fileKind = z.enum(['signed_contract', 'signed_proposal', 'annex', 'other']);
const uuidList = z.string().optional().transform((s) => (s ? s.split(',').map((x) => x.trim()).filter(Boolean) : []))
  .pipe(z.array(z.string().uuid()));
const MAX_UPLOAD = 15 * 1024 * 1024;

const contractLine = z.object({
  work_type: z.string().trim().min(1, 'Type of work is required'),
  details: z.string().trim().nullish(),
  quantity: z.number().finite().nullish(),
  unit_price: z.number().finite().nullish(),
});
const annexLine = z.object({
  service: z.string().trim().min(1, 'Service is required'),
  service_alt: z.string().trim().nullish(),
  quantity: z.number().finite().nullish(),
  notes: z.string().trim().nullish(),
});
const checklistItem = z.object({ service: z.string().trim().min(1), service_alt: z.string().trim().nullish() });

const templateMeta = z.object({
  name: z.string().trim().min(1, 'Give the template a name').max(120),
  kinds: z.array(kind).min(1, 'Choose what the template is for'),
  business_unit_ids: z.array(z.string().uuid()).default([]),
  language: z.enum(['ar', 'en', 'bilingual']),
  is_active: z.boolean().optional(),
});

/** Issued documents of a contract, with whether the client's signed copy is in. */
export async function documentsOf(db: Db, bookingId: string) {
  return (await db.query(
    `SELECT d.id, d.kind, d.doc_no, d.language, d.issued_at, d.pdf_key IS NOT NULL AS has_pdf,
            u.name AS issued_by_name, t.name AS template_name, s.signed_at
     FROM documents d
     LEFT JOIN users u ON u.id = d.issued_by
     LEFT JOIN document_templates t ON t.id = d.template_id
     LEFT JOIN LATERAL (SELECT min(f.uploaded_at) AS signed_at FROM booking_files f
                        WHERE f.document_id = d.id AND f.kind IN ('signed_contract', 'signed_proposal')) s ON true
     WHERE d.booking_id = $1 ORDER BY d.issued_at DESC`, [bookingId])).rows;
}

export async function filesOf(db: Db, bookingId: string) {
  return (await db.query(
    `SELECT f.id, f.kind, f.file_name, f.mime, f.size_bytes, f.uploaded_at, f.uploaded_by, f.document_id,
            u.name AS uploaded_by_name, d.doc_no
     FROM booking_files f LEFT JOIN users u ON u.id = f.uploaded_by LEFT JOIN documents d ON d.id = f.document_id
     WHERE f.booking_id = $1 ORDER BY f.uploaded_at DESC`, [bookingId])).rows;
}

/** The one file of a multipart upload, size-checked. */
async function uploaded(req: FastifyRequest) {
  const file = await req.file({ limits: { fileSize: MAX_UPLOAD } });
  if (!file) throw badRequest('Choose a file to upload');
  const data = await file.toBuffer();
  if (file.file.truncated) throw badRequest('The file is larger than 15 MB');
  if (!data.length) throw badRequest('The file is empty');
  return { name: file.filename, data };
}

/** Templates that fit a contract: its business type (or all types), for the given kind. */
async function templatesFor(db: Db, bookingId: string | null, k: DocKind) {
  const unit = bookingId ? (await db.query('SELECT business_unit_id FROM bookings WHERE id = $1', [bookingId])).rows[0]?.business_unit_id : null;
  if (bookingId && unit === undefined) throw notFound('Booking');
  const own = (await db.query(
    `SELECT id, name, language, kinds, business_unit_ids FROM document_templates
     WHERE is_active AND $1 = ANY(kinds) AND ($2::uuid IS NULL OR cardinality(business_unit_ids) = 0 OR $2 = ANY(business_unit_ids))
     ORDER BY cardinality(business_unit_ids) = 0, name`, [k, unit ?? null])).rows;
  // The standard template is offered only while the company has none of its own for this.
  return own.length ? own : [{ id: 'builtin', name: BUILTIN[k].name, language: BUILTIN[k].language, kinds: [k], business_unit_ids: [] }];
}

export async function documentRoutes(app: FastifyInstance) {
  const sell = { preHandler: requireRole(can.sell) };
  const managers = { preHandler: requireRole(can.manage) };
  const admins = { preHandler: requireRole(can.admin) };

  // A signed link: no login header, valid for a few minutes (browser tab, phone app).
  app.get('/files', async (req, reply) => {
    const link = openLink(z.object({ t: z.string().max(4000) }).parse(req.query).t);
    let data: Buffer;
    try { data = await readStored(link.k); } catch { throw notFound('File'); }
    const encoded = encodeURIComponent(link.n);
    return reply
      .header('content-type', link.m)
      .header('content-disposition', `${link.d ? 'attachment' : 'inline'}; filename="${link.n.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encoded}`)
      .header('cache-control', 'private, no-store')
      .header('x-content-type-options', 'nosniff')
      .send(data);
  });

  // ---- services & prices, annex details -------------------------------------

  app.put('/bookings/:id/contract-lines', sell, (req) =>
    tx(req, async (db) => {
      const bookingId = id.parse(req.params).id;
      const { lines } = z.object({ lines: z.array(contractLine).max(200) }).parse(req.body);
      if (hiddenFields(req).includes('contract_value')) throw forbidden('Prices are hidden for your role; ask a manager to change the services');
      const ctx = await writable(db, req, bookingId);
      await db.query('DELETE FROM contract_lines WHERE booking_id = $1', [bookingId]);
      for (const [n, l] of lines.entries()) {
        await db.query(
          `INSERT INTO contract_lines (tenant_id, booking_id, sort_order, work_type, details, quantity, unit_price)
           VALUES (current_tenant_id(), $1, $2, $3, $4, $5, $6)`,
          [bookingId, n, l.work_type, l.details ?? null, l.quantity ?? null, l.unit_price ?? null]);
      }
      await logChange(db, req, ctx, 'services changed', { lines: lines.length });
      return (await db.query('SELECT * FROM contract_lines WHERE booking_id = $1 ORDER BY sort_order', [bookingId])).rows;
    }),
  );

  app.put('/bookings/:id/annex-lines', sell, (req) =>
    tx(req, async (db) => {
      const bookingId = id.parse(req.params).id;
      const { lines } = z.object({ lines: z.array(annexLine).max(300) }).parse(req.body);
      const ctx = await writable(db, req, bookingId);
      await db.query('DELETE FROM annex_lines WHERE booking_id = $1', [bookingId]);
      for (const [n, l] of lines.entries()) {
        await db.query(
          `INSERT INTO annex_lines (tenant_id, booking_id, sort_order, service, service_alt, quantity, notes)
           VALUES (current_tenant_id(), $1, $2, $3, $4, $5, $6)`,
          [bookingId, n, l.service, l.service_alt ?? null, l.quantity ?? null, l.notes ?? null]);
      }
      await logChange(db, req, ctx, 'annex changed', { lines: lines.length });
      return (await db.query('SELECT * FROM annex_lines WHERE booking_id = $1 ORDER BY sort_order', [bookingId])).rows;
    }),
  );

  // Standard annex services per business type (null = every type).
  app.get('/annex-checklists', { preHandler: authed }, (req) =>
    tx(req, async (db) => (await db.query('SELECT business_unit_id, items, updated_at FROM annex_checklists')).rows),
  );
  app.put('/annex-checklists', managers, (req) =>
    tx(req, async (db) => {
      const body = z.object({ business_unit_id: z.string().uuid().nullable(), items: z.array(checklistItem).max(300) }).parse(req.body);
      await db.query(
        `DELETE FROM annex_checklists WHERE business_unit_id IS NOT DISTINCT FROM $1`, [body.business_unit_id]);
      await db.query(
        `INSERT INTO annex_checklists (tenant_id, business_unit_id, items) VALUES (current_tenant_id(), $1, $2)`,
        [body.business_unit_id, JSON.stringify(body.items)]);
      return { ok: true };
    }),
  );

  // ---- templates (Admin → Templates) ----------------------------------------

  app.get('/templates', { preHandler: authed }, (req) =>
    tx(req, async (db) => ({
      templates: (await db.query(
        `SELECT t.id, t.name, t.kinds, t.business_unit_ids, t.language, t.file_name, t.size_bytes, t.is_active, t.updated_at,
                u.name AS created_by_name
         FROM document_templates t LEFT JOIN users u ON u.id = t.created_by ORDER BY t.name`)).rows,
      placeholders: PLACEHOLDERS,
    })),
  );

  app.post('/templates', admins, async (req) => {
    const q = z.object({ name: z.string(), kinds: z.string(), business_unit_ids: z.string().optional(), language: z.string() }).parse(req.query);
    const meta = templateMeta.parse({ ...q, kinds: q.kinds.split(','), business_unit_ids: uuidList.parse(q.business_unit_ids) });
    const file = await uploaded(req);
    if (sniff(file.data) !== 'docx' || !file.name.toLowerCase().endsWith('.docx')) throw badRequest('Upload a Word .docx file');
    checkTemplate(file.data);
    return tx(req, async (db) => {
      const key = await saveFile(req.user.tid, file.data, 'docx');
      return (await db.query(
        `INSERT INTO document_templates (tenant_id, name, kinds, business_unit_ids, language, file_name, storage_key, size_bytes, created_by)
         VALUES (current_tenant_id(), $1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [meta.name, meta.kinds, meta.business_unit_ids, meta.language, cleanName(file.name, 'template.docx'), key, file.data.length, req.user.sub])).rows[0];
    });
  });

  app.patch('/templates/:id', admins, (req) =>
    tx(req, async (db) => {
      const tid = id.parse(req.params).id;
      const body = templateMeta.partial().parse(req.body);
      const sets: string[] = [];
      const vals: unknown[] = [];
      for (const [k, v] of Object.entries(body)) if (v !== undefined) { vals.push(v); sets.push(`${k} = $${vals.length}`); }
      if (!sets.length) throw badRequest('Nothing to change');
      vals.push(tid);
      const { rows } = await db.query(
        `UPDATE document_templates SET ${sets.join(', ')}, updated_at = now() WHERE id = $${vals.length} RETURNING *`, vals);
      if (!rows[0]) throw notFound('Template');
      return rows[0];
    }),
  );

  // Replace the Word file (after editing it); documents already issued keep their own copy.
  app.post('/templates/:id/file', admins, async (req) => {
    const tid = id.parse(req.params).id;
    const file = await uploaded(req);
    if (sniff(file.data) !== 'docx' || !file.name.toLowerCase().endsWith('.docx')) throw badRequest('Upload a Word .docx file');
    checkTemplate(file.data);
    return tx(req, async (db) => {
      const old = (await db.query('SELECT storage_key FROM document_templates WHERE id = $1', [tid])).rows[0];
      if (!old) throw notFound('Template');
      const key = await saveFile(req.user.tid, file.data, 'docx');
      const { rows } = await db.query(
        `UPDATE document_templates SET storage_key = $2, file_name = $3, size_bytes = $4, updated_at = now() WHERE id = $1 RETURNING *`,
        [tid, key, cleanName(file.name, 'template.docx'), file.data.length]);
      await removeStored(old.storage_key);
      return rows[0];
    });
  });

  app.delete('/templates/:id', admins, (req) =>
    tx(req, async (db) => {
      const { rows } = await db.query('DELETE FROM document_templates WHERE id = $1 RETURNING storage_key', [id.parse(req.params).id]);
      if (!rows[0]) throw notFound('Template');
      await removeStored(rows[0].storage_key);
      return { ok: true };
    }),
  );

  // Download a template to edit it in Word.
  app.get('/templates/:id/link', admins, (req) =>
    tx(req, async (db) => {
      const t = (await db.query('SELECT storage_key, file_name FROM document_templates WHERE id = $1', [id.parse(req.params).id])).rows[0];
      if (!t) throw notFound('Template');
      return { url: fileLink(t.storage_key, t.file_name, MIME.docx, { download: true }) };
    }),
  );
  // The standard templates, as a starting point for the company's own.
  app.get('/templates/standard/:kind', admins, async (req, reply) => {
    const k = z.object({ kind: z.enum(['contract', 'annex']) }).parse(req.params).kind;
    return reply.header('content-type', MIME.docx)
      .header('content-disposition', `attachment; filename="${BUILTIN[k].file}"`)
      .send(await readBuiltin(k));
  });

  // ---- issue a contract / proposal / annex ----------------------------------

  app.get('/bookings/:id/templates', { preHandler: authed }, (req) =>
    tx(req, async (db) => {
      const bookingId = id.parse(req.params).id;
      return {
        contract: await templatesFor(db, bookingId, 'contract'),
        proposal: await templatesFor(db, bookingId, 'proposal'),
        annex: await templatesFor(db, bookingId, 'annex'),
      };
    }),
  );

  app.post('/bookings/:id/documents', sell, async (req) => {
    const bookingId = id.parse(req.params).id;
    const body = z.object({
      kind,
      template_id: z.union([z.literal('builtin'), z.string().uuid()]),
      notes: z.string().trim().max(2000).nullish(),
    }).parse(req.body);
    // 1. Fill the template with the contract's data, as the caller may see it.
    const prepared = await tx(req, async (db) => {
      await writable(db, req, bookingId);
      const hidden = hiddenFields(req);
      const { rows: [raw] } = await db.query(
        `SELECT b.*, bu.name AS business_unit_name, u.name AS owner_name,
                c.name AS contact_name, c.phone AS contact_phone, c.email AS contact_email, c.customer_no,
                c.first_name AS contact_first_name, c.family_name AS contact_family_name, c.nationality AS contact_nationality,
                c.address AS contact_address, c.social_handle AS contact_social_handle, c.civil_id AS contact_civil_id,
                a.name AS account_name, v.name AS venue_name, s.name AS space_name, f.paid
         FROM bookings b JOIN business_units bu ON bu.id = b.business_unit_id JOIN booking_finance f ON f.booking_id = b.id
         LEFT JOIN users u ON u.id = b.owner_id LEFT JOIN contacts c ON c.id = b.contact_id LEFT JOIN accounts a ON a.id = b.account_id
         LEFT JOIN venues v ON v.id = b.venue_id LEFT JOIN function_spaces s ON s.id = b.function_space_id
         WHERE b.id = $1`, [bookingId]);
      if (!['TEN', 'DEF'].includes(raw.status)) throw badRequest('Contracts, proposals and annexes are issued from Tentative or Definite contracts');
      const booking = redactBooking(raw, hidden);

      let template: Buffer;
      let templateId: string | null = null;
      let language: string;
      if (body.template_id === 'builtin') {
        const offered = await templatesFor(db, bookingId, body.kind);
        if (offered[0]?.id !== 'builtin') throw badRequest('Choose one of the company templates');
        template = await readBuiltin(body.kind);
        language = BUILTIN[body.kind].language;
      } else {
        const t = (await db.query('SELECT * FROM document_templates WHERE id = $1 AND is_active', [body.template_id])).rows[0];
        if (!t || !t.kinds.includes(body.kind)) throw badRequest('This template is not for this kind of document');
        if (t.business_unit_ids.length && !t.business_unit_ids.includes(raw.business_unit_id)) throw badRequest('This template is for another business type');
        template = await readStored(t.storage_key);
        templateId = t.id;
        language = t.language;
      }
      const q = async (sql: string) => (await db.query(sql, [bookingId])).rows;
      const count = Number((await db.query('SELECT count(*) FROM documents WHERE booking_id = $1 AND kind = $2', [bookingId, body.kind])).rows[0].count);
      const docNo = docNoFor(raw.booking_no, body.kind, count + 1);
      const me = (await db.query('SELECT u.name, t.name AS company FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE u.id = $1', [req.user.sub])).rows[0];
      const data = templateData({
        kind: body.kind, docNo, company: { name: me.company }, booking, issuedBy: me.name, notes: body.notes,
        hidePrices: hidden.includes('contract_value'),
        lines: await q('SELECT * FROM contract_lines WHERE booking_id = $1 ORDER BY sort_order'),
        annex: await q('SELECT * FROM annex_lines WHERE booking_id = $1 ORDER BY sort_order'),
      });
      return { docNo, data, templateId, language, docx: fillTemplate(template, data) };
    });
    // 2. PDF outside the transaction (LibreOffice takes a few seconds).
    const pdf = await toPdf(prepared.docx);
    const docxKey = await saveFile(req.user.tid, prepared.docx, 'docx');
    const pdfKey = pdf ? await saveFile(req.user.tid, pdf, 'pdf') : null;
    // 3. Keep the frozen copy.
    return tx(req, async (db) => {
      const ctx = await writable(db, req, bookingId);
      const { rows: [doc] } = await db.query(
        `INSERT INTO documents (tenant_id, booking_id, template_id, kind, doc_no, language, docx_key, pdf_key, data, issued_by)
         VALUES (current_tenant_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, doc_no, kind`,
        [bookingId, prepared.templateId, body.kind, prepared.docNo, prepared.language, docxKey, pdfKey, JSON.stringify(prepared.data), req.user.sub]);
      await logChange(db, req, ctx, 'document issued', { doc_no: prepared.docNo, kind: body.kind });
      return { ...doc, has_pdf: Boolean(pdfKey) };
    });
  });

  app.get('/documents/:id/link', { preHandler: authed }, (req) =>
    tx(req, async (db) => {
      const docId = id.parse(req.params).id;
      const { format } = z.object({ format: z.enum(['pdf', 'docx']).default('pdf') }).parse(req.query);
      const d = (await db.query('SELECT doc_no, docx_key, pdf_key FROM documents WHERE id = $1', [docId])).rows[0];
      if (!d) throw notFound('Document');
      if (format === 'pdf' && d.pdf_key) return { url: fileLink(d.pdf_key, `${d.doc_no}.pdf`, MIME.pdf) };
      return { url: fileLink(d.docx_key, `${d.doc_no}.docx`, MIME.docx, { download: true }) };
    }),
  );

  // ---- files uploaded to a contract -----------------------------------------

  app.post('/bookings/:id/files', sell, async (req) => {
    const bookingId = id.parse(req.params).id;
    const q = z.object({ kind: fileKind.default('signed_contract'), document_id: z.string().uuid().optional() }).parse(req.query);
    const file = await uploaded(req);
    const type = sniff(file.data);
    if (type !== 'pdf' && type !== 'jpg' && type !== 'png') throw badRequest('Upload a picture (JPEG or PNG) or a PDF');
    return tx(req, async (db) => {
      const ctx = await writable(db, req, bookingId);
      let documentId = q.document_id ?? null;
      const signs = { signed_contract: 'contract', signed_proposal: 'proposal' } as Record<string, string>;
      if (documentId) {
        const d = (await db.query('SELECT kind FROM documents WHERE id = $1 AND booking_id = $2', [documentId, bookingId])).rows[0];
        if (!d) throw badRequest('That document belongs to another contract');
      } else if (signs[q.kind]) {
        // A signed copy belongs to the latest issued document of that kind, if any.
        documentId = (await db.query(
          `SELECT id FROM documents WHERE booking_id = $1 AND kind = $2 ORDER BY issued_at DESC LIMIT 1`, [bookingId, signs[q.kind]])).rows[0]?.id ?? null;
      }
      const key = await saveFile(req.user.tid, file.data, type);
      const name = cleanName(file.name, `upload.${type}`);
      const { rows: [row] } = await db.query(
        `INSERT INTO booking_files (tenant_id, booking_id, kind, document_id, file_name, mime, size_bytes, storage_key, uploaded_by)
         VALUES (current_tenant_id(), $1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, kind, file_name, mime, size_bytes, uploaded_at, document_id`,
        [bookingId, q.kind, documentId, name, MIME[type], file.data.length, key, req.user.sub]);
      await logChange(db, req, ctx, 'file uploaded', { kind: q.kind, file: name });
      return row;
    });
  });

  app.get('/booking-files/:id/link', { preHandler: authed }, (req) =>
    tx(req, async (db) => {
      const f = (await db.query('SELECT storage_key, file_name, mime FROM booking_files WHERE id = $1', [id.parse(req.params).id])).rows[0];
      if (!f) throw notFound('File');
      return { url: fileLink(f.storage_key, f.file_name, f.mime) };
    }),
  );

}
