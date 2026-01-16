/**
 * Cartera-Back Integration Helpers
 * High-level functions for integrating CRM operations with cartera-back
 */

import { eq } from "drizzle-orm";
import { db } from "../db";
import {
	carteraBackReferences,
	carteraBackSyncLog,
	type NewCarteraBackReference,
	type NewCarteraBackSyncLog,
	type NewPagoReference,
	pagoReferences,
} from "../db/schema";
import type {
	CarteraCredito,
	CarteraPagoCredito,
	CreateCreditoInput,
	CreatePagoInput,
} from "../types/cartera-back";
import { carteraBackClient } from "./cartera-back-client";

// ============================================================================
// FEATURE FLAGS
// ============================================================================

export function isCarteraBackEnabled(): boolean {
	return process.env.ENABLE_CARTERA_BACK_INTEGRATION === "true";
}

export function isCarteraBackPaymentsEnabled(): boolean {
	return process.env.ENABLE_CARTERA_BACK_PAYMENTS === "true";
}

// ============================================================================
// SYNC LOGGING
// ============================================================================

async function logSyncOperation(log: NewCarteraBackSyncLog): Promise<void> {
	try {
		await db.insert(carteraBackSyncLog).values(log);
	} catch (error) {
		console.error("[CarteraBackSync] Failed to log operation:", error);
	}
}

// ============================================================================
// USUARIOS (CLIENTS)
// ============================================================================

export interface CreateUsuarioParams {
	nombre: string;
	nit?: string;
	categoria?: string;
	como_se_entero?: string;
	userId: string; // CRM user ID
}

export async function createUsuarioInCarteraBack(
	params: CreateUsuarioParams,
): Promise<{ success: boolean; usuario_id?: number; error?: string }> {
	if (!isCarteraBackEnabled()) {
		return { success: false, error: "Cartera-back integration is disabled" };
	}

	const startTime = Date.now();

	try {
		const usuario = await carteraBackClient.createUsuario({
			nombre: params.nombre,
			nit: params.nit,
			categoria: params.categoria,
			como_se_entero: params.como_se_entero,
		});

		await logSyncOperation({
			operation: "create_usuario",
			entityType: "usuario",
			entityId: usuario.usuario_id.toString(),
			status: "success",
			requestPayload: JSON.stringify(params),
			responsePayload: JSON.stringify(usuario),
			startedAt: new Date(startTime),
			completedAt: new Date(),
			durationMs: Date.now() - startTime,
			userId: params.userId,
			source: "crm",
		});

		return { success: true, usuario_id: usuario.usuario_id };
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);

		await logSyncOperation({
			operation: "create_usuario",
			entityType: "usuario",
			entityId: "unknown",
			status: "error",
			errorMessage,
			requestPayload: JSON.stringify(params),
			startedAt: new Date(startTime),
			completedAt: new Date(),
			durationMs: Date.now() - startTime,
			userId: params.userId,
			source: "crm",
		});

		return { success: false, error: errorMessage };
	}
}

// ============================================================================
// CRÉDITOS (LOANS)
// ============================================================================

export interface CreateCreditoParams {
	// CRM data
	opportunityId: string;
	contratoFinanciamientoId?: string;
	userId: string;

	// Cartera-back data
	usuario_id: string;
	numero_credito_sifco: string;
	capital: number;
	porcentaje_interes: number;
	plazo: number;
	cuota: number;
	asesor_id?: number;
	tipoCredito?: string;
	iva_12?: number;
	seguro_10_cuotas?: number;
	gps?: number;
	fecha_creacion?: string;
	observaciones?: string;
	no_poliza?: string;
	// Nuevos campos adicionales
	categoria?: string;
	nit?: string;
	royalti?: number;
	porcentaje_royalti?: number;
	membresias_pago?: number;
	reserva?: number;
	inversionistas?: any[];
	// campos para la facturacion
	direccion?: string;
	rubros?: any[];
	otros?: number;
	municipio?: string | null;
	departamento?: string | null;
	codigo_postal?: string | null;
	pais?: string | null;
}

export interface CreateCreditoResult {
	success: boolean;
	credito_id?: number;
	numero_credito_sifco?: string;
	credito?: CarteraCredito;
	error?: string;
}

export async function createCreditoInCarteraBack(
	params: CreateCreditoParams,
): Promise<CreateCreditoResult> {
	if (!isCarteraBackEnabled()) {
		console.log(
			"[CarteraBackSync] Integration disabled, skipping credit creation",
		);
		return { success: false, error: "Cartera-back integration is disabled" };
	}

	const startTime = Date.now();

	try {
		// Create credit in cartera-back
		const creditoInput: CreateCreditoInput = {
			usuario: String(params.usuario_id),
			numero_credito_sifco: params.numero_credito_sifco,
			capital: params.capital,
			porcentaje_interes: params.porcentaje_interes,
			plazo: params.plazo,
			cuota: params.cuota,
			// asesor: params.asesor_id,
			seguro_10_cuotas: params.seguro_10_cuotas,
			gps: params.gps ?? 0,
			observaciones: params.observaciones,
			no_poliza: params.no_poliza || "",
			direccion: params.direccion || "",
			// Nuevos campos adicionales
			categoria: params.categoria,
			nit: params.nit,
			royalti: params.royalti ?? 0,
			porcentaje_royalti: params.porcentaje_royalti ?? 0,
			inversionistas: params.inversionistas,
			rubros: params.rubros,
			membresias_pago: params.membresias_pago ?? 0,
			como_se_entero: "",
			otros: params.otros ?? 0,
			reserva: params.reserva ?? 0,
			municipio: params.municipio || "",
			departamento: params.departamento || "",
			codigo_postal: params.codigo_postal || "",
			pais: params.pais || "",
		};

		console.log(
			"[CarteraBackSync] Creating credit with data:",
			JSON.stringify(creditoInput, null, 2),
		);

		const credito = await carteraBackClient.createCredito(creditoInput);

		console.log(
			"[CarteraBackSync] Credit created successfully:",
			JSON.stringify(credito, null, 2),
		);

		// Log success
		await logSyncOperation({
			operation: "create_credit",
			entityType: "credito",
			entityId: credito.numero_credito_sifco,
			status: "success",
			requestPayload: JSON.stringify(creditoInput),
			responsePayload: JSON.stringify(credito),
			startedAt: new Date(startTime),
			completedAt: new Date(),
			durationMs: Date.now() - startTime,
			userId: params.userId,
			source: "crm",
		});

		console.log(
			`[CarteraBackSync] Credit created successfully: ${credito.numero_credito_sifco} (ID: ${credito.credito_id})`,
		);

		return {
			success: true,
			credito_id: credito.credito_id,
			numero_credito_sifco: credito.numero_credito_sifco,
			credito,
		};
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);

		// Log error
		await logSyncOperation({
			operation: "create_credit",
			entityType: "credito",
			entityId: params.numero_credito_sifco,
			status: "error",
			errorMessage,
			requestPayload: JSON.stringify(params),
			startedAt: new Date(startTime),
			completedAt: new Date(),
			durationMs: Date.now() - startTime,
			userId: params.userId,
			source: "crm",
		});

		console.error("[CarteraBackSync] Failed to create credit:", errorMessage);

		return { success: false, error: errorMessage };
	}
}

// ============================================================================
// PAGOS (PAYMENTS)
// ============================================================================

export interface CreatePagoParams {
	// CRM data
	casoCobroId?: string;
	userId: string;

	// Cartera-back data
	credito_numero_sifco: string;
	cuota_id?: number;
	fecha_pago: string;
	monto_boleta: number;
	numeroAutorizacion?: string;
	observaciones?: string;
}

export interface CreatePagoResult {
	success: boolean;
	pago_id?: number;
	pago?: CarteraPagoCredito;
	error?: string;
}

export async function createPagoInCarteraBack(
	params: CreatePagoParams,
): Promise<CreatePagoResult> {
	if (!isCarteraBackPaymentsEnabled()) {
		console.log(
			"[CarteraBackSync] Payments integration disabled, skipping payment creation",
		);
		return {
			success: false,
			error: "Cartera-back payments integration is disabled",
		};
	}

	const startTime = Date.now();

	try {
		// Create payment in cartera-back
		const pagoInput: CreatePagoInput = {
			credito_numero_sifco: params.credito_numero_sifco,
			cuota_id: params.cuota_id,
			fecha_pago: params.fecha_pago,
			monto_boleta: params.monto_boleta,
			numeroAutorizacion: params.numeroAutorizacion,
			observaciones: params.observaciones,
		};

		const pago = await carteraBackClient.createPago(pagoInput);

		// Store reference in CRM
		const referenceData: NewPagoReference = {
			carteraPagoId: pago.pago_id,
			numeroCreditoSifco: params.credito_numero_sifco,
			cuotaNumero: pago.cuota_id || 0,
			montoBoleta: params.monto_boleta.toString(),
			fechaPago: new Date(params.fecha_pago),
			casoCobroId: params.casoCobroId || null,
			registradoPor: params.userId,
			syncStatus: "synced",
		};

		await db.insert(pagoReferences).values(referenceData);

		// Log success
		await logSyncOperation({
			operation: "create_payment",
			entityType: "pago",
			entityId: pago.pago_id.toString(),
			status: "success",
			requestPayload: JSON.stringify(pagoInput),
			responsePayload: JSON.stringify(pago),
			startedAt: new Date(startTime),
			completedAt: new Date(),
			durationMs: Date.now() - startTime,
			userId: params.userId,
			source: "crm",
		});

		console.log(
			`[CarteraBackSync] Payment created successfully: ${pago.pago_id} for credit ${params.credito_numero_sifco}`,
		);

		return {
			success: true,
			pago_id: pago.pago_id,
			pago,
		};
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);

		// Log error
		await logSyncOperation({
			operation: "create_payment",
			entityType: "pago",
			entityId: params.credito_numero_sifco,
			status: "error",
			errorMessage,
			requestPayload: JSON.stringify(params),
			startedAt: new Date(startTime),
			completedAt: new Date(),
			durationMs: Date.now() - startTime,
			userId: params.userId,
			source: "crm",
		});

		console.error("[CarteraBackSync] Failed to create payment:", errorMessage);

		return { success: false, error: errorMessage };
	}
}

// ============================================================================
// QUERY HELPERS
// ============================================================================

export async function getCreditoReferenceByOpportunityId(
	opportunityId: string,
): Promise<typeof carteraBackReferences.$inferSelect | null> {
	const result = await db
		.select()
		.from(carteraBackReferences)
		.where(eq(carteraBackReferences.opportunityId, opportunityId))
		.limit(1);

	return result[0] || null;
}

export async function getCreditoReferenceByNumeroSifco(
	numeroSifco: string,
): Promise<typeof carteraBackReferences.$inferSelect | null> {
	const result = await db
		.select()
		.from(carteraBackReferences)
		.where(eq(carteraBackReferences.numeroCreditoSifco, numeroSifco))
		.limit(1);

	return result[0] || null;
}

export async function getPagoReference(
	pagoId: number,
): Promise<typeof pagoReferences.$inferSelect | null> {
	const result = await db
		.select()
		.from(pagoReferences)
		.where(eq(pagoReferences.carteraPagoId, pagoId))
		.limit(1);

	return result[0] || null;
}
