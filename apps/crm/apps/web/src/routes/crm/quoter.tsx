import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import {
	Calculator,
	Eye,
	FileText,
	Loader2,
	Plus,
	Save,
	Send,
	Target,
	Trash2,
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
import { PERMISSIONS } from "@/lib/roles";
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

/** IVA de Guatemala (12%) */
const IVA_FACTOR = 1.12;

/** Tasa de interés fija para autocompra usada en el cálculo de intereses del detalle */
const AUTOCOMPRA_INTEREST_RATE = 0.0178;

/** Gastos administrativos fijos para sobre vehículo */
const FIXED_ADMIN_COST = 600;

/** Garantía mobiliaria */
const GARANTIA_MOBILIARIA = 400;

/** Contrato leasing */
const CONTRATO_LEASING = 400;

// Función para calcular cuota mensual (según Excel)
function calculateMonthlyPayment(
	principal: number,
	monthlyRate: number,
	termMonths: number,
	insuranceCost: number,
	gpsCost: number,
): number {
	// La tasa incluye IVA (12%)
	const r = (monthlyRate / 100) * IVA_FACTOR;

	if (r === 0) return principal / termMonths;

	const factor = (1 + r) ** termMonths;
	const baseMonthlyPayment = (principal * (r * factor)) / (factor - 1);

	// Agregar seguro y GPS a la cuota mensual
	return Math.round((baseMonthlyPayment + insuranceCost + gpsCost) * 100) / 100;
}

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
	vehicleValue: number;
	insuredAmount: number;
	downPayment: number;
	termMonths: number;
	interestRate: number;
	insuranceCost: number;
	gpsCost: number;
	transferCost: number;
	adminCost: number;
	membershipCost: number;
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

// Configuración de campos de gastos extra
type ExtraCostFieldType = "percentage" | "fixed";
type CreditTypeFilter = "all" | "autocompra" | "sobre_vehiculo";

interface ExtraCostFieldConfig {
	name: string;
	label: string;
	type: ExtraCostFieldType;
	percentageField?: keyof QuotationFormValues; // Campo del form para el porcentaje (si aplica)
	valueField: keyof QuotationFormValues; // Campo del form para el valor
	creditType: CreditTypeFilter;
	section: "comision" | "otros" | "abogado";
	computed?: boolean; // Si es true, el campo se calcula automáticamente y no es editable
	defaultActive?: boolean; // Si es true, el campo está activo por defecto
	defaultValue?: number; // Valor por defecto al activar el campo
}

const EXTRA_COST_FIELDS: ExtraCostFieldConfig[] = [
	// Sección: Comisión y Gastos de Registro
	{
		name: "royalty",
		label: "Royalty",
		type: "percentage",
		percentageField: "royaltyPercentage",
		valueField: "royalty",
		creditType: "all",
		section: "comision",
		computed: true,
	},
	{
		name: "freelance",
		label: "Free Lance",
		type: "percentage",
		percentageField: "freelancePercentage",
		valueField: "freelanceCost",
		creditType: "all",
		section: "comision",
	},
	{
		name: "inspection",
		label: "Inspección",
		type: "fixed",
		valueField: "inspectionCost",
		creditType: "all",
		section: "comision",
	},
	{
		name: "extraGps",
		label: "GPS",
		type: "fixed",
		valueField: "extraGpsCost",
		creditType: "all",
		section: "comision",
	},
	{
		name: "extraInsurance",
		label: "Seguro INREXSA",
		type: "fixed",
		valueField: "extraInsuranceCost",
		creditType: "all",
		section: "comision",
		defaultActive: true,
	},
	{
		name: "extraMembership",
		label: "Membresía",
		type: "fixed",
		valueField: "extraMembershipCost",
		creditType: "all",
		section: "comision",
		defaultActive: true,
	},
	{
		name: "extraAdmin",
		label: "Gastos Administrativos",
		type: "fixed",
		valueField: "extraAdminCost",
		creditType: "all",
		section: "comision",
		defaultActive: true,
	},
	{
		name: "interest",
		label: "Intereses",
		type: "fixed",
		valueField: "interestCost",
		creditType: "all",
		section: "comision",
		computed: true,
	},
	// Sección: Otros Descuentos
	{
		name: "appointment",
		label: "Nombramiento",
		type: "fixed",
		valueField: "appointmentCost",
		creditType: "autocompra",
		section: "otros",
		defaultActive: true,
		defaultValue: 150,
	},
	{
		name: "fines",
		label: "Multas",
		type: "fixed",
		valueField: "finesCost",
		creditType: "all",
		section: "otros",
	},
	{
		name: "keyCopy",
		label: "Copia de llave",
		type: "fixed",
		valueField: "keyCopyCost",
		creditType: "all",
		section: "otros",
	},
	{
		name: "keyCopyDiff",
		label: "Diferencia copia llave",
		type: "fixed",
		valueField: "keyCopyDiffCost",
		creditType: "all",
		section: "otros",
	},
	{
		name: "addressVerification",
		label: "Verificación de dirección",
		type: "fixed",
		valueField: "addressVerificationCost",
		creditType: "all",
		section: "otros",
		defaultActive: true,
		defaultValue: 395,
	},
	{
		name: "circulationTax",
		label: "Impuesto circulación",
		type: "fixed",
		valueField: "circulationTaxCost",
		creditType: "all",
		section: "otros",
	},
	{
		name: "vehicleTransfer",
		label: "Traspaso de vehículo",
		type: "fixed",
		valueField: "vehicleTransferCost",
		creditType: "all",
		section: "otros",
	},
	{
		name: "mobileGuarantee",
		label: "Garantía mobiliaria",
		type: "fixed",
		valueField: "mobileGuaranteeCost",
		creditType: "all",
		section: "otros",
		defaultActive: true,
		defaultValue: 400,
	},
	{
		name: "licensePlates",
		label: "Placas",
		type: "fixed",
		valueField: "licensePlatesCost",
		creditType: "all",
		section: "otros",
	},
	// Sección: Gastos de Abogado
	{
		name: "leasingContract",
		label: "Contrato Leasing",
		type: "fixed",
		valueField: "leasingContractCost",
		creditType: "all",
		section: "abogado",
		defaultValue: 400,
	},
	{
		name: "collectionAuth",
		label: "Auténtica contrato cobranza",
		type: "fixed",
		valueField: "collectionAuthCost",
		creditType: "all",
		section: "abogado",
	},
	{
		name: "legal",
		label: "Gastos legales",
		type: "fixed",
		valueField: "legalCost",
		creditType: "all",
		section: "abogado",
	},
];

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

/** Costo fijo del GPS (se resta de la membresía cruda para obtener la neta) */
const GPS_COST = 148.2;

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
	const quoterForm = useForm({
		defaultValues: {
			opportunityId: "",
			vehicleId: "",
			creditType: "autocompra" as "autocompra" | "sobre_vehiculo",
			vehicleBrand: "",
			vehicleLine: "",
			vehicleModel: "",
			vehicleType: "particular" as const,
			vehicleValue: 0,
			insuredAmount: 0,
			downPayment: 0,
			termMonths: 60,
			interestRate: 1.5, // default autocompra; sobre_vehiculo usa 3
			insuranceCost: 0,
			gpsCost: GPS_COST,
			transferCost: 545, // 395 + 150 según Excel
			adminCost: 0,
			membershipCost: 0,
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
		},
		onSubmit: async ({ value }) => {
			createQuotationMutation.mutate({
				opportunityId: value.opportunityId || undefined,
				vehicleId: value.vehicleId || undefined,
				creditType: value.creditType,
				vehicleBrand: value.vehicleBrand,
				vehicleLine: value.vehicleLine,
				vehicleModel: value.vehicleModel,
				vehicleType: value.vehicleType,
				vehicleValue: Number(value.vehicleValue),
				insuredAmount: Number(value.insuredAmount),
				downPayment: Number(value.downPayment),
				termMonths: Number(value.termMonths),
				interestRate: Number(value.interestRate),
				insuranceCost: Number(value.insuranceCost),
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
				vehicleTransferCost: Number(value.vehicleTransferCost),
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
	]);

	// Tipos de bus RCDP (membresía ya incluida en la tarifa)
	const BUS_TYPES = ["microbus_20", "microbus_35", "microbus_36plus"];

	// Obtener costo de seguro automáticamente
	const updateInsuranceCost = async (
		insuredAmount: number,
		vehicleType: string,
	) => {
		if (insuredAmount <= 0) return;

		try {
			const result = await client.getInsuranceCost({
				insuredAmount,
				vehicleType: vehicleType as any,
			});

			const baseInsuranceCost =
				Math.round(result.baseInsuranceCost * 100) / 100;
			const rawMembershipCost = Math.round(result.membershipCost * 100) / 100;

			// El seguro total para cálculos es: base + (membresía - GPS)
			const netMembershipCost =
				Math.round((rawMembershipCost - GPS_COST) * 100) / 100;
			const insuranceCost =
				Math.round((baseInsuranceCost + netMembershipCost) * 100) / 100;

			quoterForm.setFieldValue("insuranceCost", insuranceCost);
			quoterForm.setFieldValue("membershipCost", netMembershipCost);
			quoterForm.setFieldValue("extraInsuranceCost", baseInsuranceCost);
			quoterForm.setFieldValue("extraMembershipCost", rawMembershipCost);
			quoterForm.setFieldValue("rcdpCost", result.rcdpCost);

			// Recalcular después de actualizar
			setTimeout(() => recalculate(), 100);
		} catch (error) {
			console.error("Error al obtener costo de seguro:", error);
		}
	};

	// Función para recalcular cuando cambian los valores (según Excel)
	const recalculate = () => {
		const values = quoterForm.state.values;
		const isSobreVehiculo = values.creditType === "sobre_vehiculo";

		// En sobre vehículo: el "downPayment" field se usa como "monto solicitado" directo
		// En autocompra: monto a financiar = valor del vehículo - enganche
		const amountToFinance = isSobreVehiculo
			? Number(values.downPayment) // downPayment field = monto solicitado
			: Number(values.vehicleValue) - Number(values.downPayment);
		const insuranceCost = Number(values.insuranceCost);
		const gpsCost = Number(values.gpsCost);
		const transferCost = Number(values.transferCost);
		const royaltyPercentage = Number(values.royaltyPercentage) || 4.0;
		const rcdpCost = Number(values.rcdpCost);

		let calculatedRoyalty: number;
		let calculatedInterest: number;
		let adminCost: number;
		let totalFinanced: number;

		if (isSobreVehiculo) {
			// Sobre vehículo: cálculos sobre el monto solicitado directamente
			// Royalty = % del monto solicitado
			calculatedRoyalty = Math.ceil(
				amountToFinance * (royaltyPercentage / 100),
			);

			// Intereses = monto solicitado × tasa × IVA
			const interestRate = Number(values.interestRate) / 100;
			calculatedInterest =
				Math.round(amountToFinance * interestRate * IVA_FACTOR * 100) / 100;

			// Gastos administrativos fijos
			adminCost = FIXED_ADMIN_COST;

			// Total financiado = monto solicitado (los gastos se descuentan del desembolso)
			totalFinanced = amountToFinance;
		} else {
			// Autocompra: cálculos sobre B22
			// B22 = Monto a financiar + Traspaso + Garantía + Leasing + Admin fijo + GPS + Seguro
			const b22 =
				amountToFinance +
				transferCost +
				GARANTIA_MOBILIARIA +
				CONTRATO_LEASING +
				FIXED_ADMIN_COST +
				gpsCost +
				insuranceCost;

			// Royalty = % de B22 redondeado hacia arriba
			calculatedRoyalty = Math.ceil(b22 * (royaltyPercentage / 100));

			// Interés = ROUNDUP(B22 * tasa autocompra) + RCDP (para microbuses)
			calculatedInterest =
				Math.ceil(b22 * AUTOCOMPRA_INTEREST_RATE) + rcdpCost;

			// Gastos Admin = Garantía + Royalty + Leasing + Admin fijo + Intereses + GPS + Seguro
			const extraCost = calculatedInterest + gpsCost + insuranceCost;
			adminCost =
				GARANTIA_MOBILIARIA +
				calculatedRoyalty +
				CONTRATO_LEASING +
				FIXED_ADMIN_COST +
				extraCost;

			// Total financiado = monto a financiar + costos financiados
			const financedCosts = transferCost + adminCost;
			totalFinanced = amountToFinance + financedCosts;
		}

		quoterForm.setFieldValue("royalty", calculatedRoyalty);
		quoterForm.setFieldValue("interestCost", calculatedInterest);
		quoterForm.setFieldValue("adminCost", Math.round(adminCost * 100) / 100);

		// Nota: extraInsuranceCost y extraMembershipCost se calculan en updateInsuranceCost()
		// para que sean editables y no se sobrescriban en cada recálculo

		// La cuota mensual incluye seguro y GPS aparte
		const monthlyPayment = calculateMonthlyPayment(
			totalFinanced,
			Number(values.interestRate),
			Number(values.termMonths),
			insuranceCost,
			gpsCost,
		);

		setCalculatedValues({
			amountToFinance,
			totalFinanced,
			monthlyPayment,
		});

		// Generar tabla de amortización si hay valores
		if (totalFinanced > 0 && monthlyPayment > 0) {
			const table = generateAmortizationTable(
				totalFinanced,
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
		const vehicleTypeToUse =
			(vehicle.vehicleType as typeof quoterForm.state.values.vehicleType) ||
			"particular";
		quoterForm.setFieldValue("vehicleType", vehicleTypeToUse);

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

				// Actualizar seguro y membresía
				updateInsuranceCost(
					isSobreVehiculo
						? quoterForm.state.values.insuredAmount || numericValue
						: numericValue,
					quoterForm.state.values.vehicleType,
				);
			}
		}
	};

	// Cargar cotización existente de una oportunidad
	const loadExistingQuotation = async (opportunityId: string) => {
		try {
			const quotations = await client.listQuotationsByOpportunity({
				opportunityId,
			});

			if (quotations && quotations.length > 0) {
				const q = quotations[0]; // La más reciente

				// Cargar todos los campos de la cotización
				quoterForm.setFieldValue("vehicleId", q.vehicleId || "");
				quoterForm.setFieldValue("vehicleBrand", q.vehicleBrand || "");
				quoterForm.setFieldValue("vehicleLine", q.vehicleLine || "");
				quoterForm.setFieldValue("vehicleModel", q.vehicleModel || "");
				const vehicleTypeToUse =
					(q.vehicleType as typeof quoterForm.state.values.vehicleType) ||
					"particular";
				quoterForm.setFieldValue("vehicleType", vehicleTypeToUse);
				quoterForm.setFieldValue("vehicleValue", Number(q.vehicleValue) || 0);
				quoterForm.setFieldValue("insuredAmount", Number(q.insuredAmount) || 0);
				quoterForm.setFieldValue("downPayment", Number(q.downPayment) || 0);
				quoterForm.setFieldValue("termMonths", q.termMonths || 36);
				quoterForm.setFieldValue("interestRate", Number(q.interestRate) || 2.5);

				// Costos básicos
				quoterForm.setFieldValue("insuranceCost", Number(q.insuranceCost) || 0);
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
				quoterForm.setFieldValue(
					"vehicleTransferCost",
					Number(q.vehicleTransferCost) || 0,
				);

				// Recalcular después de cargar
				setTimeout(() => recalculate(), 100);

				toast.success("Cotización existente cargada");
			}
		} catch (error) {
			console.error("Error al cargar cotización existente:", error);
		}
	};

	const handleViewQuotation = (quotationId: string) => {
		setSelectedQuotationId(quotationId);
		setIsViewDialogOpen(true);
	};

	const handleGeneratePdf = () => {
		if (calculatedValues.monthlyPayment <= 0) {
			toast.error("Completa todos los campos para generar el PDF");
			return;
		}

		const values = quoterForm.state.values;
		// Calculate down payment percentage
		const downPaymentPercentage =
			values.vehicleValue > 0
				? (values.downPayment / values.vehicleValue) * 100
				: 0;

		const quotationData = {
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
			amortizationTable: amortizationTable,
		};

		generateQuotationPdf(quotationData);
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
												...(opportunitiesQuery.data?.map((opp: any) => ({
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
														(opp: any) => opp.id === value,
													);
													if (selectedOpp?.creditType) {
														quoterForm.setFieldValue(
															"creditType",
															selectedOpp.creditType,
														);
													}

													// Intentar cargar cotización existente primero
													await loadExistingQuotation(value);

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
											(opp: any) =>
												opp.id === quoterForm.state.values.opportunityId,
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
															value as "autocompra" | "sobre_vehiculo",
														);
														// Actualizar campos específicos según tipo de crédito
														if (value === "autocompra") {
															quoterForm.setFieldValue(
																"addressVerificationCost",
																395,
															);
															quoterForm.setFieldValue("appointmentCost", 150);
															quoterForm.setFieldValue("interestRate", 1.5);
														} else {
															quoterForm.setFieldValue("appointmentCost", 0);
															quoterForm.setFieldValue("interestRate", 3);
															// En sobre vehículo no hay enganche, limpiar
															quoterForm.setFieldValue("downPayment", 0);
														}
														// Recalcular después del cambio de tipo
														setTimeout(() => recalculate(), 100);
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
														field.handleChange(value as any);

														// Actualizar seguro cuando cambia el tipo
														// Usar getFieldValue para obtener el valor actual (no stale)
														const insuredAmount =
															quoterForm.getFieldValue("insuredAmount") ?? 0;
														if (insuredAmount > 0) {
															updateInsuranceCost(insuredAmount, value);
														}
													}}
												>
													<SelectTrigger>
														<SelectValue placeholder="Seleccionar tipo..." />
													</SelectTrigger>
													<SelectContent>
														<SelectItem value="particular">
															Particular
														</SelectItem>
														<SelectItem value="uber">UBER</SelectItem>
														<SelectItem value="pickup">Pick Up</SelectItem>
														<SelectItem value="nuevo">Nuevo</SelectItem>
														<SelectItem value="panel">Panel</SelectItem>
														<SelectItem value="camion">Camión</SelectItem>
														<SelectItem value="microbus">Microbus</SelectItem>
														<SelectItem value="microbus_20">
															Bus hasta 20 pasajeros (RCDP)
														</SelectItem>
														<SelectItem value="microbus_35">
															Bus 21-35 pasajeros (RCDP)
														</SelectItem>
														<SelectItem value="microbus_36plus">
															Bus más de 35 pasajeros (RCDP)
														</SelectItem>
													</SelectContent>
												</Select>
											</div>
										)}
									</quoterForm.Field>

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
									<Button
										type="button"
										variant="outline"
										className="gap-2"
										onClick={handleGeneratePdf}
									>
										<FileText className="h-4 w-4" />
										Generar PDF
									</Button>
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
																Q{row.initialBalance.toFixed(2)}
															</TableCell>
															<TableCell className="text-right">
																Q{row.interestPlusVAT.toFixed(2)}
															</TableCell>
															<TableCell className="text-right">
																Q{row.principal.toFixed(2)}
															</TableCell>
															<TableCell className="text-right">
																Q{row.finalBalance.toFixed(2)}
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
													{quotation.vehicleBrand} {quotation.vehicleLine}{" "}
													{quotation.vehicleModel}
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

	const handleGeneratePdf = () => {
		if (!quotationQuery.data) return;

		const quotation = quotationQuery.data;
		const quotationData = {
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
			amortizationTable: quotation.amortizationTable.map((row: any) => ({
				period: row.period,
				initialBalance: row.initialBalance,
				interestPlusVAT: row.interestPlusVAT,
				principal: row.principal,
				finalBalance: row.finalBalance,
			})),
		};

		generateQuotationPdf(quotationData);
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

	return (
		<Dialog open={isOpen} onOpenChange={onClose}>
			<DialogContent className="max-h-[90vh] min-w-[90vw] max-w-7xl overflow-y-auto">
				<DialogHeader className="pr-12">
					<div className="flex items-center justify-between">
						<div>
							<DialogTitle>Detalle de Cotización</DialogTitle>
							<DialogDescription>
								{quotation.vehicleBrand} {quotation.vehicleLine}{" "}
								{quotation.vehicleModel}
							</DialogDescription>
						</div>
						<Button
							variant="outline"
							className="gap-2"
							onClick={handleGeneratePdf}
						>
							<FileText className="h-4 w-4" />
							Generar PDF
						</Button>
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
										?.filter((row: any) => row.period !== 0)
										.map((row: any) => (
											<TableRow key={row.period}>
												<TableCell>{row.period}</TableCell>
												<TableCell>Q{row.initialBalance.toFixed(2)}</TableCell>
												<TableCell>Q{row.interestPlusVAT.toFixed(2)}</TableCell>
												<TableCell>Q{row.principal.toFixed(2)}</TableCell>
												<TableCell>Q{row.finalBalance.toFixed(2)}</TableCell>
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
