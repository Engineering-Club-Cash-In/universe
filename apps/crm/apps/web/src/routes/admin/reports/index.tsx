import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
	Activity,
	AlertTriangle,
	DollarSign,
	FileText,
	TrendingDown,
	TrendingUp,
	Users,
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
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { authClient } from "@/lib/auth-client";
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

function RouteComponent() {
	const { data: session, isPending } = authClient.useSession();
	const navigate = Route.useNavigate();
	const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);

	const userProfile = useQuery(orpc.getUserProfile.queryOptions());

	const dashboardData = useQuery({
		...orpc.getDashboardExecutivo.queryOptions({
			input: {
				startDate: dateRange?.from?.toISOString(),
				endDate: dateRange?.to?.toISOString(),
			},
		}),
		enabled: userProfile.data?.role === "admin",
	});

	useEffect(() => {
		if (!session && !isPending) {
			navigate({ to: "/login" });
		} else if (session && userProfile.data?.role !== "admin") {
			navigate({ to: "/dashboard" });
			toast.error("Acceso denegado: se requiere rol de administrador");
		}
	}, [session, isPending, userProfile.data?.role]);

	if (isPending || userProfile.isPending) {
		return <div>Cargando...</div>;
	}

	if (userProfile.data?.role !== "admin") {
		return null;
	}

	const formatCurrency = (value: string | number | null) => {
		if (!value) return "Q0.00";
		const num = typeof value === "string" ? Number.parseFloat(value) : value;
		return new Intl.NumberFormat("es-GT", {
			style: "currency",
			currency: "GTQ",
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

	return (
		<div className="container mx-auto space-y-6 p-6">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="font-bold text-3xl">Dashboard Ejecutivo</h1>
					<p className="text-muted-foreground">
						Vista general del negocio y métricas clave
					</p>
				</div>
				<DateRangeFilter
					dateRange={dateRange}
					onDateRangeChange={setDateRange}
				/>
			</div>

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
											key={`cell-${
												// biome-ignore lint/suspicious/noArrayIndexKey: <explanation>
												index
											}`}
											fill={
												COLORS[
													moraData[index]?.estadoMora as keyof typeof COLORS
												]
											}
										/>
									))}
								</Pie>
								<Tooltip formatter={(value: number) => formatCurrency(value)} />
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
									formatter={(value: number, name: string) =>
										name === "monto" ? formatCurrency(value) : value
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
									name="Monto Financiado"
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
		</div>
	);
}
