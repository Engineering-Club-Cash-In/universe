import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import React, { useState, useEffect } from "react";
import { AlertCircle, CheckCircle, FileText, XCircle } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { client, orpc } from "@/utils/orpc";

export const Route = createFileRoute("/crm/analysis")({
	component: AnalysisPage,
});

type OpportunityForAnalysis = Awaited<ReturnType<typeof client.getOpportunitiesForAnalysis>>[0];

function AnalysisPage() {
	const { data: session } = authClient.useSession();
	const navigate = Route.useNavigate();
	const userProfile = useQuery(orpc.getUserProfile.queryOptions());
	
	const [opportunities, setOpportunities] = useState<OpportunityForAnalysis[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [selectedOpportunity, setSelectedOpportunity] = useState<OpportunityForAnalysis | null>(null);
	const [isApprovalDialogOpen, setIsApprovalDialogOpen] = useState(false);
	const [isApproving, setIsApproving] = useState(true);
	const [reason, setReason] = useState("");
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [isDocumentsDialogOpen, setIsDocumentsDialogOpen] = useState(false);
	const [selectedOpportunityForDocs, setSelectedOpportunityForDocs] = useState<OpportunityForAnalysis | null>(null);
	
	// Check authentication and role
	useEffect(() => {
		if (userProfile.data && !["admin", "analyst"].includes(userProfile.data.role)) {
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

	const handleApprovalClick = (opportunity: OpportunityForAnalysis, approve: boolean) => {
		setSelectedOpportunity(opportunity);
		setIsApproving(approve);
		setReason("");
		setIsApprovalDialogOpen(true);
	};

	const handleViewDocuments = (opportunity: OpportunityForAnalysis) => {
		setSelectedOpportunityForDocs(opportunity);
		setIsDocumentsDialogOpen(true);
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
				isApproving ? "Oportunidad aprobada" : "Oportunidad rechazada"
			);

			setIsApprovalDialogOpen(false);
			loadOpportunities(); // Recargar lista
		} catch (error) {
			toast.error(`No se pudo ${isApproving ? "aprobar" : "rechazar"} la oportunidad`);
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
				<h1 className="text-3xl font-bold">Análisis de Documentación</h1>
				<p className="text-muted-foreground mt-2">
					Revisa y aprueba las oportunidades en etapa de análisis
				</p>
			</div>

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
						<CardTitle>Oportunidades Pendientes</CardTitle>
						<CardDescription>
							{opportunities.length} oportunidad{opportunities.length !== 1 ? "es" : ""} esperando revisión
						</CardDescription>
					</CardHeader>
					<CardContent>
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Título</TableHead>
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
											{opportunity.title}
										</TableCell>
										<TableCell>
											{opportunity.lead ? (
												<div>
													<p className="font-medium">
														{opportunity.lead.firstName} {opportunity.lead.lastName}
													</p>
													<p className="text-sm text-muted-foreground">
														{opportunity.lead.email}
													</p>
												</div>
											) : (
												<span className="text-muted-foreground">Sin lead</span>
											)}
										</TableCell>
										<TableCell>
											{opportunity.company?.name || (
												<span className="text-muted-foreground">Sin empresa</span>
											)}
										</TableCell>
										<TableCell>
											{opportunity.value ? (
												<span className="font-medium">
													Q{Number(opportunity.value).toLocaleString()}
												</span>
											) : (
												<span className="text-muted-foreground">Sin valor</span>
											)}
										</TableCell>
										<TableCell>
											{opportunity.expectedCloseDate ? (
												new Date(opportunity.expectedCloseDate).toLocaleDateString()
											) : (
												<span className="text-muted-foreground">Sin fecha</span>
											)}
										</TableCell>
										<TableCell>
											<div className="flex gap-2">
												<Button
													size="sm"
													variant="default"
													onClick={() => handleViewDocuments(opportunity)}
												>
													<FileText className="h-4 w-4 mr-1" />
													Ver Documentos
												</Button>
												<Button
													size="sm"
													variant="outline"
													onClick={() => handleApprovalClick(opportunity, true)}
												>
													<CheckCircle className="h-4 w-4 mr-1" />
													Aprobar
												</Button>
												<Button
													size="sm"
													variant="outline"
													onClick={() => handleApprovalClick(opportunity, false)}
												>
													<XCircle className="h-4 w-4 mr-1" />
													Rechazar
												</Button>
											</div>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</CardContent>
				</Card>
			)}

			{/* Dialog de aprobación/rechazo */}
			<Dialog open={isApprovalDialogOpen} onOpenChange={setIsApprovalDialogOpen}>
				<DialogContent className="max-w-md">
					<DialogHeader>
						<DialogTitle>
							{isApproving ? "Aprobar" : "Rechazar"} Oportunidad
						</DialogTitle>
						<DialogDescription>
							{selectedOpportunity && (
								<div className="mt-2">
									<p className="font-medium">{selectedOpportunity.title}</p>
									{selectedOpportunity.lead && (
										<p className="text-sm">
											Lead: {selectedOpportunity.lead.firstName} {selectedOpportunity.lead.lastName}
										</p>
									)}
								</div>
							)}
						</DialogDescription>
					</DialogHeader>
					<div className="grid gap-4 py-4">
						<div className="grid gap-2">
							<label htmlFor="reason" className="text-sm font-medium">
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
							{isSubmitting ? "Procesando..." : isApproving ? "Aprobar" : "Rechazar"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Dialog de documentos */}
			<Dialog open={isDocumentsDialogOpen} onOpenChange={setIsDocumentsDialogOpen}>
				<DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
					<DialogHeader>
						<DialogTitle>
							Documentos de la Oportunidad
						</DialogTitle>
						<DialogDescription>
							{selectedOpportunityForDocs && (
								<div className="mt-2">
									<p className="font-medium">{selectedOpportunityForDocs.title}</p>
									{selectedOpportunityForDocs.lead && (
										<p className="text-sm">
											Lead: {selectedOpportunityForDocs.lead.firstName} {selectedOpportunityForDocs.lead.lastName}
										</p>
									)}
								</div>
							)}
						</DialogDescription>
					</DialogHeader>
					<div className="py-4">
						{selectedOpportunityForDocs && (
							<DocumentsViewer opportunityId={selectedOpportunityForDocs.id} />
						)}
					</div>
				</DialogContent>
			</Dialog>
		</div>
	);
}

// Component to view documents
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
		<div className="space-y-4">
			{documentsQuery.data.map((doc) => (
				<Card key={doc.id}>
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div className="flex items-center gap-3 flex-1">
								<span className="text-2xl">{getDocumentIcon(doc.mimeType)}</span>
								<div className="flex-1">
									<div className="flex items-center gap-2">
										<span className="font-medium">{doc.originalName}</span>
										<Badge variant="outline" className="text-xs">
											{documentTypeLabels[doc.documentType] || doc.documentType}
										</Badge>
									</div>
									{doc.description && (
										<p className="text-sm text-muted-foreground mt-1">{doc.description}</p>
									)}
									<div className="flex items-center gap-4 text-xs text-muted-foreground mt-2">
										<span>{(doc.size / 1024 / 1024).toFixed(2)} MB</span>
										<span>Subido por {doc.uploadedBy?.name || "Usuario desconocido"}</span>
										<span>{new Date(doc.uploadedAt).toLocaleString()}</span>
									</div>
								</div>
							</div>
							<Button
								size="sm"
								variant="default"
								onClick={() => window.open(doc.url, "_blank")}
							>
								<FileText className="h-4 w-4 mr-1" />
								Ver Documento
							</Button>
						</div>
					</CardContent>
				</Card>
			))}
		</div>
	);
}