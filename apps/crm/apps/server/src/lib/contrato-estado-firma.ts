import { and, eq, lte, ne, sql } from "drizzle-orm";
import { db } from "../db";
import {
	contractSignatories,
	generatedLegalContracts,
} from "../db/schema/legal-contracts";
import {
	consultarEstadoFirma,
	type EstadoDocumentoFirma,
} from "../services/legal-docs-api";
import { recalcularLaBateriaDelContrato } from "./bateria-de-contratos";
import { rolDeFirmanteViejo } from "./contract-signatories";
import { REP_LEGAL_EMAIL } from "./contratos-rep-legal";
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
	opciones: {
		/**
		 * Cuándo se le preguntó a WeeTrust. Un firmante que cambió después no se
		 * toca: la foto es más vieja que él. Pasa con "pedir que se identifique
		 * de nuevo", que le deshace la firma a alguien: una consulta que salió
		 * antes y termina después lo volvía a dejar firmado con el enlace viejo,
		 * y como una firma no se baja, ninguna consulta nueva lo arreglaba.
		 *
		 * Obligatorio: todos los caminos le preguntan a WeeTrust en el momento
		 * —el webhook también, en vez de creerle al mensaje—, así que todos
		 * saben cuándo.
		 */
		observadoEn: Date;
	},
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
				clientSigningLink: generatedLegalContracts.clientSigningLink,
				representativeSigningLink:
					generatedLegalContracts.representativeSigningLink,
				additionalSigningLinks: generatedLegalContracts.additionalSigningLinks,
			})
			.from(generatedLegalContracts)
			.where(eq(generatedLegalContracts.id, contractId))
			.for("update")
			.limit(1);
		if (!actual) return;
		// La fila ya apunta a otro documento: esta foto es vieja. Los contratos
		// viejos no tienen ID guardado.
		if (actual.documentID && actual.documentID !== estado.documentID) return;

		// Un contrato de antes de `contract_signatories` no tiene a nadie
		// guardado, y abajo sólo se actualizan filas que existen: sin esto nunca
		// tendría estado por firmante, ni la salida de la verificación facial. Se
		// crean con lo que WeeTrust dice ahora, una sola vez.
		const [yaTieneFirmantes] = await tx
			.select({ id: contractSignatories.id })
			.from(contractSignatories)
			.where(eq(contractSignatories.contractId, contractId))
			.limit(1);

		if (!yaTieneFirmantes && estado.signatories.length > 0) {
			let yaHayTitular = false;
			const filas = estado.signatories.map((firmante, position) => {
				const role = rolDeFirmanteViejo(actual, firmante, {
					correoRepLegal: REP_LEGAL_EMAIL,
					yaHayTitular,
				});
				if (role === "TITULAR") yaHayTitular = true;
				return {
					contractId,
					role,
					email: firmante.emailID,
					name: firmante.name || firmante.emailID,
					weetrustSignatoryId: firmante.signatoryID || null,
					signingUrl: firmante.signingUrl,
					signingUrlExpiry: firmante.expiry ? new Date(firmante.expiry) : null,
					position,
					status: firmante.isSigned
						? ("signed" as const)
						: ("pending" as const),
					signedAt: firmante.isSigned ? ahora : null,
					updatedAt: ahora,
				};
			});
			await tx.insert(contractSignatories).values(filas).onConflictDoNothing();
		}

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
						// En el mismo documento una firma no se deshace. Si dice
						// "pendiente" para alguien que ya figura firmado, es una
						// consulta vieja que terminó después de otra más nueva: no se
						// le baja el estado ni se le pisa el enlace.
						firmante.isSigned
							? undefined
							: ne(contractSignatories.status, "signed"),
						lte(contractSignatories.updatedAt, opciones.observadoEn),
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

	// Y la batería, si el contrato es de una: cuando se firman todos sale de la
	// lista de jurídico, porque ya no hay nada que corregir.
	await recalcularLaBateriaDelContrato(contractId);
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
 * Cómo está el documento en WeeTrust, no en la base.
 *
 * El estado local "firmado" no prueba que allá esté completo: lo pone también
 * la confirmación a mano, que no consulta a WeeTrust. Si se borrara la
 * distinción, un contrato confirmado a mano —pero pendiente allá— se anularía
 * sin borrarlo, y sus enlaces seguirían firmando un documento descartado.
 *
 * Devuelve `null` si WeeTrust no contesta: quien llame decide qué asumir.
 */
export async function estadoEnWeeTrust(
	documentID: string,
): Promise<{ completo: boolean; conFirmas: boolean } | null> {
	try {
		const estado = await consultarEstadoFirma(documentID);
		const completo = estado.status === "COMPLETED";
		return {
			completo,
			conFirmas: completo || estado.signatories.some((f) => f.isSigned),
		};
	} catch (error) {
		console.warn(
			`[estadoEnWeeTrust] no se pudo consultar ${documentID}:`,
			error,
		);
		return null;
	}
}
