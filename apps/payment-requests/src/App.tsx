import { useState } from 'react'
import { PaymentForm } from './components/PaymentForm'
import { RequestsList } from './components/RequestsList'
import { PlusCircle, List } from 'lucide-react'

function App() {
  const [view, setView] = useState<'form' | 'list'>('form')

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col">
      {/* Navigation Header */}
      <div className="w-full border-b border-zinc-800 bg-zinc-900/50 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-4 flex justify-center">
          <div className="bg-zinc-900/80 border border-zinc-800 p-1.5 rounded-full shadow-sm flex gap-1">
            <button
              onClick={() => setView('form')}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all ${view === 'form'
                ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/25'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
                }`}
            >
              <PlusCircle className="w-4 h-4" />
              Nueva Solicitud
            </button>
            <button
              onClick={() => setView('list')}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all ${view === 'list'
                ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/25'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
                }`}
            >
              <List className="w-4 h-4" />
              Ver Solicitudes
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1">
        {view === 'form' ? <PaymentForm /> : <RequestsList />}
      </div>
    </div>
  )
}

export default App
