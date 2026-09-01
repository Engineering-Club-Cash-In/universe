/**
 * Cartera-Back API Client
 * Type-safe HTTP client with retry logic, circuit breaker, and caching
 */

import { z } from "zod";
import type {
	AbonosCuotaResponse,
	AperturaDiaResponse,
	AsesorHistorialResponse,
	BoletaPagoInversionista,
	CargaPorAsesorBucketResponse,
	CarteraAsesor,
	CarteraBackApiResponse,
	CarteraBackAuthError,
	CarteraBackConnectionError,
	CarteraBackError,
	CarteraBackValidationError,
	CarteraAsignacionesPoolPorSifcoResponse,
	CarteraBucketActualCredito,
	CarteraBucketCatalogo,
	CarteraBucketHistorialEvento,
	CarteraBucketsHistorialResponse,
	CarteraColaDiaResponse,
	CarteraComportamientoPagoResponse,
	CarteraConvenioCuota,
	CarteraConvenioListado,
	CarteraConvenioProximosResponse,
	CarteraCredito,
	CarteraCuotasProximasResponse,
	CarteraSifcosPoolAutoritativosResponse,
	CarteraInversionista,
	CarteraPagoCredito,
	CarteraPagoCreditoInversionista,
	CarteraStatsResponse,
	CarteraUsuario,
	CreateBoletaInput,
	CreateCreditoInput,
	CreatePagoInput,
	CreateUsuarioInput,
	CreditActionInput,
	CreditoBucketResponse,
	CreditoDetailResponse,
	CreditoDirectoResponse,
	EstadoPagoCartera,
	FacturarGenericoInput,
	FacturarGenericoResponse,
	GetAdvisorsParams,
	GetAllCreditsParams,
	GetAsignacionesPoolPorSifcoParams,
	GetAsesorHistorialParams,
	GetBucketsHistorialParams,
	GetCargaPorAsesorBucketParams,
	GetColaDiaSLAParams,
	GetConveniosListadoParams,
	GetCreditosPorBucketParams,
	GetInvestorReportParams,
	GetInvestorsParams,
	GetPaymentsParams,
	GetSifcosPoolAutoritativosParams,
	InversionistaReporte,
	LiquidatePagosInversionistasInput,
	PaginatedResponse,
	PagosPorBoletaResponse,
	PoolPorAsesorRow,
	PromesaActivaCredito,
	RegistrarPagoInput,
	RegistrarPagoResultado,
	ResumenCreditoResponse,
	ResumenGlobalInversionista,
	ReversePagoInput,
	UpdateCreditoInput,
} from "../types/cartera-back";
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
/**
 * ¿Ese estado HTTP prueba que el pago NO llegó a escribirse?
 *
 * Es una lista blanca, no un rango, y la diferencia importa. Estos tres son los
 * que emite `insertPayment` desde sus validaciones, que corren ANTES de la
 * primera escritura: schema inválido, crédito inexistente, crédito bloqueado,
 * usuario inexistente, boleta duplicada, cuota ya cubierta. Un `4xx` de esa
 * lista es un "no" firme y quien llamó puede dejar todo como estaba.
 *
 * "Todos los 4xx" no servía: un intermediario —proxy, balanceador, el runtime
 * del cliente— puede devolver 408 o 499 DESPUÉS de haber despachado el
 * request, y cartera seguir adelante y escribir el pago igual. Contarlo como
 * rechazo devuelve el borrador a `leida` y habilita una segunda confirmación.
 *
 * Un 5xx tampoco prueba nada: `insertPayment` responde 500 desde un catch que
 * envuelve todo el procesamiento y no es transaccional, así que el error pudo
 * ocurrir con parte del pago YA escrita.
 *
 * Todo lo que no esté acá se trata como indeterminado y lo resuelve la
 * reconciliación. Es más lento y nunca cobra de más.
 */
const ESTADOS_DE_RECHAZO_ANTES_DE_ESCRIBIR = new Set([
	400, // el schema del pago no pasó
	404, // crédito o usuario que no existe
	409, // crédito bloqueado, boleta duplicada, cuota ya cubierta
]);

export function esRechazoDefinitivo(status: number): boolean {
	return ESTADOS_DE_RECHAZO_ANTES_DE_ESCRIBIR.has(status);
}

/**
 * ¿Ese 404 es "no existe el dato" o "no existe la ruta"?
 *
 * Los endpoints de cartera que tienen un 404 **de negocio** mandan un `codigo`
 * a propósito (`CREDITO_NO_ENCONTRADO`, `SIN_MOVIMIENTOS`…). El 404 pelado con
 * `{ error: "NOT_FOUND" }` es el que Elysia devuelve cuando la ruta no está
 * registrada.
 *
 * Distinguirlos importa porque significan cosas opuestas para quien llama: uno
 * es un crédito que no se migró —respuesta normal, se sigue— y el otro es un
 * despliegue desalineado, que no se arregla reintentando ni cambiando de
 * crédito.
 */
export function rutaInexistente(
	status: number,
	payload: { error?: string; message?: string; codigo?: string } = {},
): boolean {
	return (
		status === 404 &&
		payload.error === "NOT_FOUND" &&
		payload.codigo === undefined
	);
}

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
			/**
			 * Código de máquina, cuando cartera lo manda. Sirve para distinguir un
			 * 404 de negocio ("este crédito no tiene movimientos") de uno de
			 * infraestructura (ruta que todavía no existe en un deploy rodante,
			 * base path mal, 404 de un proxy).
			 */
			codigo?: string;
		} = {},
	) {
		super(message);
		this.name = "CarteraBackHttpError";
	}
}

// ============================================================================
// CIRCUIT BREAKER
// ============================================================================

class CircuitBreaker {
	private failureCount = 0;
	private lastFailureTime: number | null = null;
	private state: "CLOSED" | "OPEN" | "HALF_OPEN" = "CLOSED";

	constructor(
		private threshold: number,
		private timeout: number,
	) {}

	async execute<T>(fn: () => Promise<T>): Promise<T> {
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

export type ReinversionLiquidacionesResponse = {
	/** Versión runtime del contrato de conciliación por modalidad. */
	contrato_version: 2;
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
	}[];
	/** Compras del mes (operación de compra) agrupadas por modalidad de reinversión. */
	comprasMes: { tipo: string; cantidad: number; monto: string }[];
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
		modalidad: string;
		monto: string;
	}[];
	detalle_estado: {
		disponible: boolean;
		error: string | null;
	};
	cantidad_liquidaciones: number;
};

const reinversionModes = [
	"sin_reinversion",
	"reinversion_capital",
	"reinversion_interes",
	"reinversion_total",
	"reinversion_variable",
	"reinversion_excedente",
	"reinversion_combinada",
] as const;
const moneySchema = z.string().regex(/^\d+(?:\.\d+)?$/);
const countSchema = z.number().int().nonnegative();
const idSchema = z.number().int().nonnegative();
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
});
const reinversionLiquidacionesSchema = z.object({
	contrato_version: z.literal(2),
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
		}),
	),
	comprasMes: z.array(
		z.object({
			tipo: z.enum(reinversionModes),
			cantidad: countSchema,
			monto: moneySchema,
		}),
	),
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
			modalidad: z.enum(reinversionModes),
			monto: moneySchema,
		}),
	),
	detalle_estado: z.discriminatedUnion("disponible", [
		z.object({ disponible: z.literal(true), error: z.null() }),
		z.object({ disponible: z.literal(false), error: z.string().trim().min(1) }),
	]),
	cantidad_liquidaciones: countSchema,
});

export type FlujoPorInversionistaRow = {
	inversionista_id: number;
	nombre: string;
	reinversion_capital: string;
	reinversion_interes: string;
	reinversion_total: string;
	cash_capital: string;
	cash_interes: string;
	cash_total: string;
	total: string;
};

export type FlujoCuotasPorInversionistaResponse = {
	porInversionista: FlujoPorInversionistaRow[];
	totales: {
		reinversion_total: string;
		cash_total: string;
		total: string;
	};
};

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
	fecha?: string;
	alcance?: "live" | "historico";
	dataDisponibleDesde?: string;
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
	 */
	private async request<T>(
		endpoint: string,
		options: RequestInit = {},
		useCache = false,
		timeoutMs?: number,
		retryOnFailure?: boolean,
		/**
		 * `false` = esta llamada ni abre ni consulta el circuit breaker
		 * compartido. SOLO para lecturas opcionales cuyo fallo ya se traga el
		 * caller: cinco fallos de un adorno no pueden dejar 60 segundos sin
		 * cartera a las llamadas que sí importan.
		 */
		usarCircuitBreaker = true,
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
			return {
				...options,
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${token}`,
					...options.headers,
				},
				signal: AbortSignal.timeout(timeoutMs ?? this.config.timeout),
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
				const ejecutar = usarCircuitBreaker
					? <R>(fn: () => Promise<R>) => this.circuitBreaker.execute(fn)
					: <R>(fn: () => Promise<R>) => fn();
				const response = await ejecutar(async () => {
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

						// ⚠️ Un 404 SIN `codigo` y con `error: "NOT_FOUND"` no es un dato
						// que no existe: es **la ruta** que no existe.
						//
						// Es el 404 por defecto de Elysia (`NotFoundError`), así que
						// significa que la instancia de cartera-back del otro lado no
						// tiene ese endpoint — típicamente porque está construida desde
						// una rama que no lo trae. Sin este mensaje, el error que llega
						// es `HTTP 404: NOT_FOUND` sin decir siquiera qué se pidió, y
						// diagnosticarlo cuesta media hora de leer logs.
						if (rutaInexistente(res.status, errorData)) {
							const detalle = `cartera-back no tiene la ruta ${endpoint.split("?")[0]} (404 NOT_FOUND de Elysia). La instancia en ${this.config.baseUrl} está construida desde una rama que no incluye ese endpoint.`;
							console.error(`[CarteraBackClient] ${detalle}`);
							throw new CarteraBackHttpError(detalle, res.status, errorData);
						}

						throw new CarteraBackHttpError(
							`HTTP ${res.status}: ${errorData.error || errorData.message || errorText}`,
							res.status,
							errorData,
						);
					}

					return res;
				});

				const data = (await response.json()) as T;

				// Cache successful GET requests
				if (useCache && this.config.enableCache && options.method === "GET") {
					this.cache.set(cacheKey, data);
				}

				return data;
			} catch (error) {
				lastError = error as Error;

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

	/**
	 * Resumen liviano del crédito, para el bot de WhatsApp.
	 *
	 * `getCredito` devuelve el calendario completo —~56 KB medidos, 14 consultas
	 * en cartera— y el bot necesita siete datos. Este endpoint responde 421
	 * bytes con las mismas reglas de negocio (capital activo, cuotas atrasadas)
	 * calculadas del lado de cartera, que es donde viven.
	 *
	 * **No se cachea**: son cifras que cambian con cada pago. Ver abajo.
	 */
	async getResumenCredito(
		numeroSifco: string,
	): Promise<ResumenCreditoResponse | null> {
		try {
			return await this.request<ResumenCreditoResponse>(
				`/credito/resumen?numero_credito_sifco=${encodeURIComponent(numeroSifco)}`,
				{ method: "GET" },
				// SIN caché, a diferencia de `getCredito`. Acá viajan saldo, mora,
				// estado y convenio: si el cliente paga y vuelve a abrir el menú, el
				// caché de 5 min le seguiría mostrando el saldo anterior y diciéndole
				// que tiene cuotas atrasadas. Un pago hecho en cartera no invalida un
				// caché que vive en el CRM (Codex, PR #1326).
				false,
			);
		} catch (error) {
			// Mismo criterio que `getEstadoCuentaUrl`: se exige el código, no basta
			// el 404. Así un problema de despliegue o de ruteo no se disfraza de
			// "este crédito no está en cartera".
			if (
				error instanceof CarteraBackHttpError &&
				error.status === 404 &&
				error.payload.codigo === "CREDITO_NO_ENCONTRADO"
			) {
				return null;
			}
			throw error;
		}
	}

	/**
	 * Contacto del asesor para mensajes complementarios. Es información opcional:
	 * no puede reintentar ni participar del breaker que protege operaciones de
	 * cartera que sí bloquean el flujo.
	 */
	async getAsesorCredito(
		numeroSifco: string,
	): Promise<ResumenCreditoResponse["asesor"]> {
		try {
			const resumen = await this.request<Pick<ResumenCreditoResponse, "asesor">>(
				`/credito/resumen?numero_credito_sifco=${encodeURIComponent(numeroSifco)}`,
				{ method: "GET" },
				false,
				5_000,
				false,
				false,
			);
			return resumen?.asesor ?? null;
		} catch (error) {
			console.warn("[CarteraBackClient] getAsesorCredito:", error);
			return null;
		}
	}

	/**
	 * Cuánto le falta a una cuota, contando los abonos parciales que ya tiene.
	 *
	 * `/credito/resumen` dice cuál es la cuota que toca y cuánto vale, pero no
	 * si ya le abonaron la mitad. Sin esto, el bot le diría a un cliente que su
	 * boleta de Q3,000 no cubre una cuota de Q6,000 que en realidad ya está
	 * pagada a medias.
	 *
	 * Devuelve `null` si cartera no pudo responder: es un dato para adornar el
	 * mensaje, no para bloquear el flujo.
	 */
	async getSaldoCuota(
		numeroSifco: string,
		numeroCuota: number,
	): Promise<string | null> {
		try {
			const respuesta = await this.request<{
				success: boolean;
				saldo_pendiente?: string | number;
			}>(
				`/abonos-cuota/${encodeURIComponent(numeroSifco)}/${numeroCuota}`,
				{ method: "GET" },
				false,
				// Timeout corto y SIN reintentos, y no es una optimización: esta
				// consulta corre con la boleta ya reservada y la imagen ya subida.
				// Con la configuración por defecto —cuatro intentos de 30 s más
				// backoff— una caída de cartera estiraría `/boleta/leer` más allá de
				// los 2 minutos en que una reserva se da por muerta, y un reintento
				// del integrador barrería la fila viva de esta misma petición.
				//
				// Es un dato para adornar el mensaje: si no está, se sigue sin él.
				5_000,
				false,
				// Fuera del circuit breaker compartido: cinco boletas seguidas con
				// este adorno fallando abrían el breaker 60 s y tumbaban también
				// getResumenCredito y todo lo demás que sí bloquea el flujo.
				false,
			);

			if (!respuesta?.success || respuesta.saldo_pendiente === undefined) {
				return null;
			}

			return String(respuesta.saldo_pendiente);
		} catch (error) {
			console.error("[CarteraBackClient] getSaldoCuota:", error);
			return null;
		}
	}

	/**
	 * Registra un pago en cartera. **Es el que mueve dinero.**
	 *
	 * ─────────────────────────────────────────────────────────────────────────
	 * NO SE REINTENTA. NUNCA.
	 *
	 * `insertPayment` no es transaccional: un timeout puede significar que el
	 * pago se escribió igual, entero o a medias. Un reintento automático crea un
	 * SEGUNDO pago real, y el control de duplicados de cartera no lo frena —solo
	 * corre cuando vienen `numeroAutorizacion` y `banco_id` a la vez, y hay
	 * boletas que no traen autorización—.
	 *
	 * Por eso, ante un timeout, este método **falla** y quien lo llamó tiene que
	 * ir a preguntar qué pasó (`getPagosPorBoleta`), que es exactamente lo que
	 * hace el job de reconciliación del bot.
	 * ─────────────────────────────────────────────────────────────────────────
	 *
	 * Contrato: docs/features/bot-whatsapp-cobros/04-validacion-de-boleta.md §5
	 */
	async registrarPago(
		pago: RegistrarPagoInput,
	): Promise<RegistrarPagoResultado> {
		try {
			const respuesta = await this.request<{
				success?: boolean;
				message?: string;
				detalle?: Record<string, unknown>;
			}>(
				"/newPayment",
				{ method: "POST", body: JSON.stringify(pago) },
				false,
				undefined,
				// Explícito, aunque el default de los POST ya sea `false`: acá el
				// reintento no es "una llamada de más", es un pago de más.
				false,
			);

			return {
				ok: true,
				detalle: respuesta?.detalle ?? null,
			};
		} catch (error) {
			if (error instanceof CarteraBackHttpError) {
				const mensaje = error.payload.message ?? error.message;

				// Un 4xx sí es un "no" definitivo: TODAS las validaciones de
				// `insertPayment` que devuelven 400/404/409 —schema, crédito
				// inexistente, boleta duplicada, cuota ya cubierta— corren antes de
				// la primera escritura. El pago no existe y quien llamó puede dejar
				// todo como estaba.
				if (esRechazoDefinitivo(error.status)) {
					return {
						ok: false,
						motivo: "rechazado",
						status: error.status,
						mensaje,
					};
				}

				// Un 5xx NO. `insertPayment` termina en un catch que responde 500
				// ante CUALQUIER excepción del procesamiento, y como no es
				// transaccional puede haber escrito una parte del pago antes de
				// reventar. Tratarlo como rechazo devolvía el borrador a `leida` y
				// habilitaba una segunda confirmación: un pago real de más, que es
				// justo lo que este archivo dice en mayúsculas que no puede pasar.
				console.error(
					`[CarteraBackClient] registrarPago devolvió ${error.status}; el pago puede haber quedado escrito a medias:`,
					mensaje,
				);
				return {
					ok: false,
					motivo: "sin_respuesta",
					status: error.status,
					mensaje,
				};
			}

			// Cartera no contestó. Acá tampoco se sabe si el pago existe, y esa
			// duda es todo el diseño de §4.1: el borrador se queda en
			// `confirmando` y lo resuelve la reconciliación.
			console.error("[CarteraBackClient] registrarPago sin respuesta:", error);
			return { ok: false, motivo: "sin_respuesta" };
		}
	}

	/**
	 * Qué pasó con una boleta, buscándola por su key de R2.
	 *
	 * Es el puente de emergencia cuando `registrarPago` no contestó: la key es
	 * única y quedó guardada del lado de cartera, en la tabla `boletas`.
	 *
	 * Devuelve también las **reversiones** que mencionan esa URL, y sin eso la
	 * respuesta sería ambigua: `reversePayment` borra las filas de `boletas`, así
	 * que "no encuentro nada" puede ser "no se registró" o "se registró y ya lo
	 * rechazaron" (D-36).
	 */
	async getPagosPorBoleta(
		r2Key: string,
		creditoId?: number,
	): Promise<PagosPorBoletaResponse | null> {
		try {
			// Con el crédito, cartera contesta además si hay un pago suyo
			// ejecutándose ahora mismo. Sin ese dato, "no encontré filas" no
			// alcanza para reabrir nada.
			const credito = creditoId === undefined ? "" : `&credito_id=${creditoId}`;

			return await this.request<PagosPorBoletaResponse>(
				`/pagos-por-boleta?url=${encodeURIComponent(r2Key)}${credito}`,
				{ method: "GET" },
				false,
			);
		} catch (error) {
			console.error("[CarteraBackClient] getPagosPorBoleta:", error);
			return null;
		}
	}



	/**
	 * Genera el estado de cuenta del crédito y devuelve su URL.
	 *
	 * Es el mismo documento que descarga el botón "Descargar Estado de Cuenta"
	 * de carteraFront: `/paymentByCredit?excel=true`.
	 *
	 * **Ojo con los nombres:** el parámetro se llama `excel` y el campo de la
	 * respuesta `excelUrl`, pero lo que devuelve es un **PDF** — cartera lo
	 * arma con Puppeteer y lo sube a R2 como `estado_cuenta_*.pdf` con
	 * `ContentType: application/pdf`. Los nombres quedaron de cuando sí era una
	 * hoja de cálculo.
	 *
	 * Genera el documento en cada llamada (Puppeteer + subida a R2), así que
	 * **no se cachea del lado del CRM pero tampoco conviene llamarlo de más**.
	 *
	 * **Sin reintentos**, aunque sea un GET: cada intento arranca un Puppeteer y
	 * sube un archivo nuevo con su timestamp. Un timeout después de que cartera
	 * empezó a trabajar dejaría hasta cuatro PDF idénticos huérfanos en R2, con
	 * su carga de navegador (Codex, PR #1328).
	 *
	 * Los dos motivos por los que puede no haber documento —el crédito no tiene
	 * movimientos, o no está en cartera— se devuelven **por separado**: para el
	 * cliente significan cosas opuestas y el bot les da mensajes distintos.
	 */
	async getEstadoCuentaUrl(
		numeroSifco: string,
	): Promise<
		| { ok: true; url: string }
		| { ok: false; motivo: "SIN_MOVIMIENTOS" | "CREDITO_NO_ESTA_EN_CARTERA" }
	> {
		try {
			const response = await this.request<{ excelUrl?: string }>(
				`/paymentByCredit?numero_credito_sifco=${encodeURIComponent(numeroSifco)}&excel=true`,
				{ method: "GET" },
				false,
				// Generar el PDF toma ~3.4 s medidos; el default del cliente se
				// queda corto cuando cartera está cargada.
				60000,
				// No reintentar: ver arriba.
				false,
			);

			// Sin `excelUrl` no hay nada que entregar, y cartera no dijo por qué:
			// se trata como falta de datos y no como un documento vacío.
			if (!response?.excelUrl) {
				return { ok: false, motivo: "CREDITO_NO_ESTA_EN_CARTERA" };
			}

			return { ok: true, url: response.excelUrl };
		} catch (error) {
			// Solo los 404 que cartera MARCA con su código son casos de negocio. Un
			// 404 pelado puede ser la ruta que todavía no existe en un deploy
			// rodante o un proxy respondiendo por su cuenta: eso es una falla y
			// debe subir, no convertirse en un "no tenés movimientos" que el
			// cliente leería como cierto (Codex, PR #1328).
			if (error instanceof CarteraBackHttpError && error.status === 404) {
				if (error.payload.codigo === "SIN_MOVIMIENTOS") {
					return { ok: false, motivo: "SIN_MOVIMIENTOS" };
				}

				if (error.payload.codigo === "CREDITO_NO_ENCONTRADO") {
					return { ok: false, motivo: "CREDITO_NO_ESTA_EN_CARTERA" };
				}
			}

			throw error;
		}
	}

	async getCredito(
		numeroSifco: string,
		useCache = true,
	): Promise<CreditoDirectoResponse> {
		// El endpoint /credito NO usa el wrapper CarteraBackApiResponse
		// Retorna los datos directamente
		//
		// CB-128: el flujo de "Registrar pago" (getCreditoParaPago,
		// registrarPagoCompleto) pasa useCache=false a propósito — mora, cuotas
		// atrasadas y saldo a favor tienen que ser el dato real en el momento de
		// cobrar, no una copia de hasta 5 min de vieja. El resto de callers (listas,
		// reportes, jobs) sigue cacheando por default: son de alto volumen y no
		// necesitan precisión al segundo.
		const response = await this.request<CreditoDirectoResponse>(
			`/credito?numero_credito_sifco=${encodeURIComponent(numeroSifco)}`,
			{ method: "GET" },
			useCache,
		);
		// Antes acá se hacía JSON.stringify(response, null, 2) del response
		// COMPLETO: ~120 KB indentados escritos al log en cada llamada no
		// cacheada, solo para depurar. Se deja el número de crédito.
		console.log(`[CarteraBackClient] getCredito OK: ${numeroSifco}`);
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
						...(params.cuotas_min !== undefined && {
							cuotas_min: params.cuotas_min,
						}),
						...(params.cuotas_max !== undefined && {
							cuotas_max: params.cuotas_max,
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
				...(params.cuotas_min !== undefined && {
					cuotas_min: params.cuotas_min.toString(),
				}),
				...(params.cuotas_max !== undefined && {
					cuotas_max: params.cuotas_max.toString(),
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
				true,
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

	// CB-128: /newPayment NO tiene un shape de respuesta uniforme — se
	// confirmó leyendo cartera-back/src/controllers/registerPayment.ts
	// completo. Tres formas distintas, todas con HTTP 2xx (this.request ya
	// lanza si el status no es 2xx, así que llegar acá siempre es éxito HTTP):
	//   1. Pago normal: {success: true, message, detalle, resumen} — sin pago_id.
	//   2. Abono directo a capital: {success: true, message, pago: {pago_id, ...}}.
	//   3. Informativo sin cerrar nada (mora parcial insuficiente, saldo a
	//      favor, etc.): {message, pagos: [], saldo_a_favor} — SIN `success`
	//      en absoluto. Un `!response.success` acá lo trataba como error y
	//      reventaba con "Error registrando pago" cuando en realidad
	//      cartera-back sí guardó el registro (mismo comportamiento que
	//      carteraFront, que muestra este mismo mensaje como notificación de
	//      éxito, no como error — confirmado contra la DB de dev).
	// `success` se toma como true salvo que el body diga explícitamente false.
	// El caso 3 (soloInformativo) ya no ocurre con el registerPayment.ts actual
	// de cartera-back — todos sus returns mandan `success` explícito desde el
	// fix de CB-128. Se deja el fallback a propósito: crm-server y cartera-back
	// son deploys separados, y una versión más vieja de cartera-back (rollback,
	// despliegue a medias) puede volver a mandar la respuesta sin `success`.
	async createPago(input: CreatePagoInput): Promise<{
		success: boolean;
		message?: string;
		pago_id?: number;
		/** true cuando cartera-back respondió sin pago_id/success explícito — informativo (ej. mora parcial), no error. */
		soloInformativo: boolean;
	}> {
		// CB-128: el patrón `credito:${sifco}` nunca hizo match — la key real de
		// getCredito es `GET:<baseUrl>/credito?numero_credito_sifco=<sifco>:{}`,
		// sin ese prefijo `credito:` en ningún lado. invalidate() nunca borraba
		// nada y el modal reabierto en <5min veía mora/cuota vieja. El SIFCO
		// solo (sin prefijo) sí aparece dentro de la URL real.
		this.cache.invalidate(input.credito_numero_sifco);
		// CB-128: "pagos" nunca hizo match — la URL real es /paymentByCredit
		// (getPagosByCredito), sin la palabra "pagos". El fallback que resuelve
		// pago_id vía getPagosByCredito (cuando /newPayment no lo trae inline,
		// ej. mora parcial) leía una respuesta vieja cacheada y no encontraba el
		// pago recién creado. invalidate() matchea por substring simple
		// (key.includes(pattern)) — "paymentByCredit" sí aparece en esa URL.
		this.cache.invalidate("paymentByCredit");
		// credito_numero_sifco NO es parte de pagoSchema en cartera-back (que
		// exige credito_id numérico) — viaja en el input solo para poder
		// invalidar la cache por SIFCO arriba, y se descarta del body real.
		const { credito_numero_sifco: _sifco, ...body } = input;
		const response = await this.request<{
			success?: boolean;
			message?: string;
			pago?: { pago_id: number };
			pago_id?: number;
		}>("/newPayment", {
			method: "POST",
			body: JSON.stringify(body),
		});
		return {
			success: response.success ?? true,
			message: response.message,
			pago_id: response.pago_id ?? response.pago?.pago_id,
			soloInformativo: response.success === undefined,
		};
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

	// CB-128: abonos parciales ya hechos a una cuota puntual — el form
	// "registrar pago" de la Ficha 360 lo usa para el mismo cálculo de
	// excedente que ya hace carteraFront (registerPayment.ts). Endpoint sin
	// wrapper CarteraBackApiResponse, igual que /credito.
	async getAbonosCuota(
		numeroSifco: string,
		numeroCuota: number,
	): Promise<AbonosCuotaResponse> {
		const response = await this.request<AbonosCuotaResponse>(
			`/abonos-cuota/${encodeURIComponent(numeroSifco)}/${numeroCuota}`,
			{ method: "GET" },
		);
		return response;
	}

	// CB-128: promesa de pago vigente de un crédito (o null) — mismo endpoint
	// de solo lectura que ya consume carteraFront para el aviso "Promesa
	// Pago: fecha" en el detalle del crédito.
	async getPromesaActivaPorCredito(
		creditoId: number,
	): Promise<PromesaActivaCredito | null> {
		const response = await this.request<{
			success: boolean;
			data: PromesaActivaCredito | null;
		}>(`/promesas-pago/activa/${creditoId}`, { method: "GET" });
		return response.data ?? null;
	}

	async getPagosByCredito(
		numeroSifco: string,
		useCache = true,
	): Promise<CarteraPagoCredito[]> {
		// CB-128: /paymentByCredit devuelve un array DIRECTO (`return pagos;` en
		// cartera-back/src/routers/payments.ts:95, no envuelto en
		// CarteraBackApiResponse<T>), y cada elemento va anidado como
		// {pago: {...}, inversionistasData: [...], pagosInversionistas: [...]}
		// — confirmado con curl real contra /paymentByCredit. El shape plano
		// que este método asumía (CarteraPagoCredito directo) nunca coincidió,
		// así que `response.data` daba undefined y el fallback de pago_id en
		// createPago nunca encontraba nada. El endpoint responde 404 (no 200
		// con []) si el crédito no tiene pagos — se trata como lista vacía.
		//
		// CB-128 (fix): useCache=false es obligatorio para quien resuelve un
		// pago recién creado (registrarPagoCompleto/resolverPagoRecienCreado)
		// — con cache activado (CARTERA_BACK_ENABLE_CACHE=true) y lag de
		// replicación en cartera-back, el primer intento post-pago podía
		// cachear una respuesta que TODAVÍA no incluye la fila nueva, y el
		// retry de 1.5s pegaba contra esa MISMA respuesta cacheada (hasta 5
		// min de TTL) en vez de volver a consultar — el fallback de pago_id
		// fallaba sistemáticamente aunque el dinero ya se hubiera movido.
		try {
			const response = await this.request<
				Array<{
					pago: CarteraPagoCredito;
					pagosInversionistas?: CarteraPagoCreditoInversionista[];
				}>
			>(
				`/paymentByCredit?numero_credito_sifco=${encodeURIComponent(numeroSifco)}&excel=false`,
				{ method: "GET" },
				useCache,
			);
			// CB-128 (fix): la distribución a inversionistas viene en la
			// propiedad EXTERNA `pagosInversionistas` de cada fila, no anidada
			// dentro de `pago` — un aplanado que solo copiaba `fila.pago`
			// descartaba esta distribución en silencio, y
			// getHistorialPagosCarteraBack (que espera
			// pago.pagos_inversionistas) siempre veía `undefined` ahí.
			return Array.isArray(response)
				? response
						.filter((fila) => fila.pago)
						.map((fila) => ({
							...fila.pago,
							pagos_inversionistas: fila.pagosInversionistas,
						}))
				: [];
		} catch (error) {
			// CB-128 (fix): un 404 por status solo no basta — rutaInexistente()
			// ya existe justo para distinguir el 404 de negocio real (crédito
			// sin pagos, con `codigo` presente) del 404 de infraestructura que
			// Elysia devuelve cuando la ruta no está registrada en este deploy
			// de cartera-back (rollback, rama sin el endpoint). Tratar CUALQUIER
			// 404 como "sin pagos" hacía que un deploy desalineado anulara en
			// silencio el guard de duplicados y el snapshot de pagoIdMaximoPrevio
			// (que dependen de esta lista): con "sin pagos" siempre, ningún
			// duplicado se detecta nunca, y el snapshot es siempre 0.
			if (
				error instanceof CarteraBackHttpError &&
				error.status === 404 &&
				!rutaInexistente(error.status, error.payload)
			) {
				return [];
			}
			throw error;
		}
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
	// BUCKETS DE MORA (catálogo dinámico B0-B5)
	// ========================================================================

	async getBucketsCatalogo(): Promise<CarteraBucketCatalogo[]> {
		const response = await this.request<{
			success: boolean;
			data: CarteraBucketCatalogo[];
		}>("/config/buckets", { method: "GET" }, true);
		return response.data ?? [];
	}

	/**
	 * Histórico de migraciones de bucket (motor COBROS-02), paginado con
	 * filtros y resumen. Sin cache: el job puede correrse manual y la vista
	 * de auditoría debe reflejarlo al instante.
	 */
	async getBucketsHistorial(
		params: GetBucketsHistorialParams = {},
	): Promise<CarteraBucketsHistorialResponse> {
		const queryParams = new URLSearchParams({
			...(params.desde && { desde: params.desde }),
			...(params.hasta && { hasta: params.hasta }),
			...(params.tipo_evento && { tipo_evento: params.tipo_evento }),
			...(params.bucket_nuevo && { bucket_nuevo: params.bucket_nuevo }),
			...(params.numero_credito_sifco && {
				numero_credito_sifco: params.numero_credito_sifco,
			}),
			...(params.nombre_usuario && { nombre_usuario: params.nombre_usuario }),
			...(params.page && { page: params.page.toString() }),
			...(params.pageSize && { pageSize: params.pageSize.toString() }),
		});
		return this.request<CarteraBucketsHistorialResponse>(
			`/buckets/historial?${queryParams}`,
			{ method: "GET" },
		);
	}

	/** Drill-down: historial completo de migraciones de UN crédito (la "ficha"). */
	async getBucketsHistorialCredito(
		creditoId: number,
	): Promise<CarteraBucketHistorialEvento[]> {
		const response = await this.request<{
			success: boolean;
			data: CarteraBucketHistorialEvento[];
		}>(`/buckets/historial/credito/${creditoId}`, { method: "GET" });
		return response.data ?? [];
	}

	/**
	 * Bucket ACTUAL de un crédito (motor COBROS-02) por número SIFCO. Sin
	 * cache a propósito: getCredito() sí cachea 5 min y este badge debe
	 * reflejar el motor al instante (mismo criterio que getBucketsHistorial).
	 */
	async getBucketActualCredito(
		numeroSifco: string,
	): Promise<CarteraBucketActualCredito | null> {
		const response = await this.request<{
			success: boolean;
			data: CarteraBucketActualCredito;
		}>(`/buckets/credito/${encodeURIComponent(numeroSifco)}`, {
			method: "GET",
		});
		return response?.data ?? null;
	}

	/**
	 * Premora (CC2-11): cuotas pendientes de créditos AL DÍA que vencen en
	 * exactamente N días (día GT). Sin cache: lo consume el job diario de
	 * recordatorios y debe ver el estado real de pagos del momento.
	 */
	async getCuotasProximasVencer(
		dias: number[] = [5, 3, 1, 0],
		opts: {
			soloAlDia?: boolean;
			buckets?: number[];
			asesorId?: number;
			page?: number;
			perPage?: number;
		} = {},
	): Promise<CarteraCuotasProximasResponse> {
		const queryParams = new URLSearchParams({ dias: dias.join(",") });
		// Default true (premora, solo B0). false = Agenda del día (todo el funnel).
		if (opts.soloAlDia === false) queryParams.set("solo_al_dia", "false");
		// Filtro por bucket MOTOR (PREMORA_BUCKETS); un crédito sin historial
		// solo cuenta como B0 si está al día en tiempo real.
		if (opts.buckets?.length)
			queryParams.set("buckets", opts.buckets.join(","));
		// Agenda del día: filtro por asesor + paginación (el job de premora no los
		// manda → sin límite). Sin cache: la agenda tiene que reflejar pagos y
		// ajustes de fecha al instante, igual que getBucketsHistorial.
		if (opts.asesorId != null)
			queryParams.set("asesor_id", String(opts.asesorId));
		if (opts.page != null) queryParams.set("page", String(opts.page));
		if (opts.perPage != null) queryParams.set("per_page", String(opts.perPage));
		return this.request<CarteraCuotasProximasResponse>(
			`/cuotas/proximas-vencer?${queryParams}`,
			{ method: "GET" },
		);
	}

	// COBROS-02: cuotas de CONVENIO próximas a vencer (créditos EN_CONVENIO). Lo
	// consume el job diario de recordatorios de convenio del CRM. Sin cache: foto
	// del día, debe reflejar los pagos del convenio más recientes.
	async getConvenioProximosVencer(
		dias: number[] = [5, 3, 1, 0],
	): Promise<CarteraConvenioProximosResponse> {
		const queryParams = new URLSearchParams({ dias: dias.join(",") });
		return this.request<CarteraConvenioProximosResponse>(
			`/convenio/proximas-vencer?${queryParams}`,
			{ method: "GET" },
		);
	}

	// CB-010: comportamiento de pago (racha de cuotas al día por crédito). Lo
	// consume el job diario de elegibilidad de la reducción de recordatorios.
	// Sin cache: es una foto que se calcula una vez al día y debe reflejar los
	// pagos más recientes. `sifcos` opcional para recálculo puntual; page/perPage
	// para recorrer toda la cartera de a lotes (fetchAllPages).
	async getComportamientoPago(
		opts: { sifcos?: string[]; page?: number; perPage?: number } = {},
	): Promise<CarteraComportamientoPagoResponse> {
		const qs = new URLSearchParams();
		if (opts.sifcos && opts.sifcos.length > 0)
			qs.set("sifcos", opts.sifcos.join(","));
		if (opts.page != null) qs.set("page", String(opts.page));
		if (opts.perPage != null) qs.set("per_page", String(opts.perPage));
		const suffix = qs.toString() ? `?${qs}` : "";
		return this.request<CarteraComportamientoPagoResponse>(
			`/cuotas/comportamiento-pago${suffix}`,
			{ method: "GET" },
		);
	}

	// Listado de créditos POR BUCKET (motor). Fuente de la tabla de la página
	// /cobros/buckets del CRM. Cada fila trae creditos.asesor_id, asesores
	// (nombre), usuarios (cliente), numero_credito_sifco y el objeto bucket.
	async getCreditosPorBucket(
		params: GetCreditosPorBucketParams,
	): Promise<PaginatedResponse<CreditoBucketResponse>> {
		const queryParams = new URLSearchParams({
			...(params.bucket !== undefined && { bucket: String(params.bucket) }),
			...(params.page && { page: params.page.toString() }),
			...(params.perPage && { perPage: params.perPage.toString() }),
			...(params.numero_credito_sifco && {
				numero_credito_sifco: params.numero_credito_sifco,
			}),
			...(params.nombre_usuario && { nombre_usuario: params.nombre_usuario }),
			...(params.email_asesor && { email_asesor: params.email_asesor }),
			...(params.asesor_id !== undefined && {
				asesor_id: String(params.asesor_id),
			}),
		});
		const response = await this.request<{
			success: boolean;
			data: CreditoBucketResponse[];
			page: number;
			perPage: number;
			totalCount: number;
			totalPages: number;
		}>(`/buckets/creditos?${queryParams}`, { method: "GET" });
		return {
			data: response.data ?? [],
			page: response.page,
			perPage: response.perPage,
			total: response.totalCount,
			totalPages: response.totalPages,
		};
	}

	/**
	 * SIFCOs activos en buckets del pool actual del asesor. Cartera Back resuelve
	 * el último registro de `buckets_historial`: no hay fallback derivado.
	 */
	async getSifcosPoolAutoritativos(
		params: GetSifcosPoolAutoritativosParams,
	): Promise<CarteraSifcosPoolAutoritativosResponse> {
		const queryParams = new URLSearchParams({
			asesor_id: String(params.asesorId),
		});
		const response = await this.request<CarteraSifcosPoolAutoritativosResponse>(
			`/buckets/pool-sifcos?${queryParams}`,
			{ method: "GET" },
			false,
		);
		return response;
	}

	/** Asignación pool→asesor limitada a los SIFCOs de una página del CRM. */
	async getAsignacionesPoolPorSifco(
		params: GetAsignacionesPoolPorSifcoParams,
	): Promise<CarteraAsignacionesPoolPorSifcoResponse> {
		const sifcos = [...new Set(params.sifcos)];
		if (sifcos.length > 25) {
			throw new Error("getAsignacionesPoolPorSifco admite máximo 25 SIFCOs");
		}
		if (sifcos.length === 0) return { data: [] };
		const queryParams = new URLSearchParams({ sifcos: sifcos.join(",") });
		return this.request<CarteraAsignacionesPoolPorSifcoResponse>(
			`/buckets/pool-asignaciones?${queryParams}`,
			{ method: "GET" },
			false,
		);
	}

	// CB-027: listado paginado de convenios de pago (con cliente/SIFCO/asesor
	// vía joins en cartera-back). Fuente de la tabla de la página
	// /cobros/convenios del CRM. Sin cache: el progreso cambia con cada pago.
	async getConveniosListado(
		params: GetConveniosListadoParams = {},
	): Promise<PaginatedResponse<CarteraConvenioListado>> {
		const queryParams = new URLSearchParams({
			...(params.estado && { estado: params.estado }),
			...(params.numeroCreditoSifco && {
				numero_credito_sifco: params.numeroCreditoSifco,
			}),
			...(params.nombreUsuario && { nombre_usuario: params.nombreUsuario }),
			...(params.asesorId !== undefined && {
				asesor_id: String(params.asesorId),
			}),
			...(params.emailAsesor && { email_asesor: params.emailAsesor }),
			...(params.page && { page: params.page.toString() }),
			...(params.perPage && { perPage: params.perPage.toString() }),
		});
		const response = await this.request<{
			success: boolean;
			data: CarteraConvenioListado[];
			page: number;
			perPage: number;
			totalCount: number;
			totalPages: number;
		}>(`/payment-agreements/listado?${queryParams}`, { method: "GET" });
		return {
			data: response.data ?? [],
			page: response.page,
			perPage: response.perPage,
			total: response.totalCount,
			totalPages: response.totalPages,
		};
	}

	// CB-027: plan de pagos (convenio_cuotas) de un convenio puntual — usado
	// como fallback si `cuotasConvenioMensuales` no viene embebido en /credito.
	async getConvenioCuotas(convenioId: number): Promise<CarteraConvenioCuota[]> {
		const response = await this.request<{
			success: boolean;
			data: CarteraConvenioCuota[];
		}>(`/payment-agreements/${convenioId}/cuotas`, { method: "GET" });
		return response.data ?? [];
	}

	// CB-020: universo SLA de la Cola del Día — créditos del POOL de buckets
	// del asesor (asesor_bucket, no el asesor_id individual del crédito) con
	// su fecha_limite_sla. Sin cache: la cola debe reflejar el estado real del
	// bucket/SLA al instante, mismo criterio que sus hermanas de /buckets.
	async getColaDiaSLA(
		params: GetColaDiaSLAParams = {},
	): Promise<CarteraColaDiaResponse> {
		const queryParams = new URLSearchParams({
			...(params.asesorId !== undefined && {
				asesor_id: String(params.asesorId),
			}),
			...(params.buckets?.length && { bucket: params.buckets.join(",") }),
			...(params.page && { page: params.page.toString() }),
			...(params.perPage && { perPage: params.perPage.toString() }),
		});
		return this.request<CarteraColaDiaResponse>(
			`/buckets/cola-dia?${queryParams}`,
			{ method: "GET" },
		);
	}

	async updateBucketsSLA(
		configuraciones: Array<{ bucket: number; dias_sla: number }>,
	): Promise<{ success: boolean; message?: string }> {
		const result = await this.request<{ success: boolean; message?: string }>(
			"/buckets/dias-sla",
			{
				method: "PUT",
				body: JSON.stringify({ configuraciones }),
			},
		);
		this.cache.invalidate("/config/buckets");
		return result;
	}

	// CB-030 — sync de promesas de pago vigentes hacia el espejo local de
	// cartera-back (contactos_cobros vive solo en esta DB del CRM; el job
	// nocturno de mora/bucket de cartera-back necesita su propia copia para
	// congelar cuotas cubiertas por una promesa vigente). Un solo método para
	// dos disparadores: push por evento (array de 1) y la reconciliación
	// diaria (array completo). Best-effort desde el caller: una falla de red
	// no debe tumbar la operación de negocio que disparó el push — el job de
	// reconciliación es la red de seguridad si un push se pierde.
	// `modo` distingue los dos disparadores del lado de cartera-back:
	// "evento" (default) solo hace upsert de las filas del batch;
	// "reconciliacion_completa" ADEMÁS desactiva toda fila activa ausente del
	// batch. Sin ese modo, un push de cumplida/cancelada perdido dejaría el
	// freeze zombie para siempre — por eso el job diario debe mandarlo
	// explícitamente, incluso con un batch vacío (= "hoy no hay ninguna
	// promesa vigente", que es la única forma de limpiar la última).
	async syncPromesasPago(
		promesas: Array<{
			contacto_cobros_id: string;
			numero_credito_sifco: string;
			cuota_inicio: number | null;
			cuota_fin: number | null;
			incluye_mora: boolean;
			fecha_promesa: string;
			activa: boolean;
		}>,
		modo: "evento" | "reconciliacion_completa" = "evento",
	): Promise<{
		success: boolean;
		message?: string;
		actualizadas?: number;
		noEncontradas?: string[];
		fallaTotal?: boolean;
	}> {
		return await this.request<{
			success: boolean;
			message?: string;
			actualizadas?: number;
			noEncontradas?: string[];
			fallaTotal?: boolean;
		}>("/promesas-pago/sync", {
			method: "PUT",
			body: JSON.stringify({ promesas, modo }),
		});
	}

	// CB-018: carga de cuentas por asesor y bucket (dashboard gerencial) —
	// cuentas asignadas, capacidad base, % utilización, sobrecarga y alerta de
	// nueva posición. Fuente de la página /cobros/carga del CRM.
	// Sin cache (mismo criterio que getCreditosPorBucket, su hermana en
	// /cobros/buckets): reasignarAsesor() NO invalida ningún substring que
	// matchee "/buckets/carga" (solo invalida "/credito?", "getAllCredits",
	// "stats", "mora-por-etapa-asesor") — cachear aquí dejaría el dashboard
	// mostrando carga desactualizada hasta 5 min después de una reasignación,
	// justo la pantalla donde gerencia decide en base al efecto de reasignar.
	async getCargaPorAsesorBucket(
		params: GetCargaPorAsesorBucketParams = {},
	): Promise<CargaPorAsesorBucketResponse> {
		const queryParams = new URLSearchParams({
			...(params.bucket !== undefined && { bucket: String(params.bucket) }),
			...(params.asesor_id !== undefined && {
				asesor_id: String(params.asesor_id),
			}),
		});
		const response = await this.request<{
			success: boolean;
			data: CargaPorAsesorBucketResponse;
		}>(`/buckets/carga?${queryParams}`, { method: "GET" });
		return response.data ?? { buckets: [], porAsesor: [], fecha: "" };
	}

	// CB-023: apertura matutina del supervisor (cuentas nuevas por bucket,
	// cumplimiento del día anterior, top 3 por bucket). Sin cache, misma razón
	// que getCargaPorAsesorBucket: es una pantalla de decisión operativa donde
	// la data desactualizada engaña; una reasignación tampoco invalida ningún
	// substring que matchee "/buckets/apertura".
	async getAperturaDia(
		params: { fecha?: string } = {},
	): Promise<AperturaDiaResponse> {
		const queryParams = new URLSearchParams(
			params.fecha ? { fecha: params.fecha } : {},
		);
		const qs = queryParams.toString();
		const response = await this.request<{
			success: boolean;
			data: AperturaDiaResponse;
		}>(`/buckets/apertura${qs ? `?${qs}` : ""}`, { method: "GET" });
		return (
			response.data ?? {
				// Sin `fecha` el caller pidió HOY, así que el fallback tiene que
				// resolverlo igual que el controller (día GT) — un string vacío
				// dejaría la vista sin fecha en el encabezado.
				fecha:
					params.fecha ??
					new Date().toLocaleDateString("sv-SE", {
						timeZone: "America/Guatemala",
					}),
				cuentas_nuevas: [],
				cumplimiento: {
					fecha: "",
					cuentas_esperadas: 0,
					cuentas_pagadas: 0,
					pct: 0,
					monto_esperado: 0,
					monto_pagado: 0,
				},
				top3: [],
				asignacion: [],
				movimientos: [],
			}
		);
	}

	// CB-019: escritura de capacidad_base/margen_alerta por asesor+bucket (antes
	// solo editable a mano por SQL). Sin cache que invalidar aquí (getCargaPorAsesorBucket
	// ya es sin cache — ver comentario arriba); el caller invalida su propia query.
	async actualizarCapacidadAsesorBucket(input: {
		asesor_id: number;
		bucket: number;
		capacidad_base: number;
		margen_alerta_tipo: "porcentaje" | "fijo";
		margen_alerta_valor: number;
	}): Promise<{ success: boolean; message?: string }> {
		const response = await this.request<{
			success: boolean;
			message?: string;
		}>(`/buckets/asesor-bucket/${input.asesor_id}/${input.bucket}`, {
			method: "PATCH",
			body: JSON.stringify({
				capacidad_base: input.capacidad_base,
				margen_alerta_tipo: input.margen_alerta_tipo,
				margen_alerta_valor: input.margen_alerta_valor,
			}),
		});
		return response;
	}

	// Pool de asesores elegibles de un bucket (alimenta el dropdown del modal).
	async getPoolAsesoresPorBucket(
		bucket: number,
	): Promise<{ asesor_id: number; nombre: string }[]> {
		const response = await this.request<{
			success: boolean;
			data: { asesor_id: number; nombre: string }[];
		}>(`/buckets/pool/${bucket}`, { method: "GET" }, true);
		return response.data ?? [];
	}

	// Catálogo COMPLETO de asesores con sus buckets activos del pool, sin pasar
	// por creditos (no depende de que el asesor tenga cuentas activas ahora
	// mismo). Trae `email_cash_in` para cruzar contra `user.email` del CRM sin
	// depender del `email` de getAdvisors (desactualizado para varios
	// asesores).
	async getPoolPorAsesor(options?: {
		useCache?: boolean;
		/**
		 * `false` para llamadas best-effort (p.ej. resolver a quién notificar)
		 * cuyo fallo ya se traga el caller — no debe compartir contador de
		 * fallos con las operaciones que sí importan (ver comentario de
		 * `usarCircuitBreaker` en `request`).
		 */
		useCircuitBreaker?: boolean;
	}): Promise<PoolPorAsesorRow[]> {
		const response = await this.request<{
			success: boolean;
			data: PoolPorAsesorRow[];
		}>(
			"/buckets/pool-por-asesor",
			{ method: "GET" },
			options?.useCache ?? true,
			undefined,
			undefined,
			options?.useCircuitBreaker ?? true,
		);
		return response.data ?? [];
	}

	// Reasignación MANUAL del asesor de un crédito (supervisor/gerente). El
	// usuario_email es el del supervisor real (el token es cuenta de servicio),
	// para que la bitácora API_MANUAL registre quién lo hizo.
	async reasignarAsesor(input: {
		credito_id: number;
		asesor_nuevo_id: number;
		motivo: string;
		usuario_email?: string;
	}): Promise<{
		success: boolean;
		credito_id: number;
		asesor_anterior: number | null;
		asesor_nuevo: number;
		bucket: number;
	}> {
		// Invalidar lecturas cacheadas que muestran asesor_id, tras mutarlo
		// (review Codex #1102). Substrings que SÍ matchean la cache key real
		// (`GET:${url}:${body}`): getCredito → "/credito?", getAllCreditos →
		// "getAllCredits", getStats → "stats", getMoraByEtapaYAsesor (agrupa
		// por asesor_id, review Codex) → "mora-por-etapa-asesor". (Nota: el
		// patrón `credito:${id}` usado en updateCredito/creditAction NO matchea
		// nada — bug preexistente fuera de alcance de este fix puntual.)
		this.cache.invalidate("/credito?");
		this.cache.invalidate("getAllCredits");
		this.cache.invalidate("stats");
		this.cache.invalidate("mora-por-etapa-asesor");
		const result = await this.request<{
			success: boolean;
			credito_id: number;
			asesor_anterior: number | null;
			asesor_nuevo: number;
			bucket: number;
		}>(`/buckets/creditos/${input.credito_id}/reasignar`, {
			method: "POST",
			body: JSON.stringify({
				asesor_nuevo_id: input.asesor_nuevo_id,
				motivo: input.motivo,
				...(input.usuario_email && { usuario_email: input.usuario_email }),
			}),
		});
		return result;
	}

	// Bitácora de cambios de asesor (credito_asesor_historial) — auditoría de
	// reasignaciones manuales (API_MANUAL) y automáticas (PROCESO_AUTO).
	async getAsesorHistorial(
		params: GetAsesorHistorialParams,
	): Promise<AsesorHistorialResponse> {
		const queryParams = new URLSearchParams({
			...(params.desde && { desde: params.desde }),
			...(params.hasta && { hasta: params.hasta }),
			...(params.origen && { origen: params.origen }),
			...(params.bucket && { bucket: params.bucket }),
			...(params.asesor_nuevo && { asesor_nuevo: params.asesor_nuevo }),
			...(params.numero_credito_sifco && {
				numero_credito_sifco: params.numero_credito_sifco,
			}),
			...(params.nombre_usuario && { nombre_usuario: params.nombre_usuario }),
			...(params.credito_id !== undefined && {
				credito_id: params.credito_id.toString(),
			}),
			...(params.page && { page: params.page.toString() }),
			...(params.pageSize && { pageSize: params.pageSize.toString() }),
		});
		return this.request<AsesorHistorialResponse>(
			`/buckets/asesores-historial?${queryParams}`,
			{ method: "GET" },
		);
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

		// El endpoint /advisor no retorna metadata de paginación; se infiere
		// si hay más páginas según si la página actual vino completa.
		const page = params.page || 1;
		const perPage = params.perPage || 20;
		const hayMasPaginas = response.length === perPage;

		return {
			data: response,
			page,
			perPage,
			total: (page - 1) * perPage + response.length,
			totalPages: hayMasPaginas ? page + 1 : page,
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

	/**
	 * Borra de R2 el archivo de una boleta del bot que nunca llegó a ser pago.
	 *
	 * Cartera se niega (409) si la llave respalda un pago registrado, así que
	 * llamarlo de más es seguro. Devuelve `true` solo cuando el archivo ya no
	 * existe del otro lado (borrado ahora, o 409 = no era nuestro para borrar:
	 * en ese caso la fila del CRM tampoco debe purgarse — devuelve `false`).
	 */
	async deleteArchivoBoletaHuerfano(r2Key: string): Promise<boolean> {
		try {
			await this.request(
				`/upload/boleta-huerfana?key=${encodeURIComponent(r2Key)}`,
				{ method: "DELETE" },
				false,
				10_000,
				false,
			);
			return true;
		} catch (error) {
			console.error(
				`[CarteraBackClient] deleteArchivoBoletaHuerfano ${r2Key}:`,
				error,
			);
			return false;
		}
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
	}): Promise<{
		message: string;
		data: { inversionista_id: number; nombre: string; [key: string]: any }[];
	}> {
		const response = await this.request<{
			message: string;
			data: { inversionista_id: number; nombre: string; [key: string]: any }[];
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
		return this.request<FlujoCuotasPorInversionistaResponse>(
			`/reportes/flujo-cuotas-inversiones/por-inversionista?${qp}`,
			{ method: "GET" },
			true,
		);
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
