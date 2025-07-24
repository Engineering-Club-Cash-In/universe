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

export const analystRole = ac.newRole({
	user: ["read"],
	lead: ["read"],
	report: ["read", "export"],
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
				analyst: analystRole,
			},
		}),
	],
	trustedOrigins: [process.env.CORS_ORIGIN || ""],
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
