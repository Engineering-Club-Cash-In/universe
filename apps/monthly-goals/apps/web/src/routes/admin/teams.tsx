import { createFileRoute } from "@tanstack/react-router";
import { orpc } from "@/utils/orpc";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, createSortableHeader, createFilterableHeader, createActionsColumn } from "@/components/ui/data-table";
import { Edit, Trash2 } from "lucide-react";
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
	SearchableSelect,
	SearchableSelectTrigger,
	SearchableSelectContent,
	SearchableSelectValue,
	SearchableSelectItem,
} from "@/components/ui/searchable-select";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@/components/ui/tabs";
import { useState, useMemo } from "react";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/error-handler";

export const Route = createFileRoute("/admin/teams")({
	component: TeamsPage,
});

type TeamMember = {
	id: string;
	userName: string | null;
	userEmail: string | null;
	areaName: string | null;
	departmentName: string | null;
	position: string | null;
	joinedAt: Date;
};

function TeamsPage() {
	const queryClient = useQueryClient();
	const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
	const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
	const [editingTeamMember, setEditingTeamMember] = useState<TeamMember | null>(null);

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
			password: formData.get("password") as string,
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
			id: editingTeamMember!.id,
			data,
		});
	};

	const handleEdit = (teamMember: TeamMember) => {
		setEditingTeamMember(teamMember);
		setIsEditDialogOpen(true);
	};

	const handleDelete = (teamMember: TeamMember) => {
		if (confirm("¿Estás seguro de que quieres eliminar este miembro del equipo?")) {
			deleteMutation.mutate({ id: teamMember.id });
		}
	};

	// Definir columnas para TanStack Table
	const columns = useMemo<ColumnDef<TeamMember>[]>(() => [
		{
			accessorKey: "userName",
			header: createSortableHeader("Nombre"),
			cell: ({ row }) => (
				<div className="font-medium">{row.getValue("userName") || "—"}</div>
			),
		},
		{
			accessorKey: "userEmail",
			header: createSortableHeader("Email"),
			cell: ({ row }) => row.getValue("userEmail") || "—",
		},
		{
			accessorKey: "areaName",
			header: createFilterableHeader("Área", 
				Array.from(new Set(teamMembers.data?.map(m => m.areaName).filter(Boolean) || []))
					.map(area => ({ label: area as string, value: area as string }))
			),
			cell: ({ row }) => row.getValue("areaName") || "—",
			filterFn: (row, id, value) => {
				if (!value || value.length === 0) return true;
				const cellValue = row.getValue(id);
				return cellValue ? value.includes(cellValue) : false;
			},
		},
		{
			accessorKey: "departmentName",
			header: createFilterableHeader("Departamento",
				Array.from(new Set(teamMembers.data?.map(m => m.departmentName).filter(Boolean) || []))
					.map(dept => ({ label: dept as string, value: dept as string }))
			),
			cell: ({ row }) => row.getValue("departmentName") || "—",
			filterFn: (row, id, value) => {
				if (!value || value.length === 0) return true;
				const cellValue = row.getValue(id);
				return cellValue ? value.includes(cellValue) : false;
			},
		},
		{
			accessorKey: "position",
			header: "Posición",
			cell: ({ row }) => row.getValue("position") || "—",
		},
		{
			accessorKey: "joinedAt",
			header: createSortableHeader("Fecha de Ingreso"),
			cell: ({ row }) => {
				return new Date(row.getValue("joinedAt")).toLocaleDateString("es-ES");
			},
		},
		createActionsColumn<TeamMember>([
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
	], [teamMembers.data]);

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
										<SearchableSelect name="userId" required>
											<SearchableSelectTrigger>
												<SearchableSelectValue placeholder="Selecciona un usuario" />
											</SearchableSelectTrigger>
											<SearchableSelectContent searchPlaceholder="Buscar usuario...">
												{availableUsers.isLoading ? (
													<div className="py-6 text-center text-sm text-muted-foreground">
														Cargando usuarios...
													</div>
												) : availableUsers.data?.map((user: any) => (
													<SearchableSelectItem key={user.id} value={user.id} searchValue={`${user.name} ${user.email}`}>
														{user.name} ({user.email})
													</SearchableSelectItem>
												))}
											</SearchableSelectContent>
										</SearchableSelect>
									</div>
									<div className="space-y-2">
										<Label htmlFor="areaId-existing">Área</Label>
										<SearchableSelect name="areaId" required>
											<SearchableSelectTrigger>
												<SearchableSelectValue placeholder="Selecciona un área" />
											</SearchableSelectTrigger>
											<SearchableSelectContent searchPlaceholder="Buscar área...">
												{areas.isLoading ? (
													<div className="py-6 text-center text-sm text-muted-foreground">
														Cargando áreas...
													</div>
												) : areas.data?.map((area: any) => (
													<SearchableSelectItem key={area.id} value={area.id} searchValue={`${area.name} ${area.departmentName}`}>
														{area.name} - {area.departmentName}
													</SearchableSelectItem>
												))}
											</SearchableSelectContent>
										</SearchableSelect>
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
										<Label htmlFor="password">Contraseña</Label>
										<Input id="password" name="password" type="password" minLength={8} required />
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
										<SearchableSelect name="areaId" required>
											<SearchableSelectTrigger>
												<SearchableSelectValue placeholder="Selecciona un área" />
											</SearchableSelectTrigger>
											<SearchableSelectContent searchPlaceholder="Buscar área...">
												{areas.isLoading ? (
													<div className="py-6 text-center text-sm text-muted-foreground">
														Cargando áreas...
													</div>
												) : areas.data?.map((area: any) => (
													<SearchableSelectItem key={area.id} value={area.id} searchValue={`${area.name} ${area.departmentName}`}>
														{area.name} - {area.departmentName}
													</SearchableSelectItem>
												))}
											</SearchableSelectContent>
										</SearchableSelect>
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
					<DataTable
						columns={columns}
						data={teamMembers.data || []}
						isLoading={teamMembers.isLoading}
						searchPlaceholder="Buscar miembros del equipo..."
						emptyMessage="No hay miembros del equipo registrados"
					/>
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
								defaultValue={editingTeamMember?.position || ""}
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