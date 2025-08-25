import { useSession } from './client'
import type { User } from './client'

export function useAuth() {
  const session = useSession()
  
  const user = session.data?.user ? {
    id: session.data.user.id,
    email: session.data.user.email,
    name: session.data.user.name,
    role: (session.data.user as { role?: string }).role || 'employee' as User['role'],
    createdAt: session.data.user.createdAt,
    updatedAt: session.data.user.updatedAt,
  } : null
  
  return {
    user,
    isLoading: session.isPending,
    isAuthenticated: !!session.data?.user,
    error: session.error,
  }
}

export function useRole() {
  const { user } = useAuth()
  
  return {
    role: user?.role,
    isAdmin: user?.role === 'superAdmin',
    isManager: user?.role === 'manager',
    isEmployee: user?.role === 'employee',
    isViewer: user?.role === 'viewer',
    canManageDepartment: user?.role && ['superAdmin', 'manager'].includes(user.role),
    canManageAllGoals: user?.role === 'superAdmin',
    canCreatePresentation: user?.role && ['superAdmin', 'manager'].includes(user.role),
  }
}

export function useRequireAuth(redirectTo = '/login') {
  const { isAuthenticated, isLoading } = useAuth()
  
  if (!isLoading && !isAuthenticated && typeof window !== 'undefined') {
    window.location.href = redirectTo
  }
  
  return { isAuthenticated, isLoading }
}