import { createFileRoute } from "@tanstack/react-router";
import { orpc } from "@/utils/orpc";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AppRouterClient } from "../../../../server/src/routers/index";

type User = Awaited<ReturnType<AppRouterClient['teams']['availableUsers']>>[0];
type Department = Awaited<ReturnType<AppRouterClient['departments']['list']>>[0];

import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, createSortableHeader, createActionsColumn } from "@/components/ui/data-table";
import { Edit, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
	SearchableSelect,
	SearchableSelectTrigger,
	SearchableSelectContent,
	SearchableSelectValue,
	SearchableSelectItem,
} from "@/components/ui/searchable-select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { useState, useMemo } from "react";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/error-handler";

export const Route = createFileRoute("/admin/departments")({
	component: DepartmentsPage,
});

function DepartmentsPage() {
	const queryClient = useQueryClient();
	const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
	const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
	const [editingDepartment, setEditingDepartment] = useState<Department | null>(null);

	// Queries
	const departments = useQuery(orpc.departments.list.queryOptions());
	const availableUsers = useQuery(orpc.teams.availableUsers.queryOptions());

	// Mutations
	const createMutation = useMutation(
		orpc.departments.create.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: orpc.departments.list.key(),
				});
				setIsCreateDialogOpen(false);
				toast.success("Departamento creado exitosamente");
			},
			onError: (error) => {
				toast.error(getErrorMessage(error, "Error al crear departamento"));
			},
		})
	);

	const updateMutation = useMutation(
		orpc.departments.update.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: orpc.departments.list.key(),
				});
				setIsEditDialogOpen(false);
				setEditingDepartment(null);
				toast.success("Departamento actualizado exitosamente");
			},
			onError: (error) => {
				toast.error(getErrorMessage(error, "Error al actualizar departamento"));
			},
		})
	);

	const deleteMutation = useMutation(
		orpc.departments.delete.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: orpc.departments.list.key(),
				});
				toast.success("Departamento eliminado exitosamente");
			},
			onError: (error) => {
				toast.error(getErrorMessage(error, "Error al eliminar departamento"));
			},
		})
	);

	const handleCreateSubmit = (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		const formData = new FormData(e.currentTarget);
		const data = {
			name: formData.get("name") as string,
			description: formData.get("description") as string,
			managerId: formData.get("managerId") as string || undefined,
		};
		createMutation.mutate(data);
	};

	const handleEditSubmit = (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		const formData = new FormData(e.currentTarget);
		const data = {
			name: formData.get("name") as string,
			description: formData.get("description") as string,
			managerId: formData.get("managerId") as string || undefined,
		};
		updateMutation.mutate({
			id: editingDepartment!.id,
			data,
		});
	};

	const handleEdit = (department: Department) => {
		setEditingDepartment(department);
		setIsEditDialogOpen(true);
	};

	const handleDelete = (department: Department) => {
		if (confirm("¿Estás seguro de que quieres eliminar este departamento?")) {
			deleteMutation.mutate({ id: department.id });
		}
	};

	// Definir columnas para TanStack Table
	const columns = useMemo<ColumnDef<Department>[]>(() => [
		{
			accessorKey: "name",
			header: createSortableHeader("Nombre"),
			cell: ({ row }) => (
				<div className="font-medium">{row.getValue("name")}</div>
			),
		},
		{
			accessorKey: "description",
			header: "Descripción",
			cell: ({ row }) => (
				<div className="max-w-xs truncate">{row.getValue("description") || "—"}</div>
			),
		},
		{
			accessorKey: "createdAt",
			header: createSortableHeader("Fecha de Creación"),
			cell: ({ row }) => {
				return new Date(row.getValue("createdAt")).toLocaleDateString("es-ES");
			},
		},
		createActionsColumn<Department>([
			{
				label: "Editar",
				icon: Edit,
				onClick: handleEdit,
			},
			{
				label: "Eliminar",
				icon: Trash2,
				onClick: handleDelete,
				variant: "destructive",
			},
		]),
	], []);

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<h1 className="text-2xl font-semibold">Departamentos</h1>
				<Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
					<DialogTrigger asChild>
						<Button>Crear Departamento</Button>
					</DialogTrigger>
					<DialogContent className="space-y-6">
						<DialogHeader>
							<DialogTitle>Crear Departamento</DialogTitle>
						</DialogHeader>
						<form onSubmit={handleCreateSubmit} className="space-y-6">
							<div className="space-y-2">
								<Label htmlFor="name">Nombre</Label>
								<Input id="name" name="name" required />
							</div>
							<div className="space-y-2">
								<Label htmlFor="description">Descripción</Label>
								<Textarea id="description" name="description" />
							</div>
							<div className="space-y-2">
								<Label htmlFor="managerId">Manager del Departamento</Label>
								<SearchableSelect name="managerId">
									<SearchableSelectTrigger>
										<SearchableSelectValue placeholder="Selecciona un manager (opcional)" />
									</SearchableSelectTrigger>
									<SearchableSelectContent searchPlaceholder="Buscar manager...">
										{availableUsers.isLoading ? (
											<div className="py-6 text-center text-sm text-muted-foreground">
												Cargando usuarios...
											</div>
										) : availableUsers.data?.filter((u: User) => u.role === "department_manager" || u.role === "super_admin").map((user: User) => (
											<SearchableSelectItem key={user.id} value={user.id} searchValue={`${user.name} ${user.email}`}>
												{user.name} ({user.email})
											</SearchableSelectItem>
										))}
									</SearchableSelectContent>
								</SearchableSelect>
							</div>
							<Button type="submit" disabled={createMutation.isPending}>
								{createMutation.isPending ? "Creando..." : "Crear"}
							</Button>
						</form>
					</DialogContent>
				</Dialog>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Todos los Departamentos</CardTitle>
				</CardHeader>
				<CardContent>
					<DataTable
						columns={columns}
						data={departments.data || []}
						isLoading={departments.isLoading}
						searchPlaceholder="Buscar departamentos..."
						emptyMessage="No hay departamentos registrados"
					/>
				</CardContent>
			</Card>

			{/* Edit Dialog */}
			<Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
				<DialogContent className="space-y-6">
					<DialogHeader>
						<DialogTitle>Editar Departamento</DialogTitle>
					</DialogHeader>
					<form onSubmit={handleEditSubmit} className="space-y-6">
						<div className="space-y-2">
							<Label htmlFor="edit-name">Nombre</Label>
							<Input
								id="edit-name"
								name="name"
								defaultValue={editingDepartment?.name}
								required
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="edit-description">Descripción</Label>
							<Textarea
								id="edit-description"
								name="description"
								defaultValue={editingDepartment?.description ?? ""}
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="edit-managerId">Manager del Departamento</Label>
							<SearchableSelect name="managerId" defaultValue={editingDepartment?.managerId ?? ""}>
								<SearchableSelectTrigger>
									<SearchableSelectValue placeholder="Selecciona un manager (opcional)" />
								</SearchableSelectTrigger>
								<SearchableSelectContent searchPlaceholder="Buscar manager...">
									{availableUsers.isLoading ? (
										<div className="py-6 text-center text-sm text-muted-foreground">
											Cargando usuarios...
										</div>
									) : availableUsers.data?.filter((u: User) => u.role === "department_manager" || u.role === "super_admin").map((user: User) => (
										<SearchableSelectItem key={user.id} value={user.id} searchValue={`${user.name} ${user.email}`}>
											{user.name} ({user.email})
										</SearchableSelectItem>
									))}
								</SearchableSelectContent>
							</SearchableSelect>
						</div>
						<Button type="submit" disabled={updateMutation.isPending}>
							{updateMutation.isPending ? "Actualizando..." : "Actualizar"}
						</Button>
					</form>
				</DialogContent>
			</Dialog>
		</div>
	);
}