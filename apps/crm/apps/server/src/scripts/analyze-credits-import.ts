/**
 * Script de Análisis de Importación de Créditos
 * Analiza los créditos de cartera-back sin escribir en la BD
 * Genera reporte detallado de qué se importará
 */

import { eq } from "drizzle-orm";
import { db } from "../db";
import { carteraBackReferences } from "../db/schema/cartera-back";
import { leads } from "../db/schema/crm";
import { carteraBackClient } from "../services/cartera-back-client";
import { isCarteraBackEnabled } from "../services/cartera-back-integration";
import type { StatusCreditEnum } from "../types/cartera-back";

// Estados a importar
const ESTADOS_IMPORTAR: StatusCreditEnum[] = [
	"ACTIVO",
	"MOROSO",
	"CANCELADO",
	"INCOBRABLE",
];

export interface AnalysisResult {
	success: boolean;
	totalCreditos: number;
	yaImportados: number;
	porImportar: number;
	breakdown: {
		ACTIVO: number;
		MOROSO: number;
		CANCELADO: number;
		INCOBRABLE: number;
		PENDIENTE_CANCELACION: number;
	};
	clientesEncontrados: number;
	clientesNuevos: number;
	vehiculosACrear: number;
	contratosACrear: number;
	referenciasACrear: number;
	estimacionDuracion: string;
	warnings: string[];
	errors: string[];
	creditosSample: Array<{
		numeroSifco: string;
		estado: string;
		capital: string;
		plazo: number;
		clienteNombre: string;
		clienteNit: string | null;
		matchEncontrado: boolean;
	}>;
}

/**
 * Analiza la importación de créditos sin escribir en BD
 */
export async function analyzeCreditsImport(): Promise<AnalysisResult> {
	if (!isCarteraBackEnabled()) {
		throw new Error("Integración con cartera-back no está habilitada");
	}

	const startTime = Date.now();

	const result: AnalysisResult = {
		success: true,
		totalCreditos: 0,
		yaImportados: 0,
		porImportar: 0,
		breakdown: {
			ACTIVO: 0,
			MOROSO: 0,
			CANCELADO: 0,
			INCOBRABLE: 0,
			PENDIENTE_CANCELACION: 0,
		},
		clientesEncontrados: 0,
		clientesNuevos: 0,
		vehiculosACrear: 0,
		contratosACrear: 0,
		referenciasACrear: 0,
		estimacionDuracion: "",
		warnings: [],
		errors: [],
		creditosSample: [],
	};

	console.log("[ImportAnalysis] Iniciando análisis de importación...");

	try {
		// 1. Obtener todos los créditos de cartera-back
		console.log("[ImportAnalysis] Obteniendo créditos de cartera-back...");

		const allCreditos = [];
		for (const estado of ESTADOS_IMPORTAR) {
			const response = await carteraBackClient.getAllCreditos({
				mes: 0,
				anio: new Date().getFullYear(),
				estado,
				page: 1,
				perPage: 10000,
			});
			allCreditos.push(...response.data);
		}

		result.totalCreditos = allCreditos.length;
		console.log(
			`[ImportAnalysis] Total de créditos encontrados: ${result.totalCreditos}`,
		);

		// 2. Analizar cada crédito
		let sampleCount = 0;
		const MAX_SAMPLE = 20; // Guardar 20 ejemplos

		for (const credito of allCreditos) {
			try {
				const numeroSifco = credito.creditos.numero_credito_sifco;
				const estado = credito.creditos.statusCredit;

				// Contar por estado
				if (estado in result.breakdown) {
					result.breakdown[estado as keyof typeof result.breakdown]++;
				}

				// Verificar si ya existe referencia
				const existingRef = await db
					.select()
					.from(carteraBackReferences)
					.where(eq(carteraBackReferences.numeroCreditoSifco, numeroSifco))
					.limit(1);

				if (existingRef.length > 0) {
					result.yaImportados++;
					continue;
				}

				// Crédito por importar
				result.porImportar++;

				// Obtener detalles completos para análisis más profundo
				// Solo para los primeros 100 para no tardar tanto
				if (result.porImportar <= 100) {
					try {
						const creditoCompleto =
							await carteraBackClient.getCredito(numeroSifco);

						// Intentar match de cliente por NIT
						let matchEncontrado = false;
						if (creditoCompleto.usuario.nit) {
							const leadMatch = await db
								.select()
								.from(leads)
								.where(eq(leads.dpi, creditoCompleto.usuario.nit))
								.limit(1);

							if (leadMatch.length > 0) {
								result.clientesEncontrados++;
								matchEncontrado = true;
							} else {
								result.clientesNuevos++;
							}
						} else {
							result.clientesNuevos++;
							result.warnings.push(
								`Crédito ${numeroSifco} no tiene NIT para matching`,
							);
						}

						// Validar datos completos
						if (!creditoCompleto.credito.capital) {
							result.warnings.push(
								`Crédito ${numeroSifco} no tiene capital definido`,
							);
						}
						if (!creditoCompleto.credito.plazo) {
							result.warnings.push(
								`Crédito ${numeroSifco} no tiene plazo definido`,
							);
						}

						// Agregar al sample
						if (sampleCount < MAX_SAMPLE) {
							result.creditosSample.push({
								numeroSifco,
								estado: creditoCompleto.credito.statusCredit,
								capital: creditoCompleto.credito.capital,
								plazo: creditoCompleto.credito.plazo,
								clienteNombre: creditoCompleto.usuario.nombre,
								clienteNit: creditoCompleto.usuario.nit,
								matchEncontrado,
							});
							sampleCount++;
						}
					} catch (error) {
						result.errors.push(
							`Error obteniendo detalles de ${numeroSifco}: ${error instanceof Error ? error.message : String(error)}`,
						);
					}
				}
			} catch (error) {
				result.errors.push(
					`Error procesando crédito: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}

		// 3. Estimar para todos los créditos por importar
		// Si solo analizamos 100 en detalle, extrapolar los ratios
		if (result.porImportar > 100) {
			const analyzed = Math.min(100, result.porImportar);
			const ratio = result.porImportar / analyzed;

			// Extrapolar clientes
			result.clientesEncontrados = Math.round(
				result.clientesEncontrados * ratio,
			);
			result.clientesNuevos = Math.round(result.clientesNuevos * ratio);

			result.warnings.push(
				`Análisis detallado solo de ${analyzed} créditos. Estadísticas de clientes son extrapoladas.`,
			);
		}

		// 4. Calcular totales a crear
		result.vehiculosACrear = result.porImportar; // 1 vehículo por crédito
		result.contratosACrear = result.porImportar; // 1 contrato por crédito
		result.referenciasACrear = result.porImportar; // 1 referencia por crédito

		// 5. Estimar duración
		// Aproximadamente 1.5 segundos por crédito (API call + inserts)
		const estimadoSegundos = result.porImportar * 1.5;
		const minutos = Math.floor(estimadoSegundos / 60);
		const segundos = Math.floor(estimadoSegundos % 60);

		if (minutos > 0) {
			result.estimacionDuracion = `~${minutos}m ${segundos}s`;
		} else {
			result.estimacionDuracion = `~${segundos}s`;
		}

		const duration = Date.now() - startTime;

		console.log("[ImportAnalysis] ✓ Análisis completado:");
		console.log(`  - Total créditos: ${result.totalCreditos}`);
		console.log(`  - Ya importados: ${result.yaImportados}`);
		console.log(`  - Por importar: ${result.porImportar}`);
		console.log(`  - Clientes a crear: ${result.clientesNuevos}`);
		console.log(`  - Vehículos a crear: ${result.vehiculosACrear}`);
		console.log(`  - Duración estimada: ${result.estimacionDuracion}`);
		console.log(`  - Análisis tomó: ${duration}ms`);

		return result;
	} catch (error) {
		result.success = false;
		result.errors.push(
			`Error fatal en análisis: ${error instanceof Error ? error.message : String(error)}`,
		);
		console.error("[ImportAnalysis] ✗ Error:", error);
		return result;
	}
}
