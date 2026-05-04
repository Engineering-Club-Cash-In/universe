// services/cuentas.service.ts
import { and, asc, desc, eq, gte, ilike, lte } from "drizzle-orm";
import { cuentasEmpresa, cuentas_empresa_movimientos } from "../database/db";
import { db } from "../database";

type MonedaCuenta = "quetzales" | "dolares";
type TipoMovimiento = "ingreso" | "egreso";

// Lista cuentas con filtros opcionales: nombre (ilike, parcial),
// cuentaId (exacto), soloActivas (default false: trae activas e inactivas).
export async function getCuentasEmpresa(filters?: {
  nombreCuenta?: string;
  cuentaId?: number;
  soloActivas?: boolean;
}) {
  try {
    const conditions = [];
    if (filters?.cuentaId !== undefined) {
      conditions.push(eq(cuentasEmpresa.cuentaId, filters.cuentaId));
    }
    if (filters?.nombreCuenta) {
      conditions.push(ilike(cuentasEmpresa.nombreCuenta, `%${filters.nombreCuenta}%`));
    }
    if (filters?.soloActivas) {
      conditions.push(eq(cuentasEmpresa.activo, true));
    }

    const cuentas = await db
      .select()
      .from(cuentasEmpresa)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
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
  moneda?: MonedaCuenta;
}) {
  try {
    const [nuevaCuenta] = await db
      .insert(cuentasEmpresa)
      .values({
        nombreCuenta: data.nombreCuenta,
        banco: data.banco,
        numeroCuenta: data.numeroCuenta,
        descripcion: data.descripcion,
        ...(data.moneda ? { moneda: data.moneda } : {}),
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
    moneda: MonedaCuenta;
  }>
) {
  try {
    const [cuentaActualizada] = await db
      .update(cuentasEmpresa)
      .set(data)
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
    // Soft delete - solo desactivar (el trigger DB actualiza fecha_actualizacion)
    const [cuentaDesactivada] = await db
      .update(cuentasEmpresa)
      .set({ activo: false })
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

// Inserta un movimiento (ingreso/egreso) en el ledger.
// Toda la lógica de saldo está en la DB:
//   - El trigger trg_cuentas_empresa_mov_aplicar (BEFORE INSERT) suma o resta
//     `monto` al saldo_actual de la cuenta y rellena `saldo_post`.
//   - Si el cuenta_id no existe, el trigger tira RAISE EXCEPTION → cae al catch.
// Pasamos saldo_post: "0" como placeholder porque la columna es NOT NULL;
// el trigger lo sobrescribe antes de insertar.
// Lista los movimientos de una cuenta con filtros opcionales:
// - tipo: ingreso | egreso
// - desde / hasta: rango de fechas (created_at)
// - orden: asc | desc (default desc → más reciente primero)
export async function getMovimientosByCuenta(
  cuentaId: number,
  filters?: {
    tipo?: TipoMovimiento;
    desde?: Date;
    hasta?: Date;
    orden?: "asc" | "desc";
  }
) {
  try {
    const conditions = [eq(cuentas_empresa_movimientos.cuenta_id, cuentaId)];

    if (filters?.tipo) {
      conditions.push(eq(cuentas_empresa_movimientos.tipo, filters.tipo));
    }
    if (filters?.desde) {
      conditions.push(gte(cuentas_empresa_movimientos.created_at, filters.desde));
    }
    if (filters?.hasta) {
      conditions.push(lte(cuentas_empresa_movimientos.created_at, filters.hasta));
    }

    const orderFn = filters?.orden === "asc" ? asc : desc;

    const movimientos = await db
      .select()
      .from(cuentas_empresa_movimientos)
      .where(and(...conditions))
      .orderBy(orderFn(cuentas_empresa_movimientos.created_at));

    return {
      success: true,
      message: "✅ Movimientos obtenidos correctamente",
      data: movimientos,
    };
  } catch (error: any) {
    console.error("❌ Error al obtener movimientos:", error);
    return {
      success: false,
      message: "❌ Error al obtener los movimientos",
      error: error.message,
      data: [],
    };
  }
}

export async function crearMovimientoCuentaEmpresa(data: {
  cuentaId: number;
  tipo: TipoMovimiento;
  monto: string;
  motivo?: string;
  createdBy?: number;
}) {
  try {
    const [movimiento] = await db
      .insert(cuentas_empresa_movimientos)
      .values({
        cuenta_id: data.cuentaId,
        tipo: data.tipo,
        monto: data.monto,
        saldo_post: "0",
        motivo: data.motivo,
        created_by: data.createdBy,
      })
      .returning();

    return {
      success: true,
      message: "✅ Movimiento registrado correctamente",
      data: movimiento,
    };
  } catch (error: any) {
    console.error("❌ Error al crear movimiento de cuenta:", error);
    return {
      success: false,
      message: "❌ Error al registrar el movimiento",
      error: error.message,
      data: null,
    };
  }
}
