import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	AlertCircle,
	AlertTriangle,
	Car,
	CheckCircle2,
	CreditCard,
	Loader2,
	Plus,
	Trash2,
	TrendingUp,
	User,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
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
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { client, orpc } from "@/utils/orpc";

// Type for selected investor
interface SelectedInversionista {
	inversionista_id: number;
	nombre: string;
	porcentaje_participacion: number;
	monto_aportado: number;
	porcentaje_cash_in: number;
}

// Type for opportunity from getOpportunitiesForInvestment
type InvestmentOpportunity = Awaited<
	ReturnType<typeof client.getOpportunitiesForInvestment>
>[0];

export function InvestmentAssignmentSection() {
	const queryClient = useQueryClient();
	const [selectedOpportunityId, setSelectedOpportunityId] = useState<
		string | null
	>(null);
	const [selectedInversionistas, setSelectedInversionistas] = useState<
		SelectedInversionista[]
	>([]);

	// Query for opportunities at 50%
	const {
		data: opportunities,
		isLoading: isLoadingOpportunities,
		refetch: refetchOpportunities,
	} = useQuery({
		queryKey: ["getOpportunitiesForInvestment"],
		queryFn: () => client.getOpportunitiesForInvestment(),
	});

	// Query for available investors
	const inversionistasQuery = useQuery({
		queryKey: ["getInversionistas"],
		queryFn: () => client.getInversionistas({ page: 1, perPage: 100 }),
	});

	// Mutation to assign investor and advance
	const assignMutation = useMutation({
		mutationFn: async ({
			opportunityId,
			inversionistas,
		}: {
			opportunityId: string;
			inversionistas: string;
		}) => {
			return client.assignInvestorAndAdvance({ opportunityId, inversionistas });
		},
		onSuccess: () => {
			toast.success("Inversionista asignado y oportunidad avanzada a 80%");
			queryClient.invalidateQueries({
				queryKey: ["getOpportunitiesForInvestment"],
			});
			queryClient.invalidateQueries({ queryKey: ["getOpportunities"] });
			setSelectedOpportunityId(null);
			setSelectedInversionistas([]);
			refetchOpportunities();
		},
		onError: (error: Error) => {
			toast.error(error.message || "Error al asignar inversionista");
		},
	});

	const selectedOpportunity = opportunities?.find(
		(o) => o.id === selectedOpportunityId,
	);

	// Calculate totals
	const totalMonto = selectedInversionistas.reduce(
		(sum, inv) => sum + (inv.monto_aportado || 0),
		0,
	);
	const creditAmount = selectedOpportunity?.value
		? Number(selectedOpportunity.value)
		: 0;

	// Add new investor row
	const handleAddInversionista = () => {
		setSelectedInversionistas([
			...selectedInversionistas,
			{
				inversionista_id: 0,
				nombre: "",
				porcentaje_participacion: 0,
				monto_aportado: 0,
				porcentaje_cash_in: 0,
			},
		]);
	};

	// Remove investor row
	const handleRemoveInversionista = (index: number) => {
		const newList = [...selectedInversionistas];
		newList.splice(index, 1);
		setSelectedInversionistas(newList);
	};

	// Update investor data
	const handleUpdateInversionista = (
		index: number,
		field: keyof SelectedInversionista,
		value: string | number,
	) => {
		const newList = [...selectedInversionistas];
		if (field === "inversionista_id") {
			const selectedInv = inversionistasQuery.data?.inversionistas?.find(
				(i) => i.inversionistaId.toString() === value,
			);
			newList[index].inversionista_id = Number(value);
			newList[index].nombre = selectedInv?.nombre || "";
		} else if (
			field === "monto_aportado" ||
			field === "porcentaje_participacion" ||
			field === "porcentaje_cash_in"
		) {
			newList[index][field] = Number(value) || 0;
		}
		setSelectedInversionistas(newList);
	};

	// Handle assign and advance
	const handleAssign = () => {
		if (!selectedOpportunityId || selectedInversionistas.length === 0) return;

		// Validate investors have required data
		const invalidInvestors = selectedInversionistas.filter(
			(inv) => !inv.inversionista_id || inv.monto_aportado <= 0,
		);

		if (invalidInvestors.length > 0) {
			toast.error(
				"Todos los inversionistas deben tener un inversionista seleccionado y un monto mayor a 0",
			);
			return;
		}

		assignMutation.mutate({
			opportunityId: selectedOpportunityId,
			inversionistas: JSON.stringify(selectedInversionistas),
		});
	};

	// Check if can assign
	const canAssign =
		selectedOpportunity &&
		selectedInversionistas.length > 0 &&
		selectedInversionistas.every(
			(inv) => inv.inversionista_id > 0 && inv.monto_aportado > 0,
		) &&
		selectedOpportunity.lead?.hasRequiredData &&
		selectedOpportunity.vehicle?.hasRequiredData &&
		selectedOpportunity.hasCreditData;

	// Get disabled reason for tooltip
	const getDisabledReasons = () => {
		const reasons: string[] = [];
		if (!selectedOpportunity) return reasons;

		if (selectedInversionistas.length === 0) {
			reasons.push("Debe agregar al menos un inversionista");
		} else {
			const invalidInvestors = selectedInversionistas.filter(
				(inv) => !inv.inversionista_id || inv.monto_aportado <= 0,
			);
			if (invalidInvestors.length > 0) {
				reasons.push(
					"Todos los inversionistas deben tener datos válidos y monto > 0",
				);
			}
		}

		if (!selectedOpportunity.lead?.hasRequiredData) {
			reasons.push(
				`Cliente: Faltan ${selectedOpportunity.lead?.missingFields?.join(", ")}`,
			);
		}

		if (!selectedOpportunity.vehicle?.hasRequiredData) {
			reasons.push(
				`Vehículo: Faltan ${selectedOpportunity.vehicle?.missingFields?.join(", ")}`,
			);
		}

		if (!selectedOpportunity.hasCreditData) {
			reasons.push("Faltan datos del crédito (cuotas, tasa, monto)");
		}

		return reasons;
	};

	const formatCurrency = (value: number | string | null) => {
		if (!value) return "Q0.00";
		return new Intl.NumberFormat("es-GT", {
			style: "currency",
			currency: "GTQ",
		}).format(Number(value));
	};

	if (isLoadingOpportunities) {
		return (
			<Card>
				<CardContent className="flex items-center justify-center py-8">
					<Loader2 className="mr-2 h-6 w-6 animate-spin" />
					<p className="text-muted-foreground">Cargando oportunidades...</p>
				</CardContent>
			</Card>
		);
	}

	if (!opportunities || opportunities.length === 0) {
		return (
			<Alert>
				<AlertCircle className="h-4 w-4" />
				<AlertDescription>
					No hay oportunidades pendientes de asignación de inversión en este
					momento.
				</AlertDescription>
			</Alert>
		);
	}

	return (
		<div className="grid gap-6 lg:grid-cols-2">
			{/* List of opportunities */}
			<Card>
				<CardHeader>
					<CardTitle>Oportunidades en 50%</CardTitle>
					<CardDescription>
						{opportunities.length} oportunidad
						{opportunities.length !== 1 ? "es" : ""} pendientes de asignación de
						inversión
					</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="space-y-3">
						{opportunities.map((opp) => (
							<div
								key={opp.id}
								className={`cursor-pointer rounded-lg border p-4 transition-colors hover:bg-muted/50 ${
									selectedOpportunityId === opp.id
										? "border-primary bg-muted/50"
										: ""
								}`}
								onClick={() => {
									setSelectedOpportunityId(opp.id);
									setSelectedInversionistas([]);
								}}
							>
								<div className="flex items-center justify-between">
									<div>
										<p className="font-medium">
											{opp.lead?.name || "Sin cliente"}
										</p>
										<p className="text-muted-foreground text-sm">
											{opp.vehicle?.description || "Sin vehículo"}
										</p>
										<p className="font-mono text-[10px] text-muted-foreground/60">
											ID: {opp.id.slice(0, 8)}
										</p>
									</div>
									<div className="text-right">
										<p className="font-medium">{formatCurrency(opp.value)}</p>
										<div className="flex items-center gap-2">
											{opp.hasInvestor ? (
												<Badge variant="default">Con inversor</Badge>
											) : (
												<Badge variant="outline">Sin inversor</Badge>
											)}
										</div>
									</div>
								</div>

								{/* Validation indicators */}
								<div className="mt-2 flex flex-wrap gap-1">
									<Badge
										variant={
											opp.lead?.hasRequiredData ? "secondary" : "destructive"
										}
										className="text-xs"
									>
										<User className="mr-1 h-3 w-3" />
										Cliente{" "}
										{opp.lead?.hasRequiredData ? (
											<CheckCircle2 className="ml-1 h-3 w-3" />
										) : (
											<AlertTriangle className="ml-1 h-3 w-3" />
										)}
									</Badge>
									<Badge
										variant={
											opp.vehicle?.hasRequiredData ? "secondary" : "destructive"
										}
										className="text-xs"
									>
										<Car className="mr-1 h-3 w-3" />
										Vehículo{" "}
										{opp.vehicle?.hasRequiredData ? (
											<CheckCircle2 className="ml-1 h-3 w-3" />
										) : (
											<AlertTriangle className="ml-1 h-3 w-3" />
										)}
									</Badge>
									<Badge
										variant={opp.hasCreditData ? "secondary" : "destructive"}
										className="text-xs"
									>
										<CreditCard className="mr-1 h-3 w-3" />
										Crédito{" "}
										{opp.hasCreditData ? (
											<CheckCircle2 className="ml-1 h-3 w-3" />
										) : (
											<AlertTriangle className="ml-1 h-3 w-3" />
										)}
									</Badge>
								</div>
							</div>
						))}
					</div>
				</CardContent>
			</Card>

			{/* Assignment panel */}
			<div>
				{selectedOpportunity ? (
					<Card>
						<CardHeader className="pb-3">
							<div className="flex items-center justify-between">
								<CardTitle className="text-lg">Asignar Inversión</CardTitle>
								<Badge
									variant="outline"
									style={{
										borderColor: selectedOpportunity.stage.color,
										color: selectedOpportunity.stage.color,
									}}
								>
									{selectedOpportunity.stage.closurePercentage}%
								</Badge>
							</div>
							<div className="mt-2 text-muted-foreground text-sm">
								<span className="font-medium">
									{selectedOpportunity.lead?.name || "Sin cliente"}
								</span>{" "}
								- {formatCurrency(selectedOpportunity.value)}
							</div>
						</CardHeader>
						<CardContent className="space-y-4">
							{/* Validation summary */}
							<div className="space-y-2">
								<Label className="font-medium text-sm">
									Estado de validación
								</Label>
								<div className="space-y-2 rounded-lg border bg-muted/30 p-3">
									{/* Lead validation */}
									<div className="flex items-center gap-2">
										{selectedOpportunity.lead?.hasRequiredData ? (
											<CheckCircle2 className="h-4 w-4 text-green-500" />
										) : (
											<AlertTriangle className="h-4 w-4 text-destructive" />
										)}
										<span className="text-sm">
											Cliente:{" "}
											{selectedOpportunity.lead?.hasRequiredData
												? "Datos completos"
												: `Faltan: ${selectedOpportunity.lead?.missingFields?.join(", ")}`}
										</span>
									</div>

									{/* Vehicle validation */}
									<div className="flex items-center gap-2">
										{selectedOpportunity.vehicle?.hasRequiredData ? (
											<CheckCircle2 className="h-4 w-4 text-green-500" />
										) : (
											<AlertTriangle className="h-4 w-4 text-destructive" />
										)}
										<span className="text-sm">
											Vehículo:{" "}
											{selectedOpportunity.vehicle?.hasRequiredData
												? "Datos completos"
												: `Faltan: ${selectedOpportunity.vehicle?.missingFields?.join(", ")}`}
										</span>
									</div>

									{/* Credit validation */}
									<div className="flex items-center gap-2">
										{selectedOpportunity.hasCreditData ? (
											<CheckCircle2 className="h-4 w-4 text-green-500" />
										) : (
											<AlertTriangle className="h-4 w-4 text-destructive" />
										)}
										<span className="text-sm">
											Crédito:{" "}
											{selectedOpportunity.hasCreditData
												? "Datos completos"
												: "Faltan datos (cuotas, tasa, monto)"}
										</span>
									</div>
								</div>
							</div>

							{/* Investors section */}
							<div className="space-y-2">
								<div className="flex items-center justify-between">
									<Label className="font-medium text-sm">Inversionistas</Label>
									<Button
										type="button"
										variant="outline"
										size="sm"
										onClick={handleAddInversionista}
									>
										<Plus className="mr-1 h-4 w-4" />
										Agregar
									</Button>
								</div>

								{selectedInversionistas.length === 0 ? (
									<div className="rounded-lg border bg-muted/30 p-4 text-center text-muted-foreground text-sm">
										No hay inversionistas asignados. Haga clic en "Agregar" para
										agregar uno.
									</div>
								) : (
									<div className="space-y-3">
										{selectedInversionistas.map((inv, index) => (
											<div
												key={index}
												className="rounded-lg border bg-background p-3"
											>
												<div className="space-y-3">
													{/* Investor selector */}
													<div>
														<Label className="text-xs">Inversionista</Label>
														<Combobox
															value={inv.inversionista_id?.toString() || ""}
															onChange={(value) =>
																handleUpdateInversionista(
																	index,
																	"inversionista_id",
																	value,
																)
															}
															options={
																inversionistasQuery.data?.inversionistas?.map(
																	(investor) => ({
																		label: investor.nombre,
																		value: investor.inversionistaId.toString(),
																	}),
																) || []
															}
															placeholder="Seleccionar inversionista..."
															width="full"
														/>
													</div>

													{/* Amount */}
													<div className="grid grid-cols-2 gap-2">
														<div>
															<Label className="text-xs">Monto aportado</Label>
															<Input
																type="number"
																value={inv.monto_aportado || ""}
																onChange={(e) =>
																	handleUpdateInversionista(
																		index,
																		"monto_aportado",
																		e.target.value,
																	)
																}
																placeholder="Q0.00"
															/>
														</div>
														<div>
															<Label className="text-xs">% Participación</Label>
															<Input
																type="number"
																value={inv.porcentaje_participacion || ""}
																onChange={(e) =>
																	handleUpdateInversionista(
																		index,
																		"porcentaje_participacion",
																		e.target.value,
																	)
																}
																placeholder="0%"
															/>
														</div>
													</div>

													{/* Remove button */}
													<div className="flex justify-end">
														<Button
															type="button"
															variant="ghost"
															size="sm"
															onClick={() => handleRemoveInversionista(index)}
														>
															<Trash2 className="mr-1 h-4 w-4" />
															Eliminar
														</Button>
													</div>
												</div>
											</div>
										))}

										{/* Total summary */}
										<div className="rounded-lg border bg-muted/50 p-3">
											<div className="flex items-center justify-between">
												<span className="font-medium text-sm">
													Total aportado:
												</span>
												<span
													className={`font-bold ${
														Math.abs(totalMonto - creditAmount) < 1
															? "text-green-600"
															: "text-orange-600"
													}`}
												>
													{formatCurrency(totalMonto)}
												</span>
											</div>
											<div className="flex items-center justify-between text-muted-foreground text-sm">
												<span>Capital del crédito:</span>
												<span>{formatCurrency(creditAmount)}</span>
											</div>
											{Math.abs(totalMonto - creditAmount) >= 1 && (
												<p className="mt-1 text-orange-600 text-xs">
													La suma de aportes debe ser igual al capital del
													crédito
												</p>
											)}
										</div>
									</div>
								)}
							</div>

							{/* Action button */}
							<div className="pt-4">
								<Button
									className="w-full"
									onClick={handleAssign}
									disabled={!canAssign || assignMutation.isPending}
								>
									{assignMutation.isPending ? (
										<Loader2 className="mr-2 h-4 w-4 animate-spin" />
									) : (
										<TrendingUp className="mr-2 h-4 w-4" />
									)}
									{canAssign
										? "Asignar y Avanzar a 80%"
										: "Complete los datos para continuar"}
								</Button>

								{/* Show reasons if disabled */}
								{!canAssign && getDisabledReasons().length > 0 && (
									<div className="mt-2 rounded border border-orange-200 bg-orange-50 p-2">
										<p className="mb-1 font-medium text-orange-800 text-xs">
											No se puede avanzar:
										</p>
										<ul className="list-inside list-disc text-orange-700 text-xs">
											{getDisabledReasons().map((reason, idx) => (
												<li key={idx}>{reason}</li>
											))}
										</ul>
									</div>
								)}
							</div>
						</CardContent>
					</Card>
				) : (
					<Card>
						<CardContent className="flex items-center justify-center py-12">
							<p className="text-muted-foreground">
								Selecciona una oportunidad para asignar inversión
							</p>
						</CardContent>
					</Card>
				)}
			</div>
		</div>
	);
}
