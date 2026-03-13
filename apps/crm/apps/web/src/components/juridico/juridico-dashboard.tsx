import {
	AlertCircle,
	ArrowUpRight,
	CalendarDays,
	CheckCircle2,
	FileText,
	Gavel,
	Scale,
	TrendingUp,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
	CartesianGrid,
	Line,
	LineChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";

export interface JuridicoDashboardPayload {
	header: {
		title: string;
		subtitle: string;
		periodLabel: string;
		sourceLabel?: string;
	};
	metrics: Array<{
		value: number;
		label: string;
		helper?: string;
		changeText?: string;
		changeTone?: "neutral" | "positive" | "warning" | "danger";
	}>;
	trend: Array<{
		label: string;
		collectedAmount: number;
		casesIntervened: number;
	}>;
	funnel: Array<{
		label: string;
		value: number;
		pct: number;
		tone?: "primary" | "info" | "success" | "warning";
	}>;
	orders: Array<{
		id: string;
		court: string;
		municipality: string;
		assignedAt: string;
		status: string;
		daysInProcess: number;
		changeText?: string;
	}>;
	quality: Array<{
		label: string;
		pct: number;
		tone: "success" | "warning" | "danger";
	}>;
}

interface SnapshotRecord {
	periodLabel: string;
	notes: string | null;
	payload: JuridicoDashboardPayload;
	publishedAt: string | Date;
}

export const JURIDICO_DASHBOARD_TEMPLATE: SnapshotRecord = {
	periodLabel: "Abril 2026",
	notes: "Actualizado con corte mensual del equipo jurídico.",
	payload: {
		header: {
			title: "Jurídico",
			subtitle: "Impacto operativo y recaudación jurídica",
			periodLabel: "Abril 2026",
			sourceLabel: "Carga manual del equipo jurídico",
		},
		metrics: [
			{
				value: 341857,
				label: "Recaudación jurídica",
				helper: "Monto recuperado en el período",
				changeText: "+211.5% vs. mes anterior",
				changeTone: "positive",
			},
			{
				value: 51.8,
				label: "Casos regularizados (%)",
				helper: "Porcentaje de casos recuperados",
				changeText: "472 casos regularizados",
				changeTone: "positive",
			},
			{
				value: 4.6,
				label: "Promedio a 1a acción (días)",
				helper: "Meta interna <= 5 días",
				changeText: "Dentro de meta",
				changeTone: "positive",
			},
			{
				value: 408,
				label: "Casos jurídicos activos",
				helper: "Casos en gestión en el período",
				changeText: "Foco operativo actual",
				changeTone: "neutral",
			},
			{
				value: 37,
				label: "Órdenes ejecutadas",
				helper: "De 73 solicitadas",
				changeText: "50.7% de ejecución",
				changeTone: "warning",
			},
		],
		trend: [
			{ label: "Ene", collectedAmount: 82000, casesIntervened: 95 },
			{ label: "Feb", collectedAmount: 115000, casesIntervened: 120 },
			{ label: "Mar", collectedAmount: 123500, casesIntervened: 150 },
			{ label: "Abr", collectedAmount: 131000, casesIntervened: 138 },
			{ label: "May", collectedAmount: 125000, casesIntervened: 162 },
			{ label: "Jun", collectedAmount: 122000, casesIntervened: 155 },
			{ label: "Jul", collectedAmount: 141000, casesIntervened: 110 },
		],
		funnel: [
			{ label: "Desde Cobros", value: 743, pct: 100, tone: "primary" },
			{ label: "Gestión temprana", value: 535, pct: 72, tone: "info" },
			{ label: "Demandas presentadas", value: 142, pct: 40, tone: "warning" },
			{ label: "Órdenes de secuestro", value: 109, pct: 28, tone: "warning" },
			{ label: "Casos regularizados", value: 268, pct: 55, tone: "success" },
		],
		orders: [
			{
				id: "OS-001",
				court: "San Juan Rosa",
				municipality: "Mixco",
				assignedAt: "12 Mar 2026",
				status: "Ejecutado",
				daysInProcess: 15,
				changeText: "70% avance",
			},
			{
				id: "OS-002",
				court: "San Norberto",
				municipality: "Guatemala",
				assignedAt: "07 Mar 2026",
				status: "Notificación fallida",
				daysInProcess: 20,
			},
			{
				id: "OS-003",
				court: "San Costa",
				municipality: "San José Pinula",
				assignedAt: "28 Mar 2026",
				status: "En trámite",
				daysInProcess: 28,
			},
		],
		quality: [
			{ label: "Diligencias completadas", pct: 87, tone: "success" },
			{ label: "Diligencias pendientes", pct: 8, tone: "warning" },
			{ label: "Diligencias fallidas", pct: 5, tone: "danger" },
		],
	},
	publishedAt: new Date().toISOString(),
};

function formatMetricValue(metric: JuridicoDashboardPayload["metrics"][number]) {
	const label = metric.label.toLowerCase();

	if (label.includes("recaudación")) {
		return `Q${metric.value.toLocaleString()}`;
	}

	if (label.includes("(%)") || label.includes("porcentaje")) {
		return `${metric.value}%`;
	}

	if (label.includes("días")) {
		return `${metric.value} días`;
	}

	return metric.value.toLocaleString();
}

function getToneClasses(
	tone: "neutral" | "positive" | "warning" | "danger" = "neutral",
) {
	if (tone === "positive") return "text-emerald-600";
	if (tone === "warning") return "text-amber-600";
	if (tone === "danger") return "text-red-600";
	return "text-muted-foreground";
}

function getFunnelClasses(
	tone: JuridicoDashboardPayload["funnel"][number]["tone"] = "primary",
) {
	if (tone === "success") return "bg-emerald-500";
	if (tone === "warning") return "bg-amber-500";
	if (tone === "info") return "bg-sky-500";
	return "bg-amber-600";
}

function getQualityClasses(
	tone: JuridicoDashboardPayload["quality"][number]["tone"],
) {
	if (tone === "success") return "bg-emerald-500";
	if (tone === "warning") return "bg-amber-500";
	return "bg-red-500";
}

export function JuridicoDashboardView({
	snapshot,
}: {
	snapshot: SnapshotRecord | null;
}) {
	if (!snapshot) {
		return (
			<Card className="border-dashed">
				<CardHeader>
					<CardTitle>Dashboard sin publicar</CardTitle>
					<CardDescription>
						El equipo jurídico todavía no ha cargado un dataset para esta vista.
					</CardDescription>
				</CardHeader>
				<CardContent className="flex items-start gap-3 text-muted-foreground text-sm">
					<AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
					<p>
						Usa la pestaña <strong>Cargar datos</strong> para pegar el JSON del
						período y publicarlo.
					</p>
				</CardContent>
			</Card>
		);
	}

	const { payload } = snapshot;

	return (
		<div className="space-y-6">
			<div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
				<Card className="border-amber-200 bg-gradient-to-br from-amber-50 to-background">
					<CardHeader className="gap-3">
						<div className="flex items-start justify-between gap-3">
							<div className="space-y-1">
								<div className="flex items-center gap-2">
									<div className="rounded-lg bg-amber-100 p-2 text-amber-700">
										<Scale className="h-5 w-5" />
									</div>
									<div>
										<CardTitle>{payload.header.title}</CardTitle>
										<CardDescription>{payload.header.subtitle}</CardDescription>
									</div>
								</div>
							</div>
							<Badge variant="outline">{snapshot.periodLabel}</Badge>
						</div>
					</CardHeader>
					<CardContent className="flex flex-wrap gap-3 text-muted-foreground text-sm">
						<div className="inline-flex items-center gap-2 rounded-md bg-background px-3 py-2">
							<CalendarDays className="h-4 w-4" />
							{payload.header.periodLabel}
						</div>
						{payload.header.sourceLabel ? (
							<div className="inline-flex items-center gap-2 rounded-md bg-background px-3 py-2">
								<FileText className="h-4 w-4" />
								{payload.header.sourceLabel}
							</div>
						) : null}
						<div className="inline-flex items-center gap-2 rounded-md bg-background px-3 py-2">
							<CheckCircle2 className="h-4 w-4" />
							Publicado {new Date(snapshot.publishedAt).toLocaleDateString()}
						</div>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle className="text-base">Notas del corte</CardTitle>
					</CardHeader>
					<CardContent className="text-muted-foreground text-sm">
						{snapshot.notes || "Sin notas registradas para esta publicación."}
					</CardContent>
				</Card>
			</div>

			<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
				{payload.metrics.map((metric) => (
					<Card key={metric.label}>
						<CardHeader className="pb-2">
							<CardDescription>{metric.label}</CardDescription>
							<CardTitle className="text-2xl">
								{formatMetricValue(metric)}
							</CardTitle>
						</CardHeader>
						<CardContent className="space-y-1">
							{metric.helper ? (
								<p className="text-muted-foreground text-xs">{metric.helper}</p>
							) : null}
							{metric.changeText ? (
								<p className={`font-medium text-xs ${getToneClasses(metric.changeTone)}`}>
									{metric.changeText}
								</p>
							) : null}
						</CardContent>
					</Card>
				))}
			</div>

			<div className="grid gap-4 xl:grid-cols-[0.9fr_1.4fr]">
				<Card>
					<CardHeader>
						<CardTitle className="text-base">Embudo jurídico</CardTitle>
						<CardDescription>
							Etapas cargadas manualmente por el equipo
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						{payload.funnel.map((step) => (
							<div key={step.label} className="space-y-2">
								<div className="flex items-center justify-between text-sm">
									<span className="text-muted-foreground">{step.label}</span>
									<span className="font-medium">{step.value.toLocaleString()}</span>
								</div>
								<div className="flex items-center gap-3">
									<Progress value={step.pct} className="h-2.5" />
									<div
										className={`h-2.5 w-14 rounded-full ${getFunnelClasses(step.tone)}`}
										style={{ width: `${Math.max(step.pct, 8)}%` }}
									/>
								</div>
								<p className="text-muted-foreground text-xs">{step.pct}%</p>
							</div>
						))}
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<div className="flex items-center justify-between gap-3">
							<div>
								<CardTitle className="text-base">Tendencia mensual</CardTitle>
								<CardDescription>
									Recaudación y casos intervenidos
								</CardDescription>
							</div>
							<Badge variant="secondary" className="gap-1">
								<TrendingUp className="h-3 w-3" />
								Seguimiento histórico
							</Badge>
						</div>
					</CardHeader>
					<CardContent className="h-[280px]">
						<ResponsiveContainer width="100%" height="100%">
							<LineChart data={payload.trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
								<CartesianGrid strokeDasharray="3 3" vertical={false} />
								<XAxis dataKey="label" tickLine={false} axisLine={false} />
								<YAxis
									yAxisId="money"
									tickLine={false}
									axisLine={false}
									tickFormatter={(value) => `Q${Number(value).toLocaleString()}`}
									width={90}
								/>
								<YAxis
									yAxisId="cases"
									orientation="right"
									tickLine={false}
									axisLine={false}
									width={40}
								/>
								<Tooltip
									formatter={(value, name) => {
										if (name === "Q recuperado") {
											return [`Q${Number(value).toLocaleString()}`, name];
										}

										return [Number(value).toLocaleString(), name];
									}}
								/>
								<Line
									yAxisId="money"
									type="monotone"
									dataKey="collectedAmount"
									name="Q recuperado"
									stroke="#d97706"
									strokeWidth={2.5}
									dot={{ r: 4 }}
								/>
								<Line
									yAxisId="cases"
									type="monotone"
									dataKey="casesIntervened"
									name="Casos intervenidos"
									stroke="#0369a1"
									strokeWidth={2}
									strokeDasharray="5 5"
									dot={{ r: 3 }}
								/>
							</LineChart>
						</ResponsiveContainer>
					</CardContent>
				</Card>
			</div>

			<div className="grid gap-4 xl:grid-cols-[1.3fr_0.9fr]">
				<Card>
					<CardHeader>
						<div className="flex items-center gap-2">
							<Gavel className="h-4 w-4 text-amber-600" />
							<CardTitle className="text-base">Órdenes de secuestro</CardTitle>
						</div>
					</CardHeader>
					<CardContent className="space-y-3">
						{payload.orders.length === 0 ? (
							<p className="text-muted-foreground text-sm">
								No hay órdenes cargadas para este corte.
							</p>
						) : (
							payload.orders.map((order) => (
								<div
									key={order.id}
									className="grid gap-3 rounded-lg border p-4 md:grid-cols-[0.8fr_0.9fr_0.8fr_0.7fr_0.7fr]"
								>
									<div>
										<p className="font-medium text-sm">{order.court}</p>
										<p className="text-muted-foreground text-xs">{order.id}</p>
									</div>
									<div>
										<p className="text-sm">{order.municipality}</p>
										<p className="text-muted-foreground text-xs">
											Asignación: {order.assignedAt}
										</p>
									</div>
									<div>
										<Badge variant="outline">{order.status}</Badge>
									</div>
									<div>
										<p className="font-medium text-sm">
											{order.daysInProcess} días
										</p>
										<p className="text-muted-foreground text-xs">En trámite</p>
									</div>
									<div className="text-right">
										{order.changeText ? (
											<span className="inline-flex items-center gap-1 font-medium text-amber-700 text-xs">
												<ArrowUpRight className="h-3 w-3" />
												{order.changeText}
											</span>
										) : (
											<span className="text-muted-foreground text-xs">
												Sin variación
											</span>
										)}
									</div>
								</div>
							))
						)}
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle className="text-base">Calidad jurídica</CardTitle>
						<CardDescription>Semáforo cargado manualmente</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						{payload.quality.map((item) => (
							<div key={item.label} className="space-y-2">
								<div className="flex items-center justify-between text-sm">
									<div className="flex items-center gap-2">
										<div
											className={`h-2.5 w-2.5 rounded-full ${getQualityClasses(item.tone)}`}
										/>
										<span className="text-muted-foreground">{item.label}</span>
									</div>
									<span className="font-medium">{item.pct}%</span>
								</div>
								<Progress value={item.pct} className="h-2.5" />
							</div>
						))}
					</CardContent>
				</Card>
			</div>
		</div>
	);
}

export function JuridicoDashboardEditor({
	snapshot,
	isSaving,
	onSave,
}: {
	snapshot: SnapshotRecord | null;
	isSaving: boolean;
	onSave: (input: {
		periodLabel: string;
		notes?: string;
		payload: JuridicoDashboardPayload;
	}) => Promise<void> | void;
}) {
	const [periodLabel, setPeriodLabel] = useState(
		snapshot?.periodLabel || JURIDICO_DASHBOARD_TEMPLATE.periodLabel,
	);
	const [notes, setNotes] = useState(
		snapshot?.notes || JURIDICO_DASHBOARD_TEMPLATE.notes || "",
	);
	const [rawJson, setRawJson] = useState(() =>
		JSON.stringify(
			snapshot?.payload || JURIDICO_DASHBOARD_TEMPLATE.payload,
			null,
			2,
		),
	);
	const [parseError, setParseError] = useState<string | null>(null);

	useEffect(() => {
		if (!snapshot) return;
		setPeriodLabel(snapshot.periodLabel);
		setNotes(snapshot.notes || "");
		setRawJson(JSON.stringify(snapshot.payload, null, 2));
		setParseError(null);
	}, [snapshot]);

	const handleUseTemplate = () => {
		setPeriodLabel(JURIDICO_DASHBOARD_TEMPLATE.periodLabel);
		setNotes(JURIDICO_DASHBOARD_TEMPLATE.notes || "");
		setRawJson(JSON.stringify(JURIDICO_DASHBOARD_TEMPLATE.payload, null, 2));
		setParseError(null);
	};

	const handleCopyTemplate = async () => {
		await navigator.clipboard.writeText(
			JSON.stringify(JURIDICO_DASHBOARD_TEMPLATE.payload, null, 2),
		);
	};

	const handleSave = async () => {
		let parsedPayload: JuridicoDashboardPayload;

		try {
			parsedPayload = JSON.parse(rawJson) as JuridicoDashboardPayload;
		} catch {
			setParseError("El JSON no es válido. Corrígelo antes de publicar.");
			return;
		}

		const nextPayload: JuridicoDashboardPayload = {
			...parsedPayload,
			header: {
				...parsedPayload.header,
				periodLabel,
			},
		};

		setParseError(null);
		await onSave({
			periodLabel,
			notes: notes || undefined,
			payload: nextPayload,
		});
	};

	return (
		<div className="grid gap-4 xl:grid-cols-[0.9fr_1.3fr]">
			<Card>
				<CardHeader>
					<CardTitle>Cargar datos del dashboard</CardTitle>
					<CardDescription>
						Este panel publica la versión visible para todo el equipo jurídico.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="space-y-2">
						<label className="font-medium text-sm" htmlFor="periodLabel">
							Período visible
						</label>
						<Input
							id="periodLabel"
							value={periodLabel}
							onChange={(event) => setPeriodLabel(event.target.value)}
							placeholder="Abril 2026"
						/>
					</div>
					<div className="space-y-2">
						<label className="font-medium text-sm" htmlFor="notes">
							Notas del corte
						</label>
						<Textarea
							id="notes"
							value={notes}
							onChange={(event) => setNotes(event.target.value)}
							rows={4}
							placeholder="Contexto del dataset, fuente, observaciones..."
						/>
					</div>
					<div className="flex flex-wrap gap-2">
						<Button variant="outline" onClick={handleUseTemplate}>
							Usar plantilla
						</Button>
						<Button variant="outline" onClick={handleCopyTemplate}>
							Copiar plantilla JSON
						</Button>
						<Button onClick={handleSave} disabled={isSaving || !periodLabel.trim()}>
							{isSaving ? "Publicando..." : "Publicar dashboard"}
						</Button>
					</div>
					{parseError ? (
						<p className="font-medium text-red-600 text-sm">{parseError}</p>
					) : null}
					<div className="rounded-lg border bg-muted/40 p-4 text-muted-foreground text-sm">
						Estructura esperada:
						<ul className="mt-2 list-disc space-y-1 pl-5">
							<li>`header`: título, subtítulo, período y fuente.</li>
							<li>`metrics`: 4 a 6 métricas principales.</li>
							<li>`trend`: historial mensual para gráfica.</li>
							<li>`funnel`: etapas del embudo jurídico.</li>
							<li>`orders`: tabla de órdenes de secuestro.</li>
							<li>`quality`: indicadores del semáforo jurídico.</li>
						</ul>
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>JSON del snapshot</CardTitle>
					<CardDescription>
						Pega aquí el dataset validado para el dashboard.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<Textarea
						value={rawJson}
						onChange={(event) => setRawJson(event.target.value)}
						className="min-h-[560px] font-mono text-xs"
						spellCheck={false}
					/>
				</CardContent>
			</Card>
		</div>
	);
}
