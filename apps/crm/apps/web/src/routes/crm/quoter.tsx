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
	Trash2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
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
import { generateQuotationPdf } from "@/lib/generate-pdf";
import { client, orpc } from "@/utils/orpc";

export const Route = createFileRoute("/crm/quoter")({
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

// Función para calcular cuota mensual (según Excel)
function calculateMonthlyPayment(
	principal: number,
	monthlyRate: number,
	termMonths: number,
	insuranceCost: number,
	gpsCost: number,
): number {
	// La tasa incluye IVA (12%)
	const r = (monthlyRate / 100) * 1.12;

	if (r === 0) return principal / termMonths;

	const factor = (1 + r) ** termMonths;
	const baseMonthlyPayment = (principal * (r * factor)) / (factor - 1);

	// Agregar seguro y GPS a la cuota mensual
	return Math.round((baseMonthlyPayment + insuranceCost + gpsCost) * 100) / 100;
}

// Interfaz para las filas de la tabla de amortización
interface AmortizationRow {
	period: number;
	initialBalance: number;
	interestPlusVAT: number;
	principal: number;
	finalBalance: number;
}

// Función para generar tabla de amortización (según Excel)
function generateAmortizationTable(
	totalFinanced: number,
	monthlyRate: number,
	termMonths: number,
	insuranceCost: number,
	gpsCost: number,
): AmortizationRow[] {
	const table: AmortizationRow[] = [];
	let balance = totalFinanced;
	const r = monthlyRate / 100;
	const VAT = 0.12; // 12% IVA

	// Calcular la cuota base (sin seguro ni GPS)
	const rWithVAT = r * (1 + VAT);
	const factor = (1 + rWithVAT) ** termMonths;
	const baseMonthlyPayment =
		(totalFinanced * (rWithVAT * factor)) / (factor - 1);

	// Período 0 (inicial)
	const initialInterest = balance * r;
	const initialInterestWithVAT = initialInterest * (1 + VAT);

	table.push({
		period: 0,
		initialBalance: Math.round(balance * 100) / 100,
		interestPlusVAT: Math.round(initialInterestWithVAT * 100) / 100,
		principal: 0,
		finalBalance: Math.round(balance * 100) / 100,
	});

	// Períodos 1 a termMonths
	for (let i = 1; i <= termMonths; i++) {
		const interest = balance * r;
		const interestWithVAT = interest * (1 + VAT);
		const principalPayment = baseMonthlyPayment - interestWithVAT;
		const newBalance = balance - principalPayment;

		table.push({
			period: i,
			initialBalance: Math.round(balance * 100) / 100,
			interestPlusVAT: Math.round(interestWithVAT * 100) / 100,
			principal: Math.round(principalPayment * 100) / 100,
			finalBalance: Math.round((newBalance > 0 ? newBalance : 0) * 100) / 100,
		});

		balance = newBalance;
	}

	return table;
}

function QuoterPage() {
	const { data: session } = authClient.useSession();
	const userProfile = useQuery(orpc.getUserProfile.queryOptions());
	const queryClient = useQueryClient();
	const navigate = Route.useNavigate();

	const [selectedQuotationId, setSelectedQuotationId] = useState<string | null>(
		null,
	);
	const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);

	// Verificar que sea usuario de ventas
	if (userProfile.data && !["admin", "sales"].includes(userProfile.data.role)) {
		navigate({ to: "/dashboard" });
	}

	// Queries - solo ejecutar si hay sesión
	const quotationsQuery = useQuery({
		...orpc.getQuotations.queryOptions(),
		enabled: !!session,
	});
	const vehiclesQuery = useQuery({
		...orpc.getVehicles.queryOptions(),
		enabled: !!session,
	});

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
		mutationFn: async (values: Parameters<typeof client.createQuotation>[0]) => {
			return await client.createQuotation(values);
		},
		onSuccess: () => {
			toast.success("Cotización creada exitosamente");
			queryClient.invalidateQueries(orpc.getQuotations.queryOptions());
			quoterForm.reset();
			setCalculatedValues({
				amountToFinance: 0,
				totalFinanced: 0,
				monthlyPayment: 0,
			});
		},
		onError: (error: unknown) => {
			const message = error instanceof Error ? error.message : "Error al crear cotización";
		toast.error(message);
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
		onError: (error: unknown) => {
			const message = error instanceof Error ? error.message : "Error al eliminar cotización";
		toast.error(message);
		},
	});

	// Form
	const quoterForm = useForm({
		defaultValues: {
			vehicleId: "",
			vehicleBrand: "",
			vehicleLine: "",
			vehicleModel: "",
			vehicleType: "particular" as const,
			vehicleValue: 0,
			insuredAmount: 0,
			downPayment: 0,
			termMonths: 60,
			interestRate: 1.5,
			insuranceCost: 0,
			gpsCost: 148.2,
			transferCost: 1950,
			adminCost: 0,
			membershipCost: 0,
		},
		onSubmit: async ({ value }) => {
			createQuotationMutation.mutate({
				vehicleId: value.vehicleId || undefined,
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
			});
		},
	});

	// Obtener costo de seguro automáticamente
	const updateInsuranceCost = async (
		insuredAmount: number,
		vehicleType: string,
	) => {
		if (insuredAmount <= 0) return;

		try {
			const result = await client.getInsuranceCost({
				insuredAmount,
				vehicleType: vehicleType as "particular" | "comercial",
			});

			quoterForm.setFieldValue(
				"insuranceCost",
				Math.round(result.insuranceCost * 100) / 100,
			);
			quoterForm.setFieldValue(
				"membershipCost",
				Math.round(result.membershipCost * 100) / 100,
			);

			// Recalcular después de actualizar
			setTimeout(() => recalculate(), 100);
		} catch (error) {
			console.error("Error al obtener costo de seguro:", error);
		}
	};

	// Función para recalcular cuando cambian los valores (según Excel)
	const recalculate = () => {
		const values = quoterForm.state.values;
		const downPayment = Number(values.downPayment);
		const vehicleValue = Number(values.vehicleValue);
		const amountToFinance = vehicleValue - downPayment;
		const insuranceCost = Number(values.insuranceCost);
		const gpsCost = Number(values.gpsCost);
		const transferCost = Number(values.transferCost);
		const membershipCost = Number(values.membershipCost);

		// Calcular Gastos Administrativos según Excel
		// B22 = Monto a financiar + Traspaso + 1400 + GPS + Seguro
		const b22 = amountToFinance + transferCost + 1400 + gpsCost + insuranceCost;

		// Gastos Admin = 400 + ROUNDUP(B22*4%,0) + 400 + 600 + ROUNDUP(B22*1.78%,0) + GPS + Seguro
		const royalty = Math.ceil(b22 * 0.04); // 4% redondeado hacia arriba
		const extraCost = Math.ceil(b22 * 0.0178) + gpsCost + insuranceCost; // 1.78% + GPS + Seguro
		const adminCost = 400 + royalty + 400 + 600 + extraCost;

		// Actualizar el campo de gastos administrativos
		quoterForm.setFieldValue("adminCost", Math.round(adminCost * 100) / 100);

		// Costos que se financian (NO incluyen seguro ni GPS)
		// La membresía ya está incluida en adminCost, no se debe agregar de nuevo
		const financedCosts = transferCost + adminCost;

		const totalFinanced = amountToFinance + financedCosts;

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
				insuranceCost,
				gpsCost,
			);
			setAmortizationTable(table);
		} else {
			setAmortizationTable([]);
		}
	};

	// Cuando se selecciona un vehículo, auto-llenar datos
	const handleVehicleSelect = (vehicleId: string) => {
		const vehicle = vehiclesQuery.data?.find((v) => v.id === vehicleId);
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

				// Auto-llenar monto asegurado (igual al valor)
				quoterForm.setFieldValue("insuredAmount", numericValue);

				// Auto-calcular enganche al 20%
				const downPayment = Math.round(numericValue * 0.2);
				quoterForm.setFieldValue("downPayment", downPayment);

				// Actualizar seguro y membresía
				updateInsuranceCost(numericValue, quoterForm.state.values.vehicleType);
			}
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
		const quotationData = {
			vehicleBrand: values.vehicleBrand,
			vehicleLine: values.vehicleLine,
			vehicleModel: values.vehicleModel,
			vehicleValue: values.vehicleValue,
			downPayment: values.downPayment,
			totalFinanced: calculatedValues.totalFinanced,
			monthlyPayment: calculatedValues.monthlyPayment,
			termMonths: values.termMonths,
			interestRate: values.interestRate,
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
					Cotizador de Autocompra
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
						<div className="grid gap-6 md:grid-cols-3">
							{/* Columna 1: Datos del Vehículo */}
							<Card>
								<CardHeader>
									<CardTitle>Datos del Vehículo</CardTitle>
								</CardHeader>
								<CardContent className="space-y-4">
									<div className="space-y-2">
										<Label>Seleccionar Vehículo (Opcional)</Label>
										<Select onValueChange={handleVehicleSelect}>
											<SelectTrigger>
												<SelectValue placeholder="Seleccionar vehículo..." />
											</SelectTrigger>
											<SelectContent>
												{vehiclesQuery.data?.map((vehicle) => (
													<SelectItem key={vehicle.id} value={vehicle.id}>
														{vehicle.make} {vehicle.model} {vehicle.year}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
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
														field.handleChange(value);

														// Actualizar seguro cuando cambia el tipo
														const insuredAmount =
															quoterForm.state.values.insuredAmount;
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

														if (value > 0) {
															// Auto-llenar monto asegurado (igual al valor)
															quoterForm.setFieldValue("insuredAmount", value);

															// Auto-calcular enganche al 20%
															const downPayment = Math.round(value * 0.2);
															quoterForm.setFieldValue(
																"downPayment",
																downPayment,
															);

															// Actualizar seguro y membresía
															updateInsuranceCost(
																value,
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
										{(field) => (
											<div>
												<div className="mb-2 flex items-center justify-between">
													<Label htmlFor={field.name}>Enganche</Label>
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
												</div>
												<Input
													id={field.name}
													type="number"
													value={field.state.value || ""}
													onChange={(e) => {
														field.handleChange(Number(e.target.value) || 0);
														recalculate();
													}}
													placeholder="20000"
												/>
											</div>
										)}
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

									<quoterForm.Field name="membershipCost">
										{(field) => (
											<div>
												<Label htmlFor={field.name} className="mb-2">
													Membresía
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
													placeholder="251.53"
												/>
											</div>
										)}
									</quoterForm.Field>
								</CardContent>
							</Card>
						</div>

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
												{amortizationTable.map((row) => (
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
			totalFinanced: Number(quotation.totalFinanced),
			monthlyPayment: Number(quotation.monthlyPayment),
			termMonths: quotation.termMonths,
			interestRate: Number(quotation.interestRate),
			amortizationTable: quotation.amortizationTable.map((row) => ({
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
									{quotation.amortizationTable?.map((row) => (
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
