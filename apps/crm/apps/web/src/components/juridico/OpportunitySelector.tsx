import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { client, orpc } from "@/utils/orpc";

interface OpportunitySelectorProps {
	contractId: string;
	leadId: string;
	currentOpportunityId: string | null;
	disabled?: boolean;
	onAssignSuccess?: () => void;
}

export function OpportunitySelector({
	contractId,
	leadId,
	currentOpportunityId,
	disabled = false,
	onAssignSuccess,
}: OpportunitySelectorProps) {
	const [selectedOpportunityId, setSelectedOpportunityId] = useState<
		string | null
	>(currentOpportunityId);

	// Obtener oportunidades del lead
	const { data: opportunities, isLoading: isLoadingOpportunities } = useQuery({
		...orpc.getOpportunitiesByLead.queryOptions({ input: { leadId } }),
	});

	// Mutación para asignar oportunidad
	const assignMutation = useMutation({
		mutationFn: async (values: {
			contractId: string;
			opportunityId: string | null;
		}) => {
			return await client.assignOpportunityToContract(values);
		},
		onSuccess: () => {
			toast.success("Oportunidad asignada correctamente");
			onAssignSuccess?.();
		},
		onError: (error: Error) => {
			toast.error(`Error al asignar oportunidad: ${error.message}`);
			// Revertir el cambio en caso de error
			setSelectedOpportunityId(currentOpportunityId);
		},
	});

	const handleAssignOpportunity = (opportunityId: string) => {
		const newOpportunityId = opportunityId || null;
		setSelectedOpportunityId(newOpportunityId);

		assignMutation.mutate({
			contractId,
			opportunityId: newOpportunityId,
		});
	};

	const handleClearOpportunity = () => {
		setSelectedOpportunityId(null);
		assignMutation.mutate({
			contractId,
			opportunityId: null,
		});
	};

	if (isLoadingOpportunities) {
		return (
			<div className="flex items-center gap-2 text-muted-foreground text-sm">
				<Loader2 className="h-4 w-4 animate-spin" />
				Cargando oportunidades...
			</div>
		);
	}

	if (!opportunities || opportunities.length === 0) {
		return (
			<div className="text-muted-foreground text-sm">
				No hay oportunidades para este lead
			</div>
		);
	}

	const options = opportunities.map((opp) => ({
		value: opp.id,
		label: `${opp.title} - ${opp.creditType} - Q${Number(opp.value || 0).toLocaleString()}`,
	}));

	return (
		<div className="flex items-center gap-2">
			<div className="flex-1">
				<Combobox
					options={options}
					placeholder="Seleccionar oportunidad..."
					value={selectedOpportunityId || ""}
					onChange={handleAssignOpportunity}
					width="full"
					popOverWidth="full"
				/>
			</div>
			{selectedOpportunityId && !disabled && (
				<Button
					variant="ghost"
					size="icon"
					onClick={handleClearOpportunity}
					disabled={assignMutation.isPending}
					title="Limpiar asignación"
				>
					{assignMutation.isPending ? (
						<Loader2 className="h-4 w-4 animate-spin" />
					) : (
						<X className="h-4 w-4" />
					)}
				</Button>
			)}
		</div>
	);
}
