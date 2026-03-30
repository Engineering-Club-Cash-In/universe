import {
	draggable,
	dropTargetForElements,
} from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
	AlertCircle,
	Banknote,
	Clock,
	Download,
	Landmark,
	Plus,
	Target,
	TrendingDown,
	TrendingUp,
	Users,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import invariant from "tiny-invariant";
import * as XLSX from "xlsx";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { authClient } from "@/lib/auth-client";
import { formatInvestmentStage } from "@/lib/investment-labels";
import {
	INVESTMENT_ACTIVE_STAGES,
	type InvestmentStageConfig,
} from "@/lib/investment-stage-config";
import { client, orpc } from "@/utils/orpc";

export const Route = createFileRoute("/inversiones/")({
	component: RouteComponent,
});

function getDaysInStage(updatedAt: string | Date | null): number {
	if (!updatedAt) return 0;
	const ms = Date.now() - new Date(updatedAt).getTime();
	return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function formatAmount(amount: string | null | undefined): string {
	if (!amount) return "—";
	const num = Number.parseFloat(amount);
	if (Number.isNaN(num)) return "—";
	return `Q${num.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function canAdvanceToNextStage(
	currentStage: string,
	targetStage: string,
): boolean {
	const currentStageIdx = INVESTMENT_ACTIVE_STAGES.findIndex(
		(stage) => stage.id === currentStage,
	);
	const targetStageIdx = INVESTMENT_ACTIVE_STAGES.findIndex(
		(stage) => stage.id === targetStage,
	);

	if (currentStageIdx === -1 || targetStageIdx === -1) {
		return false;
	}

	return targetStageIdx === currentStageIdx + 1;
}

// ─── Types ───────────────────────────────────────────────────────────────────

type InvestmentOpportunityItem = Awaited<
	ReturnType<typeof client.getInvestmentOpportunities>
>[number];

// ─── Draggable Card ──────────────────────────────────────────────────────────

function DraggableInvestmentCard({
	item,
}: {
	item: InvestmentOpportunityItem;
}) {
	const ref = useRef<HTMLDivElement | null>(null);
	const [isDragging, setIsDragging] = useState(false);

	useEffect(() => {
		const element = ref.current;
		invariant(element);

		return draggable({
			element,
			getInitialData: () => ({
				type: "investment",
				opportunityId: item.opportunity.id,
				currentStage: item.opportunity.stage,
			}),
			onDragStart: () => setIsDragging(true),
			onDrop: () => setIsDragging(false),
		});
	}, [item.opportunity.id, item.opportunity.stage]);

	const displayName = item.investor
		? `${item.investor.firstName} ${item.investor.lastName}`
		: (item.lead?.name ?? "Sin nombre");
	const days = getDaysInStage(item.opportunity.updatedAt);

	return (
		<Link
			to="/inversiones/$opportunityId"
			params={{ opportunityId: item.opportunity.id }}
		>
			<Card
				ref={ref}
				className={`cursor-pointer rounded-lg border p-3 shadow-sm transition-shadow hover:shadow-md ${
					isDragging ? "opacity-50" : ""
				}`}
			>
				<div className="space-y-2">
					<div className="flex items-start justify-between gap-2">
						<h4 className="min-w-0 flex-1 font-medium text-sm leading-tight">
							{displayName}
						</h4>
					</div>

					{item.lead?.proposedAmount && (
						<div className="flex items-center gap-1 font-medium text-green-600 text-xs">
							<Banknote className="h-3 w-3" />
							{formatAmount(item.lead.proposedAmount)}
						</div>
					)}

					<div className="flex items-center justify-between pt-1">
						<div className="flex items-center gap-1 text-muted-foreground text-xs">
							<Clock className="h-3 w-3" />
							{days} {days === 1 ? "día" : "días"} en etapa
						</div>
					</div>

					<div className="border-t pt-1">
						<span className="font-mono text-[10px] text-muted-foreground/60">
							ID: {item.opportunity.id.slice(0, 8)}
						</span>
					</div>
				</div>
			</Card>
		</Link>
	);
}

// ─── Droppable Column ─────────────────────────────────────────────────────────

function DroppableInvestmentColumn({
	stage,
	items,
	onDrop,
}: {
	stage: InvestmentStageConfig;
	items: InvestmentOpportunityItem[];
	onDrop: (opportunityId: string, newStage: string) => void;
}) {
	const ref = useRef<HTMLDivElement | null>(null);
	const [isDraggedOver, setIsDraggedOver] = useState(false);

	useEffect(() => {
		const element = ref.current;
		invariant(element);

		return dropTargetForElements({
			element,
			getData: () => ({ type: "stage", stageId: stage.id }),
			canDrop: ({ source }: { source: { data: Record<string, unknown> } }) =>
				source.data.type === "investment",
			onDragEnter: () => setIsDraggedOver(true),
			onDragLeave: () => setIsDraggedOver(false),
			onDrop: ({ source }: { source: { data: Record<string, unknown> } }) => {
				setIsDraggedOver(false);
				const opportunityId = source.data.opportunityId as string;
				const currentStage = source.data.currentStage as string;
				if (opportunityId && currentStage !== stage.id) {
					onDrop(opportunityId, stage.id);
				}
			},
		});
	}, [stage.id, onDrop]);

	const totalAmount = items.reduce((sum, item) => {
		const amount = Number.parseFloat(item.lead?.proposedAmount ?? "0") || 0;
		return sum + amount;
	}, 0);

	return (
		<div
			className={`flex max-h-[75vh] min-w-72 shrink-0 flex-col rounded-xl border bg-muted/30 ${
				isDraggedOver ? "ring-2 ring-blue-500" : ""
			}`}
		>
			<div className="shrink-0 px-4 pt-4 pb-2">
				<div className="flex items-center justify-between">
					<Badge
						style={{ backgroundColor: stage.color, color: "white" }}
						className="text-xs"
					>
						{items.length} leads
					</Badge>
				</div>
				<p className="mt-1.5 font-medium text-sm">{stage.name}</p>
				<p className="text-muted-foreground text-xs">
					{totalAmount > 0
						? `Q${totalAmount.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
						: "—"}{" "}
					monto total
				</p>
			</div>
			<div
				className="flex min-h-0 flex-col gap-3 overflow-y-auto px-3 pb-3"
				ref={ref}
			>
				{items.length === 0 ? (
					<div className="py-8 text-center text-muted-foreground">
						<Target className="mx-auto mb-2 h-8 w-8 opacity-50" />
						<p className="text-sm">Sin leads</p>
					</div>
				) : (
					items.map((item) => (
						<DraggableInvestmentCard key={item.opportunity.id} item={item} />
					))
				)}
			</div>
		</div>
	);
}

// ─── Create Lead Dialog ───────────────────────────────────────────────────────

function CreateLeadDialog({ onSuccess }: { onSuccess: () => void }) {
	const [open, setOpen] = useState(false);
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [phone, setPhone] = useState("");
	const [source, setSource] = useState<string>("");
	const [proposedAmount, setProposedAmount] = useState("");
	const [notes, setNotes] = useState("");

	const createMutation = useMutation({
		mutationFn: (data: Parameters<typeof client.createInvestmentLead>[0]) =>
			client.createInvestmentLead(data),
		onSuccess: () => {
			toast.success("Lead de inversión creado correctamente");
			setOpen(false);
			setName("");
			setEmail("");
			setPhone("");
			setSource("");
			setProposedAmount("");
			setNotes("");
			onSuccess();
		},
		onError: (error) => {
			toast.error(`Error al crear lead: ${error.message}`);
		},
	});

	function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		if (!name.trim()) {
			toast.error("El nombre es requerido");
			return;
		}
		createMutation.mutate({
			name: name.trim(),
			email: email.trim() || undefined,
			phones: phone.trim() ? [phone.trim()] : undefined,
			source:
				(source as
					| "website"
					| "referral"
					| "cold_call"
					| "email"
					| "social_media"
					| "event"
					| "whatsapp") || undefined,
			proposedAmount: proposedAmount
				? Number.parseFloat(proposedAmount)
				: undefined,
			notes: notes.trim() || undefined,
		});
	}

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button>
					<Plus className="mr-2 h-4 w-4" />
					Nuevo Lead
				</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Nuevo Lead de Inversión</DialogTitle>
				</DialogHeader>
				<form onSubmit={handleSubmit} className="space-y-4">
					<div className="space-y-1">
						<Label htmlFor="name">
							Nombre <span className="text-destructive">*</span>
						</Label>
						<Input
							id="name"
							placeholder="Nombre completo"
							value={name}
							onChange={(e) => setName(e.target.value)}
							required
						/>
					</div>

					<div className="space-y-1">
						<Label htmlFor="email">Correo electrónico</Label>
						<Input
							id="email"
							type="email"
							placeholder="correo@ejemplo.com"
							value={email}
							onChange={(e) => setEmail(e.target.value)}
						/>
					</div>

					<div className="space-y-1">
						<Label htmlFor="phone">Teléfono</Label>
						<Input
							id="phone"
							placeholder="+502 5555-5555"
							value={phone}
							onChange={(e) => setPhone(e.target.value)}
						/>
					</div>

					<div className="space-y-1">
						<Label htmlFor="source">Origen</Label>
						<Select value={source} onValueChange={setSource}>
							<SelectTrigger id="source">
								<SelectValue placeholder="Seleccionar origen" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="website">Sitio Web</SelectItem>
								<SelectItem value="referral">Referido</SelectItem>
								<SelectItem value="cold_call">Llamada en Frío</SelectItem>
								<SelectItem value="email">Correo</SelectItem>
								<SelectItem value="social_media">Redes Sociales</SelectItem>
								<SelectItem value="event">Evento</SelectItem>
								<SelectItem value="whatsapp">WhatsApp</SelectItem>
							</SelectContent>
						</Select>
					</div>

					<div className="space-y-1">
						<Label htmlFor="proposedAmount">Monto Propuesto (Q)</Label>
						<Input
							id="proposedAmount"
							type="number"
							min="0"
							step="0.01"
							placeholder="0.00"
							value={proposedAmount}
							onChange={(e) => setProposedAmount(e.target.value)}
						/>
					</div>

					<div className="space-y-1">
						<Label htmlFor="notes">Notas</Label>
						<Textarea
							id="notes"
							placeholder="Observaciones adicionales..."
							value={notes}
							onChange={(e) => setNotes(e.target.value)}
							rows={3}
						/>
					</div>

					<div className="flex justify-end gap-2 pt-2">
						<Button
							type="button"
							variant="outline"
							onClick={() => setOpen(false)}
						>
							Cancelar
						</Button>
						<Button type="submit" disabled={createMutation.isPending}>
							{createMutation.isPending ? "Creando..." : "Crear Lead"}
						</Button>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
}

// ─── Main Component ───────────────────────────────────────────────────────────

function RouteComponent() {
	const { data: session } = authClient.useSession();
	const queryClient = useQueryClient();

	const opportunitiesQuery = useQuery({
		...orpc.getInvestmentOpportunities.queryOptions({ input: {} }),
		enabled: !!session,
	});

	const statsQuery = useQuery({
		...orpc.getInvestmentDashboardStats.queryOptions({ input: {} }),
		enabled: !!session,
	});

	const advanceStageMutation = useMutation({
		mutationFn: (data: { opportunityId: string; reason?: string }) =>
			client.advanceInvestmentStage(data),
		onSuccess: () => {
			toast.success("Etapa actualizada correctamente");
			queryClient.invalidateQueries({
				queryKey: orpc.getInvestmentOpportunities.queryOptions({ input: {} })
					.queryKey,
			});
			queryClient.invalidateQueries({
				queryKey: orpc.getInvestmentDashboardStats.queryOptions({ input: {} })
					.queryKey,
			});
		},
		onError: (error) => {
			toast.error(`No se pudo cambiar la etapa: ${error.message}`);
		},
	});

	const allItems = opportunitiesQuery.data ?? [];
	const activeStageIds = new Set<string>(
		INVESTMENT_ACTIVE_STAGES.map((stage) => stage.id),
	);

	// Filter out "lost" — only show open pipeline
	const openItems = allItems.filter(
		(item) => item.opportunity.stage !== "lost",
	);
	const unknownStageItems = openItems.filter(
		(item) => !activeStageIds.has(String(item.opportunity.stage)),
	);
	const activeStageItems = openItems.filter((item) =>
		activeStageIds.has(String(item.opportunity.stage)),
	);

	const itemsByStage = INVESTMENT_ACTIVE_STAGES.reduce(
		(acc, stage) => {
			acc[stage.id] = activeStageItems.filter(
				(item) => String(item.opportunity.stage) === stage.id,
			);
			return acc;
		},
		{} as Partial<Record<string, typeof openItems>>,
	);

	function handleDrop(opportunityId: string, newStage: string) {
		const item = allItems.find((i) => i.opportunity.id === opportunityId);
		if (!item) return;

		if (!canAdvanceToNextStage(item.opportunity.stage, newStage)) {
			toast.error("Solo se permite avanzar a la siguiente etapa");
			return;
		}

		advanceStageMutation.mutate({ opportunityId });
	}

	function handleRefresh() {
		queryClient.invalidateQueries({
			queryKey: orpc.getInvestmentOpportunities.queryOptions({ input: {} })
				.queryKey,
		});
		queryClient.invalidateQueries({
			queryKey: orpc.getInvestmentDashboardStats.queryOptions({ input: {} })
				.queryKey,
		});
	}

	const stats = statsQuery.data;

	function handleExportExcel() {
		if (!allItems.length) {
			toast.error("No hay datos para exportar");
			return;
		}

		const rows = allItems.map((item) => {
			const name = item.investor
				? `${item.investor.firstName} ${item.investor.lastName}`
				: (item.lead?.name ?? "Sin nombre");
			const email = item.lead?.email ?? "";
			const phones = item.lead?.phones?.join(", ") ?? "";
			const amount = item.lead?.proposedAmount
				? Number.parseFloat(item.lead.proposedAmount)
				: "";
			const stage = formatInvestmentStage(item.opportunity.stage);

			return {
				Nombre: name,
				Correo: email,
				Teléfonos: phones,
				"Monto Propuesto": amount,
				Etapa: stage,
			};
		});

		const ws = XLSX.utils.json_to_sheet(rows);

		// Ajustar anchos de columna
		ws["!cols"] = [
			{ wch: 30 },
			{ wch: 30 },
			{ wch: 20 },
			{ wch: 18 },
			{ wch: 20 },
		];

		const wb = XLSX.utils.book_new();
		XLSX.utils.book_append_sheet(wb, ws, "Leads Inversiones");
		XLSX.writeFile(
			wb,
			`leads-inversiones-${new Date().toISOString().slice(0, 10)}.xlsx`,
		);
		toast.success("Reporte exportado correctamente");
	}

	return (
		<div className="flex h-full min-w-0 flex-col overflow-hidden">
			{/* Header */}
			<div className="border-b bg-background px-6 py-4">
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-3">
						<Landmark className="h-6 w-6 text-primary" />
						<div>
							<h1 className="font-bold text-xl">Pipeline de Inversiones</h1>
							<p className="text-muted-foreground text-sm">
								Gestión de leads y oportunidades de inversión
							</p>
						</div>
					</div>
					<div className="flex items-center gap-2">
						<Button
							variant="outline"
							size="sm"
							onClick={handleExportExcel}
							disabled={!allItems.length}
						>
							<Download className="mr-2 h-4 w-4" />
							Exportar Excel
						</Button>
						<CreateLeadDialog onSuccess={handleRefresh} />
					</div>
				</div>

				{/* Stats Bar */}
				{stats && (
					<div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
						<div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2">
							<Users className="h-4 w-4 text-muted-foreground" />
							<div>
								<p className="font-semibold text-sm">
									{stats.totalOpportunities}
								</p>
								<p className="text-muted-foreground text-xs">Total</p>
							</div>
						</div>
						<div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2">
							<TrendingUp className="h-4 w-4 text-blue-500" />
							<div>
								<p className="font-semibold text-sm">
									{stats.openOpportunities}
								</p>
								<p className="text-muted-foreground text-xs">Abiertas</p>
							</div>
						</div>
						<div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2">
							<Banknote className="h-4 w-4 text-green-500" />
							<div>
								<p className="font-semibold text-sm">
									{stats.wonOpportunities}
								</p>
								<p className="text-muted-foreground text-xs">Ganadas</p>
							</div>
						</div>
						<div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2">
							<TrendingDown className="h-4 w-4 text-red-500" />
							<div>
								<p className="font-semibold text-sm">
									{stats.lostOpportunities}
								</p>
								<p className="text-muted-foreground text-xs">Perdidas</p>
							</div>
						</div>
					</div>
				)}
			</div>

			{/* Kanban Board */}
			<div className="flex-1 overflow-x-auto p-6">
				{opportunitiesQuery.isLoading ? (
					<div className="flex h-64 items-center justify-center">
						<div className="text-center text-muted-foreground">
							<div className="mx-auto mb-2 h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
							<p className="text-sm">Cargando pipeline...</p>
						</div>
					</div>
				) : opportunitiesQuery.isError ? (
					<div className="flex h-64 items-center justify-center">
						<div className="text-center text-muted-foreground">
							<AlertCircle className="mx-auto mb-2 h-8 w-8 text-destructive" />
							<p className="text-sm">Error al cargar el pipeline</p>
							<Button
								variant="outline"
								size="sm"
								className="mt-2"
								onClick={handleRefresh}
							>
								Reintentar
							</Button>
						</div>
					</div>
				) : (
					<div className="space-y-4">
						{unknownStageItems.length > 0 && (
							<div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
								<div className="flex items-start gap-3">
									<AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
									<div className="space-y-2">
										<div>
											<p className="font-medium text-sm">
												Oportunidades en etapas no reconocidas
											</p>
											<p className="text-sm/6">
												Estas oportunidades siguen abiertas, pero su etapa no
												pertenece al funnel activo configurado.
											</p>
										</div>
										<div className="space-y-2">
											{unknownStageItems.map((item) => {
												const displayName = item.investor
													? `${item.investor.firstName} ${item.investor.lastName}`
													: (item.lead?.name ?? "Sin nombre");

												return (
													<div
														key={item.opportunity.id}
														className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-background/80 px-3 py-2 text-sm"
													>
														<Badge variant="outline">
															{formatInvestmentStage(item.opportunity.stage)}
														</Badge>
														<span className="font-medium">{displayName}</span>
														<span className="text-muted-foreground">
															ID: {item.opportunity.id.slice(0, 8)}
														</span>
													</div>
												);
											})}
										</div>
									</div>
								</div>
							</div>
						)}
						<div className="flex gap-4">
							{INVESTMENT_ACTIVE_STAGES.map((stage) => (
								<DroppableInvestmentColumn
									key={stage.id}
									stage={stage}
									items={itemsByStage[stage.id] ?? []}
									onDrop={handleDrop}
								/>
							))}
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
