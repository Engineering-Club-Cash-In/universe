import type { AppRouter } from "@repo/backend/appRouter";
import { httpBatchLink, createTRPCClient } from "@trpc/client";
import { defineAction } from "astro:actions";
import { z } from "astro:schema";
// Create a tRPC client to call your backend
const client = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: "http://localhost:9000", // Replace with your tRPC backend URL
    }),
  ],
});

export type CreditRecordInput = {
  leadId: number;
  file1: string;
  file2: string;
  file3: string;
};

export const server = {
  submitForm: defineAction({
    input: z.object({
      name: z.string(),
      email: z.string(),
      message: z.string(),
    }),
    handler: async (input) => {
      try {
        // Call the tRPC procedure
        const result = await client.submitContactForm.mutate(input);
        if (result.success) {
          return result;
        }
      } catch (error) {
        console.error("Error submitting form:", error);
        return {
          success: false,
          error: "Failed to submit form",
          message: "Failed to submit form",
          data: null,
        };
      }
    },
  }),
  getRenapData: defineAction({
    input: z.object({
      dpi: z.string(),
    }),
    handler: async ({ dpi }) => {
      const result = await client.getRenapData.query(dpi);
      return result;
    },
  }),
  checkCreditRecord: defineAction({
    input: z.object({
      leadId: z.number(),
      file1: z.string(),
      file2: z.string(),
      file3: z.string(),
    }),
    handler: async (input: CreditRecordInput) => {
      try {
        const result = await client.getCreditRecord.mutate(input);
        return {
          success: true,
          data: result,
          message: "Successfully processed files",
          error: null,
        };
      } catch (error) {
        console.error("Error processing files:", error);
        return {
          success: false,
          error: "Failed to process files",
          message: "Failed to process files",
          data: null,
        };
      }
    },
  }),
  submitLead: defineAction({
    input: z.object({
      name: z.string(),
      email: z.string(),
      phone: z.string(),
      desiredAmount: z.number(),
    }),
    handler: async (input) => {
      return await client.submitLead.mutate(input);
    },
  }),
  pollCreditRecord: defineAction({
    handler: async () => {
      const result = await client.pollCreditRecord.query();
      return result;
    },
  }),
};
