// ============================================================================
// Handler de `POST /investor/exit` — envuelve `exitInvestor` con el mismo
// cierre de devolución que ya aplican las dos ramas de `liquidateByInvestorId`
// (FASE 5). Sin esto, sacar manualmente al último inversionista no-CUBE de un
// crédito en VERIFICADO por esta ruta dejaba el crédito colgado: el padre
// quedaba transferido a CUBE, pero `estado_devolucion` nunca se cerraba,
// porque el barrido de `liquidateByInvestorId` solo corre dentro de una
// liquidación, y esta ruta no pasa por ahí.
//
// Vive en su propio archivo (no en investor.ts) por dos motivos:
//   1. `marcarDevolucionCompletadaSiCorresponde` vive en
//      utils/devolucionCompletada.ts, que a su vez es importado por
//      investor.ts — moverlo ahí generaría un ciclo (devolucionCompletada.ts
//      necesitaría `exitInvestor`, que vive en investor.ts).
//   2. Permite testear el wrapper sin arrastrar el grafo de imports de
//      investor.ts (`lockPool`, etc.) hasta los `mock.module` de otros tests
//      de la suite — mismo motivo por el que los helpers de cierre se
//      movieron a utils/devolucionCompletada.ts. Por eso `exitInvestor` se
//      importa DINÁMICO y perezoso (recién al ejecutar, solo si no se
//      inyectó `deps`): un `import` estático de "./investor" en la cabecera
//      cargaría ese módulo completo con solo importar este archivo, aunque
//      el caller nunca use el default.
//
// `exitInvestor` no se toca: la llaman también las dos ramas de FASE 5, que
// ya hacen su propio cierre después — envolverlo ahí duplicaría la llamada.
//
// Guard de devolución y saldo en 0:
// Se activa si `body.motivo === "devolucion_verificado"` O si CUALQUIERA de
// los créditos del lote tiene `estado_devolucion === "VERIFICADO"`. Sin este
// guard automático por estado (Point 2), un operador que llame a /investor/exit
// sin mandar `motivo` movería un inversionista en devolución a CUBE dejando su
// CANCELACION de abonos_capital huérfana. Créditos normales no-VERIFICADO sin
// motivo siguen el camino de salida total estándar (transfieren saldo a CUBE).
//
// TODO o nada, nunca un subconjunto filtrado: una primera versión de este
// guard pasaba solo los créditos con espejo en 0 a exitInvestor, pero
// exitInvestor marca inactivo con que UN crédito se haya procesado —no exige
// que se hayan procesado TODOS los pedidos—, así que un lote mixto dejaba al
// inversionista inactivo con la posición omitida (capital pendiente) todavía
// a su nombre (Codex, hilo de seguimiento). Con el guard activo, el batch
// entero se rechaza si CUALQUIER crédito en devolución tiene saldo residual
// != 0 o liquidaciones pendientes, con set.status=400.
//
// Créditos en devolución sin fila espejo (P1 guard):
// Al igual que en investor.ts:5653-5669, un crédito en devolución solo es válido
// si tiene fila en el espejo Y su saldo es exactamente 0. Si no tiene fila espejo,
// no hay evidencia de que el inversionista haya sido pagado; se rechaza para
// revisión manual en vez de asumir saldo cero.
//
// Lotes mixtos en activación automática (P2 guard):
// Cuando el guard se activa automáticamente (sin motivo explícito), la exigencia
// de saldo en 0 y pendientes solo aplica a los créditos en VERIFICADO. Los créditos
// ordinarios transfieren válidamente su saldo a CUBE. Si cualquiera de los créditos
// en VERIFICADO es inválido, se rechaza el lote completo (todo o nada).
// ============================================================================

import { and, eq, inArray, ne } from "drizzle-orm";

import type { exitInvestor as ExitInvestorFn } from "./investor";
import { db } from "../database/index";
import {
  abonos_capital,
  creditos,
  creditos_inversionistas_espejo,
  pagos_credito_inversionistas_espejo,
} from "../database/db/schema";
import { marcarDevolucionCompletadaSiCorresponde } from "../utils/devolucionCompletada";

type Deps = {
  exitInvestor: typeof ExitInvestorFn;
  marcarDevolucionCompletadaSiCorresponde: typeof marcarDevolucionCompletadaSiCorresponde;
  obtenerMontoAportadoEspejo?: (
    inversionista_id: number,
    creditoIds: number[]
  ) => Promise<Map<number, number>>;
  tienePendientesLiquidacion?: (
    inversionista_id: number,
    creditoIds: number[]
  ) => Promise<Set<number>>;
  obtenerEstadosDevolucion?: (
    creditoIds: number[]
  ) => Promise<Map<number, string | null>>;
};

// Por defecto usa `db` real; inyectable para los tests del guard.
const obtenerMontoAportadoEspejoReal = async (
  inversionista_id: number,
  creditoIds: number[]
): Promise<Map<number, number>> => {
  if (creditoIds.length === 0) return new Map();

  const filas = await db
    .select({
      credito_id: creditos_inversionistas_espejo.credito_id,
      monto_aportado: creditos_inversionistas_espejo.monto_aportado,
    })
    .from(creditos_inversionistas_espejo)
    .where(
      and(
        inArray(creditos_inversionistas_espejo.credito_id, creditoIds),
        eq(creditos_inversionistas_espejo.inversionista_id, inversionista_id)
      )
    );

  return new Map(
    filas.map((f: { credito_id: number; monto_aportado: string }) => [f.credito_id, Number(f.monto_aportado)])
  );
};

const obtenerEstadosDevolucionReal = async (
  creditoIds: number[]
): Promise<Map<number, string | null>> => {
  if (creditoIds.length === 0) return new Map();

  const filas = await db
    .select({
      credito_id: creditos.credito_id,
      estado_devolucion: creditos.estado_devolucion,
    })
    .from(creditos)
    .where(inArray(creditos.credito_id, creditoIds));

  return new Map(
    filas.map((f: { credito_id: number; estado_devolucion: string | null }) => [
      f.credito_id,
      f.estado_devolucion,
    ])
  );
};

// Verifica si hay abonos a capital (ej. CANCELACION de devolución) o pagos
// espejo pendientes de liquidar. Durante el cálculo de pagos, el monto_aportado
// del espejo ya se reduce a 0 pero la liquidación aún no ocurre; permitir la
// salida en esa ventana dejaría las filas huérfanas al desaparecer el inversionista.
const tienePendientesLiquidacionReal = async (
  inversionista_id: number,
  creditoIds: number[]
): Promise<Set<number>> => {
  if (creditoIds.length === 0) return new Set();

  const [abonosAbiertos, pagosNoLiquidados] = await Promise.all([
    db
      .select({ credito_id: abonos_capital.credito_id })
      .from(abonos_capital)
      .where(
        and(
          inArray(abonos_capital.credito_id, creditoIds),
          eq(abonos_capital.inversionista_id, inversionista_id),
          eq(abonos_capital.liquidado, false)
        )
      ),
    db
      .select({ credito_id: pagos_credito_inversionistas_espejo.credito_id })
      .from(pagos_credito_inversionistas_espejo)
      .where(
        and(
          inArray(pagos_credito_inversionistas_espejo.credito_id, creditoIds),
          eq(pagos_credito_inversionistas_espejo.inversionista_id, inversionista_id),
          ne(pagos_credito_inversionistas_espejo.estado_liquidacion, "LIQUIDADO")
        )
      ),
  ]);

  const pendientes = new Set<number>();
  for (const a of abonosAbiertos) pendientes.add(a.credito_id);
  for (const p of pagosNoLiquidados) pendientes.add(p.credito_id);
  return pendientes;
};

// `deps` es inyectable para poder probar el wrapper sin pasar por la
// conexión real ni por exitInvestor completo. Sin inyección (uso normal
// desde el router), resuelve las funciones reales perezosamente.
export const exitInvestorHandler = async (ctx: any, deps?: Deps) => {
  const resolved: Deps =
    deps ?? {
      exitInvestor: (await import("./investor")).exitInvestor,
      marcarDevolucionCompletadaSiCorresponde,
      obtenerMontoAportadoEspejo: obtenerMontoAportadoEspejoReal,
      tienePendientesLiquidacion: tienePendientesLiquidacionReal,
      obtenerEstadosDevolucion: obtenerEstadosDevolucionReal,
    };
  const obtenerMontoAportadoEspejo = resolved.obtenerMontoAportadoEspejo ?? obtenerMontoAportadoEspejoReal;
  const tienePendientesLiquidacion = resolved.tienePendientesLiquidacion ?? tienePendientesLiquidacionReal;
  const obtenerEstadosDevolucion = resolved.obtenerEstadosDevolucion ?? obtenerEstadosDevolucionReal;

  const { inversionista_id, creditos: creditoIds, motivo } = ctx?.body ?? {};

  if (
    typeof inversionista_id === "number" &&
    Array.isArray(creditoIds) &&
    creditoIds.length > 0
  ) {
    const estadosDevolucion = await obtenerEstadosDevolucion(creditoIds);
    const creditosVerificados = creditoIds.filter(
      (id: number) => estadosDevolucion.get(id) === "VERIFICADO"
    );
    const tieneCreditoVerificado = creditosVerificados.length > 0;

    if (motivo === "devolucion_verificado" || tieneCreditoVerificado) {
      // Cuando motivo === "devolucion_verificado", el llamador declara explícitamente que el lote
      // entero es de devolución, por lo que se valida todo el lote.
      // Cuando el guard se activa automáticamente (sin motivo), solo se valida que los créditos
      // en estado VERIFICADO tengan su devolución completa (saldo en 0 y sin pendientes),
      // permitiendo que los créditos ordinarios transfieran legítimamente su capital a CUBE.
      const creditosAValidar =
        motivo === "devolucion_verificado" ? creditoIds : creditosVerificados;

      const [montoPorCredito, creditosConPendientes] = await Promise.all([
        obtenerMontoAportadoEspejo(inversionista_id, creditosAValidar),
        tienePendientesLiquidacion(inversionista_id, creditosAValidar),
      ]);

      const creditoIdsInvalidos = creditosAValidar.filter((id: number) => {
        if (creditosConPendientes.has(id)) return true;
        const saldo = montoPorCredito.get(id);
        // P1 guard: un crédito en devolución solo es válido si tiene fila en el espejo
        // Y su saldo es exactamente 0. Si no tiene fila espejo (saldo === undefined)
        // o su saldo es distinto de 0, queda en revisión manual (igual que investor.ts:5653).
        if (saldo !== 0) return true;
        return false;
      });

      // Todo o nada: nunca se llama a exitInvestor con un subconjunto. Ver
      // comentario de arriba sobre por qué filtrar dejaba al inversionista
      // inactivo con posiciones pendientes a su nombre.
      if (creditoIdsInvalidos.length > 0) {
        console.warn(
          `  ⚠️  [POST /investor/exit guard devolución] inversionista ${inversionista_id}: ` +
            `lote rechazado, ${creditoIdsInvalidos.length}/${creditoIds.length} crédito(s) inválidos ` +
            `(saldo != 0 o abonos/pagos sin liquidar) — ` +
            creditoIdsInvalidos
              .map((id) => {
                const saldo = montoPorCredito.get(id);
                const saldoDesc = saldo === undefined ? "SIN_FILA_ESPEJO" : `monto_aportado=${saldo}`;
                const pendDesc = creditosConPendientes.has(id) ? "TIENE_PENDIENTES_LIQUIDACION" : null;
                const detalle = [saldoDesc, pendDesc].filter(Boolean).join(" ");
                return `credito_id=${id} (${detalle})`;
              })
              .join(", ")
        );
        if (ctx?.set) ctx.set.status = 400;
        return {
          success: false,
          message:
            "Lote rechazado: al menos un crédito en devolución tiene capital pendiente o abonos/pagos pendientes de liquidación. No se movió nada.",
          creditos_invalidos: creditoIdsInvalidos,
        };
      }
    }
  }

  const resultado: any = await resolved.exitInvestor(ctx);

  if (resultado?.success) {
    // En su propio try/catch, igual que el barrido de liquidateByInvestorId:
    // exitInvestor ya movió la plata con éxito (transacción propia, ya hizo
    // COMMIT); si el cierre de la devolución falla acá, es un problema
    // aparte —el crédito queda VERIFICADO, revisable después con el
    // historial— y no debe convertir una operación exitosa en un 500 que
    // le haga creer al operador que la salida del inversionista falló.
    try {
      const creditoIdsProcesados: number[] = (resultado.creditos_procesados ?? []).map(
        (r: any) => r.credito_id
      );
      await resolved.marcarDevolucionCompletadaSiCorresponde(
        creditoIdsProcesados,
        `POST /investor/exit inv ${resultado.inversionista?.inversionista_id ?? "?"}`
      );
    } catch (cierreError) {
      console.error(
        `  ⚠️  Error cerrando la devolución tras /investor/exit (la salida del inversionista sí se completó):`,
        cierreError
      );
    }
  }

  return resultado;
};
