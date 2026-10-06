import axios, { type AxiosInstance } from "axios";
import type {
  ContactoTelefono,
  ResultadoProveedorWhatsapp,
  WhatsappEstadoCuentaParams,
} from "../controllers/estadoCuentaCancelacionService";

// ================================================================
// Llamadas al CRM para el estado de cuenta de cancelación:
//   - teléfonos del cliente (Cartera no los tiene)
//   - envío por WhatsApp (la conexión con SimpleTech vive en el CRM)
// Máquina a máquina con el secreto compartido `x-cartera-relay-secret`.
// ================================================================

const BASE = "/api/cartera/estado-cuenta";
const PROVEEDOR = "SimpleTech";

const crearCliente = (): AxiosInstance =>
  axios.create({
    baseURL: process.env.CRM_API_URL,
    headers: { "Content-Type": "application/json" },
  });

const cabeceras = () => {
  const secreto = process.env.CARTERA_RELAY_SECRET;
  if (!secreto) throw new Error("CARTERA_RELAY_SECRET no está configurado");
  return { "x-cartera-relay-secret": secreto };
};

export async function obtenerContactosDelCrm(
  numeroCreditoSifco: string,
  cliente: AxiosInstance = crearCliente()
): Promise<ContactoTelefono[]> {
  const { data } = await cliente.get(`${BASE}/contactos`, {
    params: { numero_sifco: numeroCreditoSifco },
    headers: cabeceras(),
    timeout: 15_000,
  });
  if (!data?.success || !Array.isArray(data.contactos)) {
    throw new Error(data?.error ?? "Respuesta inválida del CRM");
  }
  return data.contactos as ContactoTelefono[];
}

/** Errores de red en los que la petición nunca llegó al CRM: el mensaje no salió. */
const SIN_CONEXION = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ERR_INVALID_URL"]);

/**
 * Traduce la respuesta del CRM a lo que se sabe del envío. Si la llamada al CRM
 * se corta (timeout, caída) el CRM pudo haber mandado el mensaje: INCIERTO.
 */
export async function enviarWhatsappPorCrm(
  params: WhatsappEstadoCuentaParams,
  cliente: AxiosInstance = crearCliente()
): Promise<ResultadoProveedorWhatsapp> {
  let headers: Record<string, string>;
  try {
    headers = cabeceras();
  } catch (err) {
    return { resultado: "NO_ENVIADO", proveedor: PROVEEDOR, error: String((err as Error).message) };
  }

  try {
    // El CRM espera hasta 30s a SimpleTech; se le da margen.
    const { data } = await cliente.post(`${BASE}/whatsapp`, params, { headers, timeout: 45_000 });
    return aResultado(data);
  } catch (err: any) {
    const data = err?.response?.data;
    // El CRM contestó con un resultado explícito (p. ej. 400 NO_ENVIADO).
    if (data?.resultado) return aResultado(data);
    const status = err?.response?.status as number | undefined;
    const mensaje = String(data?.error ?? err?.message ?? "Error desconocido").slice(0, 500);
    // 4xx (secreto inválido, body inválido): el CRM no lo intentó.
    if (status && status >= 400 && status < 500) {
      return { resultado: "NO_ENVIADO", proveedor: PROVEEDOR, error: `CRM ${status}: ${mensaje}` };
    }
    if (!status && SIN_CONEXION.has(err?.code)) {
      return { resultado: "NO_ENVIADO", proveedor: PROVEEDOR, error: `Sin conexión con el CRM: ${mensaje}` };
    }
    return { resultado: "INCIERTO", proveedor: PROVEEDOR, error: `CRM${status ? ` ${status}` : ""}: ${mensaje}` };
  }
}

function aResultado(data: any): ResultadoProveedorWhatsapp {
  const proveedor = String(data?.proveedor ?? PROVEEDOR);
  const modoPrueba = Boolean(data?.modoPrueba);
  if (data?.resultado === "ENVIADO") {
    return { resultado: "ENVIADO", proveedor, mensajeId: data?.mensajeId ?? null, modoPrueba };
  }
  if (data?.resultado === "NO_ENVIADO" || data?.resultado === "INCIERTO") {
    return { resultado: data.resultado, proveedor, error: String(data?.error ?? "Sin detalle"), modoPrueba };
  }
  return { resultado: "INCIERTO", proveedor, error: "Respuesta del CRM sin resultado", modoPrueba };
}
