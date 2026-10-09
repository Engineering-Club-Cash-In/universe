import { getInversionistaFacturadorConfig } from "../utils/functions/const";

// Únicos emisores cuya factura de interés apaga NO_FACTURAR_INTERES_EMPRESAS.
// Lista fija por NIT: una empresa nueva en INVERSIONISTAS_FACTURADORES sigue
// facturando hasta que alguien la agregue acá a propósito.
export const NITS_INTERES_SIN_FACTURA = new Set([
  "100691455", // AMJK
  "96896035", // Autocash
]);

/** "true" sin importar mayúsculas ni espacios alrededor; cualquier otro valor = apagado. */
export function interruptorPrendido(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env.NO_FACTURAR_INTERES_EMPRESAS?.trim().toLowerCase() === "true";
}

/**
 * NO_FACTURAR_INTERES_EMPRESAS=true apaga la factura de INTERÉS de AMJK y
 * Autocash (NITS_INTERES_SIN_FACTURA). Nadie factura ese interés desde el
 * sistema (llevan su contabilidad aparte); la parte Cash In sigue yendo a CUBE.
 * Se lee en cada llamada (no al cargar el módulo). La prende "true" (sin importar
 * mayúsculas ni espacios). /facturar-generico NO la mira: queda como vía manual.
 */
export function interesEmpresaApagado(
  nombreInversionista: string,
  env: Record<string, string | undefined> = process.env
): boolean {
  if (!interruptorPrendido(env)) return false;
  const nit = getInversionistaFacturadorConfig(nombreInversionista)?.satConfig.nit;
  return nit !== undefined && NITS_INTERES_SIN_FACTURA.has(nit);
}

// Se ve en el log de arranque: deja constancia de cómo quedó el interruptor en el deploy.
console.log(
  `[cofidi] NO_FACTURAR_INTERES_EMPRESAS=${JSON.stringify(process.env.NO_FACTURAR_INTERES_EMPRESAS ?? null)} → ` +
    (interruptorPrendido()
      ? "interés de AMJK y Autocash SIN factura"
      : "interés de AMJK y Autocash se factura normal")
);
