import { Elysia, t } from "elysia";
import { saveLead } from "../controllers/leads";
import { getRenapData } from "../controllers/renap";
import {
  queueCreditRecord,
  pollCreditRecords,
  createCreditScore,
} from "../controllers/credit-record";
import { cron } from "@elysiajs/cron";
import { predictMissingPayments } from "../controllers/credit-score";
import { getCreditScoreAndRecordByLeadEmail } from "../controllers/credit-score";

declare global {
  var isPollingCreditRecords: boolean;
}

// Initialize the global lock
global.isPollingCreditRecords = false;

const landingRouter = new Elysia({
  prefix: "/landing",
})
  .use(
    cron({
      name: "poll-credit-records",
      pattern: "*/30 * * * * *", // Every 30 seconds
      run: async () => {
        // Use a simple locking mechanism
        if (global.isPollingCreditRecords) {
          console.log("Credit records polling already in progress, skipping");
          return;
        }

        try {
          global.isPollingCreditRecords = true;
          console.log("Polling credit records");
          await pollCreditRecords();
        } catch (error) {
          console.error("Error polling credit records:", error);
        } finally {
          global.isPollingCreditRecords = false;
        }
      },
    })
  )
  .get("/", () => "Hello World from landing router")
  .post(
    "/submit-lead",
    ({ body }) => {
      return saveLead(body);
    },
    {
      body: t.Object({
        name: t.String(),
        email: t.Optional(t.String({ format: "email" })),
        phone: t.Optional(t.String()),
        desiredAmount: t.Numeric(),
      }),
    }
  )
  .get(
    "/renap-data/:id",
    async ({ params }) => {
      return await getRenapData(params.id);
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    }
  )
  .post(
    "/check-credit-record",
    async ({ body }) => {
      try {
        const files = Object.entries(body)
          .filter(([key]) => key.startsWith("file"))
          .map(([key, value]) => ({
            name: key,
            data: Buffer.from(value as string, "base64"),
          }));
        const filesArray = files.map(
          (file) => new File([file.data], file.name)
        );
        const response = await queueCreditRecord(filesArray, body.leadId);
        return response;
      } catch (error) {
        console.error("Error processing files:", error);
        throw new Error("Failed to process files");
      }
    },
    {
      body: t.Object({
        leadId: t.Numeric(),
        file1: t.String(),
        file2: t.String(),
        file3: t.String(),
      }),
    }
  )
  .post(
    "/create-credit-score",
    async ({ body }) => {
      return createCreditScore(body.creditRecordId, body.fit, body.probability);
    },
    {
      body: t.Object({
        creditRecordId: t.Numeric(),
        fit: t.Boolean(),
        probability: t.Number(),
      }),
    }
  )
  .post(
    "/predict-missing-payments",
    async ({ body }) => {
      const result = await predictMissingPayments(body);
      return {
        success: true,
        message: "Missing payments predicted successfully",
        data: result,
        error: null,
      };
    },

    {
      body: t.Object({
        PRECIO_PRODUCTO: t.Number(),
        SUELDO: t.Number(),
        EDAD: t.Number(),
        DEPENDIENTES_ECONOMICOS: t.Number(),
        OCUPACION: t.Number(),
        ANTIGUEDAD: t.Number(),
        ESTADO_CIVIL: t.Number(),
        UTILIZACION_DINERO: t.Number(),
        VIVIENDA_PROPIA: t.Number(),
        VEHICULO_PROPIO: t.Number(),
        TARJETA_DE_CREDITO: t.Number(),
        TIPO_DE_COMPRAS: t.Number(),
      }),
    }
  )
  .get(
    "/get-credit-score-and-record-by-lead-email/:email",
    async ({ params }) => {
      const result = await getCreditScoreAndRecordByLeadEmail(params.email);
      return {
        success: true,
        message: "Credit score and record retrieved successfully",
        data: result,
        error: null,
      };
    },
    {
      params: t.Object({
        email: t.String(),
      }),
    }
  )
  .get("/poll-credit-records", async () => {
    pollCreditRecords();
    return {
      success: true,
      message: "Started polling credit records",
      data: null,
      error: null,
    };
  });

export default landingRouter;
