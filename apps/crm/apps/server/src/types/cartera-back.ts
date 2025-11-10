/**
 * TypeScript types for cartera-back API integration
 * Based on cartera-back database schema and API responses
 */

// ============================================================================
// ENUMS
// ============================================================================

export type StatusCreditEnum =
	| "ACTIVO"
	| "CANCELADO"
	| "INCOBRABLE"
	| "PENDIENTE_CANCELACION"
	| "MOROSO";

export type EstadoLiquidacionEnum =
	| "NO_LIQUIDADO"
	| "POR_LIQUIDAR"
	| "LIQUIDADO";

export type ValidationStatusEnum = "no_required" | "pending" | "validated";

export type BancoEnum =
	| "GyT"
	| "BAM"
	| "BI"
	| "BANRURAL"
	| "PROMERICA"
	| "BANTRAB"
	| "BAC"
	| "NEXA"
	| "INDUSTRIAL"
	| "INTERBANCO";

export type TipoCuentaEnum =
	| "AHORRO"
	| "AHORRO Q"
	| "AHORROS"
	| "AHORRO $"
	| "MONETARIA"
	| "MONETARIA Q"
	| "MONETARIA $";

// ============================================================================
// USUARIOS (CLIENTES)
// ============================================================================

export interface CarteraUsuario {
	usuario_id: number;
	nombre: string;
	nit: string | null;
	categoria: string | null;
	como_se_entero: string | null;
	saldo_a_favor: string; // decimal(18,2) comes as string
}

export interface CreateUsuarioInput {
	nombre: string;
	nit?: string;
	categoria?: string;
	como_se_entero?: string;
}

// ============================================================================
// CRÉDITOS (PRÉSTAMOS)
// ============================================================================

export interface CarteraCredito {
	credito_id: number;
	usuario_id: number;
	numero_credito_sifco: string;
	fecha_creacion: string; // timestamp
	capital: string; // decimal(18,2)
	porcentaje_interes: string; // decimal(5,2)
	deudatotal: string; // decimal(18,2)
	cuota_interes: string; // decimal(18,2)
	cuota: string; // decimal(18,2)
	iva_12: string; // decimal(18,2)
	seguro_10_cuotas: string; // decimal(18,2)
	gps: string; // decimal(18,2)
	plazo: number;
	asesor_id: number | null;
	membresias: string; // decimal(18,2)
	membresias_pago: string; // decimal(18,2)
	formato_credito: string | null;
	porcentaje_royalti: string; // decimal(18,2)
	tipoCredito: string | null;
	royalti: string; // decimal(18,2)
	statusCredit: StatusCreditEnum;
	otros: string; // decimal(18,2)
	observaciones: string | null;
	no_poliza: string | null;
}

export interface CreateCreditoInput {
	usuario_id: number;
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
}

export interface CreditoConInversionistas extends CarteraCredito {
	usuario: CarteraUsuario;
	asesor: {
		asesor_id: number;
		nombre: string;
		activo: boolean;
	} | null;
	cuotas: CarteraCuotaCredito[];
	pagos: CarteraPagoCredito[];
	creditos_inversionistas: CarteraCreditoInversionista[];
	moras: CarteraMoraCredito[];
	// Campos calculados
	cuotas_pagadas?: number;
	cuotas_pendientes?: number;
	capital_restante?: string;
	interes_restante?: string;
	total_restante?: string;
	dias_mora?: number;
	monto_mora?: string;
	cuotas_atrasadas?: number;
	ultimo_pago?: CarteraPagoCredito;
	proxima_cuota?: CarteraCuotaCredito;
}

export interface UpdateCreditoInput {
	credito_id: number;
	capital?: number;
	porcentaje_interes?: number;
	plazo?: number;
	cuota?: number;
	tipoCredito?: string;
	observaciones?: string;
	statusCredit?: StatusCreditEnum;
}

export interface CreditActionInput {
	creditId: number;
	motivo?: string;
	observaciones?: string;
	monto_cancelacion?: number;
	accion: "CANCELAR" | "ACTIVAR" | "INCOBRABLE" | "PENDIENTE_CANCELACION";
	montosAdicionales?: Array<{
		concepto: string;
		monto: number;
	}>;
}

// ============================================================================
// CUOTAS DE CRÉDITO
// ============================================================================

export interface CarteraCuotaCredito {
	cuota_id: number;
	credito_id: number;
	numero_cuota: number;
	fecha_vencimiento: string; // date
	pagado: boolean;
	createdAt: string; // timestamp
	pago?: CarteraPagoCredito;
}

// ============================================================================
// PAGOS DE CRÉDITO
// ============================================================================

export interface CarteraPagoCredito {
	pago_id: number;
	credito_id: number;
	cuota_id: number | null;
	fecha_pago: string; // date
	cuota: string; // decimal
	cuota_interes: string; // decimal
	abono_capital: string; // decimal(18,2)
	abono_interes: string; // decimal(18,2)
	abono_iva_12: string; // decimal(18,2)
	abono_interes_ci: string; // decimal(18,2)
	abono_iva_ci: string; // decimal(18,2)
	abono_seguro: string; // decimal(18,2)
	abono_gps: string; // decimal(18,2)
	pago_del_mes: string; // decimal(18,2)
	monto_boleta: string; // decimal(18,2)
	numeroAutorizacion: string | null;
	capital_restante: string; // decimal(18,2)
	interes_restante: string; // decimal(18,2)
	iva_12_restante: string; // decimal(18,2)
	seguro_restante: string; // decimal(18,2)
	gps_restante: string; // decimal(18,2)
	total_restante: string; // decimal(18,2)
	membresias: string; // decimal
	membresias_pago: string; // decimal
	membresias_mes: string; // decimal
	mora: string; // decimal(18,2)
	pagado: boolean;
	facturacion: string | null;
	mes_pagado: string | null;
	reserva: string; // decimal(18,2)
	paymentFalse: boolean;
	validationStatus: ValidationStatusEnum;
	observaciones: string | null;
	boletas?: CarteraBoleta[];
	pagos_inversionistas?: CarteraPagoCreditoInversionista[];
}

export interface CreatePagoInput {
	credito_numero_sifco: string;
	cuota_id?: number;
	fecha_pago: string; // ISO date string
	monto_boleta: number;
	numeroAutorizacion?: string;
	observaciones?: string;
	// Los demás campos se calculan automáticamente en cartera-back
}

export interface ReversePagoInput {
	pago_id: number;
	credito_id: number;
}

// ============================================================================
// BOLETAS (RECEIPTS)
// ============================================================================

export interface CarteraBoleta {
	id: number;
	pago_id: number;
	url_boleta: string;
	created_at: string;
}

// ============================================================================
// INVERSIONISTAS
// ============================================================================

export interface CarteraInversionista {
	inversionista_id: number;
	nombre: string;
	emite_factura: boolean;
	reinversion: boolean;
	banco: BancoEnum | null;
	tipo_cuenta: TipoCuentaEnum | null;
	numero_cuenta: string | null;
}

export interface CreateInversionistaInput {
	nombre: string;
	emite_factura?: boolean;
	reinversion?: boolean;
	banco?: BancoEnum;
	tipo_cuenta?: TipoCuentaEnum;
	numero_cuenta?: string;
}

export interface UpdateInversionistaInput {
	inversionista_id: number;
	nombre?: string;
	emite_factura?: boolean;
	reinversion?: boolean;
	banco?: BancoEnum;
	tipo_cuenta?: TipoCuentaEnum;
	numero_cuenta?: string;
}

// ============================================================================
// CRÉDITOS-INVERSIONISTAS (LOAN PARTICIPATION)
// ============================================================================

export interface CarteraCreditoInversionista {
	id: number;
	credito_id: number;
	inversionista_id: number;
	cuota_inversionista: string; // decimal(18,2)
	porcentaje_participacion_inversionista: string; // decimal(5,2)
	monto_aportado: string; // decimal(18,2)
	porcentaje_cash_in: string; // decimal(5,2)
	iva_inversionista: string; // decimal(18,2)
	iva_cash_in: string; // decimal(18)
	fecha_creacion: string; // timestamp
	monto_inversionista: string; // decimal(18,2)
	monto_cash_in: string; // decimal(18,2)
	inversionista?: CarteraInversionista;
}

// ============================================================================
// PAGOS CRÉDITO INVERSIONISTAS (PAYMENT DISTRIBUTION)
// ============================================================================

export interface CarteraPagoCreditoInversionista {
	id: number;
	pago_id: number;
	inversionista_id: number;
	credito_id: number;
	abono_capital: string; // decimal(18,2)
	abono_interes: string; // decimal(18,2)
	abono_iva_12: string; // decimal(18,2)
	porcentaje_participacion: string; // decimal(5,2)
	fecha_pago: string; // timestamp
	estado_liquidacion: EstadoLiquidacionEnum;
	cuota: string; // decimal(18,2)
	inversionista?: CarteraInversionista;
}

export interface LiquidatePagosInversionistasInput {
	pago_id: number;
	credito_id: number;
	cuota: number;
}

export interface LiquidateByInvestorInput {
	inversionista_id: number;
}

// ============================================================================
// ASESORES
// ============================================================================

export interface CarteraAsesor {
	asesor_id: number;
	nombre: string;
	activo: boolean;
}

export interface CreateAsesorInput {
	nombre: string;
	activo?: boolean;
}

export interface UpdateAsesorInput {
	asesor_id: number;
	nombre?: string;
	activo?: boolean;
}

// ============================================================================
// MORAS
// ============================================================================

export interface CarteraMoraCredito {
	mora_id: number;
	credito_id: number;
	activa: boolean;
	porcentaje_mora: string; // decimal(5,2)
	monto_mora: string; // decimal(18,2)
	cuotas_atrasadas: number;
	created_at: string;
	updated_at: string;
	condonaciones?: CarteraMoraCondonacion[];
}

export interface CarteraMoraCondonacion {
	condonacion_id: number;
	credito_id: number;
	mora_id: number;
	motivo: string;
	usuario_id: number;
	fecha: string;
}

export interface CreateMoraInput {
	credito_id: number;
	porcentaje_mora?: number;
}

export interface UpdateMoraInput {
	mora_id: number;
	monto_mora?: number;
	cuotas_atrasadas?: number;
}

export interface CondonarMoraInput {
	mora_id: number;
	motivo: string;
	usuario_id: number;
}

// ============================================================================
// API RESPONSE TYPES
// ============================================================================

export interface CarteraBackApiResponse<T> {
	success: boolean;
	data?: T;
	error?: string;
	message?: string;
}

export interface PaginatedResponse<T> {
	data: T[];
	total: number;
	page: number;
	perPage: number;
	totalPages: number;
}

export interface GetAllCreditsParams {
	mes: number;
	anio: number;
	estado?: StatusCreditEnum;
	page?: number;
	perPage?: number;
	numero_credito_sifco?: string;
	excel?: boolean;
}

export interface GetPaymentsParams {
	mes: number;
	anio: number;
	page?: number;
	perPage?: number;
	numero_credito_sifco?: string;
}

export interface GetInvestorsParams {
	page?: number;
	perPage?: number;
}

export interface GetInvestorReportParams {
	id: number;
	page?: number;
	perPage?: number;
	numeroCreditoSifco?: string;
	nombreUsuario?: string;
}

export interface InversionistaReporte {
	inversionista: CarteraInversionista;
	creditos: CreditoData[];
	totales: {
		montoTotalAportado: string;
		montoTotalRecuperado: string;
		montoTotalPendiente: string;
		creditosActivos: number;
		creditosCancelados: number;
		porcentajeRecuperacion: string;
	};
}

export interface CreditoData {
	credito: CarteraCredito;
	usuario: CarteraUsuario;
	participacion: CarteraCreditoInversionista;
	pagos: PagoDetalle[];
	montoRecuperado: string;
	montoPendiente: string;
}

export interface PagoDetalle {
	pago: CarteraPagoCredito;
	distribucion: CarteraPagoCreditoInversionista;
}

// ============================================================================
// ERROR TYPES
// ============================================================================

export class CarteraBackError extends Error {
	constructor(
		message: string,
		public statusCode?: number,
		public response?: unknown,
	) {
		super(message);
		this.name = "CarteraBackError";
	}
}

export class CarteraBackConnectionError extends CarteraBackError {
	constructor(message: string) {
		super(message, 503);
		this.name = "CarteraBackConnectionError";
	}
}

export class CarteraBackAuthError extends CarteraBackError {
	constructor(message: string) {
		super(message, 401);
		this.name = "CarteraBackAuthError";
	}
}

export class CarteraBackValidationError extends CarteraBackError {
	constructor(
		message: string,
		public validationErrors?: Record<string, string[]>,
	) {
		super(message, 400);
		this.name = "CarteraBackValidationError";
	}
}
