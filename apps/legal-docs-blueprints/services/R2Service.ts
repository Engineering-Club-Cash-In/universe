import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_LEGAL_DOCS = process.env.R2_BUCKET_LEGAL_DOCS || 'legal-documents';

let r2Client: S3Client | null = null;

function getR2Client(): S3Client {
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    throw new Error('R2 credentials not configured (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)');
  }
  if (!r2Client) {
    r2Client = new S3Client({
      region: 'auto',
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
      },
    });
  }
  return r2Client;
}

/**
 * Sube un PDF directamente a R2 (independiente de firma electrónica).
 * Retorna un r2Key con formato "bucket/path" compatible con getFileUrlWithBucketInKey del CRM.
 *
 * Key format: contracts/{YYYY-MM-DD}/{nombre_tipo_timestamp_random}.pdf
 * Ejemplo: contracts/2026-02-27/Christian_Ruiz_uso_carro_usado_2026-02-27T15-30-45_a3b2c1.pdf
 */
export async function uploadPdfToR2(
  pdfBuffer: Buffer,
  filename: string
): Promise<{ r2Key: string }> {
  const client = getR2Client();

  const sanitized = filename.replace(/[^a-zA-Z0-9-_]/g, '_');
  const randomSuffix = Math.random().toString(36).substring(2, 8);
  const datePrefix = new Date().toISOString().slice(0, 10);
  const finalName = `${sanitized}_${randomSuffix}.pdf`;
  const key = `contracts/${datePrefix}/${finalName}`;

  const command = new PutObjectCommand({
    Bucket: R2_BUCKET_LEGAL_DOCS,
    Key: key,
    Body: pdfBuffer,
    ContentType: 'application/pdf',
  });

  await client.send(command);

  const r2Key = `${R2_BUCKET_LEGAL_DOCS}/${key}`;
  console.log(`✓ PDF subido a R2: ${r2Key}`);

  return { r2Key };
}
