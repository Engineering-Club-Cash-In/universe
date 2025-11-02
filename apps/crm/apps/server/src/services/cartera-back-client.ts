/**
 * Cartera-Back API Client
 * Type-safe HTTP client with retry logic, circuit breaker, and caching
 */

import type {
	CarteraBackApiResponse,
	CarteraBackAuthError,
	CarteraBackConnectionError,
	CarteraBackError,
	CarteraBackValidationError,
	CarteraCredito,
	CreateCreditoInput,
	CreatePagoInput,
	CreateUsuarioInput,
	CreditoConInversionistas,
	GetAllCreditsParams,
	GetInvestorReportParams,
	GetInvestorsParams,
	GetPaymentsParams,
	InversionistaReporte,
	PaginatedResponse,
	CarteraPagoCredito,
	CarteraUsuario,
	CarteraInversionista,
	ReversePagoInput,
	LiquidatePagosInversionistasInput,
	UpdateCreditoInput,
	CreditActionInput,
} from "../types/cartera-back";

// ============================================================================
// CONFIGURATION
// ============================================================================

interface CarteraBackClientConfig {
	baseUrl: string;
	apiKey?: string;
	timeout: number;
	retryAttempts: number;
	retryDelay: number;
	circuitBreakerThreshold: number;
	circuitBreakerTimeout: number;
	enableCache: boolean;
	cacheTtl: number;
}

const DEFAULT_CONFIG: CarteraBackClientConfig = {
	baseUrl: process.env.CARTERA_BACK_URL || "http://localhost:7000",
	apiKey: process.env.CARTERA_BACK_API_KEY,
	timeout: Number.parseInt(process.env.CARTERA_BACK_TIMEOUT || "30000"),
	retryAttempts: Number.parseInt(process.env.CARTERA_BACK_RETRY_ATTEMPTS || "3"),
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
			console.error(`[CarteraBack] Circuit breaker opened after ${this.failureCount} failures`);
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

		const requestOptions: RequestInit = {
			...options,
			headers: {
				"Content-Type": "application/json",
				...(this.config.apiKey && { Authorization: `Bearer ${this.config.apiKey}` }),
				...options.headers,
			},
			signal: AbortSignal.timeout(this.config.timeout),
		};

		let lastError: Error | null = null;

		for (let attempt = 0; attempt <= this.config.retryAttempts; attempt++) {
			try {
				const response = await this.circuitBreaker.execute(async () => {
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
							throw new Error(`Authentication failed: ${errorData.error || errorData.message}`);
						}

						if (res.status === 400) {
							throw new Error(`Validation failed: ${errorData.error || errorData.message}`);
						}

						throw new Error(`HTTP ${res.status}: ${errorData.error || errorData.message || errorText}`);
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
					console.log(`[CarteraBack] Retry ${attempt + 1}/${this.config.retryAttempts} after ${delay}ms`);
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

		if (error.message.includes("Circuit breaker is OPEN") || error.name === "AbortError") {
			return new Error(`Failed to connect to cartera-back: ${error.message}`) as CarteraBackConnectionError;
		}

		return new Error(`Cartera-back error: ${error.message}`) as CarteraBackError;
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
		const response = await this.request<CarteraBackApiResponse<CarteraUsuario>>("/users", {
			method: "POST",
			body: JSON.stringify(input),
		});
		if (!response.data) throw new Error("No data returned from createUsuario");
		return response.data;
	}

	async getUsuariosWithSifco(): Promise<CarteraUsuario[]> {
		const response = await this.request<CarteraBackApiResponse<CarteraUsuario[]>>(
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
		const response = await this.request<CarteraBackApiResponse<CarteraCredito>>("/newCredit", {
			method: "POST",
			body: JSON.stringify(input),
		});
		if (!response.data) throw new Error("No data returned from createCredito");
		return response.data;
	}

	async updateCredito(input: UpdateCreditoInput): Promise<CarteraCredito> {
		this.cache.invalidate(`credito:${input.credito_id}`);
		const response = await this.request<CarteraBackApiResponse<CarteraCredito>>("/updateCredit", {
			method: "POST",
			body: JSON.stringify(input),
		});
		if (!response.data) throw new Error("No data returned from updateCredito");
		return response.data;
	}

	async getCredito(numeroSifco: string): Promise<CreditoConInversionistas> {
		const response = await this.request<CarteraBackApiResponse<CreditoConInversionistas>>(
			`/credito?numero_credito_sifco=${encodeURIComponent(numeroSifco)}`,
			{ method: "GET" },
			true, // use cache
		);
		if (!response.data) throw new Error(`Crédito ${numeroSifco} not found`);
		return response.data;
	}

	async getAllCreditos(params: GetAllCreditsParams): Promise<PaginatedResponse<CarteraCredito>> {
		const queryParams = new URLSearchParams({
			mes: params.mes.toString(),
			anio: params.anio.toString(),
			...(params.estado && { estado: params.estado }),
			...(params.page && { page: params.page.toString() }),
			...(params.perPage && { perPage: params.perPage.toString() }),
			...(params.numero_credito_sifco && { numero_credito_sifco: params.numero_credito_sifco }),
			excel: "false",
		});

		const response = await this.request<CarteraBackApiResponse<PaginatedResponse<CarteraCredito>>>(
			`/getAllCredits?${queryParams}`,
			{ method: "GET" },
			true, // use cache
		);

		if (!response.data) throw new Error("No data returned from getAllCreditos");
		return response.data;
	}

	async creditAction(input: CreditActionInput): Promise<{ success: boolean; message: string }> {
		this.cache.invalidate(`credito:${input.creditId}`);
		const response = await this.request<CarteraBackApiResponse<{ success: boolean; message: string }>>(
			"/creditAction",
			{
				method: "POST",
				body: JSON.stringify(input),
			},
		);
		return response.data || { success: false, message: "No response" };
	}

	// ========================================================================
	// PAGOS (PAYMENTS)
	// ========================================================================

	async createPago(input: CreatePagoInput): Promise<CarteraPagoCredito> {
		this.cache.invalidate(`credito:${input.credito_numero_sifco}`);
		this.cache.invalidate("pagos");
		const response = await this.request<CarteraBackApiResponse<CarteraPagoCredito>>("/newPayment", {
			method: "POST",
			body: JSON.stringify(input),
		});
		if (!response.data) throw new Error("No data returned from createPago");
		return response.data;
	}

	async reversePago(input: ReversePagoInput): Promise<{ success: boolean; message: string }> {
		this.cache.invalidate(`credito:${input.credito_id}`);
		this.cache.invalidate("pagos");
		const response = await this.request<CarteraBackApiResponse<{ success: boolean; message: string }>>(
			"/reversePayment",
			{
				method: "POST",
				body: JSON.stringify(input),
			},
		);
		return response.data || { success: false, message: "No response" };
	}

	async getPagosByCredito(numeroSifco: string): Promise<CarteraPagoCredito[]> {
		const response = await this.request<CarteraBackApiResponse<CarteraPagoCredito[]>>(
			`/paymentByCredit?numero_credito_sifco=${encodeURIComponent(numeroSifco)}&excel=false`,
			{ method: "GET" },
			true, // use cache
		);
		return response.data || [];
	}

	async getPayments(params: GetPaymentsParams): Promise<PaginatedResponse<CarteraPagoCredito>> {
		const queryParams = new URLSearchParams({
			mes: params.mes.toString(),
			anio: params.anio.toString(),
			...(params.page && { page: params.page.toString() }),
			...(params.perPage && { perPage: params.perPage.toString() }),
			...(params.numero_credito_sifco && { numero_credito_sifco: params.numero_credito_sifco }),
		});

		const response = await this.request<CarteraBackApiResponse<PaginatedResponse<CarteraPagoCredito>>>(
			`/payments?${queryParams}`,
			{ method: "GET" },
			true,
		);

		if (!response.data) throw new Error("No data returned from getPayments");
		return response.data;
	}

	async liquidatePagosInversionistas(
		input: LiquidatePagosInversionistasInput,
	): Promise<{ success: boolean; message: string }> {
		this.cache.invalidate("inversionistas");
		const response = await this.request<CarteraBackApiResponse<{ success: boolean; message: string }>>(
			"/liquidate-pagos-inversionistas",
			{
				method: "POST",
				body: JSON.stringify(input),
			},
		);
		return response.data || { success: false, message: "No response" };
	}

	// ========================================================================
	// INVERSIONISTAS (INVESTORS)
	// ========================================================================

	async getInvestors(params: GetInvestorsParams = {}): Promise<PaginatedResponse<CarteraInversionista>> {
		const queryParams = new URLSearchParams({
			...(params.page && { page: params.page.toString() }),
			...(params.perPage && { perPage: params.perPage.toString() }),
		});

		const response = await this.request<CarteraBackApiResponse<PaginatedResponse<CarteraInversionista>>>(
			`/investor?${queryParams}`,
			{ method: "GET" },
			true,
		);

		if (!response.data) throw new Error("No data returned from getInvestors");
		return response.data;
	}

	async getInvestorReport(params: GetInvestorReportParams): Promise<InversionistaReporte> {
		const queryParams = new URLSearchParams({
			id: params.id.toString(),
			...(params.page && { page: params.page.toString() }),
			...(params.perPage && { perPage: params.perPage.toString() }),
			...(params.numeroCreditoSifco && { numeroCreditoSifco: params.numeroCreditoSifco }),
			...(params.nombreUsuario && { nombreUsuario: params.nombreUsuario }),
		});

		const response = await this.request<CarteraBackApiResponse<InversionistaReporte>>(
			`/getInvestors?${queryParams}`,
			{ method: "GET" },
			true,
		);

		if (!response.data) throw new Error("No data returned from getInvestorReport");
		return response.data;
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
