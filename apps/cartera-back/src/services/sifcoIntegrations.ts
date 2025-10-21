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
  // 🧹 Limpiar el número
  const cleanPreNumero = preNumero
    .trim()
    .replace(/\s+/g, "")
    .replace(/[^0-9]/g, "");
  
  console.log(`🔍 Consultando: ${cleanPreNumero}`);
  
  try {
    const { data } = await sifcoApi.get<ServiceResponse<PrestamoDetalle>>(
      `/api/creditos/uniqueCreditByNumber/${cleanPreNumero}`,
      {
        timeout: 10000, // 🔥 Timeout de 10 segundos
      }
    );

    return data.data;
  } catch (error: any) {
    // 🔥 Manejar errores específicos
    if (error.code === 'ECONNREFUSED') {
      console.warn(`⚠️ Servidor SIFCO no disponible para: ${cleanPreNumero}`);
      return null;
    }
    
    if (error.response?.status === 404) {
      console.warn(`⚠️ Crédito no existe en SIFCO: ${cleanPreNumero}`);
      return null;
    }

    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      console.warn(`⏱️ Timeout al consultar: ${cleanPreNumero}`);
      return null;
    }

    // Re-lanzar otros errores
    console.error(`❌ Error inesperado para ${cleanPreNumero}:`, error.message);
    throw error;
  }
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