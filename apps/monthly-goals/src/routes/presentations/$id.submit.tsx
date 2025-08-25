import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Button } from '../../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'
import { Input } from '../../components/ui/input'
import { Textarea } from '../../components/ui/textarea'
import { Badge } from '../../components/ui/badge'
import { Label } from '../../components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs'
import { Alert, AlertDescription } from '../../components/ui/alert'
import { ArrowLeft, Save, Upload, Users, AlertCircle, Target } from 'lucide-react'
import { toast } from 'sonner'
import { useRole } from '../../lib/auth/hooks'
import { 
  getPresentationById, 
  submitGoals, 
  bulkSubmitGoals,
  updatePresentation 
} from '../../server/functions/presentations'
import { getMonthlyGoals } from '../../server/functions/goals'
import { getDepartments } from '../../server/functions/departments'
import { getAreas } from '../../server/functions/areas'

export const Route = createFileRoute('/presentations/$id/submit')({
  component: SubmitGoalsPage,
})

interface GoalSubmission {
  monthlyGoalId: string
  submittedValue: number
  notes?: string
}

function SubmitGoalsPage() {
  const { id } = Route.useParams()
  const navigate = useNavigate()
  const { isManager, isAdmin } = useRole()
  const queryClient = useQueryClient()
  const [goalValues, setGoalValues] = useState<Record<string, GoalSubmission>>({})
  const [selectedDepartment, setSelectedDepartment] = useState<string>('')
  const [selectedArea, setSelectedArea] = useState<string>('')
  
  const { data: presentation } = useSuspenseQuery({
    queryKey: ['presentation', id],
    queryFn: () => getPresentationById({ data: id }),
  })
  
  const { data: monthlyGoals } = useSuspenseQuery({
    queryKey: ['monthly-goals', presentation.month, presentation.year],
    queryFn: () => getMonthlyGoals({ data: { month: presentation.month, year: presentation.year } }),
  })
  
  const { data: departments } = useSuspenseQuery({
    queryKey: ['departments'],
    queryFn: () => getDepartments(),
    staleTime: 5 * 60 * 1000,
  })
  
  const { data: areas } = useSuspenseQuery({
    queryKey: ['areas'],
    queryFn: () => getAreas(),
    staleTime: 5 * 60 * 1000,
  })
  
  const submitMutation = useMutation({
    mutationFn: async (goals: GoalSubmission[]) =>
      await submitGoals({ data: { presentationId: id, goals } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['presentation', id] })
      queryClient.invalidateQueries({ queryKey: ['monthly-goals'] })
      toast.success('Metas cargadas exitosamente')
      setGoalValues({})
    },
    onError: (error) => {
      toast.error(error.message || 'Error al cargar las metas')
    },
  })
  
  const bulkSubmitMutation = useMutation({
    mutationFn: async (data: { departmentId?: string; areaId?: string }) =>
      await bulkSubmitGoals({ data: { presentationId: id, ...data } }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['presentation', id] })
      queryClient.invalidateQueries({ queryKey: ['monthly-goals'] })
      toast.success(`${result.count} metas cargadas automáticamente`)
    },
    onError: (error) => {
      toast.error(error.message || 'Error en la carga masiva')
    },
  })
  
  const updateStatusMutation = useMutation({
    mutationFn: async (status: 'ready' | 'presented') =>
      await updatePresentation({ data: { id, data: { status } } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['presentation', id] })
      queryClient.invalidateQueries({ queryKey: ['presentations'] })
      toast.success('Estado actualizado exitosamente')
      navigate({ to: '/presentations' })
    },
    onError: (error) => {
      toast.error(error.message || 'Error al actualizar el estado')
    },
  })
  
  if (!isManager && !isAdmin) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground">
              No tienes permisos para cargar metas en presentaciones
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }
  
  if (presentation.status === 'presented') {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardContent className="pt-6">
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Esta presentación ya fue presentada y no se pueden modificar las metas.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      </div>
    )
  }
  
  const handleSubmit = () => {
    const goals = Object.values(goalValues).filter(g => g.submittedValue !== undefined)
    
    if (goals.length === 0) {
      toast.error('No hay metas para cargar')
      return
    }
    
    submitMutation.mutate(goals)
  }
  
  const handleBulkSubmit = () => {
    if (selectedArea) {
      bulkSubmitMutation.mutate({ areaId: selectedArea })
    } else if (selectedDepartment) {
      bulkSubmitMutation.mutate({ departmentId: selectedDepartment })
    } else {
      bulkSubmitMutation.mutate({})
    }
  }
  
  const updateGoalValue = (goalId: string, field: keyof GoalSubmission, value: number | string) => {
    setGoalValues(prev => ({
      ...prev,
      [goalId]: {
        ...prev[goalId],
        monthlyGoalId: goalId,
        [field]: field === 'submittedValue' ? Number(value) : value,
      },
    }))
  }
  
  const getMonthName = (month: number): string => {
    const months = [
      'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
      'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
    ]
    return months[month - 1] || ''
  }
  
  const calculateProgress = (achieved: number, target: number) => {
    if (!target) return 0
    return Math.round((achieved / target) * 100)
  }
  
  const getProgressColor = (percentage: number) => {
    if (percentage >= 80) return 'text-green-600'
    if (percentage >= 50) return 'text-yellow-600'
    return 'text-red-600'
  }
  
  const existingSubmissions = presentation.submissions || []
  const submissionsByGoal = existingSubmissions.reduce((acc, sub) => {
    acc[sub.monthlyGoalId] = sub
    return acc
  }, {} as Record<string, typeof existingSubmissions[0]>)
  
  const filteredAreas = selectedDepartment
    ? areas?.filter((area: { id: string; name: string; departmentId: string }) => area.departmentId === selectedDepartment)
    : areas
  
  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            size="icon"
            onClick={() => navigate({ to: '/presentations' })}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Cargar Metas</h1>
            <p className="text-muted-foreground">
              {presentation.name} - {getMonthName(presentation.month)} {presentation.year}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {presentation.status === 'draft' && (
            <Button
              variant="outline"
              onClick={() => updateStatusMutation.mutate('ready')}
              disabled={updateStatusMutation.isPending}
            >
              Marcar como Lista
            </Button>
          )}
          {presentation.status === 'ready' && isAdmin && (
            <Button
              onClick={() => updateStatusMutation.mutate('presented')}
              disabled={updateStatusMutation.isPending}
            >
              Marcar como Presentada
            </Button>
          )}
        </div>
      </div>
      
      <Tabs defaultValue="manual" className="space-y-4">
        <TabsList>
          <TabsTrigger value="manual">
            <Users className="mr-2 h-4 w-4" />
            Carga Manual
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="bulk">
              <Upload className="mr-2 h-4 w-4" />
              Carga Masiva
            </TabsTrigger>
          )}
        </TabsList>
        
        <TabsContent value="manual" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Metas del Período</CardTitle>
              <CardDescription>
                Ingresa los valores alcanzados para cada meta
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Empleado</TableHead>
                    <TableHead>Área</TableHead>
                    <TableHead>Meta</TableHead>
                    <TableHead>Objetivo</TableHead>
                    <TableHead>Valor Alcanzado</TableHead>
                    <TableHead>Progreso</TableHead>
                    <TableHead>Notas</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {monthlyGoals?.map((goal: any) => {
                    const submission = submissionsByGoal[goal.id]
                    const currentValue = goalValues[goal.id]?.submittedValue ?? 
                                       submission?.submittedValue ?? 
                                       Number(goal.achievedValue || 0)
                    const progress = calculateProgress(currentValue, Number(goal.targetValue))
                    
                    return (
                      <TableRow key={goal.id}>
                        <TableCell className="font-medium">{goal.teamMember?.user?.name || 'N/A'}</TableCell>
                        <TableCell>{goal.teamMember?.area?.name || 'N/A'}</TableCell>
                        <TableCell className="max-w-xs">
                          <div className="flex items-center gap-2">
                            <Target className="h-4 w-4 text-muted-foreground" />
                            <span className="truncate">{goal.description || 'Meta mensual'}</span>
                          </div>
                        </TableCell>
                        <TableCell>{goal.targetValue}</TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={goalValues[goal.id]?.submittedValue ?? submission?.submittedValue ?? ''}
                            onChange={(e) => updateGoalValue(goal.id, 'submittedValue', e.target.value)}
                            className="w-24"
                            placeholder={goal.achievedValue || '0'}
                          />
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span className={`font-semibold ${getProgressColor(progress)}`}>
                              {progress}%
                            </span>
                            {submission && (
                              <Badge variant="secondary" className="text-xs">
                                Cargado
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Textarea
                            value={goalValues[goal.id]?.notes ?? submission?.notes ?? ''}
                            onChange={(e) => updateGoalValue(goal.id, 'notes', e.target.value)}
                            className="w-40 h-10"
                            placeholder="Notas..."
                          />
                        </TableCell>
                      </TableRow>
                    )
                  })}
                  {monthlyGoals?.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8">
                        <div className="text-muted-foreground">
                          No hay metas configuradas para este período
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              
              <div className="flex justify-end mt-4">
                <Button
                  onClick={handleSubmit}
                  disabled={submitMutation.isPending || Object.keys(goalValues).length === 0}
                >
                  <Save className="mr-2 h-4 w-4" />
                  {submitMutation.isPending ? 'Guardando...' : 'Guardar Metas'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        
        {isAdmin && (
          <TabsContent value="bulk" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Carga Masiva de Metas</CardTitle>
                <CardDescription>
                  Carga automáticamente todas las metas con sus valores actuales
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    Esta acción cargará todas las metas con los valores que ya tienen registrados.
                    Puedes filtrar por departamento o área si lo deseas.
                  </AlertDescription>
                </Alert>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="department">Departamento (opcional)</Label>
                    <select
                      id="department"
                      value={selectedDepartment}
                      onChange={(e) => {
                        setSelectedDepartment(e.target.value)
                        setSelectedArea('')
                      }}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      <option value="">Todos los departamentos</option>
                      {departments?.map((dept: { id: string; name: string }) => (
                        <option key={dept.id} value={dept.id}>
                          {dept.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="area">Área (opcional)</Label>
                    <select
                      id="area"
                      value={selectedArea}
                      onChange={(e) => setSelectedArea(e.target.value)}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      disabled={!selectedDepartment}
                    >
                      <option value="">Todas las áreas</option>
                      {filteredAreas?.map((area: { id: string; name: string }) => (
                        <option key={area.id} value={area.id}>
                          {area.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                
                <div className="flex justify-end">
                  <Button
                    onClick={handleBulkSubmit}
                    disabled={bulkSubmitMutation.isPending}
                  >
                    <Upload className="mr-2 h-4 w-4" />
                    {bulkSubmitMutation.isPending ? 'Cargando...' : 'Cargar Todas las Metas'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}