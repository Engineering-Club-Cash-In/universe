import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
	Activity,
	CheckCircle2,
	Download,
	Target,
	XCircle,
} from "lucide-react";
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
import { authClient } from "@/lib/auth-client";
import { shouldRedirectToLogin } from "@/lib/auth-session";
import { getSourceLabel } from "@/lib/crm-formatters";
import { PERMISSIONS } from "@/lib/roles";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/crm/reportes/porcentaje-efectividad")({
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

function formatDisplayDate(date: Date | string | null): string {
	if (!date) return "—";
	return new Intl.DateTimeFormat("es-GT", {
		timeZone: GUATEMALA_TZ,
		day: "2-digit",
		month: "2-digit",
		year: "numeric",
	}).format(new Date(date));
}

// Prefija celdas que empiecen con operadores de fórmula para evitar CSV injection
function sanitizeCSVCell(value: string): string {
	return /^[=+\-@]/.test(value) ? `'${value}` : value;
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
		? PERMISSIONS.canAccessPorcentajeEfectividadReport(userRole)
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
			<PorcentajeEfectividadContent />
		</div>
	);
}

export function PorcentajeEfectividadContent() {
	const [dateRange, setDateRange] = useState<DateRange | undefined>(() =>
		rangeForPreset(DEFAULT_PRESET),
	);
	const [pageSize, setPageSize] = useState(25);
	const [page, setPage] = useState(0);

	const input =
		dateRange?.from && dateRange?.to
			? {
					startDate: formatDateInput(dateRange.from),
					endDate: formatDateInput(dateRange.to),
				}
			: null;

	const reportQuery = useQuery({
		...orpc.getReportePorcentajeEfectividad.queryOptions({
			input: input ?? { startDate: "", endDate: "" },
		}),
		enabled: !!input,
	});

	// Reiniciar página al recibir datos nuevos
	useEffect(() => {
		setPage(0);
	}, [reportQuery.data]);

	const data = reportQuery.data;
	const isLoading = reportQuery.isLoading;

	const allRegistros = data?.registros ?? [];
	const totalPages = Math.ceil(allRegistros.length / pageSize);
	const visibleRegistros = allRegistros.slice(
		page * pageSize,
		(page + 1) * pageSize,
	);

	// exportCSV cierra sobre allRegistros para que el tipo sea inferido por oRPC
	function exportCSV() {
		const headers = [
			"Fecha",
			"Prospecto",
			"Fuente",
			"Etapa",
			"% Etapa",
			"¿Cerró?",
		];
		const rows = allRegistros.map((row) => [
			formatDisplayDate(row.createdAt),
			row.nombre || "Sin nombre",
			getSourceLabel(row.source),
			row.etapaNombre || "Sin etapa",
			row.etapaPorcentaje != null ? `${row.etapaPorcentaje}%` : "",
			row.cerro ? "Sí" : "No",
		]);
		const csv = [headers, ...rows]
			.map((row) =>
				row
					.map(
						(cell) => `"${sanitizeCSVCell(String(cell)).replace(/"/g, '""')}"`,
					)
					.join(","),
			)
			.join("\n");
		// BOM para que Excel en Windows interprete UTF-8 correctamente
		const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8;" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		// formatDateInput usa zona horaria de Guatemala, consistente con el resto del archivo
		a.download = `efectividad-${formatDateInput(new Date())}.csv`;
		a.click();
		URL.revokeObjectURL(url);
	}

	const chartData = (data?.porFuente ?? [])
		.map((row) => ({
			rawSource: row.source,
			source: getSourceLabel(row.source),
			porcentaje: row.porcentaje,
			totalOportunidades: row.totalOportunidades,
			totalCerradas: row.totalCerradas,
			totalCierresPeriodo: row.totalCierresPeriodo,
		}))
		.sort((a, b) => b.porcentaje - a.porcentaje);

	const chartHeight = Math.max(280, chartData.length * BAR_HEIGHT_PX);

	return (
		<div className="space-y-6">
			<div>
				<h1 className="font-bold text-3xl tracking-tight">
					Porcentaje Efectividad
				</h1>
				<p className="mt-1 text-muted-foreground">
					Creadas en el rango y cierres del período por medio.
				</p>
			</div>

			<RangePresetFilter
				dateRange={dateRange}
				onDateRangeChange={setDateRange}
			/>

			{/* ── Resumen estadístico ── */}
			<div className="grid gap-4 md:grid-cols-4">
				<ReportCard
					title="Oportunidades creadas"
					value={isLoading ? "—" : (data?.total.totalOportunidades ?? 0)}
					description="En el rango"
					icon={Activity}
				/>
				<ReportCard
					title="Cerradas (creadas)"
					value={isLoading ? "—" : (data?.total.totalCerradas ?? 0)}
					description="Creadas en el rango"
					icon={CheckCircle2}
				/>
				<ReportCard
					title="Cierres del período"
					value={isLoading ? "—" : (data?.total.totalCierresPeriodo ?? 0)}
					description="Primer 90%+ en el rango"
					icon={CheckCircle2}
				/>
				<ReportCard
					title="Efectividad (creadas)"
					value={isLoading ? "—" : `${data?.total.porcentaje ?? 0}%`}
					description="Cerradas / creadas"
					icon={Target}
				/>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Efectividad de creadas por fuente</CardTitle>
					<CardDescription>
						Cerradas de oportunidades creadas en el rango
					</CardDescription>
				</CardHeader>
				<CardContent>
					{isLoading ? (
						<div className="flex h-[280px] items-center justify-center text-muted-foreground">
							Cargando...
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
								margin={{ top: 0, right: 56, left: 0, bottom: 0 }}
							>
								<CartesianGrid strokeDasharray="3 3" horizontal={false} />
								<XAxis
									type="number"
									domain={[0, 100]}
									tickFormatter={(v: number) => `${v}%`}
									tick={{ fontSize: 12 }}
								/>
								<YAxis
									dataKey="source"
									type="category"
									width={110}
									tick={{ fontSize: 12 }}
								/>
								<Tooltip
									formatter={(value) => [`${value}%`, "Efectividad"]}
									labelFormatter={(label) => `Fuente: ${label}`}
								/>
								<Bar
									dataKey="porcentaje"
									name="Efectividad"
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
					<CardTitle>Detalle por fuente</CardTitle>
					<CardDescription>
						Creadas y cierres del rango por medio
					</CardDescription>
				</CardHeader>
				<CardContent>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Fuente</TableHead>
								<TableHead className="text-right">Creadas</TableHead>
								<TableHead className="text-right">Cerradas (creadas)</TableHead>
								<TableHead className="text-right">Cierres período</TableHead>
								<TableHead className="text-right">Efectividad</TableHead>
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
											{row.totalOportunidades}
										</TableCell>
										<TableCell className="text-right">
											{row.totalCerradas}
										</TableCell>
										<TableCell className="text-right">
											{row.totalCierresPeriodo}
										</TableCell>
										<TableCell className="text-right font-semibold">
											{row.porcentaje}%
										</TableCell>
									</TableRow>
								))
							)}
						</TableBody>
					</Table>
				</CardContent>
			</Card>

			{/* ── Registros individuales (detalle) ── */}
			<Card>
				<CardHeader>
					<div className="flex items-start justify-between gap-4">
						<div>
							<CardTitle>Oportunidades del período</CardTitle>
							<CardDescription className="mt-1">
								Todas las oportunidades creadas en el rango seleccionado y su
								estado de conversión
							</CardDescription>
						</div>
						{allRegistros.length > 0 && (
							<Button
								variant="outline"
								size="sm"
								className="shrink-0"
								onClick={exportCSV}
							>
								<Download className="mr-2 h-4 w-4" />
								Exportar CSV
							</Button>
						)}
					</div>
				</CardHeader>
				<CardContent className="space-y-3">
					<div className="max-h-[600px] overflow-y-auto rounded-md border">
						<Table>
							<TableHeader className="sticky top-0 z-10 bg-background">
								<TableRow>
									<TableHead>Fecha</TableHead>
									<TableHead>Prospecto</TableHead>
									<TableHead>Fuente</TableHead>
									<TableHead>Etapa actual</TableHead>
									<TableHead className="text-center">¿Cerró?</TableHead>
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
								) : visibleRegistros.length === 0 ? (
									<TableRow>
										<TableCell
											colSpan={5}
											className="py-8 text-center text-muted-foreground"
										>
											No hay datos para el período seleccionado
										</TableCell>
									</TableRow>
								) : (
									visibleRegistros.map((row) => (
										<TableRow key={row.id}>
											<TableCell className="whitespace-nowrap text-muted-foreground text-sm">
												{formatDisplayDate(row.createdAt)}
											</TableCell>
											<TableCell className="font-medium">
												{row.nombre || (
													<span className="text-muted-foreground italic">
														Sin nombre
													</span>
												)}
											</TableCell>
											<TableCell>
												<div className="flex items-center gap-2">
													<span
														className="h-2 w-2 shrink-0 rounded-full"
														style={{
															backgroundColor: getSourceColor(row.source),
														}}
													/>
													{getSourceLabel(row.source)}
												</div>
											</TableCell>
											<TableCell>
												{row.etapaNombre ? (
													<span className="text-sm">
														{row.etapaNombre}{" "}
														<span className="text-muted-foreground">
															({row.etapaPorcentaje}%)
														</span>
													</span>
												) : (
													<span className="text-muted-foreground text-sm italic">
														Sin etapa
													</span>
												)}
											</TableCell>
											<TableCell className="text-center">
												{row.cerro ? (
													<Badge className="gap-1 bg-green-100 text-green-700 hover:bg-green-100 dark:bg-green-900/30 dark:text-green-400">
														<CheckCircle2 className="h-3 w-3" />
														Sí
													</Badge>
												) : (
													<Badge
														variant="outline"
														className="gap-1 text-muted-foreground"
													>
														<XCircle className="h-3 w-3" />
														No
													</Badge>
												)}
											</TableCell>
										</TableRow>
									))
								)}
							</TableBody>
						</Table>
					</div>

					{/* Footer: paginación + selector de page size */}
					{!isLoading && allRegistros.length > 0 && (
						<div className="flex items-center justify-between text-muted-foreground text-sm">
							<span>
								{`Mostrando ${page * pageSize + 1}–${Math.min((page + 1) * pageSize, allRegistros.length)} de ${allRegistros.length} registros`}
							</span>
							<div className="flex items-center gap-3">
								<div className="flex items-center gap-2">
									<span>Mostrar</span>
									<Select
										value={String(pageSize)}
										onValueChange={(v) => {
											setPageSize(Number(v));
											setPage(0);
										}}
									>
										<SelectTrigger className="h-7 w-16 text-xs">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="25">25</SelectItem>
											<SelectItem value="50">50</SelectItem>
											<SelectItem value="100">100</SelectItem>
										</SelectContent>
									</Select>
								</div>
								<div className="flex items-center gap-1">
									<Button
										variant="outline"
										size="sm"
										className="h-7 px-2 text-xs"
										disabled={page === 0}
										onClick={() => setPage((p) => p - 1)}
									>
										Anterior
									</Button>
									<span className="px-2">
										{page + 1} / {totalPages}
									</span>
									<Button
										variant="outline"
										size="sm"
										className="h-7 px-2 text-xs"
										disabled={page + 1 >= totalPages}
										onClick={() => setPage((p) => p + 1)}
									>
										Siguiente
									</Button>
								</div>
							</div>
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
