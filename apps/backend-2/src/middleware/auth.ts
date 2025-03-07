import { Elysia } from "elysia";
import { verifyToken } from "../controllers/auth";

export const authMiddleware = new Elysia().derive(async ({ request }) => {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new Error("Unauthorized");
  }

  const token = authHeader.split(" ")[1];
  try {
    const user = await verifyToken(token);
    return { user };
  } catch (error) {
    throw new Error("Invalid token");
  }
});
