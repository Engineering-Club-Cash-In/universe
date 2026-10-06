import { useMutation, useQuery } from "@tanstack/react-query";
import {
  enviarEstadoCuentaCancelacion,
  obtenerContactosEstadoCuentaCancelacion,
  previewEstadoCuentaCancelacion,
  type ContactoTelefono,
  type EnvioEstadoCuentaRespuesta,
  type PreviewEstadoCuentaBody,
  type PreviewEstadoCuentaRespuesta,
} from "../services/estadoCuentaCancelacion.services";

export function usePreviewEstadoCuentaCancelacion() {
  return useMutation<
    PreviewEstadoCuentaRespuesta,
    Error,
    { creditId: number; body: PreviewEstadoCuentaBody }
  >({
    mutationFn: ({ creditId, body }) => previewEstadoCuentaCancelacion(creditId, body),
  });
}

/** Teléfonos del cliente (CRM). Solo se consulta cuando se va a enviar. */
export function useContactosEstadoCuentaCancelacion(creditId: number, enabled: boolean) {
  return useQuery<ContactoTelefono[], Error>({
    queryKey: ["estado-cuenta-cancelacion-contactos", creditId],
    queryFn: () => obtenerContactosEstadoCuentaCancelacion(creditId),
    enabled: enabled && creditId > 0,
    retry: false,
    staleTime: 0,
  });
}

export function useEnviarEstadoCuentaCancelacion() {
  return useMutation<
    EnvioEstadoCuentaRespuesta,
    Error,
    { creditId: number; documentoId: string; destinatarioTelefono: string; intentoId: string }
  >({
    // Sin reintentos automáticos: un reintento es una decisión del operador
    // y lleva un intentoId nuevo.
    retry: false,
    mutationFn: ({ creditId, documentoId, destinatarioTelefono, intentoId }) =>
      enviarEstadoCuentaCancelacion(creditId, documentoId, { destinatarioTelefono, intentoId }),
  });
}
