import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
	Activity,
	AlertTriangle,
	CalendarDays,
	Download,
	FileText,
	TrendingDown,
	TrendingUp,
	Wallet,
} from "lucide-react";
import { useEffect, useState } from "react";
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
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { shouldRedirectToLogin } from "@/lib/auth-session";
import { PERMISSIONS } from "@/lib/roles";
import { orpc } from "@/utils/orpc";

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
	const csv = `﻿${rows
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
														Number.parseFloat(row.total_membresias) +
														Number.parseFloat(row.total_royalti);
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
														sum("total_membresias") +
														sum("total_royalti");
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
				</>
			)}
		</div>
	);
}
