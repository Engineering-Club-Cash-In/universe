import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { v4 as uuidv4 } from "uuid";
import {
  carteraStructuredLogger,
  type CarteraStructuredLogger,
} from "../structuredLogger";

export const s3 = new S3Client({
  endpoint: process.env.R2_ENDPOINT,
  region: "auto",
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID as string,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY as string,
  },
});

interface UploadStorage {
  send(command: PutObjectCommand): Promise<unknown>;
}

const uploadStorage: UploadStorage = {
  send: (command) => s3.send(command),
};

interface UploadFileControllerContext {
  readonly body?: { readonly file?: unknown };
  readonly set?: { status: number };
  readonly structuredLogger?: CarteraStructuredLogger;
  readonly storage?: UploadStorage;
}

function resolveMimeFamily(file: Blob): "image" | "pdf" | "other" {
  if (file.type.startsWith("image/")) return "image";
  if (file.type === "application/pdf") return "pdf";
  return "other";
}

export async function uploadFileController({
  body,
  set,
  structuredLogger = carteraStructuredLogger,
  storage = uploadStorage,
}: UploadFileControllerContext) {
  if (!set) throw new TypeError("Missing response status context");
  const startedAt = Date.now();
  let mimeFamily: "image" | "pdf" | "other" = "other";
  let r2Attempted = false;
  try {
    // Elysia ya parseó el multipart. El archivo llega en `body.file` como un
    // File/Blob. NO usar `request.formData()` acá: el body ya fue consumido
    // por el parser interno de Elysia y tirar "ERR_BODY_ALREADY_USED".
    const file = body?.file;


    if (!file || !(file instanceof Blob)) {
      set.status = 400;
      return { error: "No file uploaded" };
    }
    mimeFamily = resolveMimeFamily(file);

    // Obtener extensión
    let ext = "";
    if ("name" in file && typeof file.name === "string") {
      const parts = file.name.split(".");
      if (parts.length > 1) ext = "." + parts.pop();
    }
    const filename = `${uuidv4()}${ext}`;

    // Convertir Blob a Buffer
    const buffer = Buffer.from(await file.arrayBuffer());

    r2Attempted = true;
    await storage.send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET,
        Key: filename,
        Body: buffer,
        ContentType: file.type || "application/octet-stream",
      })
    );

    const url = `${filename}`;
    return { success: true, url, filename };
  } catch {
    const duration_ms = Math.max(0, Date.now() - startedAt);
    if (r2Attempted) {
      structuredLogger.emit("integration.request", "failed", {
        provider: "cloudflare_r2",
        operation: "put_upload",
        duration_ms,
        attempt: 1,
        retryable: false,
        error_code: "unknown",
      });
    }
    structuredLogger.emit("payment.upload", "failed", {
      mime_family: mimeFamily,
      duration_ms,
      error_code: r2Attempted ? "persistence_failed" : "parse_failed",
    });
    set.status = 500;
    return { error: "Error uploading file" };
  }
}

const SIGNED_URL_EXPIRY = 3600; // 1 hora

export async function uploadDocumentoInversionista(
  file: Blob & { name?: string },
  inversionistaId: number
): Promise<string> {
  let ext = "";
  if ("name" in file && file.name) {
    const parts = file.name.split(".");
    if (parts.length > 1) ext = "." + parts.pop();
  }
  const filename = `${uuidv4()}${ext}`;
  const key = `documentos-inversionista/${inversionistaId}/${filename}`;

  const buffer = Buffer.from(await file.arrayBuffer());

  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: file.type || "application/octet-stream",
    })
  );

  return key;
}

export async function getSignedDocumentUrl(key: string): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: process.env.R2_BUCKET,
    Key: key,
  });
  return getSignedUrl(s3, command, { expiresIn: SIGNED_URL_EXPIRY });
}

export async function deleteDocumentoFromR2(key: string): Promise<void> {
  await s3.send(
    new DeleteObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: key,
    })
  );
}
