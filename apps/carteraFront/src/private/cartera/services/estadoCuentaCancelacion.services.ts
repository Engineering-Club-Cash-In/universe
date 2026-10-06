import api from "@/Provider/interceptor";

// Estado de cuenta al solicitar la cancelación de un crédito.
// Contrato: apps/cartera-back/src/routers/estadoCuentaCancelacionRouter.ts

export interface PreviewEstadoCuentaBody {
  cuotasRestantes: number;
  traspaso: number;
  garantiaMobiliaria: number;
  otros: number;
  montosAdicionales: { concepto: string; monto: number }[];
  motivo: string;
  observaciones?: string;
}

export interface DesgloseEstadoCuentaCancelacion {
  moneda: "GTQ";
  capital: string;
  cuotasRestantes: number;
  porCuota: { interes: string; iva: string; seguro: string; gps: string; membresias: string };
  totalesCuotas: {
    interes: string;
    iva: string;
    seguro: string;
    gps: string;
    membresias: string;
    subtotal: string;
  };
  mora: string;
  traspaso: string;
  garantiaMobiliaria: string;
  otros: string;
  montosAdicionales: { concepto: string; monto: string }[];
  totalMontosAdicionales: string;
  montoCancelacion: string;
}

export interface PreviewEstadoCuentaRespuesta {
  documentoId: string;
  numeroCredito: string;
  fechaCorteGT: string;
  generadoAt: string;
  desglose: DesgloseEstadoCuentaCancelacion;
  montoCancelacion: string;
  /** Ruta autenticada del backend (no es una URL pública). */
  pdfUrl: string;
}

/** De dónde salió el teléfono en el CRM (mismo orden que Cobros). */
export type FuenteTelefono = "CASO_COBROS" | "LEAD" | "SOLICITUD";

export interface ContactoTelefono {
  /** `+502XXXXXXXX`. */
  telefono: string;
  fuente: FuenteTelefono;
  sugerido: boolean;
}

export interface EnvioEstadoCuentaRespuesta {
  intentoId: string;
  documentoId: string;
  canal: "WHATSAPP";
  destinatarioTelefono: string;
  destinatarioFuente: FuenteTelefono;
  estado: "EN_PROCESO" | "ENVIADO" | "ERROR";
  proveedor: string | null;
  proveedorMensajeId: string | null;
  errorResumen: string | null;
  reintentable: boolean;
  repetido: boolean;
  /** El CRM lo desvió a un número de prueba (TEST_MESSAGE). */
  modoPrueba: boolean;
  /** Hasta cuándo abre el enlace enviado. */
  enlaceVenceAt: string | null;
}

export async function previewEstadoCuentaCancelacion(
  creditId: number,
  body: PreviewEstadoCuentaBody,
): Promise<PreviewEstadoCuentaRespuesta> {
  const { data } = await api.post(`/credit/${creditId}/cancelacion/estado-cuenta/preview`, body);
  return data;
}

/** Bytes del PDF guardado, con la sesión del operador. */
export async function descargarPdfEstadoCuentaCancelacion(pdfUrl: string): Promise<Blob> {
  const { data } = await api.get(pdfUrl, { responseType: "blob" });
  return data;
}

/** Celulares del cliente registrados en el CRM, ya ordenados. */
export async function obtenerContactosEstadoCuentaCancelacion(
  creditId: number,
): Promise<ContactoTelefono[]> {
  const { data } = await api.get(`/credit/${creditId}/cancelacion/estado-cuenta/contactos`);
  return data.contactos;
}

/** `+50235219722` → `3521 9722`. */
export const formatearTelefonoGT = (telefono: string) => {
  const d = telefono.replace(/\D/g, "").slice(-8);
  return d.length === 8 ? `${d.slice(0, 4)} ${d.slice(4)}` : telefono;
};

export async function enviarEstadoCuentaCancelacion(
  creditId: number,
  documentoId: string,
  body: { destinatarioTelefono: string; intentoId: string },
): Promise<EnvioEstadoCuentaRespuesta> {
  const { data } = await api.post(
    `/credit/${creditId}/cancelacion/estado-cuenta/${documentoId}/enviar`,
    body,
  );
  return data.envio;
}
