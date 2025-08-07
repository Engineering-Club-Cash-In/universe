import { Link } from '@tanstack/react-router'
import { Car, FileText } from 'lucide-react'

function App() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8">
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
