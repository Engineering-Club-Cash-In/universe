import axios from "axios";

const API_BASE = process.env.CREDITOS_API_URL;

if (!API_BASE) {
  throw new Error("[ERROR] CREDITOS_API_URL is not set in env");
}

export class CreditosApiService {
  // GET /api/creditos/:id
  static async obtenerCredito(creditoId: string) {
    const url = `${API_BASE}/${creditoId}`;
    const res = await axios.get(url);
    return res.data;
  }

  // GET /api/creditos/cliente/:clienteId
  static async obtenerCreditosCliente(clienteId: string) {
    const url = `${API_BASE}/cliente/${clienteId}`;
    const res = await axios.get(url);
    return res.data;
  }

  // GET /api/creditos?estado=...&sucursal=...&limite=...&pagina=...
  static async listarCreditos(params: any = {}) {
    const url = `${API_BASE}`;
    const res = await axios.get(url, { params });
    return res.data;
  }

  // POST /api/creditos/simular
  static async simularCredito(data: any) {
    const url = `${API_BASE}/simular`;
    const res = await axios.post(url, data);
    return res.data;
  }

  // POST /api/creditos/solicitud
  static async crearSolicitud(data: any) {
    const url = `${API_BASE}/solicitud`;
    const res = await axios.post(url, data);
    return res.data;
  }

  // PUT /api/creditos/:id
  static async actualizarCredito(creditoId: string, data: any) {
    const url = `${API_BASE}/${creditoId}`;
    const res = await axios.put(url, data);
    return res.data;
  }

  // POST /api/creditos/aprobar/:id
  static async aprobarCredito(creditoId: string, data: any) {
    const url = `${API_BASE}/aprobar/${creditoId}`;
    const res = await axios.post(url, data);
    return res.data;
  }

  // POST /api/creditos/rechazar/:id
  static async rechazarCredito(creditoId: string, data: any) {
    const url = `${API_BASE}/rechazar/${creditoId}`;
    const res = await axios.post(url, data);
    return res.data;
  }

  // POST /api/creditos/desembolsar/:id
  static async desembolsarCredito(creditoId: string, data: any) {
    const url = `${API_BASE}/desembolsar/${creditoId}`;
    const res = await axios.post(url, data);
    return res.data;
  }

  // GET /api/creditos/estado-cuenta/:id
  static async obtenerEstadoCuenta(creditoId: string) {
    const url = `${API_BASE}/estado-cuenta/${creditoId}`;
    const res = await axios.get(url);
    return res.data;
  }

  // POST /api/creditos/pago
  static async registrarPago(data: any) {
    const url = `${API_BASE}/pago`;
    const res = await axios.post(url, data);
    return res.data;
  }

  // GET /api/creditos/amortizacion/:id
  static async obtenerTablaAmortizacion(creditoId: string) {
    const url = `${API_BASE}/amortizacion/${creditoId}`;
    const res = await axios.get(url);
    return res.data;
  }

  // GET /api/creditos/pagos/:id
  static async obtenerHistorialPagos(creditoId: string) {
    const url = `${API_BASE}/pagos/${creditoId}`;
    const res = await axios.get(url);
    return res.data;
  }

  // POST /api/creditos/cuotas-por-prestamo
  static async verCuotasPorPrestamo(numeroPrestamo: string) {
    const url = `${API_BASE}/cuotas-por-prestamo`;
    const res = await axios.post(url, { numeroPrestamo });
    return res.data;
  }

  // GET /api/creditos/mora/:id
  static async calcularMora(creditoId: string, fechaCorte?: string) {
    const url = `${API_BASE}/mora/${creditoId}`;
    const res = await axios.get(url, { params: fechaCorte ? { fechaCorte } : undefined });
    return res.data;
  }

  // POST /api/creditos/reestructurar/:id
  static async reestructurarCredito(creditoId: string, data: any) {
    const url = `${API_BASE}/reestructurar/${creditoId}`;
    const res = await axios.post(url, data);
    return res.data;
  }

  // GET /api/creditos/:id/garantias
  static async obtenerGarantias(creditoId: string) {
    const url = `${API_BASE}/${creditoId}/garantias`;
    const res = await axios.get(url);
    return res.data;
  }

  // POST /api/creditos/:id/garantias
  static async agregarGarantia(creditoId: string, data: any) {
    const url = `${API_BASE}/${creditoId}/garantias`;
    const res = await axios.post(url, data);
    return res.data;
  }
}
