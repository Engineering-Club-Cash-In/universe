import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Textarea } from '../../components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '../../components/ui/dialog'
import { Label } from '../../components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'
import { Badge } from '../../components/ui/badge'
import { Plus, Pencil, Trash2, Target } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod'
import { getGoalTemplates, createGoalTemplate, updateGoalTemplate, deleteGoalTemplate } from '../../server/functions/goals'
import { useRole } from '../../lib/auth/hooks'

// Schemas de validación
const createGoalTemplateSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  defaultTarget: z.number().positive().optional(),
  unit: z.string().max(50).optional(),
  successThreshold: z.number().min(0).max(100).default(80),
  warningThreshold: z.number().min(0).max(100).default(50),
})

const updateGoalTemplateSchema = createGoalTemplateSchema.partial()

export const Route = createFileRoute('/admin/goal-templates')({
  component: GoalTemplatesPage,
})

interface GoalTemplate {
  id: string
  name: string
  description: string | null
  defaultTarget: string | null
  unit: string | null
  successThreshold: string | null
  warningThreshold: string | null
  createdAt: Date
  updatedAt: Date
}

function GoalTemplatesPage() {
  const { isAdmin } = useRole()
  const queryClient = useQueryClient()
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<GoalTemplate | null>(null)
  const [deletingTemplate, setDeletingTemplate] = useState<GoalTemplate | null>(null)

  const { data: templates } = useSuspenseQuery({
    queryKey: ['goal-templates'],
    queryFn: () => getGoalTemplates(),
  })

  const createMutation = useMutation({
    mutationFn: async (formData: z.infer<typeof createGoalTemplateSchema>) => 
      await createGoalTemplate({ data: formData }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['goal-templates'] })
      toast.success('Template de meta creado exitosamente')
      setIsCreateOpen(false)
    },
    onError: () => {
      toast.error('Error al crear el template de meta')
    },
  })

  const updateMutation = useMutation({
    mutationFn: async ({ id, formData }: { id: string; formData: z.infer<typeof updateGoalTemplateSchema> }) => 
      await updateGoalTemplate({ data: { id, data: formData } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['goal-templates'] })
      toast.success('Template actualizado exitosamente')
      setEditingTemplate(null)
    },
    onError: () => {
      toast.error('Error al actualizar el template')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => await deleteGoalTemplate({ data: id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['goal-templates'] })
      toast.success('Template eliminado exitosamente')
      setDeletingTemplate(null)
    },
    onError: () => {
      toast.error('Error al eliminar el template')
    },
  })

  const handleCreate = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    
    createMutation.mutate({
      name: formData.get('name') as string,
      description: formData.get('description') as string,
      defaultTarget: formData.get('defaultTarget') ? Number(formData.get('defaultTarget')) : undefined,
      unit: formData.get('unit') as string,
      successThreshold: Number(formData.get('successThreshold')) || 80,
      warningThreshold: Number(formData.get('warningThreshold')) || 50,
    })
  }

  const handleUpdate = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    
    updateMutation.mutate({
      id: editingTemplate!.id,
      formData: {
        name: formData.get('name') as string,
        description: formData.get('description') as string,
        defaultTarget: formData.get('defaultTarget') ? Number(formData.get('defaultTarget')) : undefined,
        unit: formData.get('unit') as string,
        successThreshold: Number(formData.get('successThreshold')) || 80,
        warningThreshold: Number(formData.get('warningThreshold')) || 50,
      },
    })
  }

  if (!isAdmin) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground">
              No tienes permisos para acceder a esta página
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Templates de Metas</h1>
          <p className="text-muted-foreground">
            Configura los tipos de metas que se pueden asignar a los empleados
          </p>
        </div>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Nuevo Template
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>Crear Template de Meta</DialogTitle>
              <DialogDescription>
                Define un nuevo tipo de meta para asignar a los empleados
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleCreate}>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="name">Nombre</Label>
                  <Input
                    id="name"
                    name="name"
                    placeholder="Ej: Ventas Mensuales"
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="description">Descripción</Label>
                  <Textarea
                    id="description"
                    name="description"
                    placeholder="Descripción del template..."
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="defaultTarget">Meta por defecto</Label>
                    <Input
                      id="defaultTarget"
                      name="defaultTarget"
                      type="number"
                      step="0.01"
                      placeholder="100"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="unit">Unidad</Label>
                    <Input
                      id="unit"
                      name="unit"
                      placeholder="Ej: ventas, tickets"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="successThreshold">
                      Umbral de éxito (%)
                    </Label>
                    <Input
                      id="successThreshold"
                      name="successThreshold"
                      type="number"
                      min="0"
                      max="100"
                      defaultValue="80"
                      required
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="warningThreshold">
                      Umbral de advertencia (%)
                    </Label>
                    <Input
                      id="warningThreshold"
                      name="warningThreshold"
                      type="number"
                      min="0"
                      max="100"
                      defaultValue="50"
                      required
                    />
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={createMutation.isPending}>
                  {createMutation.isPending ? 'Creando...' : 'Crear Template'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Templates Configurados</CardTitle>
          <CardDescription>
            Lista de todos los templates de metas disponibles
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Descripción</TableHead>
                <TableHead>Meta por defecto</TableHead>
                <TableHead>Unidad</TableHead>
                <TableHead>Umbrales</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates?.map((template: GoalTemplate) => (
                <TableRow key={template.id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <Target className="h-4 w-4 text-muted-foreground" />
                      {template.name}
                    </div>
                  </TableCell>
                  <TableCell className="max-w-xs truncate">
                    {template.description || '-'}
                  </TableCell>
                  <TableCell>
                    {template.defaultTarget || '-'}
                  </TableCell>
                  <TableCell>
                    {template.unit ? (
                      <Badge variant="secondary">{template.unit}</Badge>
                    ) : (
                      '-'
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Badge variant="default" className="bg-green-500">
                        ≥{template.successThreshold}%
                      </Badge>
                      <Badge variant="default" className="bg-yellow-500">
                        ≥{template.warningThreshold}%
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => setEditingTemplate(template)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => setDeletingTemplate(template)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {templates?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8">
                    <div className="text-muted-foreground">
                      No hay templates configurados
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Dialog para editar */}
      <Dialog open={!!editingTemplate} onOpenChange={() => setEditingTemplate(null)}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Editar Template de Meta</DialogTitle>
            <DialogDescription>
              Modifica la configuración del template
            </DialogDescription>
          </DialogHeader>
          {editingTemplate && (
            <form onSubmit={handleUpdate}>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="edit-name">Nombre</Label>
                  <Input
                    id="edit-name"
                    name="name"
                    defaultValue={editingTemplate.name || ''}
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="edit-description">Descripción</Label>
                  <Textarea
                    id="edit-description"
                    name="description"
                    defaultValue={editingTemplate.description || ''}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="edit-defaultTarget">Meta por defecto</Label>
                    <Input
                      id="edit-defaultTarget"
                      name="defaultTarget"
                      type="number"
                      step="0.01"
                      defaultValue={editingTemplate.defaultTarget || ''}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="edit-unit">Unidad</Label>
                    <Input
                      id="edit-unit"
                      name="unit"
                      defaultValue={editingTemplate.unit || ''}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="edit-successThreshold">
                      Umbral de éxito (%)
                    </Label>
                    <Input
                      id="edit-successThreshold"
                      name="successThreshold"
                      type="number"
                      min="0"
                      max="100"
                      defaultValue={editingTemplate.successThreshold || ''}
                      required
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="edit-warningThreshold">
                      Umbral de advertencia (%)
                    </Label>
                    <Input
                      id="edit-warningThreshold"
                      name="warningThreshold"
                      type="number"
                      min="0"
                      max="100"
                      defaultValue={editingTemplate.warningThreshold || ''}
                      required
                    />
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={updateMutation.isPending}>
                  {updateMutation.isPending ? 'Guardando...' : 'Guardar Cambios'}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Dialog para confirmar eliminación */}
      <Dialog open={!!deletingTemplate} onOpenChange={() => setDeletingTemplate(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar Eliminación</DialogTitle>
            <DialogDescription>
              ¿Estás seguro de que deseas eliminar el template "{deletingTemplate?.name}"?
              Esta acción no se puede deshacer.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeletingTemplate(null)}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => deletingTemplate && deleteMutation.mutate(deletingTemplate.id)}
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