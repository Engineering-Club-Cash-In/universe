// ─────────────────────────────────────────────────────────────────────────────
// COBROS-02 · Alta de asesor desde «Mi equipo» del CRM. Regla pura: con los
// asesores de cartera que ya tienen ese correo (`email_cash_in`), decide si hay
// que crearlo, reactivarlo, darle su pool o si ya está dado de alta. La escritura
// vive en controllers/buckets/altaAsesor.ts.
// ─────────────────────────────────────────────────────────────────────────────

export type CandidatoAlta = {
  asesor_id: number;
  /** `asesores.activo` (null en filas viejas = activo). */
  activo: boolean | null;
  /** Buckets con la fila del pool activa. */
  poolActivo: readonly number[];
  /** Buckets con la fila del pool apagada (pausada por una ausencia o baja). */
  poolInactivo: readonly number[];
};

export type DecisionAlta =
  | { accion: "crear" }
  /** Ya está de alta con exactamente ese pool: no hay nada que escribir (reintento). */
  | { accion: "existente"; asesorId: number }
  /** Estaba dado de baja: se reactiva con el pool pedido. */
  | { accion: "reactivar"; asesorId: number }
  /** Activo pero sin pool (nunca tuvo): se le asigna el pool pedido. */
  | { accion: "vincular"; asesorId: number }
  | { accion: "conflicto"; mensaje: string };

const lista = (buckets: readonly number[]) =>
  [...buckets].sort((a, b) => a - b).map((b) => `B${b}`).join(", ");

const mismoConjunto = (a: readonly number[], b: readonly number[]) => {
  const sa = new Set(a);
  const sb = new Set(b);
  return sa.size === sb.size && [...sa].every((x) => sb.has(x));
};

export function decidirAltaAsesor(params: {
  candidatos: readonly CandidatoAlta[];
  buckets: readonly number[];
}): DecisionAlta {
  const activos = params.candidatos.filter((c) => c.activo !== false);
  const inactivos = params.candidatos.filter((c) => c.activo === false);
  if (activos.length > 1) {
    return {
      accion: "conflicto",
      mensaje: `Hay ${activos.length} asesores activos con ese correo en cartera. Corríjalo antes de dar de alta.`,
    };
  }
  const activo = activos[0];
  if (activo) {
    if (activo.poolActivo.length > 0) {
      return mismoConjunto(activo.poolActivo, params.buckets)
        ? { accion: "existente", asesorId: activo.asesor_id }
        : {
            accion: "conflicto",
            mensaje: `El correo ya pertenece a un asesor activo de cartera con otro pool (${lista(activo.poolActivo)}).`,
          };
    }
    // Activo y con el pool apagado = ausente (M5) o a medias de otra operación:
    // darle pool ahora rompería su ausencia. Se reactiva desde «Mi equipo».
    if (activo.poolInactivo.length > 0) {
      return {
        accion: "conflicto",
        mensaje: "El asesor ya existe en cartera con su pool pausado (puede estar ausente). Reactívelo desde «Mi equipo».",
      };
    }
    return { accion: "vincular", asesorId: activo.asesor_id };
  }
  if (inactivos.length > 1) {
    return {
      accion: "conflicto",
      mensaje: `Hay ${inactivos.length} asesores dados de baja con ese correo en cartera. Corríjalo antes de dar de alta.`,
    };
  }
  const inactivo = inactivos[0];
  return inactivo ? { accion: "reactivar", asesorId: inactivo.asesor_id } : { accion: "crear" };
}
