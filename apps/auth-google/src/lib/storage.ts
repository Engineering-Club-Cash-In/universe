import {
	GetObjectCommand,
	HeadObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || "crm";

if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
	console.warn("⚠️  R2 storage credentials not configured.");
}

const r2Client = new S3Client({
	region: "auto",
	endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
	credentials: {
		accessKeyId: R2_ACCESS_KEY_ID || "",
		secretAccessKey: R2_SECRET_ACCESS_KEY || "",
	},
});

const SIGNED_URL_EXPIRY = 3600; // 1 hora

/**
 * Genera una URL firmada para un archivo en R2, verificando que exista.
 * Retorna null si el archivo no existe.
 */
export async function getSignedUrlFromBucket(
	key: string,
	bucket?: string,
): Promise<{ url: string; lastModified: Date | undefined } | null> {
	const targetBucket = bucket || R2_BUCKET_NAME;

	try {
		const head = await r2Client.send(
			new HeadObjectCommand({ Bucket: targetBucket, Key: key }),
		);

		const url = await getSignedUrl(
			r2Client,
			new GetObjectCommand({ Bucket: targetBucket, Key: key }),
			{ expiresIn: SIGNED_URL_EXPIRY },
		);

		return { url, lastModified: head.LastModified };
	} catch (error: any) {
		if (
			error?.name === "NotFound" ||
			error?.$metadata?.httpStatusCode === 404
		) {
			return null;
		}
		throw error;
	}
}
