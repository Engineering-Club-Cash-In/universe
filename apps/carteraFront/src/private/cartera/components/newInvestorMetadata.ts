import type { InversionistaPayload } from "../services/services";

type NewInvestorMetadata = Pick<
  InversionistaPayload,
  | "es_nuevo"
  | "tipo_operacion"
  | "tipo_reinversion"
  | "modalidad_facturacion"
  | "modalidad_facturacion_spread_id"
>;

export function getNewInvestorMetadataError(
  investor: NewInvestorMetadata,
): string | undefined {
  if (!investor.es_nuevo) return undefined;
  if (!investor.tipo_operacion) return "Seleccioná el tipo de operación.";
  if (!investor.tipo_reinversion) {
    return "Seleccioná el tipo de reinversión.";
  }
  if (investor.tipo_operacion === "compra_cartera") {
    if (!investor.modalidad_facturacion) {
      return "Seleccioná la modalidad de facturación.";
    }
    if (!investor.modalidad_facturacion_spread_id) {
      return "Seleccioná el rango de facturación.";
    }
  }
  return undefined;
}

export function mapNewInvestorMetadata(
  investor: NewInvestorMetadata,
): NewInvestorMetadata {
  if (!investor.es_nuevo || !investor.tipo_operacion) return {};
  if (investor.tipo_operacion === "reinversion") {
    return {
      es_nuevo: true,
      tipo_operacion: "reinversion",
      tipo_reinversion: investor.tipo_reinversion,
    };
  }
  return {
    es_nuevo: true,
    tipo_operacion: "compra_cartera",
    tipo_reinversion: investor.tipo_reinversion,
    modalidad_facturacion: investor.modalidad_facturacion,
    modalidad_facturacion_spread_id: investor.modalidad_facturacion_spread_id,
  };
}
