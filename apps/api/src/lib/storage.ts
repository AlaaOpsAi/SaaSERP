/**
 * Files on disk under UPLOAD_DIR, one folder per company. The database keeps the
 * key; files are served only through short-lived signed links (see fileLink), so
 * a link can be opened in a browser tab or the phone app without a login header.
 */
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { config } from '../config.js';
import { badRequest } from './errors.js';

const root = () => resolve(config.uploadDir);

function pathOf(key: string) {
  const full = resolve(root(), key);
  if (!full.startsWith(root() + sep)) throw new Error('Unsafe storage key');
  return full;
}

export async function saveFile(tenantId: string, data: Buffer, ext: string): Promise<string> {
  const key = `${tenantId}/${new Date().getFullYear()}/${randomUUID()}.${ext}`;
  const full = pathOf(key);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, data);
  return key;
}

export const readStored = (key: string) => readFile(pathOf(key));
export const removeStored = (key: string) => rm(pathOf(key), { force: true });

export const MIME = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  png: 'image/png',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
} as const;

/** The real type of an upload, from its first bytes (never trust the file name). */
export function sniff(data: Buffer): keyof typeof MIME | null {
  if (data.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'jpg';
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (data.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) return 'docx';
  return null;
}

/** A file name safe for a download header. */
export function cleanName(name: string, fallback = 'file') {
  const n = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  return n || fallback;
}

interface LinkBody { k: string; n: string; m: string; e: number; d?: 1 }

const sign = (payload: string) => createHmac('sha256', `${config.jwtSecret}:files`).update(payload).digest('base64url');

/** A link valid for a few minutes. `download` asks the browser to save rather than show. */
export function fileLink(key: string, name: string, mime: string, opts: { minutes?: number; download?: boolean } = {}) {
  const body: LinkBody = { k: key, n: name, m: mime, e: Date.now() + (opts.minutes ?? 10) * 60_000, ...(opts.download ? { d: 1 as const } : {}) };
  const payload = Buffer.from(JSON.stringify(body)).toString('base64url');
  return `/api/files?t=${payload}.${sign(payload)}`;
}

export function openLink(token: string): LinkBody {
  const [payload, sig] = token.split('.');
  if (!payload || !sig) throw badRequest('Invalid link');
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw badRequest('Invalid link');
  const body = JSON.parse(Buffer.from(payload, 'base64url').toString()) as LinkBody;
  if (body.e < Date.now()) throw badRequest('This link has expired. Open the file again from the contract.');
  return body;
}
