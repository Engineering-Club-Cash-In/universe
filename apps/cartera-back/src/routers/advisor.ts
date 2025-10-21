// routes/inversionistas.ts
import { Elysia } from "elysia";
import {
  getAdvisors,
  insertAdvisor,
  updateAdvisor,
} from "../controllers/advisor";
import { authMiddleware } from "./midleware";

export const advisorRouter = new Elysia()
.use(authMiddleware) 
  .post("/advisor", insertAdvisor)
  .post("/updateAdvisor", updateAdvisor)
  .get("/advisor", getAdvisors);
