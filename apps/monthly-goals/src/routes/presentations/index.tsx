import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '../../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '../../components/ui/dialog'
import { Label } from '../../components/ui/label'
import { Input } from '../../components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'
import { Badge } from '../../components/ui/badge'
import { Plus, Eye, Upload, Presentation, Calendar, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Link } from '@tanstack/react-router'
import { useRole } from '../../lib/auth/hooks'
import { getPresentations, createPresentation, deletePresentation } from '../../server/functions/presentations'

export const Route = createFileRoute('/presentations/')({
  component: PresentationsPage,
})

interface PresentationData {
  id: string
  name: string
  month: number
  year: number
  status: 'draft' | 'ready' | 'presented'
  createdBy: string
  createdByName: string | null
  presentedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

function PresentationsPage() {
  const { isManager, isAdmin } = useRole()
  const queryClient = useQueryClient()
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [deletingPresentation, setDeletingPresentation] = useState<PresentationData | null>(null)
  
  const { data: presentations } = useSuspenseQuery({
    queryKey: ['presentations'],
    queryFn: () => getPresentations(),
  })
  
  const createMutation = useMutation({
    mutationFn: async (formData: { name: string; month: number; year: number }) =>
      await createPresentation({ data: formData }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['presentations'] })
      toast.success('Presentación creada exitosamente')
      setIsCreateOpen(false)
    },
    onError: (error) => {
      toast.error(error.message || 'Error al crear la presentación')
    },
  })
  
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => await deletePresentation({ data: id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['presentations'] })
      toast.success('Presentación eliminada exitosamente')
      setDeletingPresentation(null)
    },
    onError: (error) => {
      toast.error(error.message || 'Error al eliminar la presentación')
    },
  })
  
  const handleCreate = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    
    createMutation.mutate({
      name: formData.get('name') as string,
      month: Number(formData.get('month')),
      year: Number(formData.get('year')),
    })
  }
  
  const getMonthName = (month: number): string => {
    const months = [
      'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
      'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
    ]
    return months[month - 1] || ''
  }
  
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'draft':
        return 'secondary'
      case 'ready':
        return 'default'
      case 'presented':
        return 'outline'
      default:
        return 'secondary'
    }
  }
  
  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'draft':
        return 'Borrador'
      case 'ready':
        return 'Lista'
      case 'presented':
        return 'Presentada'
      default:
        return status
    }
  }
  
  const currentMonth = new Date().getMonth() + 1
  const currentYear = new Date().getFullYear()
  
  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Presentaciones</h1>
          <p className="text-muted-foreground">
            Gestiona las presentaciones mensuales de metas
          </p>
        </div>
        {(isManager || isAdmin) && (
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Nueva Presentación
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Crear Nueva Presentación</DialogTitle>
                <DialogDescription>
                  Crea una presentación para un mes específico
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleCreate}>
                <div className="grid gap-4 py-4">
                  <div className="grid gap-2">
                    <Label htmlFor="name">Nombre</Label>
                    <Input
                      id="name"
                      name="name"
                      placeholder="Presentación de Metas"
                      required
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="grid gap-2">
                      <Label htmlFor="month">Mes</Label>
                      <select
                        id="month"
                        name="month"
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        defaultValue={currentMonth}
                        required
                      >
                        {Array.from({ length: 12 }, (_, i) => (
                          <option key={i + 1} value={i + 1}>
                            {getMonthName(i + 1)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="year">Año</Label>
                      <Input
                        id="year"
                        name="year"
                        type="number"
                        min="2020"
                        max="2030"
                        defaultValue={currentYear}
                        required
                      />
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={createMutation.isPending}>
                    {createMutation.isPending ? 'Creando...' : 'Crear Presentación'}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>
      
      <Card>
        <CardHeader>
          <CardTitle>Presentaciones Disponibles</CardTitle>
          <CardDescription>
            Lista de todas las presentaciones creadas
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Período</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Creado por</TableHead>
                <TableHead>Fecha de Presentación</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {presentations?.map((presentation: PresentationData) => (
                <TableRow key={presentation.id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <Presentation className="h-4 w-4 text-muted-foreground" />
                      {presentation.name}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      {getMonthName(presentation.month)} {presentation.year}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={getStatusColor(presentation.status)}>
                      {getStatusLabel(presentation.status)}
                    </Badge>
                  </TableCell>
                  <TableCell>{presentation.createdByName || '-'}</TableCell>
                  <TableCell>
                    {presentation.presentedAt
                      ? new Date(presentation.presentedAt).toLocaleDateString()
                      : '-'}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Link to="/presentations/$id/view" params={{ id: presentation.id }}>
                        <Button variant="outline" size="icon">
                          <Eye className="h-4 w-4" />
                        </Button>
                      </Link>
                      {(isManager || isAdmin) && presentation.status !== 'presented' && (
                        <Link to="/presentations/$id/submit" params={{ id: presentation.id }}>
                          <Button variant="outline" size="icon">
                            <Upload className="h-4 w-4" />
                          </Button>
                        </Link>
                      )}
                      {isAdmin && presentation.status === 'draft' && (
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => setDeletingPresentation(presentation)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {presentations?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8">
                    <div className="text-muted-foreground">
                      No hay presentaciones creadas
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      
      <Dialog open={!!deletingPresentation} onOpenChange={() => setDeletingPresentation(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar Eliminación</DialogTitle>
            <DialogDescription>
              ¿Estás seguro de que deseas eliminar la presentación "{deletingPresentation?.name}"?
              Esta acción no se puede deshacer.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeletingPresentation(null)}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => deletingPresentation && deleteMutation.mutate(deletingPresentation.id)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? 'Eliminando...' : 'Eliminar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}