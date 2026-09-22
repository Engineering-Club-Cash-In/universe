import { eq } from "drizzle-orm";
import { db } from "../db";
import {
	contractSignatories,
	generatedLegalContracts,
} from "../db/schema/legal-contracts";
import { carteraBackClient } from "../services/cartera-back-client";
import { descargarPdfFirmado } from "../services/legal-docs-api";
import { getFileUrlWithBucketInKey } from "./storage";

/**
 * El espejo de los contratos de inversión en cartera.
 *
 * El CRM es el dueño del contrato y de su estado de firma: es quien habla con
 * WeeTrust y quien recibe el webhook. Pero la ficha del inversionista y el
 * portal viven en cartera y leen `documentos_inversionista`, así que el
 * contrato se copia ahí como una fila más de esa tabla, con sus enlaces y su
 * estado en columnas propias.
 *
 * **Todo acá es best-effort.** Cuando esto corre, el contrato ya existe en el
 * CRM y en WeeTrust; si cartera no contesta, se pierde la copia, no el
 * contrato. El espejo se vuelve a mandar en la próxima firma o consulta de
 * estado, y cartera reconoce el contrato por su id, así que reintentarlo no
 * duplica nada.
 */

/** Cómo se ve un firmante del lado de cartera. */
interface FirmanteEspejado {
	rol: string;
	nombre: string;
	correo: string;
	enlace: string | null;
	estado: string;
	firmadoEl: string | null;
}

async function firmantesDelContrato(
	contractId: string,
): Promise<FirmanteEspejado[]> {
	const filas = await db
		.select()
		.from(contractSignatories)
		.where(eq(contractSignatories.contractId, contractId))
		.orderBy(contractSignatories.position);

	return filas.map((firmante) => ({
		rol: firmante.role,
		nombre: firmante.name,
		correo: firmante.email,
		enlace: firmante.signingUrl,
		estado: firmante.status,
		firmadoEl: firmante.signedAt?.toISOString() ?? null,
	}));
}

/** El PDF que quedó en R2 al generar el contrato. */
async function bajarPdfDeR2(r2Key: string): Promise<Blob> {
	// Con la key guardada, no con la URL firmada que se le muestra a la gente:
	// esa vence en una hora.
	const url = await getFileUrlWithBucketInKey(r2Key);
	const respuesta = await fetch(url, { signal: AbortSignal.timeout(60_000) });
	if (!respuesta.ok) {
		throw new Error(`no se pudo bajar el PDF de R2 (${respuesta.status})`);
	}
	return respuesta.blob();
}

async function contratoConDueno(contractId: string) {
	const [contrato] = await db
		.select()
		.from(generatedLegalContracts)
		.where(eq(generatedLegalContracts.id, contractId))
		.limit(1);

	// Sin inversionista no hay nada que espejar: es un contrato de ventas.
	if (!contrato?.investorId) return null;
	return contrato;
}

/**
 * Copia el contrato entero en cartera: el PDF y sus enlaces.
 *
 * Se llama al emitirlo y cada vez que se reemite, porque ahí cambia el
 * documento. El PDF se baja de R2 con la key guardada, no con la URL firmada
 * que se le muestra a la gente: esa vence en una hora.
 */
export async function espejarContratoEnCartera(
	contractId: string,
	createdBy?: string,
	/** PDF a copiar. Por defecto, el que se generó y quedó en R2. */
	pdf?: Blob,
): Promise<boolean> {
	try {
		const contrato = await contratoConDueno(contractId);
		if (!contrato) return false;

		if (!pdf && !contrato.pdfLink) {
			console.warn(
				`[espejo-contratos] el contrato ${contractId} no tiene PDF: no se copia a cartera`,
			);
			return false;
		}

		const archivo = pdf ?? (await bajarPdfDeR2(contrato.pdfLink as string));

		await carteraBackClient.upsertInvestorContractDocument({
			file: archivo,
			inversionista_id: contrato.investorId as number,
			contrato_id: contrato.id,
			nombre: contrato.contractName,
			tipo_contrato: contrato.contractType,
			weetrust_document_id: contrato.weetrustDocumentId,
			observer_url: contrato.observerUrl,
			firmantes: await firmantesDelContrato(contractId),
			estado_firma: contrato.status,
			created_by: createdBy,
		});

		return true;
	} catch (error) {
		console.error(
			`[espejo-contratos] no se pudo copiar el contrato ${contractId} a cartera:`,
			error,
		);
		return false;
	}
}

/**
 * Cambia en cartera el borrador por el PDF firmado.
 *
 * Aparte y best-effort: si WeeTrust no lo entrega, el contrato igual quedó
 * marcado como firmado y en cartera sigue estando el documento con sus
 * enlaces; lo que falta es el archivo con las firmas estampadas, que se puede
 * volver a intentar.
 */
async function reemplazarPorElFirmado(
	contractId: string,
	documentID: string | null,
): Promise<void> {
	if (!documentID) return;

	try {
		const firmado = await descargarPdfFirmado(documentID);
		await espejarContratoEnCartera(contractId, undefined, firmado);
	} catch (error) {
		console.error(
			`[espejo-contratos] no se pudo copiar el PDF firmado de ${contractId}:`,
			error,
		);
	}
}

/**
 * Actualiza en cartera cómo va la firma, sin mover el PDF.
 *
 * Sale de la única puerta de escritura del estado (`sincronizarEstadoDeFirma`),
 * así que se dispara tanto con el webhook de WeeTrust como con el botón de
 * actualizar estado. Es lo que hace que inversiones vea "ya firmó" sin tener
 * que entrar al CRM.
 */
export async function espejarEstadoDeFirmaEnCartera(
	contractId: string,
): Promise<boolean> {
	try {
		const contrato = await contratoConDueno(contractId);
		if (!contrato) return false;

		const { espejado, estadoAnterior } =
			await carteraBackClient.updateInvestorContractDocumentState({
				contrato_id: contrato.id,
				observer_url: contrato.observerUrl,
				firmantes: await firmantesDelContrato(contractId),
				estado_firma: contrato.status,
			});

		// Todavía no estaba copiado (el CRM guarda primero y copia después, y esa
		// copia pudo fallar). Se copia entero ahora, con PDF y todo.
		if (espejado === false) {
			return espejarContratoEnCartera(contractId);
		}

		// Acaba de quedar firmado: lo que hay en cartera es el borrador que se
		// generó, sin firmas. Se reemplaza por el PDF firmado, que es el que vale
		// como contrato. Sólo en el cambio de estado: si no, cada consulta de un
		// contrato ya cerrado volvería a pasear el archivo entero.
		if (contrato.status === "signed" && estadoAnterior !== "signed") {
			await reemplazarPorElFirmado(contrato.id, contrato.weetrustDocumentId);
		}

		return true;
	} catch (error) {
		console.error(
			`[espejo-contratos] no se pudo actualizar el estado de ${contractId} en cartera:`,
			error,
		);
		return false;
	}
}
