// Ruta relativa y no el alias `@/`: `bun test` no resuelve los alias de vite, y
// este módulo existe para ser testeable fuera del componente.
import { sumaQ } from "../../../lib/moneda";

/**
 * Qué campos del formulario cambiaron DE VERDAD respecto de la fila que se abrió.
 *
 * El formulario mandaba los tres campos siempre, y eso pierde ediciones ajenas:
 * dos admins sobre el mismo rubro, A lo abre en Q500, B lo sube a Q800, y A
 * cambia sólo la descripción. A reenvía el Q500 que tenía cargado, el backend lo
 * compara con su fila actual, ve una diferencia real y la guarda como una edición
 * de monto. Lo de B se deshace sin que nadie se entere, y el historial registra
 * un cambio de monto que A nunca pidió.
 *
 * Mandando sólo lo que el editor tocó, editar una propiedad no puede revertir un
 * cambio concurrente en OTRA.
 *
 * ⚠️ Esto NO resuelve el conflicto sobre el MISMO campo: si A y B editan los dos
 * el monto, sigue ganando el último que guarda. Para eso haría falta un chequeo
 * de versión optimista (un `updated_at` que viaje en el patch y que el backend
 * compare), que es una decisión de contrato y no vive acá.
 *
 * La comparación del monto va al CENTAVO, no por texto: el backend guarda
 * `numeric(18,2)` y devuelve "500.00", así que comparar la grafía marcaría como
 * edición un `500` que es el mismo número.
 */
export function camposRealmenteEditados(
  actual: { monto: string; descripcion: string },
  original: { monto: string | number; descripcion: string }
): { monto?: number; descripcion?: string } {
  const patch: { monto?: number; descripcion?: string } = {};

  const montoActual = sumaQ([Number(actual.monto) || 0]);
  const montoOriginal = sumaQ([Number(original.monto) || 0]);
  if (montoActual !== montoOriginal) patch.monto = montoActual;

  const descActual = actual.descripcion.trim();
  if (descActual !== (original.descripcion ?? "").trim()) {
    patch.descripcion = descActual;
  }

  return patch;
}
