import { createFileRoute, Outlet } from '@tanstack/react-router'
import { useRole } from '../lib/auth/hooks'

export const Route = createFileRoute('/admin')({
  beforeLoad: async () => {
    // Authentication will be checked in component
  },
  component: AdminLayout,
})

function AdminLayout() {
  const { isAdmin, isManager } = useRole()
  
  if (!isAdmin && !isManager) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-red-50 border border-red-200 text-red-700 px-6 py-4 rounded-lg">
          <h2 className="text-lg font-semibold">Acceso denegado</h2>
          <p className="mt-1">No tienes permisos para acceder al panel de administración.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex">
              <div className="flex-shrink-0 flex items-center">
                <h1 className="text-xl font-semibold">Panel de Administración</h1>
              </div>
              <div className="hidden sm:ml-6 sm:flex sm:space-x-8">
                <a
                  href="/admin/departments"
                  className="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium"
                >
                  Departamentos
                </a>
                <a
                  href="/admin/areas"
                  className="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium"
                >
                  Áreas
                </a>
                <a
                  href="/admin/teams"
                  className="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium"
                >
                  Equipos
                </a>
              </div>
            </div>
          </div>
        </div>
      </nav>
      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <Outlet />
      </main>
    </div>
  )
}