/**
 * Cartera-Back API Client
 * Type-safe HTTP client with retry logic, circuit breaker, and caching
 */

import { z } from "zod";
import type {
	BoletaPagoInversionista,
	CarteraAsesor,
	CarteraBackApiResponse,
	CarteraBackAuthError,
	CarteraBackConnectionError,
	CarteraBackError,
	CarteraBackValidationError,
	CarteraCredito,
	CarteraInversionista,
	CarteraPagoCredito,
	CarteraStatsResponse,
	CarteraUsuario,
	ConsultaMoraResponse,
	CreateBoletaInput,
	CreateCreditoInput,
	CreatePagoInput,
	CreateUsuarioInput,
	CreditActionInput,
	CreditoDetailResponse,
	CreditoDirectoResponse,
	FacturarGenericoInput,
	FacturarGenericoResponse,
	GetAdvisorsParams,
	GetAllCreditsParams,
	GetInvestorReportParams,
	GetInvestorsParams,
	GetPaymentsParams,
	InversionistaReporte,
	LiquidatePagosInversionistasInput,
	PaginatedResponse,
	ResumenGlobalInversionista,
	ReversePagoInput,
	UpdateCreditoInput,
} from "../types/cartera-back";
import { ConsultaMoraNoDisponibleError } from "../types/cartera-back";
import {
	getCarteraAccessToken,
	invalidateAndReauth,
} from "./cartera-auth.service";

// ============================================================================
// TIPOS SIMULACIÓN INVERSIONISTA
// ============================================================================

export interface SimulacionInversionistaResult {
	success: boolean;
	data: {
		inversionista_id: number;
		nombre: string;
		tipo_reinversion: string | null;
		moneda: string | null;
		emite_factura: boolean;
		monto_reinversion_mensual: number;
		total_monto_aportado: number;
		total_capital_actual: number;
		capital_restante_global: number;
		desglose_acumulado: {
			total_creditos: number;
			total_reinversion: number;
			total_acumulado: number;
			meses: Array<{
				mes: string;
				total_sin_reinversion: number;
				total_con_reinversion: number;
				total_reinversion: number;
				total_capital_restante: number;
			}>;
		};
	};
}

// ============================================================================
// TIPOS MODALIDAD DE FACTURACIÓN
// ============================================================================

export type ModalidadFacturacion =
	| "p2p_directa"
	| "factura_cube"
	| "factura_cube_pequeno";

export interface ModalidadFacturacionSpreadRow {
	id: number;
	monto_desde: string;
	monto_hasta: string | null; // null = sin límite superior
	modalidad: ModalidadFacturacion;
	spread: string; // % Inversionista de esa modalidad
	tasa: string; // tasa final que ve el cliente
}

// ============================================================================
// CONFIGURATION
// ============================================================================

interface CarteraBackClientConfig {
	baseUrl: string;
	timeout: number;
	retryAttempts: number;
	retryDelay: number;
	circuitBreakerThreshold: number;
	circuitBreakerTimeout: number;
	enableCache: boolean;
	cacheTtl: number;
	accessTokenProvider: () => Promise<string>;
	fetchTransport: typeof globalThis.fetch;
}

export interface ResumenGlobalInversionistasFilters {
	inversionistaId?: string | number;
	estado?: "pending" | "uploaded" | "liquidated" | "all";
	mes?: number;
	anio?: number;
	/**
	 * Incluye a los inversionistas internos/propios (permite_distribucion = true:
	 * Cube, Autocash, Blokfund, …). En cartera-back el flag es opt-in y por defecto
	 * el endpoint solo devuelve externos.
	 */
	incluirInternos?: boolean;
}

const DEFAULT_CONFIG: CarteraBackClientConfig = {
	baseUrl: process.env.CARTERA_BACK_URL || "http://localhost:7000",
	timeout: Number.parseInt(process.env.CARTERA_BACK_TIMEOUT || "30000"),
	retryAttempts: Number.parseInt(
		process.env.CARTERA_BACK_RETRY_ATTEMPTS || "3",
	),
	retryDelay: 1000,
	circuitBreakerThreshold: 5,
	circuitBreakerTimeout: 60000,
	enableCache: process.env.CARTERA_BACK_ENABLE_CACHE === "true",
	cacheTtl: Number.parseInt(process.env.CARTERA_BACK_CACHE_TTL || "300000"), // 5 minutes
	accessTokenProvider: getCarteraAccessToken,
	fetchTransport: globalThis.fetch,
};

/**
 * Generar el reporte de pagos no liquidados recorre todos los créditos del
 * inversionista, arma el Excel y lo sube a R2. Con inversionistas grandes eso
 * supera los 30s del timeout por defecto.
 */
const REPORTE_NO_LIQUIDADOS_TIMEOUT_MS = Number.parseInt(
	process.env.CARTERA_BACK_REPORTE_TIMEOUT || "300000",
);

// ============================================================================
// ERROR TIPADO CON STATUS HTTP
// ============================================================================
// A diferencia de los demás throws de `request()` (que solo se distinguen
// por texto en `.message`), este preserva el status code real para que los
// callers puedan chequear `err.status === 404` en vez de parsear el mensaje.
// `handleError()` lo respeta explícitamente (no lo reescribe) para que el
// status sobreviva hasta el caller final.
export class CarteraBackHttpError extends Error {
	constructor(
		message: string,
		public readonly status: number,
		// Body crudo que devolvió cartera-back. `message` suele traer el texto
		// para el usuario ("Ya existe un inversionista con ese DPI") y `error`
		// el código de máquina ("duplicate_dpi"); el `.message` de esta clase
		// antepone el código, así que los callers que quieran mostrarle algo
		// legible al usuario deben leer `payload.message`.
		public readonly payload: {
			error?: string;
			message?: string;
			errores?: string[];
		} = {},
	) {
		super(message);
		this.name = "CarteraBackHttpError";
	}
}

/**
 * Corte de la consulta de mora.
 *
 * El gate corre delante de seis puntos donde alguien está esperando en una
 * pantalla, así que el corte lo manda esa espera y no la suma de los timeouts
 * de la cadena: cartera-back ya acota a 20s sus llamadas a SIFCO, y si el core
 * tarda más que esto, para el asesor es una caída — que es exactamente lo que
 * el fail-closed responde.
 */
const CONSULTA_MORA_TIMEOUT_DEFAULT_MS = 12000;

/**
 * Techo del valor configurable: 10 minutos.
 *
 * 🔴 No es una preferencia de producto sino una cota técnica.
 * `AbortSignal.timeout` acepta como máximo un entero sin signo de 64 bits
 * (`2^64 - 1` ms); pasado eso lanza `TypeError`. Un `1e30` en la variable de
 * entorno atraviesa "finito y positivo" y hace estallar TODAS las llamadas del
 * gate en runtime, antes de cualquier fail-closed. Y un presupuesto de minutos
 * ya no es un timeout para alguien esperando en pantalla: cualquier cosa por
 * encima de este techo es una errata, no una intención.
 */
const CONSULTA_MORA_TIMEOUT_MAX_MS = 600000;

/**
 * 🔴 Se valida que sea finito y positivo, no solo `parseInt`. Un valor no
 * numérico en la variable de entorno daba `NaN`, y `AbortSignal.timeout(NaN)`
 * lanza: una errata en la configuración tumbaba los ocho puntos del gate a la
 * vez, y lo hacía en el arranque de cada llamada, sin pasar por el fail-closed.
 *
 * Por la misma razón se valida el techo (ver `CONSULTA_MORA_TIMEOUT_MAX_MS`):
 * un número absurdamente grande pasaba la validación de arriba y llegaba igual
 * de lejos.
 */
export function leerTimeoutConsultaMora(crudo: string | undefined): number {
	if (crudo === undefined || crudo.trim() === "") {
		return CONSULTA_MORA_TIMEOUT_DEFAULT_MS;
	}

	const valor = Number(crudo);
	if (!Number.isFinite(valor) || valor <= 0) {
		console.warn(
			`[cartera-back] CARTERA_BACK_CONSULTA_MORA_TIMEOUT inválido (${crudo}); se usa ${CONSULTA_MORA_TIMEOUT_DEFAULT_MS}ms`,
		);
		return CONSULTA_MORA_TIMEOUT_DEFAULT_MS;
	}

	if (valor > CONSULTA_MORA_TIMEOUT_MAX_MS) {
		console.warn(
			`[cartera-back] CARTERA_BACK_CONSULTA_MORA_TIMEOUT fuera de rango (${crudo}; máximo ${CONSULTA_MORA_TIMEOUT_MAX_MS}ms); se usa ${CONSULTA_MORA_TIMEOUT_DEFAULT_MS}ms`,
		);
		return CONSULTA_MORA_TIMEOUT_DEFAULT_MS;
	}

	return valor;
}

/**
 * Corre `tarea` con un presupuesto que cubre TODO lo que hay entre la llamada y
 * la respuesta, autenticación incluida.
 *
 * 🔴 El `AbortSignal.timeout` de `request()` NO alcanza: se arma DESPUÉS de
 * esperar el token, y `getCarteraAccessToken()` no recibe señal alguna. Con el
 * auth de cartera colgado, la promesa de la consulta quedaba pendiente para
 * siempre —el reloj del fetch nunca llegaba a arrancar— y el asesor se quedaba
 * con la pantalla girando sin fail-closed que lo rescatara. Este presupuesto
 * envuelve la llamada completa, así que el techo se respeta pase lo que pase.
 *
 * El `clearTimeout` en el `finally` es lo que evita dejar el temporizador vivo
 * cuando la tarea gana la carrera. La tarea perdedora sigue su curso en
 * segundo plano (no hay cómo cancelar el auth); lo que no sigue es la espera.
 */
export async function conPresupuestoConsultaMora<T>(
	presupuestoMs: number,
	tarea: (
		senalVencimiento: AbortSignal,
		restanteMs: () => number,
	) => Promise<T>,
): Promise<T> {
	const arranque = Date.now();
	// Cuánto le queda al presupuesto AHORA. Se expone porque los pasos de
	// adentro (el fetch) arrancan su propio reloj más tarde y necesitan caber en
	// lo que sobra, no volver a pedir el presupuesto entero. Ver
	// `cotaFetchConsultaMora`.
	const restanteMs = () => presupuestoMs - (Date.now() - arranque);
	let temporizador: ReturnType<typeof setTimeout> | undefined;
	// La señal viaja hasta el fetch de `request()`: al vencerse el presupuesto
	// no solo se suelta la espera — la tarea perdedora que siga corriendo (el
	// auth no es cancelable) encuentra la señal ya abortada y NO dispara el
	// viaje a cartera cuando el token por fin llegue. Sin esto, cada intento
	// vencido durante una caída del auth quedaba en cola y descargaba una
	// ráfaga de consultas inútiles sobre el core al recuperarse.
	const control = new AbortController();

	const vencimiento = new Promise<never>((_, rechazar) => {
		temporizador = setTimeout(() => {
			control.abort();
			rechazar(
				new ConsultaMoraNoDisponibleError(
					`La consulta de mora no respondió en ${presupuestoMs}ms`,
					// No hay fallo original que guardar: nadie falló, se acabó el
					// tiempo. El mensaje ya dice todo lo que el log necesita.
					null,
				),
			);
		}, presupuestoMs);
	});

	try {
		return await Promise.race([tarea(control.signal, restanteMs), vencimiento]);
	} finally {
		clearTimeout(temporizador);
	}
}

/**
 * Lo que el fetch le cede al presupuesto externo para llegar primero. Medio
 * segundo alcanza de sobra para que el `AbortSignal.timeout` del fetch dispare,
 * se propague el `TimeoutError` y el breaker lo cuente, antes de que el
 * `setTimeout` del presupuesto gane la carrera.
 */
export const MARGEN_FETCH_CONSULTA_MORA_MS = 500;

/**
 * Piso del deadline del fetch: por debajo de un segundo ya no es un intento, es
 * un aborto con viaje de ida. Si al presupuesto le queda menos que esto, el
 * corte lo va a dar el presupuesto externo — y está bien: ese tiempo se lo
 * comió la autenticación, no un transporte colgado, que es justo lo que el
 * breaker NO tiene que contar.
 */
export const PISO_FETCH_CONSULTA_MORA_MS = 1000;

/**
 * Deadline propio del fetch, calculado con lo que QUEDA del presupuesto.
 *
 * 🔴 Antes el fetch usaba el MISMO número que el presupuesto global, y el
 * presupuesto arranca antes —cubre la autenticación, que corre delante—. O sea
 * que el externo ganaba la carrera SIEMPRE: un transporte colgado nunca
 * levantaba el `TimeoutError` propio del fetch, salía por la puerta de la
 * cancelación del llamador (`esCancelacionDelLlamador`) y el breaker no lo
 * contaba. Con cartera colgada de verdad, el breaker no abría NUNCA y cada
 * consulta volvía a pagar el presupuesto entero.
 *
 * Restando el margen, el reloj del fetch vence primero y el cuelgue se cuenta
 * como lo que es: un fallo de cartera.
 */
export function cotaFetchConsultaMora(restanteMs: number): number {
	const cota = restanteMs - MARGEN_FETCH_CONSULTA_MORA_MS;
	return cota < PISO_FETCH_CONSULTA_MORA_MS
		? PISO_FETCH_CONSULTA_MORA_MS
		: cota;
}

const CONSULTA_MORA_TIMEOUT_MS = leerTimeoutConsultaMora(
	process.env.CARTERA_BACK_CONSULTA_MORA_TIMEOUT,
);

/**
 * Forma exacta de `POST /clientes/consulta-mora`. Se valida en vez de castear
 * porque un cuerpo incompleto se leería como "sin mora" (ver la nota 3 en
 * `consultarMoraPorDpi`).
 */
const consultaMoraResponseSchema = z.object({
	encontrado: z.boolean(),
	tieneMoraActiva: z.boolean(),
	puedeContinuar: z.boolean(),
	motivo: z.enum([
		"SIN_MORA",
		"MORA_ACTIVA",
		"EN_CONVENIO",
		"CREDITO_INSOLUTO",
		"CLIENTE_NO_ENCONTRADO",
		"SERVICIO_NO_DISPONIBLE",
	]),
	cliente: z
		.object({ codigoClienteSifco: z.string(), nombre: z.string() })
		.nullable(),
	creditos: z.array(
		z.object({
			numeroCreditoSifco: z.string(),
			estado: z.string(),
			moraActiva: z
				.object({ monto: z.string(), cuotasAtrasadas: z.number() })
				.nullable(),
		}),
	),
	historialMora: z.array(
		z.object({
			fecha: z.string(),
			monto: z.string(),
			numeroCreditoSifco: z.string(),
			evento: z.string(),
		}),
	),
	consultadoEn: z.string(),
});

// ============================================================================
// CIRCUIT BREAKER
// ============================================================================

/**
 * ¿El error vino de que el LLAMADOR se cansó, y no de que cartera fallara?
 *
 * 🔴 El breaker es COMPARTIDO por todas las integraciones con cartera (pagos,
 * inversionistas, reportes). La señal de presupuesto de la consulta de mora
 * podía abrirlo sola: con el auth colgado, cada intento vencido dejaba su tarea
 * tardía viva dentro de `execute`, y al revivir el auth todas esas tareas
 * encontraban la señal ya abortada y rechazaban de una. Cinco rechazos así
 * —que no son cartera fallando, es el CRM cancelando— abrían el breaker 60s
 * para todo el mundo.
 *
 * Por eso la cancelación se relanza sin contar `onFailure` ni `onSuccess`: de
 * un viaje que nunca salió no se aprende nada sobre la salud de cartera.
 *
 * ⚠️ El timeout PROPIO del fetch SÍ sigue contando como fallo: `AbortSignal.timeout`
 * aborta sin tocar la señal externa, así que cartera no contestó a tiempo con el
 * CRM todavía esperando — eso es un síntoma real de su salud.
 *
 * 🔴 Lo único que se mira es SI LA SEÑAL EXTERNA YA ESTÁ ABORTADA al momento del
 * catch; el nombre del error no se exige. Antes se pedía `AbortError` y eso
 * dejaba afuera al caso más común de todos: `getCarteraAccessToken()` lanza un
 * `Error` PELADO cuando el login de cartera contesta non-OK, así que un auth
 * colgado más allá del presupuesto y caído después rechazaba con un error sin
 * nombre especial y contaba como fallo igual — cinco de esos abrían el breaker
 * compartido justo cuando el auth se estaba recuperando, que es exactamente el
 * agujero que esta función existe para tapar.
 *
 * El criterio ahora es temporal, no de forma: si el presupuesto ya venció, nada
 * de lo que esa tarea haga después puede contar —ni fallo ni éxito—, porque
 * nadie está esperando esa respuesta y lo que le pase ya no describe la salud de
 * cartera. Se acepta el costo: una caída REAL de cartera que llegue después del
 * vencimiento tampoco se cuenta. No se pierde la señal, solo se pierde ESA
 * muestra: la consulta siguiente, con su señal viva, la vuelve a ver.
 */
export function esCancelacionDelLlamador(
	senalExterna: AbortSignal | null | undefined,
): boolean {
	return senalExterna?.aborted === true;
}

/** Exportado para poder verificar en tests cuándo se abre y cuándo no. */
export class CircuitBreaker {
	private failureCount = 0;
	private lastFailureTime: number | null = null;
	private state: "CLOSED" | "OPEN" | "HALF_OPEN" = "CLOSED";

	constructor(
		private threshold: number,
		private timeout: number,
	) {}

	/**
	 * `esCancelacion` marca los errores que NO son un fallo de cartera: los que
	 * pasan por ahí se relanzan sin contar ni éxito ni fallo. Ver
	 * `esCancelacionDelLlamador`.
	 */
	async execute<T>(
		fn: () => Promise<T>,
		esCancelacion?: (error: unknown) => boolean,
	): Promise<T> {
		if (this.state === "OPEN") {
			if (Date.now() - (this.lastFailureTime || 0) > this.timeout) {
				this.state = "HALF_OPEN";
			} else {
				throw new Error("Circuit breaker is OPEN");
			}
		}

		try {
			const result = await fn();
			this.onSuccess();
			return result;
		} catch (error) {
			if (error instanceof CarteraBackHttpError && error.status < 500) {
				throw error;
			}
			if (esCancelacion?.(error)) {
				throw error;
			}
			this.onFailure();
			throw error;
		}
	}

	private onSuccess() {
		this.failureCount = 0;
		this.state = "CLOSED";
	}

	private onFailure() {
		this.failureCount++;
		this.lastFailureTime = Date.now();
		if (this.failureCount >= this.threshold) {
			this.state = "OPEN";
			console.error(
				`[CarteraBack] Circuit breaker opened after ${this.failureCount} failures`,
			);
		}
	}

	getState() {
		return this.state;
	}
}

// ============================================================================
// SIMPLE CACHE
// ============================================================================

interface CacheEntry<T> {
	data: T;
	timestamp: number;
}

class SimpleCache {
	private cache = new Map<string, CacheEntry<unknown>>();

	constructor(private ttl: number) {}

	get<T>(key: string): T | null {
		const entry = this.cache.get(key) as CacheEntry<T> | undefined;
		if (!entry) return null;

		if (Date.now() - entry.timestamp > this.ttl) {
			this.cache.delete(key);
			return null;
		}

		return entry.data;
	}

	set<T>(key: string, data: T): void {
		this.cache.set(key, { data, timestamp: Date.now() });
	}

	invalidate(pattern?: string): void {
		if (!pattern) {
			this.cache.clear();
			return;
		}

		for (const key of this.cache.keys()) {
			if (key.includes(pattern)) {
				this.cache.delete(key);
			}
		}
	}

	clear(): void {
		this.cache.clear();
	}
}

// ============================================================================
// TYPES
// ============================================================================

export type FacturacionMesRubro = {
	interes: string;
	membresias: string;
	seguro_gps: string;
	royalti: string;
	mora: string;
	otros: string;
};

export type FacturacionMesResponse = {
	cobrado: FacturacionMesRubro;
	esperado: { meta_mensual: string };
};

export type MontoACobrarRow = {
	bucket: string;
	cuotas_count: number;
	total_cuota: string;
	total_interes: string;
	total_iva: string;
	total_seguro: string;
	total_gps: string;
	total_membresias: string;
	total_royalti: string;
	mora_promedio: string;
};

export type CuotaPorFechaRow = {
	cuota_id: number;
	numero_cuota: number;
	fecha_vencimiento: string;
	pagado: boolean;
	credito_id: number;
	numero_credito_sifco: string;
	cliente_nombre: string;
	asesor_nombre: string | null;
	asesor_email: string | null;
	statusCredit: string;
	capital_esperado: string;
	interes_esperado: string;
	iva_esperado: string;
	seguro_esperado: string;
	gps_esperado: string;
	membresias_esperado: string;
	total_esperado: string;
	capital_pagado: string;
	interes_pagado: string;
	iva_pagado: string;
	seguro_pagado: string;
	gps_pagado: string;
	membresias_pagado: string;
	total_pagado: string;
};

export type MontoACobrarPeriodoRow = {
	bucket: string;
	cuotas_count: number;
	total_cuota: string;
	total_interes: string;
	total_iva: string;
	total_seguro: string;
	total_gps: string;
	total_membresias: string;
	total_mora: string;
	mora_count: number;
	total_credits: number;
	credits_con_mora: number;
	acum_total_cuota: string;
	acum_total_interes: string;
	acum_total_iva: string;
	acum_total_seguro: string;
	acum_total_gps: string;
	acum_total_membresias: string;
	total_interes_inversionista: string;
	acum_total_interes_inversionista: string;
	capital_inv_participacion_actual: string;
	capital_cube_participacion_actual: string;
	interes_iva_inv_participacion_actual: string;
	interes_iva_cube_participacion_actual: string;
	acum_capital_inv_participacion_actual: string;
	acum_capital_cube_participacion_actual: string;
	acum_interes_iva_inv_participacion_actual: string;
	acum_interes_iva_cube_participacion_actual: string;
	creditos_participacion_invalida: number;
	creditos_participacion_invalida_rango?: number;
	cuotas_participacion_invalida: number;
	participacion_actual: boolean;
};

export type FlujoCuotasRubro = {
	capital: string;
	interes: string;
	iva: string;
};

export type FlujoCuotasInversionista = FlujoCuotasRubro & {
	inversionista_id: number;
	nombre: string;
};

export type FlujoCuotasInversionesResponse = {
	reinversionPorTipo: (FlujoCuotasRubro & {
		tipo: string;
		monto_reinvertido?: string;
	})[];
	cashParcialPorTipo: (FlujoCuotasRubro & {
		tipo: string;
		monto_cash?: string;
	})[];
	sinReinversion: {
		totales: FlujoCuotasRubro;
		porInversionista: FlujoCuotasInversionista[];
	};
	pagosExtras: {
		abonos_capital: string;
		cancelaciones: string;
	};
};

type ReinversionLiquidacionesResponseV4 = {
	/** Versión runtime del contrato de conciliación por modalidad. */
	contrato_version: 4;
	/**
	 * Distribución mensual por modalidad. `total_cuota` es el pago neto y
	 * `reinversion_total` el capital que permanece colocado.
	 */
	porTipo: Record<
		string,
		{
			reinversion_capital: string;
			reinversion_interes: string;
			reinversion_total: string;
			total_capital: string;
			total_interes: string;
			total_iva: string;
			total_isr: string;
			total_cuota: string;
			/** IVA real facturado; excluye el IVA referencial sin factura. */
			iva_facturado: string;
			total_distribuido: string;
			cantidad_liquidaciones: number;
			composicion: LiquidationComposition;
		}
	>;
	interesNeto: {
		noVerificado: { interes: string };
		cube: { interes: string; iva: string; neto: string };
	};
	/** Pagos extras recibidos del mes (vía liquidación → pago espejo → abono). */
	pagosExtras: { abonos_capital: string; cancelaciones: string };
	/** Desglose por inversionista (desde liquidaciones): reinversión y a recibir. */
	porInversionista: {
		inversionista_id: number;
		nombre: string;
		tipo_reinversion: string;
		reinversion_capital: string;
		reinversion_interes: string;
		reinversion: string;
		a_recibir: string;
		capital_activo: string;
		composicion: LiquidationComposition;
	}[];
	/** Movimientos completados del mes agrupados por origen del dinero. */
	comprasMes: {
		modalidad_facturacion: string;
		tipo_reinversion: string;
		origen_dinero: FundingOrigin;
		cantidad: number;
		monto: string;
	}[];
	ticketInversion: {
		actual: PurchaseTicketMonth & { variacion_porcentual: string | null };
		historico: PurchaseTicketMonth[];
	};
	detalleInteresNeto: (
		| {
				inversionista_id: number;
				inversionista: string;
				referencia: string;
				interes: string;
				iva: string;
				isr: string;
				tratamiento_fiscal: "no_verificado";
		  }
		| {
				inversionista_id: number;
				inversionista: string;
				referencia: string;
				tratamiento_fiscal: "cube";
				interes: string;
				iva: string;
				isr: string;
				neto: string;
		  }
	)[];
	detallePagosExtras: {
		fecha: string;
		credito: string;
		tipo: "abono_capital" | "cancelacion";
		monto: string;
	}[];
	detalleComprasMes: {
		fecha: string;
		inversionista: string;
		modalidad_facturacion: string;
		tipo_reinversion: string;
		origen_dinero: FundingOrigin;
		monto: string;
	}[];
	detalle_estado: {
		disponible: boolean;
		error: string | null;
	};
	cantidad_liquidaciones: number;
};

type FundingOrigin = "compra_nueva" | "reinversion";

type PurchaseClassification =
	| "nueva_posicion"
	| "ampliacion_posicion"
	| "sin_clasificar";

type PurchaseTicketMonth = {
	periodo: string;
	cantidad: number;
	monto_total: string;
	ticket_promedio: string;
};

export type ReinversionLiquidacionesResponse =
	| ReinversionLiquidacionesResponseV4
	| (Omit<
			ReinversionLiquidacionesResponseV4,
			"contrato_version" | "comprasMes" | "detalleComprasMes"
	  > & {
			contrato_version: 3;
			comprasMes: (Omit<
				ReinversionLiquidacionesResponseV4["comprasMes"][number],
				"origen_dinero"
			> & { tipo_compra: PurchaseClassification })[];
			detalleComprasMes: (Omit<
				ReinversionLiquidacionesResponseV4["detalleComprasMes"][number],
				"origen_dinero"
			> & { tipo_compra: PurchaseClassification })[];
	  });

type CompositionDestination = {
	capital: string;
	resto: string;
	total: string;
};

type LiquidationComposition = {
	pagado: CompositionDestination & { sin_clasificar: string };
	reinvertido: CompositionDestination & { sin_clasificar: string };
	flujo: CompositionDestination;
	estado: "exacto" | "sin_clasificar";
};

const reinversionModes = [
	"sin_reinversion",
	"reinversion_capital",
	"reinversion_interes",
	"reinversion_total",
	"reinversion_variable",
	"reinversion_excedente",
	"reinversion_combinada",
	"sin_clasificar",
] as const;
const billingModes = [
	"p2p_directa",
	"factura_cube",
	"factura_cube_pequeno",
	"sin_modalidad",
] as const;
const fundingOrigins = ["compra_nueva", "reinversion"] as const;
const purchaseClassifications = [
	"nueva_posicion",
	"ampliacion_posicion",
	"sin_clasificar",
] as const;
const moneySchema = z.string().regex(/^\d+(?:\.\d+)?$/);
const signedDecimalSchema = z.string().regex(/^-?\d+(?:\.\d+)?$/);
const countSchema = z.number().int().nonnegative();
const idSchema = z.number().int().nonnegative();
const compositionDestinationSchema = z.object({
	capital: moneySchema,
	resto: moneySchema,
	total: moneySchema,
});
const liquidationCompositionSchema = z.object({
	pagado: compositionDestinationSchema.extend({ sin_clasificar: moneySchema }),
	reinvertido: compositionDestinationSchema.extend({
		sin_clasificar: moneySchema,
	}),
	flujo: compositionDestinationSchema,
	estado: z.enum(["exacto", "sin_clasificar"]),
});
const modeSummarySchema = z.object({
	reinversion_capital: moneySchema,
	reinversion_interes: moneySchema,
	reinversion_total: moneySchema,
	total_capital: moneySchema,
	total_interes: moneySchema,
	total_iva: moneySchema,
	total_isr: moneySchema,
	total_cuota: moneySchema,
	iva_facturado: moneySchema,
	total_distribuido: moneySchema,
	cantidad_liquidaciones: countSchema,
	composicion: liquidationCompositionSchema,
});
const reinversionLiquidacionesV4Schema = z.object({
	contrato_version: z.literal(4),
	porTipo: z.record(z.enum(reinversionModes), modeSummarySchema),
	interesNeto: z.object({
		noVerificado: z.object({ interes: moneySchema }),
		cube: z.object({
			interes: moneySchema,
			iva: moneySchema,
			neto: moneySchema,
		}),
	}),
	pagosExtras: z.object({
		abonos_capital: moneySchema,
		cancelaciones: moneySchema,
	}),
	porInversionista: z.array(
		z.object({
			inversionista_id: idSchema,
			nombre: z.string().trim().min(1),
			tipo_reinversion: z.enum(reinversionModes),
			reinversion_capital: moneySchema,
			reinversion_interes: moneySchema,
			reinversion: moneySchema,
			a_recibir: moneySchema,
			capital_activo: moneySchema,
			composicion: liquidationCompositionSchema,
		}),
	),
	comprasMes: z.array(
		z.object({
			modalidad_facturacion: z.enum(billingModes),
			tipo_reinversion: z.enum(reinversionModes),
			origen_dinero: z.enum(fundingOrigins),
			cantidad: countSchema,
			monto: moneySchema,
		}),
	),
	ticketInversion: z.object({
		actual: z.object({
			periodo: z.string().regex(/^\d{4}-\d{2}$/),
			cantidad: countSchema,
			monto_total: moneySchema,
			ticket_promedio: moneySchema,
			variacion_porcentual: signedDecimalSchema.nullable(),
		}),
		historico: z.array(
			z.object({
				periodo: z.string().regex(/^\d{4}-\d{2}$/),
				cantidad: countSchema,
				monto_total: moneySchema,
				ticket_promedio: moneySchema,
			}),
		),
	}),
	detalleInteresNeto: z.array(
		z.discriminatedUnion("tratamiento_fiscal", [
			z.object({
				inversionista_id: idSchema,
				inversionista: z.string().trim().min(1),
				referencia: z.string().trim().min(1),
				tratamiento_fiscal: z.literal("no_verificado"),
				interes: moneySchema,
				iva: moneySchema,
				isr: moneySchema,
			}),
			z.object({
				inversionista_id: idSchema,
				inversionista: z.string().trim().min(1),
				referencia: z.string().trim().min(1),
				tratamiento_fiscal: z.literal("cube"),
				interes: moneySchema,
				iva: moneySchema,
				isr: moneySchema,
				neto: moneySchema,
			}),
		]),
	),
	detallePagosExtras: z.array(
		z.object({
			fecha: z.string().trim().min(1),
			credito: z.string().trim().min(1),
			tipo: z.enum(["abono_capital", "cancelacion"]),
			monto: moneySchema,
		}),
	),
	detalleComprasMes: z.array(
		z.object({
			fecha: z.string().trim().min(1),
			inversionista: z.string().trim().min(1),
			modalidad_facturacion: z.enum(billingModes),
			tipo_reinversion: z.enum(reinversionModes),
			origen_dinero: z.enum(fundingOrigins),
			monto: moneySchema,
		}),
	),
	detalle_estado: z.discriminatedUnion("disponible", [
		z.object({ disponible: z.literal(true), error: z.null() }),
		z.object({ disponible: z.literal(false), error: z.string().trim().min(1) }),
	]),
	cantidad_liquidaciones: countSchema,
});
const reinversionLiquidacionesV3Schema =
	reinversionLiquidacionesV4Schema.extend({
		contrato_version: z.literal(3),
		comprasMes: z.array(
			z.object({
				modalidad_facturacion: z.enum(billingModes),
				tipo_reinversion: z.enum(reinversionModes),
				tipo_compra: z.enum(purchaseClassifications),
				cantidad: countSchema,
				monto: moneySchema,
			}),
		),
		detalleComprasMes: z.array(
			z.object({
				fecha: z.string().trim().min(1),
				inversionista: z.string().trim().min(1),
				modalidad_facturacion: z.enum(billingModes),
				tipo_reinversion: z.enum(reinversionModes),
				tipo_compra: z.enum(purchaseClassifications),
				monto: moneySchema,
			}),
		),
	});
const reinversionLiquidacionesSchema = z.discriminatedUnion(
	"contrato_version",
	[reinversionLiquidacionesV3Schema, reinversionLiquidacionesV4Schema],
);

export type FlujoPorInversionistaRow = {
	inversionista_id: number;
	nombre: string;
	reinversion_capital: string;
	reinversion_interes: string;
	reinversion_total: string;
	cash_capital: string;
	cash_interes: string;
	cash_total: string;
	interes_bruto: string;
	iva: string;
	isr: string;
	total: string;
};

export type FlujoCuotasPorInversionistaResponse = {
	porInversionista: FlujoPorInversionistaRow[];
	totales: {
		reinversion_total: string;
		cash_total: string;
		interes_bruto: string;
		iva: string;
		isr: string;
		total: string;
		externos: {
			reinversion_total: string;
			cash_total: string;
			total: string;
		};
		cube: {
			reinversion_total: string;
			cash_total: string;
			total: string;
		};
	};
	contexto: {
		cancelaciones_pendientes: {
			cantidad_creditos: number;
			monto_bruto: string;
			capital_externo_asociado: string;
		};
		cierres_naturales_periodo: {
			cantidad_creditos: number;
			capital_externo_asociado: string;
		};
	};
};

const flujoCuotasPorInversionistaSchema = z.object({
	porInversionista: z.array(
		z.object({
			inversionista_id: idSchema,
			nombre: z.string().min(1),
			reinversion_capital: moneySchema,
			reinversion_interes: moneySchema,
			reinversion_total: moneySchema,
			cash_capital: moneySchema,
			cash_interes: moneySchema,
			cash_total: moneySchema,
			interes_bruto: moneySchema,
			iva: moneySchema,
			isr: moneySchema,
			total: moneySchema,
		}),
	),
	totales: z.object({
		reinversion_total: moneySchema,
		cash_total: moneySchema,
		interes_bruto: moneySchema,
		iva: moneySchema,
		isr: moneySchema,
		total: moneySchema,
		externos: z.object({
			reinversion_total: moneySchema,
			cash_total: moneySchema,
			total: moneySchema,
		}),
		cube: z.object({
			reinversion_total: moneySchema,
			cash_total: moneySchema,
			total: moneySchema,
		}),
	}),
	contexto: z.object({
		cancelaciones_pendientes: z.object({
			cantidad_creditos: z.number().int().nonnegative(),
			monto_bruto: moneySchema,
			capital_externo_asociado: moneySchema,
		}),
		cierres_naturales_periodo: z.object({
			cantidad_creditos: z.number().int().nonnegative(),
			capital_externo_asociado: moneySchema,
		}),
	}),
});

export type ColocacionPeriodoRow = {
	bucket: string;
	cantidad_creditos: number;
	total_colocacion: string;
};

export type MoraAgingBucket = {
	bucket: "30" | "60" | "90" | "120";
	cantidad_creditos: number;
	monto_mora: string;
};

export type ComparativoHistoricoResponse = {
	cobrado: { mes: number; cobrado: string }[];
	cartera: { mes: string; creditos_activos: number; cartera_activa: string }[];
	moraActual: MoraAgingBucket[];
	agingHistorico: ({ periodo: string } & MoraAgingBucket)[];
};

export type MoraBucketResult = {
	cantidad: number;
	sumaCapital: string;
	sumaMora: string;
};

export type MoraTotales = {
	mora_30: MoraBucketResult;
	mora_60: MoraBucketResult;
	mora_90: MoraBucketResult;
	mora_120_plus: MoraBucketResult;
	totalEnMora: { cantidad: number; sumaMora: string };
};

export type MoraByEtapaYAsesorResponse = {
	totales: MoraTotales;
	porAsesor: ({
		asesorId: number;
		nombre: string;
		email: string;
	} & MoraTotales)[];
	capitalCartera: {
		total: string;
		porAsesor: {
			asesorId: number;
			nombre: string;
			email: string;
			capital: string;
		}[];
	};
	metadata: {
		capitalCartera: "actual";
		atribucionAsesor: "actual";
	};
	fecha?: string;
	alcance?: "live" | "historico";
	dataDisponibleDesde?: string;
};

export type MoraOfficialClosureResponse = {
	periodo: string;
	totales: Record<
		"mora_30" | "mora_60" | "mora_90" | "mora_120_plus",
		MoraBucketResult
	>;
	porAsesor: ({ asesorId: number; nombre: string } & Record<
		"mora_30" | "mora_60" | "mora_90" | "mora_120_plus",
		MoraBucketResult
	>)[];
	capitalCartera: {
		total: string;
		porAsesor: {
			asesorId: number;
			nombre: string;
			capital: string;
		}[];
	};
	moraMensual: {
		porcentaje: string;
		esperado: string;
		porAsesor: {
			asesorId: number;
			nombre: string;
			esperado: string;
		}[];
	};
	metadata: { fuente: "oficial"; inmutable: true };
};

export type MoraCobradaPorAsesorResponse = {
	periodo: { inicio: string; fin: string };
	porAsesor: { asesorId: number; nombre: string; cobrado: string }[];
	totalCobrado: string;
};

export type MoraRecuperacionPorAsesorResponse = {
	periodo: { inicio: string; fin: string };
	metadata: {
		alcance: "live" | "historico";
		atribucionAsesor: "actual";
	};
	totales: MoraRecoveryMetric;
	porAsesor: (MoraRecoveryMetric & {
		asesorId: number | null;
		nombre: string;
	})[];
};

export type MoraRecoveryMetric = {
	esperado: string;
	cobradoEnSnapshot: string;
	cobradoFueraSnapshot: string;
	excedenteEnSnapshot: string;
	pendiente: string;
};

// ============================================================================
// HTTP CLIENT
// ============================================================================

export interface IdentidadInversionista {
	inversionista_id: number;
	nombre: string;
	email: string | null;
	dpi: string;
	via: "directo" | "representante_de_la_sociedad";
	sociedad: string | null;
}

export class CarteraBackClient {
	private config: CarteraBackClientConfig;
	private circuitBreaker: CircuitBreaker;
	private cache: SimpleCache;

	constructor(config: Partial<CarteraBackClientConfig> = {}) {
		this.config = { ...DEFAULT_CONFIG, ...config };
		this.circuitBreaker = new CircuitBreaker(
			this.config.circuitBreakerThreshold,
			this.config.circuitBreakerTimeout,
		);
		this.cache = new SimpleCache(this.config.cacheTtl);
	}

	// ========================================================================
	// PRIVATE METHODS
	// ========================================================================

	/**
	 * @param retryOnFailure fuerza la política de reintentos de esta llamada.
	 *   Por defecto SOLO se reintentan GET/HEAD: reintentar un POST que ya se
	 *   ejecutó del otro lado duplica el efecto (ver el bloque de reintentos
	 *   más abajo). Pasar `true` únicamente en POST de solo lectura.
	 * @param timeoutMs deadline del fetch. Puede ser una FUNCIÓN para que se
	 *   evalúe al despachar y no al encolar: el reloj del fetch arranca después
	 *   de la autenticación, así que un número fijo calculado antes se pasa de
	 *   lo que queda del presupuesto del llamador. Ver `cotaFetchConsultaMora`.
	 */
	private async request<T>(
		endpoint: string,
		options: RequestInit = {},
		useCache = false,
		timeoutMs?: number | (() => number),
		retryOnFailure?: boolean,
	): Promise<T> {
		const url = `${this.config.baseUrl}${endpoint}`;
		const cacheKey = `${options.method || "GET"}:${url}:${JSON.stringify(options.body || {})}`;

		// Check cache for GET requests
		if (useCache && this.config.enableCache && options.method === "GET") {
			const cached = this.cache.get<T>(cacheKey);
			if (cached) {
				console.log(`[CarteraBack] Cache hit: ${cacheKey}`);
				return cached;
			}
		}

		const buildRequestOptions = async (
			forceRefresh = false,
		): Promise<RequestInit> => {
			const token = forceRefresh
				? await invalidateAndReauth()
				: await this.config.accessTokenProvider();
			// Se resuelve ACÁ, con el token ya en mano: es el instante en que el
			// reloj del fetch arranca de verdad.
			const deadlineMs =
				typeof timeoutMs === "function"
					? timeoutMs()
					: (timeoutMs ?? this.config.timeout);
			return {
				...options,
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${token}`,
					...options.headers,
				},
				// Si el llamador trae su propia señal (p. ej. el presupuesto de la
				// consulta de mora, que corre desde ANTES de la autenticación), se
				// combina con el timeout del fetch en vez de pisarla: una señal ya
				// abortada frena el fetch aunque el token haya llegado tarde.
				signal: options.signal
					? AbortSignal.any([options.signal, AbortSignal.timeout(deadlineMs)])
					: AbortSignal.timeout(deadlineMs),
			};
		};

		// Solo son seguras de reintentar las llamadas sin efecto de lado. Un
		// método mutante puede haberse ejecutado igual aunque el cliente no vea
		// la respuesta (timeout, corte de red), así que el reintento duplica.
		const metodo = (options.method || "GET").toUpperCase();
		const esLectura = metodo === "GET" || metodo === "HEAD";
		const permiteReintento = retryOnFailure ?? esLectura;

		let lastError: Error | null = null;
		let didReauth = false;

		for (let attempt = 0; attempt <= this.config.retryAttempts; attempt++) {
			try {
				const response = await this.circuitBreaker.execute(
					async () => {
						const requestOptions = await buildRequestOptions();
						const res = await this.config.fetchTransport(url, requestOptions);

						if (!res.ok) {
							const errorText = await res.text();
							let errorData: { error?: string; message?: string } = {};

							try {
								errorData = JSON.parse(errorText);
							} catch {
								errorData = { error: errorText };
							}

							if (res.status === 401 || res.status === 403) {
								if (!didReauth) {
									didReauth = true;
									const retryOptions = await buildRequestOptions(true);
									const retryRes = await this.config.fetchTransport(
										url,
										retryOptions,
									);
									if (retryRes.ok) return retryRes;
									const retryText = await retryRes.text();
									let retryData: { error?: string; message?: string } = {};
									try {
										retryData = JSON.parse(retryText);
									} catch {
										retryData = { error: retryText };
									}
									throw new CarteraBackHttpError(
										`Authentication failed: ${retryData.error || retryData.message || retryText}`,
										retryRes.status,
										retryData,
									);
								}
								throw new CarteraBackHttpError(
									`Authentication failed: ${errorData.error || errorData.message}`,
									res.status,
									errorData,
								);
							}

							if (res.status === 400) {
								throw new CarteraBackHttpError(
									`Validation failed: ${errorData.error || errorData.message}`,
									res.status,
									errorData,
								);
							}

							throw new CarteraBackHttpError(
								`HTTP ${res.status}: ${errorData.error || errorData.message || errorText}`,
								res.status,
								errorData,
							);
						}

						return res;
					},
					// La señal del llamador no es cartera fallando: ver
					// `esCancelacionDelLlamador`.
					() => esCancelacionDelLlamador(options.signal),
				);

				const data = (await response.json()) as T;

				// Cache successful GET requests
				if (useCache && this.config.enableCache && options.method === "GET") {
					this.cache.set(cacheKey, data);
				}

				return data;
			} catch (error) {
				lastError = error as Error;

				// El llamador ya se cansó: reintentar es mandar viajes que nadie
				// va a esperar, y cada uno vuelve a rechazar por la misma señal.
				if (esCancelacionDelLlamador(options.signal)) {
					break;
				}

				// Don't retry on authentication/validation errors, nor on 4xx
				// (esos son respuestas definitivas del servidor, no fallas
				// transitorias — ej. un 404 de "monto sin bracket" no cambia
				// de resultado al reintentar).
				if (
					lastError.message.includes("Authentication failed") ||
					lastError.message.includes("Validation failed") ||
					lastError.message.includes("Circuit breaker is OPEN") ||
					(lastError instanceof CarteraBackHttpError &&
						lastError.status >= 400 &&
						lastError.status < 500)
				) {
					break;
				}

				// 🚫 Nada de reintentar operaciones que MUTAN (POST/PUT/PATCH/DELETE).
				// El 2026-08-07 este bucle reintentó un POST a /facturar-generico que
				// había abortado por timeout a los 30s: cartera ya había certificado
				// la factura en SAT y el reintento certificó una segunda idéntica
				// (Q150 al NIT 43254667). El timeout del cliente NO cancela lo que el
				// servidor ya está ejecutando; lo mismo aplicaría a /newPayment,
				// /newCredit, /boletas, etc. Ante un fallo transitorio preferimos que
				// el error suba y se decida arriba antes que duplicar plata o facturas.
				if (!permiteReintento) {
					console.warn(
						`[CarteraBack] ${metodo} ${endpoint} falló y NO se reintenta (operación no idempotente): ${lastError.message}`,
					);
					break;
				}

				// Wait before retry (exponential backoff)
				if (attempt < this.config.retryAttempts) {
					const delay = this.config.retryDelay * 2 ** attempt;
					console.log(
						`[CarteraBack] Retry ${attempt + 1}/${this.config.retryAttempts} after ${delay}ms`,
					);
					await new Promise((resolve) => setTimeout(resolve, delay));
				}
			}
		}

		// All retries failed
		throw this.handleError(lastError || new Error("Unknown error"));
	}

	private handleError(error: Error): CarteraBackError {
		// Preservar tal cual: los callers que necesitan el status HTTP real
		// (ej. distinguir un 404 de "sin bracket" de un error genérico)
		// dependen de que esta instancia no se reescriba.
		if (error instanceof CarteraBackHttpError) {
			return error as unknown as CarteraBackError;
		}

		if (error.message.includes("Authentication failed")) {
			return new Error(error.message) as CarteraBackAuthError;
		}

		if (error.message.includes("Validation failed")) {
			return new Error(error.message) as CarteraBackValidationError;
		}

		if (
			error.message.includes("Circuit breaker is OPEN") ||
			error.name === "AbortError"
		) {
			return new Error(
				`Failed to connect to cartera-back: ${error.message}`,
			) as CarteraBackConnectionError;
		}

		return new Error(
			`Cartera-back error: ${error.message}`,
		) as CarteraBackError;
	}

	// ========================================================================
	// HEALTH CHECK
	// ========================================================================

	async healthCheck(): Promise<{ status: string; circuitBreaker: string }> {
		try {
			await this.request("/health", { method: "GET" });
			return {
				status: "healthy",
				circuitBreaker: this.circuitBreaker.getState(),
			};
		} catch {
			return {
				status: "unhealthy",
				circuitBreaker: this.circuitBreaker.getState(),
			};
		}
	}

	// ========================================================================
	// USUARIOS (CLIENTS)
	// ========================================================================

	async createUsuario(input: CreateUsuarioInput): Promise<CarteraUsuario> {
		this.cache.invalidate("usuarios");
		const response = await this.request<CarteraBackApiResponse<CarteraUsuario>>(
			"/users",
			{
				method: "POST",
				body: JSON.stringify(input),
			},
		);
		if (!response.data) throw new Error("No data returned from createUsuario");
		return response.data;
	}

	async getUsuariosWithSifco(): Promise<CarteraUsuario[]> {
		const response = await this.request<
			CarteraBackApiResponse<CarteraUsuario[]>
		>(
			"/users-with-sifco",
			{ method: "GET" },
			true, // use cache
		);
		return response.data || [];
	}

	// ========================================================================
	// CRÉDITOS (LOANS)
	// ========================================================================

	async createCredito(input: CreateCreditoInput): Promise<CarteraCredito> {
		this.cache.invalidate("creditos");
		// El endpoint /newCredit retorna directamente el objeto CarteraCredito, no envuelto en { data: ... }
		const response = await this.request<CarteraCredito>("/newCredit", {
			method: "POST",
			body: JSON.stringify(input),
		});
		return response;
	}

	async updateCredito(input: UpdateCreditoInput): Promise<CarteraCredito> {
		this.cache.invalidate(`credito:${input.credito_id}`);
		const response = await this.request<CarteraBackApiResponse<CarteraCredito>>(
			"/updateCredit",
			{
				method: "POST",
				body: JSON.stringify(input),
			},
		);
		if (!response.data) throw new Error("No data returned from updateCredito");
		return response.data;
	}

	async getCredito(numeroSifco: string): Promise<CreditoDirectoResponse> {
		// El endpoint /credito NO usa el wrapper CarteraBackApiResponse
		// Retorna los datos directamente
		const response = await this.request<CreditoDirectoResponse>(
			`/credito?numero_credito_sifco=${encodeURIComponent(numeroSifco)}`,
			{ method: "GET" },
			true, // use cache
		);
		console.log(
			`[CarteraBackClient] getCredito response for ${numeroSifco}:`,
			JSON.stringify(response, null, 2),
		);
		if (!response) throw new Error(`Crédito ${numeroSifco} not found`);
		return response;
	}

	async getAllCreditos(
		params: GetAllCreditsParams,
	): Promise<PaginatedResponse<CreditoDetailResponse>> {
		// Si la lista de SIFCOs es grande, usar POST para evitar URL too long
		// (414). Threshold conservador: ~50 SIFCOs * 15 chars ≈ 750 bytes, muy
		// por debajo de cualquier límite. Por arriba de eso, body en POST.
		const SIFCO_LIST_POST_THRESHOLD = 50;
		const useBulkPost =
			!!params.numeros_credito_sifco &&
			params.numeros_credito_sifco.length > SIFCO_LIST_POST_THRESHOLD;

		let response: PaginatedResponse<CreditoDetailResponse>;

		if (useBulkPost) {
			console.log(
				`[CarteraBackClient] getAllCreditos: usando POST (${params.numeros_credito_sifco?.length} SIFCOs en lista)`,
			);
			response = await this.request<PaginatedResponse<CreditoDetailResponse>>(
				"/getAllCredits",
				{
					method: "POST",
					body: JSON.stringify({
						mes: params.mes,
						anio: params.anio,
						estado: params.estado,
						...(params.page !== undefined && { page: params.page }),
						...(params.perPage !== undefined && { perPage: params.perPage }),
						...(params.cuotas_atrasadas !== undefined && {
							cuotas_atrasadas: params.cuotas_atrasadas,
						}),
						...(params.time && { proximidad_pago: params.time }),
						...(params.nombre_usuario && {
							nombre_usuario: params.nombre_usuario,
						}),
						...(params.numero_credito_sifco && {
							numero_credito_sifco: params.numero_credito_sifco,
						}),
						...(params.numeros_credito_sifco && {
							numeros_credito_sifco: params.numeros_credito_sifco,
						}),
						...(params.email_cobrador && {
							email_asesor: params.email_cobrador,
						}),
						// Sin esto el rango de fechas se perdía solo en la ruta POST
						// (>50 SIFCOs) mientras el GET sí lo mandaba.
						...(params.fecha_desde && {
							fecha_desde: params.fecha_desde,
						}),
						...(params.fecha_hasta && {
							fecha_hasta: params.fecha_hasta,
						}),
						...(params.capital_min !== undefined && {
							capital_min: params.capital_min,
						}),
						...(params.capital_max !== undefined && {
							capital_max: params.capital_max,
						}),
						...(params.excluir_pagados_mes && {
							excluir_pagados_mes: true,
						}),
						excel: false,
					}),
				},
				false,
				undefined,
				// POST solo por el tamaño del body (>50 SIFCOs): es una consulta,
				// no muta nada → se puede reintentar.
				true,
			);
		} else {
			const queryParams = new URLSearchParams({
				mes: params.mes.toString(),
				anio: params.anio.toString(),
				...(params.estado && { estado: params.estado }),
				...(params.page && { page: params.page.toString() }),
				...(params.perPage && { perPage: params.perPage.toString() }),
				...(params.cuotas_atrasadas !== undefined && {
					cuotas_atrasadas: params.cuotas_atrasadas.toString(),
				}),
				...(params.time && { proximidad_pago: params.time }),
				...(params.nombre_usuario && {
					nombre_usuario: params.nombre_usuario,
				}),
				...(params.numero_credito_sifco && {
					numero_credito_sifco: params.numero_credito_sifco,
				}),
				...(params.numeros_credito_sifco &&
					params.numeros_credito_sifco.length > 0 && {
						numeros_credito_sifco: params.numeros_credito_sifco.join(","),
					}),
				...(params.email_cobrador && { email_asesor: params.email_cobrador }),
				...(params.fecha_desde && { fecha_desde: params.fecha_desde }),
				...(params.fecha_hasta && { fecha_hasta: params.fecha_hasta }),
				...(params.capital_min !== undefined && {
					capital_min: params.capital_min.toString(),
				}),
				...(params.capital_max !== undefined && {
					capital_max: params.capital_max.toString(),
				}),
				...(params.excluir_pagados_mes && {
					excluir_pagados_mes: "true",
				}),
				excel: "false",
			});

			console.log(
				`[CarteraBackClient] getAllCreditos query: ${queryParams.toString()}`,
			);
			response = await this.request<PaginatedResponse<CreditoDetailResponse>>(
				`/getAllCredits?${queryParams}`,
				{ method: "GET" },
				true, // use cache (solo GET)
			);
		}

		// Validar que la respuesta tenga la estructura de PaginatedResponse
		if (!response.data || !Array.isArray(response.data)) {
			console.error(
				"[CarteraBackClient] Invalid PaginatedResponse structure:",
				response,
			);
			throw new Error(
				"Invalid response structure: expected PaginatedResponse with data array",
			);
		}

		// Log resumido en lugar de imprimir todo
		console.log(
			`[CarteraBackClient] getAllCreditos: ${response.data.length} créditos obtenidos (página ${response.page}/${response.totalPages})`,
		);

		return response;
	}

	async creditAction(
		input: CreditActionInput,
	): Promise<{ success: boolean; message: string }> {
		this.cache.invalidate(`credito:${input.creditId}`);
		const response = await this.request<
			CarteraBackApiResponse<{ success: boolean; message: string }>
		>("/creditAction", {
			method: "POST",
			body: JSON.stringify(input),
		});
		return response.data || { success: false, message: "No response" };
	}

	// ========================================================================
	// PAGOS (PAYMENTS)
	// ========================================================================

	async createPago(input: CreatePagoInput): Promise<CarteraPagoCredito> {
		this.cache.invalidate(`credito:${input.credito_numero_sifco}`);
		this.cache.invalidate("pagos");
		const response = await this.request<
			CarteraBackApiResponse<CarteraPagoCredito>
		>("/newPayment", {
			method: "POST",
			body: JSON.stringify(input),
		});
		if (!response.data) throw new Error("No data returned from createPago");
		return response.data;
	}

	async reversePago(
		input: ReversePagoInput,
	): Promise<{ success: boolean; message: string }> {
		this.cache.invalidate(`credito:${input.credito_id}`);
		this.cache.invalidate("pagos");
		const response = await this.request<
			CarteraBackApiResponse<{ success: boolean; message: string }>
		>("/reversePayment", {
			method: "POST",
			body: JSON.stringify(input),
		});
		return response.data || { success: false, message: "No response" };
	}

	async getPagosByCredito(numeroSifco: string): Promise<CarteraPagoCredito[]> {
		const response = await this.request<
			CarteraBackApiResponse<CarteraPagoCredito[]>
		>(
			`/paymentByCredit?numero_credito_sifco=${encodeURIComponent(numeroSifco)}&excel=false`,
			{ method: "GET" },
			true, // use cache
		);
		return response.data || [];
	}

	async getPayments(
		params: GetPaymentsParams,
	): Promise<PaginatedResponse<CarteraPagoCredito>> {
		const queryParams = new URLSearchParams({
			mes: params.mes.toString(),
			anio: params.anio.toString(),
			...(params.page && { page: params.page.toString() }),
			...(params.perPage && { perPage: params.perPage.toString() }),
			...(params.numero_credito_sifco && {
				numero_credito_sifco: params.numero_credito_sifco,
			}),
		});

		const response = await this.request<
			CarteraBackApiResponse<PaginatedResponse<CarteraPagoCredito>>
		>(`/payments?${queryParams}`, { method: "GET" }, true);

		if (!response.data) throw new Error("No data returned from getPayments");
		return response.data;
	}

	async liquidatePagosInversionistas(
		input: LiquidatePagosInversionistasInput,
	): Promise<{ success: boolean; message: string }> {
		this.cache.invalidate("inversionistas");
		const response = await this.request<
			CarteraBackApiResponse<{ success: boolean; message: string }>
		>("/liquidate-pagos-inversionistas", {
			method: "POST",
			body: JSON.stringify(input),
		});
		return response.data || { success: false, message: "No response" };
	}

	// ========================================================================
	// NIT VALIDATION
	// ========================================================================

	async consultarNit(nit: string): Promise<{
		success: boolean;
		data?: { nit: string; nombre: string | null };
		mensaje: string;
	}> {
		// POST de solo consulta (pega a SAT y no crea nada): se puede reintentar.
		return this.request(
			"/api/dte/consultarNit",
			{ method: "POST", body: JSON.stringify({ nit }) },
			false,
			undefined,
			true,
		);
	}

	// ========================================================================
	// CONSULTA DE MORA POR DPI
	// ========================================================================

	/**
	 * ¿Esta persona ya es cliente y está en mora?
	 *
	 * Fail-closed: **nunca** devuelve un veredicto que no venga de cartera. Si
	 * cartera o SIFCO no contestan, lanza `ConsultaMoraNoDisponibleError` en vez
	 * de inventar un "sin mora". El llamador (`crm.validarMoraPorDpi`) traduce
	 * esa excepción a `puedeContinuar: false` con motivo `SERVICIO_NO_DISPONIBLE`.
	 *
	 * Tres decisiones que no son obvias:
	 *
	 * 1. **Sin caché.** Cachear alivia al core legacy de SIFCO (20s de timeout),
	 *    pero acá el dato caduca en el peor sentido posible: quien acaba de caer
	 *    en mora pasaría el filtro durante los cinco minutos del TTL, y ese es
	 *    justo el caso que el filtro existe para atajar. La caché es en memoria y
	 *    por proceso, así que ni siquiera hay dónde invalidarla cuando la mora la
	 *    genera el cron de cartera. Además el volumen no lo pide: es un DPI
	 *    tecleado por un humano llenando una solicitud, no un barrido. (De hecho
	 *    `request()` solo cachea GET, así que esto es explícito, no incidental.)
	 * 2. **Un solo intento.** Es un POST de solo lectura —se podría reintentar
	 *    sin duplicar nada—, pero cada intento puede tardar los 20s de SIFCO: con
	 *    reintentos el asesor se queda mirando la pantalla más de un minuto y se
	 *    le carga la mano al core justo cuando está sufriendo. Bajo fail-closed
	 *    el costo de no reintentar es un "no se pudo consultar" que se puede
	 *    volver a pedir, no una respuesta equivocada. Del rebote repetido se
	 *    encarga el circuit breaker.
	 * 3. **Se valida la forma.** Un 200 con un cuerpo que no es el contrato es un
	 *    fallo, no un "sin mora": sin este parseo, un `{}` se leería como
	 *    `tieneMoraActiva: undefined` y dejaría pasar a cualquiera.
	 *
	 * `numerosCreditoConocidos` son los números de crédito que el CRM asocia a
	 * ese DPI y que SIFCO no sabe devolver (`CRM-<uuid>` de las oportunidades
	 * ganadas acá, `insoluto-N`). Cartera los suma a los del core antes de
	 * buscar; sin ellos, el cliente cuyos créditos nacieron todos en el CRM no
	 * tiene ficha en SIFCO y salía como CLIENTE_NO_ENCONTRADO. Se omiten cuando
	 * la lista viene vacía: el contrato los tiene como opcionales.
	 */
	async consultarMoraPorDpi(
		dpi: string,
		numerosCreditoConocidos?: string[],
	): Promise<ConsultaMoraResponse> {
		const cuerpo =
			numerosCreditoConocidos && numerosCreditoConocidos.length > 0
				? { dpi, numerosCreditoConocidos }
				: { dpi };

		let crudo: unknown;
		try {
			// El presupuesto envuelve la llamada COMPLETA y no solo el fetch: la
			// autenticación corre antes de que `request()` arme su AbortSignal y no
			// tiene señal propia. Ver `conPresupuestoConsultaMora`.
			crudo = await conPresupuestoConsultaMora(
				CONSULTA_MORA_TIMEOUT_MS,
				(senalVencimiento, restanteMs) =>
					this.request<unknown>(
						"/clientes/consulta-mora",
						{
							method: "POST",
							body: JSON.stringify(cuerpo),
							signal: senalVencimiento,
						},
						false, // sin caché (ver arriba)
						// Función, no número: el deadline se calcula al despachar
						// —con la autenticación ya pagada— para caber DENTRO del
						// presupuesto y vencer antes que él. Ver
						// `cotaFetchConsultaMora`.
						() => cotaFetchConsultaMora(restanteMs()),
						false, // un solo intento (ver arriba)
					),
			);
		} catch (error) {
			// El vencimiento del presupuesto ya llega con el motivo correcto; no se
			// vuelve a envolver para no anidar el mismo mensaje dos veces.
			if (error instanceof ConsultaMoraNoDisponibleError) {
				throw error;
			}

			throw new ConsultaMoraNoDisponibleError(
				`No se pudo consultar la mora en cartera: ${
					error instanceof Error ? error.message : String(error)
				}`,
				error,
			);
		}

		const parseado = consultaMoraResponseSchema.safeParse(crudo);
		if (!parseado.success) {
			throw new ConsultaMoraNoDisponibleError(
				`Cartera respondió la consulta de mora con una forma inesperada: ${parseado.error.message}`,
				parseado.error,
			);
		}

		return parseado.data;
	}

	// ========================================================================
	// BANCOS (BANKS)
	// ========================================================================

	// Catálogo completo, para mapear banco_id → nombre de registros existentes
	// (un inversionista puede tener guardado un banco sin transferencia).
	async getBancos(): Promise<{ banco_id: number; nombre: string }[]> {
		const response = await this.request<{
			data: { banco_id: number; nombre: string }[];
		}>("/bancos", { method: "GET" }, true);
		return response.data ?? [];
	}

	// Solo bancos con id_banco_transferencia, para comboboxes de selección
	// de banco (crear/editar inversionista) — igual que auth-google.
	async getBancosTransferencia(): Promise<
		{ banco_id: number; nombre: string }[]
	> {
		const response = await this.request<{
			data: { banco_id: number; nombre: string }[];
		}>("/bancos?con_transferencia=true", { method: "GET" }, true);
		return response.data ?? [];
	}

	// ========================================================================
	// INVERSIONISTAS (INVESTORS)
	// ========================================================================

	async getInvestors(
		params: GetInvestorsParams = {},
	): Promise<PaginatedResponse<CarteraInversionista>> {
		const queryParams = new URLSearchParams({
			...(params.id && { id: params.id.toString() }),
			...(params.page && { page: params.page.toString() }),
			...(params.perPage && { perPage: params.perPage.toString() }),
		});
		// El endpoint /investor retorna directamente un array, no un objeto con { data: [...] }
		const response = await this.request<CarteraInversionista[]>(
			`/investor?${queryParams}`,
			{ method: "GET" },
			true,
		);
		// Transformar la respuesta al formato PaginatedResponse esperado
		return {
			data: response,
			page: params.page || 1,
			perPage: params.perPage || 20,
			total: response.length,
			totalPages: 1,
		};
	}

	async getInvestorRendimiento(email: string): Promise<{
		success: boolean;
		data: {
			inversionista_id: number;
			nombre: string;
			dpi: string;
			capital_total_aportado: number;
			cantidad_inversiones: number;
			rendimiento_estimado: number;
		};
	}> {
		const queryParams = new URLSearchParams({ email });
		const response = await this.request<{
			success: boolean;
			data: {
				inversionista_id: number;
				nombre: string;
				dpi: string;
				capital_total_aportado: number;
				cantidad_inversiones: number;
				rendimiento_estimado: number;
			};
		}>(`/inversionistas/rendimiento?${queryParams}`, { method: "GET" }, true);
		return response;
	}

	/**
	 * Persona dueña de un DPI o de un correo. `data: null` = no existe.
	 *
	 * La usa el alta del CRM para detectar que conta no está duplicando por
	 * error, sino dando de alta la empresa de alguien que ya es inversionista.
	 */
	async buscarIdentidadInversionista(params: {
		dpi?: string;
		email?: string;
	}): Promise<{ success: boolean; data: IdentidadInversionista | null }> {
		const queryParams = new URLSearchParams();
		if (params.dpi) queryParams.set("dpi", params.dpi);
		if (params.email) queryParams.set("email", params.email);

		// Sin cache: el `data: null` de "no es de nadie" es un 200 y se guardaría
		// cinco minutos. Con cache en memoria + varias instancias, el invalidate
		// de `createInvestor` no llega a las demás —y el alta puede venir de
		// cartera, donde no hay invalidate ninguno—, así que el negativo viejo
		// sobrevive: la detección no ve a la persona recién creada y, sin el
		// interruptor "¿Es empresa?", su sociedad rebota como duplicada.
		// Es una consulta por DPI tecleado, disparada por un humano llenando un
		// formulario: no hay volumen que justifique cachearla.
		return this.request<{
			success: boolean;
			data: IdentidadInversionista | null;
		}>(`/investor/identidad?${queryParams}`, { method: "GET" }, false);
	}

	async getInvestorReport(
		params: GetInvestorReportParams,
	): Promise<InversionistaReporte> {
		const queryParams = new URLSearchParams({
			id: params.id.toString(),
			...(params.page && { page: params.page.toString() }),
			...(params.perPage && { perPage: params.perPage.toString() }),
			...(params.numeroCreditoSifco && {
				numeroCreditoSifco: params.numeroCreditoSifco,
			}),
			...(params.nombreUsuario && { nombreUsuario: params.nombreUsuario }),
		});

		const response = await this.request<
			CarteraBackApiResponse<InversionistaReporte>
		>(`/getInvestors?${queryParams}`, { method: "GET" }, true);

		if (!response.data)
			throw new Error("No data returned from getInvestorReport");
		return response.data;
	}

	// ========================================================================
	// ASESORES (ADVISORS)
	// ========================================================================

	async getAdvisors(
		params: GetAdvisorsParams = {},
	): Promise<PaginatedResponse<CarteraAsesor>> {
		console.log("[CarteraBackClient.getAdvisors] Called with params:", params);

		const queryParams = new URLSearchParams({
			...(params.page && { page: params.page.toString() }),
			...(params.perPage && { perPage: params.perPage.toString() }),
		});

		console.log(
			"[CarteraBackClient.getAdvisors] Query params:",
			queryParams.toString(),
		);
		console.log(
			"[CarteraBackClient.getAdvisors] URL:",
			`/advisor?${queryParams}`,
		);

		// El endpoint /advisor retorna directamente un array, no un objeto con { data: [...] }
		const response = await this.request<CarteraAsesor[]>(
			`/advisor?${queryParams}`,
			{ method: "GET" },
			true,
		);

		console.log(
			"[CarteraBackClient.getAdvisors] Response received:",
			JSON.stringify(response, null, 2),
		);

		// Transformar la respuesta al formato PaginatedResponse esperado
		return {
			data: response,
			page: params.page || 1,
			perPage: params.perPage || 20,
			total: response.length,
			totalPages: 1,
		};
	}

	// ========================================================================
	// STATS (ESTADÍSTICAS)
	// ========================================================================

	async getStats(
		params: { email?: string } = {},
	): Promise<CarteraStatsResponse> {
		const queryParams = new URLSearchParams({
			...(params.email && { email: params.email }),
		});

		const url = params.email ? `/stats?${queryParams}` : "/stats";

		// Este endpoint retorna directamente el objeto de stats
		const response = await this.request<CarteraStatsResponse>(
			url,
			{ method: "GET" },
			true,
		);

		console.log(
			"[CarteraBackClient] getStats raw response:",
			JSON.stringify(response, null, 2),
		);

		return response;
	}

	// ========================================================================
	// FACTURACIÓN
	// ========================================================================

	/**
	 * Genera una factura genérica en cartera-back
	 * @param input - Datos de la factura a generar
	 * @returns Resultado de la operación
	 */
	async facturarGenerico(
		input: FacturarGenericoInput,
	): Promise<FacturarGenericoResponse> {
		const response = await this.request<FacturarGenericoResponse>(
			"/api/dte/facturar-generico",
			{
				method: "POST",
				body: JSON.stringify(input),
			},
		);
		return response;
	}

	/**
	 * Registra un gasto administrativo en cartera-back.
	 *
	 * Se usa al cerrar una oportunidad: por cada factura de servicio generada
	 * (todas menos la de royalty) guarda el monto facturado en la tabla
	 * cartera.gastos_administrativos, para que aparezca en el reporte diario.
	 * El token Bearer y los reintentos los maneja request() automáticamente.
	 *
	 * @param input - fecha ("YYYY-MM-DD" en hora Guatemala), concepto y monto
	 * @returns Resultado de la operación ({ success, data })
	 */
	async crearGastoAdministrativo(input: {
		fecha: string;
		concepto: string;
		monto: number;
	}): Promise<{ success: boolean; data?: unknown }> {
		const response = await this.request<{ success: boolean; data?: unknown }>(
			"/api/gastos-administrativos",
			{
				method: "POST",
				body: JSON.stringify(input),
			},
		);
		return response;
	}

	/**
	 * Refresca (aplica los registros manuales de) el snapshot diario de
	 * facturación para una fecha. Es necesario DESPUÉS de insertar gastos
	 * administrativos: el reporte diario lee de facturacion_snapshot_diario,
	 * y este endpoint copia el SUM de gastos del día a las columnas
	 * administrativos/otros_cobros (el mismo paso que hace la UI manual).
	 *
	 * @param fecha - "YYYY-MM-DD" (hora Guatemala)
	 */
	async aplicarManualesDia(fecha: string): Promise<unknown> {
		// Regenera el snapshot del día completo (no suma): correrlo dos veces
		// deja el mismo resultado → es idempotente y se puede reintentar.
		return this.request(
			"/api/facturacion-snapshot/aplicar-manuales-dia",
			{ method: "POST", body: JSON.stringify({ fecha }) },
			false,
			undefined,
			true,
		);
	}

	// ========================================================================
	// RESUMEN GLOBAL INVERSIONISTAS
	// ========================================================================

	async getResumenGlobalInversionistas(
		filters: ResumenGlobalInversionistasFilters = {},
	): Promise<ResumenGlobalInversionista[]> {
		const queryParams = new URLSearchParams();

		if (filters.inversionistaId !== undefined) {
			queryParams.set("inversionistaId", String(filters.inversionistaId));
		}
		queryParams.set("estado", filters.estado ?? "pending");
		if (filters.mes !== undefined) {
			queryParams.set("mes", String(filters.mes));
		}
		if (filters.anio !== undefined) {
			queryParams.set("anio", String(filters.anio));
		}
		if (filters.incluirInternos) {
			queryParams.set("incluirInternos", "true");
		}

		// Sin cache: el estado de liquidación debe verse fresco siempre. Con cache
		// en memoria + varias instancias, el invalidate del POST liquidar no llega
		// a las demás instancias y la UI muestra "pendiente" hasta 5 min después.
		const response = await this.request<ResumenGlobalInversionista[]>(
			`/resumen-global-liquidaciones?${queryParams.toString()}`,
			{ method: "GET" },
			false,
		);
		return response;
	}

	async getResumenGlobalExcel(
		filters: ResumenGlobalInversionistasFilters = {},
	): Promise<{ success: boolean; url: string }> {
		const queryParams = new URLSearchParams();

		if (filters.inversionistaId !== undefined) {
			queryParams.set("inversionistaId", String(filters.inversionistaId));
		}
		queryParams.set("estado", filters.estado ?? "pending");
		if (filters.mes !== undefined) {
			queryParams.set("mes", String(filters.mes));
		}
		if (filters.anio !== undefined) {
			queryParams.set("anio", String(filters.anio));
		}
		if (filters.incluirInternos) {
			queryParams.set("incluirInternos", "true");
		}
		queryParams.set("excel", "true");

		const response = await this.request<{ success: boolean; url: string }>(
			`/resumen-global-liquidaciones?${queryParams.toString()}`,
			{ method: "GET" },
			false,
		);
		return response;
	}

	async getResumenTransferenciasExcel(filters: {
		mes: number;
		anio: number;
		ach: boolean;
		moneda?: "quetzales" | "dolar";
	}): Promise<{ success: boolean; url: string; filename: string }> {
		const queryParams = new URLSearchParams();
		queryParams.set("mes", String(filters.mes));
		queryParams.set("anio", String(filters.anio));
		queryParams.set("ach", filters.ach ? "true" : "false");
		if (filters.moneda) {
			queryParams.set("moneda", filters.moneda);
		}

		const response = await this.request<{
			success: boolean;
			url: string;
			filename: string;
		}>(
			`/resumen-transferencias?${queryParams.toString()}`,
			{ method: "GET" },
			false,
		);
		return response;
	}

	async getReporteNoLiquidados(
		inversionistaId: number,
	): Promise<{ success: boolean; url: string; filename: string }> {
		const queryParams = new URLSearchParams();
		queryParams.set("id", String(inversionistaId));

		// Sin cache: el reporte debe reflejar el estado actual de los pagos.
		// Timeout propio de 5 min: armar el Excel recorre todos los créditos y
		// pagos del inversionista y lo sube a R2, así que los 30s por defecto se
		// quedan cortos con inversionistas grandes.
		const response = await this.request<{
			success: boolean;
			url: string;
			filename: string;
		}>(
			`/investor/reporte-no-liquidados?${queryParams.toString()}`,
			{ method: "GET" },
			false,
			REPORTE_NO_LIQUIDADOS_TIMEOUT_MS,
		);
		return response;
	}

	async uploadFile(
		file: File | Blob,
		filename: string,
	): Promise<{ url: string; filename: string }> {
		const url = `${this.config.baseUrl}/upload`;
		const formData = new FormData();
		formData.append("file", file, filename);

		const token = await getCarteraAccessToken();
		const response = await fetch(url, {
			method: "POST",
			body: formData,
			headers: { Authorization: `Bearer ${token}` },
			signal: AbortSignal.timeout(this.config.timeout),
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`Upload failed: ${errorText}`);
		}

		return response.json();
	}

	async createBoleta(
		input: CreateBoletaInput,
	): Promise<BoletaPagoInversionista> {
		const response = await this.request<BoletaPagoInversionista>("/boletas", {
			method: "POST",
			body: JSON.stringify(input),
		});
		this.cache.invalidate("resumen-global-liquidaciones");
		return response;
	}

	async liquidateInversionista(
		inversionista_id: number,
	): Promise<Record<string, any>> {
		const response = await this.request<Record<string, any>>(
			"/liquidate-inversionista-pagos",
			{
				method: "POST",
				body: JSON.stringify({ inversionista_id }),
			},
		);
		this.cache.invalidate("resumen-global-liquidaciones");
		return response;
	}

	// ========================================================================
	// INVESTOR DOCUMENTS (DOCUMENTOS DE INVERSIONISTA)
	// ========================================================================

	async createInvestorDocument(input: {
		file: File | Blob;
		inversionista_id: number;
		nombre: string;
		descripcion?: string;
		visible?: boolean;
		created_by?: string;
	}): Promise<{
		success: boolean;
		message: string;
		data?: Record<string, any>;
	}> {
		const url = `${this.config.baseUrl}/investor-documents`;
		const formData = new FormData();
		formData.append("file", input.file, input.nombre);
		formData.append("inversionista_id", String(input.inversionista_id));
		formData.append("nombre", input.nombre);
		if (input.descripcion) formData.append("descripcion", input.descripcion);
		if (input.visible !== undefined)
			formData.append("visible", String(input.visible));
		if (input.created_by) formData.append("created_by", input.created_by);

		const token = await getCarteraAccessToken();
		const response = await fetch(url, {
			method: "POST",
			body: formData,
			headers: { Authorization: `Bearer ${token}` },
			signal: AbortSignal.timeout(this.config.timeout),
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`Error al crear documento: ${errorText}`);
		}

		this.cache.invalidate("investor-documents");
		return response.json();
	}

	async getInvestorDocumentsAdmin(
		inversionistaId: number,
	): Promise<{ success: boolean; data: Record<string, any>[] }> {
		const response = await this.request<{
			success: boolean;
			data: Record<string, any>[];
		}>(`/investor-documents/admin/${inversionistaId}`, { method: "GET" }, true);
		return response;
	}

	async toggleInvestorDocumentVisibility(
		documentoId: number,
		visible: boolean,
	): Promise<{
		success: boolean;
		message: string;
		data?: Record<string, any>;
	}> {
		const response = await this.request<{
			success: boolean;
			message: string;
			data?: Record<string, any>;
		}>(`/investor-documents/${documentoId}/visibility`, {
			method: "PUT",
			body: JSON.stringify({ visible }),
		});
		this.cache.invalidate("investor-documents");
		return response;
	}

	async deleteInvestorDocument(documentoId: number): Promise<{
		success: boolean;
		message: string;
		data?: Record<string, any>;
	}> {
		const response = await this.request<{
			success: boolean;
			message: string;
			data?: Record<string, any>;
		}>(`/investor-documents/${documentoId}/delete`, {
			method: "PATCH",
		});
		this.cache.invalidate("investor-documents");
		return response;
	}

	// ========================================================================
	// CREAR INVERSIONISTA
	// ========================================================================

	async createInvestor(input: {
		inversionista_id?: number;
		operation?: "CREATE";
		nombre: string;
		dpi?: number | null;
		email?: string | null;
		emite_factura?: boolean;
		banco?: number | null;
		tipo_cuenta?: string | null;
		numero_cuenta?: string | null;
		tipo_reinversion?: string | null;
		monto_reinversion?: number | null;
		moneda?: string;
		dpi_rep_legal?: string | null;
	}): Promise<{
		message: string;
		data: { inversionista_id: number; nombre: string; [key: string]: any }[];
		/**
		 * Qué pasó con el acceso al portal de cada inversionista recién creado.
		 *
		 * Viaja aparte de `data` porque el alta puede haber salido perfecta y el
		 * acceso no: son dos desenlaces distintos y el operador tiene que poder
		 * distinguirlos. Cartera nunca falla el alta por esto.
		 */
		provisioning?: {
			inversionistaId: number;
			estado: "creada" | "ya_tenia" | "avisada" | "omitida" | "fallo";
			usuarioEmail: string | null;
			correo: {
				enviado: boolean;
				plantilla: string | null;
				redirigido: boolean;
				destinatarioReal: string | null;
			};
			advertencias: string[];
			motivo: string | null;
		}[];
	}> {
		const response = await this.request<{
			message: string;
			data: { inversionista_id: number; nombre: string; [key: string]: any }[];
			provisioning?: {
				inversionistaId: number;
				estado: "creada" | "ya_tenia" | "avisada" | "omitida" | "fallo";
				usuarioEmail: string | null;
				correo: {
					enviado: boolean;
					plantilla: string | null;
					redirigido: boolean;
					destinatarioReal: string | null;
				};
				advertencias: string[];
				motivo: string | null;
			}[];
		}>("/investor", {
			method: "POST",
			body: JSON.stringify({
				...(input.inversionista_id && {
					inversionista_id: input.inversionista_id,
				}),
				...(input.operation && { operation: input.operation }),
				nombre: input.nombre,
				dpi: input.dpi ?? null,
				email: input.email ?? null,
				emite_factura: input.emite_factura ?? false,
				banco: input.banco ?? null,
				tipo_cuenta: input.tipo_cuenta ?? null,
				numero_cuenta: input.numero_cuenta ?? null,
				tipo_reinversion: input.tipo_reinversion ?? "sin_reinversion",
				monto_reinversion: input.monto_reinversion ?? null,
				moneda: input.moneda ?? "quetzales",
				// El alta de back office SÍ pide acceso al portal. La llave es el
				// permiso: cartera no provisiona sin ella, para que el registro
				// público de auth-google no pueda fabricarse una cuenta con la
				// contraseña en su propio correo. Va explícita porque no hay
				// forma de distinguir por identidad quién llama (todo entra con
				// el mismo token de servicio ADMIN).
				provisionar_portal: true,
				// A propósito NO usamos `?? null`: cartera distingue "la llave no
				// viene" (no tocar) de "viene vacía" (borrar). Mandar null siempre
				// borraría el DPI del representante en cada edición que no lo
				// incluya — y con él, el acceso de esa persona al portal.
				...(input.dpi_rep_legal !== undefined
					? { dpi_rep_legal: input.dpi_rep_legal }
					: {}),
			}),
		});
		this.cache.invalidate("investor");
		return response;
	}

	// ========================================================================
	// CAMBIAR STATUS INVERSIONISTA
	// ========================================================================

	async setInvestorStatus(input: {
		inversionista_id: number;
		status: "activo" | "inactivo" | "pendiente_devolucion";
	}): Promise<{ success?: boolean; message?: string; data?: any }> {
		const response = await this.request<{
			success?: boolean;
			message?: string;
			data?: any;
		}>("/investor/status", {
			method: "POST",
			body: JSON.stringify(input),
		});
		this.cache.invalidate("investor");
		return response;
	}

	// ========================================================================
	// COMPRA DE CARTERA
	// ========================================================================

	async compraCartera(input: {
		inversionista_id: number;
		monto_aportado: number;
		tipo_operacion: "compra_cartera";
		tipo_reinversion?:
			| "sin_reinversion"
			| "reinversion_capital"
			| "reinversion_total";
		// Obligatoria en compra_cartera: define el % Inversionista / % Cash In
		// desde el catálogo de spreads (por monto_aportado, salvo que venga
		// modalidad_facturacion_spread_id).
		modalidad_facturacion?: ModalidadFacturacion;
		// Anulación manual: id exacto del bracket elegido (de los 8 de la
		// modalidad), sin importar si corresponde al monto_aportado.
		modalidad_facturacion_spread_id?: number;
		porcentaje_inversion?: number;
		porcentaje_cash_in?: number;
		fecha_inicio_participacion?: string;
	}): Promise<{ success: boolean; message: string }> {
		const response = await this.request<{
			success: boolean;
			message: string;
		}>("/agregar-inversionista-credito", {
			method: "POST",
			body: JSON.stringify(input),
		});
		return response;
	}

	/**
	 * Resuelve, para un monto dado, las 3 filas del catálogo (una por
	 * modalidad) del bracket correspondiente — fuente única de verdad en SQL,
	 * el front ya no reimplementa esta comparación en JS. Devuelve `[]` si el
	 * monto no cae en ningún bracket (backend responde 404 en ese caso).
	 */
	async resolverModalidadFacturacionSpread(
		monto: number,
	): Promise<ModalidadFacturacionSpreadRow[]> {
		try {
			const response = await this.request<{
				data: ModalidadFacturacionSpreadRow[];
			}>(
				`/modalidad-facturacion/spread/resolver?monto=${encodeURIComponent(monto)}`,
				{ method: "GET" },
				true,
			);
			return response.data ?? [];
		} catch (err) {
			if (err instanceof CarteraBackHttpError && err.status === 404) {
				return [];
			}
			throw err;
		}
	}

	/**
	 * Devuelve las 8 filas (una por bracket) de una modalidad, sin filtrar
	 * por monto. Lo usa el front para poblar el combobox de anulación manual
	 * del spread (el operador puede elegir cualquiera de los 8).
	 */
	async listModalidadFacturacionSpreadByModalidad(
		modalidad: ModalidadFacturacion,
	): Promise<ModalidadFacturacionSpreadRow[]> {
		const response = await this.request<{
			data: ModalidadFacturacionSpreadRow[];
		}>(
			`/modalidad-facturacion/spread/por-modalidad?modalidad=${encodeURIComponent(modalidad)}`,
			{ method: "GET" },
			true,
		);
		return response.data ?? [];
	}

	// ========================================================================
	// REPORTES
	// ========================================================================

	async getMontoACobrar(params: {
		periodo: string;
		fechaInicio: string;
		fechaFin: string;
	}): Promise<MontoACobrarRow[]> {
		const queryParams = new URLSearchParams({
			periodo: params.periodo,
			fechaInicio: params.fechaInicio,
			fechaFin: params.fechaFin,
		});

		const response = await this.request<{ data: MontoACobrarRow[] }>(
			`/reportes/monto-cobrar?${queryParams}`,
			{ method: "GET" },
			true,
		);

		return response.data ?? [];
	}

	async getMontoACobrarPeriodo(params: {
		periodo: string;
		fechaInicio: string;
		fechaFin: string;
	}): Promise<MontoACobrarPeriodoRow[]> {
		const queryParams = new URLSearchParams({
			periodo: params.periodo,
			fechaInicio: params.fechaInicio,
			fechaFin: params.fechaFin,
		});

		const response = await this.request<{ data: MontoACobrarPeriodoRow[] }>(
			`/reportes/monto-cobrar-periodo?${queryParams}`,
			{ method: "GET" },
			true,
		);

		return response.data ?? [];
	}

	async getColocacionPeriodo(params: {
		periodo: string;
		fechaInicio: string;
		fechaFin: string;
	}): Promise<{ data: ColocacionPeriodoRow[] }> {
		const qp = new URLSearchParams(params as Record<string, string>);
		return this.request<{ data: ColocacionPeriodoRow[] }>(
			`/reportes/colocacion-periodo?${qp}`,
			{ method: "GET" },
			true,
		);
	}

	async getComparativoHistorico(
		anio: number,
	): Promise<ComparativoHistoricoResponse> {
		return this.request<ComparativoHistoricoResponse>(
			`/reportes/comparativo-historico?anio=${anio}`,
			{ method: "GET" },
			true,
		);
	}

	async getFacturacionMes(params: {
		mes: number;
		anio: number;
	}): Promise<FacturacionMesResponse> {
		const qp = new URLSearchParams({
			mes: String(params.mes),
			anio: String(params.anio),
		});

		const [cobradoResult, esperadoResult] = await Promise.all([
			this.request<{
				cobrado_interes?: string;
				cobrado_membresias?: string;
				cobrado_seguro_gps?: string;
				cobrado_royalti?: string;
				cobrado_mora?: string;
				cobrado_otros?: string;
			}>(`/reportes/facturacion-mes-cobrado?${qp}`, { method: "GET" }, true),
			this.request<{
				meta_mensual?: string;
			}>(`/reportes/facturacion-mes-esperado?${qp}`, { method: "GET" }, true),
		]);

		const cobrado: FacturacionMesRubro = {
			interes: cobradoResult.cobrado_interes ?? "0",
			membresias: cobradoResult.cobrado_membresias ?? "0",
			seguro_gps: cobradoResult.cobrado_seguro_gps ?? "0",
			royalti: cobradoResult.cobrado_royalti ?? "0",
			mora: cobradoResult.cobrado_mora ?? "0",
			otros: cobradoResult.cobrado_otros ?? "0",
		};

		return {
			cobrado,
			esperado: { meta_mensual: esperadoResult.meta_mensual ?? "0" },
		};
	}

	async getFlujoCuotasInversiones(params: {
		fechaInicio: string;
		fechaFin: string;
	}): Promise<FlujoCuotasInversionesResponse> {
		const qp = new URLSearchParams({
			fechaInicio: params.fechaInicio,
			fechaFin: params.fechaFin,
		});
		return this.request<FlujoCuotasInversionesResponse>(
			`/reportes/flujo-cuotas-inversiones?${qp}`,
			{ method: "GET" },
			true,
		);
	}

	async getReinversionLiquidaciones(params: {
		mes: number;
		anio: number;
	}): Promise<ReinversionLiquidacionesResponse> {
		const qp = new URLSearchParams({
			mes: String(params.mes),
			anio: String(params.anio),
		});
		// Sin cache: el reporte debe reflejar liquidaciones recién creadas/ajustadas.
		// Con cache activo, tras crear liquidaciones el mes podía seguir devolviendo
		// los totales previos hasta expirar el TTL.
		const data = await this.request<unknown>(
			`/reportes/reinversion-liquidaciones?${qp}`,
			{ method: "GET" },
			false,
		);
		const parsed = reinversionLiquidacionesSchema.safeParse(data);
		if (!parsed.success) throw new Error("Contrato de reinversión inválido");
		return parsed.data;
	}

	async getFlujoCuotasPorInversionista(params: {
		fechaInicio: string;
		fechaFin: string;
	}): Promise<FlujoCuotasPorInversionistaResponse> {
		const qp = new URLSearchParams({
			fechaInicio: params.fechaInicio,
			fechaFin: params.fechaFin,
		});
		const data = await this.request<unknown>(
			`/reportes/flujo-cuotas-inversiones/por-inversionista?${qp}`,
			{ method: "GET" },
			false,
		);
		const parsed = flujoCuotasPorInversionistaSchema.safeParse(data);
		if (!parsed.success) throw new Error("Contrato de proyección inválido");
		return parsed.data;
	}

	// ========================================================================
	// REPORTES
	// ========================================================================

	async getMoraByEtapaYAsesor(params?: {
		emailCobrador?: string;
		fecha?: string;
		asesores?: number[];
	}) {
		const queryParams = new URLSearchParams();
		if (params?.emailCobrador)
			queryParams.set("email_cobrador", params.emailCobrador);
		if (params?.fecha) queryParams.set("fecha", params.fecha);
		if (params?.asesores?.length)
			queryParams.set("asesores", params.asesores.join(","));
		const qs = queryParams.size > 0 ? `?${queryParams}` : "";
		return this.request<MoraByEtapaYAsesorResponse>(
			`/reportes/mora-por-etapa-asesor${qs}`,
			{ method: "GET" },
			true,
		);
	}

	async getCierreMoraOficial(params: {
		periodo: string;
		asesores?: number[];
	}) {
		const queryParams = new URLSearchParams({ periodo: params.periodo });
		if (params.asesores?.length)
			queryParams.set("asesores", params.asesores.join(","));
		return this.request<MoraOfficialClosureResponse | null>(
			`/reportes/cierre-mora-oficial?${queryParams}`,
			{ method: "GET" },
			true,
		);
	}

	async getMoraCobradaPorAsesor(params: {
		mes: number;
		anio: number;
		asesores?: number[];
		emailCobrador?: string;
	}) {
		const queryParams = new URLSearchParams();
		queryParams.set("mes", String(params.mes));
		queryParams.set("anio", String(params.anio));
		if (params.asesores?.length)
			queryParams.set("asesores", params.asesores.join(","));
		if (params.emailCobrador)
			queryParams.set("email_cobrador", params.emailCobrador);
		// Sin caché: es un reporte de flujo (pagos del período). Con caché el
		// "Actualizar" podría devolver un hit stale tras registrar/ajustar un pago.
		return this.request<MoraCobradaPorAsesorResponse>(
			`/reportes/mora-cobrada-por-asesor?${queryParams}`,
			{ method: "GET" },
			false,
		);
	}

	async getMoraRecuperacionPorAsesor(params: {
		mes: number;
		anio: number;
		asesores?: number[];
		emailCobrador?: string;
	}): Promise<MoraRecuperacionPorAsesorResponse> {
		const queryParams = new URLSearchParams({
			mes: String(params.mes),
			anio: String(params.anio),
		});
		if (params.asesores?.length)
			queryParams.set("asesores", params.asesores.join(","));
		if (params.emailCobrador)
			queryParams.set("email_cobrador", params.emailCobrador);
		return this.request<MoraRecuperacionPorAsesorResponse>(
			`/reportes/mora-recuperacion-por-asesor?${queryParams}`,
			{ method: "GET" },
			false,
		);
	}

	async getCuotasPorFecha(params: {
		fechaInicio: string;
		fechaFin: string;
		asesorId?: number;
	}): Promise<CuotaPorFechaRow[]> {
		const qp = new URLSearchParams({
			fecha_inicio: params.fechaInicio,
			fecha_fin: params.fechaFin,
			...(params.asesorId ? { asesor_id: String(params.asesorId) } : {}),
		});

		const response = await this.request<{
			ok: boolean;
			data: CuotaPorFechaRow[];
		}>(`/reportes/cuotas-por-fecha?${qp}`, { method: "GET" }, false);

		return response.data ?? [];
	}

	async getCobranzaDiaria(params: {
		anio: number;
		mes: number;
		dia: number;
		asesorId?: number;
	}): Promise<any> {
		const qp = new URLSearchParams({
			anio: String(params.anio),
			mes: String(params.mes),
			dia: String(params.dia),
			...(params.asesorId ? { asesor_id: String(params.asesorId) } : {}),
		});

		const res = await this.request<{ ok: boolean; data: any }>(
			`/reportes/cobranza-diaria?${qp}`,
			{ method: "GET" },
			false,
		);

		return res.data ?? { asesores: [], totalGeneral: null };
	}

	async getCobranzaDiariaDetalle(params: {
		anio: number;
		mes: number;
		dia: number;
		asesorId: number;
		limit?: number;
		offset?: number;
	}): Promise<any> {
		const qp = new URLSearchParams({
			anio: String(params.anio),
			mes: String(params.mes),
			dia: String(params.dia),
			asesor_id: String(params.asesorId),
			limit: String(params.limit ?? 10),
			offset: String(params.offset ?? 0),
		});

		const res = await this.request<{ ok: boolean; data: any }>(
			`/reportes/cobranza-diaria/detalle?${qp}`,
			{ method: "GET" },
			false,
		);

		return res.data ?? { creditos: [], total: 0, hasMore: false };
	}

	// ========================================================================
	// CACHE MANAGEMENT
	// ========================================================================

	clearCache(): void {
		this.cache.clear();
	}

	invalidateCache(pattern?: string): void {
		this.cache.invalidate(pattern);
	}

	// ========================================================================
	// SIMULACIÓN INVERSIONISTA
	// ========================================================================

	async getSimulacionInversionista(
		inversionistaId: number,
		params?: { mes?: number; anio?: number },
	): Promise<SimulacionInversionistaResult> {
		const query = new URLSearchParams();
		if (params?.mes !== undefined) query.set("mes", String(params.mes));
		if (params?.anio !== undefined) query.set("anio", String(params.anio));
		const qs = query.toString() ? `?${query}` : "";
		return this.request<SimulacionInversionistaResult>(
			`/inversionistas/${inversionistaId}/simulacion${qs}`,
			{ method: "GET" },
			false,
		);
	}
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

export const carteraBackClient = new CarteraBackClient();
