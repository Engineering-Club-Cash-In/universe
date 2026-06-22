/**
 * Router de Reportes Unificados
 * Combina datos de CRM y cartera-back para reportes completos
 */

import { ORPCError } from "@orpc/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { carteraBackReferences } from "../db/schema/cartera-back";
import { casosCobros } from "../db/schema/cobros";
import { metasMensuales, TIPOS_META } from "../db/schema/metas";
import {
	getGuatemalaMonthWindow,
	gtDateStrToDate,
} from "../lib/guatemala-month-window";
import { calcularDiasMoraExactos } from "../lib/mora-utils";
import { adminProcedure } from "../lib/orpc";
import {
	carteraBackClient,
	type FacturacionMesResponse,
	type FlujoCuotasInversionesResponse,
	type FlujoCuotasPorInversionistaResponse,
	type MontoACobrarPeriodoRow,
	type MontoACobrarRow,
	type ReinversionLiquidacionesResponse,
} from "../services/cartera-back-client";
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
				throw new ORPCError("BAD_REQUEST", {
					message: "Integración con cartera-back no está habilitada",
				});
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
										credito.creditos.numero_credito_sifco,
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
								credito.creditos.numero_credito_sifco,
							);

							return {
								// Datos financieros de cartera-back
								creditoId: credito.creditos.credito_id,
								numeroSifco: credito.creditos.numero_credito_sifco,
								capital: credito.creditos.capital,
								porcentajeInteres: credito.creditos.porcentaje_interes,
								cuota: credito.creditos.cuota,
								plazo: credito.creditos.plazo,
								statusCredit: credito.creditos.statusCredit,
								deudaTotal: credito.creditos.deudatotal,
								diasMora: calcularDiasMoraExactos(
									creditoCompleto.cuotasAtrasadas || [],
								),
								montoMora: creditoCompleto.moraActual ?? "0",
								cuotasAtrasadas: creditoCompleto.cuotasAtrasadas?.length || 0,
								cuotasPagadas: creditoCompleto.cuotasPagadas?.length || 0,
								cuotasPendientes: creditoCompleto.cuotasPendientes?.length || 0,
								capitalRestante: "0", // No disponible
								totalRestante: "0", // No disponible
								// Cliente
								clienteNombre: creditoCompleto.usuario.nombre,
								clienteNit: creditoCompleto.usuario.nit,
								// Asesor
								asesorNombre: null, // No disponible
								// Datos CRM
								agenteCobranza: casoCobros[0]?.responsableCobros || null,
								numeroContactos,
								ultimoContacto,
								tieneConvenio,
								tieneRecuperacion,
								// Inversionistas
								tieneInversionistas: false,
							};
						} catch (error) {
							console.error(
								`Error procesando crédito ${credito.creditos.numero_credito_sifco}:`,
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

						const capital =
							Number.parseFloat((credito as any).capital ?? "0") || 0;
						const capitalRestante =
							Number.parseFloat((credito as any).capitalRestante ?? "0") || 0;
						const montoMora =
							Number.parseFloat((credito as any).montoMora ?? "0") || 0;

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
				throw new ORPCError("BAD_REQUEST", {
					message: `Error generando reporte de cartera: ${error instanceof Error ? error.message : String(error)}`,
				});
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

	// ========================================================================
	// REPORTE: MONTO A COBRARSE POR PERÍODO
	// ========================================================================

	getMontoACobrar: adminProcedure
		.input(
			z.object({
				periodo: z
					.enum(["anio", "trimestre", "mes", "semana", "dia"])
					.default("mes"),
				fechaInicio: z
					.string()
					.regex(/^\d{4}-\d{2}-\d{2}$/, "Formato YYYY-MM-DD requerido"),
				fechaFin: z
					.string()
					.regex(/^\d{4}-\d{2}-\d{2}$/, "Formato YYYY-MM-DD requerido"),
			}),
		)
		.handler(async ({ input }): Promise<{ data: MontoACobrarRow[] }> => {
			if (!isCarteraBackEnabled()) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Integración con cartera-back no está habilitada",
				});
			}

			const data = await carteraBackClient.getMontoACobrar({
				periodo: input.periodo,
				fechaInicio: input.fechaInicio,
				fechaFin: input.fechaFin,
			});

			return { data };
		}),

	// ========================================================================
	// REPORTE: MONTO A COBRARSE POR PERÍODO (lógica cartera web, con acumulado)
	// ========================================================================

	getMontoACobrarPeriodo: adminProcedure
		.input(
			z.object({
				periodo: z
					.enum(["anio", "trimestre", "mes", "semana", "dia"])
					.default("mes"),
				fechaInicio: z
					.string()
					.regex(/^\d{4}-\d{2}-\d{2}$/, "Formato YYYY-MM-DD requerido"),
				fechaFin: z
					.string()
					.regex(/^\d{4}-\d{2}-\d{2}$/, "Formato YYYY-MM-DD requerido"),
			}),
		)
		.handler(async ({ input }): Promise<{ data: MontoACobrarPeriodoRow[] }> => {
			if (!isCarteraBackEnabled()) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Integración con cartera-back no está habilitada",
				});
			}

			const data = await carteraBackClient.getMontoACobrarPeriodo({
				periodo: input.periodo,
				fechaInicio: input.fechaInicio,
				fechaFin: input.fechaFin,
			});

			return { data };
		}),

	// ========================================================================
	// REPORTE: FACTURADO DEL MES VS ESPERADO
	// ========================================================================

	getFacturacionMes: adminProcedure
		.input(
			z.object({
				mes: z.number().min(1).max(12),
				anio: z.number().min(2020),
			}),
		)
		.handler(async ({ input }): Promise<FacturacionMesResponse> => {
			if (!isCarteraBackEnabled()) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Integración con cartera-back no está habilitada",
				});
			}

			return carteraBackClient.getFacturacionMes({
				mes: input.mes,
				anio: input.anio,
			});
		}),

	getFlujoCuotasInversiones: adminProcedure
		.input(
			z.object({
				fechaInicio: z
					.string()
					.regex(/^\d{4}-\d{2}-\d{2}$/, "Formato YYYY-MM-DD requerido"),
				fechaFin: z
					.string()
					.regex(/^\d{4}-\d{2}-\d{2}$/, "Formato YYYY-MM-DD requerido"),
			}),
		)
		.handler(async ({ input }): Promise<FlujoCuotasInversionesResponse> => {
			if (!isCarteraBackEnabled()) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Integración con cartera-back no está habilitada",
				});
			}

			return carteraBackClient.getFlujoCuotasInversiones({
				fechaInicio: input.fechaInicio,
				fechaFin: input.fechaFin,
			});
		}),

	getReinversionLiquidaciones: adminProcedure
		.input(
			z.object({
				mes: z.number().min(1).max(12),
				anio: z.number().min(2020),
			}),
		)
		.handler(async ({ input }): Promise<ReinversionLiquidacionesResponse> => {
			if (!isCarteraBackEnabled()) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Integración con cartera-back no está habilitada",
				});
			}

			return carteraBackClient.getReinversionLiquidaciones({
				mes: input.mes,
				anio: input.anio,
			});
		}),

	getFlujoCuotasPorInversionista: adminProcedure
		.input(
			z.object({
				fechaInicio: z
					.string()
					.regex(/^\d{4}-\d{2}-\d{2}$/, "Formato YYYY-MM-DD requerido"),
				fechaFin: z
					.string()
					.regex(/^\d{4}-\d{2}-\d{2}$/, "Formato YYYY-MM-DD requerido"),
			}),
		)
		.handler(
			async ({ input }): Promise<FlujoCuotasPorInversionistaResponse> => {
				if (!isCarteraBackEnabled()) {
					throw new ORPCError("BAD_REQUEST", {
						message: "Integración con cartera-back no está habilitada",
					});
				}

				return carteraBackClient.getFlujoCuotasPorInversionista({
					fechaInicio: input.fechaInicio,
					fechaFin: input.fechaFin,
				});
			},
		),

	// ========================================================================
	// METAS MENSUALES
	// ========================================================================

	getMetas: adminProcedure
		.input(
			z.object({
				anio: z.number().min(2024).max(2030),
				tipo: z.enum(TIPOS_META).default("colocacion"),
			}),
		)
		.handler(async ({ input }) => {
			const rows = await db
				.select()
				.from(metasMensuales)
				.where(
					and(
						eq(metasMensuales.anio, input.anio),
						eq(metasMensuales.tipo, input.tipo),
					),
				)
				.orderBy(metasMensuales.mes);
			return rows;
		}),

	upsertMeta: adminProcedure
		.input(
			z.object({
				tipo: z.enum(TIPOS_META),
				anio: z.number().min(2024).max(2030),
				mes: z.number().min(1).max(12),
				monto: z.string(),
			}),
		)
		.handler(async ({ input }) => {
			await db
				.insert(metasMensuales)
				.values({
					tipo: input.tipo,
					anio: input.anio,
					mes: input.mes,
					monto: input.monto,
					updatedAt: new Date(),
				})
				.onConflictDoUpdate({
					target: [
						metasMensuales.tipo,
						metasMensuales.anio,
						metasMensuales.mes,
					],
					set: { monto: input.monto, updatedAt: new Date() },
				});
			return { ok: true };
		}),

	// ========================================================================
	// REPORTE: PUNTO DE EQUILIBRIO (COLOCACIÓN VS META)
	// ========================================================================

	getPuntoEquilibrio: adminProcedure
		.input(
			z.object({
				periodo: z
					.enum(["anio", "trimestre", "mes", "semana", "dia"])
					.default("mes"),
				fechaInicio: z.string(),
				fechaFin: z.string(),
			}),
		)
		.handler(
			async ({
				input,
			}): Promise<{
				data: {
					bucket: string;
					cantidad_creditos: number;
					colocado: string;
					meta: string;
					cobertura: string | null;
					faltante: string | null;
				}[];
			}> => {
				const startDate = gtDateStrToDate(input.fechaInicio);
				const endInclusive = new Date(`${input.fechaFin}T12:00:00Z`);
				endInclusive.setUTCDate(endInclusive.getUTCDate() + 1);
				const endDate = gtDateStrToDate(
					endInclusive.toISOString().slice(0, 10),
				);
				const toPostgresPeriod: Record<string, string> = {
					dia: "'day'",
					semana: "'week'",
					mes: "'month'",
					trimestre: "'quarter'",
					anio: "'year'",
				};
				const pg = sql.raw(toPostgresPeriod[input.periodo]);

				const colocacionResult = await db.execute(sql`
					WITH placed_stage_ids AS (
						SELECT id
						FROM sales_stages
						WHERE closure_percentage >= 90
					), first_placed AS (
						SELECT
							osh.opportunity_id,
							MIN(osh.changed_at) AS first_placed_at
						FROM opportunity_stage_history osh
						WHERE osh.to_stage_id IN (SELECT id FROM placed_stage_ids)
						GROUP BY osh.opportunity_id
					)
					SELECT
						DATE_TRUNC(${pg}, fp.first_placed_at - INTERVAL '6 hours') AS bucket,
						COUNT(o.id)::int AS cantidad_creditos,
						COALESCE(SUM(o.value::numeric), 0) AS total_colocacion
					FROM first_placed fp
					JOIN opportunities o ON o.id = fp.opportunity_id
					WHERE o.status != 'migrate'
						AND o.stage_id IN (SELECT id FROM placed_stage_ids)
						AND fp.first_placed_at >= ${startDate}
						AND fp.first_placed_at < ${endDate}
					GROUP BY DATE_TRUNC(${pg}, fp.first_placed_at - INTERVAL '6 hours')
					ORDER BY bucket ASC
				`);

				const colocacion = colocacionResult.rows as {
					bucket: string;
					cantidad_creditos: number;
					total_colocacion: string;
				}[];

				const startYear = new Date(
					`${input.fechaInicio}T12:00:00Z`,
				).getUTCFullYear();
				const endYear = new Date(
					`${input.fechaFin}T12:00:00Z`,
				).getUTCFullYear();
				const anios = Array.from(
					{ length: endYear - startYear + 1 },
					(_, i) => startYear + i,
				);

				const metasRows = await db
					.select()
					.from(metasMensuales)
					.where(
						and(
							eq(metasMensuales.tipo, "colocacion"),
							inArray(metasMensuales.anio, anios),
						),
					);

				const metasMap: Record<number, Record<number, number>> = {};
				for (const r of metasRows) {
					if (!metasMap[r.anio]) metasMap[r.anio] = {};
					metasMap[r.anio][r.mes] = Number(r.monto);
				}

				// Indexar colocación por bucket local GT — parsear como UTC explícito
				// para evitar interpretación en zona local del servidor (#6)
				const colocacionMap = new Map<
					string,
					{ cantidad: number; total: number }
				>();
				for (const row of colocacion) {
					// row.bucket viene como timestamp string sin zona de DATE_TRUNC
					// Forzar parseo UTC agregando Z
					const raw =
						typeof row.bucket === "string"
							? row.bucket
							: (row.bucket as Date).toISOString();
					const key = (raw.endsWith("Z") ? raw : `${raw}Z`).slice(0, 10);
					colocacionMap.set(key, {
						cantidad: row.cantidad_creditos,
						total: Number(row.total_colocacion),
					});
				}

				// Generar todos los buckets del rango para no omitir períodos sin colocación
				const buckets: Date[] = [];
				const cur = new Date(`${input.fechaInicio}T12:00:00Z`);
				const end = new Date(`${input.fechaFin}T12:00:00Z`);

				const truncTz = (d: Date, periodo: string): Date => {
					const gt = new Date(d.getTime() - 6 * 60 * 60 * 1000);
					const y = gt.getUTCFullYear();
					const mo = gt.getUTCMonth();
					const day = gt.getUTCDate();
					if (periodo === "dia") return new Date(Date.UTC(y, mo, day));
					if (periodo === "semana") {
						const dow = gt.getUTCDay();
						// DATE_TRUNC('week') ancla al lunes (ISO 8601) — (dow+6)%7 hace lo mismo
						return new Date(Date.UTC(y, mo, day - ((dow + 6) % 7)));
					}
					if (periodo === "mes") return new Date(Date.UTC(y, mo, 1));
					if (periodo === "trimestre")
						return new Date(Date.UTC(y, Math.floor(mo / 3) * 3, 1));
					return new Date(Date.UTC(y, 0, 1));
				};

				const advancePeriod = (d: Date, periodo: string): Date => {
					const n = new Date(d);
					if (periodo === "dia") n.setUTCDate(n.getUTCDate() + 1);
					else if (periodo === "semana") n.setUTCDate(n.getUTCDate() + 7);
					else if (periodo === "mes") n.setUTCMonth(n.getUTCMonth() + 1);
					else if (periodo === "trimestre") n.setUTCMonth(n.getUTCMonth() + 3);
					else n.setUTCFullYear(n.getUTCFullYear() + 1);
					return n;
				};

				let b = truncTz(cur, input.periodo);
				while (b <= end) {
					buckets.push(b);
					b = advancePeriod(b, input.periodo);
				}

				const resultado = buckets.map((bucket) => {
					const key = bucket.toISOString().slice(0, 10);
					const col = colocacionMap.get(key);
					const anio = bucket.getUTCFullYear();
					const mes = bucket.getUTCMonth() + 1;
					const metaMes = metasMap[anio]?.[mes] ?? 0;

					let metaBucket = 0;
					if (input.periodo === "mes") {
						metaBucket = metaMes;
					} else if (input.periodo === "trimestre") {
						const q = Math.ceil(mes / 3);
						for (let m = (q - 1) * 3 + 1; m <= q * 3; m++) {
							metaBucket += metasMap[anio]?.[m] ?? 0;
						}
					} else if (input.periodo === "anio") {
						for (let m = 1; m <= 12; m++) {
							metaBucket += metasMap[anio]?.[m] ?? 0;
						}
					} else if (input.periodo === "semana") {
						const daysInMonth = new Date(anio, mes, 0).getDate();
						const weeksInMonth = Math.ceil(daysInMonth / 7);
						metaBucket = metaMes / weeksInMonth;
					} else if (input.periodo === "dia") {
						const daysInMonth = new Date(anio, mes, 0).getDate();
						metaBucket = metaMes / daysInMonth;
					}

					const colocado = col?.total ?? 0;
					const cobertura =
						metaBucket > 0 ? (colocado / metaBucket) * 100 : null;
					const faltante =
						metaBucket > 0 ? Math.max(0, metaBucket - colocado) : null;

					return {
						bucket: bucket.toISOString().slice(0, 10),
						cantidad_creditos: col?.cantidad ?? 0,
						colocado: colocado.toFixed(2),
						meta: metaBucket.toFixed(2),
						cobertura: cobertura?.toFixed(1) ?? null,
						faltante: faltante?.toFixed(2) ?? null,
					};
				});

				return { data: resultado };
			},
		),

	// ========================================================================
	// REPORTE: COMPARATIVO HISTÓRICO MENSUAL
	// ========================================================================

	getComparativoHistorico: adminProcedure
		.input(
			z.object({
				anio: z.number().min(2024).max(2100),
			}),
		)
		.handler(
			async ({
				input,
			}): Promise<{
				data: {
					mes: number;
					colocacion_monto: string | null;
					colocacion_creditos: number | null;
					facturacion: string | null;
					cartera_activa: string | null;
					creditos_activos: number | null;
					mora_30: string | null;
					mora_60: string | null;
					mora_90: string | null;
					mora_120: string | null;
					creditos_30: number | null;
					creditos_60: number | null;
					creditos_90: number | null;
					creditos_120: number | null;
				}[];
			}> => {
				if (!isCarteraBackEnabled()) {
					throw new ORPCError("BAD_REQUEST", {
						message: "Integración con cartera-back no está habilitada",
					});
				}

				const carteraData = await carteraBackClient.getComparativoHistorico(
					input.anio,
				);
				const { startOfMonth: startOfYear } = getGuatemalaMonthWindow(
					input.anio,
					1,
				);
				const { startOfMonth: endOfYear } = getGuatemalaMonthWindow(
					input.anio + 1,
					1,
				);

				const colocacionResult = await db.execute(sql`
					WITH placed_stage_ids AS (
						SELECT id
						FROM sales_stages
						WHERE closure_percentage >= 90
					), first_placed AS (
						SELECT
							osh.opportunity_id,
							MIN(osh.changed_at) AS first_placed_at
						FROM opportunity_stage_history osh
						WHERE osh.to_stage_id IN (SELECT id FROM placed_stage_ids)
						GROUP BY osh.opportunity_id
					)
					SELECT
						EXTRACT(MONTH FROM fp.first_placed_at - INTERVAL '6 hours')::int AS mes,
						COUNT(o.id)::int AS colocacion_creditos,
						COALESCE(SUM(o.value::numeric), 0) AS colocacion_monto
					FROM first_placed fp
					JOIN opportunities o ON o.id = fp.opportunity_id
					WHERE o.status != 'migrate'
						AND o.stage_id IN (SELECT id FROM placed_stage_ids)
						AND fp.first_placed_at >= ${startOfYear}
						AND fp.first_placed_at < ${endOfYear}
					GROUP BY 1
					ORDER BY 1
				`);

				const colocacionMap = new Map<
					number,
					{ monto: string; creditos: number }
				>();
				for (const row of colocacionResult.rows as {
					mes: number;
					colocacion_creditos: number;
					colocacion_monto: string;
				}[]) {
					colocacionMap.set(row.mes, {
						monto: Number(row.colocacion_monto).toFixed(2),
						creditos: row.colocacion_creditos,
					});
				}

				const mesDeDate = (valor: string): number =>
					new Date(valor).getUTCMonth() + 1;

				const cobradoMap = new Map<number, string>();
				for (const row of carteraData.cobrado) {
					cobradoMap.set(Number(row.mes), Number(row.cobrado).toFixed(2));
				}

				const carteraMap = new Map<
					number,
					{ capital: string; creditos: number }
				>();
				for (const row of carteraData.cartera) {
					carteraMap.set(mesDeDate(row.mes), {
						capital: Number(row.cartera_activa).toFixed(2),
						creditos: row.creditos_activos,
					});
				}

				type AgingBuckets = {
					mora_30: string | null;
					mora_60: string | null;
					mora_90: string | null;
					mora_120: string | null;
					creditos_30: number | null;
					creditos_60: number | null;
					creditos_90: number | null;
					creditos_120: number | null;
				};

				const agingHistMap = new Map<number, AgingBuckets>();
				for (const row of carteraData.agingHistorico) {
					const m = mesDeDate(row.periodo);
					if (!agingHistMap.has(m))
						agingHistMap.set(m, {
							mora_30: null,
							mora_60: null,
							mora_90: null,
							mora_120: null,
							creditos_30: null,
							creditos_60: null,
							creditos_90: null,
							creditos_120: null,
						});
					const entry = agingHistMap.get(m)!;
					const key = `mora_${row.bucket}` as keyof AgingBuckets;
					const cKey = `creditos_${row.bucket}` as keyof AgingBuckets;
					(entry as Record<string, string | number | null>)[key] = Number(
						row.monto_mora,
					).toFixed(2);
					(entry as Record<string, string | number | null>)[cKey] =
						row.cantidad_creditos;
				}

				const agingActual: AgingBuckets = {
					mora_30: null,
					mora_60: null,
					mora_90: null,
					mora_120: null,
					creditos_30: null,
					creditos_60: null,
					creditos_90: null,
					creditos_120: null,
				};
				for (const row of carteraData.moraActual) {
					(agingActual as Record<string, string | number | null>)[
						`mora_${row.bucket}`
					] = Number(row.monto_mora).toFixed(2);
					(agingActual as Record<string, string | number | null>)[
						`creditos_${row.bucket}`
					] = row.cantidad_creditos;
				}

				const ahoraGt = new Date(Date.now() - 6 * 60 * 60 * 1000);
				const anioActual = ahoraGt.getUTCFullYear();
				const mesActual = ahoraGt.getUTCMonth() + 1;

				const data = Array.from({ length: 12 }, (_, i) => {
					const mes = i + 1;
					const esFuturo =
						input.anio > anioActual ||
						(input.anio === anioActual && mes > mesActual);
					const esMesActual = input.anio === anioActual && mes === mesActual;

					const nullAging: AgingBuckets = {
						mora_30: null,
						mora_60: null,
						mora_90: null,
						mora_120: null,
						creditos_30: null,
						creditos_60: null,
						creditos_90: null,
						creditos_120: null,
					};

					if (esFuturo) {
						return {
							mes,
							colocacion_monto: null,
							colocacion_creditos: null,
							facturacion: null,
							cartera_activa: null,
							creditos_activos: null,
							...nullAging,
						};
					}

					const coloc = colocacionMap.get(mes);
					const cart = carteraMap.get(mes);
					const aging = esMesActual
						? agingActual
						: (agingHistMap.get(mes) ?? nullAging);

					return {
						mes,
						colocacion_monto: coloc?.monto ?? null,
						colocacion_creditos: coloc?.creditos ?? null,
						facturacion: cobradoMap.get(mes) ?? null,
						cartera_activa: cart?.capital ?? null,
						creditos_activos: cart?.creditos ?? null,
						...aging,
					};
				});

				return { data };
			},
		),
};
