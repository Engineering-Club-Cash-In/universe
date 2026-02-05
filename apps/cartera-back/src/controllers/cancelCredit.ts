import Big from "big.js";
import { db } from "../database";
import {
  creditos,
  usuarios,
  credit_cancelations,
  bad_debts,
  cuotas_credito,
  montos_adicionales,
  moras_credito,
  pagos_credito, // 👈 importar
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
  | { kind: "CANCELACION"; id: number; motivo: string; observaciones: string | null; fecha: Date | string | null; monto: string; traspaso: string; garantia_mobiliaria: string; otros: string }
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
  seguro: string;
  membresias: string;
};

type GetCreditDTO = {
  header: {
    usuario: string;
    numero_credito_sifco: string;
    moneda: "Quetzal";
    saldo_total: string;
    // NUEVO:
    extras_total: string;
    restantes_cuota_actual: string;
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
          membresias_mes: creditos.membresias,
          iva: creditos.iva_12,
      
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
          traspaso: credit_cancelations.traspaso,
          garantia_mobiliaria: credit_cancelations.garantia_mobiliaria,
          otros: credit_cancelations.otros,
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

    // 3) Cuotas atrasadas
        const hoy = new Date();
    const cuotasAtrasadas = await db
      .select({
        cuota_id: cuotas_credito.cuota_id,
        credito_id: cuotas_credito.credito_id,
        numero_cuota: cuotas_credito.numero_cuota,
        fecha_vencimiento: cuotas_credito.fecha_vencimiento,
        pagado: cuotas_credito.pagado,
        createdAt: cuotas_credito.createdAt,
        validationStatus: pagos_credito.validationStatus,
      })
      .from(cuotas_credito)
      .innerJoin(pagos_credito, eq(pagos_credito.cuota_id, cuotas_credito.cuota_id))
      .where(
        and(
          eq(cuotas_credito.credito_id, r.credit.id),
          eq(cuotas_credito.pagado, false),
          lt(cuotas_credito.fecha_vencimiento, hoy.toISOString().slice(0, 10))
        )
      )
      .orderBy(asc(cuotas_credito.numero_cuota));

    // 4) Cuota actual: restantes de lo ya abonado
    const cuotaActualResult = await db
      .select({
        cuota_id: cuotas_credito.cuota_id,
        numero_cuota: cuotas_credito.numero_cuota,
        fecha_vencimiento: cuotas_credito.fecha_vencimiento,
        pagado: cuotas_credito.pagado,
        // Restantes
        capital_restante: pagos_credito.capital_restante,
        interes_restante: pagos_credito.interes_restante,
        iva_12_restante: pagos_credito.iva_12_restante,
        seguro_restante: pagos_credito.seguro_restante,
        gps_restante: pagos_credito.gps_restante,
        membresias_restante: pagos_credito.membresias,
        pago_mora: pagos_credito.mora,
        pago_otros: pagos_credito.otros,
      })
      .from(cuotas_credito)
      .innerJoin(pagos_credito, eq(pagos_credito.cuota_id, cuotas_credito.cuota_id))
      .where(
        and(
          eq(cuotas_credito.credito_id, r.credit.id),
          eq(cuotas_credito.pagado, false),
          // cuota actual = fecha_vencimiento >= hoy (la próxima que no ha vencido)
          // pero distinta a las atrasadas
        )
      )
      .orderBy(asc(cuotas_credito.fecha_vencimiento))
      .limit(1);

    // Calcular seguro proporcional según fecha de cancelación
    const fechaCancelacion = r.cancelation?.fecha_cancelacion
      ? new Date(r.cancelation.fecha_cancelacion as unknown as string)
      : hoy;
    const diaDelMes = fechaCancelacion.getDate();
    const diasEnMes = new Date(fechaCancelacion.getFullYear(), fechaCancelacion.getMonth() + 1, 0).getDate();
    const proporcionSeguro = new Big(diaDelMes).div(diasEnMes);
    const seguroMensual = new Big(r.credit.seguro_10_cuotas ?? "0");
    const seguroProporcional = seguroMensual.times(proporcionSeguro).round(2);

    // Sumar restantes de la cuota actual
    let restantesCuotaActual = {
      interes_restante: new Big(0),
      iva_12_restante: new Big(0),
      seguro_restante: new Big(0),
      gps_restante: new Big(0),
      membresias_restante: new Big(0),
      mora_restante: new Big(0),
      otros_restante: new Big(0),
      total_restante: new Big(0),
    };

    if (cuotaActualResult.length > 0) {
      const ca = cuotaActualResult[0];
      const safeBig = (v: unknown) => new Big(String(v ?? "0") || "0");
      restantesCuotaActual.interes_restante = safeBig(ca.interes_restante);
      restantesCuotaActual.iva_12_restante = safeBig(ca.iva_12_restante);
      restantesCuotaActual.gps_restante = safeBig(ca.gps_restante);
      restantesCuotaActual.membresias_restante = safeBig(ca.membresias_restante);
      restantesCuotaActual.mora_restante = safeBig(ca.pago_mora);
      restantesCuotaActual.otros_restante = safeBig(ca.pago_otros);
      // Seguro proporcional en vez del restante completo
      restantesCuotaActual.seguro_restante = seguroProporcional;

      restantesCuotaActual.total_restante = restantesCuotaActual.interes_restante
        .plus(restantesCuotaActual.iva_12_restante)
        .plus(restantesCuotaActual.seguro_restante)
        .plus(restantesCuotaActual.gps_restante)
        .plus(restantesCuotaActual.membresias_restante)
        .plus(restantesCuotaActual.mora_restante)
        .plus(restantesCuotaActual.otros_restante);
    }

    // 5) NUEVO: montos adicionales del crédito
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
    const itemsPromises = cuotasAtrasadas.map(async (c) => {
      const fv =
        typeof c.fecha_vencimiento === "string"
          ? c.fecha_vencimiento
          : (c.fecha_vencimiento as Date).toISOString().slice(0, 10);
       
      const interes = new Big(r.credit.cuota_interes).plus(r.credit.iva);
      const membresias = new Big(r.credit.membresias_mes);
      const seguro = new Big(r.credit.seguro_10_cuotas);
      const otros = new Big(r.credit.otros ?? "0");
      const gps = new Big(r.credit.gps ?? "0");
      const servicios = new Big(r.credit.seguro_10_cuotas).add(new Big(r.credit.membresias_mes)).add(new Big(r.credit.gps ?? "0"));
      const moraResult = await db.select({monto: moras_credito.monto_mora}).from(moras_credito).where(eq(moras_credito.credito_id, r.credit.id));
      const mora = moraResult.length > 0 ? new Big(moraResult[0].monto as unknown as string) : new Big(0);
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
        seguro: seguro.toFixed(2),
        membresias: membresias.toFixed(2),
      };
    });
    
    const items: CuotaExcelRow[] = await Promise.all(itemsPromises);

    // Agregar cuota actual como fila en la tabla (si existe)
    if (cuotaActualResult.length > 0) {
      const ca = cuotaActualResult[0];
      const seguroEntero = seguroMensual; // seguro mensual completo para el cliente
      const interesCA = restantesCuotaActual.interes_restante.plus(restantesCuotaActual.iva_12_restante);
      const serviciosCA = seguroEntero.plus(restantesCuotaActual.gps_restante).plus(restantesCuotaActual.membresias_restante);
      const moraCA = restantesCuotaActual.mora_restante;
      const totalCA = interesCA.plus(serviciosCA).plus(moraCA);

      const fvCA = typeof ca.fecha_vencimiento === "string"
        ? ca.fecha_vencimiento
        : (ca.fecha_vencimiento as Date).toISOString().slice(0, 10);

      items.push({
        no: ca.numero_cuota,
        mes: `${ca.numero_cuota}-${monthShortEs(fvCA)} (actual)`,
        interes: interesCA.toFixed(2),
        servicios: serviciosCA.toFixed(2),
        mora: moraCA.toFixed(2),
        otros: "0.00",
        capital_pendiente: "0.00",
        total_cancelar: totalCA.toFixed(2),
        fecha_vencimiento: fvCA,
        seguro: seguroEntero.toFixed(2),
        membresias: restantesCuotaActual.membresias_restante.toFixed(2),
      });
    }

    // Sumatoria de cuotas atrasadas por concepto
    const sumAtrasadas = items.reduce(
      (acc, item) => {
        acc.interes = acc.interes.plus(item.interes);
        acc.seguro = acc.seguro.plus(item.seguro);
        acc.membresias = acc.membresias.plus(item.membresias);
        acc.mora = acc.mora.plus(item.mora);
        acc.otros = acc.otros.plus(item.otros);
        acc.servicios = acc.servicios.plus(item.servicios);
        acc.total = acc.total.plus(item.total_cancelar);
        return acc;
      },
      {
        interes: new Big(0),
        seguro: new Big(0),
        membresias: new Big(0),
        mora: new Big(0),
        otros: new Big(0),
        servicios: new Big(0),
        total: new Big(0),
      }
    );

    // Totales generales = cuotas atrasadas + restantes cuota actual
    const totales = {
      total_interes: sumAtrasadas.interes.plus(restantesCuotaActual.interes_restante).plus(restantesCuotaActual.iva_12_restante).toFixed(2),
      total_seguro: sumAtrasadas.seguro.plus(restantesCuotaActual.seguro_restante).toFixed(2),
      total_membresias: sumAtrasadas.membresias.plus(restantesCuotaActual.membresias_restante).toFixed(2),
      total_mora: sumAtrasadas.mora.plus(restantesCuotaActual.mora_restante).toFixed(2),
      total_otros: sumAtrasadas.otros.plus(restantesCuotaActual.otros_restante).toFixed(2),
      total_gps: new Big(0).plus(restantesCuotaActual.gps_restante).toFixed(2),
      total_cuotas_atrasadas: sumAtrasadas.total.toFixed(2),
      total_restantes_cuota_actual: restantesCuotaActual.total_restante.toFixed(2),
      gran_total: sumAtrasadas.total.plus(restantesCuotaActual.total_restante).toFixed(2),
    };

    // 6) DTO final con extras
    const saldo_total = new Big(r.credit.capital);
    const data: GetCreditDTO = {
      header: {
        usuario: r.user?.name ?? "—",
        numero_credito_sifco: r.credit.numero_sifco,
        moneda: "Quetzal",
        saldo_total: saldo_total.toFixed(2),
        // NUEVO:
        extras_total: extras_total.toFixed(2),
        restantes_cuota_actual: restantesCuotaActual.total_restante.toFixed(2),
        saldo_total_con_extras: saldo_total.plus(extras_total).plus(restantesCuotaActual.total_restante).toFixed(2),
      },
      closure,
      cuota_actual: cuotaActualResult.length > 0 ? {
        cuota_id: cuotaActualResult[0].cuota_id,
        numero_cuota: cuotaActualResult[0].numero_cuota,
        fecha_vencimiento: cuotaActualResult[0].fecha_vencimiento,
        interes_restante: restantesCuotaActual.interes_restante.toFixed(2),
        iva_12_restante: restantesCuotaActual.iva_12_restante.toFixed(2),
        seguro_proporcional: restantesCuotaActual.seguro_restante.toFixed(2),
        gps_restante: restantesCuotaActual.gps_restante.toFixed(2),
        membresias_restante: restantesCuotaActual.membresias_restante.toFixed(2),
        mora_restante: restantesCuotaActual.mora_restante.toFixed(2),
        otros_restante: restantesCuotaActual.otros_restante.toFixed(2),
        total_restante: restantesCuotaActual.total_restante.toFixed(2),
        seguro_info: {
          dia_cancelacion: diaDelMes,
          dias_en_mes: diasEnMes,
          proporcion: proporcionSeguro.toFixed(4),
          seguro_mensual: seguroMensual.toFixed(2),
          seguro_proporcional: seguroProporcional.toFixed(2),
        },
      } : null,
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
    console.log("data.", data.cuotas_atrasadas)
    return { success: true, data };
  } catch (error) {
    console.error("[ERROR] getCreditWithCancellationDetails:", error);
    return { success: false, message: "Error retrieving credit information" };
  }
}







