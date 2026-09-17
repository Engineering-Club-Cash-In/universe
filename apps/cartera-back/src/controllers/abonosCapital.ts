import { eq, and, sql, inArray, ne } from "drizzle-orm";
import { abonos_capital, creditos_inversionistas_espejo, inversionistas, pagos_credito_inversionistas_espejo } from "../database/db";
import { db } from "../database";
import Big from "big.js";
import { obtenerSumaComprasPendientes } from "../utils/comprasAjuste";
import { esCube } from "../utils/devolucionCompletada";
import {
  emitCreditCapitalContributionCompleted,
  emitCreditCapitalContributionFailed,
  emitCreditCapitalContributionRejected,
} from "../utils/structuredLogger";

type AbonoCapitalExecutor = Pick<typeof db, "select" | "insert">;
type CreateAbonoCapitalExecutor = Pick<typeof db, "insert">;
type UpdateAbonoCapitalExecutor = Pick<typeof db, "update">;
type CapitalContributionFailure = {
  readonly operation: "create" | "update";
  readonly durationMs: number;
};

function safeNow(now: () => number): number {
  try {
    const value = now();
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

function elapsedMilliseconds(startedAt: number, now: () => number): number {
  return Math.max(0, Math.min(86_400_000, Math.round(safeNow(now) - startedAt)));
}

function historicalErrorMessage(error: unknown): string | undefined {
  if ((typeof error !== "object" && typeof error !== "function") || error === null) {
    return undefined;
  }
  try {
    const message = Reflect.get(error, "message");
    return typeof message === "string" ? message : undefined;
  } catch {
    return undefined;
  }
}

function emitFailureWithoutAffectingControlFlow(
  emitFailure: (result: CapitalContributionFailure) => void,
  result: CapitalContributionFailure,
): void {
  try {
    emitFailure(result);
  } catch {
    // Observability must not replace the historical persistence response.
  }
}

export async function createAbonoCapital(data: {
  credito_id: number;
  inversionista_id: number;
  monto: string;
  tipo: "CANCELACION" | "CAPITAL";
  liquidado?: boolean;
}, dependencies: {
  readonly executor: CreateAbonoCapitalExecutor;
  readonly emitFailure: (result: CapitalContributionFailure) => void;
  readonly now: () => number;
} = {
  executor: db,
  emitFailure: emitCreditCapitalContributionFailed,
  now: Date.now,
}) {
  const startedAt = safeNow(dependencies.now);
  try {
    const [nuevoAbono] = await dependencies.executor
      .insert(abonos_capital)
      .values({
        credito_id: data.credito_id,
        inversionista_id: data.inversionista_id,
        monto: data.monto,
        tipo: data.tipo,
        liquidado: data.liquidado ?? false,
      })
      .returning();

    emitCreditCapitalContributionCompleted({
      operation: "create",
      durationMs: elapsedMilliseconds(startedAt, dependencies.now),
    });

    return {
      success: true,
      message: "Abono a capital creado correctamente",
      data: nuevoAbono,
    };
  } catch (error: unknown) {
    emitFailureWithoutAffectingControlFlow(dependencies.emitFailure, {
      operation: "create",
      durationMs: elapsedMilliseconds(startedAt, dependencies.now),
    });
    return {
      success: false,
      message: "Error al crear el abono a capital",
      error: historicalErrorMessage(error),
      data: null,
    };
  }
}

/**
 * Distribuye un abono a capital entre los inversionistas del espejo:
 * INSERTA una fila por inversionista, marcada con el `pago_id` que la originó.
 *
 * NO acumula sobre una fila abierta previa (como hacía antes): cada pago tiene
 * sus propias filas. Eso es lo que hace que revertir un pago sea simplemente
 * borrar sus filas, sin tocar lo que aportaron los demás pagos.
 *
 * `pago_id` es opcional porque resetCredit distribuye una CANCELACION que no
 * nace de un pago.
 *
 * Los errores NO se atrapan a propósito: si esto falla, quien aplica el pago
 * tiene que enterarse y abortar. Antes se los tragaba y devolvía
 * `{success:false}`, así que el pago se aplicaba igual: al crédito se le bajaba
 * el capital y el inversionista se quedaba sin su abono.
 *
 * `{success:false}` queda solo para los casos donde no hay NADA que hacer (sin
 * inversionistas en el espejo, capital total en 0). Eso no es una falla.
 */
export async function distribuirAbonoCapitalEspejo(
  credito_id: number,
  monto_abono_capital: number | string,
  tipo: "CANCELACION" | "CAPITAL" = "CAPITAL",
  pago_id?: number,
  executor: AbonoCapitalExecutor = db
) {
  const abonoBig = new Big(monto_abono_capital);

  // 1. Traer inversionistas del espejo
  const invsEspejo = await executor
      .select({
        inversionista_id: creditos_inversionistas_espejo.inversionista_id,
        monto_aportado: creditos_inversionistas_espejo.monto_aportado,
        porcentaje_cash_in: creditos_inversionistas_espejo.porcentaje_cash_in,
        nombre: inversionistas.nombre,
      })
      .from(creditos_inversionistas_espejo)
      .innerJoin(
        inversionistas,
        eq(creditos_inversionistas_espejo.inversionista_id, inversionistas.inversionista_id)
      )
      .where(eq(creditos_inversionistas_espejo.credito_id, credito_id));

    if (invsEspejo.length === 0) {
      return { success: false, message: "Sin inversionistas en espejo para este crédito", data: null };
    }

    // 2. Capital total = suma de montos aportados del espejo
    let capitalTotal = new Big(0);
    for (const inv of invsEspejo) {
      capitalTotal = capitalTotal.plus(inv.monto_aportado ?? 0);
    }

    if (capitalTotal.lte(0)) {
      return { success: false, message: "Monto aportado total es 0", data: null };
    }

    // 3. Calcular distribución y hacer upsert
    const resultados = [];

    for (const inv of invsEspejo) {
      const montoAportado = new Big(inv.monto_aportado ?? 0);

      // Porcentaje general: monto_aportado / SUM(monto_aportado)
      const porcentajeGeneral = capitalTotal.gt(0)
        ? montoAportado.div(capitalTotal)
        : new Big(0);

      // Monto que le toca del abono
      const montoAbono = abonoBig.times(porcentajeGeneral).round(6);

      // Una fila propia por (pago, inversionista): nunca se suma sobre una
      // fila previa, así revertir el pago no le toca lo suyo a otros pagos.
      const [nuevo] = await executor
        .insert(abonos_capital)
        .values({
          credito_id,
          inversionista_id: inv.inversionista_id,
          pago_id: pago_id ?? null,
          monto: montoAbono.toString(),
          tipo,
          liquidado: false,
        })
        .returning();

      resultados.push({
        inversionista: inv.nombre,
        inversionista_id: inv.inversionista_id,
        abono_id: nuevo.abono_id,
        pago_id: pago_id ?? null,
        monto_agregado: montoAbono.toString(),
        porcentaje: porcentajeGeneral.toFixed(4),
      });
    }

  return {
    success: true,
    message: "Abono a capital distribuido entre inversionistas",
    data: {
      credito_id,
      monto_total: abonoBig.toString(),
      capital_credito: capitalTotal.toString(),
      distribucion: resultados,
    },
  };
}

/**
 * Revierte el abono a capital de un pago: borra las filas de `abonos_capital`
 * que ese pago generó (una por inversionista, marcadas con su `pago_id`).
 *
 * Se puede borrar sin miedo porque cada fila es exclusiva de un pago: no
 * acumula aportes de otros pagos, así que nadie más pierde plata.
 *
 * TIRA ERROR (y voltea la transacción del reverso) en dos casos, porque en los
 * dos el abono ya no se puede tocar:
 *
 *  - `liquidado`: la plata ya le salió al inversionista.
 *  - `pago_espejo_id` seteado: una fila de espejo ya lo consumió. El espejo
 *    CONGELA el monto a pagar al generarse y no se regenera mientras esté sin
 *    liquidar, así que la liquidación le va a pagar ese capital igual. Borrar el
 *    abono no la frena: el inversionista terminaría cobrando un capital que se
 *    revirtió, mientras el cliente lo sigue debiendo.
 *
 * Los dos se resuelven a mano antes de revertir; el sistema no puede adivinar.
 *
 * Los errores NO se atrapan a propósito: si el borrado falla, el reverso entero
 * tiene que caerse. Si se tragara el error, el pago se revertiría igual y el
 * abono quedaría huérfano — justo lo que esta función viene a evitar.
 *
 * `executor` permite pasar el `tx` de una transacción para que la reversión sea
 * atómica con el resto del reverso.
 */
export async function revertirAbonoCapitalEspejo(
  pago_id: number,
  executor: any = db
) {
  // 1. Las filas que generó este pago
  const filas = await executor
    .select()
    .from(abonos_capital)
    .where(eq(abonos_capital.pago_id, pago_id));

  if (filas.length === 0) {
    return {
      success: true,
      message: "El pago no generó abonos a capital: nada que revertir",
      data: { pago_id, borrados: [] },
    };
  }

  // 2. Portero: la plata ya salió.
  const liquidadas = filas.filter((f: any) => f.liquidado);
  if (liquidadas.length > 0) {
    throw new Error(
      `[ABONO_YA_LIQUIDADO] El pago ${pago_id} tiene ${liquidadas.length} abono(s) a capital ya liquidado(s) ` +
        `(abono_id: ${liquidadas.map((f: any) => f.abono_id).join(", ")}). ` +
        `Esa plata ya se le pagó al inversionista: hay que revertir la liquidación antes de revertir el pago.`
    );
  }

  // 3. Portero: ya entró en una foto que se va a pagar.
  const enEspejo = filas.filter((f: any) => f.pago_espejo_id != null);
  if (enEspejo.length > 0) {
    throw new Error(
      `[ABONO_EN_CALCULO_PENDIENTE] El pago ${pago_id} tiene ${enEspejo.length} abono(s) a capital que ya entraron ` +
        `en un cálculo de pagos (espejo id: ${enEspejo.map((f: any) => f.pago_espejo_id).join(", ")}). ` +
        `Ese monto ya quedó congelado para liquidar: hay que liquidar o descartar el espejo antes de revertir el pago.`
    );
  }

  // 4. Ninguna foto los tomó y ninguno se pagó: se borran.
  await executor
    .delete(abonos_capital)
    .where(eq(abonos_capital.pago_id, pago_id));

  return {
    success: true,
    message: "Abonos a capital del pago revertidos",
    data: {
      pago_id,
      borrados: filas.map((f: any) => ({
        abono_id: f.abono_id,
        inversionista_id: f.inversionista_id,
        monto: f.monto,
        tipo: f.tipo,
      })),
    },
  };
}

/**
 * Registra la CANCELACIÓN de capital de un crédito al aceptar su devolución.
 * Inserta una fila en abonos_capital por cada inversionista del espejo, con
 * monto = su capital REAL (cada inversionista recupera lo que efectivamente aportó).
 *
 * Debe llamarse DENTRO de una transacción (recibe el handle `tx`) para que el
 * registro sea atómico junto con el cambio de estado del crédito.
 *
 * Detalles:
 * - Idempotente: primero borra las cancelaciones ABIERTAS (liquidado=false) del
 *   crédito y luego reinserta. updateCredit permite VERIFICADO ->
 *   PENDIENTE_AUTORIZACION, así que una devolución puede re-aceptarse antes de
 *   liquidar; sin esto cada re-aceptación acumularía otro juego de filas
 *   CANCELACION (doble conteo). Las filas ya liquidadas (pago real) NO se tocan.
 * - Capital real: al monto_aportado del espejo se le restan las compras
 *   PENDIENTES (que ya "ensuciaron" el espejo pero aún no son capital real),
 *   igual que el cálculo de intereses en pagos (obtenerSumaComprasPendientes).
 * - No reusa distribuirAbonoCapitalEspejo a propósito: esa función usa el `db`
 *   global (no participaría en la transacción) y suma sobre filas no-liquidadas
 *   existentes sin discriminar por tipo, con lo que podría fusionar la
 *   cancelación dentro de un abono CAPITAL previo.
 * - CUBE (id 86) se excluye siempre: CUBE es quien absorbe la cartera cuando
 *   los demás inversionistas salen, nunca "sale" él mismo del crédito. Sin
 *   este filtro, un crédito donde CUBE es el único que quedó en el espejo
 *   generaba una CANCELACION a su propio nombre —como si CUBE se estuviera
 *   devolviendo su propio capital—, que además nunca llega a liquidarse
 *   porque CUBE no pasa por el flujo de liquidación (confirmado en
 *   producción: decenas de estas filas, todas con liquidado=false).
 */
export async function registrarCancelacionEspejo(tx: any, credito_id: number) {
  // 1. Inversionistas del espejo con su capital aportado (nunca CUBE).
  //    El filtro de CUBE se aplica en JS con `esCube` (por ID con el nombre
  //    como respaldo), no en el WHERE: un `ne(inversionista_id, CUBE_ID)` en
  //    SQL solo excluiría el ID 86 exacto, dejando pasar una fila histórica
  //    de CUBE con otro ID — que payments.ts sí reconocería como CUBE por
  //    nombre (vía esCube) y excluiría de todo cálculo, recreando el mismo
  //    dato fantasma que este guard existe para evitar. Debe ser
  //    exactamente el mismo criterio en ambos archivos.
  const invsEspejoCrudo = await tx
    .select({
      inversionista_id: creditos_inversionistas_espejo.inversionista_id,
      monto_aportado: creditos_inversionistas_espejo.monto_aportado,
      nombre: inversionistas.nombre,
    })
    .from(creditos_inversionistas_espejo)
    .innerJoin(
      inversionistas,
      eq(creditos_inversionistas_espejo.inversionista_id, inversionistas.inversionista_id)
    )
    .where(eq(creditos_inversionistas_espejo.credito_id, credito_id));

  // Sin espejo → no hay capital de inversionistas que cancelar. No es error.
  if (invsEspejoCrudo.length === 0) {
    return { insertados: 0, detalle: [] as any[] };
  }

  const invsEspejo = invsEspejoCrudo.filter((inv: { inversionista_id: number; nombre: string }) => !esCube(inv));

  // 2. Idempotencia y reconciliación: reemplazar las cancelaciones ABIERTAS previas
  //    del crédito (una re-aceptación no debe acumular). Solo las no-liquidadas.
  //    Portero financiero: si alguna cancelación abierta ya entró en un cálculo
  //    de pagos activo (pago_espejo_id apunta a un snapshot no liquidado que existe),
  //    borrarla y re-insertarla causaría un doble pago al inversionista. Se debe liquidar
  //    o descartar el cálculo primero.
  //    Si el snapshot ya fue eliminado/descartado (p. ej. vía /deletePagosEspejoNoLiquidados),
  //    el ID huérfano no debe bloquear la re-aceptación.
  //    Esta reconciliación debe correr aun si en el espejo solo queda CUBE, para
  //    limpiar cancelaciones abiertas previas o proteger aquellas ya en cálculo.
  const cancelacionesAbiertas = await tx
    .select({
      abono_id: abonos_capital.abono_id,
      pago_espejo_id: abonos_capital.pago_espejo_id,
    })
    .from(abonos_capital)
    .where(
      and(
        eq(abonos_capital.credito_id, credito_id),
        eq(abonos_capital.tipo, "CANCELACION"),
        eq(abonos_capital.liquidado, false)
      )
    );

  const idsEspejoCandidatos = cancelacionesAbiertas
    .map((f: { abono_id: number; pago_espejo_id: number | null }) => f.pago_espejo_id)
    .filter((id: number | null | undefined): id is number => id != null);

  let enEspejo: typeof cancelacionesAbiertas = [];
  if (idsEspejoCandidatos.length > 0) {
    const snapshotsActivos = await tx
      .select({ id: pagos_credito_inversionistas_espejo.id })
      .from(pagos_credito_inversionistas_espejo)
      .where(
        and(
          inArray(pagos_credito_inversionistas_espejo.id, idsEspejoCandidatos),
          ne(pagos_credito_inversionistas_espejo.estado_liquidacion, "LIQUIDADO")
        )
      );

    const idsActivos = new Set(snapshotsActivos.map((s: { id: number }) => s.id));
    enEspejo = cancelacionesAbiertas.filter(
      (f: { abono_id: number; pago_espejo_id: number | null }) =>
        f.pago_espejo_id != null && idsActivos.has(f.pago_espejo_id)
    );
  }

  if (enEspejo.length > 0) {
    throw new Error(
      `[CANCELACION_EN_CALCULO_PENDIENTE] El crédito ${credito_id} tiene ${enEspejo.length} cancelación(es) que ya entraron ` +
        `en un cálculo de pagos (espejo id: ${enEspejo.map((f: { pago_espejo_id: number | null }) => f.pago_espejo_id).join(", ")}). ` +
        `Ese monto ya quedó congelado para liquidar: hay que liquidar o descartar el espejo antes de re-aceptar la devolución.`
    );
  }

  await tx
    .delete(abonos_capital)
    .where(
      and(
        eq(abonos_capital.credito_id, credito_id),
        eq(abonos_capital.tipo, "CANCELACION"),
        eq(abonos_capital.liquidado, false)
      )
    );

  // Si en el espejo solo queda CUBE (o ningún inversionista con saldo a cancelar),
  // ya se limpiaron y verificaron las cancelaciones previas; no hay nuevas que insertar.
  if (invsEspejo.length === 0) {
    return { insertados: 0, detalle: [] as any[] };
  }

  // 3. Una fila CANCELACION por inversionista con su capital REAL
  //    (monto_aportado del espejo menos sus compras pendientes).
  const detalle: any[] = [];
  for (const inv of invsEspejo) {
    const pendientes = await obtenerSumaComprasPendientes(
      credito_id,
      inv.inversionista_id
    );
    const monto = new Big(inv.monto_aportado ?? 0).minus(pendientes);

    // Omitir capital real en cero o negativo (nada que cancelar)
    if (monto.lte(0)) continue;

    const [nuevo] = await tx
      .insert(abonos_capital)
      .values({
        credito_id,
        inversionista_id: inv.inversionista_id,
        monto: monto.toString(),
        tipo: "CANCELACION" as const,
        liquidado: false,
      })
      .returning();

    detalle.push({
      inversionista: inv.nombre,
      inversionista_id: inv.inversionista_id,
      monto: nuevo.monto,
    });
  }

  return { insertados: detalle.length, detalle };
}

export async function updateAbonoCapital(
  abonoId: number,
  data: Partial<{
    monto: string;
    tipo: "CANCELACION" | "CAPITAL";
    liquidado: boolean;
  }>,
  dependencies: {
    readonly executor: UpdateAbonoCapitalExecutor;
    readonly emitFailure: (result: CapitalContributionFailure) => void;
    readonly now: () => number;
  } = {
    executor: db,
    emitFailure: emitCreditCapitalContributionFailed,
    now: Date.now,
  },
) {
  const startedAt = safeNow(dependencies.now);
  try {
    const [abonoActualizado] = await dependencies.executor
      .update(abonos_capital)
      .set({
        ...data,
        updated_at: new Date(),
      })
      .where(eq(abonos_capital.abono_id, abonoId))
      .returning();

    if (!abonoActualizado) {
      emitCreditCapitalContributionRejected({
        operation: "update",
        durationMs: elapsedMilliseconds(startedAt, dependencies.now),
      });
      return {
        success: false,
        message: "Abono no encontrado",
        data: null,
      };
    }

    emitCreditCapitalContributionCompleted({
      operation: "update",
      durationMs: elapsedMilliseconds(startedAt, dependencies.now),
    });

    return {
      success: true,
      message: "Abono a capital actualizado correctamente",
      data: abonoActualizado,
    };
  } catch (error: unknown) {
    emitFailureWithoutAffectingControlFlow(dependencies.emitFailure, {
      operation: "update",
      durationMs: elapsedMilliseconds(startedAt, dependencies.now),
    });
    return {
      success: false,
      message: "Error al actualizar el abono a capital",
      error: historicalErrorMessage(error),
      data: null,
    };
  }
}
