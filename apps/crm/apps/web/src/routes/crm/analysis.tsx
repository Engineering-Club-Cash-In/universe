import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
	AlertCircle,
	CheckCircle,
	FileText,
	RefreshCw,
	Wallet,
	XCircle,
} from "lucide-react";
import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { AnalysisChecklistView } from "@/components/analysis/AnalysisChecklistView";
import { DisbursementChecklistView } from "@/components/analysis/DisbursementChecklistView";
import { DocumentValidationChecklist } from "@/components/document-validation-checklist";
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
import { client, orpc } from "@/utils/orpc";

export const Route = createFileRoute("/crm/analysis")({
	component: AnalysisPage,
});

type OpportunityForAnalysis = Awaited<
	ReturnType<typeof client.getOpportunitiesForAnalysis>
>[0];

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
	const userProfile = useQuery(orpc.getUserProfile.queryOptions());

	const [opportunities, setOpportunities] = useState<OpportunityForAnalysis[]>(
		[],
	);
	const [isLoading, setIsLoading] = useState(true);
	const [selectedOpportunity, setSelectedOpportunity] =
		useState<OpportunityForAnalysis | null>(null);
	const [isApprovalDialogOpen, setIsApprovalDialogOpen] = useState(false);
	const [isApproving, setIsApproving] = useState(true);
	const [reason, setReason] = useState("");
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [isDocumentsDialogOpen, setIsDocumentsDialogOpen] = useState(false);
	const [selectedOpportunityForDocs, setSelectedOpportunityForDocs] =
		useState<OpportunityForAnalysis | null>(null);

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
			!["admin", "analyst"].includes(userProfile.data.role)
		) {
			navigate({ to: "/dashboard" });
		}
	}, [userProfile.data, navigate]);

	// Cargar oportunidades en análisis
	const loadOpportunities = async () => {
		try {
			setIsLoading(true);
			const data = await client.getOpportunitiesForAnalysis();
			setOpportunities(data);
		} catch (error) {
			toast.error("No se pudieron cargar las oportunidades");
		} finally {
			setIsLoading(false);
		}
	};

	// Cargar al montar el componente
	React.useEffect(() => {
		loadOpportunities();
	}, []);

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
		setSelectedOpportunityForDocs(opportunity);
		setIsDocumentsDialogOpen(true);
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
						lastName: opportunity.lead.lastName,
						dpi: null,
						email: opportunity.lead.email,
						phone: opportunity.lead.phone,
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
			dpi: null,
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

	if (isLoading) {
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

			<Tabs defaultValue="analysis" className="w-full">
				<TabsList className="mb-6">
					<TabsTrigger value="analysis" className="flex items-center gap-2">
						<FileText className="h-4 w-4" />
						Análisis (30% → 40%)
						{opportunities.length > 0 && (
							<Badge variant="secondary" className="ml-1">
								{opportunities.length}
							</Badge>
						)}
					</TabsTrigger>
					<TabsTrigger value="disbursement" className="flex items-center gap-2">
						<Wallet className="h-4 w-4" />
						Desembolso (90% → 100%)
					</TabsTrigger>
				</TabsList>

				<TabsContent value="analysis">
					{opportunities.length === 0 ? (
						<Alert>
							<AlertCircle className="h-4 w-4" />
							<AlertDescription>
								No hay oportunidades pendientes de análisis en este momento.
							</AlertDescription>
						</Alert>
					) : (
						<Card>
							<CardHeader>
								<CardTitle>Oportunidades Pendientes de Análisis</CardTitle>
								<CardDescription>
									{opportunities.length} oportunidad
									{opportunities.length !== 1 ? "es" : ""} esperando revisión de
									documentación
								</CardDescription>
							</CardHeader>
							<CardContent>
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
													<button
														type="button"
														className="cursor-pointer text-left text-primary hover:underline"
														onClick={() =>
															handleOpenOpportunityModal(opportunity)
														}
													>
														{opportunity.title}
													</button>
												</TableCell>
												<TableCell>
													{opportunity.analysisStatus === "resubmitted" ? (
														<Badge className="border-orange-300 bg-orange-100 text-orange-700">
															<RefreshCw className="mr-1 h-3 w-3" />
															Reenviado ({opportunity.analysisRejectionCount}x)
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
																onClick={() => handleOpenLeadModal(opportunity)}
															>
																{opportunity.lead.firstName}{" "}
																{opportunity.lead.lastName}
															</button>
															<p className="text-muted-foreground text-sm">
																{opportunity.lead.email}
															</p>
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
															Q{Number(opportunity.value).toLocaleString()}
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
							</CardContent>
						</Card>
					)}
				</TabsContent>

				<TabsContent value="disbursement">
					<DisbursementSection />
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

			{/* Dialog de documentos */}
			<Dialog
				open={isDocumentsDialogOpen}
				onOpenChange={setIsDocumentsDialogOpen}
			>
				<DialogContent className="max-h-[90vh] min-w-[80vw] max-w-6xl overflow-y-auto">
					<DialogHeader>
						<DialogTitle>Documentos de la Oportunidad</DialogTitle>
						{selectedOpportunityForDocs && (
							<DialogDescription>
								{selectedOpportunityForDocs.title}
								{selectedOpportunityForDocs.lead && (
									<>
										{" - Lead: "}
										{selectedOpportunityForDocs.lead.firstName}{" "}
										{selectedOpportunityForDocs.lead.lastName}
									</>
								)}
							</DialogDescription>
						)}
					</DialogHeader>
					<div className="w-full space-y-6 py-4">
						{selectedOpportunityForDocs && (
							<>
								<AnalysisChecklistView
									opportunityId={selectedOpportunityForDocs.id}
									onUpdate={loadOpportunities}
								/>
								<DocumentValidationChecklist
									opportunityId={selectedOpportunityForDocs.id}
								/>
								<DocumentsViewer
									opportunityId={selectedOpportunityForDocs.id}
								/>
							</>
						)}
					</div>
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
function DisbursementSection() {
	const [selectedOpportunity, setSelectedOpportunity] = useState<string | null>(
		null,
	);
	const [isOpportunityModalOpen, setIsOpportunityModalOpen] = useState(false);
	const [selectedOpportunityForModal, setSelectedOpportunityForModal] =
		useState<OpportunityForModal | null>(null);
	const [isLeadModalOpen, setIsLeadModalOpen] = useState(false);
	const [selectedLeadForModal, setSelectedLeadForModal] =
		useState<LeadForModal | null>(null);

	const {
		data: opportunities,
		isLoading,
		refetch,
	} = useQuery({
		queryKey: ["getOpportunitiesForDisbursement"],
		queryFn: () => client.getOpportunitiesForDisbursement(),
	});

	type DisbursementOpportunity = NonNullable<typeof opportunities>[0];

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
					}
				: null,
		});
		setIsOpportunityModalOpen(true);
	};

	const handleNavigateToLead = (leadId: string) => {
		// Find the opportunity with this lead
		const opp = opportunities?.find((o) => o.leadId === leadId);
		if (opp) {
			setSelectedLeadForModal({
				id: leadId,
				firstName: opp.leadName?.split(" ")[0] || "",
				lastName: opp.leadName?.split(" ").slice(1).join(" ") || "",
				email: null,
				phone: opp.leadPhone || null,
				company: null,
				source: "",
				status: "qualified",
				createdAt: opp.createdAt,
			});
			setIsOpportunityModalOpen(false);
			setIsLeadModalOpen(true);
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

	if (!opportunities || opportunities.length === 0) {
		return (
			<Alert>
				<AlertCircle className="h-4 w-4" />
				<AlertDescription>
					No hay oportunidades pendientes de desembolso en este momento.
				</AlertDescription>
			</Alert>
		);
	}

	return (
		<div className="grid gap-6 lg:grid-cols-2">
			{/* Lista de oportunidades */}
			<Card>
				<CardHeader>
					<CardTitle>Oportunidades en 90%</CardTitle>
					<CardDescription>
						{opportunities.length} oportunidad
						{opportunities.length !== 1 ? "es" : ""} pendientes de desembolso
					</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="space-y-3">
						{opportunities.map((opp) => (
							<div
								key={opp.id}
								className={`cursor-pointer rounded-lg border p-4 transition-colors hover:bg-muted/50 ${
									selectedOpportunity === opp.id
										? "border-primary bg-muted/50"
										: ""
								}`}
								onClick={() => setSelectedOpportunity(opp.id)}
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
									</div>
									<div className="text-right">
										<p className="font-medium">
											Q{Number(opp.value).toLocaleString()}
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

// Component to view documents
// TODO: Descomentar cuando exista el endpoint getOpportunityDocuments en el router
function DocumentsViewer({ opportunityId }: { opportunityId: string }) {
	const documentsQuery = useQuery({
		...orpc.getOpportunityDocuments.queryOptions({ input: { opportunityId } }),
		enabled: !!opportunityId,
	});

	const documentTypeLabels: Record<string, string> = {
		identification: "Identificación (DPI/Pasaporte)",
		income_proof: "Comprobante de Ingresos",
		bank_statement: "Estado de Cuenta Bancario",
		business_license: "Patente de Comercio",
		property_deed: "Escrituras de Propiedad",
		vehicle_title: "Tarjeta de Circulación",
		credit_report: "Reporte Crediticio",
		other: "Otro",
		// Documentos específicos por cliente
		dpi: "DPI",
		licencia: "Licencia",
		recibo_luz: "Recibo de luz",
		recibo_adicional: "Recibo adicional",
		formularios: "Formularios",
		estados_cuenta_1: "Estado de cuenta mes 1",
		estados_cuenta_2: "Estado de cuenta mes 2",
		estados_cuenta_3: "Estado de cuenta mes 3",
		patente_comercio: "Patente de comercio",
		representacion_legal: "Representación Legal",
		constitucion_sociedad: "Constitución de sociedad",
		patente_mercantil: "Patente mercantil",
		iva_1: "Formulario IVA mes 1",
		iva_2: "Formulario IVA mes 2",
		iva_3: "Formulario IVA mes 3",
		estado_financiero: "Estado financiero",
		clausula_consentimiento: "Cláusula de consentimiento",
		minutas: "Minutas",
	};

	const getDocumentIcon = (mimeType: string) => {
		if (mimeType.includes("pdf")) return "📄";
		if (mimeType.includes("image")) return "🖼️";
		if (mimeType.includes("word")) return "📝";
		return "📎";
	};

	if (documentsQuery.isLoading) {
		return (
			<div className="flex items-center justify-center py-8">
				<p className="text-muted-foreground">Cargando documentos...</p>
			</div>
		);
	}

	if (!documentsQuery.data || documentsQuery.data.length === 0) {
		return (
			<Alert>
				<AlertCircle className="h-4 w-4" />
				<AlertDescription>
					No hay documentos subidos para esta oportunidad.
				</AlertDescription>
			</Alert>
		);
	}

	return (
		<div className="w-full space-y-4">
			{documentsQuery.data.map((doc) => (
				<Card key={doc.id} className="w-full">
					<CardContent className="w-full p-4">
						<div className="flex flex-wrap items-center justify-between gap-4">
							<div className="flex min-w-0 flex-1 items-center gap-3">
								<span className="text-2xl">
									{getDocumentIcon(doc.mimeType)}
								</span>
								<div className="min-w-0 flex-1">
									<div className="flex flex-wrap items-center gap-2">
										<span className="truncate font-medium">
											{doc.originalName}
										</span>
										<Badge variant="outline" className="text-xs">
											{documentTypeLabels[doc.documentType] || doc.documentType}
										</Badge>
									</div>
									{doc.description && (
										<p className="mt-1 text-muted-foreground text-sm">
											{doc.description}
										</p>
									)}
									<div className="mt-2 flex flex-wrap items-center gap-4 text-muted-foreground text-xs">
										<span>{(doc.size / 1024 / 1024).toFixed(2)} MB</span>
										<span>
											Subido por {doc.uploadedBy?.name || "Usuario desconocido"}
										</span>
										<span>{new Date(doc.uploadedAt).toLocaleString()}</span>
									</div>
								</div>
							</div>
							<Button
								size="sm"
								variant="default"
								onClick={() => window.open(doc.url, "_blank")}
								className="flex-shrink-0"
							>
								<FileText className="mr-1 h-4 w-4" />
								Ver Documento
							</Button>
						</div>
					</CardContent>
				</Card>
			))}
		</div>
	);
}
