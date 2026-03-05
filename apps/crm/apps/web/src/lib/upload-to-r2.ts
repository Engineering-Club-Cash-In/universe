import { client } from "@/utils/orpc";

interface UploadOptions {
	onProgress?: (percent: number) => void;
}

/**
 * Sube un archivo directamente a R2 usando presigned URLs.
 * 1. Pide presigned URL al backend
 * 2. PUT directo a R2 desde el browser
 * 3. Retorna la key de R2
 */
export async function uploadFileToR2(
	file: File,
	folder: string,
	options?: UploadOptions,
): Promise<{ key: string }> {
	// 1. Obtener presigned URL
	const { url, key } = await client.getUploadPresignedUrl({
		filename: file.name,
		mimeType: file.type,
		folder,
	});

	// 2. Subir directo a R2
	await putFileToR2(url, file, options);

	return { key };
}

function putFileToR2(
	url: string,
	file: File,
	options?: UploadOptions,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();

		xhr.upload.addEventListener("progress", (event) => {
			if (event.lengthComputable && options?.onProgress) {
				const percent = Math.round((event.loaded / event.total) * 100);
				options.onProgress(percent);
			}
		});

		xhr.addEventListener("load", () => {
			if (xhr.status >= 200 && xhr.status < 300) {
				resolve();
			} else if (xhr.status === 403) {
				// Presigned URL expirada - reintentar con nueva URL
				reject(new PresignedUrlExpiredError());
			} else {
				reject(new Error(`Error al subir archivo: ${xhr.status}`));
			}
		});

		xhr.addEventListener("error", () => {
			reject(new Error("Error de red al subir archivo"));
		});

		xhr.open("PUT", url);
		xhr.setRequestHeader("Content-Type", file.type);
		xhr.send(file);
	});
}

class PresignedUrlExpiredError extends Error {
	constructor() {
		super("Presigned URL expired");
		this.name = "PresignedUrlExpiredError";
	}
}

/**
 * Upload con retry automatico.
 * Si la presigned URL expira (403), pide una nueva y reintenta.
 * Si falla por otra razon, reintenta 1 vez.
 */
export async function uploadFileToR2WithRetry(
	file: File,
	folder: string,
	options?: UploadOptions,
): Promise<{ key: string }> {
	try {
		return await uploadFileToR2(file, folder, options);
	} catch (error) {
		if (error instanceof PresignedUrlExpiredError) {
			// Presigned URL expirada, pedir nueva y reintentar
			return await uploadFileToR2(file, folder, options);
		}
		// Otro error, reintentar 1 vez
		return await uploadFileToR2(file, folder, options);
	}
}
