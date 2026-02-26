import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
	Calendar,
	Mail,
	MessageSquare,
	Phone,
	PlusCircle,
	Users,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
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
import { client, orpc } from "@/utils/orpc";

const INTERACTION_TYPE_LABELS: Record<string, string> = {
	call: "Llamada",
	email: "Email",
	whatsapp: "WhatsApp",
	meeting: "Reunión",
};

type InteractionType = "call" | "email" | "whatsapp" | "meeting";

function getInteractionIcon(type: string) {
	switch (type) {
		case "call":
			return <Phone className="h-4 w-4" />;
		case "email":
			return <Mail className="h-4 w-4" />;
		case "whatsapp":
			return <MessageSquare className="h-4 w-4" />;
		case "meeting":
			return <Users className="h-4 w-4" />;
		default:
			return <MessageSquare className="h-4 w-4" />;
	}
}

function getInteractionColor(type: string): string {
	switch (type) {
		case "call":
			return "bg-blue-100 text-blue-800";
		case "email":
			return "bg-purple-100 text-purple-800";
		case "whatsapp":
			return "bg-green-100 text-green-800";
		case "meeting":
			return "bg-orange-100 text-orange-800";
		default:
			return "bg-gray-100 text-gray-800";
	}
}

interface InteractionItem {
	id: string;
	interactionType: string;
	date: string;
	time: string | null;
	description: string;
	nextFollowupDate: Date | null;
	createdBy: string;
	createdAt: Date;
}

interface InvestmentInteractionsProps {
	opportunityId: string;
	interactions?: InteractionItem[];
}

interface NewInteractionForm {
	interactionType: InteractionType;
	date: string;
	time: string;
	description: string;
	nextFollowupDate: string;
}

const EMPTY_FORM: NewInteractionForm = {
	interactionType: "call",
	date: new Date().toISOString().split("T")[0],
	time: "",
	description: "",
	nextFollowupDate: "",
};

export function InvestmentInteractions({
	opportunityId,
	interactions = [],
}: InvestmentInteractionsProps) {
	const queryClient = useQueryClient();
	const [dialogOpen, setDialogOpen] = useState(false);
	const [form, setForm] = useState<NewInteractionForm>(EMPTY_FORM);

	const invalidate = () =>
		queryClient.invalidateQueries({
			queryKey: orpc.getInvestmentOpportunityById.queryOptions({
				input: { id: opportunityId },
			}).queryKey,
		});

	const createMutation = useMutation({
		mutationFn: (data: NewInteractionForm) =>
			client.createInvestmentInteraction({
				investmentOpportunityId: opportunityId,
				interactionType: data.interactionType,
				date: data.date,
				time: data.time || undefined,
				description: data.description,
				nextFollowupDate: data.nextFollowupDate || undefined,
			}),
		onSuccess: () => {
			toast.success("Interacción registrada exitosamente");
			setDialogOpen(false);
			setForm(EMPTY_FORM);
			invalidate();
		},
		onError: (error: Error) => {
			toast.error(error.message || "Error al registrar la interacción");
		},
	});

	const handleSubmit = () => {
		if (!form.date) {
			toast.error("Selecciona la fecha de la interacción");
			return;
		}
		if (!form.description.trim()) {
			toast.error("Ingresa una descripción");
			return;
		}
		createMutation.mutate(form);
	};

	const setField = <K extends keyof NewInteractionForm>(
		key: K,
		value: NewInteractionForm[K],
	) => {
		setForm((prev) => ({ ...prev, [key]: value }));
	};

	// Find nearest upcoming followup date
	const now = new Date();
	const upcomingFollowups = interactions
		.filter((i) => i.nextFollowupDate && new Date(i.nextFollowupDate) >= now)
		.sort(
			(a, b) =>
				new Date(a.nextFollowupDate!).getTime() -
				new Date(b.nextFollowupDate!).getTime(),
		);
	const nearestFollowup = upcomingFollowups[0] ?? null;

	// Sort interactions most recent first
	const sorted = [...interactions].sort(
		(a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
	);

	return (
		<>
			<Card>
				<CardHeader className="flex flex-row items-center justify-between">
					<CardTitle className="flex items-center gap-2 text-lg">
						<MessageSquare className="h-5 w-5" />
						Interacciones
					</CardTitle>
					<Button size="sm" onClick={() => setDialogOpen(true)}>
						<PlusCircle className="mr-1 h-4 w-4" />
						Nueva Interacción
					</Button>
				</CardHeader>
				<CardContent className="space-y-4">
					{/* Próximo seguimiento destacado */}
					{nearestFollowup && (
						<div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
							<Calendar className="h-5 w-5 shrink-0 text-amber-600" />
							<div>
								<p className="font-semibold text-amber-800 text-sm">
									Próximo seguimiento
								</p>
								<p className="text-amber-700 text-sm">
									{new Date(
										nearestFollowup.nextFollowupDate!,
									).toLocaleDateString("es-GT")}{" "}
									&mdash; {nearestFollowup.description.slice(0, 60)}
									{nearestFollowup.description.length > 60 ? "..." : ""}
								</p>
							</div>
						</div>
					)}

					{/* Timeline */}
					{sorted.length === 0 ? (
						<p className="py-6 text-center text-muted-foreground text-sm">
							No hay interacciones registradas aún.
						</p>
					) : (
						<div className="relative space-y-0">
							{sorted.map((interaction, index) => (
								<div key={interaction.id} className="flex gap-4">
									{/* Timeline line */}
									<div className="flex flex-col items-center">
										<div
											className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${getInteractionColor(interaction.interactionType)}`}
										>
											{getInteractionIcon(interaction.interactionType)}
										</div>
										{index < sorted.length - 1 && (
											<div className="w-px flex-1 bg-border" />
										)}
									</div>

									{/* Content */}
									<div
										className={`min-w-0 flex-1 pb-4 ${index === 0 ? "" : ""}`}
									>
										<div className="flex flex-wrap items-center gap-2">
											<Badge
												className={`${getInteractionColor(interaction.interactionType)} hover:${getInteractionColor(interaction.interactionType)}`}
											>
												{getInteractionIcon(interaction.interactionType)}
												<span className="ml-1">
													{INTERACTION_TYPE_LABELS[
														interaction.interactionType
													] ?? interaction.interactionType}
												</span>
											</Badge>
											<span className="text-muted-foreground text-xs">
												{new Date(interaction.date).toLocaleDateString("es-GT")}
												{interaction.time && ` — ${interaction.time}`}
											</span>
										</div>

										<p className="mt-1 text-sm">{interaction.description}</p>

										{interaction.nextFollowupDate && (
											<div className="mt-1 flex items-center gap-1 text-amber-700 text-xs">
												<Calendar className="h-3 w-3" />
												Seguimiento:{" "}
												{new Date(
													interaction.nextFollowupDate,
												).toLocaleDateString("es-GT")}
											</div>
										)}

										<p className="mt-1 text-muted-foreground text-xs">
											Registrado el{" "}
											{new Date(interaction.createdAt).toLocaleDateString(
												"es-GT",
											)}
										</p>
									</div>
								</div>
							))}
						</div>
					)}
				</CardContent>
			</Card>

			{/* Nueva Interacción Dialog */}
			<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
				<DialogContent className="sm:max-w-lg">
					<DialogHeader>
						<DialogTitle>Nueva Interacción</DialogTitle>
					</DialogHeader>
					<div className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="interactionType">Tipo</Label>
							<Select
								value={form.interactionType}
								onValueChange={(val) =>
									setField("interactionType", val as InteractionType)
								}
							>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{Object.entries(INTERACTION_TYPE_LABELS).map(
										([value, label]) => (
											<SelectItem key={value} value={value}>
												<span className="flex items-center gap-2">
													{getInteractionIcon(value)}
													{label}
												</span>
											</SelectItem>
										),
									)}
								</SelectContent>
							</Select>
						</div>

						<div className="grid grid-cols-2 gap-4">
							<div className="space-y-2">
								<Label htmlFor="intDate">Fecha</Label>
								<Input
									id="intDate"
									type="date"
									value={form.date}
									onChange={(e) => setField("date", e.target.value)}
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="intTime">
									Hora <span className="text-muted-foreground">(opcional)</span>
								</Label>
								<Input
									id="intTime"
									type="time"
									value={form.time}
									onChange={(e) => setField("time", e.target.value)}
								/>
							</div>
						</div>

						<div className="space-y-2">
							<Label htmlFor="intDescription">Descripción</Label>
							<Textarea
								id="intDescription"
								placeholder="Describe lo que se trató en la interacción..."
								rows={3}
								value={form.description}
								onChange={(e) => setField("description", e.target.value)}
							/>
						</div>

						<div className="space-y-2">
							<Label htmlFor="nextFollowup">
								Próximo Seguimiento{" "}
								<span className="text-muted-foreground">(opcional)</span>
							</Label>
							<Input
								id="nextFollowup"
								type="date"
								value={form.nextFollowupDate}
								onChange={(e) => setField("nextFollowupDate", e.target.value)}
							/>
						</div>
					</div>
					<DialogFooter>
						<Button
							variant="outline"
							onClick={() => setDialogOpen(false)}
							disabled={createMutation.isPending}
						>
							Cancelar
						</Button>
						<Button onClick={handleSubmit} disabled={createMutation.isPending}>
							{createMutation.isPending ? "Guardando..." : "Guardar"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
