export function isImmutableDocumentIntegrityEvidencePath(params: {
	filePath: string;
	bankStatementPrefix: string;
}): boolean {
	return params.filePath.startsWith(`${params.bankStatementPrefix}/validated/`);
}

// El resto de la llave del snapshot (prefijo, ids y hash) ocupa ~165
// caracteres y R2 admite 1024: se acota el nombre codificado, que al escapar
// puede triplicar su longitud, para que la subida nunca falle por la llave.
const MAX_ENCODED_EVIDENCE_NAME_LENGTH = 700;

// Percent-encoding reversible que deja la llave en [A-Za-z0-9._%-]:
// encodeURIComponent no escapa !'()*~, que sí quedan fuera de ese conjunto.
function percentEncodeEvidenceName(name: string): string {
	return encodeURIComponent(name).replace(
		/[!'()*~]/g,
		(char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
	);
}

export function encodeDocumentIntegrityEvidenceName(name: string): string {
	const encoded = percentEncodeEvidenceName(name);
	if (encoded.length <= MAX_ENCODED_EVIDENCE_NAME_LENGTH) return encoded;
	// Nombre desproporcionado: se recorta por code points, nunca a mitad de un
	// par suplente, hasta que la forma codificada entra en el límite.
	const codePoints = Array.from(name);
	for (let length = codePoints.length - 1; length > 0; length--) {
		const candidate = percentEncodeEvidenceName(
			codePoints.slice(0, length).join(""),
		);
		if (candidate.length <= MAX_ENCODED_EVIDENCE_NAME_LENGTH) return candidate;
	}
	return "";
}

function decodeEvidenceName(name: string): string {
	try {
		return decodeURIComponent(name);
	} catch {
		// Snapshots anteriores a la codificación reversible pueden traer "%"
		// literales que no forman una secuencia válida.
		return name;
	}
}

export function originalNameFromDocumentIntegrityPath(filePath: string): string {
	const storedName = filePath.split("/").at(-1) ?? "estado-de-cuenta.pdf";
	// El snapshot guarda "<sha256>-<nombre codificado>": se quita el hash y se
	// decodifica antes de retirar el prefijo técnico de la subida.
	const withoutSnapshotPrefix = filePath.includes("/validated/")
		? decodeEvidenceName(storedName.replace(/^[a-f0-9]{64}-/i, ""))
		: storedName;
	return withoutSnapshotPrefix.replace(/^\d{13}-[a-z0-9]{6}-/i, "");
}
