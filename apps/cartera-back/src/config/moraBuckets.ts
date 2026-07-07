/**
 * Fuente única de verdad para los buckets de aging de mora por cuotas atrasadas.
 *
 * Todo lo que divide créditos por etapa de mora (el filtro de la tabla y el
 * reporte de porcentajes del embudo) deriva de aquí — así reshapear o agregar
 * una etapa NO requiere tocar lógica SQL, solo esta lista.
 *
 * Semántica del rango:
 *   - `min` inclusivo.
 *   - `max = null`  → sin tope: cuenta `>= min` (el bucket "+", el último).
 *   - `min === max` → exacto: cuenta `= min`.
 *   - `min < max`   → rango cerrado: cuenta `BETWEEN min AND max`.
 *
 * Para agregar B6 en el futuro: cambiar el `max` del último bucket de `null` a su
 * tope (ej. 5) y agregar `{ key: "6", min: 6, max: null, estadoMora: "mora_180" }`.
 * No se edita ningún query.
 */
export interface MoraBucket {
  /** Clave numérica usada en `porCuotasAtrasadas` (string por compat con el JSON existente). */
  key: string;
  /** Mínimo de cuotas atrasadas (inclusivo). */
  min: number;
  /** Máximo de cuotas atrasadas (inclusivo). `null` = sin tope (>= min). */
  max: number | null;
  /** Clave de etapa que consume el CRM/frontend. */
  estadoMora: string;
  /** Nombre de negocio mostrado en el frontend (embudo + filtros). */
  label: string;
}

export const MORA_BUCKETS: readonly MoraBucket[] = [
  { key: "0", min: 0, max: 0, estadoMora: "al_dia", label: "Cartera Sana" },
  { key: "1", min: 1, max: 1, estadoMora: "mora_30", label: "Alerta Temprana" },
  { key: "2", min: 2, max: 2, estadoMora: "mora_60", label: "Gestión Activa" },
  { key: "3", min: 3, max: 3, estadoMora: "mora_90", label: "Rescate" },
  { key: "4", min: 4, max: 4, estadoMora: "mora_120", label: "Última Instancia / Pre Jurídico" },
  { key: "5", min: 5, max: null, estadoMora: "mora_120_plus", label: "Jurídico" },
] as const;

/** Busca el bucket cuya etapa (estadoMora) coincide, para mapear una etapa a su rango. */
export function bucketPorEstadoMora(estadoMora: string): MoraBucket | undefined {
  return MORA_BUCKETS.find((b) => b.estadoMora === estadoMora);
}
