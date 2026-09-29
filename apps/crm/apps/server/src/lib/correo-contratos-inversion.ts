import {
	COMPRA_CARTERA_RECIPIENTS,
	enviarCorreoEnHilo,
	obtenerHiloDeCorreo,
} from "@cci/email";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { db } from "../db";
import { investorContractBatches } from "../db/schema/investor-contracts";
import {
	contractSignatories,
	generatedLegalContracts,
} from "../db/schema/legal-contracts";
import { getFileUrlWithBucketInKey } from "./storage";

/**
 * La key de R2 del PDF de un contrato: el firmado si ya existe, si no el que se
 * emitió.
 *
 * Hay contratos que guardaron en `pdfLink` una URL firmada (la que se muestra,
 * que vence) en vez de la key: con una URL entera como key, R2 no encuentra
 * nada. Para esos queda la key que devolvió el generador.
 */
export function keyDelPdfDelContrato(contrato: {
	pdfLink: string | null;
	signedPdfLink: string | null;
	apiResponse: unknown;
}): string | null {
	const respuesta = contrato.apiResponse as { r2Key?: unknown } | null;
	return (
		contrato.signedPdfLink ||
		(contrato.pdfLink && !/^https?:\/\//i.test(contrato.pdfLink)
			? contrato.pdfLink
			: typeof respuesta?.r2Key === "string"
				? respuesta.r2Key
				: null)
	);
}

/** Por qué sale el correo: cambia el encabezado, no lo que lleva. */
export type MotivoDelCorreo =
	| { tipo: "listo" }
	| { tipo: "agregado" }
	| { tipo: "reemplazo" };

/** Cómo se nombra a quien firma, en el correo. */
const QUIEN_ES: Record<string, string> = {
	TITULAR: "inversionista",
	REP_LEGAL: "representante legal de CUBE",
	REP_LEGAL_RDBE: "representante legal",
	COFIRMANTE: "codeudor",
};

function escapar(texto: string): string {
	return texto
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function quetzales(monto: string): string {
	return `Q${Number(monto).toLocaleString("es-GT", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	})}`;
}

/**
 * Los enlaces de firma agrupados por persona.
 *
 * Es como los venía mandando inversiones a mano: "enlaces del inversionista",
 * "enlaces de Andrés". Quien recibe el correo le pasa a cada uno los suyos, y
 * así no tiene que ir contrato por contrato buscando cuál le toca a quién.
 */
function enlacesPorFirmante(
	contratos: Array<{ id: string; contractName: string }>,
	firmantes: Array<{
		contractId: string;
		role: string;
		name: string;
		email: string;
		signingUrl: string | null;
	}>,
) {
	const nombreDelContrato = new Map(
		contratos.map((c) => [c.id, c.contractName]),
	);
	const porPersona = new Map<
		string,
		{
			nombre: string;
			role: string;
			enlaces: Array<{ contrato: string; url: string }>;
		}
	>();

	for (const f of firmantes) {
		if (!f.signingUrl) continue;
		const clave = f.email.toLowerCase();
		const persona = porPersona.get(clave) ?? {
			nombre: f.name,
			role: f.role,
			enlaces: [],
		};
		persona.enlaces.push({
			contrato: nombreDelContrato.get(f.contractId) ?? "Contrato",
			url: f.signingUrl,
		});
		porPersona.set(clave, persona);
	}

	// El inversionista primero: es el que más espera los suyos.
	return [...porPersona.values()].sort(
		(a, b) => Number(b.role === "TITULAR") - Number(a.role === "TITULAR"),
	);
}

function armarHtml(params: {
	inversionista: string;
	monto: string;
	motivo: MotivoDelCorreo;
	contratos: Array<{ contractName: string }>;
	personas: ReturnType<typeof enlacesPorFirmante>;
	adjuntosFaltantes: string[];
}): string {
	const { inversionista, monto, motivo, contratos, personas } = params;
	const nombres = contratos
		.map((c) => `«${escapar(c.contractName)}»`)
		.join(", ");

	const encabezado =
		motivo.tipo === "listo"
			? `Adjunto los contratos de la compra de ${escapar(inversionista)} por ${quetzales(monto)}, con los enlaces de firma de cada persona.`
			: motivo.tipo === "reemplazo"
				? `Se reemplazó ${nombres} de la compra de ${escapar(inversionista)}. El anterior quedó anulado y sus enlaces ya no sirven: van el nuevo y sus enlaces.`
				: `Se agregó ${nombres} a la compra de ${escapar(inversionista)}. Va adjunto con sus enlaces de firma.`;

	const bloques = personas
		.map((p) => {
			const quien = QUIEN_ES[p.role] ?? p.role.toLowerCase();
			const filas = p.enlaces
				.map(
					(e) => `
          <tr>
            <td style="padding:4px 12px 4px 0;color:#374151;vertical-align:top;">${escapar(e.contrato)}</td>
            <td style="padding:4px 0;"><a href="${escapar(e.url)}" style="color:#2563eb;word-break:break-all;">${escapar(e.url)}</a></td>
          </tr>`,
				)
				.join("");
			return `
      <p style="margin:18px 0 6px 0;font-weight:600;color:#111827;">
        Enlaces de ${escapar(p.nombre)} <span style="font-weight:400;color:#6b7280;">(${escapar(quien)})</span>
      </p>
      <table style="border-collapse:collapse;font-size:14px;">${filas}
      </table>`;
		})
		.join("");

	const faltantes =
		params.adjuntosFaltantes.length > 0
			? `<p style="margin:16px 0 0 0;color:#b45309;">No se pudo adjuntar: ${params.adjuntosFaltantes
					.map((n) => `«${escapar(n)}»`)
					.join(", ")}. Está en la ficha del inversionista.</p>`
			: "";

	return `
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111827;max-width:720px;">
      <p style="margin:0 0 8px 0;">Buen día,</p>
      <p style="margin:0 0 8px 0;">${encabezado}</p>
      ${bloques || '<p style="color:#6b7280;">Este contrato no tiene enlaces de firma.</p>'}
      ${faltantes}
      <p style="margin:20px 0 0 0;color:#6b7280;font-size:12px;">
        Lo manda el CRM cuando jurídico termina de emitir los contratos. Cada enlace es personal: se le pasa sólo a quien le corresponde.
      </p>
    </div>`;
}

/**
 * Contesta en el hilo del correo de "Compra de Cartera aceptada" con los
 * contratos adjuntos y los enlaces de firma de cada persona.
 *
 * Es lo que antes hacían a mano jurídico —"adjunto contratos solicitados"— e
 * inversiones —"envío links correspondientes"— en ese mismo hilo, con la misma
 * gente copiada.
 *
 * Con el hilo guardado (`emailThreadId`) cae dentro de él y le llega a los
 * mismos destinatarios que el original. Sin él —baterías de antes, o un
 * correo de aceptación que no salió— sale igual, con el mismo asunto y a la
 * lista de siempre, pero como correo aparte: sin el Message-ID real no hay
 * forma de colgarlo del hilo.
 */
export async function mandarContratosAlHilo(params: {
	batchId: string;
	contractIds: string[];
	motivo: MotivoDelCorreo;
}): Promise<{ enviado: boolean; enHilo: boolean; error?: string }> {
	const [bateria] = await db
		.select({
			investorName: investorContractBatches.investorName,
			montoTotal: investorContractBatches.montoTotal,
			emailThreadId: investorContractBatches.emailThreadId,
		})
		.from(investorContractBatches)
		.where(eq(investorContractBatches.id, params.batchId))
		.limit(1);

	if (!bateria) {
		return { enviado: false, enHilo: false, error: "La batería no existe" };
	}
	if (params.contractIds.length === 0) {
		return {
			enviado: false,
			enHilo: false,
			error: "No hay contratos que mandar",
		};
	}

	const contratos = await db
		.select({
			id: generatedLegalContracts.id,
			contractName: generatedLegalContracts.contractName,
			pdfLink: generatedLegalContracts.pdfLink,
			signedPdfLink: generatedLegalContracts.signedPdfLink,
			apiResponse: generatedLegalContracts.apiResponse,
		})
		.from(generatedLegalContracts)
		.where(
			and(
				inArray(generatedLegalContracts.id, params.contractIds),
				eq(generatedLegalContracts.batchId, params.batchId),
				ne(generatedLegalContracts.status, "cancelled"),
			),
		)
		.orderBy(asc(generatedLegalContracts.generatedAt));

	if (contratos.length === 0) {
		return {
			enviado: false,
			enHilo: false,
			error: "Esos contratos ya no están vigentes",
		};
	}

	const firmantes = await db
		.select({
			contractId: contractSignatories.contractId,
			role: contractSignatories.role,
			name: contractSignatories.name,
			email: contractSignatories.email,
			signingUrl: contractSignatories.signingUrl,
		})
		.from(contractSignatories)
		.where(
			inArray(
				contractSignatories.contractId,
				contratos.map((c) => c.id),
			),
		)
		.orderBy(asc(contractSignatories.position));

	// Los PDF van como URL firmada: Resend los baja al mandar. Uno que no se
	// pueda firmar no frena el correo; se dice cuál falta.
	const adjuntos: Array<{ filename: string; path: string }> = [];
	const adjuntosFaltantes: string[] = [];
	for (const contrato of contratos) {
		const key = keyDelPdfDelContrato(contrato);
		const url = key
			? await getFileUrlWithBucketInKey(key).catch(() => null)
			: null;
		if (url) {
			adjuntos.push({ filename: `${contrato.contractName}.pdf`, path: url });
		} else {
			adjuntosFaltantes.push(contrato.contractName);
		}
	}

	const hilo = bateria.emailThreadId
		? await obtenerHiloDeCorreo(bateria.emailThreadId)
		: null;

	const asuntoOriginal =
		hilo?.asunto ?? `Compra de Cartera aceptada - ${bateria.investorName}`;
	const asunto = /^re:/i.test(asuntoOriginal)
		? asuntoOriginal
		: `Re: ${asuntoOriginal}`;

	const resultado = await enviarCorreoEnHilo({
		to: hilo?.to.length ? hilo.to : COMPRA_CARTERA_RECIPIENTS.to,
		cc: hilo ? hilo.cc : COMPRA_CARTERA_RECIPIENTS.cc,
		asunto,
		enRespuestaA: hilo?.messageId,
		html: armarHtml({
			inversionista: bateria.investorName,
			monto: bateria.montoTotal,
			motivo: params.motivo,
			contratos,
			personas: enlacesPorFirmante(contratos, firmantes),
			adjuntosFaltantes,
		}),
		adjuntos,
	});

	if (!resultado.success) {
		const error =
			resultado.error instanceof Error
				? resultado.error.message
				: typeof resultado.error === "object" &&
						resultado.error !== null &&
						"message" in resultado.error
					? String((resultado.error as { message: unknown }).message)
					: "Resend no aceptó el correo";
		return { enviado: false, enHilo: Boolean(hilo), error };
	}

	console.log(
		`[mandarContratosAlHilo] ${params.motivo.tipo}: ${contratos.length} contrato(s) de ${bateria.investorName} ${hilo ? "en el hilo" : "FUERA del hilo"} (${resultado.id})`,
	);
	return { enviado: true, enHilo: Boolean(hilo) };
}
