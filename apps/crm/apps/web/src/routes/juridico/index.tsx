import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import {
	Banknote,
	CheckCircle,
	FilePlus2,
	FileText,
	Landmark,
	Loader2,
	MoreHorizontal,
	Scale,
	Search,
	Settings,
	Target,
	User,
} from "lucide-react";
import { useState } from "react";
import {
	ETAPAS_POR_ACCION,
	etapaPermite,
} from "server/src/lib/contratos-anulacion";
import { toast } from "sonner";
import { DescartarBateria } from "@/components/inversiones/DescartarBateria";
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

/**
 * Los estados que jurídico ve, como el 80 y el 85 en ventas: las que está
 * armando y las que ya mandó y esperan firmas.
 *
 * Cerradas y descartadas no: ya no son trabajo de jurídico. Una cerrada tiene
 * todo firmado y no admite cambios; una descartada no llevaba papelería.
 */
const ESTADOS_DE_BATERIA = ["pendiente", "en_proceso"] as const;

type EstadoDeBateria = (typeof ESTADOS_DE_BATERIA)[number];

const ESTADO_DE_BATERIA: Record<string, string> = {
	pendiente: "Pendientes",
	en_proceso: "Por firmar",
};

export const Route = createFileRoute("/juridico/")({
	component: RouteComponent,
});

type EtapaDeJuridico = (typeof ETAPAS_POR_ACCION.reemplazar)[number];

const ETIQUETA_DE_ETAPA: Record<EtapaDeJuridico, string> = {
	80: "Cierre final (80%)",
	85: "En firma (85%)",
};

function RouteComponent() {
	const navigate = Route.useNavigate();
	const queryClient = useQueryClient();
	const {
		canViewLegal,
		canApproveLegalStage,
		isLoading: isLoadingPermissions,
	} = useJuridicoPermissions();
	const [opportunitiesSearchQuery, setOpportunitiesSearchQuery] = useState("");
	const [etapaFiltro, setEtapaFiltro] = useState<EtapaDeJuridico>(80);
	const [isApproveModalOpen, setIsApproveModalOpen] = useState(false);
	const [opportunityToApprove, setOpportunityToApprove] = useState<{
		id: string;
		title: string;
	} | null>(null);

	// Las baterías de contratos de inversionistas. Van en su propia pestaña: son
	// otro flujo, con otra gente y sin oportunidad de venta detrás.
	//
	// Por defecto, las que está armando. Cuando se firma todo, la batería sale
	// de la lista: un documento completo no admite cambios, y en WeeTrust ya no
	// se puede ni borrar.
	const [estadoBateria, setEstadoBateria] =
		useState<EstadoDeBateria>("pendiente");
	const bateriasQuery = useQuery({
		...orpc.listInvestorContractBatches.queryOptions({
			// El máximo que acepta el servidor, que devuelve primero las abiertas:
			// el trabajo pendiente no se cae de la lista por el historial.
			input: { status: [...ESTADOS_DE_BATERIA], limit: 200 },
		}),
		enabled: canViewLegal,
	});

	const bateriasDelEstado = (estado: EstadoDeBateria) =>
		(bateriasQuery.data ?? []).filter((b) => b.status === estado);
	const bateriasVisibles = bateriasDelEstado(estadoBateria);
	const bateriasPendientesQuery = useQuery({
		...orpc.listInvestorContractBatches.queryOptions({ input: { limit: 200 } }),
		enabled: canViewLegal,
	});
	const bateriasAbiertas = bateriasPendientesQuery.data?.length ?? 0;

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
	const { data: leadsWithContracts } = useQuery({
		...orpc.getOpportunitiesForContracts.queryOptions({
			input: { closurePercentages: [90, 85] },
		}),

		enabled: canViewLegal,
	});

	// Las oportunidades que jurídico todavía puede trabajar: 80% armando la
	// papelería y 85% en firma, donde rehace la batería con otra fecha si los
	// contratos vencieron. Con sólo 80% las de 85% no aparecían en esta
	// pestaña, y el menú de generar no tenía dónde mostrarse.
	//
	// Se traen juntas pero se ven de a una etapa, y por defecto la de 80%: ése
	// es el trabajo del día de jurídico. Mezcladas, las de 85% parecían
	// pendientes suyos cuando ya están en firma.
	const { data: opportunitiesForContracts, isLoading: isLoadingOpportunities } =
		useQuery({
			...orpc.getOpportunitiesForContracts.queryOptions({
				input: { closurePercentages: [...ETAPAS_POR_ACCION.reemplazar] },
			}),
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

	const cuantasEnEtapa = (etapa: EtapaDeJuridico) =>
		opportunitiesForContracts?.filter(
			(opp) => opp.stage.closurePercentage === etapa,
		).length ?? 0;

	// Filtrar oportunidades por etapa y búsqueda
	const filteredOpportunities = opportunitiesForContracts?.filter(
		(opp) =>
			opp.stage.closurePercentage === etapaFiltro &&
			(opp.title
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
					.includes(opportunitiesSearchQuery.toLowerCase())),
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
				<div className="flex gap-2">
					<Button variant="outline" asChild>
						<Link to="/juridico/dashboard">Dashboard</Link>
					</Button>
					<Button asChild>
						<Link to="/juridico/dashboard-data">Carga de datos</Link>
					</Button>
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
						<div className="font-bold text-2xl">{cuantasEnEtapa(80)}</div>
						<p className="text-muted-foreground text-xs">Al 80% de cierre</p>
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
						Ventas
					</TabsTrigger>
					<TabsTrigger value="inversiones" className="flex items-center gap-2">
						<Landmark className="h-4 w-4" />
						Inversiones
						{bateriasAbiertas > 0 && (
							<Badge variant="secondary">{bateriasAbiertas}</Badge>
						)}
					</TabsTrigger>
				</TabsList>

				{/* Inversiones: las baterías que abre cada compra de cartera aceptada */}
				<TabsContent value="inversiones">
					<Card>
						<CardHeader>
							<CardTitle>Contratos de inversionistas</CardTitle>
							<CardDescription>
								Cada compra de cartera aceptada abre una batería. En
								«Pendientes» se arma: emitir, revisar, reemplazar, subir. Con
								«Listo» se mandan al hilo del correo de la compra y pasa a «Por
								firmar»; cuando se firma todo, sale de la lista.
							</CardDescription>

							{/* Filtro por estado, como el de etapas en ventas */}
							<div className="flex flex-wrap gap-2">
								{ESTADOS_DE_BATERIA.map((estado) => (
									<Button
										key={estado}
										variant={estadoBateria === estado ? "default" : "outline"}
										size="sm"
										aria-pressed={estadoBateria === estado}
										onClick={() => setEstadoBateria(estado)}
										className="tabular-nums"
									>
										{ESTADO_DE_BATERIA[estado]} ·{" "}
										{bateriasDelEstado(estado).length}
									</Button>
								))}
							</div>
						</CardHeader>
						<CardContent>
							{bateriasQuery.isLoading ? (
								<div className="flex items-center justify-center py-12">
									<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
								</div>
							) : bateriasVisibles.length === 0 ? (
								<div className="flex flex-col items-center justify-center py-12 text-center">
									<Landmark className="mb-3 h-12 w-12 text-gray-400" />
									<h3 className="mb-1 font-semibold text-gray-900 text-lg">
										No hay baterías en «{ESTADO_DE_BATERIA[estadoBateria]}»
									</h3>
									<p className="text-gray-500 text-sm">
										{estadoBateria === "pendiente"
											? "Aparecen acá en cuanto se acepta una compra de cartera"
											: "Probá con otro estado"}
									</p>
								</div>
							) : (
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>Inversionista</TableHead>
											<TableHead>Compra</TableHead>
											<TableHead>Créditos</TableHead>
											<TableHead>Aceptada</TableHead>
											<TableHead>Estado</TableHead>
											<TableHead className="text-right">Acción</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{bateriasVisibles.map((bateria) => (
											<TableRow key={bateria.id}>
												<TableCell>
													<div className="font-medium">
														{bateria.investorName}
													</div>
													<div className="text-muted-foreground text-xs">
														{bateria.investorEmail ?? "Sin correo registrado"}
													</div>
												</TableCell>
												<TableCell>
													{new Intl.NumberFormat("es-GT", {
														style: "currency",
														currency: "GTQ",
													}).format(Number(bateria.montoTotal))}
												</TableCell>
												<TableCell>{bateria.creditos.length}</TableCell>
												<TableCell>
													{format(new Date(bateria.acceptedAt), "d MMM yyyy", {
														locale: es,
													})}
												</TableCell>
												<TableCell>
													<Badge
														variant={
															bateria.status === "pendiente"
																? "default"
																: "secondary"
														}
													>
														{ESTADO_DE_BATERIA[bateria.status] ??
															bateria.status.replace("_", " ")}
													</Badge>
												</TableCell>
												<TableCell className="text-right">
													{/* Las dos salidas de una batería pendiente, sin entrar:
													    trabajarla, o descartarla si la compra no lleva
													    contratos. Una "Por firmar" ya los tiene mandados. */}
													<div className="flex items-center justify-end gap-2">
														{bateria.status === "pendiente" && (
															<DescartarBateria
																batchId={bateria.id}
																investorName={bateria.investorName}
																variant="outline"
															/>
														)}
														<Link
															to="/juridico/inversionista/$batchId"
															params={{ batchId: bateria.id }}
														>
															<Button size="sm">Trabajar</Button>
														</Link>
													</div>
												</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
							)}
						</CardContent>
					</Card>
				</TabsContent>

				{/* Oportunidades Listas Tab */}
				<TabsContent value="opportunities">
					<Card>
						<CardHeader>
							<CardTitle>Oportunidades Listas para Contratos</CardTitle>
							<CardDescription>
								Oportunidades al 80% que requieren contratos legales. En «En
								firma» están las que ya se mandaron a firmar, por si hay que
								rehacer la batería con otra fecha.
							</CardDescription>

							{/* Filtro de etapa */}
							<div className="flex flex-wrap gap-2">
								{ETAPAS_POR_ACCION.reemplazar.map((etapa) => (
									<Button
										key={etapa}
										variant={etapaFiltro === etapa ? "default" : "outline"}
										size="sm"
										aria-pressed={etapaFiltro === etapa}
										onClick={() => setEtapaFiltro(etapa)}
										className="tabular-nums"
									>
										{ETIQUETA_DE_ETAPA[etapa]} · {cuantasEnEtapa(etapa)}
									</Button>
								))}
							</div>

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
															{/* Generar va en 80% y también en 85%: jurídico rehace la
															    batería con otra fecha cuando los contratos vencieron
															    mientras la oportunidad está en firma. */}
															{etapaPermite(
																"reemplazar",
																opp.stage.closurePercentage,
															) && (
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
											: etapaFiltro === 80
												? "No hay oportunidades listas"
												: "No hay oportunidades en firma"}
									</h3>
									<p className="text-gray-500 text-sm">
										{opportunitiesSearchQuery
											? "Intenta con otros términos de búsqueda"
											: etapaFiltro === 80
												? "Las oportunidades al 80% aparecerán aquí"
												: "Las oportunidades al 85% aparecerán aquí"}
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
