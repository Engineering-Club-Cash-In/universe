/**
 * Router de Administración de Importaciones
 * Endpoints para importar créditos existentes de cartera-back
 */

import { adminProcedure } from "../lib/orpc";
import {
	analyzeCreditsImport,
	type AnalysisResult,
} from "../scripts/analyze-credits-import";
import {
	setupImportPlaceholder,
	type SetupResult,
} from "../scripts/setup-import-placeholder";

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
};
