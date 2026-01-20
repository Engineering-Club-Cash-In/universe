/**
 * Script de migración de datos de configuración de desarrollo a producción
 *
 * Este script migra las tablas de configuración que no tienen datos dinámicos:
 * - insurance_costs: Costos de seguro y membresía por rango de precio
 * - guatemala_locations: Departamentos y municipios de Guatemala
 * - sales_stages: Etapas del pipeline de ventas
 *
 * Uso:
 *   DATABASE_URL=<dev_url> DATABASE_URL_PROD=<prod_url> bun run src/db/migrate-config-to-prod.ts
 */

import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { insuranceCosts } from "./schema/insurance";
import { guatemalaLocations } from "./schema/locations";
import { salesStages } from "./schema/crm";

const BATCH_SIZE = 100; // Tamaño de lotes para inserciones grandes

async function main() {
	const devUrl = process.env.DATABASE_URL;
	const prodUrl = process.env.DATABASE_URL_PROD;

	if (!devUrl) {
		console.error("❌ Error: DATABASE_URL (dev) no está definida");
		process.exit(1);
	}

	if (!prodUrl) {
		console.error("❌ Error: DATABASE_URL_PROD no está definida");
		process.exit(1);
	}

	console.log("🚀 Iniciando migración de datos de configuración...\n");

	// Crear clientes de PostgreSQL
	const devClient = new Client({ connectionString: devUrl });
	const prodClient = new Client({ connectionString: prodUrl });

	try {
		// Conectar a ambas bases de datos
		console.log("📡 Conectando a base de datos de desarrollo...");
		await devClient.connect();
		const devDb = drizzle(devClient);

		console.log("📡 Conectando a base de datos de producción...");
		await prodClient.connect();
		const prodDb = drizzle(prodClient);

		// 1. Migrar insurance_costs
		console.log("\n📋 Migrando insurance_costs...");
		const insuranceData = await devDb.select().from(insuranceCosts);
		console.log(`   Encontrados ${insuranceData.length} registros en dev`);

		if (insuranceData.length > 0) {
			// Insertar en lotes
			for (let i = 0; i < insuranceData.length; i += BATCH_SIZE) {
				const batch = insuranceData.slice(i, i + BATCH_SIZE);
				await prodDb.insert(insuranceCosts).values(batch).onConflictDoNothing();
				console.log(
					`   Procesados ${Math.min(i + BATCH_SIZE, insuranceData.length)}/${insuranceData.length}`,
				);
			}
			console.log(`   ✅ insurance_costs migrada exitosamente`);
		} else {
			console.log("   ⚠️  No hay datos en insurance_costs para migrar");
		}

		// 2. Migrar guatemala_locations
		console.log("\n📋 Migrando guatemala_locations...");
		const locationsData = await devDb.select().from(guatemalaLocations);
		console.log(`   Encontrados ${locationsData.length} registros en dev`);

		if (locationsData.length > 0) {
			// Insertar en lotes
			for (let i = 0; i < locationsData.length; i += BATCH_SIZE) {
				const batch = locationsData.slice(i, i + BATCH_SIZE);
				await prodDb
					.insert(guatemalaLocations)
					.values(batch)
					.onConflictDoNothing();
				console.log(
					`   Procesados ${Math.min(i + BATCH_SIZE, locationsData.length)}/${locationsData.length}`,
				);
			}
			console.log(`   ✅ guatemala_locations migrada exitosamente`);
		} else {
			console.log("   ⚠️  No hay datos en guatemala_locations para migrar");
		}

		// 3. Migrar sales_stages
		console.log("\n📋 Migrando sales_stages...");
		const stagesData = await devDb.select().from(salesStages);
		console.log(`   Encontrados ${stagesData.length} registros en dev`);

		if (stagesData.length > 0) {
			await prodDb.insert(salesStages).values(stagesData).onConflictDoNothing();
			console.log(`   ✅ sales_stages migrada exitosamente`);
		} else {
			console.log("   ⚠️  No hay datos en sales_stages para migrar");
		}

		// Resumen
		console.log("\n========================================");
		console.log("✅ Migración completada exitosamente");
		console.log("========================================");
		console.log(`   insurance_costs:     ${insuranceData.length} registros`);
		console.log(`   guatemala_locations: ${locationsData.length} registros`);
		console.log(`   sales_stages:        ${stagesData.length} registros`);
		console.log("\nNota: Los registros existentes en producción no fueron modificados.");
	} catch (error) {
		console.error("\n❌ Error durante la migración:", error);
		process.exit(1);
	} finally {
		// Cerrar conexiones
		await devClient.end();
		await prodClient.end();
		console.log("\n📡 Conexiones cerradas");
	}
}

main();
