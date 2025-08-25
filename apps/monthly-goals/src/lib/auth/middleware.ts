import { auth } from './config'
import type { User } from './client'
import { getWebRequest } from '@tanstack/start/server'

export async function getServerSession() {
  const request = getWebRequest()
  const session = await auth.api.getSession({ headers: request.headers })
  return session
}

export async function requireAuth() {
  const session = await getServerSession()
  
  if (!session) {
    throw new Response('Unauthorized', { status: 401 })
  }
  
  return session
}

export async function requireRole(allowedRoles: Array<User['role']>) {
  const session = await requireAuth()
  const userRole = ((session.user as { role?: string }).role || 'employee') as User['role']
  
  if (!allowedRoles.includes(userRole)) {
    throw new Response('Forbidden', { status: 403 })
  }
  
  return session
}

// Helper para verificar permisos
export const permissions = {
  canManageDepartment: (role: User['role']) => 
    ['superAdmin', 'manager'].includes(role),
  
  canManageAllGoals: (role: User['role']) => 
    role === 'superAdmin',
  
  canCreatePresentation: (role: User['role']) => 
    ['superAdmin', 'manager'].includes(role),
  
  canViewAllData: (role: User['role']) => 
    ['superAdmin', 'manager', 'viewer'].includes(role),
}