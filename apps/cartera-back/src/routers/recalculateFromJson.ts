import Elysia, { t } from "elysia";
import fs from "fs";
import path from "path";
import {
  recalcularCreditosDesdeJson,
  agruparCreditosPorNumeroBase,
} from "../controllers/recalculateFromJson";

// ========================================
// SCHEMA PARA VALIDACIÓN
// ========================================

const CreditoJsonSchema = t.Object({
  numeroCredito: t.String(),
  fechaUltimoPago: t.Optional(t.String()),
  numeroCuota: t.Optional(t.String()),
  cuota: t.Optional(t.String()),
  montoBoleta: t.Optional(t.String()),
  pagado: t.Optional(t.String()),
  capitalRestante: t.String(),
  inversionista: t.String(),
  pago: t.Optional(t.String()),
  pagosParciales: t.Optional(t.Array(t.Any())),
});

const CreditoAgrupadoSchema = t.Object({
  numeroCredito: t.String(),
  creditos: t.Array(CreditoJsonSchema),
});

// ========================================
// ROUTER
// ========================================

export const recalculateFromJsonRouter = new Elysia({ prefix: "/recalculate" })
  // 📌 POST: Recibir JSON directamente en el body
  .post(
    "/from-json",
    async ({ body, set }) => {
      try {
        console.log(`\n📥 Recibiendo ${body.creditos.length} créditos agrupados...`);

        const resultado = await recalcularCreditosDesdeJson(body.creditos);

        if (!resultado.success && resultado.exitosos === 0) {
          set.status = 400;
        }

        return resultado;
      } catch (error: any) {
        console.error("❌ Error en /recalculate/from-json:", error);
        set.status = 500;
        return {
          success: false,
          error: error.message || "Error interno del servidor",
        };
      }
    },
    {
      body: t.Object({
        creditos: t.Array(CreditoAgrupadoSchema),
      }),
      detail: {
        summary: "Recalcular créditos desde JSON",
        description: `
          Recibe un array de créditos agrupados y recalcula:
          - El capital sumando los capitalRestante de cada inversionista
          - La deuda total
          - Los inversionistas (los borra y los recrea)
          - Las cuotas pendientes
        `,
        tags: ["Recálculo"],
      },
    }
  )

  // 📌 POST: Recibir array plano de créditos y agruparlo automáticamente
  .post(
    "/from-flat-json",
    async ({ body, set }) => {
      try {
        console.log(`\n📥 Recibiendo ${body.creditos.length} créditos (plano)...`);

        // Agrupar por número base
        const creditosAgrupados = agruparCreditosPorNumeroBase(body.creditos);
        console.log(`📊 Agrupados en ${creditosAgrupados.length} créditos únicos`);

        const resultado = await recalcularCreditosDesdeJson(creditosAgrupados);

        if (!resultado.success && resultado.exitosos === 0) {
          set.status = 400;
        }

        return resultado;
      } catch (error: any) {
        console.error("❌ Error en /recalculate/from-flat-json:", error);
        set.status = 500;
        return {
          success: false,
          error: error.message || "Error interno del servidor",
        };
      }
    },
    {
      body: t.Object({
        creditos: t.Array(CreditoJsonSchema),
      }),
      detail: {
        summary: "Recalcular créditos desde JSON plano",
        description: `
          Recibe un array plano de créditos (como viene del JSON original)
          y los agrupa automáticamente por número base antes de recalcular.
        `,
        tags: ["Recálculo"],
      },
    }
  )

  // 📌 POST: Leer desde archivo JSON en el servidor
  .post(
    "/from-file",
    async ({ body, set }) => {
      try {
        const { filePath } = body;

        // Validar que el archivo existe
        if (!fs.existsSync(filePath)) {
          set.status = 404;
          return {
            success: false,
            error: `Archivo no encontrado: ${filePath}`,
          };
        }

        console.log(`\n📂 Leyendo archivo: ${filePath}`);

        // Leer el archivo JSON
        const contenido = fs.readFileSync(filePath, "utf-8");
        const data = JSON.parse(contenido);

        // Determinar si es un array plano o ya está agrupado
        let creditosAgrupados;

        if (Array.isArray(data)) {
          // Si es un array, verificar si son créditos planos o agrupados
          if (data.length > 0 && data[0].creditos) {
            // Ya está agrupado
            creditosAgrupados = data;
          } else {
            // Es plano, agrupar
            creditosAgrupados = agruparCreditosPorNumeroBase(data);
          }
        } else if (data.creditos) {
          // El JSON tiene una propiedad "creditos"
          if (Array.isArray(data.creditos) && data.creditos.length > 0 && data.creditos[0].creditos) {
            creditosAgrupados = data.creditos;
          } else {
            creditosAgrupados = agruparCreditosPorNumeroBase(data.creditos);
          }
        } else {
          set.status = 400;
          return {
            success: false,
            error: "Formato de JSON no reconocido",
          };
        }

        console.log(`📊 Créditos a procesar: ${creditosAgrupados.length}`);

        const resultado = await recalcularCreditosDesdeJson(creditosAgrupados);

        if (!resultado.success && resultado.exitosos === 0) {
          set.status = 400;
        }

        return resultado;
      } catch (error: any) {
        console.error("❌ Error en /recalculate/from-file:", error);
        set.status = 500;
        return {
          success: false,
          error: error.message || "Error interno del servidor",
        };
      }
    },
    {
      body: t.Object({
        filePath: t.String({ minLength: 1 }),
      }),
      detail: {
        summary: "Recalcular créditos desde archivo JSON",
        description: `
          Lee un archivo JSON del servidor y recalcula los créditos.
          El archivo puede tener formato plano o agrupado.
        `,
        tags: ["Recálculo"],
      },
    }
  )

  // 📌 POST: Recalcular un crédito específico
  .post(
    "/single",
    async ({ body, set }) => {
      try {
        const { numeroCredito, inversionistas } = body;

        console.log(`\n📋 Recalculando crédito: ${numeroCredito}`);
        console.log(`   Inversionistas: ${inversionistas.length}`);

        // Construir el formato esperado
        const creditoAgrupado = {
          numeroCredito,
          creditos: inversionistas.map((inv, idx) => ({
            numeroCredito: idx === 0 ? numeroCredito : `${numeroCredito}_${idx + 1}`,
            capitalRestante: inv.capitalRestante.toString(),
            inversionista: inv.nombre,
            fechaUltimoPago: "",
            numeroCuota: "",
            cuota: "",
            montoBoleta: "",
            pagado: "",
            pago: "",
            pagosParciales: [],
          })),
        };

        const resultado = await recalcularCreditosDesdeJson([creditoAgrupado]);

        if (!resultado.success) {
          set.status = 400;
        }

        return resultado;
      } catch (error: any) {
        console.error("❌ Error en /recalculate/single:", error);
        set.status = 500;
        return {
          success: false,
          error: error.message || "Error interno del servidor",
        };
      }
    },
    {
      body: t.Object({
        numeroCredito: t.String({ minLength: 1 }),
        inversionistas: t.Array(
          t.Object({
            nombre: t.String({ minLength: 1 }),
            capitalRestante: t.Number({ minimum: 0 }),
          }),
          { minItems: 1 }
        ),
      }),
      detail: {
        summary: "Recalcular un crédito específico",
        description: `
          Recalcula un crédito específico con los inversionistas y capitales proporcionados.

          Ejemplo:
          {
            "numeroCredito": "01010214111550",
            "inversionistas": [
              { "nombre": "Flujocapital", "capitalRestante": 18305.27 },
              { "nombre": "Richard Kachler Ortega", "capitalRestante": 11726.43 },
              { "nombre": "Alexander Kachler Simons (AMJK)", "capitalRestante": 10001.30 }
            ]
          }
        `,
        tags: ["Recálculo"],
      },
    }
  );
