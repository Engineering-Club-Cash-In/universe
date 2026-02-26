import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
	AlertCircle,
	ArrowLeft,
	ArrowRight,
	CheckCircle2,
	ChevronRight,
	Clock,
	FileText,
	History,
	Info,
	Landmark,
	MessageSquare,
	TrendingDown,
	XCircle,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { InvestmentCalculator } from "@/components/investments/InvestmentCalculator";
import { InvestmentDocuments } from "@/components/investments/InvestmentDocuments";
import { InvestmentInteractions } from "@/components/investments/InvestmentInteractions";
import { InvestorProfile } from "@/components/investments/InvestorProfile";
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
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { authClient } from "@/lib/auth-client";
import { client, orpc } from "@/utils/orpc";

export const Route = createFileRoute("/inversiones/$opportunityId")({
	component: RouteComponent,
});

// ─── Stage Config ─────────────────────────────────────────────────────────────

const STAGE_CONFIG: Record<
	string,
	{ label: string; color: string; bgColor: string }
> = {
	prospecting: {
		label: "Prospección",
		color: "#6366f1",
		bgColor: "bg-indigo-100 text-indigo-800",
	},
	contacted: {
		label: "Contactado",
		color: "#8b5cf6",
		bgColor: "bg-purple-100 text-purple-800",
	},
	negotiation: {
		label: "Negociación",
		color: "#f59e0b",
		bgColor: "bg-amber-100 text-amber-800",
	},
	acceptance_signatures: {
		label: "Aceptado/Firmas",
		color: "#3b82f6",
		bgColor: "bg-blue-100 text-blue-800",
	},
	welcome: {
		label: "Bienvenida",
		color: "#10b981",
		bgColor: "bg-emerald-100 text-emerald-800",
	},
	closed: {
		label: "Cerrado",
		color: "#22c55e",
		bgColor: "bg-green-100 text-green-800",
	},
	lost: {
		label: "Perdido",
		color: "#ef4444",
		bgColor: "bg-red-100 text-red-800",
	},
};

function StageBadge({ stage }: { stage: string }) {
	const config = STAGE_CONFIG[stage] ?? {
		label: stage,
		bgColor: "bg-gray-100 text-gray-800",
	};
	return (
		<span
			className={`inline-flex items-center rounded-full px-2.5 py-0.5 font-medium text-xs ${config.bgColor}`}
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

// ─── Negotiation Checklist ────────────────────────────────────────────────────

function NegotiationChecklist({
	opportunity,
}: {
	opportunity: {
		scenariosCompleted: boolean | null;
		documentsApproved: boolean | null;
		kycCompleted: boolean | null;
		profileCompleted: boolean | null;
		webappProfileCreated: boolean | null;
	};
}) {
	const items = [
		{
			key: "scenariosCompleted",
			label: "Escenarios de inversión",
			done: opportunity.scenariosCompleted,
		},
		{
			key: "documentsApproved",
			label: "Documentación aprobada",
			done: opportunity.documentsApproved,
		},
		{
			key: "kycCompleted",
			label: "KYC completado",
			done: opportunity.kycCompleted,
		},
		{
			key: "profileCompleted",
			label: "Perfil del inversionista",
			done: opportunity.profileCompleted,
		},
		{
			key: "webappProfileCreated",
			label: "Perfil en webapp CCI",
			done: opportunity.webappProfileCreated,
		},
	];

	const completedCount = items.filter((i) => i.done).length;

	return (
		<Card>
			<CardHeader className="pb-3">
				<CardTitle className="text-sm">Requisitos de Negociación</CardTitle>
				<CardDescription className="text-xs">
					{completedCount}/{items.length} completados
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-2">
				{items.map((item) => (
					<div key={item.key} className="flex items-center gap-2">
						{item.done ? (
							<CheckCircle2 className="h-4 w-4 text-green-500" />
						) : (
							<AlertCircle className="h-4 w-4 text-amber-500" />
						)}
						<span
							className={`text-sm ${item.done ? "text-foreground" : "text-muted-foreground"}`}
						>
							{item.label}
						</span>
					</div>
				))}
			</CardContent>
		</Card>
	);
}

// ─── Signatures Progress ──────────────────────────────────────────────────────

function SignaturesProgress({
	completed,
	total,
}: {
	completed: number;
	total: number;
}) {
	const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

	return (
		<Card>
			<CardHeader className="pb-3">
				<CardTitle className="text-sm">Progreso de Firmas</CardTitle>
				<CardDescription className="text-xs">
					{completed} de {total} firmas completadas
				</CardDescription>
			</CardHeader>
			<CardContent>
				<div className="space-y-2">
					<div className="flex items-center justify-between text-sm">
						<span className="text-muted-foreground">Avance</span>
						<span className="font-medium">{percentage}%</span>
					</div>
					<div className="h-2 w-full overflow-hidden rounded-full bg-muted">
						<div
							className="h-full rounded-full bg-blue-500 transition-all duration-300"
							style={{ width: `${percentage}%` }}
						/>
					</div>
				</div>
			</CardContent>
		</Card>
	);
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
									<p className="font-medium text-sm">{entry.action}</p>
									{entry.details != null && (
										<pre className="mt-1 overflow-x-auto rounded bg-muted px-2 py-1 font-mono text-xs">
											{JSON.stringify(entry.details, null, 2)}
										</pre>
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
				queryKey: orpc.getInvestmentOpportunities.queryOptions().queryKey,
			});
			queryClient.invalidateQueries({
				queryKey: orpc.getInvestmentDashboardStats.queryOptions().queryKey,
			});
		},
		onError: (error) => {
			toast.error(`No se pudo avanzar la etapa: ${error.message}`);
		},
	});

	function handleAdvanceStage() {
		advanceMutation.mutate({ opportunityId });
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
	const currentStage = opportunity.stage;
	const isLost = currentStage === "lost" || opportunity.status === "lost";
	const isClosed = currentStage === "closed";
	const canAdvance = !isLost && !isClosed;

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
						{canAdvance && (
							<Button
								size="sm"
								onClick={handleAdvanceStage}
								disabled={advanceMutation.isPending}
							>
								<ArrowRight className="mr-2 h-4 w-4" />
								{advanceMutation.isPending ? "Avanzando..." : "Avanzar Etapa"}
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

				{/* Stage-specific progress */}
				{currentStage === "negotiation" && (
					<div className="mt-4 max-w-sm">
						<NegotiationChecklist opportunity={opportunity} />
					</div>
				)}

				{currentStage === "acceptance_signatures" && (
					<div className="mt-4 max-w-sm">
						<SignaturesProgress
							completed={opportunity.signaturesCompleted ?? 0}
							total={opportunity.signaturesTotal ?? 0}
						/>
					</div>
				)}

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
											{opportunity.status}
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
