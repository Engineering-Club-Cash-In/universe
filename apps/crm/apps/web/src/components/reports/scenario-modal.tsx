/**
 * Modal de simulación "qué pasaría si" para los reportes.
 *
 * Recibe los datos reales del reporte y su config, aplica los supuestos en el
 * cliente y muestra el resultado simulado vs real. No modifica datos reales.
 */

import { AlertTriangle, Info, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import {
	Bar,
	BarChart,
	CartesianGrid,
	Legend,
	Tooltip as RechartsTooltip,
	ResponsiveContainer,
	XAxis,
	YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
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
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import {
	cuotaIlustrativa,
	DEFAULT_SCENARIO_PARAMS,
	type LeverKey,
	type ScenarioParams,
} from "@/lib/reports/scenario";
import type {
	ScenarioReportConfig,
	SummaryRow,
} from "@/lib/reports/scenario-configs";

function formatQ(value: number): string {
	return `Q${value.toLocaleString("es-GT", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	})}`;
}

function deltaPct(real: number, escenario: number): string {
	if (real === 0) return escenario === 0 ? "0%" : "—";
	const pct = ((escenario - real) / Math.abs(real)) * 100;
	const sign = pct > 0 ? "+" : "";
	return `${sign}${pct.toFixed(1)}%`;
}

function deltaColor(real: number, escenario: number): string {
	if (escenario > real) return "text-green-600";
	if (escenario < real) return "text-red-600";
	return "text-muted-foreground";
}

const LEVER_LABELS: Record<
	Exclude<LeverKey, "metodo">,
	{ label: string; hint: string; max: number }
> = {
	colocacion: {
		label: "Colocar más (%)",
		hint: "Aumenta el capital colocado",
		max: 100,
	},
	mora: { label: "Bajar mora (%)", hint: "Reduce la mora", max: 100 },
	efectividad: {
		label: "Subir efectividad (%)",
		hint: "Cierra la brecha contra lo esperado",
		max: 100,
	},
};

const LEVER_FIELD: Record<Exclude<LeverKey, "metodo">, keyof ScenarioParams> = {
	colocacion: "colocacionDeltaPct",
	mora: "moraReduccionPct",
	efectividad: "efectividadDeltaPct",
};

function LeverSlider({
	lever,
	value,
	onChange,
	hintOverride,
}: {
	lever: Exclude<LeverKey, "metodo">;
	value: number;
	onChange: (v: number) => void;
	hintOverride?: string;
}) {
	const cfg = LEVER_LABELS[lever];
	const hint = hintOverride ?? cfg.hint;
	return (
		<div className="space-y-1.5">
			<div className="flex items-center gap-1.5">
				<Label className="text-sm">{cfg.label}</Label>
				<TooltipProvider>
					<Tooltip>
						<TooltipTrigger
							aria-label={hint}
							className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						>
							<Info className="h-3.5 w-3.5 text-muted-foreground" />
						</TooltipTrigger>
						<TooltipContent className="max-w-56 text-xs">{hint}</TooltipContent>
					</Tooltip>
				</TooltipProvider>
			</div>
			<div className="flex items-center gap-3">
				<input
					type="range"
					min={0}
					max={cfg.max}
					step={1}
					value={value}
					onChange={(e) => onChange(Number(e.target.value))}
					className="h-2 flex-1 cursor-pointer accent-purple-500"
				/>
				<div className="relative w-20 shrink-0">
					<Input
						type="number"
						min={0}
						max={cfg.max}
						value={value}
						onChange={(e) => onChange(Number(e.target.value) || 0)}
						className="h-9 pr-6 text-right"
					/>
					<span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-muted-foreground text-sm">
						%
					</span>
				</div>
			</div>
		</div>
	);
}

interface ScenarioModalProps<T> {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	config: ScenarioReportConfig<T>;
	baseData: T | undefined;
}

export function ScenarioModal<T>({
	open,
	onOpenChange,
	config,
	baseData,
}: ScenarioModalProps<T>) {
	const [params, setParams] = useState<ScenarioParams>(DEFAULT_SCENARIO_PARAMS);

	const setField = <K extends keyof ScenarioParams>(
		key: K,
		value: ScenarioParams[K],
	) => setParams((prev) => ({ ...prev, [key]: value }));

	const { realRows, simRows } = useMemo(() => {
		if (!baseData) return { realRows: [], simRows: [] as SummaryRow[] };
		const sim = config.transform(baseData, params);
		return {
			realRows: config.summarize(baseData),
			simRows: config.summarize(sim),
		};
	}, [baseData, config, params]);

	const chartData = useMemo(
		() =>
			realRows.map((row, i) => ({
				concepto: row.concepto,
				Real: row.valor,
				Escenario: simRows[i]?.valor ?? 0,
			})),
		[realRows, simRows],
	);

	const cuota = config.usaMetodoCuota ? cuotaIlustrativa(params) : null;
	const warning = baseData ? (config.getWarning?.(baseData) ?? null) : null;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[900px]">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<Sparkles className="h-4 w-4 text-purple-500" />
						Simular: {config.titulo}
					</DialogTitle>
					<DialogDescription>{config.descripcion}</DialogDescription>
				</DialogHeader>

				{!baseData ? (
					<p className="py-8 text-center text-muted-foreground text-sm">
						Carga primero el reporte para poder simular.
					</p>
				) : (
					<div className="grid gap-6 md:grid-cols-[280px_1fr]">
						{warning && (
							<div className="col-span-full flex items-start gap-3 rounded-md border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800">
								<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
								<span>{warning}</span>
							</div>
						)}
						{/* Supuestos */}
						<div className="space-y-4">
							<h4 className="font-semibold text-sm">Supuestos</h4>
							{config.levers
								.filter((l): l is Exclude<LeverKey, "metodo"> => l !== "metodo")
								.map((lever) => (
									<LeverSlider
										key={lever}
										lever={lever}
										value={params[LEVER_FIELD[lever]] as number}
										onChange={(v) => setField(LEVER_FIELD[lever], v)}
										hintOverride={config.leverDescriptions?.[lever]}
									/>
								))}

							{config.usaMetodoCuota && (
								<div className="space-y-2 border-t pt-3">
									<Label className="text-sm">Cuota mensual por método</Label>
									<p className="text-muted-foreground text-xs">
										Compara la cuota de un crédito promedio según el método de
										amortización.
									</p>
									<div className="grid grid-cols-3 gap-2">
										<div>
											<Label className="text-muted-foreground text-xs">
												Capital
											</Label>
											<Input
												type="number"
												value={params.metodoCapital}
												onChange={(e) =>
													setField("metodoCapital", Number(e.target.value) || 0)
												}
												className="h-9"
											/>
										</div>
										<div>
											<Label className="text-muted-foreground text-xs">
												Plazo
											</Label>
											<Input
												type="number"
												value={params.metodoPlazoMeses}
												onChange={(e) =>
													setField(
														"metodoPlazoMeses",
														Number(e.target.value) || 1,
													)
												}
												className="h-9"
											/>
										</div>
										<div>
											<Label className="text-muted-foreground text-xs">
												Tasa %
											</Label>
											<Input
												type="number"
												step="0.01"
												value={params.metodoTasaMensual}
												onChange={(e) =>
													setField(
														"metodoTasaMensual",
														Number(e.target.value) || 0,
													)
												}
												className="h-9"
											/>
										</div>
									</div>
									{cuota && (
										<div className="rounded-md bg-muted/50 p-2 text-xs">
											<div className="flex justify-between">
												<span>Cuota francés:</span>
												<span className="font-medium">
													{formatQ(cuota.frances)}
												</span>
											</div>
											<div className="flex justify-between">
												<span>Cuota fija (1ª):</span>
												<span className="font-medium">
													{formatQ(cuota.fija)}
												</span>
											</div>
										</div>
									)}
								</div>
							)}

							<Button
								variant="outline"
								size="sm"
								className="w-full"
								onClick={() => setParams(DEFAULT_SCENARIO_PARAMS)}
							>
								Restablecer
							</Button>
						</div>

						{/* Resultado */}
						<div className="space-y-4">
							<ResponsiveContainer width="100%" height={240}>
								<BarChart data={chartData}>
									<CartesianGrid strokeDasharray="3 3" />
									<XAxis dataKey="concepto" tick={{ fontSize: 11 }} />
									<YAxis
										tickFormatter={(v) => `Q${(Number(v) / 1000).toFixed(0)}k`}
										tick={{ fontSize: 11 }}
									/>
									<RechartsTooltip formatter={(v) => formatQ(Number(v))} />
									<Legend />
									<Bar dataKey="Real" fill="#94a3b8" radius={[4, 4, 0, 0]} />
									<Bar
										dataKey="Escenario"
										fill="#a855f7"
										radius={[4, 4, 0, 0]}
									/>
								</BarChart>
							</ResponsiveContainer>

							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Concepto</TableHead>
										<TableHead className="text-right">Real</TableHead>
										<TableHead className="text-right">Escenario</TableHead>
										<TableHead className="text-right">Δ</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{realRows.map((row, i) => {
										const esc = simRows[i]?.valor ?? 0;
										return (
											<TableRow key={row.concepto}>
												<TableCell className="font-medium">
													{row.concepto}
												</TableCell>
												<TableCell className="text-right">
													{formatQ(row.valor)}
												</TableCell>
												<TableCell className="text-right">
													{formatQ(esc)}
												</TableCell>
												<TableCell
													className={`text-right ${deltaColor(row.valor, esc)}`}
												>
													{deltaPct(row.valor, esc)}
												</TableCell>
											</TableRow>
										);
									})}
								</TableBody>
							</Table>

							<p className="text-muted-foreground text-xs">
								Resultados estimados a partir de los datos del reporte. No
								modifican datos reales.
							</p>
						</div>
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
}
