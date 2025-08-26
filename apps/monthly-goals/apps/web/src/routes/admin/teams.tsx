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
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@/components/ui/tabs";
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

	// Queries - Use filtered endpoint based on user role
	const teamMembers = useQuery(orpc.teams.my.queryOptions());
	const areas = useQuery(orpc.areas.list.queryOptions());
	const availableUsers = useQuery(orpc.teams.availableUsers.queryOptions());

	// Mutations
	const createMutation = useMutation(
		orpc.teams.create.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: orpc.teams.my.key(),
				});
				queryClient.invalidateQueries({
					queryKey: orpc.teams.list.key(),
				});
				queryClient.invalidateQueries({
					queryKey: orpc.teams.availableUsers.key(),
				});
				setIsCreateDialogOpen(false);
				toast.success("Miembro del equipo creado exitosamente");
			},
			onError: (error) => {
				toast.error(getErrorMessage(error, "Error al crear miembro del equipo"));
			},
		})
	);

	const createUserAndAssignMutation = useMutation(
		orpc.teams.createUserAndAssign.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: orpc.teams.my.key(),
				});
				queryClient.invalidateQueries({
					queryKey: orpc.teams.list.key(),
				});
				queryClient.invalidateQueries({
					queryKey: orpc.teams.availableUsers.key(),
				});
				setIsCreateDialogOpen(false);
				toast.success("Usuario y miembro del equipo creados exitosamente");
			},
			onError: (error) => {
				toast.error(getErrorMessage(error, "Error al crear usuario y miembro del equipo"));
			},
		})
	);

	const updateMutation = useMutation(
		orpc.teams.update.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: orpc.teams.my.key(),
				});
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
					queryKey: orpc.teams.my.key(),
				});
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

	const handleCreateExistingSubmit = (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		const formData = new FormData(e.currentTarget);
		const data = {
			userId: formData.get("userId") as string,
			areaId: formData.get("areaId") as string,
			position: formData.get("position") as string,
		};
		createMutation.mutate(data);
	};

	const handleCreateNewSubmit = (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		const formData = new FormData(e.currentTarget);
		const data = {
			name: formData.get("name") as string,
			email: formData.get("email") as string,
			role: ((formData.get("role") as string) || "employee") as "super_admin" | "department_manager" | "area_lead" | "employee" | "viewer",
			areaId: formData.get("areaId") as string,
			position: formData.get("position") as string,
		};
		createUserAndAssignMutation.mutate(data);
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
					<DialogContent className="space-y-6">
						<DialogHeader>
							<DialogTitle>Agregar Miembro al Equipo</DialogTitle>
						</DialogHeader>
						
						<Tabs defaultValue="existing" className="space-y-6">
							<TabsList className="grid w-full grid-cols-2">
								<TabsTrigger value="existing">Usuario Existente</TabsTrigger>
								<TabsTrigger value="new">Crear Usuario Nuevo</TabsTrigger>
							</TabsList>

							<TabsContent value="existing" className="space-y-6">
								<form onSubmit={handleCreateExistingSubmit} className="space-y-6">
									<div className="space-y-2">
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
									<div className="space-y-2">
										<Label htmlFor="areaId-existing">Área</Label>
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
									<div className="space-y-2">
										<Label htmlFor="position-existing">Posición</Label>
										<Input id="position-existing" name="position" />
									</div>
									<Button type="submit" disabled={createMutation.isPending}>
										{createMutation.isPending ? "Agregando..." : "Agregar Usuario Existente"}
									</Button>
								</form>
							</TabsContent>

							<TabsContent value="new" className="space-y-6">
								<form onSubmit={handleCreateNewSubmit} className="space-y-6">
									<div className="space-y-2">
										<Label htmlFor="name">Nombre Completo</Label>
										<Input id="name" name="name" required />
									</div>
									<div className="space-y-2">
										<Label htmlFor="email">Correo Electrónico</Label>
										<Input id="email" name="email" type="email" required />
									</div>
									<div className="space-y-2">
										<Label htmlFor="role">Rol</Label>
										<Select name="role" defaultValue="employee">
											<SelectTrigger>
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												<SelectItem value="employee">Empleado</SelectItem>
												<SelectItem value="area_lead">Jefe de Área</SelectItem>
												<SelectItem value="department_manager">Gerente de Departamento</SelectItem>
												<SelectItem value="viewer">Observador</SelectItem>
											</SelectContent>
										</Select>
									</div>
									<div className="space-y-2">
										<Label htmlFor="areaId-new">Área</Label>
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
									<div className="space-y-2">
										<Label htmlFor="position-new">Posición</Label>
										<Input id="position-new" name="position" />
									</div>
									<Button type="submit" disabled={createUserAndAssignMutation.isPending}>
										{createUserAndAssignMutation.isPending ? "Creando..." : "Crear Usuario y Agregar al Equipo"}
									</Button>
								</form>
							</TabsContent>
						</Tabs>
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