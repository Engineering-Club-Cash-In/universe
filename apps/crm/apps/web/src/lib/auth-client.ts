import { createAuthClient } from "better-auth/react";
import { adminClient } from "better-auth/client/plugins";
import { createAccessControl } from "better-auth/plugins/access";

// Create access control matching server configuration
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

export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_SERVER_URL,
  plugins: [
    adminClient({
      ac,
      roles: {
        admin: adminRole,
        sales: salesRole,
      }
    })
  ]
});
