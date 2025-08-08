import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { 
  Activity, 
  AlertCircle, 
  TrendingUp,
  Calendar,
  Target,
  BarChart3,
  Timer
} from 'lucide-react'
import { jiraService } from '@/services/jira'
import { format, differenceInDays, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { useState } from 'react'
import BurndownChart from '@/components/BurndownChart'
import VelocityChart from '@/components/VelocityChart'
import IssuesTable from '@/components/IssuesTable'
import TeamPerformance from '@/components/TeamPerformance'
import JiraConnectionError from '@/components/JiraConnectionError'

export default function SprintDashboard() {
  const [selectedSprintId, setSelectedSprintId] = useState<number | null>(null)

  // Obtener sprint activo
  const { data: currentSprint, isLoading: loadingSprint, error: sprintError, refetch } = useQuery({
    queryKey: ['currentSprint'],
    queryFn: () => jiraService.getCurrentSprint(),
    refetchInterval: 60000, // Actualizar cada minuto
    retry: 2
  })

  // Obtener todos los sprints para el selector
  const { data: allSprints = [] } = useQuery({
    queryKey: ['allSprints'],
    queryFn: () => jiraService.getAllSprints()
  })

  const activeSprintId = selectedSprintId || currentSprint?.id

  // Obtener métricas del sprint
  const { data: metrics } = useQuery({
    queryKey: ['sprintMetrics', activeSprintId],
    queryFn: () => jiraService.getSprintMetrics(activeSprintId!),
    enabled: !!activeSprintId,
    refetchInterval: 60000
  })

  // Obtener issues del sprint
  const { data: issues = [] } = useQuery({
    queryKey: ['sprintIssues', activeSprintId],
    queryFn: () => jiraService.getSprintIssues(activeSprintId!),
    enabled: !!activeSprintId,
    refetchInterval: 60000
  })

  // Manejar error de conexión
  if (sprintError) {
    return <JiraConnectionError onRetry={() => refetch()} />
  }

  // Mostrar loading
  if (loadingSprint) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <Activity className="h-8 w-8 animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Conectando con Jira...</p>
        </div>
      </div>
    )
  }

  // Si no hay sprint activo
  if (!currentSprint) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle>No hay Sprint Activo</CardTitle>
            <CardDescription>
              No se encontró ningún sprint activo en el tablero configurado
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              Verifica que exista un sprint activo en tu tablero de Jira o selecciona otro tablero en la configuración.
            </p>
            <Button onClick={() => refetch()} className="w-full">
              Reintentar
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const sprint = allSprints.find(s => s.id === activeSprintId) || currentSprint
  const sprintProgress = metrics ? (metrics.completedStoryPoints / metrics.totalStoryPoints) * 100 : 0
  const daysRemaining = differenceInDays(parseISO(sprint.endDate), new Date())
  const totalDays = differenceInDays(parseISO(sprint.endDate), parseISO(sprint.startDate))
  const daysElapsed = totalDays - daysRemaining

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header con información del Sprint */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold">Dashboard de Sprint</h1>
          <p className="text-muted-foreground mt-1">
            Seguimiento en tiempo real del progreso del equipo
          </p>
        </div>
        <Select
          value={activeSprintId?.toString()}
          onValueChange={(value) => setSelectedSprintId(Number(value))}
        >
          <SelectTrigger className="w-[250px]">
            <SelectValue placeholder="Seleccionar sprint" />
          </SelectTrigger>
          <SelectContent>
            {allSprints.map(sprint => (
              <SelectItem key={sprint.id} value={sprint.id.toString()}>
                {sprint.name} 
                {sprint.state === 'active' && (
                  <Badge className="ml-2" variant="default">Activo</Badge>
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Información del Sprint Actual */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-start">
            <div>
              <CardTitle className="text-2xl">{sprint.name}</CardTitle>
              <CardDescription className="mt-2">
                {sprint.goal || 'Sin objetivo definido'}
              </CardDescription>
            </div>
            <Badge 
              variant={sprint.state === 'active' ? 'default' : 'secondary'}
              className="text-sm"
            >
              {sprint.state === 'active' ? 'En Progreso' : 
               sprint.state === 'closed' ? 'Completado' : 'Planificado'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-sm text-muted-foreground">Inicio</p>
                <p className="font-medium">
                  {format(parseISO(sprint.startDate), 'dd MMM', { locale: es })}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-sm text-muted-foreground">Fin</p>
                <p className="font-medium">
                  {format(parseISO(sprint.endDate), 'dd MMM', { locale: es })}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Timer className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-sm text-muted-foreground">Días Restantes</p>
                <p className="font-medium text-orange-600">
                  {daysRemaining > 0 ? `${daysRemaining} días` : 'Sprint finalizado'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-sm text-muted-foreground">Progreso</p>
                <p className="font-medium">{daysElapsed} de {totalDays} días</p>
              </div>
            </div>
          </div>
          <div className="mt-4">
            <div className="flex justify-between text-sm mb-2">
              <span>Progreso del Sprint</span>
              <span className="font-medium">{Math.round(sprintProgress)}%</span>
            </div>
            <Progress value={sprintProgress} className="h-2" />
          </div>
        </CardContent>
      </Card>

      {/* KPIs Principales */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total de Tareas</CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics?.totalIssues || 0}</div>
            <div className="flex items-center gap-4 mt-2">
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 bg-green-500 rounded-full" />
                <span className="text-xs text-muted-foreground">
                  {metrics?.completedIssues || 0} Completadas
                </span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 bg-blue-500 rounded-full" />
                <span className="text-xs text-muted-foreground">
                  {metrics?.inProgressIssues || 0} En Progreso
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Story Points</CardTitle>
            <Target className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {metrics?.completedStoryPoints || 0} / {metrics?.totalStoryPoints || 0}
            </div>
            <Progress 
              value={(metrics?.completedStoryPoints || 0) / (metrics?.totalStoryPoints || 1) * 100} 
              className="mt-2 h-2"
            />
            <p className="text-xs text-muted-foreground mt-2">
              {metrics?.remainingStoryPoints || 0} puntos restantes
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Velocidad del Equipo</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics?.velocity || 0}</div>
            <p className="text-xs text-muted-foreground mt-2">
              Promedio últimos 3 sprints
            </p>
            {metrics && metrics.velocity > 0 && (
              <p className="text-xs mt-1">
                {metrics.completedStoryPoints > metrics.velocity ? (
                  <span className="text-green-600">
                    ↑ {Math.round(((metrics.completedStoryPoints - metrics.velocity) / metrics.velocity) * 100)}% sobre promedio
                  </span>
                ) : (
                  <span className="text-orange-600">
                    ↓ {Math.round(((metrics.velocity - metrics.completedStoryPoints) / metrics.velocity) * 100)}% bajo promedio
                  </span>
                )}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Tareas Bloqueadas</CardTitle>
            <AlertCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics?.blockedIssues || 0}</div>
            <p className="text-xs text-muted-foreground mt-2">
              Requieren atención inmediata
            </p>
            {metrics && metrics.blockedIssues > 0 && (
              <Badge variant="destructive" className="mt-2">
                Acción Requerida
              </Badge>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Tabs con contenido detallado */}
      <Tabs defaultValue="burndown" className="space-y-4">
        <TabsList>
          <TabsTrigger value="burndown">Burndown</TabsTrigger>
          <TabsTrigger value="velocity">Velocidad</TabsTrigger>
          <TabsTrigger value="tasks">Tareas</TabsTrigger>
          <TabsTrigger value="team">Equipo</TabsTrigger>
        </TabsList>

        <TabsContent value="burndown" className="space-y-4">
          <BurndownChart data={metrics?.burndownData || []} />
        </TabsContent>

        <TabsContent value="velocity" className="space-y-4">
          <VelocityChart sprintId={activeSprintId!} />
        </TabsContent>

        <TabsContent value="tasks" className="space-y-4">
          <IssuesTable issues={issues} />
        </TabsContent>

        <TabsContent value="team" className="space-y-4">
          <TeamPerformance metrics={metrics} />
        </TabsContent>
      </Tabs>
    </div>
  )
}