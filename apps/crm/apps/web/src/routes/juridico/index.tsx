import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import {
	Banknote,
	CheckCircle,
	FilePlus2,
	FileSignature,
	FileText,
	Loader2,
	MoreHorizontal,
	Scale,
	Search,
	Settings,
	Target,
	User,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ApproveOpportunityModal } from "@/components/juridico/ApproveOpportunityModal";
import {
	LeadDetailModal,
	type LeadForModal,
} from "@/components/lead-detail-modal";
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
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useJuridicoPermissions } from "@/hooks/usePermissions";
import { client, orpc } from "@/utils/orpc";

export const Route = createFileRoute("/juridico/")({
	component: RouteComponent,
});

function RouteComponent() {
	const navigate = Route.useNavigate();
	const queryClient = useQueryClient();
	const {
		canViewLegal,
		canApproveLegalStage,
		isLoading: isLoadingPermissions,
	} = useJuridicoPermissions();
	const [searchQuery, setSearchQuery] = useState("");
	const [opportunitiesSearchQuery, setOpportunitiesSearchQuery] = useState("");
	const [isApproveModalOpen, setIsApproveModalOpen] = useState(false);
	const [opportunityToApprove, setOpportunityToApprove] = useState<{
		id: string;
		title: string;
	} | null>(null);

	// Mutación para aprobar oportunidad (mover a 85%)
	const approveMutation = useMutation({
		mutationFn: async (opportunityId: string) => {
			return await client.approveOpportunityLegal({ opportunityId });
		},
		onSuccess: (data) => {
			toast.success(data.message);
			queryClient.invalidateQueries({
				queryKey: ["getOpportunitiesForContracts"],
			});
		},
		onError: (error: Error) => {
			toast.error(error.message || "Error al aprobar la oportunidad");
		},
	});

	// Modal states
	const [selectedOpportunityId, setSelectedOpportunityId] = useState<
		string | null
	>(null);
	const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
	const [isOpportunityModalOpen, setIsOpportunityModalOpen] = useState(false);
	const [isLeadModalOpen, setIsLeadModalOpen] = useState(false);

	// Obtener oportunidades listas para contratos (90%+)
	const { data: leadsWithContracts, isLoading } = useQuery({
		...orpc.getOpportunitiesForContracts.queryOptions({
			input: { closurePercentages: [90, 85] },
		}),

		enabled: canViewLegal,
	});

	// Obtener oportunidades listas para contratos (80%+)
	const { data: opportunitiesForContracts, isLoading: isLoadingOpportunities } =
		useQuery({
			...orpc.getOpportunitiesForContracts.queryOptions({ input: {} }),
			enabled: canViewLegal,
		});

	// Query para obtener el lead completo cuando se selecciona
	const selectedLeadQuery = useQuery({
		queryKey: ["getLeadById", selectedLeadId],
		queryFn: () =>
			selectedLeadId ? client.getLeadById({ leadId: selectedLeadId }) : null,
		enabled: !!selectedLeadId && isLeadModalOpen,
	});

	// Redireccionar si no tiene permisos
	if (!isLoadingPermissions && !canViewLegal) {
		navigate({ to: "/dashboard" });
		return null;
	}

	// Filtrar leads por búsqueda
	const filteredLeads = leadsWithContracts?.filter(
		(lead) =>
			lead?.lead.firstName.toLowerCase().includes(searchQuery.toLowerCase()) ||
			lead.lead.lastName.toLowerCase().includes(searchQuery.toLowerCase()) ||
			lead.lead.dpi?.toLowerCase().includes(searchQuery.toLowerCase()) ||
			lead.lead.email?.toLowerCase().includes(searchQuery.toLowerCase()),
	);

	// Filtrar oportunidades por búsqueda
	const filteredOpportunities = opportunitiesForContracts?.filter(
		(opp) =>
			opp.title
				.toLowerCase()
				.includes(opportunitiesSearchQuery.toLowerCase()) ||
			opp.lead.firstName
				.toLowerCase()
				.includes(opportunitiesSearchQuery.toLowerCase()) ||
			opp.lead.lastName
				.toLowerCase()
				.includes(opportunitiesSearchQuery.toLowerCase()) ||
			opp.lead.dpi
				?.toLowerCase()
				.includes(opportunitiesSearchQuery.toLowerCase()),
	);

	// Find opportunity data from the list
	const selectedOpportunityData =
		opportunitiesForContracts?.find(
			(opp) => opp.id === selectedOpportunityId,
		) || leadsWithContracts?.find((lead) => lead.id === selectedOpportunityId);

	// Transform opportunity data for modal
	const selectedOpportunity: OpportunityForModal | null =
		selectedOpportunityData
			? {
					id: selectedOpportunityData.id,
					title: selectedOpportunityData.title,
					value: selectedOpportunityData.value,
					creditType: selectedOpportunityData.creditType,
					status: selectedOpportunityData.status,
					expectedCloseDate: selectedOpportunityData.expectedCloseDate,
					createdAt: selectedOpportunityData.createdAt,
					lead: selectedOpportunityData.lead
						? {
								id: selectedOpportunityData.lead.id,
								firstName: selectedOpportunityData.lead.firstName,
								lastName: selectedOpportunityData.lead.lastName,
								dpi: selectedOpportunityData.lead.dpi,
								email: selectedOpportunityData.lead.email,
								phone: selectedOpportunityData.lead.phone,
							}
						: null,
					stage: selectedOpportunityData.stage,
					assignedUser: selectedOpportunityData.assignedUser,
					vehicle: selectedOpportunityData.vehicle?.id
						? {
								id: selectedOpportunityData.vehicle.id,
								make: selectedOpportunityData.vehicle.make,
								model: selectedOpportunityData.vehicle.model,
								year: selectedOpportunityData.vehicle.year,
								licensePlate: selectedOpportunityData.vehicle.licensePlate,
								color: selectedOpportunityData.vehicle.color,
								isNew: selectedOpportunityData.vehicle.isNew,
							}
						: null,
				}
			: null;

	// Transform lead data for modal (using available fields from getLeadById)
	const selectedLead: LeadForModal | null = selectedLeadQuery.data
		? {
				id: selectedLeadQuery.data.id,
				firstName: selectedLeadQuery.data.firstName,
				lastName: selectedLeadQuery.data.lastName,
				email: selectedLeadQuery.data.email,
				phone: selectedLeadQuery.data.phone,
				dpi: selectedLeadQuery.data.dpi,
				source: selectedLeadQuery.data.source,
				status: selectedLeadQuery.data.status,
				createdAt: selectedLeadQuery.data.createdAt,
				company: selectedLeadQuery.data.company,
				assignedUser: selectedLeadQuery.data.assignedUser,
			}
		: null;

	const handleOpenOpportunityModal = (opportunityId: string) => {
		setSelectedOpportunityId(opportunityId);
		setIsOpportunityModalOpen(true);
	};

	const handleOpenLeadModal = (leadId: string) => {
		setSelectedLeadId(leadId);
		setIsLeadModalOpen(true);
	};

	const handleCloseOpportunityModal = (open: boolean) => {
		setIsOpportunityModalOpen(open);
		if (!open) {
			setSelectedOpportunityId(null);
		}
	};

	const handleCloseLeadModal = (open: boolean) => {
		setIsLeadModalOpen(open);
		if (!open) {
			setSelectedLeadId(null);
		}
	};

	return (
		<div className="container mx-auto space-y-6 py-8">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-3">
					<div className="flex h-12 w-12 items-center justify-center rounded-lg bg-amber-100">
						<Scale className="h-6 w-6 text-amber-600" />
					</div>
					<div>
						<h1 className="font-bold text-3xl">Jurídico</h1>
						<p className="text-muted-foreground">
							Gestión de contratos y documentos legales
						</p>
					</div>
				</div>
			</div>

			{/* Stats Cards */}
			<div className="grid gap-4 md:grid-cols-4">
				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="font-medium text-sm">
							Oportunidades Listas
						</CardTitle>
						<Target className="h-4 w-4 text-muted-foreground" />
					</CardHeader>
					<CardContent>
						<div className="font-bold text-2xl">
							{opportunitiesForContracts?.length || 0}
						</div>
						<p className="text-muted-foreground text-xs">Al 80%+ de cierre</p>
					</CardContent>
				</Card>

				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="font-medium text-sm">
							Total de Personas
						</CardTitle>
						<User className="h-4 w-4 text-muted-foreground" />
					</CardHeader>
					<CardContent>
						<div className="font-bold text-2xl">
							{leadsWithContracts?.length || 0}
						</div>
						<p className="text-muted-foreground text-xs">
							Con contratos registrados
						</p>
					</CardContent>
				</Card>

				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="font-medium text-sm">
							Total de Contratos
						</CardTitle>
						<FileText className="h-4 w-4 text-muted-foreground" />
					</CardHeader>
					<CardContent>
						<div className="font-bold text-2xl">
							{leadsWithContracts?.reduce(
								(sum, lead) => sum + lead.contractCount,
								0,
							) || 0}
						</div>
						<p className="text-muted-foreground text-xs">En el sistema</p>
					</CardContent>
				</Card>

				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="font-medium text-sm">
							Generación Reciente
						</CardTitle>
						<FileText className="h-4 w-4 text-muted-foreground" />
					</CardHeader>
					<CardContent>
						<div className="font-bold text-2xl">
							{leadsWithContracts?.filter((lead) => {
								if (!lead.latestContractDate) return false;
								const daysSince =
									(Date.now() - new Date(lead.latestContractDate).getTime()) /
									(1000 * 60 * 60 * 24);
								return daysSince <= 7;
							}).length || 0}
						</div>
						<p className="text-muted-foreground text-xs">Últimos 7 días</p>
					</CardContent>
				</Card>
			</div>

			{/* Tabs for different views */}
			<Tabs defaultValue="opportunities" className="w-full">
				<TabsList className="grid w-full grid-cols-2">
					<TabsTrigger
						value="opportunities"
						className="flex items-center gap-2"
					>
						<Target className="h-4 w-4" />
						Oportunidades Listas
					</TabsTrigger>
					<TabsTrigger value="contracts" className="flex items-center gap-2">
						<FileSignature className="h-4 w-4" />
						Personas con Contratos
					</TabsTrigger>
				</TabsList>

				{/* Oportunidades Listas Tab */}
				<TabsContent value="opportunities">
					<Card>
						<CardHeader>
							<CardTitle>Oportunidades Listas para Contratos</CardTitle>
							<CardDescription>
								Oportunidades al 80% o más de cierre que requieren contratos
								legales
							</CardDescription>

							{/* Barra de búsqueda */}
							<div className="relative">
								<Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
								<Input
									placeholder="Buscar por título, nombre o DPI..."
									value={opportunitiesSearchQuery}
									onChange={(e) => setOpportunitiesSearchQuery(e.target.value)}
									className="pl-9"
								/>
							</div>
						</CardHeader>
						<CardContent>
							{isLoadingOpportunities ? (
								<div className="flex items-center justify-center py-8">
									<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
								</div>
							) : filteredOpportunities && filteredOpportunities.length > 0 ? (
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>Oportunidad</TableHead>
											<TableHead>Cliente</TableHead>
											<TableHead>Etapa</TableHead>
											<TableHead className="text-right">Valor</TableHead>
											<TableHead className="text-center">Contratos</TableHead>
											<TableHead className="text-right">Acciones</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{filteredOpportunities.map((opp) => (
											<TableRow
												key={opp.id}
												className="cursor-pointer hover:bg-muted/50"
												onClick={() =>
													navigate({
														to: `/juridico/${opp.lead.id}?opportunityId=${opp.id}`,
													})
												}
											>
												<TableCell>
													<div className="text-sm">
														<button
															type="button"
															className="cursor-pointer text-left font-medium text-primary hover:underline"
															onClick={(e) => {
																e.stopPropagation();
																handleOpenOpportunityModal(opp.id);
															}}
														>
															{opp.title}
														</button>
														<div className="text-muted-foreground">
															{opp.creditType === "autocompra"
																? "Autocompra"
																: "Sobre Vehículo"}
														</div>
													</div>
												</TableCell>
												<TableCell>
													<div className="text-sm">
														<button
															type="button"
															className="cursor-pointer text-left font-medium text-primary hover:underline"
															onClick={(e) => {
																e.stopPropagation();
																handleOpenLeadModal(opp.lead.id);
															}}
														>
															{opp.lead.firstName} {opp.lead.lastName}
														</button>
														<div className="font-mono text-muted-foreground text-xs">
															{opp.lead.dpi || "Sin DPI"}
														</div>
													</div>
												</TableCell>
												<TableCell>
													<Badge
														style={{
															backgroundColor: opp.stage.color,
															color: "white",
														}}
													>
														{opp.stage.name} ({opp.stage.closurePercentage}%)
													</Badge>
												</TableCell>
												<TableCell className="text-right">
													<div className="flex items-center justify-end gap-1 font-medium text-green-600">
														<Banknote className="h-4 w-4" />Q
														{Number.parseFloat(
															opp.value || "0",
														).toLocaleString()}
													</div>
												</TableCell>
												<TableCell className="text-center">
													<Badge
														variant={
															opp.contractCount > 0 ? "default" : "secondary"
														}
													>
														{opp.contractCount}
													</Badge>
												</TableCell>
												<TableCell className="text-right">
													<DropdownMenu>
														<DropdownMenuTrigger asChild>
															<Button
																variant="ghost"
																size="sm"
																className="h-8 w-8 p-0"
																onClick={(e) => e.stopPropagation()}
															>
																<MoreHorizontal className="h-4 w-4" />
															</Button>
														</DropdownMenuTrigger>
														<DropdownMenuContent align="end">
															<DropdownMenuItem asChild>
																<Link
																	to="/juridico/$leadId"
																	params={{ leadId: opp.lead.id }}
																	search={{ opportunityId: opp.id }}
																	className="cursor-pointer"
																>
																	<Settings className="mr-2 h-4 w-4" />
																	Gestionar
																</Link>
															</DropdownMenuItem>
															{opp.stage.closurePercentage === 80 && (
																<DropdownMenuItem asChild>
																	<Link
																		to="/juridico/generate/$opportunityId"
																		params={{ opportunityId: opp.id }}
																		className="cursor-pointer"
																		onClick={(e) => e.stopPropagation()}
																	>
																		<FilePlus2 className="mr-2 h-4 w-4" />
																		Generar Contratos
																	</Link>
																</DropdownMenuItem>
															)}
															{canApproveLegalStage &&
																opp.stage.closurePercentage === 80 && (
																	<DropdownMenuItem
																		onClick={(e) => {
																			e.stopPropagation();
																			setOpportunityToApprove({
																				id: opp.id,
																				title: opp.title,
																			});
																			setIsApproveModalOpen(true);
																		}}
																		disabled={opp.contractCount === 0}
																		className="cursor-pointer"
																	>
																		<CheckCircle className="mr-2 h-4 w-4" />
																		Aprobar (→ 85%)
																	</DropdownMenuItem>
																)}
														</DropdownMenuContent>
													</DropdownMenu>
												</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
							) : (
								<div className="flex flex-col items-center justify-center py-12 text-center">
									<Target className="mb-3 h-12 w-12 text-gray-400" />
									<h3 className="mb-1 font-semibold text-gray-900 text-lg">
										{opportunitiesSearchQuery
											? "No se encontraron resultados"
											: "No hay oportunidades listas"}
									</h3>
									<p className="text-gray-500 text-sm">
										{opportunitiesSearchQuery
											? "Intenta con otros términos de búsqueda"
											: "Las oportunidades al 80% o más aparecerán aquí"}
									</p>
								</div>
							)}
						</CardContent>
					</Card>
				</TabsContent>

				{/* Personas con Contratos Tab */}
				<TabsContent value="contracts">
					<Card>
						<CardHeader>
							<CardTitle>Personas con Contratos</CardTitle>
							<CardDescription>
								Lista de personas que tienen contratos legales registrados
							</CardDescription>

							{/* Barra de búsqueda */}
							<div className="relative">
								<Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
								<Input
									placeholder="Buscar por nombre, DPI o email..."
									value={searchQuery}
									onChange={(e) => setSearchQuery(e.target.value)}
									className="pl-9"
								/>
							</div>
						</CardHeader>
						<CardContent>
							{isLoading ? (
								<div className="flex items-center justify-center py-8">
									<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
								</div>
							) : filteredLeads && filteredLeads.length > 0 ? (
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>Nombre</TableHead>
											<TableHead>DPI</TableHead>
											<TableHead>Contacto</TableHead>
											<TableHead className="text-center">Contratos</TableHead>
											<TableHead>Último Contrato</TableHead>
											<TableHead className="text-right">Acciones</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{filteredLeads.map((opp) => (
											<TableRow
												key={opp.id}
												className="cursor-pointer hover:bg-muted/50"
												onClick={() =>
													navigate({
														to: `/juridico/${opp.lead.id}?opportunityId=${opp.id}`,
													})
												}
											>
												<TableCell>
													<button
														type="button"
														className="cursor-pointer text-left font-medium text-primary hover:underline"
														onClick={(e) => {
															e.stopPropagation();
															handleOpenOpportunityModal(opp.id);
														}}
													>
														{opp.lead.firstName} {opp.lead.lastName}
													</button>
												</TableCell>
												<TableCell className="font-mono text-sm">
													{opp.lead.dpi || "N/A"}
												</TableCell>
												<TableCell>
													<div className="text-sm">
														<div>{opp.lead.email || "Sin email"}</div>
														<div className="text-muted-foreground">
															{opp.lead.phone || "Sin teléfono"}
														</div>
													</div>
												</TableCell>
												<TableCell className="text-center">
													<Badge variant="outline">{opp.contractCount}</Badge>
												</TableCell>
												<TableCell>
													{opp.latestContractDate ? (
														<div className="text-sm">
															<div>
																{format(
																	new Date(opp.latestContractDate),
																	"dd MMM yyyy",
																	{ locale: es },
																)}
															</div>
															<div className="text-muted-foreground">
																{opp.latestContractName}
															</div>
														</div>
													) : (
														<span className="text-muted-foreground text-sm">
															N/A
														</span>
													)}
												</TableCell>
												<TableCell className="text-right">
													<Link
														to="/juridico/$leadId"
														params={{ leadId: opp.lead.id }}
														search={{ opportunityId: opp.id }}
														className="font-medium text-primary text-sm hover:underline"
														onClick={(e) => e.stopPropagation()}
													>
														Ver detalles →
													</Link>
												</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
							) : (
								<div className="flex flex-col items-center justify-center py-12 text-center">
									<FileText className="mb-3 h-12 w-12 text-gray-400" />
									<h3 className="mb-1 font-semibold text-gray-900 text-lg">
										{searchQuery
											? "No se encontraron resultados"
											: "No hay contratos registrados"}
									</h3>
									<p className="text-gray-500 text-sm">
										{searchQuery
											? "Intenta con otros términos de búsqueda"
											: "Los contratos registrados aparecerán aquí"}
									</p>
								</div>
							)}
						</CardContent>
					</Card>
				</TabsContent>
			</Tabs>

			{/* Opportunity Detail Modal */}
			<OpportunityDetailModal
				open={isOpportunityModalOpen}
				onOpenChange={handleCloseOpportunityModal}
				opportunity={selectedOpportunity}
				userRole="juridico"
				readOnly
			/>

			{/* Modal de confirmación para aprobar */}
			<ApproveOpportunityModal
				open={isApproveModalOpen}
				onOpenChange={setIsApproveModalOpen}
				onConfirm={() => {
					if (opportunityToApprove) {
						approveMutation.mutate(opportunityToApprove.id);
						setIsApproveModalOpen(false);
						setOpportunityToApprove(null);
					}
				}}
				isLoading={approveMutation.isPending}
				opportunityTitle={opportunityToApprove?.title}
			/>
		</div>
	);
}
