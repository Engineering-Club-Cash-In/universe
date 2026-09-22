/**
 * Verificación manual de vehículos propios contra SAT.
 *
 * El CRM raspa Agencia Virtual con Puppeteer y devuelve el listado.
 * Acá se guarda, se cruza contra `vehicles` y se emiten las cuatro señales.
 */
import { and, desc, eq, gte, inArray, isNotNull, ne, sql } from "drizzle-orm";
import type {
	SatTitularObjetivo,
	SatVehiculosDelegadosResponse,
	SatVehiculosPropiosResponse,
	VehiculoSatPropio,
} from "../controllers/satVehiculos";
import {
	obtenerVehiculosDelegados,
	titularesDelegadosDelEntorno,
} from "../controllers/satVehiculos";
import { db } from "../db";
import {
	satVerificacionCorridas,
	satVerificacionLotes,
	satVerificacionResultados,
	vehicles,
} from "../db/schema";

const HORAS_ANTIDUPLICADO = 20;
// Namespace 2 queda reservado para la verificación SAT. La conexión que
// adquiere este candado se mantiene viva durante toda la corrida de Puppeteer.
const SAT_VERIFICACION_LOCK = [2, 1] as const;

let ejecucionLocalActiva: Promise<ResumenVerificacion> | null = null;

type Veredicto =
	| "activo_ok"
	| "inactivo"
	| "no_aparece_en_sat"
	| "no_registrado_interno";

export interface ResumenVerificacion {
	corridaId: string | null;
	loteId: string | null;
	corridaIds: string[];
	estado: "en_proceso" | "ok" | "error" | "omitida";
	totalEsperados: number;
	totalReportadosSat: number;
	totalAlertas: number;
	omitida?: string;
}

type EstadoCorrida = "ok" | "error" | "codigo_requerido" | "bloqueado";
type EstadoLotePersistido = "en_proceso" | "ok" | "parcial" | "error";

interface OpcionesVerificacion {
	usuarioId?: string;
	forzar?: boolean;
	intento?: number;
	titulares?: SatTitularObjetivo[];
	/** Sustituible para probar el cruce y el guardado sin levantar Puppeteer. */
	proveedor?: () => Promise<SatVehiculosDelegadosResponse>;
	/** Se notifica únicamente después de crear el lote y todas sus corridas. */
	alRegistrar?: (resumen: ResumenVerificacion) => void;
}

interface AdvisoryLockClient {
	query<T extends object>(
		text: string,
		values?: unknown[],
	): Promise<{ rows: T[] }>;
	release(): void;
}

/**
 * Traduce el estado que reporta el scraper al enum de la corrida. Explícito
 * en vez de `toLowerCase()` con cast: si SAT agrega un estado nuevo, cae en
 * `error` en lugar de romper el insert con un valor que el enum no acepta.
 */
export function estadoCorridaDesdeSat(
	estado: SatVehiculosPropiosResponse["estado"],
): EstadoCorrida {
	switch (estado) {
		case "OK":
			return "ok";
		case "CODIGO_REQUERIDO":
			return "codigo_requerido";
		case "BLOQUEADO":
			return "bloqueado";
		default:
			return "error";
	}
}

/** El lote solo es exitoso cuando todos sus titulares se leyeron completos. */
export function estadoLoteDesdeCorridas(
	estados: EstadoCorrida[],
): "ok" | "error" {
	return estados.length > 0 && estados.every((estado) => estado === "ok")
		? "ok"
		: "error";
}

/** La interfaz solo expone los tres estados que puede accionar el usuario. */
export function estadoLoteParaUsuario(
	estado: string,
): "en_proceso" | "ok" | "error" {
	if (estado === "en_proceso") return "en_proceso";
	if (estado === "ok") return "ok";
	return "error";
}

/** SAT devuelve la placa con guion; en el CRM el formato puede variar. */
function normalizarPlaca(placa: string): string {
	return placa.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function normalizarNit(nit: string): string {
	return nit.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export type CruceCrm = "propio" | "registrado_no_propio" | "sin_registro";

/** Distingue los vehiculos propios de los registrados sin marca de propiedad. */
export function agregarCruceCrm<
	T extends { vehicleId: string | null; placa: string },
>(
	filas: T[],
	vehiculosCrm: { id: string; placa: string | null; isOwned: boolean }[],
): (T & { cruceCrm: CruceCrm })[] {
	const porId = new Map<string, CruceCrm>();
	const porPlaca = new Map<string, CruceCrm>();
	for (const vehiculo of vehiculosCrm) {
		const cruce: CruceCrm = vehiculo.isOwned
			? "propio"
			: "registrado_no_propio";
		porId.set(vehiculo.id, cruce);
		if (!vehiculo.placa) continue;
		const clave = normalizarPlaca(vehiculo.placa);
		if (clave && (cruce === "propio" || !porPlaca.has(clave))) {
			porPlaca.set(clave, cruce);
		}
	}

	return filas.map((fila) => ({
		...fila,
		cruceCrm:
			(fila.vehicleId ? porId.get(fila.vehicleId) : undefined) ??
			porPlaca.get(normalizarPlaca(fila.placa)) ??
			"sin_registro",
	}));
}

function veredictoDeEstadoSat(estadoSat: string): Veredicto {
	// Comparación exacta, no `includes`: "Inactivo" contiene "activo" y una
	// coincidencia parcial daba por bueno un vehículo inactivo.
	// Cualquier otro estado que SAT llegue a devolver cae en alerta, que es el
	// lado seguro para equivocarse.
	return estadoSat.trim().toLowerCase() === "activo" ? "activo_ok" : "inactivo";
}

/** Evita repetir la consulta si ya hubo una exitosa hace poco. */
async function hayCorridaRecienteOk(): Promise<boolean> {
	const desde = new Date(Date.now() - HORAS_ANTIDUPLICADO * 60 * 60 * 1000);

	const [reciente] = await db
		.select({ id: satVerificacionLotes.id })
		.from(satVerificacionLotes)
		.where(
			and(
				eq(satVerificacionLotes.estado, "ok"),
				gte(satVerificacionLotes.iniciadaAt, desde),
			),
		)
		.limit(1);

	return Boolean(reciente);
}

async function adquirirCandadoDistribuido(): Promise<AdvisoryLockClient | null> {
	const client = (await db.$client.connect()) as AdvisoryLockClient;

	try {
		const { rows } = await client.query<{ acquired: boolean }>(
			"SELECT pg_try_advisory_lock($1, $2) AS acquired",
			[...SAT_VERIFICACION_LOCK],
		);

		if (!rows[0]?.acquired) {
			client.release();
			return null;
		}

		return client;
	} catch (error) {
		client.release();
		throw error;
	}
}

async function liberarCandadoDistribuido(client: AdvisoryLockClient) {
	try {
		await client.query("SELECT pg_advisory_unlock($1, $2)", [
			...SAT_VERIFICACION_LOCK,
		]);
	} finally {
		client.release();
	}
}

/** El advisory lock, no una fila persistida, define si el proceso sigue vivo. */
async function hayCandadoDistribuidoActivo(): Promise<boolean> {
	const client = (await db.$client.connect()) as AdvisoryLockClient;
	try {
		const { rows } = await client.query<{ active: boolean }>(
			`SELECT EXISTS (
				SELECT 1
				FROM pg_locks
				WHERE locktype = 'advisory'
					AND classid = $1::oid
					AND objid = $2::oid
					AND objsubid = 2
					AND granted
			) AS active`,
			[...SAT_VERIFICACION_LOCK],
		);
		return rows[0]?.active === true;
	} finally {
		client.release();
	}
}

async function marcarLoteInterrumpido(loteId: string): Promise<{
	estado: EstadoLotePersistido;
	finalizadaAt: Date | null;
}> {
	const finalizadaAt = new Date();
	const mensajeError =
		"La verificación fue interrumpida antes de completar todos los titulares.";
	return db.transaction(async (tx) => {
		await tx
			.update(satVerificacionCorridas)
			.set({ estado: "error", mensajeError })
			.where(
				and(
					eq(satVerificacionCorridas.loteId, loteId),
					eq(satVerificacionCorridas.estado, "en_proceso"),
				),
			);
		const [actualizado] = await tx
			.update(satVerificacionLotes)
			.set({ estado: "error", finalizadaAt })
			.where(
				and(
					eq(satVerificacionLotes.id, loteId),
					eq(satVerificacionLotes.estado, "en_proceso"),
				),
			)
			.returning({
				estado: satVerificacionLotes.estado,
				finalizadaAt: satVerificacionLotes.finalizadaAt,
			});
		if (actualizado) return actualizado;

		const [actual] = await tx
			.select({
				estado: satVerificacionLotes.estado,
				finalizadaAt: satVerificacionLotes.finalizadaAt,
			})
			.from(satVerificacionLotes)
			.where(eq(satVerificacionLotes.id, loteId))
			.limit(1);
		return actual ?? { estado: "error", finalizadaAt };
	});
}

/** Universo esperado: lo que el CRM da por propiedad de Cash In y tiene placa. */
async function obtenerUniversoEsperado() {
	const candidatos = await db
		.select({ id: vehicles.id, placa: vehicles.licensePlate })
		.from(vehicles)
		.where(and(eq(vehicles.isOwned, true), isNotNull(vehicles.licensePlate)));
	return candidatos.filter((vehiculo) =>
		Boolean(vehiculo.placa && normalizarPlaca(vehiculo.placa)),
	);
}

export function construirResultados(
	esperados: { id: string; placa: string | null }[],
	reportados: VehiculoSatPropio[],
) {
	const porPlacaSat = new Map<string, VehiculoSatPropio>();
	for (const v of reportados) {
		const clave = normalizarPlaca(v.placa);
		if (clave) porPlacaSat.set(clave, v);
	}

	const filas: {
		vehicleId: string | null;
		placa: string;
		resultado: Veredicto;
		eraEsperado: boolean;
		estadoSat: string | null;
		tipo: string | null;
		marca: string | null;
		modelo: string | null;
		color: string | null;
		impuestoCirculacionPagado: boolean | null;
		puedeAutorizarTraspaso: boolean | null;
		puedeImprimirTarjeta: boolean | null;
		puedeImprimirCertificado: boolean | null;
	}[] = [];

	const emparejadas = new Set<string>();

	for (const esperado of esperados) {
		if (!esperado.placa) continue;
		const clave = normalizarPlaca(esperado.placa);
		if (!clave) continue;
		const enSat = porPlacaSat.get(clave);

		if (enSat) {
			emparejadas.add(clave);
			filas.push({
				vehicleId: esperado.id,
				placa: esperado.placa,
				resultado: veredictoDeEstadoSat(enSat.estado),
				eraEsperado: true,
				estadoSat: enSat.estado,
				tipo: enSat.tipo,
				marca: enSat.marca,
				modelo: enSat.modelo,
				color: enSat.color,
				impuestoCirculacionPagado: enSat.impuestoCirculacionPagado,
				puedeAutorizarTraspaso: enSat.puedeAutorizarTraspaso,
				puedeImprimirTarjeta: enSat.puedeImprimirTarjeta,
				puedeImprimirCertificado: enSat.puedeImprimirCertificado,
			});
		} else {
			// La alerta que justifica el proyecto: lo damos por propio y SAT no lo
			// tiene bajo nuestro NIT.
			filas.push({
				vehicleId: esperado.id,
				placa: esperado.placa,
				resultado: "no_aparece_en_sat",
				eraEsperado: true,
				estadoSat: null,
				tipo: null,
				marca: null,
				modelo: null,
				color: null,
				impuestoCirculacionPagado: null,
				puedeAutorizarTraspaso: null,
				puedeImprimirTarjeta: null,
				puedeImprimirCertificado: null,
			});
		}
	}

	for (const [clave, v] of porPlacaSat) {
		if (emparejadas.has(clave)) continue;
		filas.push({
			vehicleId: null,
			placa: v.placa,
			resultado: "no_registrado_interno",
			eraEsperado: false,
			estadoSat: v.estado,
			tipo: v.tipo,
			marca: v.marca,
			modelo: v.modelo,
			color: v.color,
			impuestoCirculacionPagado: v.impuestoCirculacionPagado,
			puedeAutorizarTraspaso: v.puedeAutorizarTraspaso,
			puedeImprimirTarjeta: v.puedeImprimirTarjeta,
			puedeImprimirCertificado: v.puedeImprimirCertificado,
		});
	}

	return filas;
}

export function esAlertaSat(resultado: Veredicto): boolean {
	return resultado === "inactivo" || resultado === "no_aparece_en_sat";
}

const camposActualizados = {
	loteId: sql`excluded.lote_id`,
	corridaId: sql`excluded.corrida_id`,
	placa: sql`excluded.placa`,
	resultado: sql`excluded.resultado`,
	eraEsperado: sql`excluded.era_esperado`,
	estadoSat: sql`excluded.estado_sat`,
	tipo: sql`excluded.tipo`,
	marca: sql`excluded.marca`,
	modelo: sql`excluded.modelo`,
	color: sql`excluded.color`,
	impuestoCirculacionPagado: sql`excluded.impuesto_circulacion_pagado`,
	puedeAutorizarTraspaso: sql`excluded.puede_autorizar_traspaso`,
	puedeImprimirTarjeta: sql`excluded.puede_imprimir_tarjeta`,
	puedeImprimirCertificado: sql`excluded.puede_imprimir_certificado`,
	mensajeError: sql`excluded.mensaje_error`,
	consultadoAt: sql`excluded.consultado_at`,
};

export type FilaActual = ReturnType<typeof construirResultados>[number] & {
	loteId: string;
	corridaId: string | null;
	consultadoAt: Date;
};

/** SQL parametrizado para el indice parcial de placas sin vehiculo interno. */
export function construirUpsertExternos(filas: FilaActual[]) {
	const valores = filas.map(
		(fila) => sql`(
		${fila.loteId}, ${fila.corridaId}, ${fila.placa}, ${fila.resultado},
		${fila.eraEsperado}, ${fila.estadoSat}, ${fila.tipo}, ${fila.marca},
		${fila.modelo}, ${fila.color}, ${fila.impuestoCirculacionPagado},
		${fila.puedeAutorizarTraspaso}, ${fila.puedeImprimirTarjeta},
		${fila.puedeImprimirCertificado}, ${fila.consultadoAt}
	)`,
	);
	return sql`
		INSERT INTO public.sat_verificacion_resultados (
			lote_id, corrida_id, placa, resultado, era_esperado, estado_sat,
			tipo, marca, modelo, color, impuesto_circulacion_pagado,
			puede_autorizar_traspaso, puede_imprimir_tarjeta,
			puede_imprimir_certificado, consultado_at
		) VALUES ${sql.join(valores, sql`, `)}
		ON CONFLICT ((regexp_replace(upper(placa), '[^A-Z0-9]', '', 'g')))
		WHERE vehicle_id IS NULL
		DO UPDATE SET
			lote_id = excluded.lote_id,
			corrida_id = excluded.corrida_id,
			placa = excluded.placa,
			resultado = excluded.resultado,
			era_esperado = excluded.era_esperado,
			estado_sat = excluded.estado_sat,
			tipo = excluded.tipo,
			marca = excluded.marca,
			modelo = excluded.modelo,
			color = excluded.color,
			impuesto_circulacion_pagado = excluded.impuesto_circulacion_pagado,
			puede_autorizar_traspaso = excluded.puede_autorizar_traspaso,
			puede_imprimir_tarjeta = excluded.puede_imprimir_tarjeta,
			puede_imprimir_certificado = excluded.puede_imprimir_certificado,
			mensaje_error = NULL,
			consultado_at = excluded.consultado_at
	`;
}

/** Publica una foto completa sin dejar resultados de consultas anteriores. */
async function guardarEstadoActual(loteId: string, filas: FilaActual[]) {
	await db.transaction(async (tx) => {
		const internas = filas.filter((fila) => fila.vehicleId !== null);
		const externas = filas.filter((fila) => fila.vehicleId === null);
		const tamanoLote = 500;

		for (let i = 0; i < internas.length; i += tamanoLote) {
			await tx
				.insert(satVerificacionResultados)
				.values(internas.slice(i, i + tamanoLote))
				.onConflictDoUpdate({
					target: satVerificacionResultados.vehicleId,
					targetWhere: sql`vehicle_id IS NOT NULL`,
					set: camposActualizados,
				});
		}

		for (let i = 0; i < externas.length; i += tamanoLote) {
			// Drizzle no genera ON CONFLICT para indices de expresion. La consulta
			// parametrizada apunta al mismo indice parcial definido en la 0035.
			await tx.execute(
				construirUpsertExternos(externas.slice(i, i + tamanoLote)),
			);
		}

		// Un listado completo define el universo vigente. Retiramos las filas
		// externas que ya no aparecen y los vehiculos que salieron del CRM.
		await tx
			.delete(satVerificacionResultados)
			.where(ne(satVerificacionResultados.loteId, loteId));
		await tx
			.update(satVerificacionLotes)
			.set({ estado: "ok", finalizadaAt: new Date() })
			.where(eq(satVerificacionLotes.id, loteId));
	});
}

async function ejecutarVerificacionVehiculosEnSat(
	opciones: OpcionesVerificacion = {},
): Promise<ResumenVerificacion> {
	const {
		usuarioId = "",
		forzar = false,
		intento = 1,
		titulares = titularesDelegadosDelEntorno(),
		proveedor = obtenerVehiculosDelegados,
		alRegistrar,
	} = opciones;
	if (!usuarioId) {
		throw new Error("La verificación SAT requiere un usuario autenticado.");
	}
	if (titulares.length === 0) {
		throw new Error(
			"La verificación SAT requiere al menos un titular delegado.",
		);
	}

	if (!forzar && (await hayCorridaRecienteOk())) {
		return {
			corridaId: null,
			loteId: null,
			corridaIds: [],
			estado: "omitida",
			totalEsperados: 0,
			totalReportadosSat: 0,
			totalAlertas: 0,
			omitida: `Ya hubo una corrida exitosa en las últimas ${HORAS_ANTIDUPLICADO} horas.`,
		};
	}

	const esperados = await obtenerUniversoEsperado();

	// El lote y sus corridas se registran ANTES de consultar: si el proceso
	// muere, queda constancia tanto del intento como de cada titular objetivo.
	const { lote, corridas } = await db.transaction(async (tx) => {
		const [lote] = await tx
			.insert(satVerificacionLotes)
			.values({
				usuarioId,
				usuarioNit: process.env.SAT_AV_USUARIO ?? "",
				estado: "en_proceso",
				intento,
			})
			.returning({ id: satVerificacionLotes.id });

		const corridas = await tx
			.insert(satVerificacionCorridas)
			.values(
				titulares.map((titular) => ({
					loteId: lote.id,
					titularNit: titular.nit,
					titularNombre: titular.nombre,
					estado: "en_proceso" as const,
				})),
			)
			.returning({
				id: satVerificacionCorridas.id,
				titularNit: satVerificacionCorridas.titularNit,
			});

		return { lote, corridas };
	});

	const corridaIds = corridas.map((corrida) => corrida.id);
	alRegistrar?.({
		corridaId: corridas[0]?.id ?? null,
		loteId: lote.id,
		corridaIds,
		estado: "en_proceso",
		totalEsperados: esperados.length,
		totalReportadosSat: 0,
		totalAlertas: 0,
	});

	const actualizarLoteConFallo = async (mensajeError: string) => {
		await db
			.update(satVerificacionCorridas)
			.set({ estado: "error", mensajeError })
			.where(inArray(satVerificacionCorridas.id, corridaIds));
		await db
			.update(satVerificacionLotes)
			.set({
				estado: "error",
				finalizadaAt: new Date(),
			})
			.where(eq(satVerificacionLotes.id, lote.id));
	};

	try {
		const respuesta = await proveedor();
		const respuestasPorNit = new Map(
			respuesta.titulares.map((titular) => [
				normalizarNit(titular.nit),
				titular,
			]),
		);
		const resumenes: {
			corridaId: string;
			estado: EstadoCorrida;
			totalReportadosSat: number;
			totalAlertas: number;
			mensajeError?: string;
		}[] = [];
		const vehiculosPorCorrida = new Map<string, VehiculoSatPropio[]>();

		for (const corrida of corridas) {
			const titular = respuestasPorNit.get(normalizarNit(corrida.titularNit));
			const listadoIncompleto =
				titular?.estado === "OK" &&
				(!titular.listadoCompleto || titular.vehiculos.length === 0);

			if (!titular || titular.estado !== "OK" || listadoIncompleto) {
				const estado = titular
					? titular.estado !== "OK"
						? estadoCorridaDesdeSat(titular.estado)
						: "error"
					: "error";
				const mensajeError =
					titular?.mensajeError ??
					(listadoIncompleto
						? "SAT devolvió un listado vacío o incompleto; no se generaron alertas para evitar falsos positivos."
						: "SAT no devolvió resultado para el titular configurado.");

				await db
					.update(satVerificacionCorridas)
					.set({
						estado,
						mensajeError,
					})
					.where(eq(satVerificacionCorridas.id, corrida.id));
				resumenes.push({
					corridaId: corrida.id,
					estado,
					totalReportadosSat: 0,
					totalAlertas: 0,
					mensajeError,
				});
				continue;
			}

			vehiculosPorCorrida.set(corrida.id, titular.vehiculos);
			const totalAlertas = titular.vehiculos.filter(
				(vehiculo) => veredictoDeEstadoSat(vehiculo.estado) === "inactivo",
			).length;
			await db
				.update(satVerificacionCorridas)
				.set({
					estado: "ok",
				})
				.where(eq(satVerificacionCorridas.id, corrida.id));
			resumenes.push({
				corridaId: corrida.id,
				estado: "ok",
				totalReportadosSat: titular.vehiculos.length,
				totalAlertas,
			});
		}

		const primerTitularPorPlaca = new Map<
			string,
			{ corridaId: string; vehiculo: VehiculoSatPropio }
		>();
		for (const corrida of corridas) {
			for (const vehiculo of vehiculosPorCorrida.get(corrida.id) ?? []) {
				const clave = normalizarPlaca(vehiculo.placa);
				if (!primerTitularPorPlaca.has(clave)) {
					primerTitularPorPlaca.set(clave, {
						corridaId: corrida.id,
						vehiculo,
					});
				}
			}
		}

		const filasUnificadas = construirResultados(
			esperados,
			[...primerTitularPorPlaca.values()].map((item) => item.vehiculo),
		);
		const estadoLote = estadoLoteDesdeCorridas(
			resumenes.map((resumen) => resumen.estado),
		);
		const loteCompleto = estadoLote === "ok";
		// Una consulta incompleta no reemplaza el ultimo estado completo confiable.
		const fechaConsulta = new Date();
		const filasPersistir: FilaActual[] = loteCompleto
			? filasUnificadas.map((fila) => ({
					loteId: lote.id,
					corridaId:
						primerTitularPorPlaca.get(normalizarPlaca(fila.placa))?.corridaId ??
						null,
					consultadoAt: fechaConsulta,
					...fila,
				}))
			: [];

		const totalReportadosSat = loteCompleto
			? resumenes.reduce(
					(total, resumen) => total + resumen.totalReportadosSat,
					0,
				)
			: 0;
		const totalAlertas = filasPersistir.filter((fila) =>
			esAlertaSat(fila.resultado),
		).length;

		if (loteCompleto) {
			await guardarEstadoActual(lote.id, filasPersistir);
		} else {
			await db
				.update(satVerificacionLotes)
				.set({ estado: estadoLote, finalizadaAt: new Date() })
				.where(eq(satVerificacionLotes.id, lote.id));
		}

		return {
			corridaId: corridas[0]?.id ?? null,
			loteId: lote.id,
			corridaIds,
			estado: estadoLote,
			totalEsperados: esperados.length,
			totalReportadosSat,
			totalAlertas,
		};
	} catch (error) {
		const mensajeError = error instanceof Error ? error.message : String(error);
		await actualizarLoteConFallo(mensajeError);

		return {
			corridaId: corridas[0]?.id ?? null,
			loteId: lote.id,
			corridaIds,
			estado: "error",
			totalEsperados: esperados.length,
			totalReportadosSat: 0,
			totalAlertas: 0,
		};
	}
}

/** Estado liviano para que el frontend siga la ejecución sin descargar resultados. */
export async function obtenerEstadoUltimaVerificacion() {
	const [lote] = await db
		.select({
			id: satVerificacionLotes.id,
			estado: satVerificacionLotes.estado,
			iniciadaAt: satVerificacionLotes.iniciadaAt,
			finalizadaAt: satVerificacionLotes.finalizadaAt,
		})
		.from(satVerificacionLotes)
		.orderBy(desc(satVerificacionLotes.iniciadaAt))
		.limit(1);

	if (!lote) return null;

	let estadoPersistido = lote.estado;
	let finalizadaAt = lote.finalizadaAt;
	if (
		estadoPersistido === "en_proceso" &&
		!(await hayCandadoDistribuidoActivo())
	) {
		const reconciliado = await marcarLoteInterrumpido(lote.id);
		finalizadaAt = reconciliado.finalizadaAt;
		estadoPersistido = reconciliado.estado;
	}

	const estado = estadoLoteParaUsuario(estadoPersistido);
	let mensajeError: string | null = null;
	if (estado === "error") {
		const [corridaFallida] = await db
			.select({ mensajeError: satVerificacionCorridas.mensajeError })
			.from(satVerificacionCorridas)
			.where(
				and(
					eq(satVerificacionCorridas.loteId, lote.id),
					ne(satVerificacionCorridas.estado, "ok"),
				),
			)
			.limit(1);
		mensajeError =
			corridaFallida?.mensajeError ??
			"La consulta contra SAT no se completó para todos los titulares.";
	}

	return { ...lote, estado, finalizadaAt, mensajeError };
}

/** Ultimo intento y estado actual de los vehiculos para exponerlo en el CRM. */
export async function obtenerUltimaVerificacion() {
	const [lote] = await db
		.select({
			id: satVerificacionLotes.id,
			usuarioId: satVerificacionLotes.usuarioId,
			usuarioNit: satVerificacionLotes.usuarioNit,
			estado: satVerificacionLotes.estado,
			intento: satVerificacionLotes.intento,
			iniciadaAt: satVerificacionLotes.iniciadaAt,
			finalizadaAt: satVerificacionLotes.finalizadaAt,
		})
		.from(satVerificacionLotes)
		.orderBy(desc(satVerificacionLotes.iniciadaAt))
		.limit(1);

	if (!lote) return null;

	const corridas = await db
		.select({
			id: satVerificacionCorridas.id,
			loteId: satVerificacionCorridas.loteId,
			titularNit: satVerificacionCorridas.titularNit,
			titularNombre: satVerificacionCorridas.titularNombre,
			estado: satVerificacionCorridas.estado,
			mensajeError: satVerificacionCorridas.mensajeError,
		})
		.from(satVerificacionCorridas)
		.where(eq(satVerificacionCorridas.loteId, lote.id))
		.orderBy(satVerificacionCorridas.titularNit);

	const filas = await db
		.select({
			id: satVerificacionResultados.id,
			loteId: satVerificacionResultados.loteId,
			corridaId: satVerificacionResultados.corridaId,
			vehicleId: satVerificacionResultados.vehicleId,
			placa: satVerificacionResultados.placa,
			resultado: satVerificacionResultados.resultado,
			eraEsperado: satVerificacionResultados.eraEsperado,
			estadoSat: satVerificacionResultados.estadoSat,
			tipo: satVerificacionResultados.tipo,
			marca: satVerificacionResultados.marca,
			modelo: satVerificacionResultados.modelo,
			color: satVerificacionResultados.color,
			impuestoCirculacionPagado:
				satVerificacionResultados.impuestoCirculacionPagado,
			puedeAutorizarTraspaso: satVerificacionResultados.puedeAutorizarTraspaso,
			puedeImprimirTarjeta: satVerificacionResultados.puedeImprimirTarjeta,
			puedeImprimirCertificado:
				satVerificacionResultados.puedeImprimirCertificado,
			consultadoAt: satVerificacionResultados.consultadoAt,
			titularNit: satVerificacionCorridas.titularNit,
			titularNombre: satVerificacionCorridas.titularNombre,
		})
		.from(satVerificacionResultados)
		.leftJoin(
			satVerificacionCorridas,
			eq(satVerificacionResultados.corridaId, satVerificacionCorridas.id),
		)
		.orderBy(satVerificacionResultados.placa);
	const vehiculosCrm = await db
		.select({
			id: vehicles.id,
			placa: vehicles.licensePlate,
			isOwned: vehicles.isOwned,
		})
		.from(vehicles);
	const filasConCruce = agregarCruceCrm(filas, vehiculosCrm);

	const corridasConResumen = corridas.map((corrida) => ({
		...corrida,
		totalReportadosSat: filas.filter(
			(fila) =>
				fila.corridaId === corrida.id && fila.resultado !== "no_aparece_en_sat",
		).length,
		totalAlertas: filas.filter(
			(fila) => fila.corridaId === corrida.id && esAlertaSat(fila.resultado),
		).length,
	}));
	const totalEsperados = new Set(
		filas
			.filter((fila) => fila.eraEsperado)
			.map((fila) => fila.vehicleId ?? fila.placa),
	).size;
	const totalReportadosSat = filas.filter(
		(fila) => fila.corridaId !== null && fila.resultado !== "no_aparece_en_sat",
	).length;
	const alertas = filas.filter((fila) => esAlertaSat(fila.resultado));
	const loteEstadoActualId = filas[0]?.loteId ?? null;
	const ultimoIntentoPublicoResultados = loteEstadoActualId === lote.id;
	const corrida = corridasConResumen[0] ?? null;
	// `parcial` puede existir en datos de desarrollo anteriores. Para el usuario,
	// cualquier lote que no haya completado todos los titulares es un error.
	const estadoLotePublico = estadoLoteParaUsuario(lote.estado);
	return {
		lote: {
			...lote,
			estado: estadoLotePublico,
			totalTitulares: corridas.length,
			totalCorridas: corridas.length,
			totalEsperados: ultimoIntentoPublicoResultados ? totalEsperados : 0,
			totalReportadosSat: ultimoIntentoPublicoResultados
				? totalReportadosSat
				: 0,
			totalAlertas: ultimoIntentoPublicoResultados ? alertas.length : 0,
			mensajeError:
				estadoLotePublico === "error"
					? "La consulta contra SAT no se completó para todos los titulares."
					: null,
		},
		estadoActual: loteEstadoActualId
			? {
					loteId: loteEstadoActualId,
					consultadoAt: filas[0].consultadoAt,
					totalEsperados,
					totalReportadosSat,
					totalAlertas: alertas.length,
				}
			: null,
		// Se conserva esta propiedad para no romper consumidores existentes; ahora
		// representa la corrida más reciente dentro del lote.
		corrida,
		corridas: corridasConResumen,
		resultados: filasConCruce,
		alertas: filasConCruce.filter((fila) => esAlertaSat(fila.resultado)),
		descubiertos: filasConCruce.filter(
			(fila) => fila.resultado === "no_registrado_interno",
		),
	};
}

/**
 * El advisory lock cubre varias instancias; esta promesa evita la carrera
 * entre dos llamadas simultáneas dentro del mismo proceso. Las filas
 * `en_proceso` quedan como auditoría; el endpoint de estado las contrasta con
 * este candado para detectar una ejecución abandonada tras un reinicio.
 */
export function verificarVehiculosEnSat(
	opciones: OpcionesVerificacion = {},
): Promise<ResumenVerificacion> {
	if (ejecucionLocalActiva) {
		return Promise.resolve({
			corridaId: null,
			loteId: null,
			corridaIds: [],
			estado: "omitida",
			totalEsperados: 0,
			totalReportadosSat: 0,
			totalAlertas: 0,
			omitida: "Ya hay una verificación SAT en proceso.",
		});
	}

	const ejecucion: Promise<ResumenVerificacion> = (async () => {
		const candado = await adquirirCandadoDistribuido();
		if (!candado) {
			return {
				corridaId: null,
				loteId: null,
				corridaIds: [],
				estado: "omitida",
				totalEsperados: 0,
				totalReportadosSat: 0,
				totalAlertas: 0,
				omitida: "Ya hay una verificación SAT en proceso en otra instancia.",
			};
		}

		try {
			return await ejecutarVerificacionVehiculosEnSat(opciones);
		} finally {
			await liberarCandadoDistribuido(candado);
		}
	})();
	ejecucionLocalActiva = ejecucion;
	return ejecucion.finally(() => {
		if (ejecucionLocalActiva === ejecucion) ejecucionLocalActiva = null;
	});
}

/**
 * Espera solo hasta que el trabajo haya registrado su lote. La promesa larga
 * conserva un manejador de error, pero ya no forma parte de la respuesta HTTP.
 */
export function desacoplarVerificacionSat(
	crearEjecucion: (
		alRegistrar: (resumen: ResumenVerificacion) => void,
	) => Promise<ResumenVerificacion>,
	registrarError: (error: unknown) => void = (error) =>
		console.error("[SAT] La verificación en segundo plano falló:", error),
): Promise<ResumenVerificacion> {
	let resolverInicio!: (resumen: ResumenVerificacion) => void;
	let rechazarInicio!: (error: unknown) => void;
	const inicioRegistrado = new Promise<ResumenVerificacion>(
		(resolve, reject) => {
			resolverInicio = resolve;
			rechazarInicio = reject;
		},
	);

	const ejecucion = Promise.resolve().then(() =>
		crearEjecucion(resolverInicio),
	);
	void ejecucion.catch((error) => {
		rechazarInicio(error);
		registrarError(error);
	});

	// Si la ejecución se omite antes de crear un lote, devuelve ese resultado.
	return Promise.race([inicioRegistrado, ejecucion]);
}

/** Inicia la consulta manual y responde cuando el lote ya puede ser consultado. */
export function iniciarVerificacionVehiculosEnSat(
	opciones: Omit<OpcionesVerificacion, "alRegistrar"> = {},
): Promise<ResumenVerificacion> {
	return desacoplarVerificacionSat((alRegistrar) =>
		verificarVehiculosEnSat({ ...opciones, alRegistrar }),
	);
}
