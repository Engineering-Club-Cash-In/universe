import Big from "big.js";

export type AbonoNoLiquidado = {
  abono_id: number;
  tipo: string;
  monto: string | number;
};

/**
 * Resuelve qué abonos a capital no liquidados deben sumarse al pago y
 * cuáles deben marcarse como consumidos para que la liquidación los cierre.
 *
 * Extraída a utils/abonosNoLiquidados.ts para que:
 * 1. Pueda probarse de forma aislada sin levantar la infraestructura ni
 *    sufrir por mocks globales de bun (`mock.module("./payments")`).
 * 2. Mantenga desacoplada la lógica de cálculo puro del controlador monolítico.
 *
 * Reglas:
 * - Si el inversionista está saliendo del crédito por completo
 *   (`devolucionCompleta`, o sea VERIFICADO/pendiente_devolucion y no-CUBE),
 *   ningún abono pendiente se SUMA: su abono_capital ya es el monto_aportado
 *   completo, sumarlos duplicaría el conteo. Todos los abonos pendientes se
 *   marcan consumidos (el pago devuelve el 100% del capital restante y cierra
 *   su posición, por lo que tanto CANCELACION como CAPITAL quedan saldados y
 *   deben cerrarse al liquidar para no quedar huérfanos).
 * - Si no, los CAPITAL se suman al abono_capital base. Un CANCELACION (que
 *   normalmente dispara "devolver todo el aportado") solo lo hace si el
 *   inversionista no es CUBE — CUBE nunca sale del crédito, así que una
 *   CANCELACION a su nombre es basura de una corrida anterior del bug de
 *   payments.ts:916, no algo que corresponda pagarle.
 *   IMPORTANTE (Point 5 fix): Si hay una CANCELACION (no-CUBE), el abonoCapital
 *   se fija en `montoAportado`. NO se le suma montoAbono de filas CAPITAL
 *   adicionales, ya que `montoAportado` representa el 100% del capital y sumarle
 *   capital adicional excedería dicho monto (disparando [ABONO_SUPERA_MONTO]).
 *   Ambos abonos se incluyen en `abonoIdsConsumidos` para quedar liquidados.
 * - Los abonos "consumidos" (los que se cerrarán al liquidar) son TODOS los
 *   no liquidados, EXCEPTO una CANCELACION de CUBE: si esa se marcara
 *   consumida iría a `liquidado=true` sin que su monto haya entrado en
 *   ningún cálculo, dejando un registro contable falso de "se le pagó a
 *   CUBE su devolución". Queda abierta para revisión/limpieza manual.
 */
export function resolverAbonosNoLiquidados(params: {
  abonosNoLiquidados: AbonoNoLiquidado[];
  abonoCapitalBase: Big;
  montoAportado: string | number;
  devolucionCompleta: boolean;
  isCube: boolean;
}): {
  abonoCapital: Big;
  abonoCapitalId: number | null;
  abonoIdsConsumidos: number[];
  saltado: boolean;
} {
  const { abonosNoLiquidados, abonoCapitalBase, montoAportado, devolucionCompleta, isCube } = params;

  if (abonosNoLiquidados.length === 0) {
    return { abonoCapital: abonoCapitalBase, abonoCapitalId: null, abonoIdsConsumidos: [], saltado: false };
  }

  if (devolucionCompleta) {
    // Al devolverse el 100% del monto_aportado, este pago cubre la totalidad del
    // capital pendiente del inversionista (tanto CANCELACION como abonos CAPITAL
    // previos no liquidados). Todos deben marcarse como consumidos para que la
    // liquidación los cierre (liquidado=true) mediante pago_espejo_id. Si alguno
    // quedara fuera, al salir el inversionista en FASE 5 esa fila quedaría
    // huérfana en abonos_capital para siempre.
    const abonoIdsConsumidos = abonosNoLiquidados
      .filter((a) => !(isCube && a.tipo === "CANCELACION"))
      .map((a) => a.abono_id);
    return {
      abonoCapital: abonoCapitalBase,
      abonoCapitalId: null,
      abonoIdsConsumidos,
      saltado: true,
    };
  }

  let tieneCancelacion = false;
  let montoAbono = new Big(0);
  for (const abono of abonosNoLiquidados) {
    if (abono.tipo === "CAPITAL") {
      montoAbono = montoAbono.plus(abono.monto);
    } else if (abono.tipo === "CANCELACION" && !isCube) {
      tieneCancelacion = true;
    }
  }

  let abonoCapital: Big;
  if (tieneCancelacion) {
    // CANCELACION de un inversionista normal: representa devolver su monto_aportado completo.
    // No se suma montoAbono encima de montoAportado para evitar que supere el capital del inversionista.
    abonoCapital = new Big(montoAportado || 0);
  } else {
    abonoCapital = abonoCapitalBase;
    if (!montoAbono.eq(0)) {
      abonoCapital = abonoCapital.plus(montoAbono);
    }
  }

  const abonoIdsConsumidos = abonosNoLiquidados
    .filter((a) => !(isCube && a.tipo === "CANCELACION"))
    .map((a) => a.abono_id);

  // abonoCapitalId debe apuntar a una fila realmente reflejada en el pago
  // (sumada o consumida), nunca a abonosNoLiquidados[0] a secas: si la
  // CANCELACION de CUBE ignorada es la única fila pendiente,
  // abonoIdsConsumidos queda vacío y no hay ningún abono que enlazar —
  // dejar el id crudo del primero (aunque sea el de CUBE) generaría un
  // abono_capital_detalle fantasma vía resumeInvestor, apuntando a capital
  // que ni se sumó ni se consumió.
  const abonoCapitalId = abonoIdsConsumidos.length > 0 ? abonoIdsConsumidos[0] : null;

  return {
    abonoCapital,
    abonoCapitalId,
    abonoIdsConsumidos,
    saltado: false,
  };
}
