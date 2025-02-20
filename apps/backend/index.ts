import { publicProcedureWithLogger, router } from "./trpc";
import { createHTTPServer } from "@trpc/server/adapters/standalone";
import {
  checkCreditRecordRouter,
  getRenapDataRouter,
  pollCreditRecordRouter,
  submitContactFormRouter,
  submitLeadRouter,
} from "./routers/landing";
import cors from "cors";

const appRouter = router({
  hello: publicProcedureWithLogger.query(() => "Hello World"),
  submitContactForm: submitContactFormRouter,
  getRenapData: getRenapDataRouter,
  getCreditRecord: checkCreditRecordRouter,
  submitLead: submitLeadRouter,
  pollCreditRecord: pollCreditRecordRouter,
});

export type AppRouter = typeof appRouter;

const server = createHTTPServer({
  router: appRouter,
  middleware: cors(),
});
server.on("listening", () => {
  console.log("Server is listening on port 9000");
});
server.listen(9000);
