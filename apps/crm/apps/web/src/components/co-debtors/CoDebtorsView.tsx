import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	Calculator,
	ChevronDown,
	ChevronUp,
	Edit2,
	Mail,
	Pencil,
	Phone,
	Plus,
	Save,
	Trash2,
	User,
	X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { BankStatementAnalysis } from "@/components/credit/BankStatementAnalysis";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
import { Textarea } from "@/components/ui/textarea";
import type { IOpportunity } from "@/routes/crm/opportunities";
import { client } from "@/utils/orpc";

interface CoDebtorsViewProps {
	opportunityId: string;
	opportunity: IOpportunity;
}

// Tipo inferido de la query de co-deudores
type CoDebtor = Awaited<
	ReturnType<typeof client.getCoDebtorsByOpportunity>
>[number];

// Labels para estado civil
const maritalStatusLabels: Record<string, string> = {
	single: "Soltero/a",
	married: "Casado/a",
	divorced: "Divorciado/a",
	widowed: "Viudo/a",
};

// Labels para ocupación
const occupationLabels: Record<string, string> = {
	owner: "Propietario",
	employee: "Empleado",
};

// Tipo para el formulario
interface CoDebtorFormData {
	fullName: string;
	dpi: string;
	age: string;
	maritalStatus: "" | "single" | "married" | "divorced" | "widowed";
	profession: string;
	nationality: string;
	email: string;
	phone: string;
	occupation: "" | "owner" | "employee";
	notes: string;
}

const emptyFormData: CoDebtorFormData = {
	fullName: "",
	dpi: "",
	age: "",
	maritalStatus: "",
	profession: "",
	nationality: "",
	email: "",
	phone: "",
	occupation: "",
	notes: "",
};

// Formatear moneda
const formatCurrency = (value: string | number | null | undefined): string => {
	if (value === null || value === undefined) return "Q 0.00";
	const num = typeof value === "string" ? Number.parseFloat(value) : value;
	if (Number.isNaN(num)) return "Q 0.00";
	return `Q ${num.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

// Formatear fecha
const formatDate = (date: Date | string | null | undefined): string => {
	if (!date) return "-";
	const d = typeof date === "string" ? new Date(date) : date;
	return d.toLocaleDateString("es-GT", {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
};

// Componente de tarjeta individual de co-deudor
function CoDebtorCard({
	coDebtor,
	onEdit,
	onDelete,
}: {
	coDebtor: CoDebtor;
	onEdit: () => void;
	onDelete: () => void;
}) {
	const [isExpanded, setIsExpanded] = useState(false);
	const [isEditingAnalysis, setIsEditingAnalysis] = useState(false);
	const [analysisForm, setAnalysisForm] = useState({
		monthlyFixedIncome: "",
		monthlyVariableIncome: "",
		monthlyFixedExpenses: "",
		monthlyVariableExpenses: "",
		economicAvailability: "",
		minPayment: "",
		maxPayment: "",
		adjustedPayment: "",
		maxCreditAmount: "",
	});
	const queryClient = useQueryClient();

	// Query para obtener análisis de crédito del co-deudor
	const creditAnalysisQuery = useQuery({
		queryKey: ["creditAnalysis", "coDebtor", coDebtor.id],
		queryFn: () => client.getCreditAnalysisByLeadId({ coDebtorId: coDebtor.id }),
	});

	// Mutation para guardar análisis
	const upsertAnalysisMutation = useMutation({
		mutationFn: (data: {
			coDebtorId: string;
			monthlyFixedIncome?: number;
			monthlyVariableIncome?: number;
			monthlyFixedExpenses?: number;
			monthlyVariableExpenses?: number;
			economicAvailability?: number;
			minPayment?: number;
			maxPayment?: number;
			adjustedPayment?: number;
			maxCreditAmount?: number;
		}) => client.upsertCreditAnalysis(data),
		onSuccess: () => {
			toast.success("Análisis guardado correctamente");
			queryClient.invalidateQueries({
				queryKey: ["creditAnalysis", "coDebtor", coDebtor.id],
			});
			setIsEditingAnalysis(false);
		},
		onError: (error) => {
			toast.error(`Error al guardar: ${error.message}`);
		},
	});

	const handleEditAnalysis = () => {
		const data = creditAnalysisQuery.data;
		setAnalysisForm({
			monthlyFixedIncome: data?.monthlyFixedIncome?.toString() || "",
			monthlyVariableIncome: data?.monthlyVariableIncome?.toString() || "",
			monthlyFixedExpenses: data?.monthlyFixedExpenses?.toString() || "",
			monthlyVariableExpenses: data?.monthlyVariableExpenses?.toString() || "",
			economicAvailability: data?.economicAvailability?.toString() || "",
			minPayment: data?.minPayment?.toString() || "",
			maxPayment: data?.maxPayment?.toString() || "",
			adjustedPayment: data?.adjustedPayment?.toString() || "",
			maxCreditAmount: data?.maxCreditAmount?.toString() || "",
		});
		setIsEditingAnalysis(true);
	};

	const handleSaveAnalysis = () => {
		upsertAnalysisMutation.mutate({
			coDebtorId: coDebtor.id,
			monthlyFixedIncome: analysisForm.monthlyFixedIncome
				? Number(analysisForm.monthlyFixedIncome)
				: undefined,
			monthlyVariableIncome: analysisForm.monthlyVariableIncome
				? Number(analysisForm.monthlyVariableIncome)
				: undefined,
			monthlyFixedExpenses: analysisForm.monthlyFixedExpenses
				? Number(analysisForm.monthlyFixedExpenses)
				: undefined,
			monthlyVariableExpenses: analysisForm.monthlyVariableExpenses
				? Number(analysisForm.monthlyVariableExpenses)
				: undefined,
			economicAvailability: analysisForm.economicAvailability
				? Number(analysisForm.economicAvailability)
				: undefined,
			minPayment: analysisForm.minPayment
				? Number(analysisForm.minPayment)
				: undefined,
			maxPayment: analysisForm.maxPayment
				? Number(analysisForm.maxPayment)
				: undefined,
			adjustedPayment: analysisForm.adjustedPayment
				? Number(analysisForm.adjustedPayment)
				: undefined,
			maxCreditAmount: analysisForm.maxCreditAmount
				? Number(analysisForm.maxCreditAmount)
				: undefined,
		});
	};

	const hasAnalysis = creditAnalysisQuery.data?.analyzedAt != null;

	return (
		<Card>
			<CardHeader className="pb-3">
				<div className="flex items-start justify-between">
					<div className="flex items-center gap-3">
						<div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
							<User className="h-5 w-5 text-primary" />
						</div>
						<div>
							<CardTitle className="text-base">{coDebtor.fullName}</CardTitle>
							<p className="text-muted-foreground text-sm">
								DPI: {coDebtor.dpi}
							</p>
						</div>
					</div>
					<div className="flex gap-1">
						<Button variant="ghost" size="icon" onClick={onEdit}>
							<Edit2 className="h-4 w-4" />
						</Button>
						<Button
							variant="ghost"
							size="icon"
							className="text-red-500 hover:text-red-600"
							onClick={onDelete}
						>
							<Trash2 className="h-4 w-4" />
						</Button>
					</div>
				</div>
			</CardHeader>
			<CardContent className="space-y-4">
				{/* Info básica */}
				<div className="grid grid-cols-2 gap-4 text-sm">
					{coDebtor.phone && (
						<div className="flex items-center gap-2">
							<Phone className="h-4 w-4 text-muted-foreground" />
							<span>{coDebtor.phone}</span>
						</div>
					)}
					{coDebtor.email && (
						<div className="flex items-center gap-2">
							<Mail className="h-4 w-4 text-muted-foreground" />
							<span className="truncate">{coDebtor.email}</span>
						</div>
					)}
					{coDebtor.age && (
						<div>
							<span className="text-muted-foreground">Edad:</span> {coDebtor.age} años
						</div>
					)}
					{coDebtor.maritalStatus && (
						<div>
							<span className="text-muted-foreground">Estado civil:</span>{" "}
							{maritalStatusLabels[coDebtor.maritalStatus]}
						</div>
					)}
					{coDebtor.profession && (
						<div>
							<span className="text-muted-foreground">Profesión:</span>{" "}
							{coDebtor.profession}
						</div>
					)}
					{coDebtor.nationality && (
						<div>
							<span className="text-muted-foreground">Nacionalidad:</span>{" "}
							{coDebtor.nationality}
						</div>
					)}
					{coDebtor.occupation && (
						<div>
							<span className="text-muted-foreground">Ocupación:</span>{" "}
							{occupationLabels[coDebtor.occupation]}
						</div>
					)}
				</div>

				{/* Capacidad de pago - Collapsible */}
				<Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
					<CollapsibleTrigger asChild>
						<Button
							variant="outline"
							className="w-full justify-between"
							size="sm"
						>
							<div className="flex items-center gap-2">
								<Calculator className="h-4 w-4" />
								<span>Capacidad de Pago</span>
								{hasAnalysis && (
									<span className="rounded-full bg-green-100 px-2 py-0.5 text-green-700 text-xs">
										Analizado
									</span>
								)}
							</div>
							{isExpanded ? (
								<ChevronUp className="h-4 w-4" />
							) : (
								<ChevronDown className="h-4 w-4" />
							)}
						</Button>
					</CollapsibleTrigger>
					<CollapsibleContent className="mt-3 space-y-4">
						{/* Análisis con IA */}
						<BankStatementAnalysis
							coDebtorId={coDebtor.id}
							onAnalysisComplete={() => creditAnalysisQuery.refetch()}
						/>

						{/* Análisis manual o resultados */}
						<div className="rounded-lg border bg-muted/30 p-4">
							<div className="mb-3 flex items-center justify-between">
								<h4 className="font-medium text-sm">Datos del Análisis</h4>
								{!isEditingAnalysis ? (
									<Button variant="outline" size="sm" onClick={handleEditAnalysis}>
										<Pencil className="mr-2 h-3 w-3" />
										{hasAnalysis ? "Editar" : "Agregar manual"}
									</Button>
								) : (
									<Button
										variant="ghost"
										size="sm"
										onClick={() => setIsEditingAnalysis(false)}
									>
										<X className="mr-2 h-3 w-3" />
										Cancelar
									</Button>
								)}
							</div>

							{isEditingAnalysis ? (
								<div className="space-y-4">
									{/* Ingresos y Gastos */}
									<div className="grid grid-cols-2 gap-4">
										<div className="space-y-3">
											<h5 className="font-medium text-xs text-muted-foreground">
												Ingresos Mensuales
											</h5>
											<div className="space-y-2">
												<div>
													<Label className="text-xs">Ingresos Fijos</Label>
													<Input
														type="number"
														step="0.01"
														placeholder="0.00"
														value={analysisForm.monthlyFixedIncome}
														onChange={(e) =>
															setAnalysisForm((prev) => ({
																...prev,
																monthlyFixedIncome: e.target.value,
															}))
														}
													/>
												</div>
												<div>
													<Label className="text-xs">Ingresos Variables</Label>
													<Input
														type="number"
														step="0.01"
														placeholder="0.00"
														value={analysisForm.monthlyVariableIncome}
														onChange={(e) =>
															setAnalysisForm((prev) => ({
																...prev,
																monthlyVariableIncome: e.target.value,
															}))
														}
													/>
												</div>
											</div>
										</div>
										<div className="space-y-3">
											<h5 className="font-medium text-xs text-muted-foreground">
												Gastos Mensuales
											</h5>
											<div className="space-y-2">
												<div>
													<Label className="text-xs">Gastos Fijos</Label>
													<Input
														type="number"
														step="0.01"
														placeholder="0.00"
														value={analysisForm.monthlyFixedExpenses}
														onChange={(e) =>
															setAnalysisForm((prev) => ({
																...prev,
																monthlyFixedExpenses: e.target.value,
															}))
														}
													/>
												</div>
												<div>
													<Label className="text-xs">Gastos Variables</Label>
													<Input
														type="number"
														step="0.01"
														placeholder="0.00"
														value={analysisForm.monthlyVariableExpenses}
														onChange={(e) =>
															setAnalysisForm((prev) => ({
																...prev,
																monthlyVariableExpenses: e.target.value,
															}))
														}
													/>
												</div>
											</div>
										</div>
									</div>

									{/* Disponibilidad */}
									<div>
										<Label className="text-xs">Disponibilidad Económica</Label>
										<Input
											type="number"
											step="0.01"
											placeholder="0.00"
											value={analysisForm.economicAvailability}
											onChange={(e) =>
												setAnalysisForm((prev) => ({
													...prev,
													economicAvailability: e.target.value,
												}))
											}
										/>
									</div>

									{/* Capacidad de pago */}
									<div className="grid grid-cols-2 gap-2">
										<div>
											<Label className="text-xs">Pago Mínimo</Label>
											<Input
												type="number"
												step="0.01"
												placeholder="0.00"
												value={analysisForm.minPayment}
												onChange={(e) =>
													setAnalysisForm((prev) => ({
														...prev,
														minPayment: e.target.value,
													}))
												}
											/>
										</div>
										<div>
											<Label className="text-xs">Pago Máximo</Label>
											<Input
												type="number"
												step="0.01"
												placeholder="0.00"
												value={analysisForm.maxPayment}
												onChange={(e) =>
													setAnalysisForm((prev) => ({
														...prev,
														maxPayment: e.target.value,
													}))
												}
											/>
										</div>
										<div>
											<Label className="text-xs">Pago Ajustado</Label>
											<Input
												type="number"
												step="0.01"
												placeholder="0.00"
												value={analysisForm.adjustedPayment}
												onChange={(e) =>
													setAnalysisForm((prev) => ({
														...prev,
														adjustedPayment: e.target.value,
													}))
												}
											/>
										</div>
										<div>
											<Label className="text-xs">Crédito Máximo</Label>
											<Input
												type="number"
												step="0.01"
												placeholder="0.00"
												value={analysisForm.maxCreditAmount}
												onChange={(e) =>
													setAnalysisForm((prev) => ({
														...prev,
														maxCreditAmount: e.target.value,
													}))
												}
											/>
										</div>
									</div>

									<Button
										className="w-full"
										size="sm"
										onClick={handleSaveAnalysis}
										disabled={upsertAnalysisMutation.isPending}
									>
										{upsertAnalysisMutation.isPending ? (
											"Guardando..."
										) : (
											<>
												<Save className="mr-2 h-3 w-3" />
												Guardar Análisis
											</>
										)}
									</Button>
								</div>
							) : hasAnalysis ? (
								<div className="space-y-3">
									{/* Resumen de ingresos y gastos */}
									<div className="grid grid-cols-2 gap-4 text-sm">
										<div className="rounded bg-green-50 p-2">
											<p className="text-muted-foreground text-xs">
												Total Ingresos
											</p>
											<p className="font-semibold text-green-600">
												{formatCurrency(
													Number(
														creditAnalysisQuery.data?.monthlyFixedIncome || 0,
													) +
														Number(
															creditAnalysisQuery.data?.monthlyVariableIncome ||
																0,
														),
												)}
											</p>
										</div>
										<div className="rounded bg-red-50 p-2">
											<p className="text-muted-foreground text-xs">
												Total Gastos
											</p>
											<p className="font-semibold text-red-600">
												{formatCurrency(
													Number(
														creditAnalysisQuery.data?.monthlyFixedExpenses || 0,
													) +
														Number(
															creditAnalysisQuery.data?.monthlyVariableExpenses ||
																0,
														),
												)}
											</p>
										</div>
									</div>

									{/* Disponibilidad */}
									<div className="rounded bg-blue-50 p-2 text-center">
										<p className="text-muted-foreground text-xs">
											Disponibilidad Económica
										</p>
										<p className="font-bold text-blue-600 text-lg">
											{formatCurrency(
												creditAnalysisQuery.data?.economicAvailability,
											)}
										</p>
									</div>

									{/* Capacidad de pago */}
									<div className="grid grid-cols-4 gap-2 text-center text-xs">
										<div className="rounded border p-2">
											<p className="text-muted-foreground">Pago Mín</p>
											<p className="font-semibold text-orange-600">
												{formatCurrency(creditAnalysisQuery.data?.minPayment)}
											</p>
										</div>
										<div className="rounded border p-2">
											<p className="text-muted-foreground">Pago Ajust</p>
											<p className="font-semibold text-blue-600">
												{formatCurrency(
													creditAnalysisQuery.data?.adjustedPayment,
												)}
											</p>
										</div>
										<div className="rounded border p-2">
											<p className="text-muted-foreground">Pago Máx</p>
											<p className="font-semibold text-green-600">
												{formatCurrency(creditAnalysisQuery.data?.maxPayment)}
											</p>
										</div>
										<div className="rounded border bg-primary/5 p-2">
											<p className="text-muted-foreground">Créd. Máx</p>
											<p className="font-semibold text-primary">
												{formatCurrency(
													creditAnalysisQuery.data?.maxCreditAmount,
												)}
											</p>
										</div>
									</div>

									<p className="text-right text-muted-foreground text-xs">
										Analizado: {formatDate(creditAnalysisQuery.data?.analyzedAt)}
									</p>
								</div>
							) : (
								<p className="py-4 text-center text-muted-foreground text-sm">
									No hay análisis de capacidad de pago.
									<br />
									Sube estados de cuenta o agrega los datos manualmente.
								</p>
							)}
						</div>
					</CollapsibleContent>
				</Collapsible>
			</CardContent>
		</Card>
	);
}

export function CoDebtorsView({ opportunityId }: CoDebtorsViewProps) {
	const queryClient = useQueryClient();
	const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
	const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
	const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
	const [selectedCoDebtor, setSelectedCoDebtor] = useState<CoDebtor | null>(
		null,
	);
	const [formData, setFormData] = useState<CoDebtorFormData>(emptyFormData);

	// Query para obtener co-deudores
	const { data: coDebtors = [], isLoading } = useQuery({
		queryKey: ["coDebtors", opportunityId],
		queryFn: () => client.getCoDebtorsByOpportunity({ opportunityId }),
	});

	// Mutation para crear co-deudor
	const createMutation = useMutation({
		mutationFn: (data: Parameters<typeof client.createCoDebtor>[0]) =>
			client.createCoDebtor(data),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["coDebtors", opportunityId] });
			toast.success("Co-firmante agregado correctamente");
			setIsAddDialogOpen(false);
			setFormData(emptyFormData);
		},
		onError: (error) => {
			toast.error(`Error al agregar co-firmante: ${error.message}`);
		},
	});

	// Mutation para actualizar co-deudor
	const updateMutation = useMutation({
		mutationFn: (data: Parameters<typeof client.updateCoDebtor>[0]) =>
			client.updateCoDebtor(data),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["coDebtors", opportunityId] });
			toast.success("Co-firmante actualizado correctamente");
			setIsEditDialogOpen(false);
			setSelectedCoDebtor(null);
			setFormData(emptyFormData);
		},
		onError: (error) => {
			toast.error(`Error al actualizar co-firmante: ${error.message}`);
		},
	});

	// Mutation para eliminar co-deudor
	const deleteMutation = useMutation({
		mutationFn: (id: string) => client.deleteCoDebtor({ id }),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["coDebtors", opportunityId] });
			toast.success("Co-firmante eliminado correctamente");
			setIsDeleteDialogOpen(false);
			setSelectedCoDebtor(null);
		},
		onError: (error) => {
			toast.error(`Error al eliminar co-firmante: ${error.message}`);
		},
	});

	// Handlers
	const handleCreate = () => {
		if (!formData.fullName || !formData.dpi) {
			toast.error("El nombre completo y DPI son requeridos");
			return;
		}
		createMutation.mutate({
			opportunityId,
			fullName: formData.fullName,
			dpi: formData.dpi,
			age: formData.age ? Number.parseInt(formData.age, 10) : undefined,
			maritalStatus: formData.maritalStatus || undefined,
			profession: formData.profession || undefined,
			nationality: formData.nationality || undefined,
			email: formData.email || undefined,
			phone: formData.phone || undefined,
			occupation: formData.occupation || undefined,
			notes: formData.notes || undefined,
		});
	};

	const handleUpdate = () => {
		if (!selectedCoDebtor) return;
		if (!formData.fullName || !formData.dpi) {
			toast.error("El nombre completo y DPI son requeridos");
			return;
		}
		updateMutation.mutate({
			id: selectedCoDebtor.id,
			fullName: formData.fullName,
			dpi: formData.dpi,
			age: formData.age ? Number.parseInt(formData.age, 10) : null,
			maritalStatus: formData.maritalStatus || null,
			profession: formData.profession || null,
			nationality: formData.nationality || null,
			email: formData.email || null,
			phone: formData.phone || null,
			occupation: formData.occupation || null,
			notes: formData.notes || null,
		});
	};

	const handleOpenAdd = () => {
		setFormData(emptyFormData);
		setIsAddDialogOpen(true);
	};

	const handleEdit = (coDebtor: CoDebtor) => {
		setSelectedCoDebtor(coDebtor);
		setFormData({
			fullName: coDebtor.fullName,
			dpi: coDebtor.dpi,
			age: coDebtor.age?.toString() || "",
			maritalStatus: (coDebtor.maritalStatus ||
				"") as CoDebtorFormData["maritalStatus"],
			profession: coDebtor.profession || "",
			nationality: coDebtor.nationality || "",
			email: coDebtor.email || "",
			phone: coDebtor.phone || "",
			occupation: (coDebtor.occupation ||
				"") as CoDebtorFormData["occupation"],
			notes: coDebtor.notes || "",
		});
		setIsEditDialogOpen(true);
	};

	const handleDeleteClick = (coDebtor: CoDebtor) => {
		setSelectedCoDebtor(coDebtor);
		setIsDeleteDialogOpen(true);
	};

	// Form fields JSX
	const renderFormFields = () => (
		<div className="grid gap-4 py-4">
			<div className="grid grid-cols-2 gap-4">
				<div className="space-y-2">
					<Label htmlFor="fullName">
						Nombre completo <span className="text-red-500">*</span>
					</Label>
					<Input
						id="fullName"
						value={formData.fullName}
						onChange={(e) =>
							setFormData((prev) => ({ ...prev, fullName: e.target.value }))
						}
						placeholder="Ej: Juan Carlos Pérez López"
					/>
				</div>

				<div className="space-y-2">
					<Label htmlFor="dpi">
						DPI <span className="text-red-500">*</span>
					</Label>
					<Input
						id="dpi"
						value={formData.dpi}
						onChange={(e) =>
							setFormData((prev) => ({ ...prev, dpi: e.target.value }))
						}
						placeholder="Ej: 1234567890101"
					/>
				</div>
			</div>

			<div className="grid grid-cols-3 gap-4">
				<div className="space-y-2">
					<Label htmlFor="age">Edad</Label>
					<Input
						id="age"
						type="number"
						value={formData.age}
						onChange={(e) =>
							setFormData((prev) => ({ ...prev, age: e.target.value }))
						}
						placeholder="Ej: 35"
					/>
				</div>

				<div className="space-y-2">
					<Label htmlFor="maritalStatus">Estado civil</Label>
					<Select
						value={formData.maritalStatus}
						onValueChange={(value) =>
							setFormData((prev) => ({
								...prev,
								maritalStatus: value as CoDebtorFormData["maritalStatus"],
							}))
						}
					>
						<SelectTrigger>
							<SelectValue placeholder="Seleccionar" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="single">Soltero/a</SelectItem>
							<SelectItem value="married">Casado/a</SelectItem>
							<SelectItem value="divorced">Divorciado/a</SelectItem>
							<SelectItem value="widowed">Viudo/a</SelectItem>
						</SelectContent>
					</Select>
				</div>

				<div className="space-y-2">
					<Label htmlFor="nationality">Nacionalidad</Label>
					<Input
						id="nationality"
						value={formData.nationality}
						onChange={(e) =>
							setFormData((prev) => ({ ...prev, nationality: e.target.value }))
						}
						placeholder="Ej: Guatemalteca"
					/>
				</div>
			</div>

			<div className="grid grid-cols-2 gap-4">
				<div className="space-y-2">
					<Label htmlFor="profession">Profesión</Label>
					<Input
						id="profession"
						value={formData.profession}
						onChange={(e) =>
							setFormData((prev) => ({ ...prev, profession: e.target.value }))
						}
						placeholder="Ej: Ingeniero, Contador, etc."
					/>
				</div>

				<div className="space-y-2">
					<Label htmlFor="occupation">Ocupación</Label>
					<Select
						value={formData.occupation}
						onValueChange={(value) =>
							setFormData((prev) => ({
								...prev,
								occupation: value as CoDebtorFormData["occupation"],
							}))
						}
					>
						<SelectTrigger>
							<SelectValue placeholder="Seleccionar" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="owner">Propietario</SelectItem>
							<SelectItem value="employee">Empleado</SelectItem>
						</SelectContent>
					</Select>
				</div>
			</div>

			<div className="grid grid-cols-2 gap-4">
				<div className="space-y-2">
					<Label htmlFor="email">Correo electrónico</Label>
					<Input
						id="email"
						type="email"
						value={formData.email}
						onChange={(e) =>
							setFormData((prev) => ({ ...prev, email: e.target.value }))
						}
						placeholder="Ej: correo@ejemplo.com"
					/>
				</div>

				<div className="space-y-2">
					<Label htmlFor="phone">Teléfono</Label>
					<Input
						id="phone"
						value={formData.phone}
						onChange={(e) =>
							setFormData((prev) => ({ ...prev, phone: e.target.value }))
						}
						placeholder="Ej: 5555-5555"
					/>
				</div>
			</div>

			<div className="space-y-2">
				<Label htmlFor="notes">Notas</Label>
				<Textarea
					id="notes"
					value={formData.notes}
					onChange={(e) =>
						setFormData((prev) => ({ ...prev, notes: e.target.value }))
					}
					placeholder="Notas adicionales sobre el co-firmante..."
					rows={3}
				/>
			</div>
		</div>
	);

	return (
		<div className="space-y-6">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div>
					<h3 className="font-semibold text-lg">Co-firmantes</h3>
					<p className="text-muted-foreground text-sm">
						Gestiona los co-deudores y su capacidad de pago
					</p>
				</div>
				<Button onClick={handleOpenAdd}>
					<Plus className="mr-2 h-4 w-4" />
					Agregar Co-firmante
				</Button>
			</div>

			{/* Lista de co-deudores como tarjetas */}
			{isLoading ? (
				<div className="flex items-center justify-center py-8">
					<div className="text-muted-foreground">Cargando co-firmantes...</div>
				</div>
			) : coDebtors.length === 0 ? (
				<Card>
					<CardContent className="flex flex-col items-center justify-center py-12">
						<User className="mb-4 h-12 w-12 text-muted-foreground" />
						<h4 className="mb-2 font-medium text-lg">
							No hay co-firmantes registrados
						</h4>
						<p className="mb-4 text-center text-muted-foreground text-sm">
							Agrega co-firmantes para esta oportunidad de crédito
						</p>
						<Button onClick={handleOpenAdd}>
							<Plus className="mr-2 h-4 w-4" />
							Agregar primer co-firmante
						</Button>
					</CardContent>
				</Card>
			) : (
				<div className="grid gap-4">
					{coDebtors.map((coDebtor) => (
						<CoDebtorCard
							key={coDebtor.id}
							coDebtor={coDebtor}
							onEdit={() => handleEdit(coDebtor)}
							onDelete={() => handleDeleteClick(coDebtor)}
						/>
					))}
				</div>
			)}

			{/* Dialog para agregar */}
			<Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
				<DialogContent className="max-w-2xl">
					<DialogHeader>
						<DialogTitle>Agregar Co-firmante</DialogTitle>
						<DialogDescription>
							Ingresa la información del co-firmante para esta oportunidad
						</DialogDescription>
					</DialogHeader>
					{renderFormFields()}
					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => setIsAddDialogOpen(false)}
						>
							Cancelar
						</Button>
						<Button
							type="button"
							onClick={handleCreate}
							disabled={createMutation.isPending}
						>
							{createMutation.isPending ? (
								"Guardando..."
							) : (
								<>
									<Save className="mr-2 h-4 w-4" />
									Guardar
								</>
							)}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Dialog para editar */}
			<Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
				<DialogContent className="max-w-2xl">
					<DialogHeader>
						<DialogTitle>Editar Co-firmante</DialogTitle>
						<DialogDescription>
							Modifica la información del co-firmante
						</DialogDescription>
					</DialogHeader>
					{renderFormFields()}
					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => setIsEditDialogOpen(false)}
						>
							Cancelar
						</Button>
						<Button
							type="button"
							onClick={handleUpdate}
							disabled={updateMutation.isPending}
						>
							{updateMutation.isPending ? (
								"Guardando..."
							) : (
								<>
									<Save className="mr-2 h-4 w-4" />
									Actualizar
								</>
							)}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Dialog para confirmar eliminación */}
			<Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Eliminar Co-firmante</DialogTitle>
						<DialogDescription>
							¿Estás seguro de que deseas eliminar a{" "}
							<span className="font-medium">{selectedCoDebtor?.fullName}</span>?
							Esta acción no se puede deshacer.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							variant="outline"
							onClick={() => setIsDeleteDialogOpen(false)}
						>
							Cancelar
						</Button>
						<Button
							variant="destructive"
							onClick={() =>
								selectedCoDebtor && deleteMutation.mutate(selectedCoDebtor.id)
							}
							disabled={deleteMutation.isPending}
						>
							{deleteMutation.isPending ? "Eliminando..." : "Eliminar"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
