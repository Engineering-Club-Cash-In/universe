import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { admin } from 'better-auth/plugins'
import { db } from '../db/client'
import { ac, roles } from './permissions'

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
  }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false, // Para desarrollo
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 1 semana
    updateAge: 60 * 60 * 24,      // 1 día
    cookieName: 'monthly-goals-session',
  },
  trustedOrigins: ['http://localhost:3000'],
  basePath: '/api/auth',
  plugins: [
    admin({
      ac,
      roles,
      defaultRole: 'employee',
    }),
  ],
})