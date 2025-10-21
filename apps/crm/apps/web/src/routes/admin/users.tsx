import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
	Eye,
	EyeOff,
	FileText,
	MoreHorizontal,
	Plus,
	Shield,
	Trash2,
	User,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { ROLES, ROLE_CONFIG, ALL_ROLES, getRoleColor, getRoleLabel } from "server/src/types/roles";
import type { UserRole } from "server/src/types/roles";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { authClient } from "@/lib/auth-client";
import { client, orpc } from "@/utils/orpc";

export const Route = createFileRoute("/admin/users")({
	component: RouteComponent,
});

function RouteComponent() {
	const { data: session, isPending } = authClient.useSession();
	const navigate = Route.useNavigate();
	const queryClient = useQueryClient();
	const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
	const [showPassword, setShowPassword] = useState(false);
	const [userToDelete, setUserToDelete] = useState<string | null>(null);

	const userProfile = useQuery(orpc.getUserProfile.queryOptions());
	const usersQuery = useQuery(orpc.getAllUsers.queryOptions());

	const updateRoleMutation = useMutation({
		mutationFn: (input: { userId: string; role: UserRole }) =>
			client.updateUserRole(input),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["getAllUsers"] });
			toast.success("User role updated successfully");
		},
		onError: (error) => {
			toast.error(error.message || "Failed to update user role");
		},
	});

	const deleteUserMutation = useMutation({
		mutationFn: (input: { userId: string }) => client.deleteUser(input),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["getAllUsers"] });
			toast.success("User deleted successfully");
		},
		onError: (error) => {
			toast.error(error.message || "Failed to delete user");
		},
	});

	const createUserMutation = useMutation({
		mutationFn: (input: {
			name: string;
			email: string;
			password: string;
			role: UserRole;
		}) => client.createUser(input),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["getAllUsers"] });
			toast.success("User created successfully");
			setIsCreateDialogOpen(false);
			setShowPassword(false);
			createUserForm.reset();
		},
		onError: (error) => {
			toast.error(error.message || "Failed to create user");
		},
	});

	useEffect(() => {
		if (!session && !isPending) {
			navigate({ to: "/login" });
		} else if (session && userProfile.data?.role !== "admin") {
			navigate({ to: "/dashboard" });
			toast.error("Access denied: Admin role required");
		}
	}, [session, isPending, userProfile.data?.role]);

	if (isPending || userProfile.isPending) {
		return <div>Loading...</div>;
	}

	if (userProfile.data?.role !== "admin") {
		return null;
	}

	const handleRoleChange = (userId: string, newRole: UserRole) => {
		updateRoleMutation.mutate({ userId, role: newRole });
	};

	const handleDeleteUser = (userId: string) => {
		setUserToDelete(userId);
	};


	const createUserForm = useForm({
		defaultValues: {
			name: "",
			email: "",
			password: "",
			role: ROLES.SALES as UserRole,
		},
		onSubmit: async ({ value }) => {
			createUserMutation.mutate(value);
		},
		validators: {
			onSubmit: z.object({
				name: z.string().min(1, "Name is required"),
				email: z.string().email("Invalid email address"),
				password: z.string().min(8, "Password must be at least 8 characters"),
				role: z.enum(ALL_ROLES as [UserRole, ...UserRole[]]),
			}),
		},
	});

	return (
		<div className="container mx-auto space-y-6 p-6">
			<div>
				<h1 className="font-bold text-3xl">Gestión de usuarios</h1>
				<p className="text-muted-foreground">
					Gestionar usuarios y sus roles en toda la organización
				</p>
			</div>

			<Card>
				<CardHeader>
					<div className="flex items-center justify-between">
						<div>
							<CardTitle>Usuarios de la organización</CardTitle>
							<CardDescription>
								Todos los usuarios con direcciones de correo electrónico
								@clubcashin.com
							</CardDescription>
						</div>
						<Dialog
							open={isCreateDialogOpen}
							onOpenChange={(open) => {
								setIsCreateDialogOpen(open);
								if (!open) {
									setShowPassword(false);
									createUserForm.reset();
								}
							}}
						>
							<DialogTrigger asChild>
								<Button>
									<Plus className="mr-2 h-4 w-4" />
									Crear usuario
								</Button>
							</DialogTrigger>
							<DialogContent>
								<DialogHeader>
									<DialogTitle>Crear nuevo usuario</DialogTitle>
								</DialogHeader>
								<form
									onSubmit={(e) => {
										e.preventDefault();
										e.stopPropagation();
										void createUserForm.handleSubmit();
									}}
									className="space-y-4"
								>
									<div>
										<createUserForm.Field name="name">
											{(field) => (
												<div className="space-y-2">
													<Label htmlFor={field.name}>Nombre</Label>
													<Input
														id={field.name}
														name={field.name}
														type="text"
														value={field.state.value}
														onBlur={field.handleBlur}
														onChange={(e) => field.handleChange(e.target.value)}
													/>
													{field.state.meta.errors.map((error) => (
														<p
															key={error?.message}
															className="text-red-500 text-sm"
														>
															{error?.message}
														</p>
													))}
												</div>
											)}
										</createUserForm.Field>
									</div>

									<div>
										<createUserForm.Field name="email">
											{(field) => (
												<div className="space-y-2">
													<Label htmlFor={field.name}>Correo electrónico</Label>
													<Input
														id={field.name}
														name={field.name}
														type="email"
														value={field.state.value}
														onBlur={field.handleBlur}
														onChange={(e) => field.handleChange(e.target.value)}
													/>
													{field.state.meta.errors.map((error) => (
														<p
															key={error?.message}
															className="text-red-500 text-sm"
														>
															{error?.message}
														</p>
													))}
												</div>
											)}
										</createUserForm.Field>
									</div>

									<div>
										<createUserForm.Field name="password">
											{(field) => (
												<div className="space-y-2">
													<Label htmlFor={field.name}>Contraseña</Label>
													<div className="relative">
														<Input
															id={field.name}
															name={field.name}
															type={showPassword ? "text" : "password"}
															value={field.state.value}
															onBlur={field.handleBlur}
															onChange={(e) =>
																field.handleChange(e.target.value)
															}
															className="pr-10"
														/>
														<button
															type="button"
															onClick={() => setShowPassword(!showPassword)}
															className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600"
														>
															{showPassword ? (
																<EyeOff className="h-4 w-4" />
															) : (
																<Eye className="h-4 w-4" />
															)}
														</button>
													</div>
													{field.state.meta.errors.map((error) => (
														<p
															key={error?.message}
															className="text-red-500 text-sm"
														>
															{error?.message}
														</p>
													))}
												</div>
											)}
										</createUserForm.Field>
									</div>

									<div>
										<createUserForm.Field name="role">
											{(field) => (
												<div className="space-y-2">
													<Label htmlFor={field.name}>Rol</Label>
													<Select
														value={field.state.value}
														onValueChange={(value) =>
															field.handleChange(value as UserRole)
														}
													>
														<SelectTrigger>
															<SelectValue placeholder="Seleccionar rol" />
														</SelectTrigger>
														<SelectContent>
															{ALL_ROLES.map((role: string) => (
																<SelectItem key={role} value={role}>
																	{getRoleLabel(role)}
																</SelectItem>
															))}
														</SelectContent>
													</Select>
													{field.state.meta.errors.map((error) => (
														<p
															key={error?.message}
															className="text-red-500 text-sm"
														>
															{error?.message}
														</p>
													))}
												</div>
											)}
										</createUserForm.Field>
									</div>

									<createUserForm.Subscribe>
										{(state) => (
											<Button
												type="submit"
												className="w-full"
												disabled={
													!state.canSubmit ||
													state.isSubmitting ||
													createUserMutation.isPending
												}
											>
												{state.isSubmitting || createUserMutation.isPending
													? "Creando..."
													: "Crear usuario"}
											</Button>
										)}
									</createUserForm.Subscribe>
								</form>
							</DialogContent>
						</Dialog>
					</div>
				</CardHeader>
				<CardContent>
					{usersQuery.isPending ? (
						<div>Cargando usuarios...</div>
					) : usersQuery.error ? (
						<div className="text-red-500">
							Error al cargar los usuarios: {usersQuery.error.message}
						</div>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Nombre</TableHead>
									<TableHead>Correo electrónico</TableHead>
									<TableHead>Rol</TableHead>
									<TableHead>Estado</TableHead>
									<TableHead>Se unió</TableHead>
									<TableHead className="text-right">Acciones</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{usersQuery.data?.map((user) => (
									<TableRow key={user.id}>
										<TableCell className="font-medium">{user.name}</TableCell>
										<TableCell>{user.email}</TableCell>
										<TableCell>
											<Badge className={getRoleColor(user.role)}>
												{user.role === ROLES.ADMIN ? (
													<>
														<Shield className="mr-1 h-3 w-3" /> {getRoleLabel(user.role)}
													</>
												) : user.role === ROLES.ANALYST ? (
													<>
														<FileText className="mr-1 h-3 w-3" /> {getRoleLabel(user.role)}
													</>
												) : (
													<>
														<User className="mr-1 h-3 w-3" /> {getRoleLabel(user.role)}
													</>
												)}
											</Badge>
										</TableCell>
										<TableCell>
											<Badge
												variant={user.emailVerified ? "default" : "secondary"}
											>
												{user.emailVerified ? "Verificado" : "Pendiente"}
											</Badge>
										</TableCell>
										<TableCell>
											{new Date(user.createdAt).toLocaleDateString("es-GT")}
										</TableCell>
										<TableCell className="text-right">
											<DropdownMenu>
												<DropdownMenuTrigger asChild>
													<Button variant="ghost" className="h-8 w-8 p-0">
														<span className="sr-only">Abrir menú</span>
														<MoreHorizontal className="h-4 w-4" />
													</Button>
												</DropdownMenuTrigger>
												<DropdownMenuContent align="end">
													<DropdownMenuLabel>Acciones</DropdownMenuLabel>
													<DropdownMenuSeparator />
													<DropdownMenuItem
														onClick={() =>
															handleRoleChange(
																user.id,
																user.role === "admin" ? "sales" : "admin",
															)
														}
														disabled={user.id === session?.user?.id}
													>
														{user.role === "admin" ? (
															<>
																<User className="mr-2 h-4 w-4" />
																Cambiar a Ventas
															</>
														) : (
															<>
																<Shield className="mr-2 h-4 w-4" />
																Cambiar a Administrador
															</>
														)}
													</DropdownMenuItem>
													<DropdownMenuSeparator />
													<DropdownMenuItem
														onClick={() => handleDeleteUser(user.id)}
														disabled={user.id === session?.user?.id}
														className="text-red-600"
													>
														<Trash2 className="mr-2 h-4 w-4" />
														Eliminar usuario
													</DropdownMenuItem>
												</DropdownMenuContent>
											</DropdownMenu>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>

			{/* Alert Dialog para confirmar eliminación */}
			<AlertDialog open={!!userToDelete} onOpenChange={(open) => !open && setUserToDelete(null)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>¿Eliminar usuario?</AlertDialogTitle>
						<AlertDialogDescription>
							Esta acción no se puede deshacer. El usuario será eliminado permanentemente del sistema.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancelar</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => {
								if (userToDelete) {
									deleteUserMutation.mutate({ userId: userToDelete });
									setUserToDelete(null);
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
