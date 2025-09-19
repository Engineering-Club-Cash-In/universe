import { Elysia } from "elysia";
import { uploadFileController } from "../utils/functions/uploadsFiles";
 

export const uploadRouter = (app: Elysia) =>
  app.post("/upload", uploadFileController);
