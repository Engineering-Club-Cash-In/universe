import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useRole, useAuth } from '../../lib/auth/hooks'
import { getTeamMembers, getTeamMembersByArea, createTeamMember, updateTeamMember, removeTeamMember } from '../../server/team-members'
import { getAreas } from '../../server/areas'
import { Plus, Edit2, Trash2, Users, User, Mail, Building2 } from 'lucide-react'
import type { TeamMember, TeamMemberWithDetails, CreateTeamMemberInput, UpdateTeamMemberInput, RemoveTeamMemberInput } from '../../types/team-members'
import type { AreaWithDetails } from '../../types/areas'

export const Route = createFileRoute('/admin/teams')({
  component: TeamsPage,
})

function TeamsPage() {
  const { isAdmin, isManager } = useRole()
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [editingMember, setEditingMember] = useState<{ id: string; position?: string; areaId: string } | null>(null)
  const [selectedArea, setSelectedArea] = useState<string>('')

  const { data: areas } = useQuery<AreaWithDetails[]>({
    queryKey: ['areas'],
    queryFn: async () => getAreas(),
  })

  const { data: teamMembers, isLoading } = useQuery({
    queryKey: ['teamMembers', selectedArea],
    queryFn: async () => {
      if (selectedArea) {
        return getTeamMembersByArea({ data: { areaId: selectedArea } })
      }
      return getTeamMembers()
    },
  })

  const createMutation = useMutation<TeamMember, Error, CreateTeamMemberInput>({
    mutationFn: async (data) => createTeamMember({ data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teamMembers'] })
      setIsCreateModalOpen(false)
    },
  })

  const updateMutation = useMutation<TeamMember, Error, UpdateTeamMemberInput>({
    mutationFn: async (data) => updateTeamMember({ data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teamMembers'] })
      setEditingMember(null)
    },
  })

  const removeMutation = useMutation<{ success: boolean }, Error, RemoveTeamMemberInput>({
    mutationFn: async (data) => removeTeamMember({ data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teamMembers'] })
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
          <h1 className="text-3xl font-bold text-gray-900">Equipos</h1>
          <select
            value={selectedArea}
            onChange={(e) => setSelectedArea(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Todas las áreas</option>
            {areas?.map((area) => (
              <option key={area.id} value={area.id}>
                {area.name} - {area.departmentName}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={() => setIsCreateModalOpen(true)}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition"
        >
          <Plus className="w-5 h-5" />
          Agregar Miembro
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {teamMembers?.map((member: TeamMemberWithDetails) => (
          <div key={member.id} className="bg-white rounded-lg shadow p-6">
            <div className="flex justify-between items-start">
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                  <User className="w-5 h-5 text-gray-500" />
                  {member.userName || 'Sin nombre'}
                </h3>
                {member.position && (
                  <p className="text-gray-700 font-medium mt-1">{member.position}</p>
                )}
                <div className="space-y-1 mt-3 text-sm text-gray-500">
                  <div className="flex items-center gap-1">
                    <Mail className="w-4 h-4" />
                    {member.userEmail || 'Sin email'}
                  </div>
                  <div className="flex items-center gap-1">
                    <Building2 className="w-4 h-4" />
                    {member.areaName || 'Sin área'} • {member.departmentName || 'Sin departamento'}
                  </div>
                  <div className="flex items-center gap-1">
                    <Users className="w-4 h-4" />
                    Rol: {member.userRole || 'Sin rol'}
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => setEditingMember({ 
                    id: member.id,
                    position: member.position || undefined,
                    areaId: member.areaId
                  })}
                  className="p-2 text-gray-600 hover:bg-gray-100 rounded"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => {
                    if (confirm(`¿Estás seguro de remover a ${member.userName} del equipo?`)) {
                      removeMutation.mutate({ id: member.id })
                    }
                  }}
                  className="p-2 text-red-600 hover:bg-red-50 rounded"
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
            <h2 className="text-xl font-semibold mb-4">Agregar Miembro al Equipo</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                const formData = new FormData(e.currentTarget)
                const userId = user?.id || ''
                const areaId = formData.get('areaId') as string
                const position = formData.get('position') as string
                
                if (!userId) {
                  alert('Por favor, inicia sesión primero')
                  return
                }
                
                createMutation.mutate({
                  userId,
                  areaId,
                  position: position || undefined,
                })
              }}
            >
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Área
                  </label>
                  <select
                    name="areaId"
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Seleccionar área</option>
                    {areas?.map((area) => (
                      <option key={area.id} value={area.id}>
                        {area.name} - {area.departmentName}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Cargo
                  </label>
                  <input
                    name="position"
                    type="text"
                    placeholder="Ej: Desarrollador Senior"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="text-sm text-gray-500">
                  <p>Nota: Por ahora, solo puedes agregarte a ti mismo al equipo.</p>
                  <p>Usuario: {user?.name || 'Sin nombre'} ({user?.email})</p>
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
                  {createMutation.isPending ? 'Agregando...' : 'Agregar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editingMember && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-xl font-semibold mb-4">Editar Miembro del Equipo</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                const formData = new FormData(e.currentTarget)
                const position = formData.get('position') as string
                const areaId = formData.get('areaId') as string
                updateMutation.mutate({
                  id: editingMember.id,
                  position: position || undefined,
                  areaId: areaId || undefined,
                })
              }}
            >
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Área
                  </label>
                  <select
                    name="areaId"
                    defaultValue={editingMember.areaId}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {areas?.map((area) => (
                      <option key={area.id} value={area.id}>
                        {area.name} - {area.departmentName}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Cargo
                  </label>
                  <input
                    name="position"
                    type="text"
                    defaultValue={editingMember.position}
                    placeholder="Ej: Desarrollador Senior"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => setEditingMember(null)}
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