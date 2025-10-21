import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "../database";
import { asesores, creditos, cuotas_credito, moras_condonaciones, moras_credito, platform_users, usuarios } from "../database/db/schema";
import Big from "big.js";
import { toZonedTime } from "date-fns-tz";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import ExcelJS from "exceljs";
/**
 * Create a new mora (penalty) for a credit.
 *
 * Rules:
 * 1. A mora is always created as active by default.
 * 2. If the mora amount > 0, the credit status changes to "MOROSO".
 * 3. If the mora amount = 0, the credit remains "ACTIVO".
 */
export async function createMora({
  credito_id,
  monto_mora = 0,
  cuotas_atrasadas = 0,
}: {
  credito_id: number;
  monto_mora?: number;
  cuotas_atrasadas?: number;
}) {
  try {
    // 1. Insert mora record
    const [newMora] = await db
      .insert(moras_credito)
      .values({
        credito_id,
        monto_mora: monto_mora.toString(), // store as string
        cuotas_atrasadas,
        activa: true,
        porcentaje_mora: "1.12", // fixed percentage
      })
      .returning();

    // 2. Update credit status depending on mora amount
    if (Number(monto_mora) > 0) {
      await db
        .update(creditos)
        .set({
          statusCredit: "MOROSO", 
        })
        .where(eq(creditos.credito_id, credito_id));

      console.log(`[UPDATE] Credit #${credito_id} status changed to MOROSO`);
    } else {
      await db
        .update(creditos)
        .set({
          statusCredit: "ACTIVO", 
        })
        .where(eq(creditos.credito_id, credito_id));

      console.log(`[INFO] Credit #${credito_id} remains in ACTIVO (mora = 0)`);
    }

    return {
      success: true,
      mora: newMora,
    };
  } catch (error) {
    return {
      success: false,
      message: "[ERROR] Could not create mora",
      error: String(error),
    };
  }
}


 
/**
 * Update mora (penalty) for a credit using increments or decrements.
 *
 * Rules:
 * 1. If type = "INCREMENTO", add monto_cambio to the existing mora.
 * 2. If type = "DECREMENTO", subtract monto_cambio from the existing mora (never below 0).
 * 3. If final monto_mora > 0 and mora is active -> credit = MOROSO.
 * 4. If final monto_mora = 0 or mora inactive -> credit = ACTIVO.
 */
export async function updateMora({
  credito_id,
  numero_credito_sifco,
  monto_cambio,
  tipo, // "INCREMENTO" | "DECREMENTO"
  cuotas_atrasadas,
  activa,
}: {
  credito_id?: number;
  numero_credito_sifco?: string;
  monto_cambio: number;
  tipo: "INCREMENTO" | "DECREMENTO";
  cuotas_atrasadas?: number;
  activa?: boolean;
}) {
  try {
    // 1. Resolve credito_id if numero_credito_sifco is provided
    let targetCreditoId = credito_id;
    if (!targetCreditoId && numero_credito_sifco) {
      const [credito] = await db
        .select({ id: creditos.credito_id })
        .from(creditos)
        .where(eq(creditos.numero_credito_sifco, numero_credito_sifco));

      if (!credito) {
        return { success: false, message: "[ERROR] Credit not found" };
      }
      targetCreditoId = credito.id;
    }

    if (!targetCreditoId) {
      return {
        success: false,
        message: "[ERROR] You must send credito_id or numero_credito_sifco",
      };
    }

    // 2. Fetch current mora
    const [moraActual] = await db
      .select({
        id: moras_credito.mora_id,
        monto: moras_credito.monto_mora,
        activa: moras_credito.activa,
      })
      .from(moras_credito)
      .where(eq(moras_credito.credito_id, targetCreditoId));

    if (!moraActual) {
      return { success: false, message: "[ERROR] Mora not found for this credit" };
    }

    // 3. Calculate new mora amount
    let newMonto = new Big(moraActual.monto);
    if (tipo === "INCREMENTO") {
      newMonto = newMonto.plus(monto_cambio);
    } else if (tipo === "DECREMENTO") {
      newMonto = newMonto.minus(monto_cambio);
      if (newMonto.lt(0)) newMonto = new Big(0); // never negative
    }

    // 4. Determine active state
    let newActiva = activa !== undefined ? activa : moraActual.activa;
    if (newMonto.lte(0)) {
      newActiva = false;
    }

    // 5. Update mora record
    const [updated] = await db
      .update(moras_credito)
      .set({
        monto_mora: newMonto.toString(),
        ...(cuotas_atrasadas !== undefined ? { cuotas_atrasadas } : {}),
        activa: newActiva,
        updated_at: new Date(),
      })
      .where(eq(moras_credito.mora_id, moraActual.id))
      .returning();

    // 6. Update credit status
    if (newMonto.gt(0) && newActiva) {
      await db
        .update(creditos)
        .set({
          statusCredit: "MOROSO", 
        })
        .where(eq(creditos.credito_id, targetCreditoId));
    } else {
      await db
        .update(creditos)
        .set({
          statusCredit: "ACTIVO", 
        })
        .where(eq(creditos.credito_id, targetCreditoId));
    }

    return {
      success: true,
      mora: updated,
    };
  } catch (error) {
    return {
      success: false,
      message: "[ERROR] Could not update mora",
      error: String(error),
    };
  }
}

/**
 * Process overdue installments and update loan penalties (moras).
 *
 * Steps:
 * 1. Get all installments (cuotas) from the database.
 * 2. Filter those overdue (not paid and past due date) using Guatemala timezone.
 * 3. Group overdue installments by credit.
 * 4. For each credit:
 *    - Calculate the new penalty (mora) = capital × percentage × overdue installments.
 *    - If a mora record already exists, update it (accumulate total).
 *    - If not, insert a new mora record.
 *    - Update the credit status to "MOROSO".
 * 5. Log every step for debugging and monitoring.
 */
export async function procesarMoras() {
  const zona = "America/Guatemala";

  try {
    // Current date in Guatemala timezone
    const hoy = toZonedTime(new Date(), zona);
    console.log("[INFO] Current Guatemala date:", hoy.toISOString());

    // 1. Get all installments
    const cuotas = await db
      .select({
        credito_id: cuotas_credito.credito_id,
        fecha_vencimiento: cuotas_credito.fecha_vencimiento,
        pagado: cuotas_credito.pagado,
      })
      .from(cuotas_credito);

    // 2. Filter overdue installments
    const cuotasVencidas = cuotas.filter((c) => {
      const fechaVenc = toZonedTime(c.fecha_vencimiento, zona);
      return fechaVenc < hoy && c.pagado === false;
    });

    console.log("[DEBUG] Overdue installments found:", cuotasVencidas);

    // 3. Group by credit
    const moraPorCredito: Record<number, number> = {};
    for (const cuota of cuotasVencidas) {
      moraPorCredito[cuota.credito_id] =
        (moraPorCredito[cuota.credito_id] ?? 0) + 1;
    }

    console.log(
      "[DEBUG] Grouping overdue installments by credit:",
      moraPorCredito
    );

    // 4. Process each credit with overdue installments
    for (const [creditoIdStr, cuotasAtrasadas] of Object.entries(moraPorCredito)) {
      const creditoId = Number(creditoIdStr);
      console.log(
        `\n[PROCESS] Credit #${creditoId} with ${cuotasAtrasadas} overdue installments`
      );

      // Get credit capital
      const [credito] = await db
        .select({ capital: creditos.capital })
        .from(creditos)
        .where(eq(creditos.credito_id, creditoId));

      if (!credito) {
        console.log(`[WARN] Credit ${creditoId} not found`);
        continue;
      }

      const capital = new Big(credito.capital);
      console.log(`[DEBUG] Credit capital: ${capital.toString()}`);

      // Calculate mora = capital × percentage × overdue installments
      const porcentaje = new Big("0.0112");
      const moraNueva = capital.times(porcentaje).times(cuotasAtrasadas);
      console.log(`[DEBUG] New mora calculated: ${moraNueva.toString()}`);

      // Check if mora already exists
      const [moraActual] = await db
        .select({
          id: moras_credito.mora_id,
          monto: moras_credito.monto_mora,
        })
        .from(moras_credito)
        .where(eq(moras_credito.credito_id, creditoId));

      if (moraActual) {
        // Update existing mora
        console.log(
          `[INFO] Existing mora found with amount: ${moraActual.monto}`
        );
        const montoTotal = new Big(moraActual.monto).plus(moraNueva);
        console.log(`[INFO] New mora total: ${montoTotal.toString()}`);

        await db
          .update(moras_credito)
          .set({
            monto_mora: montoTotal.toString(),
            cuotas_atrasadas: cuotasAtrasadas,
            activa: true,
            updated_at: new Date(),
          })
          .where(eq(moras_credito.mora_id, moraActual.id));

        console.log(`[SUCCESS] Mora updated for credit #${creditoId}`);
      } else {
        // Insert new mora
        await db.insert(moras_credito).values({
          credito_id: creditoId,
          monto_mora: moraNueva.toString(),
          cuotas_atrasadas: cuotasAtrasadas,
          activa: true,
          porcentaje_mora: "1.12",
        });
        console.log(`[SUCCESS] Mora created for credit #${creditoId}`);
      }

      // ✅ Update credit status to MOROSO
      await db
        .update(creditos)
        .set({
          statusCredit: "MOROSO", 
        })
        .where(eq(creditos.credito_id, creditoId));

      console.log(`[UPDATE] Credit #${creditoId} status changed to MOROSO`);
    }

    console.log("\n[JOB] Finished mora processing.");
  } catch (error: any) {
    console.error("[ERROR] Failed to process moras:", error.message);
    throw error;
  }
} 

/**
 * Condonar mora de un crédito:
 * 1. Look up user_id by email.
 * 2. Set mora monto = 0, activa = false.
 * 3. Set credit status = ACTIVO.
 * 4. Insert record into moras_condonaciones for audit/history.
 */
export async function condonarMora({
  credito_id,
  motivo,
  usuario_email,
}: {
  credito_id: number;
  motivo: string;
  usuario_email: string;
}) {
  try {
    // 1. Buscar el usuario por email
    const [user] = await db
      .select({ id: platform_users.id })
      .from(platform_users)
      .where(eq(platform_users.email, usuario_email));

    if (!user) {
      return { success: false, message: "[ERROR] Usuario no encontrado" };
    }

    // 2. Obtener mora actual
    const [moraActual] = await db
      .select({
        id: moras_credito.mora_id,
        monto: moras_credito.monto_mora,
      })
      .from(moras_credito)
      .where(eq(moras_credito.credito_id, credito_id));

    if (!moraActual) {
      return { success: false, message: "[ERROR] Mora no encontrada para este crédito" };
    }

    // 3. Actualizar mora -> monto = 0 y desactivada
    const [updatedMora] = await db
      .update(moras_credito)
      .set({
        monto_mora: "0",
        activa: false,
        updated_at: new Date(),
      })
      .where(eq(moras_credito.mora_id, moraActual.id))
      .returning();

    // 4. Cambiar estado del crédito -> ACTIVO
    await db
      .update(creditos)
      .set({
        statusCredit: "ACTIVO", 
      })
      .where(eq(creditos.credito_id, credito_id));

    // 5. Insertar registro en moras_condonaciones
    const [condonacion] = await db
      .insert(moras_condonaciones)
      .values({
        credito_id,
        mora_id: moraActual.id,
        motivo,
        usuario_id: user.id, // 🔑 guardar el ID del usuario
      })
      .returning();

    return {
      success: true,
      message: `[SUCCESS] Mora condonada para crédito #${credito_id}`,
      mora: updatedMora,
      condonacion,
    };
  } catch (error) {
    return {
      success: false,
      message: "[ERROR] No se pudo condonar la mora",
      error: String(error),
    };
  }
}
 

/**
 * Obtener créditos con información de mora.
 * 
 * Filtros disponibles:
 * - numero_credito_sifco
 * - cuotas_atrasadas (ej: > 2)
 * - estado (ACTIVO, MOROSO, etc.)
 * 
 * Si excel=true, exporta a Excel y sube a R2.
 */
export async function getCreditosWithMoras({
  numero_credito_sifco,
  cuotas_atrasadas,
  estado,
  excel,
}: {
  numero_credito_sifco?: string;
  cuotas_atrasadas?: number;
  estado?: "ACTIVO" | "CANCELADO" | "INCOBRABLE" | "PENDIENTE_CANCELACION" | "MOROSO";
  excel?: boolean;
}) {
  // 1️⃣ Build query base
  let whereClauses: any[] = [];

  if (numero_credito_sifco) {
    whereClauses.push(eq(creditos.numero_credito_sifco, numero_credito_sifco));
  }
  if (estado) {
    whereClauses.push(eq(creditos.statusCredit, estado));
  }
  if (cuotas_atrasadas !== undefined) {
    whereClauses.push(gte(moras_credito.cuotas_atrasadas, cuotas_atrasadas));
  }

  const query = db
    .select({
      credito_id: creditos.credito_id,
      numero_credito_sifco: creditos.numero_credito_sifco,
      capital: creditos.capital,
      cuota: creditos.cuota,
      plazo: creditos.plazo,
      estado: creditos.statusCredit,
      fecha_creacion: creditos.fecha_creacion,
      observaciones: creditos.observaciones,
      usuario: usuarios.nombre,
      usuario_nit: usuarios.nit,
      usuario_categoria: usuarios.categoria,
      asesor: asesores.nombre,
      monto_mora: moras_credito.monto_mora,
      cuotas_atrasadas: moras_credito.cuotas_atrasadas,
      mora_activa: moras_credito.activa,
    })
    .from(creditos)
    .innerJoin(usuarios, eq(creditos.usuario_id, usuarios.usuario_id))
    .innerJoin(asesores, eq(creditos.asesor_id, asesores.asesor_id))
    .leftJoin(moras_credito, eq(moras_credito.credito_id, creditos.credito_id))
    .where(whereClauses.length > 0 ? and(...whereClauses) : undefined);

  const data = await query;

  if (!excel) {
    return {
      success: true,
      count: data.length,
      data,
    };
  }

  // 2️⃣ Generar Excel
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("CreditosMora");

  sheet.columns = [
    { header: "Crédito ID", key: "credito_id", width: 12 },
    { header: "Número SIFCO", key: "numero_credito_sifco", width: 20 },
    { header: "Estado", key: "estado", width: 15 },
    { header: "Capital", key: "capital", width: 15 },
    { header: "Cuota", key: "cuota", width: 15 },
    { header: "Plazo", key: "plazo", width: 10 },
    { header: "Usuario", key: "usuario", width: 25 },
    { header: "NIT", key: "usuario_nit", width: 20 },
    { header: "Categoría", key: "usuario_categoria", width: 15 },
    { header: "Asesor", key: "asesor", width: 20 },
    { header: "Fecha Creación", key: "fecha_creacion", width: 20 },
    { header: "Observaciones", key: "observaciones", width: 40 },
    { header: "Monto Mora", key: "monto_mora", width: 15 },
    { header: "Cuotas Atrasadas", key: "cuotas_atrasadas", width: 18 },
    { header: "Mora Activa", key: "mora_activa", width: 12 },
  ];

  data.forEach((row) => {
    sheet.addRow(row);
  });

  // 3️⃣ Subir a R2
  const filename = `reportes/creditos_moras_${Date.now()}.xlsx`;
  const s3 = new S3Client({
    endpoint: process.env.BUCKET_REPORTS_URL,
    region: "auto",
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID as string,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY as string,
    },
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const uint8Array = new Uint8Array(buffer);

  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.BUCKET_REPORTS,
      Key: filename,
      Body: uint8Array,
      ContentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    })
  );

  const url = `${process.env.URL_PUBLIC_R2_REPORTS}/${filename}`;

  return {
    success: true,
    excelUrl: url,
    count: data.length,
  };
}
/**
 * Get mora condonations (history of condonations).
 *
 * Filters:
 * - numero_credito_sifco (string)
 * - usuario_email (string)
 * - fecha_desde / fecha_hasta (rango de fechas)
 *
 * If excel=true, export to Excel and upload to R2.
 */
export async function getCondonacionesMora({
  numero_credito_sifco,
  usuario_email,
  fecha_desde,
  fecha_hasta,
  excel,
}: {
  numero_credito_sifco?: string;
  usuario_email?: string;
  fecha_desde?: Date;
  fecha_hasta?: Date;
  excel?: boolean;
}) {
  // 1️⃣ Build filters
  const whereClauses: any[] = [];

  if (numero_credito_sifco) {
    whereClauses.push(eq(creditos.numero_credito_sifco, numero_credito_sifco));
  }
  if (usuario_email) {
    whereClauses.push(eq(platform_users.email, usuario_email));
  }
    if (fecha_desde && fecha_hasta) {
    whereClauses.push(
      and(
        gte(moras_condonaciones.fecha, fecha_desde),
        lte(moras_condonaciones.fecha, fecha_hasta)
      )
    );
  }

  // 2️⃣ Query con joins
  const query = db
    .select({
      condonacion_id: moras_condonaciones.condonacion_id,
      credito_id: creditos.credito_id,
      numero_credito_sifco: creditos.numero_credito_sifco,
      estado_credito: creditos.statusCredit,
      capital: creditos.capital,
      usuario: usuarios.nombre,
      asesor: asesores.nombre,
      motivo: moras_condonaciones.motivo,
      fecha: moras_condonaciones.fecha,
      usuario_email: platform_users.email,
    })
    .from(moras_condonaciones)
    .innerJoin(creditos, eq(moras_condonaciones.credito_id, creditos.credito_id))
    .innerJoin(usuarios, eq(creditos.usuario_id, usuarios.usuario_id))
    .innerJoin(asesores, eq(creditos.asesor_id, asesores.asesor_id))
    .innerJoin(platform_users, eq(moras_condonaciones.usuario_id, platform_users.id))
    .where(whereClauses.length > 0 ? and(...whereClauses) : undefined);

  const data = await query;

  if (!excel) {
    return {
      success: true,
      count: data.length,
      data,
    };
  }

  // 3️⃣ Crear Excel
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Condonaciones");

  sheet.columns = [
    { header: "Condonación ID", key: "condonacion_id", width: 12 },
    { header: "Crédito ID", key: "credito_id", width: 12 },
    { header: "Número SIFCO", key: "numero_credito_sifco", width: 20 },
    { header: "Estado Crédito", key: "estado_credito", width: 18 },
    { header: "Capital", key: "capital", width: 15 },
    { header: "Usuario Cliente", key: "usuario", width: 25 },
    { header: "Asesor", key: "asesor", width: 25 },
    { header: "Motivo", key: "motivo", width: 40 },
    { header: "Fecha", key: "fecha", width: 20 },
    { header: "Usuario que condonó", key: "usuario_email", width: 30 },
  ];

  data.forEach((row) => {
    sheet.addRow(row);
  });

  // 4️⃣ Subir a R2
  const filename = `reportes/condonaciones_mora_${Date.now()}.xlsx`;
  const s3 = new S3Client({
    endpoint: process.env.BUCKET_REPORTS_URL,
    region: "auto",
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID as string,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY as string,
    },
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const uint8Array = new Uint8Array(buffer);

  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.BUCKET_REPORTS,
      Key: filename,
      Body: uint8Array,
      ContentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    })
  );

  const url = `${process.env.URL_PUBLIC_R2_REPORTS}/${filename}`;

  return {
    success: true,
    excelUrl: url,
    count: data.length,
  };
}