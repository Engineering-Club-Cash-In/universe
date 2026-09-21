import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

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

/**
 * Baja de R2 un PDF ya generado.
 *
 * Sirve para volver a emitir un contrato en WeeTrust sin regenerarlo ni pedirle
 * a nadie que lo suba: el PDF bueno ya está guardado, lo único que hace falta
 * es un documento nuevo con enlaces nuevos.
 *
 * Acepta la key con el bucket adelante ("legal-documents/contracts/...") que es
 * como la guarda el CRM, o sin él.
 */
export async function downloadPdfFromR2(r2Key: string): Promise<Buffer> {
  const client = getR2Client();

  const prefijo = `${R2_BUCKET_LEGAL_DOCS}/`;
  const key = r2Key.startsWith(prefijo) ? r2Key.slice(prefijo.length) : r2Key;

  const res = await client.send(
    new GetObjectCommand({ Bucket: R2_BUCKET_LEGAL_DOCS, Key: key }),
  );

  if (!res.Body) {
    throw new Error(`El objeto ${r2Key} no tiene contenido en R2`);
  }

  return Buffer.from(await res.Body.transformToByteArray());
}

/**
 * URL firmada para abrir un PDF de R2 desde el navegador.
 *
 * La usan los contratos que se firman en papel: no tienen documento en WeeTrust,
 * así que su "link del documento" es el PDF mismo. Sin esto, la app
 * legal-documents mostraba la declaración como generada y el botón para
 * abrirla deshabilitado. Vence a los 7 días, el máximo que permite S3.
 */
export async function urlFirmadaDePdf(r2Key: string): Promise<string> {
  const prefijo = `${R2_BUCKET_LEGAL_DOCS}/`;
  const key = r2Key.startsWith(prefijo) ? r2Key.slice(prefijo.length) : r2Key;
  return getSignedUrl(
    getR2Client(),
    new GetObjectCommand({ Bucket: R2_BUCKET_LEGAL_DOCS, Key: key }),
    { expiresIn: 7 * 24 * 60 * 60 },
  );
}
