import Big from "big.js";
import { db } from "../database";
import {
  creditos,
  usuarios,
  credit_cancelations,
  bad_debts,
  montos_adicionales,
  moras_credito,
} from "../database/db/schema";
import { eq, and } from "drizzle-orm";
import type { ClosureInfo, CuotaExcelRow, GetCreditDTO } from "../utils/interface";

export async function getCreditWithCancellationDetails(
  numero_credito_sifco: string
): Promise<{ success: true; data: GetCreditDTO } | { success: false; message: string }> {
  try {
    // 1) Crédito + usuario + cierres
    const [r] = await db
      .select({
        credit: {
          id: creditos.credito_id,
          numero_sifco: creditos.numero_credito_sifco,
          capital: creditos.capital,
          cuota_interes: creditos.cuota_interes,
          seguro_10_cuotas: creditos.seguro_10_cuotas,
          membresias_mes: creditos.membresias,
          iva: creditos.iva_12,
          gps: creditos.gps,
          status: creditos.statusCredit,
          tipo_credito: creditos.tipoCredito,
          observaciones: creditos.observaciones,
        },
        user: {
          name: usuarios.nombre,
        },
        cancelation: {
          id: credit_cancelations.id,
          motivo: credit_cancelations.motivo,
          observaciones: credit_cancelations.observaciones,
          fecha_cancelacion: credit_cancelations.fecha_cancelacion,
          monto_cancelacion: credit_cancelations.monto_cancelacion,
          traspaso: credit_cancelations.traspaso,
          garantia_mobiliaria: credit_cancelations.garantia_mobiliaria,
          otros: credit_cancelations.otros,
          cuotas_atrasadas: credit_cancelations.cuotas_atrasadas,
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
    if (r.cancelation?.id != null) {
      closure = {
        kind: "CANCELACION",
        id: r.cancelation.id,
        motivo: r.cancelation.motivo!,
        observaciones: r.cancelation.observaciones ?? null,
        fecha: r.cancelation.fecha_cancelacion ?? null,
        monto: r.cancelation.monto_cancelacion!,
        traspaso: r.cancelation.traspaso ?? "0",
        garantia_mobiliaria: r.cancelation.garantia_mobiliaria ?? "0",
        otros: r.cancelation.otros ?? "0",
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

    // 3) Mora activa
    const [moraActiva] = await db
      .select({ monto_mora: moras_credito.monto_mora })
      .from(moras_credito)
      .where(
        and(
          eq(moras_credito.credito_id, r.credit.id),
          eq(moras_credito.activa, true)
        )
      );

    // 4) Montos adicionales del crédito
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

    // 5) Generar filas unitarias basadas en cuotas_atrasadas guardado
    const n = r.cancelation?.cuotas_atrasadas ?? 0;

    const interes_unitario = new Big(r.credit.cuota_interes ?? "0").plus(new Big(r.credit.iva ?? "0"));
    const seguro_unitario = new Big(r.credit.seguro_10_cuotas ?? "0");
    const gps_unitario = new Big(r.credit.gps ?? "0");
    const membresias_unitario = new Big(r.credit.membresias_mes ?? "0");
    const mora_total = new Big(moraActiva?.monto_mora as unknown as string ?? "0");
    const servicios_unitario = seguro_unitario.plus(gps_unitario).plus(membresias_unitario);

    const items: CuotaExcelRow[] = Array.from({ length: n }, (_, i) => {
      const mora = i === 0 ? mora_total : new Big(0);
      const total = interes_unitario.plus(servicios_unitario).plus(mora);

      return {
        no: i + 1,
        mes: `${i + 1}`,
        interes: interes_unitario.toFixed(2),
        servicios: servicios_unitario.toFixed(2),
        mora: mora.toFixed(2),
        otros: "0.00",
        capital_pendiente: "0.00",
        total_cancelar: total.toFixed(2),
        fecha_vencimiento: "",
        seguro: seguro_unitario.toFixed(2),
        gps: gps_unitario.toFixed(2),
        membresias: membresias_unitario.toFixed(2),
      };
    });

    // 6) Totales
    const totalInteres = interes_unitario.times(n);
    const totalSeguro = seguro_unitario.times(n);
    const totalMembresias = membresias_unitario.times(n);
    const totalGps = gps_unitario.times(n);
    const totalServicios = servicios_unitario.times(n);
    const granTotal = totalInteres.plus(totalServicios).plus(mora_total);

    const totales = {
      total_interes: totalInteres.toFixed(2),
      total_seguro: totalSeguro.toFixed(2),
      total_membresias: totalMembresias.toFixed(2),
      total_mora: mora_total.toFixed(2),
      total_otros: "0.00",
      total_gps: totalGps.toFixed(2),
      total_cuotas_atrasadas: granTotal.toFixed(2),
      gran_total: granTotal.toFixed(2),
    };

    // 7) DTO final
    const saldo_total = new Big(r.credit.capital);
    const data: GetCreditDTO = {
      header: {
        usuario: r.user?.name ?? "—",
        numero_credito_sifco: r.credit.numero_sifco,
        moneda: "Quetzal",
        saldo_total: saldo_total.toFixed(2),
        extras_total: extras_total.toFixed(2),
        saldo_total_con_extras: saldo_total.plus(extras_total).toFixed(2),
        tipo_credito: r.credit.tipo_credito,
        observaciones: r.credit.observaciones ?? null,
      },
      closure,
      totales,
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
