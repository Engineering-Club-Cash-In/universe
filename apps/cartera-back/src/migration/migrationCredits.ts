import Big from "big.js";
import { eq } from "drizzle-orm";
import { findOrCreateAdvisorByName } from "../controllers/advisor";
import { findOrCreateUserByName } from "../controllers/users";
import { db } from "../database";
import { creditos, creditos_inversionistas } from "../database/db";
import { CreditoAgrupado, ExcelCreditoRow, listarCreditosAgrupados } from "../services/excel";
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
  status: "insertado" | "actualizado" | "fallido";
  error?: string;
};

export async function listarCreditosConDetalle(filePath: string) {
  const agrupados = await listarCreditosAgrupados(filePath);

  const resumen: ResultadoCredito[] = [];

  const results = await Promise.all(
    agrupados.map(async (credito) => {
      try {
        console.log(`🔎 Procesando crédito ${credito.creditoBase}...`);
        const detalle = await consultarPrestamoDetalle(credito.creditoBase);

        let dbRow = null;
        if (detalle) {
          try {
            dbRow = await mapExcelToCredito(detalle, credito);

            // 🚀 Chequear si fue insertado o actualizado
            // Asumimos que si la fecha de creación es reciente (menos de 1 minuto), es un registro nuevo
            const status = new Date().getTime() - dbRow.fecha_creacion.getTime() < 60000
                ? "insertado"
                : "actualizado";

            console.log(
              `✅ Crédito ${credito.creditoBase} ${status} (ID: ${dbRow.credito_id})`
            );

            resumen.push({
              creditoBase: credito.creditoBase,
              cliente: credito.cliente,
              status,
            });
          } catch (err: any) {
            console.error(
              `❌ Error insertando crédito ${credito.creditoBase} en DB:`,
              err
            );
            resumen.push({
              creditoBase: credito.creditoBase,
              cliente: credito.cliente,
              status: "fallido",
              error: String(err?.message || err),
            });
          }
        }

        return { ...credito, detalle, dbRow };
      } catch (err: any) {
        console.error(`❌ Error consultando crédito ${credito.creditoBase}:`, err);
        resumen.push({
          creditoBase: credito.creditoBase,
          cliente: credito.cliente,
          status: "fallido",
          error: String(err?.message || err),
        });
        return { ...credito, detalle: null, dbRow: null };
      }
    })
  );

  console.log(`\n📊 Créditos procesados: ${results.length}`);
  console.log(
    `   ✅ Insertados: ${resumen.filter((r) => r.status === "insertado").length}`
  );
  console.log(
    `   ♻️  Actualizados: ${
      resumen.filter((r) => r.status === "actualizado").length
    }`
  );
  console.log(
    `   ❌ Fallidos: ${resumen.filter((r) => r.status === "fallido").length}`
  );

  // 📝 Guardar resumen en CSV
  const csvData = stringify(resumen, {
    header: true,
    columns: ["creditoBase", "cliente", "status", "error"],
  });

  const outPath = path.join(process.cwd(), "resumen_creditos.csv");
  fs.writeFileSync(outPath, csvData);
  console.log(`📂 Resumen exportado a: ${outPath}`);

  return results;
}
export async function mapExcelToCredito(
  prestamo: PrestamoDetalle,
  agrupado: CreditoAgrupado
) {
  if (!agrupado.filas || agrupado.filas.length === 0) {
    throw new Error(`❌ No se encontraron filas en el agrupado ${agrupado.creditoBase}`);
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
    (acc, row) => acc + Number(row.Cuota || 0),
    0
  );

  const advisor = await findOrCreateAdvisorByName(excelRow?.Asesor || "", true);

  const realPorcentaje = porcentaje_interes.mul(100).toFixed(2);

  // ---- Shape del crédito ----
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
      agrupado.filas.length > 1
        ? "Pool"
        : ((excelRow?.FormatoCredito as "Pool" | "Individual") ?? "Individual"),
    porcentaje_royalti: toBigExcel(excelRow?.PorcentajeRoyalty, "0").toString(),
    royalti: toBigExcel(excelRow?.Royalty, "0").toString(),
    tipoCredito: "Nuevo",
    mora: "0",
  };

  try {
    // Insert/update crédito
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
      const montoAportado = new Big(inv.monto_aportado);
      const porcentajeCashIn = new Big(inv.porcentaje_cash_in);
      const porcentajeInversion = new Big(inv.porcentaje_inversion);
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

    // Limpiar cuotas viejas
    await db
      .delete(creditos_inversionistas)
      .where(eq(creditos_inversionistas.credito_id, creditoId));

    // Insertar cuotas nuevas
    if (creditosInversionistasData.length > 0) {
      await db.insert(creditos_inversionistas).values(creditosInversionistasData);
    }

    return row;
  } catch (error) {
    console.error("❌ Error al insertar crédito desde Excel:", error);
    throw error;
  }
}
