import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select'
import { Label } from '../../components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'
import { Badge } from '../../components/ui/badge'
import { Target, Users, Save, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import { getGoalTemplates, bulkCreateMonthlyGoals } from '../../server/functions/goals'
import { getTeamMembers } from '../../server/functions/teams'
import { useRole } from '../../lib/auth/hooks'

export const Route = createFileRoute('/goals/configure')({
  component: ConfigureGoalsPage,
})

function ConfigureGoalsPage() {
  const { isAdmin, isManager } = useRole()
  const queryClient = useQueryClient()
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1)
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())
  const [selectedDepartment, setSelectedDepartment] = useState<string>('')
  interface GoalAssignment {
    teamMemberId: string
    goalTemplateId: string
    targetValue: number
    description?: string
  }
  
  const [goalAssignments, setGoalAssignments] = useState<Record<string, GoalAssignment>>({})

  const { data: templates } = useSuspenseQuery({
    queryKey: ['goal-templates'],
    queryFn: () => getGoalTemplates(),
  })

  const { data: teamMembers } = useSuspenseQuery({
    queryKey: ['team-members', selectedDepartment],
    queryFn: async () => await getTeamMembers({ data: { departmentId: selectedDepartment } }),
  })


  const bulkCreateMutation = useMutation({
    mutationFn: async (input: { month: number; year: number; goals: GoalAssignment[] }) => 
      await bulkCreateMonthlyGoals({ data: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['monthly-goals'] })
      toast.success('Metas creadas exitosamente')
      setGoalAssignments({})
    },
    onError: () => {
      toast.error('Error al crear las metas')
    },
  })

  const handleAssignGoal = (memberId: string, templateId: string, targetValue: string) => {
    setGoalAssignments(prev => ({
      ...prev,
      [`${memberId}-${templateId}`]: {
        teamMemberId: memberId,
        goalTemplateId: templateId,
        targetValue: parseFloat(targetValue) || 0,
      },
    }))
  }

  const handleBulkSave = () => {
    const goals = Object.values(goalAssignments).filter((g: any) => g.targetValue > 0)
    
    if (goals.length === 0) {
      toast.error('No hay metas configuradas para guardar')
      return
    }

    bulkCreateMutation.mutate({
      month: selectedMonth,
      year: selectedYear,
      goals,
    })
  }

  if (!isAdmin && !isManager) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground">
              No tienes permisos para configurar metas
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const months = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
  ]

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Configurar Metas Mensuales</h1>
        <p className="text-muted-foreground">
          Asigna metas a los miembros del equipo para el período seleccionado
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Período y Filtros</CardTitle>
          <CardDescription>
            Selecciona el mes y año para configurar las metas
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label htmlFor="month">Mes</Label>
              <Select value={selectedMonth.toString()} onValueChange={(v: string) => setSelectedMonth(parseInt(v))}>
                <SelectTrigger id="month">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {months.map((month, index) => (
                    <SelectItem key={index + 1} value={(index + 1).toString()}>
                      {month}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="year">Año</Label>
              <Select value={selectedYear.toString()} onValueChange={(v: string) => setSelectedYear(parseInt(v))}>
                <SelectTrigger id="year">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[2024, 2025, 2026].map(year => (
                    <SelectItem key={year} value={year.toString()}>
                      {year}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {isAdmin && (
              <div>
                <Label htmlFor="department">Departamento</Label>
                <Select value={selectedDepartment} onValueChange={setSelectedDepartment}>
                  <SelectTrigger id="department">
                    <SelectValue placeholder="Todos los departamentos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Todos</SelectItem>
                    {/* Aquí irían los departamentos cargados dinámicamente */}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Asignación de Metas</CardTitle>
          <CardDescription>
            Configura las metas para cada miembro del equipo
          </CardDescription>
        </CardHeader>
        <CardContent>
          {templates && templates.length > 0 ? (
            <div className="space-y-6">
              {templates.map((template: { id: string; name: string; unit: string | null; defaultTarget: string | null }) => (
                <div key={template.id} className="space-y-4">
                  <div className="flex items-center gap-2 pb-2 border-b">
                    <Target className="h-5 w-5 text-muted-foreground" />
                    <h3 className="font-semibold text-lg">{template.name}</h3>
                    {template.unit && (
                      <Badge variant="secondary">{template.unit}</Badge>
                    )}
                  </div>
                  
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Empleado</TableHead>
                        <TableHead>Área</TableHead>
                        <TableHead>Meta</TableHead>
                        <TableHead>Descripción</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {teamMembers?.map((member: any) => {
                        const key = `${member.id}-${template.id}`
                        const assignment = goalAssignments[key]
                        
                        return (
                          <TableRow key={member.id}>
                            <TableCell className="font-medium">
                              {member.user.name}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline">
                                {member.area.name}
                              </Badge>
                            </TableCell>
                            <TableCell className="w-32">
                              <Input
                                type="number"
                                step="0.01"
                                placeholder={template.defaultTarget || '0'}
                                value={assignment?.targetValue || ''}
                                onChange={(e) => handleAssignGoal(
                                  member.id,
                                  template.id,
                                  e.target.value
                                )}
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                placeholder="Notas opcionales..."
                                value={assignment?.description || ''}
                                onChange={(e) => setGoalAssignments(prev => ({
                                  ...prev,
                                  [key]: {
                                    ...prev[key],
                                    description: e.target.value,
                                  },
                                }))}
                              />
                            </TableCell>
                          </TableRow>
                        )
                      })}
                      {(!teamMembers || teamMembers.length === 0) && (
                        <TableRow>
                          <TableCell colSpan={4} className="text-center py-4">
                            <div className="flex flex-col items-center gap-2 text-muted-foreground">
                              <Users className="h-8 w-8" />
                              <p>No hay miembros del equipo para mostrar</p>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <div className="flex flex-col items-center gap-2 text-muted-foreground">
                <AlertCircle className="h-8 w-8" />
                <p>No hay templates de metas configurados</p>
                <Button variant="link" onClick={() => window.location.href = '/admin/goal-templates'}>
                  Configurar Templates
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {templates && templates.length > 0 && teamMembers && teamMembers.length > 0 && (
        <div className="flex justify-end gap-4">
          <Button variant="outline" onClick={() => setGoalAssignments({})}>
            Limpiar Todo
          </Button>
          <Button 
            onClick={handleBulkSave}
            disabled={bulkCreateMutation.isPending || Object.keys(goalAssignments).length === 0}
          >
            <Save className="mr-2 h-4 w-4" />
            {bulkCreateMutation.isPending ? 'Guardando...' : 'Guardar Metas'}
          </Button>
        </div>
      )}
    </div>
  )
}