import { and, eq } from "drizzle-orm";
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
				...(firmante.isSigned ? { signedAt: ahora } : { signedAt: null }),
				updatedAt: ahora,
			})
			.where(
				and(
					eq(contractSignatories.contractId, contractId),
					eq(contractSignatories.email, firmante.emailID),
				),
			);
	}

	const completado = estado.status === "COMPLETED";
	await db
		.update(generatedLegalContracts)
		.set({
			// Sólo se avanza a "firmado". Que WeeTrust reporte PENDING no es motivo
			// para revivir un contrato que alguien ya cerró o canceló a mano.
			...(completado ? { status: "signed" as const } : {}),
			weetrustDocumentId: estado.documentID,
			signingStatusCheckedAt: ahora,
			updatedAt: ahora,
		})
		.where(eq(generatedLegalContracts.id, contractId));
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
