import { z } from "zod";

export const createPaymentTokenResponseSchema = z.object({
  id: z.number(),
  prefix: z.string(),
});

export const tokenUserInputSchema = z.object({
  identifier: z.number().int().min(100_000_000).max(999_999_999),
  description: z.string().min(1),
  nationalId: z.number().int().positive(),
});

export const createTokenUsersResponseSchema = z.object({
  users: z.array(z.object({ id: z.number(), token: z.string() })),
  errorUsers: z.array(z.object({ identifier: z.union([z.string(), z.number()]), reason: z.string() })).default([]),
});

export const reviewTransferStatusSchema = z.enum(["APPROVED", "REJECTED"]);

export const reviewTransferResponseSchema = z.object({
  reference: z.union([z.string(), z.number()]),
  status: reviewTransferStatusSchema,
});

export const tokenTransactionSchema = z.object({
  reference: z.union([z.string(), z.number()]),
  amount: z.number(),
  bank: z.string(),
  comments: z.string().nullable().default(""),
  currency: z.enum(["GTQ", "USD"]),
  account: z.string(),
  token: z.string(),
  tokenDate: z.string(),
  tokenIdentifier: z.string(),
  tokenName: z.string(),
  tokenPrefix: z.string(),
  wasReturn: z.union([z.literal(0), z.literal(1), z.boolean()]).transform((value) => value === true ? 1 : value === false ? 0 : value),
  transactionId: z.string(),
});

export const paymentTokenStatementResponseSchema = z.object({
  transactions: z.array(tokenTransactionSchema),
});

export const paymentTokenWebhookSchema = z.object({
  id: z.union([z.string(), z.number()]),
  reference: z.union([z.string(), z.number()]),
  token: z.string(),
  amount: z.number(),
  originAccount: z.string(),
  originBank: z.string(),
  comments: z.string().nullable().default(""),
  currency: z.enum(["GTQ", "USD"]),
  originAccountName: z.string().optional(),
});

export type TokenTransaction = z.infer<typeof tokenTransactionSchema>;
export type ReviewTransferStatus = z.infer<typeof reviewTransferStatusSchema>;
