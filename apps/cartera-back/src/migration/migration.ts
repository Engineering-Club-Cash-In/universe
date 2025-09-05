import Big from "big.js";
import { ExcelCreditoRow, leerCreditoPorNumeroSIFCO } from "../services/excel";
import {
  ClienteEmail,
  EstadoCuentaTransaccion,
  PrestamoDetalle,
  WSCrEstadoCuentaResponse,
  WSInformacionPrestamoResponse,
  WSRecargosLibresResponse,
} from "../services/sifco.interface";
import {
  consultarClientesPorEmail,
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
import { eq } from "drizzle-orm";

const excelPath = path.resolve(
  "C:/Users/Kelvin Palacios/Documents/analis de datos/agosto2025.csv"
);

/**
 * Convierte un string o número en Big, limpiando %, Q, comas y guiones
 * @param value valor original
 * @param fallback valor por defecto si está vacío o inválido
 */
function toBigExcel(value: any, fallback: string | number = "0"): Big {
  if (value == null) return new Big(fallback);

  let str = String(value).trim();

  if (!str || str === "-" || str.toLowerCase() === "nan") {
    return new Big(fallback);
  }

  // quitar prefijo Q si lo hubiera
  str = str.replace(/^Q/i, "");
  // quitar %
  str = str.replace(/%/g, "");
  // quitar separadores de miles
  str = str.replace(/,/g, "");

  // si al final no es numérico, usa fallback
  if (!str || isNaN(Number(str))) {
    return new Big(fallback);
  }

  return new Big(str);
}

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

  const advisor = await findOrCreateAdvisorByName(excelRow?.Asesor || "", true);

  const realPorcentaje = porcentaje_interes.mul(100).toFixed(2);

  // ---- Retornar EXACTAMENTE el shape que inserta creditDataForInsert ----
  const creditInsert = {
    usuario_id: Number(user.usuario_id ?? 0),

    otros: toBigExcel(excelRow?.Otros, "0").toString(),
    numero_credito_sifco: toBigExcel(prestamo.PreNumero, "0").toString(),

    capital: capital.toFixed(2),
    porcentaje_interes: realPorcentaje.toString(),
    cuota_interes: cuota_interes.toFixed(2),
    cuota: excelRow?.Cuota,
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
    const [insertedCredit] = await db
      .insert(creditos)
      .values(creditInsert)
      .returning();

    const creditoId = insertedCredit.credito_id;
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
      await db
        .insert(creditos_inversionistas)
        .values(creditosInversionistasData);
    }
    return insertedCredit;
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

    // 1️⃣ Consultar clientes (SIFCO)
    const clientes = await consultarClientesPorEmail();
    console.log(
      "👥 Clientes obtenidos de SIFCO:",
      clientes?.Clientes?.length || 0
    );

    if (!clientes || !clientes.Clientes || clientes.Clientes.length === 0) {
      console.log("❌ No se encontraron clientes en SIFCO");
      return;
    }

    // Si viene un filtro, trabajamos solo con ese cliente
    const listaClientes = clienteCodigoFilter
      ? clientes.Clientes.filter(
          (c) => parseInt(c.CodigoCliente, 10) === clienteCodigoFilter
        )
      : clientes.Clientes.filter(
          (c) => parseInt(c.CodigoCliente, 10) >= 1140 // 👈 del 1140 en adelante
        );
    if (listaClientes.length === 0) {
      console.log(`❌ Cliente con código ${clienteCodigoFilter} no encontrado`);
      return;
    }

    // 🔁 Recorrer clientes uno por uno
    for (const cliente of listaClientes) {
      console.log("👤 Cliente seleccionado:", cliente);

      const clienteCodigo = parseInt(cliente.CodigoCliente, 10);

      // 2️⃣ Consultar préstamos (SIFCO)
      let prestamosResp;
      try {
        prestamosResp = await consultarPrestamosPorCliente(clienteCodigo);
      } catch (err: any) {
        console.log(
          `❌ No se pudieron obtener préstamos para el cliente ${cliente.NombreCompleto}:`,
          err?.message || err
        );
        continue; // 👈 seguir con el siguiente cliente
      }

      if (!prestamosResp?.Prestamos?.length) {
        console.log(
          `❌ El cliente ${cliente.NombreCompleto} no tiene préstamos en SIFCO`
        );
        continue;
      }

      console.log("💳 Préstamos encontrados:", prestamosResp.Prestamos);

      // 3️⃣ Iterar sobre cada préstamo
      for (const prestamo of prestamosResp.Prestamos) {
        const preNumero = prestamo.NumeroPrestamo;
        console.log(`📑 Consultando detalle del préstamo: ${preNumero}`);

        let detalle;
        try {
          detalle = await consultarPrestamoDetalle(preNumero);
        } catch (err: any) {
          console.log(
            `❌ Error al obtener detalle del préstamo ${preNumero}:`,
            err?.message || err
          );
          continue; // 👉 pasar al siguiente préstamo
        }

        if (!detalle) {
          console.log(`❌ No se obtuvo detalle válido para ${preNumero}`);
          continue;
        }
        if (detalle?.ApEstDes === "CANCELADO") {
          console.log(`❌ El préstamo ${preNumero} está cancelado`);
          continue;
        }
        if (!detalle) {
          console.log(`❌ No se pudo obtener detalle para ${preNumero}`);
          continue;
        }

        // Buscar en Excel
        const excelRow = await leerCreditoPorNumeroSIFCO(excelPath, preNumero);
        if (!excelRow || excelRow.length === 0) {
          console.log(`❌ No se encontró el préstamo ${preNumero} en el Excel`);
          continue;
        }
        const recargosLibres = await consultarRecargosLibres(preNumero);

        if (!recargosLibres) {
          console.log(
            `❌ No se pudieron obtener los recargos libres para ${preNumero}`
          );
          continue;
        }

        // Mapear directo WS + Excel → DB
        let combinado;
        try {
          combinado = await mapPrestamoDetalleToCredito(
            detalle,
            excelRow as ExcelCreditoRow[],
            cliente
          );
        } catch (err) {
          console.log(`❌ Error al mapear el préstamo ${preNumero}:`, err);
          continue; // 👈 sigue con el siguiente préstamo
        }

        if (!combinado || !combinado.credito_id) {
          console.log(
            `❌ No se pudo mapear el préstamo ${preNumero} a la base de datos`
          );
          continue;
        } else {
          console.log(
            "💾 Crédito insertado en DB con ID:",
            combinado.credito_id
          );
          continue;
        }
        //const infoPagos = await consultarInformacionPrestamo(preNumero);

        console.log("🗂️ Crédito mapeado listo para DB:", combinado.credito_id);
        return;
        await mapEstadoCuentaToPagosBig(
          infoPagos as unknown as WSCrEstadoCuentaResponse,
          Number(combinado.credito_id)
        );

        console.log(
          `✅ Flujo completado para el préstamo ${preNumero} del cliente ${cliente.NombreCompleto}`
        );
      }
    }
  } catch (err: any) {
    console.error("❌ Error en syncClienteConPrestamos:", err || err);
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
  const credito = await db.query.creditos.findFirst({
    where: eq(creditos.credito_id, creditoId),
    columns: {
      seguro_10_cuotas: true,
      membresias: true,
      cuota: true,
      cuota_interes: true,
      iva_12: true,
      capital: true,
    },
  });

  const cuotas = resp?.ConsultaResultado?.PlanPagos_Cuotas ?? [];
  const transacciones =
    resp?.ConsultaResultado?.EstadoCuenta_Transacciones ?? [];
  const primeraTransaccion: EstadoCuentaTransaccion | undefined =
    resp?.ConsultaResultado.EstadoCuenta_Transacciones?.[0];

  if (primeraTransaccion) {
    // Buscar el detalle de ROYALTY
    const detalleRoyalty = primeraTransaccion.EstadoCuenta_Detalles.find(
      (d) => d.ApSalDes === "ROYALTY"
    );
    const royaltiValor = toBig(detalleRoyalty?.CrMoDeValor ?? 0);
    // 1️⃣ Insertar el pago 0
    const cuota0 = await db
      .insert(cuotas_credito)
      .values({
        credito_id: creditoId,
        numero_cuota: 0,
        fecha_vencimiento: new Date(primeraTransaccion.CrMoFeVal).toISOString(),
        pagado: true,
      })
      .returning();
    const reserva = new Big(credito?.seguro_10_cuotas ?? "0").plus(600);
    const pago0 = {
      credito_id: creditoId,
      cuota: credito?.cuota?.toString() ?? "0.00",
      cuota_interes: credito?.cuota_interes?.toString() ?? "0.00",
      cuota_id: cuota0[0]?.cuota_id ?? null,
      fecha_pago: new Date(primeraTransaccion.CrMoFeTrx).toISOString(),
      abono_capital: "0.00",
      abono_interes: credito?.cuota_interes?.toString() ?? "0.00",
      abono_iva_12: credito?.iva_12?.toString() ?? "0.00",
      abono_interes_ci: "0.00",
      abono_iva_ci: "0.00",
      abono_seguro: credito?.seguro_10_cuotas?.toString() ?? "0.00",
      abono_gps: "0.00",
      pago_del_mes: "0.00",
      llamada: "pago 0",
      monto_boleta: "0.00",
      fecha_filtro: new Date(primeraTransaccion.CrMoFeTrx).toISOString(),
      renuevo_o_nuevo: "",
      capital_restante: credito?.capital?.toString() ?? "0.00",
      interes_restante: "0.00",
      iva_12_restante: "0.00",
      seguro_restante: "0.00",
      gps_restante: "0.00",
      total_restante: "0.00",
      membresias: credito?.membresias ? Number(credito.membresias) : 0,
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

    // 2️⃣ Update del crédito con el valor de royalty
    if (royaltiValor.gt(0)) {
      await db
        .update(creditos)
        .set({ royalti: royaltiValor.toString() })
        .where(eq(creditos.credito_id, creditoId));
    }
  }
  const promiseResults = await Promise.all(
    cuotas.map(async (c) => {
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
      // Capital
      const abonoCapital = toBig(c.CapitalAbonado);

      // Interés (SIFCO suele traerlo con IVA incluido)
      const interesAbonadoTotal = toBig(c.InteresAbonado);
      let abonoInteres = new Big(0);
      let abonoIva12 = new Big(0);

      const base = interesAbonadoTotal.div(1.12);
      abonoInteres = base.round(2, Big.roundHalfUp);
      abonoIva12 = interesAbonadoTotal
        .minus(abonoInteres)
        .round(2, Big.roundHalfUp);

      // Mora pagada
      const moraCapPag = toBig(c.CapitalMoraValorPagado);
      const moraIntPag = toBig(c.InteresMoraValorPagado);
      const moraTotal = moraCapPag.plus(moraIntPag);
      const seguroDb = toBig(credito?.seguro_10_cuotas ?? 0);
      const membresiaDb = toBig(credito?.membresias ?? 0);

      // 👇 Validar que OtrosMonto = seguro + membresia
      const otrosMonto = toBig(c.OtrosMonto);
      let abonoSeguro = new Big(0);

      if (otrosMonto.eq(seguroDb.plus(membresiaDb))) {
        abonoSeguro = seguroDb;
      } else {
        abonoSeguro = new Big(0); // si no cuadra, seguro = 0
      }

      // Total pagado del mes (sin doble conteo):
      const pagoDelMes = abonoCapital
        .plus(abonoInteres)
        .plus(abonoIva12)
        .plus(moraTotal)
        .plus(otrosMonto);

      const pagado = c.CapitalPagado === "S" && c.InteresPagado === "S";
      const capitalActual = getSaldoCapitalMatch(c.Fecha);
      return {
        cuota_id: cuotadB[0].cuota_id,
        cuota_interes: abonoInteres.toString(),
        cuota: credito?.cuota?.toString() || "0.00", // Ensure a non-undefined value
        // acá puedes resolver cuota_id si ya la insertaste antes
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
        membresias: Number(credito?.membresias) || 0,
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
        pagado,
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
  // Ensure we're spreading each object in the array, not the array itself
  const pagosDB = await db
    .insert(pagos_credito)
    .values(promiseResults)
    .returning();
  return pagosDB;
  function getSaldoCapitalMatch(fechaCuota: string): string {
    const cuotaDate = new Date(fechaCuota);
    const mes = cuotaDate.getMonth();
    const año = cuotaDate.getFullYear();

    for (const trx of transacciones) {
      const trxDate = new Date(trx.CrMoFeTrx);
      if (trxDate.getMonth() === mes && trxDate.getFullYear() === año) {
        return trx.SaldoCapital; // 👈 usamos el campo directo
      }
    }
    return "0.00"; // si no encuentra
  }
}
