import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins";
import { createAccessControl } from "better-auth/plugins/access";
import { db } from "../db";
import * as schema from "../db/schema/auth";

// Create access control for custom roles
const statement = {
	user: ["read", "update"],
	lead: ["create", "read", "update", "delete"],
	report: ["read", "export"],
} as const;

const ac = createAccessControl(statement);

export const adminRole = ac.newRole({
	user: ["read", "update"],
	lead: ["create", "read", "update", "delete"],
	report: ["read", "export"],
});

export const salesRole = ac.newRole({
	user: ["read", "update"],
	lead: ["create", "read", "update"],
	report: ["read"],
});

export const salesSupervisorRole = ac.newRole({
	user: ["read", "update"],
	lead: ["create", "read", "update", "delete"],
	report: ["read", "export"],
});

export const analystRole = ac.newRole({
	user: ["read"],
	lead: ["read"],
	report: ["read", "export"],
});

export const cobrosRole = ac.newRole({
	user: ["read"],
	lead: ["read"],
	report: ["read"],
});

export const cobrosSupervisorRole = ac.newRole({
	user: ["read", "update"],
	lead: ["read"],
	report: ["read", "export"],
});

export const juridicoRole = ac.newRole({
	user: ["read"],
	lead: ["read"],
	report: ["read"],
});

export const accountRole = ac.newRole({
	user: ["read"],
	lead: ["read"],
	report: ["read"],
});

export const investmentAdvisorJrRole = ac.newRole({
	user: ["read"],
	lead: ["create", "read", "update"],
	report: ["read"],
});

export const investmentAdvisorSrRole = ac.newRole({
	user: ["read"],
	lead: ["create", "read", "update"],
	report: ["read", "export"],
});

export const investmentManagerRole = ac.newRole({
	user: ["read", "update"],
	lead: ["create", "read", "update", "delete"],
	report: ["read", "export"],
});

export const serviceCenterManagerRole = ac.newRole({
	user: ["read"],
	lead: ["read"],
	report: ["read"],
});

export const vehicleVerifierRole = ac.newRole({
	user: ["read"],
	lead: ["read"],
	report: ["read"],
});

export const auth = betterAuth({
	database: drizzleAdapter(db, {
		provider: "pg",
		schema: schema,
	}),
	plugins: [
		admin({
			ac,
			roles: {
				admin: adminRole,
				sales: salesRole,
				sales_supervisor: salesSupervisorRole,
				analyst: analystRole,
				cobros: cobrosRole,
				cobros_supervisor: cobrosSupervisorRole,
				juridico: juridicoRole,
				accounting: accountRole,
				investment_advisor_jr: investmentAdvisorJrRole,
				investment_advisor_sr: investmentAdvisorSrRole,
				investment_manager: investmentManagerRole,
				service_center_manager: serviceCenterManagerRole,
				vehicle_verifier: vehicleVerifierRole,
			},
			schema: {
				user: {
					fields: {
						banned: "banned",
						banReason: "ban_reason",
						banExpires: "ban_expires",
					},
				},
				session: {
					fields: {
						impersonatedBy: "impersonated_by",
					},
				},
			},
		}),
	],
	trustedOrigins: [
		process.env.CORS_ORIGIN,
		process.env.FRONT_URL,
		process.env.TALLER_URL,
	].filter((origin): origin is string => Boolean(origin && origin !== "*")),
	advanced: {
		useSecureCookies: true,
		defaultCookieAttributes: { sameSite: "none" as const, secure: true },
	},
	emailAndPassword: {
		enabled: true,
		requireEmailVerification: false,
	},
	onSignUp: async (data: any) => {
		const email = data.user.email;
		if (!email.endsWith("@clubcashin.com")) {
			throw new Error(
				"Only @clubcashin.com email addresses are allowed to sign up",
			);
		}
	},
	socialProviders: {
		google: {
			clientId: process.env.GOOGLE_CLIENT_ID || "",
			clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
			enabled: true,
		},
	},
	onOAuthAccountLinked: async (data: any) => {
		const email = data.user.email;
		if (!email.endsWith("@clubcashin.com")) {
			throw new Error(
				"Only @clubcashin.com email addresses are allowed to sign up",
			);
		}
	},
	secret: process.env.BETTER_AUTH_SECRET,
	baseURL: process.env.BETTER_AUTH_URL,
});
