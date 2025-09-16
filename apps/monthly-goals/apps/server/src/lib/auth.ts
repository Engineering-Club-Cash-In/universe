import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins";
import { db } from "../db";
import * as schema from "../db/schema/auth";

export const auth = betterAuth({
	logger: {
		disabled: false,
		level: "debug",
		log: (level, message, ...args) => {
			console.log(`[${level}] ${message}`, ...args);
		}
	},
	database: drizzleAdapter(db, {
		provider: "pg",
		schema: schema,
	}),
	trustedOrigins: [process.env.CORS_ORIGIN || ""],
	emailAndPassword: {
		enabled: true,
	},
	plugins: [
		admin({
			defaultRole: "employee",
			adminRoles: ["super_admin"],
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
	user: {
		additionalFields: {
			role: {
				type: "string",
				required: true,
				defaultValue: "employee",
				input: true,
			},
		},
	},
	advanced: {
		defaultCookieAttributes: {
			sameSite: "none",
			secure: true,
			httpOnly: true,
		},
	},
});
