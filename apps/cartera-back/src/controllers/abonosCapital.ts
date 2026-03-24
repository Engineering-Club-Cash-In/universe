import { eq } from "drizzle-orm";
import { abonos_capital } from "../database/db";
import { db } from "../database";

export async function createAbonoCapital(data: {
  credito_id: number;
  monto: string;
  tipo: "CANCELACION" | "CAPITAL";
  liquidado?: boolean;
}) {
  try {
    const [nuevoAbono] = await db
      .insert(abonos_capital)
      .values({
        credito_id: data.credito_id,
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
