/**
 * Estados de crédito que NO devengan mora.
 *
 * Vive acá y no en `latefee.ts` —donde nació— porque ese módulo importa la
 * conexión a la base de datos, y `src/database/index.ts` LANZA al importarse
 * si falta `SUPABASE_DB_URL`. Cualquier módulo de reglas puras que quisiera
 * reusar la lista arrastraba esa dependencia y sus tests dejaban de correr sin
 * una base configurada, aunque no tocaran ninguna. `latefee.ts` la re-exporta
 * para no romper a quien ya la importaba desde ahí.
 */
export const STATUS_EXCLUIDOS_MORA = [
  "EN_CONVENIO",
  "INCOBRABLE",
  "CANCELADO",
  "PENDIENTE_CANCELACION",
  "CAIDO",
];
