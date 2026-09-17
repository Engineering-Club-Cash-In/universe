import { and, eq, inArray } from "drizzle-orm";

import { db } from "../database/index";
import {
  creditos,
  creditos_inversionistas,
  creditos_inversionistas_espejo,
  historial_devolucion_credito,
  inversionistas,
} from "../database/db/schema";

// ============================================================================
// Cierre de la devolución de un crédito a CUBE.
//
// Vive fuera de investor.ts a propósito: son funciones puras respecto de la
// conexión (reciben el ejecutor por parámetro), y aisladas se pueden probar
// sin arrastrar el grafo de imports de investor.ts —que incluye `lockPool`—
// hasta un `mock.module` de otro archivo de la suite.
// ============================================================================

export const CUBE_ID = 86;

/**
 * Único punto del proyecto que decide "¿este inversionista es CUBE?".
 * Por ID primero — es la fuente canónica — con el nombre como red de
 * seguridad para filas históricas donde el ID quedó distinto.
 *
 * Exportado desde acá (no redefinido por archivo) porque dos guards
 * independientes dependen de que ambos usen EXACTAMENTE el mismo criterio:
 * `payments.ts::esDevolucionCompleta` (nunca tratar a CUBE como saliente) y
 * `abonosCapital.ts::registrarCancelacionEspejo` (nunca generarle una
 * CANCELACION). Si cada uno filtrara solo por `inversionista_id === 86`,
 * una fila histórica de CUBE con otro ID pasaría el filtro de creación en
 * abonosCapital.ts pero payments.ts la reconocería como CUBE por nombre y
 * la excluiría de todo cálculo — recreando el mismo dato fantasma que este
 * guard existe para evitar.
 */
export const esCube = (inv: { inversionista_id: number; nombre: string }): boolean =>
  inv.inversionista_id === CUBE_ID ||
  inv.nombre.trim().toLowerCase() === "cube investments s.a.".toLowerCase();

// Placeholder del usuario autenticado, igual que en devolucion.ts y
// updateCredit.ts mientras no se propague el usuario real hasta acá.
const USUARIO_SISTEMA_ID = 1;

export const orderUniqueCreditIds = (creditoIds: number[]): number[] =>
  [...new Set(creditoIds)].sort((a, b) => a - b);

export async function lockPendingReturnCreditsForLiquidation(
  tx: any,
  creditoIds: number[],
) {
  const orderedCreditIds = orderUniqueCreditIds(creditoIds);
  return tx
    .select({
      creditoId: creditos.credito_id,
      numeroCreditoSifco: creditos.numero_credito_sifco,
      estadoDevolucion: creditos.estado_devolucion,
    })
    .from(creditos)
    .where(inArray(creditos.credito_id, orderedCreditIds))
    .orderBy(creditos.credito_id)
    .for("no key update");
}

/** Por qué un crédito no se cerró, para poder reportarlo sin mentir. */
export type MotivoDiferido =
  | { tipo: "inversionistas_en_padre"; restantes: number }
  | { tipo: "saldo_en_espejo" };

/**
 * Parte una lista de créditos entre los que YA no tienen ningún inversionista
 * externo y los que todavía conservan alguno.
 *
 * El predicado se mide sobre `creditos_inversionistas` (el PADRE), no sobre el
 * espejo, y la razón es que `exitInvestor` trata al padre como la fuente
 * autoritativa: si el inversionista no tiene fila en el espejo, se salta esa
 * mitad y mueve el padre igual. O sea que el espejo puede quedar con filas de
 * más en estados anómalos. Exigir "espejo en cero" dejaría esos créditos
 * colgados para siempre, que es justo la trampa que se quiere evitar.
 *
 * No hay soft-delete: `exitInvestor` hace SWAP (UPDATE del inversionista_id) o
 * MERGE + DELETE, así que contar filas no-CUBE es un predicado exacto.
 *
 * Segundo filtro, sobre el espejo: si el padre está limpio pero queda una fila
 * espejo no-CUBE CON saldo, al inversionista todavía le deben capital y el
 * crédito no cierra. La RAMA 2 ya lo protege con su validación de
 * monto_aportado==0, pero ese guard solo corre sobre créditos en VERIFICADO:
 * cerrar acá los sacaría de ese estado y la validación nunca se ejecutaría.
 * Una fila espejo en CERO no bloquea —es lo que deja una liquidación ya
 * pagada— y solo se reporta la divergencia.
 */
export async function filtrarCreditosTotalmenteDevueltos(
  ejecutor: any,
  creditoIds: number[],
): Promise<{ completados: number[]; diferidos: Map<number, MotivoDiferido> }> {
  const orderedCreditIds = orderUniqueCreditIds(creditoIds);
  const diferidos = new Map<number, MotivoDiferido>();
  if (orderedCreditIds.length === 0) {
    return { completados: [], diferidos };
  }

  const restantesCrudo = await ejecutor
    .select({
      credito_id: creditos_inversionistas.credito_id,
      inversionista_id: creditos_inversionistas.inversionista_id,
      nombre: inversionistas.nombre,
    })
    .from(creditos_inversionistas)
    .innerJoin(
      inversionistas,
      eq(creditos_inversionistas.inversionista_id, inversionistas.inversionista_id),
    )
    .where(inArray(creditos_inversionistas.credito_id, orderedCreditIds));

  const restantesPorCredito = new Map<number, number>();
  for (const fila of restantesCrudo as Array<{
    credito_id: number;
    inversionista_id: number;
    nombre: string;
  }>) {
    if (esCube(fila)) continue;
    restantesPorCredito.set(fila.credito_id, (restantesPorCredito.get(fila.credito_id) ?? 0) + 1);
  }

  for (const [credito_id, restantes] of restantesPorCredito) {
    diferidos.set(credito_id, { tipo: "inversionistas_en_padre", restantes });
  }

  const candidatos = orderedCreditIds.filter((id) => !diferidos.has(id));
  if (candidatos.length === 0) return { completados: [], diferidos };

  const espejoResidualCrudo = await ejecutor
    .select({
      credito_id: creditos_inversionistas_espejo.credito_id,
      inversionista_id: creditos_inversionistas_espejo.inversionista_id,
      monto_aportado: creditos_inversionistas_espejo.monto_aportado,
      nombre: inversionistas.nombre,
    })
    .from(creditos_inversionistas_espejo)
    .innerJoin(
      inversionistas,
      eq(creditos_inversionistas_espejo.inversionista_id, inversionistas.inversionista_id),
    )
    .where(inArray(creditos_inversionistas_espejo.credito_id, candidatos));

  const espejoResidual = espejoResidualCrudo.filter(
    (f: { inversionista_id: number; nombre: string }) => !esCube(f),
  );

  const conSaldoEnEspejo = new Set<number>(
    espejoResidual
      .filter((f: any) => Number(f.monto_aportado) !== 0)
      .map((f: any) => f.credito_id),
  );

  if (espejoResidual.length > 0) {
    console.warn(
      `⚠️  DIVERGENCIA padre/espejo: crédito(s) sin inversionistas en el padre pero con filas espejo no-CUBE:`,
      espejoResidual
        .map(
          (f: any) =>
            `credito_id=${f.credito_id} inversionista_id=${f.inversionista_id} ` +
            `monto_aportado=${f.monto_aportado}` +
            `${Number(f.monto_aportado) !== 0 ? " ← NO se cierra (capital pendiente)" : ""}`,
        )
        .join(", "),
    );
  }

  for (const id of conSaldoEnEspejo) {
    diferidos.set(id, { tipo: "saldo_en_espejo" });
  }

  return {
    completados: candidatos.filter((id) => !conSaldoEnEspejo.has(id)),
    diferidos,
  };
}

function describirDiferido(id: number, motivo: MotivoDiferido): string {
  return motivo.tipo === "inversionistas_en_padre"
    ? `credito_id=${id} (${motivo.restantes} inversionista(s) aún en el padre)`
    : `credito_id=${id} (fila de espejo no-CUBE con saldo pendiente)`;
}

/**
 * Cierra la devolución de los créditos que ya no le deben nada a nadie.
 *
 * Un crédito puede tener varios inversionistas, y cada uno se liquida por su
 * cuenta (la liquidación corre por inversionista, y las boletas individuales
 * caen en momentos distintos). Marcar COMPLETADO al salir el primero sacaba al
 * crédito del flujo para los demás: el filtro de la RAMA 2 pide VERIFICADO, así
 * que los que venían atrás nunca llegaban a `exitInvestor` y su fila en el
 * padre se quedaba viva con monto mientras su espejo ya estaba en cero.
 *
 * El UPDATE exige VERIFICADO además del predicado, y lo que se reporta como
 * `completados` es lo que el UPDATE realmente cambió (`returning`), no los
 * candidatos: quien llama recibe créditos que pudo no haber cerrado —RAMA 1
 * pasa todo lo que movió exitInvestor, mucho en NO_APLICA— y reportarlos como
 * cerrados sería mentir.
 *
 * La transición queda registrada en historial_devolucion_credito, igual que
 * VERIFICADO y RECHAZADO en devolucion.ts: es la única con consecuencia
 * financiera directa y el listado de la bandeja deriva su motivo de ahí.
 */
export async function marcarDevolucionCompletadaSiCorresponde(
  creditoIdsProcesados: number[],
  contexto: string,
  // Inyectable para poder ejercitar el helper sin una conexión real. En
  // producción siempre es `db`.
  ejecutor: { transaction: (cb: (tx: any) => Promise<any>) => Promise<any> } = db,
): Promise<{ completados: number[]; diferidos: number[] }> {
  const ids = orderUniqueCreditIds(creditoIdsProcesados);
  if (ids.length === 0) return { completados: [], diferidos: [] };

  return ejecutor.transaction(async (tx) => {
    // Mismo lock (y mismo orden por credito_id) que usa el guard de devolución
    // al inicio de la liquidación, para no abrir un deadlock entre los dos.
    await lockPendingReturnCreditsForLiquidation(tx, ids);

    const { completados: candidatos, diferidos } =
      await filtrarCreditosTotalmenteDevueltos(tx, ids);

    let cerrados: number[] = [];

    if (candidatos.length > 0) {
      const actualizados = await tx
        .update(creditos)
        .set({ estado_devolucion: "COMPLETADO" })
        .where(
          and(
            inArray(creditos.credito_id, candidatos),
            eq(creditos.estado_devolucion, "VERIFICADO"),
          ),
        )
        .returning({ credito_id: creditos.credito_id });

      cerrados = actualizados.map((c: any) => c.credito_id);

      if (cerrados.length > 0) {
        await tx.insert(historial_devolucion_credito).values(
          cerrados.map((credito_id) => ({
            credito_id,
            usuario_id: USUARIO_SISTEMA_ID,
            estado_anterior: "VERIFICADO" as const,
            estado_nuevo: "COMPLETADO" as const,
            motivo: `Cierre automático: todos los inversionistas fueron devueltos a CUBE (${contexto})`,
          })),
        );
      }

      console.log(
        `  ✅ [${contexto}] COMPLETADO aplicado a ${cerrados.length} crédito(s):`,
        cerrados.join(", ") || "(ninguno seguía en VERIFICADO)",
      );
    }

    // Solo se reportan los que este llamador pidió cerrar y no se cerraron.
    const diferidosDeEstaLlamada = ids.filter((id) => diferidos.has(id));
    if (diferidosDeEstaLlamada.length > 0) {
      console.log(
        `  ⏸️  [${contexto}] ${diferidosDeEstaLlamada.length} crédito(s) no se cerraron: ` +
          diferidosDeEstaLlamada
            .map((id) => describirDiferido(id, diferidos.get(id)!))
            .join(", "),
      );
    }

    return { completados: cerrados, diferidos: diferidosDeEstaLlamada };
  });
}
