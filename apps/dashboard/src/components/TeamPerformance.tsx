import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts'
import { Trophy, TrendingUp, Award, AlertTriangle, CheckCircle } from 'lucide-react'
import type { SprintMetrics } from '@/services/jira'

interface TeamPerformanceProps {
  metrics?: SprintMetrics
}

export default function TeamPerformance({ metrics }: TeamPerformanceProps) {
  if (!metrics) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">Cargando métricas del equipo...</p>
      </div>
    )
  }

  // Preparar datos para el gráfico de rendimiento por miembro
  const teamData = Object.entries(metrics.issuesByAssignee).map(([name, data]) => ({
    name: name.split(' ')[0], // Solo primer nombre para el gráfico
    fullName: name,
    completadas: data.completed,
    pendientes: data.total - data.completed,
    total: data.total,
    porcentaje: Math.round((data.completed / data.total) * 100)
  })).sort((a, b) => b.completadas - a.completadas)

  // Top performers
  const topPerformers = teamData.slice(0, 3)

  // Datos para el gráfico de distribución por tipo
  const typeData = Object.entries(metrics.issuesByType).map(([type, count]) => ({
    name: type,
    value: count
  }))

  // Datos para el gráfico de distribución por prioridad (comentado por ahora)
  // const priorityData = Object.entries(metrics.issuesByPriority).map(([priority, count]) => ({
  //   name: priority,
  //   value: count
  // }))

  const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899']

  // Calcular eficiencia del equipo
  const teamEfficiency = metrics.totalStoryPoints > 0 
    ? Math.round((metrics.completedStoryPoints / metrics.totalStoryPoints) * 100)
    : 0

  // Identificar miembros que necesitan ayuda
  const needsHelp = teamData.filter(member => member.porcentaje < 30 && member.total > 2)

  return (
    <div className="space-y-6">
      {/* Resumen Ejecutivo */}
      <Card>
        <CardHeader>
          <CardTitle>Resumen Ejecutivo del Sprint</CardTitle>
          <CardDescription>
            Análisis de rendimiento y recomendaciones para la gerencia
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="space-y-4">
              <div>
                <p className="text-sm text-muted-foreground mb-1">Eficiencia del Equipo</p>
                <div className="flex items-center gap-2">
                  <Progress value={teamEfficiency} className="flex-1" />
                  <span className="font-bold text-lg">{teamEfficiency}%</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {teamEfficiency >= 80 ? 'Excelente' : teamEfficiency >= 60 ? 'Bueno' : 'Necesita mejora'}
                </p>
              </div>
              
              <div>
                <p className="text-sm text-muted-foreground mb-1">Velocidad vs Promedio</p>
                <div className="flex items-center gap-2">
                  {metrics.completedStoryPoints > metrics.velocity ? (
                    <>
                      <TrendingUp className="h-5 w-5 text-green-600" />
                      <span className="text-green-600 font-medium">
                        +{Math.round(((metrics.completedStoryPoints - metrics.velocity) / metrics.velocity) * 100)}%
                      </span>
                    </>
                  ) : (
                    <>
                      <TrendingUp className="h-5 w-5 text-orange-600 rotate-180" />
                      <span className="text-orange-600 font-medium">
                        -{Math.round(((metrics.velocity - metrics.completedStoryPoints) / metrics.velocity) * 100)}%
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">Estado Actual</p>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm flex items-center gap-1">
                    <CheckCircle className="h-4 w-4 text-green-600" />
                    Completadas
                  </span>
                  <span className="font-medium">{metrics.completedIssues}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm flex items-center gap-1">
                    <div className="h-4 w-4 rounded-full bg-blue-600" />
                    En Progreso
                  </span>
                  <span className="font-medium">{metrics.inProgressIssues}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm flex items-center gap-1">
                    <AlertTriangle className="h-4 w-4 text-red-600" />
                    Bloqueadas
                  </span>
                  <span className="font-medium">{metrics.blockedIssues}</span>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">Recomendaciones</p>
              <ul className="text-sm space-y-1">
                {metrics.blockedIssues > 0 && (
                  <li className="text-red-600">
                    • Resolver {metrics.blockedIssues} tareas bloqueadas urgentemente
                  </li>
                )}
                {teamEfficiency < 60 && (
                  <li className="text-orange-600">
                    • Revisar la planificación del sprint
                  </li>
                )}
                {needsHelp.length > 0 && (
                  <li className="text-orange-600">
                    • {needsHelp.length} miembros necesitan apoyo
                  </li>
                )}
                {teamEfficiency >= 80 && (
                  <li className="text-green-600">
                    • Mantener el ritmo actual
                  </li>
                )}
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Top Performers */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-yellow-600" />
            Top Performers del Sprint
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {topPerformers.map((performer, index) => (
              <div key={performer.fullName} className="p-4 border rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <Avatar className="h-12 w-12">
                      <AvatarFallback>
                        {performer.fullName.split(' ').map(n => n[0]).join('')}
                      </AvatarFallback>
                    </Avatar>
                    <Badge 
                      className="absolute -top-1 -right-1 h-6 w-6 p-0 flex items-center justify-center"
                      variant={index === 0 ? 'default' : 'secondary'}
                    >
                      {index + 1}
                    </Badge>
                  </div>
                  <div className="flex-1">
                    <p className="font-medium">{performer.fullName}</p>
                    <p className="text-sm text-muted-foreground">
                      {performer.completadas} tareas completadas
                    </p>
                  </div>
                  <Award className={`h-5 w-5 ${
                    index === 0 ? 'text-yellow-600' : 
                    index === 1 ? 'text-gray-400' : 'text-orange-600'
                  }`} />
                </div>
                <Progress value={performer.porcentaje} className="mt-3" />
                <p className="text-xs text-muted-foreground mt-1 text-center">
                  {performer.porcentaje}% de eficiencia
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Gráficos de distribución */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Rendimiento por miembro */}
        <Card>
          <CardHeader>
            <CardTitle>Rendimiento Individual</CardTitle>
            <CardDescription>Tareas completadas vs pendientes por miembro</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={teamData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip 
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload
                      return (
                        <div className="bg-white p-3 border rounded-lg shadow-lg">
                          <p className="font-medium">{data.fullName}</p>
                          <p className="text-sm">Completadas: {data.completadas}</p>
                          <p className="text-sm">Pendientes: {data.pendientes}</p>
                          <p className="text-sm font-medium">Eficiencia: {data.porcentaje}%</p>
                        </div>
                      )
                    }
                    return null
                  }}
                />
                <Legend />
                <Bar dataKey="completadas" fill="#10b981" name="Completadas" />
                <Bar dataKey="pendientes" fill="#f59e0b" name="Pendientes" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Distribución por tipo */}
        <Card>
          <CardHeader>
            <CardTitle>Distribución por Tipo</CardTitle>
            <CardDescription>Tipos de tareas en el sprint</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={typeData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name} ${((percent || 0) * 100).toFixed(0)}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {typeData.map((_entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {typeData.map((type, index) => (
                <div key={type.name} className="flex items-center gap-2">
                  <div 
                    className="w-3 h-3 rounded-full" 
                    style={{ backgroundColor: COLORS[index % COLORS.length] }}
                  />
                  <span className="text-sm">{type.name}: {type.value}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Alertas y recomendaciones */}
      {(needsHelp.length > 0 || metrics.blockedIssues > 0) && (
        <Card className="border-orange-200 bg-orange-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-orange-600" />
              Puntos de Atención
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {metrics.blockedIssues > 0 && (
                <div>
                  <p className="font-medium text-orange-800">Tareas Bloqueadas</p>
                  <p className="text-sm text-orange-700">
                    Hay {metrics.blockedIssues} tareas bloqueadas que requieren atención inmediata 
                    para no impactar el cumplimiento del sprint.
                  </p>
                </div>
              )}
              
              {needsHelp.length > 0 && (
                <div>
                  <p className="font-medium text-orange-800">Miembros que Necesitan Apoyo</p>
                  <div className="mt-2 space-y-2">
                    {needsHelp.map(member => (
                      <div key={member.fullName} className="flex items-center justify-between p-2 bg-white rounded">
                        <span className="text-sm">{member.fullName}</span>
                        <span className="text-sm text-orange-700">
                          {member.completadas}/{member.total} completadas ({member.porcentaje}%)
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}