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
  WSBuscarClientesRequest,
  ClienteIdentificacion,
} from "./sifco.interface";
import { exigirRespuestaExitosa } from "./sifcoRespuesta";

/**
 * Axios client para consumir SIFCO
 */
const sifcoApi = axios.create({
  baseURL:  "http://localhost:9500",
  // Sin timeout explícito, axios espera para siempre: una pasarela colgada deja
  // la petición viva hasta que el cliente de arriba se rinda.
  //
  // 🔴 30s y no menos: la pasarela le da 25s al core, así que cortar antes
  // mataría respuestas VÁLIDAS pero lentas —las de los caminos por lote, sync y
  // migración, que son los que llegan a esos tiempos— y las convertiría en un
  // error que no existió. Esto es el techo de los lotes, no el presupuesto de
  // nadie más.
  //
  // El camino interactivo pide lo suyo aparte: el gate de mora del CRM tiene a
  // un asesor esperando en pantalla y no espera lotes, así que sus dos llamadas
  // (`buscarClientesPorIdentificacion` y el `consultarPrestamosPorCliente` que
  // hace `consultaMora.ts`) pasan un timeout explícito: 10s de cota, y nunca
  // más de lo que le quede al presupuesto global de la consulta.
  timeout: 30000,
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
 * Buscar clientes por número de identificación (DPI)
 * ================================
 * Único camino DPI → código de cliente: ni `cartera.usuarios` ni el espejo
 * `sifco.clientes` guardan identificación, así que la resolución solo la sabe
 * hacer el core. Del otro lado esto se traduce en un WSIngresarClientes
 * `{ Modo: "DSP", ConsultaFormaIdentificar: 2, ConsultaValorIdentificador }`,
 * cuya respuesta viene en `ConsultaResultados`.
 *
 * Lanza si la consulta no se pudo hacer (red, 4xx/5xx, y por las dudas
 * `success: false`; ver `exigirRespuestaExitosa`); un DPI desconocido devuelve
 * arreglo vacío. Quien llama DEBE distinguir los dos casos: confundirlos
 * convierte una caída de SIFCO en un "no tiene mora".
 */
export async function buscarClientesPorIdentificacion(
  numeroIdentificacion: string,
  // `timeoutMs` es opcional y por omisión manda el mismo 10s de siempre. Lo
  // pasa quien tiene a alguien esperando y un presupuesto que repartir: el gate
  // de mora acota este viaje contra lo que le queda de su presupuesto global
  // (ver `PRESUPUESTO_NUMEROS_GATE_MS`), igual que hace con
  // `consultarPrestamosPorCliente`.
  timeoutMs = 10000
): Promise<ClienteIdentificacion[]> {
  const request: WSBuscarClientesRequest = { numeroIdentificacion };

  const { data } = await sifcoApi.post<ServiceResponse<ClienteIdentificacion[]>>(
    "/api/clientes/buscar",
    request,
    { timeout: timeoutMs }
  );

  const encontrados = exigirRespuestaExitosa(
    data,
    "SIFCO no pudo resolver la identificación"
  );

  // Defensa en profundidad sobre la misma regla del gateway: sin lista no hay
  // "DPI desconocido", hay respuesta que no se entiende. El `?? []` de antes
  // convertía eso en cliente nuevo y dejaba pasar la solicitud.
  if (!Array.isArray(encontrados)) {
    throw new Error(
      "SIFCO respondió sin la lista de clientes al resolver la identificación"
    );
  }

  return encontrados;
}

/** ================================
 * Consultar préstamos de un cliente
 * ================================
 *
 * Lanza si `success` viene en `false`, igual que
 * `buscarClientesPorIdentificacion`: las dos pasan por `exigirRespuestaExitosa`,
 * donde está explicado por qué es defensa en profundidad y no el cierre de un
 * agujero vivo. Un cliente sin préstamos sigue devolviendo la respuesta con la
 * lista vacía.
 *
 * `timeoutMs` es opcional y por omisión manda el del cliente (30s, el techo de
 * los lotes). Lo pasa quien tiene a alguien esperando: el gate de mora llama con
 * 10s desde `consultaMora.ts` porque su presupuesto lo fija el asesor frente a
 * la pantalla, no el core. Los llamadores por lote —sync, migración— se quedan
 * con el default a propósito.
 */
export async function consultarPrestamosPorCliente(
  clienteCodigo: number,
  timeoutMs?: number
) {
  // 👇 Usar la misma key que espera el backend (camelCase)
  const request = { clienteCodigo };

  const { data } = await sifcoApi.post<
    ServiceResponse<WSVerPrestamosPorClienteResponse>
  >(
    "/api/clientes/prestamos",
    request,
    timeoutMs === undefined ? undefined : { timeout: timeoutMs }
  );

  return exigirRespuestaExitosa(
    data,
    `SIFCO no pudo listar los préstamos del cliente ${clienteCodigo}`
  );
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