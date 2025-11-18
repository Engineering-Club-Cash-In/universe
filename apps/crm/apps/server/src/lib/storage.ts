import {
	DeleteObjectCommand,
	GetObjectCommand,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Configuración de Cloudflare R2
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || "crm-documents";

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

// Subir archivo a R2 (para oportunidades)
export async function uploadFileToR2(
	file: File | Blob,
	filename: string,
	opportunityId: string,
): Promise<{ key: string; url: string }> {
	const key = `opportunities/${opportunityId}/${filename}`;

	const command = new PutObjectCommand({
		Bucket: R2_BUCKET_NAME,
		Key: key,
		Body: Buffer.from(await file.arrayBuffer()),
		ContentType: file.type,
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
		ContentType: file.type,
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

// Obtener URL firmada para un archivo
export async function getFileUrl(key: string): Promise<string> {
	const command = new GetObjectCommand({
		Bucket: R2_BUCKET_NAME,
		Key: key,
	});

	// Generar URL firmada válida por 1 hora
	return await getSignedUrl(r2Client, command, { expiresIn: 3600 });
}

// Eliminar archivo de R2
export async function deleteFileFromR2(key: string): Promise<void> {
	const command = new DeleteObjectCommand({
		Bucket: R2_BUCKET_NAME,
		Key: key,
	});

	await r2Client.send(command);
}

// Tipos de documentos permitidos
export const ALLOWED_DOCUMENT_TYPES = [
	"application/pdf",
	"image/jpeg",
	"image/jpg",
	"image/png",
	"image/webp",
	"image/avif", // Agregado soporte para AVIF
	"application/msword",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

// Tamaño máximo del archivo (10MB)
export const MAX_FILE_SIZE = 10 * 1024 * 1024;

// Validar archivo
export function validateFile(file: File): { valid: boolean; error?: string } {
	if (!ALLOWED_DOCUMENT_TYPES.includes(file.type)) {
		return {
			valid: false,
			error:
				"Tipo de archivo no permitido. Solo se permiten PDF, imágenes (JPEG, PNG, WebP, AVIF) y documentos Word.",
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
