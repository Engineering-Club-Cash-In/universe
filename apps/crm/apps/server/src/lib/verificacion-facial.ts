import { ORPCError } from "@orpc/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import {
	contractSignatories,
	generatedLegalContracts,
} from "../db/schema/legal-contracts";
import {
	consultarEstadoFirma,
	type EstadoDocumentoFirma,
	reintentarBiometria,
} from "../services/legal-docs-api";
import { conMarcaDeBiometriaOmitida } from "./contrato-biometria";
import { sincronizarEstadoDeFirma } from "./contrato-estado-firma";

/**
 * Deja pendientes a los firmantes que WeeTrust ya no da por firmados.
 *
 * Pedir de nuevo la verificación facial **deshace la firma** de esa persona y
 * le da un enlace nuevo: el documento y las demás firmas quedan, pero ella
 * tiene que volver a entrar. El sincronizador no lo escribe porque nunca baja a
 * nadie de "firmado" —protege contra consultas y webhooks que llegan tarde— y
 * sin esto la ficha la seguía mostrando firmada, con el enlace viejo y sin nada
 * que hacer. Acá sí se sabe que se deshizo: es lo que se acaba de pedir.
 */
async function devolverAFirmar(
	contractId: string,
	estado: EstadoDocumentoFirma,
): Promise<void> {
	const ahora = new Date();

	for (const firmante of estado.signatories) {
		if (firmante.isSigned) continue;

		await db
			.update(contractSignatories)
			.set({
				status: "pending",
				signedAt: null,
				...(firmante.signingUrl ? { signingUrl: firmante.signingUrl } : {}),
				...(firmante.signatoryID
					? { weetrustSignatoryId: firmante.signatoryID }
					: {}),
				...(firmante.expiry
					? { signingUrlExpiry: new Date(firmante.expiry) }
					: {}),
				updatedAt: ahora,
			})
			.where(
				and(
					eq(contractSignatories.contractId, contractId),
					sql`lower(${contractSignatories.email}) = lower(${firmante.emailID})`,
				),
			);
	}
}

/**
 * Resuelve una verificación de identidad que WeeTrust no validó: la repite, o
 * la omite.
 *
 * Es la salida del documento que se queda abierto con todas las firmas: la
 * persona firmó, WeeTrust no le creyó el DPI o la selfie, y así no cierra.
 * Pasa en ventas y en inversiones, con cualquier contrato que verifique
 * identidad; cada área pone su permiso y busca su contrato, y lo demás es
 * igual y vive acá.
 *
 * - Repetir: sobre el MISMO documento. No se emite otro ni se tocan las demás
 *   firmas, pero WeeTrust deshace la de esa persona y le da un enlace nuevo.
 * - Omitir: el documento cierra con la identidad sin verificar, y queda
 *   marcado en el contrato quién lo decidió.
 *
 * El intento fallido se busca en WeeTrust en el momento y no se recibe del
 * navegador: el `biometricLogID` cambia con cada intento, y uno viejo haría que
 * WeeTrust conteste que no encuentra nada.
 */
export async function resolverVerificacionFacial(params: {
	contrato: { id: string; status: string | null; apiResponse: unknown };
	documentID: string;
	accion: "repetir" | "omitir";
	/** Quién lo decide: queda en la marca si se omite. */
	quien: string;
	/** Para el log. */
	origen: string;
}): Promise<{ firmantes: string[]; status: string }> {
	const { contrato, documentID, accion } = params;

	// Sólo con el contrato abierto. Uno que ya figura firmado —por ejemplo,
	// confirmado a mano— no tiene nada que resolver, y repetir ahí dejaba a la
	// persona en pendiente con el contrato firmado: un estado sin salida desde
	// la pantalla, porque el sincronizador no baja un contrato cerrado.
	if (contrato.status !== "pending") {
		throw new ORPCError("BAD_REQUEST", {
			message:
				contrato.status === "signed"
					? "Este contrato ya figura como firmado: no hay ninguna verificación que resolver."
					: "Este contrato está anulado.",
		});
	}

	let estado: EstadoDocumentoFirma;
	try {
		estado = await consultarEstadoFirma(documentID);
	} catch (error) {
		throw new ORPCError("INTERNAL_SERVER_ERROR", {
			message:
				error instanceof Error
					? error.message
					: "No se pudo consultar el estado de firma",
		});
	}

	const fallidas = estado.signatories.filter(
		(f) => f.biometric?.finished && !f.biometric.valid && f.biometric.logID,
	);

	if (fallidas.length === 0) {
		throw new ORPCError("BAD_REQUEST", {
			message:
				estado.status === "COMPLETED"
					? "Este documento ya cerró: no hay ninguna verificación pendiente."
					: "Este documento no tiene ninguna verificación de identidad fallida.",
		});
	}

	for (const firmante of fallidas) {
		await reintentarBiometria({
			documentID,
			biometricLogID: firmante.biometric?.logID as string,
			action: accion === "omitir" ? "biometricSkipped" : "biometricRetry",
		});
	}

	// Omitir cierra el documento: queda dicho en la fila quién lo decidió,
	// porque ese contrato vale con una identidad que nadie verificó.
	if (accion === "omitir") {
		await db
			.update(generatedLegalContracts)
			.set({
				apiResponse: conMarcaDeBiometriaOmitida(
					(contrato.apiResponse as object | null) ?? {},
					{
						por: params.quien,
						cuando: new Date().toISOString(),
						firmantes: fallidas.map((f) => f.name),
					},
				),
				updatedAt: new Date(),
			})
			.where(eq(generatedLegalContracts.id, contrato.id));
	}

	// Y se baja el estado nuevo: después de omitir el documento suele quedar
	// cerrado, y con eso se guardan el PDF firmado y lo que dependa de él.
	let despues: EstadoDocumentoFirma | null = null;
	try {
		despues = await consultarEstadoFirma(documentID);
		await sincronizarEstadoDeFirma(contrato.id, despues);
		if (accion === "repetir") {
			await devolverAFirmar(contrato.id, despues);
		}
	} catch (error) {
		// La acción en WeeTrust ya se hizo; el estado se vuelve a consultar solo
		// desde la ficha.
		console.warn(`[${params.origen}] no se pudo releer el estado:`, error);
	}

	return {
		firmantes: fallidas.map((f) => f.name),
		status: despues?.status ?? estado.status,
	};
}
