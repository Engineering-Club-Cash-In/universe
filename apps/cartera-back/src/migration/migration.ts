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
import { register } from "module";

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
/** ---------- Mapper con la regla nueva ---------- */
export async function mapEstadoCuentaToPagosBig(
  resp: WSCrEstadoCuentaResponse,
  creditoId: number
) {
  console.log("╔══════════════════════════════════════════════════════════════");
  console.log("║ 🚀 INICIO mapEstadoCuentaToPagosBig");
  console.log("╚══════════════════════════════════════════════════════════════");
  console.log("📋 Parámetros de entrada:");
  console.log("  • creditoId:", creditoId);
  console.log("  • resp existe:", !!resp);
  console.log("  • ConsultaResultado existe:", !!resp?.ConsultaResultado);

  // ═══════════════════════════════════════════════════════════════
  // 1️⃣ CONSULTA DE CRÉDITO
  // ═══════════════════════════════════════════════════════════════
  console.log("\n┌─────────────────────────────────────────────────────────────");
  console.log("│ 1️⃣ CONSULTANDO CRÉDITO EN DB");
  console.log("└─────────────────────────────────────────────────────────────");
  
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

  console.log("✅ Crédito encontrado:", {
    existe: !!credito,
    seguro_10_cuotas: credito?.seguro_10_cuotas,
    membresias: credito?.membresias,
    cuota: credito?.cuota,
    cuota_interes: credito?.cuota_interes,
    iva_12: credito?.iva_12,
    capital: credito?.capital,
    deudatotal: credito?.deudatotal,
    porcentaje_interes: credito?.porcentaje_interes,
    gps: credito?.gps,
  });

  // ═══════════════════════════════════════════════════════════════
  // 2️⃣ EXTRACCIÓN DE DATOS DE RESPUESTA
  // ═══════════════════════════════════════════════════════════════
  console.log("\n┌─────────────────────────────────────────────────────────────");
  console.log("│ 2️⃣ EXTRAYENDO DATOS DE RESPUESTA WS");
  console.log("└─────────────────────────────────────────────────────────────");

  const cuotas = resp?.ConsultaResultado?.PlanPagos_Cuotas ?? [];
  const transacciones = resp?.ConsultaResultado?.EstadoCuenta_Transacciones ?? [];
  const primeraTransaccion: EstadoCuentaTransaccion | undefined =
    resp?.ConsultaResultado.EstadoCuenta_Transacciones?.[0];

  console.log("📊 Estadísticas de respuesta:");
  console.log("  • Total cuotas:", cuotas.length);
  console.log("  • Total transacciones:", transacciones.length);
  console.log("  • Primera transacción existe:", !!primeraTransaccion);

  if (cuotas.length > 0) {
    console.log("\n📝 Muestra de primera cuota:");
    console.log(JSON.stringify(cuotas[0], null, 2));
  }

  if (primeraTransaccion) {
    console.log("\n📝 Primera transacción completa:");
    console.log(JSON.stringify(primeraTransaccion, null, 2));
  }

  // ═══════════════════════════════════════════════════════════════
  // 3️⃣ LIMPIEZA DE DATOS PREVIOS
  // ═══════════════════════════════════════════════════════════════
  console.log("\n┌─────────────────────────────────────────────────────────────");
  console.log("│ 3️⃣ LIMPIANDO DATOS PREVIOS");
  console.log("└─────────────────────────────────────────────────────────────");

  await db.transaction(async (tx) => {
    console.log("  🗑️  Eliminando pagos previos...");
     // Más simple y directo
await tx
  .delete(pagos_credito)
  .where(eq(pagos_credito.credito_id, creditoId));

await tx
  .delete(cuotas_credito)
  .where(eq(cuotas_credito.credito_id, creditoId));
    console.log("  ✅ Pagos eliminados");

    console.log("  🗑️  Eliminando cuotas previas...");
     
  });

  console.log(`✅ Limpieza completada para crédito_id=${creditoId}`);

  // ═══════════════════════════════════════════════════════════════
  // 4️⃣ PROCESAMIENTO DE CUOTA 0 (PAGO INICIAL)
  // ═══════════════════════════════════════════════════════════════
  if (primeraTransaccion) {
    console.log("\n┌─────────────────────────────────────────────────────────────");
    console.log("│ 4️⃣ PROCESANDO CUOTA 0 (PAGO INICIAL)");
    console.log("└─────────────────────────────────────────────────────────────");

    console.log("🔍 Buscando detalle ROYALTY...");
    console.log("  • Total detalles:", primeraTransaccion.EstadoCuenta_Detalles?.length);
    
    const detalleRoyalty = primeraTransaccion.EstadoCuenta_Detalles.find(
      (d) => d.ApSalDes === "ROYALTY"
    );

    console.log("  • Detalle ROYALTY encontrado:", !!detalleRoyalty);
    if (detalleRoyalty) {
      console.log("  • CrMoDeValor:", detalleRoyalty.CrMoDeValor);
    }

    const royaltiValor = toBig(detalleRoyalty?.CrMoDeValor ?? 0);
    console.log("💰 Valor de royalty convertido:", royaltiValor.toString());

    // Insertar cuota 0
    console.log("\n📝 Creando cuota 0...");
    const cuota0Data = {
      credito_id: creditoId,
      numero_cuota: 0,
      fecha_vencimiento: new Date(primeraTransaccion.CrMoFeVal).toISOString(),
      pagado: true,
    };
    console.log("  • Datos cuota 0:", cuota0Data);

    const cuota0 = await db
      .insert(cuotas_credito)
      .values(cuota0Data)
      .returning();

    console.log("✅ Cuota 0 insertada:", {
      cuota_id: cuota0[0]?.cuota_id,
      numero_cuota: cuota0[0]?.numero_cuota,
    });

    // Cálculos para pago 0
    console.log("\n🧮 Calculando valores para pago 0...");
    
    const reserva = new Big(credito?.seguro_10_cuotas ?? "0").plus(600);
    console.log("  • Reserva:", reserva.toString());

    const capital = toBigExcel(primeraTransaccion.CapitalDesembolsado, "0");
    console.log("  • Capital:", capital.toString());

    const porcentaje_interes = toBigExcel(credito?.porcentaje_interes, "1.5").div(100);
    console.log("  • Porcentaje interés:", porcentaje_interes.toString());

    const gps = toBigExcel(credito?.gps, 0);
    console.log("  • GPS:", gps.toString());

    const seguro_10_cuotas = toBigExcel(credito?.seguro_10_cuotas, 0);
    console.log("  • Seguro 10 cuotas:", seguro_10_cuotas.toString());

    const membresias_pago = toBigExcel(credito?.membresias, 0);
    console.log("  • Membresías:", membresias_pago.toString());

    const cuota_interes = capital.times(porcentaje_interes).round(2);
    console.log("  • Cuota interés:", cuota_interes.toString());

    const iva_12 = cuota_interes.times(0.12).round(2);
    console.log("  • IVA 12%:", iva_12.toString());

    const deudatotal = capital
      .plus(cuota_interes)
      .plus(iva_12)
      .plus(seguro_10_cuotas)
      .plus(gps)
      .plus(membresias_pago)
      .round(2, 0);
    console.log("  • Deuda total:", deudatotal.toString());

    const pago0 = {
      credito_id: creditoId,
      cuota: credito?.cuota?.toString() ?? "0.00",
      cuota_interes: cuota_interes?.toString() ?? "0.00",
      cuota_id: cuota0[0]?.cuota_id ?? null,
      fecha_pago: new Date(primeraTransaccion.CrMoFeTrx),
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
      fecha_vencimiento: new Date(primeraTransaccion.CrMoFeTrx).toISOString(),
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
      validationStatus: "validated" as const,
      registerBy: "SIFCO_SYNC",
      pagoConvenio: "0",
    };

    console.log("\n📝 Insertando pago 0...");
    console.log("  • Pago 0 data (resumen):", {
      cuota_id: pago0.cuota_id,
      credito_id: pago0.credito_id,
      fecha_pago: pago0.fecha_pago,
      capital_restante: pago0.capital_restante,
      total_restante: pago0.total_restante,
    });

    await db.insert(pagos_credito).values(pago0).onConflictDoNothing();
    console.log("✅ Pago 0 insertado exitosamente");

    // Actualizar royalty si existe
    if (royaltiValor.gt(0)) {
      console.log("\n💎 Actualizando royalty en crédito...");
      await db
        .update(creditos)
        .set({ royalti: royaltiValor.toString() })
        .where(eq(creditos.credito_id, creditoId));
      console.log("✅ Royalty actualizado:", royaltiValor.toString());
    } else {
      console.log("ℹ️  No hay royalty para actualizar");
    }
  } else {
    console.log("\n⚠️  No hay primera transacción - saltando cuota 0");
  }

  // ═══════════════════════════════════════════════════════════════
  // 5️⃣ PREPARACIÓN DE CUOTAS PARA INSERCIÓN BATCH
  // ═══════════════════════════════════════════════════════════════
  console.log("\n┌─────────────────────────────────────────────────────────────");
  console.log("│ 5️⃣ PREPARANDO CUOTAS PARA BATCH INSERT");
  console.log("└─────────────────────────────────────────────────────────────");

  const cuotasParaInsertar = cuotas.map((c, idx) => {
    const numeroCuota = Number(c.InteresNumeroCuota ?? 0) ;
    const isPagado = c.CapitalPagado === "S" && c.InteresPagado === "S";
    
    if (idx < 3 || idx >= cuotas.length - 2) {
      console.log(`\n  📋 Cuota ${idx + 1}/${cuotas.length}:`);
      console.log(`    • InteresNumeroCuota: ${c.InteresNumeroCuota}`);
      console.log(`    • Número cuota calculado: ${numeroCuota}`);
      console.log(`    • Fecha: ${c.Fecha}`);
      console.log(`    • CapitalPagado: ${c.CapitalPagado}`);
      console.log(`    • InteresPagado: ${c.InteresPagado}`);
      console.log(`    • isPagado: ${isPagado}`);
    } else if (idx === 3) {
      console.log(`\n  ... (${cuotas.length - 4} cuotas más) ...`);
    }

    return {
      credito_id: creditoId,
      numero_cuota: numeroCuota,
      fecha_vencimiento: new Date(c.Fecha).toISOString(),
      pagado: isPagado,
    };
  });

  console.log(`\n✅ Preparadas ${cuotasParaInsertar.length} cuotas para inserción`);

  // ═══════════════════════════════════════════════════════════════
  // 6️⃣ INSERCIÓN BATCH DE CUOTAS
  // ═══════════════════════════════════════════════════════════════
  console.log("\n┌─────────────────────────────────────────────────────────────");
  console.log("│ 6️⃣ INSERTANDO CUOTAS EN BATCH");
  console.log("└─────────────────────────────────────────────────────────────");

  const cuotasInsertadas = await db
    .insert(cuotas_credito)
    .values(cuotasParaInsertar)
    .returning();

  console.log(`✅ ${cuotasInsertadas.length} cuotas insertadas`);
  console.log("  • Primera cuota:", {
    cuota_id: cuotasInsertadas[0]?.cuota_id,
    numero_cuota: cuotasInsertadas[0]?.numero_cuota,
  });
  console.log("  • Última cuota:", {
    cuota_id: cuotasInsertadas[cuotasInsertadas.length - 1]?.cuota_id,
    numero_cuota: cuotasInsertadas[cuotasInsertadas.length - 1]?.numero_cuota,
  });

  // ═══════════════════════════════════════════════════════════════
  // 7️⃣ PREPARACIÓN DE PAGOS
  // ═══════════════════════════════════════════════════════════════
  console.log("\n┌─────────────────────────────────────────────────────────────");
  console.log("│ 7️⃣ PREPARANDO PAGOS PARA BATCH INSERT");
  console.log("└─────────────────────────────────────────────────────────────");

  const seguroDb = toBig(credito?.seguro_10_cuotas ?? 0);
  const membresiaDb = toBig(credito?.membresias ?? 0);

  console.log("💰 Valores base para cálculos:");
  console.log("  • Seguro DB:", seguroDb.toString());
  console.log("  • Membresía DB:", membresiaDb.toString());

  const pagosParaInsertar = cuotas.map((c, idx) => {
    const cuotaDB = cuotasInsertadas[idx];

    if (idx < 3 || idx >= cuotas.length - 2) {
      console.log(`\n  🧮 Procesando pago ${idx + 1}/${cuotas.length} (cuota_id: ${cuotaDB.cuota_id}):`);
    } else if (idx === 3) {
      console.log(`\n  ... (procesando ${cuotas.length - 4} pagos más) ...`);
    }

    // Cálculos de abonos
    const abonoCapital = toBig(c.CapitalAbonado);
    const interesAbonadoTotal = toBig(c.InteresAbonado);
    const base = interesAbonadoTotal.div(1.12);
    const abonoInteres = base.round(2, Big.roundHalfUp);
    const abonoIva12 = interesAbonadoTotal.minus(abonoInteres).round(2, Big.roundHalfUp);

    if (idx < 3 || idx >= cuotas.length - 2) {
      console.log(`    • CapitalAbonado: ${c.CapitalAbonado} → ${abonoCapital.toString()}`);
      console.log(`    • InteresAbonado: ${c.InteresAbonado} → ${abonoInteres.toString()}`);
      console.log(`    • IVA 12%: ${abonoIva12.toString()}`);
    }

    // Mora
    const moraCapPag = toBig(c.CapitalMoraValorPagado);
    const moraIntPag = toBig(c.InteresMoraValorPagado);
    const moraTotal = moraCapPag.plus(moraIntPag);

    if (idx < 3 || idx >= cuotas.length - 2) {
      if (moraTotal.gt(0)) {
        console.log(`    • Mora Capital: ${moraCapPag.toString()}`);
        console.log(`    • Mora Interés: ${moraIntPag.toString()}`);
        console.log(`    • Mora Total: ${moraTotal.toString()}`);
      }
    }

    // Otros
    const otrosMonto = toBig(c.OtrosMonto);
    let abonoSeguro = new Big(0);
    if (otrosMonto.eq(seguroDb.plus(membresiaDb))) {
      abonoSeguro = seguroDb;
      if (idx < 3 || idx >= cuotas.length - 2) {
        console.log(`    • OtrosMonto: ${otrosMonto.toString()} = Seguro + Membresía`);
        console.log(`    • Abono Seguro: ${abonoSeguro.toString()}`);
      }
    } else if (otrosMonto.gt(0)) {
      if (idx < 3 || idx >= cuotas.length - 2) {
        console.log(`    • OtrosMonto: ${otrosMonto.toString()} (no coincide con seguro+membresía)`);
      }
    }

    const pagoDelMes = abonoCapital
      .plus(abonoInteres)
      .plus(abonoIva12)
      .plus(moraTotal)
      .plus(otrosMonto);

    if (idx < 3 || idx >= cuotas.length - 2) {
      console.log(`    • Pago del mes: ${pagoDelMes.toString()}`);
    }

    // Restantes
    const interes_restante_big =
      c.InteresMonto && toBig(c.InteresMonto).gt(0) ? toBig(c.InteresMonto) : new Big(0);
    const capital_restante_big =
      c.CapitalMonto && toBig(c.CapitalMonto).gt(0) ? toBig(c.CapitalMonto) : new Big(0);
    const iva_12_restante_big = interes_restante_big.times(0.12).round(2);

    if (idx < 3 || idx >= cuotas.length - 2) {
      console.log(`    • Capital restante: ${capital_restante_big.toString()}`);
      console.log(`    • Interés restante: ${interes_restante_big.toString()}`);
      console.log(`    • IVA restante: ${iva_12_restante_big.toString()}`);
    }

    const mesNombre = new Date(c.Fecha)
      .toLocaleDateString("es-ES", { month: "long" })
      .replace(/^\w/, (ch) => ch.toUpperCase());

    const seguro_restante_big =
      c.CapitalPagado === "S" && c.InteresPagado === "S" && seguroDb.gt(0)
        ? seguroDb
        : new Big(0);

    const isPagado = c.CapitalPagado === "S" && c.InteresPagado === "S";

    if (idx < 3 || idx >= cuotas.length - 2) {
      console.log(`    • isPagado: ${isPagado}`);
      console.log(`    • Mes: ${mesNombre}`);
      console.log(`    • Validation Status: ${isPagado ? "validated" : "no_required"}`);
    }

    return {
      cuota_id: cuotaDB.cuota_id,
      credito_id: creditoId,
      cuota_interes: abonoInteres.toString(),
      cuota: credito?.cuota?.toString() || "0.00",
      fecha_pago: isPagado ? new Date(c.Fecha) : null,
      abono_capital: abonoCapital.toString(),
      abono_interes: abonoInteres.toString(),
      abono_iva_12: abonoIva12.toString(),
      abono_interes_ci: "0.00",
      abono_iva_ci: "0.00",
      abono_seguro: abonoSeguro.toString(),
      abono_gps: "0.00",
      pago_del_mes: pagoDelMes.toString(),
      llamada: "",
      monto_boleta: isPagado ? pagoDelMes.toString() : "0.00",
      fecha_vencimiento: new Date(c.Fecha).toISOString(),
      renuevo_o_nuevo: "",
      capital_restante: isPagado ? "0.00" : capital_restante_big.toString(),
      interes_restante: isPagado ? "0.00" : interes_restante_big.toString(),
      iva_12_restante: isPagado ? "0.00" : iva_12_restante_big.toString(),
      seguro_restante: isPagado ? "0.00" : seguroDb.toString(),
      gps_restante: "0.00",
      total_restante: "0.00",
      membresias: credito?.membresias,
      membresias_pago: credito?.membresias ? credito?.membresias.toString() : "0.00",
      membresias_mes: credito?.membresias ? credito?.membresias.toString() : "0.00",
      otros: "",
      mora: moraTotal.toString(),
      monto_boleta_cuota: isPagado ? pagoDelMes.toString() : "0.00",
      seguro_total: seguroDb.toString(),
      pagado: isPagado,
      facturacion: "si",
      mes_pagado: isPagado ? mesNombre : "",
      seguro_facturado: seguroDb.toString(),
      gps_facturado: "0.00",
      reserva: "0.00",
      observaciones: `pago sincronizado desde SIFCO cuota ${cuotaDB.numero_cuota}`,
      paymentFalse: false,
      validationStatus: isPagado ? ("validated" as const) : ("no_required" as const),
      registerBy: "SIFCO_SYNC",
      pagoConvenio: "0",
    };
  });

  console.log(`\n✅ Preparados ${pagosParaInsertar.length} pagos para inserción`);

  // ═══════════════════════════════════════════════════════════════
  // 8️⃣ INSERCIÓN BATCH DE PAGOS
  // ═══════════════════════════════════════════════════════════════
  console.log("\n┌─────────────────────────────────────────────────────────────");
  console.log("│ 8️⃣ INSERTANDO PAGOS EN BATCH");
  console.log("└─────────────────────────────────────────────────────────────");

  const pagosDB = await db.insert(pagos_credito).values(pagosParaInsertar).returning();

  console.log(`✅ ${pagosDB.length} pagos insertados exitosamente`);
  console.log("  • Primer pago:", {
    pago_id: pagosDB[0]?.pago_id,
    cuota_id: pagosDB[0]?.cuota_id,
    pagado: pagosDB[0]?.pagado,
  });
  console.log("  • Último pago:", {
    pago_id: pagosDB[pagosDB.length - 1]?.pago_id,
    cuota_id: pagosDB[pagosDB.length - 1]?.cuota_id,
    pagado: pagosDB[pagosDB.length - 1]?.pagado,
  });

  // ═══════════════════════════════════════════════════════════════
  // 9️⃣ RESUMEN FINAL
  // ═══════════════════════════════════════════════════════════════
  console.log("\n╔══════════════════════════════════════════════════════════════");
  console.log("║ ✅ MAPPER COMPLETADO");
  console.log("╠══════════════════════════════════════════════════════════════");
  console.log("║ 📊 Resumen:");
  console.log(`║   • Crédito ID: ${creditoId}`);
  console.log(`║   • Cuotas procesadas: ${cuotasInsertadas.length}`);
  console.log(`║   • Pagos insertados: ${pagosDB.length}`);
  console.log(`║   • Cuota 0 creada: ${primeraTransaccion ? "Sí" : "No"}`);
  
  const pagados = pagosDB.filter(p => p.pagado).length;
  const pendientes = pagosDB.filter(p => !p.pagado).length;
  console.log(`║   • Pagos realizados: ${pagados}`);
  console.log(`║   • Pagos pendientes: ${pendientes}`);
  console.log("╚══════════════════════════════════════════════════════════════\n");

  return pagosDB;
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
}export async function fillPagosInversionistasV2(
  numeroCredito: string,
  hoja_excel: string,
  inversionistasData: {
    inversionista: string;
    capital: string | number;
    porcentajeCashIn: string | number;
    porcentajeInversionista: string | number;
    porcentaje: string | number;
    cuota?: string | number;
    cuotaInversionista?: string | number;
  }[]
) {
  console.log("🚀 Iniciando fillPagosInversionistasV2...");
  console.log(`📋 Número de crédito RECIBIDO: "${numeroCredito}"`);
  console.log(`📋 Hoja Excel RECIBIDA: "${hoja_excel}"`);
  console.log(`👥 Inversionistas recibidos: ${inversionistasData.length}`);
  
  // 🔍 MOSTRAR PRIMER INVERSIONISTA PARA DEBUG
  if (inversionistasData.length > 0) {
    console.log(`📝 Ejemplo primer inversionista:`, JSON.stringify(inversionistasData[0], null, 2));
  }

  // 🧹 LIMPIAR Y NORMALIZAR el número de crédito
  const numeroCreditoLimpio = numeroCredito.toString().trim().replace(/\s+/g, '');
  console.log(`🧹 Número de crédito LIMPIO: "${numeroCreditoLimpio}"`);

  // 1. Obtener el crédito de la DB (búsqueda FLEXIBLE)
  console.log(`🔍 Buscando crédito en DB...`);
  
  const credito = await db.query.creditos.findFirst({
    columns: { credito_id: true, numero_credito_sifco: true },
    where: (c, { eq, or, like, sql }) => 
      or(
        eq(c.numero_credito_sifco, numeroCreditoLimpio),
        eq(c.numero_credito_sifco, numeroCredito),
        like(c.numero_credito_sifco, `%${numeroCreditoLimpio}%`),
        // Buscar también quitando ceros a la izquierda
        eq(c.numero_credito_sifco, numeroCreditoLimpio.replace(/^0+/, '')),
      )
  });

  if (!credito) {
    console.error(`❌ CRÉDITO NO ENCONTRADO EN DB`);
    console.error(`   Buscado: "${numeroCreditoLimpio}"`);
    
    // 🔍 Buscar créditos similares para debugging
    const creditosSimilares = await db.query.creditos.findMany({
      columns: { numero_credito_sifco: true },
      where: (c, { like }) => like(c.numero_credito_sifco, `%${numeroCreditoLimpio.slice(-8)}%`),
      limit: 5
    });
    
    if (creditosSimilares.length > 0) {
      console.log(`💡 Créditos similares encontrados en DB:`);
      creditosSimilares.forEach(c => console.log(`   - "${c.numero_credito_sifco}"`));
    }
    
    throw new Error(
      `[ERROR] No se encontró el crédito con numero_credito_sifco=${numeroCreditoLimpio}`
    );
  }

  console.log(`✅ Crédito encontrado en DB:`);
  console.log(`   ID: ${credito.credito_id}`);
  console.log(`   Número SIFCO en DB: "${credito.numero_credito_sifco}"`);

  // 🆕 PASO 2: VALIDAR QUE LA HOJA DEL EXCEL COINCIDA CON LA ÚLTIMA CUOTA LIQUIDADA
  console.log(`\n🔍 ========== VALIDANDO ÚLTIMA CUOTA LIQUIDADA ==========`);
  
  // Buscar la última cuota liquidada de este crédito
  const ultimaCuotaLiquidada = await db.query.cuotas_credito.findFirst({
    columns: { 
      cuota_id: true, 
      numero_cuota: true, 
      fecha_vencimiento: true,
      liquidado_inversionistas: true
    },
    where: (cc, { eq, and }) => 
      and(
        eq(cc.credito_id, credito.credito_id),
        eq(cc.liquidado_inversionistas, true)
      ),
    orderBy: (cc, { desc }) => [desc(cc.numero_cuota)]
  });

  if (!ultimaCuotaLiquidada) {
    console.log(`⚠️ No hay cuotas liquidadas para este crédito`);
    console.log(`   Asumiendo que es el primer proceso, continuando...`);
  } else {
    console.log(`✅ Última cuota liquidada encontrada:`);
    console.log(`   Cuota #${ultimaCuotaLiquidada.numero_cuota}`);
    console.log(`   Fecha vencimiento: ${ultimaCuotaLiquidada.fecha_vencimiento}`);

    // Convertir fecha_vencimiento a formato "mes año" (ej: "octubre 2025")
    const fechaVencimiento = new Date(ultimaCuotaLiquidada.fecha_vencimiento);
    const mesLiquidado = fechaVencimiento.toLocaleString('es-GT', { 
      month: 'long', 
      year: 'numeric' 
    });
    
    console.log(`   Mes liquidado (original): "${mesLiquidado}"`);
    console.log(`   Hoja Excel recibida: "${hoja_excel}"`);

    // 🔧 FUNCIÓN PARA NORMALIZAR (quitar "de", lowercase, espacios extra)
    const normalizarMes = (texto: string): string => {
      return texto
        .toLowerCase()
        .replace(/\s+de\s+/g, ' ')  // "octubre de 2025" -> "octubre 2025"
        .replace(/\s+/g, ' ')        // múltiples espacios -> uno solo
        .trim();
    };

    const mesLiquidadoNormalizado = normalizarMes(mesLiquidado);
    const hojaExcelNormalizada = normalizarMes(hoja_excel);

    console.log(`   Mes liquidado normalizado: "${mesLiquidadoNormalizado}"`);
    console.log(`   Hoja Excel normalizada: "${hojaExcelNormalizada}"`);
    console.log(`   Comparando: "${mesLiquidadoNormalizado}" === "${hojaExcelNormalizada}"`);

    // Validar que coincidan
    if (mesLiquidadoNormalizado !== hojaExcelNormalizada) {
      const errorMsg = `❌ NO HACE MATCH: La última cuota liquidada es de "${mesLiquidado}" pero el Excel es de "${hoja_excel}"`;
      console.error(`\n${errorMsg}`);
      
      return {
        success: false,
        credito: numeroCredito,
        hoja_excel: hoja_excel,
        ultima_cuota_liquidada: mesLiquidado,
        error: errorMsg,
        exitosos: 0,
        fallidos: 0,
        total: inversionistasData.length,
        errores: [{
          inversionista: "VALIDACIÓN",
          error: errorMsg
        }]
      };
    }

    console.log(`✅ MATCH CORRECTO: La hoja del Excel coincide con la última cuota liquidada`);
  }
  console.log(`========================================\n`);

  // Contadores
  let ok = 0;
  let fail = 0;
  const errores: { inversionista: string; error: string }[] = [];

  // 3. Procesar cada inversionista
  for (const rowData of inversionistasData) {
    try {
      console.log(`\n👤 Procesando inversionista: "${rowData.inversionista}"`);

      // 🧹 NORMALIZAR nombre del inversionista
      const nombreInversionistaLimpio = rowData.inversionista.toString().trim();
      console.log(`   Buscando en DB...`);

      // 3.1 Resolver inversionista en DB (búsqueda FLEXIBLE)
      const inv = await db.query.inversionistas.findFirst({
        columns: { inversionista_id: true, nombre: true },
        where: (i, { eq, or, like, sql }) => 
          or(
            eq(i.nombre, nombreInversionistaLimpio),
            eq(i.nombre, rowData.inversionista),
            like(i.nombre, `%${nombreInversionistaLimpio}%`),
            // Búsqueda case-insensitive
            sql`LOWER(${i.nombre}) = LOWER(${nombreInversionistaLimpio})`
          )
      });

      if (!inv) {
        console.error(`   ❌ INVERSIONISTA NO ENCONTRADO EN DB`);
        console.error(`      Buscado: "${nombreInversionistaLimpio}"`);
        
        // 🔍 Buscar inversionistas similares
        const inversionistasSimilares = await db.query.inversionistas.findMany({
          columns: { nombre: true },
          limit: 5
        });
        
        console.log(`   💡 Primeros inversionistas en DB:`);
        inversionistasSimilares.slice(0, 3).forEach(i => console.log(`      - "${i.nombre}"`));
        
        throw new Error(
          `No existe inversionista con nombre="${nombreInversionistaLimpio}"`
        );
      }

      console.log(`   ✅ Inversionista encontrado:`);
      console.log(`      ID: ${inv.inversionista_id}`);
      console.log(`      Nombre en DB: "${inv.nombre}"`);

      // 3.2 Calcular montos
      const montoAportado = toBigExcel(rowData.capital);
      const porcentajeCashIn = toBigExcel(rowData.porcentajeCashIn);
      const porcentajeInversion = toBigExcel(rowData.porcentajeInversionista);
      const interes = toBigExcel(rowData.porcentaje);

      console.log(`   💰 Valores calculados:`);
      console.log(`      Capital: ${montoAportado.toString()}`);
      console.log(`      % CashIn: ${porcentajeCashIn.toString()}`);
      console.log(`      % Inversión: ${porcentajeInversion.toString()}`);
      console.log(`      % Interés: ${interes.toString()}`);

      // Calcular cuota de interés base
      const cuotaInteres = montoAportado.times(interes);

      // Dividir entre inversionista y cashin
      const montoInversionista = cuotaInteres
        .times(porcentajeInversion)
        .toFixed(2);

      const montoCashIn = cuotaInteres
        .times(porcentajeCashIn)
        .toFixed(2);

      console.log(`      Monto Inversionista: ${montoInversionista}`);
      console.log(`      Monto CashIn: ${montoCashIn}`);

      // IVA sobre cada parte
      const ivaInversionista =
        Number(montoInversionista) > 0
          ? new Big(montoInversionista).times(0.12).toFixed(2)
          : "0.00";

      const ivaCashIn =
        Number(montoCashIn) > 0
          ? new Big(montoCashIn).times(0.12).toFixed(2)
          : "0.00";

      // Determinar cuota a usar
      const cuotaInv = (rowData.cuota ?? "0").toString();

      // 3.3 Armar registro
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
        cuota_inversionista: cuotaInv,
      };

      console.log(`   💾 Registro a guardar:`, JSON.stringify(registro, null, 2));

      // 3.4 Upsert
      console.log(`   💾 Guardando en DB...`);
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
            fecha_creacion: sql`EXCLUDED.fecha_creacion`,
          },
        });

      console.log(`   ✅ Registro guardado exitosamente`);
      ok++;
    } catch (err) {
      console.error(`   ❌ Error procesando inversionista ${rowData.inversionista}:`, err);
      errores.push({
        inversionista: rowData.inversionista,
        error: err instanceof Error ? err.message : String(err),
      });
      fail++;
    }
  }

  // Resumen
  const resultado = {
    success: true,
    credito: numeroCredito,
    hoja_excel: hoja_excel,
    exitosos: ok,
    fallidos: fail,
    total: inversionistasData.length,
    errores: errores,
  };

  console.log(`\n🎉 Resumen final:`);
  console.log(`✅ Exitosos: ${ok}`);
  console.log(`❌ Fallidos: ${fail}`);

  if (errores.length > 0) {
    console.log(`\n⚠️ Errores encontrados:`);
    errores.forEach((e) => console.log(`  - ${e.inversionista}: ${e.error}`));
  }

  return resultado;
}