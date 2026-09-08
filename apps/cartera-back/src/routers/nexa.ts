import { Elysia } from "elysia";

type NexaHandler = (context: {
  request: Request;
  body: unknown;
  set: { status?: number | string };
}) => unknown | Promise<unknown>;

export const createNexaInternalRouter = (
  environment: string,
  handler: NexaHandler,
) => {
  const router = new Elysia();
  return ["dev", "development", "qa"].includes(environment.toLowerCase())
    ? router.post("/internal/nexa/payments/apply", handler, { parse: "none" })
    : router;
};
