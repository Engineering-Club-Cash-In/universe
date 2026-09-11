export function isImmutableDocumentIntegrityEvidencePath(params: {
	filePath: string;
	bankStatementPrefix: string;
}): boolean {
	return params.filePath.startsWith(`${params.bankStatementPrefix}/validated/`);
}

export function originalNameFromDocumentIntegrityPath(filePath: string): string {
	const storedName = filePath.split("/").at(-1) ?? "estado-de-cuenta.pdf";
	const withoutSnapshotPrefix = filePath.includes("/validated/")
		? storedName.replace(/^[a-f0-9]{64}-/i, "")
		: storedName;
	return withoutSnapshotPrefix.replace(/^\d{13}-[a-z0-9]{6}-/i, "");
}
