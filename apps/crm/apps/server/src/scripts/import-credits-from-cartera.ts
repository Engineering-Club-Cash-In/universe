/**
 * Script de Importación de Créditos desde Cartera-Back
 * Importa créditos existentes creando leads, clientes, vehículos, contratos y referencias
 */

import { eq } from "drizzle-orm";
import { db } from "../db";
import {
	carteraBackReferences,
	carteraBackSyncLog,
} from "../db/schema/cartera-back";
import {
	contratosFinanciamiento,
	type estadoContratoEnum,
} from "../db/schema/cobros";
import { clients, leads } from "../db/schema/crm";
import { vehicles } from "../db/schema/vehicles";
import { carteraBackClient } from "../services/cartera-back-client";
import { isCarteraBackEnabled } from "../services/cartera-back-integration";
import type {
	CreditoDetailResponse,
	CreditoDirectoResponse,
	StatusCreditEnum,
} from "../types/cartera-back";

// Configuración
const BATCH_SIZE = 50; // Procesar en lotes de 50
const ESTADOS_IMPORTAR: StatusCreditEnum[] = [
	"ACTIVO",
	"MOROSO",
	"CANCELADO",
	"INCOBRABLE",
];

// IDs constantes (deben ser provistos o creados)
interface ImportConfig {
	importUserId: string; // ID del usuario que ejecuta la importación
	placeholderCompanyId: string; // ID de company "Importados de Cartera-Back"
}

export interface ImportResult {
	success: boolean;
	totalProcesados: number;
	exitosos: number;
	fallidos: number;
	omitidos: number; // Ya existían
	duracion: number;
	breakdown: {
		leadsCreados: number;
		clientesCreados: number;
		vehiculosCreados: number;
		contratosCreados: number;
		referenciasCreadas: number;
	};
	errores: Array<{
		numeroSifco: string;
		error: string;
	}>;
}

/**
 * Mapea el estado de cartera-back al estado de contrato del CRM
 */
function mapEstadoContrato(
	statusCredit: StatusCreditEnum,
): (typeof estadoContratoEnum.enumValues)[number] {
	switch (statusCredit) {
		case "ACTIVO":
		case "MOROSO":
		case "PENDIENTE_CANCELACION":
			return "activo";
		case "CANCELADO":
			return "completado";
		case "INCOBRABLE":
			return "incobrable";
		default:
			return "activo";
	}
}

/**
 * Tipo unificado que puede ser del listado o del detalle
 */
type CreditoSource = CreditoDirectoResponse | CreditoDetailResponse;

/**
 * Helper para determinar si la fuente es del listado
 */
function isListadoSource(
	source: CreditoSource,
): source is CreditoDetailResponse {
	return "usuarios" in source; // El listado usa "usuarios" (plural)
}

/**
 * Extrae datos del crédito de forma unificada (listado o detalle)
 */
function extractCreditoData(source: CreditoSource) {
	if (isListadoSource(source)) {
		return source.creditos;
	}
	return source.credito;
}

/**
 * Extrae datos del usuario de forma unificada (listado o detalle)
 */
function extractUsuarioData(source: CreditoSource) {
	if (isListadoSource(source)) {
		return source.usuarios;
	}
	return source.usuario;
}

/**
 * Busca o crea un lead basado en los datos del usuario de cartera-back
 */
async function findOrCreateLead(
	creditoSource: CreditoSource,
	config: ImportConfig,
): Promise<{ id: string; created: boolean }> {
	const usuario = extractUsuarioData(creditoSource);
	const credito = extractCreditoData(creditoSource);

	// Intentar match por NIT si existe
	if (usuario.nit) {
		const existingLead = await db
			.select()
			.from(leads)
			.where(eq(leads.dpi, usuario.nit))
			.limit(1);

		if (existingLead.length > 0) {
			return { id: existingLead[0].id, created: false };
		}
	}

	// No existe - crear nuevo lead
	const nombreParts = usuario.nombre.trim().split(/\s+/);
	const firstName = nombreParts[0] || "Importado";
	const lastName = nombreParts.slice(1).join(" ") || "Sin Apellido";

	const newLeads = await db
		.insert(leads)
		.values({
			firstName,
			lastName,
			email: `imported-${usuario.usuario_id}@carteraback.import`,
			phone: "00000000", // Placeholder - cartera-back no tiene teléfono
			dpi: usuario.nit || null,
			clientType: "individual",
			assignedTo: config.importUserId,
			createdBy: config.importUserId,
			source: "other", // Usar "other" ya que "cartera_back_import" no es un valor válido del enum
			notes: `Lead creado automáticamente desde importación de cartera-back.\nFuente: Importación Cartera-Back\nNombre original: ${usuario.nombre}\nUsuario ID: ${usuario.usuario_id}\nImportado: ${new Date().toISOString()}`,
		})
		.returning();

	return { id: newLeads[0].id, created: true };
}

/**
 * Busca o crea un cliente asociado al lead
 */
async function findOrCreateClient(
	leadId: string,
	creditoSource: CreditoSource,
	config: ImportConfig,
	usingFallback: boolean,
): Promise<{ id: string; created: boolean }> {
	const credito = extractCreditoData(creditoSource);
	const usuario = extractUsuarioData(creditoSource);
	// Buscar cliente existente por leadId
	const existingClient = await db
		.select()
		.from(clients)
		.where(eq(clients.leadId, leadId))
		.limit(1);

	if (existingClient.length > 0) {
		return { id: existingClient[0].id, created: false };
	}

	// Crear nuevo cliente
	const fallbackNote = usingFallback
		? "\n⚠️ NOTA: Importado con datos del listado (fallback) debido a error en getCredito()"
		: "";

	const newClients = await db
		.insert(clients)
		.values({
			companyId: config.placeholderCompanyId,
			leadId,
			contactPerson: usuario.nombre,
			assignedTo: config.importUserId,
			createdBy: config.importUserId,
			status: "active",
			notes: `Cliente creado desde importación de cartera-back.\nCrédito: ${credito.numero_credito_sifco}${fallbackNote}`,
		})
		.returning();

	return { id: newClients[0].id, created: true };
}

/**
 * Crea un vehículo placeholder para el crédito
 */
async function createPlaceholderVehicle(
	creditoSource: CreditoSource,
	config: ImportConfig,
	usingFallback: boolean,
): Promise<string> {
	const credito = extractCreditoData(creditoSource);
	const usuario = extractUsuarioData(creditoSource);

	const year = new Date(credito.fecha_creacion).getFullYear();
	const creditoId = credito.credito_id.toString();

	const fallbackNote = usingFallback
		? "\n⚠️ NOTA: Importado con datos del listado (fallback) debido a error en getCredito()"
		: "";

	const newVehicles = await db
		.insert(vehicles)
		.values({
			make: "Importado",
			model: "Desconocido",
			year,
			licensePlate: `IMP-${creditoId.slice(-6)}`, // Últimos 6 dígitos del credito_id
			vinNumber: `IMPORT-${creditoId.padStart(17, "0")}`, // VIN placeholder
			color: "Sin Especificar",
			vehicleType: "Desconocido",
			kmMileage: 0,
			origin: "Desconocido",
			cylinders: "N/A",
			engineCC: "0",
			fuelType: "Desconocido",
			transmission: "Desconocido",
			status: "pending",
			notes: `Vehículo placeholder creado para crédito importado de cartera-back.\nNúmero SIFCO: ${credito.numero_credito_sifco}\nCliente: ${usuario.nombre}\nImportado por: ${config.importUserId}${fallbackNote}\n\nEste vehículo debe ser actualizado con los datos reales.`,
		})
		.returning();

	return newVehicles[0].id;
}

/**
 * Crea el contrato de financiamiento
 */
async function createContrato(
	clientId: string,
	vehicleId: string,
	creditoSource: CreditoSource,
	config: ImportConfig,
	usingFallback: boolean,
): Promise<string> {
	const credito = extractCreditoData(creditoSource);

	// Calcular fechas
	const fechaInicio = new Date(credito.fecha_creacion);
	const fechaVencimiento = new Date(fechaInicio);
	fechaVencimiento.setMonth(fechaVencimiento.getMonth() + credito.plazo);

	// Estado mapeado
	const estado = mapEstadoContrato(credito.statusCredit);

	const fallbackNote = usingFallback
		? "\n⚠️ NOTA: Importado con datos del listado (fallback) debido a error en getCredito()\nNo se importaron datos de cuotas (pagadas/pendientes/atrasadas)."
		: "";

	const newContratos = await db
		.insert(contratosFinanciamiento)
		.values({
			clientId,
			vehicleId,
			montoFinanciado: credito.capital,
			cuotaMensual: credito.cuota,
			numeroCuotas: credito.plazo,
			tasaInteres: credito.porcentaje_interes,
			fechaInicio,
			fechaVencimiento,
			diaPagoMensual: 15, // Default
			estado,
			createdBy: config.importUserId,
			notes: `Contrato importado de cartera-back el ${new Date().toISOString()}.\nNúmero SIFCO: ${credito.numero_credito_sifco}\nEstado original: ${credito.statusCredit}\nObservaciones: ${credito.observaciones || "N/A"}${fallbackNote}`,
		})
		.returning();

	return newContratos[0].id;
}

/**
 * Crea la referencia entre CRM y cartera-back
 */
async function createReference(
	contratoId: string,
	creditoSource: CreditoSource,
	config: ImportConfig,
): Promise<void> {
	const credito = extractCreditoData(creditoSource);

	await db.insert(carteraBackReferences).values({
		opportunityId: null, // No hay opportunity para imports
		contratoFinanciamientoId: contratoId,
		carteraCreditoId: credito.credito_id,
		numeroCreditoSifco: credito.numero_credito_sifco,
		syncedAt: new Date(),
		lastSyncStatus: "success",
		createdBy: config.importUserId,
	});
}

/**
 * Importa un solo crédito
 */
async function importSingleCredit(
	numeroSifco: string,
	config: ImportConfig,
	listadoMap: Map<string, CreditoDetailResponse>,
): Promise<{
	success: boolean;
	error?: string;
	breakdown?: {
		leadCreated: boolean;
		clientCreated: boolean;
		vehicleCreated: boolean;
		contratoCreated: boolean;
		referenceCreated: boolean;
	};
}> {
	const startTime = Date.now();

	try {
		// 1. Verificar si ya existe referencia
		const existingRef = await db
			.select()
			.from(carteraBackReferences)
			.where(eq(carteraBackReferences.numeroCreditoSifco, numeroSifco))
			.limit(1);

		if (existingRef.length > 0) {
			return { success: false, error: "Ya existe referencia" };
		}

		// 2. Intentar obtener detalles completos del crédito
		let creditoSource: CreditoSource;
		let usingFallback = false;

		try {
			creditoSource = await carteraBackClient.getCredito(numeroSifco);
		} catch (error) {
			// Si falla getCredito, intentar usar datos del listado
			console.log(
				`[ImportSingleCredit] getCredito falló para ${numeroSifco}, intentando fallback...`,
			);

			const fallbackData = listadoMap.get(numeroSifco);
			if (!fallbackData) {
				throw new Error(
					`Crédito no encontrado ni en detalle ni en listado: ${numeroSifco}`,
				);
			}

			creditoSource = fallbackData;
			usingFallback = true;
			console.log(
				`[ImportSingleCredit] ✓ Usando datos del listado (fallback) para ${numeroSifco}`,
			);
		}

		// 3. Validaciones básicas
		const credito = extractCreditoData(creditoSource);
		const usuario = extractUsuarioData(creditoSource);

		if (!credito.capital) {
			return { success: false, error: "Crédito sin capital definido" };
		}
		if (!credito.plazo) {
			return { success: false, error: "Crédito sin plazo definido" };
		}
		if (!usuario.nombre) {
			return { success: false, error: "Usuario sin nombre" };
		}

		const breakdown = {
			leadCreated: false,
			clientCreated: false,
			vehicleCreated: true, // Siempre se crea vehículo
			contratoCreated: true, // Siempre se crea contrato
			referenceCreated: true, // Siempre se crea referencia
		};

		// 4. Buscar/Crear Lead
		const lead = await findOrCreateLead(creditoSource, config);
		breakdown.leadCreated = lead.created;

		// 5. Buscar/Crear Client
		const client = await findOrCreateClient(
			lead.id,
			creditoSource,
			config,
			usingFallback,
		);
		breakdown.clientCreated = client.created;

		// 6. Crear Vehículo Placeholder
		const vehicleId = await createPlaceholderVehicle(
			creditoSource,
			config,
			usingFallback,
		);

		// 7. Crear Contrato
		const contratoId = await createContrato(
			client.id,
			vehicleId,
			creditoSource,
			config,
			usingFallback,
		);

		// 8. Crear Referencia
		await createReference(contratoId, creditoSource, config);

		// 9. Log exitoso
		await db.insert(carteraBackSyncLog).values({
			operation: "import_credit",
			entityType: "contrato",
			entityId: contratoId,
			status: "success",
			requestPayload: JSON.stringify({ numeroSifco, usingFallback }),
			responsePayload: JSON.stringify({
				contratoId,
				vehicleId,
				clientId: client.id,
				leadId: lead.id,
				usingFallback,
			}),
			startedAt: new Date(startTime),
			completedAt: new Date(),
			durationMs: Date.now() - startTime,
			userId: config.importUserId,
			source: usingFallback ? "import_script_fallback" : "import_script",
		});

		return { success: true, breakdown };
	} catch (error) {
		const errorMsg =
			error instanceof Error ? error.message : String(error);

		// Log error
		await db.insert(carteraBackSyncLog).values({
			operation: "import_credit",
			entityType: "contrato",
			entityId: numeroSifco, // Usar numeroSifco como entityId cuando falla
			status: "error",
			errorMessage: errorMsg,
			requestPayload: JSON.stringify({ numeroSifco }),
			startedAt: new Date(startTime),
			completedAt: new Date(),
			durationMs: Date.now() - startTime,
			userId: config.importUserId,
			source: "import_script",
		});

		return { success: false, error: errorMsg };
	}
}

/**
 * Ejecuta la importación completa de créditos
 */
export async function importCreditsFromCartera(
	config: ImportConfig,
): Promise<ImportResult> {
	if (!isCarteraBackEnabled()) {
		throw new Error("Integración con cartera-back no está habilitada");
	}

	const startTime = Date.now();

	const result: ImportResult = {
		success: true,
		totalProcesados: 0,
		exitosos: 0,
		fallidos: 0,
		omitidos: 0,
		duracion: 0,
		breakdown: {
			leadsCreados: 0,
			clientesCreados: 0,
			vehiculosCreados: 0,
			contratosCreados: 0,
			referenciasCreadas: 0,
		},
		errores: [],
	};

	console.log("[ImportCredits] Iniciando importación de créditos...");

	try {
		// 1. Obtener todos los créditos
		console.log("[ImportCredits] Obteniendo créditos de cartera-back...");
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

		console.log(
			`[ImportCredits] Total de créditos a procesar: ${allCreditos.length}`,
		);

		// 2. Crear mapa del listado para fallback
		console.log("[ImportCredits] Creando mapa del listado para fallback...");
		const listadoMap = new Map<string, CreditoDetailResponse>();
		for (const credito of allCreditos) {
			listadoMap.set(credito.creditos.numero_credito_sifco, credito);
		}
		console.log(
			`[ImportCredits] Mapa del listado creado: ${listadoMap.size} créditos`,
		);

		// 3. Procesar en batches
		for (let i = 0; i < allCreditos.length; i += BATCH_SIZE) {
			const batch = allCreditos.slice(i, i + BATCH_SIZE);
			const batchNum = Math.floor(i / BATCH_SIZE) + 1;
			const totalBatches = Math.ceil(allCreditos.length / BATCH_SIZE);

			console.log(
				`[ImportCredits] Procesando lote ${batchNum}/${totalBatches} (${batch.length} créditos)`,
			);

			for (const credito of batch) {
				const numeroSifco = credito.creditos.numero_credito_sifco;
				result.totalProcesados++;

				const importResult = await importSingleCredit(
					numeroSifco,
					config,
					listadoMap,
				);

				if (importResult.success) {
					result.exitosos++;

					// Actualizar breakdown
					if (importResult.breakdown) {
						if (importResult.breakdown.leadCreated)
							result.breakdown.leadsCreados++;
						if (importResult.breakdown.clientCreated)
							result.breakdown.clientesCreados++;
						if (importResult.breakdown.vehicleCreated)
							result.breakdown.vehiculosCreados++;
						if (importResult.breakdown.contratoCreated)
							result.breakdown.contratosCreados++;
						if (importResult.breakdown.referenceCreated)
							result.breakdown.referenciasCreadas++;
					}

					console.log(`[ImportCredits] ✓ ${numeroSifco} importado`);
				} else if (importResult.error === "Ya existe referencia") {
					result.omitidos++;
					console.log(`[ImportCredits] ⊘ ${numeroSifco} ya existe`);
				} else {
					result.fallidos++;
					result.errores.push({
						numeroSifco,
						error: importResult.error || "Error desconocido",
					});
					console.error(`[ImportCredits] ✗ ${numeroSifco}: ${importResult.error}`);
				}
			}

			// Pequeña pausa entre batches para no saturar
			await new Promise((resolve) => setTimeout(resolve, 100));
		}

		result.duracion = Date.now() - startTime;

		console.log("[ImportCredits] ✓ Importación completada:");
		console.log(`  - Total procesados: ${result.totalProcesados}`);
		console.log(`  - Exitosos: ${result.exitosos}`);
		console.log(`  - Fallidos: ${result.fallidos}`);
		console.log(`  - Omitidos: ${result.omitidos}`);
		console.log(`  - Leads creados: ${result.breakdown.leadsCreados}`);
		console.log(`  - Clientes creados: ${result.breakdown.clientesCreados}`);
		console.log(`  - Vehículos creados: ${result.breakdown.vehiculosCreados}`);
		console.log(`  - Contratos creados: ${result.breakdown.contratosCreados}`);
		console.log(`  - Duración: ${result.duracion}ms`);

		return result;
	} catch (error) {
		result.success = false;
		result.duracion = Date.now() - startTime;
		result.errores.push({
			numeroSifco: "FATAL",
			error:
				error instanceof Error ? error.message : "Error fatal desconocido",
		});
		console.error("[ImportCredits] ✗ Error fatal:", error);
		return result;
	}
}
