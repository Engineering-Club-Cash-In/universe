import { db } from "../database";
import { creditos, historial_devolucion_credito, usuarios } from "../database/db/schema";
import { eq, desc, sql, and, or, ilike, inArray } from "drizzle-orm";

export async function listPendingDevolucion({ query, set }: any) {
  try {
    const page = parseInt(query.page || "1");
    const limit = parseInt(query.limit || "10");
    const offset = (page - 1) * limit;

    const requestedStatusRaw = String(query.status || "BANDEJA_DEVOLUCION").toUpperCase();
    const requestedStatus =
      requestedStatusRaw === "PENDIENTE_VERIFICACION" ||
      requestedStatusRaw === "PENDIENTE_VERFICACION"
        ? "PENDIENTE_AUTORIZACION"
        : requestedStatusRaw;

    const search = String(query.search || "").trim();

    const estadoFilter =
      requestedStatus === "BANDEJA_DEVOLUCION" ||
      requestedStatus === "PENDIENTE_Y_RECHAZADO"
        ? inArray(creditos.estado_devolucion, ["PENDIENTE_AUTORIZACION", "RECHAZADO"] as any)
        : eq(creditos.estado_devolucion, requestedStatus as any);

    const whereClause = and(
      estadoFilter,
      search
        ? or(
            ilike(usuarios.nombre, `%${search}%`),
            ilike(creditos.numero_credito_sifco, `%${search}%`)
          )
        : undefined
    );

    const [totalResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(creditos)
      .leftJoin(usuarios, eq(usuarios.usuario_id, creditos.usuario_id))
      .where(whereClause);

    const total = Number(totalResult.count);
    const totalPages = Math.ceil(total / limit);

    const pendingCredits = await db
      .select({
        credito_id: creditos.credito_id,
        numero_credito_sifco: creditos.numero_credito_sifco,
        usuario_nombre: usuarios.nombre,
        capital: creditos.capital,
        cuota: creditos.cuota,
        fecha_creacion: creditos.fecha_creacion,
        estado_devolucion: creditos.estado_devolucion,
        motivo_contextual: sql<string | null>`(
          SELECT h.motivo
          FROM cartera.historial_devolucion_credito h
          WHERE h.credito_id = ${creditos.credito_id}
            AND h.estado_nuevo = ${creditos.estado_devolucion}
          ORDER BY h.created_at DESC
          LIMIT 1
        )`,
      })
      .from(creditos)
      .leftJoin(usuarios, eq(usuarios.usuario_id, creditos.usuario_id))
      .where(whereClause)
      .orderBy(desc(creditos.fecha_creacion))
      .limit(limit)
      .offset(offset);

    return {
      success: true,
      data: {
        credits: pendingCredits,
        pagination: { page, limit, total, totalPages },
        status: requestedStatus,
        search,
      },
    };
  } catch (error) {
    console.error("[listPendingDevolucion] Error:", error);
    set.status = 500;
    return {
      success: false,
      message: "Error al obtener créditos pendientes de devolución",
      error: String(error),
    };
  }
}

export async function aceptarDevolucion({ params, set }: any) {
  try {
    const { id: credito_id } = params;
    const credito_id_num = parseInt(credito_id);

    if (isNaN(credito_id_num)) {
      set.status = 400;
      return { message: "ID de crédito inválido" };
    }

    const [currentCredit] = await db
      .select({ estado_devolucion: creditos.estado_devolucion })
      .from(creditos)
      .where(eq(creditos.credito_id, credito_id_num));

    if (!currentCredit) {
      set.status = 404;
      return { message: "Crédito no encontrado" };
    }

    if (currentCredit.estado_devolucion !== "PENDIENTE_AUTORIZACION") {
      set.status = 400;
      return { message: "El crédito no está en estado pendiente de autorización" };
    }

    // Insertar log
    await db.insert(historial_devolucion_credito).values({
      credito_id: credito_id_num,
      usuario_id: 1, // Placeholder para user_id autenticado
      estado_anterior: currentCredit.estado_devolucion,
      estado_nuevo: "VERIFICADO",
      motivo: null, // Opcional para aprobación
    });

    // Actualizar crédito
    await db
      .update(creditos)
      .set({ estado_devolucion: "VERIFICADO" })
      .where(eq(creditos.credito_id, credito_id_num));

    return {
      success: true,
      message: "Devolución aceptada y registrada correctamente",
    };
  } catch (error) {
    console.error("[aceptarDevolucion] Error:", error);
    set.status = 500;
    return {
      success: false,
      message: "Error al aceptar la devolución",
      error: String(error),
    };
  }
}

export async function rechazarDevolucion({ params, body, set }: any) {
  try {
    const { id: credito_id } = params;
    const { motivo } = body;
    const credito_id_num = parseInt(credito_id);

    if (isNaN(credito_id_num)) {
      set.status = 400;
      return { message: "ID de crédito inválido" };
    }

    if (!motivo || motivo.trim() === "") {
      set.status = 400;
      return { message: "Motivo de rechazo es obligatorio" };
    }

    const [currentCredit] = await db
      .select({ estado_devolucion: creditos.estado_devolucion })
      .from(creditos)
      .where(eq(creditos.credito_id, credito_id_num));

    if (!currentCredit) {
      set.status = 404;
      return { message: "Crédito no encontrado" };
    }

    if (currentCredit.estado_devolucion !== "PENDIENTE_AUTORIZACION") {
      set.status = 400;
      return { message: "El crédito no está en estado pendiente de autorización" };
    }

    // Insertar log
    await db.insert(historial_devolucion_credito).values({
      credito_id: credito_id_num,
      usuario_id: 1, // Placeholder para user_id autenticado
      estado_anterior: currentCredit.estado_devolucion,
      estado_nuevo: "RECHAZADO",
      motivo: motivo.trim(),
    });

    // Actualizar crédito
    await db
      .update(creditos)
      .set({ estado_devolucion: "RECHAZADO" })
      .where(eq(creditos.credito_id, credito_id_num));

    return {
      success: true,
      message: "Devolución rechazada y registrada correctamente",
    };
  } catch (error) {
    console.error("[rechazarDevolucion] Error:", error);
    set.status = 500;
    return {
      success: false,
      message: "Error al rechazar la devolución",
      error: String(error),
    };
  }
}

export async function getHistorialDevolucion({ params, set }: any) {
  try {
    const { id: credito_id } = params;
    const credito_id_num = parseInt(credito_id);

    if (isNaN(credito_id_num)) {
      set.status = 400;
      return { message: "ID de crédito inválido" };
    }

    const historial = await db
      .select({
        id: historial_devolucion_credito.id,
        credito_id: historial_devolucion_credito.credito_id,
        usuario_id: historial_devolucion_credito.usuario_id,
        estado_anterior: historial_devolucion_credito.estado_anterior,
        estado_nuevo: historial_devolucion_credito.estado_nuevo,
        motivo: historial_devolucion_credito.motivo,
        created_at: historial_devolucion_credito.created_at,
      })
      .from(historial_devolucion_credito)
      .where(eq(historial_devolucion_credito.credito_id, credito_id_num))
      .orderBy(desc(historial_devolucion_credito.created_at));

    return {
      success: true,
      data: historial,
    };
  } catch (error) {
    console.error("[getHistorialDevolucion] Error:", error);
    set.status = 500;
    return {
      success: false,
      message: "Error al obtener historial de devolución",
      error: String(error),
    };
  }
}
