import { z } from "zod";
import { publicProcedureWithLogger } from "../trpc";
import { saveLead } from "../controllers/leads";
import { getRenapData } from "../controllers/renap";
import {
  queueCreditRecord,
  pollCreditRecords,
} from "../controllers/credit-record";

export const submitLeadRouter = publicProcedureWithLogger
  .input(
    z.object({
      name: z.string(),
      email: z.string().email().optional(),
      phone: z.string().optional(),
      desiredAmount: z.number(),
    })
  )
  .mutation(async ({ input }) => {
    return saveLead(input);
  });

export const getRenapDataRouter = publicProcedureWithLogger
  .input(z.string())
  .query(async ({ input }) => {
    return await getRenapData(input);
  });

export const checkCreditRecordRouter = publicProcedureWithLogger
  .input(
    z.object({
      leadId: z.number(),
      file1: z.string(),
      file2: z.string(),
      file3: z.string(),
    })
  )
  .mutation(async ({ input }) => {
    try {
      const files = Object.entries(input)
        .filter(([key]) => key.startsWith("file"))
        .map(([key, value]) => ({
          name: key,
          data: Buffer.from(value as string, "base64"),
        }));
      const filesArray = files.map((file) => new File([file.data], file.name));
      const response = await queueCreditRecord(filesArray, input.leadId);
      return response;
    } catch (error) {
      console.error("Error processing files:", error);
    }
  });

export const submitContactFormRouter = publicProcedureWithLogger
  .input(z.object({ name: z.string(), email: z.string(), message: z.string() }))
  .mutation(async ({ input }) => {
    console.log("Successfully submitted form");
    return {
      success: true,
      message: "Form submitted successfully",
      data: input,
    };
  });

export const pollCreditRecordRouter = publicProcedureWithLogger.query(
  async () => {
    pollCreditRecords();
    return {
      success: true,
      message: "Started polling credit records",
      data: null,
      error: null,
    };
  }
);
