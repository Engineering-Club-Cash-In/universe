import { eq, and, sql } from "drizzle-orm";
import { abonos_capital, creditos_inversionistas_espejo, inversionistas } from "../database/db";
import { db } from "../database";
import Big from "big.js";
import { obtenerSumaComprasPendientes } from "../utils/comprasAjuste";

export async function createAbonoCapital(data: {
  credito_id: number;
  inversionista_id: number;
  monto: string;
  tipo: "CANCELACION" | "CAPITAL";
  liquidado?: boolean;
}) {
  try {
    const [nuevoAbono] = await db
      .insert(abonos_capital)
      .values({
        credito_id: data.credito_id,
        inversionista_id: data.inversionista_id,
        monto: data.monto,
        tipo: data.tipo,
        liquidado: data.liquidado ?? false,
      })
      .returning();

    return {
      success: true,
      message: "Abono a capital creado correctamente",
      data: nuevoAbono,
    };
  } catch (error: any) {
    console.error("Error al crear abono a capital:", error);
    return {
      success: false,
      message: "Error al crear el abono a capital",
      error: error.message,
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
  pago_id?: number
) {
  const abonoBig = new Big(monto_abono_capital);

  // 1. Traer inversionistas del espejo
  const invsEspejo = await db
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
      const [nuevo] = await db
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
 */
export async function registrarCancelacionEspejo(tx: any, credito_id: number) {
  // 1. Inversionistas del espejo con su capital aportado
  const invsEspejo = await tx
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
  if (invsEspejo.length === 0) {
    return { insertados: 0, detalle: [] as any[] };
  }

  // 2. Idempotencia: reemplazar las cancelaciones ABIERTAS previas del crédito
  //    (una re-aceptación no debe acumular). Solo las no-liquidadas.
  await tx
    .delete(abonos_capital)
    .where(
      and(
        eq(abonos_capital.credito_id, credito_id),
        eq(abonos_capital.tipo, "CANCELACION"),
        eq(abonos_capital.liquidado, false)
      )
    );

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
  }>
) {
  try {
    const [abonoActualizado] = await db
      .update(abonos_capital)
      .set({
        ...data,
        updated_at: new Date(),
      })
      .where(eq(abonos_capital.abono_id, abonoId))
      .returning();

    if (!abonoActualizado) {
      return {
        success: false,
        message: "Abono no encontrado",
        data: null,
      };
    }

    return {
      success: true,
      message: "Abono a capital actualizado correctamente",
      data: abonoActualizado,
    };
  } catch (error: any) {
    console.error("Error al actualizar abono a capital:", error);
    return {
      success: false,
      message: "Error al actualizar el abono a capital",
      error: error.message,
      data: null,
    };
  }
}

