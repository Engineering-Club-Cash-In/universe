import {
  AMJK_CONFIG,
  AMJK_SAT_CONFIG,
  AUTOCASH_CONFIG,
  AUTOCASH_SAT_CONFIG,
  CLUB_CASHIN_CONFIG,
  CREACION_IMAGEN_CONFIG,
  CREACION_IMAGEN_SAT_CONFIG,
  GRUPO_BATRO_CONFIG,
  GRUPO_BATRO_SAT_CONFIG,
  SAT_CONFIG,
  SE_PRESTA_CONFIG,
  SE_PRESTA_SAT_CONFIG,
} from "../utils/functions/const";

/**
 * Registro ÚNICO de las empresas que emiten facturas por COFIDI. Todo lo que
 * recorre o busca emisores (facturar-generico, anular, verificación SAT,
 * leyenda del PDF, scripts) sale de acá: del lado del back una empresa nueva es UNA entrada (el selector del front todavía tiene su propia lista).
 *
 * El ORDEN importa: /anular y los scripts prueban los emisores en este orden.
 *
 * Estar acá NO mete a una empresa en la facturación automática de pagos
 * (/facturar-pago-completo): eso lo decide INVERSIONISTAS_FACTURADORES en const.ts.
 */
export const EMISORES = [
  { clave: "CUBE", nombre: "CUBE", config: CLUB_CASHIN_CONFIG, satConfig: SAT_CONFIG },
  { clave: "SE_PRESTA", nombre: "Se Presta", config: SE_PRESTA_CONFIG, satConfig: SE_PRESTA_SAT_CONFIG },
  { clave: "AMJK", nombre: "AMJK", config: AMJK_CONFIG, satConfig: AMJK_SAT_CONFIG },
  { clave: "CREACION_IMAGEN", nombre: "Creación Imagen", config: CREACION_IMAGEN_CONFIG, satConfig: CREACION_IMAGEN_SAT_CONFIG },
  { clave: "GRUPO_BATRO", nombre: "Grupo Batro", config: GRUPO_BATRO_CONFIG, satConfig: GRUPO_BATRO_SAT_CONFIG },
  { clave: "AUTOCASH", nombre: "AutoCash", config: AUTOCASH_CONFIG, satConfig: AUTOCASH_SAT_CONFIG },
] as const;

export type Emisor = (typeof EMISORES)[number];
export type EmisorClave = Emisor["clave"];

export function emisorPorClave(clave: string): Emisor | undefined {
  return EMISORES.find((e) => e.clave === clave);
}

export function emisorPorNit(nit: string | null | undefined): Emisor | undefined {
  if (!nit) return undefined;
  return EMISORES.find((e) => e.config.emisor.nit === String(nit));
}
