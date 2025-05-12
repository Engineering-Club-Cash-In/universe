import { Elysia } from "elysia";
import { swagger } from "@elysiajs/swagger";
import { cors } from "@elysiajs/cors";
import { opentelemetry } from "@elysiajs/opentelemetry";
import landingRouter from "./routers/landing";
import authRouter from "./routers/auth";
import crmRouter from "./routers/crm";
import signaturesRouter from "./routers/signatures";
import simpletechRouter from "./routers/simpletech";

const app = new Elysia()
  .use(opentelemetry())
  .use(cors())
  .use(swagger())
  .onError(({ error, code }) => {
    if (code === "NOT_FOUND") return;
    console.error(error);
  })
  .use(landingRouter)
  .use(authRouter)
  .use(crmRouter)
  .use(signaturesRouter)
  .use(simpletechRouter)
  .get("/", () => "Hello Elysia")
  .listen(9000);

export type App = typeof app;
console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
);
