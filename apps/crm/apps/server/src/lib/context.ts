import type { Context as HonoContext } from "hono";
import { auth } from "./auth";
import { partnerAuth } from "./partner-auth";
import { ROLES } from "./roles";

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

	const [sessionCruda, partnerSession] = await Promise.all([
		traeCookieDelCrm ? auth.api.getSession({ headers }) : null,
		traeCookieDeSocio ? partnerAuth.api.getSession({ headers }) : null,
	]);

	// Las dos instancias comparten la tabla `session` y el secreto, así que un
	// token de socio renombrado a la cookie del CRM resuelve como sesión válida.
	// `protectedProcedure` no mira roles, de modo que sin esto un socio alcanzaría
	// todas esas rutas. El descarte va aquí porque es el único punto por el que
	// pasan tanto el RPC como las rutas REST.
	const session =
		sessionCruda?.user?.role === ROLES.PARTNER ? null : sessionCruda;

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
