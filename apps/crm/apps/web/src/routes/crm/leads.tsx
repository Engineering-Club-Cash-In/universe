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
import { PERMISSIONS } from "server/src/types/roles";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
	formatCurrency,
	formatGuatemalaDate,
	getLoanPurposeLabel,
	getMaritalStatusLabel,
	getOccupationLabel,
	getSourceLabel,
	getStatusLabel,
	getWorkTimeLabel,
} from "@/lib/crm-formatters";
import { client, orpc } from "@/utils/orpc";

export const Route = createFileRoute("/crm/leads")({
	component: RouteComponent,
});

// Type aliases for better type safety
type CreateLeadInput = Parameters<typeof client.createLead>[0];
type UpdateLeadInput = Parameters<typeof client.updateLead>[0];
type Lead = Awaited<ReturnType<typeof client.getLeads>>[0] & {
	score?: string | null;
	fit?: boolean | null;
	scoredAt?: Date | null;
};
type CreditAnalysis = Awaited<ReturnType<typeof client.getCreditAnalysisByLeadId>>;

function RouteComponent() {
	const { data: session, isPending } = authClient.useSession();
	const navigate = Route.useNavigate();
	const queryClient = useQueryClient();
	const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
	const [isDetailsDialogOpen, setIsDetailsDialogOpen] = useState(false);
	const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
	const [searchTerm, setSearchTerm] = useState("");
	const [statusFilter, setStatusFilter] = useState<string>("all");

	const userProfile = useQuery(orpc.getUserProfile.queryOptions());
	const leadsQuery = useQuery({
		...orpc.getLeads.queryOptions(),
		enabled:
			!!userProfile.data?.role &&
			PERMISSIONS.canAccessCRM(userProfile.data.role) &&
			!!session?.user?.id,
		queryKey: ["getLeads", session?.user?.id, userProfile.data?.role],
	});
	const companiesQuery = useQuery({
		...orpc.getCompanies.queryOptions(),
		enabled:
			!!userProfile.data?.role &&
			PERMISSIONS.canAccessCRM(userProfile.data.role) &&
			!!session?.user?.id,
		queryKey: ["getCompanies", session?.user?.id, userProfile.data?.role],
	});
	const creditAnalysisQuery = useQuery({
		queryKey: ["getCreditAnalysisByLeadId", selectedLead?.id],
		queryFn: selectedLead?.id 
			? () => client.getCreditAnalysisByLeadId({ leadId: selectedLead.id })
			: () => Promise.resolve(null),
		enabled: !!selectedLead?.id && isDetailsDialogOpen,
	});

	const createLeadForm = useForm({
		defaultValues: {
			firstName: "",
			lastName: "",
			email: "",
			phone: "",
			age: "",
			dpi: "",
			maritalStatus: "single" as "single" | "married" | "divorced" | "widowed",
			dependents: "0",
			monthlyIncome: "",
			loanAmount: "",
			occupation: "employee" as "owner" | "employee",
			workTime: "1_to_5" as "1_to_5" | "5_to_10" | "10_plus",
			loanPurpose: "personal" as "personal" | "business",
			ownsHome: false,
			ownsVehicle: false,
			hasCreditCard: false,
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
				age: value.age ? Number.parseInt(value.age) : undefined,
				dependents: Number.parseInt(value.dependents),
				monthlyIncome: value.monthlyIncome
					? Number.parseFloat(value.monthlyIncome)
					: undefined,
				loanAmount: value.loanAmount
					? Number.parseFloat(value.loanAmount)
					: undefined,
				maritalStatus: value.maritalStatus || undefined,
				occupation: value.occupation || undefined,
				workTime: value.workTime || undefined,
				loanPurpose: value.loanPurpose || undefined,
				dpi: value.dpi || undefined,
				source: value.source,
				companyId:
					value.companyId && value.companyId !== "none"
						? value.companyId
						: undefined,
				assignedTo: value.assignedTo || undefined,
				jobTitle: value.jobTitle || undefined,
				notes: value.notes || undefined,
			});
		},
	});

	const createLeadMutation = useMutation({
		mutationFn: (input: CreateLeadInput) => client.createLead(input),
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
		mutationFn: (input: UpdateLeadInput) => client.updateLead(input),
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

	const handleLeadClick = (lead: Lead) => {
		setSelectedLead(lead);
		setIsDetailsDialogOpen(true);
	};

	// Filter leads based on search and status
	const filteredLeads =
		(leadsQuery.data as Lead[] | undefined)?.filter((lead) => {
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
							<DialogContent className="max-h-[90vh] min-w-[800px] max-w-4xl overflow-y-auto">
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
											<createLeadForm.Field
												name="phone"
												validators={{
													onChange: ({ value }) => {
														if (!value.trim()) {
															return "El teléfono es requerido";
														}
														return undefined;
													},
													onBlur: ({ value }) => {
														if (!value.trim()) {
															return "El teléfono es requerido";
														}
														return undefined;
													},
												}}
											>
												{(field) => (
													<div className="space-y-2">
														<Label htmlFor={field.name}>
															Teléfono <span className="text-red-500">*</span>
														</Label>
														<Input
															id={field.name}
															name={field.name}
															type="tel"
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

									{/* Personal Information */}
									<div className="space-y-4">
										<h3 className="font-semibold text-lg">
											Información Personal
										</h3>
										<div className="grid grid-cols-2 gap-4">
											<div>
												<createLeadForm.Field name="age">
													{(field) => (
														<div className="space-y-2">
															<Label htmlFor={field.name}>Edad</Label>
															<Input
																id={field.name}
																name={field.name}
																type="number"
																value={field.state.value}
																onBlur={field.handleBlur}
																onChange={(e) =>
																	field.handleChange(e.target.value)
																}
																min="18"
																max="100"
															/>
														</div>
													)}
												</createLeadForm.Field>
											</div>
											<div>
												<createLeadForm.Field name="dpi">
													{(field) => (
														<div className="space-y-2">
															<Label htmlFor={field.name}>DPI</Label>
															<Input
																id={field.name}
																name={field.name}
																value={field.state.value}
																onBlur={field.handleBlur}
																onChange={(e) =>
																	field.handleChange(e.target.value)
																}
																placeholder="0000 00000 0000"
															/>
														</div>
													)}
												</createLeadForm.Field>
											</div>
										</div>
										<div className="grid grid-cols-2 gap-4">
											<div>
												<createLeadForm.Field name="maritalStatus">
													{(field) => (
														<div className="space-y-2">
															<Label htmlFor={field.name}>Estado Civil</Label>
															<Select
																value={field.state.value}
																onValueChange={(value) =>
																	field.handleChange(
																		value as
																			| "single"
																			| "married"
																			| "divorced"
																			| "widowed",
																	)
																}
															>
																<SelectTrigger>
																	<SelectValue placeholder="Seleccionar estado civil" />
																</SelectTrigger>
																<SelectContent>
																	<SelectItem value="single">
																		Soltero/a
																	</SelectItem>
																	<SelectItem value="married">
																		Casado/a
																	</SelectItem>
																	<SelectItem value="divorced">
																		Divorciado/a
																	</SelectItem>
																	<SelectItem value="widowed">
																		Viudo/a
																	</SelectItem>
																</SelectContent>
															</Select>
														</div>
													)}
												</createLeadForm.Field>
											</div>
											<div>
												<createLeadForm.Field name="dependents">
													{(field) => (
														<div className="space-y-2">
															<Label htmlFor={field.name}>
																Dependientes Económicos
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
																min="0"
																max="20"
															/>
														</div>
													)}
												</createLeadForm.Field>
											</div>
										</div>
									</div>

									{/* Financial Information */}
									<div className="space-y-4">
										<h3 className="font-semibold text-lg">
											Información Financiera
										</h3>
										<div className="grid grid-cols-2 gap-4">
											<div>
												<createLeadForm.Field name="monthlyIncome">
													{(field) => (
														<div className="space-y-2">
															<Label htmlFor={field.name}>
																Ingreso Mensual
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
																step="0.01"
																min="0"
															/>
														</div>
													)}
												</createLeadForm.Field>
											</div>
											<div>
												<createLeadForm.Field name="loanAmount">
													{(field) => (
														<div className="space-y-2">
															<Label htmlFor={field.name}>
																Monto a Financiar
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
																step="0.01"
																min="0"
															/>
														</div>
													)}
												</createLeadForm.Field>
											</div>
										</div>
										<div className="grid grid-cols-2 gap-4">
											<div>
												<createLeadForm.Field name="occupation">
													{(field) => (
														<div className="space-y-2">
															<Label htmlFor={field.name}>Ocupación</Label>
															<Select
																value={field.state.value}
																onValueChange={(value) =>
																	field.handleChange(
																		value as "owner" | "employee",
																	)
																}
															>
																<SelectTrigger>
																	<SelectValue placeholder="Seleccionar ocupación" />
																</SelectTrigger>
																<SelectContent>
																	<SelectItem value="owner">Dueño</SelectItem>
																	<SelectItem value="employee">
																		Empleado
																	</SelectItem>
																</SelectContent>
															</Select>
														</div>
													)}
												</createLeadForm.Field>
											</div>
											<div>
												<createLeadForm.Field name="workTime">
													{(field) => (
														<div className="space-y-2">
															<Label htmlFor={field.name}>
																Tiempo en el Trabajo
															</Label>
															<Select
																value={field.state.value}
																onValueChange={(value) =>
																	field.handleChange(
																		value as "1_to_5" | "5_to_10" | "10_plus",
																	)
																}
															>
																<SelectTrigger>
																	<SelectValue placeholder="Seleccionar tiempo" />
																</SelectTrigger>
																<SelectContent>
																	<SelectItem value="1_to_5">
																		1 a 5 años
																	</SelectItem>
																	<SelectItem value="5_to_10">
																		5 a 10 años
																	</SelectItem>
																	<SelectItem value="10_plus">
																		Más de 10 años
																	</SelectItem>
																</SelectContent>
															</Select>
														</div>
													)}
												</createLeadForm.Field>
											</div>
										</div>
										<div>
											<createLeadForm.Field name="loanPurpose">
												{(field) => (
													<div className="space-y-2">
														<Label htmlFor={field.name}>
															Propósito del Préstamo
														</Label>
														<Select
															value={field.state.value}
															onValueChange={(value) =>
																field.handleChange(
																	value as "personal" | "business",
																)
															}
														>
															<SelectTrigger>
																<SelectValue placeholder="Seleccionar propósito" />
															</SelectTrigger>
															<SelectContent>
																<SelectItem value="personal">
																	Personal
																</SelectItem>
																<SelectItem value="business">
																	Negocio
																</SelectItem>
															</SelectContent>
														</Select>
													</div>
												)}
											</createLeadForm.Field>
										</div>
									</div>

									{/* Assets */}
									<div className="space-y-4">
										<h3 className="font-semibold text-lg">Activos</h3>
										<div className="space-y-3">
											<createLeadForm.Field name="ownsHome">
												{(field) => (
													<div className="flex items-center space-x-2">
														<Checkbox
															id={field.name}
															checked={field.state.value}
															onCheckedChange={(checked) =>
																field.handleChange(checked as boolean)
															}
														/>
														<Label htmlFor={field.name}>
															Posee Casa Propia
														</Label>
													</div>
												)}
											</createLeadForm.Field>
											<createLeadForm.Field name="ownsVehicle">
												{(field) => (
													<div className="flex items-center space-x-2">
														<Checkbox
															id={field.name}
															checked={field.state.value}
															onCheckedChange={(checked) =>
																field.handleChange(checked as boolean)
															}
														/>
														<Label htmlFor={field.name}>
															Posee Vehículo Propio
														</Label>
													</div>
												)}
											</createLeadForm.Field>
											<createLeadForm.Field name="hasCreditCard">
												{(field) => (
													<div className="flex items-center space-x-2">
														<Checkbox
															id={field.name}
															checked={field.state.value}
															onCheckedChange={(checked) =>
																field.handleChange(checked as boolean)
															}
														/>
														<Label htmlFor={field.name}>
															Tiene Tarjeta de Crédito
														</Label>
													</div>
												)}
											</createLeadForm.Field>
										</div>
									</div>

									<div>
										<createLeadForm.Field name="notes">
											{(field) => (
												<div className="space-y-2">
													<Label htmlFor={field.name}>Notas</Label>
													<Textarea
														id={field.name}
														name={field.name}
														value={field.state.value}
														onBlur={field.handleBlur}
														onChange={(e) => field.handleChange(e.target.value)}
														placeholder="Notas adicionales sobre este lead..."
														rows={3}
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
									<TableHead>Score</TableHead>
									<TableHead>Pre Aprobación</TableHead>
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
													className="cursor-pointer font-medium text-primary hover:underline"
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
										<TableCell>
											{lead.score ? (
												<Badge
													variant="outline"
													className={
														Number(lead.score) >= 0.7
															? "border-green-500 text-green-600"
															: Number(lead.score) >= 0.4
																? "border-yellow-500 text-yellow-600"
																: "border-red-500 text-red-600"
													}
												>
													{(Number(lead.score) * 100).toFixed(0)}%
												</Badge>
											) : (
												<span className="text-muted-foreground">-</span>
											)}
										</TableCell>
										<TableCell>
											{lead.score ? (
												<Badge
													variant={lead.fit ? "default" : "secondary"}
													className={
														lead.fit ? "bg-green-500 hover:bg-green-600" : ""
													}
												>
													{lead.fit ? "Preaprobado" : "No Preaprobado"}
												</Badge>
											) : (
												<span className="text-muted-foreground">-</span>
											)}
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
				<DialogContent className="max-h-[85vh] min-w-[900px] max-w-6xl overflow-y-auto">
					<DialogHeader>
						<DialogTitle>Detalles del Lead</DialogTitle>
					</DialogHeader>
					{selectedLead && (
						<div className="space-y-6">
							{/* Top Section - Personal & Contact Info */}
							<div className="grid grid-cols-2 gap-6">
								{/* Personal Information */}
								<div className="space-y-4">
									<h3 className="font-semibold text-lg">Información Personal</h3>
									<div className="grid grid-cols-2 gap-4">
										<div>
											<Label className="font-medium text-sm text-muted-foreground">Nombre</Label>
											<p className="text-sm font-medium">
												{selectedLead.firstName} {selectedLead.lastName}
											</p>
										</div>
										<div>
											<Label className="font-medium text-sm text-muted-foreground">DPI</Label>
											<p className="text-sm">
												{selectedLead.dpi || "No especificado"}
											</p>
										</div>
										<div>
											<Label className="font-medium text-sm text-muted-foreground">Edad</Label>
											<p className="text-sm">
												{selectedLead.age || "No especificado"}
											</p>
										</div>
										<div>
											<Label className="font-medium text-sm text-muted-foreground">Estado Civil</Label>
											<p className="text-sm">
												{selectedLead.maritalStatus
													? getMaritalStatusLabel(selectedLead.maritalStatus)
													: "No especificado"}
											</p>
										</div>
										<div>
											<Label className="font-medium text-sm text-muted-foreground">
												Dependientes
											</Label>
											<p className="text-sm">{selectedLead.dependents || 0}</p>
										</div>
										<div>
											<Label className="font-medium text-sm text-muted-foreground">Cargo</Label>
											<p className="text-sm">
												{selectedLead.jobTitle || "No especificado"}
											</p>
										</div>
									</div>
								</div>

								{/* Contact Information */}
								<div className="space-y-4">
									<h3 className="font-semibold text-lg">
										Información de Contacto
									</h3>
									<div className="space-y-3">
										<div>
											<Label className="font-medium text-sm text-muted-foreground">
												Correo Electrónico
											</Label>
											<div className="flex items-center gap-2">
												<Mail className="h-4 w-4 text-muted-foreground" />
												<p className="text-sm">{selectedLead.email}</p>
											</div>
										</div>
										<div>
											<Label className="font-medium text-sm text-muted-foreground">Teléfono</Label>
											<div className="flex items-center gap-2">
												<Phone className="h-4 w-4 text-muted-foreground" />
												<p className="text-sm">
													{selectedLead.phone || "No especificado"}
												</p>
											</div>
										</div>
										<div>
											<Label className="font-medium text-sm text-muted-foreground">Empresa</Label>
											<div className="flex items-center gap-2">
												<Building className="h-4 w-4 text-muted-foreground" />
												<p className="text-sm">
													{selectedLead.company?.name || "Sin empresa"}
												</p>
											</div>
										</div>
									</div>
								</div>
							</div>

							{/* Middle Section - Financial & Work Info */}
							<div className="grid grid-cols-2 gap-6">
								{/* Financial Information */}
								<div className="space-y-4">
									<h3 className="font-semibold text-lg">Información Financiera</h3>
									<div className="grid grid-cols-2 gap-4">
										<div>
											<Label className="font-medium text-sm text-muted-foreground">
												Ingreso Mensual
											</Label>
											<p className="text-sm font-medium">
												{selectedLead.monthlyIncome
													? formatCurrency(selectedLead.monthlyIncome)
													: "No especificado"}
											</p>
										</div>
										<div>
											<Label className="font-medium text-sm text-muted-foreground">
												Monto a Financiar
											</Label>
											<p className="text-sm font-medium">
												{selectedLead.loanAmount
													? formatCurrency(selectedLead.loanAmount)
													: "No especificado"}
											</p>
										</div>
										<div>
											<Label className="font-medium text-sm text-muted-foreground">
												Propósito del Préstamo
											</Label>
											<p className="text-sm">
												{selectedLead.loanPurpose
													? getLoanPurposeLabel(selectedLead.loanPurpose)
													: "No especificado"}
											</p>
										</div>
									</div>
								</div>

								{/* Work Information */}
								<div className="space-y-4">
									<h3 className="font-semibold text-lg">Información Laboral</h3>
									<div className="grid grid-cols-2 gap-4">
										<div>
											<Label className="font-medium text-sm text-muted-foreground">Ocupación</Label>
											<p className="text-sm">
												{selectedLead.occupation
													? getOccupationLabel(selectedLead.occupation)
													: "No especificado"}
											</p>
										</div>
										<div>
											<Label className="font-medium text-sm text-muted-foreground">
												Tiempo en el Trabajo
											</Label>
											<p className="text-sm">
												{selectedLead.workTime
													? getWorkTimeLabel(selectedLead.workTime)
													: "No especificado"}
											</p>
										</div>
									</div>
								</div>
							</div>

							{/* Bottom Section - Assets & Status */}
							<div className="grid grid-cols-3 gap-6">
								{/* Assets */}
								<div className="space-y-4">
									<h3 className="font-semibold text-lg">Activos</h3>
									<div className="space-y-3">
										<div className="flex items-center gap-2">
											<Checkbox
												checked={selectedLead.ownsHome ?? false}
												disabled
											/>
											<Label className="text-sm">Posee Casa Propia</Label>
										</div>
										<div className="flex items-center gap-2">
											<Checkbox
												checked={selectedLead.ownsVehicle ?? false}
												disabled
											/>
											<Label className="text-sm">Posee Vehículo Propio</Label>
										</div>
										<div className="flex items-center gap-2">
											<Checkbox
												checked={selectedLead.hasCreditCard ?? false}
												disabled
											/>
											<Label className="text-sm">Tiene Tarjeta de Crédito</Label>
										</div>
									</div>
								</div>

								{/* Lead Status */}
								<div className="space-y-4">
									<h3 className="font-semibold text-lg">Estado del Lead</h3>
									<div className="space-y-3">
										<div>
											<Label className="font-medium text-sm text-muted-foreground">Fuente</Label>
											<Badge
												className={getSourceBadgeColor(selectedLead.source)}
												variant="outline"
											>
												{getSourceLabel(selectedLead.source)}
											</Badge>
										</div>
										<div>
											<Label className="font-medium text-sm text-muted-foreground">Estado</Label>
											<Badge
												className={getStatusBadgeColor(selectedLead.status)}
												variant="outline"
											>
												{getStatusLabel(selectedLead.status)}
											</Badge>
										</div>
									</div>
								</div>

								{/* Additional Information */}
								<div className="space-y-4">
									<h3 className="font-semibold text-lg">Información del Sistema</h3>
									<div className="space-y-3">
										<div>
											<Label className="font-medium text-sm text-muted-foreground">Asignado a</Label>
											<p className="text-sm">
												{selectedLead.assignedUser?.name || "No asignado"}
											</p>
										</div>
										<div>
											<Label className="font-medium text-sm text-muted-foreground">
												Fecha de Creación
											</Label>
											<p className="text-sm">
												{formatGuatemalaDate(selectedLead.createdAt)}
											</p>
										</div>
									</div>
								</div>
							</div>

							{/* Scoring Section */}
							{selectedLead.score && (
								<div className="space-y-4">
									<h3 className="font-semibold text-lg">Análisis de Riesgo</h3>
									<div className="grid grid-cols-3 gap-4">
										<div className="space-y-2">
											<Label className="font-medium text-sm text-muted-foreground">Score Crediticio</Label>
											<div className="flex items-center gap-2">
												<div className="relative h-8 w-full rounded-full bg-gray-200">
													<div
														className={`absolute left-0 top-0 h-full rounded-full ${
															Number(selectedLead.score) >= 0.7
																? "bg-green-500"
																: Number(selectedLead.score) >= 0.4
																	? "bg-yellow-500"
																	: "bg-red-500"
														}`}
														style={{ width: `${Number(selectedLead.score) * 100}%` }}
													/>
												</div>
												<span className="font-bold text-lg">
													{(Number(selectedLead.score) * 100).toFixed(0)}%
												</span>
											</div>
										</div>
										<div className="space-y-2">
											<Label className="font-medium text-sm text-muted-foreground">Estado de Aprobación</Label>
											<Badge
												variant={selectedLead.fit ? "default" : "secondary"}
												className={
													selectedLead.fit
														? "bg-green-500 hover:bg-green-600 text-lg px-4 py-1"
														: "text-lg px-4 py-1"
												}
											>
												{selectedLead.fit ? "PREAPROBADO" : "NO PREAPROBADO"}
											</Badge>
										</div>
										<div className="space-y-2">
											<Label className="font-medium text-sm text-muted-foreground">Fecha de Análisis</Label>
											<p className="text-sm">
												{selectedLead.scoredAt
													? formatGuatemalaDate(selectedLead.scoredAt)
													: "No analizado"}
											</p>
										</div>
									</div>
								</div>
							)}

							{/* Credit Analysis Section - Análisis de Capacidad de Pago */}
							{creditAnalysisQuery.data && (
								<div className="space-y-4">
									<h3 className="font-semibold text-lg">Análisis de Capacidad de Pago</h3>
									
									{/* Income and Expenses Summary */}
									<div className="grid grid-cols-2 gap-6">
										<div className="space-y-4">
											<h4 className="font-medium text-base">Ingresos Mensuales</h4>
											<div className="space-y-3 rounded-lg bg-green-50 p-4">
												<div className="flex justify-between">
													<span className="text-sm text-muted-foreground">Ingresos Fijos:</span>
													<span className="font-medium">
														{creditAnalysisQuery.data.monthlyFixedIncome
															? formatCurrency(creditAnalysisQuery.data.monthlyFixedIncome)
															: "-"}
													</span>
												</div>
												<div className="flex justify-between">
													<span className="text-sm text-muted-foreground">Ingresos Variables:</span>
													<span className="font-medium">
														{creditAnalysisQuery.data.monthlyVariableIncome
															? formatCurrency(creditAnalysisQuery.data.monthlyVariableIncome)
															: "-"}
													</span>
												</div>
												<div className="border-t pt-2">
													<div className="flex justify-between">
														<span className="font-medium">Total Ingresos:</span>
														<span className="font-bold text-green-600">
															{creditAnalysisQuery.data.monthlyFixedIncome && creditAnalysisQuery.data.monthlyVariableIncome
																? formatCurrency(
																		Number(creditAnalysisQuery.data.monthlyFixedIncome) +
																		Number(creditAnalysisQuery.data.monthlyVariableIncome)
																	)
																: "-"}
														</span>
													</div>
												</div>
											</div>
										</div>
										
										<div className="space-y-4">
											<h4 className="font-medium text-base">Gastos Mensuales</h4>
											<div className="space-y-3 rounded-lg bg-red-50 p-4">
												<div className="flex justify-between">
													<span className="text-sm text-muted-foreground">Gastos Fijos:</span>
													<span className="font-medium">
														{creditAnalysisQuery.data.monthlyFixedExpenses
															? formatCurrency(creditAnalysisQuery.data.monthlyFixedExpenses)
															: "-"}
													</span>
												</div>
												<div className="flex justify-between">
													<span className="text-sm text-muted-foreground">Gastos Variables:</span>
													<span className="font-medium">
														{creditAnalysisQuery.data.monthlyVariableExpenses
															? formatCurrency(creditAnalysisQuery.data.monthlyVariableExpenses)
															: "-"}
													</span>
												</div>
												<div className="border-t pt-2">
													<div className="flex justify-between">
														<span className="font-medium">Total Gastos:</span>
														<span className="font-bold text-red-600">
															{creditAnalysisQuery.data.monthlyFixedExpenses && creditAnalysisQuery.data.monthlyVariableExpenses
																? formatCurrency(
																		Number(creditAnalysisQuery.data.monthlyFixedExpenses) +
																		Number(creditAnalysisQuery.data.monthlyVariableExpenses)
																	)
																: "-"}
														</span>
													</div>
												</div>
											</div>
										</div>
									</div>

									{/* Economic Availability */}
									<div className="rounded-lg bg-blue-50 p-4">
										<div className="flex items-center justify-between">
											<div>
												<Label className="font-medium text-sm text-muted-foreground">Disponibilidad Económica</Label>
												<p className="text-sm text-muted-foreground">Capacidad de ahorro mensual</p>
											</div>
											<span className="text-2xl font-bold text-blue-600">
												{creditAnalysisQuery.data.economicAvailability
													? formatCurrency(creditAnalysisQuery.data.economicAvailability)
													: "-"}
											</span>
										</div>
									</div>

									{/* Payment Capacity */}
									<div className="space-y-4">
										<h4 className="font-medium text-base">Capacidad de Pago</h4>
										<div className="grid grid-cols-4 gap-4">
											<div className="rounded-lg border p-4 text-center">
												<Label className="text-xs text-muted-foreground">Pago Mínimo</Label>
												<p className="mt-1 text-lg font-bold text-orange-600">
													{creditAnalysisQuery.data.minPayment
														? formatCurrency(creditAnalysisQuery.data.minPayment)
														: "-"}
												</p>
											</div>
											<div className="rounded-lg border p-4 text-center">
												<Label className="text-xs text-muted-foreground">Pago Ajustado</Label>
												<p className="mt-1 text-lg font-bold text-blue-600">
													{creditAnalysisQuery.data.adjustedPayment
														? formatCurrency(creditAnalysisQuery.data.adjustedPayment)
														: "-"}
												</p>
											</div>
											<div className="rounded-lg border p-4 text-center">
												<Label className="text-xs text-muted-foreground">Pago Máximo</Label>
												<p className="mt-1 text-lg font-bold text-green-600">
													{creditAnalysisQuery.data.maxPayment
														? formatCurrency(creditAnalysisQuery.data.maxPayment)
														: "-"}
												</p>
											</div>
											<div className="rounded-lg border bg-primary/5 p-4 text-center">
												<Label className="text-xs text-muted-foreground">Crédito Máximo</Label>
												<p className="mt-1 text-lg font-bold text-primary">
													{creditAnalysisQuery.data.maxCreditAmount
														? formatCurrency(creditAnalysisQuery.data.maxCreditAmount)
														: "-"}
												</p>
											</div>
										</div>
									</div>

									{/* Analysis Date */}
									<div className="text-right text-sm text-muted-foreground">
										Análisis realizado: {formatGuatemalaDate(creditAnalysisQuery.data.analyzedAt)}
									</div>
								</div>
							)}

							{/* Notes Section - Full Width */}
							{selectedLead.notes && (
								<div className="space-y-2">
									<Label className="font-medium text-sm text-muted-foreground">Notas</Label>
									<p className="rounded-md bg-muted p-4 text-sm">
										{selectedLead.notes}
									</p>
								</div>
							)}
						</div>
					)}
				</DialogContent>
			</Dialog>
		</div>
	);
}
