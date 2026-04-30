import Big from "big.js";
import {
  ExcelCreditoRow,
  leerCreditoPorNumeroSIFCO,
  listarCreditosAgrupados,
} from "../services/excel";
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
  boletas,
  creditos,
  creditos_inversionistas,
  cuotas_credito,
  pagos_credito,
  pagos_credito_inversionistas,
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
  console.log(
    "╔══════════════════════════════════════════════════════════════"
  );
  console.log("║ 🚀 INICIO mapEstadoCuentaToPagosBig");
  console.log(
    "╚══════════════════════════════════════════════════════════════"
  );
  console.log("📋 Parámetros de entrada:");
  console.log("  • creditoId:", creditoId);
  console.log("  • resp existe:", !!resp);
  console.log("  • ConsultaResultado existe:", !!resp?.ConsultaResultado);

  // ═══════════════════════════════════════════════════════════════
  // 1️⃣ CONSULTA DE CRÉDITO
  // ═══════════════════════════════════════════════════════════════
  console.log(
    "\n┌─────────────────────────────────────────────────────────────"
  );
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
      fecha_creacion: true, // 👈 Para determinar día de vencimiento
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
    fecha_creacion: credito?.fecha_creacion,
  });

  // ═══════════════════════════════════════════════════════════════
  // 2️⃣ DETERMINAR DÍA DE VENCIMIENTO
  // ═══════════════════════════════════════════════════════════════
  console.log(
    "\n┌─────────────────────────────────────────────────────────────"
  );
  console.log("│ 2️⃣ DETERMINANDO DÍA DE VENCIMIENTO");
  console.log("└─────────────────────────────────────────────────────────────");

  const fechaDesembolso = new Date(credito!.fecha_creacion);
  const diaDesembolso = fechaDesembolso.getDate();
  const diaVencimiento = diaDesembolso > 15 ? 30 : 15;

  console.log(`   📌 Fecha desembolso: ${fechaDesembolso.toISOString().split("T")[0]}`);
  console.log(`   📌 Día del desembolso: ${diaDesembolso}`);
  console.log(`   🎯 Día de vencimiento para cuotas: ${diaVencimiento}`);

  // ═══════════════════════════════════════════════════════════════
  // 3️⃣ EXTRACCIÓN DE DATOS DE RESPUESTA
  // ═══════════════════════════════════════════════════════════════
  console.log(
    "\n┌──────f───────────────────────────────────────────────────────"
  );
  console.log("│ 3️⃣ EXTRAYENDO DATOS DE RESPUESTA WS");
  console.log("└─────────────────────────────────────────────────────────────");

  const cuotas = resp?.ConsultaResultado?.PlanPagos_Cuotas ?? [];
  const transacciones =
    resp?.ConsultaResultado?.EstadoCuenta_Transacciones ?? [];
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
  // 4️⃣ LIMPIEZA DE DATOS PREVIOS
  // ═══════════════════════════════════════════════════════════════
  console.log(
    "\n┌─────────────────────────────────────────────────────────────"
  );
  console.log("│ 4️⃣ LIMPIANDO DATOS PREVIOS");
  console.log("└─────────────────────────────────────────────────────────────");

  await db.transaction(async (tx) => {
    // Eliminar hijos primero (FK constraints)
    const pagosDelCredito = await tx
      .select({ pago_id: pagos_credito.pago_id })
      .from(pagos_credito)
      .where(eq(pagos_credito.credito_id, creditoId));
    const pagoIds = pagosDelCredito.map((p) => p.pago_id);

    if (pagoIds.length > 0) {
      console.log("  🗑️  Eliminando boletas...");
      await tx.delete(boletas).where(inArray(boletas.pago_id, pagoIds));
      console.log("  🗑️  Eliminando pagos inversionistas...");
      await tx.delete(pagos_credito_inversionistas).where(inArray(pagos_credito_inversionistas.pago_id, pagoIds));
    }

    console.log("  🗑️  Eliminando pagos previos...");
    await tx
      .delete(pagos_credito)
      .where(eq(pagos_credito.credito_id, creditoId));
    console.log("  ✅ Pagos eliminados");

    console.log("  🗑️  Eliminando cuotas previas...");
    await tx
      .delete(cuotas_credito)
      .where(eq(cuotas_credito.credito_id, creditoId));
    console.log("  ✅ Cuotas eliminadas");
  });

  console.log(`✅ Limpieza completada para crédito_id=${creditoId}`);

  // ═══════════════════════════════════════════════════════════════
  // 5️⃣ PROCESAMIENTO DE CUOTA 0 (PAGO INICIAL)
  // ═══════════════════════════════════════════════════════════════
  if (primeraTransaccion) {
    console.log(
      "\n┌─────────────────────────────────────────────────────────────"
    );
    console.log("│ 5️⃣ PROCESANDO CUOTA 0 (PAGO INICIAL)");
    console.log(
      "└─────────────────────────────────────────────────────────────"
    );

    console.log("🔍 Buscando detalle ROYALTY...");
    console.log(
      "  • Total detalles:",
      primeraTransaccion.EstadoCuenta_Detalles?.length
    );

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

    const porcentaje_interes = toBigExcel(
      credito?.porcentaje_interes,
      "1.5"
    ).div(100);
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
      fecha_pago: new Date(primeraTransaccion.CrMoFeTrx), // 👈 Cuota 0 siempre está pagada
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
      fecha_boleta:new Date(primeraTransaccion.CrMoFeTrx).toISOString(),
      monto_aplicado: "0.00",
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
  // 6️⃣ PREPARACIÓN DE CUOTAS PARA INSERCIÓN BATCH
  // ═══════════════════════════════════════════════════════════════
  console.log(
    "\n┌─────────────────────────────────────────────────────────────"
  );
  console.log("│ 6️⃣ PREPARANDO CUOTAS PARA BATCH INSERT");
  console.log("└─────────────────────────────────────────────────────────────");

  const cuotasParaInsertar = cuotas.map((c, idx) => {
    const numeroCuota = Number(c.CapitalNumeroCuota )>0 ? Number(c.CapitalNumeroCuota) : Number(c.InteresNumeroCuota);
    console.log(`\n🔍 Calculando número de cuota para cuota índice ${idx}:`);
    console.log(c.CapitalNumeroCuota, c.InteresNumeroCuota);

    console.log(`\n🔍 Procesando cuota ${idx + 1}/${cuotas.length}:`)
    ;
    const isPagado = c.CapitalPagado === "S" && c.InteresPagado === "S";

    // 📅 Ajustar fecha de vencimiento según día de corte
    const fechaOriginal = new Date(c.Fecha);
    const fechaVencimiento = new Date(fechaOriginal);
    fechaVencimiento.setDate(diaVencimiento);

    if (idx < 3 || idx >= cuotas.length - 2) {
      console.log(`\n  📋 Cuota ${idx + 1}/${cuotas.length}:`);
      console.log(`    • InteresNumeroCuota: ${c.InteresNumeroCuota}`);
      console.log(`    • Número cuota calculado: ${numeroCuota}`);
      console.log(`    • Fecha original SIFCO: ${c.Fecha}`);
      console.log(`    • Fecha vencimiento ajustada: ${fechaVencimiento.toISOString().split("T")[0]}`);
      console.log(`    • CapitalPagado: ${c.CapitalPagado}`);
      console.log(`    • InteresPagado: ${c.InteresPagado}`);
      console.log(`    • isPagado: ${isPagado}`);
    } else if (idx === 3) {
      console.log(`\n  ... (${cuotas.length - 4} cuotas más) ...`);
    }

    return {
      credito_id: creditoId,
      numero_cuota: numeroCuota,
      fecha_vencimiento: fechaVencimiento.toISOString(), // 👈 Fecha ajustada al día de corte
      pagado: isPagado,
    };
  });

  console.log(
    `\n✅ Preparadas ${cuotasParaInsertar.length} cuotas para inserción`
  );

  // ═══════════════════════════════════════════════════════════════
  // 7️⃣ INSERCIÓN BATCH DE CUOTAS
  // ═══════════════════════════════════════════════════════════════
  console.log(
    "\n┌─────────────────────────────────────────────────────────────"
  );
  console.log("│ 7️⃣ INSERTANDO CUOTAS EN BATCH");
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
  // 8️⃣ PREPARACIÓN DE PAGOS
  // ═══════════════════════════════════════════════════════════════
  console.log(
    "\n┌─────────────────────────────────────────────────────────────"
  );
  console.log("│ 8️⃣ PREPARANDO PAGOS PARA BATCH INSERT");
  console.log("└─────────────────────────────────────────────────────────────");

  const seguroDb = toBig(credito?.seguro_10_cuotas ?? 0);
  const membresiaDb = toBig(credito?.membresias ?? 0);

  console.log("💰 Valores base para cálculos:");
  console.log("  • Seguro DB:", seguroDb.toString());
  console.log("  • Membresía DB:", membresiaDb.toString());

  const pagosParaInsertar = cuotas.map((c, idx) => {
    const cuotaDB = cuotasInsertadas[idx];

    if (idx < 3 || idx >= cuotas.length - 2) {
      console.log(
        `\n  🧮 Procesando pago ${idx + 1}/${cuotas.length} (cuota_id: ${cuotaDB.cuota_id}):`
      );
    } else if (idx === 3) {
      console.log(`\n  ... (procesando ${cuotas.length - 4} pagos más) ...`);
    }

    // Cálculos de abonos
    const abonoCapital = toBig(c.CapitalAbonado);
    const interesAbonadoTotal = toBig(c.InteresAbonado);
    const base = interesAbonadoTotal.div(1.12);
    const abonoInteres = base.round(2, Big.roundHalfUp);
    const abonoIva12 = interesAbonadoTotal
      .minus(abonoInteres)
      .round(2, Big.roundHalfUp);

    if (idx < 3 || idx >= cuotas.length - 2) {
      console.log(
        `    • CapitalAbonado: ${c.CapitalAbonado} → ${abonoCapital.toString()}`
      );
      console.log(
        `    • InteresAbonado: ${c.InteresAbonado} → ${abonoInteres.toString()}`
      );
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
        console.log(
          `    • OtrosMonto: ${otrosMonto.toString()} = Seguro + Membresía`
        );
        console.log(`    • Abono Seguro: ${abonoSeguro.toString()}`);
      }
    } else if (otrosMonto.gt(0)) {
      if (idx < 3 || idx >= cuotas.length - 2) {
        console.log(
          `    • OtrosMonto: ${otrosMonto.toString()} (no coincide con seguro+membresía)`
        );
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
      c.InteresMonto && toBig(c.InteresMonto).gt(0)
        ? toBig(c.InteresMonto)
        : new Big(0);
    const capital_restante_big =
      c.CapitalMonto && toBig(c.CapitalMonto).gt(0)
        ? toBig(c.CapitalMonto)
        : new Big(0);
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

    // 📅 Calcular fecha de vencimiento ajustada para el pago
    const fechaOriginal = new Date(c.Fecha);
    const fechaVencimientoPago = new Date(fechaOriginal);
    fechaVencimientoPago.setDate(diaVencimiento);

    if (idx < 3 || idx >= cuotas.length - 2) {
      console.log(`    • isPagado: ${isPagado}`);
      console.log(`    • Mes: ${mesNombre}`);
      console.log(`    • Fecha pago: ${isPagado ? fechaVencimientoPago.toISOString().split("T")[0] : "null"}`);
      console.log(
        `    • Validation Status: ${isPagado ? "validated" : "no_required"}`
      );
    }

    return {
      cuota_id: cuotaDB.cuota_id,
      credito_id: creditoId,
      cuota_interes: abonoInteres.toString(),
      cuota: credito?.cuota?.toString() || "0.00",
      fecha_pago: isPagado ? fechaVencimientoPago : null, // 👈 Solo si está pagada
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
      fecha_vencimiento: fechaVencimientoPago.toISOString(), // 👈 Fecha ajustada
      renuevo_o_nuevo: "",
      capital_restante: isPagado ? "0.00" : capital_restante_big.toString(),
      interes_restante: isPagado ? "0.00" : interes_restante_big.toString(),
      iva_12_restante: isPagado ? "0.00" : iva_12_restante_big.toString(),
      seguro_restante: isPagado ? "0.00" : seguroDb.toString(),
      gps_restante: "0.00",
      total_restante: "0.00",
      membresias: credito?.membresias,
      membresias_pago: isPagado && credito?.membresias
        ? credito?.membresias.toString()
        : "0.00",
      membresias_mes: isPagado && credito?.membresias
        ? credito?.membresias.toString()
        : "0.00",
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
      validationStatus: isPagado
        ? ("validated" as const)
        : ("no_required" as const),
      registerBy: "SIFCO_SYNC",
      pagoConvenio: "0",
      fecha_boleta:fechaVencimientoPago.toISOString(),
      monto_aplicado: isPagado ? pagoDelMes.toString() : "0.00",
    };
  });

  console.log(
    `\n✅ Preparados ${pagosParaInsertar.length} pagos para inserción`
  );

  // ═══════════════════════════════════════════════════════════════
  // 9️⃣ INSERCIÓN BATCH DE PAGOS
  // ═══════════════════════════════════════════════════════════════
  console.log(
    "\n┌─────────────────────────────────────────────────────────────"
  );
  console.log("│ 9️⃣ INSERTANDO PAGOS EN BATCH");
  console.log("└─────────────────────────────────────────────────────────────");

  const pagosDB = await db
    .insert(pagos_credito)
    .values(pagosParaInsertar)
    .returning();

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
  // 🔟 RESUMEN FINAL
  // ═══════════════════════════════════════════════════════════════
  console.log(
    "\n╔══════════════════════════════════════════════════════════════"
  );
  console.log("║ ✅ MAPPER COMPLETADO");
  console.log(
    "╠══════════════════════════════════════════════════════════════"
  );
  console.log("║ 📊 Resumen:");
  console.log(`║   • Crédito ID: ${creditoId}`);
  console.log(`║   • Cuotas procesadas: ${cuotasInsertadas.length}`);
  console.log(`║   • Pagos insertados: ${pagosDB.length}`);
  console.log(`║   • Cuota 0 creada: ${primeraTransaccion ? "Sí" : "No"}`);
  console.log(`║   • Día de vencimiento: ${diaVencimiento}`);

  const pagados = pagosDB.filter((p) => p.pagado).length;
  const pendientes = pagosDB.filter((p) => !p.pagado).length;
  console.log(`║   • Pagos realizados: ${pagados}`);
  console.log(`║   • Pagos pendientes: ${pendientes}`);
  console.log(
    "╚══════════════════════════════════════════════════════════════\n"
  );

  return pagosDB;
}

/**
 * Crea cuotas y pagos para un crédito SIN ir a SIFCO.
 * Usa la info financiera de la DB y la cantidad de cuotas pagadas (hastaCuota)
 * que viene del JSON resultado_ultimos_pagos.json.
 *
 * Reemplaza: mapPagosPorCreditos + marcarCuotasPagadasHastaNumero
 */
export async function mapPagosDesdeJson(
  numeroSifco: string,
  hastaCuota: number,
  fechaPagoJson?: string
) {
  console.log(
    "╔══════════════════════════════════════════════════════════════"
  );
  console.log("║ 🚀 INICIO mapPagosDesdeJson (sin SIFCO)");
  console.log(
    "╚══════════════════════════════════════════════════════════════"
  );
  console.log(`  • numeroSifco: ${numeroSifco}`);
  console.log(`  • hastaCuota: ${hastaCuota}`);

  // ═══════════════════════════════════════════════════════════════
  // 1️⃣ CONSULTA DE CRÉDITO EN DB
  // ═══════════════════════════════════════════════════════════════
  const creditoDB = await db.query.creditos.findFirst({
    where: eq(creditos.numero_credito_sifco, numeroSifco),
    columns: {
      credito_id: true,
      seguro_10_cuotas: true,
      membresias: true,
      membresias_pago: true,
      cuota: true,
      cuota_interes: true,
      iva_12: true,
      capital: true,
      deudatotal: true,
      porcentaje_interes: true,
      gps: true,
      fecha_creacion: true,
      plazo: true,
    },
  });

  if (!creditoDB) {
    throw new Error(`Crédito ${numeroSifco} no encontrado en DB`);
  }

  const creditoId = creditoDB.credito_id;
  const plazo = Number(creditoDB.plazo ?? 0);
  const cuotaAmount = toBig(creditoDB.cuota);
  const capitalInicial = toBig(creditoDB.capital);
  const porcentajeInteres = toBig(creditoDB.porcentaje_interes).div(100);
  const seguroDb = toBig(creditoDB.seguro_10_cuotas);
  const gpsDb = toBig(creditoDB.gps);
  const membresiaDb = toBig(creditoDB.membresias_pago ?? creditoDB.membresias);

  console.log(`  ✅ Crédito encontrado (ID: ${creditoId})`);
  console.log(`  💰 Capital: ${capitalInicial} | Cuota: ${cuotaAmount} | Plazo: ${plazo}`);
  console.log(`  📊 Seguro: ${seguroDb} | GPS: ${gpsDb} | Membresía: ${membresiaDb}`);

  // ═══════════════════════════════════════════════════════════════
  // 2️⃣ DETERMINAR DÍA DE VENCIMIENTO (desde JSON "pago")
  // ═══════════════════════════════════════════════════════════════
  // fechaCreacion: si hay fecha del JSON, usar esa; sino, la de la DB
  const fechaCreacion = fechaPagoJson
    ? new Date(fechaPagoJson)
    : new Date(creditoDB.fecha_creacion);

  const diaVencimiento = fechaCreacion.getDate();

  console.log(`  📅 Fecha base: ${fechaCreacion.toISOString().split("T")[0]} (${fechaPagoJson ? "desde JSON" : "desde DB"})`);
  console.log(`  🎯 Día vencimiento: ${diaVencimiento}`);

  console.log(`  🎯 Día vencimiento: ${diaVencimiento}`);

  // ═══════════════════════════════════════════════════════════════
  // 3️⃣ LIMPIEZA DE DATOS PREVIOS
  // ═══════════════════════════════════════════════════════════════
  await db.transaction(async (tx) => {
    const pagosDelCredito = await tx
      .select({ pago_id: pagos_credito.pago_id })
      .from(pagos_credito)
      .where(eq(pagos_credito.credito_id, creditoId));
    const pagoIds = pagosDelCredito.map((p) => p.pago_id);

    if (pagoIds.length > 0) {
      console.log("  🗑️  Eliminando boletas...");
      await tx.delete(boletas).where(inArray(boletas.pago_id, pagoIds));
      console.log("  🗑️  Eliminando pagos inversionistas...");
      await tx.delete(pagos_credito_inversionistas).where(inArray(pagos_credito_inversionistas.pago_id, pagoIds));
    }

    console.log("  🗑️  Eliminando pagos previos...");
    await tx
      .delete(pagos_credito)
      .where(eq(pagos_credito.credito_id, creditoId));
    console.log("  🗑️  Eliminando cuotas previas...");
    await tx
      .delete(cuotas_credito)
      .where(eq(cuotas_credito.credito_id, creditoId));
  });
  console.log(`  ✅ Limpieza completada para crédito_id=${creditoId}`);

  // ═══════════════════════════════════════════════════════════════
  // 4️⃣ CREAR CUOTA 0 (DESEMBOLSO)
  // ═══════════════════════════════════════════════════════════════
  const cuota0 = await db
    .insert(cuotas_credito)
    .values({
      credito_id: creditoId,
      numero_cuota: 0,
      fecha_vencimiento: fechaCreacion.toISOString(),
      pagado: true,
    })
    .returning();

  console.log(`  ✅ Cuota 0 creada (ID: ${cuota0[0]?.cuota_id})`);

  // Pago 0 (registro inicial)
  const cuotaInteres0 = capitalInicial.times(porcentajeInteres).round(2);
  const iva12_0 = cuotaInteres0.times(0.12).round(2);
  const reserva = seguroDb.plus(600);
  const deudaTotal = capitalInicial
    .plus(cuotaInteres0)
    .plus(iva12_0)
    .plus(seguroDb)
    .plus(gpsDb)
    .plus(membresiaDb)
    .round(2);

  await db.insert(pagos_credito).values({
    credito_id: creditoId,
    cuota: cuotaAmount.toString(),
    cuota_interes: cuotaInteres0.toString(),
    cuota_id: cuota0[0].cuota_id,
    fecha_pago: fechaCreacion,
    abono_capital: "0.00",
    abono_interes: cuotaInteres0.toString(),
    abono_iva_12: iva12_0.toString(),
    abono_interes_ci: "0.00",
    abono_iva_ci: "0.00",
    abono_seguro: seguroDb.toString(),
    abono_gps: "0.00",
    pago_del_mes: "0.00",
    llamada: "pago 0",
    monto_boleta: "0.00",
    fecha_vencimiento: fechaCreacion.toISOString(),
    renuevo_o_nuevo: "",
    capital_restante: capitalInicial.toString(),
    interes_restante: "0.00",
    iva_12_restante: "0.00",
    seguro_restante: "0.00",
    gps_restante: "0.00",
    total_restante: deudaTotal.toString(),
    membresias: membresiaDb.toString(),
    membresias_pago: membresiaDb.toString(),
    membresias_mes: membresiaDb.toString(),
    otros: "",
    mora: "0.00",
    monto_boleta_cuota: "0.00",
    seguro_total: seguroDb.toString(),
    pagado: true,
    facturacion: "si",
    mes_pagado: "",
    seguro_facturado: seguroDb.toString(),
    gps_facturado: "0.00",
    reserva: reserva.toFixed(2),
    observaciones: "pago inicial (desde JSON)",
    paymentFalse: false,
    validationStatus: "validated" as const,
    registerBy: "JSON_SYNC",
    pagoConvenio: "0",
    fecha_boleta: fechaCreacion.toISOString(),
    monto_aplicado: "0.00",
  });

  console.log("  ✅ Pago 0 insertado");

  // ═══════════════════════════════════════════════════════════════
  // 5️⃣ CREAR CUOTAS 1 AL PLAZO
  // ═══════════════════════════════════════════════════════════════
  const cuotasData = [];
  for (let i = 1; i <= plazo; i++) {
    const anioBase = fechaCreacion.getFullYear();
    const mesBase = fechaCreacion.getMonth() + i; // JS maneja overflow de meses automáticamente

    // Último día del mes destino (ej: Feb → 28/29)
    const ultimoDiaMes = new Date(anioBase, mesBase + 1, 0).getDate();
    // Clamp: si diaVencimiento=30 y es Feb, usa 28
    const diaReal = Math.min(diaVencimiento, ultimoDiaMes);

    const fechaVencimiento = new Date(anioBase, mesBase, diaReal);

    cuotasData.push({
      credito_id: creditoId,
      numero_cuota: i,
      fecha_vencimiento: fechaVencimiento.toISOString(),
      pagado: i <= hastaCuota,
    });
  }

  const cuotasInsertadas = await db
    .insert(cuotas_credito)
    .values(cuotasData)
    .returning();

  console.log(`  ✅ ${cuotasInsertadas.length} cuotas insertadas (${hastaCuota} pagadas, ${cuotasInsertadas.length - hastaCuota} pendientes)`);

  // ═══════════════════════════════════════════════════════════════
  // 6️⃣ CREAR PAGOS CON AMORTIZACIÓN LOCAL
  // ═══════════════════════════════════════════════════════════════
  let capitalEnMemoria = capitalInicial;
  const pagosData = [];

  for (let idx = 0; idx < cuotasInsertadas.length; idx++) {
    const cuotaDB = cuotasInsertadas[idx];
    const numeroCuota = cuotaDB.numero_cuota;
    const isPagado = numeroCuota <= hastaCuota;

    // Amortización: interés sobre capital restante
    const interesMes = capitalEnMemoria.times(porcentajeInteres).round(2);
    const ivaMes = interesMes.times(0.12).round(2);
    const montosExtras = interesMes
      .plus(ivaMes)
      .plus(seguroDb)
      .plus(gpsDb)
      .plus(membresiaDb);
    const abonoCapital = cuotaAmount.minus(montosExtras).round(2);

    capitalEnMemoria = capitalEnMemoria.minus(abonoCapital);
    if (capitalEnMemoria.lt(0)) capitalEnMemoria = new Big(0);

    const pagoDelMes = isPagado
      ? abonoCapital.plus(interesMes).plus(ivaMes).plus(seguroDb).plus(gpsDb).plus(membresiaDb)
      : new Big(0);

    const fechaVencimientoCuota = new Date(cuotaDB.fecha_vencimiento);
    const mesNombre = fechaVencimientoCuota
      .toLocaleDateString("es-ES", { month: "long" })
      .replace(/^\w/, (ch) => ch.toUpperCase());

    if (idx < 3 || idx >= cuotasInsertadas.length - 2) {
      console.log(
        `  📝 Cuota ${numeroCuota}: capital=${capitalEnMemoria.round(2)} | abonoK=${abonoCapital} | interes=${interesMes} | pagado=${isPagado}`
      );
    } else if (idx === 3) {
      console.log(`  ... (${cuotasInsertadas.length - 4} cuotas más) ...`);
    }

    pagosData.push({
      cuota_id: cuotaDB.cuota_id,
      credito_id: creditoId,
      cuota: cuotaAmount.toString(),
      cuota_interes: interesMes.toString(),
      fecha_pago: isPagado ? fechaVencimientoCuota : null,
      abono_capital: isPagado ? abonoCapital.toString() : "0.00",
      abono_interes: isPagado ? interesMes.toString() : "0.00",
      abono_iva_12: isPagado ? ivaMes.toString() : "0.00",
      abono_interes_ci: "0.00",
      abono_iva_ci: "0.00",
      abono_seguro: isPagado ? seguroDb.toString() : "0.00",
      abono_gps: "0.00",
      pago_del_mes: pagoDelMes.toString(),
      llamada: "",
      monto_boleta: isPagado ? pagoDelMes.toString() : "0.00",
      fecha_vencimiento: fechaVencimientoCuota.toISOString(),
      renuevo_o_nuevo: "",
      capital_restante: capitalEnMemoria.round(2).toString(),
      interes_restante: isPagado ? "0.00" : interesMes.toString(),
      iva_12_restante: isPagado ? "0.00" : ivaMes.toString(),
      seguro_restante: isPagado ? "0.00" : seguroDb.toString(),
      gps_restante: "0.00",
      total_restante: capitalEnMemoria.round(2).toString(),
      membresias: membresiaDb.toString(),
      membresias_pago: membresiaDb.toString(),
      membresias_mes: membresiaDb.toString(),
      otros: "",
      mora: "0.00",
      monto_boleta_cuota: isPagado ? pagoDelMes.toString() : "0.00",
      seguro_total: seguroDb.toString(),
      pagado: isPagado,
      facturacion: "si",
      mes_pagado: isPagado ? mesNombre : "",
      seguro_facturado: seguroDb.toString(),
      gps_facturado: "0.00",
      reserva: "0.00",
      observaciones: `pago sincronizado desde JSON cuota ${numeroCuota}`,
      paymentFalse: false,
      validationStatus: isPagado
        ? ("validated" as const)
        : ("no_required" as const),
      registerBy: "JSON_SYNC",
      pagoConvenio: "0",
      fecha_boleta: fechaVencimientoCuota.toISOString(),
      monto_aplicado: isPagado ? pagoDelMes.toString() : "0.00",
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // 7️⃣ INSERCIÓN BATCH DE PAGOS
  // ═══════════════════════════════════════════════════════════════
  const pagosInsertados = await db
    .insert(pagos_credito)
    .values(pagosData)
    .returning();

  const pagados = pagosInsertados.filter((p) => p.pagado).length;
  const pendientes = pagosInsertados.filter((p) => !p.pagado).length;

  console.log(
    "╔══════════════════════════════════════════════════════════════"
  );
  console.log("║ ✅ mapPagosDesdeJson COMPLETADO");
  console.log(
    "╠══════════════════════════════════════════════════════════════"
  );
  console.log(`║   • Crédito: ${numeroSifco} (ID: ${creditoId})`);
  console.log(`║   • Cuotas creadas: ${cuotasInsertadas.length}`);
  console.log(`║   • Pagos insertados: ${pagosInsertados.length}`);
  console.log(`║   • Pagados: ${pagados} | Pendientes: ${pendientes}`);
  console.log(`║   • Hasta cuota: ${hastaCuota}`);
  console.log(
    "╚══════════════════════════════════════════════════════════════\n"
  );

  return pagosInsertados;
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

    console.log(
      `🚀 Procesando inversionistas para crédito SIFCO=${credito.numero_credito_sifco}`
    );

    // 3. Obtener filas desde Excel
    const rows = await leerCreditoPorNumeroSIFCO(
      excelPath,
      credito.numero_credito_sifco
    );
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
          porcentaje_participacion_inversionista:
            porcentajeInversion.toString(),
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
              porcentaje_participacion_inversionista: sql`EXCLUDED.porcentaje_participacion_inversionista`,
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
        console.error(
          `❌ Error procesando fila crédito=${credito.numero_credito_sifco}`,
          err
        );
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






// ============================================
// 🔧 HELPERS PARA NORMALIZACIÓN Y MATCHING
// ============================================

/**
 * Normaliza un nombre para comparación
 * - Quita acentos
 * - Convierte a minúsculas
 * - Normaliza espacios
 * - Normaliza abreviaturas comunes (S.A., C.A., etc)
 */
function normalizarNombre(nombre: string): string {
  return nombre
    .toLowerCase()
    .normalize("NFD") // Separar acentos de las letras
    .replace(/[\u0300-\u036f]/g, "") // Remover acentos
    .replace(/[.,\-_]/g, " ") // Puntos, comas, guiones → espacios
    .replace(/\s+/g, " ") // Múltiples espacios → uno solo
    .replace(/\bs\.?\s?a\.?\b/gi, "sa") // "S.A." o "S A" → "sa"
    .replace(/\bs\.?\s?a\.?\s?c\.?\s?v\.?\b/gi, "sacv") // "S.A.C.V." → "sacv"
    .replace(/\bc\.?\s?a\.?\b/gi, "ca") // "C.A." → "ca"
    .replace(/\bltda\.?\b/gi, "ltda") // "Ltda." → "ltda"
    .replace(/\binvestment[s]?\b/gi, "investment") // Normalizar plural
    .trim();
}

/**
 * Calcula similitud entre dos strings
 * Retorna un valor entre 0.0 (nada similar) y 1.0 (idéntico)
 */
function calcularSimilitud(str1: string, str2: string): number {
  const norm1 = normalizarNombre(str1);
  const norm2 = normalizarNombre(str2);
  
  // Si son iguales después de normalizar → 100%
  if (norm1 === norm2) return 1.0;
  
  // Si uno contiene al otro → 90%
  if (norm1.includes(norm2) || norm2.includes(norm1)) return 0.9;
  
  // Calcular similitud básica por palabras
  const palabras1 = norm1.split(" ").filter(p => p.length > 2);
  const palabras2 = norm2.split(" ").filter(p => p.length > 2);
  
  if (palabras1.length === 0 || palabras2.length === 0) return 0;
  
  let coincidencias = 0;
  for (const p1 of palabras1) {
    for (const p2 of palabras2) {
      if (p1 === p2 || p1.includes(p2) || p2.includes(p1)) {
        coincidencias++;
        break;
      }
    }
  }
  
  const maxPalabras = Math.max(palabras1.length, palabras2.length);
  return maxPalabras > 0 ? coincidencias / maxPalabras : 0;
}

/**
 * Busca un inversionista de forma permisiva
 * Usa múltiples estrategias para encontrar el mejor match
 */
async function buscarInversionista(nombreBuscado: string) {
  console.log(`\n   ${"=".repeat(70)}`);
  console.log(`   🔍 BUSCANDO INVERSIONISTA`);
  console.log(`   ${"=".repeat(70)}`);
  console.log(`   📝 Nombre recibido: "${nombreBuscado}"`);
  
  const nombreNormalizado = normalizarNombre(nombreBuscado);
  console.log(`   🧹 Nombre normalizado: "${nombreNormalizado}"`);
  
  // 🎯 ESTRATEGIA 1: Match exacto (normalizado)
  console.log(`\n   📍 Estrategia 1: Match exacto normalizado...`);
  
  const todosInversionistas = await db.query.inversionistas.findMany({
    columns: { inversionista_id: true, nombre: true, dpi: true },
  });
  
  console.log(`   📊 Total inversionistas en DB: ${todosInversionistas.length}`);
  
  for (const inv of todosInversionistas) {
    if (normalizarNombre(inv.nombre) === nombreNormalizado) {
      console.log(`   ✅ MATCH EXACTO ENCONTRADO!`);
      console.log(`      ID: ${inv.inversionista_id}`);
      console.log(`      Nombre en DB: "${inv.nombre}"`);
      console.log(`      DPI: ${inv.dpi || "N/A"}`);
      console.log(`   ${"=".repeat(70)}\n`);
      return inv;
    }
  }
  
  console.log(`   ⚠️ No se encontró match exacto`);
  
  // 🎯 ESTRATEGIA 2: Match por similitud
  console.log(`\n   📍 Estrategia 2: Match por similitud...`);
  
  const candidatos = todosInversionistas
    .map(inv => ({
      ...inv,
      similitud: calcularSimilitud(nombreBuscado, inv.nombre),
    }))
    .filter(c => c.similitud >= 0.7) // Mínimo 70% de similitud
    .sort((a, b) => b.similitud - a.similitud);
  
  if (candidatos.length > 0) {
    const mejor = candidatos[0];
    console.log(`   ✅ MATCH POR SIMILITUD ENCONTRADO!`);
    console.log(`      Similitud: ${(mejor.similitud * 100).toFixed(1)}%`);
    console.log(`      ID: ${mejor.inversionista_id}`);
    console.log(`      Nombre en DB: "${mejor.nombre}"`);
    console.log(`      DPI: ${mejor.dpi || "N/A"}`);
    
    if (candidatos.length > 1) {
      console.log(`\n      💡 Otros candidatos encontrados:`);
      candidatos.slice(1, 4).forEach((c, idx) => {
        console.log(`         ${idx + 2}. (${(c.similitud * 100).toFixed(1)}%) "${c.nombre}"`);
      });
    }
    
    console.log(`   ${"=".repeat(70)}\n`);
    return mejor;
  }
  
  console.log(`   ⚠️ No se encontró match por similitud (>=70%)`);
  
  // 🎯 ESTRATEGIA 3: Match parcial con palabras clave
  console.log(`\n   📍 Estrategia 3: Match parcial por palabras clave...`);
  
  const palabrasClave = nombreNormalizado
    .split(" ")
    .filter(p => p.length > 3)
    .slice(0, 3); // Máximo 3 palabras
  
  console.log(`   🔑 Palabras clave extraídas: [${palabrasClave.join(", ")}]`);
  
  if (palabrasClave.length > 0) {
    const matchesParciales = todosInversionistas.filter(inv => {
      const nombreInvNorm = normalizarNombre(inv.nombre);
      return palabrasClave.some(palabra => nombreInvNorm.includes(palabra));
    });
    
    if (matchesParciales.length > 0) {
      console.log(`   💡 ${matchesParciales.length} inversionista(s) encontrado(s) con palabras clave:`);
      matchesParciales.slice(0, 5).forEach((inv, idx) => {
        console.log(`      ${idx + 1}. "${inv.nombre}"`);
      });
      
      // Tomar el primero
      const inv = matchesParciales[0];
      console.log(`\n   ⚠️ USANDO PRIMER MATCH PARCIAL (puede no ser exacto):`);
      console.log(`      ID: ${inv.inversionista_id}`);
      console.log(`      Nombre: "${inv.nombre}"`);
      console.log(`   ${"=".repeat(70)}\n`);
      return inv;
    }
  }
  
  // ❌ NO SE ENCONTRÓ NADA
  console.log(`\n   ❌ NO SE ENCONTRÓ NINGÚN MATCH`);
  console.log(`   ${"=".repeat(70)}`);
  console.log(`   📋 INFORMACIÓN DE DEBUG:`);
  console.log(`   ${"=".repeat(70)}`);
  console.log(`   📝 Nombre buscado: "${nombreBuscado}"`);
  console.log(`   🧹 Normalizado: "${nombreNormalizado}"`);
  console.log(`   🔑 Palabras clave: [${palabrasClave.join(", ")}]`);
  console.log(`\n   💡 Primeros 10 inversionistas en DB:`);
  
  todosInversionistas.slice(0, 10).forEach((inv, idx) => {
    const similitud = calcularSimilitud(nombreBuscado, inv.nombre);
    console.log(`      ${idx + 1}. (${(similitud * 100).toFixed(1)}%) "${inv.nombre}"`);
  });
  
  console.log(`   ${"=".repeat(70)}\n`);
  
  return null;
}

 

// ============================================
// 🚀 FUNCIÓN PRINCIPAL
// ============================================


export async function fillPagosInversionistasV2(
  numeroCredito: string,
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
  console.log("\n");
  console.log("=".repeat(80));
  console.log("🚀 PROCESANDO PAGOS A INVERSIONISTAS");
  console.log("=".repeat(80));
  console.log(`📋 Crédito: "${numeroCredito}"`);
  console.log(`👥 Total inversionistas: ${inversionistasData.length}`);
  console.log("=".repeat(80));

  // Mostrar ejemplo
  if (inversionistasData.length > 0) {
    console.log(`\n📝 Ejemplo primer inversionista:`);
    console.log(JSON.stringify(inversionistasData[0], null, 2));
  }

  // Limpiar número de crédito
  const numeroCreditoLimpio = numeroCredito
    .toString()
    .trim()
    .replace(/\s+/g, "");
  
  console.log(`\n🧹 Número limpio: "${numeroCreditoLimpio}"`);

  // ============================================
  // 1️⃣ BUSCAR CRÉDITO
  // ============================================
  console.log("\n" + "=".repeat(80));
  console.log("1️⃣ BUSCANDO CRÉDITO EN DB");
  console.log("=".repeat(80));

  const credito = await db.query.creditos.findFirst({
    columns: { credito_id: true, numero_credito_sifco: true },
    where: (c, { eq, or, like }) =>
      or(
        eq(c.numero_credito_sifco, numeroCreditoLimpio),
        eq(c.numero_credito_sifco, numeroCredito),
        like(c.numero_credito_sifco, `%${numeroCreditoLimpio}%`),
        eq(c.numero_credito_sifco, numeroCreditoLimpio.replace(/^0+/, ""))
      ),
  });

  if (!credito) {
    console.log("\n" + "=".repeat(80));
    console.log("❌ CRÉDITO NO ENCONTRADO");
    console.log("=".repeat(80));
    console.log(`📝 Buscado: "${numeroCreditoLimpio}"`);

    // Buscar similares
    const creditosSimilares = await db.query.creditos.findMany({
      columns: { numero_credito_sifco: true, credito_id: true },
      where: (c, { like }) =>
        like(c.numero_credito_sifco, `%${numeroCreditoLimpio.slice(-8)}%`),
      limit: 10,
    });

    if (creditosSimilares.length > 0) {
      console.log(`\n💡 Créditos similares (últimos 8 dígitos):`);
      creditosSimilares.forEach((c, idx) => {
        console.log(`   ${idx + 1}. ID: ${c.credito_id} | "${c.numero_credito_sifco}"`);
      });
    }

    console.log("=".repeat(80) + "\n");

    throw new Error(
      `Crédito no encontrado: "${numeroCreditoLimpio}"`
    );
  }

  console.log(`✅ CRÉDITO ENCONTRADO:`);
  console.log(`   ID: ${credito.credito_id}`);
  console.log(`   Número: "${credito.numero_credito_sifco}"`);

  // ============================================
  // 2️⃣ PROCESAR INVERSIONISTAS
  // ============================================
  console.log("\n" + "=".repeat(80));
  console.log("2️⃣ PROCESANDO INVERSIONISTAS");
  console.log("=".repeat(80));

  let ok = 0;
  let fail = 0;
  const errores: { inversionista: string; error: string; detalles?: any }[] = [];

  for (let i = 0; i < inversionistasData.length; i++) {
    const rowData = inversionistasData[i];
    
    console.log("\n" + "─".repeat(80));
    console.log(`👤 ${i + 1}/${inversionistasData.length}: "${rowData.inversionista}"`);
    console.log("─".repeat(80));

    try {
      // Buscar inversionista
      const inv = await buscarInversionista(rowData.inversionista);

      if (!inv) {
        throw new Error(
          `Inversionista no encontrado: "${rowData.inversionista}"`
        );
      }

      // Calcular montos
      console.log(`\n   💰 CALCULANDO MONTOS...`);
      
      const montoAportado = toBigExcel(rowData.capital);
      const porcentajeCashIn = toBigExcel(rowData.porcentajeCashIn);
      const porcentajeInversion = toBigExcel(rowData.porcentajeInversionista);
      const interes = toBigExcel(rowData.porcentaje);

      console.log(`      Capital: ${montoAportado.toString()}`);
      console.log(`      % CashIn: ${porcentajeCashIn.toString()}`);
      console.log(`      % Inv: ${porcentajeInversion.toString()}`);
      console.log(`      Interés: ${interes.toString()}`);

      const cuotaInteres = montoAportado.times(interes);
      const montoInversionista = cuotaInteres.times(porcentajeInversion).toFixed(2);
      const montoCashIn = cuotaInteres.times(porcentajeCashIn).toFixed(2);

      const ivaInversionista =
        Number(montoInversionista) > 0
          ? new Big(montoInversionista).times(0.12).toFixed(2)
          : "0.00";

      const ivaCashIn =
        Number(montoCashIn) > 0
          ? new Big(montoCashIn).times(0.12).toFixed(2)
          : "0.00";

      const cuotaInv = (rowData.cuota ?? "0").toString();

      console.log(`\n      📊 RESULTADOS:`);
      console.log(`         Monto inv: ${montoInversionista}`);
      console.log(`         Monto CashIn: ${montoCashIn}`);
      console.log(`         IVA inv: ${ivaInversionista}`);
      console.log(`         IVA CashIn: ${ivaCashIn}`);

      // Registro
      const registro = {
        credito_id: credito.credito_id,
        inversionista_id: inv.inversionista_id,
        monto_aportado: montoAportado.toString(),
        porcentaje_cash_in: porcentajeCashIn.times(100).toString(),
        porcentaje_participacion_inversionista: porcentajeInversion.times(100).toString(),
        monto_inversionista: montoInversionista,
        monto_cash_in: montoCashIn,
        iva_inversionista: ivaInversionista,
        iva_cash_in: ivaCashIn,
        fecha_creacion: new Date(),
        cuota_inversionista: cuotaInv,
      };

      console.log(`\n   💾 GUARDANDO...`);

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
            porcentaje_participacion_inversionista: sql`EXCLUDED.porcentaje_participacion_inversionista`,
            monto_inversionista: sql`EXCLUDED.monto_inversionista`,
            monto_cash_in: sql`EXCLUDED.monto_cash_in`,
            iva_inversionista: sql`EXCLUDED.iva_inversionista`,
            iva_cash_in: sql`EXCLUDED.iva_cash_in`,
            cuota_inversionista: sql`EXCLUDED.cuota_inversionista`,
            fecha_creacion: sql`EXCLUDED.fecha_creacion`,
          },
        });

      console.log(`   ✅ GUARDADO`);
      ok++;
      
    } catch (err) {
      console.log("\n" + "!".repeat(80));
      console.log("❌ ERROR");
      console.log("!".repeat(80));
      console.log(`📝 Inversionista: "${rowData.inversionista}"`);
      console.log(`❌ ${err instanceof Error ? err.message : String(err)}`);
      
      if (err instanceof Error && err.stack) {
        console.log(`\n📚 Stack:`);
        console.log(err.stack);
      }
      
      console.log("!".repeat(80));
      
      errores.push({
        inversionista: rowData.inversionista,
        error: err instanceof Error ? err.message : String(err),
        detalles: {
          capital: rowData.capital,
          porcentajeCashIn: rowData.porcentajeCashIn,
          porcentajeInversionista: rowData.porcentajeInversionista,
          porcentaje: rowData.porcentaje,
        },
      });
      fail++;
    }
  }

  // ============================================
  // 🎉 RESUMEN
  // ============================================
  console.log("\n" + "=".repeat(80));
  console.log("🎉 RESUMEN");
  console.log("=".repeat(80));
  console.log(`📋 Crédito: ${numeroCredito}`);
  console.log(`👥 Total: ${inversionistasData.length}`);
  console.log(`✅ Exitosos: ${ok}`);
  console.log(`❌ Fallidos: ${fail}`);

  if (errores.length > 0) {
    console.log("\n" + "!".repeat(80));
    console.log("⚠️ ERRORES:");
    console.log("!".repeat(80));
    errores.forEach((e, idx) => {
      console.log(`\n${idx + 1}. ${e.inversionista}`);
      console.log(`   ${e.error}`);
      if (e.detalles) {
        console.log(`   Detalles:`, JSON.stringify(e.detalles, null, 2));
      }
    });
    console.log("!".repeat(80));
  }

  console.log("=".repeat(80) + "\n");

  return {
    success: ok > 0,
    credito: numeroCredito,
    exitosos: ok,
    fallidos: fail,
    total: inversionistasData.length,
    errores: errores,
  };
}