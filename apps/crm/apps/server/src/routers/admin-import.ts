/**
 * Router de Administración de Importaciones
 * Endpoints para importar créditos existentes de cartera-back
 */

import { z } from "zod";
import { adminProcedure } from "../lib/orpc";
import {
	analyzeCreditsImport,
	type AnalysisResult,
} from "../scripts/analyze-credits-import";
import {
	importCreditsFromCartera,
	type ImportResult,
} from "../scripts/import-credits-from-cartera";
import {
	setupImportPlaceholder,
	type SetupResult,
} from "../scripts/setup-import-placeholder";
import { debugCreditData } from "../scripts/debug-credit-data";

export const adminImportRouter = {
	/**
	 * Configura el entorno para importación (crea company placeholder)
	 * Debe ejecutarse antes de la importación
	 */
	setupImportacion: adminProcedure.handler(
		async ({ context }): Promise<SetupResult> => {
			console.log(
				`[AdminImport] Usuario ${context.user.email} solicitó setup de importación`,
			);

			const result = await setupImportPlaceholder(context.user.id);

			return result;
		},
	),

	/**
	 * Analiza la importación de créditos sin escribir en BD (dry-run)
	 * Retorna estadísticas de qué se importaría
	 */
	analizarImportacionCreditos: adminProcedure.handler(
		async ({ context }): Promise<AnalysisResult> => {
			console.log(
				`[AdminImport] Usuario ${context.user.email} solicitó análisis de importación`,
			);

			const result = await analyzeCreditsImport();

			return result;
		},
	),

	/**
	 * Ejecuta la importación completa de créditos desde cartera-back
	 * Crea leads, clientes, vehículos, contratos y referencias
	 */
	importarCreditosCarteraBack: adminProcedure
		.input(
			z.object({
				placeholderCompanyId: z.string().uuid(),
			}),
		)
		.handler(async ({ input, context }): Promise<ImportResult> => {
			console.log(
				`[AdminImport] Usuario ${context.user.email} inició importación de créditos`,
			);

			const result = await importCreditsFromCartera({
				importUserId: context.user.id,
				placeholderCompanyId: input.placeholderCompanyId,
			});

			console.log(
				`[AdminImport] Importación finalizada: ${result.exitosos}/${result.totalProcesados} exitosos`,
			);

			return result;
		}),

	/**
	 * Debug: Inspecciona estructura de datos de créditos
	 * Compara datos disponibles en listado vs detalle
	 */
	debugCreditData: adminProcedure.handler(async ({ context }) => {
		console.log(
			`[AdminImport] Usuario ${context.user.email} solicitó debug de datos de créditos`,
		);

		// El debug script escribe a consola, no retorna datos estructurados
		await debugCreditData();

		return { success: true, message: "Debug ejecutado, revisa logs del servidor" };
	}),
};
