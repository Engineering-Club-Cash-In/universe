import { eq, and, sql } from "drizzle-orm";
import { abonos_capital, creditos_inversionistas_espejo, inversionistas } from "../database/db";
import { db } from "../database";
import Big from "big.js";

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
 * Distribuye un abono a capital entre los inversionistas del espejo.
 * Si ya existe un registro con credito_id + inversionista_id y liquidado = false, suma el monto.
 * Si no existe, inserta uno nuevo.
 */
export async function distribuirAbonoCapitalEspejo(
  credito_id: number,
  monto_abono_capital: number | string,
  tipo: "CANCELACION" | "CAPITAL" = "CAPITAL"
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

      // Buscar si ya existe uno no liquidado
      const [existente] = await db
        .select()
        .from(abonos_capital)
        .where(
          and(
            eq(abonos_capital.credito_id, credito_id),
            eq(abonos_capital.inversionista_id, inv.inversionista_id),
            eq(abonos_capital.liquidado, false)
          )
        )
        .limit(1);

      if (existente) {
        // Sumar al existente
        const nuevoMonto = new Big(existente.monto).plus(montoAbono).toString();
        const [actualizado] = await db
          .update(abonos_capital)
          .set({ monto: nuevoMonto, updated_at: new Date() })
          .where(eq(abonos_capital.abono_id, existente.abono_id))
          .returning();

        resultados.push({
          inversionista: inv.nombre,
          inversionista_id: inv.inversionista_id,
          accion: "SUMADO",
          monto_agregado: montoAbono.toString(),
          monto_total: nuevoMonto,
          porcentaje: porcentajeGeneral.toFixed(4),
        });
      } else {
        // Insertar nuevo
        const [nuevo] = await db
          .insert(abonos_capital)
          .values({
            credito_id,
            inversionista_id: inv.inversionista_id,
            monto: montoAbono.toString(),
            tipo,
            liquidado: false,
          })
          .returning();

        resultados.push({
          inversionista: inv.nombre,
          inversionista_id: inv.inversionista_id,
          accion: "INSERTADO",
          monto_agregado: montoAbono.toString(),
          monto_total: montoAbono.toString(),
          porcentaje: porcentajeGeneral.toFixed(4),
        });
      }
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
 * Registra la CANCELACIÓN de capital de un crédito al aceptar su devolución.
 * Inserta una fila en abonos_capital por cada inversionista del espejo, con
 * monto = su monto_aportado (cada inversionista recupera exactamente lo que aportó).
 *
 * Debe llamarse DENTRO de una transacción (recibe el handle `tx`) para que el
 * registro sea atómico junto con el cambio de estado del crédito.
 *
 * No reusa distribuirAbonoCapitalEspejo a propósito: esa función usa el `db`
 * global (no participaría en la transacción) y suma sobre filas no-liquidadas
 * existentes sin discriminar por tipo, con lo que podría fusionar la cancelación
 * dentro de un abono CAPITAL previo. Aquí cada inversionista recibe exactamente
 * su monto_aportado, así que no hace falta prorrateo.
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

  // 2. Una fila CANCELACION por inversionista (monto = su monto_aportado)
  const detalle: any[] = [];
  for (const inv of invsEspejo) {
    const monto = new Big(inv.monto_aportado ?? 0);

    // Omitir aportes en cero (nada que cancelar)
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

