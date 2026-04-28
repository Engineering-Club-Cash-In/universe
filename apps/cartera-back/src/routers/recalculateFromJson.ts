import Elysia, { t } from "elysia";
import fs from "fs";
import path from "path";
import {
  recalcularCreditosDesdeJson,
  agruparCreditosPorNumeroBase,
  processPoolsRaros,
  eliminarCreditos,
  actualizarCuotasInversionistas,
} from "../controllers/recalculateFromJson";
import { authMiddleware } from "./midleware";

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

const InversionistaActualSchema = t.Object({
  numeroCredito: t.String(),
  inversionista: t.String(),
  porcentajeCashIn: t.String(),
  porcentajeInversionista: t.String(),
  capital: t.String(),
  cuota: t.Optional(t.String()),
});

const CreditoAgrupadoSchema = t.Object({
  numeroCredito: t.String(),
  creditos: t.Array(CreditoJsonSchema),
  inversionistasActuales: t.Optional(t.Array(InversionistaActualSchema)),
});

const PoolRaroSchema = t.Object({
  nombre: t.String(),
  numeroCuota: t.Optional(t.String()),
  numeroCredito: t.String(),
  creditos: t.Array(CreditoJsonSchema),
});

const CreditoEliminarSchema = t.Object({
  numeroCredito: t.String(),
  inversionista: t.String(),
  capitalRestante: t.Optional(t.String()),
});

// ========================================
// ROUTER
// ========================================

export const recalculateFromJsonRouter = new Elysia({ prefix: "/recalculate" })
  .use(authMiddleware)
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
  )

  // 📌 POST: Procesar pools raros desde archivo local
  .post(
    "/pools-raros-file",
    async ({ set }) => {
      try {
        const rutaArchivo =
          "C:\\Users\\Kelvin Palacios\\Documents\\analis de datos\\resultado_pools_raros.json";

        if (!fs.existsSync(rutaArchivo)) {
          set.status = 404;
          return { success: false, error: `Archivo no encontrado: ${rutaArchivo}` };
        }

        console.log(`\n📂 Leyendo archivo: ${rutaArchivo}`);
        const contenido = fs.readFileSync(rutaArchivo, "utf-8");
        const pools = JSON.parse(contenido);

        console.log(`📥 ${pools.length} pools raros encontrados`);
        const resultado = await processPoolsRaros(pools);

        if (!resultado.success) {
          set.status = 400;
        }

        return resultado;
      } catch (error: any) {
        console.error("❌ Error en /recalculate/pools-raros-file:", error);
        set.status = 500;
        return {
          success: false,
          error: error.message || "Error interno del servidor",
        };
      }
    },
    {
      detail: {
        summary: "Procesar pools raros desde archivo",
        description: `Lee resultado_pools_raros.json y procesa automaticamente.`,
        tags: ["Recálculo"],
      },
    }
  )

  // 📌 POST: Procesar pools raros desde body
  .post(
    "/pools-raros",
    async ({ body, set }) => {
      try {
        console.log(`\n📥 Recibiendo ${body.pools.length} pools raros...`);

        const resultado = await processPoolsRaros(body.pools);

        if (!resultado.success) {
          set.status = 400;
        }

        return resultado;
      } catch (error: any) {
        console.error("❌ Error en /recalculate/pools-raros:", error);
        set.status = 500;
        return {
          success: false,
          error: error.message || "Error interno del servidor",
        };
      }
    },
    {
      body: t.Object({
        pools: t.Array(PoolRaroSchema),
      }),
      detail: {
        summary: "Procesar pools raros",
        description: `
          Recibe un array de pools raros. Por cada pool:
          - Créditos que coinciden con el numeroCredito del pool → se recalculan (todos los inversionistas se asignan al crédito principal)
          - Créditos con número diferente → se ELIMINAN completamente de la BD (el inversionista se mueve al crédito principal)
        `,
        tags: ["Recálculo"],
      },
    }
  )

  // 📌 POST: Eliminar créditos completos de la BD
  .post(
    "/eliminar-creditos",
    async ({ body, set }) => {
      try {
        console.log(`\n📥 Eliminando ${body.creditos.length} créditos...`);

        const resultado = await eliminarCreditos(body.creditos);

        if (!resultado.success && resultado.exitosos === 0) {
          set.status = 400;
        }

        return resultado;
      } catch (error: any) {
        console.error("❌ Error en /recalculate/eliminar-creditos:", error);
        set.status = 500;
        return {
          success: false,
          error: error.message || "Error interno del servidor",
        };
      }
    },
    {
      body: t.Object({
        creditos: t.Array(CreditoEliminarSchema),
      }),
      detail: {
        summary: "Eliminar créditos completos",
        description: `
          Recibe un array de créditos.
          Elimina el crédito completo de la BD incluyendo: pagos, boletas, cuotas, inversionistas y todo lo relacionado.
        `,
        tags: ["Recálculo"],
      },
    }
  )

  // 📌 POST: Actualizar solo cuotas de inversionistas desde archivo
  .post(
    "/actualizar-cuotas",
    async ({ set }) => {
      try {
        const rutaArchivo =
          "C:\\Users\\Kelvin Palacios\\Documents\\analis de datos\\resultado_ultimos_pagos.json";

        if (!fs.existsSync(rutaArchivo)) {
          set.status = 404;
          return { success: false, error: `Archivo no encontrado: ${rutaArchivo}` };
        }

        console.log(`\n📂 Leyendo archivo: ${rutaArchivo}`);
        const contenido = fs.readFileSync(rutaArchivo, "utf-8");
        const data = JSON.parse(contenido);

        // Filtrar solo los que tienen inversionistasActuales con cuota
        const creditosConCuotas = data.filter(
          (g: any) => g.inversionistasActuales?.some((inv: any) => inv.cuota)
        );

        console.log(`📥 ${data.length} créditos en archivo, ${creditosConCuotas.length} con cuotas en inversionistasActuales`);

        const resultado = await actualizarCuotasInversionistas(creditosConCuotas);

        if (!resultado.success && resultado.exitosos === 0) {
          set.status = 400;
        }

        return resultado;
      } catch (error: any) {
        console.error("❌ Error en /recalculate/actualizar-cuotas:", error);
        set.status = 500;
        return {
          success: false,
          error: error.message || "Error interno del servidor",
        };
      }
    },
    {
      detail: {
        summary: "Actualizar solo cuotas de inversionistas desde archivo",
        description: `
          Lee resultado_ultimos_pagos.json y actualiza SOLO la cuota_inversionista
          de cada inversionista en creditos_inversionistas.
          Usa el campo "cuota" de inversionistasActuales.
          No toca capital, deuda, ni recrea inversionistas.
        `,
        tags: ["Recálculo"],
      },
    }
  );
