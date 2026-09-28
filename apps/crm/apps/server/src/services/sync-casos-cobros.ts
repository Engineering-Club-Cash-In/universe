/**
 * Servicio de Sincronización de Casos de Cobros
 * Sincroniza casos de cobros del CRM con créditos morosos de cartera-back
 */

import { and, desc, eq } from "drizzle-orm";
import { db } from "../db";
import { user } from "../db/schema/auth";
import {
	carteraBackReferences,
	carteraBackSyncLog,
} from "../db/schema/cartera-back";
import {
	casosCobros,
	contratosFinanciamiento,
	type estadoMoraEnum,
} from "../db/schema/cobros";
import { leads } from "../db/schema/crm";
import { fetchAllPages } from "../lib/fetch-all-pages";
import { calcularDiasMoraExactos } from "../lib/mora-utils";
import { estadoMoraPorCuotas } from "../lib/moraBuckets";
import { createNotification } from "../routers/notifications";
import type { StatusCreditEnum } from "../types/cartera-back";
import { carteraBackClient } from "./cartera-back-client";
import { isCarteraBackEnabled } from "./cartera-back-integration";
import { resolverUsuarioSistemaCobros } from "./cobros-notif-helpers";
import { debeCrearCasoCobros } from "./sync-casos-cobros.politica";

type EstadoMoraEnum = (typeof estadoMoraEnum.enumValues)[number];

// ============================================================================
// MAPEO DE ESTADOS
// ============================================================================

/**
 * Mapea el estado de cartera-back a estado de mora del CRM.
 *
 * La etapa de aging se clasifica por CUOTAS ATRASADAS vía MORA_BUCKETS (misma
 * fuente que el embudo, la tabla y los reportes), NO por días. Antes se usaba
 * `diasMora` con cortes <=30/60/90/120, pero como los días exactos no equivalen
 * a `cuotas * 30`, un crédito en el borde B4/B5 (ej. 4 cuotas con 125 días)
 * quedaba clasificado distinto que en el resto de la vista. Ahora coincide.
 */
function mapearEstadoMora(
	cuotasAtrasadas: number,
	statusCredit: StatusCreditEnum,
): EstadoMoraEnum {
	// Si el crédito está cancelado o incobrable, usar esos estados
	if (statusCredit === "CANCELADO") return "pagado";
	if (statusCredit === "INCOBRABLE") return "incobrable";

	// Etapa de aging por cuotas atrasadas (MORA_BUCKETS).
	return estadoMoraPorCuotas(cuotasAtrasadas) as EstadoMoraEnum;
}

/**
 * Orden de severidad de mora (mayor número = peor)
 */
const MORA_SEVERITY: Record<string, number> = {
	al_dia: 0,
	mora_30: 1,
	mora_60: 2,
	mora_90: 3,
	mora_120: 4,
	mora_120_plus: 5,
	pagado: -1,
	incobrable: 6,
};

function moraEscalo(estadoAnterior: string, estadoNuevo: string): boolean {
	return (
		(MORA_SEVERITY[estadoNuevo] ?? 0) > (MORA_SEVERITY[estadoAnterior] ?? 0)
	);
}

// A QUIÉN AVISAR
// ============================================================================
//
// Este job NO asigna casos. Antes repartía cada caso nuevo al agente con menos
// casos (columna casos_cobros.responsable_cobros), una asignación paralela a la
// de cartera que casi nunca coincidía con ella. La asignación vive en CARTERA
// (el asesor del crédito): el aviso va a ese asesor, por el puente de correo
// de siempre (`asesores.email_cash_in` == `user.email`).

/** Mapa correo → usuario del CRM, armado una vez por corrida. */
async function usuariosPorCorreo(): Promise<Map<string, string>> {
	const usuarios = await db
		.select({ id: user.id, email: user.email })
		.from(user);
	return new Map(usuarios.map((u) => [u.email.trim().toLowerCase(), u.id]));
}

// ============================================================================
// SINCRONIZACIÓN PRINCIPAL
// ============================================================================

export interface SyncCobrosOptions {
	mes?: number; // Si no se provee, usa mes actual
	anio?: number; // Si no se provee, usa año actual
	forceSyncAll?: boolean; // Forzar sincronización de todos los créditos (no solo morosos)
	userId?: string; // Usuario que ejecuta la sincronización
}

export interface SyncCobrosResult {
	success: boolean;
	casosCreados: number;
	casosActualizados: number;
	casosCerrados: number;
	errors: string[];
	duration: number;
}

/**
 * Sincroniza casos de cobros con cartera-back
 * - Crea casos para créditos morosos nuevos
 * - Actualiza casos existentes con datos actualizados
 * - Cierra casos cuando los créditos están al día
 */
export async function sincronizarCasosCobros(
	options: SyncCobrosOptions = {},
): Promise<SyncCobrosResult> {
	if (!isCarteraBackEnabled()) {
		return {
			success: false,
			casosCreados: 0,
			casosActualizados: 0,
			casosCerrados: 0,
			errors: ["Integración con cartera-back no está habilitada"],
			duration: 0,
		};
	}

	const startTime = Date.now();
	const now = new Date();
	const mes = options.mes !== undefined ? options.mes : now.getMonth() + 1;
	const anio = options.anio || now.getFullYear();

	const result: SyncCobrosResult = {
		success: true,
		casosCreados: 0,
		casosActualizados: 0,
		casosCerrados: 0,
		errors: [],
		duration: 0,
	};

	console.log(`[SyncCobros] Iniciando sincronización para ${mes}/${anio}`);

	try {
		// 1. Obtener créditos de cartera-back
		let creditos: Awaited<
			ReturnType<typeof carteraBackClient.getAllCreditos>
		>["data"];

		if (options.forceSyncAll) {
			// Obtener TODOS los créditos (todos los estados)
			// Cartera-back requiere el parámetro 'estado', así que debemos llamar por cada estado
			const estados: Array<
				| "ACTIVO"
				| "CANCELADO"
				| "INCOBRABLE"
				| "PENDIENTE_CANCELACION"
				| "MOROSO"
				| "EN_RECUPERACION"
			> = [
				"ACTIVO",
				"CANCELADO",
				"INCOBRABLE",
				"PENDIENTE_CANCELACION",
				"MOROSO",
				// COBROS-02 Fase 4 — mismos créditos que antes venían como MOROSO.
				"EN_RECUPERACION",
			];

			// allSettled en vez de Promise.all: si un estado falla (red, cartera-back
			// caído, etc.) no debe tumbar la sync de los otros 4 estados que sí
			// tenían datos válidos -- se loguea el error y se sigue con el resto.
			const resultadosPorEstado = await Promise.allSettled(
				estados.map((estado) =>
					fetchAllPages(
						(page) =>
							carteraBackClient.getAllCreditos({
								mes,
								anio,
								estado,
								page,
								perPage: 10000,
							}),
						{ concurrency: 3 },
					),
				),
			);

			creditos = [];
			let estadosExitosos = 0;
			for (let i = 0; i < resultadosPorEstado.length; i++) {
				const resultado = resultadosPorEstado[i];
				if (resultado.status === "fulfilled") {
					estadosExitosos++;
					creditos.push(...resultado.value);
				} else {
					const mensaje =
						resultado.reason instanceof Error
							? resultado.reason.message
							: String(resultado.reason);
					console.error(
						`[SyncCobros] Falló obtener créditos del estado ${estados[i]}:`,
						mensaje,
					);
					result.errors.push(
						`Estado ${estados[i]}: no se pudo obtener créditos de cartera-back (${mensaje})`,
					);
				}
			}

			// Si NINGÚN estado trajo datos, no es una sync parcial exitosa con 0
			// créditos -- es un fallo total (cartera-back caído, auth rota, etc.).
			// Marcar success:false para que el caller no lo confunda con "sync
			// corrió bien, la cartera está vacía este mes". No se corta el flujo
			// (return) para que el log a carteraBackSyncLog al final igual quede
			// registrado con status "error" (ya lo detecta por result.errors).
			if (estadosExitosos === 0) {
				result.success = false;
			}
		} else {
			// Créditos en mora — paginar hasta agotar resultados.
			//
			// `EN_RECUPERACION` va junto a `MOROSO` (COBROS-02 Fase 4): es el mismo
			// crédito moroso al que además se le decidió recuperar la unidad, y
			// traer solo MOROSO lo dejaba sin refrescar su caso. Con allSettled por
			// las mismas razones que el force-sync: que un estado falle no debe
			// tumbar al otro.
			const estadosEnMora = ["MOROSO", "EN_RECUPERACION"] as const;
			const porEstado = await Promise.allSettled(
				estadosEnMora.map((estado) =>
					fetchAllPages((page) =>
						carteraBackClient.getAllCreditos({
							mes,
							anio,
							estado,
							page,
							perPage: 1000,
						}),
					),
				),
			);
			creditos = [];
			porEstado.forEach((resultado, i) => {
				if (resultado.status === "fulfilled") {
					creditos.push(...resultado.value);
				} else {
					console.error(
						`[SyncCobros] Falló la consulta de créditos ${estadosEnMora[i]}:`,
						resultado.reason,
					);
					result.success = false;
					// Al log también (review de Codex, P2): su status sale SOLO de
					// `result.errors.length`, así que sin esto una corrida que se
					// saltó un estado entero —o los dos— quedaba registrada como
					// "success" y el monitoreo veía una sync sana. Mismo formato
					// que la rama forzada.
					const mensaje =
						resultado.reason instanceof Error
							? resultado.reason.message
							: String(resultado.reason);
					result.errors.push(
						`Estado ${estadosEnMora[i]}: no se pudo obtener créditos de cartera-back (${mensaje})`,
					);
				}
			});
		}

		console.log(
			`[SyncCobros] Encontrados ${creditos.length} créditos en cartera-back`,
		);

		// Destinatarios de los avisos: el asesor de cartera de cada crédito, y
		// como remitente el usuario sistema (no hay humano detrás del job).
		const [usuarioPorCorreo, usuarioSistema] = await Promise.all([
			usuariosPorCorreo(),
			resolverUsuarioSistemaCobros(),
		]);

		// 2. Procesar cada crédito
		for (const credito of creditos) {
			try {
				// Obtener detalles completos del crédito
				const creditoCompleto = await carteraBackClient.getCredito(
					credito.creditos.numero_credito_sifco,
				);
				const correoAsesor = creditoCompleto.asesor?.emailCashIn
					?.trim()
					.toLowerCase();
				const asesorUserId = correoAsesor
					? (usuarioPorCorreo.get(correoAsesor) ?? null)
					: null;

				// Calcular días de mora exactos usando la fecha de vencimiento
				// (se sigue usando para diasMoraMaximo/UI; la ETAPA se deriva de cuotas).
				const diasMora = calcularDiasMoraExactos(
					creditoCompleto.cuotasAtrasadas || [],
				);
				const cuotasAtrasadas = creditoCompleto.cuotasAtrasadas?.length || 0;
				const estadoMora = mapearEstadoMora(
					cuotasAtrasadas,
					creditoCompleto.credito.statusCredit,
				);

				// Verificar si existe referencia en CRM
				const reference = await db
					.select()
					.from(carteraBackReferences)
					.where(
						eq(
							carteraBackReferences.numeroCreditoSifco,
							credito.creditos.numero_credito_sifco,
						),
					)
					.limit(1);

				if (reference.length === 0) {
					console.warn(
						`[SyncCobros] Crédito ${credito.creditos.numero_credito_sifco} no tiene referencia en CRM, saltando`,
					);
					continue;
				}

				const contratoId = reference[0].contratoFinanciamientoId;

				if (!contratoId) {
					console.warn(
						`[SyncCobros] Crédito ${credito.creditos.numero_credito_sifco} no tiene contrato asociado, saltando`,
					);
					continue;
				}

				// Obtener datos del contrato y cliente para info de contacto
				const contrato = await db
					.select()
					.from(contratosFinanciamiento)
					.where(eq(contratosFinanciamiento.id, contratoId))
					.limit(1);

				if (contrato.length === 0) {
					console.warn(
						`[SyncCobros] Contrato ${contratoId} no encontrado, saltando`,
					);
					continue;
				}

				// Obtener datos del lead para info de contacto
				const lead = await db
					.select()
					.from(leads)
					.where(eq(leads.id, reference[0].opportunityId!))
					.limit(1);

				// Verificar si ya existe caso de cobros
				const casoExistente = await db
					.select()
					.from(casosCobros)
					.where(
						eq(
							casosCobros.numeroCreditoSifco,
							credito.creditos.numero_credito_sifco,
						),
					)
					.limit(1);

				const debeCrearCaso = debeCrearCasoCobros(
					creditoCompleto.credito.statusCredit,
					diasMora,
				);

				if (casoExistente.length > 0) {
					// ACTUALIZAR CASO EXISTENTE
					const caso = casoExistente[0];
					const estadoAnterior = caso.estadoMora;

					if (debeCrearCaso) {
						// Actualizar con datos frescos
						await db
							.update(casosCobros)
							.set({
								estadoMora,
								montoEnMora: creditoCompleto.moraActual, // ya es string
								diasMoraMaximo: diasMora,
								cuotasVencidas: creditoCompleto.cuotasAtrasadas?.length || 0,
								activo: true,
								updatedAt: new Date(),
							})
							.where(eq(casosCobros.id, caso.id));

						result.casosActualizados++;
						console.log(
							`[SyncCobros] ✓ Actualizado caso ${caso.id} - ${credito.creditos.numero_credito_sifco}`,
						);

						// Notificar si la mora escaló
						if (moraEscalo(estadoAnterior, estadoMora) && usuarioSistema) {
							const descripcionMora = `Caso ${credito.creditos.numero_credito_sifco} pasó de ${estadoAnterior.replace("_", " ")} a ${estadoMora.replace("_", " ")}`;

							// Notificar al asesor que lleva el crédito en cartera
							if (asesorUserId) {
								await createNotification({
									titulo: "Mora escalada",
									descripcion: descripcionMora,
									type: "system",
									createdBy: usuarioSistema,
									createdByRole: "cobros",
									assignedToRole: "cobros",
									assignedTo: asesorUserId,
									relatedEntityType: "collection_case",
									relatedEntityId: caso.id,
									redirectPage: "cobros_detail",
								});
							}

							// Notificar al supervisor
							await createNotification({
								titulo: "Mora escalada",
								descripcion: descripcionMora,
								type: "system",
								createdBy: usuarioSistema,
								createdByRole: "cobros",
								assignedToRole: "cobros_supervisor",
								relatedEntityType: "collection_case",
								relatedEntityId: caso.id,
								redirectPage: "cobros_detail",
							});
						}
					} else {
						// El crédito ya no está en mora → cerrar caso
						if (caso.activo) {
							await db
								.update(casosCobros)
								.set({
									activo: false,
									estadoMora: "al_dia",
									updatedAt: new Date(),
								})
								.where(eq(casosCobros.id, caso.id));

							result.casosCerrados++;
							console.log(
								`[SyncCobros] ✓ Cerrado caso ${caso.id} - ${credito.creditos.numero_credito_sifco} (al día)`,
							);
						}
					}
				} else if (debeCrearCaso) {
					// CREAR NUEVO CASO. Sin responsable: quién lo trabaja lo dice
					// cartera, no el caso.
					// Información de contacto del lead
					const telefonoPrincipal = lead[0]?.phone || "Sin teléfono";
					const emailContacto = lead[0]?.email || "Sin email";
					const direccionContacto = "Por confirmar";

					const [nuevoCaso] = await db
						.insert(casosCobros)
						.values({
							contratoId,
							numeroCreditoSifco: credito.creditos.numero_credito_sifco,
							estadoMora,
							montoEnMora: creditoCompleto.moraActual, // ya es string
							diasMoraMaximo: diasMora,
							cuotasVencidas: creditoCompleto.cuotasAtrasadas?.length || 0,
							telefonoPrincipal,
							telefonoAlternativo: null,
							emailContacto,
							direccionContacto,
							activo: true,
							notes: `Caso creado automáticamente desde cartera-back el ${now.toLocaleDateString()}`,
						})
						.returning();

					result.casosCreados++;
					console.log(
						`[SyncCobros] ✓ Creado caso para ${credito.creditos.numero_credito_sifco} - ${diasMora} días mora`,
					);

					// Notificar al asesor que lleva el crédito en cartera
					if (asesorUserId && usuarioSistema) {
						await createNotification({
							titulo: "Nuevo caso de cobro",
							descripcion: `Nuevo caso de cobro: ${credito.creditos.numero_credito_sifco} - mora ${estadoMora.replace("_", " ")}`,
							type: "aviso",
							createdBy: usuarioSistema,
							createdByRole: "cobros",
							assignedToRole: "cobros",
							assignedTo: asesorUserId,
							relatedEntityType: "collection_case",
							relatedEntityId: nuevoCaso.id,
							redirectPage: "cobros_detail",
						});
					}
				}
			} catch (error) {
				const errorMsg = `Error procesando crédito ${credito.creditos.numero_credito_sifco}: ${error instanceof Error ? error.message : String(error)}`;
				result.errors.push(errorMsg);
				console.error(`[SyncCobros] ${errorMsg}`);
			}
		}

		result.duration = Date.now() - startTime;
		console.log(
			`[SyncCobros] ✓ Sincronización completada en ${result.duration}ms - Creados: ${result.casosCreados}, Actualizados: ${result.casosActualizados}, Cerrados: ${result.casosCerrados}`,
		);

		// Log the sync operation
		await db.insert(carteraBackSyncLog).values({
			operation: "sync_casos_cobros",
			entityType: "caso_cobros",
			entityId: `${mes}/${anio}`,
			status: result.errors.length > 0 ? "error" : "success",
			errorMessage: result.errors.length > 0 ? result.errors.join("; ") : null,
			requestPayload: JSON.stringify(options),
			responsePayload: JSON.stringify({
				casosCreados: result.casosCreados,
				casosActualizados: result.casosActualizados,
				casosCerrados: result.casosCerrados,
			}),
			startedAt: new Date(startTime),
			completedAt: new Date(),
			durationMs: result.duration,
			userId: options.userId || "system",
			source: "sync_job",
		});

		return result;
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		result.success = false;
		result.errors.push(errorMsg);
		result.duration = Date.now() - startTime;

		console.error(`[SyncCobros] ✗ Error fatal en sincronización: ${errorMsg}`);

		// Log the error
		await db.insert(carteraBackSyncLog).values({
			operation: "sync_casos_cobros",
			entityType: "caso_cobros",
			entityId: `${mes}/${anio}`,
			status: "error",
			errorMessage: errorMsg,
			requestPayload: JSON.stringify(options),
			startedAt: new Date(startTime),
			completedAt: new Date(),
			durationMs: result.duration,
			userId: options.userId || "system",
			source: "sync_job",
		});

		return result;
	}
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Obtiene estadísticas de sincronización reciente
 */
export async function getUltimasSincronizaciones(limit = 10) {
	const syncLogs = await db
		.select()
		.from(carteraBackSyncLog)
		.where(eq(carteraBackSyncLog.operation, "sync_casos_cobros"))
		.orderBy(desc(carteraBackSyncLog.startedAt))
		.limit(limit);

	return syncLogs.map((log) => ({
		fecha: log.startedAt,
		estado: log.status,
		duracion: log.durationMs,
		resultado: log.responsePayload ? JSON.parse(log.responsePayload) : null,
		error: log.errorMessage,
	}));
}
