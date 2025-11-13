// services/cuentas.service.ts
import { eq } from "drizzle-orm";
import { cuentasEmpresa } from "../database/db";
import { db } from "../database";

export async function getCuentasEmpresa() {
  try {
    const cuentas = await db
      .select()
      .from(cuentasEmpresa)
      .where(eq(cuentasEmpresa.activo, true))
      .orderBy(cuentasEmpresa.nombreCuenta);

    return {
      success: true,
      message: "✅ Cuentas obtenidas correctamente",
      data: cuentas,
    };
  } catch (error: any) {
    console.error("❌ Error al obtener cuentas de empresa:", error);
    return {
      success: false,
      message: "❌ Error al obtener las cuentas",
      error: error.message,
      data: [],
    };
  }
}

export async function getCuentaById(cuentaId: number) {
  try {
    const result = await db
      .select()
      .from(cuentasEmpresa)
      .where(eq(cuentasEmpresa.cuentaId, cuentaId))
      .limit(1);

    const cuenta = result[0] || null;

    if (!cuenta) {
      return {
        success: false,
        message: "❌ Cuenta no encontrada",
        data: null,
      };
    }

    return {
      success: true,
      message: "✅ Cuenta obtenida correctamente",
      data: cuenta,
    };
  } catch (error: any) {
    console.error("❌ Error al obtener cuenta por ID:", error);
    return {
      success: false,
      message: "❌ Error al obtener la cuenta",
      error: error.message,
      data: null,
    };
  }
}

export async function createCuentaEmpresa(data: {
  nombreCuenta: string;
  banco: string;
  numeroCuenta: string;
  descripcion?: string;
}) {
  try {
    const [nuevaCuenta] = await db
      .insert(cuentasEmpresa)
      .values({
        nombreCuenta: data.nombreCuenta,
        banco: data.banco,
        numeroCuenta: data.numeroCuenta,
        descripcion: data.descripcion,
      })
      .returning();

    return {
      success: true,
      message: "✅ Cuenta creada correctamente",
      data: nuevaCuenta,
    };
  } catch (error: any) {
    console.error("❌ Error al crear cuenta de empresa:", error);
    return {
      success: false,
      message: "❌ Error al crear la cuenta",
      error: error.message,
      data: null,
    };
  }
}

export async function updateCuentaEmpresa(
  cuentaId: number,
  data: Partial<{
    nombreCuenta: string;
    banco: string;
    numeroCuenta: string;
    descripcion: string;
    activo: boolean;
  }>
) {
  try {
    const [cuentaActualizada] = await db
      .update(cuentasEmpresa)
      .set({
        ...data,
        fechaActualizacion: new Date(),
      })
      .where(eq(cuentasEmpresa.cuentaId, cuentaId))
      .returning();

    if (!cuentaActualizada) {
      return {
        success: false,
        message: "❌ Cuenta no encontrada",
        data: null,
      };
    }

    return {
      success: true,
      message: "✅ Cuenta actualizada correctamente",
      data: cuentaActualizada,
    };
  } catch (error: any) {
    console.error("❌ Error al actualizar cuenta de empresa:", error);
    return {
      success: false,
      message: "❌ Error al actualizar la cuenta",
      error: error.message,
      data: null,
    };
  }
}

export async function deleteCuentaEmpresa(cuentaId: number) {
  try {
    // Soft delete - solo desactivar
    const [cuentaDesactivada] = await db
      .update(cuentasEmpresa)
      .set({
        activo: false,
        fechaActualizacion: new Date(),
      })
      .where(eq(cuentasEmpresa.cuentaId, cuentaId))
      .returning();

    if (!cuentaDesactivada) {
      return {
        success: false,
        message: "❌ Cuenta no encontrada",
      };
    }

    return {
      success: true,
      message: "✅ Cuenta desactivada correctamente",
      data: cuentaDesactivada,
    };
  } catch (error: any) {
    console.error("❌ Error al desactivar cuenta de empresa:", error);
    return {
      success: false,
      message: "❌ Error al desactivar la cuenta",
      error: error.message,
    };
  }
}