import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
	Activity,
	AlertTriangle,
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
				</>
			)}
		</div>
	);
}
