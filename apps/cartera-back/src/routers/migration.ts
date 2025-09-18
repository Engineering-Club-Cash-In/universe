// routes/sifco.ts
import { Elysia, t } from "elysia";
import { syncClienteConPrestamos } from "../migration/migration";
 
import path from "path";
import { leerCreditoPorNumeroSIFCO } from "../services/excel";

/**
 * 📂 Ruta absoluta del Excel en tu máquina
 * ⚠️ para producción deberías meterlo en un bucket o carpeta compartida
 */
const excelPath = path.resolve(
  "C:/Users/Kelvin Palacios/Documents/analis de datos/agosto2025.csv"
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
  );
