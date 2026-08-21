/**
 * Cartera-Back Integration Helpers
 * High-level functions for integrating CRM operations with cartera-back
 */

import { eq, sql } from "drizzle-orm";
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
import { CarteraBackHttpError, carteraBackClient } from "./cartera-back-client";

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
	/** true cuando el resultado real es desconocido (timeout, 5xx, fallo de transporte) — el pago pudo haberse aplicado igual. El caller NO debe invitar a reintentar. */
	resultadoIncierto?: boolean;
}

// CB-128: fallback cuando /newPayment no trae pago_id inline. Filtro
// obligatorio: registerBy === mi userId — cierra el race condition de dos
// asesores pagando el mismo crédito casi al mismo tiempo (antes se tomaba "el
// pago_id más alto de los nuevos" a ciegas, que podía ser el pago del OTRO
// asesor si ambos insertaron en la misma ventana; /paymentByCredit ahora
// expone registerBy).
//
// CB-128 (fix): "es reciente" ya no es solo pago_id > snapshot — también
// acepta fecha_pago >= antesDeCrearPago (con margen por reloj no
// sincronizado). Cartera-back a veces CIERRA una cuota pisando (UPDATE) el
// placeholder no_required que cada cuota ya trae desde que se generó el
// calendario de pagos, en vez de insertar una fila nueva ("comportamiento
// histórico para el caso normal", ver registerPayment.ts:1576-1604 y
// destinoSobrescribible) — es el camino MÁS COMÚN para un pago normal al día
// (cuota sin abonos parciales previos), no un caso raro. Ahí el pago_id NUNCA
// supera el snapshot (la fila ya existía antes del pago), así que el filtro
// original nunca la encontraba sin importar cuántos retries se hicieran.
// fecha_pago se guarda con el timestamp real de aplicación (hora de
// Guatemala con segundos), sirve como ancla alternativa. Reintenta una vez
// con espera corta para cubrir lag de replicación.
//
// Devuelve el pago completo (no solo el id) — quien llama necesita también
// numero_cuota real, porque cartera-back puede cascadear el pago a otra
// cuota y el camino normal de /newPayment no lo reporta.
async function resolverPagoRecienCreado(
	numeroCreditoSifco: string,
	pagoIdMaximoPrevio: number,
	registerBy: string,
	antesDeCrearPago: Date,
): Promise<CarteraPagoCredito | null> {
	const margenMs = 5 * 1000;
	// CB-128 (fix): pagos_credito.fecha_pago es un `timestamp` de Postgres SIN
	// zona horaria — cartera-back escribe el reloj de Guatemala tal cual, y
	// el driver lo devuelve interpretándolo como UTC. Sin corregir esto, un
	// pago aplicado a las 04:00 hora Guatemala se leía como 04:00 UTC (en
	// realidad 10:00 GT) — 6 horas "en el pasado" respecto a antesDeCrearPago
	// real, muy fuera del margen de 5s. Se suma el offset de Guatemala
	// (UTC-6, sin horario de verano) para recuperar el instante UTC real.
	const OFFSET_GUATEMALA_MS = 6 * 60 * 60 * 1000;
	const buscar = async () => {
		// Sin cache: con CARTERA_BACK_ENABLE_CACHE activado y lag de
		// replicación, una respuesta cacheada sin el pago recién creado hacía
		// que el retry de 1.5s pegara contra la MISMA respuesta stale en vez
		// de volver a consultar cartera-back.
		const pagos = await carteraBackClient.getPagosByCredito(
			numeroCreditoSifco,
			false,
		);
		const nuevos = pagos.filter((p) => {
			if (p.registerBy !== registerBy) return false;
			if (p.pago_id > pagoIdMaximoPrevio) return true;
			const fechaPagoMs =
				new Date(p.fecha_pago).getTime() + OFFSET_GUATEMALA_MS;
			return (
				Number.isFinite(fechaPagoMs) &&
				fechaPagoMs >= antesDeCrearPago.getTime() - margenMs
			);
		});
		return nuevos.sort((a, b) => b.pago_id - a.pago_id)[0] ?? null;
	};
	// CB-128 (fix): createPago YA tuvo éxito cuando se llega a esta función
	// (el dinero se movió) — si buscar() en sí LANZA (timeout o 5xx de
	// getPagosByCredito agotando sus reintentos internos), eso es distinto
	// de "no encontrado todavía". Sin este try/catch, un throw del primer
	// intento se propagaba sin darle chance al retry de 1.5s, y un throw del
	// segundo intento se propagaba fuera de esta función saltándose el
	// mensaje explícito "NO reintentes" que arma el caller cuando
	// resolverPagoRecienCreado devuelve null — el asesor veía un error
	// genérico y podía reintentar un pago que ya se había aplicado.
	let primerIntento: CarteraPagoCredito | null;
	try {
		primerIntento = await buscar();
	} catch {
		primerIntento = null;
	}
	if (primerIntento) return primerIntento;
	await new Promise((resolve) => setTimeout(resolve, 1500));
	try {
		return await buscar();
	} catch (error) {
		console.error(
			"[resolverPagoRecienCreado] Resultado incierto: createPago tuvo éxito pero buscar() falló dos veces (timeout/5xx):",
			error,
		);
		return null;
	}
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
	// CB-128 (fix): declarado antes del try para que el catch general (más
	// abajo) pueda leerlo — se marca true solo si createPago falló con algo
	// que no sea un 4xx definitivo (ver el try/catch interno alrededor de la
	// llamada real, dentro de la transacción).
	let resultadoIncierto = false;

	try {
		// CB-128: pagoSchema en cartera-back exige credito_id/usuario_id
		// numéricos (no el SIFCO) y cuotaApagar/registerBy/fecha_boleta/
		// url_boletas — ninguno lo tenía este caller (nació para el bot de
		// WhatsApp, que solo conoce el SIFCO). Se resuelven acá para no
		// tocar la firma pública de CreatePagoParams que ya consume el bot.
		const credito = await carteraBackClient.getCredito(
			params.credito_numero_sifco,
		);

		// CB-128 (fix): cuota_id es el PK autoincremental GLOBAL de
		// cuotas_credito (serial, compartido por todos los créditos del
		// sistema), pero cartera-back interpreta cuotaApagar como
		// numero_cuota (secuencial 1,2,3... por crédito — ver
		// registerPayment.ts:363, `WHERE numero_cuota >= cuotaApagar`).
		// Mandar cuota_id directo como cuotaApagar (ej. 48213) hace que ese
		// filtro no encuentre ninguna cuota pendiente en un crédito que
		// nunca llega a esa magnitud de numero_cuota — el pago se pierde o
		// se aplica a la cuota equivocada. Se resuelve el numero_cuota real
		// buscando el cuota_id recibido entre las cuotas del crédito ya
		// cargado arriba.
		const todasLasCuotas = [
			...credito.cuotasPagadas,
			...credito.cuotasPendientes,
			...credito.cuotasAtrasadas,
		];
		let cuotaResuelta = params.cuota_id
			? todasLasCuotas.find((c) => c.cuota_id === params.cuota_id)
			: undefined;
		if (params.cuota_id && !cuotaResuelta) {
			throw new Error(
				`cuota_id ${params.cuota_id} no corresponde a ninguna cuota del crédito ${params.credito_numero_sifco}`,
			);
		}
		// CB-128 (fix): cuota_id es opcional en el input público de este caller
		// (registrarPago, el endpoint del bot) — omitirlo dejaba cuotaApagar en
		// 0 más abajo, que se guarda tal cual como numero_cuota en varias
		// escrituras de cartera-back (registerPayment.ts), corrompiendo el
		// registro con una cuota inexistente. Cuando no se especifica, se
		// resuelve la misma "cuota pagable" que usa la Ficha 360 (mismo
		// criterio que cardInfo.tsx de carteraFront): la más antigua de
		// atrasadas+pendientes que no esté ya validada — nunca se salta deuda
		// anterior.
		if (!params.cuota_id) {
			const pagables = [...credito.cuotasAtrasadas, ...credito.cuotasPendientes]
				.sort((a, b) => a.numero_cuota - b.numero_cuota)
				.filter((c) => {
					const status: string | null | undefined = c.validationStatus;
					return status !== "validated" && status !== "capital_validated";
				});
			cuotaResuelta = pagables[0];
			if (!cuotaResuelta) {
				throw new Error(
					`No se encontró una cuota pendiente para pagar en el crédito ${params.credito_numero_sifco}`,
				);
			}
		}

		const pagoInput: CreatePagoInput = {
			credito_numero_sifco: params.credito_numero_sifco,
			credito_id: credito.credito.credito_id,
			usuario_id: credito.usuario.usuario_id,
			cuota_id: params.cuota_id,
			cuotaApagar: cuotaResuelta?.numero_cuota ?? 0,
			fecha_pago: params.fecha_pago,
			fecha_boleta: params.fecha_pago,
			monto_boleta: params.monto_boleta,
			url_boletas: [],
			numeroAutorizacion: params.numeroAutorizacion,
			observaciones: params.observaciones,
			registerBy: params.userId,
		};

		// CB-128 (fix): mismo advisory lock por SIFCO que registrarPagoCompleto
		// (routers/cobros.ts) — este caller (usado por el endpoint registrarPago
		// del bot de WhatsApp) nunca tuvo ninguna serialización. Dos pagos
		// concurrentes del mismo asesor para el mismo crédito calculaban el
		// mismo snapshot pagoIdMaximoPrevio y podían resolver el pago_id de
		// uno al otro. El snapshot se toma DESPUÉS de adquirir el lock, dentro
		// de la misma transacción — mismo razonamiento que en cobros.ts.
		let pagoId: number | undefined;
		let cuotaNumeroReal = cuotaResuelta?.numero_cuota ?? 0;
		let respuesta:
			| Awaited<ReturnType<typeof carteraBackClient.createPago>>
			| undefined;

		await db.transaction(async (tx) => {
			await tx.execute(
				sql`SELECT pg_advisory_xact_lock(hashtext(${`pago:${params.credito_numero_sifco}`}))`,
			);

			const pagosPrevios = await carteraBackClient.getPagosByCredito(
				params.credito_numero_sifco,
				false,
			);
			const pagoIdMaximoPrevio = pagosPrevios.reduce(
				(max, p) => Math.max(max, p.pago_id),
				0,
			);

			// CB-128 (fix): ver comentario largo en resolverPagoRecienCreado —
			// necesario porque cartera-back a veces UPDATE-ea el placeholder
			// no_required de la cuota en vez de insertar una fila nueva, y ahí
			// el pago_id nunca supera pagoIdMaximoPrevio.
			const antesDeCrearPago = new Date();

			try {
				respuesta = await carteraBackClient.createPago(pagoInput);
			} catch (error) {
				// CB-128 (fix): mismo caso que registrarPagoCompleto — el 409 de
				// "abono directo a capital no aplicado" (registerPayment.ts:
				// 2193-2200) puede llegar DESPUÉS de que procesarPagoMora y/o
				// processConvenioPayment ya escribieron (pagaron mora, acreditaron
				// convenio), sin transacción del lado de cartera-back. No es un
				// 4xx limpio para efectos de "seguro reintentar".
				const esRechazoAbonoCapitalConEfectosSecundarios =
					error instanceof CarteraBackHttpError &&
					error.status === 409 &&
					error.message.includes("abono directo a capital");

				if (
					!(
						error instanceof CarteraBackHttpError &&
						error.status >= 400 &&
						error.status < 500 &&
						!esRechazoAbonoCapitalConEfectosSecundarios
					)
				) {
					resultadoIncierto = true;
				}
				throw error;
			}
			// soloInformativo (mora parcial insuficiente, etc.) no es un rechazo —
			// cartera-back sí insertó el pago, ver comentario en createPago.
			if (!respuesta.success && !respuesta.soloInformativo) {
				throw new Error(respuesta.message || "cartera-back rechazó el pago");
			}

			// CB-128: /newPayment no siempre trae pago_id inline (ver comentario
			// en cartera-back-client.ts:createPago) — se resuelve consultando el
			// pago recién creado por SIFCO cuando no vino en la respuesta
			// directa. También resuelve la cuota REAL que cerró (puede diferir
			// de cuota_id pedida si cartera-back cascadea el pago).
			pagoId = respuesta.pago_id;
			if (!pagoId) {
				const pagoEncontrado = await resolverPagoRecienCreado(
					params.credito_numero_sifco,
					pagoIdMaximoPrevio,
					params.userId,
					antesDeCrearPago,
				);
				pagoId = pagoEncontrado?.pago_id;
				if (pagoEncontrado?.numero_cuota != null) {
					cuotaNumeroReal = pagoEncontrado.numero_cuota;
				}
			} else {
				// CB-128 (fix): pago_id inline significa que cartera-back tomó
				// la rama de abono directo a capital — ahí NO respeta
				// cuotaApagar, se vincula a ultimaCuotaPagada (u otro fallback
				// interno, ver registerPayment.ts:2016-2019), que puede ser una
				// cuota distinta a la pedida. Asumir cuotaResuelta guardaba la
				// cuota equivocada en pagoReferences y en el comentario de
				// gestión generado. Se busca el pago por su pago_id YA conocido
				// para leer su numero_cuota real, con el mismo retry ante lag
				// de replicación que resolverPagoRecienCreado usa para el caso
				// hermano (sin id conocido) — una sola lectura sin reintentar
				// podía dejar cuotaNumeroReal en cuotaResuelta silenciosamente.
				const buscarPagoVinculado = async () => {
					const pagos = await carteraBackClient.getPagosByCredito(
						params.credito_numero_sifco,
						false,
					);
					return pagos.find((p) => p.pago_id === pagoId);
				};
				// CB-128 (fix): igual que en routers/cobros.ts — pagoId ya está
				// resuelto en esta rama (vino inline, dinero ya movido), así que
				// un buscarPagoVinculado() que lanza (timeout/5xx) no debe
				// bloquear el pago ni marcar resultadoIncierto: solo se pierde la
				// corrección de cuotaNumeroReal, que sigue con su valor por
				// default (cuotaResuelta/params.cuota_id) como fallback
				// aceptable — no un resultado incierto sobre si el dinero se
				// movió.
				let pagoVinculado: Awaited<ReturnType<typeof buscarPagoVinculado>>;
				try {
					pagoVinculado = await buscarPagoVinculado();
				} catch {
					pagoVinculado = undefined;
				}
				if (!pagoVinculado) {
					await new Promise((resolve) => setTimeout(resolve, 1500));
					try {
						pagoVinculado = await buscarPagoVinculado();
					} catch (error) {
						console.error(
							"[createPagoInCarteraBack] No se pudo resolver la cuota real del abono a capital tras 2 intentos (timeout/5xx) — se mantiene la cuota resuelta como fallback:",
							error,
						);
						pagoVinculado = undefined;
					}
				}
				if (pagoVinculado?.numero_cuota != null) {
					cuotaNumeroReal = pagoVinculado.numero_cuota;
				}
			}
			if (!pagoId) {
				// CB-128 (fix): resultadoIncierto no se marcaba en este punto —
				// createPago ya tuvo éxito (pasamos el chequeo de success/
				// soloInformativo arriba sin lanzar), así que el pago SÍ se
				// aplicó en cartera-back; solo falló resolver a qué pago_id
				// corresponde. El path gemelo en routers/cobros.ts sí trataba
				// este caso como resultado incierto (ORPCError
				// INTERNAL_SERVER_ERROR con "NO reintentes"); acá el Error
				// plano caía en el catch general con resultadoIncierto=false
				// (su default), y el caller (registrarPago) lo veía como un
				// BAD_REQUEST normal — invitando al bot/asesor a reintentar un
				// pago que ya se había aplicado.
				resultadoIncierto = true;
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

			await tx.insert(pagoReferences).values(referenceData);
		});

		if (!pagoId) {
			// Guard de tipos — inalcanzable en la práctica (el throw de arriba,
			// dentro de la transacción, ya cubre este caso), pero se marca
			// resultadoIncierto igual por si el control flow cambia.
			resultadoIncierto = true;
			throw new Error(
				"cartera-back confirmó el pago pero no se pudo resolver su pago_id",
			);
		}

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

		return { success: false, error: errorMessage, resultadoIncierto };
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
