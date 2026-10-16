import type { FastifyInstance } from 'fastify';
import { can, requireRole, tx } from '../auth.js';
import { badRequest } from '../lib/errors.js';
import { importWorkbook } from '../lib/importer.js';
import { importCrmWorkbook } from '../lib/crm-workbook.js';

export async function importRoutes(app: FastifyInstance) {
  app.post('/import/workbook', { preHandler: requireRole(can.admin) }, async (req) => {
    const file = await req.file();
    if (!file) throw badRequest('Upload an .xlsx file');
    if (!file.filename.toLowerCase().endsWith('.xlsx')) throw badRequest('Only .xlsx workbooks are supported');
    const buffer = await file.toBuffer();
    return tx(req, (db) => importWorkbook(db, buffer));
  });

  // The CRM workbook (DB_CRM_Segm, sheet DB): customers, relationships, applicant profiles.
  app.post('/import/crm', { preHandler: requireRole(can.admin) }, async (req) => {
    const file = await req.file();
    if (!file) throw badRequest('Upload an .xlsx file');
    if (!file.filename.toLowerCase().endsWith('.xlsx')) throw badRequest('Only .xlsx workbooks are supported');
    const buffer = await file.toBuffer();
    return tx(req, (db) => importCrmWorkbook(db, buffer, req.user.sub));
  });
}
