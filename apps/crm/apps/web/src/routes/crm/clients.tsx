import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
	Banknote,
	Briefcase,
	Calendar,
	Car,
	CheckCircle2,
	ChevronLeft,
	ChevronRight,
	CreditCard,
	Eye,
	FileText,
	HandshakeIcon,
	Home,
	Mail,
	Phone,
	Search,
	User,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
	OpportunityDetailModal,
	type OpportunityForModal,
} from "@/components/opportunity-detail-modal";
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
import { authClient } from "@/lib/auth-client";
import { formatGuatemalaDate } from "@/lib/crm-formatters";
import { PERMISSIONS } from "@/lib/roles";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/crm/clients")({
	component: RouteComponent,
});

// Helper functions
const getClientTypeLabel = (type: string) => {
	switch (type) {
		case "individual":
			return "Individual";
		case "comerciante":
			return "Comerciante";
		case "empresa":
			return "Empresa";
		default:
			return type;
	}
};

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

// Type definition for credit analysis
type CreditAnalysisData = {
	leadId: string;
	monthlyFixedIncome: string | null;
	monthlyVariableIncome: string | null;
	monthlyFixedExpenses: string | null;
	monthlyVariableExpenses: string | null;
	economicAvailability: string | null;
	minPayment: string | null;
	maxPayment: string | null;
	adjustedPayment: string | null;
	maxCreditAmount: string | null;
	analyzedAt: Date;
} | null;

// Type definition for client data
type ClientData = {
	id: string;
	firstName: string;
	lastName: string;
	email: string;
	phone: string | null;
	dpi: string | null;
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
};

function RouteComponent() {
	const { data: session, isPending } = authClient.useSession();
	const navigate = Route.useNavigate();
	const [searchTerm, setSearchTerm] = useState("");
	const [debouncedSearch, setDebouncedSearch] = useState("");
	const [page, setPage] = useState(0);
	const pageSize = 20;

	// Modal state
	const [isDetailsDialogOpen, setIsDetailsDialogOpen] = useState(false);
	const [selectedClient, setSelectedClient] = useState<ClientData | null>(null);

	// Opportunity modal state
	const [isOpportunityModalOpen, setIsOpportunityModalOpen] = useState(false);
	const [selectedOpportunityForModal, setSelectedOpportunityForModal] =
		useState<OpportunityForModal | null>(null);

	// Debounce search
	useEffect(() => {
		const timer = setTimeout(() => {
			setDebouncedSearch(searchTerm);
			setPage(0);
		}, 300);
		return () => clearTimeout(timer);
	}, [searchTerm]);

	const userProfile = useQuery(orpc.getUserProfile.queryOptions());

	const clientsQuery = useQuery({
		...orpc.getLeadsAsClients.queryOptions({
			input: {
				limit: pageSize,
				offset: page * pageSize,
				search: debouncedSearch || undefined,
			},
		}),
		enabled:
			!!userProfile.data?.role &&
			PERMISSIONS.canAccessCRM(userProfile.data.role) &&
			!!session?.user?.id,
		queryKey: [
			"getLeadsAsClients",
			session?.user?.id,
			userProfile.data?.role,
			page,
			pageSize,
			debouncedSearch,
		],
	});

	// Query para estadísticas globales (no paginadas)
	const statsQuery = useQuery({
		...orpc.getLeadsAsClientsStats.queryOptions(),
		enabled:
			!!userProfile.data?.role &&
			PERMISSIONS.canAccessCRM(userProfile.data.role) &&
			!!session?.user?.id,
		queryKey: [
			"getLeadsAsClientsStats",
			session?.user?.id,
			userProfile.data?.role,
		],
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
	}, [session, isPending, userProfile.data?.role, navigate]);

	const handleViewDetails = (client: ClientData) => {
		setSelectedClient(client);
		setIsDetailsDialogOpen(true);
	};

	if (isPending || userProfile.isPending) {
		return (
			<div className="flex items-center justify-center p-12">Cargando...</div>
		);
	}

	if (
		!userProfile.data?.role ||
		!PERMISSIONS.canAccessCRM(userProfile.data.role)
	) {
		return null;
	}

	const clients = (clientsQuery.data?.data || []) as ClientData[];
	const totalRecords = clientsQuery.data?.total || 0;
	const totalPages = Math.ceil(totalRecords / pageSize);

	return (
		<div className="container mx-auto space-y-6 p-6">
			<div>
				<h1 className="font-bold text-3xl">Cartera de Clientes</h1>
				<p className="text-muted-foreground">
					Leads con oportunidades cerradas
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
							Leads con créditos cerrados
						</p>
					</CardContent>
				</Card>
				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="font-medium text-sm">
							Oportunidades Cerradas
						</CardTitle>
						<CheckCircle2 className="h-4 w-4 text-green-500" />
					</CardHeader>
					<CardContent>
						<div className="font-bold text-2xl">
							{statsQuery.data?.totalClosedOpportunities ?? 0}
						</div>
						<p className="text-muted-foreground text-xs">
							Total de créditos activos
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
							Q{(statsQuery.data?.totalValue ?? 0).toLocaleString()}
						</div>
						<p className="text-muted-foreground text-xs">
							En créditos cerrados
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
								Leads que tienen al menos una oportunidad cerrada
							</CardDescription>
						</div>
					</div>
				</CardHeader>
				<CardContent>
					{/* Search Filter */}
					<div className="mb-6">
						<div className="relative max-w-md">
							<Search className="absolute top-2.5 left-2 h-4 w-4 text-muted-foreground" />
							<Input
								placeholder="Buscar por nombre, email, teléfono o DPI..."
								value={searchTerm}
								onChange={(e) => setSearchTerm(e.target.value)}
								className="pl-8"
							/>
						</div>
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
								Los clientes aparecerán aquí cuando los leads tengan
								oportunidades en etapa al 100%
							</p>
						</div>
					) : (
						<>
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Cliente</TableHead>
										<TableHead>Contacto</TableHead>
										<TableHead>Tipo</TableHead>
										<TableHead>Oportunidades Cerradas</TableHead>
										<TableHead>Valor Total</TableHead>
										<TableHead>Desde</TableHead>
										<TableHead className="text-right">Acciones</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{clients.map((clientData) => (
										<TableRow
											key={clientData.id}
											className="cursor-pointer hover:bg-muted/50"
											onClick={() => handleViewDetails(clientData)}
										>
											<TableCell>
												<div className="flex items-center gap-2">
													<User className="h-4 w-4 text-muted-foreground" />
													<div>
														<div className="font-medium">
															{clientData.firstName} {clientData.lastName}
														</div>
														{clientData.dpi && (
															<div className="text-muted-foreground text-xs">
																DPI: {clientData.dpi}
															</div>
														)}
													</div>
												</div>
											</TableCell>
											<TableCell>
												<div className="space-y-1">
													<div className="text-sm">{clientData.email}</div>
													{clientData.phone && (
														<div className="flex items-center gap-1 text-muted-foreground text-xs">
															<Phone className="h-3 w-3" />
															{clientData.phone}
														</div>
													)}
												</div>
											</TableCell>
											<TableCell>
												<Badge variant="outline" className="capitalize">
													{getClientTypeLabel(clientData.clientType)}
												</Badge>
											</TableCell>
											<TableCell>
												<TooltipProvider>
													<Tooltip>
														<TooltipTrigger asChild>
															<div className="flex items-center gap-2">
																<Badge
																	variant="secondary"
																	className="bg-green-100 text-green-800"
																>
																	{clientData.closedOpportunitiesCount}{" "}
																	cerrada(s)
																</Badge>
																{clientData.opportunities.length >
																	clientData.closedOpportunitiesCount && (
																	<Badge variant="outline">
																		+
																		{clientData.opportunities.length -
																			clientData.closedOpportunitiesCount}{" "}
																		abierta(s)
																	</Badge>
																)}
															</div>
														</TooltipTrigger>
														<TooltipContent side="bottom" className="max-w-sm">
															<div className="space-y-2">
																<p className="font-medium">Oportunidades:</p>
																{clientData.opportunities.map((opp) => (
																	<div
																		key={opp.id}
																		className="flex items-center gap-2 text-sm"
																	>
																		{opp.isClosed ? (
																			<CheckCircle2 className="h-3 w-3 text-green-500" />
																		) : (
																			<FileText className="h-3 w-3 text-muted-foreground" />
																		)}
																		<span>{opp.title}</span>
																		{opp.numeroSifco && (
																			<Badge
																				variant="outline"
																				className="text-xs"
																			>
																				Crédito: {opp.numeroSifco}
																			</Badge>
																		)}
																	</div>
																))}
															</div>
														</TooltipContent>
													</Tooltip>
												</TooltipProvider>
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
			<Dialog open={isDetailsDialogOpen} onOpenChange={setIsDetailsDialogOpen}>
				<DialogContent className="max-h-[85vh] min-w-[900px] max-w-6xl overflow-y-auto">
					<DialogHeader>
						<DialogTitle>Detalles del Cliente</DialogTitle>
					</DialogHeader>
					{selectedClient && (
						<div className="space-y-6">
							{/* Header con nombre y badges */}
							<div className="flex items-start justify-between">
								<div>
									<h3 className="font-semibold text-xl">
										{selectedClient.firstName} {selectedClient.lastName}
									</h3>
									<p className="text-muted-foreground">
										{selectedClient.email}
									</p>
								</div>
								<div className="flex items-center gap-2">
									<Badge variant="outline" className="text-sm">
										{getClientTypeLabel(selectedClient.clientType)}
									</Badge>
									<Badge className="bg-green-500 hover:bg-green-600">
										Cliente Activo
									</Badge>
								</div>
							</div>

							{/* Información Personal y de Contacto */}
							<div className="grid grid-cols-2 gap-6">
								{/* Información Personal */}
								<div className="space-y-3 rounded-lg border bg-muted/30 p-4">
									<h3 className="flex items-center gap-2 font-semibold text-base">
										<User className="h-4 w-4" />
										Información Personal
									</h3>
									<div className="grid grid-cols-2 gap-4">
										<div>
											<Label className="font-medium text-muted-foreground text-sm">
												Nombre Completo
											</Label>
											<p className="font-medium text-sm">
												{selectedClient.firstName} {selectedClient.lastName}
											</p>
										</div>
										<div>
											<Label className="font-medium text-muted-foreground text-sm">
												DPI
											</Label>
											<p className="text-sm">
												{selectedClient.dpi || "No especificado"}
											</p>
										</div>
										<div>
											<Label className="font-medium text-muted-foreground text-sm">
												Edad
											</Label>
											<p className="text-sm">
												{selectedClient.age || "No especificado"}
											</p>
										</div>
										<div>
											<Label className="font-medium text-muted-foreground text-sm">
												Estado Civil
											</Label>
											<p className="text-sm">
												{getMaritalStatusLabel(selectedClient.maritalStatus)}
											</p>
										</div>
										<div>
											<Label className="font-medium text-muted-foreground text-sm">
												Dependientes
											</Label>
											<p className="text-sm">
												{selectedClient.dependents || 0}
											</p>
										</div>
										<div>
											<Label className="font-medium text-muted-foreground text-sm">
												Cargo
											</Label>
											<p className="text-sm">
												{selectedClient.jobTitle || "No especificado"}
											</p>
										</div>
									</div>
								</div>

								{/* Información de Contacto */}
								<div className="space-y-3 rounded-lg border bg-muted/30 p-4">
									<h3 className="flex items-center gap-2 font-semibold text-base">
										<Phone className="h-4 w-4" />
										Información de Contacto
									</h3>
									<div className="space-y-3">
										<div>
											<Label className="font-medium text-muted-foreground text-sm">
												Correo Electrónico
											</Label>
											<div className="flex items-center gap-2">
												<Mail className="h-4 w-4 text-muted-foreground" />
												<p className="text-sm">{selectedClient.email}</p>
											</div>
										</div>
										<div>
											<Label className="font-medium text-muted-foreground text-sm">
												Teléfono
											</Label>
											<div className="flex items-center gap-2">
												<Phone className="h-4 w-4 text-muted-foreground" />
												<p className="text-sm">
													{selectedClient.phone || "No especificado"}
												</p>
											</div>
										</div>
										{selectedClient.assignedUser && (
											<div>
												<Label className="font-medium text-muted-foreground text-sm">
													Asesor Asignado
												</Label>
												<div className="flex items-center gap-2">
													<Briefcase className="h-4 w-4 text-muted-foreground" />
													<p className="text-sm">
														{selectedClient.assignedUser.name}
													</p>
												</div>
											</div>
										)}
									</div>
								</div>
							</div>

							{/* Información Financiera y Laboral */}
							<div className="grid grid-cols-2 gap-6">
								{/* Información Financiera */}
								<div className="space-y-3 rounded-lg border bg-muted/30 p-4">
									<h3 className="flex items-center gap-2 font-semibold text-base">
										<Banknote className="h-4 w-4" />
										Información Financiera
									</h3>
									<div className="grid grid-cols-2 gap-4">
										<div>
											<Label className="font-medium text-muted-foreground text-sm">
												Ingreso Mensual
											</Label>
											<p className="font-medium text-sm">
												{selectedClient.monthlyIncome
													? formatCurrency(selectedClient.monthlyIncome)
													: "No especificado"}
											</p>
										</div>
										<div>
											<Label className="font-medium text-muted-foreground text-sm">
												Monto a Financiar
											</Label>
											<p className="font-medium text-sm">
												{selectedClient.loanAmount
													? formatCurrency(selectedClient.loanAmount)
													: "No especificado"}
											</p>
										</div>
									</div>
								</div>

								{/* Información Laboral */}
								<div className="space-y-3 rounded-lg border bg-muted/30 p-4">
									<h3 className="flex items-center gap-2 font-semibold text-base">
										<Briefcase className="h-4 w-4" />
										Información Laboral
									</h3>
									<div className="grid grid-cols-2 gap-4">
										<div>
											<Label className="font-medium text-muted-foreground text-sm">
												Ocupación
											</Label>
											<p className="text-sm">
												{getOccupationLabel(selectedClient.occupation)}
											</p>
										</div>
										<div>
											<Label className="font-medium text-muted-foreground text-sm">
												Tiempo en el Trabajo
											</Label>
											<p className="text-sm">
												{getWorkTimeLabel(selectedClient.workTime)}
											</p>
										</div>
									</div>
								</div>
							</div>

							{/* Activos */}
							<div className="space-y-3 rounded-lg border bg-muted/30 p-4">
								<h3 className="flex items-center gap-2 font-semibold text-base">
									<Home className="h-4 w-4" />
									Activos
								</h3>
								<div className="flex flex-wrap gap-6">
									<div className="flex items-center gap-2">
										<Checkbox
											checked={selectedClient.ownsHome ?? false}
											disabled
										/>
										<Label className="text-sm">Posee Casa Propia</Label>
									</div>
									<div className="flex items-center gap-2">
										<Checkbox
											checked={selectedClient.ownsVehicle ?? false}
											disabled
										/>
										<Label className="text-sm">Posee Vehículo Propio</Label>
									</div>
									<div className="flex items-center gap-2">
										<Checkbox
											checked={selectedClient.hasCreditCard ?? false}
											disabled
										/>
										<Label className="text-sm">Tiene Tarjeta de Crédito</Label>
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
									{/* Income and Expenses Summary */}
									<div className="grid grid-cols-2 gap-6">
										<div className="space-y-4">
											<h4 className="font-medium text-base">
												Ingresos Mensuales
											</h4>
											<div className="space-y-3 rounded-lg bg-green-50 p-4">
												<div className="flex justify-between">
													<span className="text-muted-foreground text-sm">
														Ingresos Fijos:
													</span>
													<span className="font-medium">
														{selectedClient.creditAnalysis.monthlyFixedIncome
															? formatCurrency(
																	selectedClient.creditAnalysis
																		.monthlyFixedIncome,
																)
															: "-"}
													</span>
												</div>
												<div className="flex justify-between">
													<span className="text-muted-foreground text-sm">
														Ingresos Variables:
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
												<div className="border-t pt-2">
													<div className="flex justify-between">
														<span className="font-medium">Total Ingresos:</span>
														<span className="font-bold text-green-600">
															{selectedClient.creditAnalysis
																.monthlyFixedIncome ||
															selectedClient.creditAnalysis
																.monthlyVariableIncome
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
											</div>
										</div>

										<div className="space-y-4">
											<h4 className="font-medium text-base">
												Gastos Mensuales
											</h4>
											<div className="space-y-3 rounded-lg bg-red-50 p-4">
												<div className="flex justify-between">
													<span className="text-muted-foreground text-sm">
														Gastos Fijos:
													</span>
													<span className="font-medium">
														{selectedClient.creditAnalysis.monthlyFixedExpenses
															? formatCurrency(
																	selectedClient.creditAnalysis
																		.monthlyFixedExpenses,
																)
															: "-"}
													</span>
												</div>
												<div className="flex justify-between">
													<span className="text-muted-foreground text-sm">
														Gastos Variables:
													</span>
													<span className="font-medium">
														{selectedClient.creditAnalysis
															.monthlyVariableExpenses
															? formatCurrency(
																	selectedClient.creditAnalysis
																		.monthlyVariableExpenses,
																)
															: "-"}
													</span>
												</div>
												<div className="border-t pt-2">
													<div className="flex justify-between">
														<span className="font-medium">Total Gastos:</span>
														<span className="font-bold text-red-600">
															{selectedClient.creditAnalysis
																.monthlyFixedExpenses ||
															selectedClient.creditAnalysis
																.monthlyVariableExpenses
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
										</div>
									</div>

									{/* Economic Availability */}
									<div className="rounded-lg bg-blue-50 p-4">
										<div className="flex items-center justify-between">
											<div>
												<Label className="font-medium text-muted-foreground text-sm">
													Disponibilidad Económica
												</Label>
												<p className="text-muted-foreground text-sm">
													Capacidad de ahorro mensual
												</p>
											</div>
											<span className="font-bold text-2xl text-blue-600">
												{selectedClient.creditAnalysis.economicAvailability
													? formatCurrency(
															selectedClient.creditAnalysis
																.economicAvailability,
														)
													: "-"}
											</span>
										</div>
									</div>

									{/* Payment Capacity */}
									<div className="space-y-4">
										<h4 className="font-medium text-base">Capacidad de Pago</h4>
										<div className="grid grid-cols-4 gap-4">
											<div className="rounded-lg border p-4 text-center">
												<Label className="text-muted-foreground text-xs">
													Pago Mínimo
												</Label>
												<p className="mt-1 font-bold text-lg text-orange-600">
													{selectedClient.creditAnalysis.minPayment
														? formatCurrency(
																selectedClient.creditAnalysis.minPayment,
															)
														: "-"}
												</p>
											</div>
											<div className="rounded-lg border p-4 text-center">
												<Label className="text-muted-foreground text-xs">
													Pago Ajustado
												</Label>
												<p className="mt-1 font-bold text-blue-600 text-lg">
													{selectedClient.creditAnalysis.adjustedPayment
														? formatCurrency(
																selectedClient.creditAnalysis.adjustedPayment,
															)
														: "-"}
												</p>
											</div>
											<div className="rounded-lg border p-4 text-center">
												<Label className="text-muted-foreground text-xs">
													Pago Máximo
												</Label>
												<p className="mt-1 font-bold text-green-600 text-lg">
													{selectedClient.creditAnalysis.maxPayment
														? formatCurrency(
																selectedClient.creditAnalysis.maxPayment,
															)
														: "-"}
												</p>
											</div>
											<div className="rounded-lg border bg-primary/5 p-4 text-center">
												<Label className="text-muted-foreground text-xs">
													Crédito Máximo
												</Label>
												<p className="mt-1 font-bold text-lg text-primary">
													{selectedClient.creditAnalysis.maxCreditAmount
														? formatCurrency(
																selectedClient.creditAnalysis.maxCreditAmount,
															)
														: "-"}
												</p>
											</div>
										</div>
									</div>

									{/* Analysis Date */}
									<div className="text-right text-muted-foreground text-sm">
										Análisis realizado:{" "}
										{formatGuatemalaDate(
											selectedClient.creditAnalysis.analyzedAt,
										)}
									</div>
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

							{/* Resumen Financiero */}
							<div className="grid grid-cols-3 gap-4">
								<div className="rounded-lg border bg-green-50 p-4 text-center">
									<Label className="text-muted-foreground text-xs">
										Oportunidades Cerradas
									</Label>
									<p className="mt-1 font-bold text-2xl text-green-600">
										{selectedClient.closedOpportunitiesCount}
									</p>
								</div>
								<div className="rounded-lg border bg-blue-50 p-4 text-center">
									<Label className="text-muted-foreground text-xs">
										Total Oportunidades
									</Label>
									<p className="mt-1 font-bold text-2xl text-blue-600">
										{selectedClient.opportunities.length}
									</p>
								</div>
								<div className="rounded-lg border bg-purple-50 p-4 text-center">
									<Label className="text-muted-foreground text-xs">
										Valor Total Cerrado
									</Label>
									<p className="mt-1 font-bold text-purple-600 text-xl">
										{formatCurrency(selectedClient.totalClosedValue)}
									</p>
								</div>
							</div>

							{/* Oportunidades del Cliente */}
							<div className="space-y-4">
								<h3 className="flex items-center gap-2 font-semibold text-base">
									<FileText className="h-4 w-4" />
									Oportunidades
								</h3>
								<div className="space-y-3">
									{selectedClient.opportunities.map((opp) => (
										<div
											key={opp.id}
											className={`rounded-lg border p-4 transition-colors ${
												opp.isClosed
													? "border-green-200 bg-green-50/50"
													: "bg-muted/30"
											}`}
										>
											<div className="flex items-start justify-between">
												<div className="flex-1 space-y-2">
													<div className="flex items-center gap-3">
														{opp.isClosed ? (
															<CheckCircle2 className="h-5 w-5 text-green-500" />
														) : (
															<FileText className="h-5 w-5 text-muted-foreground" />
														)}
														<span className="font-semibold">{opp.title}</span>
														{opp.stage && (
															<Badge
																style={{
																	backgroundColor: opp.stage.color || "#888",
																	color: "#fff",
																}}
															>
																{opp.stage.name} ({opp.stage.closurePercentage}
																%)
															</Badge>
														)}
														{opp.isClosed && (
															<Badge className="bg-green-500">Cerrada</Badge>
														)}
													</div>
													<div className="ml-8 flex flex-wrap items-center gap-4 text-sm">
														<div className="flex items-center gap-1">
															<Banknote className="h-4 w-4 text-muted-foreground" />
															<span className="font-medium">
																{formatCurrency(opp.value)}
															</span>
														</div>
														<div className="flex items-center gap-1">
															<Badge variant="outline">
																{opp.creditType === "autocompra"
																	? "Autocompra"
																	: "Sobre Vehículo"}
															</Badge>
														</div>
														{opp.numeroSifco && (
															<div className="flex items-center gap-1">
																<Badge
																	variant="secondary"
																	className="bg-blue-100 text-blue-800"
																>
																	Crédito: {opp.numeroSifco}
																</Badge>
															</div>
														)}
														<div className="flex items-center gap-1 text-muted-foreground">
															<Calendar className="h-3 w-3" />
															{formatGuatemalaDate(opp.createdAt)}
														</div>
													</div>
												</div>
												<Button
													variant="outline"
													size="sm"
													onClick={() => {
														// Convertir la oportunidad al tipo esperado por el modal
														const opportunityForModal: OpportunityForModal = {
															id: opp.id,
															title: opp.title,
															value: opp.value,
															creditType: opp.creditType,
															status: opp.status,
															expectedCloseDate: null,
															createdAt: opp.createdAt,
															lead: selectedClient
																? {
																		id: selectedClient.id,
																		firstName: selectedClient.firstName,
																		lastName: selectedClient.lastName,
																		email: selectedClient.email,
																		phone: selectedClient.phone,
																		dpi: selectedClient.dpi,
																	}
																: null,
															stage: opp.stage
																? {
																		id: opp.stage.id,
																		name: opp.stage.name,
																		closurePercentage: opp.stage.closurePercentage,
																		color: opp.stage.color || "#888",
																	}
																: null,
														};
														setSelectedOpportunityForModal(opportunityForModal);
														setIsOpportunityModalOpen(true);
													}}
													className="ml-4 shrink-0"
												>
													<Eye className="mr-1 h-4 w-4" />
													Ver Oportunidad
												</Button>
											</div>
										</div>
									))}
								</div>
							</div>
						</div>
					)}
				</DialogContent>
			</Dialog>

			{/* Opportunity Detail Modal */}
			<OpportunityDetailModal
				open={isOpportunityModalOpen}
				onOpenChange={setIsOpportunityModalOpen}
				opportunity={selectedOpportunityForModal}
				userRole={userProfile.data?.role}
				readOnly
			/>
		</div>
	);
}
