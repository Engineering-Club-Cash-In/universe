import { createFileRoute } from "@tanstack/react-router";
import { orpc } from "@/utils/orpc";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import type { AppRouterClient } from "../../../../server/src/routers/index";

type User = Awaited<ReturnType<AppRouterClient['teams']['availableUsers']>>[0];
type Area = Awaited<ReturnType<AppRouterClient['areas']['list']>>[0];
type Department = Awaited<ReturnType<AppRouterClient['departments']['list']>>[0];
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

export const Route = createFileRoute("/admin/areas")({
	component: AreasPage,
});

function AreasPage() {
	const queryClient = useQueryClient();
	const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
	const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
	const [editingArea, setEditingArea] = useState<Area | null>(null);

	// Queries
	const areas = useQuery(orpc.areas.list.queryOptions());
	const departments = useQuery(orpc.departments.list.queryOptions());
	const availableUsers = useQuery(orpc.teams.availableUsers.queryOptions());

	// Mutations
	const createMutation = useMutation(
		orpc.areas.create.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: orpc.areas.list.key(),
				});
				setIsCreateDialogOpen(false);
				toast.success("Área creada exitosamente");
			},
			onError: (error) => {
				toast.error(getErrorMessage(error, "Error al crear área"));
			},
		})
	);

	const updateMutation = useMutation(
		orpc.areas.update.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: orpc.areas.list.key(),
				});
				setIsEditDialogOpen(false);
				setEditingArea(null);
				toast.success("Área actualizada exitosamente");
			},
			onError: (error) => {
				toast.error(getErrorMessage(error, "Error al actualizar área"));
			},
		})
	);

	const deleteMutation = useMutation(
		orpc.areas.delete.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: orpc.areas.list.key(),
				});
				toast.success("Área eliminada exitosamente");
			},
			onError: (error) => {
				toast.error(getErrorMessage(error, "Error al eliminar área"));
			},
		})
	);

	const handleCreateSubmit = (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		const formData = new FormData(e.currentTarget);
		const data = {
			name: formData.get("name") as string,
			description: formData.get("description") as string,
			departmentId: formData.get("departmentId") as string,
		};
		createMutation.mutate(data);
	};

	const handleEditSubmit = (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		const formData = new FormData(e.currentTarget);
		const data = {
			name: formData.get("name") as string,
			description: formData.get("description") as string,
		};
		updateMutation.mutate({
			id: editingArea!.id,
			data,
		});
	};

	const handleEdit = (area: Area) => {
		setEditingArea(area);
		setIsEditDialogOpen(true);
	};

	const handleDelete = (area: Area) => {
		if (confirm("¿Estás seguro de que quieres eliminar esta área?")) {
			deleteMutation.mutate({ id: area.id });
		}
	};

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<h1 className="text-2xl font-semibold">Áreas</h1>
				<Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
					<DialogTrigger asChild>
						<Button>Crear Área</Button>
					</DialogTrigger>
					<DialogContent className="space-y-6">
						<DialogHeader>
							<DialogTitle>Crear Área</DialogTitle>
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
								<Label htmlFor="departmentId">Departamento</Label>
								<Select name="departmentId" required>
									<SelectTrigger>
										<SelectValue placeholder="Selecciona un departamento" />
									</SelectTrigger>
									<SelectContent>
										{departments.isLoading ? (
											<SelectItem value="" disabled>
												Cargando departamentos...
											</SelectItem>
										) : departments.data?.map((department: Department) => (
											<SelectItem key={department.id} value={department.id}>
												{department.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
							<div className="space-y-2">
								<Label htmlFor="leadId">Líder de Área</Label>
								<Select name="leadId">
									<SelectTrigger>
										<SelectValue placeholder="Selecciona un líder (opcional)" />
									</SelectTrigger>
									<SelectContent>
										{availableUsers.isLoading ? (
											<SelectItem value="" disabled>
												Cargando usuarios...
											</SelectItem>
										) : availableUsers.data?.filter((u: User) => ["area_lead", "department_manager", "super_admin"].includes(u.role)).map((user: User) => (
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
					<CardTitle>Todas las Áreas</CardTitle>
				</CardHeader>
				<CardContent>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Nombre</TableHead>
								<TableHead>Descripción</TableHead>
								<TableHead>Departamento</TableHead>
								<TableHead>Creado el</TableHead>
								<TableHead>Acciones</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{areas.isLoading ? (
								<TableRow>
									<TableCell colSpan={5} className="text-center py-4">
										Cargando áreas...
									</TableCell>
								</TableRow>
							) : areas.data?.map((area: Area) => (
								<TableRow key={area.id}>
									<TableCell className="font-medium">{area.name}</TableCell>
									<TableCell>{area.description || "—"}</TableCell>
									<TableCell>{area.departmentName || "—"}</TableCell>
									<TableCell>
										{new Date(area.createdAt).toLocaleDateString()}
									</TableCell>
									<TableCell>
										<div className="flex space-x-2">
											<Button
												variant="outline"
												size="sm"
												onClick={() => handleEdit(area)}
											>
												Editar
											</Button>
											<Button
												variant="outline"
												size="sm"
												onClick={() => handleDelete(area)}
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
						<DialogTitle>Editar Área</DialogTitle>
					</DialogHeader>
					<form onSubmit={handleEditSubmit} className="space-y-6">
						<div className="space-y-2">
							<Label htmlFor="edit-name">Nombre</Label>
							<Input
								id="edit-name"
								name="name"
								defaultValue={editingArea?.name}
								required
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="edit-description">Descripción</Label>
							<Textarea
								id="edit-description"
								name="description"
								defaultValue={editingArea?.description ?? ""}
							/>
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