import {
  pgTable,
  pgEnum,
  pgSchema,
  text,
  timestamp,
  boolean,
} from "drizzle-orm/pg-core";

// Enum para el rol de usuario
export const userRoleEnum = pgEnum("user_role", [
  "ADMIN",
  "INVESTOR",
  "DEBTOR",
  "SELLER",
  "CLIENT",
]);

// Schema personalizado para el auth-google
export const customSchema = pgSchema("auth-google");

// Tabla de usuarios
export const users = customSchema.table("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  name: text("name").notNull(),
  image: text("image"),
  password: text("password"),
  role: userRoleEnum("role").default("CLIENT").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Tabla de cuentas (conexiones con proveedores externos)
export const accounts = customSchema.table("accounts", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Tabla de sesiones
export const sessions = customSchema.table("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Tabla de tokens de verificación
export const verificationTokens = customSchema.table("verification_tokens", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  token: text("token"),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Tipos TypeScript inferidos del schema
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;

export type VerificationToken = typeof verificationTokens.$inferSelect;
export type NewVerificationToken = typeof verificationTokens.$inferInsert;
