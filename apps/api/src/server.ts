// API entrypoint. Reads config from env (D-001 local-first). Connects app runtime as the
// NON-OWNER role `marinex_app` once DevOps repoints DATABASE_URL (see
// prisma/migrations/*_audit_immutability*/migration.sql) so DB-level audit immutability bites.
import { PrismaClient } from '@prisma/client';
import { buildApp } from './app.js';
import type { PresignPut } from './routes/uploads.js';

const port = Number(process.env.API_PORT ?? process.env.PORT ?? 3000);
const accessSecret = process.env.JWT_ACCESS_SECRET;
if (!accessSecret) throw new Error('JWT_ACCESS_SECRET is required');

const prisma = new PrismaClient(); // DATABASE_URL should point at marinex_app at runtime (DevOps item)

// TEMP local stub — MinIO/S3 presign helper doesn't exist as a shared package yet.
// [NEEDS: DevOps] provide a real `@marinex360/storage` (or equivalent) presign implementation;
// this stub returns a well-formed shape so routes/uploads.ts is exercisable end-to-end locally,
// but does NOT actually talk to MinIO.
const presignPut: PresignPut = async ({ key, contentType }) => {
  const endpoint = process.env.S3_ENDPOINT ?? 'http://localhost:9000';
  const bucket = process.env.S3_BUCKET ?? 'marinex360-local';
  return { uploadUrl: `${endpoint}/${bucket}/${key}`, headers: { 'Content-Type': contentType } };
};

const app = buildApp({ prisma, accessSecret, presignPut });
app
  .listen({ port, host: '0.0.0.0' })
  .then(() => app.log.info(`marinex360-api listening on :${port}`))
  .catch((err) => { app.log.error(err); process.exit(1); });
