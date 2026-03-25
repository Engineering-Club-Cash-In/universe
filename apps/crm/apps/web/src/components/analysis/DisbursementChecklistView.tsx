import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	CheckCircle2,
	Circle,
	FileCheck,
	Key,
	Loader2,
	Send,
	Truck,
	Wallet,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { client } from "@/utils/orpc";

interface DisbursementChecklistViewProps {
	opportunityId: string;
	onApproved?: () => void;
}

interface ChecklistItem {
	key: string;
	label: string;
	completed: boolean | null;
}

interface DisbursementChecklist {
	id: string;
	opportunityId: string;
	items: ChecklistItem[];
	progress: number;
	canApprove: boolean;
	notes: string | null;
	completedBy: string | null;
	completedAt: string | null;
	lead: string;
	value: string | null;
	disbursementApproved: boolean | null;
}

const ITEM_ICONS: Record<string, React.ReactNode> = {
	traspasoRealizado: <Truck className="h-4 w-4" />,
	documentosEnviadosAsesor: <Send className="h-4 w-4" />,
	documentosFirmadosRecibidos: <FileCheck className="h-4 w-4" />,
	copiaLlaveRecibida: <Key className="h-4 w-4" />,
	engancheValidado: <Wallet className="h-4 w-4" />,
	listoDesembolsar: <CheckCircle2 className="h-4 w-4" />,
};

export function DisbursementChecklistView({
	opportunityId,
	onApproved,
}: DisbursementChecklistViewProps) {
	const queryClient = useQueryClient();
	const [notes, setNotes] = useState("");

	// Fetch checklist data
	const {
		data: checklist,
		isLoading,
		refetch,
	} = useQuery<DisbursementChecklist>({
		queryKey: ["getDisbursementChecklist", opportunityId],
		queryFn: async () => {
			const result = await client.getDisbursementChecklist({ opportunityId });
			setNotes(result.notes || "");
			return result as DisbursementChecklist;
		},
	});

	// Update item mutation
	const updateItemMutation = useMutation({
		mutationFn: async ({
			itemKey,
			completed,
		}: {
			itemKey: string;
			completed: boolean;
		}) => {
			return client.updateDisbursementChecklistItem({
				opportunityId,
				itemKey: itemKey as
					| "traspasoRealizado"
					| "documentosEnviadosAsesor"
					| "documentosFirmadosRecibidos"
					| "copiaLlaveRecibida"
					| "engancheValidado"
					| "listoDesembolsar",
				completed,
			});
		},
		onSuccess: () => {
			refetch();
		},
		onError: (error) => {
			toast.error(`Error al actualizar: ${error.message}`);
		},
	});

	// Update notes mutation
	const updateNotesMutation = useMutation({
		mutationFn: async (newNotes: string) => {
			return client.updateDisbursementChecklistNotes({
				opportunityId,
				notes: newNotes,
			});
		},
		onSuccess: () => {
			toast.success("Notas guardadas");
		},
		onError: (error) => {
			toast.error(`Error al guardar notas: ${error.message}`);
		},
	});

	// Approve disbursement mutation
	const approveMutation = useMutation({
		mutationFn: async () => {
			if (notes !== (checklist?.notes ?? "")) {
				await client.updateDisbursementChecklistNotes({
					opportunityId,
					notes,
				});
			}
			return client.approveDisbursement({ opportunityId });
		},
		onSuccess: () => {
			toast.success("Desembolso aprobado - Oportunidad completada al 100%");
			queryClient.invalidateQueries({
				queryKey: ["getOpportunitiesForDisbursement"],
			});
			queryClient.invalidateQueries({ queryKey: ["getOpportunities"] });
			onApproved?.();
		},
		onError: (error) => {
			toast.error(`Error al aprobar: ${error.message}`);
		},
	});

	const handleItemChange = (itemKey: string, completed: boolean) => {
		updateItemMutation.mutate({ itemKey, completed });
	};

	const handleSaveNotes = () => {
		updateNotesMutation.mutate(notes);
	};

	if (isLoading) {
		return (
			<div className="flex items-center justify-center p-8">
				<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
			</div>
		);
	}

	if (!checklist) {
		return (
			<div className="p-4 text-center text-muted-foreground">
				No se pudo cargar el checklist
			</div>
		);
	}

	const formatCurrency = (value: string | null) => {
		if (!value) return "N/A";
		return new Intl.NumberFormat("es-GT", {
			style: "currency",
			currency: "GTQ",
			minimumFractionDigits: 2,
			maximumFractionDigits: 2,
		}).format(Number(value));
	};

	return (
		<Card>
			<CardHeader className="pb-3">
				<div className="flex items-center justify-between">
					<CardTitle className="text-lg">Checklist de Desembolso</CardTitle>
					{checklist.disbursementApproved ? (
						<Badge
							variant="outline"
							className="border-green-500 bg-green-50 text-green-700"
						>
							<CheckCircle2 className="mr-1 h-3 w-3" />
							Aprobado
						</Badge>
					) : (
						<Badge variant="outline">Pendiente</Badge>
					)}
				</div>
				<div className="mt-2 text-muted-foreground text-sm">
					<span className="font-medium">{checklist.lead}</span> -{" "}
					{formatCurrency(checklist.value)}
				</div>
			</CardHeader>
			<CardContent className="space-y-4">
				{/* Progress */}
				<div className="space-y-2">
					<div className="flex items-center justify-between text-sm">
						<span>Progreso</span>
						<span className="font-medium">{checklist.progress}%</span>
					</div>
					<Progress value={checklist.progress} className="h-2" />
				</div>

				{/* Checklist Items */}
				<div className="space-y-3">
					{checklist.items.map((item) => (
						<div
							key={item.key}
							className="flex items-center space-x-3 rounded-lg border p-3"
						>
							<Checkbox
								id={item.key}
								checked={item.completed ?? false}
								onCheckedChange={(checked) =>
									handleItemChange(item.key, checked as boolean)
								}
								disabled={
									checklist.disbursementApproved || updateItemMutation.isPending
								}
							/>
							<div className="flex flex-1 items-center space-x-2">
								<span className="text-muted-foreground">
									{ITEM_ICONS[item.key] || <Circle className="h-4 w-4" />}
								</span>
								<label
									htmlFor={item.key}
									className={`flex-1 text-sm ${
										item.completed ? "text-muted-foreground line-through" : ""
									}`}
								>
									{item.label}
								</label>
							</div>
							{item.completed && (
								<CheckCircle2 className="h-4 w-4 text-green-500" />
							)}
						</div>
					))}
				</div>

				{/* Notes */}
				<div className="flex flex-col gap-2">
					<label className="font-medium text-sm">
						Notas
						<Textarea
							value={notes}
							onChange={(e) => setNotes(e.target.value)}
							placeholder="Agregar notas sobre el proceso de desembolso..."
							disabled={checklist.disbursementApproved ?? false}
							rows={3}
						/>
					</label>
					{!checklist.disbursementApproved && (
						<Button
							variant="outline"
							size="sm"
							onClick={handleSaveNotes}
							disabled={updateNotesMutation.isPending}
						>
							{updateNotesMutation.isPending ? (
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
							) : null}
							Guardar notas
						</Button>
					)}
				</div>

				{/* Approve Button */}
				{!checklist.disbursementApproved && (
					<div className="pt-4">
						<Button
							className="w-full"
							onClick={() => approveMutation.mutate()}
							disabled={!checklist.canApprove || approveMutation.isPending}
						>
							{approveMutation.isPending ? (
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
							) : (
								<CheckCircle2 className="mr-2 h-4 w-4" />
							)}
							{checklist.canApprove
								? "Aprobar Desembolso y Completar"
								: "Completar todos los items para aprobar"}
						</Button>
					</div>
				)}
			</CardContent>
		</Card>
	);
}
