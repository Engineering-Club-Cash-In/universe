import { ORPCError, os } from "@orpc/server";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { user } from "../db/schema/auth";
import type { Context } from "./context";
import { PERMISSIONS } from "./roles";

export const o = os.$context<Context>();

export const publicProcedure = o;

const requireAuth = o.middleware(async ({ context, next }) => {
	if (!context.session?.user) {
		throw new ORPCError("UNAUTHORIZED");
	}
	return next({
		context: {
			session: context.session,
		},
	});
});

const requireAdmin = o.middleware(async ({ context, next }) => {
	if (!context.session?.user) {
		throw new ORPCError("UNAUTHORIZED");
	}

	const userId = context.session.user.id;
	const userData = await db
		.select()
		.from(user)
		.where(eq(user.id, userId))
		.limit(1);
	const userRole = userData[0]?.role;

	if (!PERMISSIONS.canAccessAdmin(userRole)) {
		throw new ORPCError("FORBIDDEN", { message: "Admin role required" });
	}

	return next({
		context: {
			session: context.session,
			user: userData[0],
		},
	});
});

const requireCrmAccess = o.middleware(async ({ context, next }) => {
	if (!context.session?.user) {
		throw new ORPCError("UNAUTHORIZED");
	}

	const userId = context.session.user.id;
	const userData = await db
		.select()
		.from(user)
		.where(eq(user.id, userId))
		.limit(1);
	const userRole = userData[0]?.role;

	if (!PERMISSIONS.canAccessClients(userRole)) {
		throw new ORPCError("FORBIDDEN", { message: "CRM access role required" });
	}

	return next({
		context: {
			session: context.session,
			user: userData[0],
			userId,
			userRole,
		},
	});
});

const requireAnalyst = o.middleware(async ({ context, next }) => {
	if (!context.session?.user) {
		throw new ORPCError("UNAUTHORIZED");
	}

	const userId = context.session.user.id;
	const userData = await db
		.select()
		.from(user)
		.where(eq(user.id, userId))
		.limit(1);
	const userRole = userData[0]?.role;

	console.log("[requireAnalyst] userId:", userId);
	console.log("[requireAnalyst] userData:", userData);
	console.log("[requireAnalyst] userRole:", userRole);
	console.log(
		"[requireAnalyst] canAccessAnalysis:",
		PERMISSIONS.canAccessAnalysis(userRole || ""),
	);

	if (!userRole || !PERMISSIONS.canAccessAnalysis(userRole)) {
		console.log("[requireAnalyst] FORBIDDEN - userRole:", userRole);
		throw new ORPCError("FORBIDDEN", { message: "Analyst role required" });
	}

	return next({
		context: {
			session: context.session,
			user: userData[0],
			userId,
			userRole,
		},
	});
});

const requireCrmOrCobros = o.middleware(async ({ context, next }) => {
	if (!context.session?.user) {
		throw new ORPCError("UNAUTHORIZED");
	}

	const userId = context.session.user.id;
	const userData = await db
		.select()
		.from(user)
		.where(eq(user.id, userId))
		.limit(1);
	const userRole = userData[0]?.role;

	if (
		!PERMISSIONS.canAccessCRM(userRole) &&
		!PERMISSIONS.canAccessCobros(userRole)
	) {
		throw new ORPCError("FORBIDDEN", {
			message: "CRM or Cobros access required",
		});
	}

	return next({
		context: {
			session: context.session,
			user: userData[0],
			userId,
			userRole,
		},
	});
});

const requireCobros = o.middleware(async ({ context, next }) => {
	if (!context.session?.user) {
		throw new ORPCError("UNAUTHORIZED");
	}

	const userId = context.session.user.id;
	const userData = await db
		.select()
		.from(user)
		.where(eq(user.id, userId))
		.limit(1);
	const userRole = userData[0]?.role;

	if (!PERMISSIONS.canAccessCobros(userRole)) {
		throw new ORPCError("FORBIDDEN", { message: "Cobros role required" });
	}

	return next({
		context: {
			session: context.session,
			user: userData[0],
			userId,
			userRole,
		},
	});
});

const requireCobrosSupervisor = o.middleware(async ({ context, next }) => {
	if (!context.session?.user) {
		throw new ORPCError("UNAUTHORIZED");
	}

	const userId = context.session.user.id;
	const userData = await db
		.select()
		.from(user)
		.where(eq(user.id, userId))
		.limit(1);
	const userRole = userData[0]?.role;

	if (!PERMISSIONS.canAssignCobros(userRole)) {
		throw new ORPCError("FORBIDDEN", {
			message: "Cobros supervisor role required",
		});
	}

	return next({
		context: {
			session: context.session,
			user: userData[0],
			userId,
			userRole,
		},
	});
});

const requireViewOpportunityContracts = o.middleware(
	async ({ context, next }) => {
		if (!context.session?.user) {
			throw new ORPCError("UNAUTHORIZED");
		}

		const userId = context.session.user.id;
		const userData = await db
			.select()
			.from(user)
			.where(eq(user.id, userId))
			.limit(1);
		const userRole = userData[0]?.role;

		if (!PERMISSIONS.canViewOpportunityContracts(userRole)) {
			throw new ORPCError("FORBIDDEN", {
				message: "Cannot view opportunity contracts",
			});
		}

		return next({
			context: {
				session: context.session,
				user: userData[0],
				userId,
				userRole,
			},
		});
	},
);

const requireJuridico = o.middleware(async ({ context, next }) => {
	if (!context.session?.user) {
		throw new ORPCError("UNAUTHORIZED");
	}

	const userId = context.session.user.id;
	const userData = await db
		.select()
		.from(user)
		.where(eq(user.id, userId))
		.limit(1);
	const userRole = userData[0]?.role;

	if (!PERMISSIONS.canAccessJuridico(userRole)) {
		throw new ORPCError("FORBIDDEN", { message: "Juridico access required" });
	}

	return next({
		context: {
			session: context.session,
			user: userData[0],
			userId,
			userRole,
			// Agregar flags de permisos específicos al contexto
			canCreateLegalContracts: PERMISSIONS.canCreateLegalContracts(userRole),
			canAssignLegalContracts: PERMISSIONS.canAssignLegalContracts(userRole),
			canDeleteLegalContracts: PERMISSIONS.canDeleteLegalContracts(userRole),
		},
	});
});

const requireTallerOrigin = o.middleware(async ({ context, next }) => {
	const tallerUrl = process.env.TALLER_URL;
	const frontUrl = process.env.FRONT_URL;

	if (!tallerUrl && !frontUrl) {
		throw new ORPCError("INTERNAL_SERVER_ERROR", {
			message: "TALLER_URL or FRONT_URL not configured",
		});
	}

	const origin = context.headers.get("origin");
	const referer = context.headers.get("referer");

	// Verificar si la petición viene del taller o del front del CRM
	const isFromTaller =
		(tallerUrl &&
			(origin === tallerUrl ||
				referer?.startsWith(tallerUrl) ||
				referer?.startsWith(`${tallerUrl}/`))) ||
		(frontUrl &&
			(origin === frontUrl ||
				referer?.startsWith(frontUrl) ||
				referer?.startsWith(`${frontUrl}/`)));

	if (!isFromTaller) {
		throw new ORPCError("FORBIDDEN", {
			message: "Access denied - Invalid origin",
		});
	}

	return next({
		context,
	});
});

// Middleware que permite acceso desde taller (por origen) O desde CRM (por rol)
const requireTallerOrCrm = o.middleware(async ({ context, next }) => {
	const tallerUrl = process.env.TALLER_URL;
	const frontUrl = process.env.FRONT_URL;
	const origin = context.headers.get("origin");
	const referer = context.headers.get("referer");

	// Verificar si viene del taller
	const isFromTaller =
		(tallerUrl &&
			(origin === tallerUrl ||
				referer?.startsWith(tallerUrl) ||
				referer?.startsWith(`${tallerUrl}/`))) ||
		(frontUrl &&
			(origin === frontUrl ||
				referer?.startsWith(frontUrl) ||
				referer?.startsWith(`${frontUrl}/`)));

	if (isFromTaller) {
		return next({ context });
	}

	// Si no viene del taller, verificar si tiene acceso CRM
	if (!context.session?.user) {
		throw new ORPCError("UNAUTHORIZED");
	}

	const userId = context.session.user.id;
	const userData = await db
		.select()
		.from(user)
		.where(eq(user.id, userId))
		.limit(1);
	const userRole = userData[0]?.role;

	if (!PERMISSIONS.canAccessCRM(userRole)) {
		throw new ORPCError("FORBIDDEN", {
			message: "CRM or Taller access required",
		});
	}

	return next({
		context: {
			...context,
			user: userData[0],
			userId,
			userRole,
		},
	});
});

export const protectedProcedure = publicProcedure.use(requireAuth);
export const adminProcedure = publicProcedure.use(requireAdmin);
export const crmProcedure = publicProcedure.use(requireCrmAccess);
export const analystProcedure = publicProcedure.use(requireAnalyst);
export const crmOrCobrosProcedure = publicProcedure.use(requireCrmOrCobros);
export const cobrosProcedure = publicProcedure.use(requireCobros);
export const cobrosSupervisorProcedure = publicProcedure.use(
	requireCobrosSupervisor,
);
export const viewOpportunityContractsProcedure = publicProcedure.use(
	requireViewOpportunityContracts,
);
export const juridicoProcedure = publicProcedure.use(requireJuridico);
export const tallerProcedure = publicProcedure.use(requireTallerOrigin);
export const tallerOrCrmProcedure = publicProcedure.use(requireTallerOrCrm);
