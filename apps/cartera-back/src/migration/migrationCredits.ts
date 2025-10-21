import Big from "big.js";
import { eq } from "drizzle-orm";
import { findOrCreateAdvisorByName } from "../controllers/advisor";
import { findOrCreateUserByName } from "../controllers/users";
import { db } from "../database";
import { creditos, creditos_inversionistas } from "../database/db";
import {
  CreditoAgrupado,
  ExcelCreditoRow,
  listarCreditosAgrupados,
} from "../services/excel";
import { PrestamoDetalle } from "../services/sifco.interface";
import { mapInversionistas } from "./migration";
import { toBigExcel } from "../utils/functions/generalFunctions";
import { consultarPrestamoDetalle } from "../services/sifcoIntegrations";

import fs from "fs";
import path from "path";
import { stringify } from "csv-stringify/sync";
type ResultadoCredito = {
  creditoBase: string;
  cliente: string;
  status: "insertado" | "actualizado" | "fallido" | "no_encontrado";
  error?: string;
};

export async function listarCreditosConDetalle(filePath: string) {
  const agrupados = await listarCreditosAgrupados(filePath);
  const resumen: ResultadoCredito[] = [];
  const results = [];

  for (const credito of agrupados) {
    try {
      console.log(`🔎 Procesando crédito ${credito.creditoBase}...`);
      const detalle = await consultarPrestamoDetalle(credito.creditoBase);

      // 🔥 Si no hay detalle, saltar
      if (!detalle) {
        console.warn(`⏭️ Saltando ${credito.creditoBase} - no disponible en SIFCO`);
        resumen.push({
          creditoBase: credito.creditoBase,
          cliente: credito.cliente,
          status: "no_encontrado",
          error: "No disponible en SIFCO o timeout",
        });
        results.push({ ...credito, detalle: null, dbRow: null });
        continue;
      }

      // ✅ Procesar normalmente
      try {
        const dbRow = await mapExcelToCredito(detalle, credito);
        const status = new Date().getTime() - dbRow.fecha_creacion.getTime() < 60000
          ? "insertado"
          : "actualizado";

        console.log(`✅ Crédito ${credito.creditoBase} ${status} (ID: ${dbRow.credito_id})`);
        resumen.push({
          creditoBase: credito.creditoBase,
          cliente: credito.cliente,
          status,
        });
        results.push({ ...credito, detalle, dbRow });
      } catch (err: any) {
        console.error(`❌ Error al insertar ${credito.creditoBase}:`, err.message);
        resumen.push({
          creditoBase: credito.creditoBase,
          cliente: credito.cliente,
          status: "fallido",
          error: String(err?.message || err),
        });
        results.push({ ...credito, detalle, dbRow: null });
      }
    } catch (err: any) {
      console.error(`❌ Error general con ${credito.creditoBase}:`, err.message);
      resumen.push({
        creditoBase: credito.creditoBase,
        cliente: credito.cliente,
        status: "fallido",
        error: String(err?.message || err),
      });
      results.push({ ...credito, detalle: null, dbRow: null });
    }
  }

  // Resto del código (logs, CSV, etc.)
  console.log(`\n📊 Créditos procesados: ${results.length}`);
  console.log(`   ✅ Insertados: ${resumen.filter((r) => r.status === "insertado").length}`);
  console.log(`   ♻️  Actualizados: ${resumen.filter((r) => r.status === "actualizado").length}`);
  console.log(`   ⏭️  No encontrados: ${resumen.filter((r) => r.status === "no_encontrado").length}`);
  console.log(`   ❌ Fallidos: ${resumen.filter((r) => r.status === "fallido").length}`);

  // Guardar CSV...
  return results;
}
export async function mapExcelToCredito(
  prestamo: PrestamoDetalle,
  agrupado: CreditoAgrupado
) {
  if (!agrupado.filas || agrupado.filas.length === 0) {
    throw new Error(
      `❌ No se encontraron filas en el agrupado ${agrupado.creditoBase}`
    );
  }

  // 🔥 Tomamos la primera fila como referencia
  const excelRow = agrupado.filas[0];

  // ---- Cliente construido desde Excel ----
  const clienteFromExcel = {
    NombreCompleto: excelRow?.Nombre ?? agrupado.cliente ?? "Desconocido",
    Categoria: excelRow?.Categoria ?? null,
    NIT: excelRow?.NIT ?? null,
    ComoSeEntero: excelRow?.ComoSeEntero ?? null,
  };

  // 🧹 Función para limpiar valores numéricos
  const cleanNumericValue = (value: any): string => {
    if (value === null || value === undefined) return "0";
    
    // Convertir a string y limpiar
    return String(value)
      .replace(/[Q$,()"\s]/g, "") // Quitar Q, $, comas, paréntesis, comillas y espacios
      .replace(/^-/, "") // Quitar signo negativo al inicio si existe
      .trim() || "0"; // Si queda vacío, retornar "0"
  };

  // ---- Cálculos base ----
  const capital = toBigExcel(cleanNumericValue(prestamo.PreSalCapital), "0");
  const porcentaje_interes = toBigExcel(cleanNumericValue(excelRow?.porcentaje), "0.015");
  const gps = toBigExcel(cleanNumericValue(excelRow?.GPS), 0);
  const seguro_10_cuotas = toBigExcel(cleanNumericValue(excelRow?.Seguro10Cuotas), 0);
  const otros = toBigExcel(cleanNumericValue(excelRow?.Otros), 0);
  const membresias_pago = toBigExcel(cleanNumericValue(excelRow?.MembresiasPago), 0);

  const cuota_interes = capital.times(porcentaje_interes).round(2);
  const iva_12 = cuota_interes.times(0.12).round(2);

  const deudatotal = capital
    .plus(cuota_interes)
    .plus(iva_12)
    .plus(seguro_10_cuotas)
    .plus(gps)
    .plus(membresias_pago)
    .plus(otros)
    .round(2, 0);

  // ---- Relaciones (IDs reales) ----
  const user = await findOrCreateUserByName(
    clienteFromExcel.NombreCompleto,
    clienteFromExcel.Categoria,
    clienteFromExcel.NIT,
    clienteFromExcel.ComoSeEntero
  );

  // 🔥 Sumar todas las cuotas de las filas agrupadas
  const cuotaCredito = agrupado.filas.reduce(
    (acc, row) => acc + Number(cleanNumericValue(row.Cuota)),
    0
  );

  const advisor = await findOrCreateAdvisorByName(excelRow?.Asesor || "", true);

  const realPorcentaje = porcentaje_interes.mul(100).toFixed(2);

  // ---- Shape del crédito ----
  const creditInsert = {
    usuario_id: Number(user.usuario_id ?? 0),
    otros: otros.toFixed(2),
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
      toBigExcel(cleanNumericValue(prestamo.PrePlazo ?? excelRow?.Plazo ?? 0), "0").toString()
    ),
    iva_12: iva_12.toFixed(2),
    membresias_pago: membresias_pago.toFixed(2),
    membresias: membresias_pago.toFixed(2),
    formato_credito:
      agrupado.filas.length > 1
        ? "Pool"
        : ((excelRow?.FormatoCredito as "Pool" | "Individual") ?? "Individual"),
    porcentaje_royalti: toBigExcel(cleanNumericValue(excelRow?.PorcentajeRoyalty), "0").toString(),
    royalti: toBigExcel(cleanNumericValue(excelRow?.Royalty), "0").toString(),
    tipoCredito: "Nuevo",
    mora: "0",
  };

  try {
    // 🔥 PRIMERO: Obtener el ID del crédito si ya existe
    const [existingCredit] = await db
      .select({ credito_id: creditos.credito_id })
      .from(creditos)
      .where(eq(creditos.numero_credito_sifco, prestamo.PreNumero))
      .limit(1);

    // 🗑️ Si existe, ELIMINAR inversionistas ANTES del upsert
    if (existingCredit) {
      await db
        .delete(creditos_inversionistas)
        .where(
          eq(creditos_inversionistas.credito_id, existingCredit.credito_id)
        );
      console.log(
        `🗑️ Inversionistas eliminados para crédito ${existingCredit.credito_id}`
      );
    }

    // ✅ Insert/update crédito
    const [row] = await db
      .insert(creditos)
      .values(creditInsert)
      .onConflictDoUpdate({
        target: creditos.numero_credito_sifco,
        set: creditInsert,
      })
      .returning();

    const creditoId = row.credito_id;
    console.log(`✅ Crédito insertado/actualizado con ID: ${creditoId}`);

    // Inversionistas: 🔥 ahora usamos todas las filas del agrupado
    const inversionistas = await mapInversionistas(agrupado.filas);
    const creditosInversionistasData = inversionistas.map((inv: any) => {
      const montoAportado = new Big(cleanNumericValue(inv.monto_aportado));
      const porcentajeCashIn = new Big(cleanNumericValue(inv.porcentaje_cash_in));
      const porcentajeInversion = new Big(cleanNumericValue(inv.porcentaje_inversion));
      const interes = new Big(realPorcentaje ?? 0);

      const newCuotaInteres = montoAportado.times(interes.div(100));

      const montoInversionista = newCuotaInteres
        .times(porcentajeInversion)
        .div(100)
        .toFixed(2);
      const montoCashIn = newCuotaInteres
        .times(porcentajeCashIn)
        .div(100)
        .toFixed(2);

      const ivaInversionista =
        Number(montoInversionista) > 0
          ? new Big(montoInversionista).times(0.12)
          : new Big(0);
      const ivaCashIn =
        Number(montoCashIn) > 0 ? new Big(montoCashIn).times(0.12) : new Big(0);

      const cuotaInv =
        inv.cuota_inversionista === 0
          ? cleanNumericValue(excelRow?.Cuota)
          : cleanNumericValue(inv.cuota_inversionista);

      return {
        credito_id: creditoId, // 🔥 Siempre usa el creditoId del row insertado
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

    // ✅ Insertar inversionistas nuevos
    if (creditosInversionistasData.length > 0) {
      await db
        .insert(creditos_inversionistas)
        .values(creditosInversionistasData);
      console.log(
        `✅ ${creditosInversionistasData.length} inversionistas insertados`
      );
    }

    return row;
  } catch (error) {
    console.error("❌ Error al insertar crédito desde Excel:", error);
    throw error;
  }
}