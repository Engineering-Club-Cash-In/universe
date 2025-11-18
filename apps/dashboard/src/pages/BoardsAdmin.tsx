import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { 
  Plus, 
  Edit2, 
  Trash2, 
  CheckCircle, 
  AlertCircle, 
  Settings,
  Star,
  Clock,
  ExternalLink,
  RefreshCw
} from 'lucide-react'
import { boardsService, type Board } from '@/services/boards'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { useNavigate } from '@tanstack/react-router'

export default function BoardsAdmin() {
  const navigate = useNavigate()
  const [boards, setBoards] = useState<Board[]>([])
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [editingBoard, setEditingBoard] = useState<Board | null>(null)
  const [isVerifying, setIsVerifying] = useState(false)
  const [verificationError, setVerificationError] = useState<string | null>(null)
  
  // Form state
  const [formData, setFormData] = useState({
    boardId: '',
    name: '',
    projectKey: '',
    description: '',
    isDefault: false
  })

  // Cargar tableros al montar y escuchar cambios
  useEffect(() => {
    loadBoards()
    
    // Escuchar cambios en los tableros
    const handleBoardsUpdate = () => loadBoards()
    window.addEventListener('boards-updated', handleBoardsUpdate)
    
    return () => {
      window.removeEventListener('boards-updated', handleBoardsUpdate)
    }
  }, [])

  const loadBoards = () => {
    const loadedBoards = boardsService.getBoards()
    setBoards(loadedBoards)
  }

  const resetForm = () => {
    setFormData({
      boardId: '',
      name: '',
      projectKey: '',
      description: '',
      isDefault: false
    })
    setVerificationError(null)
  }

  const handleVerifyBoard = async () => {
    if (!formData.boardId) {
      setVerificationError('Ingresa un ID de tablero')
      return
    }

    setIsVerifying(true)
    setVerificationError(null)

    const result = await boardsService.verifyBoard(parseInt(formData.boardId))
    
    if (result.valid && result.name) {
      setFormData(prev => ({
        ...prev,
        name: prev.name || result.name || '',
        projectKey: prev.projectKey || result.name?.split(' ')[0].toUpperCase() || ''
      }))
    } else {
      setVerificationError(result.error || 'Error al verificar el tablero')
    }

    setIsVerifying(false)
  }

  const handleAddBoard = async () => {
    if (!formData.boardId || !formData.name) {
      setVerificationError('Completa todos los campos requeridos')
      return
    }

    // Verificar que no exista
    const existing = boards.find(b => b.boardId === parseInt(formData.boardId))
    if (existing) {
      setVerificationError('Este tablero ya está registrado')
      return
    }

    const newBoard = boardsService.addBoard({
      boardId: parseInt(formData.boardId),
      name: formData.name,
      projectKey: formData.projectKey,
      description: formData.description,
      isDefault: formData.isDefault
    })

    setBoards([...boards, newBoard])
    setIsAddDialogOpen(false)
    resetForm()
  }

  const handleEditBoard = () => {
    if (!editingBoard || !formData.name) return

    const updated = boardsService.updateBoard(editingBoard.id, {
      name: formData.name,
      projectKey: formData.projectKey,
      description: formData.description,
      isDefault: formData.isDefault
    })

    if (updated) {
      loadBoards()
      setIsEditDialogOpen(false)
      setEditingBoard(null)
      resetForm()
    }
  }

  const handleDeleteBoard = (board: Board) => {
    if (confirm(`¿Estás seguro de eliminar el tablero "${board.name}"?`)) {
      boardsService.deleteBoard(board.id)
      loadBoards()
    }
  }

  const handleSetDefault = (board: Board) => {
    boardsService.updateBoard(board.id, { isDefault: true })
    loadBoards()
  }

  const handleUseBoard = (board: Board) => {
    boardsService.setCurrentBoard(board.id)
    navigate({ to: '/' })
  }

  const openEditDialog = (board: Board) => {
    setEditingBoard(board)
    setFormData({
      boardId: board.boardId.toString(),
      name: board.name,
      projectKey: board.projectKey,
      description: board.description || '',
      isDefault: board.isDefault || false
    })
    setIsEditDialogOpen(true)
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Administración de Tableros</h1>
          <p className="text-muted-foreground mt-1">
            Gestiona los tableros de Jira conectados al dashboard
          </p>
        </div>
        <Button onClick={() => navigate({ to: '/' })}>
          Volver al Dashboard
        </Button>
      </div>

      {/* Estadísticas */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Tableros</CardTitle>
            <Settings className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{boards.length}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Tablero Actual</CardTitle>
            <CheckCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-lg font-medium truncate">
              {boardsService.getCurrentBoard()?.name || 'No seleccionado'}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Tablero Default</CardTitle>
            <Star className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-lg font-medium truncate">
              {boards.find(b => b.isDefault)?.name || 'No configurado'}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Último Acceso</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-lg font-medium">
              {boardsService.getRecentBoards(1)[0]?.name || 'Sin actividad'}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabla de tableros */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <div>
              <CardTitle>Tableros Configurados</CardTitle>
              <CardDescription>
                Todos los tableros de Jira disponibles para el dashboard
              </CardDescription>
            </div>
            <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
              <DialogTrigger asChild>
                <Button className="flex items-center gap-2">
                  <Plus className="h-4 w-4" />
                  Agregar Tablero
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Agregar Nuevo Tablero</DialogTitle>
                  <DialogDescription>
                    Conecta un tablero de Jira al dashboard
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="boardId">ID del Tablero *</Label>
                    <div className="flex gap-2">
                      <Input
                        id="boardId"
                        type="number"
                        placeholder="Ej: 1"
                        value={formData.boardId}
                        onChange={(e) => setFormData(prev => ({ ...prev, boardId: e.target.value }))}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleVerifyBoard}
                        disabled={isVerifying || !formData.boardId}
                      >
                        {isVerifying ? (
                          <RefreshCw className="h-4 w-4 animate-spin" />
                        ) : (
                          'Verificar'
                        )}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Encuentra el ID en la URL del tablero en Jira
                    </p>
                    {verificationError && (
                      <p className="text-xs text-red-600 flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" />
                        {verificationError}
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="name">Nombre del Tablero *</Label>
                    <Input
                      id="name"
                      placeholder="Ej: Sprint Development"
                      value={formData.name}
                      onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="projectKey">Clave del Proyecto</Label>
                    <Input
                      id="projectKey"
                      placeholder="Ej: DEV"
                      value={formData.projectKey}
                      onChange={(e) => setFormData(prev => ({ ...prev, projectKey: e.target.value }))}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="description">Descripción</Label>
                    <Input
                      id="description"
                      placeholder="Descripción opcional"
                      value={formData.description}
                      onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                    />
                  </div>

                  <div className="flex items-center space-x-2">
                    <Switch
                      id="isDefault"
                      checked={formData.isDefault}
                      onCheckedChange={(checked) => setFormData(prev => ({ ...prev, isDefault: checked }))}
                    />
                    <Label htmlFor="isDefault">Establecer como tablero por defecto</Label>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                    Cancelar
                  </Button>
                  <Button onClick={handleAddBoard} disabled={!formData.boardId || !formData.name}>
                    Agregar
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {boards.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Settings className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No hay tableros configurados</p>
              <p className="text-sm mt-1">Agrega tu primer tablero para comenzar</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>ID</TableHead>
                  <TableHead>Proyecto</TableHead>
                  <TableHead>Descripción</TableHead>
                  <TableHead>Creado</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {boards.map((board) => {
                  const isCurrent = boardsService.getCurrentBoard()?.id === board.id
                  return (
                    <TableRow key={board.id}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          {board.name}
                          {board.isDefault && (
                            <Star className="h-4 w-4 text-yellow-500" />
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{board.boardId}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{board.projectKey}</Badge>
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate">
                        {board.description || '-'}
                      </TableCell>
                      <TableCell>
                        {format(parseISO(board.createdAt), 'dd MMM yyyy', { locale: es })}
                      </TableCell>
                      <TableCell>
                        {isCurrent && (
                          <Badge variant="default">Activo</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-2">
                          {!isCurrent && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleUseBoard(board)}
                            >
                              Usar
                            </Button>
                          )}
                          {!board.isDefault && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleSetDefault(board)}
                              title="Establecer como default"
                            >
                              <Star className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEditDialog(board)}
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => window.open(`https://clubcashin.atlassian.net/jira/software/projects/${board.projectKey}/boards/${board.boardId}`, '_blank')}
                          >
                            <ExternalLink className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteBoard(board)}
                            disabled={boards.length === 1}
                          >
                            <Trash2 className="h-4 w-4 text-red-600" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Dialog de edición */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Tablero</DialogTitle>
            <DialogDescription>
              Modifica la información del tablero
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name">Nombre del Tablero *</Label>
              <Input
                id="edit-name"
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-projectKey">Clave del Proyecto</Label>
              <Input
                id="edit-projectKey"
                value={formData.projectKey}
                onChange={(e) => setFormData(prev => ({ ...prev, projectKey: e.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-description">Descripción</Label>
              <Input
                id="edit-description"
                value={formData.description}
                onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
              />
            </div>

            <div className="flex items-center space-x-2">
              <Switch
                id="edit-isDefault"
                checked={formData.isDefault}
                onCheckedChange={(checked) => setFormData(prev => ({ ...prev, isDefault: checked }))}
              />
              <Label htmlFor="edit-isDefault">Establecer como tablero por defecto</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleEditBoard}>
              Guardar Cambios
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}