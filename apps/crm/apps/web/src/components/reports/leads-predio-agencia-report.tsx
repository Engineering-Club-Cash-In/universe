import { useQuery } from "@tanstack/react-query";
import {
	Briefcase,
	CheckCircle2,
	DollarSign,
	Download,
	Percent,
	Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { DateRange } from "react-day-picker";
import {
	Bar,
	BarChart,
	CartesianGrid,
	Legend,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import {
	DEFAULT_PRESET,
	RangePresetFilter,
	rangeForPreset,
} from "@/components/reports/range-preset-filter";
import { ReportCard } from "@/components/reports/report-card";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
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
import { formatCurrency, getStatusLabel } from "@/lib/crm-formatters";
import { orpc } from "@/utils/orpc";

const GUATEMALA_TZ = "America/Guatemala";
const SIN_ASIGNAR = "sin_asignar";
const TODOS = "todos";
const SIN_ATRIBUCION = "—";
const BAR_HEIGHT_PX = 44;
const COLOR_AGENCIA = "#14b8a6";
const COLOR_PREDIO = "#f59e0b";

type TipoFilter = "todos" | "agency" | "property";

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

// Prefija con apóstrofe las celdas que empiezan con fórmula o con tab/CR/LF (CSV injection)
function sanitizeCSVCell(value: string): string {
	return /^[=+\-@\t\r\n]/.test(value) ? `'${value}` : value;
}

function tipoLabel(source: "agency" | "property"): string {
	return source === "agency" ? "Agencia" : "Predio";
}

function atribucionLabel(atribucion: "lead" | "oportunidad" | null): string {
	if (atribucion === "lead") return "Lead";
	if (atribucion === "oportunidad") return "Oportunidad";
	return SIN_ATRIBUCION;
}

function etapaLabel(
	etapaNombre: string | null,
	etapaPorcentaje: number | null,
): string {
	return etapaNombre
		? `${etapaNombre} (${etapaPorcentaje}%)`
		: "Sin oportunidad";
}

export function LeadsPredioAgenciaContent() {
	const [dateRange, setDateRange] = useState<DateRange | undefined>(() =>
		rangeForPreset(DEFAULT_PRESET),
	);
	const [tipo, setTipo] = useState<TipoFilter>(TODOS);
	const [companyFilter, setCompanyFilter] = useState<string>(TODOS);
	const [pageSize, setPageSize] = useState(25);
	const [page, setPage] = useState(0);

	const companiesQuery = useQuery(orpc.getCompaniesForContracts.queryOptions());
	const companyOptions = useMemo(
		() =>
			[...(companiesQuery.data ?? [])]
				.sort((a, b) => a.name.localeCompare(b.name, "es"))
				.map((company) => ({ value: company.id, label: company.name })),
		[companiesQuery.data],
	);

	const input =
		dateRange?.from && dateRange?.to
			? {
					startDate: formatDateInput(dateRange.from),
					endDate: formatDateInput(dateRange.to),
					...(tipo !== TODOS && { tipo }),
					...(companyFilter !== TODOS && {
						companyId: companyFilter,
					}),
				}
			: null;

	const reportQuery = useQuery({
		...orpc.getReporteLeadsPredioAgencia.queryOptions({
			input: input ?? { startDate: "", endDate: "" },
		}),
		enabled: !!input,
	});
	const data = reportQuery.data;

	// Reiniciar página al recibir datos nuevos
	useEffect(() => {
		if (data) setPage(0);
	}, [data]);

	const isLoading = reportQuery.isLoading;
	const totales = data?.totales;
	const porEmpresa = data?.porEmpresa ?? [];
	// "Sin predio/agencia" es un hueco de captura, no un socio: queda en la tabla, no en la gráfica.
	const chartData = porEmpresa.filter((row) => row.companyId !== null);
	const chartHeight = Math.max(280, chartData.length * BAR_HEIGHT_PX + 40);

	const allRegistros = data?.registros ?? [];
	const totalPages = Math.ceil(allRegistros.length / pageSize);
	const visibleRegistros = allRegistros.slice(
		page * pageSize,
		(page + 1) * pageSize,
	);

	function exportCSV() {
		const headers = [
			"Fecha",
			"Lead",
			"Tipo",
			"Predio / agencia",
			"Vendedor agencia",
			"Asesor",
			"Estado lead",
			"Etapa",
			"¿Cerró?",
			"Monto (Q)",
			"Atribución",
		];
		const rows = allRegistros.map((row) => [
			formatDisplayDate(row.createdAt),
			row.nombre || "Sin nombre",
			tipoLabel(row.source),
			row.companyName ?? "Sin predio/agencia",
			row.vendedorAgencia ?? "—",
			row.asesor ?? "—",
			getStatusLabel(row.leadStatus),
			etapaLabel(row.etapaNombre, row.etapaPorcentaje),
			row.cerro ? "Sí" : "No",
			row.monto != null ? row.monto.toFixed(2) : "",
			atribucionLabel(row.atribucion),
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
		a.download = `leads-predio-agencia-${input?.startDate}-a-${input?.endDate}.csv`;
		a.click();
		URL.revokeObjectURL(url);
	}

	return (
		<div className="space-y-6">
			<div>
				<h1 className="font-bold text-3xl tracking-tight">
					Leads por predio/agencia
				</h1>
				<p className="mt-1 text-muted-foreground">
					Leads creados en el rango y su conversión a crédito cerrado, agrupados
					por predio o agencia.
				</p>
			</div>

			<div className="flex flex-wrap items-end gap-4">
				<RangePresetFilter
					dateRange={dateRange}
					onDateRangeChange={setDateRange}
				/>
				<div className="space-y-2">
					<span className="font-medium text-sm">Tipo</span>
					<Select value={tipo} onValueChange={(v) => setTipo(v as TipoFilter)}>
						<SelectTrigger className="w-40">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value={TODOS}>Todos</SelectItem>
							<SelectItem value="agency">Agencia</SelectItem>
							<SelectItem value="property">Predio</SelectItem>
						</SelectContent>
					</Select>
				</div>
				<div className="space-y-2">
					<span className="font-medium text-sm">Predio / agencia</span>
					<Combobox
						options={[
							{ value: TODOS, label: "Todos" },
							{ value: SIN_ASIGNAR, label: "Sin predio/agencia" },
							...companyOptions,
						]}
						value={companyFilter}
						onChange={(value) => setCompanyFilter(value || TODOS)}
						placeholder="Buscar predio / agencia"
						width="min"
						popOverWidth="auto"
					/>
				</div>
			</div>

			{reportQuery.isError && (
				<p className="text-destructive text-sm">
					No se pudo cargar el reporte. Intenta de nuevo.
				</p>
			)}

			{/* ── Resumen estadístico ── */}
			<div className="grid gap-4 md:grid-cols-3 xl:grid-cols-5">
				<ReportCard
					title="Leads"
					value={isLoading ? "—" : (totales?.leads ?? 0)}
					description="En el rango"
					icon={Users}
				/>
				<ReportCard
					title="Con oportunidad"
					value={isLoading ? "—" : (totales?.conOportunidad ?? 0)}
					description="Leads con oportunidad"
					icon={Briefcase}
				/>
				<ReportCard
					title="Créditos cerrados"
					value={isLoading ? "—" : (totales?.cerrados ?? 0)}
					description="Leads con cierre"
					icon={CheckCircle2}
				/>
				<ReportCard
					title="Monto colocado"
					value={isLoading ? "—" : formatCurrency(totales?.monto ?? 0)}
					description="Suma de créditos cerrados"
					icon={DollarSign}
				/>
				<ReportCard
					title="Conversión"
					value={isLoading ? "—" : `${totales?.conversion ?? 0}%`}
					description="Leads que llegaron a cierre (90%)"
					icon={Percent}
				/>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Predios / agencias por leads</CardTitle>
					<CardDescription>
						Todos los predios / agencias con leads en el rango, separados por
						tipo de fuente
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
						<div className="max-h-[600px] overflow-y-auto">
							<ResponsiveContainer width="100%" height={chartHeight}>
								<BarChart
									data={chartData}
									layout="vertical"
									barSize={20}
									margin={{ top: 0, right: 48, left: 0, bottom: 0 }}
								>
									<CartesianGrid strokeDasharray="3 3" horizontal={false} />
									<XAxis
										type="number"
										allowDecimals={false}
										tick={{ fontSize: 12 }}
									/>
									<YAxis
										dataKey="nombre"
										type="category"
										width={220}
										interval={0}
										tick={{ fontSize: 11 }}
									/>
									<Tooltip
										labelFormatter={(label) => `Predio / agencia: ${label}`}
									/>
									<Legend verticalAlign="top" height={32} />
									<Bar
										dataKey="leadsAgencia"
										name="Agencia"
										stackId="leads"
										fill={COLOR_AGENCIA}
									/>
									<Bar
										dataKey="leadsPredio"
										name="Predio"
										stackId="leads"
										fill={COLOR_PREDIO}
									/>
								</BarChart>
							</ResponsiveContainer>
						</div>
					)}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Leads por predio / agencia</CardTitle>
					<CardDescription>
						Atribución de cada lead a su predio o agencia
					</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="max-h-[480px] overflow-y-auto rounded-md border">
						<Table>
							<TableHeader className="sticky top-0 z-10 bg-background">
								<TableRow>
									<TableHead>Predio / agencia</TableHead>
									<TableHead className="text-right">Agencia</TableHead>
									<TableHead className="text-right">Predio</TableHead>
									<TableHead className="text-right">Leads</TableHead>
									<TableHead className="text-right">Con oportunidad</TableHead>
									<TableHead className="text-right">Cerrados</TableHead>
									<TableHead className="text-right">Monto</TableHead>
									<TableHead className="text-right">Conversión</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{isLoading ? (
									<TableRow>
										<TableCell
											colSpan={8}
											className="py-8 text-center text-muted-foreground"
										>
											Cargando...
										</TableCell>
									</TableRow>
								) : porEmpresa.length === 0 ? (
									<TableRow>
										<TableCell
											colSpan={8}
											className="py-8 text-center text-muted-foreground"
										>
											No hay leads de predios o agencias en el período
											seleccionado.
										</TableCell>
									</TableRow>
								) : (
									porEmpresa.map((row) => {
										const sinAsignar = row.companyId === null;
										const muted = sinAsignar ? "text-muted-foreground" : "";
										return (
											<TableRow key={row.companyId ?? SIN_ASIGNAR}>
												<TableCell className={`font-medium ${muted}`}>
													{row.nombre}
												</TableCell>
												<TableCell className={`text-right ${muted}`}>
													{row.leadsAgencia}
												</TableCell>
												<TableCell className={`text-right ${muted}`}>
													{row.leadsPredio}
												</TableCell>
												<TableCell className={`text-right ${muted}`}>
													{row.leads}
												</TableCell>
												<TableCell className={`text-right ${muted}`}>
													{row.conOportunidad}
												</TableCell>
												<TableCell className={`text-right ${muted}`}>
													{row.cerrados}
												</TableCell>
												<TableCell className={`text-right ${muted}`}>
													{formatCurrency(row.monto)}
												</TableCell>
												<TableCell
													className={`text-right font-semibold ${muted}`}
												>
													{row.conversion}%
												</TableCell>
											</TableRow>
										);
									})
								)}
							</TableBody>
						</Table>
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<div className="flex items-start justify-between gap-4">
						<div>
							<CardTitle>Detalle de leads</CardTitle>
							<CardDescription className="mt-1">
								Cada lead creado en el rango con su predio / agencia y estado de
								conversión
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
									<TableHead>Lead</TableHead>
									<TableHead>Tipo</TableHead>
									<TableHead>Predio / agencia</TableHead>
									<TableHead>Vendedor agencia</TableHead>
									<TableHead>Asesor</TableHead>
									<TableHead>Estado lead</TableHead>
									<TableHead>Etapa</TableHead>
									<TableHead className="text-center">¿Cerró?</TableHead>
									<TableHead className="text-right">Monto</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{isLoading ? (
									<TableRow>
										<TableCell
											colSpan={10}
											className="py-8 text-center text-muted-foreground"
										>
											Cargando...
										</TableCell>
									</TableRow>
								) : visibleRegistros.length === 0 ? (
									<TableRow>
										<TableCell
											colSpan={10}
											className="py-8 text-center text-muted-foreground"
										>
											No hay datos para el período seleccionado
										</TableCell>
									</TableRow>
								) : (
									visibleRegistros.map((row) => (
										<TableRow key={row.leadId}>
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
											<TableCell>{tipoLabel(row.source)}</TableCell>
											<TableCell>
												{row.companyName ? (
													row.companyName
												) : (
													<span className="text-muted-foreground italic">
														Sin predio/agencia
													</span>
												)}
												{row.atribucion === "oportunidad" && (
													<span
														className="ml-1 text-muted-foreground text-xs"
														title="El lead no tiene predio/agencia; se tomó el de su oportunidad"
													>
														(desde oportunidad)
													</span>
												)}
											</TableCell>
											<TableCell>{row.vendedorAgencia ?? "—"}</TableCell>
											<TableCell>{row.asesor ?? "—"}</TableCell>
											<TableCell>{getStatusLabel(row.leadStatus)}</TableCell>
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
														Sin oportunidad
													</span>
												)}
											</TableCell>
											<TableCell className="text-center">
												{row.cerro ? "Sí" : "No"}
											</TableCell>
											<TableCell className="text-right">
												{row.monto != null ? (
													formatCurrency(row.monto)
												) : (
													<span className="text-muted-foreground">—</span>
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
