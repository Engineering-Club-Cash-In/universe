import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts'
import { jiraService } from '@/services/jira'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'

interface VelocityChartProps {
  sprintId: number
}

export default function VelocityChart({ sprintId }: VelocityChartProps) {
  // Obtener datos de velocidad histórica
  const { data: sprints = [] } = useQuery({
    queryKey: ['sprintVelocity'],
    queryFn: async () => {
      const allSprints = await jiraService.getAllSprints()
      const closedSprints = allSprints
        .filter(s => s.state === 'closed')
        .slice(-5) // Últimos 5 sprints cerrados
      
      const sprintData = await Promise.all(
        closedSprints.map(async (sprint: any) => {
          const metrics = await jiraService.getSprintMetrics(sprint.id)
          return {
            name: sprint.name.replace('Sprint ', 'S'),
            planificado: metrics.totalStoryPoints,
            completado: metrics.completedStoryPoints,
            sprint
          }
        })
      )
      
      // Agregar sprint actual si existe
      if (sprintId) {
        const currentMetrics = await jiraService.getSprintMetrics(sprintId)
        const currentSprint = await jiraService.getSprintById(sprintId)
        sprintData.push({
          name: currentSprint.name.replace('Sprint ', 'S'),
          planificado: currentMetrics.totalStoryPoints,
          completado: currentMetrics.completedStoryPoints,
          sprint: currentSprint
        })
      }
      
      return sprintData
    }
  })

  const avgVelocity = sprints.length > 0
    ? sprints.reduce((sum, s) => sum + s.completado, 0) / sprints.length
    : 0

  const lastCompletedSprints = sprints.filter(s => s.sprint.state === 'closed').slice(-2)
  const velocityTrend = lastCompletedSprints.length === 2
    ? lastCompletedSprints[1].completado - lastCompletedSprints[0].completado
    : 0

  const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899']

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Velocidad del Equipo</CardTitle>
          <CardDescription>
            Story Points completados por sprint
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-6 grid grid-cols-3 gap-4">
            <div className="text-center p-3 bg-muted rounded-lg">
              <p className="text-sm text-muted-foreground">Velocidad Promedio</p>
              <p className="text-2xl font-bold">{Math.round(avgVelocity)}</p>
              <p className="text-xs text-muted-foreground">Story Points/Sprint</p>
            </div>
            <div className="text-center p-3 bg-muted rounded-lg">
              <p className="text-sm text-muted-foreground">Último Sprint</p>
              <p className="text-2xl font-bold">
                {lastCompletedSprints[lastCompletedSprints.length - 1]?.completado || 0}
              </p>
              <p className="text-xs text-muted-foreground">Story Points</p>
            </div>
            <div className="text-center p-3 bg-muted rounded-lg">
              <p className="text-sm text-muted-foreground">Tendencia</p>
              <div className="flex items-center justify-center gap-2">
                {velocityTrend > 0 ? (
                  <>
                    <TrendingUp className="h-6 w-6 text-green-600" />
                    <span className="text-2xl font-bold text-green-600">+{velocityTrend}</span>
                  </>
                ) : velocityTrend < 0 ? (
                  <>
                    <TrendingDown className="h-6 w-6 text-red-600" />
                    <span className="text-2xl font-bold text-red-600">{velocityTrend}</span>
                  </>
                ) : (
                  <>
                    <Minus className="h-6 w-6 text-gray-600" />
                    <span className="text-2xl font-bold text-gray-600">0</span>
                  </>
                )}
              </div>
              <p className="text-xs text-muted-foreground">vs Sprint Anterior</p>
            </div>
          </div>

          <ResponsiveContainer width="100%" height={350}>
            <BarChart data={sprints} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis 
                dataKey="name" 
                tick={{ fontSize: 12 }}
                stroke="#6b7280"
              />
              <YAxis 
                tick={{ fontSize: 12 }}
                stroke="#6b7280"
                label={{ value: 'Story Points', angle: -90, position: 'insideLeft' }}
              />
              <Tooltip 
                contentStyle={{
                  backgroundColor: 'rgba(255, 255, 255, 0.95)',
                  border: '1px solid #e5e7eb',
                  borderRadius: '6px'
                }}
              />
              <Legend wrapperStyle={{ paddingTop: '20px' }} />
              <Bar dataKey="planificado" fill="#e5e7eb" name="Planificado" />
              <Bar dataKey="completado" name="Completado">
                {sprints.map((entry, index) => (
                  <Cell 
                    key={`cell-${index}`} 
                    fill={entry.sprint.state === 'active' ? '#f59e0b' : COLORS[index % COLORS.length]} 
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>

          <div className="mt-4 p-4 bg-muted rounded-lg">
            <h4 className="font-semibold mb-2">Análisis de Velocidad</h4>
            <div className="space-y-2 text-sm">
              {velocityTrend > 0 ? (
                <>
                  <p className="text-green-600">
                    📈 La velocidad del equipo está mejorando (+{velocityTrend} points).
                  </p>
                  <p>
                    El equipo está aumentando su capacidad de entrega consistentemente.
                  </p>
                </>
              ) : velocityTrend < 0 ? (
                <>
                  <p className="text-orange-600">
                    📉 La velocidad del equipo ha disminuido ({velocityTrend} points).
                  </p>
                  <p>
                    Revisar posibles impedimentos o cambios en el equipo.
                  </p>
                </>
              ) : (
                <p>La velocidad del equipo se mantiene estable.</p>
              )}
              <p className="mt-2">
                <strong>Recomendación:</strong> Para el próximo sprint, planificar alrededor de {Math.round(avgVelocity)} story points.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Distribución por tipo de tarea */}
      <Card>
        <CardHeader>
          <CardTitle>Distribución de Trabajo</CardTitle>
          <CardDescription>
            Tipos de tareas completadas en los últimos sprints
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart 
              data={[
                { tipo: 'Historia', valor: 45, color: '#3b82f6' },
                { tipo: 'Bug', valor: 20, color: '#ef4444' },
                { tipo: 'Tarea', valor: 25, color: '#10b981' },
                { tipo: 'Mejora', valor: 10, color: '#f59e0b' }
              ]}
              margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="tipo" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="valor" name="Story Points">
                {[0, 1, 2, 3].map((index) => (
                  <Cell key={`cell-${index}`} fill={['#3b82f6', '#ef4444', '#10b981', '#f59e0b'][index]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  )
}