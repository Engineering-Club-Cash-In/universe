/**
 * Cartera-Back Integration Helpers
 * High-level functions for integrating CRM operations with cartera-back
 */

import { eq } from "drizzle-orm";
import { db } from "../db";
import {
	carteraBackReferences,
	carteraBackSyncLog,
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
	aseguradora?: string;
	// Nuevos campos adicionales
	categoria?: string;
	nit?: string;
	royalti?: number;
	porcentaje_royalti?: number;
	membresias_pago?: number;
	reserva?: number;
	inversionistas?: any[];
	is_vehiculo_propio?: boolean;
	// campos para la facturacion
	direccion?: string;
	rubros?: any[];
	otros?: number;
	municipio?: string | null;
	departamento?: string | null;
	codigo_postal?: string | null;
	pais?: string | null;
	dia_pago_mensual?: number;
	// Campos para el correo de notificación
	vehiculo_marca?: string;
	vehiculo_linea?: string;
	vehiculo_modelo?: string;
	vehiculo_placa?: string;
	vehiculo_vin?: string;
	monto_asegurado?: number;
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
			aseguradora: params.aseguradora,
			direccion: params.direccion || "",
			// Nuevos campos adicionales
			categoria: params.categoria,
			nit: params.nit,
			dia_pago_mensual: params.dia_pago_mensual,
			royalti: params.royalti ?? 0,
			porcentaje_royalti: params.porcentaje_royalti ?? 0,
			inversionistas: params.inversionistas,
			rubros: params.rubros,
			membresias_pago: params.membresias_pago ?? 0,
			como_se_entero: "",
			otros: params.otros ?? 0,
			reserva: params.reserva ?? 0,
			is_vehiculo_propio: params.is_vehiculo_propio ?? false,
			municipio: params.municipio || "",
			departamento: params.departamento || "",
			codigo_postal: params.codigo_postal || "",
			pais: params.pais || "",
			// Campos para el correo de notificación
			vehiculo_marca: params.vehiculo_marca,
			vehiculo_linea: params.vehiculo_linea,
			vehiculo_modelo: params.vehiculo_modelo,
			vehiculo_placa: params.vehiculo_placa,
			vehiculo_vin: params.vehiculo_vin,
			monto_asegurado: params.monto_asegurado,
			opportunity_id: params.opportunityId,
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
	error?: string;
}

// CB-128: fallback cuando /newPayment no trae pago_id inline. Filtro primario:
// registerBy === mi userId — cierra el race condition de dos asesores pagando
// el mismo crédito casi al mismo tiempo (antes se tomaba "el pago_id más alto
// de los nuevos" a ciegas, que podía ser el pago del OTRO asesor si ambos
// insertaron en la misma ventana; /paymentByCredit ahora expone registerBy).
// pago_id > snapshot (pagoIdMaximoPrevio) se mantiene como filtro extra por si
// el mismo usuario ya tenía pagos previos con el mismo registerBy. Reintenta
// una vez con espera corta para cubrir lag de replicación.
// Devuelve el pago completo (no solo el id) — quien llama necesita también
// numero_cuota real, porque cartera-back puede cascadear el pago a una cuota
// distinta a la pedida y el camino normal de /newPayment no lo reporta.
async function resolverPagoRecienCreado(
	numeroCreditoSifco: string,
	pagoIdMaximoPrevio: number,
	registerBy: string,
): Promise<CarteraPagoCredito | null> {
	const buscar = async () => {
		const pagos = await carteraBackClient.getPagosByCredito(numeroCreditoSifco);
		const nuevos = pagos.filter(
			(p) => p.pago_id > pagoIdMaximoPrevio && p.registerBy === registerBy,
		);
		return nuevos.sort((a, b) => b.pago_id - a.pago_id)[0] ?? null;
	};
	const primerIntento = await buscar();
	if (primerIntento) return primerIntento;
	await new Promise((resolve) => setTimeout(resolve, 1500));
	return buscar();
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
		// CB-128: pagoSchema en cartera-back exige credito_id/usuario_id
		// numéricos (no el SIFCO) y cuotaApagar/registerBy/fecha_boleta/
		// url_boletas — ninguno lo tenía este caller (nació para el bot de
		// WhatsApp, que solo conoce el SIFCO). Se resuelven acá para no
		// tocar la firma pública de CreatePagoParams que ya consume el bot.
		const credito = await carteraBackClient.getCredito(
			params.credito_numero_sifco,
		);

		const pagoInput: CreatePagoInput = {
			credito_numero_sifco: params.credito_numero_sifco,
			credito_id: credito.credito.credito_id,
			usuario_id: credito.usuario.usuario_id,
			cuota_id: params.cuota_id,
			cuotaApagar: params.cuota_id ?? 0,
			fecha_pago: params.fecha_pago,
			fecha_boleta: params.fecha_pago,
			monto_boleta: params.monto_boleta,
			url_boletas: [],
			numeroAutorizacion: params.numeroAutorizacion,
			observaciones: params.observaciones,
			registerBy: params.userId,
		};

		// Snapshot ANTES de crear el pago — único ancla confiable para
		// reconocer "el pago recién creado" si /newPayment no trae pago_id
		// inline (ver comentario en resolverPagoIdRecienCreado).
		const pagosPrevios = await carteraBackClient.getPagosByCredito(
			params.credito_numero_sifco,
		);
		const pagoIdMaximoPrevio = pagosPrevios.reduce(
			(max, p) => Math.max(max, p.pago_id),
			0,
		);

		const respuesta = await carteraBackClient.createPago(pagoInput);
		// soloInformativo (mora parcial insuficiente, etc.) no es un rechazo —
		// cartera-back sí insertó el pago, ver comentario en createPago.
		if (!respuesta.success && !respuesta.soloInformativo) {
			throw new Error(respuesta.message || "cartera-back rechazó el pago");
		}

		// CB-128: /newPayment no siempre trae pago_id inline (ver comentario en
		// cartera-back-client.ts:createPago) — se resuelve consultando el pago
		// recién creado por SIFCO cuando no vino en la respuesta directa. También
		// resuelve la cuota REAL que cerró (puede diferir de cuota_id pedida si
		// cartera-back cascadea el pago).
		let pagoId = respuesta.pago_id;
		let cuotaNumeroReal = params.cuota_id || 0;
		if (!pagoId) {
			const pagoEncontrado = await resolverPagoRecienCreado(
				params.credito_numero_sifco,
				pagoIdMaximoPrevio,
				params.userId,
			);
			pagoId = pagoEncontrado?.pago_id;
			if (pagoEncontrado?.numero_cuota != null) {
				cuotaNumeroReal = pagoEncontrado.numero_cuota;
			}
		}
		if (!pagoId) {
			throw new Error(
				"cartera-back confirmó el pago pero no se pudo resolver su pago_id",
			);
		}

		// Store reference in CRM
		const referenceData: NewPagoReference = {
			carteraPagoId: pagoId,
			numeroCreditoSifco: params.credito_numero_sifco,
			cuotaNumero: cuotaNumeroReal,
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
			entityId: pagoId.toString(),
			status: "success",
			requestPayload: JSON.stringify(pagoInput),
			responsePayload: JSON.stringify(respuesta),
			startedAt: new Date(startTime),
			completedAt: new Date(),
			durationMs: Date.now() - startTime,
			userId: params.userId,
			source: "crm",
		});

		console.log(
			`[CarteraBackSync] Payment created successfully: ${pagoId} for credit ${params.credito_numero_sifco}`,
		);

		return {
			success: true,
			pago_id: pagoId,
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
