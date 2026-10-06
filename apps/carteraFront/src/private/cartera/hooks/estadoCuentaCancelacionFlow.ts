// Flujo del modal «Cancelar crédito» con estado de cuenta previo.
//
//   FORMULARIO → GENERANDO → VISTA_PREVIA → CONFIRMANDO → PENDIENTE_CONFIRMADO
//                                                        → ENVIANDO → ENVIADO / ERROR_ENVIO
//                                           CONFIRMANDO → CONFIRMACION_INCIERTA (sin reconfirmar)
//
// Lógica pura (sin React ni red) para poder probar las reglas que importan:
// el primer clic solo genera la vista previa, la confirmación sale UNA vez, el
// mensaje nunca se manda antes del `ok: true` de /creditAction y un reintento
// de envío jamás repite /creditAction.
import type { PendingCancelCreditPayload } from "../services/services";
import type {
  EnvioEstadoCuentaRespuesta,
  PreviewEstadoCuentaBody,
  PreviewEstadoCuentaRespuesta,
} from "../services/estadoCuentaCancelacion.services";

export type FaseCancelacion =
  | "FORMULARIO"
  | "GENERANDO"
  | "VISTA_PREVIA"
  | "CONFIRMANDO"
  | "PENDIENTE_CONFIRMADO"
  | "ENVIANDO"
  | "ENVIADO"
  | "ERROR_ENVIO"
  /** /creditAction falló sin respuesta o con 5xx: pudo quedar registrada. */
  | "CONFIRMACION_INCIERTA";

export interface EstadoFlujoCancelacion {
  fase: FaseCancelacion;
  /** Documento vigente; cualquier edición lo invalida. */
  documento: PreviewEstadoCuentaRespuesta | null;
  /** Lo que se mandó a preview (motivo/observaciones del documento). */
  entrada: PreviewEstadoCuentaBody | null;
  errorPreview: string | null;
  errorConfirmacion: string | null;
  envio: EnvioEstadoCuentaRespuesta | null;
  errorEnvio: string | null;
  /** true solo si se sabe que el mensaje NO salió. */
  envioReintentable: boolean;
}

export const estadoInicialCancelacion: EstadoFlujoCancelacion = {
  fase: "FORMULARIO",
  documento: null,
  entrada: null,
  errorPreview: null,
  errorConfirmacion: null,
  envio: null,
  errorEnvio: null,
  envioReintentable: false,
};

export type AccionFlujoCancelacion =
  | { type: "REINICIAR" }
  | { type: "GENERAR" }
  | { type: "PREVIEW_OK"; documento: PreviewEstadoCuentaRespuesta; entrada: PreviewEstadoCuentaBody }
  | { type: "PREVIEW_ERROR"; mensaje: string }
  | { type: "VOLVER_A_EDITAR" }
  | { type: "CONFIRMAR" }
  | { type: "CONFIRMAR_OK" }
  | { type: "CONFIRMAR_ERROR"; mensaje: string }
  | { type: "CONFIRMAR_INCIERTO"; mensaje: string }
  | { type: "ENVIAR" }
  | { type: "ENVIO_RESULTADO"; envio: EnvioEstadoCuentaRespuesta }
  | { type: "ENVIO_FALLO"; mensaje: string; reintentable: boolean };

export function puedeEnviar(s: EstadoFlujoCancelacion): boolean {
  if (!s.documento) return false;
  return s.fase === "PENDIENTE_CONFIRMADO" || (s.fase === "ERROR_ENVIO" && s.envioReintentable);
}

export function flujoCancelacionReducer(
  s: EstadoFlujoCancelacion,
  a: AccionFlujoCancelacion,
): EstadoFlujoCancelacion {
  switch (a.type) {
    case "REINICIAR":
      return estadoInicialCancelacion;

    case "GENERAR":
      if (s.fase !== "FORMULARIO") return s; // doble clic
      return { ...s, fase: "GENERANDO", documento: null, entrada: null, errorPreview: null };

    case "PREVIEW_OK":
      if (s.fase !== "GENERANDO") return s;
      return { ...s, fase: "VISTA_PREVIA", documento: a.documento, entrada: a.entrada, errorConfirmacion: null };

    case "PREVIEW_ERROR":
      if (s.fase !== "GENERANDO") return s;
      return { ...s, fase: "FORMULARIO", errorPreview: a.mensaje };

    case "VOLVER_A_EDITAR":
      if (s.fase !== "VISTA_PREVIA") return s;
      return { ...estadoInicialCancelacion };

    case "CONFIRMAR":
      if (s.fase !== "VISTA_PREVIA" || !s.documento) return s; // una sola vez
      return { ...s, fase: "CONFIRMANDO", errorConfirmacion: null };

    case "CONFIRMAR_OK":
      if (s.fase !== "CONFIRMANDO") return s;
      return { ...s, fase: "PENDIENTE_CONFIRMADO" };

    case "CONFIRMAR_ERROR":
      // Rechazo explícito: no quedó registrada y se puede volver a confirmar.
      if (s.fase !== "CONFIRMANDO") return s;
      return { ...s, fase: "VISTA_PREVIA", errorConfirmacion: a.mensaje };

    case "CONFIRMAR_INCIERTO":
      // Pudo quedar registrada: no se permite reconfirmar desde este modal
      // (cada /creditAction inserta una cancelación nueva).
      if (s.fase !== "CONFIRMANDO") return s;
      return { ...s, fase: "CONFIRMACION_INCIERTA", errorConfirmacion: a.mensaje };

    case "ENVIAR":
      if (!puedeEnviar(s)) return s;
      return { ...s, fase: "ENVIANDO", errorEnvio: null, envioReintentable: false };

    case "ENVIO_RESULTADO":
      if (s.fase !== "ENVIANDO") return s;
      if (a.envio.estado === "ENVIADO") {
        return { ...s, fase: "ENVIADO", envio: a.envio, errorEnvio: null, envioReintentable: false };
      }
      return {
        ...s,
        fase: "ERROR_ENVIO",
        envio: a.envio,
        errorEnvio: a.envio.errorResumen ?? "El proveedor no confirmó el envío.",
        envioReintentable: a.envio.reintentable,
      };

    case "ENVIO_FALLO":
      if (s.fase !== "ENVIANDO") return s;
      return { ...s, fase: "ERROR_ENVIO", errorEnvio: a.mensaje, envioReintentable: a.reintentable };
  }
}

/**
 * Payload de /creditAction a partir del documento: monto y conceptos son los
 * que devolvió el backend, para que el total guardado coincida con el del PDF.
 * Conserva la semántica actual: `cuotas_atrasadas` = «Cuotas restantes».
 */
export function payloadConfirmacionDesdeDocumento(
  creditId: number,
  documento: PreviewEstadoCuentaRespuesta,
  entrada: PreviewEstadoCuentaBody,
): PendingCancelCreditPayload {
  const d = documento.desglose;
  return {
    creditId,
    accion: "PENDIENTE_CANCELACION",
    motivo: entrada.motivo.trim(),
    observaciones: entrada.observaciones?.trim() || undefined,
    monto_cancelacion: Number(documento.montoCancelacion),
    traspaso: Number(d.traspaso),
    garantia_mobiliaria: Number(d.garantiaMobiliaria),
    otros: Number(d.otros),
    cuotas_atrasadas: d.cuotasRestantes > 0 ? d.cuotasRestantes : undefined,
    montosAdicionales: d.montosAdicionales.map((m) => ({
      concepto: m.concepto,
      monto: Number(m.monto),
    })),
  };
}

/**
 * Un fallo de /creditAction es definitivo (no quedó registrada) solo con un 4xx:
 * el servidor contestó que rechazó la solicitud. Sin respuesta o con 5xx la
 * operación pudo haberse guardado y no se debe volver a confirmar a ciegas.
 */
export function falloConfirmacionEsDefinitivo(status: number | undefined): boolean {
  return status !== undefined && status >= 400 && status < 500;
}

/**
 * Un fallo HTTP de /enviar es reintentable solo cuando el servidor contestó
 * que NO lo intentó (validación, permisos, no existe, conflicto, número que no
 * está en el CRM, CRM inaccesible al verificar el número [424], deshabilitado).
 * Un 502/504 puede venir del proxy con el envío a medias: no es reintentable.
 * Sin respuesta o con otro 5xx el mensaje pudo haber salido: revisión manual.
 */
export function falloEnvioEsReintentable(status: number | undefined): boolean {
  return status !== undefined && [400, 403, 404, 409, 422, 424, 503].includes(status);
}
