import type { Context as HonoContext } from "hono";
import { auth } from "./auth";

export type CreateContextOptions = {
	context: HonoContext;
};

export async function createContext({ context }: CreateContextOptions) {
	const session = await auth.api.getSession({
		headers: context.req.raw.headers,
	});
	const cookie = context.req.header("cookie") || "";
	if (!session && cookie.includes("better-auth")) {
		console.warn(
			"CRM_AUTH_DIAG",
			JSON.stringify({
				hasCookie: true,
				origin: context.req.header("origin") || null,
				path: context.req.path,
				reason: "rpc-session-null-with-cookie",
				timestamp: new Date().toISOString(),
				userAgent: context.req.header("user-agent") || null,
			}),
		);
	}
	return {
		session,
		headers: context.req.raw.headers,
	};
}

export type Context = Awaited<ReturnType<typeof createContext>>;
