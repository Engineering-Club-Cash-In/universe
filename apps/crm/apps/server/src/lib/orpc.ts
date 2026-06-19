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

const getSessionUser = async (context: Context) => {
	if (!context.session?.user) {
		throw new ORPCError("UNAUTHORIZED");
	}

	const userId = context.session.user.id;
	const userData = await db
		.select()
		.from(user)
		.where(eq(user.id, userId))
		.limit(1);
	const currentUser = userData[0];

	return {
		currentUser,
		session: context.session,
		userId,
		userRole: currentUser?.role,
	};
};

const requirePermission = (
	canAccess: (role: string) => boolean,
	message: string,
) =>
	o.middleware(async ({ context, next }) => {
		const { currentUser, session, userId, userRole } = await getSessionUser(
			context,
		);

		if (!canAccess(userRole ?? "")) {
			throw new ORPCError("FORBIDDEN", { message });
		}

		return next({
			context: {
				...context,
				session,
				user: currentUser,
				userId,
				userRole,
			},
		});
	});

const requireAdmin = requirePermission(
	PERMISSIONS.canAccessAdmin,
	"Admin role required",
);

const requireCrmAccess = requirePermission(
	PERMISSIONS.canAccessClients,
	"CRM access role required",
);

const requireAnalyst = requirePermission(
	PERMISSIONS.canAccessAnalysis,
	"Analyst role required",
);

const requireCrmOrCobros = requirePermission(
	(role) => PERMISSIONS.canAccessCRM(role) || PERMISSIONS.canAccessCobros(role),
	"CRM or Cobros access required",
);

const requireCrmCobrosOrInvestments = requirePermission(
	(role) =>
		PERMISSIONS.canAccessCRM(role) ||
		PERMISSIONS.canAccessCobros(role) ||
		PERMISSIONS.canAccessInvestments(role) ||
		PERMISSIONS.canAccessAccounting(role),
	"CRM, Cobros, Investments or Accounting access required",
);

const requireCobros = requirePermission(
	PERMISSIONS.canAccessCobros,
	"Cobros role required",
);

const requireCobrosSupervisor = requirePermission(
	PERMISSIONS.canAssignCobros,
	"Cobros supervisor role required",
);

const requireClosedCreditsReport = requirePermission(
	PERMISSIONS.canAccessClosedCreditsReport,
	"Closed credits report access required",
);

const requireTiempoCierreReport = requirePermission(
	PERMISSIONS.canAccessTiempoCierreReport,
	"Tiempo cierre report access required",
);

const requirePorcentajeEfectividadReport = requirePermission(
	PERMISSIONS.canAccessPorcentajeEfectividadReport,
	"Porcentaje efectividad report access required",
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

const requireViewOpportunityContracts = requirePermission(
	PERMISSIONS.canViewOpportunityContracts,
	"Cannot view opportunity contracts",
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

const requireTallerAccess = requirePermission(
	PERMISSIONS.canAccessTaller,
	"Taller access required",
);

// Middleware que permite acceso autenticado desde Taller O desde CRM por rol.
const requireTallerOrCrm = requirePermission(
	(role) => PERMISSIONS.canAccessCRM(role) || PERMISSIONS.canAccessTaller(role),
	"CRM or Taller access required",
);

const requireVehicleAccess = requirePermission(
	PERMISSIONS.canAccessVehicles,
	"Se requiere acceso a vehículos",
);

const requireInvestmentAccess = requirePermission(
	PERMISSIONS.canAccessInvestments,
	"Se requiere acceso al modulo de inversiones",
);

const requireInvestmentManager = requirePermission(
	PERMISSIONS.canValidateInvestmentFunds,
	"Se requiere rol de gerente de inversiones",
);

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
