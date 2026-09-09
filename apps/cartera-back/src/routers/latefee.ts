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

// Gate de rol server-side. `authMiddleware` SOLO valida la firma del JWT: no mira
// el rol, así que sin esto cualquier token vivo (incluido el de un INVESTOR del
// portal) entra a todo. Un único helper parametrizado; la lista de roles queda
// explícita en cada sitio de uso para que se lea al lado de la ruta que protege.
const requireRole =
  (roles: string[]) =>
  (user: any, set: any): boolean => {
    if (!user || !roles.includes(user.role)) {
      set.status = 403;
      return false;
    }
    return true;
  };

// Respuestas 403: mismo shape que ya usaba el archivo, una por combinación de roles.
const NO_AUTORIZADO = { success: false, message: "[ERROR] No autorizado (requiere ADMIN o CONTA)" };
const NO_AUTORIZADO_CONDONACION = { success: false, message: "[ERROR] No autorizado: condonar mora requiere rol ADMIN" };
const NO_AUTORIZADO_CREDITO = { success: false, message: "[ERROR] No autorizado (requiere ADMIN, CONTA o ASESOR)" };
const NO_AUTORIZADO_ADMIN = { success: false, message: "[ERROR] No autorizado (requiere ADMIN)" };

export const morasRouter = new Elysia()
  .use(authMiddleware)

  /**
   * Crear una mora manualmente
   */
  .post("/mora", async ({ body, user, set }: any) => {
    // Crear una mora sube la deuda exigible de un cliente, así que se cierra a los
    // roles que realmente la crean hoy. Son tres y no dos porque el botón "➕ Mora"
    // de la ficha del crédito lo ve un ASESOR en la vista móvil (en escritorio está
    // limitado a ADMIN): cerrar a ADMIN/CONTA lo rompería. Lo que sí queda afuera es
    // cualquier otro rol —INVESTOR del portal incluido—, que antes podía crear moras.
    if (!requireRole(["ADMIN", "CONTA", "ASESOR"])(user, set)) return NO_AUTORIZADO_CREDITO;
    try {
      // 'override' salta validaciones críticas (cuotas reales, guard del monto, estado
      // excluido), así que solo ADMIN/CONTA pueden forzarlo — sin importar que el front
      // muestre u oculte el checkbox, el API lo gatea server-side.
      if (body?.override === true && !["ADMIN", "CONTA"].includes(user?.role)) {
        set.status = 403;
        return { success: false, message: "[ERROR] 'override' requiere rol ADMIN o CONTA." };
      }
      const result = await createMora({
        ...body,
        usuario_id: user?.id ?? user?.user_id,        // del token (JWT decodificado)
        usuario_email: user?.email ?? user?.correo,    // fallback si el token no trae id
      });
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
      override: t.Optional(t.Boolean()),
      motivo: t.Optional(t.String()),
    })
  })

  /**
   * Actualizar una mora (incremento o decremento)
   */
  .post("/mora/update", async ({ body, user, set }: any) => {
    // Mismo gate que condonar (ADMIN): un DECREMENTO lo bastante grande deja la mora
    // en 0 y `activa=false`, o sea que esta ruta es funcionalmente equivalente a
    // condonar; y un INCREMENTO infla deuda exigible sin tope. Dejarla abierta
    // volvía inútil el gate de /mora/condonar.
    if (!requireRole(["ADMIN"])(user, set)) return NO_AUTORIZADO_ADMIN;
    try {
      // Motivo obligatorio: un ajuste manual de mora mueve dinero exigible y
      // antes quedaba en moras_historial sin justificación alguna.
      const motivo = typeof body?.motivo === "string" ? body.motivo.trim() : "";
      if (!motivo) {
        set.status = 400;
        return { success: false, message: "[ERROR] El motivo es obligatorio para ajustar la mora" };
      }
      const result = await updateMora({ ...body, motivo, usuario_email: user?.email });
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
      motivo: t.String(),
    })
  })

  /**
   * Procesar todas las moras de forma automática
   */
  .post("/moras/procesar", async ({ set, user }: any) => {
    // Dispara a mano la corrida que REESCRIBE la mora de toda la cartera
    // (crea/recalcula/desactiva filas de moras_credito). Solo ADMIN.
    if (!requireRole(["ADMIN"])(user, set)) return NO_AUTORIZADO_ADMIN;
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
    // Condonar borra dinero exigible: solo ADMIN.
    if (!requireRole(["ADMIN"])(user, set)) return NO_AUTORIZADO_CONDONACION;
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
  .get("/moras/creditos", async ({ query, set, user }: any) => {
    // Listado de TODA la cartera morosa (nombre, NIT, categoría, capital, asesor,
    // observaciones) y, con excel=true, sube ese Excel a una URL pública de R2.
    // Sin este gate cualquier token vivo —incluido un INVESTOR del portal— la extraía.
    if (!requireRole(["ADMIN", "CONTA"])(user, set)) return NO_AUTORIZADO;
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
  .get("/moras/condonaciones", async ({ query, set, user }: any) => {
    // Mismo alcance que /moras/creditos: historial de condonaciones de TODA la
    // cartera (+ Excel a URL pública de R2). ADMIN/CONTA.
    if (!requireRole(["ADMIN", "CONTA"])(user, set)) return NO_AUTORIZADO;
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
 
  .post("/moras/condonar-masivo", async ({ body, set, user }: any) => {
    if (!requireRole(["ADMIN"])(user, set)) return NO_AUTORIZADO_CONDONACION;
    try {
      const { motivo } = body;
      // La atribución sale del TOKEN, no del body: este email queda estampado en
      // moras_condonaciones.usuario_id y en cada fila de moras_historial, y en la
      // pantalla de Condonaciones como quien condonó. Tomarlo del body dejaba que
      // quien corre la operación más destructiva del módulo se la achacara a otro.
      // El body.usuario_email queda solo como fallback si el token no trae email.
      const usuario_email = user?.email ?? body.usuario_email;

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
      // Opcional como en la ruta hermana /mora/condonar: se ignora si el token
      // trae email. Se deja aceptar para no romper al front que aún lo manda.
      usuario_email: t.Optional(t.String()),
    })
  })
  // ⚠️ Alias histórico de /moras/procesar (hace exactamente lo mismo). Se gatea igual:
  // dejarlo abierto sería un bypass trivial del gate de /moras/procesar.
  .post(
    "/procesar",
    async ({ set, user }: any) => {
      if (!requireRole(["ADMIN"])(user, set)) return NO_AUTORIZADO_ADMIN;
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
  .get("/moras/historial", async ({ query, set, user }: any) => {
    if (!requireRole(["ADMIN", "CONTA"])(user, set)) return NO_AUTORIZADO;
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
  .get("/moras/historial/timeline", async ({ query, set, user }: any) => {
    if (!requireRole(["ADMIN", "CONTA"])(user, set)) return NO_AUTORIZADO;
    try {
      return await getMoraTimeline({ desde: query.desde, hasta: query.hasta || hoyGT(), asesor: query.asesor, etapa: query.etapa });
    } catch (err) {
      set.status = 500;
      return { success: false, message: "[ERROR] No se pudo obtener el timeline de mora", error: String(err) };
    }
  }, {
    query: t.Object({ desde: t.String(), hasta: t.Optional(t.String()), asesor: t.Optional(t.String()), etapa: t.Optional(t.String()) }),
  })

  // Excel del snapshot a la fecha de corte.
  .get("/moras/historial/excel", async ({ query, set, user }: any) => {
    if (!requireRole(["ADMIN", "CONTA"])(user, set)) return NO_AUTORIZADO;
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
  // ⚠️ Abierto a ASESOR por decisión explícita del dueño del producto (09-sep-2026):
  // el asesor necesita ver el historial desde la ficha del crédito. NO hay scoping por
  // asesor — cualquier ASESOR puede consultar el historial de CUALQUIER crédito pasando
  // otro credito_id, y con él los montos y los motivos de cada ajuste y condonación.
  // Es una decisión asumida, no un descuido: si se quiere limitar, el token trae
  // asesor_id y habría que cruzarlo contra creditos.asesor_id acá.
  // Las rutas hermanas (/moras/historial, /timeline, /excel) siguen ADMIN/CONTA porque
  // exponen la cartera completa de una sola vez.
  .get("/moras/historial/credito/:credito_id", async ({ params, set, user }: any) => {
    if (!requireRole(["ADMIN", "CONTA", "ASESOR"])(user, set)) return NO_AUTORIZADO_CREDITO;
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
