import {
	DeleteObjectCommand,
	GetObjectCommand,
	HeadObjectCommand,
	type HeadObjectCommandOutput,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ORPCError } from "@orpc/server";

// Configuración de Cloudflare R2
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
// R2 Bucket names - standardized naming convention
const R2_BUCKET_NAME =
	process.env.R2_BUCKET_CRM || process.env.R2_BUCKET_NAME || "crm-documents";

// Verificar que las variables de entorno estén configuradas
if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
	console.warn(
		"⚠️  R2 storage credentials not configured. File uploads will fail.",
	);
}

// Crear cliente S3 para Cloudflare R2
export const r2Client = new S3Client({
	region: "auto",
	endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
	credentials: {
		accessKeyId: R2_ACCESS_KEY_ID || "",
		secretAccessKey: R2_SECRET_ACCESS_KEY || "",
	},
});

// =============================================================================
// SIGNED URL CACHE
// =============================================================================
// Cache signed URLs to avoid regenerating them on every request.
// URLs are valid for 1 hour, cache expires 5 minutes before to ensure validity.

interface CachedSignedUrl {
	url: string;
	expiresAt: number;
}

const signedUrlCache = new Map<string, CachedSignedUrl>();
const SIGNED_URL_EXPIRY = 3600; // 1 hour in seconds
const CACHE_TTL_MS = (SIGNED_URL_EXPIRY - 300) * 1000; // 55 minutes in ms (5 min buffer)
const CACHE_CLEANUP_INTERVAL = 10 * 60 * 1000; // Cleanup every 10 minutes

// Periodic cleanup of expired cache entries
setInterval(() => {
	const now = Date.now();
	let cleaned = 0;
	for (const [key, value] of signedUrlCache.entries()) {
		if (now >= value.expiresAt) {
			signedUrlCache.delete(key);
			cleaned++;
		}
	}
	if (cleaned > 0) {
		console.log(
			`[R2 Cache] Cleaned ${cleaned} expired signed URLs. Cache size: ${signedUrlCache.size}`,
		);
	}
}, CACHE_CLEANUP_INTERVAL);

/**
 * Get a cached signed URL or generate a new one
 */
async function getCachedSignedUrl(
	bucket: string,
	key: string,
): Promise<string> {
	const cacheKey = `${bucket}/${key}`;
	const cached = signedUrlCache.get(cacheKey);
	const now = Date.now();

	// Return cached URL if still valid
	if (cached && now < cached.expiresAt) {
		return cached.url;
	}

	// Generate new signed URL
	const command = new GetObjectCommand({
		Bucket: bucket,
		Key: key,
	});
	const url = await getSignedUrl(r2Client, command, {
		expiresIn: SIGNED_URL_EXPIRY,
	});

	// Cache the URL
	signedUrlCache.set(cacheKey, {
		url,
		expiresAt: now + CACHE_TTL_MS,
	});

	return url;
}

// =============================================================================
// PRESIGNED UPLOAD URLs
// =============================================================================

const PRESIGNED_UPLOAD_EXPIRY = 600; // 10 minutes

export const UPLOAD_RESOURCE_TYPES = [
	"opportunity_document",
	"vehicle_document",
	"notification_document",
	"legal_contract_pdf",
	"bank_statement",
	"investment_document",
] as const;

export type UploadResourceType = (typeof UPLOAD_RESOURCE_TYPES)[number];

/**
 * Generate a presigned PUT URL so the client can upload directly to R2.
 */
export async function generatePresignedUploadUrl(
	key: string,
	contentType: string,
	expiresIn = PRESIGNED_UPLOAD_EXPIRY,
): Promise<string> {
	const command = new PutObjectCommand({
		Bucket: R2_BUCKET_NAME,
		Key: key,
		ContentType: contentType,
	});

	return getSignedUrl(r2Client, command, { expiresIn });
}

export function buildUploadPrefix(
	resourceType: UploadResourceType,
	resourceId: string,
): string {
	switch (resourceType) {
		case "opportunity_document":
			return `opportunities/${resourceId}`;
		case "vehicle_document":
			return `vehicles/${resourceId}`;
		case "notification_document":
			return `notifications/${resourceId}`;
		case "legal_contract_pdf":
			return `legal-contracts/${resourceId}`;
		case "bank_statement":
			return `bank-statements/${resourceId}`;
		case "investment_document":
			return `investment-documents/${resourceId}`;
	}
}

// Generar un nombre único para el archivo
export function generateUniqueFilename(originalName: string): string {
	const timestamp = Date.now();
	const randomString = Math.random().toString(36).substring(2, 8);
	const extension = originalName.split(".").pop();
	const baseName = originalName.split(".").slice(0, -1).join(".");
	// Sanitizar el nombre del archivo
	const sanitizedBaseName = baseName.replace(/[^a-zA-Z0-9-_]/g, "_");

	return `${timestamp}-${randomString}-${sanitizedBaseName}.${extension}`;
}

export interface UploadFileLike {
	name: string;
	type?: string;
	size?: number;
}

export interface R2ObjectMetadata {
	size: number;
	contentType?: string;
}

export async function getR2ObjectMetadata(
	key: string,
): Promise<R2ObjectMetadata> {
	try {
		const command = new HeadObjectCommand({
			Bucket: R2_BUCKET_NAME,
			Key: key,
		});
		const response: HeadObjectCommandOutput = await r2Client.send(command);
		return {
			size: response.ContentLength ?? 0,
			contentType: response.ContentType,
		};
	} catch {
		throw new ORPCError("BAD_REQUEST", {
			message: "El archivo no existe en almacenamiento.",
		});
	}
}

export function assertUploadKeyMatchesPrefix(
	key: string,
	expectedPrefix: string,
): void {
	if (!key.startsWith(`${expectedPrefix}/`)) {
		throw new ORPCError("BAD_REQUEST", {
			message: "El archivo no pertenece al recurso esperado.",
		});
	}
}

export function resolveMimeType(file: UploadFileLike): string {
	if (file.type && ALLOWED_DOCUMENT_TYPES.includes(file.type)) {
		return file.type;
	}
	const extension = file.name.split(".").pop()?.toLowerCase();
	if (extension && EXTENSION_TO_MIME[extension]) {
		return EXTENSION_TO_MIME[extension];
	}
	return file.type || "";
}

export function validateResolvedMimeType(file: UploadFileLike): {
	valid: boolean;
	mimeType?: string;
	error?: string;
} {
	const mimeType = resolveMimeType(file);

	if (!ALLOWED_DOCUMENT_TYPES.includes(mimeType)) {
		return {
			valid: false,
			error:
				"Tipo de archivo no permitido. Solo se permiten PDF, imágenes (JPEG, PNG, WebP, AVIF), documentos Word y Excel.",
		};
	}

	return { valid: true, mimeType };
}

export async function verifyUploadedDocumentInR2(params: {
	key: string;
	expectedPrefix: string;
	filename: string;
	mimeType?: string;
	maxSizeBytes?: number;
}): Promise<{ key: string; filename: string; size: number; mimeType: string }> {
	assertUploadKeyMatchesPrefix(params.key, params.expectedPrefix);

	const metadata = await getR2ObjectMetadata(params.key);
	const resolved = validateResolvedMimeType({
		name: params.filename,
		type: metadata.contentType || params.mimeType,
	});

	if (!resolved.valid || !resolved.mimeType) {
		throw new ORPCError("BAD_REQUEST", {
			message: resolved.error || "Tipo de archivo no permitido.",
		});
	}

	const maxSizeBytes = params.maxSizeBytes ?? MAX_FILE_SIZE;
	if (metadata.size > maxSizeBytes) {
		throw new ORPCError("BAD_REQUEST", {
			message: `El archivo es demasiado grande. El tamaño máximo permitido es ${Math.round(maxSizeBytes / (1024 * 1024))}MB.`,
		});
	}

	return {
		key: params.key,
		filename: params.filename,
		size: metadata.size,
		mimeType: resolved.mimeType,
	};
}

// Descargar archivo de R2 como Buffer (para enviar a AI)
export async function getFileBuffer(key: string): Promise<Buffer> {
	const command = new GetObjectCommand({
		Bucket: R2_BUCKET_NAME,
		Key: key,
	});
	const response = await r2Client.send(command);
	const arrayBuffer = await response.Body!.transformToByteArray();
	return Buffer.from(arrayBuffer);
}

// Subir archivo a R2 (para oportunidades)
export async function uploadFileToR2(
	file: File | Blob,
	filename: string,
	opportunityId: string,
): Promise<{ key: string; url: string }> {
	const key = `opportunities/${opportunityId}/${filename}`;
	const contentType = file instanceof File ? resolveMimeType(file) : file.type;

	const command = new PutObjectCommand({
		Bucket: R2_BUCKET_NAME,
		Key: key,
		Body: Buffer.from(await file.arrayBuffer()),
		ContentType: contentType,
	});

	await r2Client.send(command);

	// Generar URL firmada para acceso temporal (24 horas)
	const url = await getSignedUrl(
		r2Client,
		new GetObjectCommand({
			Bucket: R2_BUCKET_NAME,
			Key: key,
		}),
		{ expiresIn: 86400 },
	); // 24 horas

	return { key, url };
}

// Subir foto de vehículo a R2
export async function uploadVehiclePhotoToR2(
	file: File | Blob,
	filename: string,
	vehicleId: string,
	category: string,
): Promise<{ key: string; url: string }> {
	const key = `vehicles/${vehicleId}/photos/${category}/${filename}`;

	const command = new PutObjectCommand({
		Bucket: R2_BUCKET_NAME,
		Key: key,
		Body: Buffer.from(await file.arrayBuffer()),
		ContentType: file instanceof File ? resolveMimeType(file) : file.type,
	});

	await r2Client.send(command);

	// Si tienes un dominio personalizado configurado en R2, úsalo:
	const R2_PUBLIC_DOMAIN = process.env.R2_PUBLIC_DOMAIN; // ej: "images.tudominio.com"

	if (R2_PUBLIC_DOMAIN) {
		// URL pública permanente con dominio personalizado
		const publicUrl = `https://${R2_PUBLIC_DOMAIN}/${key}`;
		return { key, url: publicUrl };
	}
	// Fallback: URL pública directa de R2 (requiere bucket público)
	const publicUrl = `https://${R2_BUCKET_NAME}.${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${key}`;
	return { key, url: publicUrl };
}

// Obtener URL firmada para un archivo (con cache)
export async function getFileUrl(key: string): Promise<string> {
	return getCachedSignedUrl(R2_BUCKET_NAME, key);
}

// Validar formato de R2 key con bucket incluido
function validateR2KeyFormat(fullKey: string): { bucket: string; key: string } {
	if (!fullKey || typeof fullKey !== "string") {
		throw new Error("R2 key is required and must be a string");
	}

	// fullKey debe tener formato "bucket-name/path/to/file.ext"
	const parts = fullKey.split("/");

	if (parts.length < 2) {
		throw new Error(
			`Invalid R2 key format: "${fullKey}". Expected "bucket/path/to/file"`,
		);
	}

	const bucket = parts.shift()!;
	const key = parts.join("/");

	// Validar que bucket no esté vacío y tenga caracteres válidos
	if (!bucket || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) {
		throw new Error(
			`Invalid bucket name: "${bucket}". Must be 3-63 lowercase alphanumeric characters or hyphens`,
		);
	}

	// Validar que key no esté vacío
	if (!key) {
		throw new Error("R2 key path cannot be empty");
	}

	return { bucket, key };
}

// obtener URL firmada para un archivo que tiene el bucket al inicio de la key (con cache)
export async function getFileUrlWithBucketInKey(
	fullKey: string,
): Promise<string> {
	const { bucket, key } = validateR2KeyFormat(fullKey);
	return getCachedSignedUrl(bucket, key);
}

// Eliminar archivo de R2
export async function deleteFileFromR2(key: string): Promise<void> {
	const command = new DeleteObjectCommand({
		Bucket: R2_BUCKET_NAME,
		Key: key,
	});

	await r2Client.send(command);
}

// Subir archivo desde URL a R2 (para documentos del bot)
export async function uploadFileFromUrlToR2(
	fileUrl: string,
	filename: string,
	opportunityId: string,
): Promise<{ key: string; url: string; size: number; mimeType: string }> {
	const key = `opportunities/${opportunityId}/${filename}`;

	// Fetch file from URL
	const response = await fetch(fileUrl);
	if (!response.ok) {
		throw new Error(`Failed to fetch file from URL: ${response.statusText}`);
	}

	const arrayBuffer = await response.arrayBuffer();
	const contentType =
		response.headers.get("content-type") || "application/octet-stream";
	const size = arrayBuffer.byteLength;

	const command = new PutObjectCommand({
		Bucket: R2_BUCKET_NAME,
		Key: key,
		Body: Buffer.from(arrayBuffer),
		ContentType: contentType,
	});

	await r2Client.send(command);

	// Generate signed URL for temporary access (24 hours)
	const url = await getSignedUrl(
		r2Client,
		new GetObjectCommand({
			Bucket: R2_BUCKET_NAME,
			Key: key,
		}),
		{ expiresIn: 86400 },
	);

	return { key, url, size, mimeType: contentType };
}

// Tipos de documentos permitidos
export const ALLOWED_DOCUMENT_TYPES = [
	"application/pdf",
	"image/jpeg",
	"image/png",
	"image/webp",
	"image/avif", // Agregado soporte para AVIF
	"application/msword",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	// Excel files for detalle_analisis
	"application/vnd.ms-excel",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];

// Tamaño máximo del archivo (10MB)
export const MAX_FILE_SIZE = 10 * 1024 * 1024;

// Mapa de extensiones a MIME types para fallback cuando el browser no reporta el tipo
const EXTENSION_TO_MIME: Record<string, string> = {
	pdf: "application/pdf",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	png: "image/png",
	webp: "image/webp",
	avif: "image/avif",
	doc: "application/msword",
	docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	xls: "application/vnd.ms-excel",
	xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

// Resolver MIME type desde extensión como fallback
// Validar archivo
export function validateFile(file: File): { valid: boolean; error?: string } {
	const resolved = validateResolvedMimeType(file);

	if (!resolved.valid) {
		return {
			valid: false,
			error: resolved.error,
		};
	}

	if (file.size > MAX_FILE_SIZE) {
		return {
			valid: false,
			error:
				"El archivo es demasiado grande. El tamaño máximo permitido es 10MB.",
		};
	}

	return { valid: true };
}

// Tipos de videos permitidos
export const ALLOWED_VIDEO_TYPES = [
	"video/mp4",
	"video/quicktime",
	"video/webm",
];

// Tamaño máximo del video (50MB)
export const MAX_VIDEO_SIZE = 50 * 1024 * 1024;

// Mapa de extensiones de video a MIME types
const VIDEO_EXTENSION_TO_MIME: Record<string, string> = {
	mp4: "video/mp4",
	mov: "video/quicktime",
	webm: "video/webm",
};

// Resolver MIME type de video desde extensión como fallback
export function resolveVideoMimeType(file: File): string {
	if (file.type && ALLOWED_VIDEO_TYPES.includes(file.type)) {
		return file.type;
	}
	const extension = file.name.split(".").pop()?.toLowerCase();
	if (extension && VIDEO_EXTENSION_TO_MIME[extension]) {
		return VIDEO_EXTENSION_TO_MIME[extension];
	}
	return file.type || "";
}

// Validar video
export function validateVideo(file: File): { valid: boolean; error?: string } {
	const mimeType = resolveVideoMimeType(file);
	if (!ALLOWED_VIDEO_TYPES.includes(mimeType)) {
		return {
			valid: false,
			error:
				"Tipo de archivo no permitido. Solo se permiten videos (MP4, MOV, WebM).",
		};
	}

	if (file.size > MAX_VIDEO_SIZE) {
		return {
			valid: false,
			error:
				"El video es demasiado grande. El tamaño máximo permitido es 50MB.",
		};
	}

	return { valid: true };
}

// Subir video de vehículo a R2
export async function uploadVehicleVideoToR2(
	file: File | Blob,
	filename: string,
	vehicleId: string,
	category: string,
): Promise<{ key: string; url: string }> {
	const key = `vehicles/${vehicleId}/videos/${category}/${filename}`;

	const contentType =
		file instanceof File ? resolveVideoMimeType(file) : file.type;

	const command = new PutObjectCommand({
		Bucket: R2_BUCKET_NAME,
		Key: key,
		Body: Buffer.from(await file.arrayBuffer()),
		ContentType: contentType,
	});

	await r2Client.send(command);

	// Generar URL firmada para acceso temporal (24 horas)
	const url = await getSignedUrl(
		r2Client,
		new GetObjectCommand({
			Bucket: R2_BUCKET_NAME,
			Key: key,
		}),
		{ expiresIn: 86400 },
	);

	return { key, url };
}
