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
	dia_pago_mensual?: number;
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
	/**
	 * Bucket del MOTOR (última fila de `buckets_historial`, fallback a
	 * derivación viva solo si el motor nunca vio el crédito). `null` si el
	 * crédito está fuera del funnel. Faltaba en este tipo aunque
	 * `/getAllCredits` (apps/cartera-back/src/controllers/credits.ts) ya lo
	 * devuelve — CB-128 recalculaba el bucket localmente desde cuotas atrasadas
	 * en vez de usar este campo (Codex, PR #1300).
	 */
	bucket?: {
		numero: number;
		prefijo: string;
		nombre: string;
		color: string | null;
	} | null;
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
	/** Filtra la lista por asesor asignado (cartera-back /buckets/creditos). */
	asesor_id?: number;
}

/** CB-027: filtros de GET /payment-agreements/listado. */
export interface GetConveniosListadoParams {
	estado?: "active" | "completed" | "inactive" | "all";
	numeroCreditoSifco?: string;
	nombreUsuario?: string;
	asesorId?: number;
	emailAsesor?: string;
	page?: number;
	perPage?: number;
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

/**
 * Fila de GET /buckets/pool-por-asesor: TODOS los asesores con sus buckets
 * activos del pool, sin filtrar por créditos actuales (a diferencia de
 * /buckets/carga). `email_cash_in` es el campo confiable para cruzar contra
 * `user.email` del CRM — el `email` de /advisor está desactualizado para
 * varios asesores.
 */
export interface PoolPorAsesorRow {
	asesor_id: number;
	nombre: string;
	email_cash_in: string | null;
	buckets: number[];
}

// ─────────────────────────────────────────────────────────────────────────
// CB-023 · Apertura matutina del supervisor (GET /buckets/apertura).
// ─────────────────────────────────────────────────────────────────────────

/** De dónde vinieron los créditos que entraron a un bucket. */
export interface AperturaCuentasNuevasOrigen {
	desde: number;
	tipo: "SUBIDA" | "BAJADA";
	cantidad: number;
}

/** Transiciones de bucket del día, por bucket destino. */
export interface AperturaCuentasNuevas {
	bucket: number;
	entradas: number; // SUBIDA + BAJADA que aterrizan en este bucket
	subidas: number;
	bajadas: number;
	/** Desglose "2 subieron desde B0, 3 bajaron desde B2". */
	origenes: AperturaCuentasNuevasOrigen[];
}

/**
 * Un crédito que cambió de bucket hoy. Trae el contexto completo aunque la UI
 * muestre solo algunas columnas — así crecer la tabla no toca backend.
 */
export interface AperturaMovimiento {
	credito_id: number;
	numero_credito_sifco: string | null;
	cliente: string | null;
	bucket_anterior: number | null;
	bucket_nuevo: number;
	tipo_evento: "SUBIDA" | "BAJADA";
	/** Saltos de bucket del movimiento (B1→B3 = 2). */
	saltos: number;
	status_credito: string | null;
	cuotas_vencidas: number;
	monto_cuota: number;
	monto_mora: number;
	monto_adeudado: number;
	dias_mora: number;
	asesor_id: number | null;
	asesor: string | null;
	fecha: string;
}

/** Un crédito crítico dentro del top 3 de su bucket. */
export interface AperturaTop3Fila {
	credito_id: number;
	numero_credito_sifco: string | null;
	cliente: string | null;
	bucket: number;
	status_credito: string;
	cuotas_vencidas: number;
	monto_cuota: number;
	monto_mora: number;
	/** (cuotas_vencidas × monto_cuota) + monto_mora — el eje del ranking. */
	monto_adeudado: number;
	dias_mora: number;
	asesor_id: number | null;
	asesor: string | null;
}

export interface AperturaTop3Bucket {
	bucket: number;
	total_criticos: number;
	peor_monto: number;
	top: AperturaTop3Fila[];
}

/** Cumplimiento del día anterior (cuotas que vencían ayer). */
export interface AperturaCumplimiento {
	fecha: string;
	cuentas_esperadas: number;
	cuentas_pagadas: number;
	pct: number; // 0..100, nunca NaN
	monto_esperado: number;
	monto_pagado: number;
}

/**
 * Ingreso agregado al bucket del asesor: "2 cuentas entraron desde B1".
 * No distingue subida de bajada: para quien recibe, ambas son trabajo nuevo.
 */
export interface AperturaAsignacionBucket {
	desde: number | null;
	bucket: number; // destino (= bucket que atiende el asesor)
	cantidad: number;
}

/**
 * "Asignación del día": cuentas que le cayeron HOY a cada asesor por
 * transición de bucket. Es el DELTA del día, no el acumulado de carga — eso lo
 * responde CB-018 en /cobros/carga.
 */
export interface AperturaAsignacionAsesor {
	asesor_id: number | null;
	asesor: string | null;
	/** Cuentas que entraron hoy al bucket del asesor. */
	ingresos: number;
	/** Bucket(s) del pool del asesor (asesor_bucket): a qué está asignado a atender. */
	buckets_pool: number[];
	porBucket: AperturaAsignacionBucket[];
}

/** Payload de /buckets/apertura. */
export interface AperturaDiaResponse {
	fecha: string;
	cuentas_nuevas: AperturaCuentasNuevas[];
	cumplimiento: AperturaCumplimiento;
	top3: AperturaTop3Bucket[];
	asignacion: AperturaAsignacionAsesor[];
	/** Detalle crédito por crédito de los movimientos del día. */
	movimientos: AperturaMovimiento[];
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
	/**
	 * CB-027: plan de pagos del convenio (numero_cuota/fecha_vencimiento/
	 * fecha_pago). Anidado DENTRO de convenioActivo, no top-level en
	 * CreditoDirectoResponse — carteraFront ya espera este campo así
	 * (cardInfo.tsx, registerPayment.ts spread solo result.convenioActivo).
	 */
	cuotasConvenioMensuales?: CarteraConvenioCuota[];
}

/** Fila de `convenio_cuotas` — plan de pagos del convenio (CB-027). */
export interface CarteraConvenioCuota {
	cuota_convenio_id: number;
	convenio_id: number;
	numero_cuota: number;
	fecha_vencimiento: string;
	/** null = pendiente. */
	fecha_pago: string | null;
	created_at?: string | null;
}

/** Fila de `GET /payment-agreements/listado` (CB-027). */
export interface CarteraConvenioListado {
	convenio_id: number;
	credito_id: number;
	numero_credito_sifco: string;
	cliente_nombre: string;
	asesor_id: number | null;
	asesor_nombre: string | null;
	asesor_email: string | null;
	monto_total_convenio: string;
	cuota_mensual: string;
	numero_meses: number;
	monto_pagado: string;
	monto_pendiente: string;
	pagos_realizados: number;
	pagos_pendientes: number;
	fecha_convenio: string;
	activo: boolean;
	completado: boolean;
	motivo: string | null;
	/** monto_pagado / monto_total_convenio * 100, calculado en cartera-back. */
	progreso: string;
	/**
	 * Último bucket registrado en buckets_historial ANTES de que el crédito
	 * saliera del funnel por el convenio (misma fuente que `bucket_previo` de
	 * GET /buckets/credito/:sifco). null = sin traza en historial.
	 */
	bucket_previo: number | null;
	bucket_previo_prefijo: string | null;
}

export interface CreditoDirectoResponse {
	credito: CarteraCredito;
	contractSummary?: {
		originalPrincipal?: string | null;
		installment?: string | null;
	};
	usuario: CarteraUsuario;
	asesor: CarteraAsesorCredito | null;
	cuotasPagadas: CarteraCuotaCredito[];
	cuotasPendientes: CarteraCuotaCredito[];
	cuotasAtrasadas: CarteraCuotaCredito[];
	moraActual: string; // decimal viene como string
	mora?: CarteraMoraCredito | null;
	convenioActivo?: CarteraConvenio | null;
	// CB-128: el endpoint real /credito SÍ devuelve estos 3 campos (confirmado
	// contra registerPayment.ts de carteraFront, que los lee directo de
	// result.cuotaActual/cuotaActualPagada/cuotaActualStatus) — faltaban en
	// este tipo porque nadie los había necesitado hasta el resumen de "Registrar
	// pago". cuotaActual puede venir como número plano o como objeto de cuota
	// según el estado de migración del dato en cartera-back (mismo comentario
	// "antes era número, ahora es objeto" que carteraFront ya maneja).
	cuotaActual?: number | CarteraCuotaCredito;
	cuotaActualPagada?: boolean;
	cuotaActualStatus?: string | null;
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
	cuota?: string | null;
	validationStatus?: ValidationStatusEnum | null;
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
	/** numero_cuota real de la fila cuotas_credito (join en getAllPagosWithCreditAndInversionistas) — puede diferir de la cuota que el asesor pidió pagar cuando cartera-back cascadea el pago a otra cuota. */
	numero_cuota: number | null;
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
	/** userId del CRM (o identificador de quien registró) que mandó /newPayment — expuesto por /paymentByCredit desde CB-128. */
	registerBy?: string;
}

// CB-128: shape completo de `pagoSchema` en
// cartera-back/src/controllers/registerPayment.ts:65-82 — el subconjunto
// anterior (solo 5 campos) alcanzaba para el registro mínimo del bot de
// WhatsApp, pero el form "igual a carteraFront" de la Ficha 360 necesita que
// cartera-back reciba los mismos campos que recibe desde carteraFront
// (banco, origen de pago, boletas, abono a capital) para que corra la MISMA
// lógica de cálculo (mora → convenio → cuota, excedente, etc.) sin que el CRM
// la reimplemente.
export interface CreatePagoInput {
	/** numero_credito_sifco: se resuelve a credito_id server-side antes del POST. */
	credito_numero_sifco: string;
	credito_id: number;
	usuario_id: number;
	monto_boleta: number;
	fecha_pago: string; // ISO date string
	fecha_boleta: string; // ISO date string
	cuotaApagar: number;
	/** Requerido por cartera-back aunque venga vacío. */
	url_boletas: string[];
	otros?: number;
	abono_directo_capital?: number;
	banco_id?: number;
	origen_pago?: "transferencia" | "cheque" | "boleta";
	numeroAutorizacion?: string;
	observaciones?: string;
	registerBy: string;
	llamada?: string;
	renuevo_o_nuevo?: string;
	cuota_id?: number;
}

export interface ReversePagoInput {
	pago_id: number;
	credito_id: number;
}

/** GET /abonos-cuota/:sifco/:cuota — abonos parciales ya hechos a una cuota. */
export interface AbonosCuotaResponse {
	success: boolean;
	numero_credito_sifco: string;
	numero_cuota: number;
	total_pagos: number;
	abono_capital: string;
	abono_iva_12: string;
	abono_interes: string;
	membresias_pago: string;
	abono_seguro: string;
	abono_gps: string;
	/** Usados por getDisplayedPartialContribution (mismo cálculo que carteraFront). */
	cuota_cerrada: boolean;
	total_aplicado_cuota: string;
	saldo_pendiente: string;
	tiene_abono_parcial: boolean;
}

/** GET /promesas-pago/activa/:credito_id — null si no hay promesa vigente. */
export interface PromesaActivaCredito {
	id: number;
	credito_id: number;
	fecha_promesa: string;
	activa: boolean;
	[key: string]: unknown;
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
	// CB-128 (fix): /paymentByCredit expone el nombre PLANO en cada fila de
	// pagosInversionistas (confirmado en
	// cartera-back/src/controllers/payments.ts:225-231: `{...pi, nombre:
	// inversionistaInfo[...].nombre}`), no anidado dentro de `inversionista`
	// — ese campo objeto solo existe en otros endpoints. Leer
	// pi.inversionista?.nombre acá siempre daba undefined.
	nombre?: string;
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
	/** CB-020: días de SLA para contactar desde que el crédito entró a este bucket. null = sin SLA (B0). */
	dias_sla: number | null;
}

/** Bucket ACTUAL de un crédito según el motor (GET /buckets/credito/:numero_credito_sifco). */
export interface CarteraBucketActualCredito {
	credito_id: number;
	numero_credito_sifco: string;
	/** 0-5, o null si el crédito salió del funnel (ver `fuera_funnel`) o no se pudo derivar. */
	bucket: number | null;
	prefijo: string | null;
	nombre: string | null;
	color: string | null;
	estado_mora: string | null;
	/** true = statusCredit fuera del funnel (EN_CONVENIO/CANCELADO/CAIDO/...): sin bucket por diseño. */
	fuera_funnel: boolean;
	/**
	 * CB-026: fecha en que el crédito ENTRÓ al bucket actual (ISO), de la última
	 * fila de `buckets_historial`. null = el bucket se derivó por fallback
	 * (estado que lo fuerza / rango de cuotas) y no hay fecha de entrada
	 * confiable, o el crédito está fuera del funnel. Los consumidores deben
	 * degradar, nunca asumir una fecha: la gestión temprana B1 se cuenta desde
	 * acá y una fecha inventada produciría un falso "gestión agotada".
	 */
	fecha_entrada_bucket: string | null;
	/**
	 * CB-027: último bucket registrado en buckets_historial, SIN el filtro de
	 * fuera_funnel. Con convenio activo el motor deja de escribir transiciones
	 * (sale del funnel) — esta fila queda congelada en el bucket real previo a
	 * la salida. null = sin traza en historial.
	 */
	bucket_previo: number | null;
	bucket_previo_prefijo: string | null;
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
// CB-020 · COLA DEL DÍA — universo SLA (GET /buckets/cola-dia)
// ============================================================================

/**
 * Fila del universo SLA: un crédito del pool de buckets del asesor con la
 * fecha en que entró a su bucket ACTUAL (buckets_historial) + la fecha límite
 * derivada (fecha_entrada + dias_sla del bucket, día GT). El CRM cruza esto
 * contra sus propias promesas de pago (contactos_cobros) para clasificar la
 * cola en sus 3 categorías (SLA hoy / promesa hoy / incumplida).
 */
export interface CarteraColaDiaFila {
	credito_id: number;
	numero_credito_sifco: string;
	cliente: string;
	asesor_id: number;
	asesor: string;
	bucket: number;
	bucket_prefijo: string;
	bucket_nombre: string;
	dias_sla: number;
	fecha_entrada_bucket: string;
	/** YYYY-MM-DD, día GT. */
	fecha_limite_sla: string;
}

export interface CarteraColaDiaResponse {
	success: boolean;
	data: CarteraColaDiaFila[];
	page: number;
	perPage: number;
	total: number;
	totalPages: number;
}

export interface GetColaDiaSLAParams {
	asesorId?: number;
	/** Filtra por bucket(s) del catálogo (0-5). Omitir = todos los buckets con SLA. */
	buckets?: number[];
	page?: number;
	perPage?: number;
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
	/** Presentes solo cuando se pidió paginación (Agenda del día); el job no la usa. */
	page?: number;
	perPage?: number;
	totalPages?: number;
	data: CarteraCuotaProximaVencer[];
}

/**
 * COBROS-02 · Cuota de CONVENIO próxima a vencer (créditos EN_CONVENIO). Misma
 * forma que CarteraCuotaProximaVencer + el desglose del monto: en convenio el
 * cliente paga AMBAS el mismo día (cuota normal + cuota del convenio), así que
 * `monto_cuota` = TOTAL (normal + convenio) y se exponen las dos partes.
 * `cuota_id` es el cuota_convenio_id (para la idempotencia del recordatorio).
 */
export interface CarteraConvenioProximoVencer
	extends CarteraCuotaProximaVencer {
	/** Cuota normal del crédito (parte del total). */
	monto_normal: string;
	/** Cuota del convenio (parte del total). */
	monto_convenio: string;
}

export interface CarteraConvenioProximosResponse {
	success: boolean;
	total: number;
	data: CarteraConvenioProximoVencer[];
}

/**
 * CB-010: comportamiento de pago de un crédito activo — racha de cuotas ya
 * vencidas pagadas AL DÍA (fecha_pago <= vencimiento) desde la más reciente
 * hacia atrás hasta el primer atraso. Elegibilidad (racha >= 4) la decide el CRM.
 */
export interface CarteraComportamientoPago {
	credito_id: number;
	numero_credito_sifco: string;
	racha: number;
	ultima_cuota_evaluada: number;
	total_vencidas: number;
	/** Nombre del titular (de cartera.usuarios — completo para todo crédito). */
	cliente: string | null;
	/** Cuota mensual del crédito (decimal como string). */
	cuota_mensual: string;
	/** Próxima cuota sin pagar que vence (YYYY-MM-DD) o null si no hay. */
	proxima_fecha_pago: string | null;
}

export interface CarteraComportamientoPagoResponse {
	success: boolean;
	total: number;
	/** Presentes solo cuando se pidió paginación (el job recorre todas las páginas). */
	page?: number;
	perPage?: number;
	totalPages?: number;
	data: CarteraComportamientoPago[];
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
	/** true si al inversionista se le descuentan impuestos del interés. */
	descuenta_impuestos?: boolean;
	/** Interés neto de impuestos (interés × 0.93, solo ISR). Null cuando no descuenta impuestos. */
	total_neto_impuestos?: number | string | null;
	total_cuota?: string;
	total_a_recibir_sin_reinversion: string;
	total_reinversion: string;
	total_a_recibir_con_reinversion: string;
	boleta_pendiente: BoletaPagoInversionista | null;
	boleta_liquidacion?: BoletaPagoInversionista | null;
	estado_liquidacion_resumen?: "pending" | "uploaded" | "liquidated";
	reporte_liquidacion_url?: string | null;
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

/**
 * Resumen liviano de un crédito — `GET /credito/resumen` de cartera-back.
 *
 * Existe para el bot de WhatsApp: `CreditoDirectoResponse` trae el calendario
 * completo (~56 KB) y el bot necesita siete datos. Las reglas de negocio
 * —capital activo, cuotas atrasadas— se calculan en cartera, que es donde
 * viven. Ver `apps/cartera-back/src/controllers/resumenCredito.ts`.
 */
export interface ResumenCreditoResponse {
	numero_credito_sifco: string;
	credito_id: number;
	status_credito: string;
	/** Capital original del crédito. */
	capital: string;
	/** `capital - SUM(abono_capital)` sobre los pagos pagados. */
	capital_activo: string;
	cuota_mensual: string;
	plazo: number;
	cuotas_atrasadas: number;
	cuotas_pagadas: number;
	/** La más vieja sin pagar; si hay atraso, su fecha ya pasó. */
	cuota_actual: {
		numero: number;
		de: number;
		fecha_vencimiento: string;
		vencida: boolean;
	} | null;
	/** La próxima que TODAVÍA no vence. Distinta de `cuota_actual` con atraso. */
	proxima_fecha_pago: string | null;
	/** `null` si no tiene, o si su foto quedó vieja (ver `mora_por_confirmar`). */
	mora: {
		monto: string;
		porcentaje: string;
		cuotas_atrasadas: number;
	} | null;
	/** true = tiene mora activa pero su monto no es confiable en este momento. */
	mora_por_confirmar: boolean;
	convenio: {
		monto_total: string;
		monto_pagado: string;
		monto_pendiente: string;
		cuota_mensual: string;
		numero_meses: number;
		pagos_realizados: number;
		pagos_pendientes: number;
		fecha_convenio: string | null;
	} | null;
	aseguradora: string | null;
	numero_poliza: string | null;
	/** El asesor que lleva el crédito. `null` si no tiene asignado. */
	asesor: { nombre: string; telefono: string | null } | null;
}
