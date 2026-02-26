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
import { client, orpc } from "@/utils/orpc";

export const Route = createFileRoute("/inversiones/")({
	component: RouteComponent,
});

const INVESTMENT_STAGES = [
	{ id: "prospecting", name: "Prospección", color: "#6366f1" },
	{ id: "contacted", name: "Contactado", color: "#8b5cf6" },
	{ id: "negotiation", name: "Negociación", color: "#f59e0b" },
	{ id: "acceptance_signatures", name: "Aceptado/Firmas", color: "#3b82f6" },
	{ id: "welcome", name: "Bienvenida", color: "#10b981" },
	{ id: "closed", name: "Cerrado", color: "#22c55e" },
] as const;

type StageId = (typeof INVESTMENT_STAGES)[number]["id"];

function getDaysInStage(updatedAt: string | Date | null): number {
	if (!updatedAt) return 0;
	const ms = Date.now() - new Date(updatedAt).getTime();
	return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function formatAmount(amount: string | null | undefined): string {
	if (!amount) return "—";
	const num = Number.parseFloat(amount);
	if (Number.isNaN(num)) return "—";
	return `Q${num.toLocaleString("es-GT")}`;
}

// ─── Draggable Card ──────────────────────────────────────────────────────────

function DraggableInvestmentCard({
	item,
}: {
	item: {
		opportunity: {
			id: string;
			stage: string;
			status: string;
			updatedAt: string | null;
		};
		lead: {
			id: string;
			name: string;
			proposedAmount: string | null;
			assignedTo: string | null;
		} | null;
		investor: { id: string; name: string } | null;
	};
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

	const displayName = item.investor?.name ?? item.lead?.name ?? "Sin nombre";
	const days = getDaysInStage(item.opportunity.updatedAt);

	return (
		<Link
			to="/inversiones/$opportunityId"
			params={{ opportunityId: item.opportunity.id }}
		>
			<Card
				ref={ref}
				className={`cursor-pointer p-3 transition-shadow hover:shadow-md ${
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
	stage: (typeof INVESTMENT_STAGES)[number];
	items: {
		opportunity: {
			id: string;
			stage: string;
			status: string;
			updatedAt: string | null;
		};
		lead: {
			id: string;
			name: string;
			proposedAmount: string | null;
			assignedTo: string | null;
		} | null;
		investor: { id: string; name: string } | null;
	}[];
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
			canDrop: ({ source }) => source.data.type === "investment",
			onDragEnter: () => setIsDraggedOver(true),
			onDragLeave: () => setIsDraggedOver(false),
			onDrop: ({ source }) => {
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
		<Card
			className={`flex max-h-[75vh] min-w-72 shrink-0 flex-col ${
				isDraggedOver ? "ring-2 ring-blue-500" : ""
			}`}
		>
			<CardHeader className="shrink-0 pb-3">
				<div className="flex items-center justify-between">
					<Badge
						style={{ backgroundColor: stage.color, color: "white" }}
						className="text-xs"
					>
						{items.length} leads
					</Badge>
				</div>
				<CardTitle className="font-medium text-sm">{stage.name}</CardTitle>
				<CardDescription className="text-xs">
					{totalAmount > 0 ? `Q${totalAmount.toLocaleString("es-GT")}` : "—"}{" "}
					monto total
				</CardDescription>
			</CardHeader>
			<CardContent className="min-h-0 space-y-3 overflow-y-auto" ref={ref}>
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
			</CardContent>
		</Card>
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
		mutationFn: (data: {
			name: string;
			email?: string;
			phones?: string[];
			source?: string;
			proposedAmount?: number;
			notes?: string;
		}) => client.createInvestmentLead(data),
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
		...orpc.getInvestmentOpportunities.queryOptions(),
		enabled: !!session,
	});

	const statsQuery = useQuery({
		...orpc.getInvestmentDashboardStats.queryOptions(),
		enabled: !!session,
	});

	const advanceStageMutation = useMutation({
		mutationFn: (data: { opportunityId: string; reason?: string }) =>
			client.advanceInvestmentStage(data),
		onSuccess: () => {
			toast.success("Etapa actualizada correctamente");
			queryClient.invalidateQueries({
				queryKey: orpc.getInvestmentOpportunities.queryOptions().queryKey,
			});
			queryClient.invalidateQueries({
				queryKey: orpc.getInvestmentDashboardStats.queryOptions().queryKey,
			});
		},
		onError: (error) => {
			toast.error(`No se pudo cambiar la etapa: ${error.message}`);
		},
	});

	const allItems = opportunitiesQuery.data ?? [];

	// Filter out "lost" — only show open pipeline
	const openItems = allItems.filter(
		(item) => item.opportunity.stage !== "lost",
	);

	const itemsByStage = INVESTMENT_STAGES.reduce(
		(acc, stage) => {
			acc[stage.id] = openItems.filter(
				(item) => item.opportunity.stage === stage.id,
			);
			return acc;
		},
		{} as Record<StageId, typeof openItems>,
	);

	function handleDrop(opportunityId: string, newStage: string) {
		// Find the current stage of the opportunity
		const item = allItems.find((i) => i.opportunity.id === opportunityId);
		if (!item) return;

		const currentStageIdx = INVESTMENT_STAGES.findIndex(
			(s) => s.id === item.opportunity.stage,
		);
		const targetStageIdx = INVESTMENT_STAGES.findIndex(
			(s) => s.id === newStage,
		);

		// Only allow advancing to the immediate next stage
		if (targetStageIdx !== currentStageIdx + 1) {
			if (targetStageIdx <= currentStageIdx) {
				toast.error("No se puede retroceder de etapa");
			} else {
				toast.error("Solo se puede avanzar una etapa a la vez");
			}
			return;
		}

		advanceStageMutation.mutate({ opportunityId });
	}

	function handleRefresh() {
		queryClient.invalidateQueries({
			queryKey: orpc.getInvestmentOpportunities.queryOptions().queryKey,
		});
		queryClient.invalidateQueries({
			queryKey: orpc.getInvestmentDashboardStats.queryOptions().queryKey,
		});
	}

	const stats = statsQuery.data;

	return (
		<div className="flex h-full flex-col">
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
					<div className="flex gap-4">
						{INVESTMENT_STAGES.map((stage) => (
							<DroppableInvestmentColumn
								key={stage.id}
								stage={stage}
								items={itemsByStage[stage.id] ?? []}
								onDrop={handleDrop}
							/>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
