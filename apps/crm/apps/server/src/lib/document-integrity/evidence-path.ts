export function isImmutableDocumentIntegrityEvidencePath(params: {
	filePath: string;
	bankStatementPrefix: string;
}): boolean {
	return params.filePath.startsWith(`${params.bankStatementPrefix}/validated/`);
}
