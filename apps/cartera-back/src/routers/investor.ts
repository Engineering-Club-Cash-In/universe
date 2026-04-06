// routes/inversionistas.ts
import { Elysia, t } from "elysia";
import {
  getInvestors,
  insertInvestor,
  getInvestorsWithCredits,
  resumeInvestor,
  liquidateByInvestorId,
  liquidateByInvestorSchema,
  updateInvestor,
  resumenGlobalInversionistas,
  resumenGlobalLiquidaciones,
  getLiquidaciones,
  getInvestorPerformance,
  getInvestorTotalsGlobales,
  getInvestorMirrorSummary,
  upsertPagosEspejo,             // 🆕 Recalcular pagos espejo desde el front
  aplicarPagosEspejo,
  deletePagosEspejoNoLiquidados,
  updateSaldoReinversion,
  updateLiquidacionReporteUrl,
  getLiquidacionesPorFecha,
  revertirLiquidacion,
  fixCubeInvestment,
  reconcileMirrorPercentages,
  auditMirrorPercentages,
  getCreditosEspejoPendientes,
} from "../controllers/investor";
import { InversionistaReporte, RespuestaReporte } from "../utils/interface";
import { generarYSubirPDFInversionista, generarYSubirExcelInversionista } from "../utils/functions/generalFunctions";
import { authMiddleware } from "./midleware";
import { obtenerCreditosConPagosPendientes, calcularYRegistrarPagosEspejo } from "../controllers/payments";
import { createBoleta, getBoletaById, getAllBoletas, getBoletasPendientes, updateBoleta, marcarBoletaComoProcesada, marcarBoletaComoPendiente, deleteBoleta, getBoletasStats } from "../controllers/liquidateInvestor";
import { requierePeriodoLiquidacion } from "../utils/investorLiquidationSummary";
// 🔥 IMPORTAR SERVICIO DE BOLETAS
 

export const inversionistasRouter = new Elysia()
  .post("/investor", insertInvestor)
  .get("/investor", getInvestors)
  .post("/investor/update", updateInvestor)
  .post("/investor/saldo-reinversion", updateSaldoReinversion)
  .post("/investor/fix-cube", fixCubeInvestment)
  .post("/investor/reconcile-mirror-percentages", reconcileMirrorPercentages)
  .post("/investor/audit-mirror-percentages", auditMirrorPercentages)
  .get("/getInvestorsWithFullCredits", getInvestorsWithCredits)
  .get(
    "/getInvestors",
    async ({ query, set }) => {
      const {
        id,
        dpi,
        page = "1",
        perPage = "10",
        numeroCreditoSifco,
        nombreUsuario,
        incluirLiquidados = "false",
        numeroCuota,
        tipo = "originales", // 🆕 NUEVO: Permite consultar originales, espejos o ambas
      } = query as Record<string, string | undefined>;

      const pageNum = Number(page);
      const perPageNum = Number(perPage);

      if (isNaN(pageNum) || isNaN(perPageNum)) {
        set.status = 400;
        return { message: "Parámetros 'page' y/o 'perPage' inválidos." };
      }

      if (!id && !dpi) {
        set.status = 400;
        return {
          message: "Debe proporcionar al menos 'id' o 'dpi' para buscar al inversionista.",
        };
      }

      const incluirLiquidadosBool = incluirLiquidados === "true";
      const numeroCuotaNum = numeroCuota ? Number(numeroCuota) : undefined;
      
      if (numeroCuota && isNaN(numeroCuotaNum!)) {
        set.status = 400;
        return { message: "El parámetro 'numeroCuota' debe ser numérico." };
      }

      const result = await resumeInvestor(
        id ? Number(id) : undefined,
        pageNum,
        perPageNum,
        numeroCreditoSifco,
        nombreUsuario,
        dpi,
        incluirLiquidadosBool,
        numeroCuotaNum,
        tipo as "originales" | "espejos" | "ambas" // 🆕 NUEVO: Pasar tipo a la función
      );

      return result;
    },
    {
      query: t.Object({
        id: t.Optional(t.String()),
        dpi: t.Optional(t.String()),
        page: t.Optional(t.String()),
        perPage: t.Optional(t.String()),
        numeroCreditoSifco: t.Optional(t.String()),
        nombreUsuario: t.Optional(t.String()),
        incluirLiquidados: t.Optional(t.String()),
        numeroCuota: t.Optional(t.String()),
        tipo: t.Optional(t.Union([
          t.Literal("originales"),
          t.Literal("espejos"),
          t.Literal("ambas")
        ])), // 🆕 NUEVO: Validación del parámetro tipo
      }),
      detail: {
        summary: "Obtiene el resumen de un inversionista con sus créditos y pagos",
        description: "Permite consultar datos de tablas originales, espejo o ambas usando el parámetro 'tipo'. Por defecto consulta 'originales'.",
        tags: ["Inversionistas"],
      },
    }
  )
  .get(
    "/getInvestorTotals",
    async ({ query, set }) => {
      const {
        id,
        dpi,
        tipo = "originales",
        incluirLiquidados = "false",
        numeroCuota,
      } = query as Record<string, string | undefined>;

      if (!id && !dpi) {
        set.status = 400;
        return {
          message: "Debe proporcionar al menos 'id' o 'dpi' para buscar al inversionista.",
        };
      }

      const incluirLiquidadosBool = incluirLiquidados === "true";
      const numeroCuotaNum = numeroCuota ? Number(numeroCuota) : undefined;

      if (numeroCuota && isNaN(numeroCuotaNum!)) {
        set.status = 400;
        return { message: "El parámetro 'numeroCuota' debe ser numérico." };
      }

      try {
        const result = await getInvestorTotalsGlobales(
          id ? Number(id) : undefined,
          dpi,
          tipo as "originales" | "espejos" | "ambas",
          incluirLiquidadosBool,
          numeroCuotaNum
        );

        return result;
      } catch (error: any) {
        set.status = 500;
        return {
          message: error.message || "Error al obtener totales del inversionista",
        };
      }
    },
    {
      query: t.Object({
        id: t.Optional(t.String()),
        dpi: t.Optional(t.String()),
        tipo: t.Optional(t.Union([
          t.Literal("originales"),
          t.Literal("espejos"),
          t.Literal("ambas")
        ])),
        incluirLiquidados: t.Optional(t.String()),
        numeroCuota: t.Optional(t.String()),
      }),
      detail: {
        summary: "Obtiene los totales globales de un inversionista (sin paginación)",
        description: "Calcula las sumas de TODOS los créditos y pagos del inversionista, sin aplicar paginación. Útil para mostrar totales reales en el frontend.",
        tags: ["Inversionistas"],
      },
    }
  )
  .get(
    "/getInvestorMirrorSummary",
    /**
     * Endpoint: GET /getInvestorMirrorSummary
     *
     * Devuelve los subtotales financieros de un inversionista calculados
     * EXCLUSIVAMENTE desde la tabla `pagos_credito_inversionistas_espejo`.
     *
     * El campo `total_monto_aportado` se recalcula dinámicamente:
     *   monto_aportado_base (de creditos_inversionistas_espejo)
     *   - SUM(abono_capital de pagos_credito_inversionistas_espejo)
     *
     * Esto garantiza que el saldo sea consistente con el historial real de pagos.
     *
     * @param id              - ID del inversionista
     * @param dpi             - DPI del inversionista (alternativa al id)
     * @param incluirLiquidados - "true" para incluir pagos ya liquidados
     */
    async ({ query, set }) => {
      const {
        id,
        dpi,
        incluirLiquidados = "false",
      } = query as Record<string, string | undefined>;

      if (!id && !dpi) {
        set.status = 400;
        return {
          message: "Debe proporcionar al menos 'id' o 'dpi' para buscar al inversionista.",
        };
      }

      const incluirLiquidadosBool = incluirLiquidados === "true";

      try {
        const result = await getInvestorMirrorSummary(
          id ? Number(id) : undefined,
          dpi,
          incluirLiquidadosBool
        );

        set.status = 200;
        return result;
      } catch (error: any) {
        console.error("[GET /getInvestorMirrorSummary] Error:", error);
        set.status = error.message?.includes("no encontrado") ? 404 : 500;
        return {
          message: error.message || "Error al calcular el resumen espejo del inversionista",
        };
      }
    },
    {
      query: t.Object({
        id: t.Optional(t.String()),
        dpi: t.Optional(t.String()),
        incluirLiquidados: t.Optional(t.String()),
      }),
      detail: {
        summary: "Resumen financiero calculado desde pagos espejo",
        description:
          "Calcula los subtotales del inversionista (capital, interés, IVA, ISR, cuota) " +
          "usando EXCLUSIVAMENTE los registros de `pagos_credito_inversionistas_espejo`. " +
          "El campo `total_monto_aportado` se recalcula restando los abonos de capital " +
          "al monto_aportado_base, sin depender del saldo guardado en `creditos_inversionistas_espejo`.",
        tags: ["Inversionistas", "Espejos"],
      },
    }
  )
  .post(
    "/liquidate-inversionista-pagos",
    async ({ body, set }) => {
      try {
        console.log("[liquidate-inversionista-pagos] Request body:", body);
        const bodyData = body && typeof body === 'object' ? body : {};
        const parseResult = liquidateByInvestorSchema.safeParse(bodyData);

        if (!parseResult.success) {
          set.status = 400;
          return {
            message: "Validation failed",
            errors: parseResult.error.flatten().fieldErrors,
          };
        }

        const { inversionista_id } = parseResult.data;

        if (!inversionista_id) {
          console.warn("⚠️ ¡ALERTA! Se va a liquidar TODOS los pagos del sistema");
        }

        // Lanzar liquidación en background y responder inmediatamente
        // Si algo falla, los pagos quedan como NO_LIQUIDADO (pendientes)
        liquidateByInvestorId(inversionista_id).then((result) => {
          console.log(`[liquidate-inversionista-pagos] Background OK para inversionista ${inversionista_id}:`, result.message);
        }).catch((err) => {
          console.error(`[liquidate-inversionista-pagos] Background ERROR para inversionista ${inversionista_id}:`, err);
        });

        set.status = 202;
        return {
          message: inversionista_id
            ? `Liquidación iniciada para inversionista ${inversionista_id}. Se procesará en segundo plano.`
            : "Liquidación masiva iniciada. Se procesará en segundo plano.",
          inversionista_id: inversionista_id ?? "TODOS",
        };
      } catch (error) {
        console.error("[liquidate-inversionista-pagos] Error:", error);
        set.status = 500;
        return {
          message: "Internal server error",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    {
      body: t.Optional(t.Object({
        inversionista_id: t.Optional(t.Number()),
      })),
      detail: {
        summary: "Liquida todos los pagos de un inversionista (async, responde inmediato)",
        tags: ["Pagos/Inversionistas"],
      },
    }
  )
  .post("/investor/pdf", async ({ body, set }) => {
    const { id, page = 1, perPage = 1 } = body as { 
      id?: number; 
      page?: number; 
      perPage?: number 
    };
    
    console.log("Generando PDF para inversionista ID:", id);
    const pageNum = Number(page);
    const perPageNum = Number(perPage);

    if ((page && isNaN(pageNum)) || (perPage && isNaN(perPageNum))) {
      set.status = 400;
      return { message: "Parámetros 'page' y/o 'perPage' inválidos." };
    }

    if (!id || isNaN(Number(id))) {
      set.status = 400;
      return { message: "El parámetro 'id' es obligatorio y debe ser numérico." };
    }

    const result = await resumeInvestor(
      Number(id),
      1,
      999999,
      undefined,
      undefined,
      undefined,
      false,
      undefined,
      "espejos"
    );

    if (!result.inversionistas.length) {
      set.status = 404;
      return { message: "Inversionista no encontrado." };
    }

    const inversionista = result.inversionistas[0];

    // Totales desde getInvestorTotalsGlobales (espejos, no liquidados)
    const totales = await getInvestorTotalsGlobales(
      Number(id),
      undefined,
      "espejos",
      false
    );
    inversionista.subtotal = totales.totales as any;

    const logoUrl = import.meta.env.LOGO_URL || "";
    const filename = `reporte_inversionista_${id}.pdf`;
    const { url } = await generarYSubirPDFInversionista(
      inversionista as any,
      filename,
      logoUrl
    );

    return {
      success: true,
      url,
      filename,
    };
  })
  .post("/investor/excel", async ({ body, set }) => {
    const { id } = body as { id?: number };

    if (!id || isNaN(Number(id))) {
      set.status = 400;
      return { message: "El parámetro 'id' es obligatorio y debe ser numérico." };
    }

    try {
      const result = await resumeInvestor(
        Number(id),
        1,
        999999,
        undefined,
        undefined,
        undefined,
        false,
        undefined,
        "espejos"
      );

      if (!result.inversionistas.length) {
        set.status = 404;
        return { message: "Inversionista no encontrado." };
      }

      const inversionista = result.inversionistas[0];

      const totales = await getInvestorTotalsGlobales(
        Number(id),
        undefined,
        "espejos",
        false
      );
      inversionista.subtotal = totales.totales as any;

      const logoUrl = import.meta.env.LOGO_URL || "";
      const filename = `reporte_inversionista_${id}_${Date.now()}.xlsx`;
      const { url } = await generarYSubirExcelInversionista(
        inversionista as any,
        filename,
        logoUrl
      );

      return {
        success: true,
        url,
        filename,
      };
    } catch (error) {
      console.error("[POST /investor/excel] Error:", error);
      set.status = 500;
      return {
        message: "Error al generar el Excel",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  })
  .post("/investor/reporte-liquidados-masivo", async ({ body, set }) => {
    const { fecha_liquidacion } = body as { fecha_liquidacion?: string };

    const fecha = fecha_liquidacion || new Date().toISOString().slice(0, 10);

    try {
      const liquidacionesDelDia = await getLiquidacionesPorFecha(fecha);

      if (!liquidacionesDelDia.length) {
        set.status = 404;
        return { message: `No se encontraron liquidaciones para la fecha ${fecha}.` };
      }

      const resultados: any[] = [];
      const errores: any[] = [];

      for (const liq of liquidacionesDelDia) {
        const { inversionista_id: id, liquidacion_id: liqId } = liq;
        try {
          const result = await resumeInvestor(
            id,
            1,
            999999,
            undefined,
            undefined,
            undefined,
            false,
            undefined,
            "espejos",
            true,
            liqId
          );

          if (!result.inversionistas.length) {
            errores.push({ id, liquidacion_id: liqId, error: "Sin pagos liquidados" });
            continue;
          }

          const inversionista = result.inversionistas[0];

          const totales = await getInvestorTotalsGlobales(
            id,
            undefined,
            "espejos",
            false,
            undefined,
            true,
            liqId
          );
          inversionista.subtotal = totales.totales as any;

          const logoUrl = import.meta.env.LOGO_URL || "";
          const filename = `reporte_liquidados_${id}_${Date.now()}.xlsx`;
          const { url } = await generarYSubirExcelInversionista(
            inversionista as any,
            filename,
            logoUrl
          );

          const liquidacionActualizada = await updateLiquidacionReporteUrl(id, url);

          resultados.push({
            inversionista_id: id,
            liquidacion_id: liqId,
            nombre: inversionista.nombre_inversionista,
            url,
            filename,
            liquidacion: liquidacionActualizada || null,
          });
        } catch (err) {
          errores.push({
            id,
            liquidacion_id: liqId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      return {
        success: true,
        fecha,
        total_procesados: resultados.length,
        total_errores: errores.length,
        resultados,
        errores,
      };
    } catch (error) {
      console.error("[investor/reporte-liquidados-masivo] Error:", error);
      set.status = 500;
      return {
        message: "Error al generar reportes masivos",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  })
  .post("/investor/reporte-liquidados", async ({ body, set }) => {
    const { id } = body as { id?: number };

    if (!id || isNaN(Number(id))) {
      set.status = 400;
      return { message: "El parámetro 'id' es obligatorio y debe ser numérico." };
    }

    try {
      const todasLiquidaciones = await getLiquidaciones({ inversionista_id: Number(id), perPage: 1 });
      const liquidacionReciente = todasLiquidaciones.liquidaciones?.[0];

      if (!liquidacionReciente) {
        set.status = 404;
        return { message: "Inversionista no encontrado o sin liquidaciones." };
      }
      const liquidacionId = liquidacionReciente.liquidacion_id;

      const result = await resumeInvestor(
        Number(id),
        1,
        999999,
        undefined,
        undefined,
        undefined,
        false,
        undefined,
        "espejos",
        true, // soloLiquidados
        liquidacionId,
        undefined
      );

      if (!result.inversionistas.length) {
        set.status = 404;
        return { message: "Inversionista no encontrado o sin pagos liquidados." };
      }

      const inversionista = result.inversionistas[0];

      const totales = await getInvestorTotalsGlobales(
        Number(id),
        undefined,
        "espejos",
        false,
        undefined,
        true, // soloLiquidados
        liquidacionId,
        undefined
      );
      inversionista.subtotal = totales.totales as any;

      const logoUrl = import.meta.env.LOGO_URL || "";
      const filename = `reporte_liquidados_${id}_${Date.now()}.xlsx`;
      const { url } = await generarYSubirExcelInversionista(inversionista as any, filename, logoUrl);

      const liquidacionActualizada = await updateLiquidacionReporteUrl(Number(id), url);

      return {
        success: true,
        url,
        filename,
        liquidacion: liquidacionActualizada || null,
      };
    } catch (error) {
      console.error("[investor/pdf-liquidados] Error:", error);
      set.status = 500;
      return {
        message: "Error al generar el PDF",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  })
  // ──────────────────────────────────────────────
  // Revertir una liquidación completa por liquidacion_id
  // Deshace: pagos espejo, monto_aportado, cuotas, boleta, reinversión y liquidación
  // Todo dentro de una transacción
  // ──────────────────────────────────────────────
  .post("/investor/revertir-liquidacion", async ({ body, set }) => {
    const { liquidacion_id } = body as { liquidacion_id?: number };

    if (!liquidacion_id || isNaN(Number(liquidacion_id))) {
      set.status = 400;
      return { message: "El parámetro 'liquidacion_id' es obligatorio y debe ser numérico." };
    }

    try {
      const result = await revertirLiquidacion(Number(liquidacion_id));
      return result;
    } catch (error) {
      console.error("[investor/revertir-liquidacion] Error:", error);
      set.status = 500;
      return {
        message: "Error al revertir la liquidación",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  })
  .get(
    "/resumen-global",
    async ({ query }) => {
      const { inversionistaId, mes, anio, excel } = query;

      const result = await resumenGlobalInversionistas(
        inversionistaId ? Number(inversionistaId) : undefined,
        mes ? Number(mes) : undefined,
        anio ? Number(anio) : undefined,
        excel === "true"
      );

      return result;
    },
    {
      query: t.Object({
        inversionistaId: t.Optional(t.String()),
        mes: t.Optional(t.String()),
        anio: t.Optional(t.String()),
        excel: t.Optional(t.String()),
      }),
    }
  )
  .get(
    "/resumen-global-liquidaciones",
    async ({ query, set }) => {
      const { inversionistaId, mes, anio, estado = "pending", excel } = query;
      const estadoFiltro = estado as "pending" | "uploaded" | "liquidated" | "all";

      // Si hay inversionistaId, permitir liquidated/all sin mes/anio (trae todo el historial)
      if (requierePeriodoLiquidacion(estadoFiltro) && (!mes || !anio) && !inversionistaId) {
        set.status = 400;
        return {
          message:
            "Los parámetros 'mes' y 'anio' son obligatorios cuando estado es 'liquidated' o 'all' sin inversionistaId.",
        };
      }

      return resumenGlobalLiquidaciones(
        inversionistaId ? Number(inversionistaId) : undefined,
        mes ? Number(mes) : undefined,
        anio ? Number(anio) : undefined,
        estadoFiltro,
        excel === "true"
      );
    },
    {
      query: t.Object({
        inversionistaId: t.Optional(t.String()),
        mes: t.Optional(t.String()),
        anio: t.Optional(t.String()),
        estado: t.Optional(
          t.Union([
            t.Literal("pending"),
            t.Literal("uploaded"),
            t.Literal("liquidated"),
            t.Literal("all"),
          ])
        ),
        excel: t.Optional(t.String()),
      }),
      detail: {
        summary: "Obtiene el resumen global de liquidaciones por inversionista",
        description:
          "Devuelve inversionistas clasificados como pending, uploaded o liquidated usando pagos espejo. /resumen-global se mantiene sin cambios y sigue devolviendo solo NO_LIQUIDADO. Si no se envía estado, se usa pending. Para estado=liquidated y estado=all, mes y anio son obligatorios y el período se aplica al resumen consultado.",
        tags: ["Inversionistas"],
      },
    }
  )
  .post(
    "/generateFalsePayments",
    async ({ body, set }) => {
      try {
        const { inversionistaId, generateFalsePayment } = body;

        console.log(`🔍 Procesando pagos pendientes para inversionista ${inversionistaId}`);
        console.log(`🎯 Generar pagos: ${generateFalsePayment}`);

        const resultado = await obtenerCreditosConPagosPendientes(
          inversionistaId,
          generateFalsePayment
        );

        if (!resultado.success) {
          set.status = 500;
          return {
            success: false,
            error: resultado.error,
          };
        }

        set.status = 200;
        return {
          success: true,
          message: generateFalsePayment 
            ? "✅ Pagos generados correctamente" 
            : "📄 Datos obtenidos correctamente",
          inversionistaId: resultado.inversionistaId ?? inversionistaId,
          totalCreditosConPagos: resultado.totalCreditosConCuotas ?? 0,
          pagosGenerados: resultado.pagosGenerados ?? false,
          data: resultado.data ?? [],
        };

      } catch (error: any) {
        console.error("❌ Error en POST /pagos-pendientes/generar:", error);
        set.status = 500;
        return {
          success: false,
          error: error.message || "Error al procesar pagos pendientes",
        };
      }
    },
    {
      detail: {
        summary: "Generar pagos pendientes para un inversionista",
        tags: ["Pagos Pendientes"],
      },
      body: t.Object({
        inversionistaId: t.Number({
          description: "ID del inversionista",
          minimum: 1,
        }),
        generateFalsePayment: t.Boolean({
          description: "Si es true, genera los pagos en pagos_credito_inversionistas",
          default: false,
        }),
      }),
      response: {
        200: t.Object({
          success: t.Boolean(),
          message: t.String(),
          inversionistaId: t.Number(),
          totalCreditosConPagos: t.Number(),
          pagosGenerados: t.Boolean(),
          data: t.Array(t.Any()),
        }),
        500: t.Object({
          success: t.Literal(false),
          error: t.String(),
        }),
      },
    }
  )
  .get(
    "/liquidaciones",
    async ({ query, set }) => {
      try {
        const { inversionista_id, liquidacion_id, dpi,email, page, perPage } = query;

        const result = await getLiquidaciones({
          inversionista_id: inversionista_id
            ? Number(inversionista_id)
            : undefined,
          liquidacion_id: liquidacion_id ? Number(liquidacion_id) : undefined,
          dpi: dpi || undefined,
          email: email || undefined,
          page: page ? Number(page) : 1,
          perPage: perPage ? Number(perPage) : 10,
        });

        set.status = 200;
        return result;
      } catch (error) {
        console.error("[GET /liquidaciones] Error:", error);
        set.status = 500;
        return {
          message: "Error al obtener liquidaciones",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    {
      query: t.Object({
        inversionista_id: t.Optional(t.String()),
        liquidacion_id: t.Optional(t.String()),
        dpi: t.Optional(t.String()),
        email: t.Optional(t.String()),
        page: t.Optional(t.String()),
        perPage: t.Optional(t.String()),
      }),
      detail: {
        summary: "Obtener liquidaciones con sus pagos",
        tags: ["Liquidaciones"],
      },
    }
  )
  .get(
    "/inversionistas/rendimiento",
    async ({ query, set }) => {
      try {
        const { dpi, email } = query;

        if (!dpi && !email) {
          set.status = 400;
          return {
            success: false,
            message: "Se requiere al menos 'dpi' o 'email'",
          };
        }

        const result = await getInvestorPerformance(dpi, email);

        set.status = 200;
        return {
          success: true,
          data: result,
        };
      } catch (error) {
        console.error("[GET /inversionistas/rendimiento] Error:", error);
        set.status = 500;
        return {
          success: false,
          message: "Error al obtener rendimiento",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    {
      query: t.Object({
        dpi: t.Optional(t.String()),
        email: t.Optional(t.String()),
      }),
      detail: {
        summary: "Obtener rendimiento de inversionista por DPI o email",
        tags: ["Inversionistas"],
      },
    }
  )
  // ============================================
  // 🔥 CRUD DE BOLETAS
  // ============================================
  .post(
    "/boletas",
    async ({ body, set }) => {
      try {
        console.log("📝 [POST /boletas] Body:", body);

        const boleta = await createBoleta({
          ...body,
          subido_por: body.subido_por?.toString(),
        });

        set.status = 201;
        return {
          success: true,
          message: "Boleta creada exitosamente",
          data: boleta,
        };
      } catch (error) {
        console.error("❌ [POST /boletas] Error:", error);
        set.status = 500;
        return {
          success: false,
          message: "Error al crear boleta",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    {
      body: t.Object({
        inversionista_id: t.Number({ minimum: 1 }),
        boleta_url: t.String({ minLength: 1 }),
        monto_boleta: t.Optional(t.String()),
        notas: t.Optional(t.String()),
        subido_por: t.Optional(t.Number()),
      }),
      detail: {
        summary: "Crear nueva boleta de pago",
        description: "Crea una boleta con estado PENDIENTE por defecto",
        tags: ["Boletas"],
      },
    }
  )
  .get(
    "/boletas/:id",
    async ({ params, set }) => {
      try {
        const { id } = params;
        console.log(`🔍 [GET /boletas/${id}]`);

        const boleta = await getBoletaById(Number(id));

        set.status = 200;
        return {
          success: true,
          data: boleta,
        };
      } catch (error) {
        console.error(`❌ [GET /boletas/${params.id}] Error:`, error);
        set.status = 404;
        return {
          success: false,
          message: error instanceof Error ? error.message : "Boleta no encontrada",
        };
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      detail: {
        summary: "Obtener boleta por ID",
        tags: ["Boletas"],
      },
    }
  )
  .get(
    "/boletas",
    async ({ query, set }) => {
      try {
        const { inversionista_id, estado, limit, offset } = query;
        console.log("📋 [GET /boletas] Query:", query);

        const boletas = await getAllBoletas({
          inversionista_id: inversionista_id ? Number(inversionista_id) : undefined,
          estado: estado as "PENDIENTE" | "PROCESADO" | undefined,
          limit: limit ? Number(limit) : undefined,
          offset: offset ? Number(offset) : undefined,
        });

        set.status = 200;
        return {
          success: true,
          data: boletas,
          total: boletas.length,
        };
      } catch (error) {
        console.error("❌ [GET /boletas] Error:", error);
        set.status = 500;
        return {
          success: false,
          message: "Error al listar boletas",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    {
      query: t.Object({
        inversionista_id: t.Optional(t.String()),
        estado: t.Optional(t.Union([t.Literal("PENDIENTE"), t.Literal("PROCESADO")])),
        limit: t.Optional(t.String()),
        offset: t.Optional(t.String()),
      }),
      detail: {
        summary: "Listar boletas con filtros",
        tags: ["Boletas"],
      },
    }
  )
  .get(
    "/boletas/pendientes",
    async ({ query, set }) => {
      try {
        const { inversionista_id } = query;
        console.log("📋 [GET /boletas/pendientes] Query:", query);

        const boletas = await getBoletasPendientes(
          inversionista_id ? Number(inversionista_id) : undefined
        );

        set.status = 200;
        return {
          success: true,
          data: boletas,
          total: boletas.length,
        };
      } catch (error) {
        console.error("❌ [GET /boletas/pendientes] Error:", error);
        set.status = 500;
        return {
          success: false,
          message: "Error al obtener boletas pendientes",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    {
      query: t.Object({
        inversionista_id: t.Optional(t.String()),
      }),
      detail: {
        summary: "Obtener boletas pendientes",
        tags: ["Boletas"],
      },
    }
  )
  .patch(
    "/boletas/:id",
    async ({ params, body, set }) => {
      try {
        const { id } = params;
        console.log(`✏️ [PATCH /boletas/${id}] Body:`, body);

        const boleta = await updateBoleta(Number(id), body);

        set.status = 200;
        return {
          success: true,
          message: "Boleta actualizada exitosamente",
          data: boleta,
        };
      } catch (error) {
        console.error(`❌ [PATCH /boletas/${params.id}] Error:`, error);
        set.status = 500;
        return {
          success: false,
          message: error instanceof Error ? error.message : "Error al actualizar boleta",
        };
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        boleta_url: t.Optional(t.String()),
        estado: t.Optional(t.Union([t.Literal("PENDIENTE"), t.Literal("PROCESADO")])),
        monto_boleta: t.Optional(t.String()),
        notas: t.Optional(t.String()),
        fecha_procesado: t.Optional(t.Date()),
      }),
      detail: {
        summary: "Actualizar boleta",
        tags: ["Boletas"],
      },
    }
  )
  .post(
    "/boletas/:id/procesar",
    async ({ params, set }) => {
      try {
        const { id } = params;
        console.log(`🔄 [POST /boletas/${id}/procesar]`);

        const boleta = await marcarBoletaComoProcesada(Number(id));

        set.status = 200;
        return {
          success: true,
          message: "Boleta marcada como PROCESADA",
          data: boleta,
        };
      } catch (error) {
        console.error(`❌ [POST /boletas/${params.id}/procesar] Error:`, error);
        set.status = 500;
        return {
          success: false,
          message: error instanceof Error ? error.message : "Error al procesar boleta",
        };
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      detail: {
        summary: "Marcar boleta como PROCESADA",
        tags: ["Boletas"],
      },
    }
  )
  .post(
    "/boletas/:id/revertir",
    async ({ params, set }) => {
      try {
        const { id } = params;
        console.log(`🔄 [POST /boletas/${id}/revertir]`);

        const boleta = await marcarBoletaComoPendiente(Number(id));

        set.status = 200;
        return {
          success: true,
          message: "Boleta marcada como PENDIENTE",
          data: boleta,
        };
      } catch (error) {
        console.error(`❌ [POST /boletas/${params.id}/revertir] Error:`, error);
        set.status = 500;
        return {
          success: false,
          message: error instanceof Error ? error.message : "Error al revertir boleta",
        };
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      detail: {
        summary: "Marcar boleta como PENDIENTE",
        tags: ["Boletas"],
      },
    }
  )
  .delete(
    "/boletas/:id",
    async ({ params, set }) => {
      try {
        const { id } = params;
        console.log(`🗑️ [DELETE /boletas/${id}]`);

        const boleta = await deleteBoleta(Number(id));

        set.status = 200;
        return {
          success: true,
          message: "Boleta eliminada exitosamente",
          data: boleta,
        };
      } catch (error) {
        console.error(`❌ [DELETE /boletas/${params.id}] Error:`, error);
        set.status = 500;
        return {
          success: false,
          message: error instanceof Error ? error.message : "Error al eliminar boleta",
        };
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      detail: {
        summary: "Eliminar boleta",
        description: "Solo se pueden eliminar boletas con estado PENDIENTE",
        tags: ["Boletas"],
      },
    }
  )
  .get(
    "/boletas/stats",
    async ({ query, set }) => {
      try {
        const { inversionista_id } = query;
        console.log("📊 [GET /boletas/stats] Query:", query);

        const stats = await getBoletasStats(
          inversionista_id ? Number(inversionista_id) : undefined
        );

        set.status = 200;
        return {
          success: true,
          data: stats,
        };
      } catch (error) {
        console.error("❌ [GET /boletas/stats] Error:", error);
        set.status = 500;
        return {
          success: false,
          message: "Error al obtener estadísticas",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    {
      query: t.Object({
        inversionista_id: t.Optional(t.String()),
      }),
      detail: {
        summary: "Obtener estadísticas de boletas",
        tags: ["Boletas"],
      },
    }
  )
  .post(
    "/calcularPagosEspejo",
    async ({ body, set }) => {
      try {
        const { inversionistaId } = body;

        console.log(
          `\n🚀 POST /calcularPagosEspejo → inversionistaId: ${inversionistaId}`
        );

        const resultado = await calcularYRegistrarPagosEspejo(inversionistaId);

        if (!resultado.success) {
          set.status = 500;
          return {
            success: false as const,
            error: (resultado as any).error ?? "Error desconocido",
          };
        }

        set.status = 200;
        return {
          success: true as const,
          message: `✅ Pagos espejo calculados y registrados correctamente`,
          inversionistaId: resultado.inversionistaId ?? inversionistaId,
          totalCreditosProcesados: resultado.totalCreditosProcesados ?? 0,
          data: resultado.data,
        };
      } catch (error: any) {
        console.error("❌ Error en POST /calcularPagosEspejo:", error);
        set.status = 500;
        return {
          success: false as const,
          error: error.message || "Error al calcular pagos espejo",
        };
      }
    },
    {
      detail: {
        summary:
          "Calcula y registra pagos espejo sin actualizar creditos_inversionistas_espejo",
        description:
          "Replica la lógica de /generateFalsePayments pero omite el UPDATE a creditos_inversionistas_espejo. Solo hace upsert en pagos_credito_inversionistas_espejo y marca las cuotas como liquidadas.",
        tags: ["Pagos Espejo"],
      },
      body: t.Object({
        inversionistaId: t.Number({
          description: "ID del inversionista a procesar",
          minimum: 1,
        }),
      }),
      response: {
        200: t.Object({
          success: t.Literal(true),
          message: t.String(),
          inversionistaId: t.Number(),
          totalCreditosProcesados: t.Number(),
          data: t.Array(t.Any()),
        }),
        500: t.Object({
          success: t.Literal(false),
          error: t.String(),
        }),
      },
    }
  )
  .post(
    "/recalcularPagosEspejo",
    async ({ body, set }) => {
      try {
        const { pagos } = body;

        console.log(
          `\n🔄 POST /recalcularPagosEspejo → ${pagos.length} pago(s) recibidos`
        );

        const resultado = await upsertPagosEspejo(pagos);

        set.status = 200;
        return {
          success: true as const,
          message: `✅ ${resultado.actualizados} pago(s) actualizados correctamente`,
          actualizados: resultado.actualizados,
        };
      } catch (error: any) {
        console.error("❌ Error en POST /recalcularPagosEspejo:", error);
        set.status = 500;
        return {
          success: false as const,
          error: error.message || "Error al recalcular pagos espejo",
        };
      }
    },
    {
      detail: {
        summary: "Recalcular pagos espejo desde el frontend",
        description:
          "Recibe un array de pagos (con su id PK) y actualiza los campos financieros en pagos_credito_inversionistas_espejo. " +
          "Valida que todos los ids existan antes de hacer cualquier UPDATE. No toca ninguna otra tabla.",
        tags: ["Pagos Espejo"],
      },
      body: t.Object({
        pagos: t.Array(
          t.Object({
            id:                       t.Number({ description: "PK de pagos_credito_inversionistas_espejo" }),
            abono_capital:            t.String(),
            abono_interes:            t.String(),
            abono_iva_12:             t.String(),
            porcentaje_participacion: t.String(),
            cuota:                    t.String(),
            estado_liquidacion:       t.Optional(
              t.Union([t.Literal("NO_LIQUIDADO"), t.Literal("LIQUIDADO")])
            ),
          }),
          { minItems: 1, description: "Array de pagos espejo a actualizar (deben existir en la BD)" }
        ),
      }),
      response: {
        200: t.Object({
          success: t.Literal(true),
          message: t.String(),
          actualizados: t.Number(),
        }),
        500: t.Object({
          success: t.Literal(false),
          error: t.String(),
        }),
      },
    }
  )
  // =============== 💾 APLICAR PAGOS ESPEJO ===============
  .post(
    "/aplicarPagosEspejo",
    async ({ body, set }) => {
      try {
        console.log("📥 POST /aplicarPagosEspejo", body);
        const resultado = await aplicarPagosEspejo(body.inversionistaId);

        return {
          success: true as const,
          message: `✅ ${resultado.actualizados} créditos actualizados con nuevos totales`,
          actualizados: resultado.actualizados,
        };
      } catch (error: any) {
        console.error("❌ Error en POST /aplicarPagosEspejo:", error);
        set.status = 500;
        return {
          success: false as const,
          error: error.message || "Error al aplicar pagos espejo",
        };
      }
    },
    {
      detail: {
        summary: "Actualizar encabezados de crédito espejo",
        description:
          "Toma la suma de los pagos en pagos_credito_inversionistas_espejo y actualiza los totales en creditos_inversionistas_espejo (monto aportado, etc).",
        tags: ["Pagos Espejo"],
      },
      body: t.Object({
        inversionistaId: t.Number(),
      }),
      response: {
        200: t.Object({
          success: t.Literal(true),
          message: t.String(),
          actualizados: t.Number(),
        }),
        500: t.Object({
          success: t.Literal(false),
          error: t.String(),
        }),
      },
    }

  )
  .post(
    "/deletePagosEspejoNoLiquidados",
    async ({ body, set }) => {
      const { inversionistaId } = body;
      
      console.log(`🗑️ DELETE /deletePagosEspejoNoLiquidados (ID: ${inversionistaId})`);

      if (!inversionistaId) {
        set.status = 400;
        return { success: false, message: "ID de inversionista requerido" };
      }

      try {
        const result = await deletePagosEspejoNoLiquidados(inversionistaId);
        return { 
          success: true, 
          deletedCount: result.deletedCount, 
          message: "Pagos eliminados correctamente" 
        };
      } catch (error: any) {
        console.error(error);
        set.status = 500;
        return { success: false, message: error.message };
      }
    },
    {
      body: t.Object({
        inversionistaId: t.Number(),
      }),
      detail: {
        summary: "Elimina pagos espejo estrictamente NO_LIQUIDADO",
        tags: ["Pagos Espejo"],
      },
    }
  )
  .get(
    "/creditos-espejo-pendientes",
    async ({ set }) => {
      try {
        const result = await getCreditosEspejoPendientes();
        return result;
      } catch (error: any) {
        console.error("[GET /creditos-espejo-pendientes] Error:", error);
        set.status = 500;
        return { message: error.message || "Error al obtener créditos espejo pendientes" };
      }
    },
    {
      detail: {
        summary: "Créditos espejo pendientes agrupados por inversionista",
        description:
          "Devuelve los créditos espejo con status pendiente_reinversion o pendiente_compra_cartera, " +
          "agrupados por inversionista. Incluye un array otrosCreditos placeholder.",
        tags: ["Inversionistas", "Espejos"],
      },
    }
  );
