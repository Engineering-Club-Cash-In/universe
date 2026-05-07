// services/cuentasExtraInversionista.service.ts
import { and, eq, ilike } from "drizzle-orm";
import { cuentas_extra_inversionista } from "../database/db";
import { db } from "../database";

type Moneda = "quetzales" | "dolares";
type TipoCuenta =
  | "AHORRO"
  | "AHORRO Q"
  | "AHORROS"
  | "AHORRO $"
  | "MONETARIA"
  | "MONETARIA Q"
  | "MONETARIA $"
  | "Capital";

type ListFilters = {
  inversionistaId?: number;
  bancoId?: number;
  tipoCuenta?: TipoCuenta;
  moneda?: Moneda;
  numeroCuenta?: string; // búsqueda parcial (ilike)
  motivoCuenta?: string; // búsqueda parcial (ilike)
};

export async function listCuentasExtra(filters?: ListFilters) {
  try {
    const conditions = [];
    if (filters?.inversionistaId !== undefined) {
      conditions.push(
        eq(cuentas_extra_inversionista.inversionista_id, filters.inversionistaId)
      );
    }
    if (filters?.bancoId !== undefined) {
      conditions.push(eq(cuentas_extra_inversionista.banco_id, filters.bancoId));
    }
    if (filters?.tipoCuenta) {
      conditions.push(eq(cuentas_extra_inversionista.tipo_cuenta, filters.tipoCuenta));
    }
    if (filters?.moneda) {
      conditions.push(eq(cuentas_extra_inversionista.moneda, filters.moneda));
    }
    if (filters?.numeroCuenta) {
      conditions.push(
        ilike(cuentas_extra_inversionista.numero_cuenta, `%${filters.numeroCuenta}%`)
      );
    }
    if (filters?.motivoCuenta) {
      conditions.push(
        ilike(cuentas_extra_inversionista.motivo_cuenta, `%${filters.motivoCuenta}%`)
      );
    }

    const data = await db
      .select()
      .from(cuentas_extra_inversionista)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(cuentas_extra_inversionista.cuenta_extra_id);

    return {
      success: true,
      message: "✅ Cuentas extra obtenidas correctamente",
      data,
    };
  } catch (error: any) {
    console.error("❌ Error al listar cuentas extra:", error);
    return {
      success: false,
      message: "❌ Error al obtener las cuentas extra",
      error: error.message,
      data: [],
    };
  }
}

export async function getCuentasExtraByInversionista(inversionistaId: number) {
  try {
    const data = await db
      .select()
      .from(cuentas_extra_inversionista)
      .where(eq(cuentas_extra_inversionista.inversionista_id, inversionistaId))
      .orderBy(cuentas_extra_inversionista.cuenta_extra_id);

    return {
      success: true,
      message: "✅ Cuentas extra del inversionista obtenidas correctamente",
      data,
    };
  } catch (error: any) {
    console.error("❌ Error al obtener cuentas extra por inversionista:", error);
    return {
      success: false,
      message: "❌ Error al obtener las cuentas extra del inversionista",
      error: error.message,
      data: [],
    };
  }
}

export async function getCuentaExtraById(cuentaExtraId: number) {
  try {
    const result = await db
      .select()
      .from(cuentas_extra_inversionista)
      .where(eq(cuentas_extra_inversionista.cuenta_extra_id, cuentaExtraId))
      .limit(1);

    const cuenta = result[0] || null;
    if (!cuenta) {
      return {
        success: false,
        message: "❌ Cuenta extra no encontrada",
        data: null,
      };
    }

    return {
      success: true,
      message: "✅ Cuenta extra obtenida correctamente",
      data: cuenta,
    };
  } catch (error: any) {
    console.error("❌ Error al obtener cuenta extra por ID:", error);
    return {
      success: false,
      message: "❌ Error al obtener la cuenta extra",
      error: error.message,
      data: null,
    };
  }
}

export async function createCuentaExtra(data: {
  inversionistaId: number;
  bancoId: number;
  tipoCuenta: TipoCuenta;
  numeroCuenta: string;
  motivoCuenta: string;
  moneda?: Moneda;
}) {
  try {
    const [nueva] = await db
      .insert(cuentas_extra_inversionista)
      .values({
        inversionista_id: data.inversionistaId,
        banco_id: data.bancoId,
        tipo_cuenta: data.tipoCuenta,
        numero_cuenta: data.numeroCuenta,
        motivo_cuenta: data.motivoCuenta,
        ...(data.moneda ? { moneda: data.moneda } : {}),
      })
      .returning();

    return {
      success: true,
      message: "✅ Cuenta extra creada correctamente",
      data: nueva,
    };
  } catch (error: any) {
    console.error("❌ Error al crear cuenta extra:", error);
    return {
      success: false,
      message: "❌ Error al crear la cuenta extra",
      error: error.message,
      data: null,
    };
  }
}

export async function updateCuentaExtra(
  cuentaExtraId: number,
  data: Partial<{
    bancoId: number;
    tipoCuenta: TipoCuenta;
    numeroCuenta: string;
    motivoCuenta: string;
    moneda: Moneda;
  }>
) {
  try {
    const updateValues: Record<string, unknown> = {};
    if (data.bancoId !== undefined) updateValues.banco_id = data.bancoId;
    if (data.tipoCuenta !== undefined) updateValues.tipo_cuenta = data.tipoCuenta;
    if (data.numeroCuenta !== undefined) updateValues.numero_cuenta = data.numeroCuenta;
    if (data.motivoCuenta !== undefined) updateValues.motivo_cuenta = data.motivoCuenta;
    if (data.moneda !== undefined) updateValues.moneda = data.moneda;

    if (Object.keys(updateValues).length === 0) {
      return {
        success: false,
        message: "❌ No hay campos para actualizar",
        data: null,
      };
    }

    const [actualizada] = await db
      .update(cuentas_extra_inversionista)
      .set(updateValues)
      .where(eq(cuentas_extra_inversionista.cuenta_extra_id, cuentaExtraId))
      .returning();

    if (!actualizada) {
      return {
        success: false,
        message: "❌ Cuenta extra no encontrada",
        data: null,
      };
    }

    return {
      success: true,
      message: "✅ Cuenta extra actualizada correctamente",
      data: actualizada,
    };
  } catch (error: any) {
    console.error("❌ Error al actualizar cuenta extra:", error);
    return {
      success: false,
      message: "❌ Error al actualizar la cuenta extra",
      error: error.message,
      data: null,
    };
  }
}

export async function deleteCuentaExtra(cuentaExtraId: number) {
  try {
    const [eliminada] = await db
      .delete(cuentas_extra_inversionista)
      .where(eq(cuentas_extra_inversionista.cuenta_extra_id, cuentaExtraId))
      .returning();

    if (!eliminada) {
      return {
        success: false,
        message: "❌ Cuenta extra no encontrada",
        data: null,
      };
    }

    return {
      success: true,
      message: "✅ Cuenta extra eliminada correctamente",
      data: eliminada,
    };
  } catch (error: any) {
    console.error("❌ Error al eliminar cuenta extra:", error);
    return {
      success: false,
      message: "❌ Error al eliminar la cuenta extra",
      error: error.message,
      data: null,
    };
  }
}
