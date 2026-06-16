import { Elysia, t } from "elysia";
import { authMiddleware } from "./midleware";
import {
  aplicarManualesEnSnapshotDia,
  aplicarMetaEnSnapshotsMes,
  generarExcelFacturacionDiaria,
  generarSnapshotDiario,
  getSnapshotsDiarios,
  regenerarSnapshotRango,
} from "../controllers/facturacionSnapshot";

export const facturacionSnapshotRouter = new Elysia({
  prefix: "/api/facturacion-snapshot",
})
  .use(authMiddleware)

  // POST - Generar (o regenerar) el snapshot de un día. { fecha: "YYYY-MM-DD" }.
  .post(
    "/generar",
    async ({ body, set }: any) => {
      try {
        const result = await generarSnapshotDiario(body.fecha);
        set.status = 200;
        return result;
      } catch (error) {
        set.status = 500;
        return {
          success: false,
          message: "Error generando snapshot diario",
          error: String(error),
        };
      }
    },
    {
      body: t.Object({
        fecha: t.String(), // "YYYY-MM-DD"
      }),
    }
  )

  // POST - Regenerar (force) el snapshot de un RANGO de días. Recalcula aunque
  //        la fila exista. { fechaInicio: "YYYY-MM-DD", fechaFin: "YYYY-MM-DD" }
  .post(
    "/regenerar-rango",
    async ({ body, set }: any) => {
      try {
        const result = await regenerarSnapshotRango(
          body.fechaInicio,
          body.fechaFin
        );
        if (!result.success) set.status = 400;
        return result;
      } catch (error) {
        set.status = 500;
        return {
          success: false,
          message: "Error regenerando rango de snapshots",
          error: String(error),
        };
      }
    },
    {
      body: t.Object({
        fechaInicio: t.String(), // "YYYY-MM-DD"
        fechaFin: t.String(), // "YYYY-MM-DD"
      }),
    }
  )

  // POST - Aplicar SOLO carros + administrativos al día (sin recalcular montos).
  .post(
    "/aplicar-manuales-dia",
    async ({ body, set }: any) => {
      try {
        return await aplicarManualesEnSnapshotDia(body.fecha);
      } catch (error) {
        set.status = 500;
        return { success: false, message: "Error aplicando manuales al día", error: String(error) };
      }
    },
    {
      body: t.Object({ fecha: t.String() }),
    }
  )

  // POST - Aplicar SOLO las metas al mes (sin recalcular montos importados).
  .post(
    "/aplicar-meta-mes",
    async ({ body, set }: any) => {
      try {
        return await aplicarMetaEnSnapshotsMes(body.anio, body.mes);
      } catch (error) {
        set.status = 500;
        return { success: false, message: "Error aplicando la meta al mes", error: String(error) };
      }
    },
    {
      body: t.Object({ anio: t.Number(), mes: t.Number() }),
    }
  )

  // GET - Descargar Excel (diseño tipo Excel + logo + totales).
  //       ?fechaInicio=YYYY-MM-DD&fechaFin=YYYY-MM-DD
  .get(
    "/excel",
    async ({ query, set }: any) => {
      try {
        const buffer = await generarExcelFacturacionDiaria(query.fechaInicio, query.fechaFin);
        return new Response(buffer as unknown as BodyInit, {
          headers: {
            "Content-Type":
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "Content-Disposition": `attachment; filename="facturacion-diaria-${query.fechaInicio}_${query.fechaFin}.xlsx"`,
          },
        });
      } catch (error) {
        set.status = 500;
        return { success: false, message: "Error generando el Excel", error: String(error) };
      }
    },
    {
      query: t.Object({
        fechaInicio: t.String(),
        fechaFin: t.String(),
      }),
    }
  )

  // GET - Leer snapshots. ?fechaInicio=YYYY-MM-DD&fechaFin=YYYY-MM-DD (opcionales).
  .get("/", async ({ query, set }: any) => {
    try {
      return await getSnapshotsDiarios({
        fechaInicio: query.fechaInicio,
        fechaFin: query.fechaFin,
      });
    } catch (error) {
      set.status = 500;
      return {
        success: false,
        message: "Error obteniendo snapshots",
        error: String(error),
      };
    }
  });
