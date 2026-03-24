import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	AlertCircle,
	AlertTriangle,
	Car,
	CheckCircle2,
	ChevronLeft,
	ChevronRight,
	ChevronsLeft,
	ChevronsRight,
	CreditCard,
	Eye,
	FileText,
	Loader2,
	Pencil,
	Plus,
	Save,
	Search,
	Trash2,
	TrendingUp,
	User,
} from "lucide-react";
import { startTransition, useEffect, useState } from "react";
import { toast } from "sonner";
import {
	OpportunityDetailModal,
	type OpportunityForModal,
} from "@/components/opportunity-detail-modal";
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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { client } from "@/utils/orpc";

// Type for selected investor
interface SelectedInversionista {
	inversionista_id: number;
	nombre: string;
	porcentaje_participacion: number;
	monto_aportado: number;
	porcentaje_cash_in: number;
}

// Credit categories type
type CreditCategory =
	| ""
	| "Contraseña"
	| "CV Vehículo"
	| "CV Vehículo nuevo"
	| "Fiduciario"
	| "Hipotecario"
	| "Vehículo";

type PaymentDay = 15 | 30;

// Type for existing investor from DB
type ExistingInvestor = {
	inversionista_id: number;
	nombre: string;
	porcentaje_participacion: number;
	monto_aportado: number;
	porcentaje_cash_in?: number;
};

// Type for opportunity from getOpportunitiesForInvestment
type InvestmentOpportunity = Awaited<
	ReturnType<typeof client.getOpportunitiesForInvestment>
>["data"][number] & {
	existingInvestors?: ExistingInvestor[];
};

export function InvestmentAssignmentSection({
	initialOpportunityId,
}: {
	initialOpportunityId?: string;
} = {}) {
	const queryClient = useQueryClient();
	const [selectedOpportunityId, setSelectedOpportunityId] = useState<
		string | null
	>(initialOpportunityId ?? null);
	const [selectedInversionistas, setSelectedInversionistas] = useState<
		SelectedInversionista[]
	>([]);
	const [isEditingExisting, setIsEditingExisting] = useState(false);
	const [editedExistingInvestors, setEditedExistingInvestors] = useState<
		SelectedInversionista[]
	>([]);

	// Estados para campos adicionales del detalle de crédito
	const [editDireccion, setEditDireccion] = useState<string>("");
	const [editNit, setEditNit] = useState<string>("");
	// Default: si estamos del 1-20 del mes es 15, si es 21-31 es último día (31)
	const getDefaultDiaPago = (): PaymentDay => {
		const today = new Date();
		const dayOfMonth = today.getDate();
		return dayOfMonth <= 20 ? 15 : 30;
	};
	const [editDiaPagoMensual, setEditDiaPagoMensual] =
		useState<PaymentDay>(getDefaultDiaPago);

	// Función para calcular la categoría automáticamente basándose en creditType y vehicle.isNew
	const getAutomaticCategoria = (
		opp: InvestmentOpportunity | undefined,
	): CreditCategory => {
		if (!opp) return "";

		// Si es sobre vehículo, siempre es "Vehículo"
		if (opp.creditType === "sobre_vehiculo") {
			return "Vehículo";
		}

		// Si es autocompra, depende de si el vehículo es nuevo o no
		if (opp.creditType === "autocompra") {
			if (opp.vehicle?.isNew) {
				return "CV Vehículo nuevo";
			}
			return "CV Vehículo";
		}

		return "";
	};

	// Estados para el modal de detalle de oportunidad
	const [isOpportunityModalOpen, setIsOpportunityModalOpen] = useState(false);
	const [selectedOpportunityForModal, setSelectedOpportunityForModal] =
		useState<OpportunityForModal | null>(null);

	// Search and pagination states
	const [searchTerm, setSearchTerm] = useState("");
	const [debouncedSearch, setDebouncedSearch] = useState("");
	const [page, setPage] = useState(0);
	const pageSize = 20;

	// Debounce search input
	useEffect(() => {
		const timer = setTimeout(() => {
			setDebouncedSearch(searchTerm);
			setPage(0); // Reset to first page on search
		}, 300);
		return () => clearTimeout(timer);
	}, [searchTerm]);

	// Query for opportunities at 50%
	const {
		data: opportunitiesData,
		isLoading: isLoadingOpportunities,
		refetch: refetchOpportunities,
	} = useQuery({
		queryKey: [
			"getOpportunitiesForInvestment",
			page,
			pageSize,
			debouncedSearch,
		],
		queryFn: () =>
			client.getOpportunitiesForInvestment({
				limit: pageSize,
				offset: page * pageSize,
				search: debouncedSearch || undefined,
			}),
	});

	const opportunities = (opportunitiesData?.data ??
		[]) as InvestmentOpportunity[];
	const total = opportunitiesData?.total ?? 0;
	const totalPages = Math.ceil(total / pageSize);

	// Query for available investors
	const inversionistasQuery = useQuery({
		queryKey: ["getInversionistas"],
		queryFn: () => client.getInversionistas({ page: 1, perPage: 100 }),
	});

	const selectedOpportunity = opportunities?.find(
		(o) => o.id === selectedOpportunityId,
	);

	// Inicializar valores cuando se selecciona una oportunidad
	useEffect(() => {
		if (selectedOpportunity) {
			// Dirección: usar la del lead si existe
			setEditDireccion(selectedOpportunity.lead?.direccion || "");
			// NIT: usar el de la oportunidad si existe
			setEditNit(selectedOpportunity.nit || "");
			// Día de pago: usar el de la oportunidad o calcular default según fecha actual
			setEditDiaPagoMensual(
				(selectedOpportunity.diaPagoMensual as PaymentDay) ||
					getDefaultDiaPago(),
			);
			// Limpiar inversionistas seleccionados
			setSelectedInversionistas([]);
			setIsEditingExisting(false);
			setEditedExistingInvestors([]);
		}
	}, [selectedOpportunity]);

	// Mutation to assign investor and advance
	const assignMutation = useMutation({
		mutationFn: async ({
			opportunityId,
			inversionistas,
			categoria,
			nit,
			diaPagoMensual,
		}: {
			opportunityId: string;
			inversionistas?: string;
			categoria: CreditCategory;
			nit: string;
			diaPagoMensual: PaymentDay;
		}) => {
			return client.assignInvestorAndAdvance({
				opportunityId,
				...(inversionistas && { inversionistas }),
				// @ts-expect-error
				categoria: categoria,
				nit: nit,
				diaPagoMensual: diaPagoMensual,
			});
		},
		onSuccess: () => {
			toast.success("Inversionista asignado y oportunidad avanzada a 80%");
			queryClient.invalidateQueries({
				queryKey: ["getOpportunitiesForInvestment"],
			});
			queryClient.invalidateQueries({ queryKey: ["getOpportunities"] });
			setSelectedOpportunityId(null);
			setSelectedInversionistas([]);
			// Reset campos adicionales
			setEditNit("");
			setEditDiaPagoMensual(15);
			refetchOpportunities();
		},
		onError: (error: Error) => {
			toast.error(error.message || "Error al asignar inversionista");
		},
	});

	const updateInvestorsMutation = useMutation({
		mutationFn: async ({
			opportunityId,
			inversionistas,
		}: {
			opportunityId: string;
			inversionistas: string;
		}) => {
			return client.updateOpportunityInvestors({
				opportunityId,
				inversionistas,
			});
		},
		onSuccess: () => {
			toast.success("Inversionistas actualizados correctamente");
			queryClient.invalidateQueries({
				queryKey: ["getOpportunitiesForInvestment"],
			});
			setIsEditingExisting(false);
			setEditedExistingInvestors([]);
			refetchOpportunities();
		},
		onError: (error: Error) => {
			toast.error(error.message || "Error al actualizar inversionistas");
		},
	});

	// Calculate totals
	const totalMonto = selectedInversionistas.reduce(
		(sum, inv) => sum + (inv.monto_aportado || 0),
		0,
	);
	const totalMontoExistentes =
		selectedOpportunity?.existingInvestors?.reduce(
			(sum, inv) => sum + (inv.monto_aportado || 0),
			0,
		) || 0;
	const totalMontoGeneral = totalMonto + totalMontoExistentes;
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

	const handleStartEditExisting = () => {
		if (!selectedOpportunity?.existingInvestors) return;
		setEditedExistingInvestors(
			selectedOpportunity.existingInvestors.map((inv) => ({
				inversionista_id: inv.inversionista_id,
				nombre: inv.nombre,
				porcentaje_participacion: inv.porcentaje_participacion,
				monto_aportado: inv.monto_aportado,
				porcentaje_cash_in: inv.porcentaje_cash_in ?? 0,
			})),
		);
		setIsEditingExisting(true);
	};

	const handleCancelEditExisting = () => {
		setIsEditingExisting(false);
		setEditedExistingInvestors([]);
	};

	const handleUpdateExistingInvestor = (
		index: number,
		field: keyof SelectedInversionista,
		value: string | number,
	) => {
		const newList = [...editedExistingInvestors];
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
		setEditedExistingInvestors(newList);
	};

	const handleRemoveExistingInvestor = (index: number) => {
		const newList = [...editedExistingInvestors];
		newList.splice(index, 1);
		setEditedExistingInvestors(newList);
	};

	const handleAddExistingInvestor = () => {
		setEditedExistingInvestors([
			...editedExistingInvestors,
			{
				inversionista_id: 0,
				nombre: "",
				porcentaje_participacion: 0,
				monto_aportado: 0,
				porcentaje_cash_in: 0,
			},
		]);
	};

	const handleSaveExistingInvestors = () => {
		if (!selectedOpportunityId) return;
		const invalid = editedExistingInvestors.filter(
			(inv) => !inv.inversionista_id || inv.monto_aportado <= 0,
		);
		if (invalid.length > 0) {
			toast.error(
				"Todos los inversionistas deben tener datos válidos y monto > 0",
			);
			return;
		}
		const totalPart = editedExistingInvestors.reduce(
			(sum, inv) => sum + (inv.porcentaje_participacion || 0),
			0,
		);
		if (Math.abs(totalPart - 100) >= 0.01) {
			toast.error(
				`La suma de porcentajes de participación debe ser 100% (actual: ${totalPart}%)`,
			);
			return;
		}
		updateInvestorsMutation.mutate({
			opportunityId: selectedOpportunityId,
			inversionistas: JSON.stringify(editedExistingInvestors),
		});
	};

	// Handle assign and advance
	const handleAssign = () => {
		if (!selectedOpportunityId) return;

		const hasExisting =
			(selectedOpportunity?.existingInvestors?.length ?? 0) > 0;

		if (selectedInversionistas.length === 0 && !hasExisting) {
			toast.error("Debe agregar al menos un inversionista");
			return;
		}

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

		// Calcular la categoría automáticamente
		const categoriaAutomatica = getAutomaticCategoria(selectedOpportunity);

		assignMutation.mutate({
			opportunityId: selectedOpportunityId,
			// Solo enviar inversionistas si hay nuevos seleccionados
			...(selectedInversionistas.length > 0 && {
				inversionistas: JSON.stringify(selectedInversionistas),
			}),
			categoria: categoriaAutomatica,
			nit: editNit,
			diaPagoMensual: editDiaPagoMensual,
		});
	};

	// Check if can assign
	const hasExistingInvestors =
		(selectedOpportunity?.existingInvestors?.length ?? 0) > 0;
	const hasNewInvestors =
		selectedInversionistas.length > 0 &&
		selectedInversionistas.every(
			(inv) => inv.inversionista_id > 0 && inv.monto_aportado > 0,
		);
	// Validar que los montos sean exactamente iguales (siempre, con existentes + nuevos)
	const montosCoinciden = Math.abs(totalMontoGeneral - creditAmount) < 0.01;
	const hasValidNit = editNit.trim().length > 0;
	// Validate total participation equals 100%
	const totalParticipacion =
		selectedInversionistas.reduce(
			(sum, inv) => sum + (inv.porcentaje_participacion || 0),
			0,
		) +
		(selectedOpportunity?.existingInvestors?.reduce(
			(sum, inv) => sum + (inv.porcentaje_participacion || 0),
			0,
		) || 0);
	const participacionCoincide = Math.abs(totalParticipacion - 100) < 0.01;
	const canAssign =
		selectedOpportunity &&
		(hasExistingInvestors || hasNewInvestors) &&
		selectedOpportunity.lead?.hasRequiredData &&
		selectedOpportunity.vehicle?.hasRequiredData &&
		selectedOpportunity.hasCreditData &&
		montosCoinciden &&
		participacionCoincide &&
		hasValidNit;

	// Get disabled reason for tooltip
	const getDisabledReasons = () => {
		const reasons: string[] = [];
		if (!selectedOpportunity) return reasons;

		const hasExisting =
			(selectedOpportunity?.existingInvestors?.length ?? 0) > 0;

		if (selectedInversionistas.length === 0 && !hasExisting) {
			reasons.push("Debe agregar al menos un inversionista");
		} else if (selectedInversionistas.length > 0) {
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

		if (Math.abs(totalMontoGeneral - creditAmount) >= 0.01) {
			reasons.push(
				`La suma de aportes (${formatCurrency(totalMontoGeneral)}) debe ser exactamente igual al capital del crédito (${formatCurrency(creditAmount)})`,
			);
		}

		if (Math.abs(totalParticipacion - 100) >= 0.01) {
			reasons.push(
				`La suma de porcentajes de participación debe ser exactamente 100% (actual: ${totalParticipacion}%)`,
			);
		}

		if (!editNit.trim()) {
			reasons.push("El NIT es obligatorio");
		}

		return reasons;
	};

	const formatCurrency = (value: number | string | null) => {
		if (!value) return "Q0.00";
		return new Intl.NumberFormat("es-GT", {
			style: "currency",
			currency: "GTQ",
			minimumFractionDigits: 2,
			maximumFractionDigits: 2,
		}).format(Number(value));
	};

	// Función para abrir el modal de detalle de oportunidad
	const handleOpenOpportunityModal = (opp: InvestmentOpportunity) => {
		setSelectedOpportunityForModal({
			id: opp.id,
			title: opp.title || opp.lead?.name || "Oportunidad",
			value: opp.value,
			creditType: null,
			status: "open",
			expectedCloseDate: null,
			createdAt: opp.createdAt,
			lead: opp.lead
				? {
						id: opp.lead.id,
						firstName: opp.lead.name?.split(" ")[0] || "",
						lastName: opp.lead.name?.split(" ").slice(1).join(" ") || "",
						dpi: null,
						email: null,
						phone: opp.lead.phone,
					}
				: null,
			stage: opp.stage?.id
				? {
						id: opp.stage.id,
						name: opp.stage.name,
						closurePercentage: opp.stage.closurePercentage,
						color: opp.stage.color,
					}
				: null,
			assignedUser: null,
			vehicle: opp.vehicle
				? {
						id: opp.vehicle.id,
						make: opp.vehicle.description?.split(" ")[0] || "",
						model:
							opp.vehicle.description?.split(" ").slice(1, -1).join(" ") || "",
						year:
							Number.parseInt(
								opp.vehicle.description?.split(" ").pop() || "0",
							) || 0,
						licensePlate: opp.vehicle.licensePlate,
						color: null,
						isNew: opp.vehicle.isNew,
					}
				: null,
		});
		setIsOpportunityModalOpen(true);
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

	return (
		<div className="grid gap-6 lg:grid-cols-2">
			{/* List of opportunities */}
			<Card>
				<CardHeader>
					<CardTitle>Oportunidades en 50%</CardTitle>
					<CardDescription>
						{total} oportunidad
						{total !== 1 ? "es" : ""} pendientes de asignación de inversión
					</CardDescription>
				</CardHeader>
				<CardContent>
					{/* Buscador */}
					<div className="mb-4 flex items-center gap-4">
						<div className="relative flex-1">
							<Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
							<Input
								placeholder="Buscar por nombre, placa..."
								value={searchTerm}
								onChange={(e) => {
									const value = e.target.value;
									startTransition(() => setSearchTerm(value));
								}}
								className="pl-10"
							/>
						</div>
					</div>

					{opportunities.length === 0 ? (
						<Alert>
							<AlertCircle className="h-4 w-4" />
							<AlertDescription>
								{debouncedSearch
									? "No se encontraron oportunidades con ese criterio de búsqueda."
									: "No hay oportunidades pendientes de asignación de inversión en este momento."}
							</AlertDescription>
						</Alert>
					) : (
						<>
							<div className="space-y-3">
								{opportunities.map((opp) => (
									<div
										key={opp.id}
										className={`cursor-pointer rounded-lg border p-4 transition-colors hover:bg-muted/50 ${
											selectedOpportunityId === opp.id
												? "border-primary bg-muted/50"
												: ""
										}`}
										role="button"
										tabIndex={0}
										onClick={() => {
											setSelectedOpportunityId(opp.id);
											setSelectedInversionistas([]);
										}}
										onKeyDown={(e) => {
											if (e.key === "Enter" || e.key === " ") {
												e.preventDefault();
												setSelectedOpportunityId(opp.id);
												setSelectedInversionistas([]);
											}
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
												<p className="font-medium">
													{formatCurrency(opp.value)}
												</p>
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
													opp.lead?.hasRequiredData
														? "secondary"
														: "destructive"
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
													opp.vehicle?.hasRequiredData
														? "secondary"
														: "destructive"
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
												variant={
													opp.hasCreditData ? "secondary" : "destructive"
												}
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

							{/* Paginación */}
							{totalPages > 1 && (
								<div className="mt-4 flex items-center justify-between border-t pt-4">
									<span className="text-muted-foreground text-sm">
										Mostrando {page * pageSize + 1} -{" "}
										{Math.min((page + 1) * pageSize, total)} de {total}
									</span>
									<div className="flex items-center gap-2">
										<Button
											variant="outline"
											size="sm"
											onClick={() => setPage(0)}
											disabled={page === 0}
										>
											<ChevronsLeft className="h-4 w-4" />
										</Button>
										<Button
											variant="outline"
											size="sm"
											onClick={() => setPage((p) => Math.max(0, p - 1))}
											disabled={page === 0}
										>
											<ChevronLeft className="h-4 w-4" />
										</Button>
										<span className="px-2 text-sm">
											Página {page + 1} de {totalPages}
										</span>
										<Button
											variant="outline"
											size="sm"
											onClick={() =>
												setPage((p) => Math.min(totalPages - 1, p + 1))
											}
											disabled={page >= totalPages - 1}
										>
											<ChevronRight className="h-4 w-4" />
										</Button>
										<Button
											variant="outline"
											size="sm"
											onClick={() => setPage(() => totalPages - 1)}
											disabled={page >= totalPages - 1}
										>
											<ChevronsRight className="h-4 w-4" />
										</Button>
									</div>
								</div>
							)}
						</>
					)}
				</CardContent>
			</Card>

			{/* Assignment panel */}
			<div>
				{selectedOpportunity ? (
					<Card>
						<CardHeader className="pb-3">
							<div className="flex items-center justify-between">
								<CardTitle className="text-lg">Asignar Inversión</CardTitle>
								<div className="flex items-center gap-2">
									<Button
										variant="outline"
										size="sm"
										onClick={() =>
											handleOpenOpportunityModal(selectedOpportunity)
										}
									>
										<Eye className="mr-1 h-4 w-4" />
										Ver Detalle
									</Button>
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

							<Separator />

							{/* Datos del Crédito - Campos editables */}
							<div className="space-y-3">
								<div className="flex items-center gap-2">
									<FileText className="h-4 w-4" />
									<Label className="font-medium text-sm">
										Datos del Crédito
									</Label>
								</div>

								<div className="space-y-3 rounded-lg border bg-muted/30 p-3">
									{/* Categoría (automática) y NIT */}
									<div className="grid grid-cols-2 gap-2">
										<div>
											<Label className="text-xs">Categoría</Label>
											<div className="flex h-10 w-full items-center rounded-md border border-input bg-muted px-3 py-2 text-sm">
												{getAutomaticCategoria(selectedOpportunity) ||
													"Sin categoría"}
											</div>
											<p className="mt-1 text-[10px] text-muted-foreground">
												Calculada según tipo de crédito
												{selectedOpportunity?.creditType === "autocompra"
													? " y vehículo"
													: ""}
											</p>
										</div>
										<div>
											<Label className="text-xs">NIT *</Label>
											<Input
												value={editNit}
												onChange={(e) => setEditNit(e.target.value)}
												placeholder="Ej: 12345678-9"
												className={!editNit.trim() ? "border-orange-400" : ""}
											/>
										</div>
									</div>

									{/* Día de pago mensual */}
									<div>
										<Label className="text-xs">Día de Pago Mensual</Label>
										<Select
											value={editDiaPagoMensual.toString()}
											onValueChange={(value) =>
												setEditDiaPagoMensual(Number(value) as PaymentDay)
											}
										>
											<SelectTrigger>
												<SelectValue placeholder="Seleccionar día" />
											</SelectTrigger>
											<SelectContent>
												<SelectItem value="15">15</SelectItem>
												<SelectItem value="30">Fin de mes</SelectItem>
											</SelectContent>
										</Select>
									</div>
								</div>
							</div>

							<Separator />

							{/* Existing Investors section */}
							{selectedOpportunity?.existingInvestors &&
								selectedOpportunity.existingInvestors.length > 0 && (
									<div className="space-y-2">
										<div className="flex items-center justify-between">
											<Label className="font-medium text-sm">
												Inversionistas Asignados
											</Label>
											{!isEditingExisting && (
												<Button
													type="button"
													variant="outline"
													size="sm"
													onClick={handleStartEditExisting}
												>
													<Pencil className="mr-1 h-4 w-4" />
													Editar
												</Button>
											)}
										</div>

										{isEditingExisting ? (
											<div className="space-y-3">
												{editedExistingInvestors.map((inv, index) => (
													<div
														key={`edit-${inv.inversionista_id || index}`}
														className="rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950"
													>
														<div className="space-y-3">
															<div>
																<Label className="text-xs">Inversionista</Label>
																<Combobox
																	value={inv.inversionista_id?.toString() || ""}
																	onChange={(value) =>
																		handleUpdateExistingInvestor(
																			index,
																			"inversionista_id",
																			value,
																		)
																	}
																	options={
																		inversionistasQuery.data?.inversionistas?.map(
																			(investor) => ({
																				label: investor.nombre,
																				value:
																					investor.inversionistaId.toString(),
																			}),
																		) || []
																	}
																	placeholder="Seleccionar inversionista..."
																	width="full"
																/>
															</div>
															<div className="grid grid-cols-2 gap-2">
																<div>
																	<Label className="text-xs">
																		Monto aportado
																	</Label>
																	<Input
																		type="number"
																		value={inv.monto_aportado || ""}
																		onChange={(e) =>
																			handleUpdateExistingInvestor(
																				index,
																				"monto_aportado",
																				e.target.value,
																			)
																		}
																		placeholder="Q0.00"
																	/>
																</div>
																<div>
																	<Label className="text-xs">
																		% Participación
																	</Label>
																	<Input
																		type="number"
																		value={inv.porcentaje_participacion || ""}
																		onChange={(e) =>
																			handleUpdateExistingInvestor(
																				index,
																				"porcentaje_participacion",
																				e.target.value,
																			)
																		}
																		placeholder="0%"
																	/>
																</div>
															</div>
															<div className="flex justify-end">
																<Button
																	type="button"
																	variant="ghost"
																	size="sm"
																	onClick={() =>
																		handleRemoveExistingInvestor(index)
																	}
																>
																	<Trash2 className="mr-1 h-4 w-4" />
																	Eliminar
																</Button>
															</div>
														</div>
													</div>
												))}

												<Button
													type="button"
													variant="outline"
													size="sm"
													onClick={handleAddExistingInvestor}
												>
													<Plus className="mr-1 h-4 w-4" />
													Agregar
												</Button>

												<div className="flex gap-2">
													<Button
														type="button"
														variant="default"
														size="sm"
														onClick={handleSaveExistingInvestors}
														disabled={updateInvestorsMutation.isPending}
													>
														{updateInvestorsMutation.isPending ? (
															<Loader2 className="mr-1 h-4 w-4 animate-spin" />
														) : (
															<Save className="mr-1 h-4 w-4" />
														)}
														Guardar cambios
													</Button>
													<Button
														type="button"
														variant="outline"
														size="sm"
														onClick={handleCancelEditExisting}
														disabled={updateInvestorsMutation.isPending}
													>
														Cancelar
													</Button>
												</div>
											</div>
										) : (
											<div className="space-y-2">
												{selectedOpportunity.existingInvestors.map(
													(inv: ExistingInvestor, index: number) => (
														<div
															key={index}
															className="rounded-lg border border-green-200 bg-green-50 p-3 dark:border-green-800 dark:bg-green-950"
														>
															<div className="flex items-center justify-between">
																<div>
																	<p className="font-medium text-sm">
																		{inv.nombre}
																	</p>
																	<p className="text-muted-foreground text-xs">
																		Monto: Q{" "}
																		{inv.monto_aportado?.toLocaleString(
																			"es-GT",
																			{
																				minimumFractionDigits: 2,
																			},
																		)}{" "}
																		| Participación:{" "}
																		{inv.porcentaje_participacion}%
																		{inv.porcentaje_cash_in !== undefined &&
																			` | Cash-in: ${inv.porcentaje_cash_in}%`}
																	</p>
																</div>
																<Badge
																	variant="default"
																	className="bg-green-600"
																>
																	Asignado
																</Badge>
															</div>
														</div>
													),
												)}
											</div>
										)}
									</div>
								)}

							{/* New Investors section */}
							<div className="space-y-2">
								<div className="flex items-center justify-between">
									<Label className="font-medium text-sm">
										{selectedOpportunity?.existingInvestors?.length
											? "Agregar más inversionistas"
											: "Inversionistas"}
									</Label>
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
										{selectedOpportunity?.existingInvestors?.length
											? 'Haga clic en "Agregar" para agregar más inversionistas.'
											: 'No hay inversionistas asignados. Haga clic en "Agregar" para agregar uno.'}
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
														Math.abs(totalMonto - creditAmount) < 0.01
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
											{Math.abs(totalMonto - creditAmount) >= 0.01 && (
												<p className="mt-1 text-orange-600 text-xs">
													La suma de aportes debe ser exactamente igual al
													capital del crédito (diferencia:{" "}
													{formatCurrency(Math.abs(totalMonto - creditAmount))})
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

			{/* Opportunity Detail Modal */}
			<OpportunityDetailModal
				open={isOpportunityModalOpen}
				onOpenChange={setIsOpportunityModalOpen}
				opportunity={selectedOpportunityForModal}
				userRole="analyst"
				readOnly
			/>
		</div>
	);
}
