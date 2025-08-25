import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select'
import { Badge } from '../../components/ui/badge'
import { Progress } from '../../components/ui/progress'
import { Button } from '../../components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs'
import { Calendar, Target, TrendingUp, TrendingDown, Minus, Clock, CheckCircle2, AlertCircle } from 'lucide-react'
import { getMonthlyGoals, getGoalHistory, calculateGoalProgress } from '../../server/functions/goals'
import { useAuth } from '../../lib/auth/hooks'

export const Route = createFileRoute('/goals/')({
  component: GoalsPage,
})

function GoalsPage() {
  const { user } = useAuth()
  const currentMonth = new Date().getMonth() + 1
  const currentYear = new Date().getFullYear()
  const [selectedMonth, setSelectedMonth] = useState(currentMonth)
  const [selectedYear, setSelectedYear] = useState(currentYear)

  const { data: currentGoals } = useSuspenseQuery({
    queryKey: ['monthly-goals', selectedMonth, selectedYear],
    queryFn: async () => await getMonthlyGoals({ data: { month: selectedMonth, year: selectedYear } }),
  })

  const { data: goalHistory } = useSuspenseQuery({
    queryKey: ['goal-history', user?.id],
    queryFn: async () => user ? await getGoalHistory({ data: { teamMemberId: user.id, limit: 12 } }) : Promise.resolve([]),
  })

  const months = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
  ]

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />
      case 'in_progress':
        return <Clock className="h-4 w-4 text-yellow-500" />
      default:
        return <AlertCircle className="h-4 w-4 text-gray-400" />
    }
  }

  const getProgressColor = (percentage: number, successThreshold = 80, warningThreshold = 50) => {
    if (percentage >= successThreshold) return 'bg-green-500'
    if (percentage >= warningThreshold) return 'bg-yellow-500'
    return 'bg-red-500'
  }

  const getTrendIcon = (current: number, previous: number) => {
    if (current > previous) return <TrendingUp className="h-4 w-4 text-green-500" />
    if (current < previous) return <TrendingDown className="h-4 w-4 text-red-500" />
    return <Minus className="h-4 w-4 text-gray-400" />
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Metas y Objetivos</h1>
          <p className="text-muted-foreground">
            Seguimiento de metas mensuales y progreso del equipo
          </p>
        </div>
        <Button onClick={() => window.location.href = '/goals/configure'}>
          Configurar Metas
        </Button>
      </div>

      <Tabs defaultValue="current" className="space-y-4">
        <TabsList>
          <TabsTrigger value="current">Metas Actuales</TabsTrigger>
          <TabsTrigger value="history">Histórico</TabsTrigger>
          <TabsTrigger value="team">Equipo</TabsTrigger>
        </TabsList>

        <TabsContent value="current" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Período</CardTitle>
              <CardDescription>Selecciona el mes y año para ver las metas</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex gap-4">
                <Select value={selectedMonth.toString()} onValueChange={(v: string) => setSelectedMonth(parseInt(v))}>
                  <SelectTrigger className="w-[180px]">
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
                <Select value={selectedYear.toString()} onValueChange={(v: string) => setSelectedYear(parseInt(v))}>
                  <SelectTrigger className="w-[120px]">
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
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {currentGoals?.map((goal: any) => {
              const achieved = parseFloat(goal.achievedValue || '0')
              const target = parseFloat(goal.targetValue || '1')
              const successThreshold = parseFloat(goal.template?.successThreshold || '80')
              const warningThreshold = parseFloat(goal.template?.warningThreshold || '50')
              const progress = calculateGoalProgress(achieved, target, successThreshold, warningThreshold)
              
              return (
                <Card key={goal.id} className="overflow-hidden">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg">
                        {goal.template?.name || 'Meta Personal'}
                      </CardTitle>
                      {getStatusIcon(goal.status)}
                    </div>
                    <CardDescription>
                      {goal.teamMember?.user?.name}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">
                        {goal.teamMember?.area?.name}
                      </span>
                      <Badge variant="outline">
                        {goal.teamMember?.area?.department?.name}
                      </Badge>
                    </div>
                    
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span>Progreso</span>
                        <span className="font-semibold">
                          {achieved} / {target} {goal.template?.unit}
                        </span>
                      </div>
                      <Progress 
                        value={progress.percentage} 
                        className={`h-2 ${getProgressColor(progress.percentage, successThreshold, warningThreshold)}`}
                      />
                      <div className="flex justify-between items-center">
                        <Badge 
                          variant={progress.status === 'success' ? 'default' : progress.status === 'warning' ? 'secondary' : 'destructive'}
                          className={`
                            ${progress.status === 'success' ? 'bg-green-500' : ''}
                            ${progress.status === 'warning' ? 'bg-yellow-500' : ''}
                            ${progress.status === 'danger' ? 'bg-red-500' : ''}
                          `}
                        >
                          {progress.percentage.toFixed(1)}%
                        </Badge>
                      </div>
                    </div>

                    {goal.description && (
                      <p className="text-sm text-muted-foreground">
                        {goal.description}
                      </p>
                    )}
                  </CardContent>
                </Card>
              )
            })}
            
            {(!currentGoals || currentGoals.length === 0) && (
              <Card className="col-span-full">
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <Target className="h-12 w-12 text-muted-foreground mb-4" />
                  <p className="text-lg font-medium">No hay metas configuradas</p>
                  <p className="text-sm text-muted-foreground">
                    Para este período no se han asignado metas
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        <TabsContent value="history" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Histórico de Cumplimiento</CardTitle>
              <CardDescription>
                Evolución de tus metas en los últimos meses
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {goalHistory?.map((record: any, index: number) => {
                  const prevRecord = goalHistory[index + 1]
                  const trend = prevRecord ? getTrendIcon(record.percentage, prevRecord.percentage) : null
                  
                  return (
                    <div key={`${record.year}-${record.month}`} className="flex items-center gap-4 p-4 border rounded-lg">
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">
                          {months[record.month - 1]} {record.year}
                        </span>
                      </div>
                      
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-muted-foreground">
                            {record.templateName}
                          </span>
                          {trend}
                        </div>
                        <Progress 
                          value={record.percentage} 
                          className={`h-2 mt-2 ${record.color === 'green' ? 'bg-green-500' : record.color === 'yellow' ? 'bg-yellow-500' : 'bg-red-500'}`}
                        />
                      </div>
                      
                      <div className="text-right">
                        <div className="font-semibold">
                          {parseFloat(record.achievedValue || '0')} / {parseFloat(record.targetValue || '0')}
                        </div>
                        <Badge 
                          variant={record.status === 'success' ? 'default' : record.status === 'warning' ? 'secondary' : 'destructive'}
                          className={`
                            ${record.status === 'success' ? 'bg-green-500' : ''}
                            ${record.status === 'warning' ? 'bg-yellow-500' : ''}
                            ${record.status === 'danger' ? 'bg-red-500' : ''}
                          `}
                        >
                          {record.percentage.toFixed(1)}%
                        </Badge>
                      </div>
                    </div>
                  )
                })}
                
                {(!goalHistory || goalHistory.length === 0) && (
                  <div className="text-center py-8 text-muted-foreground">
                    No hay histórico de metas disponible
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="team" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Metas del Equipo</CardTitle>
              <CardDescription>
                Progreso general del departamento y áreas
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {/* Aquí se mostrarían las metas agrupadas por departamento/área */}
                <div className="text-center py-8 text-muted-foreground">
                  Vista de equipo en desarrollo
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}