import { adminClient } from "better-auth/client/plugins";
import { createAccessControl } from "better-auth/plugins/access";
import { createAuthClient } from "better-auth/react";
import { logAuthDiagnostic } from "./auth-session";

// Create access control matching server configuration
const statement = {
	user: ["read", "update"],
	lead: ["create", "read", "update", "delete"],
	report: ["read", "export"],
} as const;

const ac = createAccessControl(statement);

const adminRole = ac.newRole({
	user: ["read", "update"],
	lead: ["create", "read", "update", "delete"],
	report: ["read", "export"],
});

const salesRole = ac.newRole({
	user: ["read", "update"],
	lead: ["create", "read", "update"],
	report: ["read"],
});

const analystRole = ac.newRole({
	user: ["read"],
	lead: ["read"],
	report: ["read", "export"],
});

const cobrosRole = ac.newRole({
	user: ["read"],
	lead: ["read"],
	report: ["read"],
});

export const authClient = createAuthClient({
	baseURL: import.meta.env.VITE_SERVER_URL,
	fetchOptions: {
		onError: (context: unknown) => {
			const authError = context as {
				error?: {
					message?: string;
					status?: number;
					statusText?: string;
				};
				request?: { url?: string | URL };
				response?: { status?: number; statusText?: string };
			};
			logAuthDiagnostic({
				detail: {
					message: authError.error?.message,
					path: authError.request?.url?.toString(),
					status: authError.error?.status ?? authError.response?.status,
					statusText:
						authError.error?.statusText ?? authError.response?.statusText,
				},
				reason: "better-auth-client-error",
			});
		},
	},
	plugins: [
		adminClient({
			ac,
			roles: {
				admin: adminRole,
				sales: salesRole,
				analyst: analystRole,
				cobros: cobrosRole,
			},
		}),
	],
});
