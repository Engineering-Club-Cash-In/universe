import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Comprobante de que un documento de WeeTrust lo generó el CRM para una
 * oportunidad, y que por lo tanto se puede descartar si nunca se enlazó.
 *
 * El wizard genera los contratos (y WeeTrust manda las invitaciones) antes de
 * que jurídico apriete "Finalizar y Enlazar". Si en vez de enlazar vuelve a
 * corregir o se va, esos documentos quedaban vivos sin fila en el CRM: el
 * cliente podía firmar uno que nadie sigue. Para limpiarlos hay que poder
 * borrarlos, pero no cualquier documento: en la misma cuenta de WeeTrust
 * viven los de inversiones y los de la app de jurídico, que no tienen fila
 * acá y parecerían "sin enlazar". El comprobante prueba que éste salió de una
 * generación del CRM para esta oportunidad.
 *
 * Sólo servidor: lee `process.env`.
 */
function secreto(): string {
	const valor = process.env.BETTER_AUTH_SECRET;
	if (!valor) throw new Error("BETTER_AUTH_SECRET no configurado");
	return valor;
}

function calcular(opportunityId: string, documentID: string): string {
	return createHmac("sha256", secreto())
		.update(`descarte-contrato:${opportunityId}:${documentID}`)
		.digest("hex");
}

export function firmarDescarte(
	opportunityId: string,
	documentID: string,
): string {
	return calcular(opportunityId, documentID);
}

export function descarteValido(
	opportunityId: string,
	documentID: string,
	comprobante: string,
): boolean {
	const esperado = Buffer.from(calcular(opportunityId, documentID), "hex");
	const recibido = Buffer.from(comprobante, "hex");
	return (
		esperado.length === recibido.length && timingSafeEqual(esperado, recibido)
	);
}
