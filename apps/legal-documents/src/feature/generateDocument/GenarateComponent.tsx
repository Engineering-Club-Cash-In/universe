import { useState } from 'react'
import { Wizard, type WizardStep } from '@/components/wizard/Wizard'
import { Step1 } from './components/Step1'
import { Step2 } from './components/Step2'


interface DocumentData {
  // Step 1
  documentTypes?: string[]
  // Step 2
  dpi?: string
  renapData?: {
    dpi: string
    firstName: string
    secondName: string
    thirdName: string
    firstLastName: string
    secondLastName: string
    marriedLastName: string
    picture: string
    birthDate: string
    gender: string
    civil_status: string
    nationality: string
    borned_in: string
    department_borned_in: string
    municipality_borned_in: string
    deathDate: string
    ocupation: string
    cedula_order: string
    cedula_register: string
    dpi_expiracy_date: string
  }
  // Step 3
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

  const handleDataChange = (field: string, value: string | boolean | string[] | object | null) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }))
  }

  const validateStep = (step: number): boolean => {
    switch (step) {
      case 1:
        return !!(formData.documentTypes && formData.documentTypes.length > 0)
      case 2:
        return !!(formData.renapData && formData.dpi)
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
      title: "Seleccionar Documentos",
      description: "Elige los tipos de documentos legales que necesitas",
      component: <Step1 data={formData} onChange={handleDataChange} />
    },
    {
      id: 2,
      title: "Información del Firmante",
      description: "Consulta los datos del DPI de quien firmará los documentos",
      component: <Step2 data={formData} onChange={handleDataChange} />
    },
    {
      id: 3,
      title: "Revisión y Generación",
      description: "Revisa la información y genera los documentos",
      component: (
        <div className="text-center py-12">
          <h3 className="text-lg font-medium mb-4">Resumen de la información</h3>
          <div className="space-y-4 text-left max-w-2xl mx-auto">
            <div>
              <strong>Documentos seleccionados:</strong>
              <ul className="list-disc list-inside ml-4">
                {formData.documentTypes?.map((docType) => (
                  <li key={docType}>{docType}</li>
                ))}
              </ul>
            </div>
            {formData.renapData && (
              <div>
                <strong>Firmante:</strong>
                <p className="ml-4">
                  {formData.renapData.firstName} {formData.renapData.secondName} {' '}
                  {formData.renapData.firstLastName} {formData.renapData.secondLastName}
                </p>
                <p className="ml-4 text-muted-foreground">DPI: {formData.renapData.dpi}</p>
              </div>
            )}
          </div>
        </div>
      )
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
