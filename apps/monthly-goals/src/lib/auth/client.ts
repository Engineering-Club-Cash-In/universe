import { createAuthClient } from 'better-auth/react'
import { adminClient } from 'better-auth/client/plugins'

export const authClient = createAuthClient({
  baseURL: '/api/auth',
  plugins: [
    adminClient(),
  ],
})

export const {
  signIn,
  signUp,
  signOut,
  useSession,
} = authClient

// Helper types
export type User = {
  id: string
  email: string
  name: string
  role: 'superAdmin' | 'manager' | 'employee' | 'viewer'
  createdAt: Date
  updatedAt: Date
}

export type Session = {
  user: User
  expiresAt: Date
}