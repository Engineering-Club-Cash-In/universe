import { Link } from '@tanstack/react-router'
import { Car, FileText, LogOut } from 'lucide-react'
import { Button } from './components/ui/button'
import { authClient } from './lib/auth-client'

function App() {
  const { data: session } = authClient.useSession()

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8">
        <div className="mb-6 flex justify-end">
          {session ? (
            <div className="flex items-center gap-3 text-sm text-gray-600">
              <span>{session.user.email}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => authClient.signOut()}
              >
                <LogOut className="mr-2 h-4 w-4" />
                Cerrar sesión
              </Button>
            </div>
          ) : null}
        </div>
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            Sistema de Gestión de Taller
          </h1>
          <p className="text-lg text-gray-600">
            Gestione inspecciones y vehículos de manera eficiente
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-2xl mx-auto">
          <Link
            to="/vehicles"
            className="group block p-8 bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow"
          >
            <div className="flex flex-col items-center text-center">
              <Car className="w-16 h-16 text-blue-600 mb-4 group-hover:scale-110 transition-transform" />
              <h2 className="text-2xl font-semibold text-gray-900 mb-2">
                Panel de Vehículos
              </h2>
              <p className="text-gray-600">
                Ver y gestionar todos los vehículos inspeccionados
              </p>
            </div>
          </Link>

          <Link
            to="/vehicle-inspection"
            className="group block p-8 bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow"
          >
            <div className="flex flex-col items-center text-center">
              <FileText className="w-16 h-16 text-green-600 mb-4 group-hover:scale-110 transition-transform" />
              <h2 className="text-2xl font-semibold text-gray-900 mb-2">
                Nueva Inspección
              </h2>
              <p className="text-gray-600">
                Proceso completo: datos, evaluación y fotografías
              </p>
            </div>
          </Link>
        </div>
      </div>
    </div>
  )
}

export default App
