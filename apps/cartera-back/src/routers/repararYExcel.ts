import { Elysia, t } from "elysia";
import path from "path";
import { sifcoDb } from "../database/sifco";
import { estado_cuenta_transacciones } from "../database/sifco/schema";
import { eq, asc } from "drizzle-orm";
import { repararTotalRestante } from "../controllers/updateCredit";
import { exportPagosToExcel } from "../controllers/reports";

const PYTHON_SCRIPT_PATH = path.join(
  process.cwd(),
  "scripts",
  "buscar_capital_excel_cartera.py",
);

interface ExcelLookupResult {
  capital_inicial: number;
  fuente: "directo" | "calculado";
  primera_cuota_excel: number;
  primera_hoja: string;
  capital_primera_aparicion: number;
  cuota_fija: number | null;
  fijos: number | null;
  nombre_cliente: string | null;
}

/**
 * Invoca el script Python que busca el crédito en el Excel histórico de cartera.
 * Si el crédito aparece desde cuota 0/1, devuelve ese capital directo.
 * Si aparece desde cuota > 1, lo calcula retrocediendo con la cuota fija inferida.
 * Devuelve null si el crédito no está en el Excel o si hay cualquier error.
 */
async function obtenerCapitalDesdeExcel(
  numero_sifco: string,
): Promise<ExcelLookupResult | null> {
  try {
    const proc = Bun.spawn(
      ["python3", PYTHON_SCRIPT_PATH, numero_sifco, "--json"],
      {
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      console.log(
        `📊 Excel lookup falló (exit=${exitCode}): ${stderr || stdout}`,
      );
      return null;
    }

    const parsed = JSON.parse(stdout.trim());
    if (parsed.error) {
      console.log(`📊 Excel lookup: ${parsed.error}`);
      return null;
    }
    if (typeof parsed.capital_inicial !== "number" || !(parsed.capital_inicial > 0)) {
      console.log(`📊 Excel lookup devolvió capital inválido: ${parsed.capital_inicial}`);
      return null;
    }

    return parsed as ExcelLookupResult;
  } catch (e) {
    console.error("📊 Error invocando script Excel:", e);
    return null;
  }
}

export const repararYExcelRouter = new Elysia().post(
  "/reparar-y-excel",
  async ({ body, set }: any) => {
    const { numero_credito_sifco, capital_inicial: capitalInicialParam } = body;

    let capital_inicial: number;
    let fuente_capital: string;
    let detalle_excel: ExcelLookupResult | null = null;

    if (capitalInicialParam !== undefined && capitalInicialParam !== null) {
      // Prioridad 1: param explícito
      capital_inicial = Number(capitalInicialParam);
      fuente_capital = "param";

      if (!(capital_inicial > 0)) {
        set.status = 400;
        return {
          success: false,
          error: `capital_inicial inválido: ${capitalInicialParam}`,
        };
      }
    } else {
      // Prioridad 2: Excel histórico (vía script Python)
      console.log(`📊 Buscando capital en Excel para ${numero_credito_sifco}...`);
      const excelResult = await obtenerCapitalDesdeExcel(numero_credito_sifco);

      if (excelResult) {
        capital_inicial = excelResult.capital_inicial;
        fuente_capital = `excel:${excelResult.fuente}`;
        detalle_excel = excelResult;
      } else {
        // Prioridad 3: SIFCO como fallback
        console.log(`📊 Excel no devolvió capital, fallback a SIFCO...`);
        if (!sifcoDb) {
          set.status = 500;
          return { success: false, error: "SIFCO_DB_URL no configurada" };
        }

        const transacciones = await sifcoDb
          .select({
            capital_desembolsado: estado_cuenta_transacciones.capital_desembolsado,
            saldo_capital: estado_cuenta_transacciones.saldo_capital,
            trx_descripcion: estado_cuenta_transacciones.trx_descripcion,
          })
          .from(estado_cuenta_transacciones)
          .where(eq(estado_cuenta_transacciones.pre_numero, numero_credito_sifco))
          .orderBy(asc(estado_cuenta_transacciones.fecha_valor));

        if (!transacciones.length) {
          set.status = 404;
          return {
            success: false,
            error: `Crédito ${numero_credito_sifco} no está en el Excel ni en SIFCO`,
          };
        }

        const primerRegistro = transacciones[0];
        const capitalDesembolsado = Number(primerRegistro.capital_desembolsado ?? 0);
        const saldoCapitalFallback = Number(primerRegistro.saldo_capital ?? 0);

        capital_inicial =
          capitalDesembolsado > 0 ? capitalDesembolsado : saldoCapitalFallback;
        fuente_capital =
          capitalDesembolsado > 0
            ? "sifco:capital_desembolsado"
            : "sifco:saldo_capital";

        if (capital_inicial <= 0) {
          set.status = 400;
          return {
            success: false,
            error: `No se pudo determinar capital inicial para ${numero_credito_sifco}`,
          };
        }
      }
    }

    console.log(
      `\n🔄 reparar-y-excel: ${numero_credito_sifco} | capital_inicial=${capital_inicial} (fuente: ${fuente_capital})`,
    );

    const repararResult = await repararTotalRestante({
      numero_credito_sifco,
      capital_inicial,
      dry_run: false,
    });

    const excelReportResult = await exportPagosToExcel(numero_credito_sifco);

    set.status = 200;
    return {
      success: true,
      capital_inicial,
      fuente_capital,
      detalle_excel,
      reparacion: {
        credito_id: repararResult.credito_id,
        capital_arranque: repararResult.capital_arranque,
        ultima_cuota_pagada: repararResult.ultima_cuota_pagada,
        pagos_actualizados: repararResult.pagos_actualizados,
      },
      excelUrl: excelReportResult.excelUrl,
    };
  },
  {
    body: t.Object({
      numero_credito_sifco: t.String({ minLength: 1 }),
      capital_inicial: t.Optional(t.Union([t.Number(), t.String()])),
    }),
    detail: {
      summary: "Reparar pagos y generar estado de cuenta Excel",
      description:
        "Prioridad para capital_inicial: 1) param explícito, 2) Excel histórico de cartera (script Python), 3) SIFCO como fallback. Luego repara los pagos históricos y genera el reporte Excel.",
      tags: ["Créditos"],
    },
  },
);
