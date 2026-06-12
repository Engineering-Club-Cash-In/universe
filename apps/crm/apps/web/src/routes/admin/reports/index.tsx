import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
	Activity,
	AlertTriangle,
	CalendarDays,
	ChevronLeft,
	ChevronRight,
	Download,
	FileText,
	Loader2,
	Target,
	TrendingDown,
	TrendingUp,
	Wallet,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { DateRange } from "react-day-picker";
import {
	Bar,
	BarChart,
	CartesianGrid,
	Cell,
	Legend,
	Line,
	LineChart,
	Pie,
	PieChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { toast } from "sonner";
import { DateRangeFilter } from "@/components/reports/date-range-filter";
import { ReportCard } from "@/components/reports/report-card";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { shouldRedirectToLogin } from "@/lib/auth-session";
import { PERMISSIONS } from "@/lib/roles";
import { client, orpc, queryClient } from "@/utils/orpc";

export const Route = createFileRoute("/admin/reports/")({
	component: RouteComponent,
});

const COLORS = {
	al_dia: "#22c55e",
	mora_30: "#eab308",
	mora_60: "#f97316",
	mora_90: "#ef4444",
	mora_120: "#dc2626",
	mora_120_plus: "#991b1b",
	pagado: "#10b981",
	incobrable: "#7f1d1d",
};

type MontoACobrarRow = {
	bucket: string;
	cuotas_count: number;
	total_cuota: string;
	total_interes: string;
	total_iva: string;
	total_seguro: string;
	total_gps: string;
	total_membresias: string;
	total_royalti: string;
	mora_promedio: string;
};

type FacturacionMesRubro = {
	capital: string;
	interes: string;
	iva: string;
	seguro: string;
	gps: string;
	membresias: string;
};

type FacturacionMesResponse = {
	cobrado: FacturacionMesRubro;
	esperado: FacturacionMesRubro;
};

type FlujoCuotasRubro = { capital: string; interes: string; iva: string };
type FlujoCuotasInversionista = FlujoCuotasRubro & { inversionista_id: number; nombre: string };
type FlujoCuotasInversionesResponse = {
	reinversionPorTipo: (FlujoCuotasRubro & { tipo: string; monto_reinvertido?: string })[];
	cashParcialPorTipo: (FlujoCuotasRubro & { tipo: string; monto_cash?: string })[];
	sinReinversion: { totales: FlujoCuotasRubro; porInversionista: FlujoCuotasInversionista[] };
	pagosExtras: { abonos_capital: string; cancelaciones: string };
};

const FLUJO_RUBROS: { key: keyof FlujoCuotasRubro; label: string }[] = [
	{ key: "capital", label: "Capital" },
	{ key: "interes", label: "Interés" },
	{ key: "iva", label: "IVA 12%" },
];

function getDefaultFlujoCuotasRange(): { fechaInicio: string; fechaFin: string } {
	const todayGt = formatDateInput(new Date());
	const [year, month] = todayGt.split("-").map(Number);
	const fechaInicio = `${year}-${String(month).padStart(2, "0")}-01`;
	const nextM = month === 12 ? 1 : month + 1;
	const nextY = month === 12 ? year + 1 : year;
	const lastDay = new Date(`${nextY}-${String(nextM).padStart(2, "0")}-01T12:00:00`);
	lastDay.setDate(lastDay.getDate() - 1);
	return { fechaInicio, fechaFin: formatDateInput(lastDay) };
}

type ComparativoHistoricoRow = {
	mes: number;
	colocacion_monto: string | null;
	colocacion_creditos: number | null;
	facturacion: string | null;
	cartera_activa: string | null;
	creditos_activos: number | null;
	mora_30: string | null;
	mora_60: string | null;
	mora_90: string | null;
	mora_120: string | null;
	creditos_30: number | null;
	creditos_60: number | null;
	creditos_90: number | null;
	creditos_120: number | null;
};

type PuntoEquilibrioRow = {
	bucket: string;
	cantidad_creditos: number;
	colocado: string;
	meta: string;
	cobertura: string | null;
	faltante: string | null;
};

const MESES = [
	"Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
	"Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function coberturaColor(cobertura: string | null): string {
	if (!cobertura) return "#6b7280";
	const pct = Number(cobertura);
	if (pct >= 100) return "#22c55e";
	if (pct >= 70) return "#eab308";
	return "#ef4444";
}

function coberturaLabel(cobertura: string | null): string {
	if (!cobertura) return "Sin meta";
	return `${cobertura}%`;
}

const FACTURACION_RUBROS: { key: keyof FacturacionMesRubro; label: string }[] = [
	{ key: "capital", label: "Capital" },
	{ key: "interes", label: "Interés" },
	{ key: "iva", label: "IVA 12%" },
	{ key: "seguro", label: "Seguro" },
	{ key: "gps", label: "GPS" },
	{ key: "membresias", label: "Membresías" },
];

const MONTO_COBRAR_COLORS = {
	total_cuota: "#3b82f6",
	total_interes: "#10b981",
	total_iva: "#eab308",
	total_seguro: "#f97316",
	total_gps: "#8b5cf6",
	total_membresias: "#ec4899",
	total_royalti: "#14b8a6",
} as const;

const MONTO_COBRAR_LABELS: Record<keyof typeof MONTO_COBRAR_COLORS, string> = {
	total_cuota: "Capital",
	total_interes: "Interés",
	total_iva: "IVA",
	total_seguro: "Seguro",
	total_gps: "GPS",
	total_membresias: "Membresías",
	total_royalti: "Royalti",
};

const GUATEMALA_TIME_ZONE = "America/Guatemala";

function formatDateInput(date: Date) {
	return new Intl.DateTimeFormat("en-CA", {
		timeZone: GUATEMALA_TIME_ZONE,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(date);
}

function dateFromInput(value: string) {
	return new Date(`${value}T12:00:00`);
}

function getDefaultMontoCobrarRange(): { fechaInicio: string; fechaFin: string } {
	const today = formatDateInput(new Date());
	const fin = new Date();
	fin.setFullYear(fin.getFullYear() + 1);
	return { fechaInicio: today, fechaFin: formatDateInput(fin) };
}

function formatBucket(bucket: string, periodo: string): string {
	const date = new Date(bucket);
	if (periodo === "dia") {
		return new Intl.DateTimeFormat("es-GT", { day: "2-digit", month: "short" }).format(date);
	}
	if (periodo === "semana") {
		return `Sem ${new Intl.DateTimeFormat("es-GT", { day: "2-digit", month: "short" }).format(date)}`;
	}
	if (periodo === "trimestre") {
		const q = Math.ceil((date.getMonth() + 1) / 3);
		return `T${q} ${date.getFullYear()}`;
	}
	if (periodo === "anio") {
		return String(date.getFullYear());
	}
	return new Intl.DateTimeFormat("es-GT", { month: "short", year: "numeric" }).format(date);
}

function getDefaultClosedCreditsRange(): DateRange {
	const today = dateFromInput(formatDateInput(new Date()));
	const start = new Date(today);
	start.setDate(today.getDate() - 14);
	return { from: start, to: today };
}

function buildClosedCreditsInput(dateRange: DateRange | undefined) {
	if (!dateRange?.from || !dateRange?.to) return null;
	return {
		startDate: formatDateInput(dateRange.from),
		endDate: formatDateInput(dateRange.to),
	};
}

function escapeCsvValue(value: string | number | null | undefined) {
	const raw = value == null ? "" : String(value);
	if (/[",\n\r]/.test(raw)) {
		return `"${raw.replaceAll('"', '""')}"`;
	}
	return raw;
}

function downloadCsv(filename: string, rows: (string | number | null)[][]) {
	const csv = `\uFEFF${rows
		.map((row) => row.map((value) => escapeCsvValue(value)).join(","))
		.join("\n")}`;
	const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = filename;
	link.click();
	URL.revokeObjectURL(url);
}

function ProgressBar({ value, max }: { value: number; max: number }) {
	const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
	const color = pct >= 100 ? "#22c55e" : pct >= 80 ? "#eab308" : "#ef4444";
	return (
		<div className="flex items-center gap-2">
			<div className="h-2 flex-1 overflow-hidden rounded-full bg-primary/20">
				<div
					className="h-full rounded-full transition-all"
					style={{ width: `${pct}%`, backgroundColor: color }}
				/>
			</div>
			<span className="w-10 text-right text-xs">{pct.toFixed(0)}%</span>
		</div>
	);
}

function RouteComponent() {
	const {
		data: session,
		error: sessionError,
		isPending,
	} = authClient.useSession();
	const navigate = Route.useNavigate();
	const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
	const [closedCreditsRange, setClosedCreditsRange] = useState<
		DateRange | undefined
	>(getDefaultClosedCreditsRange);
	const [montoCobrarPeriodo, setMontoCobrarPeriodo] = useState<
		"anio" | "trimestre" | "mes" | "semana" | "dia"
	>("mes");
	const [montoCobrarRange, setMontoCobrarRange] = useState(getDefaultMontoCobrarRange);
	const [facturacionMes, setFacturacionMes] = useState(() => ({
		mes: new Date().getMonth() + 1,
		anio: new Date().getFullYear(),
	}));
	const [flujoCuotasRange, setFlujoCuotasRange] = useState(getDefaultFlujoCuotasRange);
	const [comparativoAnio, setComparativoAnio] = useState(
		() => new Date().getFullYear(),
	);
	const [metasAnio, setMetasAnio] = useState(new Date().getFullYear());
	const [editMetas, setEditMetas] = useState<Record<number, string>>({});
	const [metasModalOpen, setMetasModalOpen] = useState(false);
	const [isSavingMetas, setIsSavingMetas] = useState(false);
	const [focusedMes, setFocusedMes] = useState<number | null>(null);
	const [equilibrioPeriodo, setEquilibrioPeriodo] = useState<
		"anio" | "trimestre" | "mes" | "semana" | "dia"
	>("mes");
	const [equilibrioRange, setEquilibrioRange] = useState(() => {
		const today = formatDateInput(new Date());
		const start = new Date();
		start.setMonth(start.getMonth() - 5);
		start.setDate(1);
		return { fechaInicio: formatDateInput(start), fechaFin: today };
	});

	const userProfile = useQuery(orpc.getUserProfile.queryOptions());
	const userRole = userProfile.data?.role;
	const isAdmin = userRole ? PERMISSIONS.canAccessAdmin(userRole) : false;
	const canAccessClosedCreditsReport = userRole
		? PERMISSIONS.canAccessClosedCreditsReport(userRole)
		: false;
	const canAccessReports = isAdmin || canAccessClosedCreditsReport;
	const closedCreditsInput = buildClosedCreditsInput(closedCreditsRange);

	const dashboardData = useQuery({
		...orpc.getDashboardExecutivo.queryOptions({
			input: {
				startDate: dateRange?.from?.toISOString(),
				endDate: dateRange?.to?.toISOString(),
			},
		}),
		enabled: isAdmin,
	});

	const closedCreditsReport = useQuery({
		...orpc.getReporteCreditosCerrados.queryOptions({
			input: closedCreditsInput ?? { startDate: "", endDate: "" },
		}),
		enabled: canAccessClosedCreditsReport && !!closedCreditsInput,
	});

	const montoCobrarQuery = useQuery({
		...orpc.getMontoACobrar.queryOptions({
			input: {
				periodo: montoCobrarPeriodo,
				fechaInicio: montoCobrarRange.fechaInicio,
				fechaFin: montoCobrarRange.fechaFin,
			},
		}),
		enabled: isAdmin,
	});
	const montoCobrarData = montoCobrarQuery.data as
		| { data: MontoACobrarRow[] }
		| undefined;

	const facturacionMesQuery = useQuery({
		...orpc.getFacturacionMes.queryOptions({
			input: { mes: facturacionMes.mes, anio: facturacionMes.anio },
		}),
		enabled: isAdmin,
	});
	const facturacionMesData = facturacionMesQuery.data as
		| FacturacionMesResponse
		| undefined;

	const flujoCuotasQuery = useQuery({
		...orpc.getFlujoCuotasInversiones.queryOptions({
			input: { fechaInicio: flujoCuotasRange.fechaInicio, fechaFin: flujoCuotasRange.fechaFin },
		}),
		enabled: isAdmin,
	});
	const flujoCuotasData = flujoCuotasQuery.data as FlujoCuotasInversionesResponse | undefined;

	const comparativoQuery = useQuery({
		...orpc.getComparativoHistorico.queryOptions({
			input: { anio: comparativoAnio },
		}),
		enabled: isAdmin,
	});
	const comparativoData = comparativoQuery.data as
		| { data: ComparativoHistoricoRow[] }
		| undefined;

	const metasQuery = useQuery({
		...orpc.getMetas.queryOptions({
			input: { anio: metasAnio, tipo: "colocacion" },
		}),
		enabled: isAdmin,
	});

	const upsertMetaMutation = useMutation({
		mutationFn: async (vars: {
			tipo: "colocacion" | "cobros" | "mora_maxima" | "captacion";
			anio: number;
			mes: number;
			monto: string;
		}) => client.upsertMeta(vars),
		onSuccess: () => {
			queryClient.invalidateQueries(
				orpc.getMetas.queryOptions({ input: { anio: metasAnio, tipo: "colocacion" } }),
			);
		},
		onError: (error: Error) => {
			toast.error(error.message);
		},
	});

	const puntoEquilibrioQuery = useQuery({
		...orpc.getPuntoEquilibrio.queryOptions({
			input: {
				periodo: equilibrioPeriodo,
				fechaInicio: equilibrioRange.fechaInicio,
				fechaFin: equilibrioRange.fechaFin,
			},
		}),
		enabled: isAdmin,
	});
	const puntoEquilibrioData = puntoEquilibrioQuery.data as
		| { data: PuntoEquilibrioRow[] }
		| undefined;

	const handleGuardarTodo = useCallback(async () => {
		const saves = MESES.map((_, idx) => {
			const mes = idx + 1;
			const monto = editMetas[mes];
			if (!monto || Number.isNaN(Number(monto)) || Number(monto) <= 0) return null;
			return client.upsertMeta({
				tipo: "colocacion",
				anio: metasAnio,
				mes,
				monto: String(Number(monto)),
			});
		}).filter(Boolean);
		if (saves.length === 0) return;
		setIsSavingMetas(true);
		try {
			await Promise.all(saves);
			await Promise.all([
				queryClient.invalidateQueries(
					orpc.getMetas.queryOptions({ input: { anio: metasAnio, tipo: "colocacion" } }),
				),
				queryClient.invalidateQueries(
					orpc.getPuntoEquilibrio.queryOptions({
						input: {
							periodo: equilibrioPeriodo,
							fechaInicio: equilibrioRange.fechaInicio,
							fechaFin: equilibrioRange.fechaFin,
						},
					}),
				),
			]);
			toast.success(`${saves.length} metas guardadas`);
			setMetasModalOpen(false);
		} finally {
			setIsSavingMetas(false);
		}
	}, [editMetas, metasAnio, equilibrioPeriodo, equilibrioRange]);

	useEffect(() => {
		if (Array.isArray(metasQuery.data)) {
			const map: Record<number, string> = {};
			for (const row of metasQuery.data as { mes: number; monto: string }[]) {
				map[row.mes] = String(Number(row.monto));
			}
			setEditMetas(map);
		}
	}, [metasQuery.data]);


	useEffect(() => {
		if (shouldRedirectToLogin({ error: sessionError, isPending, session })) {
			navigate({ to: "/login" });
		} else if (session && !userProfile.isPending && !canAccessReports) {
			navigate({ to: "/dashboard" });
			toast.error("Acceso denegado: no tienes permiso para ver reportes");
		}
	}, [
		session,
		sessionError,
		isPending,
		userProfile.isPending,
		canAccessReports,
		navigate,
	]);

	if (isPending || userProfile.isPending) {
		return <div>Cargando...</div>;
	}

	if (!canAccessReports) {
		return null;
	}

	const formatCurrency = (value: string | number | null | undefined) => {
		if (!value) return "Q0.00";
		const num = typeof value === "string" ? Number.parseFloat(value) : value;
		return new Intl.NumberFormat("es-GT", {
			style: "currency",
			currency: "GTQ",
			minimumFractionDigits: 2,
			maximumFractionDigits: 2,
		}).format(num);
	};

	const moraData = dashboardData.data?.morosidad || [];
	const totalEnMora = moraData
		.filter((m) => m.estadoMora !== "pagado" && m.estadoMora !== "al_dia")
		.reduce((acc, m) => acc + Number(m.montoTotal || 0), 0);

	const totalPagado = moraData
		.filter((m) => m.estadoMora === "pagado")
		.reduce((acc, m) => acc + Number(m.montoTotal || 0), 0);

	// Preparar datos para gráficas
	const pieData = moraData
		.filter((m) => m.estadoMora !== "al_dia")
		.map((m) => ({
			name:
				m.estadoMora === "pagado"
					? "Pagado"
					: m.estadoMora === "mora_30"
						? "Mora 1-30 días"
						: m.estadoMora === "mora_60"
							? "Mora 31-60 días"
							: m.estadoMora === "mora_90"
								? "Mora 61-90 días"
								: m.estadoMora === "mora_120"
									? "Mora 91-120 días"
									: m.estadoMora === "mora_120_plus"
										? "Mora +120 días"
										: "Incobrable",
			value: Number(m.montoTotal || 0),
			count: m.totalCuotas,
		}));

	const pipelineData = (dashboardData.data?.pipeline || []).map((p) => ({
		etapa: p.etapa,
		oportunidades: p.totalOportunidades,
		valor: Number(p.valorTotal || 0),
	}));

	const contratosData = (dashboardData.data?.nuevosContratos || []).map(
		(c) => ({
			mes: c.mes,
			contratos: c.total,
			monto: Number(c.monto || 0),
		}),
	);

	const setClosedCreditsPreset = (preset: "week" | "last15" | "month") => {
		const today = dateFromInput(formatDateInput(new Date()));

		if (preset === "last15") {
			const start = new Date(today);
			start.setDate(today.getDate() - 14);
			setClosedCreditsRange({ from: start, to: today });
			return;
		}

		if (preset === "month") {
			setClosedCreditsRange({
				from: new Date(today.getFullYear(), today.getMonth(), 1),
				to: new Date(today.getFullYear(), today.getMonth() + 1, 0),
			});
			return;
		}

		const day = today.getDay();
		const daysSinceMonday = day === 0 ? 6 : day - 1;
		const start = new Date(today);
		start.setDate(today.getDate() - daysSinceMonday);
		const end = new Date(start);
		end.setDate(start.getDate() + 6);
		setClosedCreditsRange({ from: start, to: end });
	};

	const exportClosedCreditsCsv = () => {
		if (!closedCreditsInput) return;
		const rows = closedCreditsReport.data ?? [];
		downloadCsv(
			`creditos-cerrados-${closedCreditsInput.startDate}-a-${closedCreditsInput.endDate}.csv`,
			[
				[
					"Placa",
					"Chasis",
					"Cuota Seguro",
					"Nombre del Cliente",
					"Número de Crédito",
					"Fecha 90%+",
				],
				...rows.map((row) => [
					row.placa ?? "",
					row.chasis ?? "",
					row.cuotaSeguro ?? "",
					row.clienteNombre ?? "",
					row.numeroCredito ?? "",
					row.fecha90 ? formatDateInput(new Date(row.fecha90)) : "",
				]),
			],
		);
	};

	return (
		<div className="container mx-auto space-y-6 p-6">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="font-bold text-3xl">
						{isAdmin ? "Dashboard Ejecutivo" : "Reportes"}
					</h1>
					<p className="text-muted-foreground">
						{isAdmin
							? "Vista general del negocio y métricas clave"
							: "Reportes disponibles para el área de cobros"}
					</p>
				</div>
				{isAdmin && (
					<DateRangeFilter
						dateRange={dateRange}
						onDateRangeChange={setDateRange}
					/>
				)}
			</div>

			{canAccessClosedCreditsReport && (
				<Card>
					<CardHeader>
						<div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
							<div>
								<CardTitle>Créditos cerrados</CardTitle>
								<CardDescription>
									Créditos que llegaron por primera vez a una etapa 90%+.
								</CardDescription>
							</div>
							<div className="flex flex-wrap items-center gap-2">
								<Button
									variant="outline"
									size="sm"
									onClick={() => setClosedCreditsPreset("week")}
								>
									Esta semana
								</Button>
								<Button
									variant="outline"
									size="sm"
									onClick={() => setClosedCreditsPreset("last15")}
								>
									Últimos 15 días
								</Button>
								<Button
									variant="outline"
									size="sm"
									onClick={() => setClosedCreditsPreset("month")}
								>
									Este mes
								</Button>
								<DateRangeFilter
									dateRange={closedCreditsRange}
									onDateRangeChange={setClosedCreditsRange}
									required
								/>
								<Button
									onClick={exportClosedCreditsCsv}
									disabled={!closedCreditsReport.data?.length}
								>
									<Download className="mr-2 h-4 w-4" />
									Exportar CSV
								</Button>
							</div>
						</div>
					</CardHeader>
					<CardContent>
						{closedCreditsReport.isPending && <p>Cargando reporte...</p>}
						{closedCreditsReport.isError && (
							<p className="text-destructive">Error al cargar el reporte.</p>
						)}
						{closedCreditsReport.data?.length === 0 && (
							<p className="text-muted-foreground">
								No hay créditos cerrados para el rango seleccionado.
							</p>
						)}
						{!!closedCreditsReport.data?.length && (
							<div className="overflow-x-auto">
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>Placa</TableHead>
											<TableHead>Chasis</TableHead>
											<TableHead>Cuota Seguro</TableHead>
											<TableHead>Nombre del Cliente</TableHead>
											<TableHead>Número de Crédito</TableHead>
											<TableHead>Fecha 90%+</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{closedCreditsReport.data.map((row) => (
											<TableRow
												key={`${row.numeroCredito}-${row.fecha90}-${row.placa}-${row.chasis}`}
											>
												<TableCell>{row.placa || "-"}</TableCell>
												<TableCell>{row.chasis || "-"}</TableCell>
												<TableCell>{formatCurrency(row.cuotaSeguro)}</TableCell>
												<TableCell>{row.clienteNombre || "-"}</TableCell>
												<TableCell>{row.numeroCredito || "-"}</TableCell>
												<TableCell>
													{row.fecha90
														? formatDateInput(new Date(row.fecha90))
														: "-"}
												</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
							</div>
						)}
					</CardContent>
				</Card>
			)}

			{isAdmin && (
				<>
					{/* Enlaces a otros reportes - TODO: Implementar rutas */}
					<div className="grid gap-4 md:grid-cols-4">
						<div className="rounded-lg border bg-card p-4 text-card-foreground opacity-50 shadow-sm">
							<div className="flex items-center gap-2">
								<AlertTriangle className="h-5 w-5 text-orange-500" />
								<span className="font-semibold">Cobranza</span>
							</div>
							<p className="mt-1 text-muted-foreground text-sm">
								Gestión de mora y recuperación (Próximamente)
							</p>
						</div>
						<div className="rounded-lg border bg-card p-4 text-card-foreground opacity-50 shadow-sm">
							<div className="flex items-center gap-2">
								<Wallet className="h-5 w-5 text-blue-500" />
								<span className="font-semibold">Cartera</span>
							</div>
							<p className="mt-1 text-muted-foreground text-sm">
								Análisis de créditos activos (Próximamente)
							</p>
						</div>
						<div className="rounded-lg border bg-card p-4 text-card-foreground opacity-50 shadow-sm">
							<div className="flex items-center gap-2">
								<Activity className="h-5 w-5 text-green-500" />
								<span className="font-semibold">Inventario</span>
							</div>
							<p className="mt-1 text-muted-foreground text-sm">
								Estado de vehículos (Próximamente)
							</p>
						</div>
						<div className="rounded-lg border bg-card p-4 text-card-foreground opacity-50 shadow-sm">
							<div className="flex items-center gap-2">
								<TrendingDown className="h-5 w-5 text-red-500" />
								<span className="font-semibold">Subastas</span>
							</div>
							<p className="mt-1 text-muted-foreground text-sm">
								Análisis de pérdidas (Próximamente)
							</p>
						</div>
					</div>

					{/* KPIs principales */}
					<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
						<ReportCard
							title="Cartera Activa"
							value={formatCurrency(
								dashboardData.data?.carteraActiva.montoTotal || 0,
							)}
							description={`${dashboardData.data?.carteraActiva.totalContratos || 0} contratos activos`}
							icon={Wallet}
						/>
						<ReportCard
							title="Total en Mora"
							value={formatCurrency(totalEnMora)}
							description="Cuotas pendientes de pago"
							icon={AlertTriangle}
							className="border-orange-200 dark:border-orange-900"
						/>
						<ReportCard
							title="Total Recuperado"
							value={formatCurrency(totalPagado)}
							description="Cuotas pagadas"
							icon={TrendingUp}
							className="border-green-200 dark:border-green-900"
						/>
						<ReportCard
							title="Casos Activos"
							value={
								dashboardData.data?.casosActivos.reduce(
									(acc, c) => acc + c.totalCasos,
									0,
								) || 0
							}
							description="Casos en gestión de cobros"
							icon={FileText}
						/>
					</div>

					{/* Gráficas */}
					<div className="grid gap-6 md:grid-cols-2">
						<Card>
							<CardHeader>
								<CardTitle>Distribución de Cuotas por Estado</CardTitle>
								<CardDescription>
									Análisis del estado de pago de las cuotas
								</CardDescription>
							</CardHeader>
							<CardContent>
								<ResponsiveContainer width="100%" height={300}>
									<PieChart>
										<Pie
											data={pieData}
											dataKey="value"
											nameKey="name"
											cx="50%"
											cy="50%"
											outerRadius={100}
											label
										>
											{pieData.map((entry, index) => (
												<Cell
													key={entry.name}
													fill={
														COLORS[
															moraData[index]?.estadoMora as keyof typeof COLORS
														]
													}
												/>
											))}
										</Pie>
										<Tooltip
											formatter={(value) => formatCurrency(Number(value))}
										/>
									</PieChart>
								</ResponsiveContainer>
							</CardContent>
						</Card>

						<Card>
							<CardHeader>
								<CardTitle>Pipeline de Ventas</CardTitle>
								<CardDescription>
									Oportunidades por etapa del proceso
								</CardDescription>
							</CardHeader>
							<CardContent>
								<ResponsiveContainer width="100%" height={300}>
									<BarChart data={pipelineData}>
										<CartesianGrid strokeDasharray="3 3" />
										<XAxis
											dataKey="etapa"
											angle={-45}
											textAnchor="end"
											height={100}
										/>
										<YAxis />
										<Tooltip />
										<Legend />
										<Bar
											dataKey="oportunidades"
											fill="#3b82f6"
											name="Oportunidades"
										/>
									</BarChart>
								</ResponsiveContainer>
							</CardContent>
						</Card>

						<Card className="md:col-span-2">
							<CardHeader>
								<CardTitle>Tendencia de Nuevos Contratos</CardTitle>
								<CardDescription>Últimos 6 meses de actividad</CardDescription>
							</CardHeader>
							<CardContent>
								<ResponsiveContainer width="100%" height={300}>
									<LineChart data={contratosData}>
										<CartesianGrid strokeDasharray="3 3" />
										<XAxis dataKey="mes" />
										<YAxis yAxisId="left" />
										<YAxis yAxisId="right" orientation="right" />
										<Tooltip
											formatter={(value, name) =>
												name === "monto" ? formatCurrency(Number(value)) : value
											}
										/>
										<Legend />
										<Line
											yAxisId="left"
											type="monotone"
											dataKey="contratos"
											stroke="#3b82f6"
											name="Contratos"
										/>
										<Line
											yAxisId="right"
											type="monotone"
											dataKey="monto"
											stroke="#10b981"
											name="Capital Activo"
										/>
									</LineChart>
								</ResponsiveContainer>
							</CardContent>
						</Card>
					</div>

					{/* Estadísticas de Leads */}
					<Card>
						<CardHeader>
							<CardTitle>Conversión de Leads</CardTitle>
							<CardDescription>
								Estado de los prospectos en el sistema
							</CardDescription>
						</CardHeader>
						<CardContent>
							<div className="grid gap-4 md:grid-cols-5">
								{dashboardData.data?.leadsStats.map((stat) => (
									<div key={stat.status} className="rounded-lg border p-4">
										<div className="text-muted-foreground text-sm">
											{stat.status === "new"
												? "Nuevos"
												: stat.status === "contacted"
													? "Contactados"
													: stat.status === "qualified"
														? "Calificados"
														: stat.status === "unqualified"
															? "No calificados"
															: "Convertidos"}
										</div>
										<div className="mt-1 font-bold text-2xl">{stat.total}</div>
									</div>
								))}
							</div>
						</CardContent>
					</Card>

					{/* Reporte: Monto a Cobrarse por Período */}
					<Card>
						<CardHeader>
							<div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
								<div className="flex items-center gap-2">
									<CalendarDays className="h-5 w-5 text-blue-500" />
									<div>
										<CardTitle>Monto a Cobrarse por Período</CardTitle>
										<CardDescription>
											Cuotas pendientes desglosadas por rubro (capital, interés, seguro, etc.)
										</CardDescription>
									</div>
								</div>
								<div className="flex flex-wrap items-center gap-2">
									<Select
										value={montoCobrarPeriodo}
										onValueChange={(v) =>
											setMontoCobrarPeriodo(
												v as "anio" | "trimestre" | "mes" | "semana" | "dia",
											)
										}
									>
										<SelectTrigger className="w-[140px]">
											<SelectValue placeholder="Período" />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="dia">Día</SelectItem>
											<SelectItem value="semana">Semana</SelectItem>
											<SelectItem value="mes">Mes</SelectItem>
											<SelectItem value="trimestre">Trimestre</SelectItem>
											<SelectItem value="anio">Año</SelectItem>
										</SelectContent>
									</Select>
									<DateRangeFilter
										dateRange={
											montoCobrarRange.fechaInicio && montoCobrarRange.fechaFin
												? {
														from: dateFromInput(montoCobrarRange.fechaInicio),
														to: dateFromInput(montoCobrarRange.fechaFin),
													}
												: undefined
										}
										onDateRangeChange={(range) => {
											if (range?.from && range?.to) {
												setMontoCobrarRange({
													fechaInicio: formatDateInput(range.from),
													fechaFin: formatDateInput(range.to),
												});
											}
										}}
									/>
								</div>
							</div>
						</CardHeader>
						<CardContent className="space-y-6">
							{montoCobrarQuery.isPending && <p>Cargando reporte...</p>}
							{montoCobrarQuery.isError && (
								<p className="text-destructive">
									Error al cargar el reporte de monto a cobrarse.
								</p>
							)}
							{montoCobrarData && montoCobrarData.data.length === 0 && (
								<p className="text-muted-foreground">
									No hay cuotas pendientes para el rango seleccionado.
								</p>
							)}
							{!!montoCobrarData?.data.length && (
								<>
									{/* Gráfica de barras apiladas */}
									<ResponsiveContainer width="100%" height={350}>
										<BarChart
											data={montoCobrarData.data.map((row: MontoACobrarRow) => ({
												bucket: formatBucket(row.bucket, montoCobrarPeriodo),
												total_cuota: Number.parseFloat(row.total_cuota),
												total_interes: Number.parseFloat(row.total_interes),
												total_iva: Number.parseFloat(row.total_iva),
												total_seguro: Number.parseFloat(row.total_seguro),
												total_gps: Number.parseFloat(row.total_gps),
												total_membresias: Number.parseFloat(row.total_membresias),
												total_royalti: Number.parseFloat(row.total_royalti),
											}))}
										>
											<CartesianGrid strokeDasharray="3 3" />
											<XAxis dataKey="bucket" angle={-30} textAnchor="end" height={60} />
											<YAxis tickFormatter={(v) => `Q${(Number(v) / 1000).toFixed(0)}k`} />
											<Tooltip
												formatter={(value, name) => [
													formatCurrency(Number(value)),
													MONTO_COBRAR_LABELS[name as keyof typeof MONTO_COBRAR_LABELS] ?? name,
												]}
											/>
											<Legend
												formatter={(value) =>
													MONTO_COBRAR_LABELS[value as keyof typeof MONTO_COBRAR_LABELS] ?? value
												}
											/>
											{(
												Object.keys(MONTO_COBRAR_COLORS) as (keyof typeof MONTO_COBRAR_COLORS)[]
											).map((key) => (
												<Bar
													key={key}
													dataKey={key}
													stackId="a"
													fill={MONTO_COBRAR_COLORS[key]}
												/>
											))}
										</BarChart>
									</ResponsiveContainer>

									{/* Tabla detallada */}
									<div className="overflow-x-auto">
										<Table>
											<TableHeader>
												<TableRow>
													<TableHead>Período</TableHead>
													<TableHead className="text-right">Cuotas</TableHead>
													<TableHead className="text-right">Capital</TableHead>
													<TableHead className="text-right">Interés</TableHead>
													<TableHead className="text-right">IVA</TableHead>
													<TableHead className="text-right">Seguro</TableHead>
													<TableHead className="text-right">GPS</TableHead>
													<TableHead className="text-right">Membresías</TableHead>
													<TableHead className="text-right">Royalti</TableHead>
													<TableHead className="text-right">Mora Prom.</TableHead>
													<TableHead className="text-right font-bold">Total</TableHead>
												</TableRow>
											</TableHeader>
											<TableBody>
												{montoCobrarData.data.map((row: MontoACobrarRow) => {
													const total =
														Number.parseFloat(row.total_cuota) +
														Number.parseFloat(row.total_interes) +
														Number.parseFloat(row.total_iva) +
														Number.parseFloat(row.total_seguro) +
														Number.parseFloat(row.total_gps) +
														Number.parseFloat(row.total_membresias);
													return (
														<TableRow key={row.bucket}>
															<TableCell>{formatBucket(row.bucket, montoCobrarPeriodo)}</TableCell>
															<TableCell className="text-right">{row.cuotas_count}</TableCell>
															<TableCell className="text-right">{formatCurrency(row.total_cuota)}</TableCell>
															<TableCell className="text-right">{formatCurrency(row.total_interes)}</TableCell>
															<TableCell className="text-right">{formatCurrency(row.total_iva)}</TableCell>
															<TableCell className="text-right">{formatCurrency(row.total_seguro)}</TableCell>
															<TableCell className="text-right">{formatCurrency(row.total_gps)}</TableCell>
															<TableCell className="text-right">{formatCurrency(row.total_membresias)}</TableCell>
															<TableCell className="text-right">{formatCurrency(row.total_royalti)}</TableCell>
															<TableCell className="text-right">{formatCurrency(row.mora_promedio)}</TableCell>
															<TableCell className="text-right font-bold">{formatCurrency(total)}</TableCell>
														</TableRow>
													);
												})}
												{/* Fila de totales */}
												{(() => {
													const rows = montoCobrarData.data as MontoACobrarRow[];
													const sum = (key: keyof MontoACobrarRow) =>
														rows.reduce(
															(acc: number, r: MontoACobrarRow) =>
																acc + Number.parseFloat((r[key] as string) || "0"),
															0,
														);
													const grandTotal =
														sum("total_cuota") +
														sum("total_interes") +
														sum("total_iva") +
														sum("total_seguro") +
														sum("total_gps") +
														sum("total_membresias");
													return (
														<TableRow className="border-t-2 bg-muted/50 font-bold">
															<TableCell>Total</TableCell>
															<TableCell className="text-right">
																{rows.reduce((acc, r) => acc + r.cuotas_count, 0)}
															</TableCell>
															<TableCell className="text-right">{formatCurrency(sum("total_cuota"))}</TableCell>
															<TableCell className="text-right">{formatCurrency(sum("total_interes"))}</TableCell>
															<TableCell className="text-right">{formatCurrency(sum("total_iva"))}</TableCell>
															<TableCell className="text-right">{formatCurrency(sum("total_seguro"))}</TableCell>
															<TableCell className="text-right">{formatCurrency(sum("total_gps"))}</TableCell>
															<TableCell className="text-right">{formatCurrency(sum("total_membresias"))}</TableCell>
															<TableCell className="text-right">{formatCurrency(sum("total_royalti"))}</TableCell>
															<TableCell className="text-right">—</TableCell>
															<TableCell className="text-right">{formatCurrency(grandTotal)}</TableCell>
														</TableRow>
													);
												})()}
											</TableBody>
										</Table>
									</div>
								</>
							)}
						</CardContent>
					</Card>

					{/* Reporte: Facturado del Mes vs Esperado */}
					<Card>
						<CardHeader>
							<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
								<div>
									<CardTitle className="flex items-center gap-2">
										<CalendarDays className="h-5 w-5" />
										Facturado del Mes vs Esperado
									</CardTitle>
									<CardDescription>
										Compara lo cobrado en el mes contra lo esperado según fecha de vencimiento
									</CardDescription>
								</div>
								<div className="flex items-center gap-2">
									<Select
										value={String(facturacionMes.mes)}
										onValueChange={(v) =>
											setFacturacionMes((prev) => ({ ...prev, mes: Number(v) }))
										}
									>
										<SelectTrigger className="w-36">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{[
												"Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
												"Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
											].map((label, i) => (
												<SelectItem key={i + 1} value={String(i + 1)}>
													{label}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
									<Input
										type="number"
										className="w-24"
										value={facturacionMes.anio}
										min={2020}
										max={2100}
										onChange={(e) =>
											setFacturacionMes((prev) => ({
												...prev,
												anio: Number(e.target.value),
											}))
										}
									/>
								</div>
							</div>
						</CardHeader>
						<CardContent>
							{facturacionMesQuery.isPending && (
								<div className="text-muted-foreground py-4 text-center text-sm">
									Cargando...
								</div>
							)}
							{facturacionMesQuery.isError && (
								<div className="text-destructive py-4 text-center text-sm">
									Error al cargar datos
								</div>
							)}
							{facturacionMesData && (() => {
								const { cobrado, esperado } = facturacionMesData;
								const totalCobrado = FACTURACION_RUBROS.reduce(
									(acc, r) => acc + Number(cobrado[r.key] || 0),
									0,
								);
								const totalEsperado = FACTURACION_RUBROS.reduce(
									(acc, r) => acc + Number(esperado[r.key] || 0),
									0,
								);
								return (
									<Table>
										<TableHeader>
											<TableRow>
												<TableHead>Rubro</TableHead>
												<TableHead className="text-right">Cobrado</TableHead>
												<TableHead className="text-right">Esperado</TableHead>
												<TableHead className="w-48">Progreso</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{FACTURACION_RUBROS.map(({ key, label }) => (
												<TableRow key={key}>
													<TableCell>{label}</TableCell>
													<TableCell className="text-right">
														{formatCurrency(Number(cobrado[key] || 0))}
													</TableCell>
													<TableCell className="text-right">
														{formatCurrency(Number(esperado[key] || 0))}
													</TableCell>
													<TableCell>
														<ProgressBar
															value={Number(cobrado[key] || 0)}
															max={Number(esperado[key] || 0)}
														/>
													</TableCell>
												</TableRow>
											))}
											<TableRow className="border-t-2 bg-muted/50 font-bold">
												<TableCell>Total</TableCell>
												<TableCell className="text-right">
													{formatCurrency(totalCobrado)}
												</TableCell>
												<TableCell className="text-right">
													{formatCurrency(totalEsperado)}
												</TableCell>
												<TableCell>
													<ProgressBar value={totalCobrado} max={totalEsperado} />
												</TableCell>
											</TableRow>
										</TableBody>
									</Table>
								);
							})()}
						</CardContent>
					</Card>

					{/* Reporte: Flujo de Cuotas de Inversiones */}
					<Card>
						<CardHeader>
							<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
								<div>
									<CardTitle className="flex items-center gap-2">
										<TrendingUp className="h-5 w-5" />
										Flujo de Cuotas de Inversiones
									</CardTitle>
									<CardDescription>
										Cuotas esperadas hacia reinversión y hacia pago en efectivo, por período
									</CardDescription>
								</div>
								<div className="flex items-center gap-2">
									<Input
										type="date"
										aria-label="Fecha inicio"
										className="w-40"
										value={flujoCuotasRange.fechaInicio}
										onChange={(e) =>
											setFlujoCuotasRange((prev) => ({ ...prev, fechaInicio: e.target.value }))
										}
									/>
									<span className="text-muted-foreground text-sm">–</span>
									<Input
										type="date"
										aria-label="Fecha fin"
										className="w-40"
										value={flujoCuotasRange.fechaFin}
										onChange={(e) =>
											setFlujoCuotasRange((prev) => ({ ...prev, fechaFin: e.target.value }))
										}
									/>
								</div>
							</div>
						</CardHeader>
						<CardContent className="space-y-6">
							{flujoCuotasQuery.isPending && (
								<div className="text-muted-foreground py-4 text-center text-sm">
									Cargando...
								</div>
							)}
							{flujoCuotasQuery.isError && (
								<div className="text-destructive py-4 text-center text-sm">
									Error al cargar datos
								</div>
							)}
							{flujoCuotasData && (() => {
								const { reinversionPorTipo, cashParcialPorTipo, sinReinversion, pagosExtras } = flujoCuotasData;
								const TIPO_LABELS: Record<string, string> = {
									reinversion_capital: "Reinversión Capital",
									reinversion_interes: "Reinversión Interés",
									reinversion_total: "Reinversión Total",
									reinversion_variable: "Reinversión Variable",
									reinversion_excedente: "Reinversión Excedente",
								};
								type ReinvertidoResult =
									| { esTotal: true; total: number }
									| { esTotal: false; capital: number; interes: number; iva: number };
								function getReinvertido(tipo: string, t: FlujoCuotasRubro & { monto_reinvertido?: string }): ReinvertidoResult {
									if (tipo === "reinversion_variable" || tipo === "reinversion_excedente")
										return { esTotal: true, total: Number(t.monto_reinvertido ?? 0) };
									if (tipo === "reinversion_capital")
										return { esTotal: false, capital: Number(t.capital), interes: 0, iva: 0 };
									if (tipo === "reinversion_interes")
										return { esTotal: false, capital: 0, interes: Number(t.interes), iva: Number(t.iva) };
									return { esTotal: false, capital: Number(t.capital), interes: Number(t.interes), iva: Number(t.iva) };
								}
								const totalesReinv = reinversionPorTipo.reduce(
									(a, t) => {
										const r = getReinvertido(t.tipo, t);
										const tot = r.esTotal ? r.total : r.capital + r.interes + r.iva;
										return {
											total: a.total + tot,
											capital: a.capital + (r.esTotal ? 0 : r.capital),
											interes: a.interes + (r.esTotal ? 0 : r.interes),
											iva: a.iva + (r.esTotal ? 0 : r.iva),
										};
									},
									{ total: 0, capital: 0, interes: 0, iva: 0 },
								);
								const totalReinv = totalesReinv.total;
								const cashParcialTotal = cashParcialPorTipo.reduce(
									(a, t) => a + (t.monto_cash ? Number(t.monto_cash) : Number(t.capital) + Number(t.interes) + Number(t.iva)),
									0,
								);
								const totalSinReinv = FLUJO_RUBROS.reduce((a, r) => a + Number(sinReinversion.totales[r.key] || 0), 0);
								const totalExtras = Number(pagosExtras.abonos_capital) + Number(pagosExtras.cancelaciones);
								return (
									<>
										{/* Sección 1: Hacia Reinversión por tipo */}
										<div>
											<p className="mb-2 text-sm font-semibold">Cuotas → Reinversión</p>
											<Table>
												<TableHeader>
													<TableRow>
														<TableHead>Tipo de Reinversión</TableHead>
														<TableHead className="text-right">Capital</TableHead>
														<TableHead className="text-right">Interés</TableHead>
														<TableHead className="text-right">IVA 12%</TableHead>
														<TableHead className="text-right">Total</TableHead>
													</TableRow>
												</TableHeader>
												<TableBody>
													{reinversionPorTipo.filter((t) => {
														const r = getReinvertido(t.tipo, t);
														const tot = r.esTotal ? r.total : r.capital + r.interes + r.iva;
														return tot > 0;
													}).map((t) => {
														const r = getReinvertido(t.tipo, t);
														const rowTotal = r.esTotal ? r.total : r.capital + r.interes + r.iva;
														return (
															<TableRow key={t.tipo}>
																<TableCell>{TIPO_LABELS[t.tipo] ?? t.tipo}</TableCell>
																<TableCell className="text-right text-muted-foreground">
																	{r.esTotal ? "—" : formatCurrency(r.capital)}
																</TableCell>
																<TableCell className="text-right text-muted-foreground">
																	{r.esTotal ? "—" : formatCurrency(r.interes)}
																</TableCell>
																<TableCell className="text-right text-muted-foreground">
																	{r.esTotal ? "—" : formatCurrency(r.iva)}
																</TableCell>
																<TableCell className="text-right">{formatCurrency(rowTotal)}</TableCell>
															</TableRow>
														);
													})}
													<TableRow className="border-t-2 bg-muted/50 font-bold">
														<TableCell>Total</TableCell>
														<TableCell className="text-right">
															{formatCurrency(totalesReinv.capital)}
														</TableCell>
														<TableCell className="text-right">
															{formatCurrency(totalesReinv.interes)}
														</TableCell>
														<TableCell className="text-right">
															{formatCurrency(totalesReinv.iva)}
														</TableCell>
														<TableCell className="text-right">{formatCurrency(totalReinv)}</TableCell>
													</TableRow>
												</TableBody>
											</Table>
										</div>

										{/* Sección 2: Cash (sin reinversión + porciones cash de reinversión parcial) */}
										<div>
											<p className="mb-2 text-sm font-semibold">Cuotas → Cash</p>
											<Table>
												<TableHeader>
													<TableRow>
														<TableHead>Origen</TableHead>
														<TableHead className="text-right">Capital</TableHead>
														<TableHead className="text-right">Interés</TableHead>
														<TableHead className="text-right">IVA 12%</TableHead>
														<TableHead className="text-right">Total</TableHead>
													</TableRow>
												</TableHeader>
												<TableBody>
													{/* Inversionistas sin reinversión */}
													<TableRow>
														<TableCell>Sin Reinversión</TableCell>
														<TableCell className="text-right">{formatCurrency(Number(sinReinversion.totales.capital))}</TableCell>
														<TableCell className="text-right">{formatCurrency(Number(sinReinversion.totales.interes))}</TableCell>
														<TableCell className="text-right">{formatCurrency(Number(sinReinversion.totales.iva))}</TableCell>
														<TableCell className="text-right">{formatCurrency(totalSinReinv)}</TableCell>
													</TableRow>
													{/* Porciones cash de inversionistas con reinversión parcial — combinado */}
													{cashParcialPorTipo.length > 0 && (
														<TableRow>
															<TableCell>Intereses y excedentes pagados a inversionistas</TableCell>
															<TableCell colSpan={3} className="text-muted-foreground text-right text-sm">capital/interés/IVA según tipo</TableCell>
															<TableCell className="text-right">{formatCurrency(cashParcialTotal)}</TableCell>
														</TableRow>
													)}
													{/* Total general cash */}
													<TableRow className="border-t-2 bg-muted/50 font-bold">
														<TableCell>Total Cash</TableCell>
														<TableCell colSpan={3} />
														<TableCell className="text-right">{formatCurrency(totalSinReinv + cashParcialTotal)}</TableCell>
													</TableRow>
												</TableBody>
											</Table>
										</div>

										{/* Sección 3: Pagos Extras Recibidos */}
										<div>
											<p className="mb-2 text-sm font-semibold">Pagos Extras Recibidos</p>
											<Table>
												<TableHeader>
													<TableRow>
														<TableHead>Tipo</TableHead>
														<TableHead className="text-right">Monto</TableHead>
													</TableRow>
												</TableHeader>
												<TableBody>
													<TableRow>
														<TableCell>Abonos Extra a Capital</TableCell>
														<TableCell className="text-right">{formatCurrency(Number(pagosExtras.abonos_capital))}</TableCell>
													</TableRow>
													<TableRow>
														<TableCell>Cancelaciones</TableCell>
														<TableCell className="text-right">{formatCurrency(Number(pagosExtras.cancelaciones))}</TableCell>
													</TableRow>
													<TableRow className="border-t-2 bg-muted/50 font-bold">
														<TableCell>Total</TableCell>
														<TableCell className="text-right">{formatCurrency(totalExtras)}</TableCell>
													</TableRow>
												</TableBody>
											</Table>
										</div>
									</>
								);
							})()}
						</CardContent>
					</Card>

					{/* Modal: Metas Mensuales */}
					<Dialog open={metasModalOpen} onOpenChange={setMetasModalOpen}>
						<DialogContent className="sm:max-w-[860px]">
							<DialogHeader>
								<DialogTitle className="flex items-center gap-2">
									<Target className="h-4 w-4 text-purple-500" />
									Metas de Colocación
								</DialogTitle>
							</DialogHeader>
							<div className="flex items-center justify-center gap-3 pb-2">
								<Button variant="outline" size="sm" onClick={() => setMetasAnio((y) => y - 1)}>‹</Button>
								<span className="w-16 text-center font-semibold">{metasAnio}</span>
								<Button variant="outline" size="sm" onClick={() => setMetasAnio((y) => y + 1)}>›</Button>
							</div>
							{metasQuery.isPending ? (
								<p className="text-muted-foreground py-4 text-center text-sm">Cargando...</p>
							) : (
								<div className="grid grid-cols-2 gap-x-10 gap-y-4">
									{MESES.map((nombreMes, idx) => {
										const mes = idx + 1;
										return (
											<div key={mes} className="flex items-center gap-3">
												<span className="w-20 shrink-0 font-medium text-sm">{nombreMes}</span>
												<div className="relative min-w-0 flex-1">
													<span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-medium">Q</span>
													<Input
														type="text"
														inputMode="decimal"
														className="h-10 pl-7 text-right text-base"
														placeholder="0"
														value={
															focusedMes === mes
																? (editMetas[mes] ?? "")
																: editMetas[mes] && Number(editMetas[mes]) > 0
																	? Number(editMetas[mes]).toLocaleString("es-GT", {
																			minimumFractionDigits: 2,
																			maximumFractionDigits: 2,
																		})
																	: ""
														}
														onFocus={() => setFocusedMes(mes)}
														onBlur={() => setFocusedMes(null)}
														onChange={(e) => {
															const raw = e.target.value.replace(/[^0-9.]/g, "");
															setEditMetas((prev) => ({ ...prev, [mes]: raw }));
														}}
													/>
												</div>
											</div>
										);
									})}
								</div>
							)}
							<div className="flex justify-end gap-2 pt-2">
								<Button variant="outline" onClick={() => setMetasModalOpen(false)}>
									Cancelar
								</Button>
								<Button onClick={handleGuardarTodo} disabled={isSavingMetas}>
									{isSavingMetas && (
										<Loader2 className="mr-2 h-4 w-4 animate-spin" />
									)}
									Guardar todo
								</Button>
							</div>
						</DialogContent>
					</Dialog>

					{/* Cobertura de Colocación vs Meta */}
					<Card>
						<CardHeader>
							<div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
								<div className="flex items-center gap-2">
									<TrendingUp className="h-5 w-5 text-green-500" />
									<div>
										<CardTitle>Cobertura de Colocación vs Meta</CardTitle>
										<CardDescription>
											Compara el capital colocado en cada período contra la meta mensual definida
										</CardDescription>
									</div>
								</div>
								<div className="flex flex-wrap items-center gap-2">
									<Button
										variant="outline"
										size="sm"
										className="gap-1.5"
										onClick={() => setMetasModalOpen(true)}
									>
										<Target className="h-3.5 w-3.5" />
										Configurar metas
									</Button>
									<Select
										value={equilibrioPeriodo}
										onValueChange={(v) =>
											setEquilibrioPeriodo(
												v as "anio" | "trimestre" | "mes" | "semana" | "dia",
											)
										}
									>
										<SelectTrigger className="w-[140px]">
											<SelectValue placeholder="Período" />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="dia">Día</SelectItem>
											<SelectItem value="semana">Semana</SelectItem>
											<SelectItem value="mes">Mes</SelectItem>
											<SelectItem value="trimestre">Trimestre</SelectItem>
											<SelectItem value="anio">Año</SelectItem>
										</SelectContent>
									</Select>
									<DateRangeFilter
										dateRange={
											equilibrioRange.fechaInicio && equilibrioRange.fechaFin
												? {
														from: dateFromInput(equilibrioRange.fechaInicio),
														to: dateFromInput(equilibrioRange.fechaFin),
													}
												: undefined
										}
										onDateRangeChange={(range) => {
											if (range?.from && range?.to) {
												setEquilibrioRange({
													fechaInicio: formatDateInput(range.from),
													fechaFin: formatDateInput(range.to),
												});
											}
										}}
									/>
								</div>
							</div>
						</CardHeader>
						<CardContent className="space-y-4">
							{puntoEquilibrioQuery.isPending && (
								<p className="text-muted-foreground text-sm">Cargando reporte...</p>
							)}
							{puntoEquilibrioQuery.isError && (
								<p className="text-destructive text-sm">
									Error al cargar reporte de cobertura.
								</p>
							)}
							{puntoEquilibrioData && puntoEquilibrioData.data.length === 0 && (
								<p className="text-muted-foreground text-sm">
									No hay datos de colocación para el rango seleccionado.
								</p>
							)}
							{!!puntoEquilibrioData?.data.length && (() => {
								const rows = puntoEquilibrioData.data;
								const totalColocado = rows.reduce((acc, r) => acc + Number(r.colocado), 0);
								const totalMeta = rows.reduce((acc, r) => acc + Number(r.meta), 0);
								const totalCreditos = rows.reduce((acc, r) => acc + r.cantidad_creditos, 0);
								const totalCobertura =
									totalMeta > 0 ? ((totalColocado / totalMeta) * 100).toFixed(1) : null;
								return (
									<>
										<ResponsiveContainer width="100%" height={300}>
											<BarChart
												data={rows.map((row) => ({
													bucket: formatBucket(row.bucket, equilibrioPeriodo),
													colocado: Number(row.colocado),
													meta: Number(row.meta),
												}))}
											>
												<CartesianGrid strokeDasharray="3 3" />
												<XAxis dataKey="bucket" angle={-30} textAnchor="end" height={60} />
												<YAxis tickFormatter={(v) => `Q${(Number(v) / 1000).toFixed(0)}k`} />
												<Tooltip
													formatter={(value, name) => [
														formatCurrency(Number(value)),
														name === "colocado" ? "Colocado" : "Meta",
													]}
												/>
												<Legend formatter={(v) => (v === "colocado" ? "Colocado" : "Meta")} />
												<Bar dataKey="colocado" fill="#3b82f6" name="colocado" />
												<Bar dataKey="meta" fill="#d1d5db" name="meta" />
											</BarChart>
										</ResponsiveContainer>

										<div className="overflow-x-auto">
											<Table>
												<TableHeader>
													<TableRow>
														<TableHead>Período</TableHead>
														<TableHead className="text-right">Créditos</TableHead>
														<TableHead className="text-right">Colocado</TableHead>
														<TableHead className="text-right">Meta</TableHead>
														<TableHead className="text-right">Cobertura</TableHead>
														<TableHead className="text-right">Faltante</TableHead>
													</TableRow>
												</TableHeader>
												<TableBody>
													{rows.map((row) => (
														<TableRow key={row.bucket}>
															<TableCell>{formatBucket(row.bucket, equilibrioPeriodo)}</TableCell>
															<TableCell className="text-right">{row.cantidad_creditos}</TableCell>
															<TableCell className="text-right">{formatCurrency(row.colocado)}</TableCell>
															<TableCell className="text-right">
																{Number(row.meta) > 0 ? formatCurrency(row.meta) : <span className="text-muted-foreground">Sin meta</span>}
															</TableCell>
															<TableCell className="text-right">
																<span
																	className="font-semibold"
																	style={{ color: coberturaColor(row.cobertura) }}
																>
																	{coberturaLabel(row.cobertura)}
																</span>
															</TableCell>
															<TableCell className="text-right">
																{row.faltante ? formatCurrency(row.faltante) : "—"}
															</TableCell>
														</TableRow>
													))}
													<TableRow className="border-t-2 bg-muted/50 font-bold">
														<TableCell>Total</TableCell>
														<TableCell className="text-right">{totalCreditos}</TableCell>
														<TableCell className="text-right">{formatCurrency(totalColocado)}</TableCell>
														<TableCell className="text-right">
															{totalMeta > 0 ? formatCurrency(totalMeta) : "—"}
														</TableCell>
														<TableCell className="text-right">
															<span
																className="font-semibold"
																style={{ color: coberturaColor(totalCobertura) }}
															>
																{coberturaLabel(totalCobertura)}
															</span>
														</TableCell>
														<TableCell className="text-right">
															{totalMeta > 0
																? formatCurrency(Math.max(0, totalMeta - totalColocado))
																: "—"}
														</TableCell>
													</TableRow>
												</TableBody>
											</Table>
										</div>
									</>
								);
							})()}
						</CardContent>
					</Card>

				{/* ============================================================ */}
				{/* REPORTE: COMPARATIVO HISTÓRICO MENSUAL                        */}
				{/* ============================================================ */}
				<Card>
					<CardHeader>
						<div className="flex items-center justify-between">
							<CardTitle className="flex items-center gap-2">
								<CalendarDays className="h-5 w-5" />
								Comparativo Histórico Mensual
							</CardTitle>
							<div className="flex items-center gap-2">
								<button
									type="button"
									className="rounded p-1 hover:bg-muted"
									onClick={() => setComparativoAnio((y) => y - 1)}
								>
									<ChevronLeft className="h-4 w-4" />
								</button>
								<span className="font-semibold text-sm w-12 text-center">
									{comparativoAnio}
								</span>
								<button
									type="button"
									className="rounded p-1 hover:bg-muted"
									onClick={() =>
										setComparativoAnio((y) =>
											y < new Date().getFullYear() ? y + 1 : y,
										)
									}
								>
									<ChevronRight className="h-4 w-4" />
								</button>
							</div>
						</div>
					</CardHeader>
					<CardContent>
						{comparativoQuery.isPending && (
							<p className="text-sm text-muted-foreground py-4 text-center">
								Cargando...
							</p>
						)}
						{comparativoQuery.isError && (
							<p className="text-sm text-red-500 py-4 text-center">
								Error al cargar comparativo histórico.
							</p>
						)}
						{comparativoData && (() => {
							const rows = comparativoData.data;
							const sumColoc = rows.reduce(
								(acc, r) => acc + (r.colocacion_monto ? Number(r.colocacion_monto) : 0),
								0,
							);
							const sumFacturacion = rows.reduce(
								(acc, r) => acc + (r.facturacion ? Number(r.facturacion) : 0),
								0,
							);
							const sumCreditosColoc = rows.reduce(
								(acc, r) => acc + (r.colocacion_creditos ?? 0),
								0,
							);
							return (
								<div className="overflow-x-auto">
									<Table>
										<TableHeader>
											<TableRow>
												<TableHead>Mes</TableHead>
												<TableHead className="text-right">Colocación (Q)</TableHead>
												<TableHead className="text-right"># Col.</TableHead>
												<TableHead className="text-right">Facturación (Q)</TableHead>
												<TableHead className="text-right">Cartera Activa (Q)</TableHead>
												<TableHead className="text-right"># Activos</TableHead>
												<TableHead className="text-right">Mora 30 (Q)</TableHead>
												<TableHead className="text-right">Mora 60 (Q)</TableHead>
												<TableHead className="text-right">Mora 90 (Q)</TableHead>
												<TableHead className="text-right">Mora 120+ (Q)</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{rows.map((row) => {
												const esFuturo =
													row.colocacion_monto === null &&
													row.facturacion === null &&
													row.cartera_activa === null;
												return (
													<TableRow
														key={row.mes}
														className={esFuturo ? "opacity-40" : undefined}
													>
														<TableCell className="font-medium">
															{MESES[row.mes - 1]}
														</TableCell>
														<TableCell className="text-right">
															{row.colocacion_monto
																? formatCurrency(Number(row.colocacion_monto))
																: "—"}
														</TableCell>
														<TableCell className="text-right">
															{row.colocacion_creditos ?? "—"}
														</TableCell>
														<TableCell className="text-right">
															{row.facturacion
																? formatCurrency(Number(row.facturacion))
																: "—"}
														</TableCell>
														<TableCell className="text-right">
															{row.cartera_activa
																? formatCurrency(Number(row.cartera_activa))
																: "—"}
														</TableCell>
														<TableCell className="text-right">
															{row.creditos_activos ?? "—"}
														</TableCell>
														<TableCell className="text-right">
															{row.mora_30 ? <span>{formatCurrency(Number(row.mora_30))}<span className="text-muted-foreground text-xs ml-1">({row.creditos_30 ?? 0})</span></span> : "—"}
														</TableCell>
														<TableCell className="text-right">
															{row.mora_60 ? <span>{formatCurrency(Number(row.mora_60))}<span className="text-muted-foreground text-xs ml-1">({row.creditos_60 ?? 0})</span></span> : "—"}
														</TableCell>
														<TableCell className="text-right">
															{row.mora_90 ? <span>{formatCurrency(Number(row.mora_90))}<span className="text-muted-foreground text-xs ml-1">({row.creditos_90 ?? 0})</span></span> : "—"}
														</TableCell>
														<TableCell className="text-right">
															{row.mora_120 ? <span>{formatCurrency(Number(row.mora_120))}<span className="text-muted-foreground text-xs ml-1">({row.creditos_120 ?? 0})</span></span> : "—"}
														</TableCell>
													</TableRow>
												);
											})}
										</TableBody>
										<TableBody>
											<TableRow className="border-t-2 bg-muted/50 font-bold">
												<TableCell>Total</TableCell>
												<TableCell className="text-right">
													{formatCurrency(sumColoc)}
												</TableCell>
												<TableCell className="text-right">
													{sumCreditosColoc}
												</TableCell>
												<TableCell className="text-right">
													{formatCurrency(sumFacturacion)}
												</TableCell>
												<TableCell className="text-right">—</TableCell>
												<TableCell className="text-right">—</TableCell>
												<TableCell className="text-right">—</TableCell>
												<TableCell className="text-right">—</TableCell>
												<TableCell className="text-right">—</TableCell>
												<TableCell className="text-right">—</TableCell>
											</TableRow>
										</TableBody>
									</Table>
								</div>
							);
						})()}
					</CardContent>
				</Card>
				</>
			)}

		</div>
	);
}
