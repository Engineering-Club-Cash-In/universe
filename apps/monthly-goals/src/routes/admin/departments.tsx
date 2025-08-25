import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useRole } from '../../lib/auth/hooks'
import { getDepartments, createDepartment, updateDepartment, deleteDepartment } from '../../server/departments'
import { Plus, Edit2, Trash2, Users, Building } from 'lucide-react'
import type { Department, DepartmentWithDetails, CreateDepartmentInput, UpdateDepartmentInput, DeleteDepartmentInput } from '../../types/departments'

export const Route = createFileRoute('/admin/departments')({
  component: DepartmentsPage,
})

function DepartmentsPage() {
  const { isAdmin } = useRole()
  const queryClient = useQueryClient()
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [editingDepartment, setEditingDepartment] = useState<{ id: string; name: string; description?: string } | null>(null)

  const { data: departments, isLoading } = useQuery<DepartmentWithDetails[]>({
    queryKey: ['departments'],
    queryFn: async () => getDepartments(),
  })

  const createMutation = useMutation<Department, Error, CreateDepartmentInput>({
    mutationFn: async (data) => createDepartment({ data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['departments'] })
      setIsCreateModalOpen(false)
    },
  })

  const updateMutation = useMutation<Department, Error, UpdateDepartmentInput>({
    mutationFn: async (data) => updateDepartment({ data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['departments'] })
      setEditingDepartment(null)
    },
  })

  const deleteMutation = useMutation<{ success: boolean }, Error, DeleteDepartmentInput>({
    mutationFn: async (data) => deleteDepartment({ data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['departments'] })
    },
  })

  if (!isAdmin) {
    return (
      <div className="p-8">
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
          No tienes permisos para acceder a esta página
        </div>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="p-8">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-1/4 mb-4"></div>
          <div className="space-y-3">
            <div className="h-20 bg-gray-200 rounded"></div>
            <div className="h-20 bg-gray-200 rounded"></div>
            <div className="h-20 bg-gray-200 rounded"></div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Departamentos</h1>
        <button
          onClick={() => setIsCreateModalOpen(true)}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition"
        >
          <Plus className="w-5 h-5" />
          Nuevo Departamento
        </button>
      </div>

      <div className="grid gap-4">
        {departments?.map((dept) => (
          <div key={dept.id} className="bg-white rounded-lg shadow p-6">
            <div className="flex justify-between items-start">
              <div className="flex-1">
                <h3 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
                  <Building className="w-5 h-5 text-gray-500" />
                  {dept.name}
                </h3>
                {dept.description && (
                  <p className="text-gray-600 mt-1">{dept.description}</p>
                )}
                <div className="flex gap-4 mt-3 text-sm text-gray-500">
                  <span className="flex items-center gap-1">
                    <Users className="w-4 h-4" />
                    {dept.areasCount || 0} áreas
                  </span>
                  <span className="flex items-center gap-1">
                    <Users className="w-4 h-4" />
                    {dept.membersCount || 0} miembros
                  </span>
                  {dept.managerName && (
                    <span>Gerente: {dept.managerName}</span>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setEditingDepartment({ 
                    id: dept.id, 
                    name: dept.name, 
                    description: dept.description || undefined 
                  })}
                  className="p-2 text-gray-600 hover:bg-gray-100 rounded"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => {
                    if (confirm(`¿Estás seguro de eliminar el departamento ${dept.name}?`)) {
                      deleteMutation.mutate({ id: dept.id })
                    }
                  }}
                  className="p-2 text-red-600 hover:bg-red-50 rounded"
                  disabled={dept.areasCount ? dept.areasCount > 0 : false}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Create Modal */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-xl font-semibold mb-4">Crear Departamento</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                const formData = new FormData(e.currentTarget)
                const name = formData.get('name') as string
                const description = formData.get('description') as string
                createMutation.mutate({
                  name,
                  description: description || undefined,
                })
              }}
            >
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Nombre
                  </label>
                  <input
                    name="name"
                    type="text"
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Descripción
                  </label>
                  <textarea
                    name="description"
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {createMutation.isPending ? 'Creando...' : 'Crear'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editingDepartment && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-xl font-semibold mb-4">Editar Departamento</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                const formData = new FormData(e.currentTarget)
                const name = formData.get('name') as string
                const description = formData.get('description') as string
                updateMutation.mutate({
                  id: editingDepartment.id,
                  name,
                  description: description || undefined,
                })
              }}
            >
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Nombre
                  </label>
                  <input
                    name="name"
                    type="text"
                    defaultValue={editingDepartment.name}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Descripción
                  </label>
                  <textarea
                    name="description"
                    defaultValue={editingDepartment.description}
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => setEditingDepartment(null)}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={updateMutation.isPending}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {updateMutation.isPending ? 'Guardando...' : 'Guardar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}