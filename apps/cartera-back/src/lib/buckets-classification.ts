// Fila del catálogo de buckets relevante para la derivación.
export type BucketCatalogo = {
  numero: number;
  cuotas_min: number;
  cuotas_max: number | null; // null = abierto (B5 = 5..∞)
  estados_incluidos: string[];
};

/**
 * Fila completa del catálogo `cartera.buckets` expuesta a consumidores
 * externos (CRM vía API) — incluye el puente `estado_mora` (numero↔estadoMora).
 */
export type BucketCatalogoCompleto = {
  numero: number;
  prefijo: string;
  nombre: string;
  descripcion: string | null;
  cuotas_min: number;
  cuotas_max: number | null;
  estados_incluidos: string[];
  es_operativo: boolean;
  orden: number;
  color: string | null;
  estado_mora: string | null;
};

// El bucket se DERIVA del catálogo dinámico `cartera.buckets` (nombres, rangos y
// estados configurables → filtros full dinámicos). Lo único que queda en código
// es la lista de estados FUERA del funnel operativo (Opción A): esos créditos ya
// no llevan mora ni se trackean como bucket.
export const STATUS_BUCKET_FUERA = [
  "CANCELADO",
  "PENDIENTE_CANCELACION",
  "EN_CONVENIO",
  "CAIDO",
];

/**
 * Bucket de un crédito (0-5) resuelto contra el catálogo dinámico `catalogo`.
 * Orden: (1) estado fuera del funnel → null; (2) estado que fuerza un bucket
 * (p.ej. INCOBRABLE → B5 vía `estados_incluidos`); (3) rango de cuotas atrasadas.
 * Devuelve `null` si el crédito está fuera del funnel operativo (no se trackea).
 */
export function bucketDeCredito(
  status: string | null | undefined,
  cuotasAtrasadas: number,
  catalogo: BucketCatalogo[],
): number | null {
  // (1) Fuera del funnel operativo (lista en código, Opción A).
  if (status && STATUS_BUCKET_FUERA.includes(status)) return null;
  // (2) Estado que fuerza un bucket (p.ej. INCOBRABLE → B5).
  if (status) {
    const porEstado = catalogo.find((b) => b.estados_incluidos.includes(status));
    if (porEstado) return porEstado.numero;
  }
  // (3) Por rango de cuotas atrasadas (max null = abierto).
  const cuotas = Math.max(cuotasAtrasadas, 0);
  const porRango = catalogo.find(
    (b) => cuotas >= b.cuotas_min && (b.cuotas_max == null || cuotas <= b.cuotas_max),
  );
  return porRango ? porRango.numero : null;
}
