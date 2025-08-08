import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Area, AreaChart } from 'recharts'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'

interface BurndownData {
  date: string
  remaining: number
  ideal: number
  completed: number
}

interface BurndownChartProps {
  data: BurndownData[]
}

export default function BurndownChart({ data }: BurndownChartProps) {
  const formatDate = (dateStr: string) => {
    return format(parseISO(dateStr), 'dd MMM', { locale: es })
  }

  const totalPoints = data[0]?.remaining + data[0]?.completed || 0
  const currentRemaining = data[data.length - 1]?.remaining || 0
  const idealRemaining = data[data.length - 1]?.ideal || 0
  const deviation = currentRemaining - idealRemaining
  const deviationPercentage = idealRemaining > 0 ? (deviation / idealRemaining) * 100 : 0

  return (
    <Card>
      <CardHeader>
        <CardTitle>Gráfico Burndown del Sprint</CardTitle>
        <CardDescription>
          Progreso de Story Points a lo largo del tiempo
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-4 grid grid-cols-3 gap-4">
          <div className="text-center p-3 bg-muted rounded-lg">
            <p className="text-sm text-muted-foreground">Total Inicial</p>
            <p className="text-2xl font-bold">{totalPoints}</p>
            <p className="text-xs text-muted-foreground">Story Points</p>
          </div>
          <div className="text-center p-3 bg-muted rounded-lg">
            <p className="text-sm text-muted-foreground">Restante Actual</p>
            <p className="text-2xl font-bold text-blue-600">{currentRemaining}</p>
            <p className="text-xs text-muted-foreground">Story Points</p>
          </div>
          <div className="text-center p-3 bg-muted rounded-lg">
            <p className="text-sm text-muted-foreground">Desviación</p>
            <p className={`text-2xl font-bold ${deviation > 0 ? 'text-red-600' : 'text-green-600'}`}>
              {deviation > 0 ? '+' : ''}{deviation}
            </p>
            <p className="text-xs text-muted-foreground">
              {Math.abs(Math.round(deviationPercentage))}% {deviation > 0 ? 'retrasado' : 'adelantado'}
            </p>
          </div>
        </div>

        <ResponsiveContainer width="100%" height={400}>
          <AreaChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="colorRemaining" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8}/>
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.1}/>
              </linearGradient>
              <linearGradient id="colorIdeal" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis 
              dataKey="date" 
              tickFormatter={formatDate}
              tick={{ fontSize: 12 }}
              stroke="#6b7280"
            />
            <YAxis 
              tick={{ fontSize: 12 }}
              stroke="#6b7280"
              label={{ value: 'Story Points', angle: -90, position: 'insideLeft' }}
            />
            <Tooltip 
              formatter={(value: number) => `${value} points`}
              labelFormatter={(label) => `Fecha: ${formatDate(label)}`}
              contentStyle={{
                backgroundColor: 'rgba(255, 255, 255, 0.95)',
                border: '1px solid #e5e7eb',
                borderRadius: '6px'
              }}
            />
            <Legend 
              wrapperStyle={{ paddingTop: '20px' }}
              iconType="line"
            />
            <Area
              type="monotone"
              dataKey="ideal"
              stroke="#10b981"
              fillOpacity={1}
              fill="url(#colorIdeal)"
              strokeWidth={2}
              strokeDasharray="5 5"
              name="Ideal"
            />
            <Area
              type="monotone"
              dataKey="remaining"
              stroke="#3b82f6"
              fillOpacity={1}
              fill="url(#colorRemaining)"
              strokeWidth={3}
              name="Restante Real"
            />
            <Line
              type="monotone"
              dataKey="completed"
              stroke="#f59e0b"
              strokeWidth={2}
              dot={{ fill: '#f59e0b', r: 4 }}
              name="Completado"
            />
          </AreaChart>
        </ResponsiveContainer>

        <div className="mt-4 p-4 bg-muted rounded-lg">
          <h4 className="font-semibold mb-2">Análisis del Progreso</h4>
          <div className="space-y-2 text-sm">
            {deviation > 0 ? (
              <>
                <p className="text-orange-600">
                  ⚠️ El equipo está {Math.abs(Math.round(deviationPercentage))}% por detrás del ritmo ideal.
                </p>
                <p>
                  Se recomienda revisar impedimentos y considerar re-priorización de tareas.
                </p>
              </>
            ) : deviation < 0 ? (
              <>
                <p className="text-green-600">
                  ✅ El equipo está {Math.abs(Math.round(deviationPercentage))}% por delante del ritmo ideal.
                </p>
                <p>
                  Excelente progreso. El sprint va según lo planificado o mejor.
                </p>
              </>
            ) : (
              <p>El equipo está exactamente en el ritmo planificado.</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}