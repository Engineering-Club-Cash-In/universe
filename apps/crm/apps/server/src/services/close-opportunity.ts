/**
 * Close Opportunity Service
 * Handles the complete flow of closing an opportunity at 100%
 * Including credit creation in cartera-back, client creation, and contract generation
 */

import { and, eq } from "drizzle-orm";
import { db } from "../db";
import {
	carteraBackReferences,
	type NewCarteraBackReference,
	renapInfo,
} from "../db/schema";
import { contratosFinanciamiento } from "../db/schema/cobros";
import {
	clients,
	leads,
	opportunities,
	salesStages,
} from "../db/schema/crm";
import {
	type CreateCreditoResult,
	createCreditoInCarteraBack,
	isCarteraBackEnabled,
} from "./cartera-back-integration";

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
	lastName: string;
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
}

interface CreateCreditResult {
	success: boolean;
	creditoResult?: CreateCreditoResult;
	error?: string;
}

interface CompleteClientParams {
	opportunity: OpportunityData;
	lead: LeadData;
	numeroSifco: string;
	creditoResult?: CreateCreditoResult;
	userId: string;
}

interface CompleteClientResult {
	success: boolean;
	clientId?: string;
	contractId?: string;
	error?: string;
}

// ============================================================================
// TRANSFORMATIONS
// ============================================================================

interface InversionistaCRM {
	inversionista_id: number;
	nombre?: string;
	porcentaje_participacion: number;
	monto_aportado: number;
	porcentaje_cash_in: number;
}

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
function transformInversionistasForCartera(
	inversionistas: InversionistaCRM[],
): InversionistaCartera[] {
	return inversionistas.map((inv) => ({
		inversionista_id: inv.inversionista_id,
		monto_aportado: inv.monto_aportado,
		porcentaje_cash_in: inv.porcentaje_cash_in,
		porcentaje_inversion: inv.porcentaje_participacion,
	}));
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
	if (!opp.diaPagoMensual) missingFields.push("día de pago mensual");

	const seguro = opp.seguro ? Number.parseFloat(opp.seguro) : undefined;
	const gps = opp.gps ? Number.parseFloat(opp.gps) : undefined;
	const reserva = opp.reserva ? Number.parseFloat(opp.reserva) : undefined;

	if (seguro === undefined || seguro === null || seguro <= 0) {
		missingFields.push("seguro (debe ser mayor a 0)");
	}
	if (gps === undefined || gps === null || gps <= 0) {
		missingFields.push("GPS (debe ser mayor a 0)");
	}
	if (reserva === undefined || reserva === null || reserva <= 0) {
		missingFields.push("reserva (debe ser mayor a 0)");
	}
	if (!opp.categoria) missingFields.push("categoría del crédito");
	if (!opp.nit) missingFields.push("NIT del cliente");

	if (
		!opp.inversionistas ||
		(typeof opp.inversionistas === "string" &&
			JSON.parse(opp.inversionistas).length === 0)
	) {
		missingFields.push("inversionistas (debe haber al menos uno)");
	}

	return missingFields;
}

// ============================================================================
// SUB-FUNCTIONS
// ============================================================================

/**
 * 1. Creates the credit in cartera-back
 * All data comes from the opportunity, only numeroSifco is generated here
 */
async function createCredit(params: CreateCreditParams): Promise<CreateCreditResult> {
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

		console.log(`[CloseOpportunity] Renap info found: ${renapInfoData ? "YES" : "NO"}`);

		// Parse all values from opportunity
		const seguro = opportunity.seguro ? Number.parseFloat(opportunity.seguro) : undefined;
		const gps = opportunity.gps ? Number.parseFloat(opportunity.gps) : undefined;
		const royalti = opportunity.royalti ? Number.parseFloat(opportunity.royalti) : undefined;
		const porcentajeRoyalti = opportunity.porcentajeRoyalti
			? Number.parseFloat(opportunity.porcentajeRoyalti)
			: undefined;
		const reserva = opportunity.reserva ? Number.parseFloat(opportunity.reserva) : undefined;
		const membresiaPago = opportunity.membresiaPago
			? Number.parseFloat(opportunity.membresiaPago)
			: undefined;
		const gastosAdministrativos = opportunity.gastosAdministrativos
			? Number(opportunity.gastosAdministrativos)
			: 0;

		const creditoResult = await createCreditoInCarteraBack({
			opportunityId: opportunity.id,
			userId,
			usuario_id: `${lead.firstName} ${lead.lastName}`,
			asesor_id: opportunity.asesorId ?? 1,
			numero_credito_sifco: numeroSifco,
			direccion: lead.direccion ?? undefined,
			capital: Number.parseFloat(opportunity.value as string),
			porcentaje_interes: Number.parseFloat(opportunity.tasaInteres as string),
			plazo: opportunity.numeroCuotas as number,
			cuota: Number.parseFloat(opportunity.cuotaMensual as string),
			tipoCredito: opportunity.creditType || "autocompra",
			observaciones: `Crédito generado desde CRM - Oportunidad: ${opportunity.title}`,
			seguro_10_cuotas: seguro,
			gps: gps,
			categoria: opportunity.categoria ?? undefined,
			nit: opportunity.nit ?? undefined,
			royalti: royalti,
			porcentaje_royalti: porcentajeRoyalti,
			reserva: reserva,
			membresias_pago: membresiaPago,
			inversionistas: opportunity.inversionistas
				? transformInversionistasForCartera(JSON.parse(opportunity.inversionistas))
				: undefined,
			rubros: opportunity.rubros ? JSON.parse(opportunity.rubros) : undefined,
			municipio:
				lead.municipio?.toUpperCase() ||
				(renapInfoData ? renapInfoData.municipalityBornedIn : undefined),
			departamento:
				lead.departamento?.toUpperCase() ||
				(renapInfoData ? renapInfoData.departmentBornedIn : undefined),
			otros: gastosAdministrativos,
			codigo_postal: "01001",
			pais: renapInfoData ? renapInfoData.bornedIn : undefined,
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

		console.log(`[CloseOpportunity] ✓ Credit successfully created: ${numeroSifco}`);
		return { success: true, creditoResult };
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.error(`[CloseOpportunity] Error creating credit: ${errorMessage}`);
		return { success: false, error: errorMessage };
	}
}

/**
 * 2. Completes the client flow: creates/gets client, creates contract, stores reference
 */
async function completeClient(params: CompleteClientParams): Promise<CompleteClientResult> {
	const { opportunity, lead, numeroSifco, creditoResult, userId } = params;

	console.log("[CloseOpportunity] Completing client flow...");

	try {
		const companyId = opportunity.companyId ?? lead.companyId ?? undefined;
		const fechaInicioDate = new Date();

		// Check if client already exists for this opportunity
		const existingClient = await db
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
				return { success: false, error: "No se puede crear el cliente sin un usuario asignado" };
			}

			// Create new client
			const newClient = await db
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
		const newContract = await db
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

		await db.insert(carteraBackReferences).values(referenceData);
		console.log("[CloseOpportunity] Stored cartera-back reference");

		// Update contract notes with sync status
		if (isCarteraBackEnabled() && creditoResult) {
			const syncNote = creditoResult.success
				? `\n✓ Sincronizado con cartera-back: ${numeroSifco}`
				: `\n⚠ Error sincronizando con cartera-back`;

			await db
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
		console.error(`[CloseOpportunity] Error completing client: ${errorMessage}`);
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

	console.log(`[CloseOpportunity] Starting close process for opportunity: ${opportunityId}`);

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

		// Get lead data
		if (!opportunity.leadId) {
			return { success: false, error: "No se puede crear el contrato sin un lead asociado" };
		}

		const [lead] = await db
			.select({
				id: leads.id,
				firstName: leads.firstName,
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

		// Generate SIFCO credit number
		const timestamp = Date.now();
		const randomSuffix = Math.floor(Math.random() * 1000)
			.toString()
			.padStart(3, "0");
		const numeroSifco = `CRM-${timestamp}-${randomSuffix}`;
		console.log(`[CloseOpportunity] Generated numero SIFCO: ${numeroSifco}`);

		// 1. Create credit in cartera-back
		const creditResult = await createCredit({
			opportunity,
			lead,
			numeroSifco,
			userId,
		});

		if (!creditResult.success) {
			return {
				success: false,
				error: creditResult.error || "Error al crear el crédito en cartera-back",
			};
		}

		// 2. Complete client flow (client, contract, references)
		const clientResult = await completeClient({
			opportunity,
			lead,
			numeroSifco,
			creditoResult: creditResult.creditoResult,
			userId,
		});

		if (!clientResult.success) {
			return {
				success: false,
				error: clientResult.error || "Error al completar el flujo de cliente",
			};
		}

		// 3. Update opportunity with numeroSifco and mark as won
		await db
			.update(opportunities)
			.set({
				numeroSifco,
				status: "won",
				actualCloseDate: new Date(),
				updatedAt: new Date(),
			})
			.where(eq(opportunities.id, opportunityId));

		console.log(`[CloseOpportunity] ✓ Opportunity closed successfully: ${opportunityId}`);

		return {
			success: true,
			numeroSifco,
			clientId: clientResult.clientId,
			contractId: clientResult.contractId,
			creditoId: creditResult.creditoResult?.credito_id,
		};
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.error(`[CloseOpportunity] Error: ${errorMessage}`);
		return { success: false, error: errorMessage };
	}
}
