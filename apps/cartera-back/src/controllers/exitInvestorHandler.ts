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
// Guard de monto_aportado==0 (recomendación de Codex): RAMA 2 de
// liquidateByInvestorId (investor.ts) nunca llama a exitInvestor para un
// crédito VERIFICADO sin antes confirmar que el espejo de ese inversionista
// ya está en 0 — su capital pendiente (fila CANCELACION de
// abonos_capital, creada al aceptar la devolución) ya se pagó y se marcó
// liquidado por el flujo normal de pagos. Este endpoint manual no pasaba por
// esa validación: podía mover al inversionista a CUBE con capital pendiente,
// dejando esa CANCELACION huérfana para siempre (apunta a un inversionista
// que ya no tiene fila en el espejo, así que ningún pago futuro puede
// consumirla) y cerrando igual el crédito como COMPLETADO sin haberle
// pagado. Se agrega acá el mismo filtro: los créditos con monto pendiente
// (o sin fila en el espejo) se excluyen antes de llamar a exitInvestor.
// ============================================================================

import { and, eq, inArray } from "drizzle-orm";

import type { exitInvestor as ExitInvestorFn } from "./investor";
import { db } from "../database/index";
import { creditos_inversionistas_espejo } from "../database/db/schema";
import { marcarDevolucionCompletadaSiCorresponde } from "../utils/devolucionCompletada";

type Deps = {
  exitInvestor: typeof ExitInvestorFn;
  marcarDevolucionCompletadaSiCorresponde: typeof marcarDevolucionCompletadaSiCorresponde;
  obtenerMontoAportadoEspejo?: (
    inversionista_id: number,
    creditoIds: number[]
  ) => Promise<Map<number, number>>;
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

  return new Map(filas.map((f: { credito_id: number; monto_aportado: string }) => [f.credito_id, Number(f.monto_aportado)]));
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
    };
  const obtenerMontoAportadoEspejo = resolved.obtenerMontoAportadoEspejo ?? obtenerMontoAportadoEspejoReal;

  const { inversionista_id, creditos: creditoIds } = ctx?.body ?? {};

  let ctxFiltrado = ctx;
  let creditoIdsOmitidos: number[] = [];

  if (
    typeof inversionista_id === "number" &&
    Array.isArray(creditoIds) &&
    creditoIds.length > 0
  ) {
    const montoPorCredito = await obtenerMontoAportadoEspejo(inversionista_id, creditoIds);

    const creditoIdsValidos = creditoIds.filter((id: number) => montoPorCredito.get(id) === 0);
    creditoIdsOmitidos = creditoIds.filter((id: number) => !creditoIdsValidos.includes(id));

    if (creditoIdsOmitidos.length > 0) {
      console.warn(
        `  ⚠️  [POST /investor/exit] inversionista ${inversionista_id}: ${creditoIdsOmitidos.length} ` +
          `crédito(s) con espejo != 0 (o sin fila) se omiten para no dejar capital pendiente huérfano — ` +
          creditoIdsOmitidos
            .map((id) => `credito_id=${id} monto_aportado=${montoPorCredito.get(id) ?? "SIN_FILA_ESPEJO"}`)
            .join(", ")
      );
    }

    if (creditoIdsValidos.length === 0) {
      return {
        success: false,
        message:
          "Ningún crédito pasó la validación de capital pendiente (monto_aportado != 0 en el espejo o sin fila). No se movió nada.",
        creditos_omitidos: creditoIdsOmitidos,
      };
    }

    ctxFiltrado = { ...ctx, body: { ...ctx.body, creditos: creditoIdsValidos } };
  }

  const resultado: any = await resolved.exitInvestor(ctxFiltrado);
  if (resultado?.success && creditoIdsOmitidos.length > 0) {
    resultado.creditos_omitidos = creditoIdsOmitidos;
  }

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
