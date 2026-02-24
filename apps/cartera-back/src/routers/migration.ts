// routes/sifco.ts
import { Elysia, t } from "elysia";
import { fillPagosInversionistas, fillPagosInversionistasV2, mapPagosPorCreditos, syncClienteConPrestamos } from "../migration/migration";
 
import path from "path";
import { leerCreditoPorNumeroSIFCO } from "../services/excel";
import { authMiddleware } from "./midleware";
import { listarCreditosConDetalle, procesarCreditoIndividual } from "../migration/migrationCredits";
import z from "zod";
import { procesarCreditosMora } from "../migration/migrationLateFee";
import { liquidarCuotasBatchInteligente, marcarLiquidadoInversionistasPorNombre } from "../controllers/liquidateInvestor";
import { procesarInversionistasSoloExcel } from "../controllers/migrateInvestor";

const LiquidacionBatchItemSchema = t.Object({
  nombre_usuario: t.String({ minLength: 1 }),
  cuota_mes: t.String({ minLength: 1 }),
  capital: t.Number({ minimum: 0 }),
  meses_en_credito: t.Optional(t.Union([t.Number(), t.Null()])),  // 🔥 NUEVO CAMPO OPCIONAL
  porcentaje_inversor: t.Optional(t.Number())  // 🔥 NUEVO CAMPO OPCIONAL
});

const LiquidacionBatchSchema = t.Object({
  nombre_inversionista: t.String({ minLength: 1 }),
  liquidaciones: t.Array(LiquidacionBatchItemSchema, { minItems: 1 })
});
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
      
      // 🔥 NUEVO: Detectar modo interactivo
      const modoInteractivo = body.modo_interactivo ?? false;
      const umbralSimilitud = body.umbral_similitud ?? 70;
      const decisionesUsuario = body.decisiones_usuario ?? [];
      
      if (modoInteractivo) {
        console.log(`🎯 Modo interactivo activado (umbral: ${umbralSimilitud}%)`);
      }
      
      if (decisionesUsuario.length > 0) {
        console.log(`👤 Decisiones del usuario recibidas: ${decisionesUsuario.length}`);
        decisionesUsuario.forEach((d: any) => {
          console.log(`   - ${d.nombre_excel} → ID ${d.decision}`);
        });
      }

      const resultado = await procesarInversionistasSoloExcel(body.credito, {
        modo_interactivo: modoInteractivo,
        umbral_similitud: umbralSimilitud,
      });

      // 🔥 Si requiere input del usuario, retornar 200 con requires_user_input
      if ((resultado as any).requires_user_input) {
        console.log(`\n❓ Esperando decisiones del usuario...`);
        return resultado;
      }

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
      // 🔥 NUEVOS CAMPOS OPCIONALES
      modo_interactivo: t.Optional(t.Boolean()),
      umbral_similitud: t.Optional(t.Number()),
      decisiones_usuario: t.Optional(t.Array(t.Object({
        nombre_excel: t.String(),
        credito_sifco: t.String(),
        decision: t.Number(), // inversionista_id o -1 para crear nuevo
      }))),
    }),
    detail: {
      summary: "Procesar inversionistas desde Excel (con modo interactivo)",
      description: `
        Recibe datos de Excel, busca el crédito en BD, borra inversionistas viejos e inserta los nuevos.
        
        **Modo Interactivo:**
        - Si modo_interactivo = true, matches con similitud < umbral_similitud retornarán consultas_interactivas
        - El cliente debe responder con decisiones_usuario en un segundo request
        - Las decisiones se aplicarán automáticamente
        
        **Flujo:**
        1. Primer request: { credito: {...}, modo_interactivo: true, umbral_similitud: 70 }
        2. Si hay dudas, respuesta: { requires_user_input: true, consultas_interactivas: [...] }
        3. Usuario elige opciones en Python
        4. Segundo request: { credito: {...}, decisiones_usuario: [{nombre_excel, credito_sifco, decision}] }
        5. Respuesta final: { success: true, inversionistas_procesados: X }
      `,
      tags: ["Inversionistas"],
    },
  }
).post(
  "/liquidar-cuotas-batch-inteligente",
  async ({ body, set }) => {
    try {
      console.log("🔥 ========== REQUEST RECIBIDO ==========");
      console.log(`👤 Inversionista: ${body.nombre_inversionista}`);
      console.log(`📊 Total liquidaciones: ${body.liquidaciones.length}`);

      if (!body.liquidaciones || body.liquidaciones.length === 0) {
        set.status = 400;
        return {
          success: false,
          error: "Debe proporcionar al menos una liquidación",
          exitosos: 0,
          fallidos: 0,
          agregados: 0,
          actualizados: 0,
          eliminados: 0
        };
      }

      const resultado = await liquidarCuotasBatchInteligente(body);

      if (!resultado.success) {
        set.status = 400;
        return resultado;
      }

      return resultado;

    } catch (error) {
      console.error("❌ Error en endpoint batch inteligente:", error);
      set.status = 500;
      return {
        success: false,
        error: error instanceof Error ? error.message : "Error desconocido",
        exitosos: 0,
        fallidos: 0,
        agregados: 0,
        actualizados: 0,
        eliminados: 0
      };
    }
  },
  {
    body: t.Object({
      nombre_inversionista: t.String(),
      liquidaciones: t.Array(
        t.Object({
          nombre_usuario: t.String(),
          cuota_mes: t.String(),
          capital: t.Number(),
          meses_en_credito: t.Optional(t.Union([t.Number(), t.Null()])),
          porcentaje_inversor: t.Optional(t.Number()), // 🔥 NUEVO
        })
      ),
    }),
    detail: {
      tags: ["Liquidaciones"],
      summary: "Liquidar cuotas en batch inteligente con sync",
      description: `
        Procesa múltiples liquidaciones para un inversionista específico.
        
        **Características:**
        - Crea relaciones nuevas automáticamente si no existen
        - Actualiza relaciones existentes con el nuevo capital
        - Elimina relaciones huérfanas (que ya no están en el Excel)
        - Procesa TODOS los créditos sin importar el mes
        
        **Campos opcionales:**
        - meses_en_credito: Número de meses que lleva el crédito (informativo)
        - porcentaje_inversor: % de participación del inversionista (ej: 1.20 para 1.20%)
          - Si se proporciona, se usa ese porcentaje
          - Si no se proporciona, usa default 72% inversor / 28% cash-in
          - El restante se calcula automáticamente para cash-in
        
        **Ejemplo de uso:**
        \`\`\`json
        {
          "nombre_inversionista": "Juan Pérez",
          "liquidaciones": [
            {
              "nombre_usuario": "María García",
              "cuota_mes": "nov. 25",
              "capital": 50000.00,
              "meses_en_credito": 3,
              "porcentaje_inversor": 1.20
            }
          ]
        }
        \`\`\`
      `,
    }
  }
).post(
  "/marcar-liquidado-inversionistas",
  async ({ body, set }) => {
    try {
      console.log("🔥 ========== MARCAR LIQUIDADO INVERSIONISTAS ==========");
      console.log(`   👤 Inversionista: ${body.nombre_inversionista}`);
      console.log(`   🧑  Cliente:       ${body.nombre_usuario}`);
      console.log(`   📅 Cuota mes:     ${body.cuota_mes}`);

      const resultado = await marcarLiquidadoInversionistasPorNombre({
        nombre_inversionista: body.nombre_inversionista,
        nombre_usuario: body.nombre_usuario,
        cuota_mes: body.cuota_mes,
      });

      if (!resultado.success) {
        set.status = 400;
        return resultado;
      }

      set.status = 200;
      return resultado;
    } catch (error) {
      console.error("❌ Error en /marcar-liquidado-inversionistas:", error);
      set.status = 500;
      return {
        success: false,
        message: "Error interno del servidor",
        error: error instanceof Error ? error.message : "Error desconocido",
      };
    }
  },
  {
    body: t.Object({
      nombre_inversionista: t.String({ minLength: 1, description: "Nombre del inversionista (búsqueda permisiva)" }),
      nombre_usuario: t.String({ minLength: 1, description: "Nombre del cliente/deudor (búsqueda permisiva)" }),
      cuota_mes: t.String({
        minLength: 4,
        description: "Mes de corte: 'mes. AA', ej: 'dic. 25'. Cuotas hasta ese mes → true; cuotas después → false.",
      }),
    }),
    detail: {
      tags: ["Liquidaciones"],
      summary: "Marcar liquidado_inversionistas por nombre de inversionista y cliente",
      description: `
        Dado el nombre del inversionista, el nombre del cliente y el mes de corte (\'cuota_mes\'),
        localiza el crédito y actualiza el campo \`liquidado_inversionistas\` en \`cuotas_credito\`:

        - \`fecha_vencimiento\` **≤ último día del mes de corte** → \`liquidado_inversionistas = true\`
        - \`fecha_vencimiento\` **> último día del mes de corte** → \`liquidado_inversionistas = false\`

        **Ejemplo:** \`cuota_mes = "dic. 25"\` → cuotas hasta el 31-dic-2025 quedan en **true**.

        \`\`\`json
        {
          "nombre_inversionista": "Juan Pérez",
          "nombre_usuario": "María García",
          "cuota_mes": "dic. 25"
        }
        \`\`\`
      `,
    },
  }
);