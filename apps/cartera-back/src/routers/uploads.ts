import { Elysia } from "elysia";
import { uploadFileController } from "../utils/functions/uploadsFiles";
import { authMiddleware } from "./midleware";

export const uploadRouter = new Elysia()
  .use(authMiddleware)
  .post("/upload", uploadFileController);
