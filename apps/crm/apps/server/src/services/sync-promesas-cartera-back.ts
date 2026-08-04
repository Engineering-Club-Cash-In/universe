/**
 * CB-030 — Reconciliación diaria del espejo de promesas de pago en
 * cartera-back (`promesas_pago_espejo`).
 *
 * El push por evento (lib/push-promesa-cartera-back.ts, disparado al crear
 * una promesa o al marcarla cumplida) mantiene el espejo fresco en el caso
 * normal, pero es best-effort: una falla de red, un deploy a mitad de
 * request, o un flujo de mutación futuro que alguien olvide cablear, dejan
 * la copia desincronizada EN SILENCIO. Este job es la red de seguridad:
 * empuja el set COMPLETO de promesas vigentes (idempotente por
 * contacto_cobros_id, mismo endpoint que el push por evento) justo antes de
 * que corra procesarMoras en cartera-back (23:59 GT) — así cualquier drift
 * acumulado durante el día se corrige antes del cálculo que importa.
 *
 * Manda modo="reconciliacion_completa": el batch es el set COMPLETO de
 * promesas vigentes, así que cartera-back además DESACTIVA toda fila activa
 * que no venga en él. Eso es lo que corrige el drift de verdad — sin ese
 * modo, un push de "cumplida/cancelada" perdido dejaría la fila activa para
 * siempre y el freeze sería zombie. Por la misma razón el batch vacío SÍ se
 * envía cuando de verdad no hay nada vigente hoy: es un estado legítimo, y
 * la única forma de limpiar la última fila activa. La excepción (había
 * promesas vigentes pero ninguna resolvió a un SIFCO) se aborta —
 * ver lib/reconciliacion-promesas.ts.
 *
 * Nunca lanza al caller: devuelve un resumen y loguea (mismo patrón que
 * check-promesas-pago.ts / send-premora-reminders.ts).
 */

import { inArray } from "drizzle-orm";
import { db } from "../db";
import { casosCobros, contactosCobros } from "../db/schema/cobros";
import { toDateStrGT } from "../lib/guatemala-month-window";
import { esPromesaVigente } from "../lib/promesa-vigente";
import { decidirEnvioReconciliacion } from "../lib/reconciliacion-promesas";
import { carteraBackClient } from "./cartera-back-client";
import { isCarteraBackEnabled } from "./cartera-back-integration";

const LOG_PREFIX = "[SyncPromesasCarteraBack]";

export interface SyncPromesasResumen {
	total: number;
	enviadas: number;
	sinCaso: number;
	errores: number;
	skipped?: boolean;
	reason?: string;
	// SIFCOs que cartera-back no pudo resolver a un crédito — visible acá (no
	// solo en el log de error) para que el caller pueda distinguir "todo
	// bien" de "sync parcial silencioso".
	noEncontradas?: string[];
	// true cuando cartera-back reportó fallaTotal (NINGÚN sifco del batch
	// resolvió) — señal fuerte de que algo está mal (ej. drift grande entre
	// las dos DBs), no solo un par de casos sueltos.
	fallaTotal?: boolean;
	// Con qué modo se terminó enviando el batch. "evento" significa que se
	// degradó por drift parcial y NO se limpiaron zombies en esta corrida.
	modo?: "evento" | "reconciliacion_completa";
	// Motivo de la degradación, presente solo cuando modo === "evento".
	degradado?: "drift_parcial";
}

function resumenVacio(
	partial: Partial<SyncPromesasResumen> = {},
): SyncPromesasResumen {
	return { total: 0, enviadas: 0, sinCaso: 0, errores: 0, ...partial };
}

export async function sincronizarPromesasCarteraBack(): Promise<SyncPromesasResumen> {
	try {
		if (!isCarteraBackEnabled()) {
			console.log(`${LOG_PREFIX} Cartera-back deshabilitado; job omitido`);
			return resumenVacio({ skipped: true, reason: "cartera_back_disabled" });
		}

		// Predicado compartido (lib/promesa-vigente.ts): promesa_pago + fecha
		// todavía no vencida + pendiente/null. 'incumplida' NO entra: su fecha
		// ya pasó, así que reenviarla con activa=true solo acumulaba filas
		// muertas en el espejo corrida tras corrida (no rompía el freeze —
		// cartera-back filtra por fecha del lado del read— pero era basura
		// creciendo sin techo). 'cumplida' es terminal y ya se marcó
		// activa=false vía push por evento.
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
			.where(esPromesaVigente());

		// Sin early-return con 0 promesas: el batch vacío es información real
		// ("hoy no hay ninguna vigente") y debe llegar a cartera-back para que
		// desactive lo que haya quedado activo. Cortar acá era justo el agujero
		// por el que la última promesa nunca se limpiaba.
		const casoIds = [...new Set(promesas.map((p) => p.casoCobroId))];
		const casos =
			casoIds.length > 0
				? await db
						.select({
							id: casosCobros.id,
							numeroCreditoSifco: casosCobros.numeroCreditoSifco,
						})
						.from(casosCobros)
						.where(inArray(casosCobros.id, casoIds))
				: [];
		const sifcoPorCaso = new Map(
			casos.map((c) => [c.id, c.numeroCreditoSifco]),
		);

		const resumen = resumenVacio({ total: promesas.length });
		const payload: Array<{
			contacto_cobros_id: string;
			numero_credito_sifco: string;
			cuota_inicio: number | null;
			cuota_fin: number | null;
			incluye_mora: boolean;
			fecha_promesa: string;
			activa: boolean;
		}> = [];

		for (const p of promesas) {
			const sifco = sifcoPorCaso.get(p.casoCobroId);
			if (!sifco || !p.fechaProximoContacto) {
				resumen.sinCaso++;
				continue;
			}
			payload.push({
				contacto_cobros_id: p.id,
				numero_credito_sifco: sifco,
				cuota_inicio: p.cuotaInicio,
				cuota_fin: p.cuotaFin,
				incluye_mora: p.incluyeMora,
				// toDateStrGT, NO toISOString().slice(0,10) — mismo bug/fix que
				// push-promesa-cartera-back.ts: fechaProximoContacto es timestamp
				// con hora real, no medianoche UTC.
				fecha_promesa: toDateStrGT(p.fechaProximoContacto),
				activa: true,
			});
		}

		// Guarda contra desactivación indebida por drift de datos — la regla vive
		// en lib/reconciliacion-promesas.ts (pura, con test propio) porque su
		// filo es sutil: declarar el batch como "completo" hace que cartera-back
		// desactive TODA fila activa ausente de él, y una fila ausente por drift
		// (promesa vigente que no resolvió a un caso con SIFCO) sigue vigente —
		// apagarla la destrabaría justo antes de procesarMoras.
		const decision = decidirEnvioReconciliacion(
			promesas.length,
			payload.length,
		);
		if (!decision.enviar) {
			resumen.errores = promesas.length;
			console.error(
				`${LOG_PREFIX} ABORTADO (${decision.motivo}): ${promesas.length} promesas vigentes pero NINGUNA resolvió a un caso con SIFCO. No se envía batch vacío (desactivaría todo el espejo). Revisar drift entre contactos_cobros y casos_cobros.`,
			);
			return resumen;
		}
		resumen.modo = decision.modo;
		if (decision.modo === "evento") {
			// Degradado: se conserva el upsert de las que sí resolvieron, pero sin
			// declarar el set como completo. Se pierde la limpieza de zombies de
			// ESTA corrida (la próxima la hace, si el drift se resolvió); no se
			// pierde correctitud del freeze.
			resumen.degradado = decision.motivo;
			console.error(
				`${LOG_PREFIX} DEGRADADO a modo="evento" (${decision.motivo}): ${resumen.sinCaso} de ${promesas.length} promesas vigentes no resolvieron a un caso con SIFCO. Se sincroniza lo resuelto SIN desactivar ausentes (evita destrabar promesas todavía vigentes). Revisar drift entre contactos_cobros y casos_cobros.`,
			);
		}

		//
		// El endpoint acepta batch completo — un solo request, idempotente por
		// contacto_cobros_id (upsert). Sin límite de tamaño hoy: el volumen de
		// promesas activas es órdenes de magnitud menor que el de créditos.
		try {
			const result = await carteraBackClient.syncPromesasPago(
				payload,
				decision.modo,
			);
			if (result.success) {
				resumen.enviadas = result.actualizadas ?? payload.length;
				if (result.noEncontradas && result.noEncontradas.length > 0) {
					resumen.noEncontradas = result.noEncontradas;
					console.error(
						`${LOG_PREFIX} SIFCOs no resueltos en cartera-back:`,
						result.noEncontradas,
					);
				}
				if (result.fallaTotal) {
					resumen.fallaTotal = true;
					console.error(
						`${LOG_PREFIX} FALLA TOTAL: ningún sifco del batch resolvió en cartera-back`,
					);
				}
			} else {
				// max(_, 1): con batch vacío (reconciliación de "nada vigente hoy")
				// payload.length es 0, y errores=0 haría ver un fallo como corrida
				// sana en el log y en el resumen. El request falló igual.
				resumen.errores = Math.max(payload.length, 1);
				console.error(
					`${LOG_PREFIX} sync rechazado por cartera-back:`,
					result.message,
				);
			}
		} catch (error) {
			resumen.errores = Math.max(payload.length, 1);
			console.error(`${LOG_PREFIX} Error llamando a cartera-back:`, error);
		}

		// console.error (no .log) cuando se degradó: una corrida degradada NO
		// limpió zombies, así que aunque enviadas/total se vean sanos, la
		// reconciliación de esa noche quedó a medias. Debe salir por el canal
		// que se alerta, no perdido entre los logs de rutina.
		const linea =
			`${LOG_PREFIX} total=${resumen.total} enviadas=${resumen.enviadas} sinCaso=${resumen.sinCaso} errores=${resumen.errores} modo=${resumen.modo}` +
			(resumen.degradado ? ` degradado=${resumen.degradado}` : "") +
			(resumen.noEncontradas
				? ` noEncontradas=${resumen.noEncontradas.length}`
				: "") +
			(resumen.fallaTotal ? " fallaTotal=true" : "");
		if (resumen.degradado || resumen.fallaTotal || resumen.errores > 0) {
			console.error(linea);
		} else {
			console.log(linea);
		}
		return resumen;
	} catch (error) {
		console.error(`${LOG_PREFIX} Error fatal:`, error);
		return resumenVacio({ errores: 1 });
	}
}
