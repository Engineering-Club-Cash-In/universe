import ExcelJS from "exceljs";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getCreditosWithUserByMesAnio } from "./credits";
import { getAllPagosWithCreditAndInversionistas, getPagosConInversionistas } from "./payments";

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
    rest.estado,
    rest.asesor_id,
    rest.nombre_usuario
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
    inversionistaId?: number;
    usuarioNombre?: string;
    validationStatus?: string;
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

  console.log(`📊 Generando Excel con ${result.data.length} pagos...`);

  // 2️⃣ Crear el workbook
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Pagos con Inversionistas");

  // 3️⃣ Definir columnas base
  const columns: any[] = [
    { header: "Pago ID", key: "pagoId", width: 12 },
    { header: "Número Crédito", key: "numeroCredito", width: 20 },
    { header: "Crédito ID", key: "creditoId", width: 15 },
    { header: "Capital Crédito", key: "capital", width: 15 },
    { header: "Deuda Total", key: "deudaTotal", width: 15 },
    { header: "Usuario", key: "usuarioNombre", width: 25 },
    { header: "Monto Boleta", key: "montoBoleta", width: 15 },
    { header: "Número Autorización", key: "numeroAutorizacion", width: 20 },
    { header: "Fecha Pago", key: "fechaPago", width: 20 },
    { header: "Cuota ID", key: "cuotaId", width: 12 },
    { header: "Número Cuota", key: "numeroCuota", width: 12 },
    { header: "Fecha Vencimiento", key: "fechaVencimiento", width: 20 },
    { header: "Pagado", key: "pagado", width: 10 },
    { header: "Boleta ID", key: "boletaId", width: 12 },
    { header: "URL Boleta", key: "urlBoleta", width: 50 },
    
    { header: "Abono Capital", key: "abono_capital", width: 15 },
    { header: "Abono Interés", key: "abono_interes", width: 15 },
    { header: "Abono IVA 12%", key: "abono_iva_12", width: 15 },
    { header: "Abono Seguro", key: "abono_seguro", width: 15 },
    { header: "Abono GPS", key: "abono_gps", width: 15 },
    { header: "Mora", key: "mora", width: 15 },
    { header: "Otros", key: "otros", width: 15 },
    { header: "Reserva", key: "reserva", width: 15 },
    { header: "Membresías", key: "membresias", width: 15 },
    { header: "Categoría", key: "categoria", width: 15 },
  ];

  // 4️⃣ Determinar máximo de inversionistas por pago
  const maxInversionistas = Math.max(
    ...result.data.map((pago: any) => pago.inversionistas.length)
  );

  // 5️⃣ Agregar columnas dinámicas para inversionistas
  for (let i = 1; i <= maxInversionistas; i++) {
    columns.push({ header: `Inv${i}_ID`, key: `inv${i}_id`, width: 12 });
    columns.push({ header: `Inv${i}_Nombre`, key: `inv${i}_nombre`, width: 25 });
    columns.push({ header: `Inv${i}_Monto Aportado`, key: `inv${i}_monto_aportado`, width: 15 });
    columns.push({ header: `Inv${i}_% Participación`, key: `inv${i}_porcentaje`, width: 15 });
    columns.push({ header: `Inv${i}_Abono Capital`, key: `inv${i}_abono_capital`, width: 15 });
    columns.push({ header: `Inv${i}_Abono Interés`, key: `inv${i}_abono_interes`, width: 15 });
    columns.push({ header: `Inv${i}_Abono IVA`, key: `inv${i}_abono_iva`, width: 15 });
    columns.push({ header: `Inv${i}_ISR (5%)`, key: `inv${i}_isr`, width: 12 });
    columns.push({ header: `Inv${i}_Cuota Pago`, key: `inv${i}_cuota_pago`, width: 15 });
  }

  sheet.columns = columns;

  // 6️⃣ Poblar filas
  result.data.forEach((item: any) => {
    const row: any = {
      pagoId: item.pagoId,
      numeroCredito: item.credito?.numeroCreditoSifco ?? "",
      creditoId: item.credito?.creditoId ?? "",
      capital: item.credito?.capital ?? "",
      deudaTotal: item.credito?.deudaTotal ?? "",
      usuarioNombre: item.usuario?.nombre ?? "",
      montoBoleta: item.montoBoleta,
      numeroAutorizacion: item.numeroAutorizacion,
      fechaPago: item.fechaPago,
      cuotaId: item.cuota?.cuotaId ?? "",
      numeroCuota: item.cuota?.numeroCuota ?? "",
      fechaVencimiento: item.cuota?.fechaVencimiento ?? "",
      pagado: item.cuota?.pagado ? "Sí" : "No",
      boletaId: item.boleta?.boletaId ?? "",
      urlBoleta: item.boleta?.urlBoleta ?? "",
      categoria: item.usuario?.categoria ?? "",
      abono_capital: item.abono_capital,
      abono_interes: item.abono_interes,
      abono_iva_12: item.abono_iva_12,
      abono_seguro: item.abono_seguro,
      abono_gps: item.abono_gps,
      mora: item.mora,
      otros: item.otros,
      reserva: item.reserva,
      membresias: item.membresias,
    };

    // Agregar inversionistas dinámicos
    item.inversionistas.forEach((inv: any, index: number) => {
      const i = index + 1;
      row[`inv${i}_id`] = inv.inversionistaId;
      row[`inv${i}_nombre`] = inv.nombreInversionista;
      row[`inv${i}_monto_aportado`] = inv.montoAportado;
      row[`inv${i}_porcentaje`] = inv.porcentajeParticipacion;
      row[`inv${i}_abono_capital`] = inv.abonoCapital;
      row[`inv${i}_abono_interes`] = inv.abonoInteres;
      row[`inv${i}_abono_iva`] = inv.abonoIva;
      row[`inv${i}_isr`] = inv.isr;
      row[`inv${i}_cuota_pago`] = inv.cuotaPago;
    });

    sheet.addRow(row);
  });

  // 💰 AGREGAR FILA DE TOTALES (usando los totales que ya vienen en result.totales)
  sheet.addRow({}); // Fila vacía para separar

  const totalRow = sheet.addRow({
    pagoId: "TOTALES",
    numeroCredito: "",
    creditoId: "",
    capital: "",
    deudaTotal: "",
    usuarioNombre: "",
    montoBoleta: "",
    numeroAutorizacion: "",
    fechaPago: "",
    cuotaId: "",
    numeroCuota: "",
    fechaVencimiento: "",
    pagado: "",
    boletaId: "",
    urlBoleta: "",
    categoria:"",
    abono_capital: result.totales?.totalAbonoCapital ?? 0,
    abono_interes: result.totales?.totalAbonoInteres ?? 0,
    abono_iva_12: result.totales?.totalAbonoIva ?? 0,
    abono_seguro: result.totales?.totalAbonoSeguro ?? 0,
    abono_gps: result.totales?.totalAbonoGps ?? 0,
    mora: result.totales?.totalMora ?? 0,
    otros: result.totales?.totalOtros ?? 0,
    reserva: result.totales?.totalReserva ?? 0,
    membresias: result.totales?.totalMembresias ?? 0,
  });

  // 🎨 Formatear fila de totales (negrita + fondo amarillo)
  totalRow.eachCell((cell) => {
    cell.font = { bold: true };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFF00' }
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