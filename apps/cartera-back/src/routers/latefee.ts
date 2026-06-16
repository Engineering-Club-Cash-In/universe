// routes/moras.ts
import { Elysia, t } from "elysia";
 
 
import { authMiddleware } from "./midleware";
import { createMora, updateMora, procesarMoras, condonarMora, getCreditosWithMoras, getCondonacionesMora, condonarTodasLasMoras } from "../controllers/latefee";
import { getMoraHistorialSnapshot, getMoraTimeline, getMoraHistorialCredito, getMoraHistorialExcel } from "../controllers/moraHistorial";

// Fecha de hoy en zona Guatemala (YYYY-MM-DD), para el corte por defecto del historial.
const hoyGT = () => {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Guatemala" }));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export const morasRouter = new Elysia()
  .use(authMiddleware)

  /**
   * Crear una mora manualmente
   */
  .post("/mora", async ({ body, set }) => {
    try {
      const result = await createMora(body);
      set.status = result.success ? 201 : 400;
      return result;
    } catch (err) {
      set.status = 500;
      return { success: false, message: "[ERROR] No se pudo crear la mora", error: String(err) };
    }
  }, {
    body: t.Object({
      credito_id: t.Number(),
      monto_mora: t.Optional(t.Number()),
      cuotas_atrasadas: t.Optional(t.Number()),
    })
  })

  /**
   * Actualizar una mora (incremento o decremento)
   */
  .post("/mora/update", async ({ body, user, set }: any) => {
    try {
      const result = await updateMora({ ...body, usuario_email: user?.email });
      set.status = result.success ? 200 : 400;
      return result;
    } catch (err) {
      set.status = 500;
      return { success: false, message: "[ERROR] No se pudo actualizar la mora", error: String(err) };
    }
  }, {
    body: t.Object({
      credito_id: t.Optional(t.Number()),
      numero_credito_sifco: t.Optional(t.String()),
      monto_cambio: t.Number(),
      tipo: t.Union([t.Literal("INCREMENTO"), t.Literal("DECREMENTO")]),
      cuotas_atrasadas: t.Optional(t.Number()),
      activa: t.Optional(t.Boolean()),
    })
  })

  /**
   * Procesar todas las moras de forma automática
   */
  .post("/moras/procesar", async ({ set }) => {
    try {
      const result = await procesarMoras();
      return { success: true, message: "Proceso de moras ejecutado", result };
    } catch (err) {
      set.status = 500;
      return { success: false, message: "[ERROR] No se pudo procesar las moras", error: String(err) };
    }
  })

  /**
   * Condonar mora de un crédito
   */
  .post("/mora/condonar", async ({ body, user, set }: any) => {
    try {
      const result = await condonarMora({
        credito_id: body.credito_id,
        motivo: body.motivo,
        usuario_email: user?.email ?? body.usuario_email,
      });
      set.status = result.success ? 200 : 400;
      return result;
    } catch (err) {
      set.status = 500;
      return { success: false, message: "[ERROR] No se pudo condonar la mora", error: String(err) };
    }
  }, {
    body: t.Object({
      credito_id: t.Number(),
      motivo: t.String(),
      usuario_email: t.Optional(t.String()),
    })
  })

  /**
   * Obtener créditos con moras (JSON o Excel)
   */
  .get("/moras/creditos", async ({ query, set }) => {
    try {
      const { numero_credito_sifco, cuotas_atrasadas, estado, excel } = query;
      const result = await getCreditosWithMoras({
        numero_credito_sifco,
        cuotas_atrasadas: cuotas_atrasadas ? Number(cuotas_atrasadas) : undefined,
        estado: estado as any,
        excel: excel === "true",
      });
      return result;
    } catch (err) {
      set.status = 500;
      return { success: false, message: "[ERROR] No se pudo obtener créditos con moras", error: String(err) };
    }
  }, {
    query: t.Object({
      numero_credito_sifco: t.Optional(t.String()),
      cuotas_atrasadas: t.Optional(t.String()),
      estado: t.Optional(t.String()),
      excel: t.Optional(t.String()),
    })
  })

  /**
   * Obtener historial de condonaciones de mora (JSON o Excel)
   */
  .get("/moras/condonaciones", async ({ query, set }) => {
    try {
      const { numero_credito_sifco, usuario_email, fecha_desde, fecha_hasta, excel } = query;
      const result = await getCondonacionesMora({
        numero_credito_sifco,
        usuario_email,
        fecha_desde: fecha_desde ? new Date(fecha_desde) : undefined,
        fecha_hasta: fecha_hasta ? new Date(fecha_hasta) : undefined,
        excel: excel === "true",
      });
      return result;
    } catch (err) {
      set.status = 500;
      return { success: false, message: "[ERROR] No se pudo obtener condonaciones", error: String(err) };
    }
  }, {
    query: t.Object({
      numero_credito_sifco: t.Optional(t.String()),
      usuario_email: t.Optional(t.String()),
      fecha_desde: t.Optional(t.String()), // ISO date string
      fecha_hasta: t.Optional(t.String()), // ISO date string
      excel: t.Optional(t.String()),
    })
  })
 
  .post("/moras/condonar-masivo", async ({ body, set }) => {
  try {
    const { motivo, usuario_email } = body;
    
    if (!motivo || !usuario_email) {
      set.status = 400;
      return { 
        success: false, 
        message: "[ERROR] Faltan parámetros requeridos: motivo, usuario_email" 
      };
    }

    const result = await condonarTodasLasMoras({
      motivo,
      usuario_email,
    });

    if (!result.success) {
      set.status = 400;
    }

    return result;
  } catch (err) {
    set.status = 500;
    return { 
      success: false, 
      message: "[ERROR] No se pudo realizar la condonación masiva", 
      error: String(err) 
    };
  }
}, {
  body: t.Object({
    motivo: t.String(),
    usuario_email: t.String(),
  })
}) .post(
    "/procesar",
    async ({ body }) => {
      try {
        console.log("🔥 ========== PROCESANDO MORAS MANUALMENTE ==========");
        
        await procesarMoras();
        
        return {
          success: true,
          message: "Moras procesadas exitosamente"
        };
      } catch (error: any) {
        console.error("❌ Error procesando moras:", error);
        return {
          success: false,
          error: error.message || "Error desconocido",
          message: "Error al procesar moras"
        };
      }
    },
    {
      detail: {
        tags: ["Moras"],
        summary: "Procesar moras manualmente",
        description: "Procesa todas las cuotas vencidas y genera/actualiza los registros de mora para los créditos correspondientes"
      }
    }
  )

  // ───────────── Mora Histórica (reconstruida desde moras_historial) ─────────────
  // Snapshot de la mora por crédito a una fecha de corte (con totales + filtros).
  .get("/moras/historial", async ({ query, set }: any) => {
    try {
      return await getMoraHistorialSnapshot({
        fecha: query.fecha || hoyGT(),
        asesor: query.asesor,
        etapa: query.etapa,
        numero_credito_sifco: query.numero_credito_sifco,
        nombre_usuario: query.nombre_usuario,
        page: query.page ? Number(query.page) : 1,
        pageSize: query.pageSize ? Number(query.pageSize) : 20,
      });
    } catch (err) {
      set.status = 500;
      return { success: false, message: "[ERROR] No se pudo obtener el historial de mora", error: String(err) };
    }
  }, {
    query: t.Object({
      fecha: t.Optional(t.String()),
      asesor: t.Optional(t.String()),
      etapa: t.Optional(t.String()),
      numero_credito_sifco: t.Optional(t.String()),
      nombre_usuario: t.Optional(t.String()),
      page: t.Optional(t.String()),
      pageSize: t.Optional(t.String()),
    }),
  })

  // Evolución (timeline) del total de mora día a día en un rango.
  .get("/moras/historial/timeline", async ({ query, set }: any) => {
    try {
      return await getMoraTimeline({ desde: query.desde, hasta: query.hasta || hoyGT(), asesor: query.asesor });
    } catch (err) {
      set.status = 500;
      return { success: false, message: "[ERROR] No se pudo obtener el timeline de mora", error: String(err) };
    }
  }, {
    query: t.Object({ desde: t.String(), hasta: t.Optional(t.String()), asesor: t.Optional(t.String()) }),
  })

  // Excel del snapshot a la fecha de corte.
  .get("/moras/historial/excel", async ({ query, set }: any) => {
    try {
      const fecha = query.fecha || hoyGT();
      const buf = await getMoraHistorialExcel({
        fecha, asesor: query.asesor, etapa: query.etapa,
        numero_credito_sifco: query.numero_credito_sifco, nombre_usuario: query.nombre_usuario,
      });
      return new Response(new Uint8Array(buf), {
        headers: {
          "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "content-disposition": `attachment; filename="mora-${fecha}.xlsx"`,
        },
      });
    } catch (err) {
      set.status = 500;
      return { success: false, message: "[ERROR] No se pudo generar el Excel de mora", error: String(err) };
    }
  }, {
    query: t.Object({
      fecha: t.Optional(t.String()), asesor: t.Optional(t.String()), etapa: t.Optional(t.String()),
      numero_credito_sifco: t.Optional(t.String()), nombre_usuario: t.Optional(t.String()),
    }),
  })

  // Historial completo de eventos de mora de un crédito (drill-down).
  .get("/moras/historial/credito/:credito_id", async ({ params, set }: any) => {
    try {
      const creditoId = Number(params.credito_id);
      if (!Number.isInteger(creditoId) || creditoId <= 0) {
        set.status = 400;
        return { success: false, message: "[ERROR] credito_id inválido" };
      }
      return await getMoraHistorialCredito({ credito_id: creditoId });
    } catch (err) {
      set.status = 500;
      return { success: false, message: "[ERROR] No se pudo obtener el historial del crédito", error: String(err) };
    }
  });