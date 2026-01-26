import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
	AlertCircle,
	ArrowLeft,
	CheckCircle,
	FileText,
	Loader2,
	XCircle,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { AnalysisChecklistView } from "@/components/analysis/AnalysisChecklistView";
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
import { Textarea } from "@/components/ui/textarea";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { authClient } from "@/lib/auth-client";
import { client, orpc } from "@/utils/orpc";

export const Route = createFileRoute("/crm/analysis/$opportunityId")({
	component: OpportunityDocumentsPage,
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

function DocumentsViewer({ opportunityId }: { opportunityId: string }) {
	const documentsQuery = useQuery({
		...orpc.getOpportunityDocuments.queryOptions({ input: { opportunityId } }),
		enabled: !!opportunityId,
	});

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

function OpportunityDocumentsPage() {
	const { opportunityId } = Route.useParams();
	const navigate = useNavigate();
	const { data: session } = authClient.useSession();
	const userProfile = useQuery(orpc.getUserProfile.queryOptions());

	// Approval dialog state
	const [isApprovalDialogOpen, setIsApprovalDialogOpen] = useState(false);
	const [isApproving, setIsApproving] = useState(true);
	const [reason, setReason] = useState("");
	const [isSubmitting, setIsSubmitting] = useState(false);

	// Modal states
	const [isOpportunityModalOpen, setIsOpportunityModalOpen] = useState(false);
	const [isLeadModalOpen, setIsLeadModalOpen] = useState(false);
	const [selectedOpportunityForModal, setSelectedOpportunityForModal] =
		useState<OpportunityForModal | null>(null);
	const [selectedLeadForModal, setSelectedLeadForModal] =
		useState<LeadForModal | null>(null);

	// Fetch opportunity data
	const {
		data: opportunitiesData,
		isLoading: isLoadingOpportunity,
		refetch: refetchOpportunity,
	} = useQuery({
		...orpc.getOpportunities.queryOptions({
			input: { opportunityId },
		}),
		enabled: !!opportunityId,
	});

	const opportunity = opportunitiesData?.[0];

	// Validation query for approve button
	const validation = useQuery({
		...orpc.validateOpportunityDocuments.queryOptions({
			input: { opportunityId },
		}),
		enabled: !!opportunityId,
	});

	const checklist = useQuery({
		queryKey: ["getAnalysisChecklist", opportunityId],
		queryFn: async () => {
			return await client.getAnalysisChecklist({ opportunityId });
		},
		enabled: !!opportunityId,
	});

	const canApprove =
		(validation.data?.canApprove ?? false) &&
		((checklist.data as any)?.canApprove ?? false);
	const isValidationLoading = validation.isLoading || checklist.isLoading;

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

	const handleApprovalClick = (approve: boolean) => {
		setIsApproving(approve);
		setReason("");
		setIsApprovalDialogOpen(true);
	};

	const handleSubmitApproval = async () => {
		if (!opportunityId) return;

		try {
			setIsSubmitting(true);
			await client.approveOpportunityAnalysis({
				opportunityId,
				approved: isApproving,
				reason: reason || undefined,
			});

			toast.success(
				isApproving ? "Oportunidad aprobada" : "Oportunidad rechazada",
			);

			setIsApprovalDialogOpen(false);
			navigate({ to: "/crm/analysis" });
		} catch (error: any) {
			toast.error(
				error.message ||
					`No se pudo ${isApproving ? "aprobar" : "rechazar"} la oportunidad`,
			);
		} finally {
			setIsSubmitting(false);
		}
	};

	const handleOpenOpportunityModal = () => {
		if (!opportunity) return;
		setSelectedOpportunityForModal({
			id: opportunity.id,
			title: opportunity.title,
			value: opportunity.value,
			creditType: opportunity.creditType,
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
						phone: null,
					}
				: null,
			stage: opportunity.stage,
			assignedUser: opportunity.assignedUser,
			vehicle: opportunity.vehicle?.id
				? {
						id: opportunity.vehicle.id,
						make: opportunity.vehicle.make,
						model: opportunity.vehicle.model,
						year: opportunity.vehicle.year,
						licensePlate: opportunity.vehicle.licensePlate,
						color: opportunity.vehicle.color,
					}
				: null,
		});
		setIsOpportunityModalOpen(true);
	};

	const handleOpenLeadModal = () => {
		if (!opportunity?.lead) return;
		setSelectedLeadForModal({
			id: opportunity.lead.id,
			firstName: opportunity.lead.firstName,
			lastName: opportunity.lead.lastName,
			email: opportunity.lead.email,
			phone: null,
			dpi: null,
			source: "",
			status: "",
			createdAt: new Date(),
			company: null,
			assignedUser: null,
		});
		setIsLeadModalOpen(true);
	};

	// Check role
	if (
		userProfile.data &&
		!["admin", "analyst"].includes(userProfile.data.role)
	) {
		navigate({ to: "/dashboard" });
		return null;
	}

	if (isLoadingOpportunity) {
		return (
			<div className="container mx-auto flex min-h-[400px] items-center justify-center py-8">
				<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
			</div>
		);
	}

	if (!opportunity) {
		return (
			<div className="container mx-auto py-8">
				<div className="text-center">
					<h1 className="mb-4 font-bold text-2xl">Oportunidad No Encontrada</h1>
					<p className="mb-4 text-muted-foreground">
						No se encontró la oportunidad solicitada.
					</p>
					<Link to="/crm/analysis">
						<Button variant="outline">
							<ArrowLeft className="mr-2 h-4 w-4" />
							Volver a Análisis
						</Button>
					</Link>
				</div>
			</div>
		);
	}

	return (
		<div className="container mx-auto space-y-6 py-8">
			{/* Header */}
			<div className="space-y-4">
				<Link
					to="/crm/analysis"
					className="inline-flex items-center text-muted-foreground text-sm hover:text-foreground"
				>
					<ArrowLeft className="mr-2 h-4 w-4" />
					Volver a Análisis
				</Link>

				<div className="flex items-center justify-between">
					<div className="flex items-center gap-3">
						<div className="flex h-12 w-12 items-center justify-center rounded-lg bg-blue-100">
							<FileText className="h-6 w-6 text-blue-600" />
						</div>
						<div>
							<button
								type="button"
								className="cursor-pointer font-bold text-3xl text-primary hover:underline"
								onClick={handleOpenOpportunityModal}
							>
								{opportunity.title}
							</button>
							<p className="mt-1 font-mono text-muted-foreground text-sm">
								ID: {opportunity.id.slice(0, 8)}
							</p>
							{opportunity.lead && (
								<p className="mt-1 text-muted-foreground">
									Lead:{" "}
									<button
										type="button"
										className="cursor-pointer text-primary hover:underline"
										onClick={handleOpenLeadModal}
									>
										{opportunity.lead.firstName} {opportunity.lead.lastName}
									</button>
								</p>
							)}
						</div>
					</div>

					<div className="flex gap-2">
						<TooltipProvider>
							<Tooltip>
								<TooltipTrigger asChild>
									<span>
										<Button
											variant="default"
											onClick={() => handleApprovalClick(true)}
											disabled={!canApprove || isValidationLoading}
										>
											<CheckCircle className="mr-2 h-4 w-4" />
											Aprobar
										</Button>
									</span>
								</TooltipTrigger>
								{!canApprove && !isValidationLoading && (
									<TooltipContent className="max-w-xs whitespace-pre-line">
										<p className="mb-1 font-semibold">No se puede aprobar:</p>
										<p className="text-sm">{getDisabledReason()}</p>
									</TooltipContent>
								)}
							</Tooltip>
						</TooltipProvider>
						<Button
							variant="outline"
							onClick={() => handleApprovalClick(false)}
						>
							<XCircle className="mr-2 h-4 w-4" />
							Rechazar
						</Button>
					</div>
				</div>
			</div>

			{/* Summary Card */}
			<Card>
				<CardHeader>
					<div className="flex items-center justify-between">
						<CardTitle>Información de la Oportunidad</CardTitle>
						<Button
							variant="outline"
							size="sm"
							onClick={handleOpenOpportunityModal}
						>
							Ver Detalles
						</Button>
					</div>
				</CardHeader>
				<CardContent>
					<div className="grid gap-4 md:grid-cols-3">
						<div>
							<p className="font-medium text-muted-foreground text-sm">Valor</p>
							<p className="mt-1 font-medium">
								{opportunity.value
									? `Q${Number(opportunity.value).toLocaleString()}`
									: "Sin valor"}
							</p>
						</div>
						<div>
							<p className="font-medium text-muted-foreground text-sm">
								Fecha Esperada
							</p>
							<p className="mt-1">
								{opportunity.expectedCloseDate
									? new Date(opportunity.expectedCloseDate).toLocaleDateString(
											"es-GT",
										)
									: "Sin fecha"}
							</p>
						</div>
						<div>
							<p className="font-medium text-muted-foreground text-sm">
								Vehículo
							</p>
							<p className="mt-1">
								{opportunity.vehicle
									? `${opportunity.vehicle.make} ${opportunity.vehicle.model} ${opportunity.vehicle.year}`
									: "Sin vehículo"}
							</p>
						</div>
					</div>
				</CardContent>
			</Card>

			{/* Checklist */}
			<AnalysisChecklistView
				opportunityId={opportunityId}
				onUpdate={() => {
					refetchOpportunity();
					validation.refetch();
					checklist.refetch();
				}}
			/>

			{/* Document Validation */}
			<DocumentValidationChecklist opportunityId={opportunityId} />

			{/* Documents List */}
			<Card>
				<CardHeader>
					<CardTitle>Documentos Subidos</CardTitle>
					<CardDescription>
						Lista de todos los documentos asociados a esta oportunidad
					</CardDescription>
				</CardHeader>
				<CardContent>
					<DocumentsViewer opportunityId={opportunityId} />
				</CardContent>
			</Card>

			{/* Approval Dialog */}
			<Dialog
				open={isApprovalDialogOpen}
				onOpenChange={setIsApprovalDialogOpen}
			>
				<DialogContent className="max-w-md">
					<DialogHeader>
						<DialogTitle>
							{isApproving ? "Aprobar" : "Rechazar"} Oportunidad
						</DialogTitle>
						<DialogDescription>
							{opportunity.title}
							{opportunity.lead && (
								<>
									{" - Lead: "}
									{opportunity.lead.firstName} {opportunity.lead.lastName}
								</>
							)}
						</DialogDescription>
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
				onOpenChange={(open) => {
					setIsOpportunityModalOpen(open);
					if (!open) {
						// Refrescar queries cuando se cierra el modal (por si se subieron documentos)
						refetchOpportunity();
						validation.refetch();
						checklist.refetch();
					}
				}}
				opportunity={selectedOpportunityForModal}
				userRole="analyst"
				readOnly
				onNavigateToLead={() => {
					setIsOpportunityModalOpen(false);
					if (opportunity?.lead) {
						setSelectedLeadForModal({
							id: opportunity.lead.id,
							firstName: opportunity.lead.firstName,
							lastName: opportunity.lead.lastName,
							email: opportunity.lead.email,
							phone: null,
							dpi: null,
							source: "",
							status: "",
							createdAt: new Date(),
						});
						setIsLeadModalOpen(true);
					}
				}}
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
