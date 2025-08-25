import { auth } from '../lib/auth/config'

// This creates a catch-all route for /api/auth/*
export const loader = async ({ request }: { request: Request }) => {
  return auth.handler(request)
}