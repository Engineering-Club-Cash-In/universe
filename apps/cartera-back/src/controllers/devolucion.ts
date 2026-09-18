import { db } from "../database";
import { creditos, historial_devolucion_credito, usuarios } from "../database/db/schema";
import { eq, desc, sql, and, or, ilike, inArray } from "drizzle-orm";
import { registrarCancelacionEspejo } from "./abonosCapital";
import {
  filtrarCreditosTotalmenteDevueltos,
  marcarDevolucionCompletadaSiCorresponde,
} from "../utils/devolucionCompletada";

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

    // HISTORIAL: la vista completa del ciclo de vida de la devolución, no
    // solo la bandeja de pendientes. Trae todos los estados (incluido
    // NO_APLICA no tendría sentido acá — un crédito que nunca entró al flujo
    // no es "historial" — así que se excluye) sin filtrar por estado.
    const estadoFilter =
      requestedStatus === "HISTORIAL"
        ? sql`${creditos.estado_devolucion} <> 'NO_APLICA'`
        : (requestedStatus === "BANDEJA_DEVOLUCION" || requestedStatus === "PENDIENTE_Y_RECHAZADO")
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

    // Solo en HISTORIAL: por cada crédito VERIFICADO de esta página, por qué
    // sigue sin cerrar. Si sigue en VERIFICADO es porque el cierre
    // (marcarDevolucionCompletadaSiCorresponde) todavía no encontró el padre
    // limpio — lo normal es que falte liquidar a alguien, y esto se lo dice
    // al operador sin que tenga que ir a mirar la base. Se reusa el mismo
    // predicado que decide el cierre real, así que nunca puede divergir de
    // "cuándo cierra de verdad" un crédito.
    //
    // Dos motivos posibles (ver MotivoDiferido en devolucionCompletada.ts):
    //   - inversionistas_en_padre: quedan N filas no-CUBE en el padre.
    //   - saldo_en_espejo: el padre ya está limpio, pero el inversionista que
    //     salió todavía tiene saldo en el espejo (no se le puede cerrar por
    //     el guard de monto_aportado==0 de la RAMA 2 de la liquidación).
    const pendientesPorCredito = new Map<
      number,
      { motivo: "inversionistas_en_padre"; restantes: number } | { motivo: "saldo_en_espejo" }
    >();
    if (requestedStatus === "HISTORIAL") {
      const verificadosIds = pendingCredits
        .filter((c) => c.estado_devolucion === "VERIFICADO")
        .map((c) => c.credito_id);

      if (verificadosIds.length > 0) {
        const { diferidos } = await filtrarCreditosTotalmenteDevueltos(db, verificadosIds);
        for (const [creditoId, motivoDiferido] of diferidos) {
          pendientesPorCredito.set(
            creditoId,
            motivoDiferido.tipo === "inversionistas_en_padre"
              ? { motivo: "inversionistas_en_padre", restantes: motivoDiferido.restantes }
              : { motivo: "saldo_en_espejo" },
          );
        }
      }
    }

    const creditsConAlerta = pendingCredits.map((c) => ({
      ...c,
      pendiente_cierre:
        c.estado_devolucion === "VERIFICADO"
          ? (pendientesPorCredito.get(c.credito_id) ?? null)
          : null,
    }));

    return {
      success: true,
      data: {
        credits: creditsConAlerta,
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

export type AceptarDevolucionDeps = {
  marcarDevolucionCompletadaSiCorresponde?: typeof marcarDevolucionCompletadaSiCorresponde;
};

export async function aceptarDevolucion(
  { params, set }: any,
  deps: AceptarDevolucionDeps = {}
) {
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

    // Todo o nada: cambio de estado + log + abonos de CANCELACIÓN en una transacción.
    // Si falla el registro de abonos, se revierte también el cambio de estado.
    const abonos = await db.transaction(async (tx) => {
      // 1. Actualizar crédito de forma atómica: la transición solo aplica si el
      //    crédito SIGUE en PENDIENTE_AUTORIZACION. Esto cierra la carrera de
      //    doble-aceptación (el guard previo es un SELECT sin lock): dos requests
      //    concurrentes serializan aquí y la segunda afecta 0 filas → aborta,
      //    evitando registrar los abonos de CANCELACIÓN dos veces.
      const actualizados = await tx
        .update(creditos)
        .set({ estado_devolucion: "VERIFICADO" })
        .where(
          and(
            eq(creditos.credito_id, credito_id_num),
            eq(creditos.estado_devolucion, "PENDIENTE_AUTORIZACION")
          )
        )
        .returning({ credito_id: creditos.credito_id });

      if (actualizados.length === 0) {
        throw new Error(
          "El crédito ya no está en PENDIENTE_AUTORIZACION (posible doble aceptación concurrente)"
        );
      }

      // 2. Insertar log
      await tx.insert(historial_devolucion_credito).values({
        credito_id: credito_id_num,
        usuario_id: 1, // Placeholder para user_id autenticado
        estado_anterior: currentCredit.estado_devolucion,
        estado_nuevo: "VERIFICADO",
        motivo: null, // Opcional para aprobación
      });

      // 3. Registrar la cancelación de capital: una fila por inversionista del espejo
      return await registrarCancelacionEspejo(tx, credito_id_num);
    });

    // 4. Si el crédito ya no tiene inversionistas externos pendientes (p. ej. en el espejo
    //    solo queda CUBE o ningún inversionista con saldo), cerrar la devolución a COMPLETADO
    //    inmediatamente. De lo contrario, quedaría en VERIFICADO indefinidamente ya que no
    //    habrá pagos ni salidas manuales de inversionistas externos que invoquen el cierre.
    const marcarFn =
      deps.marcarDevolucionCompletadaSiCorresponde ?? marcarDevolucionCompletadaSiCorresponde;
    try {
      await marcarFn([credito_id_num], "aceptacion devolucion");
    } catch (cierreError) {
      console.error(
        "  ⚠️  Error cerrando la devolución tras aceptarDevolucion:",
        cierreError
      );
    }

    return {
      success: true,
      message: "Devolución aceptada y registrada correctamente",
      abonos_cancelacion: abonos,
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
