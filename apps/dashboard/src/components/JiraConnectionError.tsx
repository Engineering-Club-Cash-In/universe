import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AlertTriangle, RefreshCw, Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface JiraConnectionErrorProps {
  onRetry?: () => void
}

export default function JiraConnectionError({ onRetry }: JiraConnectionErrorProps) {
  return (
    <div className="flex items-center justify-center min-h-screen p-4">
      <Card className="max-w-2xl w-full">
        <CardHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-6 w-6 text-orange-600" />
            <CardTitle>Error de Conexión con Jira</CardTitle>
          </div>
          <CardDescription>
            No se pudo establecer conexión con la API de Jira
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="p-4 bg-orange-50 border border-orange-200 rounded-lg">
            <h3 className="font-semibold text-orange-800 mb-2">Posibles causas:</h3>
            <ul className="space-y-2 text-sm text-orange-700">
              <li>• Las credenciales de Jira no están configuradas correctamente</li>
              <li>• El token de API ha expirado o es inválido</li>
              <li>• El Board ID no existe o no tienes permisos para accederlo</li>
              <li>• Problemas de red o el servidor de Jira no está disponible</li>
            </ul>
          </div>

          <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <h3 className="font-semibold text-blue-800 mb-2">Para solucionarlo:</h3>
            <ol className="space-y-2 text-sm text-blue-700">
              <li>1. Verifica que las credenciales en el archivo <code className="bg-white px-1 py-0.5 rounded">.env</code> sean correctas</li>
              <li>2. Genera un nuevo token en: <a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" className="underline">Atlassian API Tokens</a></li>
              <li>3. Confirma el Board ID en la URL de tu tablero de Jira</li>
              <li>4. Reinicia el servidor de desarrollo con <code className="bg-white px-1 py-0.5 rounded">bun run dev</code></li>
            </ol>
          </div>

          <div className="flex gap-2">
            {onRetry && (
              <Button onClick={onRetry} className="flex items-center gap-2">
                <RefreshCw className="h-4 w-4" />
                Reintentar
              </Button>
            )}
            <Button 
              variant="outline" 
              onClick={() => window.open('/JIRA_SETUP.md', '_blank')}
              className="flex items-center gap-2"
            >
              <Settings className="h-4 w-4" />
              Ver Guía de Configuración
            </Button>
          </div>

          <div className="text-xs text-muted-foreground mt-4 p-3 bg-gray-50 rounded">
            <strong>Nota para desarrollo:</strong> El dashboard usa un proxy en desarrollo para evitar problemas de CORS. 
            Para producción, necesitarás implementar un backend que maneje las llamadas a Jira.
          </div>
        </CardContent>
      </Card>
    </div>
  )
}