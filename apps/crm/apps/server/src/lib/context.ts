import type { Context as HonoContext } from "hono";
import { auth } from "./auth";
import { partnerAuth } from "./partner-auth";

export type CreateContextOptions = {
	context: HonoContext;
};

type SesionCrm = Awaited<ReturnType<typeof auth.api.getSession>>;
type SesionSocio = Awaited<ReturnType<typeof partnerAuth.api.getSession>>;

/**
 * `partnerSession` es opcional a propósito: solo le importa a los
 * procedimientos del tracker, así que quien construya un contexto —tests
 * incluidos— no tiene por qué conocerla.
 */
export type Context = {
	session: SesionCrm;
	partnerSession?: SesionSocio;
	headers: Headers;
};

export async function createContext({
	context,
}: CreateContextOptions): Promise<Context> {
	const cookie = context.req.header("cookie") || "";
	const headers = context.req.raw.headers;

	// Las dos instancias usan prefijos de cookie distintos, así que solo se
	// consulta la que viene en la petición: nunca dos queries por request.
	const traeCookieDeSocio = cookie.includes("partner-auth.");
	const traeCookieDelCrm = cookie.includes("better-auth.");

	const [session, partnerSession] = await Promise.all([
		traeCookieDelCrm ? auth.api.getSession({ headers }) : null,
		traeCookieDeSocio ? partnerAuth.api.getSession({ headers }) : null,
	]);

	if (!session && traeCookieDelCrm) {
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
		partnerSession,
		headers,
	};
}
