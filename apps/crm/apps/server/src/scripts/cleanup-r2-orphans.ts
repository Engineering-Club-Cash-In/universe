import {
	DeleteObjectCommand,
	ListObjectsV2Command,
	type _Object,
	S3Client,
} from "@aws-sdk/client-s3";
import { isNotNull } from "drizzle-orm";
import { db } from "../db";
import {
	generatedLegalContracts,
	notificationDocuments,
	opportunityDocuments,
	vehicleDocuments,
} from "../db/schema";

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME =
	process.env.R2_BUCKET_CRM || process.env.R2_BUCKET_NAME || "crm-documents";

if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
	throw new Error("R2 credentials are required to run cleanup-r2-orphans");
}

const r2Client = new S3Client({
	region: "auto",
	endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
	credentials: {
		accessKeyId: R2_ACCESS_KEY_ID,
		secretAccessKey: R2_SECRET_ACCESS_KEY,
	},
});

type CleanupMode = "dry-run" | "apply";

const args = new Set(Bun.argv.slice(2));
const mode: CleanupMode = args.has("--apply") ? "apply" : "dry-run";
const includeBankStatements = args.has("--include-bank-statements");
const minAgeHours = readNumberArg("--min-age-hours") ?? 24;

function readNumberArg(flag: string): number | undefined {
	const index = Bun.argv.indexOf(flag);
	if (index === -1) {
		return undefined;
	}
	const value = Bun.argv[index + 1];
	if (!value) {
		throw new Error(`Missing value for ${flag}`);
	}
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed < 0) {
		throw new Error(`Invalid numeric value for ${flag}: ${value}`);
	}
	return parsed;
}

function normalizeStoredKey(key: string | null): string | null {
	if (!key) {
		return null;
	}
	if (key.startsWith("http://") || key.startsWith("https://")) {
		return null;
	}
	if (key.startsWith(`${R2_BUCKET_NAME}/`)) {
		return key.slice(R2_BUCKET_NAME.length + 1);
	}
	return key;
}

function isOlderThanThreshold(lastModified: Date | undefined, cutoff: Date): boolean {
	if (!lastModified) {
		return false;
	}
	return lastModified < cutoff;
}

async function listObjects(prefix: string): Promise<_Object[]> {
	const objects: _Object[] = [];
	let continuationToken: string | undefined;

	do {
		const response = await r2Client.send(
			new ListObjectsV2Command({
				Bucket: R2_BUCKET_NAME,
				Prefix: prefix,
				ContinuationToken: continuationToken,
			}),
		);

		objects.push(...(response.Contents ?? []));
		continuationToken = response.IsTruncated
			? response.NextContinuationToken
			: undefined;
	} while (continuationToken);

	return objects;
}

async function deleteObject(key: string): Promise<void> {
	await r2Client.send(
		new DeleteObjectCommand({
			Bucket: R2_BUCKET_NAME,
			Key: key,
		}),
	);
}

async function loadReferencedKeys(): Promise<Set<string>> {
	const [opportunityRows, vehicleRows, notificationRows, legalContractRows] =
		await Promise.all([
			db
				.select({ key: opportunityDocuments.filePath })
				.from(opportunityDocuments),
			db.select({ key: vehicleDocuments.filePath }).from(vehicleDocuments),
			db
				.select({ key: notificationDocuments.filePath })
				.from(notificationDocuments),
			db
				.select({ key: generatedLegalContracts.pdfLink })
				.from(generatedLegalContracts)
				.where(isNotNull(generatedLegalContracts.pdfLink)),
		]);

	const referencedKeys = new Set<string>();
	for (const row of [
		...opportunityRows,
		...vehicleRows,
		...notificationRows,
		...legalContractRows,
	]) {
		const normalized = normalizeStoredKey(row.key);
		if (normalized) {
			referencedKeys.add(normalized);
		}
	}

	return referencedKeys;
}

async function main() {
	const cutoff = new Date(Date.now() - minAgeHours * 60 * 60 * 1000);
	const referencedKeys = await loadReferencedKeys();
	const prefixes = [
		"opportunities/",
		"vehicles/",
		"notifications/",
		"legal-contracts/",
	];

	if (includeBankStatements) {
		prefixes.push("bank-statements/");
	}

	console.log(
		JSON.stringify(
			{
				mode,
				bucket: R2_BUCKET_NAME,
				minAgeHours,
				includeBankStatements,
				cutoff: cutoff.toISOString(),
				referencedKeys: referencedKeys.size,
			},
			null,
			2,
		),
	);

	const orphanedObjects: Array<{
		key: string;
		size: number;
		lastModified: string | null;
		reason: string;
	}> = [];

	for (const prefix of prefixes) {
		const objects = await listObjects(prefix);

		for (const object of objects) {
			if (!object.Key) {
				continue;
			}

			if (!isOlderThanThreshold(object.LastModified, cutoff)) {
				continue;
			}

			if (prefix === "bank-statements/") {
				orphanedObjects.push({
					key: object.Key,
					size: object.Size ?? 0,
					lastModified: object.LastModified?.toISOString() ?? null,
					reason: "bank_statement_temporary_file",
				});
				continue;
			}

			if (!referencedKeys.has(object.Key)) {
				orphanedObjects.push({
					key: object.Key,
					size: object.Size ?? 0,
					lastModified: object.LastModified?.toISOString() ?? null,
					reason: "missing_db_reference",
				});
			}
		}
	}

	const totalBytes = orphanedObjects.reduce((sum, object) => sum + object.size, 0);

	console.log(
		JSON.stringify(
			{
				orphanedCount: orphanedObjects.length,
				totalBytes,
				totalMegabytes: Number((totalBytes / (1024 * 1024)).toFixed(2)),
				sample: orphanedObjects.slice(0, 20),
			},
			null,
			2,
		),
	);

	if (mode === "dry-run") {
		console.log(
			"Dry run only. Re-run with --apply to delete the orphaned objects listed above.",
		);
		return;
	}

	for (const object of orphanedObjects) {
		await deleteObject(object.key);
	}

	console.log(`Deleted ${orphanedObjects.length} orphaned objects from R2.`);
}

await main().catch((error) => {
	console.error("cleanup-r2-orphans failed", error);
	process.exit(1);
});
