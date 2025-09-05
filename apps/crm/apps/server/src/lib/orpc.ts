import { ORPCError, os } from "@orpc/server";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { user } from "../db/schema/auth";
import type { Context } from "./context";
import { ROLES, PERMISSIONS } from "./roles";

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

	if (!PERMISSIONS.canAccessCRM(userRole)) {
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

	if (!userRole || !PERMISSIONS.canAccessAnalysis(userRole)) {
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

export const protectedProcedure = publicProcedure.use(requireAuth);
export const adminProcedure = publicProcedure.use(requireAdmin);
export const crmProcedure = publicProcedure.use(requireCrmAccess);
export const analystProcedure = publicProcedure.use(requireAnalyst);
export const cobrosProcedure = publicProcedure.use(requireCobros);
