import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
	Building,
	Filter,
	Mail,
	MoreHorizontal,
	Phone,
	Plus,
	Search,
	Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
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
import {
	formatGuatemalaDate,
	getSourceLabel,
	getStatusLabel,
} from "@/lib/crm-formatters";
import { client, orpc } from "@/utils/orpc";

export const Route = createFileRoute("/crm/leads")({
	component: RouteComponent,
});

function RouteComponent() {
	const { data: session, isPending } = authClient.useSession();
	const navigate = Route.useNavigate();
	const queryClient = useQueryClient();
	const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
	const [isDetailsDialogOpen, setIsDetailsDialogOpen] = useState(false);
	const [selectedLead, setSelectedLead] = useState<any>(null);
	const [searchTerm, setSearchTerm] = useState("");
	const [statusFilter, setStatusFilter] = useState<string>("all");

	const userProfile = useQuery(orpc.getUserProfile.queryOptions());
	const leadsQuery = useQuery({
		...orpc.getLeads.queryOptions(),
		enabled:
			!!userProfile.data?.role &&
			["admin", "sales"].includes(userProfile.data.role) &&
			!!session?.user?.id,
		queryKey: ["getLeads", session?.user?.id, userProfile.data?.role],
	});
	const companiesQuery = useQuery({
		...orpc.getCompanies.queryOptions(),
		enabled:
			!!userProfile.data?.role &&
			["admin", "sales"].includes(userProfile.data.role) &&
			!!session?.user?.id,
		queryKey: ["getCompanies", session?.user?.id, userProfile.data?.role],
	});

	const createLeadForm = useForm({
		defaultValues: {
			firstName: "",
			lastName: "",
			email: "",
			phone: "",
			jobTitle: "",
			companyId: "none",
			source: "website" as
				| "website"
				| "referral"
				| "cold_call"
				| "email"
				| "social_media"
				| "event"
				| "other",
			assignedTo: "",
			notes: "",
		},
		validators: {
			onSubmit: ({ value }) => {
				const errors: Record<string, string> = {};

				if (!value.firstName.trim()) {
					errors.firstName = "El nombre es requerido";
				}

				if (!value.lastName.trim()) {
					errors.lastName = "El apellido es requerido";
				}

				if (!value.email.trim()) {
					errors.email = "El correo electrónico es requerido";
				} else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email)) {
					errors.email = "El correo electrónico no es válido";
				}

				if (!value.source) {
					errors.source = "La fuente del lead es requerida";
				}

				if (Object.keys(errors).length > 0) {
					return errors;
				}

				return undefined;
			},
		},
		onSubmit: async ({ value }) => {
			createLeadMutation.mutate({
				...value,
				source: value.source,
				companyId:
					value.companyId && value.companyId !== "none"
						? value.companyId
						: undefined,
				assignedTo: value.assignedTo || undefined,
				phone: value.phone || undefined,
				jobTitle: value.jobTitle || undefined,
				notes: value.notes || undefined,
			});
		},
	});

	const createLeadMutation = useMutation({
		mutationFn: (input: {
			firstName: string;
			lastName: string;
			email: string;
			phone?: string;
			jobTitle?: string;
			companyId?: string;
			source:
				| "website"
				| "referral"
				| "cold_call"
				| "email"
				| "social_media"
				| "event"
				| "other";
			assignedTo?: string;
			notes?: string;
		}) => client.createLead(input),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: ["getLeads", session?.user?.id, userProfile.data?.role],
			});
			toast.success("Lead creado exitosamente");
			setIsCreateDialogOpen(false);
			createLeadForm.reset();
		},
		onError: (error: any) => {
			toast.error(error.message || "Error al crear el lead");
		},
	});

	const updateLeadMutation = useMutation({
		mutationFn: (input: {
			id: string;
			firstName?: string;
			lastName?: string;
			email?: string;
			phone?: string;
			jobTitle?: string;
			companyId?: string;
			source?:
				| "website"
				| "referral"
				| "cold_call"
				| "email"
				| "social_media"
				| "event"
				| "other";
			status?: "new" | "contacted" | "qualified" | "unqualified" | "converted";
			assignedTo?: string;
			notes?: string;
		}) => client.updateLead(input),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: ["getLeads", session?.user?.id, userProfile.data?.role],
			});
			toast.success("Lead actualizado exitosamente");
		},
		onError: (error: any) => {
			toast.error(error.message || "Error al actualizar el lead");
		},
	});

	useEffect(() => {
		if (!session && !isPending) {
			navigate({ to: "/login" });
		} else if (
			session &&
			userProfile.data?.role &&
			!["admin", "sales"].includes(userProfile.data.role)
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
		!["admin", "sales"].includes(userProfile.data.role)
	) {
		return null;
	}

	const getStatusBadgeColor = (status: string) => {
		switch (status) {
			case "new":
				return "bg-blue-100 text-blue-800";
			case "contacted":
				return "bg-yellow-100 text-yellow-800";
			case "qualified":
				return "bg-green-100 text-green-800";
			case "unqualified":
				return "bg-red-100 text-red-800";
			case "converted":
				return "bg-purple-100 text-purple-800";
			default:
				return "bg-gray-100 text-gray-800";
		}
	};

	const getSourceBadgeColor = (source: string) => {
		switch (source) {
			case "website":
				return "bg-indigo-100 text-indigo-800";
			case "referral":
				return "bg-green-100 text-green-800";
			case "cold_call":
				return "bg-orange-100 text-orange-800";
			case "email":
				return "bg-blue-100 text-blue-800";
			case "social_media":
				return "bg-pink-100 text-pink-800";
			case "event":
				return "bg-purple-100 text-purple-800";
			default:
				return "bg-gray-100 text-gray-800";
		}
	};

	const handleStatusChange = (leadId: string, newStatus: string) => {
		updateLeadMutation.mutate({
			id: leadId,
			status: newStatus as
				| "new"
				| "contacted"
				| "qualified"
				| "unqualified"
				| "converted",
		});
	};

	const handleLeadClick = (lead: any) => {
		setSelectedLead(lead);
		setIsDetailsDialogOpen(true);
	};

	// Filter leads based on search and status
	const filteredLeads =
		leadsQuery.data?.filter((lead) => {
			const matchesSearch =
				searchTerm === "" ||
				`${lead.firstName} ${lead.lastName}`
					.toLowerCase()
					.includes(searchTerm.toLowerCase()) ||
				lead.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
				lead.company?.name?.toLowerCase().includes(searchTerm.toLowerCase());

			const matchesStatus =
				statusFilter === "all" || lead.status === statusFilter;

			return matchesSearch && matchesStatus;
		}) || [];

	return (
		<div className="container mx-auto space-y-6 p-6">
			<div>
				<h1 className="font-bold text-3xl">Gestión de Leads</h1>
				<p className="text-muted-foreground">
					{userProfile.data.role === "admin"
						? "Gestionar todos los leads del sistema"
						: "Gestionar tus leads asignados"}
				</p>
			</div>

			{/* Stats Cards */}
			<div className="grid gap-4 md:grid-cols-4">
				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="font-medium text-sm">
							Total de Leads
						</CardTitle>
						<Users className="h-4 w-4 text-muted-foreground" />
					</CardHeader>
					<CardContent>
						<div className="font-bold text-2xl">
							{leadsQuery.data?.length || 0}
						</div>
					</CardContent>
				</Card>
				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="font-medium text-sm">Leads Nuevos</CardTitle>
						<Users className="h-4 w-4 text-blue-500" />
					</CardHeader>
					<CardContent>
						<div className="font-bold text-2xl">
							{leadsQuery.data?.filter((l) => l.status === "new").length || 0}
						</div>
					</CardContent>
				</Card>
				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="font-medium text-sm">Calificados</CardTitle>
						<Users className="h-4 w-4 text-green-500" />
					</CardHeader>
					<CardContent>
						<div className="font-bold text-2xl">
							{leadsQuery.data?.filter((l) => l.status === "qualified")
								.length || 0}
						</div>
					</CardContent>
				</Card>
				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="font-medium text-sm">Convertidos</CardTitle>
						<Users className="h-4 w-4 text-purple-500" />
					</CardHeader>
					<CardContent>
						<div className="font-bold text-2xl">
							{leadsQuery.data?.filter((l) => l.status === "converted")
								.length || 0}
						</div>
					</CardContent>
				</Card>
			</div>

			<Card>
				<CardHeader>
					<div className="flex items-center justify-between">
						<div>
							<CardTitle>Base de Datos de Leads</CardTitle>
							<CardDescription>
								Ver y gestionar tus leads de ventas
							</CardDescription>
						</div>
						<Dialog
							open={isCreateDialogOpen}
							onOpenChange={(open) => {
								setIsCreateDialogOpen(open);
								if (!open) {
									createLeadForm.reset();
								}
							}}
						>
							<DialogTrigger asChild>
								<Button>
									<Plus className="mr-2 h-4 w-4" />
									Agregar Lead
								</Button>
							</DialogTrigger>
							<DialogContent className="max-w-2xl">
								<DialogHeader>
									<DialogTitle>Crear Nuevo Lead</DialogTitle>
								</DialogHeader>
								<form
									onSubmit={(e) => {
										e.preventDefault();
										e.stopPropagation();
										void createLeadForm.handleSubmit();
									}}
									className="space-y-4"
								>
									<div className="grid grid-cols-2 gap-4">
										<div>
											<createLeadForm.Field
												name="firstName"
												validators={{
													onChange: ({ value }) => {
														if (!value.trim()) {
															return "El nombre es requerido";
														}
														return undefined;
													},
													onBlur: ({ value }) => {
														if (!value.trim()) {
															return "El nombre es requerido";
														}
														return undefined;
													},
												}}
											>
												{(field) => (
													<div className="space-y-2">
														<Label htmlFor={field.name}>
															Nombre <span className="text-red-500">*</span>
														</Label>
														<Input
															id={field.name}
															name={field.name}
															value={field.state.value}
															onBlur={field.handleBlur}
															onChange={(e) =>
																field.handleChange(e.target.value)
															}
															className={
																field.state.meta.errors.length > 0
																	? "border-red-500"
																	: ""
															}
														/>
														{field.state.meta.errors.map((error, index) => (
															<p key={index} className="text-red-500 text-sm">
																{String(error)}
															</p>
														))}
													</div>
												)}
											</createLeadForm.Field>
										</div>
										<div>
											<createLeadForm.Field
												name="lastName"
												validators={{
													onChange: ({ value }) => {
														if (!value.trim()) {
															return "El apellido es requerido";
														}
														return undefined;
													},
													onBlur: ({ value }) => {
														if (!value.trim()) {
															return "El apellido es requerido";
														}
														return undefined;
													},
												}}
											>
												{(field) => (
													<div className="space-y-2">
														<Label htmlFor={field.name}>
															Apellido <span className="text-red-500">*</span>
														</Label>
														<Input
															id={field.name}
															name={field.name}
															value={field.state.value}
															onBlur={field.handleBlur}
															onChange={(e) =>
																field.handleChange(e.target.value)
															}
															className={
																field.state.meta.errors.length > 0
																	? "border-red-500"
																	: ""
															}
														/>
														{field.state.meta.errors.map((error, index) => (
															<p key={index} className="text-red-500 text-sm">
																{String(error)}
															</p>
														))}
													</div>
												)}
											</createLeadForm.Field>
										</div>
									</div>

									<div className="grid grid-cols-2 gap-4">
										<div>
											<createLeadForm.Field
												name="email"
												validators={{
													onChange: ({ value }) => {
														if (!value.trim()) {
															return "El correo electrónico es requerido";
														}
														if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
															return "El correo electrónico no es válido";
														}
														return undefined;
													},
													onBlur: ({ value }) => {
														if (!value.trim()) {
															return "El correo electrónico es requerido";
														}
														if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
															return "El correo electrónico no es válido";
														}
														return undefined;
													},
												}}
											>
												{(field) => (
													<div className="space-y-2">
														<Label htmlFor={field.name}>
															Correo Electrónico{" "}
															<span className="text-red-500">*</span>
														</Label>
														<Input
															id={field.name}
															name={field.name}
															type="email"
															value={field.state.value}
															onBlur={field.handleBlur}
															onChange={(e) =>
																field.handleChange(e.target.value)
															}
															className={
																field.state.meta.errors.length > 0
																	? "border-red-500"
																	: ""
															}
														/>
														{field.state.meta.errors.map((error, index) => (
															<p key={index} className="text-red-500 text-sm">
																{String(error)}
															</p>
														))}
													</div>
												)}
											</createLeadForm.Field>
										</div>
										<div>
											<createLeadForm.Field name="phone">
												{(field) => (
													<div className="space-y-2">
														<Label htmlFor={field.name}>Teléfono</Label>
														<Input
															id={field.name}
															name={field.name}
															type="tel"
															value={field.state.value}
															onBlur={field.handleBlur}
															onChange={(e) =>
																field.handleChange(e.target.value)
															}
														/>
													</div>
												)}
											</createLeadForm.Field>
										</div>
									</div>

									<div className="grid grid-cols-2 gap-4">
										<div>
											<createLeadForm.Field name="jobTitle">
												{(field) => (
													<div className="space-y-2">
														<Label htmlFor={field.name}>Cargo</Label>
														<Input
															id={field.name}
															name={field.name}
															value={field.state.value}
															onBlur={field.handleBlur}
															onChange={(e) =>
																field.handleChange(e.target.value)
															}
														/>
													</div>
												)}
											</createLeadForm.Field>
										</div>
										<div>
											<createLeadForm.Field name="companyId">
												{(field) => (
													<div className="space-y-2">
														<Label htmlFor={field.name}>Empresa</Label>
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
																<SelectItem value="none">
																	Sin empresa
																</SelectItem>
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
											</createLeadForm.Field>
										</div>
									</div>

									<div>
										<createLeadForm.Field
											name="source"
											validators={{
												onChange: ({ value }) => {
													if (!value) {
														return "La fuente del lead es requerida";
													}
													return undefined;
												},
												onBlur: ({ value }) => {
													if (!value) {
														return "La fuente del lead es requerida";
													}
													return undefined;
												},
											}}
										>
											{(field) => (
												<div className="space-y-2">
													<Label htmlFor={field.name}>
														Fuente del Lead{" "}
														<span className="text-red-500">*</span>
													</Label>
													<Select
														value={field.state.value}
														onValueChange={(value) =>
															field.handleChange(
																value as
																	| "website"
																	| "referral"
																	| "cold_call"
																	| "email"
																	| "social_media"
																	| "event"
																	| "other",
															)
														}
													>
														<SelectTrigger
															className={
																field.state.meta.errors.length > 0
																	? "border-red-500"
																	: ""
															}
														>
															<SelectValue placeholder="Seleccionar fuente" />
														</SelectTrigger>
														<SelectContent>
															<SelectItem value="website">Sitio Web</SelectItem>
															<SelectItem value="referral">
																Referencia
															</SelectItem>
															<SelectItem value="cold_call">
																Llamada en Frío
															</SelectItem>
															<SelectItem value="email">
																Correo Electrónico
															</SelectItem>
															<SelectItem value="social_media">
																Redes Sociales
															</SelectItem>
															<SelectItem value="event">Evento</SelectItem>
															<SelectItem value="other">Otro</SelectItem>
														</SelectContent>
													</Select>
													{field.state.meta.errors.map((error) => (
														<p
															key={String(error)}
															className="text-red-500 text-sm"
														>
															{String(error)}
														</p>
													))}
												</div>
											)}
										</createLeadForm.Field>
									</div>

									<div>
										<createLeadForm.Field name="notes">
											{(field) => (
												<div className="space-y-2">
													<Label htmlFor={field.name}>Notas</Label>
													<Input
														id={field.name}
														name={field.name}
														value={field.state.value}
														onBlur={field.handleBlur}
														onChange={(e) => field.handleChange(e.target.value)}
														placeholder="Notas adicionales sobre este lead..."
													/>
												</div>
											)}
										</createLeadForm.Field>
									</div>

									<createLeadForm.Subscribe>
										{(state) => (
											<Button
												type="submit"
												className="w-full"
												disabled={
													!state.canSubmit ||
													state.isSubmitting ||
													createLeadMutation.isPending
												}
											>
												{state.isSubmitting || createLeadMutation.isPending
													? "Creando..."
													: "Crear Lead"}
											</Button>
										)}
									</createLeadForm.Subscribe>
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
									placeholder="Buscar leads..."
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
								<SelectItem value="new">Nuevo</SelectItem>
								<SelectItem value="contacted">Contactado</SelectItem>
								<SelectItem value="qualified">Calificado</SelectItem>
								<SelectItem value="unqualified">No Calificado</SelectItem>
								<SelectItem value="converted">Convertido</SelectItem>
							</SelectContent>
						</Select>
					</div>

					{leadsQuery.isPending ? (
						<div>Cargando leads...</div>
					) : leadsQuery.error ? (
						<div className="text-red-500">
							Error al cargar leads: {leadsQuery.error.message}
						</div>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Nombre</TableHead>
									<TableHead>Contacto</TableHead>
									<TableHead>Empresa</TableHead>
									<TableHead>Fuente</TableHead>
									<TableHead>Estado</TableHead>
									<TableHead>Creado</TableHead>
									<TableHead className="text-right">Acciones</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{filteredLeads.map((lead) => (
									<TableRow key={lead.id}>
										<TableCell>
											<div>
												<div 
													className="font-medium text-primary hover:underline cursor-pointer"
													onClick={() => handleLeadClick(lead)}
												>
													{lead.firstName} {lead.lastName}
												</div>
												{lead.jobTitle && (
													<div className="text-muted-foreground text-sm">
														{lead.jobTitle}
													</div>
												)}
											</div>
										</TableCell>
										<TableCell>
											<div className="space-y-1">
												<div className="flex items-center gap-1 text-sm">
													<Mail className="h-3 w-3" />
													{lead.email}
												</div>
												{lead.phone && (
													<div className="flex items-center gap-1 text-muted-foreground text-sm">
														<Phone className="h-3 w-3" />
														{lead.phone}
													</div>
												)}
											</div>
										</TableCell>
										<TableCell>
											{lead.company ? (
												<div className="flex items-center gap-1">
													<Building className="h-3 w-3" />
													{lead.company.name}
												</div>
											) : (
												<span className="text-muted-foreground">
													Sin empresa
												</span>
											)}
										</TableCell>
										<TableCell>
											<Badge
												className={getSourceBadgeColor(lead.source)}
												variant="outline"
											>
												{getSourceLabel(lead.source)}
											</Badge>
										</TableCell>
										<TableCell>
											<Badge
												className={getStatusBadgeColor(lead.status)}
												variant="outline"
											>
												{getStatusLabel(lead.status)}
											</Badge>
										</TableCell>
										<TableCell>{formatGuatemalaDate(lead.createdAt)}</TableCell>
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
															handleStatusChange(lead.id, "contacted")
														}
														disabled={lead.status === "contacted"}
													>
														Marcar como Contactado
													</DropdownMenuItem>
													<DropdownMenuItem
														onClick={() =>
															handleStatusChange(lead.id, "qualified")
														}
														disabled={lead.status === "qualified"}
													>
														Marcar como Calificado
													</DropdownMenuItem>
													<DropdownMenuItem
														onClick={() =>
															handleStatusChange(lead.id, "unqualified")
														}
														disabled={lead.status === "unqualified"}
													>
														Marcar como No Calificado
													</DropdownMenuItem>
													<DropdownMenuSeparator />
													<DropdownMenuItem
														onClick={() =>
															handleStatusChange(lead.id, "converted")
														}
														disabled={lead.status === "converted"}
													>
														Convertir a Oportunidad
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

			{/* Lead Details Dialog */}
			<Dialog open={isDetailsDialogOpen} onOpenChange={setIsDetailsDialogOpen}>
				<DialogContent className="max-w-2xl">
					<DialogHeader>
						<DialogTitle>Detalles del Lead</DialogTitle>
					</DialogHeader>
					{selectedLead && (
						<div className="space-y-6">
							{/* Personal Information */}
							<div className="space-y-4">
								<h3 className="font-semibold text-lg">Información Personal</h3>
								<div className="grid grid-cols-2 gap-4">
									<div>
										<Label className="text-sm font-medium">Nombre</Label>
										<p className="text-sm">{selectedLead.firstName} {selectedLead.lastName}</p>
									</div>
									<div>
										<Label className="text-sm font-medium">Cargo</Label>
										<p className="text-sm">{selectedLead.jobTitle || "No especificado"}</p>
									</div>
								</div>
							</div>

							{/* Contact Information */}
							<div className="space-y-4">
								<h3 className="font-semibold text-lg">Información de Contacto</h3>
								<div className="space-y-3">
									<div>
										<Label className="text-sm font-medium">Correo Electrónico</Label>
										<p className="text-sm">{selectedLead.email}</p>
									</div>
									<div>
										<Label className="text-sm font-medium">Teléfono</Label>
										<div className="flex items-center gap-2">
											<Phone className="h-4 w-4" />
											<p className="text-sm">{selectedLead.phone || "No especificado"}</p>
										</div>
									</div>
								</div>
							</div>

							{/* Company Information */}
							<div className="space-y-4">
								<h3 className="font-semibold text-lg">Información de la Empresa</h3>
								<div>
									<Label className="text-sm font-medium">Empresa</Label>
									<div className="flex items-center gap-2">
										<Building className="h-4 w-4" />
										<p className="text-sm">{selectedLead.company?.name || "Sin empresa"}</p>
									</div>
								</div>
							</div>

							{/* Lead Status */}
							<div className="space-y-4">
								<h3 className="font-semibold text-lg">Estado del Lead</h3>
								<div className="grid grid-cols-2 gap-4">
									<div>
										<Label className="text-sm font-medium">Fuente</Label>
										<Badge className={getSourceBadgeColor(selectedLead.source)} variant="outline">
											{getSourceLabel(selectedLead.source)}
										</Badge>
									</div>
									<div>
										<Label className="text-sm font-medium">Estado</Label>
										<Badge className={getStatusBadgeColor(selectedLead.status)} variant="outline">
											{getStatusLabel(selectedLead.status)}
										</Badge>
									</div>
								</div>
							</div>

							{/* Additional Information */}
							<div className="space-y-4">
								<h3 className="font-semibold text-lg">Información Adicional</h3>
								<div className="grid grid-cols-2 gap-4">
									<div>
										<Label className="text-sm font-medium">Asignado a</Label>
										<p className="text-sm">{selectedLead.assignedUser?.name || "No asignado"}</p>
									</div>
									<div>
										<Label className="text-sm font-medium">Fecha de Creación</Label>
										<p className="text-sm">{formatGuatemalaDate(selectedLead.createdAt)}</p>
									</div>
								</div>
								{selectedLead.notes && (
									<div>
										<Label className="text-sm font-medium">Notas</Label>
										<p className="text-sm bg-muted p-3 rounded-md">{selectedLead.notes}</p>
									</div>
								)}
							</div>
						</div>
					)}
				</DialogContent>
			</Dialog>
		</div>
	);
}
