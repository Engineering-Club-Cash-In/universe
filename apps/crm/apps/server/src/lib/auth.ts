
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "../db";
import * as schema from "../db/schema/auth";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    
    
    schema: schema,
  }),
  trustedOrigins: [
    process.env.CORS_ORIGIN || "",
  ],
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
  },
  onSignUp: async (data: any) => {
    const email = data.user.email;
    if (!email.endsWith('@clubcashin.com')) {
      throw new Error('Only @clubcashin.com email addresses are allowed to sign up');
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
    if (!email.endsWith('@clubcashin.com')) {
      throw new Error('Only @clubcashin.com email addresses are allowed to sign up');
    }
  },
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
});



