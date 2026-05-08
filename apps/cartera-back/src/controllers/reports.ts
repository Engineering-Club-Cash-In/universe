import ExcelJS from "exceljs";
import puppeteer from "puppeteer";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getCreditosWithUserByMesAnio } from "./credits";
import { getAllPagosWithCreditAndInversionistas, getPagosConInversionistas } from "./payments";
import { fetchImageBase64 } from "../utils/functions/internReportCancelations";
import { buildNameSearchCondition } from "../utils/functions/generalFunctions";
import { db } from "../database";
import { sql } from "drizzle-orm";

const LOGO_URL = process.env.LOGO_URL || "https://pub-8081c8d6e5e743f9adfc9e0db92e5a88.r2.dev/reports/logo-cashin.png";

export async function getCreditosWithUserByMesAnioExcel(
  params: {
    mes: number;
    anio: number;
    page?: number;
    perPage?: number;
    numero_credito_sifco?: string;
    numeros_credito_sifco?: string[];
    estado?: "ACTIVO" | "CANCELADO" | "INCOBRABLE" | "PENDIENTE_CANCELACION" | "MOROSO" | "EN_CONVENIO" | "CAIDO";
    asesor_id?: number;
    nombre_usuario?: string;
    email_asesor?: string; // 🆕 NUEVO
    cuotas_atrasadas?: number; // 🆕 NUEVO
    proximidad_pago?: "TODAY" | "WEEK" | "TWO_WEEKS" | "MONTH" | "DUEMONTH";
    is_vehiculo_propio?: boolean;
    inversionista_ids?: number[];
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
    rest.email_asesor,
    rest.cuotas_atrasadas,
    rest.proximidad_pago,
    rest.is_vehiculo_propio,
    rest.inversionista_ids,
    undefined, // fecha_desde
    undefined, // fecha_hasta
    rest.numeros_credito_sifco
  );

  if (!excel) return result; // si no piden excel, devolvemos JSON normal

  console.log("📊 Generando Excel con", result.data.length, "créditos...");

  // 📝 Workbook + hoja
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Créditos");

  // 1️⃣ Definir columnas base y de inversionistas
  const columns: any[] = [
    { header: "Crédito ID", key: "credito_id", width: 12 },
    { header: "Número SIFCO", key: "numero_credito_sifco", width: 20 },
    { header: "Estado", key: "estado", width: 15 },
    { header: "Capital", key: "capital", width: 15 },
    { header: "Cuota", key: "cuota", width: 15 },
    { header: "Deuda Total", key: "deuda_total", width: 15 },
    { header: "Deuda con Mora", key: "deuda_con_mora", width: 15 },
    { header: "Plazo", key: "plazo", width: 10 },
    { header: "Usuario", key: "usuario", width: 25 },
    { header: "NIT", key: "usuario_nit", width: 20 },
    { header: "Categoría", key: "usuario_categoria", width: 15 },
    { header: "Saldo a Favor", key: "saldo_favor", width: 15 },
    { header: "Asesor", key: "asesor", width: 20 },
    { header: "Email Asesor", key: "email_asesor", width: 30 },
    { header: "Observaciones", key: "observaciones", width: 50 },
    
    { header: "% Interés", key: "porcentaje_interes", width: 12 },
    { header: "Cuota Interés", key: "cuota_interes", width: 15 },
    { header: "IVA 12%", key: "iva_12", width: 15 },
    { header: "Seguro", key: "seguro", width: 15 },
    { header: "GPS", key: "gps", width: 15 },
    { header: "Membresías", key: "membresias", width: 15 },
    { header: "Royalti", key: "royalti", width: 15 },
    { header: "No. Póliza", key: "no_poliza", width: 20 },
    { header: "Formato Crédito", key: "formato_credito", width: 20 },
    { header: "V. Cash-In", key: "is_vehiculo_propio", width: 12 },
    { header: "Fecha Inicio", key: "fecha_inicio", width: 15 },
    { header: "Dirección", key: "usuario_direccion", width: 30 },
    { header: "Municipio", key: "usuario_municipio", width: 20 },
    { header: "Departamento", key: "usuario_departamento", width: 20 },
    
    { header: "Tiene Mora", key: "tiene_mora", width: 12 },
    { header: "Monto Mora", key: "monto_mora", width: 15 },
    { header: "Cuotas Atrasadas", key: "cuotas_atrasadas", width: 18 },
    
    { header: "Próxima Cuota #", key: "proxima_cuota_numero", width: 18 },
    { header: "Fecha Vencimiento", key: "proxima_fecha_venc", width: 20 },
    { header: "Proximidad", key: "proximidad_pago", width: 15 },
    { header: "Cuota Pagada", key: "proxima_cuota_pagada", width: 15 },
    
    { header: "Total CashIn Monto", key: "total_cash_in_monto", width: 20 },
    { header: "Total CashIn IVA", key: "total_cash_in_iva", width: 20 },
    { header: "Total Inversión Monto", key: "total_inversion_monto", width: 20 },
    { header: "Total Inversión IVA", key: "total_inversion_iva", width: 20 },

    // Inversionistas (ahora estáticos)
    { header: "Inversionista Nombre", key: "inv_nombre", width: 25 },
    { header: "Monto Aportado", key: "inv_aportado", width: 15 },
    { header: "Monto CashIn", key: "inv_cashin", width: 15 },
    { header: "Monto Inversión", key: "inv_inversion", width: 15 },
    { header: "IVA CashIn", key: "inv_iva_cashin", width: 15 },
    { header: "IVA Inversión", key: "inv_iva_inversion", width: 15 },
    { header: "% Inversionista", key: "inv_porcentaje", width: 15 },
    { header: "% CashIn", key: "inv_porcentaje_cashin", width: 15 },
  ];

  sheet.columns = columns;

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: "FFFFFF" } };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "1F4E79" } };
  headerRow.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  headerRow.height = 30;

  const thinBorder = {
    top: { style: "thin" as const, color: { argb: "D9D9D9" } },
    bottom: { style: "thin" as const, color: { argb: "D9D9D9" } },
    left: { style: "thin" as const, color: { argb: "D9D9D9" } },
    right: { style: "thin" as const, color: { argb: "D9D9D9" } },
  };

  // 2️⃣ Poblar filas con agrupación
  let isEvenGroup = false;

  result.data.forEach((item) => {
    isEvenGroup = !isEvenGroup;
    // F5F9FF is a very light blue. FFFFFF is white. We'll alternate between them.
    const groupBgColor = isEvenGroup ? "FFFFFF" : "F5F9FF";

    const baseCreditData: any = {
      credito_id: item.creditos.credito_id,
      numero_credito_sifco: item.creditos.numero_credito_sifco,
      estado: item.creditos.statusCredit,
      capital: item.creditos.capital,
      cuota: item.creditos.cuota,
      deuda_total: item.creditos.deudatotal,
      deuda_con_mora: item.deuda_total_con_mora || item.creditos.deudatotal,
      plazo: item.creditos.plazo,
      usuario: item.usuarios.nombre,
      usuario_nit: item.usuarios.nit,
      usuario_categoria: item.usuarios.categoria,
      saldo_favor: item.usuarios.saldo_a_favor,
      asesor: item.asesores.nombre,
      email_asesor: item.asesores.emailCashIn || "",
      fecha_creacion: item.creditos.fecha_creacion,
      observaciones: item.creditos.observaciones,

      porcentaje_interes: `${item.creditos.porcentaje_interes}%`,
      cuota_interes: item.creditos.cuota_interes,
      iva_12: item.creditos.iva_12,
      seguro: item.creditos.seguro_10_cuotas,
      gps: item.creditos.gps,
      membresias: item.creditos.membresias_pago,
      royalti: item.creditos.royalti,
      no_poliza: item.creditos.no_poliza,
      formato_credito: item.creditos.formato_credito,
      is_vehiculo_propio: item.creditos.is_vehiculo_propio ? "SI" : "NO",
      fecha_inicio: item.fecha_inicio ? item.fecha_inicio : "--",
      usuario_direccion: item.usuarios.direccion || "--",
      usuario_municipio: item.usuarios.municipio || "--",
      usuario_departamento: item.usuarios.departamento || "--",

      tiene_mora: item.mora?.activa ? "SI" : "NO",
      monto_mora: item.mora?.monto_mora || 0,
      cuotas_atrasadas: item.mora?.cuotas_atrasadas || 0,
      
      proxima_cuota_numero: item.proxima_cuota?.numero_cuota || "N/A",
      proxima_fecha_venc: item.proxima_cuota?.fecha_vencimiento || "N/A",
      proximidad_pago: item.proxima_cuota?.proximidad || "N/A",
      proxima_cuota_pagada: item.proxima_cuota?.pagado ? "Sí" : "No",
      
      total_cash_in_monto: item.resumen.total_cash_in_monto,
      total_cash_in_iva: item.resumen.total_cash_in_iva,
      total_inversion_monto: item.resumen.total_inversion_monto,
      total_inversion_iva: item.resumen.total_inversion_iva,
    };

    const inversionistas = item.inversionistas || [];
    const firstRowIndex = sheet.rowCount + 1;

    if (inversionistas.length === 0) {
      // Sin inversionistas: 1 fila vacía en la parte de inversionistas
      const r = sheet.addRow(baseCreditData);
      r.eachCell({ includeEmpty: true }, (cell) => { 
        cell.border = thinBorder; 
        cell.alignment = { vertical: "middle" }; 
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: groupBgColor } };
      });
    } else {
      // Diferentes filas por cada inversionista
      inversionistas.forEach((inv) => {
        const row = {
          ...baseCreditData,
          inv_nombre: inv.nombre,
          inv_aportado: inv.monto_aportado,
          inv_cashin: inv.monto_cash_in,
          inv_inversion: inv.monto_inversionista,
          inv_iva_cashin: inv.iva_cash_in,
          inv_iva_inversion: inv.iva_inversionista,
          inv_porcentaje: inv.porcentaje_participacion_inversionista,
          inv_porcentaje_cashin: inv.porcentaje_cash_in,
        };
        const r = sheet.addRow(row);
        r.eachCell({ includeEmpty: true }, (cell) => { 
          cell.border = thinBorder; 
          cell.alignment = { vertical: "middle" }; 
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: groupBgColor } };
        });
      });

      // ── Fila de resumen/totales de los inversionistas ──
      const summaryRowData: any = {};
      summaryRowData.inv_nombre = "TOTALES INVERSIONISTAS:";
      summaryRowData.inv_aportado = inversionistas.reduce((acc, inv) => acc + Number(inv.monto_aportado || 0), 0);
      summaryRowData.inv_cashin = inversionistas.reduce((acc, inv) => acc + Number(inv.monto_cash_in || 0), 0);
      summaryRowData.inv_inversion = inversionistas.reduce((acc, inv) => acc + Number(inv.monto_inversionista || 0), 0);
      summaryRowData.inv_iva_cashin = inversionistas.reduce((acc, inv) => acc + Number(inv.iva_cash_in || 0), 0);
      summaryRowData.inv_iva_inversion = inversionistas.reduce((acc, inv) => acc + Number(inv.iva_inversionista || 0), 0);
      summaryRowData.inv_porcentaje = "";
      summaryRowData.inv_porcentaje_cashin = "";

      const sumRow = sheet.addRow(summaryRowData);
      sumRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        cell.border = thinBorder;
        cell.alignment = { vertical: "middle" };
        
        // Solo coloreamos y ponemos negrita en la parte de los totales (cols > 40 que son las de inversionistas)
        if (colNumber > 40) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: "B4D6E4" } }; // Color Teal clarito como en Pagos
          cell.font = { bold: true };
        } else {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: groupBgColor } };
        }
      });

      const lastRowIndex = sheet.rowCount;

      // Unir las celdas del crédito si hay más de 1 inversionista o si agregamos totales (siempre unimos hasta la fila resumen)
      // Merging credit columns (1 to 40 now with new columns)
      for (let col = 1; col <= 40; col++) {
        sheet.mergeCells(firstRowIndex, col, lastRowIndex, col);
        sheet.getCell(firstRowIndex, col).alignment = { vertical: "middle", horizontal: "left" };
      }
    }

    // Al finalizar con el crédito, agregarle un borde inferior más grueso a toda su última fila
    // para separar visualmente este crédito del siguiente.
    const lastSummaryRow = sheet.getRow(sheet.rowCount);
    lastSummaryRow.eachCell({ includeEmpty: true }, (cell) => {
      const currentBorder: any = cell.border || { ...thinBorder };
      currentBorder.bottom = { style: 'medium', color: { argb: "999999" } };
      cell.border = currentBorder;
    });
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

  // Filtrar solo pagos pagados
  const pagosFiltrados = pagosData.filter(
    ({ pago }) => pago.pagado === true
  );

  if (!pagosFiltrados.length) {
    throw new Error(`No hay pagos pagados para el crédito ${credito_sifco}`);
  }

  console.log(`📊 Generando PDF con ${pagosFiltrados.length} pagos pagados...`);

  const primerPago = pagosFiltrados[0].pago;
  const nombreDeudor = primerPago.usuario_nombre ?? "";
  const numCredito = primerPago.numero_credito_sifco ?? credito_sifco;
  const fechaGen = new Date().toLocaleDateString("es-GT", { year: "numeric", month: "long", day: "numeric" });

  const formatQ = (n: number) => `Q${n.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // Calcular totales
  let totalMontoAplicado = 0;
  let totalCapital = 0;
  let totalInteres = 0;

  const tableRows = pagosFiltrados.map(({ pago }, index) => {
    const montoAplicado = Number(pago.monto_aplicado || 0);
    const capitalPago = Number(pago.abono_capital || 0);
    const interesPago = Number(pago.abono_interes || 0);
    totalMontoAplicado += montoAplicado;
    totalCapital += capitalPago;
    totalInteres += interesPago;

    const fechaPago = pago.fecha_vencimiento
      ? new Date(pago.fecha_vencimiento).toLocaleDateString("es-GT", { year: "numeric", month: "2-digit", day: "2-digit" })
      : "";

    const isEven = index % 2 === 0;
    return `<tr class="${isEven ? "even" : ""}">
      <td>${index + 1}</td>
      <td>${pago.pago_id}</td>
      <td>${pago.numero_cuota ?? ""}</td>
      <td class="money">${formatQ(Number(pago.cuota || 0))}</td>
      <td class="money">${formatQ(capitalPago)}</td>
      <td class="money">${formatQ(interesPago)}</td>
      <td class="money">${formatQ(Number(pago.abono_iva_12 || 0))}</td>
      <td class="money">${formatQ(Number(pago.abono_seguro || 0) + Number(pago.abono_gps || 0) + Number(pago.membresias_pago || 0))}</td>
      <td class="money">${formatQ(Number(pago.mora || 0))}</td>
      <td class="money total">${formatQ(montoAplicado)}</td>
      <td class="money">${formatQ(Number(pago.total_restante || 0))}</td>
      <td>${fechaPago}</td>
    </tr>`;
  }).join("");

  // 2️⃣ HTML del reporte
  const html = `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8">
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { font-family: 'Segoe UI', Arial, sans-serif; padding: 20px 25px; color: #333; }
      .header-bar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;
        padding-bottom: 12px;
        border-bottom: 3px solid #1F4E79;
      }
      .header-bar img { height: 50px; }
      .header-bar .title-block { text-align: right; }
      .header-bar h1 { font-size: 18px; color: #1F4E79; margin: 0; }
      .header-bar p { font-size: 10px; color: #888; margin: 0; }
      .info-bar {
        display: flex;
        justify-content: space-between;
        background: #f0f5fa;
        border-radius: 6px;
        padding: 8px 14px;
        margin-bottom: 12px;
        font-size: 11px;
      }
      .info-bar span { color: #555; }
      .info-bar strong { color: #1F4E79; }
      table { width: 100%; border-collapse: collapse; font-size: 8px; }
      th {
        background: #1F4E79;
        color: #fff;
        padding: 6px 4px;
        text-align: center;
        font-weight: 600;
        font-size: 7.5px;
        white-space: nowrap;
        border: 1px solid #0D3B66;
      }
      td {
        padding: 4px 3px;
        text-align: center;
        border-bottom: 1px solid #e8e8e8;
        white-space: nowrap;
      }
      td.money { text-align: right; font-family: 'Consolas', monospace; font-size: 7.5px; }
      td.total { font-weight: 600; color: #1F4E79; }
      tr.even td { background: #f8fafc; }
      tr:hover td { background: #eef3f9; }
      .totals-row td {
        background: #1F4E79 !important;
        color: #fff;
        font-weight: 700;
        font-size: 8px;
        padding: 6px 4px;
        border: 1px solid #0D3B66;
      }
      .totals-row td.money { text-align: right; color: #fff; }
      .summary {
        margin-top: 14px;
        display: flex;
        gap: 12px;
      }
      .summary-card {
        flex: 1;
        background: #f0f5fa;
        border-radius: 6px;
        padding: 10px 14px;
        text-align: center;
        border-top: 3px solid #1F4E79;
      }
      .summary-card .label { font-size: 9px; color: #888; text-transform: uppercase; margin-bottom: 2px; }
      .summary-card .value { font-size: 14px; font-weight: 700; color: #1F4E79; }
      .footer {
        margin-top: 16px;
        text-align: center;
        font-size: 8px;
        color: #aaa;
        border-top: 1px solid #eee;
        padding-top: 8px;
      }
    </style>
  </head>
  <body>
    <div class="header-bar">
      <img src="${LOGO_URL}" alt="Cash-In" />
      <div class="title-block">
        <h1>Estado de Cuenta</h1>
        <p>Club Cash-In</p>
      </div>
    </div>

    <div class="info-bar">
      <span><strong>Crédito:</strong> ${numCredito}</span>
      <span><strong>Cliente:</strong> ${nombreDeudor}</span>
      <span><strong>Generado:</strong> ${fechaGen}</span>
    </div>

    <table>
      <thead>
        <tr>
          <th>No.</th>
          <th>Pago ID</th>
          <th># Cuota</th>
          <th>Cuota</th>
          <th>Capital</th>
          <th>Interés</th>
          <th>IVA 12%</th>
          <th>Servicios</th>
          <th>Mora</th>
          <th>Monto Aplicado</th>
          <th>Capital Rest.</th>
          <th>Fecha Vencimiento Cuota</th>
        </tr>
      </thead>
      <tbody>
        ${tableRows}
        <tr class="totals-row">
          <td colspan="4">TOTALES</td>
          <td class="money">${formatQ(totalCapital)}</td>
          <td class="money">${formatQ(totalInteres)}</td>
          <td colspan="3"></td>
          <td class="money">${formatQ(totalMontoAplicado)}</td>
          <td colspan="2"></td>
        </tr>
      </tbody>
    </table>

    <div class="summary">
      <div class="summary-card">
        <div class="label">Total Pagos</div>
        <div class="value">${pagosFiltrados.length}</div>
      </div>
      <div class="summary-card">
        <div class="label">Capital Abonado</div>
        <div class="value">${formatQ(totalCapital)}</div>
      </div>
      <div class="summary-card">
        <div class="label">Interés Abonado</div>
        <div class="value">${formatQ(totalInteres)}</div>
      </div>
      <div class="summary-card">
        <div class="label">Monto Aplicado</div>
        <div class="value">${formatQ(totalMontoAplicado)}</div>
      </div>
    </div>

    <div class="footer">
      Este documento fue generado por el sistema de Club Cash-In &mdash; ${fechaGen}
    </div>
  </body>
  </html>`;

  // 3️⃣ Generar PDF con Puppeteer (landscape para que quepan las columnas)
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "networkidle0" });
  const pdfData = await page.pdf({
    format: "A4",
    landscape: true,
    printBackground: true,
    margin: { top: "10mm", bottom: "10mm", left: "8mm", right: "8mm" },
  });
  await browser.close();

  // 4️⃣ Subir a R2
  const fileBuffer = Buffer.from(pdfData);
  const filename = `reportes/estado_cuenta_${credito_sifco}_${Date.now()}.pdf`;
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
      Body: fileBuffer,
      ContentType: "application/pdf",
    })
  );

  console.log("✅ Estado de cuenta PDF subido:", filename);

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
    fechaBoleta?: string;
    fechaBoletaInicio?: string;
    fechaBoletaFin?: string;
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
    { header: "Banco", key: "bancoNombre", width: 20 },
    { header: "Cuenta Empresa", key: "cuentaEmpresaNombre", width: 20 },
    { header: "Banco Empresa", key: "cuentaEmpresaBanco", width: 20 },
    { header: "Número Cuenta Empresa", key: "cuentaEmpresaNumero", width: 20 },
    { header: "¿Tiene Factura?", key: "tieneFactura", width: 15 },
    { header: "Números Factura", key: "numerosFactura", width: 30 },
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

    const facturas = item.facturas ?? [];
    const tieneFactura = facturas.length > 0 ? "Sí" : "No";
    const numerosFactura = facturas
      .map((f: any) => `[${f.serie}-${f.numero}]`)
      .join("");

    // Campos comunes del pago
    const commonPayFields = {
      categoriaCredito: item.usuario?.categoria ?? "",
      tipoPago,
      fechaAplicado: item.fechaAplicado ?? "",
      origenPago: item.origenPago ?? "",
      boletas: boletas.map((b: any) => b.urlBoleta).filter(Boolean).join("\n"),
      bancoNombre: item.bancoNombre ?? "",
      cuentaEmpresaNombre: item.cuentaEmpresaNombre ?? "",
      cuentaEmpresaBanco: item.cuentaEmpresaBanco ?? "",
      cuentaEmpresaNumero: item.cuentaEmpresaNumero ?? "",
      tieneFactura,
      numerosFactura,
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
    fechaBoleta?: string;
    fechaBoletaInicio?: string;
    fechaBoletaFin?: string;
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
    { header: "¿Tiene Factura?", key: "tieneFactura", width: 15 },
    { header: "Números Factura", key: "numerosFactura", width: 30 },
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
      tieneFactura: (item.facturas ?? []).length > 0 ? "Sí" : "No",
      numerosFactura: (item.facturas ?? [])
        .map((f: any) => `[${f.serie}-${f.numero}]`)
        .join(""),
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

/**
 * Genera un recibo de pago en PDF y lo sube a R2
 */
export async function generateReciboPagoPDF(pagoId: number) {
  // 1️⃣ Traer datos del pago con crédito, usuario y cuota
  const result = await db.execute(sql`
    SELECT
      p.pago_id,
      p.monto_boleta,
      p.monto_aplicado,
      p.cuota,
      p.abono_capital,
      p.abono_interes,
      p.abono_iva_12,
      p.abono_seguro,
      p.abono_gps,
      p.mora,
      p.otros,
      p.reserva,
      p.membresias_pago,
      p.pago_convenio,
      p.observaciones,
      TO_CHAR(p.fecha_pago AT TIME ZONE 'UTC' AT TIME ZONE 'America/Guatemala', 'YYYY-MM-DD HH24:MI:SS') AS fecha_pago,
      p.origen_pago,
      c.numero_credito_sifco,
      u.nombre AS usuario_nombre,
      u.nit AS usuario_nit,
      cq.numero_cuota
    FROM cartera.pagos_credito p
    INNER JOIN cartera.creditos c ON c.credito_id = p.credito_id
    INNER JOIN cartera.usuarios u ON u.usuario_id = c.usuario_id
    LEFT JOIN cartera.cuotas_credito cq ON cq.cuota_id = p.cuota_id
    WHERE p.pago_id = ${pagoId}
  `);

  if (!result.rows.length) {
    throw new Error(`No se encontró el pago con ID ${pagoId}`);
  }

  const pago = result.rows[0] as any;

  const montoBoleta = Number(pago.monto_boleta || 0);
  const montoAplicado = Number(pago.monto_aplicado || 0);
  const abonoCapital = Number(pago.abono_capital || 0);
  const abonoInteres = Number(pago.abono_interes || 0);
  const abonoIva = Number(pago.abono_iva_12 || 0);
  const abonoSeguro = Number(pago.abono_seguro || 0);
  const abonoGps = Number(pago.abono_gps || 0);
  const mora = Number(pago.mora || 0);
  const otros = Number(pago.otros || 0);
  const reserva = Number(pago.reserva || 0);
  const membresias = Number(pago.membresias_pago || 0);
  const pagoConvenio = Number(pago.pago_convenio || 0);

  // Abono capital solo si los demás abonos son 0
  const otrosAbonosSonCero = abonoInteres === 0 && abonoIva === 0 && abonoSeguro === 0 && abonoGps === 0;
  const mostrarAbonoCapital = otrosAbonosSonCero && abonoCapital > 0;

  const formatQ = (n: number) => `Q${n.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const fechaPago = pago.fecha_pago
    ? new Date(pago.fecha_pago).toLocaleDateString("es-GT", { year: "numeric", month: "long", day: "numeric" })
    : "N/A";

  // Construir filas del detalle (solo lo esencial)
  const desgloseRows: string[] = [];

  desgloseRows.push(`<tr><td>Monto Boleta</td><td>${formatQ(montoBoleta)}</td></tr>`);
  if (mostrarAbonoCapital) {
    desgloseRows.push(`<tr><td>Abono a Capital</td><td>${formatQ(abonoCapital)}</td></tr>`);
  }
  if (mora > 0) desgloseRows.push(`<tr><td>Mora</td><td>${formatQ(mora)}</td></tr>`);
  if (otros > 0) desgloseRows.push(`<tr><td>Otros</td><td>${formatQ(otros)}</td></tr>`);

  // 2️⃣ Generar HTML del recibo
  const html = `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8">
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { font-family: 'Segoe UI', Arial, sans-serif; background: #f5f5f5; padding: 40px; }
      .recibo {
        max-width: 500px;
        margin: 0 auto;
        background: #fff;
        border-radius: 12px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.08);
        overflow: hidden;
      }
      .header {
        background: linear-gradient(135deg, #1F4E79, #2E75B6);
        color: #fff;
        padding: 30px 30px 25px;
        text-align: center;
      }
      .header img {
        width: 120px;
        margin-bottom: 12px;
      }
      .header h1 {
        font-size: 20px;
        font-weight: 600;
        margin-bottom: 4px;
      }
      .header p {
        font-size: 12px;
        opacity: 0.85;
      }
      .badge {
        display: inline-block;
        background: rgba(255,255,255,0.2);
        padding: 4px 14px;
        border-radius: 20px;
        font-size: 11px;
        margin-top: 10px;
        letter-spacing: 0.5px;
      }
      .body { padding: 25px 30px; }
      .info-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
        margin-bottom: 20px;
      }
      .info-item {
        background: #f8fafc;
        border-radius: 8px;
        padding: 10px 12px;
      }
      .info-item.full { grid-column: 1 / -1; }
      .info-label {
        font-size: 10px;
        color: #8899a6;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: 2px;
      }
      .info-value {
        font-size: 13px;
        color: #1a1a2e;
        font-weight: 500;
      }
      .divider {
        border: none;
        border-top: 1px dashed #e0e0e0;
        margin: 20px 0;
      }
      .desglose h3 {
        font-size: 13px;
        color: #1F4E79;
        margin-bottom: 10px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      .desglose table {
        width: 100%;
        border-collapse: collapse;
      }
      .desglose td {
        padding: 8px 0;
        font-size: 13px;
        color: #333;
      }
      .desglose td:last-child {
        text-align: right;
        font-weight: 500;
      }
      .desglose tr:not(:last-child) td {
        border-bottom: 1px solid #f0f0f0;
      }
      .total-row {
        background: linear-gradient(135deg, #1F4E79, #2E75B6);
        border-radius: 8px;
        padding: 14px 16px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-top: 16px;
      }
      .total-row span:first-child {
        color: rgba(255,255,255,0.85);
        font-size: 13px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      .total-row span:last-child {
        color: #fff;
        font-size: 20px;
        font-weight: 700;
      }
      .footer {
        background: #f8fafc;
        padding: 16px 30px;
        text-align: center;
        border-top: 1px solid #eee;
      }
      .footer p {
        font-size: 10px;
        color: #999;
      }
      ${pago.observaciones ? `.obs { background: #fffbeb; border-left: 3px solid #f59e0b; padding: 10px 12px; border-radius: 0 6px 6px 0; margin-top: 16px; font-size: 12px; color: #92400e; }` : ""}
    </style>
  </head>
  <body>
    <div class="recibo">
      <div class="header">
        <img src="${LOGO_URL}" alt="Cash-In" />
        <h1>Recibo de Pago</h1>
        <p>Club Cash-In</p>
        <div class="badge">No. ${pago.pago_id}</div>
      </div>
      <div class="body">
        <div class="info-grid">
          <div class="info-item full">
            <div class="info-label">Cliente</div>
            <div class="info-value">${pago.usuario_nombre}</div>
          </div>
          <div class="info-item">
            <div class="info-label">NIT</div>
            <div class="info-value">${pago.usuario_nit || "C/F"}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Crédito</div>
            <div class="info-value">${pago.numero_credito_sifco}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Cuota No.</div>
            <div class="info-value">${pago.numero_cuota ?? "N/A"}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Fecha</div>
            <div class="info-value">${fechaPago}</div>
          </div>
          ${pago.origen_pago ? `
          <div class="info-item">
            <div class="info-label">Origen</div>
            <div class="info-value">${pago.origen_pago}</div>
          </div>` : ""}
        </div>

        <hr class="divider" />

        <div class="desglose">
          <h3>Desglose del Pago</h3>
          <table>
            ${desgloseRows.join("")}
          </table>
        </div>

        <div class="total-row">
          <span>Monto Aplicado</span>
          <span>${formatQ(montoAplicado)}</span>
        </div>

        ${pago.observaciones ? `<div class="obs">${pago.observaciones}</div>` : ""}
      </div>
      <div class="footer">
        <p>Este documento es un comprobante de pago generado por el sistema de Club Cash-In.</p>
        <p>Generado el ${new Date().toLocaleDateString("es-GT", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
      </div>
    </div>
  </body>
  </html>`;

  // 3️⃣ Generar PDF con Puppeteer
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "networkidle0" });
  const pdfData = await page.pdf({
    format: "A4",
    printBackground: true,
    margin: { top: "10mm", bottom: "10mm", left: "10mm", right: "10mm" },
  });
  await browser.close();

  // 4️⃣ Subir a R2
  const fileBuffer = Buffer.from(pdfData);
  const filename = `recibos/recibo_pago_${pagoId}_${Date.now()}.pdf`;
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
      Bucket: process.env.BUCKET_REPORTS as string,
      Key: filename,
      Body: fileBuffer,
      ContentType: "application/pdf",
    })
  );

  const url = `${process.env.URL_PUBLIC_R2_REPORTS}/${filename}`;
  console.log("✅ Recibo de pago PDF subido:", url);

  return { pdfUrl: url };
}

export async function getPagosByVencimiento({
  mes,
  anio,
  page = 1,
  pageSize = 20,
  numero_credito_sifco,
  nombre_usuario,
  tipo_fecha = "vencimiento",
  asesor,
  rango_mora,
}: {
  mes: number;
  anio: number;
  page?: number;
  pageSize?: number;
  numero_credito_sifco?: string;
  nombre_usuario?: string;
  tipo_fecha?: "vencimiento" | "creacion";
  asesor?: string;
  rango_mora?: string;
}) {
  const fechaInicio = `${anio}-${String(mes).padStart(2, "0")}-01`;
  const fechaFinDate = new Date(anio, mes, 0);
  const fechaFin = `${anio}-${String(mes).padStart(2, "0")}-${String(fechaFinDate.getDate()).padStart(2, "0")}`;

  // Filtros dinámicos
  const filters: any[] = [
    sql`COALESCE(q.fecha_vencimiento, p.fecha_vencimiento)::date >= ${fechaInicio}`,
    sql`COALESCE(q.fecha_vencimiento, p.fecha_vencimiento)::date <= ${fechaFin}`,
  ];

  if (tipo_fecha === "creacion") {
    filters.push(sql`c.fecha_creacion::date >= ${fechaInicio}`);
    filters.push(sql`c.fecha_creacion::date <= ${fechaFin}`);
  }

  if (numero_credito_sifco) {
    filters.push(sql`c.numero_credito_sifco ILIKE ${"%" + numero_credito_sifco + "%"}`);
  }
  if (nombre_usuario) {
    const nameCond = buildNameSearchCondition(sql`u.nombre`, nombre_usuario);
    if (nameCond) filters.push(nameCond);
  }
  if (asesor) {
    const asesorNames = asesor.split(",").map((n) => n.trim()).filter((n) => n.length > 0);
    if (asesorNames.length > 0) {
      const orConditions = asesorNames.map((name) => sql`a.nombre ILIKE ${"%" + name + "%"}`);
      filters.push(sql.join(orConditions, sql` OR `));
    }
  }
  if (rango_mora) {
    if (rango_mora === "0-30") filters.push(sql`m.cuotas_atrasadas = 1 AND m.activa = true AND p.pagado = false`);
    else if (rango_mora === "31-60") filters.push(sql`m.cuotas_atrasadas = 2 AND m.activa = true AND p.pagado = false`);
    else if (rango_mora === "61-90") filters.push(sql`m.cuotas_atrasadas = 3 AND m.activa = true AND p.pagado = false`);
    else if (rango_mora === "+90") filters.push(sql`m.cuotas_atrasadas >= 4 AND m.activa = true AND p.pagado = false`);
  }
  const whereClause = sql.join(filters, sql` AND `);

  // Subquery para los porcentajes de Cube por crédito
  const cubeSubquery = sql`
    LEFT JOIN LATERAL (
      SELECT
        CASE
          WHEN sum_montos.total > 0 THEN
            (ci_cube.porcentaje_cash_in::numeric / 100.0) * (ci_cube.monto_aportado::numeric / sum_montos.total)
          ELSE 0
        END AS cube_pct
      FROM cartera.creditos_inversionistas ci_cube
      INNER JOIN cartera.inversionistas inv_cube
        ON ci_cube.inversionista_id = inv_cube.inversionista_id
      CROSS JOIN LATERAL (
        SELECT COALESCE(SUM(ci_all.monto_aportado::numeric), 0) AS total
        FROM cartera.creditos_inversionistas ci_all
        WHERE ci_all.credito_id = p.credito_id
      ) sum_montos
      WHERE ci_cube.credito_id = p.credito_id
        AND LOWER(TRIM(inv_cube.nombre)) = 'cube investments s.a.'
      LIMIT 1
    ) cube_data ON true
  `;

  // SQL para calcular el total por fila (Suma de restantes + Suma de abonos)
  const totalFilaSql = sql`(
    COALESCE(p.capital_restante, 0)::numeric + 
    COALESCE(p.interes_restante, 0)::numeric + 
    COALESCE(p.iva_12_restante, 0)::numeric + 
    COALESCE(p.seguro_restante, 0)::numeric + 
    COALESCE(p.gps_restante, 0)::numeric + 
    COALESCE(p.membresias, 0)::numeric + 
    COALESCE(p.membresias_pago, 0)::numeric + 
    COALESCE(p.abono_capital, 0)::numeric + 
    COALESCE(p.abono_interes, 0)::numeric + 
    COALESCE(p.abono_iva_12, 0)::numeric + 
    COALESCE(p.abono_seguro, 0)::numeric + 
    COALESCE(p.abono_gps, 0)::numeric
  )`;

  // 1. Totales globales y conteo de créditos únicos
  const totalesResult = await db.execute<any>(sql`
    SELECT
      COUNT(DISTINCT c.credito_id)::int AS total_count,
      COALESCE(SUM(p.capital_restante::numeric + COALESCE(p.abono_capital, 0)::numeric), 0) AS total_capital_restante,
      COALESCE(SUM(p.interes_restante::numeric + COALESCE(p.abono_interes, 0)::numeric), 0) AS total_interes_restante,
      COALESCE(SUM(p.iva_12_restante::numeric + COALESCE(p.abono_iva_12, 0)::numeric), 0) AS total_iva_12_restante,
      COALESCE(SUM(p.seguro_restante::numeric + COALESCE(p.abono_seguro, 0)::numeric), 0) AS total_seguro_restante,
      COALESCE(SUM(p.gps_restante::numeric + COALESCE(p.abono_gps, 0)::numeric), 0) AS total_gps_restante,
      COALESCE(SUM(p.membresias::numeric + COALESCE(p.membresias_pago, 0)::numeric), 0) AS total_membresias,
      COALESCE(SUM((p.interes_restante::numeric + COALESCE(p.abono_interes, 0)::numeric) * COALESCE(cube_data.cube_pct, 0)), 0) AS total_interes_cube,
      COALESCE(SUM((p.iva_12_restante::numeric + COALESCE(p.abono_iva_12, 0)::numeric) * COALESCE(cube_data.cube_pct, 0)), 0) AS total_iva_cube
    FROM cartera.pagos_credito p
    INNER JOIN cartera.creditos c ON p.credito_id = c.credito_id
    INNER JOIN cartera.usuarios u ON c.usuario_id = u.usuario_id
    INNER JOIN cartera.asesores a ON c.asesor_id = a.asesor_id
    LEFT JOIN cartera.cuotas_credito q ON p.cuota_id = q.cuota_id
    LEFT JOIN cartera.moras_credito m ON c.credito_id = m.credito_id AND m.activa = true
    ${cubeSubquery}
    WHERE ${whereClause}
      AND ${totalFilaSql} <> 0
  `);

  const totalesRow = totalesResult.rows[0];
  const total = Number(totalesRow?.total_count ?? 0);
  const offset = (page - 1) * pageSize;

  // 2. Pagos agrupados por crédito
  const pagosResult = await db.execute<any>(sql`
    SELECT
      c.credito_id,
      c.numero_credito_sifco,
      u.nombre AS nombre_usuario,
      a.nombre AS asesor,
      MIN(q.numero_cuota) AS cuota_min,
      MAX(q.numero_cuota) AS cuota_max,
      COALESCE(SUM(p.capital_restante::numeric + COALESCE(p.abono_capital, 0)::numeric), 0) AS capital_restante,
      COALESCE(SUM(p.interes_restante::numeric + COALESCE(p.abono_interes, 0)::numeric), 0) AS interes_restante,
      COALESCE(SUM(p.iva_12_restante::numeric + COALESCE(p.abono_iva_12, 0)::numeric), 0) AS iva_12_restante,
      COALESCE(SUM(p.seguro_restante::numeric + COALESCE(p.abono_seguro, 0)::numeric), 0) AS seguro_restante,
      COALESCE(SUM(p.gps_restante::numeric + COALESCE(p.abono_gps, 0)::numeric), 0) AS gps_restante,
      COALESCE(SUM(p.membresias::numeric + COALESCE(p.membresias_pago, 0)::numeric), 0) AS membresias,
      COALESCE(SUM(p.monto_boleta::numeric), 0) AS monto_boleta,
      COALESCE(SUM((p.interes_restante::numeric + COALESCE(p.abono_interes, 0)::numeric) * COALESCE(cube_data.cube_pct, 0)), 0) AS interes_cube,
      COALESCE(SUM((p.iva_12_restante::numeric + COALESCE(p.abono_iva_12, 0)::numeric) * COALESCE(cube_data.cube_pct, 0)), 0) AS iva_cube,
      COALESCE(SUM(${totalFilaSql}), 0) AS total_pagos_del_mes,
      CASE
        WHEN MAX(m.cuotas_atrasadas) = 1 THEN 'Mora 30'
        WHEN MAX(m.cuotas_atrasadas) = 2 THEN 'Mora 60'
        WHEN MAX(m.cuotas_atrasadas) = 3 THEN 'Mora 90'
        WHEN MAX(m.cuotas_atrasadas) >= 4 THEN 'Mora 120+'
        ELSE 'Al día'
      END AS dias_mora
    FROM cartera.pagos_credito p
    INNER JOIN cartera.creditos c ON p.credito_id = c.credito_id
    INNER JOIN cartera.usuarios u ON c.usuario_id = u.usuario_id
    INNER JOIN cartera.asesores a ON c.asesor_id = a.asesor_id
    LEFT JOIN cartera.cuotas_credito q ON p.cuota_id = q.cuota_id
    LEFT JOIN cartera.moras_credito m ON c.credito_id = m.credito_id AND m.activa = true
    ${cubeSubquery}
    WHERE ${whereClause}
    GROUP BY c.credito_id, c.numero_credito_sifco, u.nombre, a.nombre
    HAVING SUM(${totalFilaSql}) <> 0
    ORDER BY c.numero_credito_sifco
    LIMIT ${pageSize} OFFSET ${offset}
  `);

  const pagos = pagosResult.rows;

  return {
    data: pagos,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
    totales: {
      capital_restante: Number(totalesRow?.total_capital_restante ?? 0).toFixed(2),
      interes_restante: Number(totalesRow?.total_interes_restante ?? 0).toFixed(2),
      iva_12_restante: Number(totalesRow?.total_iva_12_restante ?? 0).toFixed(2),
      seguro_restante: Number(totalesRow?.total_seguro_restante ?? 0).toFixed(2),
      gps_restante: Number(totalesRow?.total_gps_restante ?? 0).toFixed(2),
      membresias: Number(totalesRow?.total_membresias ?? 0).toFixed(2),
      interes_cube: Number(totalesRow?.total_interes_cube ?? 0).toFixed(2),
      iva_cube: Number(totalesRow?.total_iva_cube ?? 0).toFixed(2),
    },
  };
}
