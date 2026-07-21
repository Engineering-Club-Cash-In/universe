import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Activity, ArrowRightCircle, CheckCircle2, ListChecks } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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

export const Route = createFileRoute("/crm/reportes/efectividad-por-etapa")({
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
		? PERMISSIONS.canAccessEfectividadPorEtapaReport(userRole)
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
			<EfectividadPorEtapaContent />
		</div>
	);
}

export function EfectividadPorEtapaContent() {
	const [dateRange, setDateRange] = useState<DateRange | undefined>(() =>
		rangeForPreset(DEFAULT_PRESET),
	);
	const [selectedStageId, setSelectedStageId] = useState<string | null>(null);

	const input =
		dateRange?.from && dateRange?.to
			? {
					startDate: formatDateInput(dateRange.from),
					endDate: formatDateInput(dateRange.to),
				}
			: null;

	const reportQuery = useQuery({
		...orpc.getReporteEfectividadPorEtapa.queryOptions({
			input: input ?? { startDate: "", endDate: "" },
		}),
		enabled: !!input,
	});
	const data = reportQuery.data;
	const isLoading = reportQuery.isLoading;

	const porEtapa = data?.porEtapa ?? [];
	const porEtapaFuente = data?.porEtapaFuente ?? [];

	const activeStageId = selectedStageId ?? porEtapa[0]?.stageId ?? null;
	const activeStage = porEtapa.find((e) => e.stageId === activeStageId) ?? null;

	const chartData = useMemo(
		() =>
			porEtapaFuente
				.filter((row) => row.stageId === activeStageId)
				.map((row) => ({
					rawSource: row.source,
					source: getSourceLabel(row.source),
					pctEfectividad: row.pctEfectividad,
					pctAvance: row.pctAvance,
					llegaron: row.llegaron,
					avanzaron: row.avanzaron,
					cerraron: row.cerraron,
				}))
				.sort((a, b) => b.pctEfectividad - a.pctEfectividad),
		[porEtapaFuente, activeStageId],
	);

	const chartHeight = Math.max(280, chartData.length * BAR_HEIGHT_PX);

	return (
		<div className="space-y-6">
			<div>
				<h1 className="font-bold text-3xl tracking-tight">
					Efectividad por Etapa
				</h1>
				<p className="mt-1 text-muted-foreground">
					De las oportunidades creadas en el rango, cuántas llegan a cada una de
					las primeras 4 etapas del pipeline, cuántas avanzan más allá y cuántas
					terminan cerrando.
				</p>
			</div>

			<RangePresetFilter dateRange={dateRange} onDateRangeChange={setDateRange} />

			{/* ── Progresión por Etapa ── */}
			<Card>
				<CardHeader>
					<CardTitle>Progresión por Etapa</CardTitle>
					<CardDescription>
						Preparación → Llamada de presentación → Solución y propuesta →
						Recepción de documentación y traslado a análisis
					</CardDescription>
				</CardHeader>
				<CardContent>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Etapa</TableHead>
								<TableHead className="text-right">Llegaron</TableHead>
								<TableHead className="text-right">Avanzaron</TableHead>
								<TableHead className="text-right">% Avance</TableHead>
								<TableHead className="text-right">Cerraron</TableHead>
								<TableHead className="text-right">% Efectividad</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{isLoading ? (
								<TableRow>
									<TableCell
										colSpan={6}
										className="py-8 text-center text-muted-foreground"
									>
										Cargando...
									</TableCell>
								</TableRow>
							) : porEtapa.length === 0 ? (
								<TableRow>
									<TableCell
										colSpan={6}
										className="py-8 text-center text-muted-foreground"
									>
										No hay datos para el período seleccionado
									</TableCell>
								</TableRow>
							) : (
								porEtapa.map((row) => (
									<TableRow
										key={row.stageId}
										className={
											row.stageId === activeStageId ? "bg-muted/50" : undefined
										}
									>
										<TableCell className="font-medium">
											{row.stageName}
										</TableCell>
										<TableCell className="text-right">{row.llegaron}</TableCell>
										<TableCell className="text-right">
											{row.avanzaron}
										</TableCell>
										<TableCell className="text-right text-muted-foreground">
											{row.pctAvance}%
										</TableCell>
										<TableCell className="text-right">
											{row.cerraron}
										</TableCell>
										<TableCell className="text-right font-semibold">
											{row.pctEfectividad}%
										</TableCell>
									</TableRow>
								))
							)}
						</TableBody>
					</Table>
				</CardContent>
			</Card>

			{/* ── Selector de etapa + detalle por fuente ── */}
			<div className="flex items-center gap-3">
				<span className="text-muted-foreground text-sm">Ver detalle de:</span>
				<Select
					value={activeStageId ?? undefined}
					onValueChange={setSelectedStageId}
					disabled={porEtapa.length === 0}
				>
					<SelectTrigger className="w-[340px]">
						<SelectValue placeholder="Selecciona una etapa" />
					</SelectTrigger>
					<SelectContent>
						{porEtapa.map((row) => (
							<SelectItem key={row.stageId} value={row.stageId}>
								{row.stageName}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			{activeStage && (
				<div className="grid gap-4 md:grid-cols-4">
					<ReportCard
						title="Llegaron"
						value={isLoading ? "—" : activeStage.llegaron}
						description="Oportunidades en esta etapa"
						icon={Activity}
					/>
					<ReportCard
						title="Avanzaron"
						value={isLoading ? "—" : activeStage.avanzaron}
						description={`${activeStage.pctAvance}% avanzó más allá`}
						icon={ArrowRightCircle}
					/>
					<ReportCard
						title="Cerraron"
						value={isLoading ? "—" : activeStage.cerraron}
						description="Llegaron a etapa de cierre"
						icon={CheckCircle2}
					/>
					<ReportCard
						title="Efectividad"
						value={isLoading ? "—" : `${activeStage.pctEfectividad}%`}
						description="Cerraron / llegaron"
						icon={ListChecks}
					/>
				</div>
			)}

			<Card>
				<CardHeader>
					<CardTitle>Efectividad por fuente</CardTitle>
					<CardDescription>
						{activeStage
							? `Desglose por fuente para "${activeStage.stageName}"`
							: "Selecciona una etapa para ver el desglose"}
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
									dataKey="pctEfectividad"
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
						{activeStage
							? `Llegaron, avanzaron y cerraron por fuente en "${activeStage.stageName}"`
							: "Selecciona una etapa para ver el desglose"}
					</CardDescription>
				</CardHeader>
				<CardContent>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Fuente</TableHead>
								<TableHead className="text-right">Llegaron</TableHead>
								<TableHead className="text-right">Avanzaron</TableHead>
								<TableHead className="text-right">% Avance</TableHead>
								<TableHead className="text-right">Cerraron</TableHead>
								<TableHead className="text-right">% Efectividad</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{isLoading ? (
								<TableRow>
									<TableCell
										colSpan={6}
										className="py-8 text-center text-muted-foreground"
									>
										Cargando...
									</TableCell>
								</TableRow>
							) : chartData.length === 0 ? (
								<TableRow>
									<TableCell
										colSpan={6}
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
											{row.llegaron}
										</TableCell>
										<TableCell className="text-right">
											{row.avanzaron}
										</TableCell>
										<TableCell className="text-right text-muted-foreground">
											{row.pctAvance}%
										</TableCell>
										<TableCell className="text-right">
											{row.cerraron}
										</TableCell>
										<TableCell className="text-right font-semibold">
											{row.pctEfectividad}%
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
