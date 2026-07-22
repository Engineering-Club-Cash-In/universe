import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import {
	Calculator,
	ChevronDown,
	Eye,
	FileText,
	Loader2,
	Plus,
	Save,
	Send,
	Target,
	Trash2,
	UserCheck,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox } from "@/components/ui/combobox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { authClient } from "@/lib/auth-client";
import {
	type AmortizationRow,
	generateAmortizationTable,
	generateQuotationPdf,
} from "@/lib/generate-pdf";
import {
	formatQuotationClientName,
	formatVehicleWithClient,
} from "@/lib/quotation-display";
import {
	EXTRA_COST_FIELDS,
	type ExtraCostFieldConfig,
} from "@/lib/quotation-pdf-copy";
import { PERMISSIONS } from "@/lib/roles";
import {
	QUOTER_VEHICLE_ORIGIN_OPTIONS,
	QUOTER_VEHICLE_TYPE_OPTIONS,
} from "@/lib/vehicle-form-options";
import { client, orpc } from "@/utils/orpc";

const searchSchema = z.object({
	opportunityId: z.string().optional(),
});

export const Route = createFileRoute("/crm/quoter")({
	validateSearch: searchSchema,
	beforeLoad: async ({ location }) => {
		const session = await authClient.getSession();
		if (!session.data?.session) {
			throw redirect({
				to: "/login",
				search: {
					redirect: location.href,
				},
			});
		}
	},
	component: QuoterPage,
});

import {
	applyMembershipAdjustment,
	getMembershipAdjustment,
} from "@/utils/membership-adjustment";
import {
	calculateQuotation,
	GARANTIA_MOBILIARIA_INTERNO,
	GPS_COST,
} from "@/utils/quoter-calculations";

// Tipo para los valores del formulario de cotización
interface QuotationFormValues {
	opportunityId: string;
	vehicleId: string;
	creditType: "autocompra" | "sobre_vehiculo";
	vehicleBrand: string;
	vehicleLine: string;
	vehicleModel: string;
	vehicleType:
		| "particular"
		| "uber"
		| "pickup"
		| "nuevo"
		| "panel"
		| "camion"
		| "microbus"
		| "microbus_20"
		| "microbus_35"
		| "microbus_36plus";
	vehicleCondition: "new" | "used";
	vehicleOrigin: "agencia" | "rodado" | "importado" | "subasta" | "otro";
	vehicleValue: number;
	insuredAmount: number;
	downPayment: number;
	termMonths: number;
	interestRate: number;
	insuranceCost: number;
	insuranceProvider: "universales" | "gyt";
	customerInsuranceCost: number;
	internalInsuranceCost: number;
	excelCurrentInsuranceCost: number;
	insuranceSavingsToMembership: number;
	gpsCost: number;
	transferCost: number;
	adminCost: number;
	baseMembershipCost: number;
	membershipCost: number;
	membershipAdjustmentCategory: string;
	membershipAdjustmentPercentage: number;
	freelanceCost: number;
	freelancePercentage: number;
	royalty: number;
	royaltyPercentage: number;
	inspectionCost: number;
	finesCost: number;
	keyCopyCost: number;
	keyCopyDiffCost: number;
	circulationTaxCost: number;
	vehicleTransferCost: number;
	mobileGuaranteeCost: number;
	licensePlatesCost: number;
	leasingContractCost: number;
	collectionAuthCost: number;
	legalCost: number;
	appointmentCost: number;
	addressVerificationCost: number;
	interestCost: number;
	// Gastos extra (separados de los principales)
	extraGpsCost: number;
	extraInsuranceCost: number;
	extraMembershipCost: number;
	extraAdminCost: number;
	rcdpCost: number;
}

// Componente para la tabla de gastos extra
function ExtraCostsTable({
	values,
	totalFinanced,
	creditType,
	onFieldChange,
}: {
	values: QuotationFormValues;
	totalFinanced: number;
	creditType: "autocompra" | "sobre_vehiculo";
	onFieldChange: (field: keyof QuotationFormValues, value: number) => void;
}) {
	// Filtrar campos según el tipo de crédito
	const visibleFields = EXTRA_COST_FIELDS.filter(
		(field) => field.creditType === "all" || field.creditType === creditType,
	);

	// Estado local para TODOS los valores de esta sección
	const [localValues, setLocalValues] = useState<Record<string, number>>(() => {
		const initial: Record<string, number> = {};
		for (const field of EXTRA_COST_FIELDS) {
			initial[field.name] =
				Math.round((Number(values[field.valueField]) || 0) * 100) / 100;
			if (field.percentageField) {
				initial[`${field.name}-pct`] =
					Math.round((Number(values[field.percentageField]) || 0) * 100) / 100;
			}
		}
		return initial;
	});

	// Estado para campos activos
	const [activeFields, setActiveFields] = useState<Record<string, boolean>>(
		() => {
			const active: Record<string, boolean> = {};
			for (const field of EXTRA_COST_FIELDS) {
				// Activo si: es computed (siempre), o tiene valor > 0 en el form
				// Los defaults del form ya vienen con valores, así que si el form tiene valor > 0, se activa
				const formValue = Number(values[field.valueField]) || 0;
				active[field.name] = field.computed || formValue > 0;
			}
			return active;
		},
	);

	// Guardar valores originales antes de desactivar (para restaurar al reactivar)
	const storedValuesRef = useRef<Record<string, number>>({});

	// Sincronizar valores computed desde el form (royalty, intereses, etc.)
	useEffect(() => {
		const updates: Record<string, number> = {};
		for (const field of EXTRA_COST_FIELDS) {
			if (field.computed) {
				const formValue =
					Math.round((Number(values[field.valueField]) || 0) * 100) / 100;
				if (localValues[field.name] !== formValue) {
					updates[field.name] = formValue;
				}
				if (field.percentageField) {
					const pctValue =
						Math.round((Number(values[field.percentageField]) || 0) * 100) /
						100;
					if (localValues[`${field.name}-pct`] !== pctValue) {
						updates[`${field.name}-pct`] = pctValue;
					}
				}
			}
		}
		// Sincronizar valores del form con el estado local de la tabla (solo campos globales)
		const extraInsurance =
			Math.round((Number(values.extraInsuranceCost) || 0) * 100) / 100;
		const extraMembership =
			Math.round((Number(values.extraMembershipCost) || 0) * 100) / 100;
		const extraAdmin =
			Math.round((Number(values.extraAdminCost) || 0) * 100) / 100;
		const extraGps = Math.round((Number(values.extraGpsCost) || 0) * 100) / 100;
		if (localValues.extraInsurance !== extraInsurance) {
			updates.extraInsurance = extraInsurance;
		}
		if (localValues.extraMembership !== extraMembership) {
			updates.extraMembership = extraMembership;
		}
		if (localValues.extraGps !== extraGps) {
			updates.extraGps = extraGps;
		}
		if (localValues.extraAdmin !== extraAdmin) {
			updates.extraAdmin = extraAdmin;
		}

		if (Object.keys(updates).length > 0) {
			setLocalValues((prev) => ({ ...prev, ...updates }));
		}
	}, [
		values.royalty,
		values.interestCost,
		values.royaltyPercentage,
		values.extraInsuranceCost,
		values.extraMembershipCost,
		values.extraAdminCost,
		values.extraGpsCost,
	]);

	const isFieldActive = (field: ExtraCostFieldConfig) => {
		if (field.computed) return true;
		return activeFields[field.name] ?? false;
	};

	// Agrupar por sección
	const sections = {
		comision: visibleFields.filter((f) => f.section === "comision"),
		otros: visibleFields.filter((f) => f.section === "otros"),
		abogado: visibleFields.filter((f) => f.section === "abogado"),
	};

	const sectionLabels = {
		comision: "Comisión y Gastos de Registro",
		otros: "Otros Descuentos",
		abogado: "Gastos de Abogado",
	};

	const calculateFromPercentage = (percentage: number) => {
		if (!percentage || totalFinanced <= 0) return 0;
		return Math.ceil(totalFinanced * (percentage / 100));
	};

	const handleToggleField = (field: ExtraCostFieldConfig, checked: boolean) => {
		setActiveFields((prev) => ({ ...prev, [field.name]: checked }));
		if (!checked) {
			// Guardar valor actual antes de desactivar
			const currentValue = localValues[field.name] || 0;
			if (currentValue > 0) {
				storedValuesRef.current[field.name] = currentValue;
			}
			setLocalValues((prev) => ({ ...prev, [field.name]: 0 }));
			onFieldChange(field.valueField, 0);
			if (field.percentageField) {
				const currentPct = localValues[`${field.name}-pct`] || 0;
				if (currentPct > 0) {
					storedValuesRef.current[`${field.name}-pct`] = currentPct;
				}
				setLocalValues((prev) => ({ ...prev, [`${field.name}-pct`]: 0 }));
				onFieldChange(field.percentageField, 0);
			}
		} else {
			// Restaurar valor: primero stored, luego defaultValue, luego form value
			const storedValue = storedValuesRef.current[field.name];
			const restoreValue =
				storedValue ??
				field.defaultValue ??
				(Number(values[field.valueField]) || 0);
			if (restoreValue > 0) {
				setLocalValues((prev) => ({ ...prev, [field.name]: restoreValue }));
				onFieldChange(field.valueField, restoreValue);
			}
			if (field.percentageField) {
				const storedPct = storedValuesRef.current[`${field.name}-pct`];
				const restorePct =
					storedPct ?? (Number(values[field.percentageField]) || 0);
				if (restorePct > 0) {
					setLocalValues((prev) => ({
						...prev,
						[`${field.name}-pct`]: restorePct,
					}));
					onFieldChange(field.percentageField, restorePct);
				}
			}
		}
	};

	const handleValueChange = (field: ExtraCostFieldConfig, newValue: number) => {
		const rounded = Math.round(newValue * 100) / 100;
		setLocalValues((prev) => ({ ...prev, [field.name]: rounded }));
		onFieldChange(field.valueField, rounded);
	};

	const handlePercentageChange = (
		field: ExtraCostFieldConfig,
		newPercentage: number,
	) => {
		const rounded = Math.round(newPercentage * 100) / 100;
		setLocalValues((prev) => ({ ...prev, [`${field.name}-pct`]: rounded }));
		onFieldChange(field.percentageField!, rounded);
		const calculatedValue = calculateFromPercentage(rounded);
		setLocalValues((prev) => ({ ...prev, [field.name]: calculatedValue }));
		onFieldChange(field.valueField, calculatedValue);
	};

	const renderField = (field: ExtraCostFieldConfig) => {
		const value = localValues[field.name] ?? 0;
		const isActive = isFieldActive(field);
		const percentageValue = localValues[`${field.name}-pct`] ?? 0;
		const isComputed = field.computed ?? false;

		const formatValue = (v: number) =>
			v.toLocaleString("es-GT", {
				minimumFractionDigits: 2,
				maximumFractionDigits: 2,
			});

		return (
			<TableRow key={field.name} className={!isActive ? "opacity-50" : ""}>
				<TableCell className="w-10 text-center">
					<Checkbox
						checked={isActive}
						onCheckedChange={(checked) =>
							handleToggleField(field, checked === true)
						}
						disabled={isComputed}
						className={`border-2 border-gray-400 ${isComputed ? "opacity-50" : "cursor-pointer hover:border-primary"}`}
					/>
				</TableCell>
				<TableCell className="font-medium">{field.label}</TableCell>
				<TableCell className="w-28">
					{field.type === "percentage" && field.percentageField ? (
						<div className="flex items-center gap-1">
							{isComputed ? (
								<span className="flex h-8 w-16 items-center justify-end rounded bg-gray-100 px-2 text-sm">
									{percentageValue.toFixed(2)}
								</span>
							) : (
								<Input
									type="number"
									step="0.01"
									value={percentageValue}
									onChange={(e) =>
										handlePercentageChange(
											field,
											Number.parseFloat(e.target.value) || 0,
										)
									}
									placeholder="0"
									className="h-8 w-16 border-2 border-gray-400 text-right text-sm"
								/>
							)}
							<span className="text-muted-foreground text-xs">%</span>
						</div>
					) : (
						<span className="text-muted-foreground text-xs">-</span>
					)}
				</TableCell>
				<TableCell className="w-32">
					{isComputed ? (
						<span className="flex h-8 w-full items-center justify-end rounded border-2 border-gray-300 bg-gray-100 px-2 text-sm">
							{formatValue(value)}
						</span>
					) : (
						<Input
							type="number"
							step="0.01"
							value={value}
							onChange={(e) =>
								handleValueChange(field, Number.parseFloat(e.target.value) || 0)
							}
							placeholder="0"
							className="h-8 border-2 border-gray-400 text-right text-sm"
						/>
					)}
				</TableCell>
			</TableRow>
		);
	};

	// Calcular subtotales usando estado local
	const calculateSectionSubtotal = (sectionFields: ExtraCostFieldConfig[]) => {
		return sectionFields.reduce((sum, field) => {
			const isActive = isFieldActive(field);
			if (!isActive) return sum;
			return sum + (localValues[field.name] ?? 0);
		}, 0);
	};

	const subtotals = {
		comision: calculateSectionSubtotal(sections.comision),
		otros: calculateSectionSubtotal(sections.otros),
		abogado: calculateSectionSubtotal(sections.abogado),
	};

	const total = subtotals.comision + subtotals.otros + subtotals.abogado;

	const formatCurrency = (value: number) =>
		`Q ${value.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

	return (
		<div className="space-y-6">
			{(Object.keys(sections) as Array<keyof typeof sections>).map(
				(sectionKey) => {
					const sectionFields = sections[sectionKey];
					if (sectionFields.length === 0) return null;

					return (
						<div key={sectionKey}>
							<h4 className="mb-2 font-semibold text-muted-foreground text-sm">
								{sectionLabels[sectionKey]}
							</h4>
							<div className="rounded-lg border">
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead className="w-10 text-center">Activo</TableHead>
											<TableHead>Concepto</TableHead>
											<TableHead className="w-28">%</TableHead>
											<TableHead className="w-32 text-right">
												Valor (Q)
											</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{sectionFields.map((field) => renderField(field))}
										{/* Subtotal de la sección */}
										<TableRow className="bg-muted/50 font-semibold">
											<TableCell colSpan={3} className="text-right">
												Subtotal {sectionLabels[sectionKey]}:
											</TableCell>
											<TableCell className="text-right">
												{formatCurrency(subtotals[sectionKey])}
											</TableCell>
										</TableRow>
									</TableBody>
								</Table>
							</div>
						</div>
					);
				},
			)}

			{/* Total general */}
			<div className="rounded-lg border-2 border-primary bg-primary/5 p-4">
				<div className="flex items-center justify-between">
					<span className="font-bold text-lg">Total Gastos Adicionales:</span>
					<span className="font-bold text-primary text-xl">
						{formatCurrency(total)}
					</span>
				</div>
			</div>
		</div>
	);
}

function QuoterPage() {
	const { data: session } = authClient.useSession();
	const userProfile = useQuery(orpc.getUserProfile.queryOptions());
	const queryClient = useQueryClient();
	const navigate = Route.useNavigate();
	const { opportunityId: initialOpportunityId } = Route.useSearch();

	const [selectedQuotationId, setSelectedQuotationId] = useState<string | null>(
		null,
	);
	const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
	const [vehiclesSearch, setVehiclesSearch] = useState("");
	const [debouncedVehiclesSearch, setDebouncedVehiclesSearch] = useState("");
	const [opportunitiesSearch, setOpportunitiesSearch] = useState("");
	const [debouncedOpportunitiesSearch, setDebouncedOpportunitiesSearch] =
		useState("");

	// Debounce vehicles search
	useEffect(() => {
		const timer = setTimeout(() => {
			setDebouncedVehiclesSearch(vehiclesSearch);
		}, 300);
		return () => clearTimeout(timer);
	}, [vehiclesSearch]);

	// Debounce opportunities search
	useEffect(() => {
		const timer = setTimeout(() => {
			setDebouncedOpportunitiesSearch(opportunitiesSearch);
		}, 300);
		return () => clearTimeout(timer);
	}, [opportunitiesSearch]);

	// Verificar que sea usuario de ventas (admin, sales, sales_supervisor)
	if (
		userProfile.data &&
		!PERMISSIONS.canCreateOpportunities(userProfile.data.role)
	) {
		navigate({ to: "/dashboard" });
	}

	// Queries - solo ejecutar si hay sesión
	const quotationsQuery = useQuery({
		...orpc.getQuotations.queryOptions(),
		enabled: !!session,
	});
	const vehiclesQuery = useQuery({
		queryKey: ["getVehicles", "quoter", debouncedVehiclesSearch],
		queryFn: () =>
			client.getVehicles({
				limit: 50,
				query: debouncedVehiclesSearch || undefined,
				excludeStatus: "sold", // No mostrar vehículos vendidos en el cotizador
			}),
		enabled: !!session,
	});
	const opportunitiesQuery = useQuery({
		queryKey: ["getOpportunities", "quoter", debouncedOpportunitiesSearch],
		queryFn: () =>
			client.getOpportunities({
				search: debouncedOpportunitiesSearch || undefined,
				excludeStatuses: ["won", "migrate"], // No mostrar oportunidades ganadas o migradas
			}),
		enabled: !!session,
	});

	// Vehículo seleccionado desde la oportunidad (para mostrar en el combobox)
	const [opportunityVehicle, setOpportunityVehicle] = useState<{
		value: string;
		label: string;
	} | null>(null);

	// Estado del formulario
	const [calculatedValues, setCalculatedValues] = useState({
		amountToFinance: 0,
		totalFinanced: 0,
		monthlyPayment: 0,
	});

	const [isInterno, setIsInterno] = useState(false);

	const [amortizationTable, setAmortizationTable] = useState<AmortizationRow[]>(
		[],
	);

	// Mutations
	const createQuotationMutation = useMutation({
		mutationFn: async (values: any) => {
			return await client.createQuotation(values);
		},
		onSuccess: () => {
			toast.success("Cotización creada exitosamente");
			queryClient.invalidateQueries(orpc.getQuotations.queryOptions());
			quoterForm.reset();
			setIsInterno(false);
			setOpportunityVehicle(null);
			setCalculatedValues({
				amountToFinance: 0,
				totalFinanced: 0,
				monthlyPayment: 0,
			});
		},
		onError: (error: any) => {
			toast.error(error.message || "Error al crear cotización");
		},
	});

	const deleteQuotationMutation = useMutation({
		mutationFn: async (quotationId: string) => {
			return await client.deleteQuotation({ quotationId });
		},
		onSuccess: () => {
			toast.success("Cotización eliminada");
			queryClient.invalidateQueries(orpc.getQuotations.queryOptions());
		},
		onError: (error: any) => {
			toast.error(error.message || "Error al eliminar cotización");
		},
	});

	// Form
	const defaultQuotationValues: QuotationFormValues = {
		opportunityId: "",
		vehicleId: "",
		creditType: "autocompra" as "autocompra" | "sobre_vehiculo",
		vehicleBrand: "",
		vehicleLine: "",
		vehicleModel: "",
		vehicleType: "particular" as const,
		vehicleCondition: "used" as const,
		vehicleOrigin: "agencia" as const,
		vehicleValue: 0,
		insuredAmount: 0,
		downPayment: 0,
		termMonths: 60,
		interestRate: 1.5, // default autocompra; sobre_vehiculo usa 3
		insuranceCost: 0,
		insuranceProvider: "universales",
		customerInsuranceCost: 0,
		internalInsuranceCost: 0,
		excelCurrentInsuranceCost: 0,
		insuranceSavingsToMembership: 0,
		gpsCost: GPS_COST,
		transferCost: 545, // 395 + 150 según Excel
		adminCost: 0,
		baseMembershipCost: 0,
		membershipCost: 0,
		membershipAdjustmentCategory: "",
		membershipAdjustmentPercentage: 0,
		// Gastos adicionales para detalle de crédito
		freelanceCost: 0,
		freelancePercentage: 0,
		royalty: 0,
		royaltyPercentage: 4.0,
		inspectionCost: 0,
		finesCost: 0,
		keyCopyCost: 0,
		keyCopyDiffCost: 0,
		circulationTaxCost: 0,
		vehicleTransferCost: 0,
		mobileGuaranteeCost: 400,
		licensePlatesCost: 0,
		leasingContractCost: 400,
		collectionAuthCost: 0,
		legalCost: 0,
		// Gastos específicos de Autocompras
		appointmentCost: 150,
		addressVerificationCost: 395,
		// Interés calculado automáticamente
		interestCost: 0,
		// Gastos extra (separados de los principales)
		extraGpsCost: 0,
		extraInsuranceCost: 0,
		extraMembershipCost: 0,
		extraAdminCost: 600,
		rcdpCost: 0,
	};

	const quoterForm = useForm({
		defaultValues: defaultQuotationValues,
		onSubmit: async ({ value }) => {
			createQuotationMutation.mutate({
				opportunityId: value.opportunityId || undefined,
				vehicleId: value.vehicleId || undefined,
				creditType: value.creditType,
				vehicleBrand: value.vehicleBrand,
				vehicleLine: value.vehicleLine,
				vehicleModel: value.vehicleModel,
				vehicleType: value.vehicleType,
				vehicleCondition: value.vehicleCondition,
				vehicleOrigin: value.vehicleOrigin,
				vehicleValue: Number(value.vehicleValue),
				insuredAmount: Number(value.insuredAmount),
				downPayment: Number(value.downPayment),
				termMonths: Number(value.termMonths),
				interestRate: Number(value.interestRate),
				insuranceCost: Number(value.insuranceCost),
				insuranceProvider: value.insuranceProvider,
				customerInsuranceCost: Number(value.customerInsuranceCost),
				internalInsuranceCost: Number(value.internalInsuranceCost),
				insuranceSavingsToMembership: Number(
					value.insuranceSavingsToMembership,
				),
				gpsCost: Number(value.gpsCost),
				transferCost: Number(value.transferCost),
				adminCost: Number(value.adminCost),
				membershipCost: Number(value.membershipCost),
				// Gastos adicionales para detalle de crédito
				freelanceCost: Number(value.freelanceCost),
				freelancePercentage: Number(value.freelancePercentage) || undefined,
				royalty: Number(value.royalty),
				royaltyPercentage: Number(value.royaltyPercentage),
				inspectionCost: Number(value.inspectionCost),
				finesCost: Number(value.finesCost),
				keyCopyCost: Number(value.keyCopyCost),
				keyCopyDiffCost: Number(value.keyCopyDiffCost),
				circulationTaxCost: Number(value.circulationTaxCost),
				mobileGuaranteeCost: Number(value.mobileGuaranteeCost),
				licensePlatesCost: Number(value.licensePlatesCost),
				leasingContractCost: Number(value.leasingContractCost),
				collectionAuthCost: Number(value.collectionAuthCost),
				legalCost: Number(value.legalCost),
				// Gastos específicos de Autocompras
				appointmentCost: Number(value.appointmentCost),
				addressVerificationCost: Number(value.addressVerificationCost),
				// Gastos extra para detalle de crédito (descuentos iniciales)
				extraGpsCost: Number(value.extraGpsCost),
				extraInsuranceCost: Number(value.extraInsuranceCost),
				extraMembershipCost: Number(value.extraMembershipCost),
				extraAdminCost: Number(value.extraAdminCost),
				interestCost: Number(value.interestCost),
				rcdpCost: Number(value.rcdpCost),
				vehicleTransferCost: Number(value.vehicleTransferCost),
				isInterno,
			});
		},
	});

	// Pre-seleccionar la oportunidad si viene en la URL
	useEffect(() => {
		if (initialOpportunityId) {
			quoterForm.setFieldValue("opportunityId", initialOpportunityId);
		}
	}, [initialOpportunityId]);

	// Auto-recalcular cuando cambien los valores relevantes del formulario
	useEffect(() => {
		const values = quoterForm.state.values;
		const isSobreVehiculo = values.creditType === "sobre_vehiculo";
		// Para sobre vehículo: recalcular si hay monto solicitado (downPayment field)
		// Para autocompra: recalcular si hay valor del vehículo y enganche
		const shouldRecalculate = isSobreVehiculo
			? values.downPayment > 0
			: values.vehicleValue > 0 && values.downPayment > 0;
		if (shouldRecalculate) {
			recalculate();
		}
	}, [
		quoterForm.state.values.vehicleValue,
		quoterForm.state.values.downPayment,
		quoterForm.state.values.insuranceCost,
		quoterForm.state.values.gpsCost,
		quoterForm.state.values.transferCost,
		quoterForm.state.values.membershipCost,
		quoterForm.state.values.interestRate,
		quoterForm.state.values.termMonths,
		quoterForm.state.values.royaltyPercentage,
		quoterForm.state.values.insuredAmount,
		quoterForm.state.values.vehicleType,
		quoterForm.state.values.creditType,
		isInterno,
	]);

	// Tipos de bus RCDP (membresía ya incluida en la tarifa)
	const BUS_TYPES = ["microbus_20", "microbus_35", "microbus_36plus"];

	const normalizeVehicleOrigin = (
		origin?: string | null,
	): QuotationFormValues["vehicleOrigin"] => {
		const normalized = (origin ?? "").trim().toLowerCase();
		if (normalized.includes("rodado")) return "rodado";
		if (normalized.includes("import")) return "importado";
		if (normalized.includes("subasta")) return "subasta";
		if (normalized.includes("agencia")) return "agencia";
		return "otro";
	};

	const normalizeVehicleTypeForQuoter = (
		vehicleType?: string | null,
	): QuotationFormValues["vehicleType"] => {
		const normalized = (vehicleType ?? "").trim().toLowerCase();

		if (
			[
				"particular",
				"sedan",
				"sedán",
				"hatchback",
				"suv",
				"minivan",
				"deportivo",
				"otro",
			].includes(normalized)
		) {
			return "particular";
		}
		if (normalized === "bus hasta 20 pasajeros") return "microbus_20";
		if (normalized === "bus 21-35 pasajeros") return "microbus_35";
		if (normalized === "bus más de 35 pasajeros") return "microbus_36plus";
		if (normalized === "bus mas de 35 pasajeros") return "microbus_36plus";
		if (["pickup", "pick up", "pick-up"].includes(normalized)) {
			return "pickup";
		}
		if (normalized === "nuevo") return "nuevo";
		if (normalized === "uber") return "uber";
		if (normalized === "panel") return "panel";
		if (normalized === "camion" || normalized === "camión") return "camion";
		if (normalized === "microbus" || normalized === "microbús") {
			return "microbus";
		}
		if (normalized === "microbus_20") return "microbus_20";
		if (normalized === "microbus_35") return "microbus_35";
		if (normalized === "microbus_36plus") return "microbus_36plus";

		return "particular";
	};

	const applyVehicleConditionAndOrigin = (vehicle?: {
		isNew?: boolean | null;
		origin?: string | null;
	}) => {
		if (!vehicle) return null;

		const vehicleCondition: QuotationFormValues["vehicleCondition"] =
			vehicle.isNew ? "new" : "used";
		const vehicleOrigin = normalizeVehicleOrigin(vehicle.origin);
		quoterForm.setFieldValue("vehicleCondition", vehicleCondition);
		quoterForm.setFieldValue("vehicleOrigin", vehicleOrigin);
		return { condition: vehicleCondition, origin: vehicleOrigin };
	};

	// Obtener costo de seguro automáticamente
	const updateInsuranceCost = async (
		insuredAmount: number,
		vehicleType: QuotationFormValues["vehicleType"],
		vehicleContext?: {
			creditType?: "autocompra" | "sobre_vehiculo";
			condition?: "new" | "used";
			isInterno?: boolean;
			origin?: string | null;
		},
	) => {
		if (insuredAmount <= 0) return;

		try {
			const result = await client.getInsuranceCost({
				insuredAmount,
				vehicleType,
			});

			const baseInsuranceCost =
				Math.round(result.baseInsuranceCost * 100) / 100;
			const rawMembershipCostBeforeAdjustment =
				Math.round(result.effectiveMembershipCost * 100) / 100;
			quoterForm.setFieldValue(
				"baseMembershipCost",
				rawMembershipCostBeforeAdjustment,
			);
			const condition =
				vehicleContext?.condition ??
				quoterForm.getFieldValue("vehicleCondition") ??
				"used";
			const origin =
				vehicleContext?.origin ??
				quoterForm.getFieldValue("vehicleOrigin") ??
				"agencia";
			const membershipAdjustment = getMembershipAdjustment({
				creditType:
					vehicleContext?.creditType ?? quoterForm.state.values.creditType,
				insuredAmount,
				vehicleType,
				isNew: condition === "new",
				condition,
				origin,
			});
			const rawMembershipCost = applyMembershipAdjustment(
				rawMembershipCostBeforeAdjustment,
				membershipAdjustment,
			);
			quoterForm.setFieldValue(
				"membershipAdjustmentCategory",
				membershipAdjustment.category,
			);
			quoterForm.setFieldValue(
				"membershipAdjustmentPercentage",
				membershipAdjustment.percentage,
			);
			quoterForm.setFieldValue("insuranceProvider", result.provider);
			quoterForm.setFieldValue(
				"customerInsuranceCost",
				Math.round(result.customerInsuranceCost * 100) / 100,
			);
			quoterForm.setFieldValue(
				"internalInsuranceCost",
				Math.round(result.internalInsuranceCost * 100) / 100,
			);
			quoterForm.setFieldValue(
				"excelCurrentInsuranceCost",
				Math.round((result.excelCurrentInsuranceCost ?? 0) * 100) / 100,
			);
			quoterForm.setFieldValue(
				"insuranceSavingsToMembership",
				Math.round(result.insuranceSavingsToMembership * 100) / 100,
			);
			const shouldUseInterno = vehicleContext?.isInterno ?? isInterno;

			if (shouldUseInterno) {
				// Crédito interno: solo seguro base, sin membresía ni GPS
				quoterForm.setFieldValue("insuranceCost", baseInsuranceCost);
				quoterForm.setFieldValue("customerInsuranceCost", baseInsuranceCost);
				quoterForm.setFieldValue("baseMembershipCost", 0);
				quoterForm.setFieldValue("membershipCost", 0);
				quoterForm.setFieldValue("extraInsuranceCost", baseInsuranceCost);
				quoterForm.setFieldValue("extraMembershipCost", 0);
			} else {
				// El seguro total para cálculos es: base + (membresía - GPS)
				const netMembershipCost =
					Math.round((rawMembershipCost - GPS_COST) * 100) / 100;
				const insuranceCost =
					Math.round((baseInsuranceCost + netMembershipCost) * 100) / 100;

				quoterForm.setFieldValue("insuranceCost", insuranceCost);
				quoterForm.setFieldValue("customerInsuranceCost", insuranceCost);
				quoterForm.setFieldValue("membershipCost", netMembershipCost);
				quoterForm.setFieldValue("extraInsuranceCost", baseInsuranceCost);
				quoterForm.setFieldValue("extraMembershipCost", rawMembershipCost);
			}
			quoterForm.setFieldValue("rcdpCost", result.rcdpCost);

			// Recalcular después de actualizar
			setTimeout(() => recalculate(shouldUseInterno), 100);
		} catch (error) {
			console.error("Error al obtener costo de seguro:", error);
		}
	};

	const applyCreditTypeChange = async (
		creditType: QuotationFormValues["creditType"],
	) => {
		quoterForm.setFieldValue("creditType", creditType);

		const shouldUseInterno =
			creditType === "sobre_vehiculo" ? false : isInterno;

		if (creditType === "sobre_vehiculo") {
			setIsInterno(false);
			quoterForm.setFieldValue("appointmentCost", 0);
			quoterForm.setFieldValue("interestRate", 3);
			quoterForm.setFieldValue("downPayment", 0);
		} else {
			quoterForm.setFieldValue("addressVerificationCost", 395);
			quoterForm.setFieldValue("appointmentCost", 150);
			quoterForm.setFieldValue("interestRate", 1.5);
		}

		const insuredAmount = quoterForm.getFieldValue("insuredAmount") ?? 0;
		if (insuredAmount > 0) {
			await updateInsuranceCost(
				insuredAmount,
				quoterForm.getFieldValue("vehicleType"),
				{
					creditType,
					condition: quoterForm.getFieldValue("vehicleCondition"),
					isInterno: shouldUseInterno,
					origin: quoterForm.getFieldValue("vehicleOrigin"),
				},
			);
		}

		setTimeout(() => recalculate(shouldUseInterno), 100);
	};

	// Función para recalcular cuando cambian los valores (según Excel)
	const recalculate = (isInternoOverride = isInterno) => {
		const values = quoterForm.state.values;

		const result = calculateQuotation({
			creditType: values.creditType,
			vehicleValue: Number(values.vehicleValue),
			downPayment: Number(values.downPayment),
			interestRate: Number(values.interestRate),
			termMonths: Number(values.termMonths),
			insuranceCost: Number(values.insuranceCost),
			gpsCost: Number(values.gpsCost),
			transferCost: Number(values.transferCost),
			royaltyPercentage: Number(values.royaltyPercentage),
			rcdpCost: Number(values.rcdpCost),
			isInterno: isInternoOverride,
		});

		quoterForm.setFieldValue("royalty", result.calculatedRoyalty);
		quoterForm.setFieldValue("interestCost", result.calculatedInterest);
		quoterForm.setFieldValue("rcdpCost", result.rcdpCost);
		quoterForm.setFieldValue("adminCost", result.adminCost);

		// Nota: extraInsuranceCost y extraMembershipCost se calculan en updateInsuranceCost()
		// para que sean editables y no se sobrescriban en cada recálculo

		setCalculatedValues({
			amountToFinance: result.amountToFinance,
			totalFinanced: result.totalFinanced,
			monthlyPayment: result.monthlyPayment,
		});

		// Generar tabla de amortización si hay valores
		if (result.totalFinanced > 0 && result.monthlyPayment > 0) {
			const table = generateAmortizationTable(
				result.totalFinanced,
				Number(values.interestRate),
				Number(values.termMonths),
			);
			setAmortizationTable(table);
		} else {
			setAmortizationTable([]);
		}
	};

	// Cuando se selecciona un vehículo desde la oportunidad, auto-llenar datos
	const handleOpportunityVehicleSelect = async (vehicle: {
		id: string;
		make: string;
		model: string;
		year: number;
		licensePlate: string | null;
		vehicleType?: string | null;
		isNew?: boolean | null;
		origin?: string | null;
	}) => {
		// Guardar el vehículo para mostrarlo en el combobox
		setOpportunityVehicle({
			value: vehicle.id,
			label: `${vehicle.make} ${vehicle.model} ${vehicle.year} - ${vehicle.licensePlate || ""}`,
		});

		// Primero llenamos los datos básicos del vehículo
		quoterForm.setFieldValue("vehicleId", vehicle.id);
		quoterForm.setFieldValue("vehicleBrand", vehicle.make);
		quoterForm.setFieldValue("vehicleLine", vehicle.model);
		quoterForm.setFieldValue("vehicleModel", vehicle.year.toString());

		// Establecer el tipo de vehículo si viene de la oportunidad
		const vehicleTypeToUse = normalizeVehicleTypeForQuoter(vehicle.vehicleType);
		quoterForm.setFieldValue("vehicleType", vehicleTypeToUse);
		const vehicleContext = applyVehicleConditionAndOrigin(vehicle);

		// Obtener la inspección más reciente para el marketValue
		try {
			const inspection = await client.getLatestInspectionByVehicleId({
				vehicleId: vehicle.id,
			});

			if (inspection?.marketValue) {
				const numericValue = Number(inspection.marketValue);
				quoterForm.setFieldValue("vehicleValue", numericValue);

				const isSobreVehiculo =
					quoterForm.state.values.creditType === "sobre_vehiculo";

				if (!isSobreVehiculo) {
					// Autocompra: auto-llenar monto asegurado y enganche
					quoterForm.setFieldValue("insuredAmount", numericValue);
					const downPayment = Math.round(numericValue * 0.2);
					quoterForm.setFieldValue("downPayment", downPayment);
				}

				// Actualizar seguro y membresía con el tipo de vehículo correcto
				updateInsuranceCost(
					isSobreVehiculo
						? quoterForm.state.values.insuredAmount || numericValue
						: numericValue,
					vehicleTypeToUse,
					vehicleContext ?? undefined,
				);
			}
		} catch (error) {
			console.error("Error al obtener inspección del vehículo:", error);
		}
	};

	// Cuando se selecciona un vehículo, auto-llenar datos
	const handleVehicleSelect = (vehicleId: string) => {
		const vehicle = vehiclesQuery.data?.data?.find((v) => v.id === vehicleId);
		if (vehicle) {
			quoterForm.setFieldValue("vehicleId", vehicleId);
			quoterForm.setFieldValue("vehicleBrand", vehicle.make);
			quoterForm.setFieldValue("vehicleLine", vehicle.model);
			quoterForm.setFieldValue("vehicleModel", vehicle.year.toString());
			const vehicleTypeToUse = normalizeVehicleTypeForQuoter(
				vehicle.vehicleType,
			);
			quoterForm.setFieldValue("vehicleType", vehicleTypeToUse);
			const vehicleContext = applyVehicleConditionAndOrigin(vehicle);

			// El marketValue está en la inspección más reciente
			const latestInspection = vehicle.inspections?.[0];
			if (latestInspection?.marketValue) {
				const numericValue = Number(latestInspection.marketValue);
				quoterForm.setFieldValue("vehicleValue", numericValue);

				const isSobreVehiculo =
					quoterForm.state.values.creditType === "sobre_vehiculo";

				if (!isSobreVehiculo) {
					// Autocompra: auto-llenar monto asegurado y enganche
					quoterForm.setFieldValue("insuredAmount", numericValue);
					const downPayment = Math.round(numericValue * 0.2);
					quoterForm.setFieldValue("downPayment", downPayment);
				}

				// Actualizar seguro y membresía. Pasamos isNew/origin del vehículo
				// seleccionado explícitamente: el form state (vehicleId) que usa
				// updateInsuranceCost para resolver el vehículo recién se seteó y
				// puede estar stale, lo que clasificaría mal la membresía.
				updateInsuranceCost(
					isSobreVehiculo
						? quoterForm.state.values.insuredAmount || numericValue
						: numericValue,
					vehicleTypeToUse,
					vehicleContext ?? undefined,
				);
			}
		}
	};

	// Cargar cotización existente de una oportunidad
	const loadExistingQuotation = async (
		opportunityId: string,
		fallbackVehicle?: {
			id: string;
			isNew?: boolean | null;
			origin?: string | null;
		},
	): Promise<boolean> => {
		try {
			const quotations = await client.listQuotationsByOpportunity({
				opportunityId,
			});

			if (quotations && quotations.length > 0) {
				const q = quotations[0]; // La más reciente
				const savedVehicleContext = q as typeof q & {
					vehicleCondition?: QuotationFormValues["vehicleCondition"] | null;
					vehicleOrigin?: QuotationFormValues["vehicleOrigin"] | null;
				};
				const linkedVehicle = q.vehicleId
					? (vehiclesQuery.data?.data?.find(
							(vehicle) => vehicle.id === q.vehicleId,
						) ??
						(fallbackVehicle?.id === q.vehicleId ? fallbackVehicle : undefined))
					: undefined;

				// Cargar todos los campos de la cotización
				quoterForm.setFieldValue("vehicleId", q.vehicleId || "");
				quoterForm.setFieldValue("vehicleBrand", q.vehicleBrand || "");
				quoterForm.setFieldValue("vehicleLine", q.vehicleLine || "");
				quoterForm.setFieldValue("vehicleModel", q.vehicleModel || "");
				const vehicleTypeToUse = normalizeVehicleTypeForQuoter(q.vehicleType);
				quoterForm.setFieldValue("vehicleType", vehicleTypeToUse);
				const contextMigrationCutoff = new Date("2026-06-18T16:46:51.000Z");
				const isMigratedDefaultContext =
					!!linkedVehicle &&
					new Date(q.createdAt) < contextMigrationCutoff &&
					savedVehicleContext.vehicleCondition === "used" &&
					savedVehicleContext.vehicleOrigin === "agencia";
				const hasSavedContext =
					!!savedVehicleContext.vehicleCondition ||
					!!savedVehicleContext.vehicleOrigin;
				if (hasSavedContext && !isMigratedDefaultContext) {
					quoterForm.setFieldValue(
						"vehicleCondition",
						savedVehicleContext.vehicleCondition ?? "used",
					);
					quoterForm.setFieldValue(
						"vehicleOrigin",
						savedVehicleContext.vehicleOrigin ?? "agencia",
					);
				} else if (linkedVehicle) {
					applyVehicleConditionAndOrigin(linkedVehicle);
				} else {
					quoterForm.setFieldValue("vehicleCondition", "used");
					quoterForm.setFieldValue("vehicleOrigin", "agencia");
				}
				quoterForm.setFieldValue("vehicleValue", Number(q.vehicleValue) || 0);
				quoterForm.setFieldValue("insuredAmount", Number(q.insuredAmount) || 0);
				quoterForm.setFieldValue("downPayment", Number(q.downPayment) || 0);
				quoterForm.setFieldValue("termMonths", q.termMonths || 36);
				quoterForm.setFieldValue("interestRate", Number(q.interestRate) || 2.5);

				// Costos básicos
				quoterForm.setFieldValue("insuranceCost", Number(q.insuranceCost) || 0);
				quoterForm.setFieldValue(
					"insuranceProvider",
					(q.insuranceProvider as "universales" | "gyt") || "universales",
				);
				quoterForm.setFieldValue(
					"customerInsuranceCost",
					Number(q.customerInsuranceCost) || Number(q.insuranceCost) || 0,
				);
				quoterForm.setFieldValue(
					"internalInsuranceCost",
					Number(q.internalInsuranceCost) || Number(q.insuranceCost) || 0,
				);
				quoterForm.setFieldValue(
					"insuranceSavingsToMembership",
					Number(q.insuranceSavingsToMembership) || 0,
				);
				quoterForm.setFieldValue("gpsCost", Number(q.gpsCost) || 0);
				quoterForm.setFieldValue("transferCost", Number(q.transferCost) || 0);
				quoterForm.setFieldValue("adminCost", Number(q.adminCost) || 0);
				quoterForm.setFieldValue(
					"membershipCost",
					Number(q.membershipCost) || 0,
				);

				// Comisiones
				quoterForm.setFieldValue("freelanceCost", Number(q.freelanceCost) || 0);
				quoterForm.setFieldValue(
					"freelancePercentage",
					Number(q.freelancePercentage) || 0,
				);
				quoterForm.setFieldValue("royalty", Number(q.royalty) || 0);
				quoterForm.setFieldValue(
					"royaltyPercentage",
					Number(q.royaltyPercentage) || 4,
				);

				// Gastos adicionales
				quoterForm.setFieldValue(
					"inspectionCost",
					Number(q.inspectionCost) || 0,
				);
				quoterForm.setFieldValue("finesCost", Number(q.finesCost) || 0);
				quoterForm.setFieldValue("keyCopyCost", Number(q.keyCopyCost) || 0);
				quoterForm.setFieldValue(
					"keyCopyDiffCost",
					Number(q.keyCopyDiffCost) || 0,
				);
				quoterForm.setFieldValue(
					"circulationTaxCost",
					Number(q.circulationTaxCost) || 0,
				);
				quoterForm.setFieldValue(
					"mobileGuaranteeCost",
					Number(q.mobileGuaranteeCost) || 0,
				);
				quoterForm.setFieldValue(
					"licensePlatesCost",
					Number(q.licensePlatesCost) || 0,
				);
				quoterForm.setFieldValue(
					"leasingContractCost",
					Number(q.leasingContractCost) || 0,
				);
				quoterForm.setFieldValue(
					"collectionAuthCost",
					Number(q.collectionAuthCost) || 0,
				);
				quoterForm.setFieldValue("legalCost", Number(q.legalCost) || 0);

				// Gastos de Autocompras - usar el valor exacto guardado, no defaults
				quoterForm.setFieldValue(
					"appointmentCost",
					q.appointmentCost ? Number(q.appointmentCost) : 0,
				);
				quoterForm.setFieldValue(
					"addressVerificationCost",
					q.addressVerificationCost ? Number(q.addressVerificationCost) : 0,
				);

				// Gastos extra (descuentos iniciales)
				quoterForm.setFieldValue("extraGpsCost", Number(q.extraGpsCost) || 0);
				quoterForm.setFieldValue(
					"extraInsuranceCost",
					Number(q.extraInsuranceCost) || 0,
				);
				quoterForm.setFieldValue(
					"extraMembershipCost",
					Number(q.extraMembershipCost) || 0,
				);
				quoterForm.setFieldValue(
					"extraAdminCost",
					Number(q.extraAdminCost) || 600,
				);
				quoterForm.setFieldValue("interestCost", Number(q.interestCost) || 0);
				quoterForm.setFieldValue("rcdpCost", Number(q.rcdpCost) || 0);
				quoterForm.setFieldValue(
					"vehicleTransferCost",
					Number(q.vehicleTransferCost) || 0,
				);

				// Restaurar estado de crédito interno
				setIsInterno(q.isInterno ?? false);

				// Recalcular después de cargar
				setTimeout(() => recalculate(), 100);

				toast.success("Cotización existente cargada");
				return true;
			}

			return false;
		} catch (error) {
			console.error("Error al cargar cotización existente:", error);
			return false;
		}
	};

	const handleViewQuotation = (quotationId: string) => {
		setSelectedQuotationId(quotationId);
		setIsViewDialogOpen(true);
	};

	const getQuotationPdfData = () => {
		if (calculatedValues.monthlyPayment <= 0) {
			toast.error("Completa todos los campos para generar el PDF");
			return null;
		}

		const values = quoterForm.state.values;
		const selectedOpportunity = opportunitiesQuery.data?.find(
			(opp) => opp.id === values.opportunityId,
		);
		const clientName = selectedOpportunity
			? formatQuotationClientName({
					leadFirstName: selectedOpportunity.lead?.firstName,
					leadLastName: selectedOpportunity.lead?.lastName,
					companyName: selectedOpportunity.company?.name,
				})
			: null;
		const downPaymentPercentage =
			values.vehicleValue > 0
				? (values.downPayment / values.vehicleValue) * 100
				: 0;

		return {
			creditType: values.creditType,
			clientName,
			vehicleBrand: values.vehicleBrand,
			vehicleLine: values.vehicleLine,
			vehicleModel: values.vehicleModel,
			vehicleValue: values.vehicleValue,
			downPayment: values.downPayment,
			downPaymentPercentage: downPaymentPercentage,
			amountToFinance: calculatedValues.amountToFinance,
			totalFinanced: calculatedValues.totalFinanced,
			monthlyPayment: calculatedValues.monthlyPayment,
			termMonths: values.termMonths,
			interestRate: values.interestRate,
			insuranceCost: values.insuranceCost,
			gpsCost: values.gpsCost,
			transferCost: values.transferCost,
			adminCost: values.adminCost,
			membershipCost: values.membershipCost,
			extraCosts: values,
			amortizationTable: amortizationTable,
		};
	};

	const handleGeneratePdf = (clientVersion = false) => {
		const data = getQuotationPdfData();
		if (data) generateQuotationPdf(data, { clientVersion });
	};

	const statusLabels = {
		draft: "Borrador",
		sent: "Enviada",
		accepted: "Aceptada",
		rejected: "Rechazada",
	};

	const statusColors = {
		draft: "bg-gray-100 text-gray-800",
		sent: "bg-blue-100 text-blue-800",
		accepted: "bg-green-100 text-green-800",
		rejected: "bg-red-100 text-red-800",
	};

	return (
		<div className="container mx-auto py-8">
			<div className="mb-8">
				<h1 className="flex items-center gap-2 font-bold text-3xl">
					<Calculator className="h-8 w-8" />
					Cotizador de{" "}
					{quoterForm.state.values.creditType === "sobre_vehiculo"
						? "Sobre Vehículo"
						: "Autocompra"}
				</h1>
				<p className="mt-2 text-muted-foreground">
					Genera propuestas de financiamiento para tus clientes
				</p>
			</div>

			<Tabs defaultValue="new" className="space-y-6">
				<TabsList className="print:hidden">
					<TabsTrigger value="new" className="gap-2">
						<Plus className="h-4 w-4" />
						Nueva Cotización
					</TabsTrigger>
					<TabsTrigger value="saved" className="gap-2">
						<FileText className="h-4 w-4" />
						Cotizaciones Guardadas
					</TabsTrigger>
				</TabsList>

				{/* Tab: Nueva Cotización */}
				<TabsContent value="new">
					<form
						onSubmit={(e) => {
							e.preventDefault();
							quoterForm.handleSubmit();
						}}
					>
						{/* Selector de Oportunidad */}
						<Card className="mb-6">
							<CardHeader className="pb-3">
								<CardTitle className="flex items-center gap-2 text-lg">
									<Target className="h-5 w-5" />
									Asignar a Oportunidad (Opcional)
								</CardTitle>
							</CardHeader>
							<CardContent className="space-y-4">
								<quoterForm.Field name="opportunityId">
									{(field) => (
										<Combobox
											options={[
												{ value: "none", label: "Sin oportunidad" },
												...(opportunitiesQuery.data?.map((opp) => ({
													value: opp.id,
													label: `${opp.title} - ${opp.lead ? `${opp.lead.firstName} ${opp.lead.lastName}` : "Sin lead"} (${opp.creditType === "autocompra" ? "Autocompra" : "Sobre Vehículo"})`,
												})) || []),
											]}
											value={field.state.value || "none"}
											onChange={async (value) => {
												field.handleChange(value === "none" ? "" : value);
												// Auto-seleccionar el tipo de crédito y cargar cotización/vehículo
												if (value && value !== "none") {
													const selectedOpp = opportunitiesQuery.data?.find(
														(opp) => opp.id === value,
													);
													if (selectedOpp?.creditType) {
														quoterForm.setFieldValue(
															"creditType",
															selectedOpp.creditType,
														);
													}

													// Intentar cargar cotización existente primero
													const loadedExistingQuotation =
														await loadExistingQuotation(
															value,
															selectedOpp?.vehicle ?? undefined,
														);
													if (!loadedExistingQuotation) {
														if (selectedOpp?.vehicle) {
															await handleOpportunityVehicleSelect(
																selectedOpp.vehicle,
															);
														}
														if (selectedOpp?.creditType) {
															await applyCreditTypeChange(
																selectedOpp.creditType,
															);
														}
													}

													// Guardar vehículo de la oportunidad para el combobox
													if (selectedOpp?.vehicle?.id) {
														setOpportunityVehicle({
															value: selectedOpp.vehicle.id,
															label: `${selectedOpp.vehicle.make} ${selectedOpp.vehicle.model} ${selectedOpp.vehicle.year} - ${selectedOpp.vehicle.licensePlate || ""}`,
														});
													}
												} else {
													// Limpiar vehículo de oportunidad cuando se deselecciona
													setOpportunityVehicle(null);
												}
											}}
											onSearchChange={setOpportunitiesSearch}
											isLoading={opportunitiesQuery.isFetching}
											placeholder="Buscar oportunidad..."
											width="full"
										/>
									)}
								</quoterForm.Field>

								{/* Selector de Tipo de Crédito */}
								<quoterForm.Field name="creditType">
									{(field) => {
										const hasOpportunity =
											!!quoterForm.state.values.opportunityId;
										const selectedOpp = opportunitiesQuery.data?.find(
											(opp) => opp.id === quoterForm.state.values.opportunityId,
										);
										const isDisabled =
											hasOpportunity && !!selectedOpp?.creditType;

										return (
											<div>
												<Label htmlFor={field.name} className="mb-2">
													Tipo de Crédito
												</Label>
												<Select
													value={field.state.value}
													onValueChange={(value) => {
														field.handleChange(
															value as QuotationFormValues["creditType"],
														);
														void applyCreditTypeChange(
															value as QuotationFormValues["creditType"],
														);
													}}
													disabled={isDisabled}
												>
													<SelectTrigger>
														<SelectValue placeholder="Seleccionar tipo..." />
													</SelectTrigger>
													<SelectContent>
														<SelectItem value="autocompra">
															Autocompra
														</SelectItem>
														<SelectItem value="sobre_vehiculo">
															Sobre Vehículo
														</SelectItem>
													</SelectContent>
												</Select>
												{isDisabled && (
													<p className="mt-1 text-muted-foreground text-xs">
														Tipo de crédito definido por la oportunidad
													</p>
												)}
											</div>
										);
									}}
								</quoterForm.Field>

								{/* Toggle Crédito Interno - solo visible para autocompra */}
								{quoterForm.state.values.creditType === "autocompra" && (
									<div className="flex items-center space-x-2">
										<Checkbox
											id="isInterno"
											checked={isInterno}
											onCheckedChange={(checked) => {
												const value = checked === true;
												setIsInterno(value);
												if (value) {
													// Crédito interno: sin membresía, sin GPS, sin admin fijo, sin leasing, garantía 300
													quoterForm.setFieldValue("membershipCost", 0);
													quoterForm.setFieldValue("extraMembershipCost", 0);
													quoterForm.setFieldValue("gpsCost", 0);
													quoterForm.setFieldValue(
														"mobileGuaranteeCost",
														GARANTIA_MOBILIARIA_INTERNO,
													);
													quoterForm.setFieldValue("leasingContractCost", 0);
													quoterForm.setFieldValue("extraAdminCost", 0);
													// Recalcular seguro sin membresía
													const insuredAmountInterno =
														quoterForm.getFieldValue("insuredAmount") ?? 0;
													if (insuredAmountInterno > 0) {
														// Setear insuranceCost solo al base (extraInsuranceCost ya tiene el valor)
														const baseOnly =
															quoterForm.getFieldValue("extraInsuranceCost") ??
															0;
														quoterForm.setFieldValue(
															"insuranceCost",
															Number(baseOnly),
														);
													}
												} else {
													// Restaurar defaults de autocompra
													quoterForm.setFieldValue("gpsCost", GPS_COST);
													quoterForm.setFieldValue("mobileGuaranteeCost", 400);
													quoterForm.setFieldValue("leasingContractCost", 400);
													quoterForm.setFieldValue("extraAdminCost", 600);
													// Recalcular seguro/membresía
													const insuredAmount =
														quoterForm.getFieldValue("insuredAmount") ?? 0;
													if (insuredAmount > 0) {
														updateInsuranceCost(
															insuredAmount,
															quoterForm.state.values.vehicleType,
															{ isInterno: false },
														);
													}
												}
												setTimeout(() => recalculate(value), 100);
											}}
										/>
										<Label
											htmlFor="isInterno"
											className="cursor-pointer font-medium text-sm"
										>
											Crédito Interno (Empleados)
										</Label>
									</div>
								)}
							</CardContent>
						</Card>

						<div className="grid gap-6 md:grid-cols-3">
							{/* Columna 1: Datos del Vehículo */}
							<Card>
								<CardHeader>
									<CardTitle>Datos del Vehículo</CardTitle>
								</CardHeader>
								<CardContent className="space-y-4">
									<div className="space-y-2">
										<Label>Seleccionar Vehículo (Opcional)</Label>
										<Combobox
											options={(() => {
												const queryOptions =
													vehiclesQuery.data?.data?.map((vehicle) => ({
														value: vehicle.id,
														label: `${vehicle.make} ${vehicle.model} ${vehicle.year} - ${vehicle.licensePlate}`,
													})) || [];

												// Agregar vehículo de oportunidad si no está en la lista
												if (
													opportunityVehicle &&
													!queryOptions.some(
														(opt) => opt.value === opportunityVehicle.value,
													)
												) {
													return [opportunityVehicle, ...queryOptions];
												}

												return queryOptions;
											})()}
											value={quoterForm.state.values.vehicleId || null}
											onChange={(value) => {
												if (value) handleVehicleSelect(value);
											}}
											onSearchChange={setVehiclesSearch}
											isLoading={vehiclesQuery.isFetching}
											placeholder="Buscar vehículo..."
											width="full"
										/>
									</div>

									<quoterForm.Field name="vehicleBrand">
										{(field) => (
											<div>
												<Label htmlFor={field.name} className="mb-2">
													Marca
												</Label>
												<Input
													id={field.name}
													value={field.state.value}
													onChange={(e) => field.handleChange(e.target.value)}
													placeholder="Toyota"
												/>
											</div>
										)}
									</quoterForm.Field>

									<quoterForm.Field name="vehicleLine">
										{(field) => (
											<div>
												<Label htmlFor={field.name} className="mb-2">
													Línea
												</Label>
												<Input
													id={field.name}
													value={field.state.value}
													onChange={(e) => field.handleChange(e.target.value)}
													placeholder="Corolla"
												/>
											</div>
										)}
									</quoterForm.Field>

									<quoterForm.Field name="vehicleModel">
										{(field) => (
											<div>
												<Label htmlFor={field.name} className="mb-2">
													Modelo
												</Label>
												<Input
													id={field.name}
													value={field.state.value}
													onChange={(e) => field.handleChange(e.target.value)}
													placeholder="2020"
												/>
											</div>
										)}
									</quoterForm.Field>

									<quoterForm.Field name="vehicleType">
										{(field) => (
											<div>
												<Label htmlFor={field.name} className="mb-2">
													Tipo de Vehículo
												</Label>
												<Select
													value={field.state.value}
													onValueChange={(value) => {
														field.handleChange(
															value as QuotationFormValues["vehicleType"],
														);

														// Actualizar seguro cuando cambia el tipo
														// Usar getFieldValue para obtener el valor actual (no stale)
														const insuredAmount =
															quoterForm.getFieldValue("insuredAmount") ?? 0;
														if (insuredAmount > 0) {
															updateInsuranceCost(
																insuredAmount,
																value as QuotationFormValues["vehicleType"],
															);
														}
													}}
												>
													<SelectTrigger>
														<SelectValue placeholder="Seleccionar tipo..." />
													</SelectTrigger>
													<SelectContent>
														{QUOTER_VEHICLE_TYPE_OPTIONS.map((option) => (
															<SelectItem
																key={option.value}
																value={option.value}
															>
																{option.label}
															</SelectItem>
														))}
													</SelectContent>
												</Select>
											</div>
										)}
									</quoterForm.Field>

									<div className="grid gap-4 sm:grid-cols-2">
										<quoterForm.Field name="vehicleCondition">
											{(field) => {
												return (
													<div>
														<Label htmlFor={field.name} className="mb-2">
															Condición
														</Label>
														<Select
															value={field.state.value}
															onValueChange={(value) => {
																const condition = value as "new" | "used";
																field.handleChange(condition);
																const insuredAmount =
																	quoterForm.getFieldValue("insuredAmount") ??
																	0;
																if (insuredAmount > 0) {
																	updateInsuranceCost(
																		insuredAmount,
																		quoterForm.state.values.vehicleType,
																		{
																			condition,
																			origin:
																				quoterForm.getFieldValue(
																					"vehicleOrigin",
																				),
																		},
																	);
																}
															}}
														>
															<SelectTrigger>
																<SelectValue placeholder="Seleccionar condición..." />
															</SelectTrigger>
															<SelectContent>
																<SelectItem value="new">Nuevo</SelectItem>
																<SelectItem value="used">Usado</SelectItem>
															</SelectContent>
														</Select>
													</div>
												);
											}}
										</quoterForm.Field>

										<quoterForm.Field name="vehicleOrigin">
											{(field) => {
												return (
													<div>
														<Label htmlFor={field.name} className="mb-2">
															Origen
														</Label>
														<Select
															value={field.state.value}
															onValueChange={(value) => {
																const origin =
																	value as QuotationFormValues["vehicleOrigin"];
																field.handleChange(origin);
																const insuredAmount =
																	quoterForm.getFieldValue("insuredAmount") ??
																	0;
																if (insuredAmount > 0) {
																	updateInsuranceCost(
																		insuredAmount,
																		quoterForm.state.values.vehicleType,
																		{
																			condition:
																				quoterForm.getFieldValue(
																					"vehicleCondition",
																				),
																			origin,
																		},
																	);
																}
															}}
														>
															<SelectTrigger>
																<SelectValue placeholder="Seleccionar origen..." />
															</SelectTrigger>
															<SelectContent>
																{QUOTER_VEHICLE_ORIGIN_OPTIONS.map((option) => (
																	<SelectItem
																		key={option.value}
																		value={option.value}
																	>
																		{option.label}
																	</SelectItem>
																))}
															</SelectContent>
														</Select>
													</div>
												);
											}}
										</quoterForm.Field>
									</div>

									<quoterForm.Field name="vehicleValue">
										{(field) => (
											<div>
												<Label htmlFor={field.name} className="mb-2">
													Valor del Vehículo
												</Label>
												<Input
													id={field.name}
													type="number"
													value={field.state.value || ""}
													onBlur={(e) => {
														const value = Number(e.target.value) || 0;
														const isSobreVehiculo =
															quoterForm.state.values.creditType ===
															"sobre_vehiculo";

														if (value > 0) {
															if (isSobreVehiculo) {
																// En sobre vehículo: NO auto-llenar monto asegurado ni enganche
																// El usuario los define independientemente
															} else {
																// Autocompra: auto-llenar monto asegurado (igual al valor)
																quoterForm.setFieldValue(
																	"insuredAmount",
																	value,
																);

																// Auto-calcular enganche al 20%
																const downPayment = Math.round(value * 0.2);
																quoterForm.setFieldValue(
																	"downPayment",
																	downPayment,
																);
															}

															// Actualizar seguro y membresía en ambos casos
															updateInsuranceCost(
																isSobreVehiculo
																	? quoterForm.state.values.insuredAmount ||
																			value
																	: value,
																quoterForm.state.values.vehicleType,
															);
														}
													}}
													onChange={(e) => {
														field.handleChange(Number(e.target.value) || 0);
													}}
													placeholder="50000"
												/>
											</div>
										)}
									</quoterForm.Field>

									<quoterForm.Field name="insuredAmount">
										{(field) => (
											<div>
												<Label htmlFor={field.name} className="mb-2">
													Monto Asegurado
												</Label>
												<Input
													id={field.name}
													type="number"
													value={field.state.value || ""}
													onChange={(e) => {
														const value = Number(e.target.value) || 0;
														field.handleChange(value);

														// Actualizar seguro y membresía
														updateInsuranceCost(
															value,
															quoterForm.state.values.vehicleType,
														);
													}}
													placeholder="50000"
												/>
											</div>
										)}
									</quoterForm.Field>
								</CardContent>
							</Card>

							{/* Columna 2: Financiamiento */}
							<Card>
								<CardHeader>
									<CardTitle>Financiamiento</CardTitle>
								</CardHeader>
								<CardContent className="space-y-4">
									<quoterForm.Field name="downPayment">
										{(field) => {
											const isSobreVehiculo =
												quoterForm.state.values.creditType === "sobre_vehiculo";
											return (
												<div>
													<div className="mb-2 flex items-center justify-between">
														<Label htmlFor={field.name}>
															{isSobreVehiculo
																? "Monto Solicitado"
																: "Enganche"}
														</Label>
														{!isSobreVehiculo && (
															<span className="text-muted-foreground text-sm">
																{quoterForm.state.values.vehicleValue > 0
																	? (
																			(Number(field.state.value) /
																				Number(
																					quoterForm.state.values.vehicleValue,
																				)) *
																			100
																		).toFixed(2)
																	: "0.00"}
																% del valor
															</span>
														)}
													</div>
													<Input
														id={field.name}
														type="number"
														value={field.state.value || ""}
														onChange={(e) => {
															field.handleChange(Number(e.target.value) || 0);
															recalculate();
														}}
														placeholder={isSobreVehiculo ? "43000" : "20000"}
													/>
												</div>
											);
										}}
									</quoterForm.Field>

									<quoterForm.Field name="termMonths">
										{(field) => (
											<div>
												<Label htmlFor={field.name} className="mb-2">
													Plazo (meses)
												</Label>
												<Input
													id={field.name}
													type="number"
													value={field.state.value || ""}
													onChange={(e) => {
														field.handleChange(Number(e.target.value) || 0);
														recalculate();
													}}
													placeholder="60"
												/>
											</div>
										)}
									</quoterForm.Field>

									<quoterForm.Field name="interestRate">
										{(field) => (
											<div>
												<div className="mb-2 flex items-center justify-between">
													<Label htmlFor={field.name}>
														Tasa de Interés (%)
													</Label>
													<span className="text-muted-foreground text-sm">
														Tasa mensual
													</span>
												</div>
												<Input
													id={field.name}
													type="number"
													step="0.01"
													value={field.state.value || ""}
													onChange={(e) => {
														field.handleChange(Number(e.target.value) || 0);
														recalculate();
													}}
													placeholder="1.5"
												/>
											</div>
										)}
									</quoterForm.Field>

									<div className="border-t pt-4">
										<div className="space-y-2">
											<div className="flex justify-between">
												<span className="text-sm">Monto a Financiar:</span>
												<span className="font-medium">
													Q
													{calculatedValues.amountToFinance.toLocaleString(
														"es-GT",
														{
															minimumFractionDigits: 2,
															maximumFractionDigits: 2,
														},
													)}
												</span>
											</div>
										</div>
									</div>
								</CardContent>
							</Card>

							{/* Columna 3: Costos Adicionales */}
							<Card>
								<CardHeader>
									<CardTitle>Costos Adicionales</CardTitle>
								</CardHeader>
								<CardContent className="space-y-4">
									<quoterForm.Field name="insuranceCost">
										{(field) => (
											<div>
												<Label htmlFor={field.name} className="mb-2">
													Seguro
												</Label>
												<Input
													id={field.name}
													type="number"
													step="0.01"
													value={field.state.value || ""}
													onChange={(e) => {
														field.handleChange(Number(e.target.value) || 0);
														recalculate();
													}}
													placeholder="496.53"
												/>
											</div>
										)}
									</quoterForm.Field>
									{quoterForm.state.values.insuranceProvider === "gyt" ? (
										<p className="text-muted-foreground text-xs">
											Seguro: GyT. Actual Excel: Q
											{quoterForm.state.values.excelCurrentInsuranceCost.toFixed(
												2,
											)}{" "}
											/ CRM: Q
											{quoterForm.state.values.customerInsuranceCost.toFixed(2)}{" "}
											/ GyT: Q
											{quoterForm.state.values.internalInsuranceCost.toFixed(2)}
											. Diferencia a membresía: Q
											{quoterForm.state.values.insuranceSavingsToMembership.toFixed(
												2,
											)}
											.
										</p>
									) : (
										<p className="text-muted-foreground text-xs">
											Seguro: Universales
										</p>
									)}
									{quoterForm.state.values.membershipAdjustmentCategory ? (
										<p className="text-muted-foreground text-xs">
											Membresía: ajuste automático {""}
											{quoterForm.state.values.membershipAdjustmentPercentage.toFixed(
												2,
											)}
											% por {quoterForm.state.values.membershipAdjustmentCategory}.
										</p>
									) : null}

									<quoterForm.Field name="gpsCost">
										{(field) => (
											<div>
												<Label htmlFor={field.name} className="mb-2">
													GPS
												</Label>
												<Input
													id={field.name}
													type="number"
													step="0.01"
													value={field.state.value || ""}
													onChange={(e) => {
														field.handleChange(Number(e.target.value) || 0);
														recalculate();
													}}
													placeholder="148.20"
												/>
											</div>
										)}
									</quoterForm.Field>

									<quoterForm.Field name="transferCost">
										{(field) => (
											<div>
												<Label htmlFor={field.name} className="mb-2">
													Traspaso
												</Label>
												<Input
													id={field.name}
													type="number"
													step="0.01"
													value={field.state.value || ""}
													onChange={(e) => {
														field.handleChange(Number(e.target.value) || 0);
														recalculate();
													}}
													placeholder="1950"
												/>
											</div>
										)}
									</quoterForm.Field>

									<quoterForm.Field name="adminCost">
										{(field) => (
											<div>
												<Label htmlFor={field.name} className="mb-2">
													Gastos Administrativos
												</Label>
												<Input
													id={field.name}
													type="number"
													step="0.01"
													value={field.state.value || ""}
													onChange={(e) => {
														field.handleChange(Number(e.target.value) || 0);
														recalculate();
													}}
													placeholder="4010.73"
												/>
											</div>
										)}
									</quoterForm.Field>
								</CardContent>
							</Card>
						</div>

						{/* Gastos Adicionales para Detalle de Crédito */}
						<Card className="mt-6">
							<CardHeader>
								<CardTitle>Gastos Adicionales (Detalle de Crédito)</CardTitle>
								<CardDescription>
									Gastos opcionales que se descuentan del monto a desembolsar
								</CardDescription>
							</CardHeader>
							<CardContent>
								<quoterForm.Field name="creditType">
									{(creditTypeField) => (
										<ExtraCostsTable
											key={`${creditTypeField.state.value}-${quoterForm.state.values.opportunityId}`}
											values={quoterForm.state.values as QuotationFormValues}
											totalFinanced={calculatedValues.totalFinanced}
											creditType={creditTypeField.state.value}
											onFieldChange={(field, value) =>
												quoterForm.setFieldValue(field, value)
											}
										/>
									)}
								</quoterForm.Field>
							</CardContent>
						</Card>

						{/* Resumen */}
						<Card className="mt-6">
							<CardHeader>
								<CardTitle>Resumen de la Cotización</CardTitle>
							</CardHeader>
							<CardContent>
								<div className="grid gap-4 md:grid-cols-3">
									<div className="rounded-lg bg-secondary p-4 text-center">
										<p className="text-muted-foreground text-sm">
											Monto Total a Financiar
										</p>
										<p className="font-bold text-2xl">
											Q
											{calculatedValues.totalFinanced.toLocaleString("es-GT", {
												minimumFractionDigits: 2,
												maximumFractionDigits: 2,
											})}
										</p>
									</div>
									<div className="rounded-lg bg-primary/10 p-4 text-center">
										<p className="text-muted-foreground text-sm">
											Cuota Mensual
										</p>
										<p className="font-bold text-3xl text-primary">
											Q
											{calculatedValues.monthlyPayment.toLocaleString("es-GT", {
												minimumFractionDigits: 2,
												maximumFractionDigits: 2,
											})}
										</p>
									</div>
									<div className="rounded-lg bg-secondary p-4 text-center">
										<p className="text-muted-foreground text-sm">Plazo</p>
										<p className="font-bold text-2xl">
											{quoterForm.state.values.termMonths} meses
										</p>
									</div>
								</div>

								<div className="mt-6 flex gap-4">
									<Button
										type="submit"
										disabled={createQuotationMutation.isPending}
										className="gap-2"
									>
										{createQuotationMutation.isPending ? (
											<Loader2 className="h-4 w-4 animate-spin" />
										) : (
											<Save className="h-4 w-4" />
										)}
										{createQuotationMutation.isPending
											? "Guardando..."
											: "Guardar Cotización"}
									</Button>
									<DropdownMenu>
										<DropdownMenuTrigger asChild>
											<Button type="button" variant="outline" className="gap-2">
												<FileText className="h-4 w-4" />
												Generar PDF
												<ChevronDown className="h-3 w-3" />
											</Button>
										</DropdownMenuTrigger>
										<DropdownMenuContent>
											<DropdownMenuItem
												onClick={() => handleGeneratePdf(false)}
											>
												<FileText className="mr-2 h-4 w-4" />
												PDF Interno
											</DropdownMenuItem>
											<DropdownMenuItem onClick={() => handleGeneratePdf(true)}>
												<UserCheck className="mr-2 h-4 w-4" />
												PDF Cliente
											</DropdownMenuItem>
										</DropdownMenuContent>
									</DropdownMenu>
								</div>
							</CardContent>
						</Card>

						{/* Tabla de Amortización */}
						{amortizationTable.length > 0 && (
							<Card className="mt-6">
								<CardHeader>
									<CardTitle>Tabla de Amortización</CardTitle>
									<CardDescription>
										Detalle del pago mes a mes durante el plazo del
										financiamiento
									</CardDescription>
								</CardHeader>
								<CardContent>
									<div className="max-h-96 overflow-y-auto">
										<Table>
											<TableHeader>
												<TableRow>
													<TableHead>Período</TableHead>
													<TableHead className="text-right">
														Saldo Inicial
													</TableHead>
													<TableHead className="text-right">
														Interés + IVA
													</TableHead>
													<TableHead className="text-right">Capital</TableHead>
													<TableHead className="text-right">
														Saldo Final
													</TableHead>
												</TableRow>
											</TableHeader>
											<TableBody>
												{amortizationTable
													.filter((row) => row.period !== 0)
													.map((row) => (
														<TableRow key={row.period}>
															<TableCell className="font-medium">
																{row.period}
															</TableCell>
															<TableCell className="text-right">
																Q
																{row.initialBalance.toLocaleString("es-GT", {
																	minimumFractionDigits: 2,
																	maximumFractionDigits: 2,
																})}
															</TableCell>
															<TableCell className="text-right">
																Q
																{row.interestPlusVAT.toLocaleString("es-GT", {
																	minimumFractionDigits: 2,
																	maximumFractionDigits: 2,
																})}
															</TableCell>
															<TableCell className="text-right">
																Q
																{row.principal.toLocaleString("es-GT", {
																	minimumFractionDigits: 2,
																	maximumFractionDigits: 2,
																})}
															</TableCell>
															<TableCell className="text-right">
																Q
																{row.finalBalance.toLocaleString("es-GT", {
																	minimumFractionDigits: 2,
																	maximumFractionDigits: 2,
																})}
															</TableCell>
														</TableRow>
													))}
											</TableBody>
										</Table>
									</div>
								</CardContent>
							</Card>
						)}
					</form>
				</TabsContent>

				{/* Tab: Cotizaciones Guardadas */}
				<TabsContent value="saved" className="print:hidden">
					<Card>
						<CardHeader>
							<CardTitle>Cotizaciones Guardadas</CardTitle>
							<CardDescription>
								{quotationsQuery.data?.length || 0} cotización(es) guardada(s)
							</CardDescription>
						</CardHeader>
						<CardContent>
							{quotationsQuery.isLoading ? (
								<p>Cargando...</p>
							) : quotationsQuery.data?.length === 0 ? (
								<p className="py-8 text-center text-muted-foreground">
									No hay cotizaciones guardadas
								</p>
							) : (
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>Fecha</TableHead>
											<TableHead>Vehículo</TableHead>
											<TableHead>Valor</TableHead>
											<TableHead>Cuota Mensual</TableHead>
											<TableHead>Estado</TableHead>
											<TableHead>Acciones</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{quotationsQuery.data?.map((quotation) => (
											<TableRow key={quotation.id}>
												<TableCell>
													{new Date(quotation.createdAt).toLocaleDateString(
														"es-GT",
													)}
												</TableCell>
												<TableCell>
													{formatVehicleWithClient(
														[
															quotation.vehicleBrand,
															quotation.vehicleLine,
															quotation.vehicleModel,
														]
															.filter(Boolean)
															.join(" "),
														formatQuotationClientName(quotation),
													)}
												</TableCell>
												<TableCell>
													Q
													{Number(quotation.vehicleValue).toLocaleString(
														"es-GT",
														{
															minimumFractionDigits: 2,
															maximumFractionDigits: 2,
														},
													)}
												</TableCell>
												<TableCell className="font-medium">
													Q
													{Number(quotation.monthlyPayment).toLocaleString(
														"es-GT",
														{
															minimumFractionDigits: 2,
															maximumFractionDigits: 2,
														},
													)}
												</TableCell>
												<TableCell>
													<Badge
														className={
															statusColors[
																quotation.status as keyof typeof statusColors
															]
														}
													>
														{
															statusLabels[
																quotation.status as keyof typeof statusLabels
															]
														}
													</Badge>
												</TableCell>
												<TableCell>
													<div className="flex gap-2">
														<Button
															size="sm"
															variant="outline"
															onClick={() => handleViewQuotation(quotation.id)}
														>
															<Eye className="h-4 w-4" />
														</Button>
														<Button
															size="sm"
															variant="destructive"
															onClick={() =>
																deleteQuotationMutation.mutate(quotation.id)
															}
															disabled={deleteQuotationMutation.isPending}
														>
															{deleteQuotationMutation.isPending ? (
																<Loader2 className="h-4 w-4 animate-spin" />
															) : (
																<Trash2 className="h-4 w-4" />
															)}
														</Button>
													</div>
												</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
							)}
						</CardContent>
					</Card>
				</TabsContent>
			</Tabs>

			{/* Dialog para ver detalle de cotización */}
			{selectedQuotationId && (
				<QuotationDetailDialog
					quotationId={selectedQuotationId}
					isOpen={isViewDialogOpen}
					onClose={() => {
						setIsViewDialogOpen(false);
						setSelectedQuotationId(null);
					}}
				/>
			)}
		</div>
	);
}

// Componente separado para el detalle de la cotización con tabla de amortización
function QuotationDetailDialog({
	quotationId,
	isOpen,
	onClose,
}: {
	quotationId: string;
	isOpen: boolean;
	onClose: () => void;
}) {
	const quotationQuery = useQuery({
		...orpc.getQuotationById.queryOptions({ input: { quotationId } }),
		enabled: isOpen && !!quotationId,
	});

	const handleGeneratePdf = (clientVersion = false) => {
		if (!quotationQuery.data) return;

		const quotation = quotationQuery.data;
		const clientName = formatQuotationClientName(quotation);
		const quotationData = {
			creditType: quotation.creditType,
			clientName,
			vehicleBrand: quotation.vehicleBrand,
			vehicleLine: quotation.vehicleLine,
			vehicleModel: quotation.vehicleModel,
			vehicleValue: Number(quotation.vehicleValue),
			downPayment: Number(quotation.downPayment),
			downPaymentPercentage: Number(quotation.downPaymentPercentage || 0),
			amountToFinance: Number(quotation.amountToFinance || 0),
			totalFinanced: Number(quotation.totalFinanced),
			monthlyPayment: Number(quotation.monthlyPayment),
			termMonths: quotation.termMonths,
			interestRate: Number(quotation.interestRate),
			insuranceCost: Number(quotation.insuranceCost || 0),
			gpsCost: Number(quotation.gpsCost || 0),
			transferCost: Number(quotation.transferCost || 0),
			adminCost: Number(quotation.adminCost || 0),
			membershipCost: Number(quotation.membershipCost || 0),
			extraCosts: quotation,
			amortizationTable: quotation.amortizationTable.map((row) => ({
				period: row.period,
				initialBalance: row.initialBalance,
				interestPlusVAT: row.interestPlusVAT,
				principal: row.principal,
				finalBalance: row.finalBalance,
			})),
		};

		generateQuotationPdf(quotationData, { clientVersion });
	};

	if (!quotationQuery.data) {
		return (
			<Dialog open={isOpen} onOpenChange={onClose}>
				<DialogContent className="max-h-[90vh] max-w-6xl overflow-y-auto">
					<DialogHeader>
						<DialogTitle>Detalle de Cotización</DialogTitle>
					</DialogHeader>
					<p>Cargando...</p>
				</DialogContent>
			</Dialog>
		);
	}

	const quotation = quotationQuery.data;
	const clientName = formatQuotationClientName(quotation);
	const vehicleLabel = formatVehicleWithClient(
		[quotation.vehicleBrand, quotation.vehicleLine, quotation.vehicleModel]
			.filter(Boolean)
			.join(" "),
		clientName,
	);

	return (
		<Dialog open={isOpen} onOpenChange={onClose}>
			<DialogContent className="max-h-[90vh] min-w-[90vw] max-w-7xl overflow-y-auto">
				<DialogHeader className="pr-12">
					<div className="flex items-center justify-between">
						<div>
							<DialogTitle>Detalle de Cotización</DialogTitle>
							<DialogDescription>{vehicleLabel}</DialogDescription>
						</div>
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button variant="outline" className="gap-2">
									<FileText className="h-4 w-4" />
									Generar PDF
									<ChevronDown className="h-3 w-3" />
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent>
								<DropdownMenuItem onClick={() => handleGeneratePdf(false)}>
									<FileText className="mr-2 h-4 w-4" />
									PDF Interno
								</DropdownMenuItem>
								<DropdownMenuItem onClick={() => handleGeneratePdf(true)}>
									<UserCheck className="mr-2 h-4 w-4" />
									PDF Cliente
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
				</DialogHeader>

				<div className="space-y-6">
					{/* Resumen */}
					<div className="grid gap-4 md:grid-cols-4">
						<div className="rounded-lg bg-secondary p-4">
							<p className="text-muted-foreground text-sm">
								Valor del Vehículo
							</p>
							<p className="font-bold text-xl">
								Q
								{Number(quotation.vehicleValue).toLocaleString("es-GT", {
									minimumFractionDigits: 2,
									maximumFractionDigits: 2,
								})}
							</p>
						</div>
						<div className="rounded-lg bg-secondary p-4">
							<div className="mb-2 flex items-center justify-between">
								<p className="text-muted-foreground text-sm">Enganche</p>
								<p className="text-muted-foreground text-xs">
									{Number(quotation.downPaymentPercentage).toFixed(2)}%
								</p>
							</div>
							<p className="font-bold text-xl">
								Q
								{Number(quotation.downPayment).toLocaleString("es-GT", {
									minimumFractionDigits: 2,
									maximumFractionDigits: 2,
								})}
							</p>
						</div>
						<div className="rounded-lg bg-secondary p-4">
							<p className="text-muted-foreground text-sm">Total a Financiar</p>
							<p className="font-bold text-xl">
								Q
								{Number(quotation.totalFinanced).toLocaleString("es-GT", {
									minimumFractionDigits: 2,
									maximumFractionDigits: 2,
								})}
							</p>
						</div>
						<div className="rounded-lg bg-primary/10 p-4">
							<p className="text-muted-foreground text-sm">Cuota Mensual</p>
							<p className="font-bold text-2xl text-primary">
								Q
								{Number(quotation.monthlyPayment).toLocaleString("es-GT", {
									minimumFractionDigits: 2,
									maximumFractionDigits: 2,
								})}
							</p>
						</div>
					</div>

					{/* Tabla de Amortización */}
					<div>
						<h3 className="mb-4 font-semibold text-lg">
							Tabla de Amortización
						</h3>
						<div className="max-h-[400px] overflow-y-auto rounded-lg border">
							<Table>
								<TableHeader className="sticky top-0 bg-background">
									<TableRow>
										<TableHead>Cuota</TableHead>
										<TableHead>Saldo Inicial</TableHead>
										<TableHead>Interés + IVA</TableHead>
										<TableHead>Amortización</TableHead>
										<TableHead>Saldo Final</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{quotation.amortizationTable
										?.filter((row) => row.period !== 0)
										.map((row) => (
											<TableRow key={row.period}>
												<TableCell>{row.period}</TableCell>
												<TableCell>
													Q
													{row.initialBalance.toLocaleString("es-GT", {
														minimumFractionDigits: 2,
														maximumFractionDigits: 2,
													})}
												</TableCell>
												<TableCell>
													Q
													{row.interestPlusVAT.toLocaleString("es-GT", {
														minimumFractionDigits: 2,
														maximumFractionDigits: 2,
													})}
												</TableCell>
												<TableCell>
													Q
													{row.principal.toLocaleString("es-GT", {
														minimumFractionDigits: 2,
														maximumFractionDigits: 2,
													})}
												</TableCell>
												<TableCell>
													Q
													{row.finalBalance.toLocaleString("es-GT", {
														minimumFractionDigits: 2,
														maximumFractionDigits: 2,
													})}
												</TableCell>
											</TableRow>
										))}
								</TableBody>
							</Table>
						</div>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
