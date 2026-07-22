import { Hono } from "hono";
import { z } from "zod";
import type { NexaClient } from "../nexa/client";
import type { CarteraPaymentClient } from "../payments/cartera-client";
import { pollPaymentTokenDate } from "../payments/poller";
import { createTokenUserForCredit } from "../tokens/service";
import type { DbPaymentTransactionRepository, DbTokenUserRepository, PaymentTokenRepository, PollRunRepository } from "../db/repositories";

const createTokenUserSchema = z.object({
  creditoId: z.number().int().positive(),
  description: z.string().min(1),
  nationalId: z.string().regex(/^\d+$/),
});

const mockCreditSchema = z.object({
  creditoId: z.number().int().positive(),
  borrowerName: z.string().min(1).default("Cliente prueba"),
  initialBalance: z.number().positive(),
  installmentAmount: z.number().positive(),
});

export function createAdminRouter(deps: {
  internalApiKey: string;
  nexa: NexaClient;
  cartera: CarteraPaymentClient;
  paymentTokens: PaymentTokenRepository;
  tokenUsers: DbTokenUserRepository;
  transactions: DbPaymentTransactionRepository;
  pollRuns: PollRunRepository;
  mockCredits?: {
    list(): Promise<unknown[]>;
    upsert(input: z.infer<typeof mockCreditSchema>): Promise<unknown>;
  };
  accumulatorAccount: number;
  paymentTokenName: string;
}) {
  const router = new Hono();

  router.use("/*", async (c, next) => {
    const token = c.req.header("Authorization")?.replace("Bearer ", "").trim();
    if (token !== deps.internalApiKey) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    await next();
  });

  router.post("/tokens/bootstrap", async (c) => {
    const existing = await deps.paymentTokens.findActive();
    if (existing) return c.json(existing);

    const nexaToken = await deps.nexa.createPaymentToken({ account: deps.accumulatorAccount, name: deps.paymentTokenName });
    const created = await deps.paymentTokens.create({
      nexaTokenId: nexaToken.id,
      prefix: nexaToken.prefix,
      account: String(deps.accumulatorAccount),
      name: deps.paymentTokenName,
    });
    return c.json(created, 201);
  });

  router.post("/token-users", async (c) => {
    const body = createTokenUserSchema.parse(await c.req.json());
    const paymentToken = await deps.paymentTokens.findActive();
    if (!paymentToken) return c.json({ error: "No active Nexa payment token. Run /tokens/bootstrap first." }, 409);

    try {
      const created = await createTokenUserForCredit({
        ...body,
        paymentToken: { id: paymentToken.id, nexaTokenId: paymentToken.nexaTokenId, prefix: paymentToken.prefix },
        repository: deps.tokenUsers,
        nexa: deps.nexa,
      });
      return c.json(created, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith("Nexa rejected token user")) {
        return c.json({ error: message }, 422);
      }
      throw error;
    }
  });

  router.get("/token-users", async (c) => {
    return c.json({ tokenUsers: await deps.tokenUsers.list() });
  });

  router.get("/transactions", async (c) => {
    return c.json({ transactions: await deps.transactions.list() });
  });

  router.get("/mock-credits", async (c) => {
    return c.json({ credits: await deps.mockCredits?.list() ?? [] });
  });

  router.post("/mock-credits", async (c) => {
    if (!deps.mockCredits) return c.json({ error: "Mock cartera is not configured" }, 409);
    const body = mockCreditSchema.parse(await c.req.json());
    return c.json(await deps.mockCredits.upsert(body), 201);
  });

  router.post("/poll/:date", async (c) => {
    const date = c.req.param("date");
    const result = await deps.pollRuns.run(date, () => pollPaymentTokenDate({
      date,
      nexa: deps.nexa,
      cartera: deps.cartera,
      transactions: deps.transactions,
      tokenUsers: deps.tokenUsers,
    }));
    return c.json(result);
  });

  return router;
}
