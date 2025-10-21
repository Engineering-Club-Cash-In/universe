import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
	Building,
	Calendar,
	DollarSign,
	Filter,
	HandshakeIcon,
	MoreHorizontal,
	Plus,
	Search,
	User,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PERMISSIONS } from "server/src/types/roles";
import { NotesTimeline } from "@/components/notes-timeline";
import { Badge } from "@/components/ui/badge";
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
import { authClient } from "@/lib/auth-client";
import { formatGuatemalaDate, getStatusLabel } from "@/lib/crm-formatters";
import { client, orpc } from "@/utils/orpc";

export const Route = createFileRoute("/crm/clients")({
	component: RouteComponent,
});

function RouteComponent() {
	const { data: session, isPending } = authClient.useSession();
	const navigate = Route.useNavigate();
	const queryClient = useQueryClient();
	const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
	const [searchTerm, setSearchTerm] = useState("");
	const [statusFilter, setStatusFilter] = useState<string>("all");

	const userProfile = useQuery(orpc.getUserProfile.queryOptions());
	const clientsQuery = useQuery({
		...orpc.getClients.queryOptions(),
		enabled:
			!!userProfile.data?.role &&
			PERMISSIONS.canAccessCRM(userProfile.data.role) &&
			!!session?.user?.id,
		queryKey: ["getClients", session?.user?.id, userProfile.data?.role],
	});
	const companiesQuery = useQuery({
		...orpc.getCompanies.queryOptions(),
		enabled:
			!!userProfile.data?.role &&
			PERMISSIONS.canAccessCRM(userProfile.data.role) &&
			!!session?.user?.id,
		queryKey: ["getCompanies", session?.user?.id, userProfile.data?.role],
	});
	const crmUsersQuery = useQuery({
		...orpc.getCrmUsers.queryOptions(),
		enabled:
			!!userProfile.data?.role &&
			PERMISSIONS.canAccessCRM(userProfile.data.role) &&
			!!session?.user?.id,
		queryKey: ["getCrmUsers", session?.user?.id, userProfile.data?.role],
	});

	const createClientForm = useForm({
		defaultValues: {
			companyId: "",
			contactPerson: "",
			contractValue: "",
			startDate: "",
			endDate: "",
			assignedTo: session?.user?.id || "",
			notes: "",
		},
		validators: {
			onChange: ({ value }) => {
				if (!value.companyId || value.companyId === "") {
					return { form: "La empresa es requerida" };
				}
				if (!value.contactPerson || value.contactPerson.trim() === "") {
					return { form: "La persona de contacto es requerida" };
				}
				return undefined;
			},
		},
		onSubmit: async ({ value }) => {
			createClientMutation.mutate({
				...value,
				companyId: value.companyId,
				contractValue: value.contractValue || undefined,
				startDate: value.startDate || undefined,
				endDate: value.endDate || undefined,
				assignedTo: value.assignedTo || undefined,
				notes: value.notes || undefined,
			});
		},
	});

	const createClientMutation = useMutation({
		mutationFn: (input: {
			companyId: string;
			contactPerson: string;
			contractValue?: string;
			startDate?: string;
			endDate?: string;
			assignedTo?: string;
			notes?: string;
		}) => client.createClient(input),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: ["getClients", session?.user?.id, userProfile.data?.role],
			});
			toast.success("Cliente creado exitosamente");
			setIsCreateDialogOpen(false);
			createClientForm.reset();
		},
		onError: (error: any) => {
			toast.error(error.message || "Error al crear cliente");
		},
	});

	const updateClientMutation = useMutation({
		mutationFn: (input: {
			id: string;
			companyId?: string;
			contactPerson?: string;
			contractValue?: string;
			startDate?: string;
			endDate?: string;
			status?: "active" | "inactive" | "churned";
			assignedTo?: string;
			notes?: string;
		}) => client.updateClient(input),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: ["getClients", session?.user?.id, userProfile.data?.role],
			});
			toast.success("Cliente actualizado exitosamente");
		},
		onError: (error: any) => {
			toast.error(error.message || "Error al actualizar cliente");
		},
	});

	useEffect(() => {
		if (!session && !isPending) {
			navigate({ to: "/login" });
		} else if (
			session &&
			userProfile.data?.role &&
			!PERMISSIONS.canAccessCRM(userProfile.data.role)
		) {
			navigate({ to: "/dashboard" });
			toast.error("Acceso denegado: Se requiere acceso al CRM");
		}
	}, [session, isPending, userProfile.data?.role]);

	if (isPending || userProfile.isPending) {
		return <div>Cargando...</div>;
	}

	if (
		!userProfile.data?.role ||
		!PERMISSIONS.canAccessCRM(userProfile.data.role)
	) {
		return null;
	}

	const getStatusBadgeColor = (status: string) => {
		switch (status) {
			case "active":
				return "bg-green-100 text-green-800";
			case "inactive":
				return "bg-gray-100 text-gray-800";
			case "churned":
				return "bg-red-100 text-red-800";
			default:
				return "bg-blue-100 text-blue-800";
		}
	};

	const handleStatusChange = (clientId: string, newStatus: string) => {
		updateClientMutation.mutate({
			id: clientId,
			status: newStatus as "active" | "inactive" | "churned",
		});
	};

	// Filter clients based on search and status
	const filteredClients =
		clientsQuery.data?.filter((clientData) => {
			const matchesSearch =
				searchTerm === "" ||
				clientData.contactPerson
					.toLowerCase()
					.includes(searchTerm.toLowerCase()) ||
				clientData.company?.name
					?.toLowerCase()
					.includes(searchTerm.toLowerCase());

			const matchesStatus =
				statusFilter === "all" || clientData.status === statusFilter;

			return matchesSearch && matchesStatus;
		}) || [];

	// Calculate client metrics
	const totalClients = clientsQuery.data?.length || 0;
	const activeClients =
		clientsQuery.data?.filter((c) => c.status === "active").length || 0;
	const inactiveClients =
		clientsQuery.data?.filter((c) => c.status === "inactive").length || 0;
	const churnedClients =
		clientsQuery.data?.filter((c) => c.status === "churned").length || 0;

	// Calculate total contract value
	const totalContractValue =
		clientsQuery.data?.reduce((sum, client) => {
			return sum + (Number.parseFloat(client.contractValue || "0") || 0);
		}, 0) || 0;

	return (
		<div className="container mx-auto space-y-6 p-6">
			<div>
				<h1 className="font-bold text-3xl">Cartera de Clientes</h1>
				<p className="text-muted-foreground">
					{userProfile.data.role === "admin"
						? "Gestiona todas las relaciones con clientes"
						: "Gestiona tus clientes asignados"}
				</p>
			</div>

			{/* Stats Cards */}
			<div className="grid gap-4 md:grid-cols-4">
				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="font-medium text-sm">
							Total de Clientes
						</CardTitle>
						<HandshakeIcon className="h-4 w-4 text-muted-foreground" />
					</CardHeader>
					<CardContent>
						<div className="font-bold text-2xl">{totalClients}</div>
						<p className="text-muted-foreground text-xs">Relaciones activas</p>
					</CardContent>
				</Card>
				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="font-medium text-sm">
							Clientes Activos
						</CardTitle>
						<HandshakeIcon className="h-4 w-4 text-green-500" />
					</CardHeader>
					<CardContent>
						<div className="font-bold text-2xl">{activeClients}</div>
						<p className="text-muted-foreground text-xs">
							Actualmente comprometidos
						</p>
					</CardContent>
				</Card>
				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="font-medium text-sm">Perdidos</CardTitle>
						<HandshakeIcon className="h-4 w-4 text-red-500" />
					</CardHeader>
					<CardContent>
						<div className="font-bold text-2xl">{churnedClients}</div>
						<p className="text-muted-foreground text-xs">Clientes perdidos</p>
					</CardContent>
				</Card>
				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="font-medium text-sm">
							Valor de Contratos
						</CardTitle>
						<DollarSign className="h-4 w-4 text-purple-500" />
					</CardHeader>
					<CardContent>
						<div className="font-bold text-2xl">
							${totalContractValue.toLocaleString()}
						</div>
						<p className="text-muted-foreground text-xs">Cartera total</p>
					</CardContent>
				</Card>
			</div>

			<Card>
				<CardHeader>
					<div className="flex items-center justify-between">
						<div>
							<CardTitle>Directorio de Clientes</CardTitle>
							<CardDescription>
								Gestiona y cultiva tus relaciones con clientes
							</CardDescription>
						</div>
						<Dialog
							open={isCreateDialogOpen}
							onOpenChange={(open) => {
								setIsCreateDialogOpen(open);
								if (!open) {
									createClientForm.reset();
								}
							}}
						>
							<DialogTrigger asChild>
								<Button>
									<Plus className="mr-2 h-4 w-4" />
									Agregar Cliente
								</Button>
							</DialogTrigger>
							<DialogContent className="max-w-2xl">
								<DialogHeader>
									<DialogTitle>Crear Nuevo Cliente</DialogTitle>
								</DialogHeader>
								<form
									onSubmit={(e) => {
										e.preventDefault();
										e.stopPropagation();
										void createClientForm.handleSubmit();
									}}
									className="space-y-4"
								>
									<div className="grid grid-cols-2 gap-4">
										<div>
											<createClientForm.Field name="companyId">
												{(field) => (
													<div className="space-y-2">
														<Label htmlFor={field.name}>
															Empresa <span className="text-red-500">*</span>
														</Label>
														<Select
															value={field.state.value}
															onValueChange={(value) =>
																field.handleChange(value)
															}
														>
															<SelectTrigger>
																<SelectValue placeholder="Seleccionar empresa" />
															</SelectTrigger>
															<SelectContent>
																{companiesQuery.data?.map((company) => (
																	<SelectItem
																		key={company.id}
																		value={company.id}
																	>
																		{company.name}
																	</SelectItem>
																))}
															</SelectContent>
														</Select>
													</div>
												)}
											</createClientForm.Field>
										</div>
										<div>
											<createClientForm.Field name="contactPerson">
												{(field) => (
													<div className="space-y-2">
														<Label htmlFor={field.name}>
															Persona de Contacto{" "}
															<span className="text-red-500">*</span>
														</Label>
														<Input
															id={field.name}
															name={field.name}
															value={field.state.value}
															onBlur={field.handleBlur}
															onChange={(e) =>
																field.handleChange(e.target.value)
															}
															placeholder="Nombre del contacto principal"
														/>
													</div>
												)}
											</createClientForm.Field>
										</div>
									</div>

									<div className="grid grid-cols-2 gap-4">
										<div>
											<createClientForm.Field name="contractValue">
												{(field) => (
													<div className="space-y-2">
														<Label htmlFor={field.name}>
															Valor del Contrato
														</Label>
														<Input
															id={field.name}
															name={field.name}
															type="number"
															value={field.state.value}
															onBlur={field.handleBlur}
															onChange={(e) =>
																field.handleChange(e.target.value)
															}
															placeholder="0.00"
														/>
													</div>
												)}
											</createClientForm.Field>
										</div>
										<div>
											<createClientForm.Field name="assignedTo">
												{(field) => (
													<div className="space-y-2">
														<Label htmlFor={field.name}>Asignado a</Label>
														<Select
															value={field.state.value}
															onValueChange={(value) => field.handleChange(value)}
														>
															<SelectTrigger size="full">
																<SelectValue placeholder="Seleccionar vendedor" />
															</SelectTrigger>
															<SelectContent size="full">
																{crmUsersQuery.isLoading ? (
																	<SelectItem value="" disabled>
																		Cargando usuarios...
																	</SelectItem>
																) : crmUsersQuery.isError ? (
																	<SelectItem value="" disabled>
																		Error al cargar usuarios
																	</SelectItem>
																) : !crmUsersQuery.data || crmUsersQuery.data.length === 0 ? (
																	<SelectItem value="" disabled>
																		No hay usuarios disponibles
																	</SelectItem>
																) : (
																	crmUsersQuery.data.map((user) => (
																		<SelectItem key={user.id} value={user.id}>
																			{user.name}
																		</SelectItem>
																	))
																)}
															</SelectContent>
														</Select>
													</div>
												)}
											</createClientForm.Field>
										</div>
									</div>

									<div className="grid grid-cols-2 gap-4">
										<div>
											<createClientForm.Field name="startDate">
												{(field) => (
													<div className="space-y-2">
														<Label htmlFor={field.name}>Fecha de Inicio</Label>
														<Input
															id={field.name}
															name={field.name}
															type="date"
															value={field.state.value}
															onBlur={field.handleBlur}
															onChange={(e) =>
																field.handleChange(e.target.value)
															}
														/>
													</div>
												)}
											</createClientForm.Field>
										</div>
										<div>
											<createClientForm.Field name="endDate">
												{(field) => (
													<div className="space-y-2">
														<Label htmlFor={field.name}>Fecha de Fin</Label>
														<Input
															id={field.name}
															name={field.name}
															type="date"
															value={field.state.value}
															onBlur={field.handleBlur}
															onChange={(e) =>
																field.handleChange(e.target.value)
															}
														/>
													</div>
												)}
											</createClientForm.Field>
										</div>
									</div>

									<div>
										<createClientForm.Field name="notes">
											{(field) => (
												<div className="space-y-2">
													<Label htmlFor={field.name}>Notas</Label>
													<Textarea
														id={field.name}
														name={field.name}
														value={field.state.value}
														onBlur={field.handleBlur}
														onChange={(e) => field.handleChange(e.target.value)}
														placeholder="Notas adicionales sobre este cliente..."
														rows={3}
													/>
												</div>
											)}
										</createClientForm.Field>
									</div>

									<createClientForm.Subscribe>
										{(state) => (
											<Button
												type="submit"
												className="w-full"
												disabled={
													!state.canSubmit ||
													state.isSubmitting ||
													createClientMutation.isPending
												}
											>
												{state.isSubmitting || createClientMutation.isPending
													? "Creando..."
													: "Crear Cliente"}
											</Button>
										)}
									</createClientForm.Subscribe>
								</form>
							</DialogContent>
						</Dialog>
					</div>
				</CardHeader>
				<CardContent>
					{/* Filters */}
					<div className="mb-6 flex gap-4">
						<div className="flex-1">
							<div className="relative">
								<Search className="absolute top-2.5 left-2 h-4 w-4 text-muted-foreground" />
								<Input
									placeholder="Buscar clientes..."
									value={searchTerm}
									onChange={(e) => setSearchTerm(e.target.value)}
									className="pl-8"
								/>
							</div>
						</div>
						<Select value={statusFilter} onValueChange={setStatusFilter}>
							<SelectTrigger className="w-[180px]">
								<Filter className="mr-2 h-4 w-4" />
								<SelectValue placeholder="Filtrar por estado" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">Todos los Estados</SelectItem>
								<SelectItem value="active">Activo</SelectItem>
								<SelectItem value="inactive">Inactivo</SelectItem>
								<SelectItem value="churned">Perdido</SelectItem>
							</SelectContent>
						</Select>
					</div>

					{clientsQuery.isPending ? (
						<div>Cargando clientes...</div>
					) : clientsQuery.error ? (
						<div className="text-red-500">
							Error al cargar clientes: {clientsQuery.error.message}
						</div>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Persona de Contacto</TableHead>
									<TableHead>Empresa</TableHead>
									<TableHead>Valor del Contrato</TableHead>
									<TableHead>Período del Contrato</TableHead>
									<TableHead>Estado</TableHead>
									<TableHead>Creado</TableHead>
									<TableHead className="text-right">Acciones</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{filteredClients.map((clientData) => (
									<TableRow key={clientData.id}>
										<TableCell>
											<div className="flex items-center gap-2">
												<User className="h-4 w-4" />
												<div className="font-medium">
													{clientData.contactPerson}
												</div>
											</div>
										</TableCell>
										<TableCell>
											{clientData.company ? (
												<div className="flex items-center gap-1">
													<Building className="h-3 w-3" />
													{clientData.company.name}
												</div>
											) : (
												<span className="text-muted-foreground">
													Sin empresa
												</span>
											)}
										</TableCell>
										<TableCell>
											{clientData.contractValue ? (
												<div className="flex items-center gap-1 font-medium text-green-600">
													<DollarSign className="h-3 w-3" />$
													{Number.parseFloat(
														clientData.contractValue,
													).toLocaleString()}
												</div>
											) : (
												<span className="text-muted-foreground">Sin valor</span>
											)}
										</TableCell>
										<TableCell>
											<div className="space-y-1">
												{clientData.startDate && (
													<div className="flex items-center gap-1 text-sm">
														<Calendar className="h-3 w-3" />
														{formatGuatemalaDate(clientData.startDate)}
													</div>
												)}
												{clientData.endDate && (
													<div className="flex items-center gap-1 text-muted-foreground text-sm">
														<Calendar className="h-3 w-3" />
														{formatGuatemalaDate(clientData.endDate)}
													</div>
												)}
												{!clientData.startDate && !clientData.endDate && (
													<span className="text-muted-foreground text-sm">
														Sin fechas establecidas
													</span>
												)}
											</div>
										</TableCell>
										<TableCell>
											<Badge
												className={getStatusBadgeColor(clientData.status)}
												variant="outline"
											>
												{getStatusLabel(clientData.status)}
											</Badge>
										</TableCell>
										<TableCell>
											<div className="flex items-center gap-1 text-sm">
												<Calendar className="h-3 w-3" />
												{formatGuatemalaDate(clientData.createdAt)}
											</div>
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
													<DropdownMenuLabel>Estado</DropdownMenuLabel>
													<DropdownMenuSeparator />
													<DropdownMenuItem
														onClick={() =>
															handleStatusChange(clientData.id, "active")
														}
														disabled={clientData.status === "active"}
													>
														Marcar como Activo
													</DropdownMenuItem>
													<DropdownMenuItem
														onClick={() =>
															handleStatusChange(clientData.id, "inactive")
														}
														disabled={clientData.status === "inactive"}
													>
														Marcar como Inactivo
													</DropdownMenuItem>
													<DropdownMenuItem
														onClick={() =>
															handleStatusChange(clientData.id, "churned")
														}
														disabled={clientData.status === "churned"}
													>
														Marcar como Perdido
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
		</div>
	);
}
