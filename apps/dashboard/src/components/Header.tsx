import { useState, useEffect } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Settings, LayoutDashboard, Plus } from 'lucide-react'
import { boardsService, type Board } from '@/services/boards'
import { useNavigate, useLocation } from '@tanstack/react-router'

export default function Header() {
  const navigate = useNavigate()
  const location = useLocation()
  const [boards, setBoards] = useState<Board[]>([])
  const [currentBoard, setCurrentBoard] = useState<Board | null>(null)

  useEffect(() => {
    loadBoards()
    // Escuchar cambios en localStorage (entre pestañas)
    const handleStorageChange = () => loadBoards()
    window.addEventListener('storage', handleStorageChange)
    
    // Escuchar cambios personalizados (misma pestaña)
    const handleBoardsUpdate = () => loadBoards()
    window.addEventListener('boards-updated', handleBoardsUpdate)
    
    return () => {
      window.removeEventListener('storage', handleStorageChange)
      window.removeEventListener('boards-updated', handleBoardsUpdate)
    }
  }, [])

  // Recargar cuando cambie la ruta
  useEffect(() => {
    loadBoards()
  }, [location.pathname])

  const loadBoards = () => {
    const loadedBoards = boardsService.getBoards()
    console.log('Loading boards in Header:', loadedBoards)
    setBoards(loadedBoards)
    const current = boardsService.getCurrentBoard()
    setCurrentBoard(current)
  }

  const handleBoardChange = (boardId: string) => {
    boardsService.setCurrentBoard(boardId)
    setCurrentBoard(boardsService.getCurrentBoard())
    // Recargar la página para actualizar los datos
    if (location.pathname === '/' || location.pathname === '/dashboard') {
      window.location.reload()
    }
  }

  const isAdminPage = location.pathname === '/admin/boards'
  const isDashboardPage = location.pathname === '/' || location.pathname === '/dashboard'

  if (!isDashboardPage && !isAdminPage) {
    return null // No mostrar header en otras páginas
  }

  return (
    <header className="border-b bg-background">
      <div className="container mx-auto px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <LayoutDashboard className="h-6 w-6 text-primary" />
              <h1 className="text-xl font-bold">Jira Dashboard</h1>
            </div>
            
            {isDashboardPage && (
              <>
                {boards.length > 0 ? (
                  <>
                    <div className="h-6 w-px bg-border" />
                    <Select value={currentBoard?.id || ''} onValueChange={handleBoardChange}>
                      <SelectTrigger className="w-[250px]">
                        <SelectValue placeholder="Seleccionar tablero">
                          {currentBoard?.name || 'Seleccionar tablero'}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {boards.map((board) => (
                          <SelectItem key={board.id} value={board.id}>
                            {board.name}
                            {board.isDefault && (
                              <Badge variant="secondary" className="ml-2 text-xs">Default</Badge>
                            )}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigate({ to: '/admin/boards' })}
                    className="flex items-center gap-2"
                  >
                    <Plus className="h-4 w-4" />
                    Agregar primer tablero
                  </Button>
                )}
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            {isDashboardPage && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate({ to: '/admin/boards' })}
                className="flex items-center gap-2"
              >
                <Settings className="h-4 w-4" />
                Administrar Tableros
              </Button>
            )}
            {isAdminPage && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate({ to: '/' })}
                className="flex items-center gap-2"
              >
                <LayoutDashboard className="h-4 w-4" />
                Volver al Dashboard
              </Button>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
