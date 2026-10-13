/**
 * Qué se devuelve al reactivar a un asesor ausente (COBROS-02 M5, issue #1895).
 * Solo vuelve una cuenta si SIGUE con quien la recibió en el reparto y su bucket
 * de hoy está en el pool del asesor; lo demás se queda donde está.
 */

export type RetenidoDevolucion = {
  credito_id: number;
  motivo: "cambio_de_dueno" | "fuera_del_funnel" | "bucket_fuera_del_pool";
};

export function clasificarDevolucion(
  detalle: readonly { credito_id: number; asesor_nuevo_id: number; bucket: number | null }[],
  actuales: ReadonlyMap<number, { asesor_id: number | null; bucket: number | null } | null>,
  bucketsDelTitular: ReadonlySet<number>,
): { aDevolver: number[]; aDevolverDirecto: number[]; retenidos: RetenidoDevolucion[] } {
  const aDevolver: number[] = [];
  // Cuentas que estaban en el funnel al repartir pero hoy no tienen bucket
  // operativo (p. ej. EN_CONVENIO): la reasignación en bloque no las acepta, así
  // que se devuelven aparte, con la misma bitácora.
  const aDevolverDirecto: number[] = [];
  const retenidos: RetenidoDevolucion[] = [];
  for (const d of detalle) {
    const hoy = actuales.get(d.credito_id);
    if (!hoy || hoy.asesor_id !== d.asesor_nuevo_id) {
      retenidos.push({ credito_id: d.credito_id, motivo: "cambio_de_dueno" });
    } else if (hoy.bucket === null) {
      if (d.bucket !== null) aDevolverDirecto.push(d.credito_id);
      else retenidos.push({ credito_id: d.credito_id, motivo: "fuera_del_funnel" });
    } else if (!bucketsDelTitular.has(hoy.bucket)) {
      retenidos.push({ credito_id: d.credito_id, motivo: "bucket_fuera_del_pool" });
    } else {
      aDevolver.push(d.credito_id);
    }
  }
  return { aDevolver, aDevolverDirecto, retenidos };
}
