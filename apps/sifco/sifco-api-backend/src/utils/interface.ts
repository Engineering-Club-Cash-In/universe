export interface WSVerPrestamosPorClienteRequest {
  ClCliCod: number; // Código del cliente
}

export interface Prestamo {
  NumeroPrestamo: string;
  // aquí puedes ir agregando más campos según lo que devuelva el WS
}

export interface WSVerPrestamosPorClienteResponse {
  Prestamos: Prestamo[];
  Mensaje?: string;
}

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

export interface WSVerCuotasPorPrestamoRequest {
  NumeroPrestamo: string;
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

export interface WSRecargosLibresRequest {
  Modo: string; // Ejemplo: "DSP"
  ConsultaNumeroPrestamo: string;
  RecargosLibres: any[];
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

export interface WSCrEstadoCuentaResponse {
  ConsultaResultado: {
    PlanPagos_Cuotas: PlanPagoCuota[];
  };
}


// utils/interface.ts  (o donde tengas tus tipos compartidos)
export interface WSInformacionPrestamoRequest {
  /** Valor por el que SIFCO hace la consulta (ej. PreNumero) */
  ConsultaValorIdentificador: string;
}

/** Respuesta tipada con los campos que devuelve SIFCO */
export interface PrestamoInformacion {
  PreNumero: string;
  PreEmpCodigo: number;
  PreSucCodigo: number;
  PreSoCrNumero: string;
  PrePrdCod: number;
  PrePrdNombre: string;
  PrePrdTipo: number;
  ApColCod: number;
  ApColDes: string;
  ApColAport: string;               // "N" | "S"
  ApColVeces: number;
  ApColMontMaximo: string;          // "2000000.00"
  ApColTasaFoV: string;             // "L" | "F"
  ApColFacPlazo: number;
  ApColPlazo: number;
  ApMonCod: number;
  ApMonNombre: string;
  ApMonSimbolo: string;             // "Q"
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
  PreFecAprobacion: string;         // "YYYY-MM-DD"
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
  CupFecVencimiento: string;        // "0000-00-00" posible
  CupDespVence: string;
  CupObligatorio: string;
  PreTasaFoV: string;               // "F" | "L"
  PreTasaBase: string;
  PreBaseMora: string;
  PreSpreCorr: string;
  PreSpreMora: string;
  PreFacPlazo: number;
  PrePeriodoFrecuencia: string;     // "M"
  PreNumeroPeriodos: number;
  PreFacPlazoDescripcion: string;
  PrePlazo: number;
  PreFecVencimiento: string;        // "YYYY-MM-DD"
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
  PreSusInts: string;               // "N" | "S"
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

/** Wrapper estándar de tu BaseService */
export interface WSInformacionPrestamoResponse {
  success: boolean;
  data?: PrestamoInformacion;
  error?: string;
  statusCode?: number;
}
