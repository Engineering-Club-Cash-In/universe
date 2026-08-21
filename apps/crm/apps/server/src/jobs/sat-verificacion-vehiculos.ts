/**
 * Verificación periódica de vehículos propios contra SAT.
 *
 * cartera-back raspa Agencia Virtual (ahí vive Chromium) y devuelve el listado.
 * Acá se guarda, se cruza contra `vehicles` y se emiten las cuatro señales.
 */
import { and, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import { db } from "../db";
import {
	satVerificacionCorridas,
	satVerificacionResultados,
	vehicles,
} from "../db/schema";
import { carteraBackClient } from "../services/cartera-back-client";
import type {
	SatVehiculosPropiosResponse,
	VehiculoSatPropio,
} from "../services/cartera-back-client";

const HORAS_ANTIDUPLICADO = 20;
const MAX_EVIDENCIA = 20000;

type Veredicto =
	| "activo_ok"
	| "inactivo"
	| "no_aparece_en_sat"
	| "no_registrado_interno";

export interface ResumenVerificacion {
	corridaId: string | null;
	estado: string;
	totalEsperados: number;
	totalReportadosSat: number;
	totalAlertas: number;
	omitida?: string;
}

type EstadoCorrida = "ok" | "error" | "codigo_requerido" | "bloqueado";

/**
 * Traduce el estado que reporta cartera-back al enum de la corrida. Explícito
 * en vez de `toLowerCase()` con cast: si cartera agrega un estado nuevo, cae en
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

/** SAT devuelve la placa con guion; en el CRM el formato puede variar. */
function normalizarPlaca(placa: string): string {
	return placa.toUpperCase().replace(/[^A-Z0-9]/g, "");
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
		.select({ id: satVerificacionCorridas.id })
		.from(satVerificacionCorridas)
		.where(
			and(
				eq(satVerificacionCorridas.estado, "ok"),
				gte(satVerificacionCorridas.iniciadaAt, desde),
			),
		)
		.limit(1);

	return Boolean(reciente);
}

/** Universo esperado: lo que el CRM da por propiedad de Cash In y tiene placa. */
async function obtenerUniversoEsperado() {
	return db
		.select({ id: vehicles.id, placa: vehicles.licensePlate })
		.from(vehicles)
		.where(and(eq(vehicles.isOwned, true), isNotNull(vehicles.licensePlate)));
}

export function construirResultados(
	esperados: { id: string; placa: string | null }[],
	reportados: VehiculoSatPropio[],
) {
	const porPlacaSat = new Map<string, VehiculoSatPropio>();
	for (const v of reportados) {
		porPlacaSat.set(normalizarPlaca(v.placa), v);
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
	}[] = [];

	const emparejadas = new Set<string>();

	for (const esperado of esperados) {
		if (!esperado.placa) continue;
		const clave = normalizarPlaca(esperado.placa);
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
		});
	}

	return filas;
}

export async function verificarVehiculosEnSat(
	opciones: {
		origen?: "cron" | "manual";
		forzar?: boolean;
		intento?: number;
		/** Sustituible para probar el cruce y el guardado sin levantar cartera-back. */
		proveedor?: () => Promise<SatVehiculosPropiosResponse>;
	} = {},
): Promise<ResumenVerificacion> {
	const {
		origen = "cron",
		forzar = false,
		intento = 1,
		proveedor = () => carteraBackClient.obtenerVehiculosPropiosSat(),
	} = opciones;

	if (!forzar && (await hayCorridaRecienteOk())) {
		return {
			corridaId: null,
			estado: "omitida",
			totalEsperados: 0,
			totalReportadosSat: 0,
			totalAlertas: 0,
			omitida: `Ya hubo una corrida exitosa en las últimas ${HORAS_ANTIDUPLICADO} horas.`,
		};
	}

	const esperados = await obtenerUniversoEsperado();

	// La corrida se registra ANTES de consultar: si el proceso muere, queda
	// constancia del intento en vez de no dejar rastro.
	const [corrida] = await db
		.insert(satVerificacionCorridas)
		.values({
			nit: "",
			estado: "en_proceso",
			origen,
			intento,
			totalEsperados: esperados.length,
		})
		.returning({ id: satVerificacionCorridas.id });

	try {
		const respuesta = await proveedor();

		if (respuesta.estado !== "OK") {
			await db
				.update(satVerificacionCorridas)
				.set({
					nit: respuesta.nit ?? "",
					estado: estadoCorridaDesdeSat(respuesta.estado),
					mensajeError: respuesta.mensajeError,
					evidencia: respuesta.evidencia?.slice(0, MAX_EVIDENCIA),
					finalizadaAt: new Date(),
				})
				.where(eq(satVerificacionCorridas.id, corrida.id));

			return {
				corridaId: corrida.id,
				estado: respuesta.estado,
				totalEsperados: esperados.length,
				totalReportadosSat: 0,
				totalAlertas: 0,
			};
		}

		const filas = construirResultados(esperados, respuesta.vehiculos);

		if (filas.length > 0) {
			await db.insert(satVerificacionResultados).values(
				filas.map((f) => ({ corridaId: corrida.id, ...f })),
			);
		}

		const totalAlertas = filas.filter(
			(f) => f.resultado === "no_aparece_en_sat" || f.resultado === "inactivo",
		).length;

		await db
			.update(satVerificacionCorridas)
			.set({
				nit: respuesta.nit,
				estado: "ok",
				totalReportadosSat: respuesta.vehiculos.length,
				totalAlertas,
				finalizadaAt: new Date(),
			})
			.where(eq(satVerificacionCorridas.id, corrida.id));

		return {
			corridaId: corrida.id,
			estado: "ok",
			totalEsperados: esperados.length,
			totalReportadosSat: respuesta.vehiculos.length,
			totalAlertas,
		};
	} catch (error) {
		const mensajeError = error instanceof Error ? error.message : String(error);

		await db
			.update(satVerificacionCorridas)
			.set({ estado: "error", mensajeError, finalizadaAt: new Date() })
			.where(eq(satVerificacionCorridas.id, corrida.id));

		return {
			corridaId: corrida.id,
			estado: "error",
			totalEsperados: esperados.length,
			totalReportadosSat: 0,
			totalAlertas: 0,
		};
	}
}

/** Última corrida con sus alertas, para exponer en el CRM. */
export async function obtenerUltimaVerificacion() {
	const [corrida] = await db
		.select()
		.from(satVerificacionCorridas)
		.orderBy(desc(satVerificacionCorridas.iniciadaAt))
		.limit(1);

	if (!corrida) return null;

	const filas = await db
		.select()
		.from(satVerificacionResultados)
		.where(
			and(
				eq(satVerificacionResultados.corridaId, corrida.id),
				sql`${satVerificacionResultados.resultado} <> 'activo_ok'`,
			),
		);

	// Separados a propósito: `no_registrado_interno` es un hallazgo de
	// reconciliación, no una alarma, y no cuenta en `totalAlertas`.
	return {
		corrida,
		alertas: filas.filter((f) => f.resultado !== "no_registrado_interno"),
		descubiertos: filas.filter((f) => f.resultado === "no_registrado_interno"),
	};
}
