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
// Guard de monto_aportado==0 — SOLO con `body.motivo === "devolucion_verificado"`:
// el endpoint es genérico (Codex P1: "the existing full-exit path explicitly
// permits nonzero balances because it transfers them to CUBE"), así que un
// guard incondicional rompía la salida total legítima (ver revert 3d433df5e).
// Pero sin ningún guard, usar este endpoint para la devolución de un crédito
// VERIFICADO (en vez de esperar al pago normal) puede mover al inversionista
// a CUBE con su CANCELACION de abonos_capital todavía abierta: esa fila queda
// huérfana para siempre, porque ya no tiene fila en el espejo que la pueda
// consumir (Codex, hilo original). El caller que sabe que está haciendo esa
// devolución debe pedirlo explícitamente con `motivo`; sin él, el endpoint se
// comporta exactamente igual que antes (salida total, sin validar saldo).
//
// TODO o nada, nunca un subconjunto filtrado: una primera versión de este
// guard pasaba solo los créditos con espejo en 0 a exitInvestor, pero
// exitInvestor marca inactivo con que UN crédito se haya procesado —no exige
// que se hayan procesado TODOS los pedidos—, así que un lote mixto dejaba al
// inversionista inactivo con la posición omitida (capital pendiente) todavía
// a su nombre (Codex, hilo de seguimiento). Con motivo=devolucion_verificado
// el batch entero se rechaza si CUALQUIER crédito no tiene el espejo en 0,
// con set.status=400 para que el caller lo note por código de estado y no
// solo por `success:false` en el body.
//
// Asimismo, saldo en 0 no es suficiente por sí solo: el cálculo de pagos
// (payments.ts) descuenta el monto_aportado del espejo antes de liquidar el
// dinero, por lo que el guard también valida que no existan abonos_capital
// ni pagos espejo pendientes de liquidación para esos créditos. Si hay
// liquidaciones pendientes, el lote se rechaza para no desasociar al
// inversionista antes del cierre contable.
// ============================================================================

import { and, eq, inArray, ne } from "drizzle-orm";

import type { exitInvestor as ExitInvestorFn } from "./investor";
import { db } from "../database/index";
import {
  abonos_capital,
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
    };
  const obtenerMontoAportadoEspejo = resolved.obtenerMontoAportadoEspejo ?? obtenerMontoAportadoEspejoReal;
  const tienePendientesLiquidacion = resolved.tienePendientesLiquidacion ?? tienePendientesLiquidacionReal;

  const { inversionista_id, creditos: creditoIds, motivo } = ctx?.body ?? {};

  if (
    motivo === "devolucion_verificado" &&
    typeof inversionista_id === "number" &&
    Array.isArray(creditoIds) &&
    creditoIds.length > 0
  ) {
    const [montoPorCredito, creditosConPendientes] = await Promise.all([
      obtenerMontoAportadoEspejo(inversionista_id, creditoIds),
      tienePendientesLiquidacion(inversionista_id, creditoIds),
    ]);

    const creditoIdsInvalidos = creditoIds.filter(
      (id: number) => montoPorCredito.get(id) !== 0 || creditosConPendientes.has(id)
    );

    // Todo o nada: nunca se llama a exitInvestor con un subconjunto. Ver
    // comentario de arriba sobre por qué filtrar dejaba al inversionista
    // inactivo con posiciones pendientes a su nombre.
    if (creditoIdsInvalidos.length > 0) {
      console.warn(
        `  ⚠️  [POST /investor/exit motivo=devolucion_verificado] inversionista ${inversionista_id}: ` +
          `lote rechazado, ${creditoIdsInvalidos.length}/${creditoIds.length} crédito(s) inválidos ` +
          `(saldo != 0, sin fila espejo, o abonos/pagos sin liquidar) — ` +
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
          "Lote rechazado: al menos un crédito tiene capital pendiente, no tiene fila en el espejo, o tiene abonos/pagos pendientes de liquidación. No se movió nada.",
        creditos_invalidos: creditoIdsInvalidos,
      };
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
