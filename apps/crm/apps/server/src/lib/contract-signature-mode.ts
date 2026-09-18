/**
 * Cómo se firma cada contrato: electrónicamente (WeeTrust) o en papel.
 *
 * La fuente de verdad vive en el generador
 * (`legal-docs-blueprints/services/signaturePatterns.ts`, campo `firma`), que
 * es quien decide si el documento se sube a WeeTrust. Acá se repite la lista
 * porque el CRM necesita saberlo sin llamar a la API: para no pedirle correos a
 * jurídico, para no marcar como incompleto un contrato que nunca iba a tener
 * link, y para etiquetarlo en la ficha.
 *
 * Si se agrega otro contrato en papel, hay que tocar los dos lados.
 */
export type SignatureMode = "electronica" | "fisica";

/**
 * Contratos que se imprimen y se firman a mano.
 *
 * Hoy sólo la declaración de vendedor: la firma el vendedor del vehículo, de
 * quien tenemos nombre y DPI pero no correo, así que no hay a dónde mandarle un
 * link de firma.
 */
export const CONTRATOS_FIRMA_FISICA = new Set<string>(["declaracion_vendedor"]);

export function esFirmaFisica(contractType: string): boolean {
	return CONTRATOS_FIRMA_FISICA.has(contractType);
}

export function getSignatureMode(contractType: string): SignatureMode {
	return esFirmaFisica(contractType) ? "fisica" : "electronica";
}
