/**
 * CB-020 — Cierre nocturno de Promesas de Pago.
 *
 * getEstadoPromesasPago (routers/cobros.ts) recalcula el estado de una
 * promesa cada vez que un asesor abre el caso — pero si nadie lo abre, una
 * promesa vencida se queda "pendiente" indefinidamente. Este job corre TODAS
 * las noches y evalúa TODAS las promesas activas (pendiente o incumplida —
 * una incumplida puede volverse cumplida si el cliente pagó después) sin
 * depender de que alguien visite la página del caso.
 *
 * Usa la MISMA lógica pura que el endpoint on-demand (lib/promesa-pago.ts) —
 * una sola fuente de verdad, no se puede divergir entre ambos caminos.
 *
 * Nunca lanza al caller: devuelve un resumen y loguea (patrón premora).
 */

import { and, eq, inArray, isNull, ne, or } from "drizzle-orm";
import { db } from "../db";
import { casosCobros, contactosCobros } from "../db/schema/cobros";
import {
	derivarEstadoCredito,
	type EstadoPromesa,
	evaluarPromesa,
} from "../lib/promesa-pago";
import { carteraBackClient } from "./cartera-back-client";
import { isCarteraBackEnabled } from "./cartera-back-integration";

const LOG_PREFIX = "[PromesasPago]";

export interface CheckPromesasResumen {
	evaluadas: number;
	cumplidas: number;
	incumplidas: number;
	pendientes: number;
	sinCaso: number;
	errores: number;
	skipped?: boolean;
	reason?: string;
}

function resumenVacio(
	partial: Partial<CheckPromesasResumen> = {},
): CheckPromesasResumen {
	return {
		evaluadas: 0,
		cumplidas: 0,
		incumplidas: 0,
		pendientes: 0,
		sinCaso: 0,
		errores: 0,
		...partial,
	};
}

export async function checkPromesasPago(): Promise<CheckPromesasResumen> {
	try {
		if (!isCarteraBackEnabled()) {
			console.log(`${LOG_PREFIX} Cartera-back deshabilitado; job omitido`);
			return resumenVacio({ skipped: true, reason: "cartera_back_disabled" });
		}

		// 1. Promesas activas — pendiente O incumplida (una incumplida puede
		// pasar a cumplida si el cliente pagó después de que se marcó así).
		// "cumplida" no se re-evalúa: es terminal, no hay forma de "des-cumplir".
		const promesas = await db
			.select({
				id: contactosCobros.id,
				casoCobroId: contactosCobros.casoCobroId,
				cuotaInicio: contactosCobros.cuotaInicio,
				cuotaFin: contactosCobros.cuotaFin,
				incluyeMora: contactosCobros.incluyeMora,
				fechaProximoContacto: contactosCobros.fechaProximoContacto,
			})
			.from(contactosCobros)
			.where(
				and(
					eq(contactosCobros.estadoContacto, "promesa_pago"),
					or(
						isNull(contactosCobros.estadoPromesa),
						ne(contactosCobros.estadoPromesa, "cumplida"),
					),
				),
			);

		if (promesas.length === 0) return resumenVacio();
		// evaluadas NO se fija aquí — se calcula al final como cumplidas +
		// incumplidas + pendientes, así siempre cuadra con lo que realmente se
		// evaluó (promesas.length incluye filas que después se saltan por
		// sinCaso o fecha faltante, y fijar evaluadas=promesas.length de
		// entrada dejaba el log desalineado: "evaluó N" pero solo sumaba N-X).
		const resumen = resumenVacio();

		// 2. Batch: numeroCreditoSifco de cada caso (la llave hacia cartera-back).
		const casoIds = [...new Set(promesas.map((p) => p.casoCobroId))];
		const casos = await db
			.select({
				id: casosCobros.id,
				numeroCreditoSifco: casosCobros.numeroCreditoSifco,
			})
			.from(casosCobros)
			.where(inArray(casosCobros.id, casoIds));
		const sifcoPorCaso = new Map(
			casos.map((c) => [c.id, c.numeroCreditoSifco]),
		);

		// 3. Agrupar promesas por SIFCO — un solo getCredito por crédito, sin
		// importar cuántas promesas tenga (varias comparten la misma foto).
		const promesasPorSifco = new Map<string, typeof promesas>();
		for (const promesa of promesas) {
			const sifco = sifcoPorCaso.get(promesa.casoCobroId);
			if (!sifco) {
				resumen.sinCaso++;
				continue;
			}
			const grupo = promesasPorSifco.get(sifco) ?? [];
			grupo.push(promesa);
			promesasPorSifco.set(sifco, grupo);
		}

		const hoy = new Date();
		for (const [sifco, grupo] of promesasPorSifco) {
			try {
				const credito = await carteraBackClient.getCredito(sifco);
				const estadoCredito = derivarEstadoCredito(credito);

				const actualizaciones: Array<{ id: string; estado: EstadoPromesa }> =
					[];
				for (const promesa of grupo) {
					if (!promesa.fechaProximoContacto) continue; // fecha obligatoria en el modal, defensivo
					const estado = evaluarPromesa(
						{
							id: promesa.id,
							cuotaInicio: promesa.cuotaInicio,
							cuotaFin: promesa.cuotaFin,
							incluyeMora: promesa.incluyeMora,
							fechaPrometida: promesa.fechaProximoContacto,
						},
						estadoCredito,
						hoy,
					);
					actualizaciones.push({ id: promesa.id, estado });
					if (estado === "cumplida") resumen.cumplidas++;
					else if (estado === "incumplida") resumen.incumplidas++;
					else resumen.pendientes++;
				}

				// allSettled, no all: un UPDATE que falle no debe tumbar los demás
				// del mismo crédito — con Promise.all, una fila mala bloqueaba la
				// persistencia de TODAS sus hermanas (aunque ya se hubieran
				// calculado bien), y el catch de abajo las contaba a todas como
				// error aunque solo una fallara.
				const resultados = await Promise.allSettled(
					actualizaciones.map(({ id, estado }) =>
						db
							.update(contactosCobros)
							.set({ estadoPromesa: estado })
							.where(eq(contactosCobros.id, id)),
					),
				);
				for (let i = 0; i < resultados.length; i++) {
					const resultado = resultados[i];
					if (resultado.status === "rejected") {
						const { estado } = actualizaciones[i];
						// Revertir el conteo de éxito hecho arriba — la evaluación fue
						// correcta pero la escritura falló, no debe contar como logro.
						if (estado === "cumplida") resumen.cumplidas--;
						else if (estado === "incumplida") resumen.incumplidas--;
						else resumen.pendientes--;
						resumen.errores++;
						console.error(
							`${LOG_PREFIX} Error persistiendo promesa ${actualizaciones[i].id}:`,
							resultado.reason,
						);
					}
				}
			} catch (error) {
				resumen.errores += grupo.length;
				console.error(
					`${LOG_PREFIX} Error evaluando promesas del crédito ${sifco}:`,
					error,
				);
			}
		}

		// evaluadas = suma real de lo que se resolvió, no promesas.length (que
		// incluía sinCaso/fecha-faltante/errores de credito no evaluados).
		resumen.evaluadas =
			resumen.cumplidas + resumen.incumplidas + resumen.pendientes;

		console.log(
			`${LOG_PREFIX} ${resumen.evaluadas} evaluada(s) → ${resumen.cumplidas} cumplida(s), ${resumen.incumplidas} incumplida(s), ${resumen.pendientes} pendiente(s), ${resumen.sinCaso} sin caso, ${resumen.errores} error(es)`,
		);
		return resumen;
	} catch (err) {
		console.error(`${LOG_PREFIX} Error general del job:`, err);
		return resumenVacio({ errores: 1 });
	}
}
