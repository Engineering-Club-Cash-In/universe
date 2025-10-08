import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Loader2, AlertCircle, FileText, CheckCircle } from 'lucide-react'
import { documentsService, documentsKeys } from '@/services/documents'

interface Step1Props {
  readonly data: {
    documentType?: string
  }
  readonly onChange: (field: string, value: string) => void
}

export function Step1({ data, onChange }: Step1Props) {
  // Obtener tipos de documentos desde la API
  const {
    data: documentsResponse,
    isLoading,
    error,
    isError
  } = useQuery({
    queryKey: documentsKeys.types(),
    queryFn: documentsService.getDocumentTypes,
    staleTime: 5 * 60 * 1000, // 5 minutos
    gcTime: 10 * 60 * 1000, // 10 minutos
  })

  const documentTypes = documentsResponse?.data || []

  // Estado de carga
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin mb-4" />
        <h3 className="text-lg font-medium mb-2">Cargando documentos disponibles</h3>
        <p className="text-muted-foreground text-center">
          Estamos obteniendo la lista de documentos legales que puedes generar...
        </p>
      </div>
    )
  }

  // Estado de error
  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <Alert variant="destructive" className="max-w-md">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="ml-2">
            <strong>Error al cargar documentos:</strong><br />
            {error?.message || 'No se pudieron cargar los tipos de documentos. Por favor, intenta de nuevo.'}
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      

      {documentTypes.length === 0 ? (
        <div className="text-center py-12">
          <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium mb-2">No hay documentos disponibles</h3>
          <p className="text-muted-foreground">
            No se encontraron tipos de documentos para generar.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {documentTypes.map((document) => (
            <Card
              key={document.enum}
              className={`cursor-pointer transition-all duration-200 hover:shadow-md border-2 ${
                data.documentType === document.enum
                  ? 'border-primary bg-primary/5 shadow-md'
                  : 'border-muted hover:border-primary/50'
              }`}
              onClick={() => onChange('documentType', document.enum)}
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center space-x-2">
                    <FileText className="h-5 w-5 text-primary" />
                    {data.documentType === document.enum && (
                      <CheckCircle className="h-4 w-4 text-primary" />
                    )}
                  </div>
                  {data.documentType === document.enum && (
                    <Badge variant="default" className="text-xs">
                      Seleccionado
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <CardTitle className="text-base mb-2 leading-tight">
                  {document.label}
                </CardTitle>
                
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {data.documentType && (
        <div className="bg-primary/5 border border-primary/20 p-4 rounded-lg">
          <div className="flex items-center space-x-2 mb-2">
            <CheckCircle className="h-5 w-5 text-primary" />
            <h3 className="font-medium text-primary">Documento seleccionado</h3>
          </div>
          <p className="text-sm text-muted-foreground">
            Has seleccionado: <strong>
              {documentTypes.find(doc => doc.enum === data.documentType)?.label}
            </strong>
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            Haz clic en "Continuar" para proceder con la configuración del documento.
          </p>
        </div>
      )}
    </div>
  )
}
