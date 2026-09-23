/**
 * Qué dice la tarjeta "Detalles de Mora" del detalle de crédito.
 *
 * EL PROBLEMA QUE RESUELVE. Con la mora vieja la tarjeta reconciliaba sola: el
 * monto ERA `capital × % × cuotas atrasadas`, así que mostrar los tres números
 * uno al lado del otro era mostrar la fórmula y su resultado. Con la mora
 * PROPORCIONAL el monto se acumula por DÍA —cada cuota atrasada suma su cargo
 * mensual en partes de 1/30 por día— y los mismos tres números dejaron de
 * cerrar: "1.12%", "3 cuotas" y "Q37.33" son los tres correctos, pero quien
 * multiplica obtiene Q336 y concluye que el monto está mal.
 *
 * LA DECISIÓN. No se esconde el porcentaje: se lo pone donde es verdad. Q336
 * no es un error, es el cargo COMPLETO de esas 3 cuotas, el que se cobra recién
 * cuando cada una cumple 30 días de atraso. Así la multiplicación que el
 * usuario iba a hacer igual deja de ser una contradicción y pasa a ser el
 * techo, y la tarjeta dice además a qué ritmo se va llegando a él.
 *
 * Vive en `src/lib` porque carteraFront no tiene DOM ni testing-library: la
 * decisión de qué texto mostrar se prueba acá, y el cableado con un test de
 * contrato sobre el fuente de la tarjeta.
 */

import { fmtQ } from "./moneda";

/** Días que tarda una cuota atrasada en devengar su cargo mensual completo. */
export const DIAS_CARGO_COMPLETO = 30;

/**
 * Lo que la tarjeta recibe. Todo llega de `getCreditoByNumero`: `mora` (fila de
 * `moras_credito`) y, como hermanos suyos, `incrementoDiarioMora` e
 * `incrementoMaximoMensualMora`. Los tipos son laxos a propósito: los montos
 * viajan como string con 2 decimales y los campos nuevos pueden no venir si el
 * front habla con un backend viejo.
 */
export interface MoraTarjetaDatos {
  montoMora?: unknown;
  cuotasAtrasadas?: unknown;
  porcentajeMora?: unknown;
  incrementoDiarioMora?: unknown;
  incrementoMaximoMensualMora?: unknown;
}

export interface MoraTarjeta {
  /** Monto acumulado HOY, ya formateado. */
  monto: string;
  /** Rótulo del monto. Dice "hoy" porque mañana es otro número. */
  rotuloMonto: string;
  cuotas: number;
  /**
   * A qué ritmo sube, o el aviso de que ya no sube. `null` solo si el backend
   * no mandó el dato (payload viejo): nunca se inventa un ritmo.
   */
  ritmo: string | null;
  /**
   * A cuánto llega en 30 días si nadie paga. `null` solo cuando el techo del
   * mes es cero, o sea cuando la mora de verdad ya no puede subir.
   */
  techo: string | null;
  /** Por qué el monto no es `capital × % × cuotas`. Siempre se muestra. */
  explicacion: string;
}

/** Number() tolerante: devuelve null para null/""/NaN en vez de 0. */
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function construirMoraTarjeta(datos: MoraTarjetaDatos): MoraTarjeta {
  const monto = num(datos.montoMora) ?? 0;
  const cuotas = num(datos.cuotasAtrasadas) ?? 0;
  const porcentaje = num(datos.porcentajeMora);
  const diario = num(datos.incrementoDiarioMora);
  const maximo = num(datos.incrementoMaximoMensualMora);

  // El ritmo: si el backend no lo mandó no se dice nada (no se deduce de
  // monto/cuotas: eso sería volver a la fórmula vieja por la ventana). Si lo
  // mandó en 0, la mora de estas cuotas ya topó y decirlo es información útil.
  let ritmo: string | null = null;
  let techo: string | null = null;
  if (diario !== null) {
    // El techo del mes y el incremento diario NO miden lo mismo: el diario mide
    // solo MAÑANA, mientras que el máximo incluye además las cuotas que VENCEN
    // dentro de los próximos 30 días. Por eso existe el caso `diario = 0` con
    // `máximo > 0`: las cuotas ya vencidas topearon su cargo, pero la próxima
    // cuota está por vencer y la mora va a volver a subir. El techo positivo
    // vale en los dos casos, así que se calcula antes de elegir el texto.
    if (maximo !== null && maximo > 0) {
      // EL ALCANCE DE LA PROYECCIÓN, dicho en voz alta. Sin esta segunda frase
      // la tarjeta se contradecía sola: la explicación llama a
      // `capital × % × cuotas` "el cargo completo de esas cuotas" —o sea, su
      // techo— y acá se anunciaba un techo a 30 días MAYOR que ese número,
      // porque `incrementoMaximoMensualMora` ya cuenta las cuotas que vencen
      // dentro de la ventana. Con 1 cuota atrasada el usuario leía "el cargo
      // completo es Q112" y debajo "en 30 días llega a Q149": justo la
      // contradicción que esta tarjeta vino a resolver.
      //
      // No se puede reconciliar contra un conteo PROYECTADO porque el payload
      // no trae el capital: `capital × % × N` se muestra simbólicamente, nunca
      // se calcula. Así que se nombra el alcance, que además es lo que el
      // usuario necesita para no negociar sobre el número equivocado.
      techo =
        `Si no se paga, en ${DIAS_CARGO_COMPLETO} días llega a ${fmtQ(
          monto + maximo
        )}. Esa proyección incluye las cuotas que venzan dentro de esos ` +
        `${DIAS_CARGO_COMPLETO} días` +
        (cuotas > 0
          ? `, no solo las ${cuotas} ya vencidas: por eso puede pasar del cargo ` +
            `completo de esas ${cuotas}.`
          : `.`);
    }
    if (diario > 0) {
      ritmo = `Sube ${fmtQ(diario)} por cada día que pase sin pagar.`;
    } else if (techo !== null) {
      // "Ya no sube" acá sería falso: es "hoy no sube". Decir que nunca más va
      // a subir manda al usuario a negociar sobre un número que mañana cambia.
      ritmo =
        `Hoy no sube: estas cuotas atrasadas llegaron a su cargo completo. ` +
        `Vuelve a subir cuando venza la próxima cuota.`;
    } else {
      ritmo = `Ya no sube: estas cuotas atrasadas llegaron a su cargo completo.`;
    }
  }

  // La explicación desarma la multiplicación nombrándola: se dice a cuánto da y
  // qué significa ese número, en vez de dejar que el usuario la haga solo.
  const explicacion =
    porcentaje !== null && cuotas > 0
      ? `La mora se acumula por día: cada cuota atrasada devenga su cargo de ${porcentaje}% ` +
        `del capital en partes de 1/${DIAS_CARGO_COMPLETO} por día. Por eso NO es ` +
        `capital × ${porcentaje}% × ${cuotas}: eso es el cargo completo, el que se alcanza ` +
        `recién cuando cada una de las ${cuotas} cuotas YA VENCIDAS cumple ${DIAS_CARGO_COMPLETO} días ` +
        `de atraso. Es el techo de esas ${cuotas}, no el de la proyección a ${DIAS_CARGO_COMPLETO} días.`
      : `La mora se acumula por día: cada cuota atrasada devenga su cargo mensual en partes ` +
        `de 1/${DIAS_CARGO_COMPLETO} por día, no completo desde el primer día.`;

  return {
    monto: fmtQ(monto),
    rotuloMonto: "Mora acumulada a hoy",
    cuotas,
    ritmo,
    techo,
    explicacion,
  };
}
