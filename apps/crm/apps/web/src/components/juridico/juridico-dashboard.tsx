import {
	AlertCircle,
	ArrowUpRight,
	CalendarDays,
	CheckCircle2,
	FileText,
	Gavel,
	LayoutList,
	PlusCircle,
	Scale,
	Tally3,
	TrendingUp,
	XCircle,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
	CartesianGrid,
	Line,
	LineChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
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
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

export const SPANISH_MONTHS = [
	"Enero",
	"Febrero",
	"Marzo",
	"Abril",
	"Mayo",
	"Junio",
	"Julio",
	"Agosto",
	"Septiembre",
	"Octubre",
	"Noviembre",
	"Diciembre",
];
const SPANISH_SHORT_MONTHS = [
	"Ene",
	"Feb",
	"Mar",
	"Abr",
	"May",
	"Jun",
	"Jul",
	"Ago",
	"Sep",
	"Oct",
	"Nov",
	"Dic",
];

const getNextMonthLabel = (currentLabel: string) => {
	const parts = currentLabel?.split(" ") || [];
	if (parts.length < 2) return currentLabel || "Enero 2026";

	const month = parts[0];
	const year = Number.parseInt(parts[1]);

	const index = SPANISH_MONTHS.indexOf(month);
	if (index === -1) return currentLabel;

	const nextIndex = (index + 1) % 12;
	const nextYear = nextIndex === 0 ? year + 1 : year;

	return `${SPANISH_MONTHS[nextIndex]} ${nextYear}`;
};

const getNextShortMonth = (currentShort: string) => {
	const index = SPANISH_SHORT_MONTHS.indexOf(currentShort);
	if (index === -1) return SPANISH_SHORT_MONTHS[0];
	return SPANISH_SHORT_MONTHS[(index + 1) % 12];
};

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
	history?: Array<{
		periodLabel: string;
		metrics: JuridicoDashboardPayload["metrics"];
		funnel: JuridicoDashboardPayload["funnel"];
		orders: JuridicoDashboardPayload["orders"];
		quality: JuridicoDashboardPayload["quality"];
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

function formatMetricValue(
	metric: JuridicoDashboardPayload["metrics"][number],
) {
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

// Client-side validation schema
const juridicoDashboardMetricSchema = z.object({
	value: z.number().nonnegative(),
	label: z.string().min(1),
	helper: z.string().optional(),
	changeText: z.string().optional(),
	changeTone: z
		.enum(["neutral", "positive", "warning", "danger"])
		.default("neutral"),
});

const juridicoDashboardTrendPointSchema = z.object({
	label: z.string().min(1),
	collectedAmount: z.number().nonnegative(),
	casesIntervened: z.number().nonnegative(),
});

const juridicoDashboardFunnelStepSchema = z.object({
	label: z.string().min(1),
	value: z.number().nonnegative(),
	pct: z.number().min(0).max(100),
	tone: z.enum(["primary", "info", "success", "warning"]).default("primary"),
});

const juridicoDashboardOrderSchema = z.object({
	id: z.string().min(1),
	court: z.string().min(1),
	municipality: z.string().min(1),
	assignedAt: z.string().min(1),
	status: z.string().min(1),
	daysInProcess: z.number().nonnegative(),
	changeText: z.string().optional(),
});

const juridicoDashboardQualityItemSchema = z.object({
	label: z.string().min(1),
	pct: z.number().min(0).max(100),
	tone: z.enum(["success", "warning", "danger"]),
});

const juridicoDashboardPayloadSchema = z.object({
	header: z.object({
		title: z.string().min(1).default("Jurídico"),
		subtitle: z
			.string()
			.min(1)
			.default("Impacto operativo y recaudación jurídica"),
		periodLabel: z.string().min(1),
		sourceLabel: z.string().optional(),
	}),
	metrics: z.array(juridicoDashboardMetricSchema).min(4).max(6),
	trend: z.array(juridicoDashboardTrendPointSchema).min(1).max(12),
	funnel: z.array(juridicoDashboardFunnelStepSchema).min(3).max(6),
	orders: z.array(juridicoDashboardOrderSchema).max(20).default([]),
	quality: z.array(juridicoDashboardQualityItemSchema).min(1).max(5),
});

// Helper to normalize period labels (for comparison and deduping)
function normalizePeriod(label: string) {
	return label.trim().toLowerCase().replace(/\s+/g, " ");
}

const SPANISH_MONTHS_MAP: Record<string, number> = {
	enero: 0,
	febrero: 1,
	marzo: 2,
	abril: 3,
	mayo: 4,
	junio: 5,
	julio: 6,
	agosto: 7,
	septiembre: 8,
	octubre: 9,
	noviembre: 10,
	diciembre: 11,
};

function sortHistory(history: any[]) {
	return [...history].sort((a, b) => {
		const labelA = a.header.periodLabel.toLowerCase();
		const labelB = b.header.periodLabel.toLowerCase();

		// Robust year parsing (find any 4-digit number)
		const yearA = Number.parseInt(labelA.match(/\d{4}/)?.[0] || "0");
		const yearB = Number.parseInt(labelB.match(/\d{4}/)?.[0] || "0");

		if (yearA !== yearB) return yearA - yearB;

		// Robust month parsing (find if any month key is present in the label)
		// This handles "Septiembre" vs "Setiembre" if we add those variations
		const findMonth = (label: string) => {
			for (const [key, value] of Object.entries(SPANISH_MONTHS_MAP)) {
				if (label.includes(key)) return value;
			}
			// Special case for common typo "Setiembre"
			if (label.includes("setiembre")) return 8; // Septiembre
			return -1;
		};

		const monthA = findMonth(labelA);
		const monthB = findMonth(labelB);

		return monthA - monthB;
	});
}

export function JuridicoDashboardView({
	snapshot,
}: {
	snapshot: SnapshotRecord | null;
}) {
	const [activePeriod, setActivePeriod] = useState<string | null>(null);

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

	// NEW: The payload can now be a single object or an array (for history)
	const rawPayload = snapshot.payload;
	const history: any[] = sortHistory(
		(Array.isArray(rawPayload) ? rawPayload : [rawPayload]).filter(Boolean),
	);
	const hasHistory = history.length > 1;

	// Use the latest period by default if none selected
	const latestPeriod =
		history[history.length - 1] ||
		(Array.isArray(rawPayload) ? null : rawPayload);

	if (!latestPeriod) {
		return (
			<Card className="border-dashed">
				<CardHeader>
					<CardTitle>Datos no válidos</CardTitle>
					<CardDescription>
						El contenido guardado no tiene una estructura válida.
					</CardDescription>
				</CardHeader>
			</Card>
		);
	}

	const normalizedActive = activePeriod ? normalizePeriod(activePeriod) : null;
	const selectedSnapshot = normalizedActive
		? history.find(
				(h: any) => normalizePeriod(h.header.periodLabel) === normalizedActive,
			) || latestPeriod
		: latestPeriod;

	return (
		<div className="space-y-6">
			<div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
				<Card className="border-amber-200 bg-linear-to-br from-amber-50 to-background">
					<CardHeader className="gap-3">
						<div className="flex items-start justify-between gap-3">
							<div className="space-y-1">
								<div className="flex items-center gap-2">
									<div className="rounded-lg bg-amber-100 p-2 text-amber-700">
										<Scale className="h-5 w-5" />
									</div>
									<div>
										<CardTitle>{selectedSnapshot.header.title}</CardTitle>
										<CardDescription>
											{selectedSnapshot.header.subtitle}
										</CardDescription>
									</div>
								</div>
							</div>
							<div className="flex items-center gap-2">
								{hasHistory && (
									<Select
										value={
											activePeriod ||
											normalizePeriod(latestPeriod.header.periodLabel)
										}
										onValueChange={(val) => setActivePeriod(val)}
									>
										<SelectTrigger className="h-8 w-[180px] bg-background">
											<SelectValue placeholder="Seleccionar periodo" />
										</SelectTrigger>
										<SelectContent>
											{history.map((h: any) => (
												<SelectItem
													key={h.header.periodLabel}
													value={normalizePeriod(h.header.periodLabel)}
												>
													{h.header.periodLabel}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								)}
								<Badge variant="outline">
									{selectedSnapshot.header.periodLabel}
								</Badge>
							</div>
						</div>
					</CardHeader>
					<CardContent className="flex flex-wrap gap-3 text-muted-foreground text-sm">
						<div className="inline-flex items-center gap-2 rounded-md bg-background px-3 py-2">
							<CalendarDays className="h-4 w-4" />
							{selectedSnapshot.header.periodLabel}
						</div>
						{selectedSnapshot.header.sourceLabel ? (
							<div className="inline-flex items-center gap-2 rounded-md bg-background px-3 py-2">
								<FileText className="h-4 w-4" />
								{selectedSnapshot.header.sourceLabel}
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
				{selectedSnapshot.metrics.map((metric: any) => (
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
								<p
									className={`font-medium text-xs ${getToneClasses(metric.changeTone)}`}
								>
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
							Etapas para {selectedSnapshot.header.periodLabel}
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						{selectedSnapshot.funnel.map((step: any) => (
							<div key={step.label} className="space-y-2">
								<div className="flex items-center justify-between text-sm">
									<span className="text-muted-foreground">{step.label}</span>
									<span className="font-medium">
										{step.value.toLocaleString()}
									</span>
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
							<LineChart
								data={latestPeriod.trend}
								margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
							>
								<CartesianGrid strokeDasharray="3 3" vertical={false} />
								<XAxis dataKey="label" tickLine={false} axisLine={false} />
								<YAxis
									yAxisId="money"
									tickLine={false}
									axisLine={false}
									tickFormatter={(value) =>
										`Q${Number(value).toLocaleString()}`
									}
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
							<CardTitle className="text-base">
								Órdenes de secuestro - {selectedSnapshot.header.periodLabel}
							</CardTitle>
						</div>
					</CardHeader>
					<CardContent className="space-y-3">
						{selectedSnapshot.orders.length === 0 ? (
							<p className="text-muted-foreground text-sm">
								No hay órdenes cargadas para este período.
							</p>
						) : (
							selectedSnapshot.orders.map((order: any) => (
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
						<CardDescription>
							Estado para {selectedSnapshot.header.periodLabel}
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						{selectedSnapshot.quality.map((item: any) => (
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
	const initialPayload = (() => {
		const raw = snapshot?.payload;
		const hist = sortHistory(
			(Array.isArray(raw) ? raw : raw ? [raw] : []).filter(Boolean),
		);
		return hist[hist.length - 1] || JURIDICO_DASHBOARD_TEMPLATE.payload;
	})();
	const [periodLabel, setPeriodLabel] = useState(
		snapshot?.periodLabel || JURIDICO_DASHBOARD_TEMPLATE.periodLabel,
	);
	const [notes, setNotes] = useState(
		(snapshot?.notes || JURIDICO_DASHBOARD_TEMPLATE.notes || "")
			.split("<!--DASHBOARD_HISTORY:")[0]
			.trim(),
	);
	const [payload, setPayload] =
		useState<JuridicoDashboardPayload>(initialPayload);
	const [rawJson, setRawJson] = useState(() =>
		JSON.stringify(initialPayload, null, 2),
	);
	const [validationErrors, setValidationErrors] = useState<string[]>([]);
	const [parseError, setParseError] = useState<string | null>(null);
	const [sectionsPresence, setSectionsPresence] = useState({
		header: false,
		metrics: false,
		trend: false,
		funnel: false,
		orders: false,
		quality: false,
	});
	const [showAdvancedEditor, setShowAdvancedEditor] = useState(false);
	const [viewMode, setViewMode] = useState<"tabs" | "list">("tabs");
	const orderRefs = useRef<Array<HTMLDivElement | null>>([]);

	useEffect(() => {
		if (!snapshot) return;

		// If payload is array, take latest for current editor state
		const rawPayload = snapshot.payload;
		const history: any[] = sortHistory(
			(Array.isArray(rawPayload) ? rawPayload : [rawPayload]).filter(Boolean),
		);
		const latest =
			history[history.length - 1] || JURIDICO_DASHBOARD_TEMPLATE.payload;

		// Priority: Payload header label correctly reflects the content
		setPeriodLabel(latest?.header?.periodLabel || snapshot.periodLabel || "");
		setNotes(snapshot.notes || "");
		setPayload(latest);
		setRawJson(JSON.stringify(latest, null, 2));
		setParseError(null);
		setValidationErrors([]);
	}, [snapshot]);

	// Real-time validation with debounce for the WHOLE payload (including form changes)
	useEffect(() => {
		const timer = setTimeout(() => {
			try {
				const currentPayload = payload;

				// Track actual validity for indicators
				setSectionsPresence({
					header: juridicoDashboardPayloadSchema.shape.header.safeParse(
						currentPayload.header,
					).success,
					metrics: z
						.array(juridicoDashboardMetricSchema)
						.min(4)
						.max(6)
						.safeParse(currentPayload.metrics).success,
					trend: z
						.array(juridicoDashboardTrendPointSchema)
						.min(1)
						.max(12)
						.safeParse(currentPayload.trend).success,
					funnel: z
						.array(juridicoDashboardFunnelStepSchema)
						.min(3)
						.max(6)
						.safeParse(currentPayload.funnel).success,
					orders: z
						.array(juridicoDashboardOrderSchema)
						.max(20)
						.safeParse(currentPayload.orders).success,
					quality: z
						.array(juridicoDashboardQualityItemSchema)
						.min(1)
						.max(5)
						.safeParse(currentPayload.quality).success,
				});

				const result = juridicoDashboardPayloadSchema.safeParse(currentPayload);
				if (!result.success) {
					// Humanize Zod errors
					const humanErrors = result.error.issues.map((issue) => {
						const path = issue.path.join(".");
						let label = path;

						if (path.startsWith("metrics")) label = "metrics";
						else if (path.startsWith("funnel")) label = "funnel";
						else if (path.startsWith("trend")) label = "trend";
						else if (path.startsWith("orders")) label = "orders";
						else if (path.startsWith("quality")) label = "quality";
						else if (path.startsWith("header.periodLabel")) label = "Periodo";
						else if (path.startsWith("header")) label = "Encabezado";

						const message =
							issue.code === "invalid_type"
								? "Dato incompleto o incorrecto"
								: issue.message;

						return `${label}: ${message}`;
					});

					setValidationErrors(Array.from(new Set(humanErrors)));
					setParseError("Hay detalles por corregir en la estructura");
				} else {
					setValidationErrors([]);
					setParseError(null);
				}
			} catch (e) {
				// Should not happen with direct payload sync, but for safety:
				setParseError("Error procesando los datos");
			}
		}, 800);

		return () => clearTimeout(timer);
	}, [payload]);

	const handleNewMonth = () => {
		// Get latest available data from history or template
		const rawPayload = snapshot?.payload;
		const historyList: any[] = (
			Array.isArray(rawPayload) ? rawPayload : [rawPayload]
		).filter(Boolean);
		const base =
			historyList[historyList.length - 1] ||
			JURIDICO_DASHBOARD_TEMPLATE.payload;

		const nextPeriodHeader = getNextMonthLabel(base.header.periodLabel);
		const lastTrend = base.trend || [];
		const lastTrendLabel = lastTrend[lastTrend.length - 1]?.label || "Dic";
		const nextTrendLabel = getNextShortMonth(lastTrendLabel);

		// Shift trend: keep last 6, add new one
		const newTrend = [
			...lastTrend.slice(1),
			{ label: nextTrendLabel, collectedAmount: 0, casesIntervened: 0 },
		];

		const cleanPayload: JuridicoDashboardPayload = {
			...base,
			header: {
				...base.header,
				periodLabel: nextPeriodHeader,
				sourceLabel: base.header.sourceLabel || "",
			},
			metrics: base.metrics.map((m: any) => ({
				...m,
				value: 0,
				changeText: "",
			})),
			trend: newTrend,
			funnel: base.funnel.map((s: any) => ({ ...s, value: 0, pct: 0 })),
			orders: [],
			quality: base.quality.map((q: any) => ({ ...q, pct: 0 })),
		};

		setPeriodLabel(nextPeriodHeader);
		setNotes("");
		setPayload(cleanPayload);
		setRawJson(JSON.stringify(cleanPayload, null, 2));
		setParseError(null);
	};

	const handleCopyTemplate = async () => {
		await navigator.clipboard.writeText(
			JSON.stringify(JURIDICO_DASHBOARD_TEMPLATE.payload, null, 2),
		);
	};

	const syncPayload = (
		updater: (current: JuridicoDashboardPayload) => JuridicoDashboardPayload,
	) => {
		setPayload((current) => {
			const next = updater(current);
			setRawJson(JSON.stringify(next, null, 2));
			return next;
		});
	};

	const updateMetric = (index: number, value: string) => {
		syncPayload((current) => {
			const metrics = [...current.metrics];
			const metric = { ...metrics[index] };
			metric.value = Number(value) || 0;
			metrics[index] = metric;
			return { ...current, metrics };
		});
	};

	const updateTrend = (
		index: number,
		key: "collectedAmount" | "casesIntervened",
		value: string,
	) => {
		syncPayload((current) => {
			const trend = [...current.trend];
			const point = { ...trend[index] };
			point[key] = Number(value) || 0;
			trend[index] = point;
			return { ...current, trend };
		});
	};

	const updateFunnel = (index: number, value: string) => {
		syncPayload((current) => {
			const funnel = [...current.funnel];
			const step = { ...funnel[index] };
			step.value = Number(value) || 0;
			funnel[index] = step;
			return { ...current, funnel };
		});
	};

	const updateOrder = (
		index: number,
		key: keyof JuridicoDashboardPayload["orders"][number],
		value: string,
	) => {
		syncPayload((current) => {
			const orders = [...current.orders];
			const order = { ...orders[index] };
			if (key === "daysInProcess") {
				order.daysInProcess = Number(value) || 0;
			} else {
				order[key] = value;
			}
			orders[index] = order;
			return { ...current, orders };
		});
	};

	const addOrder = () => {
		let nextIndex = -1;
		syncPayload((current) => {
			nextIndex = current.orders.length;
			return {
				...current,
				orders: [
					...current.orders,
					{
						id: `OS-${String(current.orders.length + 1).padStart(3, "0")}`,
						court: "",
						municipality: "",
						assignedAt: "",
						status: "",
						daysInProcess: 0,
						changeText: "",
					},
				],
			};
		});
		requestAnimationFrame(() => {
			orderRefs.current[nextIndex]?.scrollIntoView({
				behavior: "smooth",
				block: "start",
			});
		});
	};

	const removeOrder = (index: number) => {
		syncPayload((current) => ({
			...current,
			orders: current.orders.filter(
				(_, currentIndex) => currentIndex !== index,
			),
		}));
	};

	const updateQuality = (
		index: number,
		key: keyof JuridicoDashboardPayload["quality"][number],
		value: string,
	) => {
		syncPayload((current) => {
			const quality = [...current.quality];
			const item = { ...quality[index] };
			if (key === "pct") {
				item.pct = Number(value) || 0;
			} else if (key === "tone") {
				item.tone = value as "success" | "warning" | "danger";
			} else {
				item[key] = value;
			}
			quality[index] = item;
			return { ...current, quality };
		});
	};

	const handleSave = async () => {
		let parsedData = payload;

		if (showAdvancedEditor) {
			try {
				parsedData = JSON.parse(rawJson) as JuridicoDashboardPayload;
				setPayload(parsedData);
			} catch (e) {
				setParseError("El JSON no es válido");
				return;
			}
		}

		// --- SMART UPSERT ARRAY LOGIC ---
		const rawPayload = snapshot?.payload;
		const history: any[] = Array.isArray(rawPayload)
			? rawPayload
			: rawPayload
				? [rawPayload]
				: [];

		// Priority: Use the label from the JSON content to avoid mismatches
		const currentPeriodLabel = parsedData.header.periodLabel || periodLabel;
		const normalizedCurrent = normalizePeriod(currentPeriodLabel);

		// Snapshot of current data
		const currentSnapshot = {
			...parsedData,
			header: {
				...parsedData.header,
				periodLabel: currentPeriodLabel,
			},
		};

		// Remove existing record if same period (Normalized)
		const otherHistory = history.filter(
			(h: any) => normalizePeriod(h.header.periodLabel) !== normalizedCurrent,
		);

		// Append new record and keep last 12, then SORT chronologically
		const updatedHistory = sortHistory([
			...otherHistory,
			currentSnapshot,
		]).slice(-12);

		setParseError(null);
		await onSave({
			periodLabel: currentPeriodLabel,
			notes: notes || undefined,
			payload: updatedHistory as any, // We send the whole array to the server
		});
	};

	// Reusable section contents
	const GeneralSection = (
		<div className="space-y-6">
			<div className="space-y-3">
				<h3 className="font-medium text-sm">Encabezado</h3>
				<Input
					value={payload?.header?.title || ""}
					onChange={(event) =>
						syncPayload((current) => ({
							...current,
							header: { ...current.header, title: event.target.value },
						}))
					}
					placeholder="Jurídico"
				/>
				<Input
					value={payload?.header?.subtitle || ""}
					onChange={(event) =>
						syncPayload((current) => ({
							...current,
							header: { ...current.header, subtitle: event.target.value },
						}))
					}
					placeholder="Subtítulo"
				/>
				<Input
					value={payload?.header?.sourceLabel || ""}
					onChange={(event) =>
						syncPayload((current) => ({
							...current,
							header: {
								...current.header,
								sourceLabel: event.target.value,
							},
						}))
					}
					placeholder="Fuente o nota de carga"
				/>
			</div>

			{validationErrors.filter((e) => e.startsWith("header")).length > 0 && (
				<div className="rounded-md bg-destructive/10 p-3 text-destructive text-xs">
					{validationErrors
						.filter((e) => e.startsWith("header"))
						.map((err, i) => (
							<p key={i}>{err}</p>
						))}
				</div>
			)}
		</div>
	);

	const MetricsSection = (
		<div className="space-y-8">
			<div className="space-y-3">
				<h3 className="font-medium text-sm">Métricas principales (4 a 6)</h3>
				<div className="grid gap-3 sm:grid-cols-2">
					{payload?.metrics?.map((metric: any, index: number) => (
						<div
							key={`${metric.label}-${index}`}
							className="grid gap-2 rounded-lg border p-3"
						>
							<div className="font-medium text-muted-foreground text-xs">
								{metric.label}
							</div>
							<Input
								type="number"
								value={metric.value}
								onChange={(event) => updateMetric(index, event.target.value)}
								placeholder="Valor"
							/>
						</div>
					))}
				</div>
				{validationErrors.filter((e) => e.startsWith("metrics")).length > 0 && (
					<div className="mt-2 rounded-md bg-destructive/10 p-3 text-destructive text-xs">
						{validationErrors
							.filter((e) => e.startsWith("metrics"))
							.map((err, i) => (
								<p key={i}>{err}</p>
							))}
					</div>
				)}
			</div>

			<div className="space-y-3">
				<h3 className="font-medium text-sm">Tendencia mensual</h3>
				<div className="max-h-[300px] overflow-y-auto pr-2">
					{payload?.trend?.map((point: any, index: number) => (
						<div
							key={`${point.label}-${index}`}
							className="mb-3 grid gap-2 rounded-lg border p-3 md:grid-cols-3"
						>
							<div className="flex items-center font-medium text-sm">
								{point.label}
							</div>
							<Input
								type="number"
								value={point.collectedAmount}
								onChange={(event) =>
									updateTrend(index, "collectedAmount", event.target.value)
								}
								placeholder="Monto"
							/>
							<Input
								type="number"
								value={point.casesIntervened}
								onChange={(event) =>
									updateTrend(index, "casesIntervened", event.target.value)
								}
								placeholder="Casos"
							/>
						</div>
					))}
				</div>
			</div>
		</div>
	);

	const OperationSection = (
		<div className="space-y-8">
			<div className="space-y-3">
				<h3 className="font-medium text-sm">Embudo jurídico</h3>
				{payload?.funnel?.map((step: any, index: number) => (
					<div
						key={`${step.label}-${index}`}
						className="grid gap-2 rounded-lg border p-3 md:grid-cols-2"
					>
						<div className="flex items-center font-medium text-sm">
							{step.label}
						</div>
						<Input
							type="number"
							value={step.value}
							onChange={(event) => updateFunnel(index, event.target.value)}
							placeholder="Valor"
						/>
					</div>
				))}
				{validationErrors.filter((e) => e.startsWith("funnel")).length > 0 && (
					<div className="mt-2 rounded-md bg-destructive/10 p-3 text-destructive text-xs">
						{validationErrors
							.filter((e) => e.startsWith("funnel"))
							.map((err, i) => (
								<p key={i}>{err}</p>
							))}
					</div>
				)}
			</div>

			<div className="space-y-3">
				<div className="flex items-center justify-between">
					<h3 className="font-medium text-sm">Órdenes</h3>
					<Button type="button" variant="outline" size="sm" onClick={addOrder}>
						Nueva orden
					</Button>
				</div>
				<div className="max-h-[400px] overflow-y-auto pr-2">
					{payload?.orders?.map((order: any, index: number) => (
						<div
							key={order.id || index}
							ref={(node) => {
								orderRefs.current[index] = node;
							}}
							className="mb-4 grid gap-2 rounded-lg border p-3"
						>
							<div className="flex justify-end">
								<Button
									type="button"
									variant="ghost"
									size="sm"
									onClick={() => removeOrder(index)}
									className="h-6 text-red-500 hover:bg-red-50 hover:text-red-600"
								>
									Eliminar
								</Button>
							</div>
							<div className="grid gap-2 md:grid-cols-2">
								<Input
									value={order.id}
									onChange={(event) =>
										updateOrder(index, "id", event.target.value)
									}
									placeholder="Código"
								/>
								<Input
									value={order.status}
									onChange={(event) =>
										updateOrder(index, "status", event.target.value)
									}
									placeholder="Estado"
								/>
							</div>
							<div className="grid gap-2 md:grid-cols-2">
								<Input
									value={order.court}
									onChange={(event) =>
										updateOrder(index, "court", event.target.value)
									}
									placeholder="Juzgado"
								/>
								<Input
									value={order.municipality}
									onChange={(event) =>
										updateOrder(index, "municipality", event.target.value)
									}
									placeholder="Municipio"
								/>
							</div>
							<div className="grid gap-2 md:grid-cols-3">
								<Input
									value={order.assignedAt}
									onChange={(event) =>
										updateOrder(index, "assignedAt", event.target.value)
									}
									placeholder="Fecha asignación"
								/>
								<Input
									type="number"
									value={order.daysInProcess}
									onChange={(event) =>
										updateOrder(index, "daysInProcess", event.target.value)
									}
									placeholder="Días"
								/>
								<Input
									value={order.changeText || ""}
									onChange={(event) =>
										updateOrder(index, "changeText", event.target.value)
									}
									placeholder="Avance o nota"
								/>
							</div>
						</div>
					))}
				</div>
			</div>

			<div className="space-y-3">
				<h3 className="font-medium text-sm">Semáforo de calidad</h3>
				{payload?.quality?.map((item: any, index: number) => (
					<div
						key={`${item.label}-${index}`}
						className="grid gap-2 rounded-lg border p-3 md:grid-cols-2"
					>
						<div className="flex items-center text-muted-foreground text-xs">
							{item.label}
						</div>
						<Input
							type="number"
							value={item.pct}
							onChange={(event) =>
								updateQuality(index, "pct", event.target.value)
							}
							placeholder="Porcentaje"
						/>
					</div>
				))}
			</div>
		</div>
	);

	return (
		<div className="grid gap-4 xl:grid-cols-[0.9fr_1.3fr]">
			<Card>
				<CardHeader className="flex flex-row items-center justify-between space-y-0 text-amber-900">
					<div>
						<CardTitle>Cargar datos del dashboard</CardTitle>
						<CardDescription className="text-amber-700/70">
							Gestión de historial y snapshots mensuales.
						</CardDescription>
					</div>
					<Button
						variant="outline"
						size="sm"
						className="gap-2 border-primary/20 text-primary hover:bg-primary/5"
						onClick={handleNewMonth}
					>
						<PlusCircle className="h-4 w-4" />+ Nuevo Mes
					</Button>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="space-y-2">
						<div className="flex items-center justify-between font-medium text-sm">
							<label htmlFor="periodLabel">Período visible</label>
							{Array.isArray(snapshot?.payload) &&
								(snapshot.payload as unknown as any[]).length > 0 && (
									<Select
										value={periodLabel}
										onValueChange={(val) => {
											const history = snapshot.payload as unknown as any[];
											const selected = history.find(
												(m) =>
													normalizePeriod(m.header.periodLabel) ===
													normalizePeriod(val),
											);
											if (selected) {
												setPayload(selected);
												setRawJson(JSON.stringify(selected, null, 2));
												setPeriodLabel(selected.header.periodLabel);
											}
										}}
									>
										<SelectTrigger className="h-7 w-[160px] text-xs">
											<SelectValue placeholder="Editar existente..." />
										</SelectTrigger>
										<SelectContent>
											{sortHistory(snapshot.payload as unknown as any[]).map(
												(m: any) => (
													<SelectItem
														key={m.header.periodLabel}
														value={m.header.periodLabel}
													>
														{m.header.periodLabel}
													</SelectItem>
												),
											)}
										</SelectContent>
									</Select>
								)}
						</div>
						<Input
							id="periodLabel"
							value={periodLabel}
							onChange={(event) => {
								const val = event.target.value;
								setPeriodLabel(val);
								syncPayload((current) => ({
									...current,
									header: { ...current.header, periodLabel: val },
								}));
							}}
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
						<Button variant="outline" onClick={handleNewMonth}>
							Restablecer / Nuevo
						</Button>
						<Button
							variant="outline"
							onClick={() => setShowAdvancedEditor((current) => !current)}
						>
							{showAdvancedEditor ? "Ocultar JSON" : "Modo avanzado"}
						</Button>
						{showAdvancedEditor ? (
							<Button variant="outline" onClick={handleCopyTemplate}>
								Copiar plantilla JSON
							</Button>
						) : null}
						<Button
							onClick={handleSave}
							disabled={isSaving || !periodLabel.trim()}
						>
							{isSaving ? "Publicando..." : "Publicar dashboard"}
						</Button>
					</div>
					{parseError ? (
						<p className="font-medium text-red-600 text-sm">{parseError}</p>
					) : null}
					<div className="rounded-lg border bg-muted/40 p-4 text-muted-foreground text-sm">
						Edita los bloques de abajo como un formulario. El JSON queda solo
						como respaldo para casos avanzados.
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
					<div className="flex-1">
						<CardTitle>Contenido del dashboard</CardTitle>
						<CardDescription>
							Ajusta la información visible sin tocar estructura técnica.
						</CardDescription>
					</div>
					<div className="flex items-center gap-2">
						<div className="mr-4 flex rounded-lg border bg-muted p-1">
							<Button
								variant={viewMode === "tabs" ? "secondary" : "ghost"}
								size="sm"
								className="h-8 gap-2 px-3"
								onClick={() => setViewMode("tabs")}
							>
								<Tally3 className="h-3.5 w-3.5" />
								<span className="sr-only sm:not-sr-only">Secciones</span>
							</Button>
							<Button
								variant={viewMode === "list" ? "secondary" : "ghost"}
								size="sm"
								className="h-8 gap-2 px-3"
								onClick={() => setViewMode("list")}
							>
								<LayoutList className="h-3.5 w-3.5" />
								<span className="sr-only sm:not-sr-only">Lista</span>
							</Button>
						</div>
						{parseError && (
							<Badge variant="destructive" className="animate-pulse">
								Detalles por corregir
							</Badge>
						)}
					</div>
				</CardHeader>
				<CardContent className="space-y-6">
					{viewMode === "tabs" ? (
						<Tabs defaultValue="general" className="w-full">
							<TabsList className="grid w-full grid-cols-3">
								<TabsTrigger value="general" className="gap-2">
									General
									{sectionsPresence.header ? (
										<CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
									) : (
										<AlertCircle className="h-3.5 w-3.5 text-muted-foreground/50" />
									)}
								</TabsTrigger>
								<TabsTrigger value="metrics" className="gap-2">
									Métricas
									{sectionsPresence.metrics && sectionsPresence.trend ? (
										<CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
									) : (
										<AlertCircle className="h-3.5 w-3.5 text-muted-foreground/50" />
									)}
								</TabsTrigger>
								<TabsTrigger value="operacion" className="gap-2">
									Operación
									{sectionsPresence.funnel &&
									sectionsPresence.orders &&
									sectionsPresence.quality ? (
										<CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
									) : (
										<AlertCircle className="h-3.5 w-3.5 text-muted-foreground/50" />
									)}
								</TabsTrigger>
							</TabsList>

							<TabsContent value="general" className="mt-6">
								{GeneralSection}
							</TabsContent>

							<TabsContent value="metrics" className="mt-6">
								{MetricsSection}
							</TabsContent>

							<TabsContent value="operacion" className="mt-6">
								{OperationSection}
							</TabsContent>
						</Tabs>
					) : (
						<div className="space-y-12 pr-2">
							<div className="space-y-4">
								<div className="flex items-center gap-2 border-b pb-2">
									<h2 className="font-bold text-lg">General</h2>
									{sectionsPresence.header && (
										<CheckCircle2 className="h-4 w-4 text-emerald-500" />
									)}
								</div>
								{GeneralSection}
							</div>
							<div className="space-y-4">
								<div className="flex items-center gap-2 border-b pb-2">
									<h2 className="font-bold text-lg">Métricas y Tendencias</h2>
									{sectionsPresence.metrics && sectionsPresence.trend && (
										<CheckCircle2 className="h-4 w-4 text-emerald-500" />
									)}
								</div>
								{MetricsSection}
							</div>
							<div className="space-y-4">
								<div className="flex items-center gap-2 border-b pb-2">
									<h2 className="font-bold text-lg">Operación</h2>
									{sectionsPresence.funnel &&
										sectionsPresence.orders &&
										sectionsPresence.quality && (
											<CheckCircle2 className="h-4 w-4 text-emerald-500" />
										)}
								</div>
								{OperationSection}
							</div>
						</div>
					)}

					{showAdvancedEditor ? (
						<div className="space-y-3 border-t pt-4">
							<h3 className="font-medium text-sm">JSON avanzado</h3>
							<Textarea
								value={rawJson}
								onChange={(event) => setRawJson(event.target.value)}
								className="min-h-[360px] font-mono text-xs"
								spellCheck={false}
							/>
						</div>
					) : null}
				</CardContent>
			</Card>
		</div>
	);
}
