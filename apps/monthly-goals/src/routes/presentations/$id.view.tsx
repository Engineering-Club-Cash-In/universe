import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Progress } from '../../components/ui/progress'
import { Badge } from '../../components/ui/badge'
import { 
  ArrowLeft, 
  ArrowRight, 
  Maximize2, 
  Minimize2,
  Home,
  Target,
  TrendingUp,
  Users,
  Building2,
  Calendar,
  Award
} from 'lucide-react'
import { getPresentationSlides } from '../../server/functions/presentations'

export const Route = createFileRoute('/presentations/$id/view')({
  component: PresentationViewPage,
})

interface EmployeeGoal {
  description: string | null
  targetValue: number
  achievedValue: number
  percentage: number
  status: string | null
  notes: string | null
}

interface Employee {
  userName: string
  userImage: string | null
  goals: EmployeeGoal[]
}

interface Slide {
  type: 'cover' | 'department' | 'employees' | 'summary'
  title?: string
  subtitle?: string
  date?: Date
  departmentName?: string
  areaName?: string
  employees?: Employee[]
  totalGoals?: number
  completedGoals?: number
  averagePercentage?: number
  departmentCount?: number
}

function PresentationViewPage() {
  const { id } = Route.useParams()
  const navigate = useNavigate()
  const [currentSlide, setCurrentSlide] = useState(0)
  const [isFullscreen, setIsFullscreen] = useState(false)
  
  const { data } = useSuspenseQuery({
    queryKey: ['presentation-slides', id],
    queryFn: () => getPresentationSlides({ data: id }),
  })
  
  const { presentation, slides } = data
  
  const goToNextSlide = useCallback(() => {
    if (currentSlide < slides.length - 1) {
      setCurrentSlide(currentSlide + 1)
    }
  }, [currentSlide, slides.length])
  
  const goToPreviousSlide = useCallback(() => {
    if (currentSlide > 0) {
      setCurrentSlide(currentSlide - 1)
    }
  }, [currentSlide])
  
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen()
      setIsFullscreen(true)
    } else {
      document.exitFullscreen()
      setIsFullscreen(false)
    }
  }
  
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ') {
        goToNextSlide()
      } else if (e.key === 'ArrowLeft') {
        goToPreviousSlide()
      } else if (e.key === 'Escape') {
        if (isFullscreen) {
          toggleFullscreen()
        }
      } else if (e.key === 'f' || e.key === 'F') {
        toggleFullscreen()
      }
    }
    
    window.addEventListener('keydown', handleKeyPress)
    return () => window.removeEventListener('keydown', handleKeyPress)
  }, [currentSlide, isFullscreen, goToNextSlide, goToPreviousSlide])
  
  const getProgressColor = (percentage: number) => {
    if (percentage >= 80) return 'bg-green-500'
    if (percentage >= 50) return 'bg-yellow-500'
    return 'bg-red-500'
  }
  
  const getProgressTextColor = (percentage: number) => {
    if (percentage >= 80) return 'text-green-600'
    if (percentage >= 50) return 'text-yellow-600'
    return 'text-red-600'
  }
  
  const renderSlide = (slide: Slide) => {
    switch (slide.type) {
      case 'cover':
        return (
          <div className="flex flex-col items-center justify-center h-full space-y-8 text-center">
            <div className="space-y-4">
              <h1 className="text-6xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                {slide.title}
              </h1>
              <p className="text-3xl text-muted-foreground">
                {slide.subtitle}
              </p>
            </div>
            <div className="flex items-center gap-2 text-xl text-muted-foreground">
              <Calendar className="h-6 w-6" />
              {slide.date && new Date(slide.date).toLocaleDateString()}
            </div>
            <div className="absolute bottom-8 flex items-center gap-2 text-sm text-muted-foreground">
              <span>Presiona</span>
              <kbd className="px-2 py-1 bg-muted rounded">→</kbd>
              <span>o</span>
              <kbd className="px-2 py-1 bg-muted rounded">Espacio</kbd>
              <span>para continuar</span>
            </div>
          </div>
        )
        
      case 'department':
        return (
          <div className="flex flex-col items-center justify-center h-full space-y-8">
            <div className="flex items-center gap-4">
              <Building2 className="h-12 w-12 text-blue-600" />
              <h2 className="text-5xl font-bold">{slide.departmentName}</h2>
            </div>
          </div>
        )
        
      case 'employees':
        return (
          <div className="h-full p-8 space-y-6">
            <div className="text-center space-y-2">
              <h3 className="text-2xl font-semibold text-muted-foreground">{slide.areaName}</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-8">
              {slide.employees?.map((employee, idx) => (
                <Card key={idx} className="p-6 space-y-4">
                  <div className="flex items-center gap-3">
                    {employee.userImage ? (
                      <img
                        src={employee.userImage}
                        alt={employee.userName}
                        className="w-12 h-12 rounded-full object-cover"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white font-semibold">
                        {employee.userName.split(' ').map(n => n[0]).join('')}
                      </div>
                    )}
                    <div>
                      <h4 className="font-semibold text-lg">{employee.userName}</h4>
                      <p className="text-sm text-muted-foreground">
                        {employee.goals.length} {employee.goals.length === 1 ? 'meta' : 'metas'}
                      </p>
                    </div>
                  </div>
                  
                  <div className="space-y-3">
                    {employee.goals.map((goal, goalIdx) => (
                      <div key={goalIdx} className="space-y-2">
                        <div className="flex items-start gap-2">
                          <Target className="h-4 w-4 text-muted-foreground mt-0.5" />
                          <p className="text-sm flex-1">
                            {goal.description || 'Meta mensual'}
                          </p>
                        </div>
                        <div className="space-y-1">
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">
                              {goal.achievedValue} / {goal.targetValue}
                            </span>
                            <span className={`font-semibold ${getProgressTextColor(goal.percentage)}`}>
                              {goal.percentage}%
                            </span>
                          </div>
                          <Progress 
                            value={goal.percentage} 
                            className="h-2"
                            indicatorClassName={getProgressColor(goal.percentage)}
                          />
                        </div>
                        {goal.notes && (
                          <p className="text-xs text-muted-foreground italic">
                            {goal.notes}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )
        
      case 'summary':
        return (
          <div className="flex flex-col items-center justify-center h-full space-y-8">
            <h2 className="text-4xl font-bold">Resumen de la Presentación</h2>
            
            <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
              <Card className="p-6 text-center space-y-2">
                <Users className="h-8 w-8 mx-auto text-blue-600" />
                <p className="text-3xl font-bold">{slide.departmentCount}</p>
                <p className="text-sm text-muted-foreground">Departamentos</p>
              </Card>
              
              <Card className="p-6 text-center space-y-2">
                <Target className="h-8 w-8 mx-auto text-purple-600" />
                <p className="text-3xl font-bold">{slide.totalGoals}</p>
                <p className="text-sm text-muted-foreground">Metas Totales</p>
              </Card>
              
              <Card className="p-6 text-center space-y-2">
                <Award className="h-8 w-8 mx-auto text-green-600" />
                <p className="text-3xl font-bold">{slide.completedGoals}</p>
                <p className="text-sm text-muted-foreground">Metas Completadas</p>
              </Card>
              
              <Card className="p-6 text-center space-y-2">
                <TrendingUp className="h-8 w-8 mx-auto text-orange-600" />
                <p className="text-3xl font-bold">{slide.averagePercentage}%</p>
                <p className="text-sm text-muted-foreground">Promedio General</p>
              </Card>
            </div>
            
            <div className="mt-8">
              <Badge 
                variant="outline" 
                className={`text-lg px-4 py-2 ${
                  (slide.averagePercentage || 0) >= 80 
                    ? 'border-green-500 text-green-600' 
                    : (slide.averagePercentage || 0) >= 50
                    ? 'border-yellow-500 text-yellow-600'
                    : 'border-red-500 text-red-600'
                }`}
              >
                {(slide.averagePercentage || 0) >= 80 
                  ? '¡Excelente Desempeño!' 
                  : (slide.averagePercentage || 0) >= 50
                  ? 'Buen Progreso'
                  : 'Necesita Mejora'}
              </Badge>
            </div>
          </div>
        )
        
      default:
        return null
    }
  }
  
  return (
    <div className={`h-screen flex flex-col ${isFullscreen ? 'bg-background' : ''}`}>
      {!isFullscreen && (
        <div className="border-b px-4 py-2 flex items-center justify-between bg-background">
          <div className="flex items-center gap-4">
            <Button
              variant="outline"
              size="icon"
              onClick={() => navigate({ to: '/presentations' })}
            >
              <Home className="h-4 w-4" />
            </Button>
            <span className="text-sm text-muted-foreground">
              {presentation.name}
            </span>
          </div>
          
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {currentSlide + 1} / {slides.length}
            </span>
            <Button
              variant="outline"
              size="icon"
              onClick={toggleFullscreen}
            >
              {isFullscreen ? (
                <Minimize2 className="h-4 w-4" />
              ) : (
                <Maximize2 className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      )}
      
      <div className="flex-1 relative overflow-hidden">
        <div className="absolute inset-0 flex items-center justify-center p-8">
          <div className="w-full max-w-6xl h-full">
            {renderSlide(slides[currentSlide] as Slide)}
          </div>
        </div>
        
        <button
          onClick={goToPreviousSlide}
          disabled={currentSlide === 0}
          className={`absolute left-4 top-1/2 -translate-y-1/2 p-2 rounded-full bg-background/80 backdrop-blur border shadow-lg hover:bg-accent transition-colors ${
            currentSlide === 0 ? 'opacity-50 cursor-not-allowed' : ''
          }`}
        >
          <ArrowLeft className="h-6 w-6" />
        </button>
        
        <button
          onClick={goToNextSlide}
          disabled={currentSlide === slides.length - 1}
          className={`absolute right-4 top-1/2 -translate-y-1/2 p-2 rounded-full bg-background/80 backdrop-blur border shadow-lg hover:bg-accent transition-colors ${
            currentSlide === slides.length - 1 ? 'opacity-50 cursor-not-allowed' : ''
          }`}
        >
          <ArrowRight className="h-6 w-6" />
        </button>
        
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-1">
          {slides.map((_, idx) => (
            <button
              key={idx}
              onClick={() => setCurrentSlide(idx)}
              className={`w-2 h-2 rounded-full transition-all ${
                idx === currentSlide 
                  ? 'bg-primary w-8' 
                  : 'bg-muted-foreground/30 hover:bg-muted-foreground/50'
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  )
}