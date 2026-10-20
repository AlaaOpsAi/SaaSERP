/**
 * The watermarked document viewer (customer comment 7): issued documents and uploaded files
 * shown as page images with the viewer's name, employee ID and the time drawn into them.
 * Everyone who can see a contract can use it; only people with the "download" right also
 * get the file itself (routes/documents.ts).
 *
 *   GET /viewer/:kind/:id    → { title, pages, token, rights }; the view is logged
 *   GET /viewer/page?t=&n=   → page n as a watermarked PNG (token from above, 10 minutes)
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authed, tx } from '../auth.js';
import { config } from '../config.js';
import { type Db, withTenant } from '../db.js';
import { logAccess } from '../lib/access.js';
import { toPdf } from '../lib/docgen.js';
import { badRequest, notFound } from '../lib/errors.js';
import { rightsOf } from '../lib/permissions.js';
import { readStored } from '../lib/storage.js';
import { pageCount, renderPage, type Viewable } from '../lib/viewer.js';

const kind = z.enum(['document', 'file']);
type Kind = z.infer<typeof kind>;
interface Token { u: string; t: string; k: Kind; i: string; e: number }

const sign = (payload: string) => createHmac('sha256', `${config.jwtSecret}:viewer`).update(payload).digest('base64url');

function issue(body: Token) {
  const payload = Buffer.from(JSON.stringify(body)).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function open(token: string): Token {
  const [payload, sig] = token.split('.');
  if (!payload || !sig) throw badRequest('Invalid link');
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw badRequest('Invalid link');
  const body = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Token;
  if (body.e < Date.now()) throw badRequest('This view has expired; open the document again');
  return body;
}

/** The file behind a document or upload, as something the viewer can draw. */
async function source(db: Db, k: Kind, id: string): Promise<{ title: string; src: Viewable }> {
  if (k === 'document') {
    const d = (await db.query('SELECT doc_no, docx_key, pdf_key FROM documents WHERE id = $1', [id])).rows[0];
    if (!d) throw notFound('Document');
    if (d.pdf_key) return { title: d.doc_no, src: { kind: 'pdf', data: await readStored(d.pdf_key) } };
    const pdf = await toPdf(await readStored(d.docx_key));
    if (!pdf) throw badRequest('This document cannot be shown on screen right now. Ask someone who can download it.');
    return { title: d.doc_no, src: { kind: 'pdf', data: pdf } };
  }
  const f = (await db.query('SELECT file_name, mime, storage_key FROM booking_files WHERE id = $1', [id])).rows[0];
  if (!f) throw notFound('File');
  const data = await readStored(f.storage_key);
  return { title: f.file_name, src: { kind: f.mime === 'application/pdf' ? 'pdf' : 'image', data } };
}

/** "Melinda Molnar · E2021001 · 20/10/2026 14:32", in the workspace's time zone. */
async function markFor(db: Db, userId: string) {
  const { rows } = await db.query(
    `SELECT u.name, u.employee_no, t.timezone FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE u.id = $1`, [userId]);
  const u = rows[0];
  const when = new Intl.DateTimeFormat('en-GB', {
    timeZone: u?.timezone ?? 'UTC', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date()).replace(',', '');
  return [u?.name, u?.employee_no, when].filter(Boolean).join(' · ');
}

export async function viewerRoutes(app: FastifyInstance) {
  app.get('/viewer/:kind/:id', { preHandler: authed }, (req) =>
    tx(req, async (db) => {
      const p = z.object({ kind, id: z.string().uuid() }).parse(req.params);
      // Reading it here also checks the contract is visible to this person (row security).
      const { title, src } = await source(db, p.kind, p.id);
      const pages = await pageCount(src);
      await logAccess(db, req.user.sub, 'view_document', title, req.ip);
      const rights = await rightsOf(db, req.user.sub);
      return {
        title, pages,
        token: issue({ u: req.user.sub, t: req.user.tid, k: p.kind, i: p.id, e: Date.now() + 10 * 60_000 }),
        rights: { download: rights.download, print: rights.print },
      };
    }),
  );

  app.get('/viewer/page', async (req, reply) => {
    const q = z.object({ t: z.string().max(2000), n: z.coerce.number().int().min(1).max(500) }).parse(req.query);
    const tok = open(q.t);
    const png = await withTenant(tok.t, async (db) => {
      const { src } = await source(db, tok.k, tok.i);
      return renderPage(src, q.n, await markFor(db, tok.u));
    });
    return reply
      .header('content-type', 'image/png')
      .header('content-disposition', 'inline')
      .header('cache-control', 'private, no-store')
      .header('x-content-type-options', 'nosniff')
      .send(png);
  });
}
