/**
 * Close Opportunity Service
 * Handles the complete flow of closing an opportunity at 100%
 * Including credit creation in cartera-back, client creation, and contract generation
 */

import crypto from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
	carteraBackReferences,
	carteraBackSyncLog,
	type NewCarteraBackReference,
	type NewCarteraBackSyncLog,
	quotations,
	renapInfo,
	vehicles,
} from "../db/schema";
import { contratosFinanciamiento } from "../db/schema/cobros";
import { clients, leads, opportunities } from "../db/schema/crm";
import { formatMissingFields, getMissingFields } from "../lib/vehicle-helpers";
import type { FacturaItem } from "../types/cartera-back";
import { carteraBackClient } from "./cartera-back-client";
import {
	type CreateCreditoResult,
	createCreditoInCarteraBack,
	isCarteraBackEnabled,
} from "./cartera-back-integration";

// ============================================================================
// CONSTANTS
// ============================================================================

/** Minimum reserve amount in Quetzales */
export const MIN_RESERVA = 600;

/** Default postal code for Guatemala City */
export const DEFAULT_CODIGO_POSTAL = "01001";

/** Credit number prefix for CRM-generated credits */
export const CREDIT_NUMBER_PREFIX = "CRM";

function normalizePaymentDay(day: number | null | undefined): 15 | 30 | null {
	if (day == null) return null;
	if (day === 15 || day === 30) return day;
	if (day === 31) return 30;
	return null;
}

// ============================================================================
// FACTURACIÓN CONSTANTS (valores fijos para facturas)
// ============================================================================

/** Costo fijo de traspaso de vehículo */
export const FACTURACION_TRASPASO_COSTO = 400;

/** Costo fijo de garantía mobiliaria */
export const FACTURACION_GARANTIA_MOBILIARIA_COSTO = 100;

/** Costo fijo de nombramiento */
export const FACTURACION_NOMBRAMIENTO_COSTO = 150;

/** Usuario por defecto para created_by en facturación */
export const FACTURACION_CREATED_BY = 1;

// ============================================================================
// TYPES
// ============================================================================

export interface CloseOpportunityParams {
	opportunityId: string;
	userId: string;
}

export interface CloseOpportunityResult {
	success: boolean;
	numeroSifco?: string;
	clientId?: string;
	contractId?: string;
	creditoId?: number;
	error?: string;
}

interface OpportunityData {
	id: string;
	title: string;
	leadId: string | null;
	companyId: string | null;
	vehicleId: string | null;
	value: string | null;
	creditType: string | null;
	assignedTo: string | null;
	stageId: string;
	// Credit terms
	numeroCuotas: number | null;
	tasaInteres: string | null;
	cuotaMensual: string | null;
	fechaInicio: Date | null;
	diaPagoMensual: number | null;
	// Additional fields
	seguro: string | null;
	gps: string | null;
	categoria: string | null;
	nit: string | null;
	royalti: string | null;
	porcentajeRoyalti: string | null;
	reserva: string | null;
	membresiaPago: string | null;
	inversionistas: string | null;
	asesorId: number | null;
	rubros: string | null;
	gastosAdministrativos: string | null;
}

interface LeadData {
	id: string;
	firstName: string;
	middleName: string | null;
	lastName: string;
	secondLastName: string | null;
	dpi: string | null;
	companyId: string | null;
	direccion: string | null;
	departamento: string | null;
	municipio: string | null;
}

interface CreateCreditParams {
	opportunity: OpportunityData;
	lead: LeadData;
	numeroSifco: string;
	userId: string;
	cuotaMensual?: string;
	isVehicleOwned?: boolean;
	// Info del vehículo para el correo
	vehiculo_marca?: string;
	vehiculo_linea?: string;
	vehiculo_modelo?: string;
	vehiculo_placa?: string;
	vehiculo_vin?: string;
	monto_asegurado?: number;
}

interface CreateCreditResult {
	success: boolean;
	creditoResult?: CreateCreditoResult;
	error?: string;
}

/** Transaction type for Drizzle */
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

interface CompleteClientParams {
	opportunity: OpportunityData;
	lead: LeadData;
	numeroSifco: string;
	creditoResult?: CreateCreditoResult;
	userId: string;
	tx: Transaction;
}

interface CompleteClientResult {
	success: boolean;
	clientId?: string;
	contractId?: string;
	error?: string;
}

/** Datos de la última cotización aprobada para facturación */
interface QuotationDataForBilling {
	vehicleTransferCost: string | null; // Traspaso de vehículo
	leasingContractCost: string | null; // Contrato de abogado (leasing)
	mobileGuaranteeCost: string | null; // Garantía mobiliaria
	interestCost: string | null; // Intereses anticipados (cuota 0)
	extraMembershipCost: string | null; // Membresía extra (cuota 0)
	appointmentCost: string | null; // Nombramiento
	keyCopyDiffCost: string | null; // Diferencia de copia de llave
	extraInsuranceCost: string | null; // Seguro extra
	extraAdminCost: string | null; // Gastos administrativos
	insuredAmount: string | null; // Monto asegurado (para correo)
	value: string | null; // Valor del vehículo (para correo)
	monthlyPayment: string | null; // Cuota mensual (para asegurar el valor que es)
}

/** Parámetros para generación de facturas en background */
interface GenerateInvoicesParams {
	opportunityId: string;
	nit: string;
	royalti: number | null;
	quotation: QuotationDataForBilling | null;
	userId: string;
}

/** Representa una factura individual a generar */
interface InvoiceToGenerate {
	name: string; // Nombre descriptivo de la factura para logs
	/**
	 * Tipo de factura. Sirve para diferenciar la de royalty del resto:
	 * el gasto administrativo en cartera se registra SOLO para las de
	 * servicio (todas menos royalty). Ver generateInvoicesInBackground().
	 */
	kind: "royalty" | "servicio";
	items: FacturaItem[];
}

// ============================================================================
// VALIDATION SCHEMAS (Zod)
// ============================================================================

/** Schema for validating inversionista data from CRM */
const inversionistaCRMSchema = z.object({
	inversionista_id: z.number().int().positive(),
	nombre: z.string().optional(),
	porcentaje_participacion: z.number().min(0).max(100),
	monto_aportado: z.number().min(0),
	porcentaje_cash_in: z.number().min(0).max(100),
});

/** Schema for validating array of inversionistas */
const inversionistasArraySchema = z.array(inversionistaCRMSchema).min(1);

/** Schema for validating rubro data */
const rubroSchema = z.object({
	nombre_rubro: z.string().min(1),
	monto: z.number().min(0),
});

/** Schema for validating array of rubros */
const rubrosArraySchema = z.array(rubroSchema);

// ============================================================================
// TRANSFORMATIONS
// ============================================================================

type InversionistaCRM = z.infer<typeof inversionistaCRMSchema>;

interface InversionistaCartera {
	inversionista_id: number;
	monto_aportado: number;
	porcentaje_cash_in: number;
	porcentaje_inversion: number;
}

/**
 * Transforms inversionistas from CRM format to cartera-back format
 * CRM: { inversionista_id, nombre, porcentaje_participacion, monto_aportado, porcentaje_cash_in }
 * Cartera: { inversionista_id, monto_aportado, porcentaje_cash_in, porcentaje_inversion }
 */
/** ID del inversionista Cash In cuyo porcentaje es fijo */
const CASH_IN_INVERSIONISTA_ID = 86;
const CASH_IN_PORCENTAJE_CASH_IN = 100;
const CASH_IN_PORCENTAJE_INVERSION = 0;

function transformInversionistasForCartera(
	inversionistas: InversionistaCRM[],
): InversionistaCartera[] {
	return inversionistas.map((inv) => {
		if (inv.inversionista_id === CASH_IN_INVERSIONISTA_ID) {
			return {
				inversionista_id: inv.inversionista_id,
				monto_aportado: inv.monto_aportado,
				porcentaje_cash_in: CASH_IN_PORCENTAJE_CASH_IN,
				porcentaje_inversion: CASH_IN_PORCENTAJE_INVERSION,
			};
		}
		return {
			inversionista_id: inv.inversionista_id,
			monto_aportado: inv.monto_aportado,
			porcentaje_cash_in: inv.porcentaje_cash_in,
			porcentaje_inversion: inv.porcentaje_participacion,
		};
	});
}

/**
 * Safely parses and validates inversionistas JSON string
 * @returns Validated array of inversionistas or null if invalid
 */
function parseInversionistas(
	jsonString: string | null,
): InversionistaCRM[] | null {
	if (!jsonString) return null;
	try {
		const parsed = JSON.parse(jsonString);
		const result = inversionistasArraySchema.safeParse(parsed);
		if (!result.success) {
			console.error(
				"[CloseOpportunity] Invalid inversionistas data:",
				result.error.message,
			);
			return null;
		}
		return result.data;
	} catch (error) {
		console.error(
			"[CloseOpportunity] Failed to parse inversionistas JSON:",
			error,
		);
		return null;
	}
}

/**
 * Safely parses and validates rubros JSON string
 * @returns Validated array of rubros or empty array if invalid
 */
function parseRubros(
	jsonString: string | null,
): z.infer<typeof rubrosArraySchema> {
	if (!jsonString) return [];
	try {
		const parsed = JSON.parse(jsonString);
		const result = rubrosArraySchema.safeParse(parsed);
		if (!result.success) {
			console.error(
				"[CloseOpportunity] Invalid rubros data:",
				result.error.message,
			);
			return [];
		}
		return result.data;
	} catch (error) {
		console.error("[CloseOpportunity] Failed to parse rubros JSON:", error);
		return [];
	}
}

/**
 * Cleans a NIT string by removing dashes, spaces, and non-alphanumeric characters
 * @param nit - The NIT string to clean
 * @returns Cleaned NIT with only alphanumeric characters, or undefined if empty
 */
function cleanNit(nit: string | null | undefined): string | undefined {
	if (!nit) return undefined;
	const cleaned = nit.replace(/[-\s]/g, "").trim();
	return cleaned || undefined;
}

/**
 * Generates a unique credit number using UUID
 * Format: CRM-{uuid} (e.g., CRM-550e8400-e29b-41d4-a716-446655440000)
 */
function generateNumeroSifco(): string {
	const uuid = crypto.randomUUID();
	return `${CREDIT_NUMBER_PREFIX}-${uuid}`;
}

// ============================================================================
// VALIDATION
// ============================================================================

function validateOpportunityForClose(opp: OpportunityData): string[] {
	const missingFields: string[] = [];

	if (!opp.vehicleId) missingFields.push("vehículo");
	if (!opp.leadId) missingFields.push("lead/contacto");
	if (!opp.value) missingFields.push("valor del crédito");
	if (!opp.numeroCuotas) missingFields.push("número de cuotas");
	if (!opp.tasaInteres) missingFields.push("tasa de interés");
	if (!opp.cuotaMensual) missingFields.push("cuota mensual");
	if (!opp.categoria) missingFields.push("categoría del crédito");
	if (!opp.nit) missingFields.push("NIT del cliente");

	// Validate inversionistas using safe parser
	const inversionistas = parseInversionistas(opp.inversionistas);
	if (!inversionistas || inversionistas.length === 0) {
		missingFields.push(
			"inversionistas (debe haber al menos uno con datos válidos)",
		);
	}

	return missingFields;
}

// ============================================================================
// FACTURACIÓN HELPERS
// ============================================================================

/**
 * Registra un log de sincronización de facturación
 */
async function logInvoiceSyncOperation(
	log: NewCarteraBackSyncLog,
): Promise<void> {
	try {
		await db.insert(carteraBackSyncLog).values(log);
	} catch (error) {
		console.error("[CloseOpportunity] Failed to log invoice operation:", error);
	}
}

/**
 * Obtiene la última cotización aprobada de una oportunidad
 */
async function getLatestApprovedQuotation(
	opportunityId: string,
): Promise<QuotationDataForBilling | null> {
	try {
		const [quotation] = await db
			.select({
				vehicleTransferCost: quotations.vehicleTransferCost,
				leasingContractCost: quotations.leasingContractCost,
				mobileGuaranteeCost: quotations.mobileGuaranteeCost,
				interestCost: quotations.interestCost,
				extraMembershipCost: quotations.extraMembershipCost,
				appointmentCost: quotations.appointmentCost,
				keyCopyDiffCost: quotations.keyCopyDiffCost,
				extraInsuranceCost: quotations.extraInsuranceCost,
				extraAdminCost: quotations.extraAdminCost,
				insuredAmount: quotations.insuredAmount,
				value: quotations.vehicleValue,
				monthlyPayment: quotations.monthlyPayment,
			})
			.from(quotations)
			.where(eq(quotations.opportunityId, opportunityId))
			.orderBy(desc(quotations.createdAt))
			.limit(1);

		return quotation || null;
	} catch (error) {
		console.error("[CloseOpportunity] Error fetching latest quotation:", error);
		return null;
	}
}

/**
 * Construye las facturas individuales basándose en los datos de oportunidad y cotización
 * Cada punto genera una factura separada:
 * 1. ROYALTY: 1 factura con 1 rubro (royalti de oportunidad)
 * 2. TRASPASO: 1 factura con 1 rubro (Q400 fijo si vehicle_transfer_cost > 0)
 * 3. CONTRATO ABOGADO: 1 factura con 1 rubro (valor de leasing_contract_cost)
 * 4. GARANTÍA MOBILIARIA: 1 factura con 1 rubro (Q100 fijo si mobile_guarantee_cost > 0)
 * 5. CUOTA 0: 1 factura con 2 rubros (interest_cost + extra_membership_cost)
 * 6. NOMBRAMIENTO: 1 factura con 1 rubro (Q150 fijo si appointment_cost > 0)
 * 7. COPIA DE LLAVE: 1 factura con 1 rubro (valor de key_copy_diff_cost)
 * 8. SEGURO Y GASTOS ADMIN: 1 factura con 2 rubros (extra_insurance_cost + extra_admin_cost)
 */
function buildInvoices(
	royalti: number | null,
	quotation: QuotationDataForBilling | null,
): InvoiceToGenerate[] {
	const invoices: InvoiceToGenerate[] = [];

	// Cada factura se etiqueta con `kind`: "royalty" para la de royalty y
	// "servicio" para el resto. Aguas abajo, generateInvoicesInBackground()
	// usa ese kind para registrar el gasto administrativo en cartera SOLO en
	// las de servicio (la de royalty se excluye a propósito).

	// 1. ROYALTY - Siempre se factura si existe (1 factura, 1 rubro)
	if (royalti && royalti > 0) {
		invoices.push({
			name: "Royalty",
			kind: "royalty",
			items: [
				{
					monto: royalti,
					rubro: "Royalty",
				},
			],
		});
	}

	if (!quotation) {
		console.log(
			"[CloseOpportunity] No quotation found, only royalty invoice will be generated",
		);
		return invoices;
	}

	// 2. TRASPASO - Q400 fijo si tiene costo de traspaso (1 factura, 1 rubro)
	const vehicleTransferCost = quotation.vehicleTransferCost
		? Number(quotation.vehicleTransferCost)
		: 0;
	if (vehicleTransferCost > 0) {
		invoices.push({
			name: "Traspaso",
			kind: "servicio",
			items: [
				{
					monto: FACTURACION_TRASPASO_COSTO,
					rubro: "Cargo por servicios",
				},
			],
		});
	}

	// 3. CONTRATO DE ABOGADO - Facturar el valor del leasing_contract_cost (1 factura, 1 rubro)
	const leasingContractCost = quotation.leasingContractCost
		? Number(quotation.leasingContractCost)
		: 0;
	if (leasingContractCost > 0) {
		invoices.push({
			name: "Contrato Abogado",
			kind: "servicio",
			items: [
				{
					monto: leasingContractCost,
					rubro: "Cargo por servicios",
				},
			],
		});
	}

	// 4. GARANTÍA MOBILIARIA - Q100 fijo si tiene costo (1 factura, 1 rubro)
	const mobileGuaranteeCost = quotation.mobileGuaranteeCost
		? Number(quotation.mobileGuaranteeCost)
		: 0;
	if (mobileGuaranteeCost > 0) {
		invoices.push({
			name: "Garantía Mobiliaria",
			kind: "servicio",
			items: [
				{
					monto: FACTURACION_GARANTIA_MOBILIARIA_COSTO,
					rubro: "Cargo por servicios",
				},
			],
		});
	}

	// 5. CUOTA 0 - Interés anticipado y membresía (1 factura, 2 rubros)
	const interestCost = quotation.interestCost
		? Number(quotation.interestCost)
		: 0;
	const extraMembershipCost = quotation.extraMembershipCost
		? Number(quotation.extraMembershipCost)
		: 0;

	if (interestCost > 0 || extraMembershipCost > 0) {
		const cuota0Items: FacturaItem[] = [];
		if (interestCost > 0) {
			cuota0Items.push({
				monto: interestCost,
				rubro: "Gastos varios",
			});
		}
		if (extraMembershipCost > 0) {
			cuota0Items.push({
				monto: extraMembershipCost,
				rubro: "Gastos varios",
			});
		}
		if (cuota0Items.length > 0) {
			invoices.push({
				name: "Cuota 0",
				kind: "servicio",
				items: cuota0Items,
			});
		}
	}

	// 6. NOMBRAMIENTO - Q150 fijo si tiene costo (1 factura, 1 rubro)
	const appointmentCost = quotation.appointmentCost
		? Number(quotation.appointmentCost)
		: 0;
	if (appointmentCost > 0) {
		invoices.push({
			name: "Nombramiento",
			kind: "servicio",
			items: [
				{
					monto: FACTURACION_NOMBRAMIENTO_COSTO,
					rubro: "Cargo por servicios",
				},
			],
		});
	}

	// 7. COPIA DE LLAVE - Facturar el valor real de key_copy_diff_cost (1 factura, 1 rubro)
	const keyCopyDiffCost = quotation.keyCopyDiffCost
		? Number(quotation.keyCopyDiffCost)
		: 0;
	if (keyCopyDiffCost > 0) {
		invoices.push({
			name: "Copia de Llave",
			kind: "servicio",
			items: [
				{
					monto: keyCopyDiffCost,
					rubro: "Cargo por servicios",
				},
			],
		});
	}

	// 8. SEGURO Y GASTOS ADMINISTRATIVOS (1 factura, 2 rubros)
	const extraInsuranceCost = quotation.extraInsuranceCost
		? Number(quotation.extraInsuranceCost)
		: 0;
	const extraAdminCost = quotation.extraAdminCost
		? Number(quotation.extraAdminCost)
		: 0;

	if (extraInsuranceCost > 0 || extraAdminCost > 0) {
		const seguroGastosItems: FacturaItem[] = [];
		if (extraInsuranceCost > 0) {
			seguroGastosItems.push({
				monto: extraInsuranceCost,
				rubro: "Gastos varios",
			});
		}
		if (extraAdminCost > 0) {
			seguroGastosItems.push({
				monto: extraAdminCost,
				rubro: "Gastos varios",
			});
		}
		if (seguroGastosItems.length > 0) {
			invoices.push({
				name: "Seguro y Gastos Administrativos",
				kind: "servicio",
				items: seguroGastosItems,
			});
		}
	}

	return invoices;
}

/**
 * Genera facturas en cartera-back de forma asíncrona (fire-and-forget)
 * Cada factura se envía de forma secuencial para evitar saturar el servidor
 * Los errores se registran en cartera_back_sync_log pero no bloquean el flujo principal
 */
function generateInvoicesInBackground(params: GenerateInvoicesParams): void {
	const { opportunityId, nit, royalti, quotation, userId } = params;

	// Ejecutar en background (fire-and-forget)
	setImmediate(async () => {
		console.log(
			`[CloseOpportunity] Starting background invoice generation for opportunity: ${opportunityId}`,
		);

		try {
			// Construir las facturas individuales
			const invoices = buildInvoices(royalti, quotation);

			if (invoices.length === 0) {
				console.log(
					"[CloseOpportunity] No invoices to generate, skipping facturación",
				);
				return;
			}

			console.log(
				`[CloseOpportunity] Generating ${invoices.length} invoices for NIT: ${nit}`,
			);

			// Fecha de hoy en hora de Guatemala (YYYY-MM-DD). Se calcula una sola
			// vez y se reutiliza para todos los gastos administrativos del cierre.
			const fechaGuatemala = new Date().toLocaleDateString("en-CA", {
				timeZone: "America/Guatemala",
			});

			// Procesar cada factura secuencialmente
			let successCount = 0;
			let errorCount = 0;
			// Cuántos gastos administrativos se registraron (para refrescar el
			// snapshot del día una sola vez al final, si hubo al menos uno).
			let gastosRegistrados = 0;

			for (const invoice of invoices) {
				const startTime = Date.now();

				try {
					console.log(
						`[CloseOpportunity] Generating invoice: ${invoice.name} with ${invoice.items.length} item(s)`,
					);

					// Construir el payload exacto que se envía al endpoint
					const requestBody = {
						nit: nit,
						items: invoice.items,
						emisor: "CUBE",
						created_by: FACTURACION_CREATED_BY,
						credito_nuevo: true, // Indicamos que es un crédito nuevo para que cartera-back lo maneje como tal
					};

					// Llamar al endpoint de facturación genérica
					const response =
						await carteraBackClient.facturarGenerico(requestBody);

					// Registrar éxito en el log con el payload exacto enviado
					await logInvoiceSyncOperation({
						operation: "generate_invoice",
						entityType: "factura",
						entityId: `${opportunityId}-${invoice.name}`,
						status: "success",
						requestPayload: JSON.stringify(requestBody),
						responsePayload: JSON.stringify(response),
						startedAt: new Date(startTime),
						completedAt: new Date(),
						durationMs: Date.now() - startTime,
						userId,
						source: "crm",
					});

					successCount++;
					console.log(
						`[CloseOpportunity] ✓ Invoice "${invoice.name}" generated successfully`,
					);

					// 🧾 Registrar el gasto administrativo en cartera con el monto
					// facturado. Aplica a TODAS las facturas de servicio (todas menos
					// la de royalty) y solo cuando la factura se generó correctamente.
					// Es best-effort: si falla, se loguea pero NO rompe la facturación.
					if (invoice.kind !== "royalty") {
						try {
							// Monto facturado de esta factura = suma de sus rubros.
							const montoFacturado = invoice.items.reduce(
								(sum, item) => sum + item.monto,
								0,
							);

							await carteraBackClient.crearGastoAdministrativo({
								fecha: fechaGuatemala,
								concepto: `${invoice.name} (oportunidad ${opportunityId})`,
								monto: montoFacturado,
							});
							gastosRegistrados++;

							console.log(
								`[CloseOpportunity] ✓ Gasto administrativo registrado: "${invoice.name}" = ${montoFacturado}`,
							);
						} catch (gastoError) {
							const gastoMsg =
								gastoError instanceof Error
									? gastoError.message
									: String(gastoError);
							console.error(
								`[CloseOpportunity] ✗ No se pudo registrar el gasto administrativo "${invoice.name}": ${gastoMsg}`,
							);
						}
					}
				} catch (error) {
					const errorMessage =
						error instanceof Error ? error.message : String(error);

					console.error(
						`[CloseOpportunity] ✗ Failed to generate invoice "${invoice.name}": ${errorMessage}`,
					);

					// Construir el payload para el log de error
					const errorRequestBody = {
						nit: nit || "CF",
						items: invoice.items,
						created_by: FACTURACION_CREATED_BY,
					};

					// Registrar error en el log con el payload exacto
					await logInvoiceSyncOperation({
						operation: "generate_invoice",
						entityType: "factura",
						entityId: `${opportunityId}-${invoice.name}`,
						status: "error",
						errorMessage,
						requestPayload: JSON.stringify(errorRequestBody),
						startedAt: new Date(startTime),
						completedAt: new Date(),
						durationMs: Date.now() - startTime,
						userId,
						source: "crm",
					});

					errorCount++;
					// Continuar con la siguiente factura aunque esta falle
				}

				// Pequeña pausa entre facturas para no saturar el servidor
				await new Promise((resolve) => setTimeout(resolve, 100));
			}

			// 🔄 Refrescar el snapshot del día UNA sola vez. El reporte diario lee
			// de facturacion_snapshot_diario (no de gastos_administrativos), así que
			// tras insertar los gastos hay que aplicar los manuales del día para que
			// queden en las columnas administrativos/otros_cobros (mismo paso que
			// hace la UI manual). Best-effort: si falla, se loguea y sigue.
			if (gastosRegistrados > 0) {
				try {
					await carteraBackClient.aplicarManualesDia(fechaGuatemala);
					console.log(
						`[CloseOpportunity] ✓ Snapshot del día ${fechaGuatemala} refrescado (${gastosRegistrados} gasto(s))`,
					);
				} catch (snapshotError) {
					const snapshotMsg =
						snapshotError instanceof Error
							? snapshotError.message
							: String(snapshotError);
					console.error(
						`[CloseOpportunity] ✗ No se pudo refrescar el snapshot del día ${fechaGuatemala}: ${snapshotMsg}`,
					);
				}
			}

			console.log(
				`[CloseOpportunity] Invoice generation completed: ${successCount} success, ${errorCount} errors`,
			);
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);

			console.error(
				`[CloseOpportunity] ✗ Critical error in invoice generation for opportunity ${opportunityId}: ${errorMessage}`,
			);

			// Registrar error crítico en el log
			await logInvoiceSyncOperation({
				operation: "generate_invoices_batch",
				entityType: "factura",
				entityId: opportunityId,
				status: "error",
				errorMessage: `Critical error: ${errorMessage}`,
				requestPayload: JSON.stringify({
					nit,
					royalti,
					quotation,
				}),
				startedAt: new Date(),
				completedAt: new Date(),
				durationMs: 0,
				userId,
				source: "crm",
			});
		}
	});
}

// ============================================================================
// SUB-FUNCTIONS
// ============================================================================

/**
 * 1. Creates the credit in cartera-back
 * All data comes from the opportunity, only numeroSifco is generated here
 */
async function createCredit(
	params: CreateCreditParams,
): Promise<CreateCreditResult> {
	const { opportunity, lead, numeroSifco, userId } = params;

	if (!isCarteraBackEnabled()) {
		console.log("[CloseOpportunity] Cartera-back integration is DISABLED");
		return { success: true }; // Success without credit if disabled
	}

	console.log("[CloseOpportunity] Creating credit in cartera-back...");

	try {
		// Get RENAP info if available
		const [renapInfoData] = await db
			.select()
			.from(renapInfo)
			.where(eq(renapInfo.dpi, lead.dpi ?? ""))
			.limit(1);

		console.log(
			`[CloseOpportunity] Renap info found: ${renapInfoData ? "YES" : "NO"}`,
		);

		// Parse all values from opportunity
		const seguro = opportunity.seguro
			? Number.parseFloat(opportunity.seguro)
			: undefined;
		const gps = opportunity.gps
			? Number.parseFloat(opportunity.gps)
			: undefined;
		const royalti = opportunity.royalti
			? Number.parseFloat(opportunity.royalti)
			: undefined;
		const porcentajeRoyalti = opportunity.porcentajeRoyalti
			? Number.parseFloat(opportunity.porcentajeRoyalti)
			: undefined;
		const reserva = opportunity.reserva
			? Number.parseFloat(opportunity.reserva)
			: undefined;
		const membresiaPago = opportunity.membresiaPago
			? Number.parseFloat(opportunity.membresiaPago)
			: undefined;
		const gastosAdministrativos = opportunity.gastosAdministrativos
			? Number(opportunity.gastosAdministrativos)
			: 0;
		const diaPagoMensual = normalizePaymentDay(opportunity.diaPagoMensual);

		if (diaPagoMensual == null) {
			return {
				success: false,
				error:
					"La oportunidad debe tener día de pago 15 o 30 para crear el crédito en cartera-back",
			};
		}

		const creditoResult = await createCreditoInCarteraBack({
			opportunityId: opportunity.id,
			userId,
			usuario_id: `${lead.firstName} ${lead.middleName ?? ""} ${lead.lastName} ${lead.secondLastName ?? ""}`,
			asesor_id: opportunity.asesorId ?? 1,
			numero_credito_sifco: numeroSifco,
			direccion: lead.direccion ?? undefined,
			capital: Number.parseFloat(opportunity.value as string),
			porcentaje_interes: Number.parseFloat(opportunity.tasaInteres as string),
			plazo: opportunity.numeroCuotas as number,
			cuota: params.cuotaMensual ? Number(params.cuotaMensual) : Number.parseFloat(opportunity.cuotaMensual as string),
			dia_pago_mensual: diaPagoMensual,
			tipoCredito: opportunity.creditType || "autocompra",
			observaciones: `Crédito generado desde CRM - Oportunidad: ${opportunity.title}`,
			seguro_10_cuotas: seguro,
			gps: gps,
			categoria: opportunity.categoria ?? undefined,
			nit: cleanNit(opportunity.nit),
			royalti: royalti,
			porcentaje_royalti: porcentajeRoyalti,
			reserva: reserva,
			membresias_pago: membresiaPago,
			inversionistas: (() => {
				const parsed = parseInversionistas(opportunity.inversionistas);
				return parsed ? transformInversionistasForCartera(parsed) : undefined;
			})(),
			rubros: parseRubros(opportunity.rubros),
			municipio:
				lead.municipio?.toUpperCase() ||
				(renapInfoData ? renapInfoData.municipalityBornedIn : undefined),
			departamento:
				lead.departamento?.toUpperCase() ||
				(renapInfoData ? renapInfoData.departmentBornedIn : undefined),
			otros: gastosAdministrativos,
			codigo_postal: DEFAULT_CODIGO_POSTAL,
			pais: renapInfoData ? renapInfoData.bornedIn : undefined,
			is_vehiculo_propio: params.isVehicleOwned ?? false,
			// Campos para el correo de notificación
			vehiculo_marca: params.vehiculo_marca,
			vehiculo_linea: params.vehiculo_linea,
			vehiculo_modelo: params.vehiculo_modelo,
			vehiculo_placa: params.vehiculo_placa,
			vehiculo_vin: params.vehiculo_vin,
			monto_asegurado: params.monto_asegurado,
		});

		if (!creditoResult.success) {
			console.error(
				`[CloseOpportunity] CRITICAL: Failed to create credit in cartera-back: ${creditoResult.error}`,
			);
			return {
				success: false,
				error: `No se pudo crear el crédito en cartera-back: ${creditoResult.error || "Error desconocido"}`,
			};
		}

		console.log(
			`[CloseOpportunity] ✓ Credit successfully created: ${numeroSifco}`,
		);
		return { success: true, creditoResult };
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.error(`[CloseOpportunity] Error creating credit: ${errorMessage}`);
		return { success: false, error: errorMessage };
	}
}

/**
 * 2. Completes the client flow: creates/gets client, creates contract, stores reference
 * Uses transaction context for atomic operations
 */
async function completeClient(
	params: CompleteClientParams,
): Promise<CompleteClientResult> {
	const { opportunity, lead, numeroSifco, creditoResult, userId, tx } = params;

	console.log("[CloseOpportunity] Completing client flow...");

	try {
		const companyId = opportunity.companyId ?? lead.companyId ?? undefined;
		const fechaInicioDate = new Date();

		// Check if client already exists for this opportunity
		const existingClient = await tx
			.select()
			.from(clients)
			.where(eq(clients.opportunityId, opportunity.id))
			.limit(1);

		let clientId: string;

		if (existingClient.length > 0) {
			clientId = existingClient[0].id;
			console.log(`[CloseOpportunity] Using existing client: ${clientId}`);
		} else {
			// Ensure we have required fields for client creation
			if (!opportunity.assignedTo) {
				return {
					success: false,
					error: "No se puede crear el cliente sin un usuario asignado",
				};
			}

			// Create new client
			const newClient = await tx
				.insert(clients)
				.values({
					...(companyId && { companyId }),
					opportunityId: opportunity.id,
					contactPerson: `${lead.firstName} ${lead.lastName}`,
					contractValue: opportunity.value,
					startDate: fechaInicioDate,
					status: "active",
					assignedTo: opportunity.assignedTo,
					notes: `Cliente generado automáticamente desde oportunidad: ${opportunity.title}`,
					createdBy: userId,
				})
				.returning();

			clientId = newClient[0].id;
			console.log(`[CloseOpportunity] Created new client: ${clientId}`);
		}

		// Calculate contract end date
		const fechaVencimiento = new Date(fechaInicioDate);
		fechaVencimiento.setMonth(
			fechaVencimiento.getMonth() + (opportunity.numeroCuotas as number),
		);

		// Create financing contract (local CRM)
		const newContract = await tx
			.insert(contratosFinanciamiento)
			.values({
				clientId,
				vehicleId: opportunity.vehicleId as string,
				montoFinanciado: opportunity.value as string,
				cuotaMensual: opportunity.cuotaMensual as string,
				numeroCuotas: opportunity.numeroCuotas as number,
				tasaInteres: opportunity.tasaInteres as string,
				fechaInicio: fechaInicioDate,
				fechaVencimiento,
				diaPagoMensual: opportunity.diaPagoMensual as number,
				estado: "activo",
				notes: `Contrato generado desde oportunidad: ${opportunity.title}`,
				createdBy: userId,
			})
			.returning();

		console.log(`[CloseOpportunity] Created contract: ${newContract[0].id}`);

		// Store reference in CRM
		const referenceData: NewCarteraBackReference = {
			opportunityId: opportunity.id,
			contratoFinanciamientoId: newContract[0].id,
			carteraCreditoId: creditoResult?.credito_id as number,
			numeroCreditoSifco: creditoResult?.numero_credito_sifco ?? numeroSifco,
			syncedAt: new Date(),
			lastSyncStatus: "success",
			createdBy: userId,
		};

		await tx.insert(carteraBackReferences).values(referenceData);
		console.log("[CloseOpportunity] Stored cartera-back reference");

		// Update contract notes with sync status
		if (isCarteraBackEnabled() && creditoResult) {
			const syncNote = creditoResult.success
				? `\n✓ Sincronizado con cartera-back: ${numeroSifco}`
				: "\n⚠ Error sincronizando con cartera-back";

			await tx
				.update(contratosFinanciamiento)
				.set({
					notes: `${newContract[0].notes}${syncNote}`,
					updatedAt: new Date(),
				})
				.where(eq(contratosFinanciamiento.id, newContract[0].id));
		}

		return {
			success: true,
			clientId,
			contractId: newContract[0].id,
		};
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.error(
			`[CloseOpportunity] Error completing client: ${errorMessage}`,
		);
		return { success: false, error: errorMessage };
	}
}

// ============================================================================
// MAIN FUNCTION
// ============================================================================

/**
 * Main function to close an opportunity at 100%
 * 1. Validates all required fields are present in the opportunity
 * 2. Creates the credit in cartera-back
 * 3. Creates/gets client, creates contract, stores references
 * 4. Updates the opportunity with the new status
 */
export async function closeOpportunity(
	params: CloseOpportunityParams,
): Promise<CloseOpportunityResult> {
	const { opportunityId, userId } = params;

	console.log(
		`[CloseOpportunity] Starting close process for opportunity: ${opportunityId}`,
	);

	try {
		// Get current opportunity
		const [opportunity] = await db
			.select({
				id: opportunities.id,
				title: opportunities.title,
				leadId: opportunities.leadId,
				companyId: opportunities.companyId,
				vehicleId: opportunities.vehicleId,
				value: opportunities.value,
				creditType: opportunities.creditType,
				assignedTo: opportunities.assignedTo,
				stageId: opportunities.stageId,
				numeroCuotas: opportunities.numeroCuotas,
				tasaInteres: opportunities.tasaInteres,
				cuotaMensual: opportunities.cuotaMensual,
				fechaInicio: opportunities.fechaInicio,
				diaPagoMensual: opportunities.diaPagoMensual,
				seguro: opportunities.seguro,
				gps: opportunities.gps,
				categoria: opportunities.categoria,
				nit: opportunities.nit,
				royalti: opportunities.royalti,
				porcentajeRoyalti: opportunities.porcentajeRoyalti,
				reserva: opportunities.reserva,
				membresiaPago: opportunities.membresiaPago,
				inversionistas: opportunities.inversionistas,
				asesorId: opportunities.asesorId,
				rubros: opportunities.rubros,
				gastosAdministrativos: opportunities.gastosAdministrativos,
			})
			.from(opportunities)
			.where(eq(opportunities.id, opportunityId))
			.limit(1);

		if (!opportunity) {
			return { success: false, error: "Oportunidad no encontrada" };
		}

		// Validate all required fields
		const missingFields = validateOpportunityForClose(opportunity);
		if (missingFields.length > 0) {
			console.log("[CloseOpportunity] Missing fields:", missingFields);
			return {
				success: false,
				error: `No se puede cerrar la oportunidad. Faltan los siguientes datos: ${missingFields.join(", ")}`,
			};
		}

		let vehicleData:
			| {
					isNew: boolean;
					isOwned: boolean;
					vinNumber: string | null;
					licensePlate: string | null;
					origin: string | null;
					fuelType: string | null;
					transmission: string | null;
					companyId: string | null;
					// Extra vehicle info for email
					make: string | null;
					model: string | null;
					year: number | null;
					montoAsegurado: string | null;
			  }
			| undefined;

		// Validate vehicle data completeness for new vehicles
		if (opportunity.vehicleId) {
			const [vehicleTemp] = await db
				.select({
					isNew: vehicles.isNew,
					isOwned: vehicles.isOwned,
					vinNumber: vehicles.vinNumber,
					licensePlate: vehicles.licensePlate,
					origin: vehicles.origin,
					fuelType: vehicles.fuelType,
					transmission: vehicles.transmission,
					companyId: vehicles.companyId,
					// Extra vehicle info for email
					make: vehicles.make,
					model: vehicles.model,
					year: vehicles.year,
					montoAsegurado: vehicles.montoAsegurado,
				})
				.from(vehicles)
				.where(eq(vehicles.id, opportunity.vehicleId))
				.limit(1);
			vehicleData = vehicleTemp;

			if (vehicleData?.isNew) {
				const missingVehicleFields = getMissingFields(vehicleData);
				if (missingVehicleFields.length > 0) {
					console.log(
						"[CloseOpportunity] Missing vehicle fields for new vehicle:",
						missingVehicleFields,
					);
					return {
						success: false,
						error: `El vehículo nuevo no tiene todos los datos completos. Faltan: ${formatMissingFields(missingVehicleFields)}`,
					};
				}
				console.log("[CloseOpportunity] New vehicle data is complete");
			}
		}

		// Get lead data
		if (!opportunity.leadId) {
			return {
				success: false,
				error: "No se puede crear el contrato sin un lead asociado",
			};
		}

		const [lead] = await db
			.select({
				id: leads.id,
				firstName: leads.firstName,
				middleName: leads.middleName,
				secondLastName: leads.secondLastName,
				lastName: leads.lastName,
				dpi: leads.dpi,
				companyId: leads.companyId,
				direccion: leads.direccion,
				departamento: leads.departamento,
				municipio: leads.municipio,
			})
			.from(leads)
			.where(eq(leads.id, opportunity.leadId))
			.limit(1);

		if (!lead) {
			return { success: false, error: "Lead no encontrado" };
		}

		console.log("[CloseOpportunity] Lead data found:", lead.id);

		// Validate NIT against cartera-back before proceeding
		if (opportunity.nit) {
			const nitLimpio = opportunity.nit.replace(/[-\s]/g, "").toUpperCase();
			console.log(
				`[CloseOpportunity] Validating NIT: ${nitLimpio}`,
			);

			if (nitLimpio.length < 5 && nitLimpio !== "CF") {
				return {
					success: false,
					error: `El NIT "${opportunity.nit}" es inválido. Debe tener al menos 5 caracteres o ser "CF".`,
				};
			}

			try {
				const nitResult = await carteraBackClient.consultarNit(nitLimpio);

				if (!nitResult.success) {
					return {
						success: false,
						error: `NIT inválido: ${nitResult.mensaje}. Corrige el NIT antes de cerrar la oportunidad.`,
					};
				}

				if (nitResult.data?.nombre === null) {
					return {
						success: false,
						error: `El NIT "${opportunity.nit}" no fue encontrado en el registro de SAT. Verifica que sea correcto antes de cerrar.`,
					};
				}

				console.log(
					`[CloseOpportunity] NIT validated: ${nitResult.data?.nombre}`,
				);
			} catch (error) {
				console.error("[CloseOpportunity] Error validating NIT:", error);
				return {
					success: false,
					error: `No se pudo validar el NIT contra SAT. Intenta de nuevo o verifica la conexión con cartera.`,
				};
			}
		}

		// Generate unique SIFCO credit number using UUID
		const numeroSifco = generateNumeroSifco();
		console.log(`[CloseOpportunity] Generated numero SIFCO: ${numeroSifco}`);


		//  Get the latest quotation for invoicing (async - doesn't block)
		const quotation = await getLatestApprovedQuotation(opportunityId);
		console.log(
			`[CloseOpportunity] Latest quotation found: ${quotation ? "YES" : "NO"}`,
		);

		//  Create credit in cartera-back
		const creditResult = await createCredit({
			opportunity,
			lead,
			numeroSifco,
			userId,
			cuotaMensual: quotation?.monthlyPayment ? String(quotation.monthlyPayment) : undefined,
			isVehicleOwned: vehicleData?.isOwned ?? false,
			// Enviar info del vehículo para que llegue en el correo de cartera
			vehiculo_marca: vehicleData?.make ?? undefined,
			vehiculo_linea: vehicleData?.model ?? undefined, // Usamos model como línea
			vehiculo_modelo: vehicleData?.year ? String(vehicleData.year) : undefined,
			vehiculo_placa: vehicleData?.licensePlate ?? undefined,
			vehiculo_vin: vehicleData?.vinNumber ?? undefined,
			monto_asegurado: quotation?.insuredAmount ? Number(quotation.insuredAmount) : quotation?.value ? Number(quotation.value) : undefined,
		});

		if (!creditResult.success) {
			return {
				success: false,
				error:
					creditResult.error || "Error al crear el crédito en cartera-back",
			};
		}


		// 3. Generate invoices in background (fire-and-forget)
		// This runs asynchronously after the credit is created
		// Skip invoice generation if the vehicle is owned
		const vehicleHasCompany = vehicleData?.isOwned;

		if (isCarteraBackEnabled() && !vehicleHasCompany) {
			const royalti = opportunity.royalti
				? Number.parseFloat(opportunity.royalti)
				: null;

			generateInvoicesInBackground({
				opportunityId,
				nit: cleanNit(opportunity.nit) || "CF",
				royalti,
				quotation,
				userId,
			});
			console.log("[CloseOpportunity] Invoice generation queued in background");
		} else if (vehicleHasCompany) {
			console.log(
				"[CloseOpportunity] Skipping invoice generation - vehicle belongs to a company",
			);
		}

		// 4. Complete local operations in a transaction for atomicity
		// This ensures that if any local operation fails, all changes are rolled back
		const transactionResult = await db.transaction(async (tx) => {
			// Complete client flow (client, contract, references)
			const clientResult = await completeClient({
				opportunity,
				lead,
				numeroSifco,
				creditoResult: creditResult.creditoResult,
				userId,
				tx,
			});

			if (!clientResult.success) {
				throw new Error(
					clientResult.error || "Error al completar el flujo de cliente",
				);
			}

			// Update opportunity with numeroSifco and mark as won
			await tx
				.update(opportunities)
				.set({
					numeroSifco,
					status: "won",
					actualCloseDate: new Date(),
					updatedAt: new Date(),
				})
				.where(eq(opportunities.id, opportunityId));

			// Update vehicle status to 'sold'
			if (opportunity.vehicleId) {
				await tx
					.update(vehicles)
					.set({
						status: "sold",
						updatedAt: new Date(),
					})
					.where(eq(vehicles.id, opportunity.vehicleId));
				console.log(
					`[CloseOpportunity] ✓ Vehicle ${opportunity.vehicleId} marked as sold`,
				);
			}

			return {
				clientId: clientResult.clientId,
				contractId: clientResult.contractId,
			};
		});

		console.log(
			`[CloseOpportunity] ✓ Opportunity closed successfully: ${opportunityId}`,
		);

		return {
			success: true,
			numeroSifco,
			clientId: transactionResult.clientId,
			contractId: transactionResult.contractId,
			creditoId: creditResult.creditoResult?.credito_id,
		};
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.error(`[CloseOpportunity] Error: ${errorMessage}`);
		return { success: false, error: errorMessage };
	}
}
