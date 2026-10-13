import { debeAdvertirPagosNexa } from "./advertenciaPagosNexa";
import type { PagosNexaCredito } from "../services/nexaDashboard.services";

export type ResultadoPreflightCaido = "cancelado" | "advertir" | "marcar";

// Decide qué hacer cuando vuelve la consulta de pagos Nexa previa a marcar CAÍDO.
// Si el operador cerró el modal mientras la consulta corría (`sigueVigente()` es false),
// el resultado es obsoleto y NO se marca ni se advierte: marcar CAÍDO es destructivo.
export function resolverPreflightCaido(
  pagosNexa: PagosNexaCredito | null,
  sigueVigente: () => boolean,
): ResultadoPreflightCaido {
  if (!sigueVigente()) return "cancelado";
  return debeAdvertirPagosNexa(pagosNexa) ? "advertir" : "marcar";
}
