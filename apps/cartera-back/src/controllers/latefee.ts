import { eq } from "drizzle-orm";
import { db } from "../database";
import { creditos, cuotas_credito, moras_credito } from "../database/db/schema";
import Big from "big.js";
import { toZonedTime } from "date-fns-tz";
export async function createMora({
  credito_id,
  monto_mora = 0,
  cuotas_atrasadas = 0,
}: {
  credito_id: number;
  monto_mora?: number;
  cuotas_atrasadas?: number;
}) {
  try {
    const [newMora] = await db
      .insert(moras_credito)
      .values({
        credito_id,
        monto_mora: monto_mora.toString(), // 👈 convertir a string
        cuotas_atrasadas,
        activa: true,
        porcentaje_mora: "1.12", // 👈 string fijo
      })
      .returning();

    return {
      success: true,
      mora: newMora,
    };
  } catch (error) {
    return {
      success: false,
      message: "[ERROR] No se pudo crear la mora",
      error: String(error),
    };
  }
}

// Servicio para actualizar la mora
export async function updateMora({
  credito_id,
  numero_credito_sifco,
  monto_mora,
  cuotas_atrasadas,
  activa,
}: {
  credito_id?: number;
  numero_credito_sifco?: string;
  monto_mora?: number;
  cuotas_atrasadas?: number;
  activa?: boolean;
}) {
  try {
    // Buscar el credito_id si vino numero_credito_sifco
    let targetCreditoId = credito_id;
    if (!targetCreditoId && numero_credito_sifco) {
      const [credito] = await db
        .select({ id: creditos.credito_id })
        .from(creditos)
        .where(eq(creditos.numero_credito_sifco, numero_credito_sifco));

      if (!credito) {
        return { success: false, message: "[ERROR] Crédito no encontrado" };
      }
      targetCreditoId = credito.id;
    }

    if (!targetCreditoId) {
      return { success: false, message: "[ERROR] Debes enviar credito_id o numero_credito_sifco" };
    }

    // Actualizar mora
    const [updated] = await db
      .update(moras_credito)
      .set({
        ...(monto_mora !== undefined ? { monto_mora: monto_mora.toString() } : {}),
        ...(cuotas_atrasadas !== undefined ? { cuotas_atrasadas } : {}),
        ...(activa !== undefined ? { activa } : {}),
        updated_at: new Date(),
      })
      .where(eq(moras_credito.credito_id, targetCreditoId))
      .returning();

    return {
      success: true,
      mora: updated,
    };
  } catch (error) {
    return {
      success: false,
      message: "[ERROR] No se pudo actualizar la mora",
      error: String(error),
    };
  }
}


export async function procesarMoras() {
  const zona = "America/Guatemala";

  // Fecha actual en hora de Guatemala
  const hoy = toZonedTime(new Date(), zona);
  console.log("[INFO] Fecha actual Guatemala:", hoy.toISOString());

  // 1. Traemos todas las cuotas y filtramos en JS con timezone
  const cuotas = await db
    .select({
      credito_id: cuotas_credito.credito_id,
      fecha_vencimiento: cuotas_credito.fecha_vencimiento,
      pagado: cuotas_credito.pagado,
    })
    .from(cuotas_credito);

  // Filtramos vencidas manualmente en zona Guate
  const cuotasVencidas = cuotas.filter((c) => {
    const fechaVenc = toZonedTime(c.fecha_vencimiento, zona);
    return fechaVenc < hoy && c.pagado === false;
  });

  console.log("[DEBUG] Cuotas vencidas encontradas:", cuotasVencidas);

  // Agrupación
  const moraPorCredito: Record<number, number> = {};
  for (const cuota of cuotasVencidas) {
    moraPorCredito[cuota.credito_id] =
      (moraPorCredito[cuota.credito_id] ?? 0) + 1;
  }

  console.log("[DEBUG] Agrupación de cuotas vencidas por crédito:", moraPorCredito);

  // 2. Procesar cada crédito
  for (const [creditoIdStr, cuotasAtrasadas] of Object.entries(moraPorCredito)) {
    const creditoId = Number(creditoIdStr);
    console.log(`\n[PROCESS] Crédito #${creditoId} con ${cuotasAtrasadas} cuotas atrasadas`);

    const [credito] = await db
      .select({ capital: creditos.capital })
      .from(creditos)
      .where(eq(creditos.credito_id, creditoId));

    if (!credito) {
      console.log(`[WARN] Crédito ${creditoId} no encontrado`);
      continue;
    }

    const capital = new Big(credito.capital);
    console.log(`[DEBUG] Capital del crédito: ${capital.toString()}`);

    const porcentaje = new Big("0.0112");
    const moraNueva = capital.times(porcentaje).times(cuotasAtrasadas);
    console.log(`[DEBUG] Mora nueva calculada: ${moraNueva.toString()}`);

    const [moraActual] = await db
      .select({
        id: moras_credito.mora_id,
        monto: moras_credito.monto_mora,
      })
      .from(moras_credito)
      .where(eq(moras_credito.credito_id, creditoId));

    if (moraActual) {
      console.log(`[INFO] Mora existente encontrada con monto: ${moraActual.monto}`);
      const montoTotal = new Big(moraActual.monto).plus(moraNueva);
      console.log(`[INFO] Nueva mora total: ${montoTotal.toString()}`);

      await db
        .update(moras_credito)
        .set({
          monto_mora: montoTotal.toString(),
          cuotas_atrasadas: cuotasAtrasadas,
          activa: true,
          updated_at: new Date(),
        })
        .where(eq(moras_credito.mora_id, moraActual.id));

      console.log(`[SUCCESS] Mora actualizada para crédito #${creditoId}`);
    } else {
      await db.insert(moras_credito).values({
        credito_id: creditoId,
        monto_mora: moraNueva.toString(),
        cuotas_atrasadas: cuotasAtrasadas,
        activa: true,
        porcentaje_mora: "1.12",
      });
      console.log(`[SUCCESS] Mora creada para crédito #${creditoId}`);
    }
  }

  console.log("\n[JOB] Finalizado procesamiento de moras.");
}