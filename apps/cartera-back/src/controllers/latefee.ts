import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "../database";
import { asesores, creditos, cuotas_credito, moras_condonaciones, moras_credito, platform_users, usuarios } from "../database/db/schema";
import Big from "big.js";
import { toZonedTime } from "date-fns-tz";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import ExcelJS from "exceljs";
import { stat } from "fs";
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
  monto_mora,
  cuotas_atrasadas = 0,
}: {
  credito_id: number;
  monto_mora?: number;
  cuotas_atrasadas?: number;
}) {
  const requestId = `${credito_id}-${Date.now()}`;
  
  console.log(`
╔════════════════════════════════════════════════════════════
║ [CREATE MORA ENTRY] Request ID: ${requestId}
║ Crédito ID: ${credito_id}
║ Monto Mora: ${monto_mora}
║ Cuotas Atrasadas: ${cuotas_atrasadas}
║ Timestamp: ${new Date().toISOString()}
╚════════════════════════════════════════════════════════════
  `);

  try {
    // 🔥 VALIDACIÓN 1: Monto debe ser mayor a 0
    if (!monto_mora || monto_mora <= 0) {
      console.log(`[${requestId}] ❌ RECHAZADO: Monto debe ser mayor a 0`);
      
      return {
        success: false,
        message: "[ERROR] Monto de mora debe ser mayor a 0",
      };
    }

    // 🔥 VERIFICAR SI YA EXISTE MORA ACTIVA (UPSERT)
    console.log(`[${requestId}] 🔍 Verificando mora activa existente...`);

    const [moraExistente] = await db
      .select({ mora_id: moras_credito.mora_id })
      .from(moras_credito)
      .where(
        and(
          eq(moras_credito.credito_id, credito_id),
          eq(moras_credito.activa, true)
        )
      );

    let newMora;

    if (moraExistente) {
      // 🔄 ACTUALIZAR MORA EXISTENTE
      console.log(`[${requestId}] 🔄 Mora activa existente (ID: ${moraExistente.mora_id}), actualizando...`);

      [newMora] = await db
        .update(moras_credito)
        .set({
          monto_mora: monto_mora.toString(),
          cuotas_atrasadas,
          updated_at: new Date(),
        })
        .where(eq(moras_credito.mora_id, moraExistente.mora_id))
        .returning();

      console.log(`[${requestId}] ✅ Mora actualizada: ID=${newMora.mora_id}`);
    } else {
      // 🔥 INSERTAR NUEVA MORA
      console.log(`[${requestId}] 💰 Insertando nueva mora con monto ${monto_mora}...`);

      [newMora] = await db
        .insert(moras_credito)
        .values({
          credito_id,
          monto_mora: monto_mora.toString(),
          cuotas_atrasadas,
          activa: true,
          porcentaje_mora: "1.12",
        })
        .returning();

      console.log(`[${requestId}] ✅ Mora creada: ID=${newMora.mora_id}`);
    }

    // Actualizar status del crédito a MOROSO
    console.log(`[${requestId}] 🔄 Actualizando status a MOROSO...`);
    
    await db
      .update(creditos)
      .set({ statusCredit: "MOROSO" })
      .where(eq(creditos.credito_id, credito_id));

    console.log(`[${requestId}] ✅ Status actualizado a MOROSO`);

    console.log(`
╔════════════════════════════════════════════════════════════
║ [CREATE MORA SUCCESS] Request ID: ${requestId}
║ Mora ID: ${newMora.mora_id}
║ Status: MOROSO
║ Timestamp: ${new Date().toISOString()}
╚════════════════════════════════════════════════════════════
    `);

    return {
      success: true,
      mora: newMora,
      status: "MOROSO",
    };
    
  } catch (error) {
    console.error(`
╔════════════════════════════════════════════════════════════
║ [CREATE MORA ERROR] Request ID: ${requestId}
║ Crédito ID: ${credito_id}
║ Error: ${String(error)}
║ Timestamp: ${new Date().toISOString()}
╚════════════════════════════════════════════════════════════
    `);
    
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
  tipo,
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
  const requestId = `${credito_id}-${Date.now()}`;
  
  console.log(`
╔════════════════════════════════════════════════════════════
║ [UPDATE MORA] Request ID: ${requestId}
║ Crédito ID: ${credito_id}
║ Tipo: ${tipo}
║ Monto Cambio: ${monto_cambio}
║ Timestamp: ${new Date().toISOString()}
╚════════════════════════════════════════════════════════════
  `);

  try {
    // 1. Resolve credito_id
    let targetCreditoId = credito_id;
   
    if (!targetCreditoId) {
      console.log(`[${requestId}] ❌ credito_id is required`);
      return { success: false, message: "[ERROR] credito_id is required" };
    }

    // 2. Fetch current mora ACTIVA
    console.log(`[${requestId}] 🔍 Buscando mora activa...`);
    
    const [moraActual] = await db
      .select({
        id: moras_credito.mora_id,
        monto: moras_credito.monto_mora,
        activa: moras_credito.activa,
      })
      .from(moras_credito)
      .where(
        and(
          eq(moras_credito.credito_id, targetCreditoId),
          eq(moras_credito.activa, true) // 🔥 Solo mora activa
        )
      );

    if (!moraActual) {
      console.log(`[${requestId}] ❌ No se encontró mora activa para este crédito`);
      return { success: false, message: "[ERROR] Mora activa no encontrada para este crédito" };
    }

    console.log(`[${requestId}] ✅ Mora activa encontrada: ID=${moraActual.id}, Monto=${moraActual.monto}`);

    // 3. Calculate new mora amount
    let newMonto = new Big(moraActual.monto);

    console.log(`[${requestId}] 🧮 Monto actual: ${newMonto.toString()}`);
    
    if (tipo === "INCREMENTO") {
      newMonto = newMonto.plus(monto_cambio);
      console.log(`[${requestId}] ➕ Incremento: +${monto_cambio} = ${newMonto.toString()}`);
    } else if (tipo === "DECREMENTO") {
      newMonto = newMonto.minus(monto_cambio);
      if (newMonto.lt(0)) {
        console.log(`[${requestId}] ⚠️  Monto negativo detectado, ajustando a 0`);
        newMonto = new Big(0);
      }
      console.log(`[${requestId}] ➖ Decremento: -${monto_cambio} = ${newMonto.toString()}`);
    }

    // 4. Determine active state
    let newActiva = activa !== undefined ? activa : moraActual.activa;
    
    console.log(`[${requestId}] 🔄 Estado activa: ${newActiva}`);

    // 5. Update mora record
    console.log(`[${requestId}] 💾 Actualizando registro de mora...`);
    
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

    console.log(`[${requestId}] ✅ Mora actualizada: ID=${updated.mora_id}`);

    // 🔥 6. Update credit status (LÓGICA COMPLETA)
    const newStatus = "MOROSO"  

    console.log(`[${requestId}] 🔄 Actualizando status del crédito a ${newStatus}...`);

    await db
      .update(creditos)
      .set({ statusCredit: newStatus })
      .where(eq(creditos.credito_id, targetCreditoId));

    console.log(`[${requestId}] ✅ Status del crédito actualizado a ${newStatus}`);

    console.log(`
╔════════════════════════════════════════════════════════════
║ [UPDATE MORA SUCCESS] Request ID: ${requestId}
║ Mora ID: ${updated.mora_id}
║ Nuevo Monto: ${newMonto.toString()}
║ Status Crédito: ${newStatus}
║ Timestamp: ${new Date().toISOString()}
╚════════════════════════════════════════════════════════════
    `);

    return {
      success: true,
      mora: updated,
      newStatus,
    };
    
  } catch (error) {
    console.error(`
╔════════════════════════════════════════════════════════════
║ [UPDATE MORA ERROR] Request ID: ${requestId}
║ Crédito ID: ${credito_id}
║ Error: ${String(error)}
║ Timestamp: ${new Date().toISOString()}
╚════════════════════════════════════════════════════════════
    `);
    
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
    const hoy = toZonedTime(new Date(), zona);
    hoy.setHours(0, 0, 0, 0);
    
    console.log("[INFO] Current Guatemala date (midnight):", hoy.toISOString());

    // 🔥 PASO 0: LIMPIAR TODAS LAS MORAS (activas E inactivas)
    console.log("\n╔════════════════════════════════════════════════════════════");
    console.log("║ [CLEANUP] 🗑️  ELIMINANDO TODAS LAS MORAS");
    console.log("╚════════════════════════════════════════════════════════════\n");
    
    // ANTES del delete - para debug
    const antesDelete = await db.select().from(moras_credito);
    console.log(`[DEBUG] Moras ANTES del delete: ${antesDelete.length}`);
    
    // 🔥 SIN WHERE = BORRA TODO
    await db.delete(moras_credito);
    
    // DESPUÉS del delete - verificar
    const despuesDelete = await db.select().from(moras_credito);
    console.log(`[DEBUG] Moras DESPUÉS del delete: ${despuesDelete.length}`);
    
    if (despuesDelete.length > 0) {
      console.error("[CLEANUP] ⚠️  ADVERTENCIA: Aún hay moras en la tabla!");
      console.error("[CLEANUP] Moras restantes:", despuesDelete);
    } else {
      console.log("[CLEANUP] ✅ Todas las moras eliminadas correctamente");
    }
    
    // 🔥 RESETEAR STATUS DE TODOS LOS CRÉDITOS MOROSOS → ACTIVO
    console.log("[CLEANUP] 🔄 Reseteando status de créditos morosos a ACTIVO...");

    await db
      .update(creditos)
      .set({ statusCredit: "ACTIVO" })
      .where(eq(creditos.statusCredit, "MOROSO"));
    
    console.log("[CLEANUP] ✅ Status reseteados\n");

    // 1. Get all installments WITH PROPER JOIN
    const cuotas = await db
      .select({
        credito_id: cuotas_credito.credito_id,
        fecha_vencimiento: cuotas_credito.fecha_vencimiento,
        pagado: cuotas_credito.pagado,
        statusCredit: creditos.statusCredit,
      })
      .from(cuotas_credito)
      .innerJoin(creditos, eq(cuotas_credito.credito_id, creditos.credito_id));

    console.log(`[DEBUG] Total installments fetched: ${cuotas.length}`);

    // 2. Filter overdue installments
    const cuotasVencidas = cuotas.filter((c) => {
      const fechaVenc = toZonedTime(c.fecha_vencimiento, zona);
      fechaVenc.setHours(0, 0, 0, 0);
      
      const isOverdue = fechaVenc < hoy;
      const isUnpaid = c.pagado === false;
      const statusExcluidos = ["EN_CONVENIO", "INCOBRABLE", "CANCELADO", "PENDIENTE_CANCELACION"];
      const isEligible = !statusExcluidos.includes(c.statusCredit ?? "");

      if (isOverdue && isUnpaid) {
        console.log(`[DEBUG] Cuota vencida encontrada:`, {
          credito_id: c.credito_id,
          fecha_vencimiento: fechaVenc.toISOString(),
          hoy: hoy.toISOString(),
          pagado: c.pagado,
          statusCredit: c.statusCredit,
          cumple_filtros: isEligible
        });
      }

      return isOverdue && isUnpaid && isEligible;
    });

    console.log(`[DEBUG] Overdue installments found: ${cuotasVencidas.length}`);

    // 3. Group by credit
    const moraPorCredito: Record<number, number> = {};
    
    for (const cuota of cuotasVencidas) {
      moraPorCredito[cuota.credito_id] = (moraPorCredito[cuota.credito_id] ?? 0) + 1;
    }

    console.log("[DEBUG] Grouping overdue installments by credit:", moraPorCredito);

    if (Object.keys(moraPorCredito).length === 0) {
      console.log("\n╔════════════════════════════════════════════════════════════");
      console.log("║ [INFO] ✅ No credits with overdue installments found.");
      console.log("║ All credits are clean! 🎉");
      console.log("╚════════════════════════════════════════════════════════════\n");
      return;
    }

    // 4. Process each credit
    for (const [creditoIdStr, cuotasAtrasadas] of Object.entries(moraPorCredito)) {
      const creditoId = Number(creditoIdStr);
      
      console.log(`\n[PROCESS] Credit #${creditoId} with ${cuotasAtrasadas} overdue installments`);

      const [credito] = await db
        .select({ capital: creditos.capital })
        .from(creditos)
        .where(eq(creditos.credito_id, creditoId));

      if (!credito) {
        console.log(`[WARN] Credit ${creditoId} not found`);
        continue;
      }

      const capital = new Big(credito.capital);
      const porcentaje = new Big("0.0112");
      const moraNueva = capital.times(porcentaje).times(cuotasAtrasadas);

      console.log(`[DEBUG] New mora calculated: ${moraNueva.toString()}`);

      const result = await createMora({
        credito_id: creditoId,
        monto_mora: Number(moraNueva.toString()),
        cuotas_atrasadas: cuotasAtrasadas,
      });

      if (result.success) {
        console.log(`[SUCCESS] ✅ Mora created for credit #${creditoId} → Q${moraNueva.toFixed(2)}`);
      } else {
        console.error(`[ERROR] ❌ Failed to create mora for credit #${creditoId}:`, result.message);
      }
    }

    console.log("\n╔════════════════════════════════════════════════════════════");
    console.log("║ [JOB] ✅ FINISHED MORA PROCESSING");
    console.log("╚════════════════════════════════════════════════════════════\n");
    
  } catch (error: any) {
    console.error("\n╔════════════════════════════════════════════════════════════");
    console.error("║ [ERROR] ❌ FAILED TO PROCESS MORAS");
    console.error("╚════════════════════════════════════════════════════════════");
    console.error("[ERROR] Message:", error.message);
    console.error("[ERROR] Stack trace:", error.stack);
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
    const monto= moraActual?.monto || "0";

     console.log(`[INFO] Current mora amount for credit #${credito_id}: ${monto}`);
     console.log(`[INFO] Condonation reason: ${motivo}`);
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
        montoCondonacion: monto,
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
  whereClauses.push(eq(moras_credito.activa, true)); // Solo moras activas
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
      montoCondonacion: moras_condonaciones.montoCondonacion,
    })
    .from(moras_condonaciones)
    .innerJoin(creditos, eq(moras_condonaciones.credito_id, creditos.credito_id))
    .innerJoin(usuarios, eq(creditos.usuario_id, usuarios.usuario_id))
    .innerJoin(asesores, eq(creditos.asesor_id, asesores.asesor_id))
    .innerJoin(platform_users, eq(moras_condonaciones.usuario_id, platform_users.id))
    .where(whereClauses.length > 0 ? and(...whereClauses) : undefined);
console.log(query)
  const data = await query;
    console.log("[DEBUG] Condonations found:", data);
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


export async function condonarTodasLasMoras({
  motivo,
  usuario_email,
}: {
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

    // 2. Obtener todos los créditos MOROSOS con sus moras activas
    const creditosMorosos = await db
      .select({
        credito_id: creditos.credito_id,
        mora_id: moras_credito.mora_id,
        monto_mora: moras_credito.monto_mora,
      })
      .from(creditos)
      .leftJoin(
        moras_credito,
        and(
          eq(creditos.credito_id, moras_credito.credito_id),
          eq(moras_credito.activa, true)
        )
      )
      .where(eq(creditos.statusCredit, "MOROSO"));
      console.log(`[INFO] Found ${creditosMorosos.length} morose credits to condone`);

    if (creditosMorosos.length === 0) {
      return {
        success: true,
        message: "[INFO] No hay créditos morosos para condonar",
        condonados: 0,
      };
    }

    // 3. Actualizar todas las moras a 0 (mantener activas y estado MOROSO)
    const moraIds = creditosMorosos.map((c) => c.mora_id).filter((id): id is number => id !== null);
    await db
      .update(moras_credito)
      .set({
        monto_mora: "0",
        updated_at: new Date(),
      })
      .where(inArray(moras_credito.mora_id, moraIds));

    

    // 5. Insertar registros masivos en moras_condonaciones
    const condonacionesData = creditosMorosos
      .filter((credito) => credito.mora_id !== null)
      .map((credito) => ({
        credito_id: credito.credito_id,
        mora_id: credito.mora_id as number,
        motivo,
        usuario_id: user.id,
        montoCondonacion: credito.monto_mora ??"0",
      }));

    const condonaciones = await db
      .insert(moras_condonaciones)
      .values(condonacionesData)
      .returning();

    return {
      success: true,
      message: `[SUCCESS] Se condonaron ${creditosMorosos.length} moras`,
      condonados: creditosMorosos.length,
      creditos_afectados: creditosMorosos.length,
      condonaciones,
    };
  } catch (error) {
    return {
      success: false,
      message: "[ERROR] No se pudieron condonar las moras masivamente",
      error: String(error),
    };
  }
}