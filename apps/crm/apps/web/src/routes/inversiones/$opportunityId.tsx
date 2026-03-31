import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
	AlertCircle,
	ArrowLeft,
	ArrowRight,
	ArrowUpLeft,
	ChevronRight,
	FileText,
	History,
	Info,
	Landmark,
	MessageSquare,
	ScrollText,
	TrendingDown,
	XCircle,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { InvestmentCalculator } from "@/components/investments/InvestmentCalculator";
import { RetreatStageConfirmDialog } from "@/components/investments/RetreatStageConfirmDialog";
import { InvestmentContracts } from "@/components/investments/InvestmentContracts";
import { InvestmentDocuments } from "@/components/investments/InvestmentDocuments";
import { InvestmentInteractions } from "@/components/investments/InvestmentInteractions";
import { InvestorProfile } from "@/components/investments/InvestorProfile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { authClient } from "@/lib/auth-client";
import {
	formatInvestmentStage,
	formatOpportunityStatus,
} from "@/lib/investment-labels";
import {
	INVESTMENT_ACTIVE_STAGES,
	INVESTMENT_STAGES,
} from "@/lib/investment-stage-config";
import { client, orpc } from "@/utils/orpc";

export const Route = createFileRoute("/inversiones/$opportunityId")({
	component: RouteComponent,
});

// ─── Stage Config ─────────────────────────────────────────────────────────────

const STAGE_CONFIG = Object.fromEntries(
	INVESTMENT_STAGES.map((stage) => [
		stage.id,
		{
			label: stage.name,
			color: stage.color,
		},
	]),
) satisfies Record<string, { label: string; color: string }>;

const WON_STAGE_ID = "initial_onboarding_senior_handoff";

function formatUnknownStageLabel(stage: string | null | undefined): string {
	if (!stage) return "Etapa desconocida";
	return stage
		.split(/[_-]+/)
		.filter(Boolean)
		.map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
		.join(" ");
}

function StageBadge({ stage }: { stage: string | null | undefined }) {
	const config = (stage ? STAGE_CONFIG[stage] : undefined) ?? {
		label: formatUnknownStageLabel(stage),
		color: "#6b7280",
	};

	return (
		<span
			className="inline-flex items-center rounded-full px-2.5 py-0.5 font-medium text-xs"
			style={{
				backgroundColor: `${config.color}1A`,
				color: config.color,
			}}
		>
			{config.label}
		</span>
	);
}

function formatDate(dateStr: string | Date | null | undefined): string {
	if (!dateStr) return "—";
	return new Date(dateStr).toLocaleDateString("es-GT", {
		day: "2-digit",
		month: "long",
		year: "numeric",
	});
}

function formatDateTime(dateStr: string | Date | null | undefined): string {
	if (!dateStr) return "—";
	return new Date(dateStr).toLocaleString("es-GT", {
		day: "2-digit",
		month: "short",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

// ─── Mark as Lost Dialog ──────────────────────────────────────────────────────

function MarkAsLostDialog({
	opportunityId,
	onSuccess,
}: {
	opportunityId: string;
	onSuccess: () => void;
}) {
	const [open, setOpen] = useState(false);
	const [reason, setReason] = useState("");

	const mutation = useMutation({
		mutationFn: (data: { opportunityId: string; reason: string }) =>
			client.markAsLost(data),
		onSuccess: () => {
			toast.success("Oportunidad marcada como perdida");
			setOpen(false);
			setReason("");
			onSuccess();
		},
		onError: (error) => {
			toast.error(`Error: ${error.message}`);
		},
	});

	function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		if (!reason.trim()) {
			toast.error("Debe ingresar una razón");
			return;
		}
		mutation.mutate({ opportunityId, reason: reason.trim() });
	}

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button variant="destructive" size="sm">
					<XCircle className="mr-2 h-4 w-4" />
					Marcar como Perdido
				</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Marcar como Perdido</DialogTitle>
				</DialogHeader>
				<form onSubmit={handleSubmit} className="space-y-4">
					<div className="space-y-1">
						<Label htmlFor="reason">
							Razón <span className="text-destructive">*</span>
						</Label>
						<Textarea
							id="reason"
							placeholder="Explique por qué se perdió esta oportunidad..."
							value={reason}
							onChange={(e) => setReason(e.target.value)}
							rows={4}
							required
						/>
					</div>
					<div className="flex justify-end gap-2">
						<Button
							type="button"
							variant="outline"
							onClick={() => setOpen(false)}
						>
							Cancelar
						</Button>
						<Button
							type="submit"
							variant="destructive"
							disabled={mutation.isPending}
						>
							{mutation.isPending ? "Procesando..." : "Confirmar"}
						</Button>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
}

// ─── Audit Helpers ───────────────────────────────────────────────────────────

const AUDIT_ACTION_LABELS: Record<string, string> = {
	stage_advanced: "Etapa avanzada",
	stage_retreated: "Etapa regresada",
	marked_as_lost: "Marcada como perdida",
	scenario_created: "Escenario creado",
	scenario_accepted: "Escenario aceptado",
	document_uploaded: "Documento subido",
	document_approved: "Documento aprobado",
	document_rejected: "Documento rechazado",
	interaction_created: "Interacción registrada",
	funds_validated: "Fondos validados",
	signature_updated: "Firmas actualizadas",
	non_advance_survey_submitted: "Encuesta de no avance enviada",
};

function formatAuditAction(action: string): string {
	return AUDIT_ACTION_LABELS[action] ?? action;
}

function formatAuditDetails(
	action: string,
	details: Record<string, unknown>,
): React.ReactNode {
	const str = (key: string) => String(details[key] ?? "");

	switch (action) {
		case "stage_advanced":
		case "stage_retreated":
			return (
				<span>
					{details.from ? (
						<>De <strong>{formatInvestmentStage(str("from"))}</strong> a </>
					) : null}
					<strong>{formatInvestmentStage(str("to"))}</strong>
				</span>
			);
		case "marked_as_lost":
			return (
				<span>
					Etapa anterior: <strong>{formatInvestmentStage(str("previousStage"))}</strong>
					{details.reason ? <> — Razón: {str("reason")}</> : null}
				</span>
			);
		case "scenario_created":
			return (
				<span>
					Modalidad: <strong>{str("modality")}</strong>
					{details.amount ? <> — Monto: Q{Number(details.amount).toLocaleString("es-GT")}</> : null}
				</span>
			);
		case "scenario_accepted":
			return <span>Escenario seleccionado</span>;
		case "document_uploaded":
			return (
				<span>
					Tipo: <strong>{str("documentType")}</strong>
					{details.fileName ? <> — Archivo: {str("fileName")}</> : null}
				</span>
			);
		case "document_approved":
		case "document_rejected":
			return (
				<span>
					Documento {action === "document_approved" ? "aprobado" : "rechazado"}
					{details.documentType ? <> — Tipo: {str("documentType")}</> : null}
				</span>
			);
		case "interaction_created":
			return (
				<span>
					Tipo: <strong>{str("type")}</strong>
					{details.date ? <> — Fecha: {str("date")}</> : null}
				</span>
			);
		case "signature_updated":
			return (
				<span>
					{details.completed ? "Completadas" : "Pendientes"}
					{details.total != null ? <> — Total: {String(details.total)}</> : null}
				</span>
			);
		case "non_advance_survey_submitted":
			return (
				<span>
					Razón: {str("reason")}
				</span>
			);
		default:
			return (
				<span>
					{Object.entries(details)
						.map(([k, v]) => `${k}: ${v}`)
						.join(" — ")}
				</span>
			);
	}
}

// ─── Audit Log Tab ────────────────────────────────────────────────────────────

function AuditLogTab({
	opportunityId,
	stageHistory,
}: {
	opportunityId: string;
	stageHistory: {
		id: string;
		fromStage: string | null;
		toStage: string;
		changedBy: string;
		reason: string | null;
		createdAt: Date;
	}[];
}) {
	const auditQuery = useQuery({
		...orpc.getInvestmentAuditLog.queryOptions({ input: { opportunityId } }),
	});

	const auditLog = auditQuery.data ?? [];

	return (
		<div className="space-y-6">
			{/* Stage History */}
			<Card>
				<CardHeader>
					<CardTitle className="text-sm">Historial de Etapas</CardTitle>
				</CardHeader>
				<CardContent className="space-y-3">
					{stageHistory.length === 0 ? (
						<p className="text-center text-muted-foreground text-sm">
							Sin historial de etapas
						</p>
					) : (
						stageHistory.map((entry) => (
							<div
								key={entry.id}
								className="flex items-start gap-3 rounded-lg border p-3"
							>
								<ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
								<div className="min-w-0 flex-1">
									<div className="flex flex-wrap items-center gap-2">
										{entry.fromStage && (
											<>
												<StageBadge stage={entry.fromStage} />
												<ArrowRight className="h-3 w-3 text-muted-foreground" />
											</>
										)}
										<StageBadge stage={entry.toStage} />
									</div>
									{entry.reason && (
										<p className="mt-1 text-muted-foreground text-xs">
											{entry.reason}
										</p>
									)}
									<p className="mt-1 text-muted-foreground text-xs">
										{formatDateTime(entry.createdAt)}
									</p>
								</div>
							</div>
						))
					)}
				</CardContent>
			</Card>

			{/* Audit Actions */}
			<Card>
				<CardHeader>
					<CardTitle className="text-sm">Registro de Acciones</CardTitle>
				</CardHeader>
				<CardContent className="space-y-3">
					{auditQuery.isLoading ? (
						<p className="text-center text-muted-foreground text-sm">
							Cargando...
						</p>
					) : auditLog.length === 0 ? (
						<p className="text-center text-muted-foreground text-sm">
							Sin registros de auditoría
						</p>
					) : (
						auditLog.map((entry) => (
							<div
								key={entry.id}
								className="flex items-start gap-3 rounded-lg border p-3"
							>
								<History className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
								<div className="min-w-0 flex-1">
									<p className="font-medium text-sm">
										{formatAuditAction(entry.action)}
									</p>
									{entry.details != null && (
										<div className="mt-1 text-muted-foreground text-xs">
											{formatAuditDetails(entry.action, entry.details as Record<string, unknown>)}
										</div>
									)}
									<p className="mt-1 text-muted-foreground text-xs">
										{formatDateTime(entry.createdAt)}
									</p>
								</div>
							</div>
						))
					)}
				</CardContent>
			</Card>
		</div>
	);
}

// ─── Main Component ───────────────────────────────────────────────────────────

function RouteComponent() {
	const { opportunityId } = Route.useParams();
	const { data: session } = authClient.useSession();
	const queryClient = useQueryClient();
	const [isRetreatDialogOpen, setIsRetreatDialogOpen] = useState(false);

	const query = useQuery({
		...orpc.getInvestmentOpportunityById.queryOptions({
			input: { id: opportunityId },
		}),
		enabled: !!session,
	});

	const advanceMutation = useMutation({
		mutationFn: (data: { opportunityId: string }) =>
			client.advanceInvestmentStage(data),
		onSuccess: () => {
			toast.success("Etapa avanzada correctamente");
			queryClient.invalidateQueries({
				queryKey: orpc.getInvestmentOpportunityById.queryOptions({
					input: { id: opportunityId },
				}).queryKey,
			});
			queryClient.invalidateQueries({
				queryKey: orpc.getInvestmentOpportunities.queryOptions({ input: {} })
					.queryKey,
			});
			queryClient.invalidateQueries({
				queryKey: orpc.getInvestmentDashboardStats.queryOptions().queryKey,
			});
		},
		onError: (error) => {
			toast.error(`No se pudo avanzar la etapa: ${error.message}`);
		},
	});

	const retreatMutation = useMutation({
		mutationFn: (data: { opportunityId: string; reason?: string }) =>
			client.retreatInvestmentStage(data),
		onSuccess: () => {
			toast.success("Etapa regresada correctamente");
			setIsRetreatDialogOpen(false);
			queryClient.invalidateQueries({
				queryKey: orpc.getInvestmentOpportunityById.queryOptions({
					input: { id: opportunityId },
				}).queryKey,
			});
			queryClient.invalidateQueries({
				queryKey: orpc.getInvestmentOpportunities.queryOptions({ input: {} })
					.queryKey,
			});
			queryClient.invalidateQueries({
				queryKey: orpc.getInvestmentDashboardStats.queryOptions().queryKey,
			});
		},
		onError: (error) => {
			toast.error(`No se pudo regresar la etapa: ${error.message}`);
		},
	});

	const isStageTransitionPending =
		advanceMutation.isPending || retreatMutation.isPending;

	function handleAdvanceStage() {
		advanceMutation.mutate({ opportunityId });
	}

	function confirmRetreatStage() {
		retreatMutation.mutate({
			opportunityId,
			reason: "Regreso manual de etapa por corrección",
		});
	}

	function handleRefresh() {
		queryClient.invalidateQueries({
			queryKey: orpc.getInvestmentOpportunityById.queryOptions({
				input: { id: opportunityId },
			}).queryKey,
		});
	}

	if (query.isLoading) {
		return (
			<div className="flex h-64 items-center justify-center">
				<div className="text-center text-muted-foreground">
					<div className="mx-auto mb-2 h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
					<p className="text-sm">Cargando oportunidad...</p>
				</div>
			</div>
		);
	}

	if (query.isError || !query.data) {
		return (
			<div className="flex h-64 flex-col items-center justify-center gap-4">
				<AlertCircle className="h-10 w-10 text-destructive" />
				<p className="text-muted-foreground">
					No se pudo cargar la oportunidad
				</p>
				<Button asChild variant="outline" size="sm">
					<Link to="/inversiones">
						<ArrowLeft className="mr-2 h-4 w-4" />
						Volver al Pipeline
					</Link>
				</Button>
			</div>
		);
	}

	const data = query.data;
	const {
		opportunity,
		lead,
		investor,
		stageHistory,
		scenarios,
		documents,
		interactions,
	} = data;

	const displayName = investor
		? `${investor.firstName} ${investor.lastName}`
		: (lead?.name ?? "Sin nombre");
	const currentStage: string = opportunity.stage;
	const isLost = currentStage === "lost" || opportunity.status === "lost";
	const isClosed =
		!isLost && (currentStage === WON_STAGE_ID || opportunity.status === "won");
	const canAdvance = !isLost && !isClosed;
	const currentStageIndex = INVESTMENT_ACTIVE_STAGES.findIndex(
		(stage) => stage.id === currentStage,
	);
	const canRetreat = currentStageIndex > 0;

	return (
		<div className="flex h-full flex-col">
			{/* Page Header */}
			<div className="border-b bg-background px-6 py-4">
				<div className="flex items-center gap-2 text-muted-foreground text-sm">
					<Link
						to="/inversiones"
						className="flex items-center gap-1 hover:text-foreground"
					>
						<Landmark className="h-3.5 w-3.5" />
						Inversiones
					</Link>
					<ChevronRight className="h-3.5 w-3.5" />
					<span className="text-foreground">{displayName}</span>
				</div>

				<div className="mt-3 flex flex-wrap items-start justify-between gap-4">
					<div className="flex items-center gap-3">
						<Button asChild variant="ghost" size="icon" className="shrink-0">
							<Link to="/inversiones">
								<ArrowLeft className="h-4 w-4" />
							</Link>
						</Button>
						<div>
							<div className="flex flex-wrap items-center gap-2">
								<h1 className="font-bold text-xl">{displayName}</h1>
								<StageBadge stage={currentStage} />
								{isClosed && (
									<Badge className="bg-green-100 text-green-800 hover:bg-green-100">
										Ganada
									</Badge>
								)}
								{isLost && (
									<Badge variant="destructive" className="text-xs">
										Perdida
									</Badge>
								)}
							</div>
							<p className="mt-1 text-muted-foreground text-sm">
								ID: {opportunity.id.slice(0, 8)}
							</p>
						</div>
					</div>

					{/* Actions */}
					<div className="flex flex-wrap items-center gap-2">
						{canRetreat && (
							<Button
								size="sm"
								variant="outline"
								onClick={() => setIsRetreatDialogOpen(true)}
								disabled={isStageTransitionPending}
							>
								<ArrowUpLeft className="mr-2 h-4 w-4" />
								{retreatMutation.isPending
									? "Regresando..."
									: advanceMutation.isPending
										? "Avanzando..."
									: "Regresar Etapa"}
							</Button>
						)}
						{canAdvance && (
							<Button
								size="sm"
								onClick={handleAdvanceStage}
								disabled={isStageTransitionPending}
							>
								<ArrowRight className="mr-2 h-4 w-4" />
								{advanceMutation.isPending
									? "Avanzando..."
									: retreatMutation.isPending
										? "Regresando..."
										: "Avanzar Etapa"}
							</Button>
						)}
						{!isLost && !isClosed && (
							<MarkAsLostDialog
								opportunityId={opportunityId}
								onSuccess={handleRefresh}
							/>
						)}
					</div>
				</div>
				<RetreatStageConfirmDialog
					open={isRetreatDialogOpen}
					onOpenChange={setIsRetreatDialogOpen}
					onConfirm={confirmRetreatStage}
					isLoading={isStageTransitionPending}
				/>

				{isLost && opportunity.lostReason && (
					<div className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 dark:border-red-900 dark:bg-red-950">
						<XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
						<div>
							<p className="font-medium text-red-700 text-sm dark:text-red-400">
								Razón de pérdida
							</p>
							<p className="text-red-600 text-sm dark:text-red-300">
								{opportunity.lostReason}
							</p>
						</div>
					</div>
				)}
			</div>

			{/* Tabs */}
			<div className="flex-1 overflow-auto p-6">
				<Tabs defaultValue="informacion">
					<TabsList className="mb-6">
						<TabsTrigger value="informacion">
							<Info className="mr-1.5 h-3.5 w-3.5" />
							Información
						</TabsTrigger>
						<TabsTrigger value="escenarios">
							<TrendingDown className="mr-1.5 h-3.5 w-3.5" />
							Escenarios
						</TabsTrigger>
						<TabsTrigger value="documentos">
							<FileText className="mr-1.5 h-3.5 w-3.5" />
							Documentos
						</TabsTrigger>
						<TabsTrigger value="contratos">
							<ScrollText className="mr-1.5 h-3.5 w-3.5" />
							Contratos
						</TabsTrigger>
						<TabsTrigger value="interacciones">
							<MessageSquare className="mr-1.5 h-3.5 w-3.5" />
							Interacciones
						</TabsTrigger>
						<TabsTrigger value="auditoria">
							<History className="mr-1.5 h-3.5 w-3.5" />
							Auditoría
						</TabsTrigger>
					</TabsList>

					{/* Información Tab */}
					<TabsContent value="informacion">
						<div className="grid gap-6 lg:grid-cols-2">
							{/* Lead Info */}
							<Card>
								<CardHeader>
									<CardTitle className="text-sm">Datos del Lead</CardTitle>
								</CardHeader>
								<CardContent className="space-y-3">
									<div className="flex justify-between">
										<span className="text-muted-foreground text-sm">
											Nombre
										</span>
										<span className="font-medium text-sm">
											{lead?.name ?? "—"}
										</span>
									</div>
									<Separator />
									<div className="flex justify-between">
										<span className="text-muted-foreground text-sm">
											Correo
										</span>
										<span className="font-medium text-sm">
											{lead?.email ?? "—"}
										</span>
									</div>
									<Separator />
									<div className="flex justify-between">
										<span className="text-muted-foreground text-sm">
											Teléfono
										</span>
										<span className="font-medium text-sm">
											{Array.isArray(lead?.phones) && lead.phones.length > 0
												? (lead.phones as string[]).join(", ")
												: "—"}
										</span>
									</div>
									<Separator />
									<div className="flex justify-between">
										<span className="text-muted-foreground text-sm">
											Origen
										</span>
										<span className="font-medium text-sm">
											{lead?.source ?? "—"}
										</span>
									</div>
									<Separator />
									<div className="flex justify-between">
										<span className="text-muted-foreground text-sm">
											Monto Propuesto
										</span>
										<span className="font-medium text-green-600 text-sm">
											{lead?.proposedAmount
												? `Q${Number.parseFloat(lead.proposedAmount).toLocaleString("es-GT")}`
												: "—"}
										</span>
									</div>
									{lead?.notes && (
										<>
											<Separator />
											<div>
												<span className="text-muted-foreground text-sm">
													Notas
												</span>
												<p className="mt-1 text-sm">{lead.notes}</p>
											</div>
										</>
									)}
								</CardContent>
							</Card>

							{/* Investor Profile */}
							<InvestorProfile
								key={investor?.id ?? "new"}
								opportunityId={opportunityId}
								investmentLeadId={lead?.id}
								investor={investor}
							/>

							{/* Opportunity Meta */}
							<Card>
								<CardHeader>
									<CardTitle className="text-sm">
										Datos de la Oportunidad
									</CardTitle>
								</CardHeader>
								<CardContent className="space-y-3">
									<div className="flex justify-between">
										<span className="text-muted-foreground text-sm">
											Etapa actual
										</span>
										<StageBadge stage={currentStage} />
									</div>
									<Separator />
									<div className="flex justify-between">
										<span className="text-muted-foreground text-sm">
											Estado
										</span>
										<span className="font-medium text-sm">
											{formatOpportunityStatus(opportunity.status)}
										</span>
									</div>
									<Separator />
									<div className="flex justify-between">
										<span className="text-muted-foreground text-sm">
											Creada el
										</span>
										<span className="font-medium text-sm">
											{formatDate(opportunity.createdAt)}
										</span>
									</div>
									<Separator />
									<div className="flex justify-between">
										<span className="text-muted-foreground text-sm">
											Última actualización
										</span>
										<span className="font-medium text-sm">
											{formatDate(opportunity.updatedAt)}
										</span>
									</div>
									{opportunity.lastStageBeforeLost && (
										<>
											<Separator />
											<div className="flex justify-between">
												<span className="text-muted-foreground text-sm">
													Etapa antes de perderse
												</span>
												<StageBadge stage={opportunity.lastStageBeforeLost} />
											</div>
										</>
									)}
								</CardContent>
							</Card>
						</div>
					</TabsContent>

					{/* Escenarios Tab */}
					<TabsContent value="escenarios">
						<InvestmentCalculator
							opportunityId={opportunityId}
							scenarios={scenarios}
						/>
					</TabsContent>

					{/* Documentos Tab */}
					<TabsContent value="documentos">
						<InvestmentDocuments
							opportunityId={opportunityId}
							investorId={investor?.id}
							documents={documents}
						/>
					</TabsContent>

					{/* Contratos Tab */}
					<TabsContent value="contratos">
						<InvestmentContracts
							opportunityId={opportunityId}
							investorId={investor?.id}
							documents={documents}
						/>
					</TabsContent>

					{/* Interacciones Tab */}
					<TabsContent value="interacciones">
						<InvestmentInteractions
							opportunityId={opportunityId}
							interactions={interactions}
						/>
					</TabsContent>

					{/* Auditoría Tab */}
					<TabsContent value="auditoria">
						<AuditLogTab
							opportunityId={opportunityId}
							stageHistory={stageHistory ?? []}
						/>
					</TabsContent>
				</Tabs>
			</div>
		</div>
	);
}
