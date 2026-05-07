import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
	AlertCircle,
	CheckCircle,
	ChevronLeft,
	ChevronRight,
	ChevronsLeft,
	ChevronsRight,
	FileText,
	RefreshCw,
	Search,
	TrendingUp,
	Wallet,
	XCircle,
} from "lucide-react";
import { startTransition, useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { DisbursementChecklistView } from "@/components/analysis/DisbursementChecklistView";
import { InvestmentAssignmentSection } from "@/components/analysis/InvestmentAssignmentSection";
import {
	LeadDetailModal,
	type LeadForModal,
} from "@/components/lead-detail-modal";
import {
	OpportunityDetailModal,
	type OpportunityForModal,
} from "@/components/opportunity-detail-modal";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
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
import { Textarea } from "@/components/ui/textarea";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { authClient } from "@/lib/auth-client";
import { PERMISSIONS } from "@/lib/roles";
import { client, orpc } from "@/utils/orpc";

export const Route = createFileRoute("/crm/analysis/")({
	component: AnalysisPage,
	validateSearch: z.object({
		opportunityId: z.string().optional(),
		stage: z.enum(["analysis", "investment", "disbursement"]).optional(),
	}).parse,
});

type OpportunityForAnalysis = Awaited<
	ReturnType<typeof client.getOpportunitiesForAnalysis>
>["data"][0];

// Helper component to render action buttons with validation
function OpportunityActions({
	opportunity,
	onApprove,
	onReject,
	onViewDocuments,
}: {
	opportunity: OpportunityForAnalysis;
	onApprove: () => void;
	onReject: () => void;
	onViewDocuments: () => void;
}) {
	const validation = useQuery({
		...orpc.validateOpportunityDocuments.queryOptions({
			input: { opportunityId: opportunity.id },
		}),
		enabled: !!opportunity.id,
	});

	const checklist = useQuery({
		queryKey: ["getAnalysisChecklist", opportunity.id],
		queryFn: async () => {
			return await client.getAnalysisChecklist({
				opportunityId: opportunity.id,
			});
		},
		enabled: !!opportunity.id,
	});

	const canApprove =
		(validation.data?.canApprove ?? false) &&
		((checklist.data as any)?.canApprove ?? false);
	const isLoading = validation.isLoading || checklist.isLoading;

	// Build tooltip message for why approve is disabled
	const getDisabledReason = () => {
		if (!validation.data || !checklist.data) return "Cargando validación...";

		const reasons: string[] = [];
		if (!validation.data.vehicleInfo?.id) {
			reasons.push("Debe asociar un vehículo a la oportunidad");
		} else if (!validation.data.vehicleInspected) {
			reasons.push("El vehículo no ha sido inspeccionado");
		}
		if (!validation.data.allDocumentsPresent) {
			reasons.push(
				`Faltan ${validation.data.missingDocuments.length} documentos obligatorios`,
			);
		}

		const checklistData = checklist.data as any;
		if (checklistData && !checklistData.canApprove) {
			reasons.push(
				"Debe completar todas las verificaciones del checklist de análisis",
			);
		}

		return reasons.length > 0 ? reasons.join("\n") : "";
	};

	return (
		<div className="flex gap-2">
			<Button size="sm" variant="default" onClick={onViewDocuments}>
				<FileText className="mr-1 h-4 w-4" />
				Ver Documentos
			</Button>
			<TooltipProvider>
				<Tooltip>
					<TooltipTrigger asChild>
						<span>
							<Button
								size="sm"
								variant="outline"
								onClick={onApprove}
								disabled={!canApprove || isLoading}
							>
								<CheckCircle className="mr-1 h-4 w-4" />
								Aprobar
							</Button>
						</span>
					</TooltipTrigger>
					{!canApprove && !isLoading && (
						<TooltipContent className="max-w-xs whitespace-pre-line">
							<p className="mb-1 font-semibold">No se puede aprobar:</p>
							<p className="text-sm">{getDisabledReason()}</p>
						</TooltipContent>
					)}
				</Tooltip>
			</TooltipProvider>
			<Button size="sm" variant="outline" onClick={onReject}>
				<XCircle className="mr-1 h-4 w-4" />
				Rechazar
			</Button>
		</div>
	);
}

function AnalysisPage() {
	const { data: session } = authClient.useSession();
	const navigate = Route.useNavigate();
	const search = Route.useSearch();
	const userProfile = useQuery(orpc.getUserProfile.queryOptions());

	// Search and pagination states
	const [searchTerm, setSearchTerm] = useState("");
	const [debouncedSearch, setDebouncedSearch] = useState("");
	const [page, setPage] = useState(0);
	const pageSize = 20;

	// Debounce search input
	useEffect(() => {
		const timer = setTimeout(() => {
			setDebouncedSearch(searchTerm);
			setPage(0); // Reset to first page on search
		}, 600);
		return () => clearTimeout(timer);
	}, [searchTerm]);

	const [selectedOpportunity, setSelectedOpportunity] =
		useState<OpportunityForAnalysis | null>(null);
	const [isApprovalDialogOpen, setIsApprovalDialogOpen] = useState(false);
	const [isApproving, setIsApproving] = useState(true);
	const [reason, setReason] = useState("");
	const [isSubmitting, setIsSubmitting] = useState(false);

	// Modal states for opportunity and lead detail
	const [isOpportunityModalOpen, setIsOpportunityModalOpen] = useState(false);
	const [isLeadModalOpen, setIsLeadModalOpen] = useState(false);
	const [selectedOpportunityForModal, setSelectedOpportunityForModal] =
		useState<OpportunityForModal | null>(null);
	const [selectedLeadForModal, setSelectedLeadForModal] =
		useState<LeadForModal | null>(null);

	// Check authentication and role
	useEffect(() => {
		if (
			userProfile.data &&
			!PERMISSIONS.canAccessAnalysis(userProfile.data.role)
		) {
			navigate({ to: "/dashboard" });
		}
	}, [userProfile.data, navigate]);

	// Auto-navigate to opportunity detail when opportunityId is in URL and stage is analysis
	useEffect(() => {
		if (
			search.opportunityId &&
			(!search.stage || search.stage === "analysis")
		) {
			navigate({
				to: "/crm/analysis/$opportunityId",
				params: { opportunityId: search.opportunityId },
			});
		}
	}, [search.opportunityId, search.stage, navigate]);

	// Query with pagination
	const {
		data: opportunitiesData,
		isLoading,
		isFetching,
		refetch: loadOpportunities,
	} = useQuery({
		queryKey: ["getOpportunitiesForAnalysis", page, pageSize, debouncedSearch],
		queryFn: () =>
			client.getOpportunitiesForAnalysis({
				limit: pageSize,
				offset: page * pageSize,
				search: debouncedSearch || undefined,
			}),
		placeholderData: (prev) => prev,
	});

	const opportunities = opportunitiesData?.data ?? [];
	const total = opportunitiesData?.total ?? 0;
	const totalPages = Math.ceil(total / pageSize);

	const handleApprovalClick = (
		opportunity: OpportunityForAnalysis,
		approve: boolean,
	) => {
		setSelectedOpportunity(opportunity);
		setIsApproving(approve);
		setReason("");
		setIsApprovalDialogOpen(true);
	};

	const handleViewDocuments = (opportunity: OpportunityForAnalysis) => {
		navigate({
			to: "/crm/analysis/$opportunityId",
			params: { opportunityId: opportunity.id },
		});
	};

	const handleOpenOpportunityModal = (opportunity: OpportunityForAnalysis) => {
		setSelectedOpportunityForModal({
			id: opportunity.id,
			title: opportunity.title,
			value: opportunity.value,
			creditType: null,
			status: opportunity.status,
			expectedCloseDate: opportunity.expectedCloseDate,
			createdAt: opportunity.createdAt,
			lead: opportunity.lead
				? {
						id: opportunity.lead.id,
						firstName: opportunity.lead.firstName,
						middleName: opportunity.lead.middleName,
						lastName: opportunity.lead.lastName,
						secondLastName: opportunity.lead.secondLastName,
						dpi: opportunity.lead.dpi,
						email: opportunity.lead.email,
						phone: opportunity.lead.phone,
						age: opportunity.lead.age,
						direccion: opportunity.lead.direccion,
						departamento: opportunity.lead.departamento,
						municipio: opportunity.lead.municipio,
						zona: opportunity.lead.zona,
					}
				: null,
			stage: opportunity.stage?.id
				? {
						id: opportunity.stage.id,
						name: opportunity.stage.name,
						closurePercentage: opportunity.stage.closurePercentage,
						color: opportunity.stage.color,
					}
				: null,
			assignedUser: null,
			vehicle: opportunity.vehicle
				? {
						id: opportunity.vehicle.id,
						make: opportunity.vehicle.make,
						model: opportunity.vehicle.model,
						year: opportunity.vehicle.year,
						licensePlate: opportunity.vehicle.licensePlate,
						color: opportunity.vehicle.color,
						isNew: opportunity.vehicle.isNew,
						isOwned: opportunity.vehicle.isOwned,
					}
				: null,
		});
		setIsOpportunityModalOpen(true);
	};

	const handleOpenLeadModal = (opportunity: OpportunityForAnalysis) => {
		if (!opportunity.lead) return;
		setSelectedLeadForModal({
			id: opportunity.lead.id,
			firstName: opportunity.lead.firstName,
			lastName: opportunity.lead.lastName,
			email: opportunity.lead.email,
			phone: opportunity.lead.phone,
			dpi: opportunity.lead.dpi,
			source: "",
			status: "",
			createdAt: new Date(),
			company: null,
			assignedUser: null,
		});
		setIsLeadModalOpen(true);
	};

	const handleSubmitApproval = async () => {
		if (!selectedOpportunity) return;

		try {
			setIsSubmitting(true);
			await client.approveOpportunityAnalysis({
				opportunityId: selectedOpportunity.id,
				approved: isApproving,
				reason: reason || undefined,
			});

			toast.success(
				isApproving ? "Oportunidad aprobada" : "Oportunidad rechazada",
			);

			setIsApprovalDialogOpen(false);
			loadOpportunities(); // Recargar lista
		} catch (error: any) {
			toast.error(
				error.message ||
					`No se pudo ${isApproving ? "aprobar" : "rechazar"} la oportunidad`,
			);
		} finally {
			setIsSubmitting(false);
		}
	};

	if (isLoading && !opportunitiesData) {
		return (
			<div className="container mx-auto py-8">
				<Card>
					<CardContent className="flex items-center justify-center py-8">
						<p className="text-muted-foreground">Cargando oportunidades...</p>
					</CardContent>
				</Card>
			</div>
		);
	}

	return (
		<div className="container mx-auto py-8">
			<div className="mb-8">
				<h1 className="font-bold text-3xl">Análisis de Documentación</h1>
				<p className="mt-2 text-muted-foreground">
					Revisa y aprueba las oportunidades en diferentes etapas
				</p>
			</div>

			<Tabs defaultValue={search.stage || "analysis"} className="w-full">
				<TabsList className="mb-6">
					<TabsTrigger value="analysis" className="flex items-center gap-2">
						<FileText className="h-4 w-4" />
						Análisis (30% → 40%)
						{total > 0 && (
							<Badge variant="secondary" className="ml-1">
								{total}
							</Badge>
						)}
					</TabsTrigger>
					<TabsTrigger value="investment" className="flex items-center gap-2">
						<TrendingUp className="h-4 w-4" />
						Asignación de Inversión (50% → 80%)
					</TabsTrigger>
					<TabsTrigger value="disbursement" className="flex items-center gap-2">
						<Wallet className="h-4 w-4" />
						Desembolso (90% → 100%)
					</TabsTrigger>
				</TabsList>

				<TabsContent value="analysis">
					<Card>
						<CardHeader>
							<CardTitle>Oportunidades Pendientes de Análisis</CardTitle>
							<CardDescription>
								{total} oportunidad
								{total !== 1 ? "es" : ""} esperando revisión de documentación
							</CardDescription>
						</CardHeader>
						<CardContent>
							{/* Buscador */}
							<div className="mb-4 flex items-center gap-4">
								<div className="relative max-w-sm flex-1">
									<Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
									<Input
										placeholder="Buscar por nombre, placa o ID..."
										value={searchTerm}
										onChange={(e) => {
											const value = e.target.value;
											startTransition(() => setSearchTerm(value));
										}}
										className="pl-10"
									/>
								</div>
							</div>

							{isFetching && (
								<div className="mb-4 flex items-center gap-2 text-muted-foreground text-sm">
									<RefreshCw className="h-3 w-3 animate-spin" />
									Buscando...
								</div>
							)}
							{opportunities.length === 0 ? (
								<Alert>
									<AlertCircle className="h-4 w-4" />
									<AlertDescription>
										{debouncedSearch
											? "No se encontraron oportunidades con ese criterio de búsqueda."
											: "No hay oportunidades pendientes de análisis en este momento."}
									</AlertDescription>
								</Alert>
							) : (
								<>
									<Table>
										<TableHeader>
											<TableRow>
												<TableHead>Título</TableHead>
												<TableHead>Estado</TableHead>
												<TableHead>Lead</TableHead>
												<TableHead>Empresa</TableHead>
												<TableHead>Valor</TableHead>
												<TableHead>Fecha Esperada</TableHead>
												<TableHead>Acciones</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{opportunities.map((opportunity) => (
												<TableRow key={opportunity.id}>
													<TableCell className="font-medium">
														<div className="space-y-1">
															<button
																type="button"
																className="cursor-pointer text-left text-primary hover:underline"
																onClick={() =>
																	handleOpenOpportunityModal(opportunity)
																}
															>
																{opportunity.title}
															</button>
															<p className="font-mono text-[10px] text-muted-foreground/60">
																ID: {opportunity.id.slice(0, 8)}
															</p>
														</div>
													</TableCell>
													<TableCell>
														{opportunity.analysisStatus === "resubmitted" ? (
															<Badge className="border-orange-300 bg-orange-100 text-orange-700">
																<RefreshCw className="mr-1 h-3 w-3" />
																Reenviado ({opportunity.analysisRejectionCount}
																x)
															</Badge>
														) : (
															<Badge className="border-green-300 bg-green-100 text-green-700">
																Nueva
															</Badge>
														)}
													</TableCell>
													<TableCell>
														{opportunity.lead ? (
															<div>
																<button
																	type="button"
																	className="cursor-pointer text-left font-medium text-primary hover:underline"
																	onClick={() =>
																		handleOpenLeadModal(opportunity)
																	}
																>
																	{opportunity.lead.firstName}{" "}
																	{opportunity.lead.lastName}
																</button>
																{opportunity.lead.email && (
																	<p className="text-muted-foreground text-sm">
																		{opportunity.lead.email}
																	</p>
																)}
															</div>
														) : (
															<span className="text-muted-foreground">
																Sin lead
															</span>
														)}
													</TableCell>
													<TableCell>
														{opportunity.company?.name || (
															<span className="text-muted-foreground">
																Sin empresa
															</span>
														)}
													</TableCell>
													<TableCell>
														{opportunity.value ? (
															<span className="font-medium">
																Q{Number(opportunity.value).toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
															</span>
														) : (
															<span className="text-muted-foreground">
																Sin valor
															</span>
														)}
													</TableCell>
													<TableCell>
														{opportunity.expectedCloseDate ? (
															new Date(
																opportunity.expectedCloseDate,
															).toLocaleDateString("es-GT")
														) : (
															<span className="text-muted-foreground">
																Sin fecha
															</span>
														)}
													</TableCell>
													<TableCell>
														<OpportunityActions
															opportunity={opportunity}
															onApprove={() =>
																handleApprovalClick(opportunity, true)
															}
															onReject={() =>
																handleApprovalClick(opportunity, false)
															}
															onViewDocuments={() =>
																handleViewDocuments(opportunity)
															}
														/>
													</TableCell>
												</TableRow>
											))}
										</TableBody>
									</Table>

									{/* Paginación */}
									{totalPages > 1 && (
										<div className="mt-4 flex items-center justify-between border-t pt-4">
											<span className="text-muted-foreground text-sm">
												Mostrando {page * pageSize + 1} -{" "}
												{Math.min((page + 1) * pageSize, total)} de {total}
											</span>
											<div className="flex items-center gap-2">
												<Button
													variant="outline"
													size="sm"
													onClick={() => setPage(0)}
													disabled={page === 0}
												>
													<ChevronsLeft className="h-4 w-4" />
												</Button>
												<Button
													variant="outline"
													size="sm"
													onClick={() => setPage((p) => Math.max(0, p - 1))}
													disabled={page === 0}
												>
													<ChevronLeft className="h-4 w-4" />
												</Button>
												<span className="px-2 text-sm">
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
													<ChevronRight className="h-4 w-4" />
												</Button>
												<Button
													variant="outline"
													size="sm"
													onClick={() => setPage(() => totalPages - 1)}
													disabled={page >= totalPages - 1}
												>
													<ChevronsRight className="h-4 w-4" />
												</Button>
											</div>
										</div>
									)}
								</>
							)}
						</CardContent>
					</Card>
				</TabsContent>

				<TabsContent value="investment">
					<InvestmentAssignmentSection
						initialOpportunityId={
							search.stage === "investment" ? search.opportunityId : undefined
						}
					/>
				</TabsContent>

				<TabsContent value="disbursement">
					<DisbursementSection
						initialOpportunityId={
							search.stage === "disbursement" ? search.opportunityId : undefined
						}
					/>
				</TabsContent>
			</Tabs>

			{/* Dialog de aprobación/rechazo */}
			<Dialog
				open={isApprovalDialogOpen}
				onOpenChange={setIsApprovalDialogOpen}
			>
				<DialogContent className="max-w-md">
					<DialogHeader>
						<DialogTitle>
							{isApproving ? "Aprobar" : "Rechazar"} Oportunidad
						</DialogTitle>
						{selectedOpportunity && (
							<DialogDescription>
								{selectedOpportunity.title}
								{selectedOpportunity.lead && (
									<>
										{" - Lead: "}
										{selectedOpportunity.lead.firstName}{" "}
										{selectedOpportunity.lead.lastName}
									</>
								)}
							</DialogDescription>
						)}
					</DialogHeader>
					<div className="grid gap-4 py-4">
						<div className="grid gap-2">
							<label htmlFor="reason" className="font-medium text-sm">
								{isApproving ? "Comentarios (opcional)" : "Razón del rechazo"}
							</label>
							<Textarea
								id="reason"
								value={reason}
								onChange={(e) => setReason(e.target.value)}
								placeholder={
									isApproving
										? "Agregar comentarios sobre la aprobación..."
										: "Explicar por qué se rechaza la documentación..."
								}
								rows={4}
								required={!isApproving}
							/>
						</div>
					</div>
					<DialogFooter>
						<Button
							variant="outline"
							onClick={() => setIsApprovalDialogOpen(false)}
							disabled={isSubmitting}
						>
							Cancelar
						</Button>
						<Button
							onClick={handleSubmitApproval}
							disabled={isSubmitting || (!isApproving && !reason.trim())}
							variant={isApproving ? "default" : "destructive"}
						>
							{isSubmitting
								? "Procesando..."
								: isApproving
									? "Aprobar"
									: "Rechazar"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Opportunity Detail Modal */}
			<OpportunityDetailModal
				open={isOpportunityModalOpen}
				onOpenChange={setIsOpportunityModalOpen}
				opportunity={selectedOpportunityForModal}
				userRole="analyst"
				readOnly
			/>

			{/* Lead Detail Modal */}
			<LeadDetailModal
				open={isLeadModalOpen}
				onOpenChange={setIsLeadModalOpen}
				lead={selectedLeadForModal}
				readOnly
			/>
		</div>
	);
}

// Component for disbursement section (90% → 100%)
function DisbursementSection({
	initialOpportunityId,
}: {
	initialOpportunityId?: string;
}) {
	const [selectedOpportunity, setSelectedOpportunity] = useState<string | null>(
		initialOpportunityId ?? null,
	);
	const [isOpportunityModalOpen, setIsOpportunityModalOpen] = useState(false);
	const [selectedOpportunityForModal, setSelectedOpportunityForModal] =
		useState<OpportunityForModal | null>(null);
	const [isLeadModalOpen, setIsLeadModalOpen] = useState(false);
	const [selectedLeadForModal, setSelectedLeadForModal] =
		useState<LeadForModal | null>(null);

	// Search and pagination states
	const [searchTerm, setSearchTerm] = useState("");
	const [debouncedSearch, setDebouncedSearch] = useState("");
	const [pageD, setPageD] = useState(0);
	const pageSizeD = 20;

	// Debounce search input
	useEffect(() => {
		const timer = setTimeout(() => {
			setDebouncedSearch(searchTerm);
			setPageD(0); // Reset to first page on search
		}, 300);
		return () => clearTimeout(timer);
	}, [searchTerm]);

	const {
		data: opportunitiesData,
		isLoading,
		refetch,
	} = useQuery({
		queryKey: [
			"getOpportunitiesForDisbursement",
			pageD,
			pageSizeD,
			debouncedSearch,
		],
		queryFn: () =>
			client.getOpportunitiesForDisbursement({
				limit: pageSizeD,
				offset: pageD * pageSizeD,
				search: debouncedSearch || undefined,
			}),
	});

	const opportunities = opportunitiesData?.data ?? [];
	const totalD = opportunitiesData?.total ?? 0;
	const totalPagesD = Math.ceil(totalD / pageSizeD);

	type DisbursementOpportunity = NonNullable<
		typeof opportunitiesData
	>["data"][0];

	const handleOpenOpportunityModal = (opp: DisbursementOpportunity) => {
		setSelectedOpportunityForModal({
			id: opp.id,
			title: opp.leadName || "Oportunidad",
			value: opp.value,
			creditType: null,
			status: "open",
			expectedCloseDate: null,
			createdAt: opp.createdAt,
			lead: opp.leadId
				? {
						id: opp.leadId,
						firstName: opp.leadName?.split(" ")[0] || "",
						lastName: opp.leadName?.split(" ").slice(1).join(" ") || "",
						dpi: null,
						email: null,
						phone: opp.leadPhone,
					}
				: null,
			stage: opp.stage?.id
				? {
						id: opp.stage.id,
						name: opp.stage.name,
						closurePercentage: opp.stage.closurePercentage,
						color: opp.stage.color,
					}
				: null,
			assignedUser: null,
			vehicle: opp.vehicle
				? {
						id: opp.vehicle.id,
						make: opp.vehicle.make,
						model: opp.vehicle.model,
						year: opp.vehicle.year,
						licensePlate: opp.vehicle.licensePlate,
						color: opp.vehicle.color,
						isNew: opp.vehicle.isNew,
						isOwned: opp.vehicle.isOwned,
					}
				: null,
		});
		setIsOpportunityModalOpen(true);
	};

	const handleNavigateToLead = (leadId: string) => {
		// Find the opportunity with this lead
		const opp = opportunities?.find((o) => o.leadId === leadId);
		if (opp) {
			const leadData = {
				id: leadId,
				firstName: opp.leadName?.split(" ")[0] || "",
				lastName: opp.leadName?.split(" ").slice(1).join(" ") || "",
				email: null,
				phone: opp.leadPhone || null,
				company: null,
				source: "",
				status: "qualified",
				createdAt: opp.createdAt,
			};
			setIsOpportunityModalOpen(false);
			// Delay opening second modal to allow first to fully close
			setTimeout(() => {
				setSelectedLeadForModal(leadData);
				setIsLeadModalOpen(true);
			}, 150);
		}
	};

	if (isLoading) {
		return (
			<Card>
				<CardContent className="flex items-center justify-center py-8">
					<p className="text-muted-foreground">Cargando oportunidades...</p>
				</CardContent>
			</Card>
		);
	}

	return (
		<div className="grid gap-6 lg:grid-cols-2">
			{/* Lista de oportunidades */}
			<Card>
				<CardHeader>
					<CardTitle>Oportunidades en 90%</CardTitle>
					<CardDescription>
						{totalD} oportunidad
						{totalD !== 1 ? "es" : ""} pendientes de desembolso
					</CardDescription>
				</CardHeader>
				<CardContent>
					{/* Buscador */}
					<div className="mb-4 flex items-center gap-4">
						<div className="relative flex-1">
							<Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
							<Input
								placeholder="Buscar por nombre, placa..."
								value={searchTerm}
								onChange={(e) => {
									const value = e.target.value;
									startTransition(() => setSearchTerm(value));
								}}
								className="pl-10"
							/>
						</div>
					</div>

					{opportunities.length === 0 ? (
						<Alert>
							<AlertCircle className="h-4 w-4" />
							<AlertDescription>
								{debouncedSearch
									? "No se encontraron oportunidades con ese criterio de búsqueda."
									: "No hay oportunidades pendientes de desembolso en este momento."}
							</AlertDescription>
						</Alert>
					) : (
						<>
							<div className="space-y-3">
								{opportunities.map((opp) => (
									<div
										key={opp.id}
										className={`cursor-pointer rounded-lg border p-4 transition-colors hover:bg-muted/50 ${
											selectedOpportunity === opp.id
												? "border-primary bg-muted/50"
												: ""
										}`}
										role="button"
										tabIndex={0}
										onClick={() => setSelectedOpportunity(opp.id)}
										onKeyDown={(e) => {
											if (e.key === "Enter" || e.key === " ") {
												e.preventDefault();
												setSelectedOpportunity(opp.id);
											}
										}}
									>
										<div className="flex items-center justify-between">
											<div>
												<button
													type="button"
													className="cursor-pointer text-left font-medium text-primary hover:underline"
													onClick={(e) => {
														e.stopPropagation();
														handleOpenOpportunityModal(opp);
													}}
												>
													{opp.leadName}
												</button>
												<p className="text-muted-foreground text-sm">
													{opp.leadPhone}
												</p>
												<p className="font-mono text-[10px] text-muted-foreground/60">
													ID: {opp.id.slice(0, 8)}
												</p>
											</div>
											<div className="text-right">
												<p className="font-medium">
													Q{Number(opp.value).toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
												</p>
												<div className="flex items-center gap-2">
													{opp.hasChecklist ? (
														<Badge
															variant={
																opp.checklistProgress === 100
																	? "default"
																	: "secondary"
															}
														>
															{opp.checklistProgress}%
														</Badge>
													) : (
														<Badge variant="outline">Sin iniciar</Badge>
													)}
												</div>
											</div>
										</div>
									</div>
								))}
							</div>

							{/* Paginación */}
							{totalPagesD > 1 && (
								<div className="mt-4 flex items-center justify-between border-t pt-4">
									<span className="text-muted-foreground text-sm">
										Mostrando {pageD * pageSizeD + 1} -{" "}
										{Math.min((pageD + 1) * pageSizeD, totalD)} de {totalD}
									</span>
									<div className="flex items-center gap-2">
										<Button
											variant="outline"
											size="sm"
											onClick={() => setPageD(0)}
											disabled={pageD === 0}
										>
											<ChevronsLeft className="h-4 w-4" />
										</Button>
										<Button
											variant="outline"
											size="sm"
											onClick={() => setPageD((p) => Math.max(0, p - 1))}
											disabled={pageD === 0}
										>
											<ChevronLeft className="h-4 w-4" />
										</Button>
										<span className="px-2 text-sm">
											Página {pageD + 1} de {totalPagesD}
										</span>
										<Button
											variant="outline"
											size="sm"
											onClick={() =>
												setPageD((p) => Math.min(totalPagesD - 1, p + 1))
											}
											disabled={pageD >= totalPagesD - 1}
										>
											<ChevronRight className="h-4 w-4" />
										</Button>
										<Button
											variant="outline"
											size="sm"
											onClick={() => setPageD(() => totalPagesD - 1)}
											disabled={pageD >= totalPagesD - 1}
										>
											<ChevronsRight className="h-4 w-4" />
										</Button>
									</div>
								</div>
							)}
						</>
					)}
				</CardContent>
			</Card>

			{/* Checklist de desembolso */}
			<div>
				{selectedOpportunity ? (
					<DisbursementChecklistView
						opportunityId={selectedOpportunity}
						onApproved={() => {
							setSelectedOpportunity(null);
							refetch();
						}}
					/>
				) : (
					<Card>
						<CardContent className="flex items-center justify-center py-12">
							<p className="text-muted-foreground">
								Selecciona una oportunidad para ver el checklist de desembolso
							</p>
						</CardContent>
					</Card>
				)}
			</div>

			{/* Opportunity Detail Modal */}
			<OpportunityDetailModal
				open={isOpportunityModalOpen}
				onOpenChange={setIsOpportunityModalOpen}
				opportunity={selectedOpportunityForModal}
				userRole="analyst"
				readOnly
				onNavigateToLead={handleNavigateToLead}
			/>

			{/* Lead Detail Modal */}
			<LeadDetailModal
				open={isLeadModalOpen}
				onOpenChange={setIsLeadModalOpen}
				lead={selectedLeadForModal}
				readOnly
			/>
		</div>
	);
}
