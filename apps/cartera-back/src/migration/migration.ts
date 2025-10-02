import Big from "big.js";
import { ExcelCreditoRow, leerCreditoPorNumeroSIFCO, listarCreditosAgrupados } from "../services/excel";
import {
  ClienteEmail,
  EstadoCuentaDetalle,
  EstadoCuentaTransaccion,
  PrestamoDetalle,
  WSCrEstadoCuentaResponse,
  WSInformacionPrestamoResponse,
  WSRecargosLibresResponse,
} from "../services/sifco.interface";
import {
  consultarClientesPorEmail,
  consultarEstadoCuentaPrestamo,
  consultarInformacionPrestamo,
  consultarPrestamoDetalle,
  consultarPrestamosPorCliente,
  consultarRecargosLibres,
} from "../services/sifcoIntegrations";
import path from "path";
import { findOrCreateUserByName } from "../controllers/users";
import { findOrCreateAdvisorByName } from "../controllers/advisor";
import { db } from "../database";
import {
  creditos,
  creditos_inversionistas,
  cuotas_credito,
  pagos_credito,
} from "../database/db";
import { findOrCreateInvestor } from "../controllers/investor";
import { map } from "zod";
import { and, eq, inArray, sql } from "drizzle-orm";
import { toBigExcel } from "../utils/functions/generalFunctions";

const excelPath = path.resolve(
  "C:/Users/Kelvin Palacios/Documents/analis de datos/noviembre2025.csv"
);



export async function mapPrestamoDetalleToCredito(
  prestamo: PrestamoDetalle,
  excelRows: ExcelCreditoRow[] | undefined,
  cliente: ClienteEmail
) {
  if (!excelRows || excelRows.length === 0) {
    throw new Error("❌ No se encontraron filas en excelRows");
  }

  // ---- Tomamos siempre la primera fila ----
  const excelRow = excelRows[0];
  // ---- Cálculos base ----
  const capital = toBigExcel(prestamo.PreSalCapital, "0");
  const porcentaje_interes = toBigExcel(excelRow?.porcentaje, "0.015");
  const gps = toBigExcel(excelRow?.GPS, 0);
  const seguro_10_cuotas = toBigExcel(excelRow?.Seguro10Cuotas, 0);
  const membresias_pago = toBigExcel(excelRow?.MembresiasPago, 0);

  const cuota_interes = capital.times(porcentaje_interes).round(2);
  const iva_12 = cuota_interes.times(0.12).round(2);

  const deudatotal = capital
    .plus(cuota_interes)
    .plus(iva_12)
    .plus(seguro_10_cuotas)
    .plus(gps)
    .plus(membresias_pago)
    .round(2, 0); // Using rounding mode 0 (round down/floor)

  // ---- Relaciones (IDs reales) ----
  const user = await findOrCreateUserByName(
    cliente.NombreCompleto,
    excelRow?.Categoria ?? null,
    excelRow?.NIT ?? null,
    excelRow?.ComoSeEntero ?? null
  );
  
  // Calculate cuotaCredito by summing all cuotas from Excel rows
  const cuotaCredito = excelRows 
    ? excelRows.reduce((acc, row) => acc + Number(row.Cuota || 0), 0)
    : 0;
    
  const advisor = await findOrCreateAdvisorByName(excelRow?.Asesor || "", true);

  const realPorcentaje = porcentaje_interes.mul(100).toFixed(2);

  // ---- Retornar EXACTAMENTE el shape que inserta creditDataForInsert ----
  const creditInsert = {
    usuario_id: Number(user.usuario_id ?? 0),

    otros: toBigExcel(excelRow?.Otros, "0").toString(),
    numero_credito_sifco: prestamo.PreNumero,

    capital: capital.toFixed(2),
    porcentaje_interes: realPorcentaje.toString(),
    cuota_interes: cuota_interes.toFixed(2),
    cuota: cuotaCredito.toString(),
    deudatotal: deudatotal.toFixed(2),
    seguro_10_cuotas: seguro_10_cuotas.toFixed(2),
    gps: gps.toFixed(2),

    observaciones: prestamo.PreComentario || excelRow?.Observaciones || "0",
    no_poliza: prestamo.PreReferencia || "",
    como_se_entero: excelRow?.ComoSeEntero ?? "",
    asesor_id: advisor.asesor_id,

    plazo: Number(
      toBigExcel(prestamo.PrePlazo ?? excelRow?.Plazo ?? 0, "0").toString()
    ),

    iva_12: iva_12.toFixed(2),

    membresias_pago: membresias_pago.toFixed(2),
    membresias: membresias_pago.toFixed(2),

    formato_credito:
      excelRows.length > 1
        ? "Pool"
        : ((excelRow?.FormatoCredito as "Pool" | "Individual") ?? "Individual"),

    porcentaje_royalti: toBigExcel(excelRow?.PorcentajeRoyalty, "0").toString(),
    royalti: toBigExcel(excelRow?.Royalty, "0").toString(),

    tipoCredito: "Nuevo",
    mora: "0",
  };

  try {
    // Insert credit and get the ID
  const [row] = await db
    .insert(creditos)
    .values(creditInsert)
    .onConflictDoUpdate({
      target: creditos.numero_credito_sifco, // o un índice único compuesto
      set: creditInsert, // actualiza usando el MISMO shape que insertás
    })
    .returning();

    const creditoId = row.credito_id;
    console.log(`✅ Crédito insertado con ID: ${creditoId}`);
    const inversionistas = await mapInversionistas(excelRows);
    const creditosInversionistasData = inversionistas.map((inv: any) => {
      const montoAportado = new Big(inv.monto_aportado);
      const porcentajeCashIn = new Big(inv.porcentaje_cash_in); // Ej: 30
      const porcentajeInversion = new Big(inv.porcentaje_inversion); // Ej: 70
      const interes = new Big(realPorcentaje ?? 0);
      const newCuotaInteres = new Big(montoAportado ?? 0).times(
        interes.div(100)
      );
      // Montos proporcionales
      const montoInversionista = newCuotaInteres
        .times(porcentajeInversion)
        .div(100)
        .toFixed(2);
      const montoCashIn = newCuotaInteres
        .times(porcentajeCashIn)
        .div(100)
        .toFixed(2);
      // IVA respectivos
      const ivaInversionista =
        Number(montoInversionista) > 0
          ? new Big(montoInversionista).times(0.12)
          : new Big(0);
      const ivaCashIn =
        Number(montoCashIn) > 0 ? new Big(montoCashIn).times(0.12) : new Big(0);
      const cuotaInv =
        inv.cuota_inversionista === 0
          ? excelRow?.Cuota.toString()
          : inv.cuota_inversionista.toString();
      return {
        credito_id: creditoId,
        inversionista_id: inv.inversionista_id,
        monto_aportado: montoAportado.toString(),
        porcentaje_cash_in: porcentajeCashIn.toString(),
        porcentaje_participacion_inversionista: porcentajeInversion.toString(),
        monto_inversionista: montoInversionista.toString(),
        monto_cash_in: montoCashIn.toString(),
        iva_inversionista: ivaInversionista.toString(),
        iva_cash_in: ivaCashIn.toString(),
        fecha_creacion: new Date(),
        cuota_inversionista: cuotaInv.toString(),
      };
    });
    let total_monto_cash_in = new Big(0);
    let total_iva_cash_in = new Big(0);

    creditosInversionistasData.forEach(({ monto_cash_in, iva_cash_in }) => {
      total_monto_cash_in = total_monto_cash_in.plus(monto_cash_in);
      total_iva_cash_in = total_iva_cash_in.plus(iva_cash_in);
    }); // <-- Add this closing parenthesis and semicolon

    if (creditosInversionistasData.length > 0) {
  // 1️⃣ Eliminar cuotas viejas del crédito
  await db
    .delete(creditos_inversionistas)
    .where(eq(creditos_inversionistas.credito_id, creditoId));

  // 2️⃣ Insertar las nuevas cuotas
  await db
    .insert(creditos_inversionistas)
    .values(creditosInversionistasData);
}
    return row;
  } catch (error) {
    console.error("❌ Error al insertar crédito en la base de datos:", error);
    throw error;
  }
}
/**
 * Flujo de sincronización de clientes con préstamos desde SIFCO + Excel
 * @param clienteCodigoFilter - (opcional) Código específico del cliente para filtrar
 */
export async function syncClienteConPrestamos(clienteCodigoFilter?: number) {
  try {
    console.log(
      "🚀 Iniciando flujo de sincronización de clientes con préstamos desde SIFCO"
    );

    // 📊 Control de métricas
    const stats = {
      totalClientes: 0,
      totalPrestamos: 0,
      creditosMigrados: 0,
      creditosFallidos: 0,
      errores: [] as { prestamo: string; motivo: string }[],
    };

    // 1️⃣ Consultar clientes (SIFCO)
    const clientes = await consultarClientesPorEmail();
    console.log(
      "👥 Clientes obtenidos de SIFCO:",
      clientes?.Clientes?.length || 0
    );

    if (!clientes?.Clientes?.length) {
      console.log("❌ No se encontraron clientes en SIFCO");
      return stats;
    }

    // Filtrado
    const listaClientes = clienteCodigoFilter
      ? clientes.Clientes.filter(
          (c) => parseInt(c.CodigoCliente, 10) === clienteCodigoFilter
        )
      : clientes.Clientes.filter((c) => parseInt(c.CodigoCliente, 10) >= 1140);

    if (listaClientes.length === 0) {
      console.log(`❌ Cliente con código ${clienteCodigoFilter} no encontrado`);
      return stats;
    }

    stats.totalClientes = listaClientes.length;

    // 🔁 Recorrer clientes
    for (const cliente of listaClientes) {
      console.log("👤 Cliente seleccionado:", cliente.NombreCompleto);
      const clienteCodigo = parseInt(cliente.CodigoCliente, 10);

      let prestamosResp;
      try {
        prestamosResp = await consultarPrestamosPorCliente(clienteCodigo);
      } catch (err: any) {
        console.log(
          `❌ No se pudieron obtener préstamos para ${cliente.NombreCompleto}:`,
          err?.message || err
        );
        continue;
      }

      if (!prestamosResp?.Prestamos?.length) {
        console.log(
          `❌ El cliente ${cliente.NombreCompleto} no tiene préstamos en SIFCO`
        );
        continue;
      }

      console.log("💳 Préstamos encontrados:", prestamosResp.Prestamos.length);
      stats.totalPrestamos += prestamosResp.Prestamos.length;

      // 3️⃣ Iterar sobre cada préstamo
      for (const prestamo of prestamosResp.Prestamos) {
        const preNumero = prestamo.NumeroPrestamo;
        console.log(`📑 Consultando detalle del préstamo: ${preNumero}`);

        try {
          const detalle = await consultarPrestamoDetalle(preNumero);

          if (!detalle) {
            throw new Error("Detalle vacío");
          }
          if (detalle.ApEstDes === "CANCELADO") {
            throw new Error("Préstamo cancelado");
          }

          const excelRow = await leerCreditoPorNumeroSIFCO(
            excelPath,
            preNumero
          );
     

          const recargosLibres = await consultarRecargosLibres(preNumero);
          if (!recargosLibres) {
            throw new Error("Recargos libres no disponibles");
          }

          const combinado = await mapPrestamoDetalleToCredito(
            detalle,
            excelRow as ExcelCreditoRow[],
            cliente
          );

          if (!combinado?.credito_id) {
            throw new Error("Mapeo a DB fallido");
          }

          console.log(
            "💾 Crédito insertado en DB con ID:",
            combinado.credito_id
          );
          stats.creditosMigrados++;
        } catch (err: any) {
          console.log(
            `❌ Error procesando préstamo ${preNumero}:`,
            err?.message || err
          );
          stats.creditosFallidos++;
          stats.errores.push({
            prestamo: preNumero,
            motivo: err?.message || "Error desconocido",
          });
          continue;
        }
      }
    }

    // 📊 Resumen global
    console.log("📊 Resumen de sincronización:");
    console.log(`   Clientes procesados: ${stats.totalClientes}`);
    console.log(`   Préstamos encontrados: ${stats.totalPrestamos}`);
    console.log(`   Créditos migrados: ✅ ${stats.creditosMigrados}`);
    console.log(`   Créditos fallidos: ❌ ${stats.creditosFallidos}`);

    if (stats.errores.length > 0) {
      console.log("📝 Detalles de errores:");
      stats.errores.forEach((e) =>
        console.log(`   - Préstamo ${e.prestamo}: ${e.motivo}`)
      );
    }

    return stats;
  } catch (err: any) {
    console.error("❌ Error en syncClienteConPrestamos:", err?.message || err);
    throw err;
  }
}

// 👇 función que procesa inversionistas y agrega el id desde BD
export async function mapInversionistas(excelRows: ExcelCreditoRow[]) {
  const inversionistasMapped = [];

  for (const row of excelRows) {
    // nombre del inversionista del Excel
    const nombre = row?.Inversionista ?? "Desconocido";

    // 👇 llamar al método para buscar o crear inversionista
    const investor = await findOrCreateInvestor(nombre, true);

    inversionistasMapped.push({
      inversionista_id: investor.inversionista_id, // 👈 ahora tienes el id real
      inversionista: investor.nombre,
      monto_aportado: Number(toBigExcel(row?.Capital, "0").toString()),
      porcentaje_cash_in: Number(
        toBigExcel(row?.PorcentajeCashIn, "0").mul(100).toString()
      ),
      porcentaje_inversion: Number(
        toBigExcel(row?.PorcentajeInversionista, "0").mul(100).toString()
      ),
      cuota_inversionista: Number(toBigExcel(row?.Cuota, "0").toString()),
    });
  }

  return inversionistasMapped;
}

/** ---------- Helpers ---------- */
const toBig = (v: string | number | null | undefined): Big => {
  if (v == null) return new Big(0);
  if (typeof v === "number") return Big(Number.isFinite(v) ? v : 0);
  const cleaned = String(v).replace(/[Qq,\s,]/g, "");
  const n = Number(cleaned);
  return Big(Number.isFinite(n) ? n : 0);
};
const to2 = (b: Big) => b.round(2, Big.roundHalfUp).toFixed(2);

/** Lee cargos fijos del crédito */
async function getFixedChargesByCreditoId(creditoId: number): Promise<{
  seguro: Big;
  membresia: Big;
}> {
  const [row] = await db
    .select({
      seguro_10_cuotas: creditos.seguro_10_cuotas,
      membresias_mes: creditos.membresias,
      membresias_pago: creditos.membresias_pago,
    })
    .from(creditos)
    .where(eq(creditos.credito_id, creditoId))
    .limit(1);

  const seguro = toBig(row?.seguro_10_cuotas);
  const membresia = toBig(row?.membresias_mes ?? row?.membresias_pago ?? 0);

  return { seguro, membresia };
}

export interface OtroCargo {
  /* si lo necesitas luego */
}

/** ---------- Mapper con la regla nueva ---------- */
export async function mapEstadoCuentaToPagosBig(
  resp: WSCrEstadoCuentaResponse,
  creditoId: number
) {
  console.log(
    "▶️ Iniciando mapEstadoCuentaToPagosBig para crédito:",
    creditoId
  );

  const credito = await db.query.creditos.findFirst({
    where: eq(creditos.credito_id, creditoId),
    columns: {
      seguro_10_cuotas: true,
      membresias: true,
      cuota: true,
      cuota_interes: true,
      iva_12: true,
      capital: true,
      deudatotal: true,
      porcentaje_interes: true,
      gps: true,
    },
  });
  console.log("✅ Crédito encontrado:", credito);

  const cuotas = resp?.ConsultaResultado?.PlanPagos_Cuotas ?? [];
  const transacciones =
    resp?.ConsultaResultado?.EstadoCuenta_Transacciones ?? [];
  const primeraTransaccion: EstadoCuentaTransaccion | undefined =
    resp?.ConsultaResultado.EstadoCuenta_Transacciones?.[0];

  console.log(
    `📊 Respuesta: cuotas=${cuotas.length}, transacciones=${transacciones.length}`
  );

  if (primeraTransaccion) {
    console.log("🔍 Primera transacción encontrada:", primeraTransaccion);

    const detalleRoyalty = primeraTransaccion.EstadoCuenta_Detalles.find(
      (d) => d.ApSalDes === "ROYALTY"
    );
    console.log("🔍 Detalle ROYALTY:", detalleRoyalty);

    const royaltiValor = toBig(detalleRoyalty?.CrMoDeValor ?? 0);
    console.log("💰 Valor de royalty:", royaltiValor.toString());
    // 🧹 Primero limpiamos la cuota 0 de ese crédito

    await db
      .delete(pagos_credito)
      .where(
        inArray(
          pagos_credito.cuota_id,
          db
            .select({ id: cuotas_credito.cuota_id })
            .from(cuotas_credito)
            .where(eq(cuotas_credito.credito_id, creditoId))
        )
      );

    await db
      .delete(cuotas_credito)
      .where(eq(cuotas_credito.credito_id, creditoId));

    console.log(`🧹 Eliminadas cuotas previas #0 para crédito_id=${creditoId}`);

    // ➕ Luego insertamos la nueva cuota 0
    const cuota0 = await db
      .insert(cuotas_credito)
      .values({
        credito_id: creditoId,
        numero_cuota: 0,
        fecha_vencimiento: new Date(primeraTransaccion.CrMoFeVal).toISOString(),
        pagado: true,
      })
      .returning();

    console.log("✅ Insertada cuota 0:", cuota0);

    const reserva = new Big(credito?.seguro_10_cuotas ?? "0").plus(600);
    console.log("📦 Reserva calculada:", reserva.toString());
    const capital = toBigExcel(primeraTransaccion.CapitalDesembolsado, "0");
    const porcentaje_interes = toBigExcel(credito?.porcentaje_interes, "1.5").div(100);
    const gps = toBigExcel(credito?.gps, 0);
    const seguro_10_cuotas = toBigExcel(credito?.seguro_10_cuotas, 0);
    const membresias_pago = toBigExcel(credito?.membresias, 0);

    const cuota_interes = capital.times(porcentaje_interes).round(2);
    const iva_12 = cuota_interes.times(0.12).round(2);

    const deudatotal = capital
      .plus(cuota_interes)
      .plus(iva_12)
      .plus(seguro_10_cuotas)
      .plus(gps)
      .plus(membresias_pago)
      .round(2, 0); // Using rounding mode 0 (round down/floor)
    const pago0 = {
      credito_id: creditoId,
      cuota: credito?.cuota?.toString() ?? "0.00",
      cuota_interes: cuota_interes?.toString() ?? "0.00",
      cuota_id: cuota0[0]?.cuota_id ?? null,
      fecha_pago: new Date(primeraTransaccion.CrMoFeTrx).toISOString(),
      abono_capital: "0.00",
      abono_interes: cuota_interes.toString() ?? "0.00",
      abono_iva_12: iva_12.toString() ?? "0.00",
      abono_interes_ci: "0.00",
      abono_iva_ci: "0.00",
      abono_seguro: credito?.seguro_10_cuotas?.toString() ?? "0.00",
      abono_gps: "0.00",
      pago_del_mes: "0.00",
      llamada: "pago 0",
      monto_boleta: "0.00",
      fecha_filtro: new Date(primeraTransaccion.CrMoFeTrx).toISOString(),
      renuevo_o_nuevo: "",
      capital_restante: capital?.toString() ?? "0.00",
      interes_restante: "0.00",
      iva_12_restante: "0.00",
      seguro_restante: "0.00",
      gps_restante: "0.00",
      total_restante: deudatotal.toString(),
      membresias: credito?.membresias?.toString() ?? "0.00",
      membresias_pago: credito?.membresias?.toString() ?? "0.00",
      membresias_mes: credito?.membresias?.toString() ?? "0.00",
      otros: "",
      mora: "0.00",
      monto_boleta_cuota: "0.00",
      seguro_total: credito?.seguro_10_cuotas?.toString() ?? "0.00",
      pagado: true,
      facturacion: "si",
      mes_pagado: "",
      seguro_facturado: credito?.seguro_10_cuotas?.toString() ?? "0.00",
      gps_facturado: "0.00",
      reserva: reserva.toFixed(2),
      observaciones: "pago inicial",
      paymentFalse: false,
    };

    await db.insert(pagos_credito).values(pago0).onConflictDoNothing();
    console.log("✅ Insertado pago 0");

    if (royaltiValor.gt(0)) {
      await db
        .update(creditos)
        .set({ royalti: royaltiValor.toString() })
        .where(eq(creditos.credito_id, creditoId));
      console.log(
        "✅ Crédito actualizado con royalty:",
        royaltiValor.toString()
      );
    }
  }

  console.log("▶️ Procesando cuotas...");
  const promiseResults = await Promise.all(
    cuotas.map(async (c, idx) => {
      console.log(`➡️ Cuota ${idx + 1} de ${cuotas.length}`, c);

      const cuotadB = await db
        .insert(cuotas_credito)
        .values({
          credito_id: creditoId,
          numero_cuota: Number(
            c.CapitalNumeroCuota ?? c.InteresNumeroCuota ?? 0
          ),
          fecha_vencimiento: new Date(c.Fecha).toISOString(),
          pagado: c.CapitalPagado === "S" && c.InteresPagado === "S",
        })
        .returning();
      console.log("✅ Insertada cuota en DB:", cuotadB);

      // Capital
      const abonoCapital = toBig(c.CapitalAbonado);
      console.log("💵 Abono capital:", abonoCapital.toString());

      // Interés
      const interesAbonadoTotal = toBig(c.InteresAbonado);
      console.log("💵 Interés abonado total:", interesAbonadoTotal.toString());

      const base = interesAbonadoTotal.div(1.12);
      const abonoInteres = base.round(2, Big.roundHalfUp);
      const abonoIva12 = interesAbonadoTotal
        .minus(abonoInteres)
        .round(2, Big.roundHalfUp);

      console.log(
        "💵 Abono interés sin IVA:",
        abonoInteres.toString(),
        " IVA:",
        abonoIva12.toString()
      );

      const moraCapPag = toBig(c.CapitalMoraValorPagado);
      const moraIntPag = toBig(c.InteresMoraValorPagado);
      const moraTotal = moraCapPag.plus(moraIntPag);
      console.log("💵 Mora total:", moraTotal.toString());

      const seguroDb = toBig(credito?.seguro_10_cuotas ?? 0);
      const membresiaDb = toBig(credito?.membresias ?? 0);

      const otrosMonto = toBig(c.OtrosMonto);
      console.log("💵 Otros monto:", otrosMonto.toString());

      let abonoSeguro = new Big(0);
      if (otrosMonto.eq(seguroDb.plus(membresiaDb))) {
        abonoSeguro = seguroDb;
      }
      console.log("💵 Abono seguro:", abonoSeguro.toString());

      const pagoDelMes = abonoCapital
        .plus(abonoInteres)
        .plus(abonoIva12)
        .plus(moraTotal)
        .plus(otrosMonto);
      console.log("💵 Pago del mes:", pagoDelMes.toString());

      const capitalActual = getSaldoCapitalMatch(c.Fecha);
      console.log("📌 Capital restante match:", capitalActual);

      return {
        cuota_id: cuotadB[0].cuota_id,
        credito_id: creditoId,
        cuota_interes: abonoInteres.toString(),
        cuota: credito?.cuota?.toString() || "0.00",
        fecha_pago: new Date(c.Fecha).toISOString(),
        abono_capital: abonoCapital.toString(),
        abono_interes: abonoInteres.toString(),
        abono_iva_12: abonoIva12.toString(),
        abono_interes_ci: "0.00",
        abono_iva_ci: "0.00",
        abono_seguro: abonoSeguro.toString(),
        abono_gps: "0.00",
        pago_del_mes: pagoDelMes.toString(),
        llamada: "",
        monto_boleta: pagoDelMes.toString(),
        fecha_filtro: new Date(c.Fecha).toISOString(),
        renuevo_o_nuevo: "",
        capital_restante: capitalActual || "0.00",
        interes_restante: "0.00",
        iva_12_restante: "0.00",
        seguro_restante: "0.00",
        gps_restante: "0.00",
        total_restante: "0.00",
        membresias: credito?.membresias,
        membresias_pago: credito?.membresias
          ? credito?.membresias.toString()
          : "0.00",
        membresias_mes: credito?.membresias
          ? credito?.membresias.toString()
          : "0.00",
        otros: "",
        mora: moraTotal.toString(),
        monto_boleta_cuota: pagoDelMes.toString(),
        seguro_total: seguroDb.toString(),
        pagado: c.CapitalPagado === "S" && c.InteresPagado === "S",
        facturacion: "si",
        mes_pagado: "",
        seguro_facturado: seguroDb.toString(),
        gps_facturado: "0.00",
        reserva: "0.00",
        observaciones: `pago sincronizado desde SIFCO cuota ${cuotadB[0].numero_cuota}`,
        paymentFalse: false,
      };
    })
  );

  console.log("✅ Todas las cuotas procesadas. Insertando pagos...");
  const pagosDB = await db
    .insert(pagos_credito)
    .values(promiseResults)
    .returning();

  console.log("✅ Pagos insertados:", pagosDB.length);
  return pagosDB;

  function getSaldoCapitalMatch(fechaCuota: string): string {
    const cuotaDate = new Date(fechaCuota);
    const mes = cuotaDate.getMonth();
    const año = cuotaDate.getFullYear();

    for (const trx of transacciones) {
      const trxDate = new Date(trx.CrMoFeTrx);
      if (trxDate.getMonth() === mes && trxDate.getFullYear() === año) {
        console.log(
          `🔗 Match transacción con cuota ${fechaCuota}:`,
          trx.SaldoCapital
        );
        return trx.SaldoCapital;
      } else {
        console.log(
          `❌ No match transacción ${trx.CrMoFeTrx} con cuota ${fechaCuota}`
        );
      }
    }
    console.log(`⚠️ No se encontró match para cuota ${fechaCuota}`);
    return "0.00";
  }
}

/**
 * Fetch a list of credits from DB. If numeroSifco is provided, filter by it.
 * NOTE: Adjust selected columns to match your schema.
 */
async function fetchCreditosFromDB(numeroSifco?: string) {
  if (numeroSifco) {
    // Only the specified credit
    const rows = await db
      .select({
        id: creditos.credito_id, // PK interno
        numeroSifco: creditos.numero_credito_sifco, // número SIFCO (ajusta nombre)
      })
      .from(creditos)
      .where(eq(creditos.numero_credito_sifco, numeroSifco));

    return rows;
  }

  // All credits
  const rows = await db
    .select({
      id: creditos.credito_id,
      numeroSifco: creditos.numero_credito_sifco,
    })
    .from(creditos);

  return rows;
}

/**
 * Main entry:
 * - If numeroSifco is provided, process only that credit.
 * - Otherwise, process all credits in DB.
 *
 * Keeps it sequential and simple by design.
 */
export async function mapPagosPorCreditos(numeroSifco?: string) {
  // --- 1) Obtener créditos a procesar ---
  const creditList = await fetchCreditosFromDB(numeroSifco);

  if (!creditList.length) {
    console.log(
      numeroSifco
        ? `[WARN] No se encontró crédito con número SIFCO=${numeroSifco}`
        : "[WARN] No hay créditos para procesar."
    );
    return;
  }

  console.log(
    `🧾 Créditos a procesar: ${creditList.length}${
      numeroSifco ? ` (filtro SIFCO=${numeroSifco})` : ""
    }`
  );

  // --- 2) Recorrer y mapear pagos (secuencial para mantenerlo sencillo) ---
  let ok = 0;
  let fail = 0;

  for (const c of creditList) {
    const label = `${c.numeroSifco} / credito_id=${c.id}`;
    console.log(`🧭 Iniciando flujo para ${label}`);

    try {
      console.log(`🔍 Consultando estado de cuenta en SIFCO para ${label}...`);
      // 2.1) Consultar estado de cuenta por número SIFCO
      const infoPagos = await consultarEstadoCuentaPrestamo(c.numeroSifco);
      console.log(infoPagos);
      console.log(`✅ Estado de cuenta obtenido para ${label}.`);
      // 2.2) Validaciones mínimas
      if (!infoPagos) {
        console.log(`[WARN] Sin estado de cuenta para ${label}. Se omite.`);
        fail++;
        continue;
      }

      // 2.3) Mapear pagos a DB usando tu método existente
      await mapEstadoCuentaToPagosBig(
        infoPagos as unknown as WSCrEstadoCuentaResponse,
        Number(c.id)
      );

      ok++;
    } catch (err: any) {
      console.log(`[ERROR] Procesando ${label}:`, err?.message || err);
      fail++;
      // Nota: no hacemos throw para no tumbar el lote
    }
  }

  // --- 3) Resumen ---
  console.log(
    `🎉 Resumen mapeo pagos -> OK=${ok} | FAIL=${fail} | TOTAL=${creditList.length}`
  );
}

/**
 * Inserta o actualiza pagos de inversionistas
 * Puede procesar TODOS los créditos o solo uno específico
 * @param numeroCredito Opcional: número de crédito SIFCO a procesar
 */
export async function fillPagosInversionistas(numeroCredito?: string) {
  console.log("numeroCredito", numeroCredito);
  console.log("🚀 Iniciando flujo de pagos de inversionistas...");

  // 1. Obtener créditos de DB
  let creditos: { credito_id: number; numero_credito_sifco: string }[] = [];

  if (numeroCredito) {
    const credito = await db.query.creditos.findFirst({
      columns: { credito_id: true, numero_credito_sifco: true },
      where: (c, { eq }) => eq(c.numero_credito_sifco, numeroCredito),
    });

    if (!credito) {
      throw new Error(
        `[ERROR] No se encontró el crédito con numero_credito_sifco=${numeroCredito}`
      );
    }

    creditos = [credito];
  } else {
    creditos = await db.query.creditos.findMany({
      columns: { credito_id: true, numero_credito_sifco: true },
    });

    if (!creditos || creditos.length === 0) {
      throw new Error(`[ERROR] No se encontró ningún crédito en la DB`);
    }
  }

  console.log(`🧾 Créditos a procesar: ${creditos?.length || 0}`);
  console.log(creditos);

  // Contadores globales
  let totalOk = 0;
  let totalFail = 0;

  // 2. Iterar créditos
  for (const credito of creditos) {
    if (!credito) continue;

    console.log(`🚀 Procesando inversionistas para crédito SIFCO=${credito.numero_credito_sifco}`);

    // 3. Obtener filas desde Excel
    const rows = await leerCreditoPorNumeroSIFCO(excelPath, credito.numero_credito_sifco);
    console.log(`ℹ️ Filas obtenidas desde Excel: ${rows?.length || 0}`);

    // Contadores por crédito
    let ok = 0;
    let fail = 0;

    // 4. Procesar filas
    for (const row of rows) {
      try {
        // 4.1 Resolver inversionista
        const inv = await db.query.inversionistas.findFirst({
          columns: { inversionista_id: true, nombre: true },
          where: (i, { eq }) => eq(i.nombre, row.Inversionista.trim()),
        });

        if (!inv) {
          throw new Error(
            `[ERROR] No existe inversionista con nombre="${row.Inversionista}" (Crédito ${row.CreditoSIFCO})`
          );
        }

        // 4.2 Calcular montos
        const montoAportado = toBigExcel(row.Capital);
        console.log(
          "💰 Capital (montoAportado):",
          row.Capital,
          "->",
          montoAportado.toString()
        );

        const porcentajeCashIn = toBigExcel(row.PorcentajeCashIn);
        console.log(
          "📊 Porcentaje CashIn:",
          row.PorcentajeCashIn,
          "->",
          porcentajeCashIn.toString()
        );

        const porcentajeInversion = toBigExcel(row.PorcentajeInversionista);
        console.log(
          "📊 Porcentaje Inversionista:",
          row.PorcentajeInversionista,
          "->",
          porcentajeInversion.toString()
        );

        const interes = toBigExcel(row.porcentaje);
        console.log(
          "📈 Interés (%):",
          row.porcentaje,
          "->",
          interes.toString()
        );

        // Calcular cuota de interés base
        const cuotaInteres = montoAportado.times(interes);
        console.log(
          "💵 Cuota Interés (Capital * interes):",
          cuotaInteres.toString()
        );

        // Dividir la cuota entre inversionista y cashin
        const montoInversionista = cuotaInteres
          .times(porcentajeInversion)
 
          .toFixed(2);
        console.log("👤 Monto Inversionista:", montoInversionista);

        const montoCashIn = cuotaInteres
          .times(porcentajeCashIn)
        
          .toFixed(2);
        console.log("🏦 Monto CashIn:", montoCashIn);

        // IVA sobre cada parte
        const ivaInversionista =
          Number(montoInversionista) > 0
            ? new Big(montoInversionista).times(0.12).toFixed(2)
            : "0.00";
        console.log("🧾 IVA Inversionista:", ivaInversionista);

        const ivaCashIn =
          Number(montoCashIn) > 0
            ? new Big(montoCashIn).times(0.12).toFixed(2)
            : "0.00";
        console.log("🧾 IVA CashIn:", ivaCashIn);

        // Cuota final
        const cuotaInv =
          row.CuotaInversionista && row.CuotaInversionista !== "0"
            ? row.CuotaInversionista
            : row.Cuota;
        console.log("📌 Cuota usada (Inversionista/General):", cuotaInv);
        // 4.3 Armar registro
        const registro = {
          credito_id: credito.credito_id,
          inversionista_id: inv.inversionista_id,
          monto_aportado: montoAportado.toString(),
          porcentaje_cash_in: porcentajeCashIn.toString(),
          porcentaje_participacion_inversionista: porcentajeInversion.toString(),
          monto_inversionista: montoInversionista,
          monto_cash_in: montoCashIn,
          iva_inversionista: ivaInversionista,
          iva_cash_in: ivaCashIn,
          fecha_creacion: new Date(),
          cuota_inversionista: cuotaInv.toString(),
        };

        // 4.4 Upsert
        await db
          .insert(creditos_inversionistas)
          .values(registro)
          .onConflictDoUpdate({
            target: [
              creditos_inversionistas.credito_id,
              creditos_inversionistas.inversionista_id,
            ],
            set: {
              monto_aportado: sql`EXCLUDED.monto_aportado`,
              porcentaje_cash_in: sql`EXCLUDED.porcentaje_cash_in`,
              porcentaje_participacion_inversionista:
                sql`EXCLUDED.porcentaje_participacion_inversionista`,
              monto_inversionista: sql`EXCLUDED.monto_inversionista`,
              monto_cash_in: sql`EXCLUDED.monto_cash_in`,
              iva_inversionista: sql`EXCLUDED.iva_inversionista`,
              iva_cash_in: sql`EXCLUDED.iva_cash_in`,
              cuota_inversionista: sql`EXCLUDED.cuota_inversionista`,
            },
          });

        ok++;
        totalOk++;
      } catch (err) {
        console.error(`❌ Error procesando fila crédito=${credito.numero_credito_sifco}`, err);
        fail++;
        totalFail++;
      }
    }

    console.log(
      `🎉 Resumen crédito ${credito.numero_credito_sifco} -> OK=${ok} | FAIL=${fail} | TOTAL=${rows.length}`
    );
  }

  // Resumen global
  console.log(
    `✅ Resumen final -> OK=${totalOk} | FAIL=${totalFail} | TOTAL=${totalOk + totalFail}`
  );
}
