import Big from "big.js";
import { db } from "../database";
import {
  creditos,
  usuarios,
  credit_cancelations,
  bad_debts,
  cuotas_credito,
  montos_adicionales, // 👈 importar
} from "../database/db/schema";
import { eq, and, lt, asc } from "drizzle-orm";

// Helpers
const todayStr = () => new Date().toISOString().slice(0, 10);
const monthShortEs = (d: string | Date) => {
  const months = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
  const dt = typeof d === "string" ? new Date(d) : d;
  return months[dt.getMonth()];
};

type ClosureInfo =
  | { kind: "CANCELACION"; id: number; motivo: string; observaciones: string | null; fecha: Date | string | null; monto: string }
  | { kind: "INCOBRABLE"; id: number; motivo: string; observaciones: string | null; fecha: Date | string | null; monto: string }
  | null;

type  CuotaExcelRow = {
  no: number;
  mes: string;
  interes: string;
  servicios: string;
  mora: string;
  otros: string;
  capital_pendiente: string;
  total_cancelar: string;
  fecha_vencimiento: string;
};

type GetCreditDTO = {
  header: {
    usuario: string;
    numero_credito_sifco: string;
    moneda: "Quetzal";
    tipo_credito: string;
    observaciones: string;
    saldo_total: string;
    // NUEVO:
    extras_total: string;
    saldo_total_con_extras: string;
  };
  closure: ClosureInfo;
  cuotas_atrasadas: {
    total: number;
    items: CuotaExcelRow[];
  };
  // NUEVO: listado de extras guardados
  extras: {
    total_items: number;
    items: Array<{
      id: number;
      concepto: string;
      monto: string;
      fecha_registro: Date | string | null;
    }>;
  };
};

export async function getCreditWithCancellationDetails(
  numero_credito_sifco: string
): Promise<{ success: true; data: GetCreditDTO } | { success: false; message: string }> {
  try {
    console.log(numero_credito_sifco)
    // 1) Crédito + usuario + cierres
    const [r] = await db
      .select({
        credit: {
          id: creditos.credito_id,
          numero_sifco: creditos.numero_credito_sifco,
          createdAt: creditos.fecha_creacion,
          status: creditos.statusCredit,
          term: creditos.plazo,

          deudatotal: creditos.deudatotal,
          capital: creditos.capital,
          cuota_interes: creditos.cuota_interes,
          seguro_10_cuotas: creditos.seguro_10_cuotas,
          membresias_pago: creditos.membresias_pago,
          mora: creditos.mora,
          otros: creditos.otros,
          tipo_credito: creditos.tipoCredito,
          observaciones: creditos.observaciones,
          gps: creditos.gps,
        },
        user: {
          id: usuarios.usuario_id,
          nit: usuarios.nit,
          name: usuarios.nombre,
        },
        cancelation: {
          id: credit_cancelations.id,
          motivo: credit_cancelations.motivo,
          observaciones: credit_cancelations.observaciones,
          fecha_cancelacion: credit_cancelations.fecha_cancelacion,
          monto_cancelacion: credit_cancelations.monto_cancelacion,
        },
        badDebt: {
          id: bad_debts.id,
          motivo: bad_debts.motivo,
          observaciones: bad_debts.observaciones,
          fecha_registro: bad_debts.fecha_registro,
          monto_incobrable: bad_debts.monto_incobrable,
        },
      })
      .from(creditos)
      .leftJoin(usuarios, eq(creditos.usuario_id, usuarios.usuario_id))
      .leftJoin(credit_cancelations, eq(creditos.credito_id, credit_cancelations.credit_id))
      .leftJoin(bad_debts, eq(creditos.credito_id, bad_debts.credit_id))
      .where(eq(creditos.numero_credito_sifco, numero_credito_sifco));

    if (!r) return { success: false, message: "Credit not found" };

    // 2) Closure unificado
    let closure: ClosureInfo = null;
    if (r.credit.status === "CANCELADO" && r.cancelation?.id != null) {
      closure = {
        kind: "CANCELACION",
        id: r.cancelation.id,
        motivo: r.cancelation.motivo!,
        observaciones: r.cancelation.observaciones ?? null,
        fecha: r.cancelation.fecha_cancelacion ?? null,
        monto: r.cancelation.monto_cancelacion!,
      };
    } else if (r.credit.status === "INCOBRABLE" && r.badDebt?.id != null) {
      closure = {
        kind: "INCOBRABLE",
        id: r.badDebt.id,
        motivo: r.badDebt.motivo!,
        observaciones: r.badDebt.observaciones ?? null,
        fecha: r.badDebt.fecha_registro ?? null,
        monto: r.badDebt.monto_incobrable!,
      };
    }

    // 3) Cuotas atrasadas
    const hoy = todayStr();
    const cuotasAtrasadas = await db
      .select({
        cuota_id: cuotas_credito.cuota_id,
        numero_cuota: cuotas_credito.numero_cuota,
        fecha_vencimiento: cuotas_credito.fecha_vencimiento,
      })
      .from(cuotas_credito)
      .where(
        and(
          eq(cuotas_credito.credito_id, r.credit.id),
          eq(cuotas_credito.pagado, false),
          lt(cuotas_credito.fecha_vencimiento, hoy)
        )
      )
      .orderBy(asc(cuotas_credito.numero_cuota));

    // 4) NUEVO: montos adicionales del crédito
    const extrasRows = await db
      .select({
        id: montos_adicionales.id,
        concepto: montos_adicionales.concepto,
        monto: montos_adicionales.monto,
        fecha_registro: montos_adicionales.fecha_registro,
      })
      .from(montos_adicionales)
      .where(eq(montos_adicionales.credit_id, r.credit.id));

    const extras_total = extrasRows.reduce(
      (acc, row) => acc.plus(row.monto as unknown as string),
      new Big(0)
    );

    // 5) Mapeo de cuotas atrasadas (sin prorratear extras)
    const items: CuotaExcelRow[] = cuotasAtrasadas.map((c) => {
      const fv =
        typeof c.fecha_vencimiento === "string"
          ? c.fecha_vencimiento
          : (c.fecha_vencimiento as Date).toISOString().slice(0, 10);

      const interes = new Big(r.credit.cuota_interes);
      const membresias = new Big(r.credit.membresias_pago);
      const mora = new Big(r.credit.mora ?? "0");
      const otros = new Big(r.credit.otros ?? "0");
      const gps = new Big(r.credit.gps ?? "0");
      const servicios = new Big(r.credit.seguro_10_cuotas).add(new Big(r.credit.membresias_pago)).add(new Big(r.credit.gps ?? "0"));

      const total_cancelar = interes.plus(servicios).plus(membresias).plus(mora).plus(otros);

      return {
        no: c.numero_cuota,
        mes: `${c.numero_cuota}-${monthShortEs(fv)}`,
        interes: interes.toFixed(2),
        servicios: servicios.toFixed(2),
        mora: mora.toFixed(2),
        otros: otros.toFixed(2),
        capital_pendiente: new Big(r.credit.capital).toFixed(2),
        total_cancelar: total_cancelar.toFixed(2),
        fecha_vencimiento: fv,
        gps: gps.toFixed(2),
      };
    });

    // 6) DTO final con extras
    const saldo_total = new Big(r.credit.deudatotal);
    const data: GetCreditDTO = {
      header: {
        usuario: r.user?.name ?? "—",
        numero_credito_sifco: r.credit.numero_sifco,
        moneda: "Quetzal",
        tipo_credito: r.credit.tipo_credito,
        observaciones: r.credit.observaciones,
        saldo_total: saldo_total.toFixed(2),
        // NUEVO:
        extras_total: extras_total.toFixed(2),
        saldo_total_con_extras: saldo_total.plus(extras_total).toFixed(2),
      },
      closure,
      cuotas_atrasadas: {
        total: items.length,
        items,
      },
      extras: {
        total_items: extrasRows.length,
        items: extrasRows.map((e) => ({
          id: e.id,
          concepto: e.concepto,
          monto: new Big(e.monto as unknown as string).toFixed(2),
          fecha_registro:
            typeof e.fecha_registro === "string"
              ? e.fecha_registro
              : e.fecha_registro ?? null,
        })),
      },
    };

    return { success: true, data };
  } catch (error) {
    console.error("[ERROR] getCreditWithCancellationDetails:", error);
    return { success: false, message: "Error retrieving credit information" };
  }
}







