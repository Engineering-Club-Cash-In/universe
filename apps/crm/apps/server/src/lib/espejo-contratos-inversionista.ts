import { eq } from "drizzle-orm";
import { db } from "../db";
import {
	contractSignatories,
	generatedLegalContracts,
} from "../db/schema/legal-contracts";
import { carteraBackClient } from "../services/cartera-back-client";
import { descargarPdfFirmado } from "../services/legal-docs-api";
import { getFileUrlWithBucketInKey, uploadPdfWithBucketInKey } from "./storage";

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
 * Si el inversionista ve el contrato en su portal.
 *
 * - Firmado por todos: sí. Es el documento que vale.
 * - Anulado: no. Sus enlaces ya no sirven y el reemplazo va aparte; dejarlo
 *   visible es ofrecerle un contrato que se descartó.
 * - Mientras se firma: `undefined`, que es "no opino". Lo que hay es el
 *   borrador, así que no se enciende solo, pero si alguien decidió mostrárselo
 *   desde la ficha, esa decisión se respeta.
 */
function visibilidadEnElPortal(status: string | null): boolean | undefined {
	if (status === "signed") return true;
	if (status === "cancelled") return false;
	return undefined;
}

/**
 * Cómo se llama el contrato en la papelería del inversionista.
 *
 * Con la fecha de emisión pegada al nombre porque un inversionista compra
 * cartera varias veces con los meses, y cada compra emite los mismos tipos de
 * contrato. Sin la fecha, la papelería termina con tres filas idénticas
 * llamadas "Contrato de Participación" y nadie sabe cuál es de cuál.
 *
 * Se arma acá y no en cartera para que la copia sea siempre la misma: el
 * espejo se vuelve a mandar en cada firma, y un nombre que cambiara entre
 * envíos renombraría el documento a media vida.
 */
function nombreEnLaPapeleria(contrato: {
	contractName: string;
	generatedAt: Date | string | null;
}): string {
	// Sin fecha se manda el nombre pelado: todo esto es best-effort y un error
	// acá no se ve en ninguna pantalla, así que no se arriesga la copia por el
	// nombre.
	const emitido = contrato.generatedAt ? new Date(contrato.generatedAt) : null;
	if (!emitido || Number.isNaN(emitido.getTime())) return contrato.contractName;

	const fecha = emitido.toLocaleDateString("es-GT", {
		day: "2-digit",
		month: "2-digit",
		year: "numeric",
		timeZone: "America/Guatemala",
	});
	return `${contrato.contractName} — ${fecha}`;
}

/**
 * Copia el contrato firmado en la papelería del inversionista, en cartera.
 *
 * **Sólo firmado.** Mientras se firma, el contrato ya se ve en la tarjeta de
 * contratos de la ficha, con sus enlaces; copiarlo antes llenaba "Documentos"
 * de borradores ocultos —y de anulados— que nadie iba a mostrar. La papelería
 * es de documentos que valen, y ahí entra visible.
 *
 * El PDF se baja de R2 con la key guardada, no con la URL firmada que se le
 * muestra a la gente: esa vence en una hora.
 */
export async function espejarContratoEnCartera(
	contractId: string,
	createdBy?: string,
	/** PDF a copiar. Por defecto, el mejor que haya en R2. */
	pdf?: Blob,
): Promise<boolean> {
	try {
		const contrato = await contratoConDueno(contractId);
		if (!contrato || contrato.status !== "signed") return false;

		// El firmado manda: en la papelería tiene que estar el documento que vale,
		// no el borrador. Se lee de nuestra copia en R2, así que volver a copiar un
		// contrato ya cerrado no le pregunta nada a WeeTrust.
		const key = contrato.signedPdfLink ?? contrato.pdfLink;

		if (!pdf && !key) {
			console.warn(
				`[espejo-contratos] el contrato ${contractId} no tiene PDF: no se copia a cartera`,
			);
			return false;
		}

		const archivo = pdf ?? (await bajarPdfDeR2(key as string));

		await carteraBackClient.upsertInvestorContractDocument({
			file: archivo,
			inversionista_id: contrato.investorId as number,
			contrato_id: contrato.id,
			nombre: nombreEnLaPapeleria(contrato),
			tipo_contrato: contrato.contractType,
			weetrust_document_id: contrato.weetrustDocumentId,
			observer_url: contrato.observerUrl,
			firmantes: await firmantesDelContrato(contractId),
			estado_firma: contrato.status,
			created_by: createdBy,
			// Firmado: entra visible, en la ficha y en el portal.
			visible: true,
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
 * Baja de WeeTrust el PDF firmado y lo guarda en R2.
 *
 * Se le pide a WeeTrust **una sola vez**: la marca es `signedPdfLink`. Antes la
 * decisión era "el estado acaba de cambiar a firmado", que dependía de lo que
 * contestara cartera; preguntándole a la propia base, ni un webhook repetido lo
 * vuelve a bajar ni se queda sin archivo un contrato que firmaron antes de que
 * existiera su copia en cartera.
 *
 * El borrador no se pisa: `pdfLink` es el que se vuelve a subir si hay que
 * reemitir el documento, y reemitir con el firmado mandaría a firmar un PDF que
 * ya trae firmas estampadas.
 *
 * Best-effort: si WeeTrust no lo entrega, el contrato igual quedó firmado y lo
 * que se sigue viendo es el borrador. Se reintenta en la próxima consulta de
 * estado.
 */
async function guardarElPdfFirmado(contrato: {
	id: string;
	weetrustDocumentId: string | null;
}): Promise<Blob | null> {
	if (!contrato.weetrustDocumentId) return null;

	try {
		const firmado = await descargarPdfFirmado(contrato.weetrustDocumentId);
		const key = await uploadPdfWithBucketInKey(
			`legal-contracts/firmados/${contrato.id}.pdf`,
			Buffer.from(await firmado.arrayBuffer()),
		);

		await db
			.update(generatedLegalContracts)
			.set({ signedPdfLink: key, updatedAt: new Date() })
			.where(eq(generatedLegalContracts.id, contrato.id));

		return firmado;
	} catch (error) {
		console.error(
			`[espejo-contratos] no se pudo guardar el PDF firmado de ${contrato.id}:`,
			error,
		);
		return null;
	}
}

/**
 * Lleva a la papelería de cartera lo que cambió de un contrato.
 *
 * Sale de la única puerta de escritura del estado (`sincronizarEstadoDeFirma`),
 * así que se dispara tanto con el webhook de WeeTrust como con el botón de
 * actualizar estado, y también al anular y al reemplazar.
 *
 * - Firmado: se copia con el PDF firmado, visible. Es el momento en que entra.
 * - Anulado: si estaba copiado (uno firmado que después se anuló, o uno de
 *   antes de que sólo entraran los firmados), se oculta.
 * - Mientras se firma: nada. Se ve en la tarjeta de contratos de la ficha.
 */
export async function espejarEstadoDeFirmaEnCartera(
	contractId: string,
): Promise<boolean> {
	try {
		const contrato = await contratoConDueno(contractId);
		if (!contrato || contrato.status === "pending") return false;

		// Quedó firmado y todavía no tenemos su PDF firmado: se baja ahora, una
		// sola vez, y con ese mismo archivo se actualizan los dos lados. Va antes
		// del PATCH porque copiar el contrato entero ya manda el estado y los
		// firmantes: el PATCH sería el mismo viaje dos veces.
		if (contrato.status === "signed" && !contrato.signedPdfLink) {
			const firmado = await guardarElPdfFirmado(contrato);
			if (firmado) {
				return espejarContratoEnCartera(contractId, undefined, firmado);
			}
		}

		const { espejado } =
			await carteraBackClient.updateInvestorContractDocumentState({
				contrato_id: contrato.id,
				observer_url: contrato.observerUrl,
				firmantes: await firmantesDelContrato(contractId),
				estado_firma: contrato.status,
				visible: visibilidadEnElPortal(contrato.status),
			});

		// Firmado y todavía sin copiar (la copia pudo fallar la primera vez): se
		// copia ahora, con PDF y todo. Un anulado que no estaba copiado se queda
		// así: a la papelería sólo entran los que valen.
		if (espejado === false && contrato.status === "signed") {
			return espejarContratoEnCartera(contractId);
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
