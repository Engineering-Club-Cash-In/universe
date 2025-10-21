import ExcelJS from "exceljs";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getCreditosWithUserByMesAnio } from "./credits";
import { getAllPagosWithCreditAndInversionistas } from "./payments";

export async function getCreditosWithUserByMesAnioExcel(
  params: {
    mes: number;
    anio: number;
    page?: number;
    perPage?: number;
    numero_credito_sifco?: string;
    estado?: "ACTIVO" | "CANCELADO" | "INCOBRABLE" | "PENDIENTE_CANCELACION";
    excel?: boolean;
  }
) {
  const { excel, ...rest } = params;

  // 👉 Traemos la data normal
  const result = await getCreditosWithUserByMesAnio(
    rest.mes,
    rest.anio,
    rest.page ?? 1,
    rest.perPage ?? 10,
    rest.numero_credito_sifco,
    rest.estado
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
    { header: "Plazo", key: "plazo", width: 10 },
    { header: "Usuario", key: "usuario", width: 25 },
    { header: "NIT", key: "usuario_nit", width: 20 },
    { header: "Categoría", key: "usuario_categoria", width: 15 },
    { header: "Saldo a Favor", key: "saldo_favor", width: 15 },
    { header: "Asesor", key: "asesor", width: 20 },
    { header: "Fecha Creación", key: "fecha_creacion", width: 20 },
    { header: "Observaciones", key: "observaciones", width: 50 },
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
      deuda_total: item.creditos.deudatotal, // cuidado aquí, revisa tu schema
      plazo: item.creditos.plazo,
      usuario: item.usuarios.nombre,
      usuario_nit: item.usuarios.nit,
      usuario_categoria: item.usuarios.categoria,
      saldo_favor: item.usuarios.saldo_a_favor,
      asesor: item.asesores.nombre,
      fecha_creacion: item.creditos.fecha_creacion,
      observaciones: item.creditos.observaciones,
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
 

  // 6️⃣ Subir a R2 (igual a como subes PDF)
  const filename = `reportes/creditos_${Date.now()}.xlsx`;
  const s3 = new S3Client({
    endpoint: process.env.BUCKET_REPORTS_URL,
    region: "auto",
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID as string,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY as string,
    },
  });
const arrayBuffer = await workbook.xlsx.writeBuffer();
const uint8Array = new Uint8Array(arrayBuffer); // ✅ convertir a Uint8Array

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
    { header: "Fecha Pago", key: "fecha_pago", width: 20 },
    { header: "Observaciones", key: "observaciones", width: 40 },
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
      fecha_pago: pago.fecha_pago,
      observaciones: pago.observaciones,
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