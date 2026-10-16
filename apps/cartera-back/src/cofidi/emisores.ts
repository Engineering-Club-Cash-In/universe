import {
  AMJK_CONFIG,
  AMJK_SAT_CONFIG,
  AUTOCASH_CONFIG,
  AUTOCASH_SAT_CONFIG,
  CHECKIN_CONFIG,
  CHECKIN_SAT_CONFIG,
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
 *
 * `bienOServicio`: cómo van sus líneas en Facturas Genéricas (B = bien, S = servicio).
 * `logoEnv`: env con la URL del logo propio para el PDF (null = logo de siempre).
 */
export const EMISORES = [
  { clave: "CUBE", nombre: "CUBE", config: CLUB_CASHIN_CONFIG, satConfig: SAT_CONFIG, bienOServicio: "B" as const, logoEnv: null as string | null },
  { clave: "SE_PRESTA", nombre: "Se Presta", config: SE_PRESTA_CONFIG, satConfig: SE_PRESTA_SAT_CONFIG, bienOServicio: "B" as const, logoEnv: null as string | null },
  { clave: "AMJK", nombre: "AMJK", config: AMJK_CONFIG, satConfig: AMJK_SAT_CONFIG, bienOServicio: "B" as const, logoEnv: null as string | null },
  { clave: "CREACION_IMAGEN", nombre: "Creación Imagen", config: CREACION_IMAGEN_CONFIG, satConfig: CREACION_IMAGEN_SAT_CONFIG, bienOServicio: "B" as const, logoEnv: null as string | null },
  { clave: "GRUPO_BATRO", nombre: "Grupo Batro", config: GRUPO_BATRO_CONFIG, satConfig: GRUPO_BATRO_SAT_CONFIG, bienOServicio: "B" as const, logoEnv: null as string | null },
  { clave: "AUTOCASH", nombre: "AutoCash", config: AUTOCASH_CONFIG, satConfig: AUTOCASH_SAT_CONFIG, bienOServicio: "B" as const, logoEnv: null as string | null },
  { clave: "CHECKIN", nombre: "Checkin (MotorLab)", config: CHECKIN_CONFIG, satConfig: CHECKIN_SAT_CONFIG, bienOServicio: "S" as const, logoEnv: "CHECKIN_LOGO_URL" as const },
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

/** Lo que necesita el selector de Facturas Genéricas: clave y nombre, en el orden del registro. */
export function emisoresParaSelector(): { clave: EmisorClave; nombre: string }[] {
  return EMISORES.map((e) => ({ clave: e.clave, nombre: e.nombre }));
}

/**
 * Complemento de una factura genérica. Solo FCAM lleva el complemento
 * cambiario (abonos); FACT no lleva complementos (SAT/COFIDI lo rechaza).
 */
export function complementosFacturaGenerica(
  tipoDocumento: string,
  montoTotal: number,
  fechaVencimiento: string
) {
  if (tipoDocumento !== "FCAM") return [];
  return [
    {
      tipo: "cambiario" as const,
      abonos: [{ numeroAbono: 1, fechaVencimiento, montoAbono: montoTotal }],
    },
  ];
}

/** Un emisor sin requestor o sin URL de COFIDI no puede facturar: mejor decirlo que fallar en COFIDI. */
export function emisorTieneCredenciales(emisor: Emisor): boolean {
  return Boolean(emisor.satConfig.requestor && emisor.satConfig.endpointUrl);
}

/**
 * URL del logo para el PDF de una factura de este emisor: el propio si el
 * emisor tiene `logoEnv` y esa env está puesta; si no, `porDefecto`.
 */
export function logoUrlEmisor(
  nitEmisor: string | null | undefined,
  porDefecto: string,
  env: Record<string, string | undefined> = process.env
): string {
  const variable = emisorPorNit(nitEmisor)?.logoEnv;
  return (variable && env[variable]) || porDefecto;
}
