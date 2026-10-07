import { Elysia } from "elysia";

type NexaHandler = (context: {
  request: Request;
  body: unknown;
  set: { status?: number | string };
}) => unknown | Promise<unknown>;

export const createNexaInternalRouter = (
  environment: string,
  enabled: boolean,
  handler: NexaHandler,
  tokenHandler: NexaHandler,
) => {
  const router = new Elysia();
  return enabled && ["dev", "development", "qa", "production"].includes(environment.toLowerCase())
    ? router
        .post("/internal/nexa/payments/apply", handler, { parse: "none" })
        .post("/internal/nexa/tokens", tokenHandler, { parse: "none" })
    : router;
};
