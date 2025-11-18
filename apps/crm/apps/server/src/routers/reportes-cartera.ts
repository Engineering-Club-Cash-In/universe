/**
 * Router de Reportes Unificados
 * Combina datos de CRM y cartera-back para reportes completos
 */

import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { carteraBackReferences } from "../db/schema/cartera-back";
import { casosCobros } from "../db/schema/cobros";
import { adminProcedure } from "../lib/orpc";
import { carteraBackClient } from "../services/cartera-back-client";
import { isCarteraBackEnabled } from "../services/cartera-back-integration";

export const reportesCarteraRouter = {
	// ========================================================================
	// REPORTE DE CARTERA COMPLETO
	// ========================================================================

	/**
	 * Reporte completo de cartera combinando datos financieros de cartera-back
	 * con datos de workflow y gestión del CRM
	 */
	getReporteCarteraCompleto: adminProcedure
		.input(
			z.object({
				mes: z.number().min(1).max(12),
				anio: z.number().min(2000).max(2100),
				estado: z
					.enum(["ACTIVO", "MOROSO", "CANCELADO", "INCOBRABLE"])
					.optional(),
			}),
		)
		.handler(async ({ input, context: _ }) => {
			if (!isCarteraBackEnabled()) {
				throw new Error("Integración con cartera-back no está habilitada");
			}

			const startTime = Date.now();

			try {
				// 1. Obtener créditos de cartera-back
				const creditosCartera = await carteraBackClient.getAllCreditos({
					mes: input.mes,
					anio: input.anio,
					estado: input.estado,
					page: 1,
					perPage: 1000, // TODO: Implementar paginación
				});

				// 2. Enriquecer con datos del CRM
				const creditosEnriquecidos = await Promise.all(
					creditosCartera.data.map(async (credito) => {
						try {
							// Obtener referencia del CRM
							const reference = await db
								.select()
								.from(carteraBackReferences)
								.where(
									eq(
										carteraBackReferences.numeroCreditoSifco,
										credito.numero_credito_sifco,
									),
								)
								.limit(1);

							if (reference.length === 0) {
								return {
									...credito,
									// Datos financieros de cartera-back
									diasMora: 0,
									montoMora: "0",
									cuotasAtrasadas: 0,
									// Datos CRM (no disponibles)
									agenteCobranza: null,
									numeroContactos: 0,
									ultimoContacto: null,
									tieneConvenio: false,
									tieneRecuperacion: false,
								};
							}

							// Obtener datos del CRM
							const contratoId = reference[0].contratoFinanciamientoId;

							// Buscar caso de cobros activo
							const casoCobros = contratoId
								? await db
										.select()
										.from(casosCobros)
										.where(
											and(
												eq(casosCobros.contratoId, contratoId),
												eq(casosCobros.activo, true),
											),
										)
										.limit(1)
								: [];

							// Contar contactos de cobros
							let numeroContactos = 0;
							let ultimoContacto: Date | null = null;

							if (casoCobros.length > 0) {
								const contactos = await db.execute<{
									total: number;
									ultimo: string | null;
								}>(
									sql`
										SELECT COUNT(*) as total, MAX(fecha_contacto) as ultimo
										FROM contactos_cobros
										WHERE caso_cobro_id = ${casoCobros[0].id}
									`,
								);

								if (contactos.rows.length > 0) {
									numeroContactos = Number(contactos.rows[0]?.total) || 0;
									const ultimoStr = contactos.rows[0]?.ultimo;
									ultimoContacto = ultimoStr ? new Date(ultimoStr) : null;
								}
							}

							// Verificar si tiene convenio de pago activo
							let tieneConvenio = false;
							if (casoCobros.length > 0) {
								const conveniosResult = await db.execute<{ total: number }>(
									sql`
										SELECT COUNT(*) as total
										FROM convenios_pago
										WHERE caso_cobro_id = ${casoCobros[0].id}
										AND activo = true
									`,
								);
								tieneConvenio = Number(conveniosResult.rows[0]?.total) > 0;
							}

							// Verificar si tiene recuperación de vehículo
							let tieneRecuperacion = false;
							if (casoCobros.length > 0) {
								const recuperacionesResult = await db.execute<{
									total: number;
								}>(
									sql`
										SELECT COUNT(*) as total
										FROM recuperaciones_vehiculo
										WHERE caso_cobro_id = ${casoCobros[0].id}
										AND completada = false
									`,
								);
								tieneRecuperacion =
									Number(recuperacionesResult.rows[0]?.total) > 0;
							}

							// Obtener detalles completos desde cartera-back
							const creditoCompleto = await carteraBackClient.getCredito(
								credito.numero_credito_sifco,
							);

							return {
								// Datos financieros de cartera-back
								creditoId: credito.credito_id,
								numeroSifco: credito.numero_credito_sifco,
								capital: credito.capital,
								porcentajeInteres: credito.porcentaje_interes,
								cuota: credito.cuota,
								plazo: credito.plazo,
								statusCredit: credito.statusCredit,
								deudaTotal: credito.deudatotal,
								diasMora: creditoCompleto.dias_mora || 0,
								montoMora: creditoCompleto.monto_mora ?? "0",
								cuotasAtrasadas: creditoCompleto.cuotas_atrasadas ?? 0,
								cuotasPagadas: creditoCompleto.cuotas_pagadas ?? 0,
								cuotasPendientes: creditoCompleto.cuotas_pendientes ?? 0,
								capitalRestante: creditoCompleto.capital_restante ?? "0",
								totalRestante: creditoCompleto.total_restante ?? "0",
								// Cliente
								clienteNombre: creditoCompleto.usuario.nombre,
								clienteNit: creditoCompleto.usuario.nit,
								// Asesor
								asesorNombre: creditoCompleto.asesor?.nombre || null,
								// Datos CRM
								agenteCobranza: casoCobros[0]?.responsableCobros || null,
								numeroContactos,
								ultimoContacto,
								tieneConvenio,
								tieneRecuperacion,
								// Inversionistas
								tieneInversionistas:
									(creditoCompleto.creditos_inversionistas?.length || 0) > 0,
								numeroInversionistas:
									creditoCompleto.creditos_inversionistas?.length || 0,
							};
						} catch (error) {
							console.error(
								`Error procesando crédito ${credito.numero_credito_sifco}:`,
								error,
							);
							return {
								...credito,
								error: true,
								errorMessage:
									error instanceof Error ? error.message : "Error desconocido",
							};
						}
					}),
				);

				// 3. Calcular totales y métricas
				const totales = creditosEnriquecidos.reduce(
					(acc, credito) => {
						if ("error" in credito && credito.error) return acc;

						const capital = Number.parseFloat(credito.capital) || 0;
						const capitalRestante =
							Number.parseFloat(credito.capitalRestante ?? "0") || 0;
						const montoMora = Number.parseFloat(credito.montoMora ?? "0") || 0;

						acc.montoDesembolsado += capital;
						acc.montoRecuperado += capital - capitalRestante;
						acc.montoPendiente += capitalRestante;
						acc.montoEnMora += montoMora;

						if (credito.statusCredit === "ACTIVO") acc.creditosActivos++;
						if (credito.statusCredit === "MOROSO") acc.creditosMorosos++;
						if (credito.statusCredit === "CANCELADO") acc.creditosCancelados++;
						if (credito.statusCredit === "INCOBRABLE")
							acc.creditosIncobrables++;

						if (credito.tieneConvenio) acc.creditosConConvenio++;
						if (credito.tieneRecuperacion) acc.creditosConRecuperacion++;

						return acc;
					},
					{
						montoDesembolsado: 0,
						montoRecuperado: 0,
						montoPendiente: 0,
						montoEnMora: 0,
						creditosActivos: 0,
						creditosMorosos: 0,
						creditosCancelados: 0,
						creditosIncobrables: 0,
						creditosConConvenio: 0,
						creditosConRecuperacion: 0,
					},
				);

				// Calcular métricas
				const totalCreditos = creditosEnriquecidos.length;
				const tasaMorosidad =
					totalCreditos > 0
						? (totales.creditosMorosos / totalCreditos) * 100
						: 0;
				const tasaRecuperacion =
					totales.montoDesembolsado > 0
						? (totales.montoRecuperado / totales.montoDesembolsado) * 100
						: 0;
				const tasaIncumplimiento =
					totales.montoDesembolsado > 0
						? (totales.montoEnMora / totales.montoDesembolsado) * 100
						: 0;

				const duracion = Date.now() - startTime;

				return {
					periodo: {
						mes: input.mes,
						anio: input.anio,
						estado: input.estado || "TODOS",
					},
					creditos: creditosEnriquecidos,
					totales: {
						...totales,
						totalCreditos,
					},
					metricas: {
						tasaMorosidad: tasaMorosidad.toFixed(2),
						tasaRecuperacion: tasaRecuperacion.toFixed(2),
						tasaIncumplimiento: tasaIncumplimiento.toFixed(2),
						promedioContactosPorCaso:
							totales.creditosMorosos > 0
								? (
										creditosEnriquecidos.reduce(
											(acc, c) =>
												acc +
												("numeroContactos" in c && c.numeroContactos
													? c.numeroContactos
													: 0),
											0,
										) / totales.creditosMorosos
									).toFixed(1)
								: "0",
					},
					metadata: {
						generadoEn: new Date().toISOString(),
						duracionMs: duracion,
						fuenteDatos: "cartera-back + CRM",
					},
				};
			} catch (error) {
				throw new Error(
					`Error generando reporte de cartera: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}),

	// ========================================================================
	// REPORTE DE EFICIENCIA DE COBROS
	// ========================================================================

	/**
	 * Reporte de eficiencia del equipo de cobros
	 */
	getReporteEficienciaCobros: adminProcedure
		.input(
			z.object({
				fechaInicio: z.string(), // ISO date
				fechaFin: z.string(), // ISO date
			}),
		)
		.handler(async ({ input, context: _ }) => {
			// Obtener todos los casos de cobros en el período
			const casosCobrosResult = await db.execute(
				sql`
					SELECT
						cc.responsable_cobros,
						COUNT(DISTINCT cc.id) as total_casos,
						COUNT(DISTINCT CASE WHEN cc.activo = true THEN cc.id END) as casos_activos,
						COUNT(DISTINCT CASE WHEN cc.activo = false THEN cc.id END) as casos_cerrados,
						SUM(cc.monto_en_mora) as monto_total_mora,
						AVG(cc.dias_mora_maximo) as promedio_dias_mora,
						COUNT(contactos.id) as total_contactos,
						COUNT(DISTINCT convenios.id) as total_convenios,
						COUNT(DISTINCT recuperaciones.id) as total_recuperaciones
					FROM casos_cobros cc
					LEFT JOIN contactos_cobros contactos ON contactos.caso_cobro_id = cc.id
					LEFT JOIN convenios_pago convenios ON convenios.caso_cobro_id = cc.id
					LEFT JOIN recuperaciones_vehiculo recuperaciones ON recuperaciones.caso_cobro_id = cc.id
					WHERE cc.created_at BETWEEN ${input.fechaInicio} AND ${input.fechaFin}
					GROUP BY cc.responsable_cobros
				`,
			);

			const agenteStats = casosCobrosResult.rows.map((row) => ({
				agenteId: row.responsable_cobros as string,
				totalCasos: Number(row.total_casos),
				casosActivos: Number(row.casos_activos),
				casosCerrados: Number(row.casos_cerrados),
				montoTotalMora: row.monto_total_mora as string,
				promedioDiasMora: Number.parseFloat(row.promedio_dias_mora as string),
				totalContactos: Number(row.total_contactos),
				totalConvenios: Number(row.total_convenios),
				totalRecuperaciones: Number(row.total_recuperaciones),
				tasaCierre:
					Number(row.total_casos) > 0
						? (
								(Number(row.casos_cerrados) / Number(row.total_casos)) *
								100
							).toFixed(2)
						: "0",
				promedioContactosPorCaso:
					Number(row.total_casos) > 0
						? (Number(row.total_contactos) / Number(row.total_casos)).toFixed(1)
						: "0",
			}));

			return {
				periodo: {
					fechaInicio: input.fechaInicio,
					fechaFin: input.fechaFin,
				},
				agentes: agenteStats,
				totales: {
					totalCasos: agenteStats.reduce((acc, a) => acc + a.totalCasos, 0),
					totalContactos: agenteStats.reduce(
						(acc, a) => acc + a.totalContactos,
						0,
					),
					totalConvenios: agenteStats.reduce(
						(acc, a) => acc + a.totalConvenios,
						0,
					),
					totalRecuperaciones: agenteStats.reduce(
						(acc, a) => acc + a.totalRecuperaciones,
						0,
					),
				},
			};
		}),
};
