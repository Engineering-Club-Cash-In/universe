import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import {
	contractSignatories,
	generatedLegalContracts,
} from "../db/schema/legal-contracts";
import {
	consultarEstadoFirma,
	type EstadoDocumentoFirma,
} from "../services/legal-docs-api";
import { alguienFirmo } from "./contract-signatories";
import { espejarEstadoDeFirmaEnCartera } from "./espejo-contratos-inversionista";

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

	// Todo en una transacción con la fila del contrato bloqueada: la
	// verificación de a qué documento apunta y las escrituras van juntas. Si no,
	// una regeneración que se colara entre las dos le devolvía el ID viejo a la
	// fila y pisaba los enlaces nuevos.
	await db.transaction(async (tx) => {
		const [actual] = await tx
			.select({
				documentID: generatedLegalContracts.weetrustDocumentId,
				status: generatedLegalContracts.status,
			})
			.from(generatedLegalContracts)
			.where(eq(generatedLegalContracts.id, contractId))
			.for("update")
			.limit(1);
		if (!actual) return;
		// La fila ya apunta a otro documento: esta foto es vieja. Los contratos
		// viejos no tienen ID guardado.
		if (actual.documentID && actual.documentID !== estado.documentID) return;

		// Con el contrato ya cerrado (confirmado a mano, o anulado) no se le baja
		// a nadie de "firmado" a "pendiente": WeeTrust puede seguir diciendo
		// pending y el contrato quedaba firmado con firmantes pendientes.
		const sePuedeBajar = actual.status === "pending";

		for (const firmante of estado.signatories) {
			if (!firmante.isSigned && !sePuedeBajar) continue;

			await tx
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

		await tx
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
			await tx
				.update(generatedLegalContracts)
				.set({ status: "signed", updatedAt: ahora })
				.where(
					and(
						eq(generatedLegalContracts.id, contractId),
						eq(generatedLegalContracts.status, "pending"),
					),
				);
		}
	});

	// Los contratos de inversión se copian en cartera, que es donde inversiones
	// y el portal los miran. Va afuera de la transacción y best-effort: habla
	// con otro servicio, y si no contesta no se puede perder por eso el estado
	// que WeeTrust acaba de contarnos. Se reintenta en la próxima consulta.
	await espejarEstadoDeFirmaEnCartera(contractId);
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

/**
 * Si alguien ya firmó, preguntándole a WeeTrust y no sólo a la base.
 *
 * Los webhooks pueden no estar registrados y nadie tiene por qué haber
 * apretado "Actualizar estado": la base puede decir que nadie firmó cuando
 * en WeeTrust ya hay una firma. Al anular un contrato se consulta en vivo
 * para que el motivo diga si tenía firmas parciales. Si WeeTrust no responde,
 * se asume que sí: mejor que alguien lo revise de más a que no sepa de una
 * firma. La fila no depende de esto: la de un documento de WeeTrust se
 * conserva siempre.
 */
export async function tieneFirmas(
	contractId: string,
	documentID: string | null,
): Promise<boolean> {
	if (await alguienFirmo(contractId)) return true;
	if (!documentID) return false;
	try {
		const estado = await consultarEstadoFirma(documentID);
		return (
			estado.status === "COMPLETED" ||
			estado.signatories.some((f) => f.isSigned)
		);
	} catch (error) {
		console.warn(
			`[tieneFirmas] no se pudo consultar ${documentID}; se conserva la fila por las dudas:`,
			error,
		);
		return true;
	}
}
