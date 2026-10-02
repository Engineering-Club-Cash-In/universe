import { and, desc, eq, inArray, isNull, like, ne } from "drizzle-orm";
import { db } from "../db";
import { opportunities } from "../db/schema/crm";
import {
	contractGenerationSnapshots,
	generatedLegalContracts,
} from "../db/schema/legal-contracts";
import { fueSubidoAMano } from "./contrato-subido-a-mano";

/**
 * La fecha de vencimiento que dice el contrato del crédito (el reconocimiento
 * de deuda), no la que calcula cartera.
 *
 * Cartera arma el calendario desde la formalización y su última cuota cae un
 * mes antes (y a veces otro día) que lo que jurídico puso en el contrato: de
 * 766 créditos con datos del contrato, 689 vencen un mes después en el
 * contrato (01-oct-2026). Los contratos de inversión citan el vencimiento del
 * crédito, así que tiene que ser el del contrato.
 */

const TIPO_RECONOCIMIENTO = "reconocimiento_deuda";

/** Una fecha que exista, como "AAAA-MM-DD"; si no, null. */
function fechaValida(diaRaw: unknown, mesRaw: unknown, anioRaw: unknown) {
	const dia = Number(diaRaw);
	const mes = Number(mesRaw);
	let anio = Number(anioRaw);
	if (!dia || !mes || !anio) return null;
	// El wizard lo guarda con dos cifras ("29" es 2029).
	if (anio < 100) anio += 2000;

	// Un 31 de un mes de 30 días no es una fecha.
	const fecha = new Date(Date.UTC(anio, mes - 1, dia));
	if (
		fecha.getUTCFullYear() !== anio ||
		fecha.getUTCMonth() !== mes - 1 ||
		fecha.getUTCDate() !== dia
	) {
		return null;
	}
	return fecha.toISOString().slice(0, 10);
}

/** El vencimiento a partir de los campos con que se generó un contrato. */
export function vencimientoDeLosDatos(data: unknown): string | null {
	if (!data || typeof data !== "object") return null;
	const campos = data as Record<string, unknown>;
	return fechaValida(
		campos.diaVencimiento,
		campos.mesVencimiento,
		campos.anoVencimiento,
	);
}

/**
 * El vencimiento de un snapshot de generación (`contract_generation_snapshots`).
 *
 * Prefiere la entrada del reconocimiento de deuda; si no la hay, cualquiera que
 * tenga la fecha (el wizard pone la misma en todas).
 */
export function vencimientoDelSnapshot(data: unknown): string | null {
	const entradas = (Array.isArray(data) ? data : [data]) as Array<{
		contractType?: unknown;
		data?: unknown;
	} | null>;
	const delReconocimiento = entradas.filter((e) =>
		String(e?.contractType ?? "").startsWith(TIPO_RECONOCIMIENTO),
	);
	for (const entrada of [...delReconocimiento, ...entradas]) {
		const fecha = vencimientoDeLosDatos(entrada?.data);
		if (fecha) return fecha;
	}
	return null;
}

/**
 * El vencimiento guardado en el propio contrato.
 *
 * Desde ahora se guarda al enlazarlo o regenerarlo (`vencimientoDelContrato`).
 * Los de la época de Documenso traen los campos en `data[].values[]`.
 */
export function vencimientoGuardado(apiResponse: unknown): string | null {
	if (!apiResponse || typeof apiResponse !== "object") return null;
	const respuesta = apiResponse as {
		vencimientoDelContrato?: unknown;
		data?: unknown;
	};
	if (
		typeof respuesta.vencimientoDelContrato === "string" &&
		/^\d{4}-\d{2}-\d{2}$/.test(respuesta.vencimientoDelContrato)
	) {
		return respuesta.vencimientoDelContrato;
	}

	if (!Array.isArray(respuesta.data)) return null;
	for (const firmante of respuesta.data) {
		const valores = (firmante as { values?: unknown } | null)?.values;
		if (!Array.isArray(valores)) continue;
		const campo = (nombre: string) =>
			(valores as Array<{ field?: unknown; value?: unknown }>).find(
				(v) => v?.field === nombre,
			)?.value;
		const fecha = fechaValida(
			campo("diaVencimiento"),
			campo("mesVencimiento"),
			campo("anoVencimiento"),
		);
		if (fecha) return fecha;
	}
	return null;
}

/**
 * Le agrega a la respuesta del generador el vencimiento con que se generó el
 * contrato, para leerlo después del contrato mismo y no de un snapshot que
 * puede ser de otra generación.
 */
export function conVencimientoDelContrato<T>(
	apiResponse: T,
	data: unknown,
): T | (T & { vencimientoDelContrato: string }) {
	const fecha = vencimientoDeLosDatos(data);
	if (!fecha || !apiResponse || typeof apiResponse !== "object") {
		return apiResponse;
	}
	return { ...apiResponse, vencimientoDelContrato: fecha };
}

/**
 * Cuánto antes y después del contrato puede estar el snapshot de su misma
 * generación.
 *
 * Después: el enlace guarda los contratos y enseguida el snapshot. Antes: el
 * reconocimiento a veces se sube aparte, con el PDF que salió de esa
 * generación, minutos después de enlazar el resto. En prod, los que se subieron
 * así están entre 0 y 55 minutos del snapshot; los siguientes saltan a 18 horas
 * o más, y ahí ya no hay forma de saber que el PDF es de esa generación.
 */
const ANTES_DEL_CONTRATO_MS = 60 * 60 * 1000;
const DESPUES_DEL_CONTRATO_MS = 10 * 60 * 1000;

/**
 * El snapshot de la misma generación que el contrato: el más reciente dentro de
 * la ventana. Uno de después puede ser de una generación en la que el
 * reconocimiento falló; uno de mucho antes, de una generación que no es la del
 * PDF que quedó.
 */
export function snapshotDeLaMismaGeneracion<T extends { createdAt: Date }>(
	contratoCreadoEn: Date,
	snapshotsDelMasNuevo: T[],
): T | undefined {
	const desde = contratoCreadoEn.getTime() - ANTES_DEL_CONTRATO_MS;
	const hasta = contratoCreadoEn.getTime() + DESPUES_DEL_CONTRATO_MS;
	return snapshotsDelMasNuevo.find((s) => {
		const t = s.createdAt.getTime();
		return t >= desde && t <= hasta;
	});
}

/**
 * Número de crédito (el de cartera, `CRM-…`) → vencimiento del contrato.
 *
 * Sale del reconocimiento de deuda vigente de la oportunidad:
 * 1. Lo guardado en el propio contrato.
 * 2. Si no tiene, el snapshot de su misma generación (ver
 *    `snapshotDeLaMismaGeneracion`). Nunca si el reconocimiento reemplazó a otro
 *    (regenerado o subido a mano: no se guardaba snapshot al regenerar) ni si
 *    tiene la marca de subido a mano: de un PDF armado por fuera no se sabe la
 *    fecha.
 *
 * Los créditos sin dato confiable no aparecen, y quien llame se queda con lo de
 * cartera.
 */
export async function vencimientosDeContrato(
	numerosDeCredito: string[],
): Promise<Map<string, string>> {
	const vencimientos = new Map<string, string>();
	const numeros = [...new Set(numerosDeCredito.filter(Boolean))];
	if (numeros.length === 0) return vencimientos;

	const reconocimientos = await db
		.select({
			id: generatedLegalContracts.id,
			opportunityId: generatedLegalContracts.opportunityId,
			createdAt: generatedLegalContracts.createdAt,
			apiResponse: generatedLegalContracts.apiResponse,
			numeroSifco: opportunities.numeroSifco,
		})
		.from(generatedLegalContracts)
		.innerJoin(
			opportunities,
			eq(generatedLegalContracts.opportunityId, opportunities.id),
		)
		.where(
			and(
				inArray(opportunities.numeroSifco, numeros),
				like(generatedLegalContracts.contractType, `${TIPO_RECONOCIMIENTO}%`),
				ne(generatedLegalContracts.status, "cancelled"),
				isNull(generatedLegalContracts.replacedByContractId),
			),
		)
		.orderBy(desc(generatedLegalContracts.generatedAt));

	// El vigente de cada crédito: el más reciente.
	const vigentes = new Map<string, (typeof reconocimientos)[number]>();
	for (const r of reconocimientos) {
		if (r.numeroSifco && !vigentes.has(r.numeroSifco)) {
			vigentes.set(r.numeroSifco, r);
		}
	}
	if (vigentes.size === 0) return vencimientos;

	const ids = [...vigentes.values()].map((r) => r.id);
	const reemplazos = new Set(
		(
			await db
				.select({ id: generatedLegalContracts.replacedByContractId })
				.from(generatedLegalContracts)
				.where(inArray(generatedLegalContracts.replacedByContractId, ids))
		).map((f) => f.id),
	);

	const sinDatoPropio: Array<(typeof reconocimientos)[number]> = [];
	for (const [numero, r] of vigentes) {
		const fecha = vencimientoGuardado(r.apiResponse);
		if (fecha) vencimientos.set(numero, fecha);
		else if (
			!reemplazos.has(r.id) &&
			!fueSubidoAMano(r.apiResponse) &&
			r.opportunityId
		) {
			sinDatoPropio.push(r);
		}
	}
	if (sinDatoPropio.length === 0) return vencimientos;

	const snapshots = await db
		.select({
			opportunityId: contractGenerationSnapshots.opportunityId,
			createdAt: contractGenerationSnapshots.createdAt,
			data: contractGenerationSnapshots.data,
		})
		.from(contractGenerationSnapshots)
		.where(
			inArray(
				contractGenerationSnapshots.opportunityId,
				sinDatoPropio.map((r) => r.opportunityId as string),
			),
		)
		.orderBy(desc(contractGenerationSnapshots.createdAt));

	for (const r of sinDatoPropio) {
		const snapshot = snapshotDeLaMismaGeneracion(
			r.createdAt,
			snapshots.filter((s) => s.opportunityId === r.opportunityId),
		);
		const fecha = snapshot ? vencimientoDelSnapshot(snapshot.data) : null;
		if (fecha && r.numeroSifco) vencimientos.set(r.numeroSifco, fecha);
	}
	return vencimientos;
}
