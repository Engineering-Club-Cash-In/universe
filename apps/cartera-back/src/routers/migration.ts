// routes/sifco.ts
import { Elysia, t } from "elysia";
import { fillPagosInversionistas, fillPagosInversionistasV2, mapPagosPorCreditos, syncClienteConPrestamos } from "../migration/migration";
 
import path from "path";
import { leerCreditoPorNumeroSIFCO } from "../services/excel";
import { authMiddleware } from "./midleware";
import { listarCreditosConDetalle, procesarCreditoIndividual } from "../migration/migrationCredits";
import z from "zod";
import { procesarCreditosMora } from "../migration/migrationLateFee";
import { liquidarCuotasPorUsuario } from "../controllers/liquidateInvestor";
import { procesarInversionistasSoloExcel } from "../controllers/migrateInvestor";
// ✅ Schema para sync de pagos desde SIFCO (param opcional)
const syncCreditPaymentsSchema = z.object({
  numero_credito_sifco: z.string().min(1).optional(),
});
const ExcelCreditoRowSchema = t.Object({
  Fecha: t.String(),
  CreditoSIFCO: t.String(),
  Numero: t.Number(),
  Nombre: t.String(),
  Capital: t.String(),
  porcentaje: t.String(),
  Cuotas: t.String(),
  DeudaQ: t.String(),
  IVA12: t.String(),
  PorcentajeCashIn: t.String(),
  PorcentajeInversionista: t.String(),
  CuotaCashIn: t.String(),
  IVACashIn: t.String(),
  CuotaInversionista: t.String(),
  IVAInversionista: t.String(),
  Seguro10Cuotas: t.String(),
  GPS: t.String(),
  AbonoCapital: t.String(),
  AbonoInteres: t.String(),
  AbonoIVA12: t.String(),
  AbonoInteresCI: t.String(),
  AbonoIVACI: t.String(),
  AbonoSeguro: t.String(),
  AbonoGPS: t.String(),
  PagoDelMes: t.String(),
  CapitalRestante: t.String(),
  InteresRestante: t.String(),
  IVA12Restante: t.String(),
  SeguroRestante: t.String(),
  GPSRestante: t.String(),
  TotalRestante: t.String(),
  Llamada: t.String(),
  Pago: t.String(),
  NIT: t.String(),
  Categoria: t.String(),
  Inversionista: t.String(),
  Observaciones: t.String(),
  Cuota: t.String(),
  MontoBoleta: t.String(),
  FechaFiltro: t.String(),
  NumeroPoliza: t.String(),
  ComisionVenta: t.String(),
  AcumuladoComisionVenta: t.String(),
  ComisionesMesCashIn: t.String(),
  ComisionesCobradasMesCashIn: t.String(),
  AcumuladoComisionesCashIn: t.String(),
  AcumuladoComisionesCobradasCashIn: t.String(),
  RenuevoONuevo: t.String(),
  CapitalNuevosCreditos: t.String(),
  PorcentajeRoyalty: t.String(),
  Royalty: t.String(),
  USRoyalty: t.String(),
  Membresias: t.String(),
  MembresiasPago: t.String(),
  GastosMes: t.String(),
  UtilidadMes: t.String(),
  UtilidadAcumulada: t.String(),
  ComoSeEntero: t.String(),
  MembresiasDelMes: t.String(),
  MembresiasDelMesCobradas: t.String(),
  MembresiasAcumulado: t.String(),
  Asesor: t.String(),
  Otros: t.String(),
  Mora: t.String(),
  MontoBoletaCuota: t.String(),
  Plazo: t.String(),
  Seguro: t.String(),
  FormatoCredito: t.String(),
  Pagado: t.String(),
  Facturacion: t.String(),
  MesPagado: t.String(),
  SeguroFacturado: t.String(),
  GPSFacturado: t.String(),
  Reserva: t.String(),
});

const CreditoAgrupadoSchema = t.Object({
  creditoBase: t.String(),
  cliente: t.String(),
  filas: t.Array(ExcelCreditoRowSchema),
});
/**
 * 📂 Ruta absoluta del Excel en tu máquina
 * ⚠️ para producción deberías meterlo en un bucket o carpeta compartida
 */
const excelPath = path.resolve(
  "C:/Users/Kelvin Palacios/Documents/analis de datos/octubre2025.csv"
);
const csvMoraPath = path.resolve(
  "C:/Users/Kelvin Palacios/Documents/analis de datos/moraGeneral.csv"
);
export const sifcoRouter = new Elysia()
 
  /**
   * 🔄 Sincronizar cliente(s) con préstamos desde SIFCO
   */
  .get(
    "/syncClienteConPrestamos",
    async ({ query, set }) => {
      try {
        const { clienteCodigo } = query as Record<string, string | undefined>;
        const codigoParsed = clienteCodigo ? Number(clienteCodigo) : undefined;

        if (clienteCodigo && isNaN(codigoParsed!)) {
          set.status = 400;
          return { success: false, error: "El parámetro 'clienteCodigo' debe ser numérico." };
        }

        const result = await syncClienteConPrestamos(codigoParsed);
        console.log(result)

        set.status = 200;
        return {
          success: true,
          message: codigoParsed
            ? `Flujo ejecutado para cliente ${codigoParsed}`
            : "Flujo ejecutado para el primer cliente encontrado",
          data: result,
        };
      } catch (error: any) {
        console.error("❌ Error en /syncClienteConPrestamos:", error);
        set.status = 500;
        return {
          success: false,
          error: error.message || String(error),
        };
      }
    },
    {
      detail: {
        summary: "Sincroniza clientes desde SIFCO y obtiene sus créditos",
        tags: ["SIFCO"],
      },
      query: t.Object({
        clienteCodigo: t.Optional(t.String()),
      }),
    }
  )
  /**aaaaa
   * 📊 Consultar crédito en Excel por # crédito SIFCO qqqqqqqqq
   */
  .get(
    "/excel/credito",
    async ({ query, set }) => {
      try {
        const { numeroCredito } = query as Record<string, string | undefined>;

        if (!numeroCredito) {
          set.status = 400;
          return { success: false, error: "El parámetro 'numeroCredito' es requerido." };
        }

        console.log("🚀 Iniciando búsqueda de crédito en Excel...");
        const row = leerCreditoPorNumeroSIFCO(excelPath, numeroCredito);

        if (!row) {
          set.status = 404;
          return { success: false, error: `No se encontró crédito ${numeroCredito}` };
        }

        set.status = 200;
        return { success: true, data: row };
      } catch (error: any) {
        console.error("❌ Error en /excel/credito:", error);
        set.status = 500;
        return { success: false, error: error.message || String(error) };
      }
    },
    {
      detail: {
        summary: "Busca un crédito en el Excel local por # crédito SIFCO",
        tags: ["Excel", "Migración"],
      },
      query: t.Object({
        numeroCredito: t.String(),
      }),
    }
  ) /**
   * 🔄 Sincronizar inversionistas de un crédito desde Excel
   */
.get(
  "/migrate/investors",
  async ({ query, set }) => {
    try {
      const { numeroCredito } = query as Record<string, string | undefined>;

      console.log(
        numeroCredito
          ? `🚀 Buscando inversionistas para crédito SIFCO=${numeroCredito}`
          : "🚀 Sincronizando inversionistas para TODOS los créditos"
      );

      // 1. Ejecutar flujo centralizado
      await fillPagosInversionistas(numeroCredito);

      set.status = 200;
      return {
        success: true,
        message: numeroCredito
          ? `Inversionistas sincronizados para crédito ${numeroCredito}`
          : "Inversionistas sincronizados para TODOS los créditos",
      };
    } catch (error: any) {
      console.error("❌ Error en /excel/inversionistas:", error);
      set.status = 500;
      return {
        success: false,
        error: error.message || String(error),
      };
    }
  },
  {
    detail: {
      summary: "Sincroniza inversionistas desde Excel local",
      tags: ["Excel", "Inversionistas", "Migración"],
    },
    query: t.Object({
      numeroCredito: t.Optional(t.String()),
    }),
  }
)  /**
   * 📊 Sincronizar TODOS los créditos del Excel con detalle en SIFCO
   */
  .get(
    "/sync/creditos/detalle",
    async ({ set }) => {
      try {
        console.log("🚀 Iniciando sincronización masiva de créditos con detalle...");
        const result = await listarCreditosConDetalle(excelPath);

        set.status = 200;
        return {
          success: true,
          message: `Se procesaron ${result.length} créditos desde el Excel`,
          data: result,
        };
      } catch (error: any) {
        console.error("❌ Error en /excel/creditos/detalle:", error);
        set.status = 500;
        return { success: false, error: error.message || String(error) };
      }
    },
    {
      detail: {
        summary: "Sincroniza TODOS los créditos del Excel con detalle desde SIFCO",
        tags: ["Excel", "Créditos", "Migración"],
      },
    }
  )  // 🆕🛠️ Endpoint para sincronizar/mappear pagos de créditos desde SIFCO
  // - Si envías `numero_credito_sifco`, procesa solo ese crédito.
  // - Si NO envías nada, procesa todos los créditos en DB.
  .post(
    "/sync-credit-payments",
    async ({ body, set }) => {
      try {
        /** Validate body with Zod (numero_credito_sifco es opcional) */
        const { numero_credito_sifco } = syncCreditPaymentsSchema.parse(body ?? {});

        console.log(
          `[sync-credit-payments] Inicio${
            numero_credito_sifco ? ` (SIFCO=${numero_credito_sifco})` : " (todos los créditos)"
          }`
        );

        // Llamamos al servicio principal que:
        // - Busca en DB (Drizzle)
        // - Consulta estado de cuenta
        // - Invoca mapEstadoCuentaToPagosBig por cada crédito
        const summary = await mapPagosPorCreditos(numero_credito_sifco);

        // Tip: si tu servicio no retorna nada, puedes devolver un mensaje genérico
        set.status = 200;
        return {
          ok: true,
          message: numero_credito_sifco
            ? `Sincronización completada para crédito SIFCO=${numero_credito_sifco}`
            : "Sincronización completada para todos los créditos",
          summary: summary ?? null, // si tu servicio devuelve { ok, fail, total }
        };
      } catch (error: any) {
        console.log("[ERROR] /sync-credit-payments:", error?.message || error);
        set.status = 400;
        return {
          ok: false,
          message: "Failed to sync credit payments",
          error: error?.message ?? String(error),
        };
      }
    },
    {
      detail: {
        summary: "Sincroniza y mapea pagos de créditos desde SIFCO",
        tags: ["Pagos", "Sync"],
      },
    }
  ).post(
  "/sync-creditos-mora",
  async ({ set }) => {
    try {
      console.log("[sync-creditos-mora] Iniciando procesamiento de mora...");

      // Procesamos el CSV y actualizamos créditos
      const resultado = await procesarCreditosMora(csvMoraPath);

      set.status = 200;
      return {
        ok: true,
        message: "Procesamiento de créditos en mora completado",
        summary: {
          procesados: resultado.procesados,
          errores: resultado.errores,
          total: resultado.procesados + resultado.errores
        },
        detalles: resultado.detalles
      };
    } catch (error: any) {
      console.error("[ERROR] /sync-creditos-mora:", error?.message || error);
      set.status = 500;
      return {
        ok: false,
        message: "Error al procesar créditos en mora",
        error: error?.message ?? String(error),
      };
    }
  },
  {
    detail: {
      summary: "Procesa y actualiza créditos en mora desde CSV",
      tags: ["Mora", "Sync"],
    },
  }
)
.post(
    "/liquidar-cuotas",
    async ({ body, set }) => {
      try {
        console.log("[liquidar-cuotas] Iniciando liquidación...");
        console.log("[liquidar-cuotas] Body recibido:", JSON.stringify(body, null, 2));

        let { nombre_usuario, cuota_mes, capital, nombre_inversionista } = body;

        // 🔥 VALIDACIONES BÁSICAS
        if (!nombre_usuario || nombre_usuario.trim() === '') {
          set.status = 400;
          return {
            success: false,
            message: "❌ nombre_usuario es requerido",
            error: "Nombre de usuario vacío"
          };
        }

        if (!cuota_mes || cuota_mes.trim() === '') {
          set.status = 400;
          return {
            success: false,
            message: "❌ cuota_mes es requerido",
            error: "Cuota mes vacía"
          };
        }

        // 🔥 VALIDAR CAPITAL (CRÍTICO)
        if (capital === undefined || capital === null) {
          console.error(`❌ Capital no recibido. Body:`, body);
          set.status = 400;
          return {
            success: false,
            message: "❌ capital es requerido",
            error: "Capital no enviado"
          };
        }

        // 🔥 CONVERTIR CAPITAL A NÚMERO SI VIENE COMO STRING
        let capitalNumerico: number;
        try {
          capitalNumerico = typeof capital === 'string' ? parseFloat(capital) : capital;
        } catch (err) {
          set.status = 400;
          return {
            success: false,
            message: "❌ capital debe ser un número válido",
            error: "Capital inválido"
          };
        }

        // 🆕 VALIDAR QUE CAPITAL SEA >= 0 (AHORA ACEPTA 0)
        if (isNaN(capitalNumerico) || capitalNumerico < 0) {
          console.error(`❌ Capital inválido: ${capital} (tipo: ${typeof capital}, parseado: ${capitalNumerico})`);
          set.status = 400;
          return {
            success: false,
            message: `❌ El capital debe ser mayor o igual a 0 (recibido: ${capital})`,
            error: "Capital inválido"
          };
        }

        // 🆕 LOG SI EL CAPITAL ES 0
        if (capitalNumerico === 0) {
          console.log(`⚠️ Capital en 0 para ${nombre_usuario} - Se procesará con valores en 0`);
        } else {
          console.log(`✅ Capital válido recibido: ${capitalNumerico}`);
        }

        if (!nombre_inversionista || nombre_inversionista.trim() === '') {
          set.status = 400;
          return {
            success: false,
            message: "❌ nombre_inversionista es requerido",
            error: "Nombre de inversionista vacío"
          };
        }

        // 🆕 NORMALIZAR FORMATO DE MES
        cuota_mes = cuota_mes.trim();
        
        // Si tiene formato "nov.25" o "nov25" (sin espacio), agregar espacio
        if (/^[a-zA-Z]{3}\.?\d{2,4}$/.test(cuota_mes)) {
          const match = cuota_mes.match(/^([a-zA-Z]{3})\.?(\d{2,4})$/);
          if (match) {
            const mesOriginal = cuota_mes;
            cuota_mes = `${match[1]}. ${match[2]}`;
            console.log(`🔧 Formato de mes corregido: "${mesOriginal}" → "${cuota_mes}"`);
          }
        }

        // Validar formato básico del mes
        if (cuota_mes.length < 4) {
          set.status = 400;
          return {
            success: false,
            message: "❌ cuota_mes debe tener formato válido (ej: 'oct. 25')",
            error: "Formato de mes inválido"
          };
        }

        // 🔥 LLAMAR AL SERVICIO CON LOS 4 PARÁMETROS
        const resultado = await liquidarCuotasPorUsuario({
          nombre_usuario,
          cuota_mes,
          capital: capitalNumerico, // 🔥 CONVERTIDO A NÚMERO
          nombre_inversionista,
        });

        if (resultado.success) {
          set.status = 200;
          return resultado;
        } else {
          set.status = 400;
          return resultado;
        }
      } catch (error: any) {
        console.error("[ERROR] /liquidar-cuotas:", error?.message || error);
        console.error("[ERROR] Stack:", error?.stack);
        set.status = 500;
        return {
          success: false,
          message: "Error al procesar liquidación de cuotas",
          error: error?.message ?? String(error),
          stack: error?.stack
        };
      }
    },
    {
      detail: {
        summary: "Liquida cuotas de créditos con capital e inversionista",
        tags: ["Liquidaciones"],
        description: "Busca la cuota que vence en el mes especificado, marca como liquidadas todas las cuotas hasta esa, y actualiza el capital del inversionista en ese crédito. Acepta capital = 0.",
      },
      body: t.Object({
        nombre_usuario: t.String({
          description: "Nombre del usuario (búsqueda flexible)",
          examples: ["Christopher Miguel", "Fernando Alfonso", "Juan Pérez"],
        }),
        cuota_mes: t.String({
          description: "Mes y año de la cuota a liquidar. Acepta formatos: 'oct. 25', 'oct.25', 'oct 25'",
          examples: ["oct. 25", "ago. 25", "sep. 25", "nov. 24", "nov.25"],
          pattern: "^[a-zA-Z]{3}\\.?\\s*\\d{2,4}$",
        }),
        capital: t.Number({
          description: "Capital a aplicar al inversionista (puede ser 0 para actualizar con valores en 0)",
          examples: [55938.46, 42109.69, 103310.43, 0],
          minimum: 0, // 🆕 CAMBIO: Ahora acepta desde 0
        }),
        nombre_inversionista: t.String({
          description: "Nombre del inversionista (búsqueda flexible)",
          examples: ["Anna Lisseth Lorenzo Rodas", "Alexa Nahomy Caballero Pinto", "Alexander Kachler"],
        }),
      }),
    }
  ).post(
  "/pagos-inversionistas/v2",
  async ({ body }) => {
    const { numeroCredito, inversionistasData } = body;

    // Transform inversionistasData to match expected type
    const inversionistasDataTyped = inversionistasData.map((inv) => ({
      inversionista: inv.inversionista,
      capital: inv.capital,
      porcentajeCashIn: inv.porcentajeCashIn,
      porcentajeInversionista: inv.porcentajeInversionista,
      porcentaje: inv.porcentaje,
      cuota: inv.cuota !== undefined ? inv.cuota as string | number : undefined,
      cuotaInversionista: inv.cuotaInversionista !== undefined ? inv.cuotaInversionista as string | number : undefined,
    }));

    const resultado = await fillPagosInversionistasV2(
      numeroCredito,
      inversionistasDataTyped
    );

    return resultado;
  },
  {
    body: t.Object({
      numeroCredito: t.String({
        description: "Número del crédito SIFCO",
        examples: ["01010214116560"]
      }),
      inversionistasData: t.Array(
        t.Object({
          inversionista: t.String({
            description: "Nombre del inversionista",
            examples: ["Pedro Piox Piox", "Cube Investments S.A.", "Adriana Bahaia"]
          }),
          capital: t.Union([t.String(), t.Number()], {
            description: "Capital aportado por el inversionista",
            examples: ["269354.80", 269354.80]
          }),
          porcentajeCashIn: t.Union([t.String(), t.Number()], {
            description: "Porcentaje de participación de Cash-In (0.0 a 1.0)",
            examples: ["1.00", 1.0, "0.30", 0.3]
          }),
          porcentajeInversionista: t.Union([t.String(), t.Number()], {
            description: "Porcentaje de participación del inversionista (0.0 a 1.0)",
            examples: ["0.00", 0.0, "0.70", 0.7]
          }),
          porcentaje: t.Union([t.String(), t.Number()], {
            description: "Porcentaje de interés (tasa) aplicable",
            examples: ["0.015", 0.015, "1.50%"]
          }),
          cuota: t.Optional(t.Union([t.String(), t.Number()], {
            description: "Cuota total calculada (opcional)",
            examples: ["8132.48", 8132.48]
          })),
          cuotaInversionista: t.Optional(t.Union([t.String(), t.Number()], {
            description: "Cuota específica del inversionista (opcional)",
            examples: ["0", 0, "5692.74"]
          })),
        }),
        {
          description: "Array de inversionistas con sus datos de participación",
          minItems: 1
        }
      ),
    }),
    detail: {
      summary: "Procesar pagos de inversionistas",
      tags: ["Pagos Inversionistas"],
      description: `
        Procesa y registra los pagos/participaciones de inversionistas para un crédito específico.
        
        **Características:**
        - Búsqueda permisiva de inversionistas (normaliza nombres, quita acentos, ignora mayúsculas)
        - Cálculo automático de montos e IVA
        - Upsert: actualiza si ya existe, crea si es nuevo
        - Logs detallados para debugging
        
        **Notas:**
        - Los porcentajes deben sumar 1.0 (100%) entre porcentajeCashIn y porcentajeInversionista
        - El sistema normalizará automáticamente nombres como "S.A.", "C.A.", espacios, acentos, etc.
      `
    }
  }
)
  .post(
    "/processUniqueCredit",
    async ({ body, set }) => {
      try {
        console.log(`📥 Recibiendo crédito: ${body.credito.creditoBase}`);
        
        const resultado = await procesarCreditoIndividual(body.credito);
        
        if (!resultado.success) {
          set.status = 400;
          return resultado;
        }
        
        return resultado;
        
      } catch (error: any) {
        set.status = 500;
        return {
          success: false,
          error: error.message || "Error interno del servidor",
        };
      }
    },
    {
      body: t.Object({
        credito: CreditoAgrupadoSchema,
      }),
      detail: {
        summary: "Procesar un crédito individual",
        description: "Recibe un objeto CreditoAgrupado y lo procesa: consulta SIFCO, mapea y guarda en DB",
        tags: ["Créditos"],
      },
    }
  ).post(
  "/processInvestorsOnly",
  async ({ body, set }) => {
    try {
      console.log(`\n📥 ========== RECIBIENDO SOLICITUD ==========`);
      console.log(`📋 Crédito: ${body.credito.creditoBase}`);
      console.log(`👥 Filas: ${body.credito.filas.length}`);

      const resultado = await procesarInversionistasSoloExcel(body.credito);

      if (!resultado.success) {
        set.status = 400;
        return resultado;
      }

      return resultado;

    } catch (error: any) {
      console.error("❌ Error en endpoint:", error);
      set.status = 500;
      return {
        success: false,
        error: error.message || "Error interno del servidor",
      };
    }
  },
  {
    body: t.Object({
      credito: t.Object({
        creditoBase: t.String(),
        cliente: t.String(),
        filas: t.Array(t.Any()),
      }),
    }),
    detail: {
      summary: "Procesar inversionistas desde Excel",
      description: "Recibe datos de Excel, busca el crédito en BD, borra inversionistas viejos e inserta los nuevos",
      tags: ["Inversionistas"],
    },
  }
);