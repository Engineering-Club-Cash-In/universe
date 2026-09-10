import Big from "big.js";

export interface AsesorCarga {
  asesor_id: number;
  nombre: string;
  total_creditos: number;
  capital_total: string;
}

/**
 * Elige al asesor que recibe el siguiente crédito.
 *
 * El criterio es el NÚMERO de créditos vivos (ACTIVO/MOROSO), no el capital:
 * un asesor con pocos créditos grandes se veía cargado bajo el criterio viejo
 * y dejaba de recibir asignaciones.
 *
 * Los empates por conteo son frecuentes (varios asesores con el mismo número
 * de créditos), así que el orden debe quedar totalmente definido; sin los
 * desempates el ganador lo decidiría el orden en que Postgres devuelva las
 * filas, que es indeterminado.
 */
export const elegirAsesorConMenorCarga = (asesores: AsesorCarga[]): AsesorCarga => {
  if (asesores.length === 0) {
    throw new Error("No hay asesores activos disponibles");
  }

  return [...asesores].sort((a, b) => {
    if (a.total_creditos !== b.total_creditos) {
      return a.total_creditos - b.total_creditos;
    }

    const porCapital = new Big(a.capital_total).cmp(new Big(b.capital_total));
    if (porCapital !== 0) return porCapital;

    return a.asesor_id - b.asesor_id;
  })[0];
};
