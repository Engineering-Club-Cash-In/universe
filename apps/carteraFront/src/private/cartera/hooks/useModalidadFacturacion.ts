import { useQuery } from "@tanstack/react-query";
import {
  resolverModalidadFacturacionSpreadService,
  listModalidadFacturacionSpreadByModalidadService,
  type ModalidadFacturacion,
} from "../services/services";

/**
 * Resuelve, para un monto dado, las 3 filas del catálogo (una por
 * modalidad) del bracket correspondiente — fuente única de verdad en SQL.
 */
export function useResolverModalidadFacturacionSpread(
  monto: number,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["modalidad-facturacion-resolver", monto],
    queryFn: () => resolverModalidadFacturacionSpreadService(monto),
    enabled: enabled && monto > 0,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Las 8 filas (una por bracket) de una modalidad, sin filtrar por monto —
 * opciones para la anulación manual del spread.
 */
export function useModalidadFacturacionSpreadByModalidad(
  modalidad: ModalidadFacturacion,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["modalidad-facturacion-por-modalidad", modalidad],
    queryFn: () => listModalidadFacturacionSpreadByModalidadService(modalidad),
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}
