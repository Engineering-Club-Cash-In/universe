export interface Board {
  id: string
  boardId: number
  name: string
  projectKey: string
  description?: string
  isDefault?: boolean
  createdAt: string
  lastAccessed?: string
}

const BOARDS_STORAGE_KEY = 'jira_boards'
const CURRENT_BOARD_KEY = 'jira_current_board'

class BoardsService {
  // Emitir evento cuando se actualicen los tableros
  private emitBoardsUpdate() {
    window.dispatchEvent(new Event('boards-updated'))
  }

  // Obtener todos los tableros
  getBoards(): Board[] {
    const boards = localStorage.getItem(BOARDS_STORAGE_KEY)
    return boards ? JSON.parse(boards) : []
  }

  // Obtener un tablero por ID
  getBoard(id: string): Board | null {
    const boards = this.getBoards()
    return boards.find(board => board.id === id) || null
  }

  // Obtener el tablero actual
  getCurrentBoard(): Board | null {
    const currentBoardId = localStorage.getItem(CURRENT_BOARD_KEY)
    if (!currentBoardId) {
      // Si no hay tablero actual, intentar obtener el default
      const boards = this.getBoards()
      const defaultBoard = boards.find(b => b.isDefault)
      if (defaultBoard) {
        this.setCurrentBoard(defaultBoard.id)
        return defaultBoard
      }
      // Si no hay default, retornar el primero
      if (boards.length > 0) {
        this.setCurrentBoard(boards[0].id)
        return boards[0]
      }
      return null
    }
    return this.getBoard(currentBoardId)
  }

  // Establecer el tablero actual
  setCurrentBoard(boardId: string): void {
    localStorage.setItem(CURRENT_BOARD_KEY, boardId)
    // Actualizar lastAccessed
    const boards = this.getBoards()
    const updatedBoards = boards.map(board => 
      board.id === boardId 
        ? { ...board, lastAccessed: new Date().toISOString() }
        : board
    )
    localStorage.setItem(BOARDS_STORAGE_KEY, JSON.stringify(updatedBoards))
  }

  // Agregar un nuevo tablero
  addBoard(board: Omit<Board, 'id' | 'createdAt'>): Board {
    const boards = this.getBoards()
    const newBoard: Board = {
      ...board,
      id: `board_${Date.now()}`,
      createdAt: new Date().toISOString()
    }
    
    // Si es el primer tablero, hacerlo default
    if (boards.length === 0) {
      newBoard.isDefault = true
    }
    
    // Si se marca como default, desmarcar los demás
    if (newBoard.isDefault) {
      boards.forEach(b => b.isDefault = false)
    }
    
    boards.push(newBoard)
    localStorage.setItem(BOARDS_STORAGE_KEY, JSON.stringify(boards))
    
    // Si no hay tablero actual, establecer este
    if (!this.getCurrentBoard()) {
      this.setCurrentBoard(newBoard.id)
    }
    
    // Emitir evento de actualización
    this.emitBoardsUpdate()
    
    return newBoard
  }

  // Actualizar un tablero
  updateBoard(id: string, updates: Partial<Omit<Board, 'id' | 'createdAt'>>): Board | null {
    const boards = this.getBoards()
    const index = boards.findIndex(board => board.id === id)
    
    if (index === -1) return null
    
    // Si se marca como default, desmarcar los demás
    if (updates.isDefault) {
      boards.forEach(b => b.isDefault = false)
    }
    
    boards[index] = { ...boards[index], ...updates }
    localStorage.setItem(BOARDS_STORAGE_KEY, JSON.stringify(boards))
    
    // Emitir evento de actualización
    this.emitBoardsUpdate()
    
    return boards[index]
  }

  // Eliminar un tablero
  deleteBoard(id: string): boolean {
    const boards = this.getBoards()
    const filteredBoards = boards.filter(board => board.id !== id)
    
    if (filteredBoards.length === boards.length) return false
    
    // Si eliminamos el tablero actual, establecer otro
    const currentBoard = this.getCurrentBoard()
    if (currentBoard?.id === id) {
      if (filteredBoards.length > 0) {
        this.setCurrentBoard(filteredBoards[0].id)
      } else {
        localStorage.removeItem(CURRENT_BOARD_KEY)
      }
    }
    
    // Si eliminamos el default, hacer default al primero
    if (boards.find(b => b.id === id)?.isDefault && filteredBoards.length > 0) {
      filteredBoards[0].isDefault = true
    }
    
    localStorage.setItem(BOARDS_STORAGE_KEY, JSON.stringify(filteredBoards))
    
    // Emitir evento de actualización
    this.emitBoardsUpdate()
    
    return true
  }

  // Verificar si un tablero existe en Jira
  async verifyBoard(boardId: number): Promise<{ valid: boolean; name?: string; error?: string }> {
    try {
      const response = await fetch(`/api/jira/rest/agile/1.0/board/${boardId}`, {
        headers: {
          'Accept': 'application/json'
        }
      })
      
      if (response.ok) {
        const data = await response.json()
        return { valid: true, name: data.name }
      } else if (response.status === 404) {
        return { valid: false, error: 'Tablero no encontrado' }
      } else if (response.status === 401) {
        return { valid: false, error: 'Sin permisos para acceder al tablero' }
      } else {
        return { valid: false, error: `Error: ${response.status}` }
      }
    } catch (error) {
      return { valid: false, error: 'Error de conexión' }
    }
  }

  // Obtener tableros recientes
  getRecentBoards(limit: number = 5): Board[] {
    const boards = this.getBoards()
    return boards
      .filter(b => b.lastAccessed)
      .sort((a, b) => {
        const dateA = new Date(a.lastAccessed!).getTime()
        const dateB = new Date(b.lastAccessed!).getTime()
        return dateB - dateA
      })
      .slice(0, limit)
  }

  // Importar configuración desde el .env (para migración inicial)
  importFromEnv(): Board | null {
    const boardId = import.meta.env.VITE_JIRA_BOARD_ID
    if (!boardId) return null
    
    // Verificar si ya existe
    const boards = this.getBoards()
    const existingBoard = boards.find(b => b.boardId === parseInt(boardId))
    if (existingBoard) return existingBoard
    
    // Crear nuevo tablero desde .env
    return this.addBoard({
      boardId: parseInt(boardId),
      name: 'Tablero Principal',
      projectKey: 'PROJ',
      description: 'Tablero importado desde configuración inicial',
      isDefault: true
    })
  }
}

export const boardsService = new BoardsService()

// Auto-importar desde .env si no hay tableros
if (typeof window !== 'undefined') {
  const boards = boardsService.getBoards()
  if (boards.length === 0) {
    boardsService.importFromEnv()
  }
}