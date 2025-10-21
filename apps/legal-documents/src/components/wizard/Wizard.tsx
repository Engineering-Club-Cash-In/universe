import { type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'

export interface WizardStep {
  id: number
  title: string
  description?: string
  component: ReactNode
}

interface WizardProps {
  readonly steps: WizardStep[]
  readonly currentStep: number
  readonly onNext: () => void
  readonly onPrevious: () => void
  readonly onStepClick?: (stepId: number) => void
  readonly canGoNext?: boolean
  readonly canGoPrevious?: boolean
  readonly nextLabel?: string
  readonly previousLabel?: string
  readonly finishLabel?: string
  readonly isLoading?: boolean
}

export function Wizard({
  steps,
  currentStep,
  onNext,
  onPrevious,
  onStepClick,
  canGoNext = true,
  canGoPrevious = true,
  nextLabel = "Siguiente",
  previousLabel = "Anterior",
  finishLabel = "Finalizar",
  isLoading = false
}: WizardProps) {
  const progress = (currentStep / steps.length) * 100
  const currentStepData = steps.find(step => step.id === currentStep)
  const isFirstStep = currentStep === 1
  const isLastStep = currentStep === steps.length

  return (
    <Card className="w-full  ">
      <CardHeader>
        {/* Step indicators */}
        <div className="flex justify-between items-center mb-4">
          {steps.map((step, index) => (
            <div key={step.id} className="flex items-center">
              <Badge 
                variant={currentStep >= step.id ? "default" : "outline"}
                className={`
                  ${onStepClick && currentStep > step.id ? 'cursor-pointer hover:bg-primary/80' : ''}
                  ${currentStep === step.id ? 'ring-2 ring-ring ring-offset-2' : ''}
                `}
                onClick={() => onStepClick && currentStep > step.id && onStepClick(step.id)}
              >
                {step.id}
              </Badge>
              {index < steps.length - 1 && (
                <div className={`h-0.5 w-8 mx-2 ${
                  currentStep > step.id ? 'bg-primary' : 'bg-muted'
                }`} />
              )}
            </div>
          ))}
        </div>

        {/* Progress bar */}
        <Progress value={progress} className="mb-4" />

        {/* Current step info */}
        <div className="text-center">
          <CardTitle className="text-xl">{currentStepData?.title}</CardTitle>
          {currentStepData?.description && (
            <p className="text-muted-foreground mt-2">{currentStepData.description}</p>
          )}
        </div>

        <Separator className="mt-4" />
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Step content */}
        <div className="min-h-[300px]">
          {currentStepData?.component}
        </div>

        <Separator />

        {/* Navigation buttons */}
        <div className="flex justify-between items-center">
          <Button 
            variant="outline" 
            onClick={onPrevious}
            disabled={isFirstStep || !canGoPrevious || isLoading}
          >
            {previousLabel}
          </Button>

          <div className="text-sm text-muted-foreground">
            Paso {currentStep} de {steps.length}
          </div>

          <Button 
            onClick={onNext}
            disabled={!canGoNext || isLoading}
          >
            {(() => {
              if (isLoading) return "Cargando..."
              if (isLastStep) return finishLabel
              return nextLabel
            })()}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
