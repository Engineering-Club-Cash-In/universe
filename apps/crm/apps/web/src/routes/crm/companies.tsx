import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
	Building,
	Filter,
	Globe,
	HandshakeIcon,
	Mail,
	MapPin,
	MoreHorizontal,
	Phone,
	Plus,
	Search,
	Target,
	Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
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
import { client, orpc } from "@/utils/orpc";

export const Route = createFileRoute("/crm/companies")({
	component: RouteComponent,
});

function RouteComponent() {
	const { data: session, isPending } = authClient.useSession();
	const navigate = Route.useNavigate();
	const queryClient = useQueryClient();
	const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
	const [isDetailsDialogOpen, setIsDetailsDialogOpen] = useState(false);
	const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
	const [selectedCompany, setSelectedCompany] = useState<any>(null);
	const [searchTerm, setSearchTerm] = useState("");
	const [industryFilter, setIndustryFilter] = useState<string>("all");
	const [sizeFilter, setSizeFilter] = useState<string>("all");

	const userProfile = useQuery(orpc.getUserProfile.queryOptions());
	const companiesQuery = useQuery({
		...orpc.getCompanies.queryOptions(),
		enabled:
			!!userProfile.data?.role &&
			["admin", "sales"].includes(userProfile.data.role) &&
			!!session?.user?.id,
		queryKey: ["getCompanies", session?.user?.id, userProfile.data?.role],
	});
	const leadsQuery = useQuery({
		...orpc.getLeads.queryOptions(),
		enabled:
			!!userProfile.data?.role &&
			["admin", "sales"].includes(userProfile.data.role) &&
			!!session?.user?.id,
		queryKey: ["getLeads", session?.user?.id, userProfile.data?.role],
	});
	const opportunitiesQuery = useQuery({
		...orpc.getOpportunities.queryOptions(),
		enabled:
			!!userProfile.data?.role &&
			["admin", "sales"].includes(userProfile.data.role) &&
			!!session?.user?.id,
		queryKey: ["getOpportunities", session?.user?.id, userProfile.data?.role],
	});
	const clientsQuery = useQuery({
		...orpc.getClients.queryOptions(),
		enabled:
			!!userProfile.data?.role &&
			["admin", "sales"].includes(userProfile.data.role) &&
			!!session?.user?.id,
		queryKey: ["getClients", session?.user?.id, userProfile.data?.role],
	});

	const createCompanyForm = useForm({
		defaultValues: {
			name: "",
			industry: "",
			size: "",
			website: "",
			email: "",
			phone: "",
			address: "",
			notes: "",
		},
		validators: {
			onChange: ({ value }) => {
				if (!value.name || value.name.trim() === "") {
					return { form: "El nombre de la empresa es requerido" };
				}
				if (value.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email)) {
					return { form: "El correo electrónico no es válido" };
				}
				return undefined;
			},
		},
		onSubmit: async ({ value }) => {
			createCompanyMutation.mutate({
				...value,
				industry:
					value.industry && value.industry !== "none"
						? value.industry
						: undefined,
				size: value.size && value.size !== "none" ? value.size : undefined,
				website: value.website || undefined,
				email: value.email || undefined,
				phone: value.phone || undefined,
				address: value.address || undefined,
				notes: value.notes || undefined,
			});
		},
	});

	const editCompanyForm = useForm({
		defaultValues: {
			name: "",
			industry: "",
			size: "",
			website: "",
			email: "",
			phone: "",
			address: "",
			notes: "",
		},
		validators: {
			onChange: ({ value }) => {
				if (!value.name || value.name.trim() === "") {
					return { form: "El nombre de la empresa es requerido" };
				}
				if (value.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email)) {
					return { form: "El correo electrónico no es válido" };
				}
				return undefined;
			},
		},
		onSubmit: async ({ value }) => {
			if (selectedCompany) {
				updateCompanyMutation.mutate({
					id: selectedCompany.id,
					...value,
					industry:
						value.industry && value.industry !== "none"
							? value.industry
							: undefined,
					size: value.size && value.size !== "none" ? value.size : undefined,
					website: value.website || undefined,
					email: value.email || undefined,
					phone: value.phone || undefined,
					address: value.address || undefined,
					notes: value.notes || undefined,
				});
			}
		},
	});

	const createCompanyMutation = useMutation({
		mutationFn: (input: {
			name: string;
			industry?: string;
			size?: string;
			website?: string;
			email?: string;
			phone?: string;
			address?: string;
			notes?: string;
		}) => client.createCompany(input),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: ["getCompanies", session?.user?.id, userProfile.data?.role],
			});
			toast.success("Empresa creada exitosamente");
			setIsCreateDialogOpen(false);
			createCompanyForm.reset();
		},
		onError: (error: any) => {
			toast.error(error.message || "Error al crear la empresa");
		},
	});

	const updateCompanyMutation = useMutation({
		mutationFn: (input: {
			id: string;
			name?: string;
			industry?: string;
			size?: string;
			website?: string;
			email?: string;
			phone?: string;
			address?: string;
			notes?: string;
		}) => client.updateCompany(input),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: ["getCompanies", session?.user?.id, userProfile.data?.role],
			});
			toast.success("Empresa actualizada exitosamente");
			setIsEditDialogOpen(false);
		},
		onError: (error: any) => {
			toast.error(error.message || "Error al actualizar la empresa");
		},
	});

	const handleViewDetails = (company: any) => {
		setSelectedCompany(company);
		setIsDetailsDialogOpen(true);
	};

	const handleEditCompany = (company: any) => {
		setSelectedCompany(company);
		// Populate form with company data
		editCompanyForm.setFieldValue("name", company.name || "");
		editCompanyForm.setFieldValue("industry", company.industry || "none");
		editCompanyForm.setFieldValue("size", company.size || "none");
		editCompanyForm.setFieldValue("website", company.website || "");
		editCompanyForm.setFieldValue("email", company.email || "");
		editCompanyForm.setFieldValue("phone", company.phone || "");
		editCompanyForm.setFieldValue("address", company.address || "");
		editCompanyForm.setFieldValue("notes", company.notes || "");
		setIsEditDialogOpen(true);
	};

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

	const getSizeBadgeColor = (size: string) => {
		switch (size) {
			case "startup":
				return "bg-green-100 text-green-800";
			case "small":
				return "bg-blue-100 text-blue-800";
			case "medium":
				return "bg-yellow-100 text-yellow-800";
			case "large":
				return "bg-purple-100 text-purple-800";
			case "enterprise":
				return "bg-indigo-100 text-indigo-800";
			default:
				return "bg-gray-100 text-gray-800";
		}
	};

	const getIndustryBadgeColor = (industry: string) => {
		switch (industry) {
			case "technology":
				return "bg-blue-100 text-blue-800";
			case "finance":
				return "bg-green-100 text-green-800";
			case "healthcare":
				return "bg-red-100 text-red-800";
			case "retail":
				return "bg-orange-100 text-orange-800";
			case "manufacturing":
				return "bg-gray-100 text-gray-800";
			case "education":
				return "bg-purple-100 text-purple-800";
			case "consulting":
				return "bg-indigo-100 text-indigo-800";
			default:
				return "bg-gray-100 text-gray-800";
		}
	};

	// Get company statistics
	const getCompanyStats = (companyId: string) => {
		const leads =
			leadsQuery.data?.filter((l) => l.company?.id === companyId).length || 0;
		const opportunities =
			opportunitiesQuery.data?.filter((o) => o.company?.id === companyId)
				.length || 0;
		const clients =
			clientsQuery.data?.filter((c) => c.company?.id === companyId).length || 0;

		return { leads, opportunities, clients };
	};

	// Filter companies based on search, industry, and size
	const filteredCompanies =
		companiesQuery.data?.filter((company) => {
			const matchesSearch =
				searchTerm === "" ||
				company.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
				company.industry?.toLowerCase().includes(searchTerm.toLowerCase()) ||
				company.email?.toLowerCase().includes(searchTerm.toLowerCase());

			const matchesIndustry =
				industryFilter === "all" || company.industry === industryFilter;
			const matchesSize = sizeFilter === "all" || company.size === sizeFilter;

			return matchesSearch && matchesIndustry && matchesSize;
		}) || [];

	// Calculate company metrics
	const totalCompanies = companiesQuery.data?.length || 0;
	const techCompanies =
		companiesQuery.data?.filter((c) => c.industry === "technology").length || 0;
	const largeCompanies =
		companiesQuery.data?.filter(
			(c) => c.size === "large" || c.size === "enterprise",
		).length || 0;

	// Companies with active relationships
	const companiesWithClients =
		companiesQuery.data?.filter((company) =>
			clientsQuery.data?.some((client) => client.company?.id === company.id),
		).length || 0;

	return (
		<div className="container mx-auto space-y-6 p-6">
			<div>
				<h1 className="font-bold text-3xl">Directorio de Empresas</h1>
				<p className="text-muted-foreground">
					Gestiona tus relaciones comerciales y prospectos
				</p>
			</div>

			{/* Stats Cards */}
			<div className="grid gap-4 md:grid-cols-4">
				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="font-medium text-sm">
							Total de Empresas
						</CardTitle>
						<Building className="h-4 w-4 text-muted-foreground" />
					</CardHeader>
					<CardContent>
						<div className="font-bold text-2xl">{totalCompanies}</div>
						<p className="text-muted-foreground text-xs">En base de datos</p>
					</CardContent>
				</Card>
				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="font-medium text-sm">
							Empresas Tecnológicas
						</CardTitle>
						<Building className="h-4 w-4 text-blue-500" />
					</CardHeader>
					<CardContent>
						<div className="font-bold text-2xl">{techCompanies}</div>
						<p className="text-muted-foreground text-xs">Sector tecnológico</p>
					</CardContent>
				</Card>
				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="font-medium text-sm">
							Grandes + Corporativas
						</CardTitle>
						<Building className="h-4 w-4 text-purple-500" />
					</CardHeader>
					<CardContent>
						<div className="font-bold text-2xl">{largeCompanies}</div>
						<p className="text-muted-foreground text-xs">
							Prospectos principales
						</p>
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
						<div className="font-bold text-2xl">{companiesWithClients}</div>
						<p className="text-muted-foreground text-xs">Clientes que pagan</p>
					</CardContent>
				</Card>
			</div>

			<Card>
				<CardHeader>
					<div className="flex items-center justify-between">
						<div>
							<CardTitle>Base de Datos de Empresas</CardTitle>
							<CardDescription>
								Rastrea organizaciones y relaciones comerciales
							</CardDescription>
						</div>
						<Dialog
							open={isCreateDialogOpen}
							onOpenChange={(open) => {
								setIsCreateDialogOpen(open);
								if (!open) {
									createCompanyForm.reset();
								}
							}}
						>
							<DialogTrigger asChild>
								<Button>
									<Plus className="mr-2 h-4 w-4" />
									Agregar Empresa
								</Button>
							</DialogTrigger>
							<DialogContent className="max-w-2xl">
								<DialogHeader>
									<DialogTitle>Crear Nueva Empresa</DialogTitle>
								</DialogHeader>
								<form
									onSubmit={(e) => {
										e.preventDefault();
										e.stopPropagation();
										void createCompanyForm.handleSubmit();
									}}
									className="space-y-4"
								>
									<div>
										<createCompanyForm.Field name="name">
											{(field) => (
												<div className="space-y-2">
													<Label htmlFor={field.name}>
														Nombre de la Empresa{" "}
														<span className="text-red-500">*</span>
													</Label>
													<Input
														id={field.name}
														name={field.name}
														value={field.state.value}
														onBlur={field.handleBlur}
														onChange={(e) => field.handleChange(e.target.value)}
														placeholder="Ingresa el nombre de la empresa..."
													/>
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
										</createCompanyForm.Field>
									</div>

									<div className="grid grid-cols-2 gap-4">
										<div>
											<createCompanyForm.Field name="industry">
												{(field) => (
													<div className="space-y-2">
														<Label htmlFor={field.name}>Industria</Label>
														<Select
															value={field.state.value}
															onValueChange={(value) =>
																field.handleChange(value)
															}
														>
															<SelectTrigger>
																<SelectValue placeholder="Seleccionar industria" />
															</SelectTrigger>
															<SelectContent>
																<SelectItem value="none">
																	Sin industria
																</SelectItem>
																<SelectItem value="technology">
																	Tecnología
																</SelectItem>
																<SelectItem value="finance">
																	Finanzas
																</SelectItem>
																<SelectItem value="healthcare">
																	Salud
																</SelectItem>
																<SelectItem value="retail">
																	Venta al por menor
																</SelectItem>
																<SelectItem value="manufacturing">
																	Manufactura
																</SelectItem>
																<SelectItem value="education">
																	Educación
																</SelectItem>
																<SelectItem value="consulting">
																	Consultoría
																</SelectItem>
																<SelectItem value="other">Otro</SelectItem>
															</SelectContent>
														</Select>
													</div>
												)}
											</createCompanyForm.Field>
										</div>
										<div>
											<createCompanyForm.Field name="size">
												{(field) => (
													<div className="space-y-2">
														<Label htmlFor={field.name}>
															Tamaño de la Empresa
														</Label>
														<Select
															value={field.state.value}
															onValueChange={(value) =>
																field.handleChange(value)
															}
														>
															<SelectTrigger>
																<SelectValue placeholder="Seleccionar tamaño" />
															</SelectTrigger>
															<SelectContent>
																<SelectItem value="none">Sin tamaño</SelectItem>
																<SelectItem value="startup">
																	Startup (1-10)
																</SelectItem>
																<SelectItem value="small">
																	Pequeña (11-50)
																</SelectItem>
																<SelectItem value="medium">
																	Mediana (51-200)
																</SelectItem>
																<SelectItem value="large">
																	Grande (201-1000)
																</SelectItem>
																<SelectItem value="enterprise">
																	Corporativa (1000+)
																</SelectItem>
															</SelectContent>
														</Select>
													</div>
												)}
											</createCompanyForm.Field>
										</div>
									</div>

									<div className="grid grid-cols-2 gap-4">
										<div>
											<createCompanyForm.Field name="website">
												{(field) => (
													<div className="space-y-2">
														<Label htmlFor={field.name}>Sitio Web</Label>
														<Input
															id={field.name}
															name={field.name}
															type="url"
															value={field.state.value}
															onBlur={field.handleBlur}
															onChange={(e) =>
																field.handleChange(e.target.value)
															}
															placeholder="https://empresa.com"
														/>
													</div>
												)}
											</createCompanyForm.Field>
										</div>
										<div>
											<createCompanyForm.Field name="email">
												{(field) => (
													<div className="space-y-2">
														<Label htmlFor={field.name}>
															Correo Electrónico
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
															placeholder="contacto@empresa.com"
														/>
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
											</createCompanyForm.Field>
										</div>
									</div>

									<div className="grid grid-cols-2 gap-4">
										<div>
											<createCompanyForm.Field name="phone">
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
															placeholder="+1 (555) 123-4567"
														/>
													</div>
												)}
											</createCompanyForm.Field>
										</div>
										<div>
											<createCompanyForm.Field name="address">
												{(field) => (
													<div className="space-y-2">
														<Label htmlFor={field.name}>Dirección</Label>
														<Input
															id={field.name}
															name={field.name}
															value={field.state.value}
															onBlur={field.handleBlur}
															onChange={(e) =>
																field.handleChange(e.target.value)
															}
															placeholder="Dirección de la empresa..."
														/>
													</div>
												)}
											</createCompanyForm.Field>
										</div>
									</div>

									<div>
										<createCompanyForm.Field name="notes">
											{(field) => (
												<div className="space-y-2">
													<Label htmlFor={field.name}>Notas</Label>
													<Textarea
														id={field.name}
														name={field.name}
														value={field.state.value}
														onBlur={field.handleBlur}
														onChange={(e) => field.handleChange(e.target.value)}
														placeholder="Notas adicionales sobre esta empresa..."
														rows={3}
													/>
												</div>
											)}
										</createCompanyForm.Field>
									</div>

									<createCompanyForm.Subscribe>
										{(state) => (
											<Button
												type="submit"
												className="w-full"
												disabled={
													!state.canSubmit ||
													state.isSubmitting ||
													createCompanyMutation.isPending
												}
											>
												{state.isSubmitting || createCompanyMutation.isPending
													? "Creando..."
													: "Crear Empresa"}
											</Button>
										)}
									</createCompanyForm.Subscribe>
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
									placeholder="Buscar empresas..."
									value={searchTerm}
									onChange={(e) => setSearchTerm(e.target.value)}
									className="pl-8"
								/>
							</div>
						</div>
						<Select value={industryFilter} onValueChange={setIndustryFilter}>
							<SelectTrigger className="w-[180px]">
								<Filter className="mr-2 h-4 w-4" />
								<SelectValue placeholder="Filtrar por industria" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">Todas las Industrias</SelectItem>
								<SelectItem value="technology">Tecnología</SelectItem>
								<SelectItem value="finance">Finanzas</SelectItem>
								<SelectItem value="healthcare">Salud</SelectItem>
								<SelectItem value="retail">Venta al por menor</SelectItem>
								<SelectItem value="manufacturing">Manufactura</SelectItem>
								<SelectItem value="education">Educación</SelectItem>
								<SelectItem value="consulting">Consultoría</SelectItem>
								<SelectItem value="other">Otro</SelectItem>
							</SelectContent>
						</Select>
						<Select value={sizeFilter} onValueChange={setSizeFilter}>
							<SelectTrigger className="w-[180px]">
								<Filter className="mr-2 h-4 w-4" />
								<SelectValue placeholder="Filtrar por tamaño" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">Todos los Tamaños</SelectItem>
								<SelectItem value="startup">Startup</SelectItem>
								<SelectItem value="small">Pequeña</SelectItem>
								<SelectItem value="medium">Mediana</SelectItem>
								<SelectItem value="large">Grande</SelectItem>
								<SelectItem value="enterprise">Corporativa</SelectItem>
							</SelectContent>
						</Select>
					</div>

					{companiesQuery.isPending ? (
						<div>Cargando empresas...</div>
					) : companiesQuery.error ? (
						<div className="text-red-500">
							Error al cargar empresas: {companiesQuery.error.message}
						</div>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Empresa</TableHead>
									<TableHead>Información de Contacto</TableHead>
									<TableHead>Industria</TableHead>
									<TableHead>Tamaño</TableHead>
									<TableHead>Relaciones</TableHead>
									<TableHead className="text-right">Acciones</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{filteredCompanies.map((company) => {
									const stats = getCompanyStats(company.id);
									return (
										<TableRow key={company.id}>
											<TableCell>
												<div>
													<div className="flex items-center gap-2 font-medium">
														<Building className="h-4 w-4" />
														{company.name}
													</div>
													{company.address && (
														<div className="flex items-center gap-1 text-muted-foreground text-sm">
															<MapPin className="h-3 w-3" />
															{company.address}
														</div>
													)}
												</div>
											</TableCell>
											<TableCell>
												<div className="space-y-1">
													{company.email && (
														<div className="flex items-center gap-1 text-sm">
															<Mail className="h-3 w-3" />
															{company.email}
														</div>
													)}
													{company.phone && (
														<div className="flex items-center gap-1 text-muted-foreground text-sm">
															<Phone className="h-3 w-3" />
															{company.phone}
														</div>
													)}
													{company.website && (
														<div className="flex items-center gap-1 text-muted-foreground text-sm">
															<Globe className="h-3 w-3" />
															<a
																href={company.website}
																target="_blank"
																rel="noopener noreferrer"
																className="hover:underline"
															>
																Sitio Web
															</a>
														</div>
													)}
												</div>
											</TableCell>
											<TableCell>
												{company.industry ? (
													<Badge
														className={getIndustryBadgeColor(company.industry)}
														variant="outline"
													>
														{company.industry}
													</Badge>
												) : (
													<span className="text-muted-foreground">
														Sin industria
													</span>
												)}
											</TableCell>
											<TableCell>
												{company.size ? (
													<Badge
														className={getSizeBadgeColor(company.size)}
														variant="outline"
													>
														{company.size}
													</Badge>
												) : (
													<span className="text-muted-foreground">
														Sin tamaño
													</span>
												)}
											</TableCell>
											<TableCell>
												<div className="flex gap-2">
													{stats.leads > 0 && (
														<Badge variant="outline" className="text-xs">
															<Users className="mr-1 h-3 w-3" />
															{stats.leads} prospectos
														</Badge>
													)}
													{stats.opportunities > 0 && (
														<Badge variant="outline" className="text-xs">
															<Target className="mr-1 h-3 w-3" />
															{stats.opportunities} opor.
														</Badge>
													)}
													{stats.clients > 0 && (
														<Badge
															variant="outline"
															className="text-green-700 text-xs"
														>
															<HandshakeIcon className="mr-1 h-3 w-3" />
															{stats.clients} clientes
														</Badge>
													)}
													{stats.leads === 0 &&
														stats.opportunities === 0 &&
														stats.clients === 0 && (
															<span className="text-muted-foreground text-xs">
																Sin relaciones
															</span>
														)}
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
														<DropdownMenuLabel>Acciones</DropdownMenuLabel>
														<DropdownMenuSeparator />
														<DropdownMenuItem onClick={() => handleViewDetails(company)}>
															Ver Detalles
														</DropdownMenuItem>
														<DropdownMenuItem onClick={() => {
															navigate({ to: "/crm/leads", search: { companyId: company.id } });
														}}>
															Crear Prospecto
														</DropdownMenuItem>
														<DropdownMenuItem onClick={() => {
															navigate({ to: "/crm/opportunities", search: { companyId: company.id } });
														}}>
															Crear Oportunidad
														</DropdownMenuItem>
														{userProfile.data?.role === "admin" && (
															<>
																<DropdownMenuSeparator />
																<DropdownMenuItem onClick={() => handleEditCompany(company)}>
																	Editar Empresa
																</DropdownMenuItem>
															</>
														)}
													</DropdownMenuContent>
												</DropdownMenu>
											</TableCell>
										</TableRow>
									);
								})}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>

			{/* Details Dialog */}
			<Dialog open={isDetailsDialogOpen} onOpenChange={setIsDetailsDialogOpen}>
				<DialogContent className="min-w-2xl max-w-3xl">
					<DialogHeader>
						<DialogTitle>Detalles de la Empresa</DialogTitle>
					</DialogHeader>
					{selectedCompany && (
						<div className="space-y-6">
							<div>
								<h3 className="text-xl font-semibold">{selectedCompany.name}</h3>
								<div className="mt-2 flex gap-2">
									{selectedCompany.industry && (
										<Badge className={getIndustryBadgeColor(selectedCompany.industry)} variant="outline">
											{selectedCompany.industry}
										</Badge>
									)}
									{selectedCompany.size && (
										<Badge className={getSizeBadgeColor(selectedCompany.size)} variant="outline">
											{selectedCompany.size}
										</Badge>
									)}
								</div>
							</div>

							<div className="grid grid-cols-2 gap-4">
								{selectedCompany.email && (
									<div className="flex items-center gap-2">
										<Mail className="h-4 w-4 text-muted-foreground" />
										<span>{selectedCompany.email}</span>
									</div>
								)}
								{selectedCompany.phone && (
									<div className="flex items-center gap-2">
										<Phone className="h-4 w-4 text-muted-foreground" />
										<span>{selectedCompany.phone}</span>
									</div>
								)}
								{selectedCompany.website && (
									<div className="flex items-center gap-2">
										<Globe className="h-4 w-4 text-muted-foreground" />
										<a href={selectedCompany.website} target="_blank" rel="noopener noreferrer" className="hover:underline">
											{selectedCompany.website}
										</a>
									</div>
								)}
								{selectedCompany.address && (
									<div className="flex items-center gap-2">
										<MapPin className="h-4 w-4 text-muted-foreground" />
										<span>{selectedCompany.address}</span>
									</div>
								)}
							</div>

							{selectedCompany.notes && (
								<div>
									<Label className="font-semibold">Notas</Label>
									<p className="mt-2 text-sm text-muted-foreground">{selectedCompany.notes}</p>
								</div>
							)}

							<div className="border-t pt-4">
								<NotesTimeline
									entityType="company"
									entityId={selectedCompany.id}
									title="Timeline de Notas"
								/>
							</div>
						</div>
					)}
				</DialogContent>
			</Dialog>

			{/* Edit Dialog */}
			<Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
				<DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
					<DialogHeader>
						<DialogTitle>Editar Empresa</DialogTitle>
					</DialogHeader>
					<form
						onSubmit={(e) => {
							e.preventDefault();
							e.stopPropagation();
							void editCompanyForm.handleSubmit();
						}}
						className="space-y-4"
					>
						<div>
							<editCompanyForm.Field name="name">
								{(field) => (
									<div className="space-y-2">
										<Label htmlFor={field.name}>
											Nombre de la Empresa <span className="text-red-500">*</span>
										</Label>
										<Input
											id={field.name}
											name={field.name}
											value={field.state.value}
											onBlur={field.handleBlur}
											onChange={(e) => field.handleChange(e.target.value)}
											placeholder="Ingresa el nombre de la empresa..."
										/>
									</div>
								)}
							</editCompanyForm.Field>
						</div>

						<div className="grid grid-cols-2 gap-4">
							<div>
								<editCompanyForm.Field name="industry">
									{(field) => (
										<div className="space-y-2">
											<Label htmlFor={field.name}>Industria</Label>
											<Select
												value={field.state.value}
												onValueChange={(value) => field.handleChange(value)}
											>
												<SelectTrigger>
													<SelectValue placeholder="Seleccionar industria" />
												</SelectTrigger>
												<SelectContent>
													<SelectItem value="none">Sin industria</SelectItem>
													<SelectItem value="technology">Tecnología</SelectItem>
													<SelectItem value="finance">Finanzas</SelectItem>
													<SelectItem value="healthcare">Salud</SelectItem>
													<SelectItem value="retail">Venta al por menor</SelectItem>
													<SelectItem value="manufacturing">Manufactura</SelectItem>
													<SelectItem value="education">Educación</SelectItem>
													<SelectItem value="consulting">Consultoría</SelectItem>
													<SelectItem value="other">Otro</SelectItem>
												</SelectContent>
											</Select>
										</div>
									)}
								</editCompanyForm.Field>
							</div>
							<div>
								<editCompanyForm.Field name="size">
									{(field) => (
										<div className="space-y-2">
											<Label htmlFor={field.name}>Tamaño de la Empresa</Label>
											<Select
												value={field.state.value}
												onValueChange={(value) => field.handleChange(value)}
											>
												<SelectTrigger>
													<SelectValue placeholder="Seleccionar tamaño" />
												</SelectTrigger>
												<SelectContent>
													<SelectItem value="none">Sin tamaño</SelectItem>
													<SelectItem value="startup">Startup (1-10)</SelectItem>
													<SelectItem value="small">Pequeña (11-50)</SelectItem>
													<SelectItem value="medium">Mediana (51-200)</SelectItem>
													<SelectItem value="large">Grande (201-1000)</SelectItem>
													<SelectItem value="enterprise">Corporativa (1000+)</SelectItem>
												</SelectContent>
											</Select>
										</div>
									)}
								</editCompanyForm.Field>
							</div>
						</div>

						<div className="grid grid-cols-2 gap-4">
							<div>
								<editCompanyForm.Field name="website">
									{(field) => (
										<div className="space-y-2">
											<Label htmlFor={field.name}>Sitio Web</Label>
											<Input
												id={field.name}
												name={field.name}
												type="url"
												value={field.state.value}
												onBlur={field.handleBlur}
												onChange={(e) => field.handleChange(e.target.value)}
												placeholder="https://empresa.com"
											/>
										</div>
									)}
								</editCompanyForm.Field>
							</div>
							<div>
								<editCompanyForm.Field name="email">
									{(field) => (
										<div className="space-y-2">
											<Label htmlFor={field.name}>Correo Electrónico</Label>
											<Input
												id={field.name}
												name={field.name}
												type="email"
												value={field.state.value}
												onBlur={field.handleBlur}
												onChange={(e) => field.handleChange(e.target.value)}
												placeholder="contacto@empresa.com"
											/>
										</div>
									)}
								</editCompanyForm.Field>
							</div>
						</div>

						<div className="grid grid-cols-2 gap-4">
							<div>
								<editCompanyForm.Field name="phone">
									{(field) => (
										<div className="space-y-2">
											<Label htmlFor={field.name}>Teléfono</Label>
											<Input
												id={field.name}
												name={field.name}
												type="tel"
												value={field.state.value}
												onBlur={field.handleBlur}
												onChange={(e) => field.handleChange(e.target.value)}
												placeholder="+1 (555) 123-4567"
											/>
										</div>
									)}
								</editCompanyForm.Field>
							</div>
							<div>
								<editCompanyForm.Field name="address">
									{(field) => (
										<div className="space-y-2">
											<Label htmlFor={field.name}>Dirección</Label>
											<Input
												id={field.name}
												name={field.name}
												value={field.state.value}
												onBlur={field.handleBlur}
												onChange={(e) => field.handleChange(e.target.value)}
												placeholder="Dirección de la empresa..."
											/>
										</div>
									)}
								</editCompanyForm.Field>
							</div>
						</div>

						<div>
							<editCompanyForm.Field name="notes">
								{(field) => (
									<div className="space-y-2">
										<Label htmlFor={field.name}>Notas</Label>
										<Textarea
											id={field.name}
											name={field.name}
											value={field.state.value}
											onBlur={field.handleBlur}
											onChange={(e) => field.handleChange(e.target.value)}
											placeholder="Notas adicionales sobre esta empresa..."
											rows={3}
										/>
									</div>
								)}
							</editCompanyForm.Field>
						</div>

						<editCompanyForm.Subscribe>
							{(state) => (
								<div className="flex gap-3">
									<Button
										type="button"
										variant="outline"
										className="flex-1"
										onClick={() => setIsEditDialogOpen(false)}
									>
										Cancelar
									</Button>
									<Button
										type="submit"
										className="flex-1"
										disabled={
											!state.canSubmit ||
											state.isSubmitting ||
											updateCompanyMutation.isPending
										}
									>
										{state.isSubmitting || updateCompanyMutation.isPending
											? "Actualizando..."
											: "Actualizar Empresa"}
									</Button>
								</div>
							)}
						</editCompanyForm.Subscribe>
					</form>
				</DialogContent>
			</Dialog>
		</div>
	);
}
