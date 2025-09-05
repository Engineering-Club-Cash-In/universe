/**
 * Interfaces para integraciones con SIFCO
 * Todas las request y response de los servicios
 */

/** ================================
 * Wrapper genérico para TODAS las respuestas
 * ================================
 */
export interface ServiceResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  statusCode: number;
}

/** ================================
 * WSClientesEmailConsulta
 * ================================
 */
export interface WSClientesEmailConsultaRequest {
  Email?: string; // opcional, SIFCO lo acepta vacío
}

export interface ClienteEmail {
  CodigoCliente: string;
  NombreCompleto: string;
  CodigoReferencia: string;
  DireccionEMailPrincipal: string;
  DireccionEMailSecundario: string;
  ExcluirDeMensajesDeCorreo: number;
}

export interface WSClientesEmailConsultaResponse {
  Clientes: ClienteEmail[];
}

/** ================================
 * WSVerPrestamosPorCliente
 * ================================
 */
export interface WSVerPrestamosPorClienteRequest {
  ClCliCod: number; // Código del cliente
}

export interface Prestamo {
  NumeroPrestamo: string;
}

export interface WSVerPrestamosPorClienteResponse {
  Prestamos: Prestamo[];
  Mensaje?: string;
}

/** ================================
 * TCrPrestamos/{PreNumero}
 * ================================
 * Detalle de un crédito
 */
export interface PrestamoDetalle {
  PreNumero: string;
  PreEmpCodigo: number;
  PreSucCodigo: number;
  PreSoCrNumero: string;
  PrePrdCod: number;
  PrePrdNombre: string;
  PrePrdTipo: number;
  ApColCod: number;
  ApColDes: string;
  ApColAport: string;
  ApColVeces: number;
  ApColMontMaximo: string;
  ApColTasaFoV: string;
  ApColFacPlazo: number;
  ApColPlazo: number;
  ApMonCod: number;
  ApMonNombre: string;
  ApMonSimbolo: string;
  ApColTMin: string;
  ApColTMax: string;
  ApColEstado: boolean;
  PreMonedaCod: number;
  PreMonedaNombre: string;
  PreMonedaSimbolo: string;
  ApColTCInt: number;
  ApColTCMora: number;
  ApColTNInt: string;
  ApColTNMora: string;
  ApColMes: number;
  ApColAno: number;
  PreCorrelativo: string;
  PreNombre: string;
  PreCliCod: string;
  PreCliNom: string;
  PreCliPromotor: string;
  PreDirCor: number;
  PreDirTipo: number;
  PreDirDir1: string;
  PrePrmCod: string;
  PrePrmNombre: string;
  PreAprCod: number;
  PreAprDes: string;
  PreAprLimites: string;
  PreAprMinimo: string;
  PreAprMaximo: string;
  PreGarCod: number;
  PreGarDes: string;
  ApOrgCod: number;
  ApOrgDes: string;
  PreFecAprobacion: string;
  PreFecConcesion: string;
  PreFecEscritura: string;
  PreGrDCod: number;
  PreGrDDes: string;
  PrePaiCod: number;
  PrePaiNom: string;
  PreRegCod: number;
  PreRegDes: string;
  PreDepCod: number;
  PreDepDes: string;
  PreMunCod: number;
  PreMunDes: string;
  PreMonOriginal: string;
  PreMonTotal: string;
  CupNumero: string;
  CupMonDisponible: string;
  CupFecVencimiento: string;
  CupDespVence: string;
  CupObligatorio: string;
  PreTasaFoV: string;
  PreTasaBase: string;
  PreBaseMora: string;
  PreSpreCorr: string;
  PreSpreMora: string;
  PreFacPlazo: number;
  PrePeriodoFrecuencia: string;
  PreNumeroPeriodos: number;
  PreFacPlazoDescripcion: string;
  PrePlazo: number;
  PreFecVencimiento: string;
  PreTipCom: number;
  PreFreCCod: number;
  PreFreCDes: string;
  PreFreCPeriodo: string;
  PreFreCNumeroPeriodos: number;
  PreFreICod: number;
  PreFreIDes: string;
  PreFreIPeriodo: string;
  PreFreINumeroPeriodos: number;
  PreFec1Cap: string;
  PreFec1Int: string;
  PreDiaPago: number;
  PreFreCPlanilla: number;
  PreFreDPlanilla: string;
  PreNumCuotas: number;
  PreValCuota: string;
  PreCuotaDefinidaUsuario: string;
  PreForDes: number;
  PrePrimerDesembolso: string;
  PreForPago: number;
  PreAsigBoleta: string;
  PreCtaNumero: string;
  PreCtaNombre: string;
  PreCtaEstado: number;
  PreCtaInactiva: string;
  ApCaCCod: number;
  ApCaCDes: string;
  ApEstCod: string;
  ApEstDes: string;
  PreFecModulo: string;
  PreFecAdicion: string;
  PreUsuCod: string;
  PreFecModificacion: string;
  PreUsuMod: string;
  PreFecPCap: string;
  PreFecPInt: string;
  PreFecUCap: string;
  PreFecUInt: string;
  PreMarDesembolsar: string;
  PreSusInts: string;
  PreFecSuspension: string;
  PreSalCapital: string;
  PreCapAtrasado: string;
  PreIntMes: string;
  PreIntAcumulado: string;
  PreIntVencido: string;
  PreIntAnticipado: string;
  PreIntMora: string;
  PreUltGar: number;
  PreUltPri: number;
  PreUltCam: string;
  PreUltAbo: string;
  PreNumCont: string;
  PreReferencia: string;
  PreAnulado: string;
  CrCiclo: number;
  CrDiasGracia: number;
  CrDiasPGracia: number;
  PreComentario: string;
  PreEstado: boolean;
  PreMensaje: number;
  PreTipoCredito: number;
  PreNumeroRefinanciamiento: string;
  PreNombreRefinanciamiento: string;
  PreMontoCapitalRefinanciamiento: string;
  PreMontoInteresRefinanciamiento: string;
  PreMontoOtrosRefinanciamiento: string;
  PreIntDevengado: string;
  PreReEstructuraEsOriginado: boolean;
  PreReEstructuraOrigen: string;
  PreReEstructuraEsOriginador: boolean;
  PreReEstructuraDestino: string;
  PreRefExterno: string;
  CrTasaRetInversion: string;
  CrCostoFinanciamiento: string;
  PreAseguradora: number;
  PreCarteraSaneadaEsOriginado: boolean;
  PreCarteraSaneadaOrigen: string;
  PreCarteraSaneadaEsOriginador: boolean;
  PreCarteraSaneadaDestino: string;
  PreCancelacionTipo: number;
  PrestamosInversionistasPromotorPorcentaje: string;
  PrestamosInversionistasAgentePorcentaje: string;
  PrestamosInversionistasContratoFlexible: boolean;
  gx_md5_hash: string;
}

/** ================================
 * WSVerCuotasPorPrestamo
 * ================================
 */
export interface WSVerCuotasPorPrestamoRequest {
  NumeroPrestamo: string;
}

export interface Cuota {
  CuotaNumero: number;
  CuotaFecha: string;
  CuotaDiasMora: number;
  CuotaMontoTotal?: string;
  CuotaMontoMoraPag?: string;
  CuotaSaldoMoraPen?: string;
}

export interface WSVerCuotasPorPrestamoResponse {
  Respuesta: {
    FechaSIFCO: string;
    FechaSistema: string;
    Cuotas: Cuota[];
    Mensaje: string;
  };
}
export type FormatoCredito = "Pool" | "Individual";

export interface CreditDataForInsert {
  usuario_id: number;
  otros: string;
  numero_credito_sifco: string;
  capital: string;
  porcentaje_interes: string;
  cuota_interes: string;
  cuota: string;
  deudatotal: string;
  seguro_10_cuotas: string;
  gps: string;
  observaciones: string;
  no_poliza: string;
  como_se_entero: string;
  asesor_id: number;
  plazo: string;                 // si lo manejas numérico, cambia a `string | number`
  iva_12: string;
  membresias_pago: string;
  membresias: string;
  formato_credito: FormatoCredito | string;
  porcentaje_royalti: string;
  royalti: string;
  tipoCredito: string;
  mora: string;
}

/** ================================
 * Recargos libres
 * ================================ 
 */
export interface WSRecargosLibresRequest {
  Modo: string; // Ejemplo: "DSP"
  numeroPrestamo: string;
  RecargosLibres: any[]; // Suele ir vacío []
}

export interface RecargoLibre {
  NumeroDePrestamo: string;
  NombreDePrestamo: string;
  CodigoDeSaldo: number;
  DescripcionCodigoDeSaldo: string;
  ValorDeSaldo: string;
  FechaProximoPago: string;
  FechaUltimoPago: string;
  ValorRecargoDefinidoPorUsuario: string;
  UsuarioQueActualizoElRecargo: string;
  FechaActualizacionDeRecargo: string;
  CuentaAcreditacionRecargoLibre: string;
  NombreCuentaAcreditacionRecargoLibre: string;
}

export interface WSRecargosLibresResponse {
  ConsultaResultados: RecargoLibre[];
  Messages: any[];
  Result: string;
}
/** ================================
 * Estado de Cuenta (WSCrEstadoCuenta)
 * ================================ 
 */
export interface WSCrEstadoCuentaRequest {
  NumeroPrestamo: string;
}

export interface OtroCargo {
  NumeroCuota: number;
  Monto: string;
  Abonado: string;
  Atrasado: string;
  Pagado: string;
  Saldo: number;
  SaldoDescripcion: string;
}

export interface PlanPagoCuota {
  Fecha: string;
  CapitalNumeroCuota: number;
  CapitalMonto: string;
  CapitalAbonado: string;
  CapitaAtrasado: string;
  CapitalPagado: string;
  CapitalSaldo: string;
  CapitalEstado: string;
  CapitalMovimiento: string;
  CapitalMoraMonto: string;
  CapitalMoraValorPagado: string;
  CapitalMoraPagada: string;
  CapitalMoraSaldo: string;
  CapitalMoraDias: number;
  InteresNumeroCuota: number;
  InteresMonto: string;
  InteresAbonado: string;
  InteresAtrasado: string;
  InteresPagado: string;
  InteresSaldo: string;
  InteresEstado: string;
  InteresMovimiento: string;
  InteresMoraMonto: string;
  InteresMoraValorPagado: string;
  InteresMoraPagada: string;
  InteresMoraSaldo: string;
  InteresMoraDias: number;
  OtrosMonto: string;
  Prestamo: string;
  Otros: OtroCargo[];
}
export interface EstadoCuentaDetalle {
  CrMoDeSalCod: number;      // Código del detalle (ej: 50, 59, 60...)
  ApSalDes: string;          // Descripción del detalle (CAPITAL, ROYALTY, etc.)
  CrMoDeValor: string;       // Valor en string (ej: "116059.23")
}

export interface EstadoCuentaTransaccion {
  CrMoNuMov: string;
  CrMoUsuCod: string;
  CrMoTrxCod: number;
  CrMoTrxDes: string;
  CrMoFeTrx: string;         // Fecha de transacción (YYYY-MM-DD)
  CrMoHoTrx: string;         // Hora de transacción (HH:mm:ss)
  CrMoFeVal: string;         // Fecha valor
  CrMoCoSup: string;
  CrMoEstado: number;
  CrMoFoPa: number;
  CrMoFoDesembolso: number;
  CrMoNuOrigen: string;
  CrMoParConta: string;
  BaCtaCod: number;
  BaTiMovCod: string;
  BaMovNum: string;
  BaBanNombre: string;
  CrMoReferencia: string;
  CrMoNumDoc: string;
  CapitalDesembolsado: string;
  CapitalPagado: string;
  Interes: string;
  InteresMoratorio: string;
  Otros: string;
  SaldoCapital: string;
  CrMoFacturaSerie: string;
  CrMoFacturaCorrelativo: string;
  CrMoDetalleFormaPago: string;
  CrMoDesembolsoDeduccionesPorcentajeBit: string;
  CrMoDesembolsoInstrucciones: string;
  EstadoCuenta_Detalles: EstadoCuentaDetalle[];
}
 
export interface WSCrEstadoCuentaResponse {
  ConsultaResultado: {
    PlanPagos_Cuotas: PlanPagoCuota[];
     EstadoCuenta_Transacciones: EstadoCuentaTransaccion[];
  };
}


export interface WSInformacionPrestamoRequest {
  ConsultaValorIdentificador: string;
}

export interface WSInformacionPrestamoResponse {
  NumeroPrestamo: string;
  CodigoEmpresa: number;
  CodigoSucursal: number;
  NumeroSolicitud: string;
  CodigoProducto: number;
  NombreProducto: string;
  TipoProducto: number;
  CodigoSubproducto: number;
  DescripcionSubproducto: string;
  CalculoAportaciones: string;                 // "N" | "S"
  CantidadVecesAportacion: number;             // 0.0000
  MontoMaxCredito: string;                     // "2000000.00"
  TasaFijaOVariable: string;                   // "L" | "F"
  FactorPlazo: number;
  PlazoMax: number;
  CodigoMoneda: number;
  NombreMoneda: string;
  SimboloMoneda: string;                       // "Q"
  TasaMinima: string;
  TasaMaxima: string;
  EstadoProducto: boolean;
  CodigoMonedaCredito: number;
  NombreMonedaCredito: string;
  SimboloMonedaCredito: string;
  TasaInteresCorriente: number;
  TasaInteresMora: number;
  NombreTasaInteresCorriente: string;
  NombreTasaInteresMora: string;
  CalculoTipoMes: number;
  CalculoTipoAno: number;
  CorrelativoPrestamo: string;
  NombrePrestamo: string;
  CodigoCliente: string;
  NombreCliente: string;
  ClienteNumeroReferencia: string;
  ClienteIdentificacion: string;
  PromotorCliente: string;
  CorrelativoDireccionCliente: number;
  TipoDireccion: number;
  DireccionPrestamo: string;
  CodigoPromotor: string;
  NombrePromotor: string;
  CodigoAprobacion: number;
  DescripcionAprobacion: string;
  LimitesAprobacion: string;
  MontoMinAprobacion: string;
  MontoMaxAprobacion: string;
  CodigoGarantia: number;
  DescripcionGarantia: string;
  CodigoOrigenFondos: number;
  DescripcionOrigenFondos: string;
  FechaAprobacion: string;                     // "YYYY-MM-DD"
  FechaConcesion: string;
  FechaEscrituracion: string;
  CodigoDivisionDestino: number;
  DescripcionDivisionDestino: string;
  CodigoPais: number;
  NombrePais: string;
  CodigoRegion: number;
  DescripcionRegion: string;
  CodigoDepartamento: number;
  DescripcionDepartamento: string;
  CodigoMunicipio: number;
  DescripcionMunicipio: string;
  MontoOriginal: string;
  MontoOtorgado: string;
  NumeroCupo: string;
  MontoDisponibleCupo: string;
  FechaVenciminetoCupo: string;                // ojo: viene así en WS
  CambioDespuesVencimientoCupo: string;
  CupoObligatorio: string;
  TipoTasa: string;                            // "F" | "L"
  TasaBase: string;
  TasaBaseMora: string;
  TasaSpreadInteres: string;
  TasaSpreadIntXMora: string;
  FactorDelPlazo: number;
  PeriodoFrecuencia: string;                   // "M"
  NumeroPeriodos: number;
  DescripcionFactorPlazo: string;
  PlazoPrestamo: number;
  FechaVencimiento: string;                    // "YYYY-MM-DD"
  TipoCompromiso: number;
  FrecuenciaPagoCapital: number;
  DescripcionFrecuenciaCapital: string;
  TipoPeriodoFrecuenciaCap: string;
  NumeroPeriodosFrecuenciaCap: number;
  FrecuenciaPagoInteres: number;
  DescripcionFrecuenciaPagoInt: string;
  TipoPeriodoFrecuenciaInteres: string;
  NumeroPeriodosFrecuenciaInt: number;
  FechaPrimerPagoCapital: string;
  FechaPrimerPagoInteres: string;
  DiaPago: number;
  FrecuenciaPagoPlanilla: number;
  DescripcionFrecuenciaPagoPlanilla: string;
  NumeroCuotas: number;
  ValorCuota: string;
  CuotaDefinidaPorUsuario: string;
  FormaDesembolso: number;
  FechaPrimerDesembolso: string;
  FormaPago: number;
  AsignaBoletaSiONo: string;                   // "N" | "S"
  NumeroCuenta: string;
  NombreCuenta: string;
  EstadoActualCuenta: number;
  CuentaActivaOInactiva: string;
  CodigoCategoria: number;
  DescripcionCategoria: string;
  CodigoEstado: string;
  DescripcionEstado: string;
  FechaModulo: string;
  FechaIngreso: string;
  CodigoUsuario: string;
  FechaModificacion: string;
  UsuarioModificador: string;
  ProximaFechaPagoCapital: string;
  ProximaFechaPagoInteres: string;
  UltimaFechaPagoCapital: string;
  UltimaFechaPagoInteres: string;
  MargenPorDesembolsar: string;
  InteresSuspension: string;                   // "N" | "S"
  FechaInteresSuspension: string;
  SaldoCapital: string;
  CapitalAtrasado: string;
  InteresMes: string;
  InteresAcumulado: string;
  InteresVencido: string;
  InteresAnticipado: string;
  InteresMoratorio: string;
  UltimoCorrelativoGarantia: number;
  UltimoCorrelativoPrimaSeguro: number;
  UltimoCorrelativoCambio: string;
  UltimoAbonoExtraordinario: string;
  NumeroContrato: string;
  ReferenciaPrestamo: string;
  PrestamoAnulado: string;
  CicloPrestamoGrupal: number;
  DiasGraciaOtorgados: number;
  DiasGraciaPendiente: number;
  Comentario: string;
  EstadoPrestamo: boolean;
  CodigoMensaje: number;
  TipoCredito: number;
  NumeroRefinanciamiento: string;
  NombreRefinanciamiento: string;
  MontoCapitalRefinanciamiento: string;
  MontoInteresRefinanciamiento: string;
  MontoOtrosRefinanciamiento: string;
  MontoInteresDevengado: string;
  ReestructuraOriginado: boolean;
  ReestructuraOrigen: string;
  ReestructuraOriginador: boolean;
  ReestructuraDestino: string;
  ReferenciaExterna: string;
}