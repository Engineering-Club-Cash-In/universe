import { Elysia } from "elysia";

export const healthRouter = new Elysia().get("/health", () => ({
	status: "ok" as const,
}));
