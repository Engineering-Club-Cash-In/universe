import { Elysia, t } from "elysia";
import {
  saveLead,
  saveInvestorLead,
  saveClientLead,
  listAllInvestorLeads,
  listAllClientLeads,
} from "../controllers/leads";
import { getRenapData } from "../controllers/renap";
import {
  queueCreditRecord,
  pollCreditRecords,
  createCreditScore,
} from "../controllers/credit-record";
import { cron } from "@elysiajs/cron";
import { predictMissingPayments } from "../controllers/credit-score";
import { getCreditScoreAndRecordByLeadEmail } from "../controllers/credit-score";
// Import the missing type
import type { InsertClientLead } from "../database/schemas/landing";

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
  })
  .post(
    "/submit-investor-lead",
    async ({ body }) => {
      try {
        // Convert boolean strings to actual booleans
        const leadData = {
          ...body,
          hasInvested: body.hasInvested === "si",
          hasBankAccount: body.hasBankAccount === "si",
        };
        const result = await saveInvestorLead(leadData);
        return { success: true, data: result };
      } catch (error: any) {
        console.error("Error saving investor lead:", error);
        // You might want to return a more specific error status code
        return {
          success: false,
          error: error.message || "Failed to save investor lead",
        };
      }
    },
    {
      body: t.Object({
        fullName: t.String(),
        phoneNumber: t.String(),
        email: t.String({ format: "email" }),
        hasInvested: t.String(), // Keep as string initially for frontend compatibility
        hasBankAccount: t.String(), // Keep as string initially
        investmentRange: t.String(),
        contactMethod: t.String(),
      }),
      response: {
        200: t.Object({
          success: t.Boolean(),
          data: t.Optional(t.Any()), // Adjust response type as needed
          error: t.Optional(t.String()),
        }),
        // Add other status codes like 500 if needed
        500: t.Object({
          success: t.Boolean(),
          error: t.String(),
        }),
      },
    }
  )
  // New route for submitting client leads
  .post(
    "/submit-client-lead",
    async ({ body }) => {
      try {
        // Prepare data for insertion, converting boolean-like strings
        const leadData: InsertClientLead = {
          ready: body.ready === "si",
          firstName: body.firstName,
          lastName: body.lastName,
          phoneNumber: body.phoneNumber,
          loanType: body.loanType,
          carLoanInfoAction:
            body.loanType === "carLoan" ? body.carLoanInfo : null,
          hasStatements:
            body.loanType === "carLoan" && body.carLoanInfo === "continue"
              ? body.hasStatements === "yes"
              : null,
          vehicleLoanInfoAction:
            body.loanType === "vehicleLoan" ? body.vehicleLoanInfo : null,
          vehicleDetails:
            body.loanType === "vehicleLoan" &&
            body.vehicleLoanInfo === "continue"
              ? body.vehicleDetails
              : null,
          loanAmount:
            body.loanType === "vehicleLoan" &&
            body.vehicleLoanInfo === "continue"
              ? body.loanAmount
              : null,
        };

        const result = await saveClientLead(leadData);
        return { success: true, data: result };
      } catch (error: any) {
        console.error("Error saving client lead:", error);
        return {
          success: false,
          error: error.message || "Failed to save client lead",
        };
      }
    },
    {
      // Define the expected body structure, keeping conditional fields optional
      body: t.Object({
        ready: t.String(), // 'si' or 'no'
        firstName: t.String(),
        lastName: t.String(),
        phoneNumber: t.String(),
        loanType: t.String(), // 'carLoan' or 'vehicleLoan'
        carLoanInfo: t.Optional(t.String()), // 'continue' or 'cancel'
        hasStatements: t.Optional(t.String()), // 'yes' or 'no'
        vehicleLoanInfo: t.Optional(t.String()), // 'continue' or 'cancel'
        vehicleDetails: t.Optional(t.String()),
        loanAmount: t.Optional(t.String()),
      }),
      response: {
        200: t.Object({
          success: t.Boolean(),
          data: t.Optional(t.Any()),
          error: t.Optional(t.String()),
        }),
        500: t.Object({
          success: t.Boolean(),
          error: t.String(),
        }),
      },
    }
  )
  // New route to get all investor leads
  .get(
    "/investor-leads",
    async () => {
      try {
        const leads = await listAllInvestorLeads();
        return { success: true, data: leads };
      } catch (error: any) {
        console.error("Error fetching investor leads:", error);
        return {
          success: false,
          error: error.message || "Failed to fetch investor leads",
        };
      }
    },
    {
      response: {
        200: t.Object({
          success: t.Boolean(),
          data: t.Optional(t.Array(t.Any())), // Adjust response type as needed
          error: t.Optional(t.String()),
        }),
        500: t.Object({
          success: t.Boolean(),
          error: t.String(),
        }),
      },
    }
  )
  // New route to get all client leads
  .get(
    "/client-leads",
    async () => {
      try {
        const leads = await listAllClientLeads();
        return { success: true, data: leads };
      } catch (error: any) {
        console.error("Error fetching client leads:", error);
        return {
          success: false,
          error: error.message || "Failed to fetch client leads",
        };
      }
    },
    {
      response: {
        200: t.Object({
          success: t.Boolean(),
          data: t.Optional(t.Array(t.Any())), // Adjust response type as needed
          error: t.Optional(t.String()),
        }),
        500: t.Object({
          success: t.Boolean(),
          error: t.String(),
        }),
      },
    }
  );

export default landingRouter;
