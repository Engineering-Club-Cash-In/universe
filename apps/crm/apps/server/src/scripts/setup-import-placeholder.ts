/**
 * Script de Setup: Crear Company Placeholder
 * Crea la company "Importados de Cartera-Back" si no existe
 */

import { eq } from "drizzle-orm";
import { db } from "../db";
import { companies } from "../db/schema/crm";

const PLACEHOLDER_COMPANY_NAME = "Importados de Cartera-Back";

export interface SetupResult {
	success: boolean;
	companyId: string;
	created: boolean;
	error?: string;
}

/**
 * Crea o busca la company placeholder para importaciones
 */
export async function setupImportPlaceholder(
	userId: string,
): Promise<SetupResult> {
	try {
		// 1. Buscar company existente
		const existing = await db
			.select()
			.from(companies)
			.where(eq(companies.name, PLACEHOLDER_COMPANY_NAME))
			.limit(1);

		if (existing.length > 0) {
			console.log(
				`[SetupImport] Company placeholder ya existe: ${existing[0].id}`,
			);
			return {
				success: true,
				companyId: existing[0].id,
				created: false,
			};
		}

		// 2. Crear nueva company
		const newCompany = await db
			.insert(companies)
			.values({
				name: PLACEHOLDER_COMPANY_NAME,
				industry: "Financiero",
				size: "Enterprise",
				notes: `Company placeholder creada automáticamente para agrupar clientes importados de cartera-back.

Esta company agrupa todos los clientes que fueron importados del sistema cartera-back y que no tienen una empresa asociada específica.

Creada: ${new Date().toISOString()}`,
				createdBy: userId,
			})
			.returning();

		console.log(
			`[SetupImport] ✓ Company placeholder creada: ${newCompany[0].id}`,
		);

		return {
			success: true,
			companyId: newCompany[0].id,
			created: true,
		};
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		console.error(`[SetupImport] ✗ Error: ${errorMsg}`);

		return {
			success: false,
			companyId: "",
			created: false,
			error: errorMsg,
		};
	}
}
