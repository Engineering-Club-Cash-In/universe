import axios from "axios";
import {
  ServiceResponse,
  WSClientesEmailConsultaRequest,
  WSClientesEmailConsultaResponse,
  WSVerPrestamosPorClienteRequest,
  WSVerPrestamosPorClienteResponse,
  PrestamoDetalle,
  WSVerCuotasPorPrestamoRequest,
  WSVerCuotasPorPrestamoResponse,
  WSRecargosLibresRequest,
  WSRecargosLibresResponse,
  WSCrEstadoCuentaResponse,
  WSCrEstadoCuentaRequest,
  WSInformacionPrestamoRequest,
  WSInformacionPrestamoResponse,
} from "./sifco.interface";

/**
 * Axios client para consumir SIFCO
 */
const sifcoApi = axios.create({
  baseURL: process.env.SIFCO_URL || "http://localhost:9000",
  headers: {
    "Content-Type": "application/json",
    Authorization: `OAuth ${process.env.SIFCO_TOKEN}`,
    "Genexus-Agent": "SmartDevice Application",
  },
});

/** ================================
 * Consultar clientes por email (email opcional)
 * ================================
 */
export async function consultarClientesPorEmail() {
  const request: WSClientesEmailConsultaRequest = { Email: "" };

  const { data } = await sifcoApi.post<
    ServiceResponse<WSClientesEmailConsultaResponse>
  >("/api/clientes/consultar-email", request); 

  return data.data; // 👈 devolvemos WSClientesEmailConsultaResponse
}

/** ================================
 * Consultar préstamos de un cliente
 * ================================
 */
export async function consultarPrestamosPorCliente(clienteCodigo: number) {
  // 👇 Usar la misma key que espera el backend (camelCase)
  const request = { clienteCodigo };

  const { data } = await sifcoApi.post<
    ServiceResponse<WSVerPrestamosPorClienteResponse>
  >("/api/clientes/prestamos", request);

  return data.data;
}

/** ================================
 * Consultar detalle de un préstamo
 * ================================
 */
export async function consultarPrestamoDetalle(preNumero: string) {
  const { data } = await sifcoApi.get<ServiceResponse<PrestamoDetalle>>(
    `/api/creditos/uniqueCreditByNumber/${preNumero}`
  );

  // Devolvemos solo la data útil
  return data.data;
}
/** ================================
 * Consultar cuotas de un préstamo
 * ================================
 */
export async function consultarCuotasPorPrestamo(numeroPrestamo: string) {
  const request: WSVerCuotasPorPrestamoRequest = { NumeroPrestamo: numeroPrestamo };

  const { data } = await sifcoApi.post<
    ServiceResponse<WSVerCuotasPorPrestamoResponse>
  >("/api/creditos/cuotas", request);

  return data.data;
}
/** ================================
 * Consultar recargos libres de un préstamo
 * ================================ 
 */

export async function consultarRecargosLibres(
  numeroPrestamo: string
): Promise<WSRecargosLibresResponse | null> {
  console.log("📢 Consultando recargos libres para:", numeroPrestamo);

  const requestBody: WSRecargosLibresRequest = {
    Modo: "DSP",
    numeroPrestamo: numeroPrestamo,
    RecargosLibres: []
  };

  try {
    const { data } = await sifcoApi.post<
      ServiceResponse<WSRecargosLibresResponse>
    >("/api/creditos/recargos", requestBody);
 

    if (data.success && data.data) {
      return data.data;
    }

    console.warn("⚠️ No se obtuvo respuesta válida de recargos libres");
    return null;
  } catch (err: any) {
    console.error("❌ Error en consultarRecargosLibres:", err.response?.data || err.message || err);
    return null;
  }
}

/** ================================
 * Consultar estado de cuenta de un préstamo
 * ================================ 
 */
export async function consultarEstadoCuentaPrestamo(numeroPrestamo: string) {
  const request: WSCrEstadoCuentaRequest = { numeroPrestamo: numeroPrestamo };

  const { data } = await sifcoApi.post<
    ServiceResponse<WSCrEstadoCuentaResponse>
  >("/api/creditos/estado-cuenta", request); 
  return data.data; // 👈 devolvemos WSCrEstadoCuentaResponse
}
/** ================================
 * Consultar información del préstamo (WSInformacionPrestamo)
 * Body: { ConsultaValorIdentificador: "<PreNumero u otro identificador>" }
 * ================================ 
 */
export async function consultarInformacionPrestamo(identificador: string) {
  const request: WSInformacionPrestamoRequest = {
    ConsultaValorIdentificador: identificador,
  };

  const { data } = await sifcoApi.post<
    ServiceResponse<WSInformacionPrestamoResponse>
  >("/api/creditos/informacion", request);

  console.log("🧾 Respuesta informacion prestamo:", data);

  return data.data; // 👈 devolvemos WSInformacionPrestamoResponse
}