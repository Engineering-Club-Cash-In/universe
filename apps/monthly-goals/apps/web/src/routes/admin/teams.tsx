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

export const Route = createFileRoute("/admin/teams")({
	component: TeamsPage,
});

function TeamsPage() {
	const queryClient = useQueryClient();
	const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
	const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
	const [editingTeamMember, setEditingTeamMember] = useState<any>(null);

	// Queries
	const teamMembers = useQuery(orpc.teams.list.queryOptions());
	const areas = useQuery(orpc.areas.list.queryOptions());
	const availableUsers = useQuery(orpc.teams.availableUsers.queryOptions());

	// Mutations
	const createMutation = useMutation(
		orpc.teams.create.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: orpc.teams.list.key(),
				});
				setIsCreateDialogOpen(false);
				toast.success("Miembro del equipo creado exitosamente");
			},
			onError: (error) => {
				toast.error(getErrorMessage(error, "Error al crear miembro del equipo"));
			},
		})
	);

	const updateMutation = useMutation(
		orpc.teams.update.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: orpc.teams.list.key(),
				});
				setIsEditDialogOpen(false);
				setEditingTeamMember(null);
				toast.success("Miembro del equipo actualizado exitosamente");
			},
			onError: (error) => {
				toast.error(getErrorMessage(error, "Error al actualizar miembro del equipo"));
			},
		})
	);

	const deleteMutation = useMutation(
		orpc.teams.delete.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: orpc.teams.list.key(),
				});
				toast.success("Miembro del equipo eliminado exitosamente");
			},
			onError: (error) => {
				toast.error(getErrorMessage(error, "Error al eliminar miembro del equipo"));
			},
		})
	);

	const handleCreateSubmit = (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		const formData = new FormData(e.currentTarget);
		const data = {
			userId: formData.get("userId") as string,
			areaId: formData.get("areaId") as string,
			position: formData.get("position") as string,
		};
		createMutation.mutate(data);
	};

	const handleEditSubmit = (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		const formData = new FormData(e.currentTarget);
		const data = {
			position: formData.get("position") as string,
		};
		updateMutation.mutate({
			id: editingTeamMember.id,
			data,
		});
	};

	const handleEdit = (teamMember: any) => {
		setEditingTeamMember(teamMember);
		setIsEditDialogOpen(true);
	};

	const handleDelete = (teamMember: any) => {
		if (confirm("¿Estás seguro de que quieres eliminar este miembro del equipo?")) {
			deleteMutation.mutate({ id: teamMember.id });
		}
	};

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<h1 className="text-2xl font-semibold">Miembros del Equipo</h1>
				<Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
					<DialogTrigger asChild>
						<Button>Agregar Miembro</Button>
					</DialogTrigger>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>Agregar Miembro al Equipo</DialogTitle>
						</DialogHeader>
						<form onSubmit={handleCreateSubmit} className="space-y-4">
							<div>
								<Label htmlFor="userId">Usuario</Label>
								<Select name="userId" required>
									<SelectTrigger>
										<SelectValue placeholder="Selecciona un usuario" />
									</SelectTrigger>
									<SelectContent>
										{availableUsers.isLoading ? (
											<SelectItem value="" disabled>
												Cargando usuarios...
											</SelectItem>
										) : availableUsers.data?.map((user: any) => (
											<SelectItem key={user.id} value={user.id}>
												{user.name} ({user.email})
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
							<div>
								<Label htmlFor="areaId">Área</Label>
								<Select name="areaId" required>
									<SelectTrigger>
										<SelectValue placeholder="Selecciona un área" />
									</SelectTrigger>
									<SelectContent>
										{areas.isLoading ? (
											<SelectItem value="" disabled>
												Cargando áreas...
											</SelectItem>
										) : areas.data?.map((area: any) => (
											<SelectItem key={area.id} value={area.id}>
												{area.name} - {area.departmentName}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
							<div>
								<Label htmlFor="position">Posición</Label>
								<Input id="position" name="position" />
							</div>
							<Button type="submit" disabled={createMutation.isPending}>
								{createMutation.isPending ? "Agregando..." : "Agregar"}
							</Button>
						</form>
					</DialogContent>
				</Dialog>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Todos los Miembros del Equipo</CardTitle>
				</CardHeader>
				<CardContent>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Usuario</TableHead>
								<TableHead>Email</TableHead>
								<TableHead>Área</TableHead>
								<TableHead>Departamento</TableHead>
								<TableHead>Posición</TableHead>
								<TableHead>Fecha de Ingreso</TableHead>
								<TableHead>Acciones</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{teamMembers.isLoading ? (
								<TableRow>
									<TableCell colSpan={7} className="text-center py-4">
										Cargando miembros del equipo...
									</TableCell>
								</TableRow>
							) : teamMembers.data?.map((member: any) => (
								<TableRow key={member.id}>
									<TableCell className="font-medium">{member.userName}</TableCell>
									<TableCell>{member.userEmail}</TableCell>
									<TableCell>{member.areaName}</TableCell>
									<TableCell>{member.departmentName}</TableCell>
									<TableCell>{member.position || "—"}</TableCell>
									<TableCell>
										{new Date(member.joinedAt).toLocaleDateString()}
									</TableCell>
									<TableCell>
										<div className="flex space-x-2">
											<Button
												variant="outline"
												size="sm"
												onClick={() => handleEdit(member)}
											>
												Editar
											</Button>
											<Button
												variant="outline"
												size="sm"
												onClick={() => handleDelete(member)}
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
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Editar Miembro del Equipo</DialogTitle>
					</DialogHeader>
					<form onSubmit={handleEditSubmit} className="space-y-4">
						<div>
							<Label htmlFor="edit-position">Posición</Label>
							<Input
								id="edit-position"
								name="position"
								defaultValue={editingTeamMember?.position}
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