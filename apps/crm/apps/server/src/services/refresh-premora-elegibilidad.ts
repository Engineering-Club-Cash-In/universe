/**
 * CB-010 — Job diario de elegibilidad para la reducción de recordatorios.
 *
 * Refresca la FOTO del comportamiento de pago (`premora_pago_tracking`) de toda
 * la cartera activa preguntándole a cartera-back la racha de cuotas pagadas AL
 * DÍA por crédito. Elegible = racha >= 4 (≈4 meses).
 *
 * Y hace el AUTO-REVOKE: si un crédito que tenía una reducción activa dejó de
 * ser elegible (pagó tarde o entró en mora), apaga su config y avisa al Gerente
 * de Cobros. El sistema propone y también RETIRA solo — el gerente no tiene que
 * vigilar quién dejó de pagar bien.
 *
 * Nunca lanza al caller: devuelve un resumen y loguea (patrón premora).
 */

import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { db } from "../db";
import { casosCobros } from "../db/schema/cobros";
import { notifications } from "../db/schema/notifications";
import {
	premoraPagoTracking,
	premoraReduccionConfig,
} from "../db/schema/premora-reduccion";
import { fetchAllPages } from "../lib/fetch-all-pages";
import { carteraBackClient } from "./cartera-back-client";
import { isCarteraBackEnabled } from "./cartera-back-integration";
import {
	obtenerSupervisoresCobros,
	resolverUsuarioSistemaCobros,
} from "./cobros-notif-helpers";

const LOG_PREFIX = "[PremoraElegibilidad]";

/** Racha mínima de cuotas al día para que un crédito sea elegible (≈4 meses). */
export const RACHA_ELEGIBLE = 4;

export interface ElegibilidadResumen {
	skipped?: boolean;
	reason?: string;
	evaluados: number;
	elegibles: number;
	autoRevocados: number;
}

const resumenVacio = (
	extra?: Partial<ElegibilidadResumen>,
): ElegibilidadResumen => ({
	evaluados: 0,
	elegibles: 0,
	autoRevocados: 0,
	...extra,
});

export async function refreshPremoraElegibilidad(): Promise<ElegibilidadResumen> {
	try {
		if (!isCarteraBackEnabled()) {
			console.log(`${LOG_PREFIX} Cartera-back deshabilitado; job omitido`);
			return resumenVacio({ skipped: true, reason: "cartera_back_disabled" });
		}

		// Marca de esta corrida: las filas que se refrescan quedan con
		// `calculadoAt = runInicio`; las que NO aparezcan hoy (crédito cancelado,
		// ya no ACTIVO o sin cuotas evaluables) quedan con un calculadoAt más
		// viejo y se limpian abajo. Se usa un único instante (no now() por fila)
		// para que la comparación de "no tocado" sea exacta.
		const runInicio = new Date();

		// 1. Comportamiento de pago de TODA la cartera activa, recorriendo todas
		// las páginas (la cartera puede ser de miles; el endpoint pagina).
		const PER_PAGE = 500;
		const filas = await fetchAllPages(
			(page) =>
				carteraBackClient
					.getComportamientoPago({ page, perPage: PER_PAGE })
					.then((r) => ({ data: r.data ?? [], totalPages: r.totalPages })),
			{ perPage: PER_PAGE },
		);
		console.log(`${LOG_PREFIX} ${filas.length} crédito(s) evaluado(s)`);

		const elegibleSet = new Set<string>();

		// 2. Upsert de la foto por crédito (en lotes; puede ser toda la cartera).
		if (filas.length > 0) {
			const CHUNK = 500;
			for (let i = 0; i < filas.length; i += CHUNK) {
				const lote = filas.slice(i, i + CHUNK).map((f) => {
					const elegible = f.racha >= RACHA_ELEGIBLE;
					if (elegible) elegibleSet.add(f.numero_credito_sifco);
					return {
						numeroCreditoSifco: f.numero_credito_sifco,
						creditoId: f.credito_id,
						cliente: f.cliente,
						cuotaMensual: f.cuota_mensual,
						proximaFechaPago: f.proxima_fecha_pago,
						cuotasAlDiaConsecutivas: f.racha,
						ultimaCuotaEvaluada: f.ultima_cuota_evaluada,
						totalVencidas: f.total_vencidas,
						elegible,
						calculadoAt: runInicio,
					};
				});
				await db
					.insert(premoraPagoTracking)
					.values(lote)
					.onConflictDoUpdate({
						target: premoraPagoTracking.numeroCreditoSifco,
						set: {
							creditoId: sql`excluded.credito_id`,
							cliente: sql`excluded.cliente`,
							cuotaMensual: sql`excluded.cuota_mensual`,
							proximaFechaPago: sql`excluded.proxima_fecha_pago`,
							cuotasAlDiaConsecutivas: sql`excluded.cuotas_al_dia_consecutivas`,
							ultimaCuotaEvaluada: sql`excluded.ultima_cuota_evaluada`,
							totalVencidas: sql`excluded.total_vencidas`,
							elegible: sql`excluded.elegible`,
							calculadoAt: sql`excluded.calculado_at`,
							updatedAt: sql`now()`,
						},
					});
			}
		}

		// 2b. Limpiar elegibilidad STALE: cualquier fila que NO se refrescó en
		//     esta corrida (calculadoAt < runInicio) ya no está en la cartera
		//     evaluable → deja de ser elegible. Sin esto, un crédito cancelado o
		//     que dejó de ser ACTIVO seguiría apareciendo como configurable en el
		//     módulo del gerente (que confía en elegible=true). El fetch fue
		//     exitoso (si cartera falla, fetchAllPages lanza y no llegamos acá),
		//     así que un resultado vacío es un "nadie califica hoy" legítimo.
		await db
			.update(premoraPagoTracking)
			.set({ elegible: false, updatedAt: sql`now()` })
			.where(
				and(
					lt(premoraPagoTracking.calculadoAt, runInicio),
					eq(premoraPagoTracking.elegible, true),
				),
			);

		// 3. Auto-revoke: cualquier config ACTIVA cuyo crédito ya NO es elegible
		//    (bajó la racha o dejó de estar en la cartera activa) se apaga. Se
		//    compara contra el set fresco — no contra la tabla tracking — para
		//    cubrir también a los créditos que desaparecieron del resultado.
		const configsActivas = await db
			.select({
				id: premoraReduccionConfig.id,
				numeroCreditoSifco: premoraReduccionConfig.numeroCreditoSifco,
			})
			.from(premoraReduccionConfig)
			.where(eq(premoraReduccionConfig.activo, true));

		const aRevocar = configsActivas.filter(
			(c) => !elegibleSet.has(c.numeroCreditoSifco),
		);

		let autoRevocados = 0;
		if (aRevocar.length > 0) {
			const ids = aRevocar.map((c) => c.id);
			await db
				.update(premoraReduccionConfig)
				.set({
					activo: false,
					revocadoAt: sql`now()`,
					revocadoMotivo: "auto",
					updatedAt: sql`now()`,
				})
				.where(inArray(premoraReduccionConfig.id, ids));
			autoRevocados = aRevocar.length;

			await notificarAutoRevoke(aRevocar.map((c) => c.numeroCreditoSifco));
		}

		const resumen = resumenVacio({
			evaluados: filas.length,
			elegibles: elegibleSet.size,
			autoRevocados,
		});
		console.log(
			`${LOG_PREFIX} Resumen: ${resumen.evaluados} evaluados · ${resumen.elegibles} elegibles · ${resumen.autoRevocados} auto-revocados`,
		);
		return resumen;
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		console.error(`${LOG_PREFIX} Error no controlado: ${msg}`);
		return resumenVacio({ skipped: true, reason: msg });
	}
}

/**
 * Avisa al Gerente de Cobros (todos los `cobros_supervisor`) que se retiró la
 * reducción de un crédito porque dejó de pagar al día. Notificación simple
 * (sin `cobros_tipo`): es un aviso de gestión, no una de las tres alertas de
 * asesor. Redirige al detalle de cobros si el crédito tiene caso.
 */
async function notificarAutoRevoke(sifcos: string[]): Promise<void> {
	try {
		const supervisores = await obtenerSupervisoresCobros();
		if (supervisores.length === 0) return;
		const usuarioSistema = await resolverUsuarioSistemaCobros();
		if (!usuarioSistema) {
			console.error(
				`${LOG_PREFIX} Sin usuario sistema; no se notifica el auto-revoke`,
			);
			return;
		}

		// Caso de cobros por SIFCO (para el redirect al detalle 360 si existe).
		const casos = await db
			.select({
				id: casosCobros.id,
				numeroCreditoSifco: casosCobros.numeroCreditoSifco,
			})
			.from(casosCobros)
			.where(inArray(casosCobros.numeroCreditoSifco, sifcos));
		const casoPorSifco = new Map(
			casos.map((c) => [c.numeroCreditoSifco ?? "", c.id]),
		);

		const filas = sifcos.flatMap((sifco) => {
			const casoId = casoPorSifco.get(sifco) ?? null;
			return supervisores.map((supervisorId) => ({
				titulo: "Reducción de recordatorios retirada",
				descripcion: `El crédito ${sifco} dejó de pagar al día, así que el sistema restauró sus recordatorios premora completos. Revisa su gestión.`,
				type: "aviso" as const,
				status: "pending" as const,
				createdBy: usuarioSistema,
				createdByRole: "cobros_supervisor" as const,
				assignedToRole: "cobros_supervisor" as const,
				assignedTo: supervisorId,
				...(casoId
					? {
							relatedEntityType: "collection_case" as const,
							relatedEntityId: casoId,
							redirectPage: "cobros_detail" as const,
						}
					: {}),
			}));
		});

		if (filas.length > 0) await db.insert(notifications).values(filas);
	} catch (err) {
		console.error(`${LOG_PREFIX} Error notificando auto-revoke:`, err);
	}
}
