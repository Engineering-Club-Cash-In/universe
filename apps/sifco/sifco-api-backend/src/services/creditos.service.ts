import { BaseService, ServiceResponse } from './base.service';

export interface Credito {
  id?: string;
  numeroCredito?: string;
  clienteId: string;
  tipoCredito: string;
  monto: number;
  montoAprobado?: number;
  tasaInteres: number;
  plazo: number;
  frecuenciaPago: string;
  estado?: string;
  fechaSolicitud?: string;
  fechaAprobacion?: string;
  fechaDesembolso?: string;
  fechaVencimiento?: string;
  saldoCapital?: number;
  saldoInteres?: number;
  saldoMora?: number;
  cuotasPagadas?: number;
  cuotasPendientes?: number;
  garantias?: any[];
  sucursal?: string;
  oficial?: string;
}

export interface SimulacionCredito {
  tipoCredito: string;
  monto: number;
  tasaInteres: number;
  plazo: number;
  frecuenciaPago: string;
  fechaInicio?: string;
  incluirSeguro?: boolean;
}

export interface ResultadoSimulacion {
  montoSolicitado: number;
  tasaInteres: number;
  plazo: number;
  cuotaMensual: number;
  totalIntereses: number;
  totalPagar: number;
  tablaAmortizacion?: AmortizacionDetalle[];
}

export interface AmortizacionDetalle {
  numeroCuota: number;
  fechaPago: string;
  capital: number;
  interes: number;
  cuota: number;
  saldoRestante: number;
}

export interface PagoCredito {
  PreNumero: string; // Número del préstamo/crédito
  Fecha: string; // Fecha del pago (formato: YYYY-MM-DD)
  NumeroCuotas: number; // Número de cuotas a pagar
  Monto: number; // Monto a pagar
  PagadoBoleta: string; // 'S' o 'N' - Indica si fue pagado con boleta
  BaCtaCod?: number; // Código de cuenta bancaria (opcional, default: 0)
  NumeroDeposito?: number; // Número de depósito bancario (opcional, default: 0)
  Referencia?: string; // Referencia o explicación del pago
}

export interface EstadoCuenta {
  creditoId: string;
  numeroCredito: string;
  cliente: string;
  montoOriginal: number;
  saldoCapital: number;
  saldoInteres: number;
  saldoMora: number;
  saldoTotal: number;
  proximoPago: {
    fecha: string;
    monto: number;
    numeroCuota: number;
  };
  historialPagos: any[];
  cuotasPendientes: any[];
}

export class CreditosService extends BaseService {
  /**
   * Obtener información de un crédito por ID
   */
  async obtenerCredito(creditoId: string): Promise<ServiceResponse<Credito>> {
    console.log(`💰 Fetching credit: ${creditoId}`);
    return this.request<Credito>('GET', `WSCreditos/${creditoId}`);
  }

  /**
   * Obtener créditos de un cliente
   */
  async obtenerCreditosCliente(clienteId: string): Promise<ServiceResponse<Credito[]>> {
    console.log(`📊 Fetching credits for client: ${clienteId}`);
    return this.request<Credito[]>('GET', `WSCreditos/Cliente/${clienteId}`);
  }

  /**
   * Listar todos los créditos con filtros
   */
  async listarCreditos(filtros?: {
    estado?: string;
    sucursal?: string;
    oficial?: string;
    fechaDesde?: string;
    fechaHasta?: string;
    limite?: number;
    pagina?: number;
  }): Promise<ServiceResponse<Credito[]>> {
    console.log('📑 Listing credits with filters:', filtros);
    return this.request<Credito[]>('GET', 'WSCreditos', null, filtros);
  }

  /**
   * Simular un crédito
   */
  async simularCredito(parametros: SimulacionCredito): Promise<ServiceResponse<ResultadoSimulacion>> {
    console.log('🧮 Simulating credit:', parametros);
    return this.request<ResultadoSimulacion>('POST', 'WSCreditosSimulacion', parametros);
  }

  /**
   * Crear solicitud de crédito
   */
  async crearSolicitud(datosCredito: Credito): Promise<ServiceResponse<Credito>> {
    console.log('📝 Creating credit application for client:', datosCredito.clienteId);
    return this.request<Credito>('POST', 'WSCreditosSolicitud', datosCredito);
  }

  /**
   * Actualizar información de un crédito
   */
  async actualizarCredito(
    creditoId: string,
    datosActualizacion: Partial<Credito>
  ): Promise<ServiceResponse<Credito>> {
    console.log(`✏️ Updating credit: ${creditoId}`);
    return this.request<Credito>('PUT', `WSCreditosActualizar/${creditoId}`, datosActualizacion);
  }

  /**
   * Aprobar crédito
   */
  async aprobarCredito(
    creditoId: string,
    datosAprobacion: {
      montoAprobado: number;
      observaciones?: string;
      condiciones?: string;
    }
  ): Promise<ServiceResponse<any>> {
    console.log(`✅ Approving credit: ${creditoId}`);
    return this.request('POST', `WSCreditosAprobar/${creditoId}`, datosAprobacion);
  }

  /**
   * Rechazar crédito
   */
  async rechazarCredito(
    creditoId: string,
    motivo: string
  ): Promise<ServiceResponse<any>> {
    console.log(`❌ Rejecting credit: ${creditoId}`);
    return this.request('POST', `WSCreditosRechazar/${creditoId}`, { motivo });
  }

  /**
   * Desembolsar crédito
   */
  async desembolsarCredito(
    creditoId: string,
    datosDesembolso: {
      cuentaDestino: string;
      formaDesembolso: string;
      observaciones?: string;
    }
  ): Promise<ServiceResponse<any>> {
    console.log(`💸 Disbursing credit: ${creditoId}`);
    return this.request('POST', `WSCreditosDesembolsar/${creditoId}`, datosDesembolso);
  }

  /**
   * Obtener estado de cuenta de un crédito
   */
  async obtenerEstadoCuenta(creditoId: string): Promise<ServiceResponse<EstadoCuenta>> {
    console.log(`📋 Fetching account statement for credit: ${creditoId}`);
    return this.request<EstadoCuenta>('GET', `WSCreditosEstadoCuenta/${creditoId}`);
  }

  /**
   * Registrar pago de crédito
   * Web Service: WSCrPago
   * Permite realizar el pago de un crédito en SIFCO WEB
   */
  async registrarPago(datosPago: PagoCredito): Promise<ServiceResponse<{ Resultado: string }>> {
    console.log(`💵 Registering payment for credit: ${datosPago.PreNumero}`);
    
    // Establecer valores por defecto si no se proporcionan
    const payload = {
      PreNumero: datosPago.PreNumero,
      Fecha: datosPago.Fecha,
      NumeroCuotas: datosPago.NumeroCuotas,
      Monto: datosPago.Monto,
      PagadoBoleta: datosPago.PagadoBoleta || 'N',
      BaCtaCod: datosPago.BaCtaCod || 0,
      NumeroDeposito: datosPago.NumeroDeposito || 0,
      Referencia: datosPago.Referencia || ''
    };
    
    return this.request('POST', 'WSCrPago', payload);
  }

  /**
   * Obtener tabla de amortización
   */
  async obtenerTablaAmortizacion(creditoId: string): Promise<ServiceResponse<AmortizacionDetalle[]>> {
    console.log(`📊 Fetching amortization table for credit: ${creditoId}`);
    return this.request<AmortizacionDetalle[]>('GET', `WSCreditosAmortizacion/${creditoId}`);
  }

  /**
   * Obtener historial de pagos
   */
  async obtenerHistorialPagos(creditoId: string): Promise<ServiceResponse<any[]>> {
    console.log(`📜 Fetching payment history for credit: ${creditoId}`);
    return this.request<any[]>('GET', `WSCreditosPagos/${creditoId}`);
  }

  /**
   * Ver cuotas por préstamo
   * Web Service: WSVerCuotasPorPrestamo
   * Consulta las cuotas de un préstamo y la mora total, pagada y pendiente
   */
  async verCuotasPorPrestamo(numeroPrestamo: string): Promise<ServiceResponse<{
    Respuesta: {
      FechaSIFCO: string;
      FechaSistema: string;
      Cuotas: Array<{
        CuotaNumero: number;
        CuotaFecha: string;
        CuotaDiasMora: number;
        CuotaMontoMoraTot: string;
        CuotaMontoMoraPag: string;
        CuotaSaldoMoraPen: string;
      }>;
    };
    Mensaje: string;
  }>> {
    console.log(`📋 Fetching installments for loan: ${numeroPrestamo}`);
    return this.request('POST', 'WSVerCuotasPorPrestamo', { NumeroPrestamo: numeroPrestamo });
  }

  /**
   * Calcular mora de un crédito
   */
  async calcularMora(creditoId: string, fechaCorte?: string): Promise<ServiceResponse<{
    diasMora: number;
    montoMora: number;
    cuotasEnMora: number;
  }>> {
    console.log(`⚠️ Calculating late fees for credit: ${creditoId}`);
    return this.request('GET', `WSCreditosMora/${creditoId}`, null, { fechaCorte });
  }

  /**
   * Reestructurar crédito
   */
  async reestructurarCredito(
    creditoId: string,
    datosReestructuracion: {
      nuevoPlazo: number;
      nuevaTasa?: number;
      motivoReestructuracion: string;
    }
  ): Promise<ServiceResponse<any>> {
    console.log(`🔄 Restructuring credit: ${creditoId}`);
    return this.request('POST', `WSCreditosReestructurar/${creditoId}`, datosReestructuracion);
  }

  /**
   * Obtener garantías de un crédito
   */
  async obtenerGarantias(creditoId: string): Promise<ServiceResponse<any[]>> {
    console.log(`🏠 Fetching guarantees for credit: ${creditoId}`);
    return this.request<any[]>('GET', `WSCreditos/${creditoId}/Garantias`);
  }

  /**
   * Agregar garantía a un crédito
   */
  async agregarGarantia(
    creditoId: string,
    garantia: {
      tipo: string;
      descripcion: string;
      valor: number;
      ubicacion?: string;
    }
  ): Promise<ServiceResponse<any>> {
    console.log(`➕ Adding guarantee to credit: ${creditoId}`);
    return this.request('POST', `WSCreditos/${creditoId}/Garantias`, garantia);
  }
}