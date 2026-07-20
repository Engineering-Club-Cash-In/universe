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
	| "MOROSO"
	| "EN_CONVENIO";

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
	//usuario_id?: number;
	usuario?: string;
	numero_credito_sifco: string;
	capital: number;
	porcentaje_interes: number;
	plazo: number;
	cuota: number;
	// asesor_id?: number;
	asesor?: any;
	tipoCredito?: string;
	iva_12?: number;
	seguro_10_cuotas?: number;
	gps?: number;
	fecha_creacion?: string;
	observaciones?: string;
	no_poliza?: string;
	aseguradora?: string;
	como_se_entero?: string;
	dia_pago_mensual?: 15 | 30;
	membresias_pago?: number;
	categoria?: string;
	nit?: string;
	royalti?: number;
	porcentaje_royalti?: number;
	otros?: number;
	reserva?: number;
	is_vehiculo_propio?: boolean;
	// campos para la facturacion
	direccion?: string;
	municipio?: string;
	departamento?: string;
	codigo_postal?: string;
	pais?: string;
	// Nuevos campos para el correo de notificación
	vehiculo_marca?: string;
	vehiculo_linea?: string;
	vehiculo_modelo?: string;
	vehiculo_placa?: string;
	vehiculo_vin?: string;
	monto_asegurado?: number;
	opportunity_id?: string;
	inversionistas?: Array<{
		inversionista_id: number;
		porcentaje_participacion: number;
		cuota_inversionista: number;
		monto_aportado: number;
		porcentaje_cash_in: number;
		porcentaje_inversion: number;
	}>;
	rubros?: Array<{
		nombre_rubro: string;
		monto: number;
	}>;
}

/**
 * Estructura REAL devuelta por el endpoint /getAllCredits
 * Los datos vienen anidados, no como un objeto plano
 */
export interface CreditoDetailResponse {
	creditos: CarteraCredito;
	usuarios: CarteraUsuario;
	asesores: CarteraAsesorCredito | null;
	inversionistas: Array<{
		credito_id: number;
		inversionista_id: number;
		nombre: string;
		emite_factura: boolean;
		monto_aportado: string;
		monto_cash_in: string;
		monto_inversionista: string;
		iva_cash_in: string;
		iva_inversionista: string;
		porcentaje_participacion_inversionista: string;
		porcentaje_cash_in: string;
		cuota_inversionista: string;
	}>;
	resumen: {
		total_cash_in_monto: number;
		total_cash_in_iva: number;
		total_inversion_monto: number;
		total_inversion_iva: number;
	};
	rubros: unknown[];
	mora: CarteraMoraCredito | null;
	deuda_total_con_mora: string;
	proxima_cuota?: CarteraCuotaCredito | null;
}

/** Fila del listado /buckets/creditos: CreditoDetailResponse + el bucket derivado. */
export interface CreditoBucketResponse extends CreditoDetailResponse {
	bucket?: {
		numero: number;
		prefijo: string;
		nombre: string;
		color: string | null;
	};
}

export interface GetCreditosPorBucketParams {
	/** Número de bucket del catálogo (0-5). Omitir = todo el funnel. */
	bucket?: number;
	page?: number;
	perPage?: number;
	numero_credito_sifco?: string;
	nombre_usuario?: string;
	email_asesor?: string;
}

/** CB-018: filtros de GET /buckets/carga (carga por asesor y bucket). */
export interface GetCargaPorAsesorBucketParams {
	bucket?: number;
	asesor_id?: number;
}

/**
 * Detalle por asesor dentro de un bucket. Capacidad/% utilización/sobrecarga
 * viven AQUÍ (ticket CB-018, confirmado con el informador: el techo de 300 es
 * "la cantidad que puede atender un asesor", NO un agregado del bucket
 * completo) — cada combinación asesor+bucket tiene su propio techo.
 */
export interface CargaPorAsesorBucketDetalle {
	bucket: number;
	cuentas: number;
	capacidad_base: number;
	utilizacion_pct: number;
	elegible: boolean;
	/** cuentas > capacidad_base (sin margen) — ya pasó su cupo nominal. */
	sobrecarga: boolean;
	/** cuentas > capacidad_base + margen (margen %/fijo configurable por fila) — señal de abrir plaza. */
	alerta_nueva_posicion: boolean;
	/** Umbral absoluto (capacidad_base + margen resuelto) a partir del cual esta fila entra en alerta_nueva_posicion. */
	umbral_alerta_cuentas: number;
	/** CB-019: crudos de margen, para prellenar el formulario de edición de capacidad. */
	margen_alerta_tipo: "porcentaje" | "fijo";
	margen_alerta_valor: number;
}

export interface CargaPorAsesor {
	asesor_id: number;
	nombre: string;
	email_asesor: string | null;
	porBucket: CargaPorAsesorBucketDetalle[];
}

/** Resumen informativo del bucket: totales y conteos de sus asesores en alerta/sobrecarga. */
export interface CargaPorBucketResumen {
	numero: number;
	prefijo: string;
	nombre: string;
	color: string | null;
	cuentas_totales: number;
	asesores_en_pool: number;
	asesores_en_alerta: number;
	asesores_sobrecargados: number;
}

export interface CargaPorAsesorBucketResponse {
	buckets: CargaPorBucketResumen[];
	porAsesor: CargaPorAsesor[];
	fecha: string;
}

/** CB-019: input de PATCH /buckets/asesor-bucket/:asesor_id/:bucket. */
export interface ActualizarCapacidadAsesorBucketInput {
	asesor_id: number;
	bucket: number;
	capacidad_base: number;
	margen_alerta_tipo: "porcentaje" | "fijo";
	margen_alerta_valor: number;
}

export interface GetAsesorHistorialParams {
	desde?: string; // YYYY-MM-DD
	hasta?: string; // YYYY-MM-DD
	origen?: string; // PROCESO_AUTO | API_MANUAL
	bucket?: string; // CSV de enteros
	asesor_nuevo?: string; // CSV de nombres
	numero_credito_sifco?: string;
	nombre_usuario?: string;
	credito_id?: number;
	page?: number;
	pageSize?: number;
}

/** Fila de la bitácora de cambios de asesor (credito_asesor_historial). */
export interface AsesorCambioRow {
	historial_id: number;
	fecha: string;
	credito_id: number;
	numero_credito_sifco: string;
	cliente: string;
	asesor_anterior_id: number | null;
	asesor_anterior: string | null;
	asesor_nuevo_id: number | null;
	asesor_nuevo: string | null;
	bucket: number | null;
	bucket_prefijo: string | null;
	bucket_nombre: string | null;
	origen: string;
	motivo: string | null;
	usuario: string | null;
	status_actual: string;
}

export interface AsesorHistorialResponse {
	success: boolean;
	data: AsesorCambioRow[];
	pagination: {
		page: number;
		pageSize: number;
		total: number;
		totalPages: number;
	};
	resumen: {
		total: number;
		automaticos: number;
		manuales: number;
		creditos: number;
	};
}

/**
 * @deprecated Usar CreditoDetailResponse en su lugar
 * Este tipo representa una estructura que NO coincide con la API real
 */
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

/**
 * Asesor tal como lo devuelve el endpoint /credito (campos crudos de la tabla `asesores`).
 * Difiere de CarteraAsesor (que se enriquece con datos de platform_users en /advisor).
 */
export interface CarteraAsesorCredito {
	asesor_id: number;
	nombre: string;
	telefono: string | null;
	activo: boolean | null;
	emailCashIn: string | null;
}

/**
 * Estructura real devuelta por el endpoint /credito?numero_credito_sifco=XXX
 * Retorna los datos del crédito con las cuotas separadas por estado
 */
export interface CarteraConvenio {
	convenio_id: number;
	credito_id: number;
	monto_total_convenio: string;
	numero_meses: number;
	cuota_mensual: string;
	activo: boolean;
	completado: boolean;
	created_at?: string | null;
	updated_at?: string | null;
	fecha_convenio?: string | null;
	monto_pagado?: string | null;
	monto_pendiente?: string | null;
	pagos_realizados?: number | null;
	pagos_pendientes?: number | null;
	motivo?: string | null;
	observaciones?: string | null;
	created_by?: number | null;
	cuotaConvenioAPagar?: string | null;
}

export interface CreditoDirectoResponse {
	credito: CarteraCredito;
	usuario: CarteraUsuario;
	asesor: CarteraAsesorCredito | null;
	cuotasPagadas: CarteraCuotaCredito[];
	cuotasPendientes: CarteraCuotaCredito[];
	cuotasAtrasadas: CarteraCuotaCredito[];
	moraActual: string; // decimal viene como string
	mora?: CarteraMoraCredito | null;
	convenioActivo?: CarteraConvenio | null;
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
	// Campos adicionales de pago (opcionales)
	pago_id?: number;
	monto_boleta?: string; // decimal
	abono_capital?: string; // decimal
	abono_interes?: string; // decimal
	abono_iva_12?: string; // decimal
	abono_interes_ci?: string; // decimal
	abono_iva_ci?: string; // decimal
	abono_seguro?: string; // decimal
	abono_gps?: string; // decimal
	abono_membresias?: string; // decimal
	capital_restante?: string; // decimal
	interes_restante?: string; // decimal
	iva_12_restante?: string; // decimal
	seguro_restante?: string; // decimal
	gps_restante?: string; // decimal
	membresias_restante?: string; // decimal
	pago_mora?: string; // decimal
	pago_otros?: string; // decimal
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
	dpi: number | null;
	email: string | null;
	emite_factura: boolean;
	reinversion: boolean;
	tipo_reinversion: string;
	banco: BancoEnum | null;
	banco_id: number | null;
	tipo_cuenta: TipoCuentaEnum | null;
	numero_cuenta: string | null;
	moneda: "quetzales" | "dolares";
	celular: string | null;
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
	email: string;
	is_active: boolean;
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
	totalCount?: number;
	totalPages: number;
}

export interface GetAllCreditsParams {
	mes: number;
	anio: number;
	estado?: StatusCreditEnum;
	page?: number;
	perPage?: number;
	numero_credito_sifco?: string;
	numeros_credito_sifco?: string[];
	excel?: boolean;
	cuotas_atrasadas?: number;
	/** Rango de cuotas atrasadas (aging). `cuotas_max` undefined = sin tope (>= min). */
	cuotas_min?: number;
	cuotas_max?: number;
	nombre_usuario?: string;
	time?: "WEEK" | "MONTH" | "DUEMONTH" | "TODAY";
	email_cobrador?: string;
	fecha_desde?: string;
	fecha_hasta?: string;
	capital_min?: number;
	capital_max?: number;
	excluir_pagados_mes?: boolean;
}

export interface GetPaymentsParams {
	mes: number;
	anio: number;
	page?: number;
	perPage?: number;
	numero_credito_sifco?: string;
}

export interface GetInvestorsParams {
	id?: number;
	page?: number;
	perPage?: number;
}

export interface GetAdvisorsParams {
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
// STATS (ESTADÍSTICAS)
// ============================================================================

export interface CarteraStatsBucket {
	cantidad: number;
	porcentaje: string;
	sumaCapital: string;
	sumaMora: string;
	/** Enriquecido desde el catálogo dinámico `cartera.buckets`. */
	estadoMora?: string;
	label?: string;
	color?: string | null;
	prefijo?: string;
}

export interface CarteraStatsResponse {
	totalCreditos: number;
	efectividad: string;
	porCuotasAtrasadas: {
		[key: string]: CarteraStatsBucket; // "0".."5" y futuros
	};
	porEstado: {
		cancelado?: CarteraStatsBucket;
		incobrable?: CarteraStatsBucket;
	};
}

export interface GetStatsParams {
	email?: string; // Email del asesor para filtrar
}

/** Fila del catálogo dinámico `cartera.buckets` (B0-B5), expuesta vía GET /config/buckets. */
export interface CarteraBucketCatalogo {
	numero: number;
	prefijo: string;
	nombre: string;
	descripcion: string | null;
	cuotas_min: number;
	cuotas_max: number | null;
	estados_incluidos: string[];
	es_operativo: boolean;
	orden: number;
	color: string | null;
	estado_mora: string | null;
}

// ============================================================================
// HISTORIAL DE BUCKETS (motor COBROS-02, GET /buckets/historial)
// ============================================================================

/** Fila del histórico de migraciones de bucket (`cartera.buckets_historial` + joins). */
export interface CarteraBucketHistorialRow {
	historial_id: number;
	fecha: string;
	credito_id: number;
	numero_credito_sifco: string;
	cliente: string;
	asesor_id: number | null;
	asesor: string | null;
	tipo_evento: "INICIAL" | "SUBIDA" | "BAJADA";
	origen: string;
	bucket_anterior: number | null;
	bucket_anterior_prefijo: string | null;
	bucket_anterior_nombre: string | null;
	bucket_nuevo: number;
	bucket_nuevo_prefijo: string | null;
	bucket_nuevo_nombre: string | null;
	cuotas_atrasadas_nuevas: number | null;
	status_credito: string | null;
	status_actual: string;
	capital: string;
	asesor_atribucion_id: number | null;
	asesor_atribucion: string | null;
	pago_id: number | null;
	motivo: string | null;
}

export interface CarteraBucketsHistorialResponse {
	success: boolean;
	data: CarteraBucketHistorialRow[];
	pagination: {
		page: number;
		pageSize: number;
		total: number;
		totalPages: number;
	};
	resumen: {
		total: number;
		iniciales: number;
		subidas: number;
		bajadas: number;
	};
}

export interface GetBucketsHistorialParams {
	desde?: string; // YYYY-MM-DD (corte por día GT, inclusive)
	hasta?: string; // YYYY-MM-DD
	tipo_evento?: string; // CSV: INICIAL,SUBIDA,BAJADA
	bucket_nuevo?: string; // CSV de enteros 0-5
	numero_credito_sifco?: string; // ILIKE
	nombre_usuario?: string; // cliente, ILIKE
	page?: number;
	pageSize?: number;
}

/** Evento del drill-down por crédito (GET /buckets/historial/credito/:id). */
export interface CarteraBucketHistorialEvento {
	historial_id: number;
	fecha: string;
	tipo_evento: "INICIAL" | "SUBIDA" | "BAJADA";
	origen: string;
	bucket_anterior: number | null;
	bucket_anterior_prefijo: string | null;
	bucket_anterior_nombre: string | null;
	bucket_nuevo: number;
	bucket_nuevo_prefijo: string | null;
	bucket_nuevo_nombre: string | null;
	cuotas_atrasadas_nuevas: number | null;
	status_credito: string | null;
	asesor_atribucion_id: number | null;
	asesor_atribucion: string | null;
	pago_id: number | null;
	motivo: string | null;
}

// ============================================================================
// PREMORA (CC2-11, GET /cuotas/proximas-vencer)
// ============================================================================

/** Cuota pendiente de un crédito AL DÍA que vence en exactamente N días (día GT). */
export interface CarteraCuotaProximaVencer {
	cuota_id: number;
	credito_id: number;
	numero_cuota: number;
	fecha_vencimiento: string; // YYYY-MM-DD
	dias_para_vencer: number; // 0 | 1 | 3 | 5 (según el filtro pedido)
	numero_credito_sifco: string;
	status_credit: string; // ACTIVO | MOROSO | INCOBRABLE (funnel)
	bucket: number | null; // bucket MOTOR (último de buckets_historial)
	monto_cuota: string;
	/** Mora ACTIVA: SOLO el recargo, NO incluye las cuotas vencidas ("0.00" si no tiene). */
	monto_mora: string;
	/** Cuotas atrasadas según la FOTO de `moras_credito` (puede venir stale). */
	cuotas_atrasadas: number;
	/** Cuotas vencidas reales en tiempo real. Si difiere de `cuotas_atrasadas`, la foto está stale. */
	cuotas_vencidas_reales: number;
	cliente: string;
	telefono_cliente_cartera: string | null;
	asesor_id: number | null;
	asesor: string | null;
	telefono_asesor: string | null;
}

export interface CarteraCuotasProximasResponse {
	success: boolean;
	total: number;
	data: CarteraCuotaProximaVencer[];
}

// ============================================================================
// FACTURACIÓN
// ============================================================================

/** Item de factura genérica */
export interface FacturaItem {
	monto: number;
	rubro: string;
	/** Rubro del REPORTE (enum rubro_facturacion de cartera-back) para el desglose.
	 *  Opcional: si viene, cartera lo guarda en facturacion_desglose y el snapshot lo suma. */
	rubro_desglose?: string;
}

/** Input para facturación genérica */
export interface FacturarGenericoInput {
	nit: string;
	items: FacturaItem[];
	created_by: number;
}

/** Respuesta de facturación genérica */
export interface FacturarGenericoResponse {
	success: boolean;
	message?: string;
	factura_id?: number;
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

// ============================================================================
// RESUMEN GLOBAL INVERSIONISTAS
// ============================================================================

export interface BoletaPagoInversionista {
	boleta_id: number;
	inversionista_id: number;
	boleta_url: string;
	estado: string;
	notas: string | null;
	monto_boleta: string;
	fecha_subida: string;
}

export interface CreateBoletaInput {
	inversionista_id: number;
	boleta_url: string;
	monto_boleta?: string;
	notas?: string;
	subido_por?: number;
}

export interface ResumenGlobalInversionista {
	inversionista_id: number;
	nombre: string;
	moneda: "quetzales" | "dolares";
	currencySymbol: string;
	emite_factura: boolean;
	reinversion: string;
	banco: string | null;
	tipo_cuenta: string | null;
	numero_cuenta: string | null;
	total_abono_capital: string;
	total_abono_interes: string;
	total_abono_iva: string;
	total_isr: string;
	total_cuota?: string;
	total_a_recibir_sin_reinversion: string;
	total_reinversion: string;
	total_a_recibir_con_reinversion: string;
	boleta_pendiente: BoletaPagoInversionista | null;
	boleta_liquidacion?: BoletaPagoInversionista | null;
	estado_liquidacion_resumen?: "pending" | "uploaded" | "liquidated";
}

// ============================================================================
// ERRORS
// ============================================================================

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
