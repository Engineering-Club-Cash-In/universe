import { db } from "./index";
import {
	clients,
	companies,
	creditAnalysis,
	leads,
	opportunities,
	salesStages,
} from "./schema/crm";
import {
	vehicles,
	vehicleInspections,
	vehiclePhotos,
	inspectionChecklistItems,
} from "./schema/vehicles";
import {
	contratosFinanciamiento,
	cuotasPago,
	casosCobros,
	contactosCobros,
	conveniosPago,
	recuperacionesVehiculo,
	notificacionesCobros,
} from "./schema/cobros";

async function clearAllCRMData() {
	console.log("🗑️ Clearing all CRM data...");

	try {
		// Delete cobros data first (most dependent)
		await db.delete(notificacionesCobros);
		console.log("✅ Notificaciones de cobros cleared");

		await db.delete(recuperacionesVehiculo);
		console.log("✅ Recuperaciones de vehículo cleared");

		await db.delete(conveniosPago);
		console.log("✅ Convenios de pago cleared");

		await db.delete(contactosCobros);
		console.log("✅ Contactos de cobros cleared");

		await db.delete(casosCobros);
		console.log("✅ Casos de cobros cleared");

		await db.delete(cuotasPago);
		console.log("✅ Cuotas de pago cleared");

		await db.delete(contratosFinanciamiento);
		console.log("✅ Contratos de financiamiento cleared");

		// Delete vehicle data (they depend on companies)
		await db.delete(inspectionChecklistItems);
		console.log("✅ Inspection checklist items cleared");

		await db.delete(vehiclePhotos);
		console.log("✅ Vehicle photos cleared");

		await db.delete(vehicleInspections);
		console.log("✅ Vehicle inspections cleared");

		await db.delete(vehicles);
		console.log("✅ Vehicles cleared");

		// Delete in reverse order of dependencies
		await db.delete(clients);
		console.log("✅ Clients cleared");

		await db.delete(opportunities);
		console.log("✅ Opportunities cleared");

		await db.delete(creditAnalysis);
		console.log("✅ Credit analyses cleared");

		await db.delete(leads);
		console.log("✅ Leads cleared");

		await db.delete(companies);
		console.log("✅ Companies cleared");

		await db.delete(salesStages);
		console.log("✅ Sales stages cleared");

		console.log("\n🎉 All CRM data cleared successfully!");
		console.log(
			"💡 You can now run 'bun run db:seed' to add fresh sample data.",
		);
	} catch (error) {
		console.error("❌ Error clearing CRM data:", error);
	}
}

async function main() {
	await clearAllCRMData();
	process.exit(0);
}

if (require.main === module) {
	main();
}

export { clearAllCRMData };
