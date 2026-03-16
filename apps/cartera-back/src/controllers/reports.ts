import ExcelJS from "exceljs";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getCreditosWithUserByMesAnio } from "./credits";
import { getAllPagosWithCreditAndInversionistas, getPagosConInversionistas } from "./payments";
import { fetchImageBase64 } from "../utils/functions/internReportCancelations";

const LOGO_URL = process.env.LOGO_URL || "https://pub-8081c8d6e5e743f9adfc9e0db92e5a88.r2.dev/reports/logo-cashin.png";

export async function getCreditosWithUserByMesAnioExcel(
  params: {
    mes: number;
    anio: number;
    page?: number;
    perPage?: number;
    numero_credito_sifco?: string;
    estado?: "ACTIVO" | "CANCELADO" | "INCOBRABLE" | "PENDIENTE_CANCELACION" | "MOROSO" | "EN_CONVENIO";
    asesor_id?: number;
    nombre_usuario?: string;
    email_asesor?: string; // 🆕 NUEVO
    cuotas_atrasadas?: number; // 🆕 NUEVO
    proximidad_pago?: "TODAY" | "WEEK" | "TWO_WEEKS" | "MONTH" | "DUEMONTH"; // 🆕 NUEVO
    excel?: boolean;
  }
) {
  const { excel, ...rest } = params;

  // 👉 Traemos la data normal con los nuevos parámetros
  const result = await getCreditosWithUserByMesAnio(
    rest.mes,
    rest.anio,
    rest.page ?? 1,
    rest.perPage ?? 10,
    rest.numero_credito_sifco,
    rest.estado,
    rest.asesor_id,
    rest.nombre_usuario,
    rest.email_asesor, // 🆕 NUEVO
    rest.cuotas_atrasadas, // 🆕 NUEVO
    rest.proximidad_pago // 🆕 NUEVO
  );

  if (!excel) return result; // si no piden excel, devolvemos JSON normal

  console.log("📊 Generando Excel con", result.data.length, "créditos...");

  // 📝 Workbook + hoja
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Créditos");

  // 1️⃣ Buscar el máximo de inversionistas
  const maxInversionistas = Math.max(
    ...result.data.map((item) => item.inversionistas.length)
  );

  // 2️⃣ Definir columnas base
  const columns: any[] = [
    { header: "Crédito ID", key: "credito_id", width: 12 },
    { header: "Número SIFCO", key: "numero_credito_sifco", width: 20 },
    { header: "Estado", key: "estado", width: 15 },
    { header: "Capital", key: "capital", width: 15 },
    { header: "Cuota", key: "cuota", width: 15 },
    { header: "Deuda Total", key: "deuda_total", width: 15 },
    { header: "Deuda con Mora", key: "deuda_con_mora", width: 15 }, // 🆕
    { header: "Plazo", key: "plazo", width: 10 },
    { header: "Usuario", key: "usuario", width: 25 },
    { header: "NIT", key: "usuario_nit", width: 20 },
    { header: "Categoría", key: "usuario_categoria", width: 15 },
    { header: "Saldo a Favor", key: "saldo_favor", width: 15 },
    { header: "Asesor", key: "asesor", width: 20 },
    { header: "Email Asesor", key: "email_asesor", width: 30 }, // 🆕
    { header: "Fecha Creación", key: "fecha_creacion", width: 20 },
    { header: "Observaciones", key: "observaciones", width: 50 },
    
    // 🆕 Columnas de mora
    { header: "Tiene Mora", key: "tiene_mora", width: 12 },
    { header: "Monto Mora", key: "monto_mora", width: 15 },
    { header: "Cuotas Atrasadas", key: "cuotas_atrasadas", width: 18 },
    
    // 🆕 Columnas de próxima cuota
    { header: "Próxima Cuota #", key: "proxima_cuota_numero", width: 18 },
    { header: "Fecha Vencimiento", key: "proxima_fecha_venc", width: 20 },
    { header: "Proximidad", key: "proximidad_pago", width: 15 },
    { header: "Cuota Pagada", key: "proxima_cuota_pagada", width: 15 },
    
    { header: "Total CashIn Monto", key: "total_cash_in_monto", width: 20 },
    { header: "Total CashIn IVA", key: "total_cash_in_iva", width: 20 },
    { header: "Total Inversión Monto", key: "total_inversion_monto", width: 20 },
    { header: "Total Inversión IVA", key: "total_inversion_iva", width: 20 },
  ];

  // 3️⃣ Agregar columnas dinámicas por inversionista
  for (let i = 1; i <= maxInversionistas; i++) {
    columns.push({ header: `Inv${i}_Nombre`, key: `inv${i}_nombre`, width: 25 });
    columns.push({ header: `Inv${i}_Aportado`, key: `inv${i}_aportado`, width: 15 });
    columns.push({ header: `Inv${i}_CashIn`, key: `inv${i}_cashin`, width: 15 });
    columns.push({ header: `Inv${i}_Inversion`, key: `inv${i}_inversion`, width: 15 });
    columns.push({ header: `Inv${i}_IVA_CashIn`, key: `inv${i}_iva_cashin`, width: 15 });
    columns.push({ header: `Inv${i}_IVA_Inv`, key: `inv${i}_iva_inversion`, width: 15 });
    columns.push({ header: `Inv${i}_%Inv`, key: `inv${i}_porcentaje`, width: 10 });
    columns.push({ header: `Inv${i}_%CashIn`, key: `inv${i}_porcentaje_cashin`, width: 10 });
  }

  sheet.columns = columns;

  // 4️⃣ Poblar filas
  result.data.forEach((item) => {
    const row: any = {
      credito_id: item.creditos.credito_id,
      numero_credito_sifco: item.creditos.numero_credito_sifco,
      estado: item.creditos.statusCredit,
      capital: item.creditos.capital,
      cuota: item.creditos.cuota,
      deuda_total: item.creditos.deudatotal,
      deuda_con_mora: item.deuda_total_con_mora || item.creditos.deudatotal, // 🆕
      plazo: item.creditos.plazo,
      usuario: item.usuarios.nombre,
      usuario_nit: item.usuarios.nit,
      usuario_categoria: item.usuarios.categoria,
      saldo_favor: item.usuarios.saldo_a_favor,
      asesor: item.asesores.nombre,
      email_asesor: "", // 🆕 Lo llenaremos abajo si existe
      fecha_creacion: item.creditos.fecha_creacion,
      observaciones: item.creditos.observaciones,
      
      // 🆕 Mora
      tiene_mora: item.mora ? "Sí" : "No",
      monto_mora: item.mora?.monto_mora || 0,
      cuotas_atrasadas: item.mora?.cuotas_atrasadas || 0,
      
      // 🆕 Próxima cuota
      proxima_cuota_numero: item.proxima_cuota?.numero_cuota || "N/A",
      proxima_fecha_venc: item.proxima_cuota?.fecha_vencimiento || "N/A",
      proximidad_pago: item.proxima_cuota?.proximidad || "N/A",
      proxima_cuota_pagada: item.proxima_cuota?.pagado ? "Sí" : "No",
      
      total_cash_in_monto: item.resumen.total_cash_in_monto,
      total_cash_in_iva: item.resumen.total_cash_in_iva,
      total_inversion_monto: item.resumen.total_inversion_monto,
      total_inversion_iva: item.resumen.total_inversion_iva,
    };

    // 👉 Agregar inversionistas dinámicos
    item.inversionistas.forEach((inv, index) => {
      const i = index + 1;
      row[`inv${i}_nombre`] = inv.nombre;
      row[`inv${i}_aportado`] = inv.monto_aportado;
      row[`inv${i}_cashin`] = inv.monto_cash_in;
      row[`inv${i}_inversion`] = inv.monto_inversionista;
      row[`inv${i}_iva_cashin`] = inv.iva_cash_in;
      row[`inv${i}_iva_inversion`] = inv.iva_inversionista;
      row[`inv${i}_porcentaje`] = inv.porcentaje_participacion_inversionista;
      row[`inv${i}_porcentaje_cashin`] = inv.porcentaje_cash_in;
    });

    sheet.addRow(row);
  });

  // 5️⃣ Pasar Excel a buffer
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);

  // 6️⃣ Subir a R2
  const filename = `reportes/creditos_${Date.now()}.xlsx`;
  const s3 = new S3Client({
    endpoint: process.env.BUCKET_REPORTS_URL,
    region: "auto",
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID as string,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY as string,
    },
  });

  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.BUCKET_REPORTS,
      Key: filename,
      Body: uint8Array,
      ContentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    })
  );

  const url = `${process.env.URL_PUBLIC_R2_REPORTS}/${filename}`;
  console.log("✅ Reporte Excel subido a R2:", url);

  return {
    ...result,
    excelUrl: url,
  };
}
export async function exportPagosToExcel(credito_sifco: string) {
  // 1️⃣ Traer los pagos con su data
  const pagosData = await getAllPagosWithCreditAndInversionistas(credito_sifco);
  if (!pagosData.length) {
    throw new Error(`No hay pagos para el crédito ${credito_sifco}`);
  }

  console.log(`📊 Generando Excel con ${pagosData.length} pagos...`);

  // 2️⃣ Crear workbook
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Pagos");

  // 3️⃣ Definir columnas base de "pago"
  const columns: any[] = [
    { header: "Pago ID", key: "pago_id", width: 12 },
    { header: "Número Crédito", key: "numero_credito_sifco", width: 20 },
    { header: "Número Cuota", key: "numero_cuota", width: 15 },
    { header: "Cuota", key: "cuota", width: 15 },
    { header: "Abono Capital", key: "abono_capital", width: 15 },
    { header: "Abono Interés", key: "abono_interes", width: 15 },
    { header: "Abono IVA 12%", key: "abono_iva_12", width: 15 },
    { header: "Seguro", key: "abono_seguro", width: 15 },
    { header: "GPS", key: "abono_gps", width: 15 },
    { header: "Mora", key: "mora", width: 15 },
    { header: "Capital Restante", key: "capital_restante", width: 18 },
    { header: "Interés Restante", key: "interes_restante", width: 18 },
    { header: "IVA Restante", key: "iva_12_restante", width: 18 },
    { header: "Total Restante", key: "total_restante", width: 18 },
    { header: "Monto Aplicado", key: "monto_aplicado", width: 15 },
    { header: "Fecha Pago", key: "fecha_pago", width: 20 },
    { header: "Observaciones", key: "observaciones", width: 40 },
    { header: "Origen Pago", key: "origen_pago", width: 18 },
    { header: "Boletas", key: "boletas", width: 50 },
  ];

  // 4️⃣ Buscar el máximo de inversionistas en cualquier pago
  const maxInversionistas = Math.max(
    ...pagosData.map((pd) => pd.pagosInversionistas.length)
  );

  for (let i = 1; i <= maxInversionistas; i++) {
    columns.push({ header: `Inv${i}_Nombre`, key: `inv${i}_nombre`, width: 25 });
    columns.push({ header: `Inv${i}_EmiteFactura`, key: `inv${i}_factura`, width: 15 });
    columns.push({ header: `Inv${i}_Monto`, key: `inv${i}_monto`, width: 15 });
  }

  sheet.columns = columns;

  // 5️⃣ Agregar filas
  pagosData.forEach(({ pago, pagosInversionistas }) => {
    const row: any = {
      pago_id: pago.pago_id,
      numero_credito_sifco: pago.numero_credito_sifco,
      numero_cuota: pago.numero_cuota,
      cuota: pago.cuota,
      abono_capital: pago.abono_capital,
      abono_interes: pago.abono_interes,
      abono_iva_12: pago.abono_iva_12,
      abono_seguro: pago.abono_seguro,
      abono_gps: pago.abono_gps,
      mora: pago.mora,
      capital_restante: pago.capital_restante,
      interes_restante: pago.interes_restante,
      iva_12_restante: pago.iva_12_restante,
      total_restante: pago.total_restante,
      monto_aplicado: pago.monto_aplicado,
      fecha_pago: pago.fecha_pago,
      observaciones: pago.observaciones,
      origen_pago: pago.origen_pago ?? "",
      boletas: (pago as any).boletas?.join(", ") || "",
    };

    pagosInversionistas.forEach((inv, index) => {
      const i = index + 1;
      row[`inv${i}_nombre`] = inv.nombre;
      row[`inv${i}_factura`] = inv.emite_factura ? "Sí" : "No";
      row[`inv${i}_monto`] = inv.abono_capital || 0; // Using abono_capital instead of monto
    });

    sheet.addRow(row);
  });

  // 6️⃣ Buffer + subir a S3
  const buffer = await workbook.xlsx.writeBuffer();
  const fileKey = `reportes/pagos_${credito_sifco}_${Date.now()}.xlsx`;
  const s3 = new S3Client({
    endpoint: process.env.BUCKET_REPORTS_URL,
    region: "auto",
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID as string,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY as string,
    },
  });
  const filename = `reportes/pagos_${Date.now()}.xlsx`;
  const arrayBuffer = await workbook.xlsx.writeBuffer();
const uint8Array = new Uint8Array(arrayBuffer);
  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.BUCKET_REPORTS,
      Key: filename,
      Body: uint8Array,
    ContentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  })
);

  console.log("✅ Reporte de pagos subido a S3:", fileKey);

  const url = `${process.env.URL_PUBLIC_R2_REPORTS}/${filename}`;
  return {
    excelUrl: url,
  };
}

 

/**
 * 📊 Genera y sube un Excel con todos los pagos e inversionistas
 */
export async function exportPagosConInversionistasExcel(
  options: {
    page?: number;
    pageSize?: number;
    numeroCredito?: string;
    dia?: number;
    mes?: number;
    anio?: number;
    fechaInicio?: string;
    fechaFin?: string;
    inversionistaId?: number;
    usuarioNombre?: string;
    validationStatus?: string;
    categoriaCredito?: string;
    tipoCredito?: string;
    formatoCredito?: string;
    soloAplicados?: boolean;
    fechaAplicado?: string;
  }
) {
  // 1️⃣ Obtener los datos completos de tu servicio
  const result = await getPagosConInversionistas({
    ...options,
    pageSize: 99999,
  });

  if (!result.data || result.data.length === 0) {
    throw new Error("No se encontraron pagos para generar el Excel.");
  }

  console.log(`📊 Generando Excel con ${result.data.length} pagos (estilo distri_recaudo)...`);

  // 2️⃣ Crear el workbook
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Distribución Recaudo");

  // Helper: tipo de pago
  const getTipoPago = (item: any): string => {
    const mora = Number(item.mora || 0);
    const boleta = Number(item.montoBoleta || 0);
    const abonoCapital = Number(item.abono_capital || 0);
    const cuota = Number(item.cuotaMonto || 0);
    const montoAplicado = Number(item.monto_aplicado || 0);
    if (mora > 0 && mora === boleta) return "PAGO DE MORA";
    if (abonoCapital > 0 && abonoCapital === boleta) return "ABONOS A CAPITAL";
    if (cuota > 0 && cuota === montoAplicado) return "PAGOS DE CREDITOS";
    if (cuota > 0 && cuota > montoAplicado) return "PAGO PARCIAL";
    return "PAGOS DE CREDITOS";
  };

  // 3️⃣ Columnas fijas al estilo distri_recaudo
  const columns: { header: string; key: string; width: number }[] = [
    { header: "No. Prestamo", key: "noPrestamo", width: 20 },
    { header: "Nombre Deudor", key: "nombreDeudor", width: 25 },
    { header: "Monto Otorgado", key: "montoOtorgado", width: 15 },
    { header: "# Cuota", key: "numCuota", width: 10 },
    { header: "Capital", key: "capital", width: 15 },
    { header: "Intereses", key: "intereses", width: 15 },
    { header: "Mora", key: "mora", width: 15 },
    { header: "Otros", key: "otrosPago", width: 12 },
    { header: "Total Pago", key: "totalPago", width: 15 },
    { header: "Inversionistas", key: "inversionista", width: 28 },
    { header: "Emite Factura", key: "emiteFactura", width: 15 },
    { header: "Fondos Otorgados", key: "fondosOtorgados", width: 18 },
    { header: "Capital Inversionista", key: "capitalInv", width: 18 },
    { header: "Interes Inversionista", key: "interesInv", width: 18 },
    { header: "IVA Incluido en Intereses", key: "ivaInv", width: 22 },
    { header: "SubTotal Inversionista", key: "subtotalInv", width: 18 },
    { header: "Retencion ISR", key: "isrInv", width: 15 },
    { header: "Cuota Pago", key: "cuotaPago", width: 15 },
    { header: "Seguro", key: "seguro", width: 12 },
    { header: "Membresías", key: "membresias", width: 12 },
    { header: "GPS", key: "gps", width: 12 },
    { header: "Otros", key: "otros", width: 12 },
    { header: "Reserva", key: "reserva", width: 12 },
    { header: "Pago Convenio", key: "pagoConvenio", width: 15 },
    { header: "SubTotal Distribución", key: "subtotalDist", width: 18 },
    { header: "Categoría Crédito", key: "categoriaCredito", width: 18 },
    { header: "Tipo de Pago", key: "tipoPago", width: 18 },
    { header: "Fecha Aplicado", key: "fechaAplicado", width: 20 },
    { header: "Origen Pago", key: "origenPago", width: 18 },
    { header: "Boletas", key: "boletas", width: 50 },
  ];

  const totalCols = columns.length;

  // Setear solo key + width
  sheet.columns = columns.map(c => ({ key: c.key, width: c.width }));

  // Logo
  const logo = await fetchImageBase64(LOGO_URL);
  if (logo) {
    const imgId = workbook.addImage({ base64: logo.data, extension: logo.ext });
    sheet.addImage(imgId, "A1:B2");
    sheet.addRow([]);
    sheet.addRow([]);
  }

  // Header row
  const headerLabels = columns.map(c => c.header);
  const headerRow = sheet.addRow(headerLabels);
  headerRow.font = { bold: true, color: { argb: "FFFFFF" }, size: 10 };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "1F4E79" } };
  headerRow.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  headerRow.height = 35;

  // 4️⃣ Estilo helpers
  const thinBorder = {
    top: { style: "thin" as const, color: { argb: "D9D9D9" } },
    bottom: { style: "thin" as const, color: { argb: "D9D9D9" } },
    left: { style: "thin" as const, color: { argb: "D9D9D9" } },
    right: { style: "thin" as const, color: { argb: "D9D9D9" } },
  };

  // 5️⃣ Recorrer todos los pagos (sin agrupar por asesor)
  result.data.forEach((item: any) => {
    const noPrestamo = item.credito?.numeroCreditoSifco ?? "";
    const nombreDeudor = item.usuario?.nombre ?? "";
    const montoOtorgado = Number(item.credito?.capital ?? 0);
    const numCuota = item.cuota?.numeroCuota ?? "";
    const capitalPago = Number(item.abono_capital || 0);
    const interesesPago = Number(item.abono_interes || 0);
    const moraPago = Number(item.mora || 0);
    const totalPago = Number(item.monto_aplicado || 0);
    const tipoPago = getTipoPago(item);
    const boletas = item.boletas ?? [];

    // ── Fila header de transacción (bold) ──
    const txHeaderRow = sheet.addRow([]);
    txHeaderRow.getCell(1).value = noPrestamo;
    txHeaderRow.getCell(9).value = `Correlativo: ${item.pagoId}`;
    txHeaderRow.getCell(10).value = `Cuenta Bancaria: ${item.cuentaEmpresaNombre ?? ""}`;
    sheet.mergeCells(txHeaderRow.number, 11, txHeaderRow.number, 13);
    txHeaderRow.getCell(11).value = `Fecha Transaccion: ${item.fechaPago}`;
    sheet.mergeCells(txHeaderRow.number, 14, txHeaderRow.number, 16);
    txHeaderRow.getCell(14).value = `Transacción: ${tipoPago}`;
    sheet.mergeCells(txHeaderRow.number, 17, txHeaderRow.number, totalCols);
    txHeaderRow.getCell(17).value = boletas.length > 0 ? `No. Boleta: ${boletas[0]?.boletaId ?? ""}` : "";
    txHeaderRow.font = { bold: true, size: 10 };
    txHeaderRow.eachCell({ includeEmpty: false }, (cell) => {
      cell.border = thinBorder;
    });

    const inversionistas = item.inversionistas ?? [];
    const txFirstInvRow = sheet.rowCount + 1;

    // Campos comunes del pago
    const commonPayFields = {
      categoriaCredito: item.usuario?.categoria ?? "",
      tipoPago,
      fechaAplicado: item.fechaAplicado ?? "",
      origenPago: item.origenPago ?? "",
      boletas: boletas.map((b: any) => b.urlBoleta).filter(Boolean).join("\n"),
    };

    if (inversionistas.length === 0) {
      // Sin inversionistas - una fila con datos del pago
      const r = sheet.addRow({
        noPrestamo, nombreDeudor, montoOtorgado, numCuota,
        capital: capitalPago, intereses: interesesPago, mora: moraPago, otrosPago: Number(item.otros || 0), totalPago,
        inversionista: "", emiteFactura: "", fondosOtorgados: 0,
        capitalInv: 0, interesInv: 0, ivaInv: 0, subtotalInv: 0, isrInv: 0, cuotaPago: 0,
        seguro: Number(item.abono_seguro || 0), membresias: Number(item.membresias || 0),
        gps: Number(item.abono_gps || 0), otros: Number(item.otros || 0),
        reserva: Number(item.reserva || 0), pagoConvenio: Number(item.pagoConvenio || 0),
        subtotalDist: totalPago,
        ...commonPayFields,
      });
      r.eachCell({ includeEmpty: true }, (cell) => { cell.border = thinBorder; cell.alignment = { vertical: "middle" }; });
    } else {
      // ── Filas de inversionistas ──
      inversionistas.forEach((inv: any) => {
        const capitalI = Number(inv.abonoCapital || 0);
        const interesI = Number(inv.abonoInteres || 0);
        const ivaI = Number(inv.abonoIva || 0);
        const subtotalI = capitalI + interesI + ivaI;
        const isrI = Number(inv.isr || 0);
        const cuotaP = Number(inv.cuotaPago || 0);

        const r = sheet.addRow({
          noPrestamo, nombreDeudor, montoOtorgado, numCuota,
          capital: capitalPago, intereses: interesesPago, mora: moraPago, otrosPago: Number(item.otros || 0), totalPago,
          inversionista: inv.nombreInversionista,
          emiteFactura: inv.emiteFactura ? "Sí" : "No",
          fondosOtorgados: Number(inv.montoAportado || 0),
          capitalInv: capitalI, interesInv: interesI, ivaInv: ivaI,
          subtotalInv: subtotalI, isrInv: isrI, cuotaPago: cuotaP,
          seguro: Number(item.abono_seguro || 0), membresias: Number(item.membresias || 0),
          gps: Number(item.abono_gps || 0), otros: Number(item.otros || 0),
          reserva: Number(item.reserva || 0), pagoConvenio: Number(item.pagoConvenio || 0),
          subtotalDist: cuotaP + Number(item.abono_seguro || 0) + Number(item.membresias || 0) + Number(item.abono_gps || 0) + Number(item.otros || 0) + Number(item.reserva || 0),
          ...commonPayFields,
        });
        r.eachCell({ includeEmpty: true }, (cell) => { cell.border = thinBorder; cell.alignment = { vertical: "middle" }; });
      });

      const txLastInvRow = sheet.rowCount;

      // Merge vertical de columnas repetidas si hay más de 1 inversionista
      if (inversionistas.length > 1) {
        // Cols A-I (datos del pago, incluyendo Otros)
        for (let col = 1; col <= 9; col++) {
          sheet.mergeCells(txFirstInvRow, col, txLastInvRow, col);
          sheet.getCell(txFirstInvRow, col).alignment = { vertical: "middle" };
        }
        // Cols finales: Categoría, Tipo Pago, Fecha Aplicado, Boletas
        const catIdx = columns.findIndex(c => c.key === "categoriaCredito") + 1;
        for (let col = catIdx; col <= totalCols; col++) {
          sheet.mergeCells(txFirstInvRow, col, txLastInvRow, col);
          sheet.getCell(txFirstInvRow, col).alignment = { vertical: "middle" };
        }
      }
    }

    // ── Fila resumen de la transacción (teal) ──
    const summaryData: any = {};
    summaryData.capital = capitalPago;
    summaryData.intereses = interesesPago;
    summaryData.mora = moraPago;
    summaryData.otrosPago = Number(item.otros || 0);
    summaryData.totalPago = totalPago;
    summaryData.capitalInv = inversionistas.reduce((s: number, i: any) => s + Number(i.abonoCapital || 0), 0);
    summaryData.interesInv = inversionistas.reduce((s: number, i: any) => s + Number(i.abonoInteres || 0), 0);
    summaryData.ivaInv = inversionistas.reduce((s: number, i: any) => s + Number(i.abonoIva || 0), 0);
    summaryData.subtotalInv = summaryData.capitalInv + summaryData.interesInv + summaryData.ivaInv;
    summaryData.isrInv = inversionistas.reduce((s: number, i: any) => s + Number(i.isr || 0), 0);
    summaryData.cuotaPago = inversionistas.reduce((s: number, i: any) => s + Number(i.cuotaPago || 0), 0);

    const sumRow = sheet.addRow(summaryData);
    sumRow.eachCell({ includeEmpty: true }, (cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "B4D6E4" } };
      cell.border = thinBorder;
      cell.alignment = { vertical: "middle" };
    });
  });

  // Fila vacía + TOTALES GENERALES
  sheet.addRow([]);

  const grandTotals: any = { noPrestamo: "TOTALES GENERALES" };
  grandTotals.capital = result.totales?.totalAbonoCapital ?? 0;
  grandTotals.intereses = result.totales?.totalAbonoInteres ?? 0;
  grandTotals.mora = result.totales?.totalMora ?? 0;
  grandTotals.otrosPago = result.totales?.totalOtros ?? 0;
  grandTotals.seguro = result.totales?.totalAbonoSeguro ?? 0;
  grandTotals.gps = result.totales?.totalAbonoGps ?? 0;
  grandTotals.otros = result.totales?.totalOtros ?? 0;
  grandTotals.reserva = result.totales?.totalReserva ?? 0;
  grandTotals.membresias = result.totales?.totalMembresias ?? 0;
  grandTotals.pagoConvenio = result.totales?.totalConvenio ?? 0;

  const totalRow = sheet.addRow(grandTotals);
  totalRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "000000" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD966" } };
    cell.border = {
      top: { style: "medium" as const, color: { argb: "1F4E79" } },
      bottom: { style: "medium" as const, color: { argb: "1F4E79" } },
    };
  });

  // 7️⃣ Generar buffer del Excel
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);

  // 8️⃣ Subir a S3/R2
  const s3 = new S3Client({
    endpoint: process.env.BUCKET_REPORTS_URL,
    region: "auto",
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });

  const filename = `reportes/pagos_inversionistas_${Date.now()}.xlsx`;

  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.BUCKET_REPORTS!,
      Key: filename,
      Body: uint8Array,
      ContentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    })
  );

  const excelUrl = `${process.env.URL_PUBLIC_R2_REPORTS}/${filename}`;
  console.log("✅ Reporte de pagos con inversionistas subido:", excelUrl);

  return {
    success: true,
    total: result.data.length,
    excelUrl,
  };
}

// ============================================
// 📊 REPORTE EXCEL PARA ASESORES (SIN INVERSIONISTAS)
// ============================================
export async function exportPagosAdvisorExcel(
  options: {
    page?: number;
    pageSize?: number;
    numeroCredito?: string;
    dia?: number;
    mes?: number;
    anio?: number;
    fechaInicio?: string;
    fechaFin?: string;
    inversionistaId?: number;
    usuarioNombre?: string;
    validationStatus?: string;
    categoriaCredito?: string;
    tipoCredito?: string;
    formatoCredito?: string;
    soloAplicados?: boolean;
    fechaAplicado?: string;
  }
) {
  const result = await getPagosConInversionistas({
    ...options,
    pageSize: 99999,
  });

  if (!result.data || result.data.length === 0) {
    throw new Error("No se encontraron pagos para generar el Excel.");
  }

  console.log(`📊 Generando Excel de asesores con ${result.data.length} pagos...`);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Reporte Asesores");

  // Helpers
  const getTipoPago = (item: any): string => {
    const mora = Number(item.mora || 0);
    const boleta = Number(item.montoBoleta || 0);
    const abonoCapital = Number(item.abono_capital || 0);
    const cuota = Number(item.cuotaMonto || 0);
    const montoAplicado = Number(item.monto_aplicado || 0);
    if (mora > 0 && mora === boleta) return "Pago de mora";
    if (abonoCapital > 0 && abonoCapital === boleta) return "Pago capital";
    if (cuota > 0 && cuota === montoAplicado) return "Pago de cuota";
    if (cuota > 0 && cuota > montoAplicado) return "Parcial";
    return "";
  };
  const getDiaPago = (fechaVencimiento: string | null): string => {
    if (!fechaVencimiento) return "";
    const dia = new Date(fechaVencimiento).getDate();
    return isNaN(dia) ? "" : dia.toString();
  };

  // Máximo de boletas por pago
  const maxBoletas = Math.max(1, ...result.data.map((p: any) => (p.boletas ?? []).length));

  const columns: { header: string; key: string; width: number }[] = [
    { header: "Fecha Pago", key: "fechaPago", width: 20 },
    { header: "Número Crédito", key: "numeroCredito", width: 20 },
    { header: "Asesor", key: "registerByNombre", width: 25 },
    { header: "Cliente", key: "usuarioNombre", width: 25 },
    { header: "Monto Boleta", key: "montoBoleta", width: 15 },
    { header: "Número Cuota", key: "numeroCuota", width: 12 },
    { header: "Cuota (Q)", key: "cuotaMonto", width: 15 },
    { header: "Monto Aplicado", key: "montoAplicado", width: 15 },
    { header: "Seguro", key: "abono_seguro", width: 15 },
    { header: "Membresías", key: "membresias", width: 15 },
    { header: "Mora", key: "mora", width: 15 },
    { header: "Otros", key: "otros", width: 15 },
    { header: "Abono Capital", key: "abono_capital", width: 15 },
    { header: "Abono Interés", key: "abono_interes", width: 15 },
    { header: "Abono IVA 12%", key: "abono_iva_12", width: 15 },
    { header: "Abono GPS", key: "abono_gps", width: 15 },
    { header: "Tipo de Pago", key: "tipoPago", width: 18 },
    { header: "Estado", key: "validationStatus", width: 18 },
    { header: "Observaciones", key: "observaciones", width: 30 },
    { header: "Pago Convenio", key: "pagoConvenio", width: 15 },
    { header: "Fecha Boleta", key: "fechaBoleta", width: 15 },
    { header: "Fecha Aplicado", key: "fechaAplicado", width: 20 },
    { header: "Origen Pago", key: "origenPago", width: 18 },
  ];

  // Columnas dinámicas de boletas
  for (let i = 1; i <= maxBoletas; i++) {
    columns.push({ header: maxBoletas === 1 ? "URL Boleta" : `Boleta ${i}`, key: `boleta_${i}`, width: 50 });
  }

  columns.push(
    { header: "Banco", key: "bancoNombre", width: 20 },
    { header: "Cuenta Empresa", key: "cuentaEmpresaNombre", width: 20 },
    { header: "Banco Empresa", key: "cuentaEmpresaBanco", width: 20 },
    { header: "Número Cuenta Empresa", key: "cuentaEmpresaNumero", width: 20 },
    { header: "Tipo de Crédito", key: "tipoCredito", width: 15 },
    { header: "Día de Pago", key: "diaPago", width: 12 },
    { header: "Número Autorización", key: "numeroAutorizacion", width: 20 },
    { header: "Capital Crédito", key: "capital", width: 15 },
    { header: "Deuda Total", key: "deudaTotal", width: 15 },
    { header: "Estado Crédito", key: "statusCredit", width: 18 },
    { header: "NIT", key: "nit", width: 15 },
    { header: "Reserva", key: "reserva", width: 15 },
    { header: "Registrado Por (Email)", key: "registerBy", width: 30 },
    { header: "Pago ID", key: "pagoId", width: 12 },
  );

  // Setear solo key + width (sin header, para no escribir en row 1 automáticamente)
  sheet.columns = columns.map(c => ({ key: c.key, width: c.width }));

  // Logo
  let dataStartRow = 2; // fila donde inician los datos (después del header)
  const logo = await fetchImageBase64(LOGO_URL);
  if (logo) {
    const imgId = workbook.addImage({ base64: logo.data, extension: logo.ext });
    sheet.addImage(imgId, "A1:B2");
    sheet.addRow([]); // Fila 1 - logo
    sheet.addRow([]); // Fila 2 - espacio
    dataStartRow = 4; // header en fila 3, datos desde fila 4
  }

  // Header row manual
  const headerLabels = columns.map(c => c.header);
  const headerRow = sheet.addRow(headerLabels);
  headerRow.font = { bold: true, color: { argb: "FFFFFF" }, size: 11 };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "1F4E79" } };
  headerRow.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  headerRow.height = 30;

  // ── Filas de datos (sin agrupar por asesor) ──
  result.data.forEach((item: any, idx: number) => {
    const row: any = {
      fechaPago: item.fechaPago,
      numeroCredito: item.credito?.numeroCreditoSifco ?? "",
      registerByNombre: item.registerByNombre,
      usuarioNombre: item.usuario?.nombre ?? "",
      montoBoleta: item.montoBoleta,
      numeroCuota: item.cuota?.numeroCuota ?? "",
      cuotaMonto: item.cuotaMonto,
      montoAplicado: item.monto_aplicado,
      abono_seguro: item.abono_seguro,
      membresias: item.membresias,
      mora: item.mora,
      otros: item.otros,
      abono_capital: item.abono_capital,
      abono_interes: item.abono_interes,
      abono_iva_12: item.abono_iva_12,
      abono_gps: item.abono_gps,
      tipoPago: getTipoPago(item),
      validationStatus: item.validationStatus,
      observaciones: item.observaciones,
      pagoConvenio: item.pagoConvenio,
      fechaBoleta: item.fechaBoleta,
      fechaAplicado: item.fechaAplicado,
      origenPago: item.origenPago ?? "",
      bancoNombre: item.bancoNombre,
      cuentaEmpresaNombre: item.cuentaEmpresaNombre,
      cuentaEmpresaBanco: item.cuentaEmpresaBanco,
      cuentaEmpresaNumero: item.cuentaEmpresaNumero,
      tipoCredito: item.usuario?.categoria ?? "",
      diaPago: getDiaPago(item.cuota?.fechaVencimiento),
      numeroAutorizacion: item.numeroAutorizacion,
      capital: item.credito?.capital ?? "",
      deudaTotal: item.credito?.deudaTotal ?? "",
      statusCredit: item.credito?.statusCredit ?? "",
      nit: item.usuario?.nit ?? "",
      reserva: item.reserva,
      registerBy: item.registerBy,
      pagoId: item.pagoId,
    };

    // Boletas dinámicas
    const boletas = item.boletas ?? [];
    for (let b = 0; b < maxBoletas; b++) {
      row[`boleta_${b + 1}`] = boletas[b]?.urlBoleta ?? "";
    }

    const dataRow = sheet.addRow(row);
    // Zebra striping
    const bgColor = idx % 2 === 1 ? "F2F7FB" : "FFFFFF";
    dataRow.eachCell({ includeEmpty: true }, (cell) => {
      cell.border = {
        top: { style: "thin", color: { argb: "D9D9D9" } },
        bottom: { style: "thin", color: { argb: "D9D9D9" } },
        left: { style: "thin", color: { argb: "D9D9D9" } },
        right: { style: "thin", color: { argb: "D9D9D9" } },
      };
      cell.alignment = { vertical: "middle" };
      if (bgColor !== "FFFFFF") {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgColor } };
      }
    });
  });

  // Fila vacía + TOTALES GENERALES
  sheet.addRow([]);

  const totalRow = sheet.addRow({
    fechaPago: "TOTALES GENERALES",
    abono_capital: result.totales?.totalAbonoCapital ?? 0,
    abono_interes: result.totales?.totalAbonoInteres ?? 0,
    abono_iva_12: result.totales?.totalAbonoIva ?? 0,
    abono_seguro: result.totales?.totalAbonoSeguro ?? 0,
    abono_gps: result.totales?.totalAbonoGps ?? 0,
    mora: result.totales?.totalMora ?? 0,
    pagoConvenio: result.totales?.totalConvenio ?? 0,
    otros: result.totales?.totalOtros ?? 0,
    reserva: result.totales?.totalReserva ?? 0,
    membresias: result.totales?.totalMembresias ?? 0,
  });

  totalRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "000000" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD966" } };
    cell.border = {
      top: { style: "medium", color: { argb: "1F4E79" } },
      bottom: { style: "medium", color: { argb: "1F4E79" } },
    };
  });

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);

  const s3 = new S3Client({
    endpoint: process.env.BUCKET_REPORTS_URL,
    region: "auto",
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });

  const filename = `reportes/pagos_asesores_${Date.now()}.xlsx`;

  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.BUCKET_REPORTS!,
      Key: filename,
      Body: uint8Array,
      ContentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    })
  );

  const excelUrl = `${process.env.URL_PUBLIC_R2_REPORTS}/${filename}`;
  console.log("✅ Reporte de asesores subido:", excelUrl);

  return {
    success: true,
    total: result.data.length,
    excelUrl,
  };
}