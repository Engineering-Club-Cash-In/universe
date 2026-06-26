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
  updateInvestorStatus,
  exitInvestor,
  resumenGlobalInversionistas,
  resumenGlobalLiquidaciones,
  resumenTransferencias,
  getLiquidaciones,
  getInvestorPerformance,
  getInvestorTotalsGlobales,
  getInvestorMirrorSummary,
  upsertPagosEspejo,             // 🆕 Recalcular pagos espejo desde el front
  aplicarPagosEspejo,
  deletePagosEspejoNoLiquidados,
  updateSaldoReinversion,
  updateLiquidacionReporteUrl,
  updateLiquidacionTotales,
  getLiquidacionesPorFecha,
  revertirLiquidacion,
  revertirComprasUltimaLiquidacion,
  ejecutarReinversionAutomatica,
  reinvertirDesdeLiquidacionId,
  fixCubeInvestment,
  reconcileMirrorPercentages,
  auditMirrorPercentages,
  getCreditosEspejoPendientes,
  detectPagosHuerfanos,
  simularInversionista,
} from "../controllers/investor";
import { ajustarPagosLiquidacion } from "../controllers/ajustarPagosLiquidacion";
import { InversionistaReporte, RespuestaReporte } from "../utils/interface";
import { generarYSubirPDFInversionista, generarYSubirExcelInversionista } from "../utils/functions/generalFunctions";
import { authMiddleware } from "./midleware";
import { obtenerCreditosConPagosPendientes, calcularYRegistrarPagosEspejo } from "../controllers/payments";
import { createBoleta, getBoletaById, getAllBoletas, getBoletasPendientes, updateBoleta, marcarBoletaComoProcesada, marcarBoletaComoPendiente, deleteBoleta, getBoletasStats } from "../controllers/liquidateInvestor";
import { requierePeriodoLiquidacion } from "../utils/investorLiquidationSummary";
import ExcelJS from "exceljs";
import { promises as fsp } from "node:fs";
import path from "node:path";
// 🔥 IMPORTAR SERVICIO DE BOLETAS


// ──────────────────────────────────────────────
// Helper: serializar resultados del bulk ajuste-pagos-liquidacion a CSV.
// Una fila por item enviado, con la URL del reporte (si se generó) y los
// deltas anterior/nuevo de cada total de la liquidación.
// ──────────────────────────────────────────────
function armarCsvBulkAjuste(
  resultados: Array<{
    index: number;
    inversionista_id?: number;
    liquidacion_id?: number;
    success: boolean;
    result?: any;
    error?: string;
  }>,
): string {
  const camposTotales = [
    "total_pagos_liquidados",
    "total_capital",
    "total_interes",
    "total_iva",
    "total_isr",
    "total_cuota",
    "reinversion_capital",
    "reinversion_interes",
    "reinversion_total",
  ] as const;

  // Header: una columna anterior + nuevo por cada total
  const headerBase = [
    "index",
    "inversionista_id",
    "liquidacion_id",
    "success",
    "dry_run",
    "reporte_url",
    "creditos_excluidos",
    "creditos_ajustados",
    "compras_canceladas",
    "totales_cambios_count",
    "error",
  ];
  const headerTotales = camposTotales.flatMap((c) => [
    `${c}_anterior`,
    `${c}_nuevo`,
    `${c}_diferencia`,
  ]);
  const header = [...headerBase, ...headerTotales];

  // Escape simple para CSV (RFC 4180): si tiene coma, comilla doble o salto
  // de línea, encerrar entre comillas y doblar las comillas internas.
  const esc = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    if (/[",\n\r]/.test(s)) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const filas: string[] = [header.join(",")];

  for (const r of resultados) {
    const res = r.result ?? {};
    const tu = res.totales_update ?? {};
    const fila = [
      esc(r.index),
      esc(r.inversionista_id ?? ""),
      esc(r.liquidacion_id ?? ""),
      esc(r.success),
      esc(res.dry_run ?? ""),
      esc(res.reporte_url ?? ""),
      esc(
        Array.isArray(res.creditos_excluidos_reporte)
          ? res.creditos_excluidos_reporte.join("|")
          : "",
      ),
      esc(
        Array.isArray(res.creditos_ajustados_reporte)
          ? res.creditos_ajustados_reporte
              .map(
                (c: any) =>
                  `${c.credito_id}:${c.monto_original}->${c.monto_ajustado}`,
              )
              .join("|")
          : "",
      ),
      esc(
        Array.isArray(res.compras_canceladas)
          ? res.compras_canceladas
              .map(
                (c: any) =>
                  `${c.credito_id}:espejo=${c.espejo_monto},compra=${c.compra_monto}`,
              )
              .join("|")
          : "",
      ),
      esc(res.totales_cambios_count ?? ""),
      esc(r.error ?? ""),
    ];

    for (const campo of camposTotales) {
      const t = tu[campo];
      if (t) {
        fila.push(esc(t.anterior), esc(t.nuevo), esc(t.diferencia));
      } else {
        fila.push("", "", "");
      }
    }

    filas.push(fila.join(","));
  }

  return filas.join("\n");
}

// ──────────────────────────────────────────────
// Helper: serializar resultados del bulk a XLSX y dejarlo escrito en disco.
// Mismas columnas y semántica que armarCsvBulkAjuste; columnas vacías cuando
// el campo no cambió, para que destaquen los cambios visualmente.
// Devuelve el path absoluto donde se escribió el archivo.
// ──────────────────────────────────────────────
async function armarYGuardarXlsxBulkAjuste(
  resultados: Array<{
    index: number;
    inversionista_id?: number;
    liquidacion_id?: number;
    success: boolean;
    result?: any;
    error?: string;
  }>,
): Promise<string> {
  const camposTotales = [
    "total_pagos_liquidados",
    "total_capital",
    "total_interes",
    "total_iva",
    "total_isr",
    "total_cuota",
    "reinversion_capital",
    "reinversion_interes",
    "reinversion_total",
  ] as const;

  const headerBase = [
    "index",
    "inversionista_id",
    "liquidacion_id",
    "success",
    "dry_run",
    "reporte_url",
    "creditos_excluidos",
    "creditos_ajustados",
    "compras_canceladas",
    "totales_cambios_count",
    "error",
  ];
  const headerTotales = camposTotales.flatMap((c) => [
    `${c}_anterior`,
    `${c}_nuevo`,
    `${c}_diferencia`,
  ]);
  const header = [...headerBase, ...headerTotales];

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("bulk_ajuste");

  // Header con negrita y freeze pane
  ws.addRow(header);
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];

  for (const r of resultados) {
    const res = r.result ?? {};
    const tu = res.totales_update ?? {};
    const fila: (string | number | null)[] = [
      r.index,
      r.inversionista_id ?? "",
      r.liquidacion_id ?? "",
      r.success,
      res.dry_run ?? "",
      res.reporte_url ?? "",
      Array.isArray(res.creditos_excluidos_reporte)
        ? res.creditos_excluidos_reporte.join("|")
        : "",
      Array.isArray(res.creditos_ajustados_reporte)
        ? res.creditos_ajustados_reporte
            .map(
              (c: any) =>
                `${c.credito_id}:${c.monto_original}->${c.monto_ajustado}`,
            )
            .join("|")
        : "",
      Array.isArray(res.compras_canceladas)
        ? res.compras_canceladas
            .map(
              (c: any) =>
                `${c.credito_id}:espejo=${c.espejo_monto},compra=${c.compra_monto}`,
            )
            .join("|")
        : "",
      res.totales_cambios_count ?? "",
      r.error ?? "",
    ];

    for (const campo of camposTotales) {
      const t = tu[campo];
      if (t) {
        // Convertir a número cuando sea posible (Excel hace mejor pivote/sort)
        const ant = isNaN(Number(t.anterior)) ? t.anterior : Number(t.anterior);
        const nue = isNaN(Number(t.nuevo)) ? t.nuevo : Number(t.nuevo);
        const dif = isNaN(Number(t.diferencia))
          ? t.diferencia
          : Number(t.diferencia);
        fila.push(ant, nue, dif);
      } else {
        fila.push("", "", "");
      }
    }

    ws.addRow(fila);
  }

  // Auto width básico (mín 12, máx 50, según el largo del header)
  ws.columns.forEach((col, i) => {
    const headerStr = String(header[i] ?? "");
    col.width = Math.min(Math.max(headerStr.length + 2, 12), 50);
  });

  // Path: <cwd>/ajustarPagos/bulk_resultado.xlsx
  // Cuando el back arranca desde apps/cartera-back/, cwd ya apunta ahí.
  const outDir = path.join(process.cwd(), "ajustarPagos");
  await fsp.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, "bulk_resultado.xlsx");
  await wb.xlsx.writeFile(outPath);
  return outPath;
}

export const inversionistasRouter = new Elysia()
  .use(authMiddleware)
  .post("/investor", insertInvestor)
  .get("/investor", getInvestors)
  .post("/investor/update", updateInvestor)
  .post(
    "/investor/status",
    updateInvestorStatus,
    {
      body: t.Object({
        inversionista_id: t.Number({ minimum: 1 }),
        status: t.Union([
          t.Literal("activo"),
          t.Literal("inactivo"),
          t.Literal("pendiente_devolucion"),
        ]),
      }),
      detail: {
        summary: "Cambia el status de un inversionista y notifica por correo",
        description:
          "Cambia el campo status del inversionista a 'activo', 'inactivo' o " +
          "'pendiente_devolucion'. Si el status cambia realmente, envía un correo " +
          "de notificación a la lista hardcodeada de destinatarios. Cuando el status " +
          "pasa a 'pendiente_devolucion', el correo incluye un aviso de que en la " +
          "próxima liquidación se le devolverá el saldo al inversionista.",
        tags: ["Inversionistas"],
      },
    }
  )
  .post(
    "/investor/exit",
    exitInvestor,
    {
      body: t.Object({
        inversionista_id: t.Number({ minimum: 1 }),
        creditos: t.Array(t.Number({ minimum: 1 }), { minItems: 1 }),
      }),
      detail: {
        summary: "Saca a un inversionista de los créditos indicados (CUBE absorbe) y lo marca como inactivo",
        description:
          "Por cada crédito de la lista: si CUBE NO está en el crédito, el row del " +
          "inversionista cambia de dueño a CUBE (mismo monto, misma cuota). Si CUBE " +
          "YA está, los campos numéricos del row del inversionista se suman al row de " +
          "CUBE y el row del inversionista se elimina. Lo mismo en el espejo, dejando " +
          "status='completado'. Al final, el inversionista pasa a status='inactivo' y " +
          "se envía correo de notificación a la lista hardcodeada.",
        tags: ["Inversionistas"],
      },
    }
  )
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

        const { inversionista_id, fecha_liquidacion } = parseResult.data;
        const fechaLiquidacion = fecha_liquidacion ? new Date(fecha_liquidacion) : undefined;

        if (!inversionista_id) {
          console.warn("⚠️ ¡ALERTA! Se va a liquidar TODOS los pagos del sistema");
        }

        const result = await liquidateByInvestorId(inversionista_id, fechaLiquidacion);

        const hayErrores = result.errores && result.errores.length > 0;
        const hayLiquidaciones = (result.liquidaciones_creadas ?? 0) > 0;

        if (hayErrores && !hayLiquidaciones) {
          set.status = 422;
        } else if (hayErrores && hayLiquidaciones) {
          set.status = 207;
        } else {
          set.status = 200;
        }

        return result;
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
        fecha_liquidacion: t.Optional(t.String()),
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
  .get(
    "/investor/reporte-no-liquidados",
    async ({ query, set }) => {
      const { id } = query;

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
        const filename = `reporte_no_liquidados_${id}_${Date.now()}.xlsx`;
        const { url } = await generarYSubirExcelInversionista(
          inversionista as any,
          filename,
          logoUrl,
          true
        );

        return {
          success: true,
          url,
          filename,
        };
      } catch (error) {
        console.error("[GET /investor/reporte-no-liquidados] Error:", error);
        set.status = 500;
        return {
          message: "Error al obtener reporte de pagos no liquidados",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    {
      query: t.Object({
        id: t.String(),
      }),
      detail: {
        summary: "Genera Excel con pagos no liquidados de un inversionista",
        description: "Genera y sube un Excel con el resumen de pagos espejo no liquidados del inversionista, y devuelve la URL del archivo.",
        tags: ["Inversionistas"],
      },
    }
  )
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
        if (id === 38 || id === 84) continue;
        try {
          const huerfanos = await detectPagosHuerfanos(id, liqId);
          if (huerfanos.length) {
            errores.push({
              id,
              liquidacion_id: liqId,
              error: `Se encontraron ${huerfanos.length} pago(s) huérfano(s) (sin crédito espejo asociado). No se generó el reporte.`,
              pagos_huerfanos: huerfanos,
            });
            continue;
          }

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

          const liquidacionActualizada = await updateLiquidacionReporteUrl(liqId, url);

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
    const { investor_id, liquidacion_id, reinvertir, solo_reporte, sustituir_totales } = body as {
      investor_id?: number;
      liquidacion_id?: number;
      reinvertir?: boolean;
      solo_reporte?: boolean;
      sustituir_totales?: boolean;
    };

    if (!investor_id || isNaN(Number(investor_id))) {
      set.status = 400;
      return { message: "El parámetro 'investor_id' es obligatorio y debe ser numérico." };
    }

    try {
      const liquidacionId = liquidacion_id

      const result = await resumeInvestor(
        Number(investor_id),
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

      // Totales formateados (USD para inv en dolares) — los que se ven en el Excel.
      const totales = await getInvestorTotalsGlobales(
        Number(investor_id),
        undefined,
        "espejos",
        false,
        undefined,
        true, // soloLiquidados
        liquidacionId,
        undefined
      );
      inversionista.subtotal = totales.totales as any;

      // Totales en bruto (siempre en Quetzales). Se usan para:
      //   • `sustituir_totales` → la tabla `liquidaciones` guarda en Q
      //   • la compra (`ejecutarReinversionAutomatica`) → addInvestorToCredit espera Q
      // Esto evita que para inversionistas en dólares (ej. Flujocapital 84)
      // se pase un valor USD donde se espera Q.
      const totalesRaw = await getInvestorTotalsGlobales(
        Number(investor_id),
        undefined,
        "espejos",
        false,
        undefined,
        true,
        liquidacionId,
        undefined,
        true, // rawValues
      );

      const logoUrl = import.meta.env.LOGO_URL || "";
      const filename = `reporte_liquidados_${liquidacionId}_${Date.now()}.xlsx`;
      const { url } = await generarYSubirExcelInversionista(inversionista as any, filename, logoUrl);

      // Si `solo_reporte=true`, devolvemos solo el Excel: no se actualiza la
      // `reporte_liquidacion_url` en la liquidación ni se ejecuta la
      // reinversión automática, sin importar el valor de `reinvertir`.
      if (solo_reporte) {
        return {
          success: true,
          url,
          filename,
          liquidacion: null,
          reinversion: null,
          solo_reporte: true,
        };
      }

      const liquidacionActualizada = await updateLiquidacionReporteUrl(Number(liquidacionId), url);

      // Si `sustituir_totales=true`, actualiza los totales monetarios de la
      // liquidación con los recalculados en vivo (en Q, igual que el INSERT
      // original de `liquidateByInvestorId`).
      let totalesActualizados: unknown = null;
      if (sustituir_totales && liquidacionId) {
        const pagosCount = (inversionista as any).creditos?.reduce(
          (acc: number, c: any) => acc + (c.pagos?.length ?? 0),
          0,
        ) ?? 0;
        try {
          totalesActualizados = await updateLiquidacionTotales(
            Number(liquidacionId),
            totalesRaw.totales as any,
            pagosCount,
          );
        } catch (totErr) {
          console.error(
            "[investor/reporte-liquidados] Error actualizando totales liquidación:",
            totErr,
          );
          totalesActualizados = {
            error: totErr instanceof Error ? totErr.message : String(totErr),
          };
        }
      }

      // Si `reinvertir=true`, ejecuta la reinversión automática usando el
      // total recalculado en Quetzales (`totalesRaw`), NO el `reinversion_total`
      // guardado en la liquidación — así la compra siempre refleja el estado
      // actual de los pagos/abonos. Importante: usamos `totalesRaw` (Q) y no
      // `totales` (que para inv en dólares ya viene convertido a USD).
      let reinversion: unknown = null;
      if (reinvertir) {
        const monto = Number((totalesRaw.totales as any).total_reinversion ?? 0);
        if (!monto || monto <= 0) {
          reinversion = { skipped: true, reason: "total_reinversion recalculado = 0", monto };
        } else {
          try {
            const r = await ejecutarReinversionAutomatica(Number(investor_id), monto);
            reinversion = {
              liquidacion_id: liquidacionId,
              inversionista_id: Number(investor_id),
              reinversion_total: monto,
              fuente_monto: "excel_recalculado",
              ...r,
            };
          } catch (reinvErr) {
            console.error(
              "[investor/reporte-liquidados] Error en reinversión automática:",
              reinvErr,
            );
            reinversion = {
              error: reinvErr instanceof Error ? reinvErr.message : String(reinvErr),
            };
          }
        }
      }

      return {
        success: true,
        url,
        filename,
        liquidacion: liquidacionActualizada || null,
        totales_actualizados: totalesActualizados,
        reinversion,
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
  // Ajustar pagos espejo + monto_aportado de un inversionista en una
  // liquidación específica. Soporta dry-run cuando hay compras del mes
  // que afectan el cálculo del monto_aportado.
  //
  // Body:
  //   inversionista_id: number
  //   liquidacion_id: number
  //   cambios: [{ credito_id, abono_capital?, abono_interes?, iva?,
  //               monto_aportado?, monto_aportado_forzado? }]
  //   force?: boolean         (saltar dry-run y aplicar)
  //   generar_reporte?: boolean (tras aplicar, generar Excel filtrado)
  // ──────────────────────────────────────────────
  .post("/investor/ajustar-pagos-liquidacion", async ({ body, set }) => {
    const parsed = body as {
      inversionista_id?: number;
      liquidacion_id?: number;
      cambios?: Array<{
        credito_id?: number;
        abono_capital?: number | null;
        abono_interes?: number | null;
        iva?: number | null;
        monto_aportado?: number | null;
        monto_aportado_forzado?: boolean;
      }>;
      force?: boolean;
      generar_reporte?: boolean;
    };

    if (!parsed.inversionista_id || isNaN(Number(parsed.inversionista_id))) {
      set.status = 400;
      return { message: "El parámetro 'inversionista_id' es obligatorio y debe ser numérico." };
    }
    if (!parsed.liquidacion_id || isNaN(Number(parsed.liquidacion_id))) {
      set.status = 400;
      return { message: "El parámetro 'liquidacion_id' es obligatorio y debe ser numérico." };
    }
    if (!Array.isArray(parsed.cambios) || parsed.cambios.length === 0) {
      set.status = 400;
      return { message: "El parámetro 'cambios' debe ser un arreglo no vacío." };
    }
    for (const [i, c] of parsed.cambios.entries()) {
      if (!c.credito_id || isNaN(Number(c.credito_id))) {
        set.status = 400;
        return { message: `cambios[${i}].credito_id es obligatorio y debe ser numérico.` };
      }
    }

    try {
      const result = await ajustarPagosLiquidacion({
        inversionista_id: Number(parsed.inversionista_id),
        liquidacion_id: Number(parsed.liquidacion_id),
        cambios: parsed.cambios.map((c) => ({
          credito_id: Number(c.credito_id),
          abono_capital: c.abono_capital ?? null,
          abono_interes: c.abono_interes ?? null,
          iva: c.iva ?? null,
          monto_aportado: c.monto_aportado ?? null,
          monto_aportado_forzado: c.monto_aportado_forzado === true,
        })),
        force: parsed.force === true,
        generar_reporte: parsed.generar_reporte === true,
      });

      const { status, ...payload } = result as any;
      set.status = status ?? 200;
      return payload;
    } catch (error) {
      console.error("[investor/ajustar-pagos-liquidacion] Error:", error);
      set.status = 500;
      return {
        success: false,
        message: "Error ajustando pagos de liquidación",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  })
  // ──────────────────────────────────────────────
  // BULK: ajustar-pagos-liquidacion en lote
  //
  // Recibe un array `items`, cada uno con la misma forma que el endpoint
  // single. Se procesan SECUENCIALMENTE con try/catch por item — si uno
  // falla, los demás siguen. Cada item maneja su propio dry-run y
  // generar_reporte de manera independiente.
  //
  // Body:
  //   items: [{
  //     inversionista_id, liquidacion_id, cambios: [...],
  //     force?, generar_reporte?
  //   }]
  //
  // Response:
  //   procesados: número total enviado
  //   exitosos:   cuántos terminaron con success=true
  //   fallidos:   cuántos lanzaron error
  //   dry_runs:   cuántos quedaron en dry-run
  //   resultados: [{ index, inversionista_id, liquidacion_id, result | error }]
  // ──────────────────────────────────────────────
  .post("/investor/ajustar-pagos-liquidacion/bulk", async ({ body, set }) => {
    type BulkItem = {
      inversionista_id?: number;
      liquidacion_id?: number;
      cambios?: Array<{
        credito_id?: number;
        abono_capital?: number | null;
        abono_interes?: number | null;
        iva?: number | null;
        monto_aportado?: number | null;
        monto_aportado_forzado?: boolean;
      }>;
      force?: boolean;
      generar_reporte?: boolean;
    };

    // Aceptar tanto un array directo como `{ items: [...] }`.
    const items: BulkItem[] = Array.isArray(body)
      ? (body as BulkItem[])
      : Array.isArray((body as any)?.items)
        ? ((body as any).items as BulkItem[])
        : [];
    const parsed = { items };

    if (parsed.items.length === 0) {
      set.status = 400;
      return {
        message:
          "El body debe ser un arreglo de items o `{ items: [...] }` no vacío.",
      };
    }

    const resultados: Array<{
      index: number;
      inversionista_id?: number;
      liquidacion_id?: number;
      success: boolean;
      result?: unknown;
      error?: string;
    }> = [];
    let exitosos = 0;
    let fallidos = 0;
    let dry_runs = 0;

    for (let i = 0; i < parsed.items.length; i++) {
      const item = parsed.items[i];

      // Validación liviana por item (no aborta el batch, marca el item como error)
      if (!item.inversionista_id || isNaN(Number(item.inversionista_id))) {
        resultados.push({
          index: i,
          success: false,
          error: "inversionista_id es obligatorio y debe ser numérico.",
        });
        fallidos++;
        continue;
      }
      if (!item.liquidacion_id || isNaN(Number(item.liquidacion_id))) {
        resultados.push({
          index: i,
          inversionista_id: Number(item.inversionista_id),
          success: false,
          error: "liquidacion_id es obligatorio y debe ser numérico.",
        });
        fallidos++;
        continue;
      }
      if (!Array.isArray(item.cambios) || item.cambios.length === 0) {
        resultados.push({
          index: i,
          inversionista_id: Number(item.inversionista_id),
          liquidacion_id: Number(item.liquidacion_id),
          success: false,
          error: "cambios debe ser un arreglo no vacío.",
        });
        fallidos++;
        continue;
      }

      try {
        const result = await ajustarPagosLiquidacion({
          inversionista_id: Number(item.inversionista_id),
          liquidacion_id: Number(item.liquidacion_id),
          cambios: item.cambios.map((c) => ({
            credito_id: Number(c.credito_id),
            abono_capital: c.abono_capital ?? null,
            abono_interes: c.abono_interes ?? null,
            iva: c.iva ?? null,
            monto_aportado: c.monto_aportado ?? null,
            monto_aportado_forzado: c.monto_aportado_forzado === true,
          })),
          force: item.force === true,
          generar_reporte: item.generar_reporte === true,
        });

        // El controller devuelve `status` con el código HTTP que correspondería
        // si fuera single. Lo usamos para clasificar pero no lo propagamos al
        // status del response del bulk (que siempre es 200 OK del batch).
        const { status, ...payload } = result as any;
        const ok = (payload as any).success === true;
        const isDry = (payload as any).dry_run === true;

        resultados.push({
          index: i,
          inversionista_id: Number(item.inversionista_id),
          liquidacion_id: Number(item.liquidacion_id),
          success: ok,
          result: payload,
        });

        if (ok) {
          exitosos++;
          if (isDry) dry_runs++;
        } else {
          fallidos++;
        }
      } catch (error) {
        console.error(
          `[investor/ajustar-pagos-liquidacion/bulk] Item ${i} (inv=${item.inversionista_id}, liq=${item.liquidacion_id}) falló:`,
          error,
        );
        resultados.push({
          index: i,
          inversionista_id: Number(item.inversionista_id),
          liquidacion_id: Number(item.liquidacion_id),
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
        fallidos++;
      }
    }

    // Generar Excel y guardarlo en disco (best-effort: si falla, no rompe la respuesta).
    let xlsx_path: string | null = null;
    let xlsx_error: string | undefined;
    try {
      xlsx_path = await armarYGuardarXlsxBulkAjuste(resultados);
    } catch (err) {
      console.error("[investor/ajustar-pagos-liquidacion/bulk] Error generando XLSX:", err);
      xlsx_error = err instanceof Error ? err.message : String(err);
    }

    set.status = 200;
    return {
      success: fallidos === 0,
      procesados: parsed.items.length,
      exitosos,
      fallidos,
      dry_runs,
      resultados,
      csv: armarCsvBulkAjuste(resultados),
      xlsx_path,
      ...(xlsx_error ? { xlsx_error } : {}),
    };
  })
  // ──────────────────────────────────────────────
  // Revertir una liquidación completa por liquidacion_id
  // Deshace: pagos espejo, monto_aportado, cuotas, boleta, snapshots del
  // histórico de liquidaciones espejo y la liquidación
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
  // ──────────────────────────────────────────────
  // Revierte las compras (tipo_operacion='reinversion') generadas por la
  // última liquidación de cada inversionista listado. Devuelve el monto a
  // CUBE en padre + espejo del mismo crédito, recalcula porcentajes y
  // cuotas, marca las compras como 'completado' y escribe un archivo de
  // log con los compra_ids afectados para borrarlos después si se decide.
  // Body: { "inversionista_ids": number[] }
  // ──────────────────────────────────────────────
  .post(
    "/investor/revertir-compras-ultima-liquidacion",
    async ({ body, set }) => {
      const { inversionista_ids } = body as {
        inversionista_ids?: unknown;
      };

      if (
        !Array.isArray(inversionista_ids) ||
        inversionista_ids.length === 0 ||
        !inversionista_ids.every((id) => Number.isFinite(Number(id)))
      ) {
        set.status = 400;
        return {
          message:
            "El parámetro 'inversionista_ids' es obligatorio y debe ser un array de números no vacío.",
        };
      }

      try {
        const ids = inversionista_ids.map((id) => Number(id));
        const result = await revertirComprasUltimaLiquidacion(ids);
        return result;
      } catch (error) {
        console.error(
          "[investor/revertir-compras-ultima-liquidacion] Error:",
          error,
        );
        set.status = 500;
        return {
          message: "Error al revertir las compras de la última liquidación",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  )
  .get(
    "/resumen-transferencias",
    async ({ query, set }) => {
      const { mes, anio, ach, moneda } = query;

      const mesNum = Number(mes);
      const anioNum = Number(anio);

      if (!Number.isFinite(mesNum) || mesNum < 1 || mesNum > 12) {
        set.status = 400;
        return { message: "El parámetro 'mes' es obligatorio y debe estar entre 1 y 12." };
      }
      if (!Number.isFinite(anioNum) || anioNum < 2000) {
        set.status = 400;
        return { message: "El parámetro 'anio' es obligatorio y debe ser un año válido." };
      }

      let monedaFiltro: "quetzales" | "dolar" | "todas" = "todas";
      if (moneda === "quetzales" || moneda === "dolar") {
        monedaFiltro = moneda;
      } else if (moneda) {
        set.status = 400;
        return { message: "El parámetro 'moneda' debe ser 'quetzales' o 'dolar'." };
      }

      try {
        return await resumenTransferencias(mesNum, anioNum, ach === "true", monedaFiltro);
      } catch (error) {
        console.error("[investor/resumen-transferencias] Error:", error);
        set.status = 500;
        return {
          message: "Error al generar el reporte de transferencias",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    {
      query: t.Object({
        mes: t.String(),
        anio: t.String(),
        ach: t.Optional(t.String()),
        moneda: t.Optional(t.String()),
      }),
    }
  )
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
      const { inversionistaId, mes, anio, estado = "pending", excel, incluirSinMovimiento } = query;
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
        excel === "true",
        incluirSinMovimiento === "true"
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
        incluirSinMovimiento: t.Optional(t.String()),
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
        fecha_liquidacion: t.Optional(t.String()),
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
        const { inversionistaId, fecha_calculo } = body;

        console.log(
          `\n🚀 POST /calcularPagosEspejo → inversionistaId: ${inversionistaId}, fecha_calculo: ${fecha_calculo ?? "no enviada"}`
        );

        const fechaCalculoDate = fecha_calculo ? new Date(fecha_calculo) : undefined;
        const resultado = await calcularYRegistrarPagosEspejo(inversionistaId, fechaCalculoDate);

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
          totalCreditosFallidos: (resultado as any).totalCreditosFallidos ?? 0,
          data: resultado.data,
          fallidos: (resultado as any).fallidos ?? [],
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
        fecha_calculo: t.Optional(t.String({
          description: "Fecha ISO del período de cálculo (YYYY-MM-DD). Determina periodoMes/periodoAnio para la validación del histórico.",
        })),
      }),
      response: {
        200: t.Object({
          success: t.Literal(true),
          message: t.String(),
          inversionistaId: t.Number(),
          totalCreditosProcesados: t.Number(),
          totalCreditosFallidos: t.Number(),
          data: t.Array(t.Any()),
          fallidos: t.Array(t.Object({
            creditoId: t.Number(),
            numeroCreditoSifco: t.String(),
            mensaje: t.String(),
          })),
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
    async ({ set, query }) => {
      try {
        const page = Number(query.page) || 1;
        const pageSize = Number(query.pageSize) || 10;
        const search = query.search || undefined;
        const inversionistaId = query.inversionista_id
          ? Number(query.inversionista_id)
          : undefined;
        const statuses = query.statuses || undefined;

        const result = await getCreditosEspejoPendientes(
          page,
          pageSize,
          search,
          inversionistaId,
          statuses
        );
        return result;
      } catch (error: any) {
        console.error("[GET /creditos-espejo-pendientes] Error:", error);
        set.status = 500;
        return { message: error.message || "Error al obtener créditos espejo pendientes" };
      }
    },
    {
      query: t.Object({
        page: t.Optional(t.String()),
        pageSize: t.Optional(t.String()),
        search: t.Optional(t.String()),
        inversionista_id: t.Optional(t.String()),
        statuses: t.Optional(t.String()),
      }),
      detail: {
        summary: "Créditos espejo pendientes agrupados por inversionista (paginado)",
        description:
          "Devuelve los créditos espejo con status pendiente_reinversion, pendiente_compra_cartera " +
          "o pendiente_revision, agrupados por inversionista. Soporta paginación (page, pageSize), " +
          "búsqueda por nombre (search), filtro por inversionista_id y filtro por statuses (coma separada).",
        tags: ["Inversionistas", "Espejos"],
      },
    }
  )
  .get(
    "/inversionistas/:id/simulacion",
    async ({ params, query, set }) => {
      const inversionista_id = Number(params.id);
      if (isNaN(inversionista_id) || inversionista_id < 1) {
        set.status = 400;
        return {
          success: false,
          message: "El parámetro 'id' debe ser un número entero positivo.",
        };
      }
      const mes = query.mes ? Number(query.mes) : undefined;
      const anio = query.anio ? Number(query.anio) : undefined;
      const mesLiquidacion =
        mes && anio && mes >= 1 && mes <= 12 ? { mes, anio } : undefined;
      try {
        const result = await simularInversionista(inversionista_id, mesLiquidacion);
        set.status = 200;
        return { success: true, data: result };
      } catch (error) {
        console.error(`[GET /inversionistas/${params.id}/simulacion] Error:`, error);
        const msg = error instanceof Error ? error.message : String(error);
        set.status = msg.includes("no encontrado") ? 404 : 500;
        return { success: false, message: msg };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      query: t.Object({
        mes: t.Optional(t.String()),
        anio: t.Optional(t.String()),
      }),
      detail: {
        summary: "Simula pagos futuros de un inversionista sobre sus créditos activos",
        description:
          "Proyecta las cuotas no pagadas de los créditos ACTIVOS del inversionista. " +
          "Con ?mes=M&anio=A filtra a la cuota de ese mes específico por crédito. " +
          "Calcula: abono_capital, abono_interes, IVA (12%), ISR (7%), monto_neto y flags de reinversión. " +
          "Solo lectura — no modifica la base de datos.",
        tags: ["Inversionistas"],
      },
    }
  );
