import { useState } from 'react'
import { Wizard, type WizardStep } from '@/components/wizard/Wizard'
import { Step1 } from './components/Step1'


interface DocumentData {
  // Step 1
  documentType?: string
  clientName?: string
  clientEmail?: string
  clientPhone?: string
  // Step 2
  documentDescription?: string
  projectValue?: string
  duration?: string
  paymentTerms?: string
  includeIntellectualProperty?: boolean
  includeTermination?: boolean
  additionalClauses?: string
}

export function GenerateComponent() {
  const [currentStep, setCurrentStep] = useState(1)
  const [formData, setFormData] = useState<DocumentData>({})
  const [isLoading, setIsLoading] = useState(false)

  const handleDataChange = (field: string, value: string | boolean) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }))
  }

  const validateStep = (step: number): boolean => {
    switch (step) {
      case 1:
        return !!(formData.documentType)
      case 2:
        return !!(formData.documentDescription)
      case 3:
        return true
      default:
        return false
    }
  }

  const handleNext = async () => {
    if (currentStep === steps.length) {
      // Generar documento
      setIsLoading(true)
      try {
        // Simular generación de documento
        await new Promise(resolve => setTimeout(resolve, 3000))
        
        console.log('Generando documento con los siguientes datos:', formData)
        
        // Aquí iría la lógica para generar el documento
        // Por ejemplo, llamar a una API o generar PDF
        
        alert('¡Documento generado exitosamente! 📄')
        
        // Opcional: resetear el wizard
        // setCurrentStep(1)
        // setFormData({})
        
      } catch (error) {
        console.error('Error generando documento:', error)
        alert('Error al generar el documento. Por favor, intenta de nuevo.')
      } finally {
        setIsLoading(false)
      }
    } else {
      setCurrentStep(prev => prev + 1)
    }
  }

  const handlePrevious = () => {
    setCurrentStep(prev => Math.max(1, prev - 1))
  }

  const handleStepClick = (stepId: number) => {
    // Solo permitir navegar a pasos anteriores o al actual
    if (stepId <= currentStep) {
      setCurrentStep(stepId)
    }
  }

  const steps: WizardStep[] = [
    {
      id: 1,
      title: "Selecciona el documento que necesitas",
      description: "Elige el tipo de documento legal que quieres generar",
      component: <Step1 data={formData} onChange={handleDataChange} />
    },
    {
      id: 2,
      title: "Detalles del Documento",
      description: "Especifica el contenido y términos del documento",
      component: <></>
    },
    {
      id: 3,
      title: "Revisión y Generación",
      description: "Revisa la información y genera el documento",
      component: <></>
    }
  ]

  return (
    <div className=" p-6">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2">Generador de Documentos Legales</h1>
          <p className="text-muted-foreground">
            Crea documentos legales personalizados en minutos
          </p>
        </div>

        <Wizard
          steps={steps}
          currentStep={currentStep}
          onNext={handleNext}
          onPrevious={handlePrevious}
          onStepClick={handleStepClick}
          canGoNext={validateStep(currentStep)}
          isLoading={isLoading}
          finishLabel="Generar Documento"
          nextLabel="Continuar"
          previousLabel="Volver"
        />

        {isLoading && (
          <div className="mt-6 text-center">
            <p className="text-muted-foreground animate-pulse">
              Generando tu documento legal personalizado...
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
