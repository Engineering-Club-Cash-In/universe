import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_LEGAL_DOCS = process.env.R2_BUCKET_LEGAL_DOCS || 'legal-documents';

if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
  console.warn('⚠️  R2 storage credentials not configured. Direct PDF uploads to R2 will fail.');
}

const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID || '',
    secretAccessKey: R2_SECRET_ACCESS_KEY || '',
  },
});

/**
 * Sube un PDF directamente a R2 (independiente de firma electrónica).
 * Retorna un r2Key con formato "bucket/path" compatible con getFileUrlWithBucketInKey del CRM.
 */
export async function uploadPdfToR2(
  pdfBuffer: Buffer,
  filename: string
): Promise<{ r2Key: string }> {
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    throw new Error('R2 credentials not configured. Skipping direct PDF upload.');
  }

  const sanitizedFilename = filename.replace(/[^a-zA-Z0-9-_]/g, '_');
  const key = sanitizedFilename.endsWith('.pdf') ? sanitizedFilename : `${sanitizedFilename}.pdf`;

  const command = new PutObjectCommand({
    Bucket: R2_BUCKET_LEGAL_DOCS,
    Key: key,
    Body: pdfBuffer,
    ContentType: 'application/pdf',
  });

  await r2Client.send(command);

  // r2Key con formato "bucket/key" para que el CRM lo resuelva con getFileUrlWithBucketInKey
  const r2Key = `${R2_BUCKET_LEGAL_DOCS}/${key}`;
  console.log(`✓ PDF subido directamente a R2: ${r2Key}`);

  return { r2Key };
}
