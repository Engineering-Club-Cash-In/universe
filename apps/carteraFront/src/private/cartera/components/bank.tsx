import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Pencil, Trash2, Plus, Loader2, Building2 } from 'lucide-react'; 
import type { Banco } from '../services/services';
import { useBancos } from '../hooks/bancos';

export function BancosManager() {
  const { bancos, loading, createBanco, updateBanco, deleteBanco } = useBancos();
  
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [selectedBanco, setSelectedBanco] = useState<Banco | null>(null);
  const [nombre, setNombre] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Crear banco
  const handleCreate = async () => {
    if (!nombre.trim()) return;
    
    setIsSubmitting(true);
    const result = await createBanco({ nombre: nombre.trim() });
    setIsSubmitting(false);
    
    if (result) {
      setNombre('');
      setIsCreateOpen(false);
    }
  };

  // Abrir modal de edición
  const handleOpenEdit = (banco: Banco) => {
    setSelectedBanco(banco);
    setNombre(banco.nombre);
    setIsEditOpen(true);
  };

  // Actualizar banco
  const handleUpdate = async () => {
    if (!selectedBanco || !nombre.trim()) return;
    
    setIsSubmitting(true);
    const result = await updateBanco(selectedBanco.banco_id, { nombre: nombre.trim() });
    setIsSubmitting(false);
    
    if (result) {
      setNombre('');
      setSelectedBanco(null);
      setIsEditOpen(false);
    }
  };

  // Eliminar banco
  const handleDelete = async (id: number) => {
    await deleteBanco(id);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-start bg-gradient-to-br from-blue-50 to-white px-2 overflow-auto pt-8 pb-8">
      <Card className="w-full max-w-6xl">
        <CardHeader className="bg-gradient-to-r from-blue-500 to-blue-600">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <CardTitle className="text-xl sm:text-2xl font-bold text-white">
              Gestión de Bancos
            </CardTitle>
            
            {/* Botón Crear Banco */}
            <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
              <DialogTrigger asChild>
                <Button className="gap-2 w-full sm:w-auto bg-white text-blue-600 hover:bg-blue-50">
                  <Plus className="w-4 h-4" />
                  Nuevo Banco
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                  <DialogTitle className="text-gray-900">Crear Nuevo Banco</DialogTitle>
                  <DialogDescription className="text-gray-600">
                    Ingresa el nombre del banco que deseas agregar.
                  </DialogDescription>
                </DialogHeader>
                
                <div className="grid gap-4 py-4">
                  <div className="grid gap-2">
                    <Label htmlFor="nombre-create" className="text-gray-900">Nombre del Banco</Label>
                    <Input
                      id="nombre-create"
                      placeholder="Ej: Banco Industrial"
                      value={nombre}
                      onChange={(e) => setNombre(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleCreate();
                      }}
                      className="text-gray-900"
                    />
                  </div>
                </div>
                
                <DialogFooter className="flex-col sm:flex-row gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setIsCreateOpen(false);
                      setNombre('');
                    }}
                    disabled={isSubmitting}
                    className="w-full sm:w-auto"
                  >
                    Cancelar
                  </Button>
                  <Button
                    onClick={handleCreate}
                    disabled={!nombre.trim() || isSubmitting}
                    className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Creando...
                      </>
                    ) : (
                      'Crear Banco'
                    )}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>

        <CardContent className="mt-6">
          {bancos.length === 0 ? (
            <div className="text-center py-12 text-gray-600">
              No hay bancos registrados. Crea uno nuevo para comenzar.
            </div>
          ) : (
            <>
              {/* Vista Desktop - Tabla */}
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-blue-50">
                      <TableHead className="w-[100px] text-blue-900 font-semibold">ID</TableHead>
                      <TableHead className="text-blue-900 font-semibold">Nombre</TableHead>
                      <TableHead className="text-right text-blue-900 font-semibold">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bancos.map((banco) => (
                      <TableRow key={banco.banco_id} className="hover:bg-blue-50/50">
                        <TableCell className="font-medium text-gray-900">{banco.banco_id}</TableCell>
                        <TableCell className="text-gray-900">{banco.nombre}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            {/* Botón Editar */}
                            <Button
                              variant="outline"
                              size="icon"
                              onClick={() => handleOpenEdit(banco)}
                              className="border-blue-300 text-blue-600 hover:bg-blue-50"
                            >
                              <Pencil className="w-4 h-4" />
                            </Button>

                            {/* Botón Eliminar */}
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="destructive" size="icon">
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle className="text-gray-900">¿Estás seguro?</AlertDialogTitle>
                                  <AlertDialogDescription className="text-gray-600">
                                    Esta acción no se puede deshacer. Se eliminará permanentemente
                                    el banco <strong className="text-gray-900">{banco.nombre}</strong>.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => handleDelete(banco.banco_id)}
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  >
                                    Eliminar
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Vista Mobile - Cards */}
              <div className="md:hidden space-y-3">
                {bancos.map((banco) => (
                  <Card key={banco.banco_id} className="border-2 border-blue-200 bg-white">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-start gap-3 flex-1 min-w-0">
                          <div className="mt-1 flex-shrink-0">
                            <Building2 className="w-5 h-5 text-blue-600" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-blue-600 font-medium">
                              ID: {banco.banco_id}
                            </p>
                            <h3 className="font-semibold text-lg mt-1 break-words text-gray-900">
                              {banco.nombre}
                            </h3>
                          </div>
                        </div>

                        <div className="flex gap-2 flex-shrink-0">
                          {/* Botón Editar Mobile */}
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() => handleOpenEdit(banco)}
                            className="border-blue-300 text-blue-600 hover:bg-blue-50"
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>

                          {/* Botón Eliminar Mobile */}
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="destructive" size="icon">
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent className="max-w-[90vw] sm:max-w-lg">
                              <AlertDialogHeader>
                                <AlertDialogTitle className="text-gray-900">¿Estás seguro?</AlertDialogTitle>
                                <AlertDialogDescription className="text-gray-600">
                                  Esta acción no se puede deshacer. Se eliminará permanentemente
                                  el banco <strong className="text-gray-900">{banco.nombre}</strong>.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter className="flex-col sm:flex-row gap-2">
                                <AlertDialogCancel className="w-full sm:w-auto">
                                  Cancelar
                                </AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => handleDelete(banco.banco_id)}
                                  className="w-full sm:w-auto bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                  Eliminar
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Dialog de Edición */}
      {/* Dialog de Edición */}
<Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
  <DialogContent className="sm:max-w-[425px] bg-white">
    <DialogHeader>
      <DialogTitle className="text-gray-900">Editar Banco</DialogTitle>
      <DialogDescription className="text-gray-600">
        Modifica el nombre del banco.
      </DialogDescription>
    </DialogHeader>
    
    <div className="grid gap-4 py-4">
      <div className="grid gap-2">
        <Label htmlFor="nombre-edit" className="text-gray-900">Nombre del Banco</Label>
        <Input
          id="nombre-edit"
          placeholder="Ej: Banco Industrial"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleUpdate();
          }}
          className="text-gray-900 bg-white"
        />
      </div>
    </div>
    
    <DialogFooter className="flex-col sm:flex-row gap-2">
      <Button
        variant="outline"
        onClick={() => {
          setIsEditOpen(false);
          setNombre('');
          setSelectedBanco(null);
        }}
        disabled={isSubmitting}
        className="w-full sm:w-auto"
      >
        Cancelar
      </Button>
      <Button
        onClick={handleUpdate}
        disabled={!nombre.trim() || isSubmitting}
        className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700"
      >
        {isSubmitting ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Actualizando...
          </>
        ) : (
          'Guardar Cambios'
        )}
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
    </div>
  );
}