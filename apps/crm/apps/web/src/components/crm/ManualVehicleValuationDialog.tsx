import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, PencilLine } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
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
import { client, orpc } from "@/utils/orpc";

type ManualVehicleValuationDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	vehicleId: string;
	vehicleLabel: string;
};

const MANUAL_TECHNICIAN_NAME = "Actualizacion manual CRM";
const clientWithManualValuation = client as typeof client & {
	upsertManualVehicleValuation: (input: {
		vehicleId: string;
		vehicleRating: "Comercial" | "No comercial";
		marketValue: string;
		suggestedCommercialValue: string;
		bankValue: string;
		currentConditionValue: string;
	}) => Promise<{ action: "created" | "updated"; inspection: { id: string } }>;
};

export function ManualVehicleValuationDialog({
	open,
	onOpenChange,
	vehicleId,
	vehicleLabel,
}: ManualVehicleValuationDialogProps) {
	const queryClient = useQueryClient();
	const [vehicleRating, setVehicleRating] = useState<"Comercial" | "No comercial">(
		"Comercial",
	);
	const [marketValue, setMarketValue] = useState("");
	const [suggestedCommercialValue, setSuggestedCommercialValue] = useState("");
	const [bankValue, setBankValue] = useState("");
	const [currentConditionValue, setCurrentConditionValue] = useState("");

	const latestInspectionQuery = useQuery({
		...orpc.getLatestInspectionByVehicleId.queryOptions({
			input: { vehicleId },
		}),
		enabled: open && !!vehicleId,
		queryKey: ["getLatestInspectionByVehicleId", vehicleId],
	});
	const latestInspection = latestInspectionQuery.data as
		| {
				technicianName?: string | null;
				vehicleRating?: string | null;
				marketValue?: string | number | null;
				suggestedCommercialValue?: string | number | null;
				bankValue?: string | number | null;
				currentConditionValue?: string | number | null;
		  }
		| null
		| undefined;

	useEffect(() => {
		if (!open) {
			return;
		}

		if (!latestInspection) {
			setVehicleRating("Comercial");
			setMarketValue("");
			setSuggestedCommercialValue("");
			setBankValue("");
			setCurrentConditionValue("");
			return;
		}

		setVehicleRating(
			latestInspection.vehicleRating === "No comercial"
				? "No comercial"
				: "Comercial",
		);
		setMarketValue(latestInspection.marketValue?.toString() ?? "");
		setSuggestedCommercialValue(
			latestInspection.suggestedCommercialValue?.toString() ?? "",
		);
		setBankValue(latestInspection.bankValue?.toString() ?? "");
		setCurrentConditionValue(
			latestInspection.currentConditionValue?.toString() ??
				latestInspection.suggestedCommercialValue?.toString() ??
				"",
		);
	}, [open, latestInspection]);

	const saveMutation = useMutation({
		mutationFn: async () => {
			return clientWithManualValuation.upsertManualVehicleValuation({
				vehicleId,
				vehicleRating,
				marketValue,
				suggestedCommercialValue,
				bankValue,
				currentConditionValue,
			});
		},
		onSuccess: (result) => {
			toast.success(
				result.action === "updated"
					? "Valores mínimos actualizados"
					: "Valores mínimos cargados",
			);
			queryClient.invalidateQueries({
				queryKey: ["getLatestInspectionByVehicleId", vehicleId],
			});
			queryClient.invalidateQueries({ queryKey: ["getVehicleById", vehicleId] });
			onOpenChange(false);
		},
		onError: (error: any) => {
			const message =
				error?.message && typeof error.message === "string"
					? error.message
					: "Ocurrió un error al guardar la valoración. Inténtalo nuevamente.";
			toast.error(message);
		},
	});

	const isManualValuation =
		latestInspection?.technicianName === MANUAL_TECHNICIAN_NAME;
	const isDisabled =
		!marketValue ||
		!suggestedCommercialValue ||
		!bankValue ||
		!currentConditionValue ||
		saveMutation.isPending;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>Carga de valores mínimos</DialogTitle>
					<DialogDescription>{vehicleLabel}</DialogDescription>
				</DialogHeader>

				<div className="space-y-4">
					{latestInspectionQuery.isLoading ? (
						<div className="flex items-center gap-2 text-muted-foreground text-sm">
							<Loader2 className="h-4 w-4 animate-spin" />
							Cargando última inspección...
						</div>
					) : latestInspection ? (
						<div className="rounded-lg border bg-muted/30 p-3 text-sm">
							<div className="font-medium">
								{isManualValuation
									? "Última carga manual encontrada"
									: "Última inspección registrada"}
							</div>
							<div className="mt-2 grid gap-1 text-muted-foreground">
								<span>
									Clasificación: {latestInspection.vehicleRating || "Sin dato"}
								</span>
								<span>
									Mercado: Q
									{Number(latestInspection.marketValue || 0).toLocaleString()}
								</span>
								<span>
									Sugerido: Q
									{Number(
										latestInspection.suggestedCommercialValue || 0,
									).toLocaleString()}
								</span>
								<span>
									Bancario: Q
									{Number(latestInspection.bankValue || 0).toLocaleString()}
								</span>
							</div>
						</div>
					) : (
						<div className="rounded-lg border border-dashed p-3 text-muted-foreground text-sm">
							Este vehículo no tiene inspección previa. Se creará una carga
							manual nueva.
						</div>
					)}

					<div className="grid gap-4 sm:grid-cols-2">
						<div className="space-y-2">
							<Label>Clasificación</Label>
							<Select
								value={vehicleRating}
								onValueChange={(value) =>
									setVehicleRating(value as "Comercial" | "No comercial")
								}
							>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="Comercial">Comercial</SelectItem>
									<SelectItem value="No comercial">No comercial</SelectItem>
								</SelectContent>
							</Select>
						</div>

						<div className="space-y-2">
							<Label>Valor mercado</Label>
							<Input
								inputMode="decimal"
								value={marketValue}
								onChange={(event) => setMarketValue(event.target.value)}
								placeholder="60000"
							/>
						</div>

						<div className="space-y-2">
							<Label>Valor comercial sugerido</Label>
							<Input
								inputMode="decimal"
								value={suggestedCommercialValue}
								onChange={(event) => {
									const value = event.target.value;
									setSuggestedCommercialValue(value);
									if (!currentConditionValue) {
										setCurrentConditionValue(value);
									}
								}}
								placeholder="56000"
							/>
						</div>

						<div className="space-y-2">
							<Label>Valor bancario</Label>
							<Input
								inputMode="decimal"
								value={bankValue}
								onChange={(event) => setBankValue(event.target.value)}
								placeholder="47000"
							/>
						</div>

						<div className="space-y-2 sm:col-span-2">
							<Label>Valor condiciones actuales</Label>
							<Input
								inputMode="decimal"
								value={currentConditionValue}
								onChange={(event) =>
									setCurrentConditionValue(event.target.value)
								}
								placeholder="56000"
							/>
						</div>
					</div>
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancelar
					</Button>
					<Button disabled={isDisabled} onClick={() => saveMutation.mutate()}>
						{saveMutation.isPending ? (
							<>
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
								Guardando...
							</>
						) : (
							<>
								<PencilLine className="mr-2 h-4 w-4" />
								Guardar valores mínimos
							</>
						)}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
