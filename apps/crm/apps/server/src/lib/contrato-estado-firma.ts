import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import {
	contractSignatories,
	generatedLegalContracts,
} from "../db/schema/legal-contracts";
import type { EstadoDocumentoFirma } from "../services/legal-docs-api";

/**
 * Baja a la base lo que WeeTrust dice de un documento.
 *
 * Tiene dos entradas: el botón "Actualizar estado" de la ficha, que pregunta a
 * demanda, y el webhook de WeeTrust, que avisa solo cuando alguien firma. Las
 * dos terminan acá para que el estado se escriba de una sola forma.
 *
 * Los firmantes se emparejan por correo, que es la llave que usa WeeTrust: el
 * `signatoryID` cambia cuando se regeneran los enlaces, el correo no.
 */
export async function sincronizarEstadoDeFirma(
	contractId: string,
	estado: EstadoDocumentoFirma,
): Promise<void> {
	const ahora = new Date();

	// Si mientras se consultaba alguien regeneró el contrato, la fila ya apunta
	// a otro documento: aplicar esta foto vieja le devolvería el ID anterior y
	// pisaría los enlaces nuevos. Los contratos viejos no tienen ID guardado.
	const [actual] = await db
		.select({ documentID: generatedLegalContracts.weetrustDocumentId })
		.from(generatedLegalContracts)
		.where(eq(generatedLegalContracts.id, contractId))
		.limit(1);
	if (!actual) return;
	if (actual.documentID && actual.documentID !== estado.documentID) return;

	for (const firmante of estado.signatories) {
		await db
			.update(contractSignatories)
			.set({
				status: firmante.isSigned ? "signed" : "pending",
				// Un link regenerado reemplaza al anterior; uno vacío no borra el
				// que ya teníamos, que puede seguir sirviendo.
				...(firmante.signingUrl ? { signingUrl: firmante.signingUrl } : {}),
				...(firmante.signatoryID
					? { weetrustSignatoryId: firmante.signatoryID }
					: {}),
				...(firmante.expiry
					? { signingUrlExpiry: new Date(firmante.expiry) }
					: {}),
				// La primera vez que se vio firmado. Cada consulta posterior lo
				// correría hacia adelante y dejaría de decir cuándo firmó.
				signedAt: firmante.isSigned
					? sql`coalesce(${contractSignatories.signedAt}, ${ahora})`
					: null,
				updatedAt: ahora,
			})
			.where(
				and(
					eq(contractSignatories.contractId, contractId),
					// WeeTrust puede devolver el correo en minúsculas.
					sql`lower(${contractSignatories.email}) = lower(${firmante.emailID})`,
				),
			);
	}

	await db
		.update(generatedLegalContracts)
		.set({
			weetrustDocumentId: estado.documentID,
			signingStatusCheckedAt: ahora,
			updatedAt: ahora,
		})
		.where(eq(generatedLegalContracts.id, contractId));

	// Sólo se avanza de "pendiente" a "firmado". Un anulado se queda anulado
	// aunque su documento viejo termine de firmarse (un webhook atrasado, o uno
	// que no se pudo borrar): si no, reaparece entre los activos y sus enlaces
	// se vuelven a mandar.
	if (estado.status === "COMPLETED") {
		await db
			.update(generatedLegalContracts)
			.set({ status: "signed", updatedAt: ahora })
			.where(
				and(
					eq(generatedLegalContracts.id, contractId),
					eq(generatedLegalContracts.status, "pending"),
				),
			);
	}
}

/**
 * Busca el contrato al que pertenece un documento de WeeTrust.
 *
 * El webhook sólo trae el `documentID`; el contrato hay que ubicarlo por ahí.
 */
export async function contratoPorDocumentID(documentID: string) {
	const [contrato] = await db
		.select({
			id: generatedLegalContracts.id,
			contractType: generatedLegalContracts.contractType,
			opportunityId: generatedLegalContracts.opportunityId,
		})
		.from(generatedLegalContracts)
		.where(eq(generatedLegalContracts.weetrustDocumentId, documentID))
		.limit(1);

	return contrato ?? null;
}
