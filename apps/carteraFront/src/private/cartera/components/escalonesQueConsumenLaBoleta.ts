/** Un escalón de la cascada, con lo que la boleta le alcanzó a dar. */
export type Escalon = { etiqueta: string; monto: number };

export type Consumo = {
  /** Los escalones con plata encima, en el orden de la cascada. */
  escalones: Escalon[];
  /** Cuánto se llevaron entre todos. */
  total: number;
  /** Si alguno se llevó algo. */
  hayConsumo: boolean;
};

/** Menos de medio centavo no se le nombra a nadie: es ruido de redondeo. */
const UN_CENTAVO_Y_MEDIO = 0.005;

/**
 * Qué escalones de la cascada se comen parte de la boleta ANTES de la cuota.
 *
 * Una sola lista para los dos avisos del modal de confirmación, porque los dos
 * preguntan lo mismo desde lados distintos:
 *
 *   * el de **cobro corto** la usa para decir QUIÉN se llevó la plata cuando la
 *     cuota no queda cubierta;
 *   * el de **"Abonar todo a Capital"** la usa para decir qué NO se va a cobrar
 *     si el asesor elige esa opción — porque manda la boleta entera a capital y
 *     el backend arranca la cascada con `boleta − otros − abono directo`
 *     (`calcularMontoEfectivo`), que con el abono igual a la boleta da cero.
 *
 * Teniéndola dos veces terminarían diciendo cosas distintas el día que la
 * cascada gane o pierda un escalón.
 *
 * **El convenio NO está**, y no es un olvido: se registra pero no descuenta de
 * la boleta (regla del dueño del dominio, 06-ago-2026, que revirtió la resta de
 * b6d79b8d). Meterlo sería culparlo de un faltante que no causó en el primer
 * aviso, y anunciar que "no se cobra" algo que tampoco se cobraba en el segundo.
 *
 * Es pura y sin React a propósito — `carteraFront` no tiene testing-library, así
 * que la única forma de fijar esto con tests es que la decisión no viva dentro
 * del componente. Mismo criterio que `rubrosApertura`.
 */
export function escalonesQueConsumenLaBoleta(escalones: Escalon[]): Consumo {
  const conPlata = escalones.filter((e) => e.monto > UN_CENTAVO_Y_MEDIO);

  const total = conPlata.reduce((suma, e) => suma + e.monto, 0);

  return {
    escalones: conPlata,
    // Redondeado al centavo: sumar flotantes deja colas (0.1 + 0.2) que no
    // tienen por qué salir a pantalla.
    total: Math.round(total * 100) / 100,
    hayConsumo: conPlata.length > 0,
  };
}
