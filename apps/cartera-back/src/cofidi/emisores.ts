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
 * leyenda del PDF, scripts) sale de acá: una empresa nueva es UNA entrada (el selector del front la pide a GET /api/dte/emisores).
 *
 * El ORDEN importa: /anular y los scripts prueban los emisores en este orden.
 *
 * Estar acá NO mete a una empresa en la facturación automática de pagos
 * (/facturar-pago-completo): eso lo decide INVERSIONISTAS_FACTURADORES en const.ts.
 *
 * `bienOServicio`: cómo van sus líneas en Facturas Genéricas (B = bien, S = servicio).
 * `logoEnv`: env con la URL del logo propio para el PDF (null = logo de siempre).
 * `entraAlReporteDiario`: si sus facturas genéricas suman al reporte diario de facturación (Cash In). CHECKIN no: no es ingreso de Cash In.
 */
export const EMISORES = [
  { clave: "CUBE", nombre: "CUBE", config: CLUB_CASHIN_CONFIG, satConfig: SAT_CONFIG, bienOServicio: "B" as const, logoEnv: null as string | null, entraAlReporteDiario: true as const },
  { clave: "SE_PRESTA", nombre: "Se Presta", config: SE_PRESTA_CONFIG, satConfig: SE_PRESTA_SAT_CONFIG, bienOServicio: "B" as const, logoEnv: null as string | null, entraAlReporteDiario: true as const },
  { clave: "AMJK", nombre: "AMJK", config: AMJK_CONFIG, satConfig: AMJK_SAT_CONFIG, bienOServicio: "B" as const, logoEnv: null as string | null, entraAlReporteDiario: true as const },
  { clave: "CREACION_IMAGEN", nombre: "Creación Imagen", config: CREACION_IMAGEN_CONFIG, satConfig: CREACION_IMAGEN_SAT_CONFIG, bienOServicio: "B" as const, logoEnv: null as string | null, entraAlReporteDiario: true as const },
  { clave: "GRUPO_BATRO", nombre: "Grupo Batro", config: GRUPO_BATRO_CONFIG, satConfig: GRUPO_BATRO_SAT_CONFIG, bienOServicio: "B" as const, logoEnv: null as string | null, entraAlReporteDiario: true as const },
  { clave: "AUTOCASH", nombre: "AutoCash", config: AUTOCASH_CONFIG, satConfig: AUTOCASH_SAT_CONFIG, bienOServicio: "B" as const, logoEnv: null as string | null, entraAlReporteDiario: true as const },
  { clave: "CHECKIN", nombre: "Checkin (MotorLab)", config: CHECKIN_CONFIG, satConfig: CHECKIN_SAT_CONFIG, bienOServicio: "S" as const, logoEnv: "CHECKIN_LOGO_URL" as const, entraAlReporteDiario: false as const },
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

/**
 * Un emisor sin requestor o sin URL de COFIDI no puede facturar: mejor decirlo que fallar en COFIDI.
 * Nota: se define aquí para que emisoresParaSelector pueda usarlo en su filtro.
 */
export function emisorTieneCredenciales(emisor: Emisor): boolean {
  return Boolean(emisor.satConfig.requestor && emisor.satConfig.endpointUrl);
}

/** Lo que necesita el selector de Facturas Genéricas: clave y nombre, en el orden del registro, solo emisores con credenciales. */
export function emisoresParaSelector(
  emisores: readonly Emisor[] = EMISORES
): { clave: EmisorClave; nombre: string }[] {
  return emisores
    .filter(emisorTieneCredenciales)
    .map((e) => ({ clave: e.clave, nombre: e.nombre }));
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

/**
 * Con qué emisores intentar anular una factura. Si se sabe de quién es
 * (emisor_nit en la BD), SOLO con ese: cada empresa solo puede anular lo
 * suyo, y así el error que se muestra es el de la dueña. Si no se sabe
 * (facturas viejas sin emisor_nit, o un NIT que no está en el registro),
 * con todos los que tienen credenciales, como antes.
 * Un emisor sin credenciales nunca se intenta (su cliente SAT revienta).
 */
export function emisoresParaAnular(
  emisorNit: string | null | undefined,
  emisores: readonly Emisor[] = EMISORES
): Emisor[] {
  const propio = emisorNit ? emisores.find((e) => e.config.emisor.nit === String(emisorNit)) : undefined;
  if (propio) return emisorTieneCredenciales(propio) ? [propio] : [];
  return emisores.filter(emisorTieneCredenciales);
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
