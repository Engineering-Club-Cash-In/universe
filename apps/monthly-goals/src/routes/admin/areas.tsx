import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useRole } from '../../lib/auth/hooks'
import { getAreas, getAreasByDepartment, createArea, updateArea, deleteArea } from '../../server/areas'
import { getDepartments } from '../../server/departments'
import { Plus, Edit2, Trash2, Users, Building, Building2, User } from 'lucide-react'
import type { Area, AreaWithDetails, CreateAreaInput, UpdateAreaInput, DeleteAreaInput } from '../../types/areas'
import type { Department } from '../../types/departments'

export const Route = createFileRoute('/admin/areas')({
  component: AreasPage,
})

function AreasPage() {
  const { isAdmin, isManager } = useRole()
  const queryClient = useQueryClient()
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [editingArea, setEditingArea] = useState<{ id: string; name: string; description?: string; leadId?: string } | null>(null)
  const [selectedDepartment, setSelectedDepartment] = useState<string>('')

  const { data: departments } = useQuery<Department[]>({
    queryKey: ['departments'],
    queryFn: async () => getDepartments(),
  })

  const { data: areas, isLoading } = useQuery({
    queryKey: ['areas', selectedDepartment],
    queryFn: async () => {
      if (selectedDepartment) {
        return getAreasByDepartment({ data: { departmentId: selectedDepartment } })
      }
      return getAreas()
    },
  })

  const createMutation = useMutation<Area, Error, CreateAreaInput>({
    mutationFn: async (data) => createArea({ data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['areas'] })
      setIsCreateModalOpen(false)
    },
  })

  const updateMutation = useMutation<Area, Error, UpdateAreaInput>({
    mutationFn: async (data) => updateArea({ data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['areas'] })
      setEditingArea(null)
    },
  })

  const deleteMutation = useMutation<{ success: boolean }, Error, DeleteAreaInput>({
    mutationFn: async (data) => deleteArea({ data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['areas'] })
    },
  })

  if (!isAdmin && !isManager) {
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
        <div className="flex items-center gap-4">
          <h1 className="text-3xl font-bold text-gray-900">Áreas</h1>
          <select
            value={selectedDepartment}
            onChange={(e) => setSelectedDepartment(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Todos los departamentos</option>
            {departments?.map((dept) => (
              <option key={dept.id} value={dept.id}>
                {dept.name}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={() => setIsCreateModalOpen(true)}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition"
        >
          <Plus className="w-5 h-5" />
          Nueva Área
        </button>
      </div>

      <div className="grid gap-4">
        {areas?.map((area: AreaWithDetails) => (
          <div key={area.id} className="bg-white rounded-lg shadow p-6">
            <div className="flex justify-between items-start">
              <div className="flex-1">
                <h3 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
                  <Building2 className="w-5 h-5 text-gray-500" />
                  {area.name}
                </h3>
                {area.description && (
                  <p className="text-gray-600 mt-1">{area.description}</p>
                )}
                <div className="flex gap-4 mt-3 text-sm text-gray-500">
                  <span className="flex items-center gap-1">
                    <Building className="w-4 h-4" />
                    {area.departmentName || 'Sin departamento'}
                  </span>
                  <span className="flex items-center gap-1">
                    <Users className="w-4 h-4" />
                    {area.membersCount || 0} miembros
                  </span>
                  {area.leadName && (
                    <span className="flex items-center gap-1">
                      <User className="w-4 h-4" />
                      Líder: {area.leadName}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setEditingArea({ 
                    id: area.id, 
                    name: area.name, 
                    description: area.description || undefined,
                    leadId: area.leadId || undefined
                  })}
                  className="p-2 text-gray-600 hover:bg-gray-100 rounded"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => {
                    if (confirm(`¿Estás seguro de eliminar el área ${area.name}?`)) {
                      deleteMutation.mutate({ id: area.id })
                    }
                  }}
                  className="p-2 text-red-600 hover:bg-red-50 rounded"
                  disabled={area.membersCount ? area.membersCount > 0 : false}
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
            <h2 className="text-xl font-semibold mb-4">Crear Área</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                const formData = new FormData(e.currentTarget)
                const name = formData.get('name') as string
                const description = formData.get('description') as string
                const departmentId = formData.get('departmentId') as string
                const leadId = formData.get('leadId') as string
                createMutation.mutate({
                  name,
                  description: description || undefined,
                  departmentId,
                  leadId: leadId || undefined,
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
                    Departamento
                  </label>
                  <select
                    name="departmentId"
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Seleccionar departamento</option>
                    {departments?.map((dept) => (
                      <option key={dept.id} value={dept.id}>
                        {dept.name}
                      </option>
                    ))}
                  </select>
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
      {editingArea && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-xl font-semibold mb-4">Editar Área</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                const formData = new FormData(e.currentTarget)
                const name = formData.get('name') as string
                const description = formData.get('description') as string
                const leadId = formData.get('leadId') as string
                updateMutation.mutate({
                  id: editingArea.id,
                  name,
                  description: description || undefined,
                  leadId: leadId || undefined,
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
                    defaultValue={editingArea.name}
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
                    defaultValue={editingArea.description}
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => setEditingArea(null)}
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