/**
 * Cartera-Back API Client
 * Type-safe HTTP client with retry logic, circuit breaker, and caching
 */

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
import {
	getCarteraAccessToken,
	invalidateAndReauth,
} from "./cartera-auth.service";

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
}

export interface ResumenGlobalInversionistasFilters {
	inversionistaId?: string | number;
	estado?: "pending" | "uploaded" | "liquidated" | "all";
	mes?: number;
	anio?: number;
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
};

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
	capital: string;
	interes: string;
	membresias: string;
	seguro_gps: string;
	royalti: string;
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
	/**
	 * Por modalidad (`tipo_reinversion`), campos crudos de la liquidación:
	 * - `reinversion_total` → sección "Cuotas → Reinversión".
	 * - `total_capital` / `total_interes` / `total_iva` / `total_isr` / `total_cuota`
	 *   → sección "Cuotas → A Recibir".
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
		}
	>;
	/**
	 * Interés neto agrupado por si el inversionista emite factura:
	 * - `conFactura`: neto = interés + IVA.
	 * - `sinFactura`: neto = interés − ISR.
	 */
	interesNeto: {
		conFactura: { interes: string; iva: string; neto: string };
		sinFactura: { interes: string; isr: string; neto: string };
		cube: { interes: string };
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
		monto_aportado: string;
	}[];
	/** Compras del mes (operación de compra) agrupadas por modalidad de reinversión. */
	comprasMes: { tipo: string; cantidad: number; monto: string }[];
	cantidad_liquidaciones: number;
};

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
	porAsesor: ({ asesorId: number; nombre: string; email: string } & MoraTotales)[];
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

	private async request<T>(
		endpoint: string,
		options: RequestInit = {},
		useCache = false,
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
				: await getCarteraAccessToken();
			return {
				...options,
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${token}`,
					...options.headers,
				},
				signal: AbortSignal.timeout(this.config.timeout),
			};
		};

		let lastError: Error | null = null;
		let didReauth = false;

		for (let attempt = 0; attempt <= this.config.retryAttempts; attempt++) {
			try {
				const response = await this.circuitBreaker.execute(async () => {
					const requestOptions = await buildRequestOptions();
					const res = await fetch(url, requestOptions);

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
								const retryRes = await fetch(url, retryOptions);
								if (retryRes.ok) return retryRes;
								const retryText = await retryRes.text();
								let retryData: { error?: string; message?: string } = {};
								try {
									retryData = JSON.parse(retryText);
								} catch {
									retryData = { error: retryText };
								}
								throw new Error(
									`Authentication failed: ${retryData.error || retryData.message || retryText}`,
								);
							}
							throw new Error(
								`Authentication failed: ${errorData.error || errorData.message}`,
							);
						}

						if (res.status === 400) {
							throw new Error(
								`Validation failed: ${errorData.error || errorData.message}`,
							);
						}

						throw new Error(
							`HTTP ${res.status}: ${errorData.error || errorData.message || errorText}`,
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

				// Don't retry on authentication or validation errors
				if (
					lastError.message.includes("Authentication failed") ||
					lastError.message.includes("Validation failed") ||
					lastError.message.includes("Circuit breaker is OPEN")
				) {
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
						...(params.capital_min !== undefined && {
							capital_min: params.capital_min,
						}),
						...(params.capital_max !== undefined && {
							capital_max: params.capital_max,
						}),
						excel: false,
					}),
				},
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
		return this.request("/api/dte/consultarNit", {
			method: "POST",
			body: JSON.stringify({ nit }),
		});
	}

	// ========================================================================
	// BANCOS (BANKS)
	// ========================================================================

	async getBancos(): Promise<{ banco_id: number; nombre: string }[]> {
		const response = await this.request<{
			data: { banco_id: number; nombre: string }[];
		}>("/bancos", { method: "GET" }, true);
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
		return this.request("/api/facturacion-snapshot/aplicar-manuales-dia", {
			method: "POST",
			body: JSON.stringify({ fecha }),
		});
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

		const response = await this.request<ResumenGlobalInversionista[]>(
			`/resumen-global-liquidaciones?${queryParams.toString()}`,
			{ method: "GET" },
			true,
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
				cobrado_capital?: string;
				cobrado_interes?: string;
				cobrado_membresias?: string;
				cobrado_seguro_gps?: string;
				cobrado_royalti?: string;
			}>(`/reportes/facturacion-mes-cobrado?${qp}`, { method: "GET" }, true),
			this.request<{
				meta_mensual?: string;
			}>(`/reportes/facturacion-mes-esperado?${qp}`, { method: "GET" }, true),
		]);

		const cobrado: FacturacionMesRubro = {
			capital: cobradoResult.cobrado_capital ?? "0",
			interes: cobradoResult.cobrado_interes ?? "0",
			membresias: cobradoResult.cobrado_membresias ?? "0",
			seguro_gps: cobradoResult.cobrado_seguro_gps ?? "0",
			royalti: cobradoResult.cobrado_royalti ?? "0",
		};

		return { cobrado, esperado: { meta_mensual: esperadoResult.meta_mensual ?? "0" } };
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
		return this.request<ReinversionLiquidacionesResponse>(
			`/reportes/reinversion-liquidaciones?${qp}`,
			{ method: "GET" },
			false,
		);
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

	async getMoraByEtapaYAsesor(params?: { emailCobrador?: string }) {
		const queryParams = new URLSearchParams();
		if (params?.emailCobrador) queryParams.set("email_cobrador", params.emailCobrador);
		const qs = queryParams.size > 0 ? `?${queryParams}` : "";
		return this.request<MoraByEtapaYAsesorResponse>(
			`/reportes/mora-por-etapa-asesor${qs}`,
			{ method: "GET" },
			true,
		);
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
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

export const carteraBackClient = new CarteraBackClient();
