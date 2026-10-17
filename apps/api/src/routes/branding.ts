/**
 * Company logos (customer comment 6). Each company (business unit) has a logo for the light
 * theme and one for the dark theme; the group (the workspace) has its own, shown to users
 * without a company. Logos are small images kept in the database as data URLs.
 *
 * The images are served on a public address (an <img> can't send the sign-in header) with a
 * version in the URL, so browsers cache them until the logo changes. Logos aren't secret.
 */
import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireRole, can, tx } from '../auth.js';
import { withTenant } from '../db.js';
import { badRequest, notFound } from '../lib/errors.js';
import { getRow } from '../lib/sql.js';

const MAX_LOGO = 300 * 1024;
const variant = z.enum(['light', 'dark']);
const owner = z.union([z.literal('group'), z.string().uuid()]);

/** The image type from its first bytes; SVG only when it holds no scripts or event handlers. */
function logoType(data: Buffer): string | null {
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (data.subarray(0, 4).toString('latin1') === 'RIFF' && data.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  const text = data.toString('utf8');
  if (/^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(text)) {
    if (/<script|\son[a-z]+\s*=|javascript:|<foreignObject|<iframe|<embed|<object/i.test(text)) return null;
    return 'image/svg+xml';
  }
  return null;
}

const version = (dataUrl: string | null) => (dataUrl ? createHash('md5').update(dataUrl).digest('hex').slice(0, 12) : null);

/** Addresses of the logo a user sees: their company's, or the group's when the company has none. */
export function logoUrls(tenantId: string, row: {
  unit_id: string | null; unit_light: string | null; unit_dark: string | null; group_light: string | null; group_dark: string | null;
}) {
  const own = row.unit_id && (row.unit_light || row.unit_dark);
  const [who, light, dark] = own ? [row.unit_id!, row.unit_light, row.unit_dark] : ['group', row.group_light, row.group_dark];
  // A missing version falls back to the other one, so a single upload already shows in both themes.
  const url = (v: 'light' | 'dark', data: string | null) => (data ? `/api/logos/${tenantId}/${who}/${v}?v=${version(data)}` : null);
  return { light: url('light', light) ?? url('dark', dark), dark: url('dark', dark) ?? url('light', light) };
}

async function uploadedLogo(req: FastifyRequest) {
  const file = await req.file({ limits: { fileSize: MAX_LOGO } });
  if (!file) throw badRequest('Choose a logo file');
  const data = await file.toBuffer();
  if (file.file.truncated) throw badRequest('The logo is larger than 300 kB');
  const type = logoType(data);
  if (!type) throw badRequest('Upload the logo as PNG, JPEG, WebP or SVG');
  return `data:${type};base64,${data.toString('base64')}`;
}

export async function brandingRoutes(app: FastifyInstance) {
  const admin = { preHandler: requireRole(can.admin) };

  // Upload or remove a logo: the group's (owner = "group") or a company's (owner = its id).
  app.put('/logos/:owner/:variant', admin, async (req) => {
    const p = z.object({ owner, variant }).parse(req.params);
    const dataUrl = await uploadedLogo(req);
    return tx(req, async (db) => {
      const column = `logo_${p.variant}`;
      if (p.owner === 'group') await db.query(`UPDATE tenants SET ${column} = $2 WHERE id = $1`, [req.user.tid, dataUrl]);
      else {
        await getRow(db, 'business_units', p.owner, 'Company');
        await db.query(`UPDATE business_units SET ${column} = $2 WHERE id = $1`, [p.owner, dataUrl]);
      }
      return { ok: true };
    });
  });

  app.delete('/logos/:owner/:variant', admin, (req) =>
    tx(req, async (db) => {
      const p = z.object({ owner, variant }).parse(req.params);
      const column = `logo_${p.variant}`;
      if (p.owner === 'group') await db.query(`UPDATE tenants SET ${column} = NULL WHERE id = $1`, [req.user.tid]);
      else await db.query(`UPDATE business_units SET ${column} = NULL WHERE id = $1`, [p.owner]);
      return { ok: true };
    }),
  );

  // Which logos are set, with their addresses (for Admin & IT).
  app.get('/logos', admin, (req) =>
    tx(req, async (db) => {
      const t = (await db.query('SELECT logo_light, logo_dark FROM tenants WHERE id = $1', [req.user.tid])).rows[0];
      const units = (await db.query('SELECT id, logo_light, logo_dark FROM business_units')).rows;
      const urls = (who: string, row: { logo_light: string | null; logo_dark: string | null }) => ({
        light: row.logo_light ? `/api/logos/${req.user.tid}/${who}/light?v=${version(row.logo_light)}` : null,
        dark: row.logo_dark ? `/api/logos/${req.user.tid}/${who}/dark?v=${version(row.logo_dark)}` : null,
      });
      return { group: urls('group', t), units: Object.fromEntries(units.map((u) => [u.id, urls(u.id, u)])) };
    }),
  );

  // The image itself: public, cached for a year (the version in the URL changes with the logo).
  app.get('/logos/:tenantId/:owner/:variant', async (req, reply) => {
    const p = z.object({ tenantId: z.string().uuid(), owner, variant }).parse(req.params);
    const dataUrl = await withTenant(p.tenantId, async (db) => {
      const column = `logo_${p.variant}`;
      const { rows } = p.owner === 'group'
        ? await db.query(`SELECT ${column} AS logo FROM tenants WHERE id = $1`, [p.tenantId])
        : await db.query(`SELECT ${column} AS logo FROM business_units WHERE id = $1`, [p.owner]);
      return rows[0]?.logo as string | null | undefined;
    });
    const m = dataUrl && /^data:([^;]+);base64,(.*)$/s.exec(dataUrl);
    if (!m) throw notFound('Logo');
    return reply
      .header('Content-Type', m[1])
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .header('X-Content-Type-Options', 'nosniff')
      // An SVG opened on its own must never run anything on this site.
      .header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox")
      .send(Buffer.from(m[2], 'base64'));
  });
}
