import { createFileRoute } from "@tanstack/react-router";
import { orpc } from "@/utils/orpc";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { useState } from "react";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/error-handler";

export const Route = createFileRoute("/admin/departments")({
	component: DepartmentsPage,
});

function DepartmentsPage() {
	const queryClient = useQueryClient();
	const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
	const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
	const [editingDepartment, setEditingDepartment] = useState<any>(null);

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
			id: editingDepartment.id,
			data,
		});
	};

	const handleEdit = (department: any) => {
		setEditingDepartment(department);
		setIsEditDialogOpen(true);
	};

	const handleDelete = (department: any) => {
		if (confirm("¿Estás seguro de que quieres eliminar este departamento?")) {
			deleteMutation.mutate({ id: department.id });
		}
	};

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
								<Select name="managerId">
									<SelectTrigger>
										<SelectValue placeholder="Selecciona un manager (opcional)" />
									</SelectTrigger>
									<SelectContent>
										{availableUsers.isLoading ? (
											<SelectItem value="" disabled>
												Cargando usuarios...
											</SelectItem>
										) : availableUsers.data?.filter((u: any) => u.role === "manager" || u.role === "super_admin").map((user: any) => (
											<SelectItem key={user.id} value={user.id}>
												{user.name} ({user.email})
											</SelectItem>
										))}
									</SelectContent>
								</Select>
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
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Nombre</TableHead>
								<TableHead>Descripción</TableHead>
								<TableHead>Creado el</TableHead>
								<TableHead>Acciones</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{departments.isLoading ? (
								<TableRow>
									<TableCell colSpan={4} className="text-center py-4">
										Cargando departamentos...
									</TableCell>
								</TableRow>
							) : departments.data?.map((department: any) => (
								<TableRow key={department.id}>
									<TableCell className="font-medium">
										{department.name}
									</TableCell>
									<TableCell>{department.description || "—"}</TableCell>
									<TableCell>
										{new Date(department.createdAt).toLocaleDateString()}
									</TableCell>
									<TableCell>
										<div className="flex space-x-2">
											<Button
												variant="outline"
												size="sm"
												onClick={() => handleEdit(department)}
											>
												Editar
											</Button>
											<Button
												variant="outline"
												size="sm"
												onClick={() => handleDelete(department)}
												disabled={deleteMutation.isPending}
											>
												Eliminar
											</Button>
										</div>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
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
								defaultValue={editingDepartment?.description}
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="edit-managerId">Manager del Departamento</Label>
							<Select name="managerId" defaultValue={editingDepartment?.managerId || ""}>
								<SelectTrigger>
									<SelectValue placeholder="Selecciona un manager (opcional)" />
								</SelectTrigger>
								<SelectContent>
									{availableUsers.isLoading ? (
										<SelectItem value="" disabled>
											Cargando usuarios...
										</SelectItem>
									) : availableUsers.data?.filter((u: any) => u.role === "manager" || u.role === "super_admin").map((user: any) => (
										<SelectItem key={user.id} value={user.id}>
											{user.name} ({user.email})
										</SelectItem>
									))}
								</SelectContent>
							</Select>
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