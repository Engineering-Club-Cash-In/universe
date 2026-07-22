import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Activity, Clock, TrendingDown, TrendingUp } from "lucide-react";
import { useEffect, useState } from "react";
import type { DateRange } from "react-day-picker";
import {
	Bar,
	BarChart,
	CartesianGrid,
	Cell,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { toast } from "sonner";
import {
	DEFAULT_PRESET,
	RangePresetFilter,
	rangeForPreset,
} from "@/components/reports/range-preset-filter";
import { ReportCard } from "@/components/reports/report-card";
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
import { getSourceLabel } from "@/lib/crm-formatters";
import { PERMISSIONS } from "@/lib/roles";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/crm/reportes/tiempo-cierre")({
	component: RouteComponent,
});

const GUATEMALA_TZ = "America/Guatemala";
const BAR_HEIGHT_PX = 52;

const SOURCE_COLORS: Record<string, string> = {
	website: "#8b5cf6",
	referral: "#10b981",
	cold_call: "#f97316",
	email: "#6366f1",
	social_media: "#d946ef",
	event: "#a855f7",
	facebook: "#3b82f6",
	instagram: "#ec4899",
	google: "#ef4444",
	meta: "#0ea5e9",
	linkedin: "#1d4ed8",
	// "Whatsapp" con W mayúscula es el valor real del enum en BD
	Whatsapp: "#22c55e",
	agency: "#14b8a6",
	property: "#f59e0b",
	recurrent: "#7c3aed",
	recurrent_active: "#0891b2",
	other: "#9ca3af",
};

function getSourceColor(source: string): string {
	return SOURCE_COLORS[source] ?? "#9ca3af";
}

function formatDateInput(date: Date): string {
	return new Intl.DateTimeFormat("en-CA", {
		timeZone: GUATEMALA_TZ,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(date);
}

function RouteComponent() {
	const {
		data: session,
		error: sessionError,
		isPending: sessionPending,
	} = authClient.useSession();
	const navigate = useNavigate();

	const userProfile = useQuery(orpc.getUserProfile.queryOptions());
	const userRole = userProfile.data?.role;
	const canAccess = userRole
		? PERMISSIONS.canAccessTiempoCierreReport(userRole)
		: false;
	const isPending = sessionPending || userProfile.isPending;

	useEffect(() => {
		if (
			shouldRedirectToLogin({
				error: sessionError,
				isPending: sessionPending,
				session,
			})
		) {
			navigate({ to: "/login" });
		} else if (session && !userProfile.isPending && !canAccess) {
			navigate({ to: "/dashboard" });
			toast.error("Acceso denegado");
		}
	}, [
		session,
		sessionError,
		sessionPending,
		userProfile.isPending,
		canAccess,
		navigate,
	]);

	if (isPending) {
		return (
			<div className="flex h-96 items-center justify-center text-muted-foreground">
				Cargando...
			</div>
		);
	}

	if (!canAccess) return null;

	return (
		<div className="container mx-auto space-y-6 p-6">
			<TiempoCierreContent />
		</div>
	);
}

export function TiempoCierreContent() {
	const [dateRange, setDateRange] = useState<DateRange | undefined>(() =>
		rangeForPreset(DEFAULT_PRESET),
	);

	const input =
		dateRange?.from && dateRange?.to
			? {
					startDate: formatDateInput(dateRange.from),
					endDate: formatDateInput(dateRange.to),
				}
			: null;

	const reportQuery = useQuery({
		...orpc.getReporteTiempoCierre.queryOptions({
			input: input ?? { startDate: "", endDate: "" },
		}),
		enabled: !!input,
	});

	const data = reportQuery.data;
	const isLoading = reportQuery.isLoading;

	const chartData = (data?.porFuente ?? [])
		.map((row) => ({
			rawSource: row.source,
			source: getSourceLabel(row.source),
			avgDias: row.avgDias,
			minDias: row.minDias,
			maxDias: row.maxDias,
			totalCreditos: row.totalCreditos,
		}))
		.sort((a, b) => a.avgDias - b.avgDias);

	const chartHeight = Math.max(280, chartData.length * BAR_HEIGHT_PX);
	const channelTypeData = data?.porTipoCanal ?? [];

	return (
		<div className="space-y-6">
			<div>
				<h1 className="font-bold text-3xl tracking-tight">
					Tiempo Cierre Crédito
				</h1>
				<p className="mt-1 text-muted-foreground">
					Días promedio desde la creación del prospecto hasta el cierre del
					crédito (etapa 90%+), desglosado por fuente.
				</p>
			</div>

			<RangePresetFilter
				dateRange={dateRange}
				onDateRangeChange={setDateRange}
			/>

			<div className="grid gap-4 md:grid-cols-4">
				<ReportCard
					title="Créditos Analizados"
					value={isLoading ? "—" : (data?.total.totalCreditos ?? 0)}
					description="Créditos cerrados en el período"
					icon={Activity}
				/>
				<ReportCard
					title="Promedio General"
					value={isLoading ? "—" : `${data?.total.avgDias ?? 0} días`}
					description="Tiempo promedio total del período"
					icon={Clock}
				/>
				<ReportCard
					title="Cierre Más Rápido"
					value={isLoading ? "—" : `${data?.total.minDias ?? 0} días`}
					description="Tiempo mínimo registrado"
					icon={TrendingDown}
				/>
				<ReportCard
					title="Cierre Más Lento"
					value={isLoading ? "—" : `${data?.total.maxDias ?? 0} días`}
					description="Tiempo máximo registrado"
					icon={TrendingUp}
				/>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Promedio de días por fuente</CardTitle>
					<CardDescription>
						Ordenado de menor a mayor tiempo de cierre
					</CardDescription>
				</CardHeader>
				<CardContent>
					{isLoading ? (
						<div className="flex h-[280px] items-center justify-center text-muted-foreground">
							Cargando datos...
						</div>
					) : chartData.length === 0 ? (
						<div className="flex h-[280px] items-center justify-center text-muted-foreground">
							No hay datos para el período seleccionado
						</div>
					) : (
						<ResponsiveContainer width="100%" height={chartHeight}>
							<BarChart
								data={chartData}
								layout="vertical"
								margin={{ top: 0, right: 48, left: 0, bottom: 0 }}
							>
								<CartesianGrid strokeDasharray="3 3" horizontal={false} />
								<XAxis
									type="number"
									tickFormatter={(v: number) => `${v}d`}
									tick={{ fontSize: 12 }}
								/>
								<YAxis
									dataKey="source"
									type="category"
									width={110}
									tick={{ fontSize: 12 }}
								/>
								<Tooltip
									formatter={(value) => [`${value} días`, "Promedio"]}
									labelFormatter={(label) => `Fuente: ${label}`}
								/>
								<Bar
									dataKey="avgDias"
									name="Días promedio"
									radius={[0, 4, 4, 0]}
								>
									{chartData.map((entry) => (
										<Cell
											key={entry.rawSource}
											fill={getSourceColor(entry.rawSource)}
										/>
									))}
								</Bar>
							</BarChart>
						</ResponsiveContainer>
					)}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Subtotales por tipo de canal</CardTitle>
					<CardDescription>
						Agrupación de fuentes para comparar tiempos de cierre por esfuerzo
					</CardDescription>
				</CardHeader>
				<CardContent>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Tipo de canal</TableHead>
								<TableHead className="text-right">Créditos</TableHead>
								<TableHead className="text-right">Promedio (días)</TableHead>
								<TableHead className="text-right">Mínimo (días)</TableHead>
								<TableHead className="text-right">Máximo (días)</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{isLoading ? (
								<TableRow>
									<TableCell
										colSpan={5}
										className="py-8 text-center text-muted-foreground"
									>
										Cargando...
									</TableCell>
								</TableRow>
							) : channelTypeData.length === 0 ? (
								<TableRow>
									<TableCell
										colSpan={5}
										className="py-8 text-center text-muted-foreground"
									>
										No hay datos para el período seleccionado
									</TableCell>
								</TableRow>
							) : (
								channelTypeData.map((row) => (
									<TableRow key={row.tipoCanal}>
										<TableCell className="font-medium">
											{row.tipoCanal}
										</TableCell>
										<TableCell className="text-right">
											{row.totalCreditos}
										</TableCell>
										<TableCell className="text-right font-semibold">
											{row.avgDias}
										</TableCell>
										<TableCell className="text-right text-green-600 dark:text-green-400">
											{row.minDias}
										</TableCell>
										<TableCell className="text-right text-orange-600 dark:text-orange-400">
											{row.maxDias}
										</TableCell>
									</TableRow>
								))
							)}
						</TableBody>
					</Table>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Detalle por fuente</CardTitle>
					<CardDescription>
						Estadísticas completas de tiempo de cierre por canal de origen
					</CardDescription>
				</CardHeader>
				<CardContent>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Fuente</TableHead>
								<TableHead className="text-right">Créditos</TableHead>
								<TableHead className="text-right">Promedio (días)</TableHead>
								<TableHead className="text-right">Mínimo (días)</TableHead>
								<TableHead className="text-right">Máximo (días)</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{isLoading ? (
								<TableRow>
									<TableCell
										colSpan={5}
										className="py-8 text-center text-muted-foreground"
									>
										Cargando...
									</TableCell>
								</TableRow>
							) : chartData.length === 0 ? (
								<TableRow>
									<TableCell
										colSpan={5}
										className="py-8 text-center text-muted-foreground"
									>
										No hay datos para el período seleccionado
									</TableCell>
								</TableRow>
							) : (
								chartData.map((row) => (
									<TableRow key={row.rawSource}>
										<TableCell className="font-medium">
											<div className="flex items-center gap-2">
												<span
													className="h-2.5 w-2.5 shrink-0 rounded-full"
													style={{
														backgroundColor: getSourceColor(row.rawSource),
													}}
												/>
												{row.source}
											</div>
										</TableCell>
										<TableCell className="text-right">
											{row.totalCreditos}
										</TableCell>
										<TableCell className="text-right font-semibold">
											{row.avgDias}
										</TableCell>
										<TableCell className="text-right text-green-600 dark:text-green-400">
											{row.minDias ?? 0}
										</TableCell>
										<TableCell className="text-right text-orange-600 dark:text-orange-400">
											{row.maxDias ?? 0}
										</TableCell>
									</TableRow>
								))
							)}
						</TableBody>
					</Table>
				</CardContent>
			</Card>
		</div>
	);
}
