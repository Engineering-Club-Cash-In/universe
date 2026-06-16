import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
	AlertTriangle,
	Banknote,
	Briefcase,
	Calendar,
	Car,
	CheckCircle2,
	ChevronLeft,
	ChevronRight,
	CreditCard,
	Download,
	Eye,
	FileText,
	HandshakeIcon,
	Loader2,
	Mail,
	MapPin,
	Paperclip,
	Pencil,
	Phone,
	Save,
	Search,
	User,
	X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import {
	OpportunityDetailModal,
	type OpportunityForModal,
} from "@/components/opportunity-detail-modal";
import { DateRangeFilter } from "@/components/reports/date-range-filter";
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
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { usePersistedDateRange } from "@/hooks/usePersistedDateRange";
import { usePersistedState } from "@/hooks/usePersistedState";
import { authClient } from "@/lib/auth-client";
import { shouldRedirectToLogin } from "@/lib/auth-session";
import { formatGuatemalaDate } from "@/lib/crm-formatters";
import { PERMISSIONS } from "@/lib/roles";
import { client, orpc } from "@/utils/orpc";

export const Route = createFileRoute("/crm/clients")({
	component: RouteComponent,
	validateSearch: z.object({
		opportunityId: z.string().optional(),
		initialTab: z.string().optional(),
		idLead: z.string().optional(),
		edit: z.boolean().optional(),
	}).parse,
});

// Helper functions
function formatLeadFullName(lead: {
	firstName?: string | null;
	middleName?: string | null;
	lastName?: string | null;
	secondLastName?: string | null;
}) {
	return [lead.firstName, lead.middleName, lead.lastName, lead.secondLastName]
		.filter((part): part is string => Boolean(part?.trim()))
		.join(" ");
}

const getMaritalStatusLabel = (status: string | null) => {
	if (!status) return "No especificado";
	switch (status) {
		case "single":
			return "Soltero/a";
		case "married":
			return "Casado/a";
		case "divorced":
			return "Divorciado/a";
		case "widowed":
			return "Viudo/a";
		default:
			return status;
	}
};

const getOccupationLabel = (occupation: string | null) => {
	if (!occupation) return "No especificado";
	switch (occupation) {
		case "owner":
			return "Propietario";
		case "employee":
			return "Empleado";
		default:
			return occupation;
	}
};

const getWorkTimeLabel = (workTime: string | null) => {
	if (!workTime) return "No especificado";
	switch (workTime) {
		case "less_than_1":
			return "Menos de 1 año";
		case "1_to_5":
			return "1 a 5 años";
		case "5_to_10":
			return "5 a 10 años";
		case "10_plus":
			return "Más de 10 años";
		default:
			return workTime;
	}
};

const formatCurrency = (value: string | number | null) => {
	if (!value) return "Q0.00";
	const num = typeof value === "string" ? Number.parseFloat(value) : value;
	return `Q${num.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const getCarteraStatusLabel = (status?: string | null) => {
	switch (status) {
		case "ACTIVO":
			return "Activo";
		case "MOROSO":
			return "Moroso";
		case "EN_CONVENIO":
			return "En convenio";
		default:
			return "Cartera";
	}
};

const getCarteraStatusClassName = (status?: string | null) => {
	switch (status) {
		case "ACTIVO":
			return "bg-green-100 text-green-800";
		case "MOROSO":
			return "bg-red-100 text-red-800";
		case "EN_CONVENIO":
			return "bg-blue-100 text-blue-800";
		default:
			return "bg-muted text-muted-foreground";
	}
};

// Type definition for credit analysis
type CreditAnalysisData = {
	leadId: string;
	monthlyFixedIncome: string | null;
	monthlyVariableIncome: string | null;
	monthlyFixedExpenses: string | null;
	monthlyVariableExpenses: string | null;
	economicAvailability: string | null;
	maxPayment: string | null;
	maxCreditAmount: string | null;
	analyzedAt: Date;
} | null;

// Type definition for client data
type ClientData = {
	id: string;
	rowId?: string;
	firstName: string;
	middleName?: string | null;
	lastName: string;
	secondLastName?: string | null;
	email: string;
	phone: string | null;
	dpi: string | null;
	nit?: string | null;
	age: number | null;
	clientType: string;
	maritalStatus: string | null;
	dependents: number | null;
	monthlyIncome: string | null;
	loanAmount: string | null;
	occupation: string | null;
	workTime: string | null;
	ownsHome: boolean | null;
	ownsVehicle: boolean | null;
	hasCreditCard: boolean | null;
	jobTitle: string | null;
	direccion: string | null;
	departamento: string | null;
	municipio: string | null;
	zona: string | null;
	assignedTo: string;
	createdAt: Date;
	updatedAt: Date;
	assignedUser: { id: string; name: string } | null;
	opportunities: Array<{
		id: string;
		title: string;
		value: string | null;
		creditType: string;
		numeroSifco: string | null;
		status: string;
		createdAt: Date;
		stage: {
			id: string;
			name: string;
			closurePercentage: number;
			color: string | null;
		} | null;
		isClosed: boolean;
	}>;
	creditAnalysis: CreditAnalysisData;
	totalClosedValue: number;
	closedOpportunitiesCount: number;
	crmMatchStatus?: "matched" | "missing";
	carteraCredit?: {
		numeroSifco: string;
		statusCredit: string | null;
		capital: string | null;
		deudaTotal: string | null;
		cuota: string | null;
		tipoCredito: string | null;
	} | null;
};

function RouteComponent() {
	const {
		data: session,
		error: sessionError,
		isPending,
	} = authClient.useSession();
	const navigate = Route.useNavigate();
	const search = Route.useSearch();
	const [searchTerm, setSearchTerm] = usePersistedState<string>(
		"crm/clients/searchTerm",
		"",
	);
	const [debouncedSearch, setDebouncedSearch] = useState(searchTerm);
	const [dateRange, setDateRange] = usePersistedDateRange(
		"crm/clients/dateRange",
	);
	const [page, setPage] = usePersistedState<number>("crm/clients/page", 0);
	const pageSize = 20;

	const hasActiveFilters = searchTerm !== "" || dateRange !== undefined;
	const resetFilters = () => {
		setSearchTerm("");
		setDebouncedSearch("");
		setDateRange(undefined);
		setPage(0);
	};

	const queryClient = useQueryClient();

	// Modal state
	const [isDetailsDialogOpen, setIsDetailsDialogOpen] = useState(false);
	const [selectedClient, setSelectedClient] = useState<ClientData | null>(null);

	// Edit contact info state
	const [isEditingContact, setIsEditingContact] = useState(false);
	const [editForm, setEditForm] = useState({
		phone: "",
		email: "",
		direccion: "",
	});

	// Opportunity modal state
	const [isOpportunityModalOpen, setIsOpportunityModalOpen] = useState(false);
	const [activeOpportunityId, setActiveOpportunityId] = useState<string | null>(
		null,
	);

	// The effective opportunity ID: from URL param or from click
	const effectiveOpportunityId = search.opportunityId || activeOpportunityId;

	// Fetch full opportunity data (used for both URL param and click)
	const fullOpportunityQuery = useQuery({
		...orpc.getOpportunities.queryOptions({
			input: { opportunityId: effectiveOpportunityId ?? undefined },
		}),
		enabled: !!effectiveOpportunityId,
	});

	// Map query result to OpportunityForModal
	const selectedOpportunityForModal: OpportunityForModal | null =
		useMemo(() => {
			const opp = fullOpportunityQuery.data?.[0];
			if (!opp) return null;
			return {
				id: opp.id,
				title: opp.title,
				value: opp.value,
				creditType: opp.creditType,
				status: opp.status,
				expectedCloseDate: opp.expectedCloseDate ?? null,
				createdAt: opp.createdAt,
				lead: opp.lead?.id
					? {
							id: opp.lead.id,
							firstName: opp.lead.firstName,
							lastName: opp.lead.lastName,
							email: opp.lead.email,
							age: opp.lead.age,
							direccion: opp.lead.direccion,
							departamento: opp.lead.departamento,
							municipio: opp.lead.municipio,
							zona: opp.lead.zona,
						}
					: undefined,
				stage: opp.stage?.id
					? {
							id: opp.stage.id,
							name: opp.stage.name,
							closurePercentage: opp.stage.closurePercentage,
							color: opp.stage.color || "#888",
						}
					: undefined,
				vehicle: opp.vehicle?.id
					? {
							id: opp.vehicle.id,
							make: opp.vehicle.make,
							model: opp.vehicle.model,
							year: opp.vehicle.year,
							licensePlate: opp.vehicle.licensePlate,
							color: opp.vehicle.color,
							isNew: opp.vehicle.isNew,
						}
					: undefined,
				assignedUser: opp.assignedUser?.id
					? { id: opp.assignedUser.id, name: opp.assignedUser.name }
					: undefined,
			};
		}, [fullOpportunityQuery.data]);

	// Auto-open modal from URL param when data is ready
	useEffect(() => {
		if (search.opportunityId && selectedOpportunityForModal) {
			setIsOpportunityModalOpen(true);
		}
	}, [search.opportunityId, selectedOpportunityForModal]);

	// Debounce search
	useEffect(() => {
		const timer = setTimeout(() => {
			setDebouncedSearch(searchTerm);
			setPage(0);
		}, 300);
		return () => clearTimeout(timer);
	}, [searchTerm]);

	const userProfile = useQuery(orpc.getUserProfile.queryOptions());

	// Query para obtener un cliente específico por idLead
	const specificClientQuery = useQuery({
		...orpc.getLeadsAsClients.queryOptions({
			input: {
				limit: 1,
				offset: 0,
				leadId: search.idLead,
			},
		}),
		enabled:
			!!search.idLead &&
			!!userProfile.data?.role &&
			PERMISSIONS.canAccessClients(userProfile.data.role) &&
			!!session?.user?.id,
	});

	// Auto-open client detail modal when idLead is in URL
	useEffect(() => {
		if (search.idLead && specificClientQuery.data?.data?.[0]) {
			const client = specificClientQuery.data.data[0] as unknown as ClientData;
			setSelectedClient(client);
			setIsDetailsDialogOpen(true);
			if (search.edit) {
				setEditForm({
					phone: client.phone || "",
					email: client.email || "",
					direccion: client.direccion || "",
				});
				setIsEditingContact(true);
			}
		}
	}, [search.idLead, search.edit, specificClientQuery.data]);

	// Documentos de contabilidad para las oportunidades del cliente seleccionado
	const opportunityIds =
		selectedClient?.opportunities.map((opp) => opp.id) ?? [];
	const accountDocsQuery = useQuery({
		...orpc.getAccountDocumentsByOpportunities.queryOptions({
			input: { opportunityIds },
		}),
		enabled: isDetailsDialogOpen && opportunityIds.length > 0,
	});

	const clientsQuery = useQuery({
		...orpc.getLeadsAsClients.queryOptions({
			input: {
				limit: pageSize,
				offset: page * pageSize,
				search: debouncedSearch || undefined,
				dateFrom: dateRange?.from?.toISOString(),
				dateTo: dateRange?.to?.toISOString(),
			},
		}),
		enabled:
			!!userProfile.data?.role &&
			PERMISSIONS.canAccessClients(userProfile.data.role) &&
			!!session?.user?.id,
		queryKey: [
			"getLeadsAsClients",
			session?.user?.id,
			userProfile.data?.role,
			page,
			pageSize,
			debouncedSearch,
			dateRange?.from?.toISOString(),
			dateRange?.to?.toISOString(),
		],
	});

	// Query para estadísticas globales (no paginadas)
	const statsQuery = useQuery({
		...orpc.getLeadsAsClientsStats.queryOptions(),
		enabled:
			!!userProfile.data?.role &&
			PERMISSIONS.canAccessClients(userProfile.data.role) &&
			!!session?.user?.id,
		queryKey: [
			"getLeadsAsClientsStats",
			session?.user?.id,
			userProfile.data?.role,
		],
	});

	useEffect(() => {
		if (shouldRedirectToLogin({ error: sessionError, isPending, session })) {
			navigate({ to: "/login" });
		} else if (
			session &&
			userProfile.data?.role &&
			!PERMISSIONS.canAccessClients(userProfile.data.role)
		) {
			navigate({ to: "/dashboard" });
			toast.error("Acceso denegado: Se requiere acceso al CRM");
		}
	}, [session, sessionError, isPending, userProfile.data?.role, navigate]);

	const updateLeadMutation = useMutation({
		mutationFn: (input: {
			id: string;
			phone?: string;
			email?: string;
			direccion?: string;
			departamento?: string;
			municipio?: string;
			zona?: string;
		}) => client.updateLead(input),
		onSuccess: () => {
			queryClient.invalidateQueries({
				predicate: (query) =>
					query.queryKey[0] === "getLeadsAsClients" ||
					query.queryKey[0] === "getLeadsAsClientsStats",
			});
			toast.success("Información de contacto actualizada");
			setIsEditingContact(false);
			if (selectedClient) {
				setSelectedClient({
					...selectedClient,
					phone: editForm.phone || null,
					email: editForm.email,
					direccion: editForm.direccion || null,
				});
			}
		},
		onError: (error: any) => {
			toast.error(error.message || "Error al actualizar la información");
		},
	});

	const handleStartEditContact = () => {
		if (!selectedClient) return;
		setEditForm({
			phone: selectedClient.phone || "",
			email: selectedClient.email || "",
			direccion: selectedClient.direccion || "",
		});
		setIsEditingContact(true);
	};

	const handleSaveContact = () => {
		if (!selectedClient) return;
		updateLeadMutation.mutate({
			id: selectedClient.id,
			phone: editForm.phone || undefined,
			email: editForm.email || undefined,
			direccion: editForm.direccion || undefined,
		});
	};

	const handleViewDetails = (clientData: ClientData) => {
		setSelectedClient(clientData);
		setIsEditingContact(false);
		setIsDetailsDialogOpen(true);
	};

	if (isPending || userProfile.isPending) {
		return (
			<div className="flex items-center justify-center p-12">Cargando...</div>
		);
	}

	if (
		!userProfile.data?.role ||
		!PERMISSIONS.canAccessClients(userProfile.data.role)
	) {
		return null;
	}

	const clients = (clientsQuery.data?.data || []) as unknown as ClientData[];
	const totalRecords = clientsQuery.data?.total || 0;
	const totalPages = Math.ceil(totalRecords / pageSize);

	return (
		<div className="container mx-auto space-y-6 p-6">
			<div>
				<h1 className="font-bold text-3xl">Cartera de Clientes</h1>
				<p className="text-muted-foreground">
					Créditos vigentes de cartera enriquecidos con CRM cuando existe match
				</p>
			</div>

			{/* Summary Stats */}
			<div className="grid gap-4 md:grid-cols-3">
				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="font-medium text-sm">
							Total de Clientes
						</CardTitle>
						<HandshakeIcon className="h-4 w-4 text-muted-foreground" />
					</CardHeader>
					<CardContent>
						<div className="font-bold text-2xl">
							{statsQuery.data?.totalClients ?? 0}
						</div>
						<p className="text-muted-foreground text-xs">
							Créditos activos, morosos o en convenio
						</p>
					</CardContent>
				</Card>
				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="font-medium text-sm">Con CRM</CardTitle>
						<CheckCircle2 className="h-4 w-4 text-green-500" />
					</CardHeader>
					<CardContent>
						<div className="font-bold text-2xl">
							{statsQuery.data?.totalClosedOpportunities ?? 0}
						</div>
						<p className="text-muted-foreground text-xs">
							Créditos con oportunidad enlazada
						</p>
					</CardContent>
				</Card>
				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="font-medium text-sm">Valor Total</CardTitle>
						<Banknote className="h-4 w-4 text-purple-500" />
					</CardHeader>
					<CardContent>
						<div className="font-bold text-2xl">
							Q
							{(statsQuery.data?.totalValue ?? 0).toLocaleString("es-GT", {
								minimumFractionDigits: 2,
								maximumFractionDigits: 2,
							})}
						</div>
						<p className="text-muted-foreground text-xs">
							Deuda total en cartera vigente
						</p>
					</CardContent>
				</Card>
			</div>

			<Card>
				<CardHeader>
					<div className="flex items-center justify-between">
						<div>
							<CardTitle>Directorio de Clientes</CardTitle>
							<CardDescription>
								Clientes de cartera; CRM se muestra cuando hay oportunidad
								enlazada
							</CardDescription>
						</div>
					</div>
				</CardHeader>
				<CardContent>
					{/* Search Filter */}
					<div className="mb-6 flex flex-wrap items-center gap-4">
						<div className="relative max-w-md flex-1">
							<Search className="absolute top-2.5 left-2 h-4 w-4 text-muted-foreground" />
							<Input
								placeholder="Buscar por nombre, NIT, SIFCO, email o teléfono..."
								value={searchTerm}
								onChange={(e) => setSearchTerm(e.target.value)}
								className="pl-8"
							/>
						</div>
						<DateRangeFilter
							dateRange={dateRange}
							onDateRangeChange={(range) => {
								setDateRange(range);
								setPage(0);
							}}
						/>
						{hasActiveFilters && (
							<Button
								variant="ghost"
								size="sm"
								onClick={resetFilters}
								className="shrink-0 text-muted-foreground"
							>
								<X className="mr-1 h-3 w-3" />
								Limpiar filtros
								<Badge variant="secondary" className="ml-1 h-4 px-1 text-xs">
									{
										[searchTerm !== "", dateRange !== undefined].filter(Boolean)
											.length
									}
								</Badge>
							</Button>
						)}
					</div>

					{clientsQuery.isPending ? (
						<div className="flex items-center justify-center py-12">
							Cargando clientes...
						</div>
					) : clientsQuery.error ? (
						<div className="py-4 text-red-500">
							Error al cargar clientes: {clientsQuery.error.message}
						</div>
					) : clients.length === 0 ? (
						<div className="flex flex-col items-center justify-center py-12 text-center">
							<HandshakeIcon className="mb-4 h-12 w-12 text-muted-foreground" />
							<h3 className="font-medium text-lg">No hay clientes aún</h3>
							<p className="max-w-md text-muted-foreground text-sm">
								Los clientes aparecerán aquí cuando cartera tenga créditos
								activos, morosos o en convenio.
							</p>
						</div>
					) : (
						<>
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Cliente</TableHead>
										<TableHead>Contacto</TableHead>
										<TableHead>Estado cartera</TableHead>
										<TableHead>CRM</TableHead>
										<TableHead>Deuda / valor</TableHead>
										<TableHead>Desde</TableHead>
										<TableHead className="text-right">Acciones</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{clients.map((clientData) => (
										<TableRow
											key={clientData.rowId ?? clientData.id}
											className="cursor-pointer hover:bg-muted/50"
											onClick={() => handleViewDetails(clientData)}
										>
											<TableCell>
												<div className="flex items-center gap-2">
													<User className="h-4 w-4 text-muted-foreground" />
													<div>
														<div className="font-medium">
															{formatLeadFullName(clientData)}
														</div>
														{clientData.carteraCredit?.numeroSifco && (
															<div className="text-muted-foreground text-xs">
																SIFCO: {clientData.carteraCredit.numeroSifco}
															</div>
														)}
														{clientData.dpi && (
															<div className="text-muted-foreground text-xs">
																DPI: {clientData.dpi}
															</div>
														)}
														{!clientData.dpi && clientData.nit && (
															<div className="text-muted-foreground text-xs">
																NIT: {clientData.nit}
															</div>
														)}
													</div>
												</div>
											</TableCell>
											<TableCell>
												<div className="space-y-1">
													{clientData.email && (
														<div className="text-sm">{clientData.email}</div>
													)}
													{clientData.phone && (
														<div className="flex items-center gap-1 text-muted-foreground text-xs">
															<Phone className="h-3 w-3" />
															{clientData.phone}
														</div>
													)}
												</div>
											</TableCell>
											<TableCell>
												<div className="space-y-1">
													<Badge
														className={getCarteraStatusClassName(
															clientData.carteraCredit?.statusCredit,
														)}
													>
														{getCarteraStatusLabel(
															clientData.carteraCredit?.statusCredit,
														)}
													</Badge>
													{clientData.carteraCredit?.cuota && (
														<div className="text-muted-foreground text-xs">
															Cuota:{" "}
															{formatCurrency(clientData.carteraCredit.cuota)}
														</div>
													)}
												</div>
											</TableCell>
											<TableCell>
												{clientData.crmMatchStatus === "missing" ? (
													<Badge
														variant="outline"
														className="border-amber-300 text-amber-700"
													>
														<AlertTriangle className="mr-1 h-3 w-3" />
														Sin oportunidad CRM
													</Badge>
												) : (
													<TooltipProvider>
														<Tooltip>
															<TooltipTrigger asChild>
																<Badge
																	variant="secondary"
																	className="bg-green-100 text-green-800"
																>
																	{clientData.closedOpportunitiesCount}{" "}
																	enlazada(s)
																</Badge>
															</TooltipTrigger>
															<TooltipContent
																side="bottom"
																className="max-w-sm"
															>
																<div className="space-y-2">
																	<p className="font-medium">
																		Oportunidades CRM:
																	</p>
																	{clientData.opportunities.map((opp) => (
																		<div
																			key={opp.id}
																			className="flex items-center gap-2 text-sm"
																		>
																			<CheckCircle2 className="h-3 w-3 text-green-500" />
																			<span>{opp.title}</span>
																		</div>
																	))}
																</div>
															</TooltipContent>
														</Tooltip>
													</TooltipProvider>
												)}
											</TableCell>
											<TableCell>
												<div className="flex items-center gap-1 font-medium text-green-600">
													<Banknote className="h-3 w-3" />Q
													{(clientData.totalClosedValue || 0).toLocaleString()}
												</div>
											</TableCell>
											<TableCell>
												<div className="flex items-center gap-1 text-sm">
													<Calendar className="h-3 w-3" />
													{formatGuatemalaDate(clientData.createdAt)}
												</div>
											</TableCell>
											<TableCell className="text-right">
												<Button
													variant="ghost"
													size="sm"
													onClick={(e) => {
														e.stopPropagation();
														handleViewDetails(clientData);
													}}
												>
													<Eye className="h-4 w-4" />
												</Button>
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>

							{/* Pagination Controls */}
							{totalPages > 1 && (
								<div className="flex items-center justify-between border-t px-4 py-3">
									<div className="text-muted-foreground text-sm">
										Mostrando {page * pageSize + 1} -{" "}
										{Math.min((page + 1) * pageSize, totalRecords)} de{" "}
										{totalRecords} clientes
									</div>
									<div className="flex items-center gap-2">
										<Button
											variant="outline"
											size="sm"
											onClick={() => setPage((p) => Math.max(0, p - 1))}
											disabled={page === 0}
										>
											<ChevronLeft className="h-4 w-4" />
											Anterior
										</Button>
										<span className="text-sm">
											Página {page + 1} de {totalPages}
										</span>
										<Button
											variant="outline"
											size="sm"
											onClick={() =>
												setPage((p) => Math.min(totalPages - 1, p + 1))
											}
											disabled={page >= totalPages - 1}
										>
											Siguiente
											<ChevronRight className="h-4 w-4" />
										</Button>
									</div>
								</div>
							)}
						</>
					)}
				</CardContent>
			</Card>

			{/* Details Dialog */}
			<Dialog
				open={isDetailsDialogOpen}
				onOpenChange={(open) => {
					setIsDetailsDialogOpen(open);
					if (!open && search.idLead) {
						navigate({
							to: "/crm/clients",
							search: { ...search, idLead: undefined },
							replace: true,
						});
					}
				}}
			>
				<DialogContent className="max-h-[85vh] min-w-[900px] max-w-6xl overflow-y-auto">
					<DialogHeader>
						<DialogTitle>Detalles del Cliente</DialogTitle>
					</DialogHeader>
					{selectedClient && (
						<div className="space-y-6">
							{/* Header con nombre, badges y resumen */}
							<div className="flex items-center gap-4 rounded-lg border bg-linear-to-r from-primary/5 to-transparent p-4">
								<div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary/10 font-bold text-lg text-primary">
									{selectedClient.firstName?.[0]}
									{selectedClient.lastName?.[0]}
								</div>
								<div className="min-w-0 flex-1">
									<div className="flex items-center gap-2">
										<h3 className="truncate font-semibold text-xl">
											{formatLeadFullName(selectedClient)}
										</h3>
										<Badge
											className={`shrink-0 text-xs ${getCarteraStatusClassName(
												selectedClient.carteraCredit?.statusCredit,
											)}`}
										>
											{getCarteraStatusLabel(
												selectedClient.carteraCredit?.statusCredit,
											)}
										</Badge>
										{selectedClient.crmMatchStatus === "missing" ? (
											<Badge
												variant="outline"
												className="shrink-0 border-amber-300 text-amber-700 text-xs"
											>
												Sin oportunidad CRM
											</Badge>
										) : (
											<Badge variant="outline" className="shrink-0 text-xs">
												CRM enlazado
											</Badge>
										)}
									</div>
									<div className="mt-1 flex items-center gap-4 text-muted-foreground text-sm">
										{selectedClient.email && (
											<span className="flex items-center gap-1">
												<Mail className="h-3.5 w-3.5" />
												{selectedClient.email}
											</span>
										)}
										{selectedClient.phone && (
											<span className="flex items-center gap-1">
												<Phone className="h-3.5 w-3.5" />
												{selectedClient.phone}
											</span>
										)}
										{selectedClient.carteraCredit?.numeroSifco && (
											<span className="flex items-center gap-1">
												<CreditCard className="h-3.5 w-3.5" />
												SIFCO: {selectedClient.carteraCredit.numeroSifco}
											</span>
										)}
										{selectedClient.dpi && (
											<span className="flex items-center gap-1">
												<User className="h-3.5 w-3.5" />
												DPI: {selectedClient.dpi}
											</span>
										)}
									</div>
								</div>
								<div className="flex shrink-0 items-center gap-3">
									<div className="text-center">
										<p className="font-bold text-green-600 text-xl">
											{selectedClient.closedOpportunitiesCount}
										</p>
										<p className="text-[11px] text-muted-foreground">CRM</p>
									</div>
									<div className="h-8 w-px bg-border" />
									<div className="text-center">
										<p className="font-bold text-blue-600 text-xl">
											{selectedClient.opportunities.length}
										</p>
										<p className="text-[11px] text-muted-foreground">Total</p>
									</div>
									<div className="h-8 w-px bg-border" />
									<div className="text-center">
										<p className="font-bold text-lg text-purple-600">
											{formatCurrency(selectedClient.totalClosedValue)}
										</p>
										<p className="text-[11px] text-muted-foreground">
											Deuda / valor
										</p>
									</div>
								</div>
							</div>

							{/* Oportunidades del Cliente - PRIMERO */}
							<div className="space-y-3">
								<h3 className="flex items-center gap-2 font-semibold text-base">
									<HandshakeIcon className="h-4 w-4" />
									Oportunidad CRM
									<Badge variant="secondary" className="ml-1 text-xs">
										{selectedClient.opportunities.length}
									</Badge>
								</h3>
								<div className="space-y-2">
									{selectedClient.opportunities.length === 0 && (
										<div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
											<div className="flex items-start gap-3">
												<AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
												<div>
													<p className="font-medium">
														Sin oportunidad CRM enlazada
													</p>
													<p className="mt-1 text-sm">
														Este crédito existe en cartera, pero no hay una
														oportunidad CRM con el mismo número SIFCO. Los datos
														de etapa, vehículo, documentos, análisis e historial
														CRM no están disponibles.
													</p>
												</div>
											</div>
										</div>
									)}
									{selectedClient.opportunities.map((opp) => (
										<div
											key={opp.id}
											className={`group flex items-center gap-3 rounded-lg border p-3 transition-all hover:shadow-sm ${
												opp.isClosed
													? "border-green-200 bg-green-50/50 dark:bg-green-900/20"
													: "bg-card hover:bg-muted/40"
											}`}
										>
											{opp.isClosed ? (
												<CheckCircle2 className="h-5 w-5 shrink-0 text-green-500" />
											) : (
												<Car className="h-5 w-5 shrink-0 text-muted-foreground" />
											)}
											<div className="min-w-0 flex-1">
												<div className="flex items-center gap-2">
													<span className="truncate font-medium text-sm">
														{opp.title}
													</span>
													{opp.stage && (
														<Badge
															className="shrink-0 text-[10px]"
															style={{
																backgroundColor: opp.stage.color || "#888",
																color: "#fff",
															}}
														>
															{opp.stage.name} ({opp.stage.closurePercentage}%)
														</Badge>
													)}
													{opp.isClosed && (
														<Badge className="shrink-0 bg-green-500 text-[10px]">
															Cerrada
														</Badge>
													)}
												</div>
												<div className="mt-0.5 flex items-center gap-3 text-muted-foreground text-xs">
													<span className="font-medium text-foreground">
														{formatCurrency(opp.value)}
													</span>
													<span>
														{opp.creditType === "autocompra"
															? "Autocompra"
															: "Sobre Vehículo"}
													</span>
													{opp.numeroSifco && (
														<span className="text-blue-600">
															#{opp.numeroSifco}
														</span>
													)}
													<span className="flex items-center gap-1">
														<Calendar className="h-3 w-3" />
														{formatGuatemalaDate(opp.createdAt)}
													</span>
												</div>
											</div>
											<Button
												variant="ghost"
												size="sm"
												className="shrink-0 opacity-60 group-hover:opacity-100"
												onClick={() => {
													setActiveOpportunityId(opp.id);
													setIsOpportunityModalOpen(true);
												}}
											>
												<Eye className="mr-1 h-4 w-4" />
												Ver detalle
											</Button>
										</div>
									))}
								</div>
							</div>

							{/* Documentos de Contabilidad */}
							{accountDocsQuery.data && accountDocsQuery.data.length > 0 && (
								<div className="space-y-3 rounded-lg border bg-muted/30 p-4">
									<h3 className="flex items-center gap-2 font-semibold text-base">
										<Paperclip className="h-4 w-4" />
										Documentos de Contabilidad
										<Badge variant="secondary" className="ml-1 text-xs">
											{accountDocsQuery.data.length}
										</Badge>
									</h3>
									<div className="space-y-2">
										{accountDocsQuery.data.map((doc) => (
											<div
												key={doc.id}
												className="flex items-center justify-between rounded-md border bg-background px-3 py-2"
											>
												<div className="flex min-w-0 items-center gap-3">
													<FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
													<div className="min-w-0">
														<p className="truncate font-medium text-sm">
															{doc.originalName}
														</p>
														<p className="text-muted-foreground text-xs">
															{doc.notificationTitulo}
															{" · "}
															{(doc.size / 1024).toFixed(1)} KB
														</p>
													</div>
												</div>
												<a
													href={doc.url}
													target="_blank"
													rel="noopener noreferrer"
													onClick={(e) => e.stopPropagation()}
												>
													<Button
														variant="ghost"
														size="icon"
														className="shrink-0"
													>
														<Download className="h-4 w-4" />
													</Button>
												</a>
											</div>
										))}
									</div>
								</div>
							)}

							{/* Información del Cliente */}
							<div className="space-y-4">
								<h3 className="flex items-center gap-2 font-semibold text-base">
									<User className="h-4 w-4" />
									Información del Cliente
								</h3>

								{/* Personal + Contacto */}
								<div className="grid grid-cols-2 gap-4">
									<div className="space-y-3 rounded-lg border bg-muted/30 p-4">
										<h4 className="font-medium text-muted-foreground text-sm">
											Información Personal
										</h4>
										<div className="grid grid-cols-2 gap-3">
											<div>
												<p className="text-muted-foreground text-xs">
													Nombre Completo
												</p>
												<p className="font-medium text-sm">
													{formatLeadFullName(selectedClient)}
												</p>
											</div>
											<div>
												<p className="text-muted-foreground text-xs">DPI</p>
												<p className="text-sm">
													{selectedClient.dpi || "No especificado"}
												</p>
											</div>
											<div>
												<p className="text-muted-foreground text-xs">Edad</p>
												<p className="text-sm">
													{selectedClient.age || "No especificado"}
												</p>
											</div>
											<div>
												<p className="text-muted-foreground text-xs">
													Estado Civil
												</p>
												<p className="text-sm">
													{getMaritalStatusLabel(selectedClient.maritalStatus)}
												</p>
											</div>
											<div>
												<p className="text-muted-foreground text-xs">
													Dependientes
												</p>
												<p className="text-sm">
													{selectedClient.dependents || 0}
												</p>
											</div>
											<div>
												<p className="text-muted-foreground text-xs">Cargo</p>
												<p className="text-sm">
													{selectedClient.jobTitle || "No especificado"}
												</p>
											</div>
										</div>
									</div>

									<div className="space-y-3 rounded-lg border bg-muted/30 p-4">
										<div className="flex items-center justify-between">
											<h4 className="font-medium text-muted-foreground text-sm">
												Contacto y Laboral
											</h4>
											{isEditingContact ? (
												<div className="flex items-center gap-1">
													<Button
														variant="ghost"
														size="sm"
														className="h-7 px-2 text-xs"
														onClick={() => setIsEditingContact(false)}
														disabled={updateLeadMutation.isPending}
													>
														<X className="mr-1 h-3 w-3" />
														Cancelar
													</Button>
													<Button
														variant="default"
														size="sm"
														className="h-7 px-2 text-xs"
														onClick={handleSaveContact}
														disabled={updateLeadMutation.isPending}
													>
														{updateLeadMutation.isPending ? (
															<Loader2 className="mr-1 h-3 w-3 animate-spin" />
														) : (
															<Save className="mr-1 h-3 w-3" />
														)}
														Guardar
													</Button>
												</div>
											) : selectedClient.crmMatchStatus !== "missing" ? (
												<Button
													variant="ghost"
													size="sm"
													className="h-7 px-2 text-xs"
													onClick={handleStartEditContact}
												>
													<Pencil className="mr-1 h-3 w-3" />
													Editar
												</Button>
											) : null}
										</div>
										{isEditingContact ? (
											<div className="space-y-3">
												<div className="grid grid-cols-2 gap-3">
													<div>
														<Label className="text-xs">Correo</Label>
														<Input
															value={editForm.email}
															onChange={(e) =>
																setEditForm({
																	...editForm,
																	email: e.target.value,
																})
															}
															className="h-8 text-sm"
														/>
													</div>
													<div>
														<Label className="text-xs">Teléfono</Label>
														<Input
															value={editForm.phone}
															onChange={(e) =>
																setEditForm({
																	...editForm,
																	phone: e.target.value,
																})
															}
															className="h-8 text-sm"
														/>
													</div>
												</div>
												<div>
													<Label className="text-xs">Dirección</Label>
													<Input
														value={editForm.direccion}
														onChange={(e) =>
															setEditForm({
																...editForm,
																direccion: e.target.value,
															})
														}
														className="h-8 text-sm"
													/>
												</div>
											</div>
										) : (
											<div className="space-y-3">
												<div className="flex items-center gap-2">
													<Mail className="h-4 w-4 text-muted-foreground" />
													<p className="text-sm">{selectedClient.email}</p>
												</div>
												<div className="flex items-center gap-2">
													<Phone className="h-4 w-4 text-muted-foreground" />
													<p className="text-sm">
														{selectedClient.phone || "No especificado"}
													</p>
												</div>
												{(selectedClient.direccion ||
													selectedClient.departamento ||
													selectedClient.municipio ||
													selectedClient.zona) && (
													<div className="flex items-center gap-2">
														<MapPin className="h-4 w-4 text-muted-foreground" />
														<p className="text-sm">
															{[
																selectedClient.direccion,
																selectedClient.zona
																	? `Zona ${selectedClient.zona}`
																	: null,
																selectedClient.municipio,
																selectedClient.departamento,
															]
																.filter(Boolean)
																.join(", ")}
														</p>
													</div>
												)}
												{selectedClient.assignedUser && (
													<div className="flex items-center gap-2">
														<Briefcase className="h-4 w-4 text-muted-foreground" />
														<p className="text-sm">
															{selectedClient.assignedUser.name}
														</p>
													</div>
												)}
												<div className="mt-2 border-t pt-2">
													<div className="grid grid-cols-2 gap-3">
														<div>
															<p className="text-muted-foreground text-xs">
																Ocupación
															</p>
															<p className="text-sm">
																{getOccupationLabel(selectedClient.occupation)}
															</p>
														</div>
														<div>
															<p className="text-muted-foreground text-xs">
																Tiempo en el Trabajo
															</p>
															<p className="text-sm">
																{getWorkTimeLabel(selectedClient.workTime)}
															</p>
														</div>
													</div>
												</div>
											</div>
										)}
									</div>
								</div>

								{/* Financiera + Activos */}
								<div className="grid grid-cols-2 gap-4">
									<div className="space-y-3 rounded-lg border bg-muted/30 p-4">
										<h4 className="font-medium text-muted-foreground text-sm">
											Información Financiera
										</h4>
										<div className="grid grid-cols-2 gap-3">
											<div>
												<p className="text-muted-foreground text-xs">
													Ingreso Mensual
												</p>
												<p className="font-medium text-sm">
													{selectedClient.monthlyIncome
														? formatCurrency(selectedClient.monthlyIncome)
														: "No especificado"}
												</p>
											</div>
											<div>
												<p className="text-muted-foreground text-xs">
													Monto a Financiar
												</p>
												<p className="font-medium text-sm">
													{selectedClient.loanAmount
														? formatCurrency(selectedClient.loanAmount)
														: "No especificado"}
												</p>
											</div>
										</div>
									</div>

									<div className="space-y-3 rounded-lg border bg-muted/30 p-4">
										<h4 className="font-medium text-muted-foreground text-sm">
											Activos
										</h4>
										<div className="flex flex-wrap gap-4">
											<div className="flex items-center gap-2">
												<Checkbox
													checked={selectedClient.ownsHome ?? false}
													disabled
												/>
												<Label className="text-sm">Casa Propia</Label>
											</div>
											<div className="flex items-center gap-2">
												<Checkbox
													checked={selectedClient.ownsVehicle ?? false}
													disabled
												/>
												<Label className="text-sm">Vehículo Propio</Label>
											</div>
											<div className="flex items-center gap-2">
												<Checkbox
													checked={selectedClient.hasCreditCard ?? false}
													disabled
												/>
												<Label className="text-sm">Tarjeta de Crédito</Label>
											</div>
										</div>
									</div>
								</div>
							</div>

							{/* Capacidad de Pago */}
							{selectedClient.creditAnalysis ? (
								<div className="space-y-3 rounded-lg border bg-muted/30 p-4">
									<h3 className="flex items-center gap-2 font-semibold text-base">
										<CreditCard className="h-4 w-4" />
										Análisis de Capacidad de Pago
									</h3>
									<div className="grid grid-cols-2 gap-4">
										<div className="space-y-3 rounded-lg bg-green-50 p-3 dark:bg-green-900/20">
											<h4 className="font-medium text-sm">
												Ingresos Mensuales
											</h4>
											<div className="flex justify-between text-sm">
												<span className="text-muted-foreground">Fijos:</span>
												<span className="font-medium">
													{selectedClient.creditAnalysis.monthlyFixedIncome
														? formatCurrency(
																selectedClient.creditAnalysis
																	.monthlyFixedIncome,
															)
														: "-"}
												</span>
											</div>
											<div className="flex justify-between text-sm">
												<span className="text-muted-foreground">
													Variables:
												</span>
												<span className="font-medium">
													{selectedClient.creditAnalysis.monthlyVariableIncome
														? formatCurrency(
																selectedClient.creditAnalysis
																	.monthlyVariableIncome,
															)
														: "-"}
												</span>
											</div>
											<div className="flex justify-between border-t pt-2">
												<span className="font-medium text-sm">Total:</span>
												<span className="font-bold text-green-600">
													{selectedClient.creditAnalysis.monthlyFixedIncome ||
													selectedClient.creditAnalysis.monthlyVariableIncome
														? formatCurrency(
																Number(
																	selectedClient.creditAnalysis
																		.monthlyFixedIncome || 0,
																) +
																	Number(
																		selectedClient.creditAnalysis
																			.monthlyVariableIncome || 0,
																	),
															)
														: "-"}
												</span>
											</div>
										</div>

										<div className="space-y-3 rounded-lg bg-red-50 p-3 dark:bg-red-900/20">
											<h4 className="font-medium text-sm">Gastos Mensuales</h4>
											<div className="flex justify-between text-sm">
												<span className="text-muted-foreground">Fijos:</span>
												<span className="font-medium">
													{selectedClient.creditAnalysis.monthlyFixedExpenses
														? formatCurrency(
																selectedClient.creditAnalysis
																	.monthlyFixedExpenses,
															)
														: "-"}
												</span>
											</div>
											<div className="flex justify-between text-sm">
												<span className="text-muted-foreground">
													Variables:
												</span>
												<span className="font-medium">
													{selectedClient.creditAnalysis.monthlyVariableExpenses
														? formatCurrency(
																selectedClient.creditAnalysis
																	.monthlyVariableExpenses,
															)
														: "-"}
												</span>
											</div>
											<div className="flex justify-between border-t pt-2">
												<span className="font-medium text-sm">Total:</span>
												<span className="font-bold text-red-600">
													{selectedClient.creditAnalysis.monthlyFixedExpenses ||
													selectedClient.creditAnalysis.monthlyVariableExpenses
														? formatCurrency(
																Number(
																	selectedClient.creditAnalysis
																		.monthlyFixedExpenses || 0,
																) +
																	Number(
																		selectedClient.creditAnalysis
																			.monthlyVariableExpenses || 0,
																	),
															)
														: "-"}
												</span>
											</div>
										</div>
									</div>

									{/* Disponibilidad Económica */}
									<div className="rounded-lg bg-blue-50 p-3 dark:bg-blue-900/20">
										<div className="flex items-center justify-between">
											<div>
												<p className="font-medium text-sm">
													Disponibilidad Económica
												</p>
												<p className="text-muted-foreground text-xs">
													Capacidad de ahorro mensual
												</p>
											</div>
											<span className="font-bold text-blue-600 text-xl">
												{selectedClient.creditAnalysis.economicAvailability
													? formatCurrency(
															selectedClient.creditAnalysis
																.economicAvailability,
														)
													: "-"}
											</span>
										</div>
									</div>

									{/* Capacidad de Pago */}
									<div className="grid grid-cols-2 gap-3">
										<div className="rounded-lg border p-3 text-center">
											<p className="text-muted-foreground text-xs">
												Pago Máximo
											</p>
											<p className="mt-1 font-bold text-green-600">
												{selectedClient.creditAnalysis.maxPayment
													? formatCurrency(
															selectedClient.creditAnalysis.maxPayment,
														)
													: "-"}
											</p>
										</div>
										<div className="rounded-lg border bg-primary/5 p-3 text-center">
											<p className="text-muted-foreground text-xs">
												Crédito Máximo
											</p>
											<p className="mt-1 font-bold text-primary">
												{selectedClient.creditAnalysis.maxCreditAmount
													? formatCurrency(
															selectedClient.creditAnalysis.maxCreditAmount,
														)
													: "-"}
											</p>
										</div>
									</div>

									<p className="text-right text-muted-foreground text-xs">
										Análisis realizado:{" "}
										{formatGuatemalaDate(
											selectedClient.creditAnalysis.analyzedAt,
										)}
									</p>
								</div>
							) : (
								<div className="space-y-3 rounded-lg border bg-muted/30 p-4">
									<h3 className="flex items-center gap-2 font-semibold text-base">
										<CreditCard className="h-4 w-4" />
										Análisis de Capacidad de Pago
									</h3>
									<p className="py-2 text-center text-muted-foreground">
										No hay análisis de capacidad de pago registrado.
									</p>
								</div>
							)}
						</div>
					)}
				</DialogContent>
			</Dialog>

			{/* Opportunity Detail Modal */}
			<OpportunityDetailModal
				open={isOpportunityModalOpen}
				onOpenChange={(open) => {
					setIsOpportunityModalOpen(open);
					if (!open) {
						setActiveOpportunityId(null);
						if (search.opportunityId) {
							navigate({ to: "/crm/clients", search: {}, replace: true });
						}
					}
				}}
				opportunity={selectedOpportunityForModal}
				userRole={userProfile.data?.role}
				readOnly
				initialTab={search.initialTab}
				onNavigateToLead={(id: string) => {
					//borrar los search params de oportunidad y agregar el id del lead a la pagina actual de clients
					navigate({
						to: "/crm/clients",
						search: { ...search, idLead: id, opportunityId: undefined },
						replace: true,
					});
				}}
			/>
		</div>
	);
}
