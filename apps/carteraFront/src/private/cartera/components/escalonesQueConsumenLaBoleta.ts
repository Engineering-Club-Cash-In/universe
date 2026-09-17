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
 * Contesta UNA pregunta: **¿quién se llevó la plata que le faltó a la cuota?**
 * La usa el aviso de "cobro corto" del modal de confirmación.
 *
 * **El convenio NO está**, y no es un olvido: se registra pero no descuenta de
 * la boleta (regla del dueño del dominio, 06-ago-2026, que revirtió la resta de
 * b6d79b8d). Culparlo de un faltante sería acusar a quien no se llevó nada.
 *
 * ⚠️ El aviso de "Abonar todo a Capital" NO usa esta lista, y acá estaba escrito
 * que sí porque los dos "preguntan lo mismo desde lados distintos". No es cierto,
 * y el error costó un agujero: ese otro aviso pregunta **qué se promete en
 * pantalla y no va a ocurrir**, que es un predicado distinto. El convenio ahí SÍ
 * entra —con la boleta entera a capital no se acredita en `convenios_pago`—, y
 * gatear ese aviso por esta lista lo dejaba sin salir cuando lo único prometido
 * era el convenio. Ver `loQueElAbonoACapitalNoAplica`.
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

export type AvisoAbonoACapital = {
  /** Lo prometido que no va a aplicarse, ya redactado y en orden de pantalla. */
  etiquetas: string[];
  /** Cuánto suma todo eso. */
  total: number;
  /** Si hay algo que advertir. */
  hayAviso: boolean;
};

/**
 * Contesta la OTRA pregunta: **¿qué de lo que el modal promete no va a pasar si
 * el asesor aprieta "Abonar todo a Capital"?**
 *
 * Esa opción manda la boleta entera a `abono_directo_capital`, y el backend
 * arranca la cascada con `boleta − otros − abono directo`
 * (`calcularMontoEfectivo`): con el abono igual a la boleta el disponible queda
 * en cero y nada de lo que el desglose anuncia se aplica.
 *
 * Es un predicado distinto al de `escalonesQueConsumenLaBoleta`, y colapsarlos
 * en uno fue el error que dejó dos huecos:
 *
 *   * **el convenio**. No consume la boleta, así que no está en la otra lista —
 *     pero SÍ se acredita normalmente en `convenios_pago`, y con el abono
 *     directo no: `debeProcesarConvenio` exige disponible `> 0`, así que
 *     `prepararConvenioPayment` no corre y no se escribe nada. El modal muestra
 *     la contribución al convenio DOS veces (en el escalón 4 y en el pie) y el
 *     aviso no salía si era lo único prometido;
 *   * **el excedente**. El modal promete "Excedente (nuevo saldo a favor)", y el
 *     bloque que lo acredita tampoco corre con el disponible en cero: esa plata
 *     se va a capital.
 *
 * ⚠️ **`otros` NO entra**, y es la diferencia más fina con la otra lista: sí
 * consume la boleta —se resta en `calcularMontoEfectivo`— pero el abono directo
 * NO lo anula, porque es una columna de la fila del pago y se guarda tal como
 * vino. Anunciar que "no se cobra otros" sería otra frase falsa. Lo que el abono
 * directo deja en cero es todo lo que sale del DISPONIBLE: mora, rubros,
 * convenio, cuota y excedente.
 *
 * Por eso recibe montos explícitos en vez de reusar la lista de la otra
 * pregunta. Compartirla fue el error original: las dos listas se parecen y no
 * son la misma, y el parecido tapó que `otros` estaba de un lado y no del otro.
 */
export function loQueElAbonoACapitalNoAplica(entrada: {
  mora: number;
  rubros: number;
  convenio: number;
  excedente: number;
}): AvisoAbonoACapital {
  // El orden es el de la pantalla, de arriba hacia abajo: el asesor lee el aviso
  // contra el desglose que tiene a la vista.
  const partes: { etiqueta: string; monto: number }[] = [
    { etiqueta: `Q${entrada.mora.toFixed(2)} a mora`, monto: entrada.mora },
    { etiqueta: `Q${entrada.rubros.toFixed(2)} a rubros`, monto: entrada.rubros },
    { etiqueta: `Q${entrada.convenio.toFixed(2)} al convenio`, monto: entrada.convenio },
    {
      etiqueta: `Q${entrada.excedente.toFixed(2)} de excedente a saldo a favor`,
      monto: entrada.excedente,
    },
  ].filter((p) => p.monto > UN_CENTAVO_Y_MEDIO);

  const total = partes.reduce((suma, p) => suma + p.monto, 0);

  return {
    etiquetas: partes.map((p) => p.etiqueta),
    total: Math.round(total * 100) / 100,
    hayAviso: partes.length > 0,
  };
}
