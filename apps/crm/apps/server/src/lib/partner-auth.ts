import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { sql } from "drizzle-orm";
import { db } from "../db";
import * as schema from "../db/schema/auth";
import { ROLES } from "./roles";

export const PARTNER_AUTH_BASE_PATH = "/api/partner-auth";

/**
 * Instancia de auth para socios externos (predios y agencias).
 *
 * Vive en su propia ruta y con su propia cookie, separada de la del CRM, para
 * que un socio no tenga forma de autenticarse contra el CRM ni un empleado
 * contra el tracker. Comparte las tablas `user` y `account` a propósito: es lo
 * que permite darlos de alta desde el panel de admin como a cualquier otro
 * usuario. La tabla `session` también se comparte; el aislamiento real lo dan
 * las cookies distintas más el rol.
 *
 * `secret` y la configuración de hashing tienen que ser idénticos a los de
 * auth.ts, o una contraseña creada desde el panel del CRM no verificaría aquí.
 */
const soloSocios = createAuthMiddleware(async (ctx) => {
	if (ctx.path !== "/sign-in/email") return;

	const email = (ctx.body as { email?: unknown } | undefined)?.email;
	if (typeof email !== "string") return;

	const [cuenta] = await db
		.select({ role: schema.user.role, banned: schema.user.banned })
		.from(schema.user)
		.where(sql`lower(${schema.user.email}) = lower(${email})`)
		.limit(1);

	if (cuenta?.role !== ROLES.PARTNER) {
		throw new APIError("FORBIDDEN", {
			message: "Esta cuenta no pertenece a un predio o agencia",
		});
	}

	// Sin el plugin admin, better-auth no revisa `banned` por su cuenta.
	if (cuenta.banned) {
		throw new APIError("FORBIDDEN", {
			message: "Esta cuenta está suspendida",
		});
	}
});

export const partnerAuth = betterAuth({
	database: drizzleAdapter(db, {
		provider: "pg",
		schema: schema,
	}),
	basePath: PARTNER_AUTH_BASE_PATH,
	hooks: {
		before: soloSocios,
	},
	trustedOrigins: [process.env.TRACKER_URL].filter(
		(origin): origin is string => Boolean(origin && origin !== "*"),
	),
	advanced: {
		cookiePrefix: "partner-auth",
		useSecureCookies: true,
		defaultCookieAttributes: { sameSite: "none" as const, secure: true },
	},
	emailAndPassword: {
		enabled: true,
		requireEmailVerification: false,
		// Los socios se dan de alta solo desde el panel de admin. Sin esto,
		// cualquiera podría registrarse en /sign-up/email y, como esta instancia
		// no lleva el plugin admin que asigna rol, quedaría con el default de la
		// columna (sales) y con acceso al CRM.
		disableSignUp: true,
	},
	secret: process.env.BETTER_AUTH_SECRET,
	baseURL: process.env.BETTER_AUTH_URL,
});
