import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { client } from "@/utils/orpc";
import { toast } from "sonner";
import type { AppRouterClient } from "../../../../server/src/routers/index";

type UserRole = "super_admin" | "department_manager" | "area_lead" | "employee" | "viewer";
type User = Awaited<ReturnType<AppRouterClient['users']['list']>>[0];
import { Button } from "@/components/ui/button";
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
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal, UserPlus, Trash2, Settings } from "lucide-react";
import { usePermissions } from "@/lib/permissions";

export const Route = createFileRoute("/admin/users")({
	component: RouteComponent,
});

function RouteComponent() {
	const { canManageUsers, canCreateUserWithRole, canDeleteUsers } = usePermissions();
	const [createDialogOpen, setCreateDialogOpen] = useState(false);
	const [roleDialogOpen, setRoleDialogOpen] = useState(false);
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const [selectedUser, setSelectedUser] = useState<User | null>(null);
	const [newRole, setNewRole] = useState<UserRole>("employee");
	const queryClient = useQueryClient();

	// Cargar usuarios
	const { data: users, isLoading } = useQuery({
		queryKey: ["users", "list"],
		queryFn: () => client.users.list(undefined),
		enabled: canManageUsers,
	});

	// Crear usuario
	const createUserMutation = useMutation({
		mutationFn: client.users.create,
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["users", "list"] });
			setCreateDialogOpen(false);
			toast.success("Usuario creado exitosamente");
		},
		onError: (error: Error) => {
			toast.error(error.message || "Error al crear usuario");
		},
	});

	// Actualizar rol
	const updateRoleMutation = useMutation({
		mutationFn: client.users.updateRole,
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["users", "list"] });
			toast.success("Rol actualizado exitosamente");
		},
		onError: (error: Error) => {
			toast.error(error.message || "Error al actualizar rol");
		},
	});

	// Eliminar usuario
	const deleteUserMutation = useMutation({
		mutationFn: client.users.delete,
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["users", "list"] });
			toast.success("Usuario eliminado exitosamente");
		},
		onError: (error: Error) => {
			toast.error(error.message || "Error al eliminar usuario");
		},
	});

	const roleLabels: Record<UserRole, string> = {
		super_admin: "Super Admin",
		department_manager: "Gerente de Departamento",
		area_lead: "Líder de Área",
		employee: "Empleado",
		viewer: "Visor",
	};

	const roleColors: Record<UserRole, string> = {
		super_admin: "bg-red-100 text-red-800",
		department_manager: "bg-blue-100 text-blue-800",
		area_lead: "bg-green-100 text-green-800",
		employee: "bg-yellow-100 text-yellow-800",
		viewer: "bg-gray-100 text-gray-800",
	};

	if (!canManageUsers) {
		return (
			<div className="container mx-auto p-6">
				<div className="text-center">
					<h1 className="text-2xl font-bold text-gray-900 mb-4">Acceso Denegado</h1>
					<p className="text-gray-600">No tienes permisos para administrar usuarios.</p>
				</div>
			</div>
		);
	}

	return (
		<div className="container mx-auto p-6">
			<div className="flex justify-between items-center mb-6">
				<h1 className="text-2xl font-bold text-gray-900">Administración de Usuarios</h1>
				<Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
					<DialogTrigger asChild>
						<Button>
							<UserPlus className="h-4 w-4 mr-2" />
							Crear Usuario
						</Button>
					</DialogTrigger>
					<CreateUserDialog
						onSubmit={(data) => createUserMutation.mutate(data)}
						isLoading={createUserMutation.isPending}
						canCreateUserWithRole={canCreateUserWithRole}
					/>
				</Dialog>
			</div>

			{isLoading ? (
				<div className="flex items-center justify-center py-8">
					<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" />
				</div>
			) : (
				<div className="bg-white shadow-sm rounded-lg border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Nombre</TableHead>
								<TableHead>Email</TableHead>
								<TableHead>Rol</TableHead>
								<TableHead>Fecha de Creación</TableHead>
								<TableHead className="w-[50px]"></TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{users?.map((user) => (
								<TableRow key={user.id}>
									<TableCell className="font-medium">{user.name}</TableCell>
									<TableCell>{user.email}</TableCell>
									<TableCell>
										<Badge className={roleColors[user.role]}>
											{roleLabels[user.role]}
										</Badge>
									</TableCell>
									<TableCell>
										{new Date(user.createdAt).toLocaleDateString("es-ES")}
									</TableCell>
									<TableCell>
										<DropdownMenu>
											<DropdownMenuTrigger asChild>
												<Button variant="ghost" className="h-8 w-8 p-0">
													<MoreHorizontal className="h-4 w-4" />
												</Button>
											</DropdownMenuTrigger>
											<DropdownMenuContent align="end">
												<DropdownMenuItem
													onClick={() => {
														setSelectedUser(user);
														setNewRole(user.role);
														setRoleDialogOpen(true);
													}}
												>
													<Settings className="h-4 w-4 mr-2" />
													Cambiar Rol
												</DropdownMenuItem>
												{canDeleteUsers && (
													<DropdownMenuItem
														onClick={() => {
															setSelectedUser(user);
															setDeleteDialogOpen(true);
														}}
														className="text-red-600"
													>
														<Trash2 className="h-4 w-4 mr-2" />
														Eliminar
													</DropdownMenuItem>
												)}
											</DropdownMenuContent>
										</DropdownMenu>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
			)}

			{/* Modal para cambiar rol */}
			<Dialog open={roleDialogOpen} onOpenChange={setRoleDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Cambiar Rol de Usuario</DialogTitle>
					</DialogHeader>
					<div className="space-y-4">
						<div>
							<p className="text-sm text-gray-600">
								Cambiando rol de: <strong>{selectedUser?.name}</strong> ({selectedUser?.email})
							</p>
							<p className="text-sm text-gray-500">
								Rol actual: <strong>{selectedUser ? roleLabels[selectedUser.role] : ""}</strong>
							</p>
						</div>
						<div className="space-y-2">
							<Label htmlFor="newRole">Nuevo Rol</Label>
							<Select value={newRole} onValueChange={(value) => setNewRole(value as UserRole)}>
								<SelectTrigger>
									<SelectValue placeholder="Seleccionar nuevo rol" />
								</SelectTrigger>
								<SelectContent>
									{[
										{ value: "super_admin", label: "Super Admin" },
										{ value: "department_manager", label: "Gerente de Departamento" },
										{ value: "area_lead", label: "Líder de Área" },
										{ value: "employee", label: "Empleado" },
										{ value: "viewer", label: "Visor" },
									]
										.filter(role => canCreateUserWithRole(role.value))
										.map((role) => (
											<SelectItem key={role.value} value={role.value}>
												{role.label}
											</SelectItem>
										))}
								</SelectContent>
							</Select>
						</div>
						<div className="flex justify-end space-x-2 pt-4">
							<Button 
								variant="outline" 
								onClick={() => setRoleDialogOpen(false)}
							>
								Cancelar
							</Button>
							<Button
								onClick={() => {
									if (selectedUser && newRole !== selectedUser.role) {
										updateRoleMutation.mutate({
											userId: selectedUser.id,
											newRole: newRole,
										});
										setRoleDialogOpen(false);
									}
								}}
								disabled={updateRoleMutation.isPending}
							>
								{updateRoleMutation.isPending ? "Actualizando..." : "Actualizar Rol"}
							</Button>
						</div>
					</div>
				</DialogContent>
			</Dialog>

			{/* Modal para confirmar eliminación */}
			<Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Confirmar Eliminación</DialogTitle>
					</DialogHeader>
					<div className="space-y-4">
						<div>
							<p className="text-sm text-gray-600">
								¿Estás seguro de que quieres eliminar al usuario?
							</p>
							<div className="mt-2 p-3 bg-gray-50 rounded-md">
								<p className="text-sm font-medium">{selectedUser?.name}</p>
								<p className="text-sm text-gray-500">{selectedUser?.email}</p>
								<p className="text-sm text-gray-500">
									Rol: {selectedUser ? roleLabels[selectedUser.role] : ""}
								</p>
							</div>
							<p className="text-sm text-red-600 mt-2">
								Esta acción no se puede deshacer.
							</p>
						</div>
						<div className="flex justify-end space-x-2 pt-4">
							<Button 
								variant="outline" 
								onClick={() => setDeleteDialogOpen(false)}
							>
								Cancelar
							</Button>
							<Button
								variant="destructive"
								onClick={() => {
									if (selectedUser) {
										deleteUserMutation.mutate({ userId: selectedUser.id });
										setDeleteDialogOpen(false);
									}
								}}
								disabled={deleteUserMutation.isPending}
							>
								{deleteUserMutation.isPending ? "Eliminando..." : "Eliminar Usuario"}
							</Button>
						</div>
					</div>
				</DialogContent>
			</Dialog>
		</div>
	);
}

function CreateUserDialog({
	onSubmit,
	isLoading,
	canCreateUserWithRole,
}: {
	onSubmit: (data: {
		name: string;
		email: string;
		password: string;
		role: UserRole;
	}) => void;
	isLoading: boolean;
	canCreateUserWithRole: (role: string) => boolean;
}) {
	const [formData, setFormData] = useState<{
		name: string;
		email: string;
		password: string;
		role: UserRole;
	}>({
		name: "",
		email: "",
		password: "",
		role: "employee",
	});

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		onSubmit(formData);
	};

	const availableRoles = [
		{ value: "super_admin", label: "Super Admin" },
		{ value: "department_manager", label: "Gerente de Departamento" },
		{ value: "area_lead", label: "Líder de Área" },
		{ value: "employee", label: "Empleado" },
		{ value: "viewer", label: "Visor" },
	].filter(role => canCreateUserWithRole(role.value));

	return (
		<DialogContent>
			<DialogHeader>
				<DialogTitle>Crear Nuevo Usuario</DialogTitle>
			</DialogHeader>
			<form onSubmit={handleSubmit} className="space-y-6">
				<div className="space-y-2">
					<Label htmlFor="name">Nombre</Label>
					<Input
						id="name"
						value={formData.name}
						onChange={(e) => setFormData({ ...formData, name: e.target.value })}
						required
					/>
				</div>
				<div className="space-y-2">
					<Label htmlFor="email">Email</Label>
					<Input
						id="email"
						type="email"
						value={formData.email}
						onChange={(e) => setFormData({ ...formData, email: e.target.value })}
						required
					/>
				</div>
				<div className="space-y-2">
					<Label htmlFor="password">Contraseña</Label>
					<Input
						id="password"
						type="password"
						value={formData.password}
						onChange={(e) => setFormData({ ...formData, password: e.target.value })}
						minLength={8}
						required
					/>
				</div>
				<div className="space-y-2">
					<Label htmlFor="role">Rol</Label>
					<Select
						value={formData.role}
						onValueChange={(value) => setFormData({ ...formData, role: value as UserRole })}
					>
						<SelectTrigger>
							<SelectValue placeholder="Seleccionar rol" />
						</SelectTrigger>
						<SelectContent>
							{availableRoles.map((role) => (
								<SelectItem key={role.value} value={role.value}>
									{role.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<div className="flex justify-end space-x-2 pt-4">
					<Button type="submit" disabled={isLoading}>
						{isLoading ? "Creando..." : "Crear Usuario"}
					</Button>
				</div>
			</form>
		</DialogContent>
	);
}