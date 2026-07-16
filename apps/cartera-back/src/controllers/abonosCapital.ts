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
 */
export async function distribuirAbonoCapitalEspejo(
  credito_id: number,
  monto_abono_capital: number | string,
  tipo: "CANCELACION" | "CAPITAL" = "CAPITAL",
  pago_id?: number
) {
  try {
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
  } catch (error: any) {
    console.error("Error al distribuir abono a capital:", error);
    return {
      success: false,
      message: "Error al distribuir el abono a capital",
      error: error.message,
      data: null,
    };
  }
}

/**
 * Revierte el abono a capital de un pago: borra las filas de `abonos_capital`
 * que ese pago generó (una por inversionista, marcadas con su `pago_id`).
 *
 * Se puede borrar sin miedo porque cada fila es exclusiva de un pago: no
 * acumula aportes de otros pagos, así que nadie más pierde plata.
 *
 * Las filas YA LIQUIDADAS no se borran (la plata ya le salió al inversionista):
 * se devuelven en `omitidos` para tratarlas a mano. Es el caso que decidimos
 * dejar fuera de este cambio.
 *
 * `executor` permite pasar el `tx` de una transacción para que la reversión sea
 * atómica con el resto del reverso.
 */
export async function revertirAbonoCapitalEspejo(
  pago_id: number,
  executor: any = db
) {
  try {
    // 1. Las filas que generó este pago
    const filas = await executor
      .select()
      .from(abonos_capital)
      .where(eq(abonos_capital.pago_id, pago_id));

    if (filas.length === 0) {
      return {
        success: true,
        message: "El pago no generó abonos a capital: nada que revertir",
        data: { pago_id, borrados: [], omitidos: [] },
      };
    }

    // 2. Las liquidadas NO se tocan: esa plata ya salió.
    const liquidadas = filas.filter((f: any) => f.liquidado);
    const borrables = filas.filter((f: any) => !f.liquidado);

    if (borrables.length > 0) {
      await executor.delete(abonos_capital).where(
        and(
          eq(abonos_capital.pago_id, pago_id),
          eq(abonos_capital.liquidado, false)
        )
      );
    }

    return {
      success: true,
      message: "Abonos a capital del pago revertidos",
      data: {
        pago_id,
        borrados: borrables.map((f: any) => ({
          abono_id: f.abono_id,
          inversionista_id: f.inversionista_id,
          monto: f.monto,
          tipo: f.tipo,
        })),
        omitidos: liquidadas.map((f: any) => ({
          abono_id: f.abono_id,
          inversionista_id: f.inversionista_id,
          monto: f.monto,
          motivo: "YA_LIQUIDADO_LA_PLATA_YA_SALIO",
        })),
      },
    };
  } catch (error: any) {
    console.error("Error al revertir abono a capital:", error);
    return {
      success: false,
      message: "Error al revertir el abono a capital",
      error: error.message,
      data: null,
    };
  }
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

