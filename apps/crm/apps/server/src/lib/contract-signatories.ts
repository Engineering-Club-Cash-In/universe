import type { SignerRole } from "../services/legal-docs-api";

/**
 * Un firmante tal como lo devuelve el generador, ya enviado a WeeTrust.
 */
export interface FirmanteEnviado {
	role: SignerRole;
	email: string;
	name: string;
	signatoryID?: string;
	signingUrl?: string;
}

/**
 * Filas de `contract_signatories` para un contrato recién guardado.
 *
 * Devuelve vacío si el generador no reportó firmantes (contratos en papel, o
 * respuestas del camino viejo que sólo traían `signing_links`). En ese caso
 * siguen valiendo las columnas por posición del contrato.
 */
export function filasDeFirmantes(
	contractId: string,
	signatories: FirmanteEnviado[] | undefined,
): Array<{
	contractId: string;
	role: string;
	email: string;
	name: string;
	weetrustSignatoryId: string | null;
	signingUrl: string | null;
	position: number;
}> {
	if (!signatories || signatories.length === 0) return [];

	// WeeTrust manda un solo link por correo aunque la persona firme en varias
	// líneas: la tabla tiene único (contract_id, email), así que se deduplica acá
	// en vez de dejar que reviente el insert.
	const porEmail = new Map<string, FirmanteEnviado>();
	for (const s of signatories) {
		if (!porEmail.has(s.email)) porEmail.set(s.email, s);
	}

	return [...porEmail.values()].map((s, i) => ({
		contractId,
		role: s.role,
		email: s.email,
		name: s.name,
		weetrustSignatoryId: s.signatoryID ?? null,
		signingUrl: s.signingUrl ?? null,
		position: i,
	}));
}

/**
 * Las columnas viejas de links, llenadas por ROL en vez de por posición.
 *
 * `generated_legal_contracts` guarda el link del cliente, el del representante
 * y "los demás" en tres columnas fijas. Llenarlas con `signing_links[0]`,
 * `[1]` y `slice(2)` asumía que WeeTrust devolvía titular → representante →
 * resto, y no es así: hay templates donde el representante firma primero, y con
 * un cofirmante el segundo link era del cofirmante, de modo que la ficha
 * mostraba el link del cofirmante rotulado "Rep. Legal".
 *
 * Mientras esas columnas sigan existiendo se llenan desde los roles reales.
 * Si no hay roles (camino viejo), se cae al reparto por posición de antes.
 */
export function linksPorRol(
	signatories: FirmanteEnviado[] | undefined,
	signingLinks: string[] | undefined,
): {
	clientSigningLink: string | null;
	representativeSigningLink: string | null;
	additionalSigningLinks: string[] | null;
} {
	if (!signatories || signatories.length === 0) {
		return {
			clientSigningLink: signingLinks?.[0] || null,
			representativeSigningLink: signingLinks?.[1] || null,
			additionalSigningLinks: signingLinks?.slice(2) || null,
		};
	}

	const titular = signatories.find((s) => s.role === "TITULAR");
	const repLegal = signatories.find((s) => s.role === "REP_LEGAL");
	const resto = signatories
		.filter((s) => s !== titular && s !== repLegal)
		.map((s) => s.signingUrl)
		.filter((url): url is string => Boolean(url));

	return {
		clientSigningLink: titular?.signingUrl || null,
		representativeSigningLink: repLegal?.signingUrl || null,
		additionalSigningLinks: resto.length > 0 ? resto : null,
	};
}

/**
 * Saca el `documentID` de WeeTrust de un link de firma ya guardado.
 *
 * Los contratos generados antes de que se guardara el `documentID` sólo tienen
 * la URL, que lo lleva adentro:
 * `https://app.weetrust.mx/signatory/{documentID}/{signatoryID}/...`
 *
 * Es una recuperación, no la vía normal: para los contratos nuevos el
 * `documentID` viene del generador.
 */
export function documentIdDesdeLink(link: string | null): string | null {
	if (!link) return null;
	const m = link.match(/\/signatory\/([^/?#]+)/);
	return m?.[1] ?? null;
}
