import { db } from "../database/index";
import {
  asesores,
  bad_debts,
  boletas,
  credit_cancelations,
  creditos,
  creditos_inversionistas,
  creditos_rubros_otros,
  cuotas_credito,
  inversionistas,
  montos_adicionales,
  moras_credito,
  pagos_credito,
  usuarios,
} from "../database/db/schema";
import { z } from "zod";
import Big from "big.js";
import {
  and,
  desc,
  eq,
  sql,
  inArray,
  asc,
  lte,
  lt,
  gte,
  gt,
} from "drizzle-orm";
import { getPagosDelMesActual } from "./payments";
import { Context } from "elysia/dist/context";

 


export const getCreditoByNumero = async (numero_credito_sifco: string) => {
  try {
    // 1. Buscar el crédito con su usuario
    const creditoData = await db
      .select()
      .from(creditos)
      .where(
        and(
          eq(creditos.numero_credito_sifco, numero_credito_sifco),
          inArray(creditos.statusCredit, ["ACTIVO", "PENDIENTE_CANCELACION"])
        )
      )
      .innerJoin(usuarios, eq(creditos.usuario_id, usuarios.usuario_id))
      .limit(1);

    if (creditoData.length === 0) {
      return { message: "Crédito no encontrado" };
    }

    const currentCredit = creditoData[0];
    const creditoId = currentCredit.creditos.credito_id;
    // 2. Si el crédito está cancelado, traer la info de cancelación y retornar flujo especial
    if (
      currentCredit.creditos.statusCredit === "CANCELADO" ||
      currentCredit.creditos.statusCredit === "PENDIENTE_CANCELACION"
    ) {
      // Buscar la info de cancelación
      const cancelacion = await db
        .select()
        .from(credit_cancelations)
        .where(eq(credit_cancelations.credit_id, creditoId))
        .limit(1);

      return {
        credito: currentCredit.creditos,
        usuario: currentCredit.usuarios,
        cancelacion: cancelacion[0] || null,
        flujo: "CANCELADO",
      };
    }

    // 2. Consultar todas las cuotas pagadas (pagado = true)
    const cuotasPagadas = await db
      .select()
      .from(cuotas_credito)
      .where(
        and(
          eq(cuotas_credito.credito_id, creditoId),
          eq(cuotas_credito.pagado, true)
        )
      )
      .orderBy(cuotas_credito.numero_cuota);

    // 4. Calcular la cuota que toca este mes (según meses transcurridos desde fecha_creacion)
    const fechaInicio = new Date(currentCredit.creditos.fecha_creacion);
    const hoy = new Date();
    const mesesTranscurridos =
      (hoy.getFullYear() - fechaInicio.getFullYear()) * 12 +
      (hoy.getMonth() - fechaInicio.getMonth()) +
      1;

    // 5. Consultar cuotas pendientes (no pagadas y ya deberían haberse pagado)
    const cuotasAtrasadas = await db
      .select()
      .from(cuotas_credito)
      .where(
        and(
          eq(cuotas_credito.credito_id, creditoId),

          eq(cuotas_credito.pagado, false),
          lt(cuotas_credito.fecha_vencimiento, hoy.toISOString().slice(0, 10))
        )
      )
      .orderBy(asc(cuotas_credito.numero_cuota));

    const cuotasPendientes = await db
      .select()
      .from(cuotas_credito)
      .where(
        and(
          eq(cuotas_credito.credito_id, creditoId),

          eq(cuotas_credito.pagado, false)
        )
      )
      .orderBy(asc(cuotas_credito.numero_cuota));

    // 6. Consultar si la cuota actual ya fue pagada
    const [cuotaActualData] = await db
      .select()
      .from(cuotas_credito)
      .where(
        and(
          eq(cuotas_credito.credito_id, creditoId),
          gt(cuotas_credito.numero_cuota, 0),
          gte(cuotas_credito.fecha_vencimiento, hoy.toISOString().slice(0, 10))
        )
      )
      .orderBy(cuotas_credito.fecha_vencimiento)
      .limit(1);

    // ¿Está pagada la cuota actual?
    const cuotaActualPagada = !!(cuotaActualData && cuotaActualData.pagado);

    // La cuota actual del mes es la de número `mesesTranscurridos`
    const cuotaActual = cuotaActualData.numero_cuota;

    return {
      credito: currentCredit.creditos,
      usuario: currentCredit.usuarios,
      cuotaActual, // Cuota que debe pagar este mes (número)
      cuotaActualPagada, // true si ya la pagó, false si no
      cuotasPendientes: cuotasPendientes, // Todas las cuotas vencidas y no pagadas
      cuotasAtrasadas: cuotasAtrasadas,
      cuotasPagadas, // Todas las cuotas pagadas
    };
  } catch (error) {
    console.error("[getCreditoByNumero] Error:", error);
    return { message: "Error consultando crédito", error: String(error) };
  }
};

// Interfaces para cancelaciones/incobrables
export interface CreditCancelation {
  id: number;
  credit_id: number;
  motivo: string;
  observaciones?: string | null;
  fecha_cancelacion: Date | string;
  monto_cancelacion: number;
}

export interface BadDebt {
  id: number;
  credit_id: number;
  motivo: string;
  observaciones?: string | null;
  fecha_registro: Date | string;
  monto_incobrable: number;
}

export interface CreditoConInfo {
  creditos: typeof creditos.$inferSelect;
  usuarios: typeof usuarios.$inferSelect;
  asesores: typeof asesores.$inferSelect;
  inversionistas: {
    credito_id: number;
    inversionista_id: number;
    nombre: string;
    emite_factura: boolean;
    monto_aportado: string;
    monto_cash_in: string;
    monto_inversionista: string;
    iva_cash_in: string;
    iva_inversionista: string;
    porcentaje_participacion_inversionista: string;
    porcentaje_cash_in: string;
    cuota_inversionista: string;
  }[]; // Actualizado para reflejar la estructura real
  resumen: {
    total_cash_in_monto: number;
    total_cash_in_iva: number;
    total_inversion_monto: number;
    total_inversion_iva: number;
  };
  cancelacion?: CreditCancelation | null;
  incobrable?: BadDebt | null;
  rubros?: { nombre_rubro: string; monto: number }[];
}
;
 
export async function getCreditosWithUserByMesAnio(
  mes: number,
  anio: number,
  page: number = 1,
  perPage: number = 10,
  numero_credito_sifco?: string,
  estado?: "ACTIVO" | "CANCELADO" | "INCOBRABLE" | "PENDIENTE_CANCELACION" | "MOROSO"
): Promise<{
  data: CreditoConInfo[];
  page: number;
  perPage: number;
  totalCount: number;
  totalPages: number;
}> {
  console.log(
    `🚀 Fetching credits | mes: ${mes}, anio: ${anio}, page: ${page}, perPage: ${perPage}, estado: ${estado}, numero_credito_sifco: ${numero_credito_sifco}`
  );

  const offset = (page - 1) * perPage;
  const conditions: any[] = [];

  try {
    // 📌 Filtros
    if (numero_credito_sifco && numero_credito_sifco.length > 0) {
      console.log(`🔎 Filtrando por número de crédito: ${numero_credito_sifco}`);
      conditions.push(eq(creditos.numero_credito_sifco, numero_credito_sifco));
    } else {
      if (mes !== 0 && anio !== 0) {
        console.log(`🔎 Filtrando por mes/año: ${mes}/${anio}`);
        conditions.push(
          sql`EXTRACT(MONTH FROM ${creditos.fecha_creacion}) = ${mes}`,
          sql`EXTRACT(YEAR FROM ${creditos.fecha_creacion}) = ${anio}`
        );
      }
    }
    if (estado && estado.length > 0) {
      console.log(`🔎 Filtrando por estado: ${estado}`);
      conditions.push(eq(creditos.statusCredit, estado));
    }
  } catch (err) {
    console.error("❌ Error construyendo filtros:", err);
  }

  const whereCondition = conditions.length > 0 ? and(...conditions) : undefined;

  let rows: any[] = [];
  try {
    // 1️⃣ Buscar créditos + usuarios + asesores
    rows = await db
      .select({
        creditos,
        usuarios,
        asesores,
      })
      .from(creditos)
      .innerJoin(usuarios, eq(creditos.usuario_id, usuarios.usuario_id))
      .innerJoin(asesores, eq(creditos.asesor_id, asesores.asesor_id))
      .where(whereCondition)
      .limit(perPage)
      .offset(offset)
      .orderBy(desc(creditos.fecha_creacion));

    console.log(`📄 Créditos encontrados: ${rows.length}`);
  } catch (err) {
    console.error("❌ Error consultando créditos:", err);
  }

  // 🆔 IDs de créditos
  const creditosIds = rows.map((r) => r.creditos.credito_id);
  console.log("🆔 Créditos IDs:", creditosIds);

  // 2️⃣ Rubros
  let rubrosPorCredito: any[] = [];
  try {
    rubrosPorCredito = await db
      .select({
        credito_id: creditos_rubros_otros.credito_id,
        nombre_rubro: creditos_rubros_otros.nombre_rubro,
        monto: creditos_rubros_otros.monto,
      })
      .from(creditos_rubros_otros)
      .where(inArray(creditos_rubros_otros.credito_id, creditosIds));

    console.log(`📊 Rubros encontrados: ${rubrosPorCredito.length}`);
  } catch (err) {
    console.error("❌ Error consultando rubros:", err);
  }

  const rubrosMap = creditosIds.reduce(
    (acc, creditoId) => {
      acc[creditoId] = rubrosPorCredito
        .filter((r) => r.credito_id === creditoId)
        .map((r) => ({
          nombre_rubro: r.nombre_rubro,
          monto: Number(r.monto),
        }));
      return acc;
    },
    {} as Record<number, { nombre_rubro: string; monto: number }[]>
  );

  // 3️⃣ Inversionistas
  let inversionistasPorCredito: any[] = [];
  try {
    inversionistasPorCredito = await db
      .select({
        credito_id: creditos_inversionistas.credito_id,
        inversionista_id: inversionistas.inversionista_id,
        nombre: inversionistas.nombre,
        emite_factura: inversionistas.emite_factura,
        monto_aportado: creditos_inversionistas.monto_aportado,
        monto_cash_in: creditos_inversionistas.monto_cash_in,
        monto_inversionista: creditos_inversionistas.monto_inversionista,
        iva_cash_in: creditos_inversionistas.iva_cash_in,
        iva_inversionista: creditos_inversionistas.iva_inversionista,
        porcentaje_participacion_inversionista:
          creditos_inversionistas.porcentaje_participacion_inversionista,
        porcentaje_cash_in: creditos_inversionistas.porcentaje_cash_in,
        cuota_inversionista: creditos_inversionistas.cuota_inversionista,
      })
      .from(creditos_inversionistas)
      .innerJoin(
        inversionistas,
        eq(
          creditos_inversionistas.inversionista_id,
          inversionistas.inversionista_id
        )
      )
      .where(inArray(creditos_inversionistas.credito_id, creditosIds));

    console.log(`👥 Inversionistas encontrados: ${inversionistasPorCredito.length}`);
  } catch (err) {
    console.error("❌ Error consultando inversionistas:", err);
  }

  const inversionistasMap = creditosIds.reduce((acc, creditoId) => {
    const aportes = inversionistasPorCredito.filter(
      (inv) => inv.credito_id === creditoId
    );
    acc[creditoId] = {
      aportes,
      resumen: {
        total_cash_in_monto: aportes.reduce(
          (sum, cur) => sum + Number(cur.monto_cash_in ?? 0),
          0
        ),
        total_cash_in_iva: aportes.reduce(
          (sum, cur) => sum + Number(cur.iva_cash_in ?? 0),
          0
        ),
        total_inversion_monto: aportes.reduce(
          (sum, cur) => sum + Number(cur.monto_inversionista ?? 0),
          0
        ),
        total_inversion_iva: aportes.reduce(
          (sum, cur) => sum + Number(cur.iva_inversionista ?? 0),
          0
        ),
      },
    };
    return acc;
  }, {} as Record<number, any>);

  // 4️⃣ Moras
  let moras: any[] = [];
  try {
    moras = await db
      .select({
        credito_id: moras_credito.credito_id,
        mora_id: moras_credito.mora_id,
        activa: moras_credito.activa,
        porcentaje_mora: moras_credito.porcentaje_mora,
        monto_mora: moras_credito.monto_mora,
        cuotas_atrasadas: moras_credito.cuotas_atrasadas,
        created_at: moras_credito.created_at,
        updated_at: moras_credito.updated_at,
      })
      .from(moras_credito)
      .where(inArray(moras_credito.credito_id, creditosIds));

    console.log(`📌 Moras encontradas: ${moras.length}`);
  } catch (err) {
    console.error("❌ Error consultando moras:", err);
  }

  const morasMap: Record<number, any> = {};
  moras.forEach((row) => {
    morasMap[row.credito_id] = row;
  });

  // --- Cancelaciones & Incobrables ---
  let cancelaciones: CreditCancelation[] = [];
  let incobrables: BadDebt[] = [];

  try {
    const canceladosIds = rows
      .filter((r) => r.creditos.statusCredit === "CANCELADO")
      .map((r) => r.creditos.credito_id);
    if (canceladosIds.length > 0) {
      console.log("🛑 Créditos cancelados:", canceladosIds);
      const cancelacionesRaw = await db
        .select()
        .from(credit_cancelations)
        .where(inArray(credit_cancelations.credit_id, canceladosIds));
      cancelaciones = cancelacionesRaw.map((row) => ({
        ...row,
        fecha_cancelacion: row.fecha_cancelacion ?? "",
        monto_cancelacion: Number(row.monto_cancelacion),
      }));
    }
  } catch (err) {
    console.error("❌ Error consultando cancelaciones:", err);
  }

  try {
    const incobrablesIds = rows
      .filter((r) => r.creditos.statusCredit === "INCOBRABLE")
      .map((r) => r.creditos.credito_id);
    if (incobrablesIds.length > 0) {
      console.log("⚠️ Créditos incobrables:", incobrablesIds);
      const incobrablesRaw = await db
        .select()
        .from(bad_debts)
        .where(inArray(bad_debts.credit_id, incobrablesIds));
      incobrables = incobrablesRaw.map((row) => ({
        ...row,
        fecha_registro: row.fecha_registro ?? "",
        monto_incobrable: Number(row.monto_incobrable),
      }));
    }
  } catch (err) {
    console.error("❌ Error consultando incobrables:", err);
  }

  try {
    const incobrablesIds = rows
      .filter((r) => r.creditos.statusCredit === "INCOBRABLE")
      .map((r) => r.creditos.credito_id);
    if (incobrablesIds.length > 0) {
      console.log("⚠️ Créditos incobrables:", incobrablesIds);
      const incobrablesRaw = await db
        .select()
        .from(bad_debts)
        .where(inArray(bad_debts.credit_id, incobrablesIds));
      incobrables = incobrablesRaw.map((row) => ({
        ...row,
        fecha_registro: row.fecha_registro ?? "",
        monto_incobrable: Number(row.monto_incobrable),
      }));
    }
  } catch (err) {
    console.error("❌ Error consultando incobrables:", err);
  }

  const cancelacionesMap: Record<number, CreditCancelation> = {};
  cancelaciones.forEach((row) => (cancelacionesMap[row.credit_id] = row));

  const incobrablesMap: Record<number, BadDebt> = {};
  incobrables.forEach((row) => (incobrablesMap[row.credit_id] = row));

  // 5️⃣ Map final
  let data: CreditoConInfo[] = [];
  try {
    data = rows.map((row) => {
      const info = inversionistasMap[row.creditos.credito_id] || {
        aportes: [],
        resumen: {
          total_cash_in_monto: 0,
          total_cash_in_iva: 0,
          total_inversion_monto: 0,
          total_inversion_iva: 0,
        },
      };
      const rubros = rubrosMap[row.creditos.credito_id] || [];
      const cancelacion =
        row.creditos.statusCredit === "CANCELADO"
          ? cancelacionesMap[row.creditos.credito_id] || null
          : undefined;
      const incobrable =
        row.creditos.statusCredit === "INCOBRABLE"
          ? incobrablesMap[row.creditos.credito_id] || null
          : undefined;

      const mora = morasMap[row.creditos.credito_id] || null;
      const deuda_total_con_mora = new Big(row.creditos.deudatotal ?? 0)
        .plus(new Big(mora?.monto_mora ?? 0))
        .toString();

      return {
        creditos: row.creditos,
        usuarios: row.usuarios,
        asesores: row.asesores,
        inversionistas: info.aportes,
        resumen: info.resumen,
        cancelacion,
        rubros,
        incobrable,
        mora,                    // 👈 objeto de mora completo
        deuda_total_con_mora,    // 👈 suma con Big.js
      };
    });
    console.log(`✅ Créditos mapeados: ${data.length}`);
  } catch (err) {
    console.error("❌ Error mapeando créditos:", err);
  }

  // 6️⃣ Paginación
  let count = 0;
  try {
    const [{ count: total }] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(creditos)
      .innerJoin(usuarios, eq(creditos.usuario_id, usuarios.usuario_id))
      .where(whereCondition);
    count = Number(total);
    console.log(`📊 Total records encontrados: ${count}`);
  } catch (err) {
    console.error("❌ Error contando créditos:", err);
  }

  return {
    data,
    page,
    perPage,
    totalCount: count,
    totalPages: Math.ceil(count / perPage),
  };
}


type Aporte = {
  monto_cash_in: string; // viene como string desde la DB
  monto_inversionista: string;
};

type ResultadoDistribucion = {
  cuota_cash_in: Big;
  iva_cash_in: Big;
  cuota_inversionistas: Big;
  iva_inversionistas: Big;
};

export function calcularDistribucionCuota({
  capital,
  cuota_interes,
  aportes,
}: {
  capital: Big;
  cuota_interes: Big;
  aportes: Aporte[];
}): ResultadoDistribucion {
  const totalCashIn = aportes.reduce(
    (acc, cur) => acc.plus(cur.monto_cash_in),
    new Big(0)
  );

  const totalInversion = aportes.reduce(
    (acc, cur) => acc.plus(cur.monto_inversionista),
    new Big(0)
  );

  const cuota_cash_in = totalCashIn.div(capital).times(cuota_interes).round(2);
  const iva_cash_in = cuota_cash_in.times(0.12).round(2);

  const cuota_inversionistas = totalInversion
    .div(capital)
    .times(cuota_interes)
    .round(2);
  const iva_inversionistas = cuota_inversionistas.times(0.12).round(2);

  return {
    cuota_cash_in,
    iva_cash_in,
    cuota_inversionistas,
    iva_inversionistas,
  };
}

export async function cancelCredit(creditId: number) {
  try {
    // 1. Obtener el crédito
    const [credit] = await db
      .select()
      .from(creditos)
      .where(eq(creditos.credito_id, creditId))
      .limit(1);

    if (!credit) {
      return { message: "Crédito no encontrado." };
    }
    const hoy = new Date();

    // 2. Obtener cuotas pendientes
    const cuotasPendientes = await db
      .select()
      .from(pagos_credito)
      .where(
        and(
          eq(pagos_credito.credito_id, creditId),
          eq(pagos_credito.pagado, false),
          lte(pagos_credito.fecha_pago, hoy.toISOString().slice(0, 10))
        )
      );

    const numeroCuotasPendientes = cuotasPendientes.length;

    // 3. Calcular montos
    const capitalActual = new Big(credit.capital ?? 0);
    const cuotaInteres = new Big(credit.cuota_interes ?? 0);
    const membresiasPago = new Big(credit.membresias_pago ?? 0);
    const seguro10Cuotas = new Big(credit.seguro_10_cuotas ?? 0);
    const iva12 = new Big(credit.iva_12 ?? 0);

    const totalInteresesPendientes = cuotaInteres.times(numeroCuotasPendientes);
    const totalMembresiasPendientes = membresiasPago.times(
      numeroCuotasPendientes
    );
    const totalSeguroPendiente = seguro10Cuotas.times(numeroCuotasPendientes);
    const totalIvaPendiente = iva12.times(numeroCuotasPendientes);

    // 4. Devolver la info
    return {
      message: "Resumen del crédito a cancelar",
      credito: {
        capital_actual: capitalActual.toFixed(2),
        total_intereses_pendientes: totalInteresesPendientes.toFixed(2),
        total_membresias_pendientes: totalMembresiasPendientes.toFixed(2),
        total_seguro_pendiente: totalSeguroPendiente.toFixed(2),
        total_iva_pendiente: totalIvaPendiente.toFixed(2),
        cuotas_pendientes: numeroCuotasPendientes,
      },
    };
  } catch (error) {
    console.error("Error cancelando crédito:", error);
    return { message: "Error cancelando crédito", error: String(error) };
  }
}

const MontoAdicionalSchema = z.object({
  concepto: z.string().min(1),
  monto: z.number(), // positivo suma / negativo descuenta
});
// Define the inferred type from the schema
type MontoAdicional = z.infer<typeof MontoAdicionalSchema>;

const AccionCreditoParamsSchema = z.object({
  creditId: z.number(),
  motivo: z.string().optional(),
  observaciones: z.string().optional(),
  monto_cancelacion: z.number().optional(),
  accion: z.enum([
    "CANCELAR",
    "ACTIVAR",
    "INCOBRABLE",
    "PENDIENTE_CANCELACION",
  ]),
  montosAdicionales: z.array(MontoAdicionalSchema).optional(),
});

const STATUS_MAP = {
  CANCELAR: "CANCELADO",
  PENDIENTE_CANCELACION: "PENDIENTE_CANCELACION",
  // Puedes agregar más acciones aquí si las necesitas
};

/**
 * Actualiza el estado de un crédito: cancela o activa según el parámetro 'accion'.
 */
export type AccionCreditoParams = z.infer<typeof AccionCreditoParamsSchema>;

export async function actualizarEstadoCredito(input: AccionCreditoParams) {
  // Validate input
  const {
    creditId,
    motivo,
    observaciones,
    monto_cancelacion,
    accion,
    montosAdicionales,
  } = AccionCreditoParamsSchema.parse(input);

  // Guard rails for actions that require motivo + monto
  const needsReasonAndAmount =
    accion === "CANCELAR" ||
    accion === "PENDIENTE_CANCELACION" ||
    accion === "INCOBRABLE";
  if (needsReasonAndAmount && (!motivo || monto_cancelacion == null)) {
    return {
      ok: false,
      message: "Debes enviar 'motivo' y 'monto_cancelacion' para esta acción.",
    };
  }

  try {
    const result = await db.transaction(async (tx) => {
      /** 1) OPCIONAL: insertar montos adicionales ANTES del cambio de estado */
      if (montosAdicionales?.length) {
        await tx.insert(montos_adicionales).values(
          montosAdicionales.map((m) => ({
            credit_id: creditId,
            concepto: m.concepto,
            monto: m.monto.toString(), // numeric -> string
          }))
        );
      }

      /** 2) Cambios según acción */
      if (accion === "CANCELAR" || accion === "PENDIENTE_CANCELACION") {
        const newStatus =
          STATUS_MAP[accion as keyof typeof STATUS_MAP] ||
          "PENDIENTE_CANCELACION";

        // a) Update credit status
        await tx
          .update(creditos)
          .set({
            statusCredit: newStatus as
              | "CANCELADO"
              | "ACTIVO"
              | "INCOBRABLE"
              | "PENDIENTE_CANCELACION",
          })
          .where(eq(creditos.credito_id, creditId));

        // b) Register cancelation (idempotent insert; assume one row per credit)
        await tx.insert(credit_cancelations).values({
          credit_id: creditId,
          motivo: motivo!, // validated above
          observaciones: observaciones ?? "",
          monto_cancelacion: monto_cancelacion!.toString(),
        });

        return {
          ok: true,
          message: `Crédito ${newStatus.toLowerCase().replace("_", " ")} correctamente`,
        };
      }

      if (accion === "ACTIVAR") {
        // a) Set ACTIVE
        await tx
          .update(creditos)
          .set({ statusCredit: "ACTIVO" })
          .where(eq(creditos.credito_id, creditId));

        // b) Remove cancelation & bad debt records
        await tx
          .delete(credit_cancelations)
          .where(eq(credit_cancelations.credit_id, creditId));
        await tx.delete(bad_debts).where(eq(bad_debts.credit_id, creditId));
        await tx
          .delete(montos_adicionales)
          .where(eq(montos_adicionales.credit_id, creditId));

        return {
          ok: true,
          message: "Crédito reactivado y registros de cierre eliminados",
        };
      }

      // accion === "INCOBRABLE"
      // a) Set UNCOLLECTIBLE
      await tx
        .update(creditos)
        .set({ statusCredit: "INCOBRABLE" })
        .where(eq(creditos.credito_id, creditId));

      // b) Register bad debt
      await tx.insert(bad_debts).values({
        credit_id: creditId,
        motivo: motivo!, // validated above
        observaciones: observaciones ?? "",
        monto_incobrable: monto_cancelacion!.toString(),
      });

      return {
        ok: true,
        message: "Crédito marcado como incobrable correctamente",
      };
    });

    return result;
  } catch (err) {
    console.error("[ERROR] actualizarEstadoCredito:", err);
    return {
      ok: false,
      message: "[ERROR] No fue posible actualizar el estado del crédito",
    };
  }
}
/**
 * Obtiene todos los créditos marcados como incobrables, junto con su usuario e información relevante.
 * Permite paginación para evitar respuestas demasiado grandes.
 * Si se pasa el número de crédito SIFCO, filtra solo ese crédito.
 * @param page Página (empieza en 1)
 * @param perPage Registros por página (default 20)
 * @param numero_credito_sifco (opcional) Número de crédito SIFCO para filtrar
 */
export async function getCreditosIncobrables(
  page: number = 1,
  perPage: number = 20,
  numero_credito_sifco?: string
) {
  try {
    console.log(
      "[getCreditosIncobrables] Iniciando consulta de créditos incobrables..."
    );
    const offset = (page - 1) * perPage;

    // Condición de filtro opcional por número de crédito SIFCO
    const whereCondition =
      numero_credito_sifco && numero_credito_sifco.length > 0
        ? and(
            eq(creditos.statusCredit, "INCOBRABLE"),
            eq(creditos.numero_credito_sifco, numero_credito_sifco)
          )
        : eq(creditos.statusCredit, "INCOBRABLE");

    // Buscar créditos incobrables paginados
    const creditosIncobrables = await db
      .select({
        creditos,
        usuarios,
        asesores,
        bad_debt: bad_debts,
      })
      .from(creditos)
      .innerJoin(usuarios, eq(creditos.usuario_id, usuarios.usuario_id))
      .innerJoin(asesores, eq(creditos.asesor_id, asesores.asesor_id))
      .innerJoin(bad_debts, eq(creditos.credito_id, bad_debts.credit_id))
      .where(eq(creditos.statusCredit, "INCOBRABLE"))
      .orderBy(desc(creditos.fecha_creacion))
      .limit(perPage)
      .offset(offset);

    // Total para paginación
    const [{ count }] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(creditos)
      .where(eq(creditos.statusCredit, "INCOBRABLE"));

    console.log(
      `[getCreditosIncobrables] Créditos incobrables encontrados: ${creditosIncobrables.length}`
    );
    return {
      ok: true,
      data: creditosIncobrables,
      page,
      perPage,
      totalCount: Number(count),
      totalPages: Math.ceil(Number(count) / perPage),
    };
  } catch (error) {
    console.error(
      "[getCreditosIncobrables] Error al obtener créditos incobrables:",
      error
    );
    return {
      ok: false,
      message: "Error al obtener créditos incobrables",
      error: String(error),
    };
  }
}

export async function reiniciarCredito(
  creditId: number,
  montoIncobrable?: number
) {
  await db
    .update(creditos)
    .set({
      capital: "0",
      porcentaje_interes: "0",
      deudatotal: montoIncobrable !== undefined ? String(montoIncobrable) : "0",
      cuota_interes: "0",
      cuota: "0",
      iva_12: "0",
      seguro_10_cuotas: "0",
      gps: "0",
      membresias_pago: "0",
      membresias: "0",
      porcentaje_royalti: "0",
      royalti: "0", 
      otros: "0",
      statusCredit: "ACTIVO",
    })
    .where(eq(creditos.credito_id, creditId));
}

function construirUrlBoletas(url_boletas: string[], r2BaseUrl: string) {
  return url_boletas.map((url_boleta) => `${r2BaseUrl}${url_boleta}`);
}
export async function resetCredit({
  creditId,
  montoIncobrable,
  montoBoleta,
  url_boletas,
  cuota,
}: {
  creditId: number;
  montoIncobrable?: number;
  montoBoleta: number | string;
  url_boletas: string[];
  cuota: number;
}) {
  try {
    // 🚨 1. Verificar si existe una mora activa para el crédito
    const moraActiva = await db
      .select()
      .from(moras_credito)
      .where(and(eq(moras_credito.credito_id, creditId), eq(moras_credito.activa, true)))
      .limit(1);

    if (moraActiva.length > 0) {
      throw new Error("No se puede reiniciar el crédito porque tiene una mora activa.");
    }

    // 2. Determinar el estado del crédito
    const statusCredit =
      typeof montoIncobrable !== "undefined" &&
      montoIncobrable > 0 &&
      montoBoleta !== undefined
        ? "INCOBRABLE"
        : "CANCELADO";

    // 3. Reinicia el crédito poniendo todos los montos a cero y el estado
    await db
      .update(creditos)
      .set({
        capital: "0",
        porcentaje_interes: "0",
        deudatotal:
          montoIncobrable !== undefined ? String(montoIncobrable) : "0",
        cuota_interes: "0",
        cuota: "0",
        iva_12: "0",
        seguro_10_cuotas: "0",
        gps: "0",
        membresias_pago: "0",
        membresias: "0",
        porcentaje_royalti: "0",
        royalti: "0", 
        otros: "0",
        statusCredit: statusCredit,
      })
      .where(eq(creditos.credito_id, creditId));

    // 4. Consulta el crédito para validar que existe
    const [credito] = await db
      .select()
      .from(creditos)
      .where(eq(creditos.credito_id, creditId));
    if (!credito) {
      throw new Error("Crédito no encontrado.");
    }

    // 5. Construir URLs de boletas
    const r2BaseUrl = import.meta.env.URL_PUBLIC_R2 ?? "";
    const urlCompletas = construirUrlBoletas(url_boletas, r2BaseUrl);

    // 6. Obtener pagos del mes + monto de boleta
    const pago_del_mes = await getPagosDelMesActual(credito.credito_id);
    const pago_del_mesBig = new Big(pago_del_mes ?? 0).add(montoBoleta ?? 0);

    // 7. Buscar cuota_id correspondiente
    const [cuotaEncontrada] = await db
      .select({ cuota_id: cuotas_credito.cuota_id })
      .from(cuotas_credito)
      .where(
        and(
          eq(cuotas_credito.credito_id, credito.credito_id),
          eq(cuotas_credito.numero_cuota, cuota)
        )
      )
      .limit(1);

    const cuotaId = cuotaEncontrada?.cuota_id;

    // 8. Insertar nuevo pago
    const [nuevoPago] = await db
      .insert(pagos_credito)
      .values({
        credito_id: credito.credito_id,
        cuota_id: cuotaId,
        cuota: credito.cuota?.toString() ?? "0",
        cuota_interes: credito.cuota_interes?.toString() ?? "0",
        abono_capital: "0",
        abono_interes: "0",
        abono_iva_12: "0",
        abono_interes_ci: "0",
        abono_iva_ci: "0",
        abono_seguro: "0",
        abono_gps: "0",
        pago_del_mes: pago_del_mesBig.toString(),
        monto_boleta: montoBoleta.toString(),
        capital_restante: credito.capital?.toString() ?? "0",
        interes_restante: credito.cuota_interes?.toString() ?? "0",
        iva_12_restante: credito.iva_12?.toString() ?? "0",
        seguro_restante: credito.seguro_10_cuotas?.toString() ?? "0",
        gps_restante: credito.gps?.toString() ?? "0",
        total_restante: credito.deudatotal?.toString() ?? "0",
        llamada: "",
        renuevo_o_nuevo: "renuevo",
        membresias:
        credito.membresias_pago?.toString() ?? "",
        membresias_pago: credito.membresias_pago?.toString() ?? "",
        membresias_mes: credito.membresias_pago?.toString() ?? "",
        otros: "0",
        mora: "0",
        monto_boleta_cuota: montoBoleta.toString(),
        seguro_total: credito.seguro_10_cuotas?.toString() ?? "0",
        pagado: true,
        facturacion: "si",
        mes_pagado: "",
        seguro_facturado: credito.seguro_10_cuotas?.toString() ?? "0",
        gps_facturado: credito.gps?.toString() ?? "0",
        reserva: "0",
        observaciones: "",
      })
      .returning();

    // 9. Eliminar pagos no pagados
    await db
      .delete(pagos_credito)
      .where(
        and(
          eq(pagos_credito.credito_id, credito.credito_id),
          eq(pagos_credito.pagado, false)
        )
      );

    // 10. Insertar boletas si existen
    if (
      urlCompletas &&
      urlCompletas.length > 0 &&
      nuevoPago &&
      nuevoPago?.pago_id
    ) {
      await db.insert(boletas).values(
        urlCompletas.map((url) => ({
          pago_id: nuevoPago?.pago_id,
          url_boleta: url,
        }))
      );
    }

    // 11. Retorno OK
    return {
      ok: true,
      message: "Crédito reiniciado y pago creado exitosamente.",
    };
  } catch (error) {
    console.error("[ERROR] resetCredit:", error);
    throw new Error(
      error instanceof Error
        ? error.message
        : "Error al reiniciar el crédito y crear el pago."
    );
  }
}

type SyncTermsInput = {
  creditoId: number;
  newCuota: number; // incoming updated cuota
  newPlazo: number; // incoming updated plazo (months)
  // Optional: pass preloaded credit to save a roundtrip (if you already fetched it)
  preloadCredit?: {
    cuota: string | number;
    plazo: number;
    capital: string | number;
    porcentaje_interes: string | number;
    iva_12: string | number;
    deudatotal: string | number;
    seguro_10_cuotas: string | number;
    gps: string | number;
    membresias_pago: string | number;
    formato_credito?: string | null;
  };
};

export async function syncScheduleOnTermsChange({
  creditoId,
  newCuota,
  newPlazo,
  preloadCredit,
}: SyncTermsInput) {
  return await db.transaction(async (tx) => {
    // 1) Load current credit
    const [credit] = preloadCredit
      ? [{ credito_id: creditoId, ...preloadCredit }]
      : await tx
          .select({
            credito_id: creditos.credito_id,
            cuota: creditos.cuota,
            plazo: creditos.plazo,
            capital: creditos.capital,
            porcentaje_interes: creditos.porcentaje_interes,
            iva_12: creditos.iva_12,
            deudatotal: creditos.deudatotal,
            seguro_10_cuotas: creditos.seguro_10_cuotas,
            gps: creditos.gps,
            membresias_pago: creditos.membresias_pago,
            formato_credito: creditos.formato_credito,
          })
          .from(creditos)
          .where(eq(creditos.credito_id, creditoId));

    if (!credit) {
      throw new Error("[ERROR] Credit not found");
    }

    const oldCuotaNum = Number(credit.cuota ?? 0);
    const oldPlazoNum = Number(credit.plazo ?? 0);
    const changedCuota = Number(newCuota) !== oldCuotaNum;
    const changedPlazo = Number(newPlazo) !== oldPlazoNum;

    if (!changedCuota && !changedPlazo) {
      // Nothing to do
      return { updated: false, reason: "No changes" };
    }

    // --- helper: generate due dates like your creation logic (30th or last day) ---
    function generateNextDates(fromDateISO: string, count: number): string[] {
      // fromDateISO = 'YYYY-MM-DD'
      const [y, m, d] = fromDateISO.split("-").map((v) => Number(v));
      const base = new Date(Date.UTC(y, m - 1, d, 12, 0, 0)); // noon UTC
      const dates: string[] = [];

      for (let i = 0; i < count; i++) {
        const dt = new Date(base);
        // move month + i + 1 (next months)
        dt.setUTCMonth(dt.getUTCMonth() + i + 1);

        const month = dt.getUTCMonth();
        const year = dt.getUTCFullYear();
        // last day of month
        const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
        const day = lastDay < 30 ? lastDay : 30;

        const final = new Date(Date.UTC(year, month, day, 12, 0, 0));
        // Return in 'sv-SE' like your logic (YYYY-MM-DD)
        const iso = final
          .toLocaleDateString("sv-SE", { timeZone: "America/Guatemala" })
          .toString();
        dates.push(iso);
      }
      return dates;
    }

    // --- 2) If only cuota changed: update cuota in UNPAID payments ---
    if (changedCuota && !changedPlazo) {
      await tx
        .update(pagos_credito)
        .set({
          // only cuota changes, everything else stays as-is
          cuota: new Big(newCuota).round(2).toString(),
        })
        .where(
          and(
            eq(pagos_credito.credito_id, creditoId),
            eq(pagos_credito.pagado, false)
          )
        );

      // Reflect new cuota in creditos row (keeping your other totals untouched)
      await tx
        .update(creditos)
        .set({ cuota: new Big(newCuota).round(2).toString() })
        .where(eq(creditos.credito_id, creditoId));

      return { updated: true, changedCuota: true, changedPlazo: false };
    }

    // --- 3) If plazo changed: add/remove schedule, and also handle cuota change if applies ---
    // Load current cuotas (excluding numero_cuota = 0 "cuota inicial")
    const cuotasRows = await tx
      .select({
        cuota_id: cuotas_credito.cuota_id,
        numero_cuota: cuotas_credito.numero_cuota,
        fecha_vencimiento: cuotas_credito.fecha_vencimiento,
        pagado: cuotas_credito.pagado,
      })
      .from(cuotas_credito)
      .where(eq(cuotas_credito.credito_id, creditoId));

    const cuotasReal = cuotasRows.filter((c) => c.numero_cuota > 0);
    const maxNumero = cuotasReal.reduce(
      (acc, r) => Math.max(acc, Number(r.numero_cuota)),
      0
    );

    // Update cuota for unpaid rows if cuota also changed
    if (changedCuota) {
      await tx
        .update(pagos_credito)
        .set({
          cuota: new Big(newCuota).round(2).toString(),
        })
        .where(
          and(
            eq(pagos_credito.credito_id, creditoId),
            eq(pagos_credito.pagado, false)
          )
        );
    }

    if (newPlazo > oldPlazoNum) {
      // --- 3.a) Increase plazo: append missing cuotas & pagos ---
      const toAppend = newPlazo - oldPlazoNum;

      // last scheduled date to continue from:
      const lastCuota = cuotasReal.sort(
        (a, b) => a.numero_cuota - b.numero_cuota
      )[cuotasReal.length - 1];
      const lastDateISO = lastCuota
        ? (lastCuota.fecha_vencimiento as string)
        : // fallback: if for some reason there is no cuota > 0, base from today like insert
          new Date()
            .toLocaleDateString("sv-SE", { timeZone: "America/Guatemala" })
            .toString();

      const newDates = generateNextDates(lastDateISO, toAppend);

      // Insert cuotas_credito batch
      const newCuotasToInsert = newDates.map((fecha, idx) => ({
        credito_id: creditoId,
        numero_cuota: maxNumero + idx + 1,
        fecha_vencimiento: fecha,
        pagado: false,
      }));

      const insertedCuotas = await tx
        .insert(cuotas_credito)
        .values(newCuotasToInsert)
        .returning({
          cuota_id: cuotas_credito.cuota_id,
          numero_cuota: cuotas_credito.numero_cuota,
          fecha_vencimiento: cuotas_credito.fecha_vencimiento,
        });

      // Build pagos for each new cuota, mirroring your creation template
      const cuotaStr = new Big(changedCuota ? newCuota : oldCuotaNum)
        .round(2)
        .toString();

      const pagosToInsert = insertedCuotas.map((c) => ({
        credito_id: creditoId,
        cuota: cuotaStr,
        // keep interest per your credit row (unchanged here)
        cuota_interes: new Big(credit.porcentaje_interes ?? 0)
          .times(new Big(credit.capital ?? 0).div(100))
          .round(2)
          .toString(), // same formula you used on create (capital * rate%)
        cuota_id: c.cuota_id,
        fecha_pago: c.fecha_vencimiento,
        abono_capital: "0",
        abono_interes: "0",
        abono_iva_12: "0",
        abono_interes_ci: "0",
        abono_iva_ci: "0",
        abono_seguro:
          Number(credit.seguro_10_cuotas ?? 0) > 0 ? "0" : undefined,
        abono_gps: Number(credit.gps ?? 0) > 0 ? "0" : undefined,
        pago_del_mes: "0",
        monto_boleta: "0",
        fecha_filtro: c.fecha_vencimiento,
        renuevo_o_nuevo: "",
        capital_restante: new Big(credit.capital ?? 0).toString(),
        interes_restante: new Big(credit.porcentaje_interes ?? 0)
          .times(new Big(credit.capital ?? 0).div(100))
          .round(2)
          .toString(),
        iva_12_restante: new Big(credit.porcentaje_interes ?? 0)
          .times(new Big(credit.capital ?? 0).div(100))
          .times(0.12)
          .round(2)
          .toString(),
        seguro_restante: new Big(credit.seguro_10_cuotas ?? 0).toString(),
        gps_restante: new Big(credit.gps ?? 0).toString(),
        total_restante: new Big(credit.deudatotal ?? 0).toString(),
        membresias: new Big(credit.membresias_pago ?? 0).toString(),
        membresias_pago: new Big(credit.membresias_pago ?? 0).toString(),
        membresias_mes: new Big(credit.membresias_pago ?? 0).toString(),
        otros: "",
        mora: "0",
        monto_boleta_cuota: "0",
        seguro_total: new Big(credit.seguro_10_cuotas ?? 0).toString(),
        pagado: false,
        facturacion: "si",
        mes_pagado: "",
        seguro_facturado: new Big(credit.seguro_10_cuotas ?? 0).toString(),
        gps_facturado: new Big(credit.gps ?? 0).toString(),
        reserva: "0",
        observaciones: "",
        paymentFalse: false,
      }));

      await tx.insert(pagos_credito).values(pagosToInsert);
    } else if (newPlazo < oldPlazoNum) {
      // --- 3.b) Decrease plazo: remove extra unpaid quotas & their payments ---
      const extra = cuotasReal.filter((c) => Number(c.numero_cuota) > newPlazo);

      // Safety: if any of the "extra" are paid, abort
      const paidExtra = extra.filter((c) => c.pagado);
      if (paidExtra.length > 0) {
        throw new Error(
          "[ERROR] Cannot reduce plazo below a paid cuota. Please reverse or adjust paid cuotas first."
        );
      }

      const extraCuotaIds = extra.map((c) => c.cuota_id);
      if (extraCuotaIds.length > 0) {
        // delete related pagos first
        await tx
          .delete(pagos_credito)
          .where(inArray(pagos_credito.cuota_id, extraCuotaIds));
        // then delete cuotas
        await tx
          .delete(cuotas_credito)
          .where(inArray(cuotas_credito.cuota_id, extraCuotaIds));
      }
    }

    // --- 4) Persist credit row fields actually changed (only cuota/plazo) ---
    const updateSet: Record<string, any> = {};
    if (changedCuota) updateSet.cuota = new Big(newCuota).round(2).toString();
    if (changedPlazo) updateSet.plazo = Number(newPlazo);

    if (Object.keys(updateSet).length > 0) {
      await tx
        .update(creditos)
        .set(updateSet)
        .where(eq(creditos.credito_id, creditoId));
    }

    return { updated: true, changedCuota, changedPlazo };
  });
}
