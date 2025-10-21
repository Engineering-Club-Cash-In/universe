import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  Search,
  Plus,
  Edit,
  Trash2,
  Building2,
  User,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { orpc, client } from "@/utils/orpc";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

export const Route = createFileRoute("/crm/vendors")({
  component: VendorsPage,
});

const vendorSchema = z.object({
  name: z.string().min(1, "El nombre es requerido"),
  phone: z.string().min(8, "El teléfono es requerido"),
  dpi: z.string().min(13, "DPI debe tener 13 dígitos").max(13, "DPI debe tener 13 dígitos"),
  vendorType: z.enum(["individual", "empresa"], { message: "Tipo de vendedor requerido" }),
  companyName: z.string().optional(),
  email: z.string().email("Email inválido").optional().or(z.literal("")),
  address: z.string().optional(),
});

type VendorFormData = z.infer<typeof vendorSchema>;

function VendorsPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [vendorTypeFilter, setVendorTypeFilter] = useState("all");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [selectedVendor, setSelectedVendor] = useState<any>(null);
  const [vendorToDelete, setVendorToDelete] = useState<string | null>(null);

  const queryClient = useQueryClient();

  // Queries
  const vendorsQuery = useQuery({
    ...orpc.getVendors.queryOptions(),
  });

  // Mutations
  const createVendorMutation = useMutation({
    mutationFn: async (data: VendorFormData) => {
      return await client.createVendor({
        ...data,
        email: data.email || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["getVendors"] });
      toast.success("Vendedor creado exitosamente");
      setIsCreateOpen(false);
    },
    onError: (error) => {
      toast.error(error.message || "Error al crear vendedor");
    },
  });

  const updateVendorMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: VendorFormData }) => {
      return await client.updateVendor({
        id,
        data: {
          ...data,
          email: data.email || undefined,
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["getVendors"] });
      toast.success("Vendedor actualizado exitosamente");
      setIsEditOpen(false);
      setSelectedVendor(null);
    },
    onError: (error) => {
      toast.error(error.message || "Error al actualizar vendedor");
    },
  });

  const deleteVendorMutation = useMutation({
    mutationFn: async (id: string) => {
      return await client.deleteVendor({ id });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["getVendors"] });
      toast.success("Vendedor eliminado exitosamente");
    },
    onError: (error) => {
      toast.error(error.message || "Error al eliminar vendedor");
    },
  });

  // Forms
  const createForm = useForm<VendorFormData>({
    resolver: zodResolver(vendorSchema),
    defaultValues: {
      name: "",
      phone: "",
      dpi: "",
      vendorType: "individual",
      companyName: "",
      email: "",
      address: "",
    },
  });

  const editForm = useForm<VendorFormData>({
    resolver: zodResolver(vendorSchema),
  });

  // Filter vendors
  const filteredVendors = vendorsQuery.data?.filter((vendor: any) => {
    const matchesSearch = 
      vendor.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      vendor.dpi.includes(searchTerm) ||
      vendor.phone.includes(searchTerm) ||
      (vendor.companyName && vendor.companyName.toLowerCase().includes(searchTerm.toLowerCase()));
    
    const matchesType = vendorTypeFilter === "all" || vendor.vendorType === vendorTypeFilter;
    
    return matchesSearch && matchesType;
  });

  const handleEdit = (vendor: any) => {
    setSelectedVendor(vendor);
    editForm.reset({
      name: vendor.name,
      phone: vendor.phone,
      dpi: vendor.dpi,
      vendorType: vendor.vendorType,
      companyName: vendor.companyName || "",
      email: vendor.email || "",
      address: vendor.address || "",
    });
    setIsEditOpen(true);
  };

  const handleDelete = (id: string) => {
    setVendorToDelete(id);
  };

  const onCreateSubmit = (data: VendorFormData) => {
    createVendorMutation.mutate(data);
  };

  const onEditSubmit = (data: VendorFormData) => {
    if (selectedVendor) {
      updateVendorMutation.mutate({ id: selectedVendor.id, data });
    }
  };

  return (
    <div className="flex flex-col p-6 gap-4">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Vendedores de Vehículos</h1>
          <p className="text-muted-foreground mt-2">
            Gestiona la información de los vendedores de vehículos
          </p>
        </div>
        
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Nuevo Vendedor
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Crear Nuevo Vendedor</DialogTitle>
              <DialogDescription>
                Registra un nuevo vendedor de vehículos en el sistema
              </DialogDescription>
            </DialogHeader>
            <Form {...createForm}>
              <form onSubmit={createForm.handleSubmit(onCreateSubmit)} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={createForm.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Nombre completo</FormLabel>
                        <FormControl>
                          <Input placeholder="Nombre y apellidos" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={createForm.control}
                    name="phone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Teléfono</FormLabel>
                        <FormControl>
                          <Input placeholder="5555-5555" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={createForm.control}
                    name="dpi"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>DPI</FormLabel>
                        <FormControl>
                          <Input placeholder="1234567890101" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={createForm.control}
                    name="vendorType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Tipo</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Selecciona tipo" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="individual">Persona Individual</SelectItem>
                            <SelectItem value="empresa">Empresa</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {createForm.watch("vendorType") === "empresa" && (
                  <FormField
                    control={createForm.control}
                    name="companyName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Nombre de la empresa</FormLabel>
                        <FormControl>
                          <Input placeholder="Razón social" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={createForm.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email (opcional)</FormLabel>
                        <FormControl>
                          <Input placeholder="email@ejemplo.com" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={createForm.control}
                    name="address"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Dirección (opcional)</FormLabel>
                        <FormControl>
                          <Input placeholder="Dirección completa" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <DialogFooter>
                  <Button type="submit" disabled={createVendorMutation.isPending}>
                    {createVendorMutation.isPending ? "Creando..." : "Crear Vendedor"}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por nombre, DPI, teléfono o empresa..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8"
              />
            </div>
            <Select value={vendorTypeFilter} onValueChange={setVendorTypeFilter}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Filtrar por tipo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="individual">Persona Individual</SelectItem>
                <SelectItem value="empresa">Empresa</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Vendors Table */}
      <Card>
        <CardHeader>
          <CardTitle>Lista de Vendedores</CardTitle>
          <CardDescription>
            {filteredVendors?.length || 0} vendedores registrados
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vendedor</TableHead>
                  <TableHead>DPI</TableHead>
                  <TableHead>Contacto</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredVendors?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center">
                      No se encontraron vendedores.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredVendors?.map((vendor: any) => (
                    <TableRow key={vendor.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {vendor.vendorType === "empresa" ? (
                            <Building2 className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <User className="h-4 w-4 text-muted-foreground" />
                          )}
                          <div>
                            <div className="font-medium">{vendor.name}</div>
                            {vendor.companyName && (
                              <div className="text-sm text-muted-foreground">
                                {vendor.companyName}
                              </div>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {vendor.dpi}
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">
                          <div>{vendor.phone}</div>
                          {vendor.email && (
                            <div className="text-muted-foreground">{vendor.email}</div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge 
                          variant={vendor.vendorType === "empresa" ? "default" : "secondary"}
                          className="capitalize"
                        >
                          {vendor.vendorType === "empresa" ? "Empresa" : "Individual"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleEdit(vendor)}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleDelete(vendor.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Vendedor</DialogTitle>
            <DialogDescription>
              Actualiza la información del vendedor
            </DialogDescription>
          </DialogHeader>
          {selectedVendor && (
            <Form {...editForm}>
              <form onSubmit={editForm.handleSubmit(onEditSubmit)} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={editForm.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Nombre completo</FormLabel>
                        <FormControl>
                          <Input placeholder="Nombre y apellidos" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={editForm.control}
                    name="phone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Teléfono</FormLabel>
                        <FormControl>
                          <Input placeholder="5555-5555" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={editForm.control}
                    name="dpi"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>DPI</FormLabel>
                        <FormControl>
                          <Input placeholder="1234567890101" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={editForm.control}
                    name="vendorType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Tipo</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Selecciona tipo" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="individual">Persona Individual</SelectItem>
                            <SelectItem value="empresa">Empresa</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {editForm.watch("vendorType") === "empresa" && (
                  <FormField
                    control={editForm.control}
                    name="companyName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Nombre de la empresa</FormLabel>
                        <FormControl>
                          <Input placeholder="Razón social" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={editForm.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email (opcional)</FormLabel>
                        <FormControl>
                          <Input placeholder="email@ejemplo.com" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={editForm.control}
                    name="address"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Dirección (opcional)</FormLabel>
                        <FormControl>
                          <Input placeholder="Dirección completa" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <DialogFooter>
                  <Button type="submit" disabled={updateVendorMutation.isPending}>
                    {updateVendorMutation.isPending ? "Guardando..." : "Guardar Cambios"}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          )}
        </DialogContent>
      </Dialog>

      {/* Alert Dialog para confirmar eliminación */}
      <AlertDialog open={!!vendorToDelete} onOpenChange={(open) => !open && setVendorToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar vendedor?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. El vendedor será eliminado permanentemente del sistema.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (vendorToDelete) {
                  deleteVendorMutation.mutate(vendorToDelete);
                  setVendorToDelete(null);
                }
              }}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}