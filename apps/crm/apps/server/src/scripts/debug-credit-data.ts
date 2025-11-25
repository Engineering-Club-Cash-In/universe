/**
 * Script de Debug: Inspeccionar estructura de datos de créditos
 * Compara datos disponibles en listado vs detalle
 */

import { carteraBackClient } from "../services/cartera-back-client";
import { isCarteraBackEnabled } from "../services/cartera-back-integration";

export async function debugCreditData() {
	if (!isCarteraBackEnabled()) {
		throw new Error("Integración con cartera-back no está habilitada");
	}

	console.log("\n=== DEBUG: Estructura de Datos de Créditos ===\n");

	try {
		// 1. Obtener listado básico
		console.log("1️⃣ Obteniendo listado básico (getAllCreditos)...");
		const listado = await carteraBackClient.getAllCreditos({
			mes: 0,
			anio: new Date().getFullYear(),
			estado: "ACTIVO",
			page: 1,
			perPage: 5, // Solo 5 para debug
		});

		console.log(`\n📊 Total de créditos en listado: ${listado.total}`);
		console.log(`📦 Créditos obtenidos: ${listado.data.length}\n`);

		if (listado.data.length === 0) {
			console.log("❌ No hay créditos para analizar");
			return;
		}

		// 2. Analizar primer crédito del listado
		const primerCredito = listado.data[0];
		console.log("🔍 Estructura del LISTADO (primer crédito):");
		console.log(JSON.stringify(primerCredito, null, 2));
		console.log("\n");

		// 3. Obtener detalles completos
		const numeroSifco = primerCredito.creditos.numero_credito_sifco;
		console.log(
			`2️⃣ Obteniendo detalles completos para ${numeroSifco}...\n`,
		);

		try {
			const detalle = await carteraBackClient.getCredito(numeroSifco);

			console.log("🔍 Estructura del DETALLE (getCredito):");
			console.log(JSON.stringify(detalle, null, 2));
			console.log("\n");

			// 4. Comparar qué tenemos en cada uno
			console.log("📋 COMPARACIÓN DE DATOS DISPONIBLES:");
			console.log("=====================================\n");

			console.log("En LISTADO tenemos:");
			console.log("  - creditos.numero_credito_sifco:", primerCredito.creditos?.numero_credito_sifco || "❌");
			console.log("  - creditos.capital:", primerCredito.creditos?.capital || "❌");
			console.log("  - creditos.cuota:", primerCredito.creditos?.cuota || "❌");
			console.log("  - creditos.plazo:", primerCredito.creditos?.plazo || "❌");
			console.log("  - creditos.porcentaje_interes:", primerCredito.creditos?.porcentaje_interes || "❌");
			console.log("  - creditos.fecha_creacion:", primerCredito.creditos?.fecha_creacion || "❌");
			console.log("  - creditos.statusCredit:", primerCredito.creditos?.statusCredit || "❌");
			console.log("  - usuario.nombre:", primerCredito.usuario?.nombre || "❌");
			console.log("  - usuario.nit:", primerCredito.usuario?.nit || "❌");
			console.log("\n");

			console.log("En DETALLE tenemos:");
			console.log("  - credito.numero_credito_sifco:", detalle.credito?.numero_credito_sifco || "❌");
			console.log("  - credito.capital:", detalle.credito?.capital || "❌");
			console.log("  - credito.cuota:", detalle.credito?.cuota || "❌");
			console.log("  - credito.plazo:", detalle.credito?.plazo || "❌");
			console.log("  - credito.porcentaje_interes:", detalle.credito?.porcentaje_interes || "❌");
			console.log("  - credito.fecha_creacion:", detalle.credito?.fecha_creacion || "❌");
			console.log("  - credito.statusCredit:", detalle.credito?.statusCredit || "❌");
			console.log("  - usuario.nombre:", detalle.usuario?.nombre || "❌");
			console.log("  - usuario.nit:", detalle.usuario?.nit || "❌");
			console.log("  - cuotasPagadas:", detalle.cuotasPagadas?.length || 0, "cuotas");
			console.log("  - cuotasPendientes:", detalle.cuotasPendientes?.length || 0, "cuotas");
			console.log("  - cuotasAtrasadas:", detalle.cuotasAtrasadas?.length || 0, "cuotas");
			console.log("  - moraActual:", detalle.moraActual || "❌");
			console.log("\n");

			console.log("✅ CONCLUSIÓN:");
			if (primerCredito.usuario && primerCredito.creditos) {
				console.log("  El LISTADO tiene suficientes datos para importar sin getCredito");
				console.log("  Campos disponibles en listado:");
				console.log("    ✓ Datos del crédito (capital, cuota, plazo, tasa)");
				console.log("    ✓ Datos del usuario (nombre, NIT)");
				console.log("\n  Lo que FALTA en listado vs detalle:");
				console.log("    ✗ Información de cuotas (pagadas, pendientes, atrasadas)");
				console.log("    ✗ Monto de mora actual");
			} else {
				console.log("  El LISTADO NO tiene datos de usuario, necesitamos getCredito");
			}
		} catch (error) {
			console.error("\n❌ Error al obtener detalles:", error);
			console.log("\n🔍 Esto indica que este crédito tiene datos corruptos");
			console.log("   Podríamos usar el LISTADO como fallback\n");
		}

		// 5. Probar con un crédito corrupto si encontramos uno
		console.log("\n3️⃣ Buscando créditos corruptos para analizar fallback...\n");
		for (const credito of listado.data) {
			const numeroSifco = credito.creditos.numero_credito_sifco;
			try {
				await carteraBackClient.getCredito(numeroSifco);
			} catch (error) {
				if (
					error instanceof Error &&
					error.message.includes("destructure")
				) {
					console.log(`\n🔴 CRÉDITO CORRUPTO ENCONTRADO: ${numeroSifco}`);
					console.log("📦 Datos disponibles en LISTADO para este crédito:");
					console.log(JSON.stringify(credito, null, 2));
					console.log("\n");
					break;
				}
			}
		}
	} catch (error) {
		console.error("❌ Error fatal:", error);
	}

	console.log("\n=== FIN DEL DEBUG ===\n");
}

// Ejecutar si se llama directamente
if (import.meta.main) {
	debugCreditData()
		.then(() => {
			console.log("✓ Debug completado");
			process.exit(0);
		})
		.catch((error) => {
			console.error("✗ Error:", error);
			process.exit(1);
		});
}
