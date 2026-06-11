import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Calculator, Check, Download, Save } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { client, orpc } from "@/utils/orpc";

interface Scenario {
	id: string;
	amount: string;
	monthlyRate: string;
	termMonths: number;
	modality: string;
	isSmallTaxpayer: boolean;
	totalInterest: string | null;
	totalToReceive: string | null;
	amortizationTable: unknown;
	isAccepted: boolean;
	createdAt: Date;
}

interface InvestmentCalculatorProps {
	opportunityId: string;
	scenarios?: Scenario[];
	onScenarioSaved?: () => void;
}

function formatCurrency(value: number | string): string {
	const num = typeof value === "string" ? Number.parseFloat(value) : value;
	if (isNaN(num)) return "Q0.00";
	return `Q${num.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatModality(modality: string): string {
	switch (modality) {
		case "traditional":
			return "Tradicional";
		case "maturity":
			return "Al Vencimiento";
		case "compound":
			return "Interés Compuesto";
		default:
			return modality;
	}
}

function formatDate(date: Date): string {
	return new Date(date).toLocaleDateString("es-GT", {
		day: "2-digit",
		month: "2-digit",
		year: "numeric",
	});
}

export function InvestmentCalculator({
	opportunityId,
	scenarios = [],
	onScenarioSaved,
}: InvestmentCalculatorProps) {
	const queryClient = useQueryClient();

	const [mode, setMode] = useState<"rendimiento" | "objetivo">("rendimiento");
	const [amount, setAmount] = useState("");
	const [monthlyRate, setMonthlyRate] = useState("1.5");
	const [termMonths, setTermMonths] = useState("");
	const [modality, setModality] = useState<
		"traditional" | "maturity" | "compound"
	>("traditional");
	const [isSmallTaxpayer, setIsSmallTaxpayer] = useState(false);
	const [desiredMonthlyAmount, setDesiredMonthlyAmount] = useState("");
	const [calculationResult, setCalculationResult] = useState<Awaited<
		ReturnType<typeof client.calculateInvestmentScenario>
	> | null>(null);

	const calculateMutation = useMutation({
		mutationFn: (
			input: Parameters<typeof client.calculateInvestmentScenario>[0],
		) => client.calculateInvestmentScenario(input),
		onSuccess: (data) => setCalculationResult(data),
		onError: (error: Error) => toast.error(error.message),
	});

	const calculateGoalMutation = useMutation({
		mutationFn: (input: Parameters<typeof client.calculateInvestmentGoal>[0]) =>
			client.calculateInvestmentGoal(input),
		onSuccess: (
			data: Awaited<ReturnType<typeof client.calculateInvestmentGoal>>,
		) => {
			setCalculationResult(data.scenario);
			setAmount(data.requiredCapital.toString());
		},
		onError: (error: Error) => toast.error(error.message),
	});

	const saveScenarioMutation = useMutation({
		mutationFn: (
			input: Parameters<typeof client.createInvestmentScenario>[0],
		) => client.createInvestmentScenario(input),
		onSuccess: () => {
			toast.success("Escenario guardado");
			queryClient.invalidateQueries({
				queryKey: orpc.getInvestmentOpportunityById.queryOptions({
					input: { id: opportunityId },
				}).queryKey,
			});
			onScenarioSaved?.();
		},
		onError: (error: Error) => toast.error(error.message),
	});

	const acceptScenarioMutation = useMutation({
		mutationFn: (
			input: Parameters<typeof client.acceptInvestmentScenario>[0],
		) => client.acceptInvestmentScenario(input),
		onSuccess: () => {
			toast.success("Escenario aceptado");
			queryClient.invalidateQueries({
				queryKey: orpc.getInvestmentOpportunityById.queryOptions({
					input: { id: opportunityId },
				}).queryKey,
			});
		},
		onError: (error: Error) => toast.error(error.message),
	});

	const isCalculating =
		calculateMutation.isPending || calculateGoalMutation.isPending;

	function handleCalculate() {
		if (mode === "rendimiento") {
			if (!amount || !termMonths) {
				toast.error("Por favor completa todos los campos requeridos");
				return;
			}
			calculateMutation.mutate({
				amount: Number.parseFloat(amount),
				monthlyRate: Number.parseFloat(monthlyRate),
				termMonths: Number.parseInt(termMonths, 10),
				modality,
				isSmallTaxpayer,
			});
		} else {
			if (!desiredMonthlyAmount || !termMonths) {
				toast.error("Por favor completa todos los campos requeridos");
				return;
			}
			calculateGoalMutation.mutate({
				desiredMonthlyAmount: Number.parseFloat(desiredMonthlyAmount),
				monthlyRate: Number.parseFloat(monthlyRate),
				termMonths: Number.parseInt(termMonths, 10),
				isSmallTaxpayer,
			});
		}
	}

	function handleSaveScenario() {
		if (!calculationResult) return;
		saveScenarioMutation.mutate({
			investmentOpportunityId: opportunityId,
			amount: Number.parseFloat(amount),
			monthlyRate: Number.parseFloat(monthlyRate),
			termMonths: Number.parseInt(termMonths, 10),
			modality: mode === "objetivo" ? "compound" : modality,
			isSmallTaxpayer,
		});
	}

	function handleAcceptScenario(scenarioId: string) {
		acceptScenarioMutation.mutate({ scenarioId, opportunityId });
	}

	const amortizationRows = calculationResult?.amortizationTable ?? [];

	return (
		<div className="space-y-6">
			{/* Selector de modo */}
			<div className="flex gap-2 rounded-lg border bg-muted/30 p-1">
				<Button
					variant={mode === "rendimiento" ? "default" : "ghost"}
					size="sm"
					className="flex-1"
					onClick={() => {
						setMode("rendimiento");
						setCalculationResult(null);
					}}
				>
					<Calculator className="mr-2 h-4 w-4" />
					Calcular Rendimiento
				</Button>
				<Button
					variant={mode === "objetivo" ? "default" : "ghost"}
					size="sm"
					className="flex-1"
					onClick={() => {
						setMode("objetivo");
						setCalculationResult(null);
					}}
				>
					<Calculator className="mr-2 h-4 w-4" />
					Calcular Objetivo
				</Button>
			</div>

			{/* Sección de entradas */}
			<Card>
				<CardHeader className="pb-3">
					<CardTitle className="text-base">
						{mode === "rendimiento"
							? "Parámetros de Inversión"
							: "Parámetros de Objetivo"}
					</CardTitle>
				</CardHeader>
				<CardContent className="space-y-4">
					{mode === "rendimiento" ? (
						<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
							<div className="space-y-1.5">
								<Label htmlFor="amount">Monto de inversión (Q)</Label>
								<Input
									id="amount"
									type="number"
									placeholder="Ej. 50000"
									value={amount}
									onChange={(e) => setAmount(e.target.value)}
									min="0"
									step="0.01"
								/>
							</div>
							<div className="space-y-1.5">
								<Label htmlFor="monthlyRate">Tasa mensual (%)</Label>
								<Input
									id="monthlyRate"
									type="number"
									placeholder="1.5"
									value={monthlyRate}
									onChange={(e) => setMonthlyRate(e.target.value)}
									min="0"
									step="0.01"
								/>
							</div>
							<div className="space-y-1.5">
								<Label htmlFor="termMonths">Plazo (meses)</Label>
								<Input
									id="termMonths"
									type="number"
									placeholder="Ej. 12"
									value={termMonths}
									onChange={(e) => setTermMonths(e.target.value)}
									min="1"
									step="1"
								/>
							</div>
							<div className="flex items-end pb-0.5">
								<div className="flex items-center gap-2">
									<Checkbox
										id="isSmallTaxpayer"
										checked={isSmallTaxpayer}
										onCheckedChange={(checked) =>
											setIsSmallTaxpayer(checked === true)
										}
									/>
									<Label
										htmlFor="isSmallTaxpayer"
										className="cursor-pointer font-normal"
									>
										Pequeño contribuyente
									</Label>
								</div>
							</div>
						</div>
					) : (
						<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
							<div className="space-y-1.5">
								<Label htmlFor="desiredMonthlyAmount">
									Rendimiento mensual deseado (Q)
								</Label>
								<Input
									id="desiredMonthlyAmount"
									type="number"
									placeholder="Ej. 2000"
									value={desiredMonthlyAmount}
									onChange={(e) => setDesiredMonthlyAmount(e.target.value)}
									min="0"
									step="0.01"
								/>
							</div>
							<div className="space-y-1.5">
								<Label htmlFor="termMonthsGoal">Plazo (meses)</Label>
								<Input
									id="termMonthsGoal"
									type="number"
									placeholder="Ej. 12"
									value={termMonths}
									onChange={(e) => setTermMonths(e.target.value)}
									min="1"
									step="1"
								/>
							</div>
							<div className="space-y-1.5">
								<Label htmlFor="monthlyRateGoal">Tasa mensual (%)</Label>
								<Input
									id="monthlyRateGoal"
									type="number"
									placeholder="1.5"
									value={monthlyRate}
									onChange={(e) => setMonthlyRate(e.target.value)}
									min="0"
									step="0.01"
								/>
							</div>
							<div className="flex items-end pb-0.5">
								<div className="flex items-center gap-2">
									<Checkbox
										id="isSmallTaxpayerGoal"
										checked={isSmallTaxpayer}
										onCheckedChange={(checked) =>
											setIsSmallTaxpayer(checked === true)
										}
									/>
									<Label
										htmlFor="isSmallTaxpayerGoal"
										className="cursor-pointer font-normal"
									>
										Pequeño contribuyente
									</Label>
								</div>
							</div>
						</div>
					)}

					{/* Tabs de modalidad (solo en modo rendimiento) */}
					{mode === "rendimiento" && (
						<div className="pt-2">
							<Label className="mb-2 block text-sm">Modalidad</Label>
							<Tabs
								value={modality}
								onValueChange={(v) =>
									setModality(v as "traditional" | "maturity" | "compound")
								}
							>
								<TabsList className="grid w-full grid-cols-3">
									<TabsTrigger value="traditional">Tradicional</TabsTrigger>
									<TabsTrigger value="maturity">Al Vencimiento</TabsTrigger>
									<TabsTrigger value="compound">Interés Compuesto</TabsTrigger>
								</TabsList>
								<TabsContent value="traditional" className="mt-2">
									<p className="text-muted-foreground text-xs">
										Pagos de interés mensuales con amortización al final del
										plazo.
									</p>
								</TabsContent>
								<TabsContent value="maturity" className="mt-2">
									<p className="text-muted-foreground text-xs">
										Capital e intereses se pagan íntegramente al vencimiento del
										plazo.
									</p>
								</TabsContent>
								<TabsContent value="compound" className="mt-2">
									<p className="text-muted-foreground text-xs">
										Los intereses se reinvierten cada mes, generando
										rendimientos sobre rendimientos.
									</p>
								</TabsContent>
							</Tabs>
						</div>
					)}

					{mode === "objetivo" && (
						<p className="text-muted-foreground text-xs">
							El modo objetivo calcula el capital necesario usando interés
							compuesto.
						</p>
					)}

					<Button
						onClick={handleCalculate}
						disabled={isCalculating}
						className="w-full"
					>
						<Calculator className="mr-2 h-4 w-4" />
						{isCalculating ? "Calculando..." : "Calcular"}
					</Button>
				</CardContent>
			</Card>

			{/* Resultados */}
			{calculationResult && (
				<>
					{/* Tarjetas de resumen */}
					<div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
						<Card className="border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/30">
							<CardContent className="pt-4">
								<p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
									Monto
								</p>
								<p className="mt-1 font-bold text-blue-700 text-xl dark:text-blue-300">
									{formatCurrency(calculationResult.amount ?? amount)}
								</p>
							</CardContent>
						</Card>
						<Card className="border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30">
							<CardContent className="pt-4">
								<p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
									Interés Total
								</p>
								<p className="mt-1 font-bold text-amber-700 text-xl dark:text-amber-300">
									{formatCurrency(calculationResult.totalInterest ?? 0)}
								</p>
							</CardContent>
						</Card>
						<Card className="border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/30">
							<CardContent className="pt-4">
								<p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
									Total a Recibir
								</p>
								<p className="mt-1 font-bold text-green-700 text-xl dark:text-green-300">
									{formatCurrency(calculationResult.totalToReceive ?? 0)}
								</p>
							</CardContent>
						</Card>
					</div>

					{/* Tabla de amortización */}
					{amortizationRows.length > 0 && (
						<Card>
							<CardHeader className="pb-3">
								<CardTitle className="text-base">
									Tabla de Amortización
								</CardTitle>
							</CardHeader>
							<CardContent className="p-0">
								<div className="max-h-72 overflow-y-auto">
									<Table>
										<TableHeader className="sticky top-0 z-10 bg-background">
											<TableRow>
												<TableHead className="w-16 text-center">Mes</TableHead>
												<TableHead className="text-right">
													Saldo Inicial
												</TableHead>
												<TableHead className="text-right">
													Interés + IVA
												</TableHead>
												<TableHead className="text-right">
													Amortización
												</TableHead>
												<TableHead className="text-right">
													Total a Recibir
												</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{amortizationRows.map((row) => (
												<TableRow key={row.month}>
													<TableCell className="text-center font-medium">
														{row.month}
													</TableCell>
													<TableCell className="text-right">
														{formatCurrency(row.initialBalance)}
													</TableCell>
													<TableCell className="text-right">
														{formatCurrency(row.interestPlusVat)}
													</TableCell>
													<TableCell className="text-right">
														{formatCurrency(row.amortization)}
													</TableCell>
													<TableCell className="text-right font-semibold">
														{formatCurrency(row.totalToReceive)}
													</TableCell>
												</TableRow>
											))}
										</TableBody>
									</Table>
								</div>
							</CardContent>
						</Card>
					)}

					{/* Botones de acción */}
					<div className="flex gap-3">
						<Button
							onClick={handleSaveScenario}
							disabled={saveScenarioMutation.isPending}
							className="flex-1"
						>
							<Save className="mr-2 h-4 w-4" />
							{saveScenarioMutation.isPending
								? "Guardando..."
								: "Guardar Escenario"}
						</Button>
						<Button
							variant="outline"
							disabled
							className="flex-1 cursor-not-allowed opacity-60"
							title="Próximamente disponible"
						>
							<Download className="mr-2 h-4 w-4" />
							Descargar PDF
						</Button>
					</div>
				</>
			)}

			{/* Escenarios guardados */}
			{scenarios.length > 0 && (
				<Card>
					<CardHeader className="pb-3">
						<CardTitle className="text-base">Escenarios Guardados</CardTitle>
					</CardHeader>
					<CardContent className="space-y-3">
						{scenarios.map((scenario) => (
							<div
								key={scenario.id}
								className={`rounded-lg border p-4 transition-colors ${
									scenario.isAccepted
										? "border-green-300 bg-green-50 dark:border-green-800 dark:bg-green-950/30"
										: "border-border bg-muted/20 hover:bg-muted/40"
								}`}
							>
								<div className="flex items-start justify-between gap-3">
									<div className="min-w-0 flex-1 space-y-1">
										<div className="flex flex-wrap items-center gap-2">
											<span className="font-semibold text-sm">
												{formatCurrency(scenario.amount)}
											</span>
											<Badge variant="secondary" className="text-xs">
												{formatModality(scenario.modality)}
											</Badge>
											{scenario.isAccepted && (
												<Badge
													variant="default"
													className="bg-green-600 text-white text-xs"
												>
													<Check className="mr-1 h-3 w-3" />
													Aceptado
												</Badge>
											)}
											{scenario.isSmallTaxpayer && (
												<Badge variant="outline" className="text-xs">
													Pequeño contribuyente
												</Badge>
											)}
										</div>
										<div className="grid grid-cols-2 gap-x-6 gap-y-0.5 text-muted-foreground text-xs sm:grid-cols-4">
											<span>
												Tasa:{" "}
												<span className="font-medium text-foreground">
													{scenario.monthlyRate}%
												</span>
											</span>
											<span>
												Plazo:{" "}
												<span className="font-medium text-foreground">
													{scenario.termMonths} meses
												</span>
											</span>
											{scenario.totalInterest && (
												<span>
													Interés:{" "}
													<span className="font-medium text-foreground">
														{formatCurrency(scenario.totalInterest)}
													</span>
												</span>
											)}
											{scenario.totalToReceive && (
												<span>
													Total:{" "}
													<span className="font-medium text-foreground">
														{formatCurrency(scenario.totalToReceive)}
													</span>
												</span>
											)}
										</div>
										<p className="text-muted-foreground text-xs">
											Creado el {formatDate(scenario.createdAt)}
										</p>
									</div>
									{!scenario.isAccepted && (
										<Button
											size="sm"
											variant="outline"
											onClick={() => handleAcceptScenario(scenario.id)}
											disabled={acceptScenarioMutation.isPending}
											className="shrink-0 border-green-400 text-green-700 hover:bg-green-50 hover:text-green-800 dark:border-green-700 dark:text-green-400 dark:hover:bg-green-950/50"
										>
											<Check className="mr-1 h-3 w-3" />
											Aceptar
										</Button>
									)}
								</div>
							</div>
						))}
					</CardContent>
				</Card>
			)}
		</div>
	);
}
