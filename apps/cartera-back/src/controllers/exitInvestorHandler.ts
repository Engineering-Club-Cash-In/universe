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
// ============================================================================

import type { exitInvestor as ExitInvestorFn } from "./investor";
import { marcarDevolucionCompletadaSiCorresponde } from "../utils/devolucionCompletada";

type Deps = {
  exitInvestor: typeof ExitInvestorFn;
  marcarDevolucionCompletadaSiCorresponde: typeof marcarDevolucionCompletadaSiCorresponde;
};

// `deps` es inyectable para poder probar el wrapper sin pasar por la
// conexión real ni por exitInvestor completo. Sin inyección (uso normal
// desde el router), resuelve las funciones reales perezosamente.
export const exitInvestorHandler = async (ctx: any, deps?: Deps) => {
  const resolved: Deps =
    deps ?? {
      exitInvestor: (await import("./investor")).exitInvestor,
      marcarDevolucionCompletadaSiCorresponde,
    };

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
