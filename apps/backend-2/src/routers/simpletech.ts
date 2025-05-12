// Integration router for Simpletech

import { Elysia, t } from "elysia";
import { jwt } from "@elysiajs/jwt";
import {
  createLead,
  fillPersonaFields,
  createLeadCreditScore,
  createCreditProfile,
  updateCompletedRuns,
} from "../controllers/simpletech";
import { saveLead } from "../controllers/leads";

import { cron } from "@elysiajs/cron";

declare global {
  var isPollingCreditRecords: boolean;
}

// Initialize the global lock
global.isPollingCreditRecords = false;

const simpletechRouter = new Elysia({ prefix: "simpletech" })
  .use(
    jwt({
      name: "jwt",
      secret: Bun.env.JWT_SECRET ?? "secret",
    })
  )
  .use(
    cron({
      name: "poll-credit-records",
      pattern: "*/10 * * * * *", // Every 10 seconds
      run: async () => {
        if (global.isPollingCreditRecords) {
          console.log("Credit records polling already in progress, skipping");
          return;
        }
        try {
          global.isPollingCreditRecords = true;
          console.log("Polling credit records");
          await updateCompletedRuns();
        } catch (error) {
          console.error("Error polling credit records:", error);
        } finally {
          global.isPollingCreditRecords = false;
        }
      },
    })
  )
  .get("/", () => "Hello World")
  .post(
    "/createLead",
    async ({ jwt, body, headers, set }) => {
      const validation = jwt.verify(headers.authorization);
      if (!validation) {
        set.status = 401;
        return {
          success: false,
          message: "Unauthorized",
        };
      }
      const { phone } = body;
      const foundLead = await createLead(phone);
      if (foundLead instanceof Error) {
        set.status = 500;
        return {
          success: false,
          message: foundLead.message,
        };
      }
      return {
        success: true,
        message: "Lead created successfully",
        data: {
          leadId: foundLead,
        },
      };
    },
    {
      body: t.Object({
        phone: t.String(),
      }),
      response: {
        200: t.Object({
          success: t.Boolean(),
          message: t.String(),
          data: t.Object({ leadId: t.String() }),
        }),
        401: t.Object({
          success: t.Boolean(),
          message: t.String(),
        }),
        500: t.Object({
          success: t.Boolean(),
          message: t.String(),
        }),
      },
    }
  )
  .post(
    "/create-credit-score",
    async ({ jwt, body, headers, set }) => {
      const validation = jwt.verify(headers.authorization);
      if (!validation) {
        set.status = 401;
        return {
          success: false,
          message: "Unauthorized",
        };
      }
      const {
        leadId,
        age,
        civilStatus,
        name,
        documentNumber,
        economicDependents,
        monthlyIncome,
        amountToFinance,
        ocupation,
        timeEmployed,
        moneyPurpose,
        ownsHouse,
        ownsVehicle,
        hasCreditCard,
      } = body;
      const filledLead = await fillPersonaFields({
        leadId,
        name,
        age,
        civilStatus,
        economicDependents,
        documentNumber,
        monthlyIncome,
        amountToFinance,
        ocupation: ocupation === "OWNER" ? "PROPIETARIO" : "COLABORADOR",
        timeEmployed:
          timeEmployed === "1TO5"
            ? "ONETOFIVE"
            : timeEmployed === "5TO10"
              ? "FIVETOTEN"
              : "TENPLUS",
        moneyPurpose: moneyPurpose === "PERSONAL" ? "PERSONAL" : "TRABAJO",
        ownsHouse,
        ownsVehicle,
        hasCreditCard,
      });
      if (filledLead instanceof Error) {
        set.status = 500;
        return {
          success: false,
          message: filledLead.message,
        };
      }
      const creditScore = await createLeadCreditScore(leadId);
      return {
        success: true,
        message: "Credit profile created successfully",
        data: {
          leadId,
          fit: creditScore.fit,
          probability: creditScore.probability,
        },
      };
    },
    {
      body: t.Object({
        leadId: t.String(),
        age: t.Number(),
        civilStatus: t.Enum({
          SINGLE: "SINGLE",
          MARRIED: "MARRIED",
          DIVORCED: "DIVORCED",
          WIDOWER: "WIDOWER",
        }),
        documentNumber: t.String(),
        economicDependents: t.Number(),
        monthlyIncome: t.Number(),
        amountToFinance: t.Number(),
        ocupation: t.Enum({
          OWNER: "OWNER",
          EMPLOYEE: "EMPLOYEE",
        }),
        timeEmployed: t.Enum({
          "1TO5": "1TO5",
          "5TO10": "5TO10",
          "10PLUS": "10PLUS",
        }),
        moneyPurpose: t.Enum({
          PERSONAL: "PERSONAL",
          BUSINESS: "BUSINESS",
        }),
        name: t.String(),
        ownsHouse: t.Boolean(),
        ownsVehicle: t.Boolean(),
        hasCreditCard: t.Boolean(),
      }),
      response: {
        200: t.Object({
          success: t.Boolean(),
          message: t.String(),
          data: t.Object({
            leadId: t.String(),
            fit: t.Boolean(),
            probability: t.Number(),
          }),
        }),
        401: t.Object({
          success: t.Boolean(),
          message: t.String(),
        }),
      },
    }
  )
  .post(
    "/create-credit-profile",
    async ({ jwt, body, headers, set }) => {
      const validation = jwt.verify(headers.authorization);
      if (!validation) {
        set.status = 401;
        return {
          success: false,
          message: "Unauthorized",
        };
      }
      const { leadId, firstStatement, secondStatement, thirdStatement } = body;
      // TODO: Create credit profile in CRM
      const creditProfile = await createCreditProfile(
        leadId,
        firstStatement,
        secondStatement,
        thirdStatement
      );
      if (creditProfile instanceof Error) {
        set.status = 500;
        return {
          success: false,
          message: creditProfile.message,
        };
      }
      return {
        success: true,
        message: "Credit profile created successfully",
        data: { leadId },
      };
    },
    {
      body: t.Object({
        leadId: t.String(),
        score: t.Optional(t.Number()),
        firstStatement: t.String(),
        secondStatement: t.String(),
        thirdStatement: t.String(),
      }),
      response: {
        200: t.Object({
          success: t.Boolean(),
          message: t.String(),
          data: t.Object({ leadId: t.String() }),
        }),
        401: t.Object({
          success: t.Boolean(),
          message: t.String(),
        }),
      },
    }
  );

export default simpletechRouter;
