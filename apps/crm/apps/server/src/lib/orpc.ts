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

const requireCrmCobrosOrInvestments = o.middleware(
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

		if (
			!PERMISSIONS.canAccessCRM(userRole) &&
			!PERMISSIONS.canAccessCobros(userRole) &&
			!PERMISSIONS.canAccessInvestments(userRole) &&
			!PERMISSIONS.canAccessAccounting(userRole)
		) {
			throw new ORPCError("FORBIDDEN", {
				message: "CRM, Cobros, Investments or Accounting access required",
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

const requireClosedCreditsReport = o.middleware(async ({ context, next }) => {
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

	if (!PERMISSIONS.canAccessClosedCreditsReport(userRole)) {
		throw new ORPCError("FORBIDDEN", {
			message: "Closed credits report access required",
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

const requireTiempoCierreReport = o.middleware(async ({ context, next }) => {
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

	if (!PERMISSIONS.canAccessTiempoCierreReport(userRole)) {
		throw new ORPCError("FORBIDDEN", {
			message: "Tiempo cierre report access required",
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
const requirePorcentajeEfectividadReport = o.middleware(
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

		if (!PERMISSIONS.canAccessPorcentajeEfectividadReport(userRole)) {
			throw new ORPCError("FORBIDDEN", {
				message: "Porcentaje efectividad report access required",
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
const requireMetaColocacionReport = o.middleware(async ({ context, next }) => {
	if (!context.session?.user) {
		throw new ORPCError("UNAUTHORIZED");
	}

	const userId = context.session.user.id;
	const userRole = context.session.user.role ?? "";

	if (!PERMISSIONS.canAccessMetaColocacionReport(userRole)) {
		throw new ORPCError("FORBIDDEN", {
			message: "Meta colocación report access required",
		});
	}

	return next({
		context: {
			session: context.session,
			userId,
			userRole,
		},
	});
});

const requireEfectividadPorEtapaReport = o.middleware(
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

		if (!PERMISSIONS.canAccessEfectividadPorEtapaReport(userRole)) {
			throw new ORPCError("FORBIDDEN", {
				message: "Efectividad por etapa report access required",
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

const requireTallerAccess = o.middleware(async ({ context, next }) => {
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

	if (!userRole || !PERMISSIONS.canAccessTaller(userRole)) {
		throw new ORPCError("FORBIDDEN", {
			message: "Taller access required",
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

// Middleware que permite acceso autenticado desde Taller O desde CRM por rol.
const requireTallerOrCrm = o.middleware(async ({ context, next }) => {
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
	const hasAccess =
		!!userRole &&
		(PERMISSIONS.canAccessCRM(userRole) ||
			PERMISSIONS.canAccessTaller(userRole));

	if (!hasAccess) {
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

const requireVehicleAccess = o.middleware(async ({ context, next }) => {
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

	if (!userRole || !PERMISSIONS.canAccessVehicles(userRole)) {
		throw new ORPCError("FORBIDDEN", {
			message: "Se requiere acceso a vehículos",
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

const requireInvestmentAccess = o.middleware(async ({ context, next }) => {
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

	if (!PERMISSIONS.canAccessInvestments(userRole)) {
		throw new ORPCError("FORBIDDEN", {
			message: "Se requiere acceso al modulo de inversiones",
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

const requireInvestmentManager = o.middleware(async ({ context, next }) => {
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

	if (!PERMISSIONS.canValidateInvestmentFunds(userRole)) {
		throw new ORPCError("FORBIDDEN", {
			message: "Se requiere rol de gerente de inversiones",
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

export const protectedProcedure = publicProcedure.use(requireAuth);
export const adminProcedure = publicProcedure.use(requireAdmin);
export const crmProcedure = publicProcedure.use(requireCrmAccess);
export const analystProcedure = publicProcedure.use(requireAnalyst);
export const crmOrCobrosProcedure = publicProcedure.use(requireCrmOrCobros);
export const crmCobrosOrInvestmentsProcedure = publicProcedure.use(
	requireCrmCobrosOrInvestments,
);
export const cobrosProcedure = publicProcedure.use(requireCobros);
export const cobrosSupervisorProcedure = publicProcedure.use(
	requireCobrosSupervisor,
);
export const closedCreditsReportProcedure = publicProcedure.use(
	requireClosedCreditsReport,
);
export const tiempoCierreReportProcedure = publicProcedure.use(
	requireTiempoCierreReport,
);
export const porcentajeEfectividadReportProcedure = publicProcedure.use(
	requirePorcentajeEfectividadReport,
);
export const metaColocacionReportProcedure = publicProcedure.use(
	requireMetaColocacionReport,
);
export const efectividadPorEtapaReportProcedure = publicProcedure.use(
	requireEfectividadPorEtapaReport,
);
export const viewOpportunityContractsProcedure = publicProcedure.use(
	requireViewOpportunityContracts,
);
export const juridicoProcedure = publicProcedure.use(requireJuridico);
export const tallerProcedure = publicProcedure.use(requireTallerAccess);
export const tallerOrCrmProcedure = publicProcedure.use(requireTallerOrCrm);
export const vehiclesProcedure = publicProcedure.use(requireVehicleAccess);
export const investmentProcedure = publicProcedure.use(requireInvestmentAccess);
export const investmentManagerProcedure = publicProcedure.use(
	requireInvestmentManager,
);
