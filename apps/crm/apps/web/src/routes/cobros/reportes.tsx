import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import {
	BarChart3,
	CalendarClock,
	RefreshCw,
	TrendingDown,
} from "lucide-react";
import { useState } from "react";
import { CapitalRangeFilter } from "@/components/cobros/capital-range-filter";
import { DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePersistedState } from "@/hooks/usePersistedState";
import { authClient } from "@/lib/auth-client";
import { PERMISSIONS } from "@/lib/roles";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/cobros/reportes")({
	component: RouteComponent,
});

// ─── shared helpers ────────────────────────────────────────────────────────

function fmtQ(v: string | number) {
	const n = Number.parseFloat(String(v));
	return `Q${isNaN(n) ? "0.00" : n.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtTime(d: Date) {
	return d.toLocaleTimeString("es-GT", {
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	});
}

// ─── Mora ──────────────────────────────────────────────────────────────────

const ETAPAS = [
	{
		key: "mora_30" as const,
		label: "Mora 30",
		color: "bg-yellow-100 text-yellow-800",
	},
	{
		key: "mora_60" as const,
		label: "Mora 60",
		color: "bg-orange-100 text-orange-800",
	},
	{
		key: "mora_90" as const,
		label: "Mora 90",
		color: "bg-red-100 text-red-800",
	},
	{
		key: "mora_120_plus" as const,
		label: "Mora 120+",
		color: "bg-red-300 text-red-950",
	},
];

function TabMora({
	session,
	canSeeAll,
}: {
	session: ReturnType<typeof authClient.useSession>["data"];
	canSeeAll: boolean;
}) {
	const emailCobrador = canSeeAll
		? undefined
		: (session?.user?.email ?? undefined);

	const { data, isLoading, dataUpdatedAt, refetch, isFetching } = useQuery({
		...orpc.getMoraByEtapaYAsesor.queryOptions({ input: { emailCobrador } }),
		enabled: !!session,
		refetchInterval: 60_000,
		refetchIntervalInBackground: false,
	});

	const ultimaAct = dataUpdatedAt ? fmtTime(new Date(dataUpdatedAt)) : null;

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<TrendingDown className="h-5 w-5 text-red-600" />
					<h2 className="font-semibold text-xl">Análisis de Mora</h2>
				</div>
				<div className="flex items-center gap-3">
					{ultimaAct && (
						<span className="text-muted-foreground text-xs">
							Actualizado: {ultimaAct}
						</span>
					)}
					<Button
						variant="outline"
						size="sm"
						onClick={() => refetch()}
						disabled={isFetching}
					>
						<RefreshCw
							className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`}
						/>
						Actualizar
					</Button>
				</div>
			</div>

			{isLoading ? (
				<div className="grid grid-cols-2 gap-4 md:grid-cols-4">
					{ETAPAS.map((e) => (
						<Card key={e.key}>
							<CardContent className="pt-6">
								<div className="h-12 animate-pulse rounded bg-muted" />
							</CardContent>
						</Card>
					))}
				</div>
			) : (
				<div className="grid grid-cols-2 gap-4 md:grid-cols-4">
					{ETAPAS.map((etapa) => {
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						const bucket = (data as any)?.totales?.[etapa.key];
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						const totalMora = parseFloat((data as any)?.totales?.totalEnMora?.sumaMora ?? "0");
						const pct = totalMora > 0 ? (parseFloat(bucket?.sumaMora ?? "0") / totalMora) * 100 : 0;
						return (
							<Card key={etapa.key}>
								<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
									<CardTitle className="font-medium text-sm">
										{etapa.label}
									</CardTitle>
									<Badge className={etapa.color}>{bucket?.cantidad ?? 0}</Badge>
								</CardHeader>
								<CardContent>
									<div className="font-bold text-2xl">
										{fmtQ(bucket?.sumaMora ?? "0")}
									</div>
									<p className="text-muted-foreground text-xs">
										Capital: {fmtQ(bucket?.sumaCapital ?? "0")}
									</p>
									<p className="mt-1 font-medium text-xs text-muted-foreground">
										{pct.toFixed(1)}% del total en mora
									</p>
								</CardContent>
							</Card>
						);
					})}
				</div>
			)}

			{/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
			{!!(data as any)?.totales?.totalEnMora && (
				<Card className="border-red-200 bg-red-50">
					<CardContent className="pt-4">
						<div className="flex items-center justify-between">
							<div>
								<p className="font-semibold text-red-700 text-sm">
									Total en Mora
								</p>
								{/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
								<p className="font-bold text-3xl text-red-800">
									{fmtQ((data as any).totales.totalEnMora.sumaMora)}
								</p>
							</div>
							{/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
							<div className="text-right">
								<p className="text-muted-foreground text-sm">Créditos</p>
								<p className="font-bold text-2xl">
									{(data as any).totales.totalEnMora.cantidad}
								</p>
							</div>
						</div>
					</CardContent>
				</Card>
			)}

			<div>
				<h3 className="mb-3 font-semibold text-base">Desglose por Asesor</h3>
				{isLoading ? (
					<div className="h-32 animate-pulse rounded bg-muted" />
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
				) : !(data as any)?.porAsesor?.length ? (
					<p className="text-muted-foreground text-sm">
						No hay datos disponibles.
					</p>
				) : (
					<div className="overflow-x-auto rounded-lg border">
						<table className="w-full text-sm">
							<thead className="bg-muted/50">
								<tr>
									<th className="px-4 py-3 text-left font-semibold">Asesor</th>
									{ETAPAS.map((e) => (
										<th
											key={e.key}
											className="px-4 py-3 text-right font-semibold"
										>
											{e.label}
										</th>
									))}
									<th className="px-4 py-3 text-right font-semibold">
										Total en Mora
									</th>
								</tr>
							</thead>
							<tbody>
								{/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
								{(data as any).porAsesor.map((asesor: any) => (
									<tr
										key={asesor.asesorId}
										className="border-t hover:bg-muted/30"
									>
										<td className="px-4 py-3 font-medium">{asesor.nombre}</td>
										{ETAPAS.map((etapa) => {
											const bucket = asesor[etapa.key];
											return (
												<td key={etapa.key} className="px-4 py-3 text-right">
													{bucket?.cantidad > 0 ? (
														<div>
															<div className="font-medium">
																{fmtQ(bucket.sumaMora)}
															</div>
															<div className="text-muted-foreground text-xs">
																{bucket.cantidad} créd.
															</div>
														</div>
													) : (
														<span className="text-muted-foreground">—</span>
													)}
												</td>
											);
										})}
										<td className="px-4 py-3 text-right">
											<div className="font-semibold text-red-700">
												{fmtQ(asesor.totalEnMora?.sumaMora ?? "0")}
											</div>
											<div className="text-muted-foreground text-xs">
												{asesor.totalEnMora?.cantidad ?? 0} créd.
											</div>
											{/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
											{(() => {
												const totalMora = parseFloat((data as any)?.totales?.totalEnMora?.sumaMora ?? "0");
												const pct = totalMora > 0 ? (parseFloat(asesor.totalEnMora?.sumaMora ?? "0") / totalMora) * 100 : 0;
												return pct > 0 ? (
													<div className="font-medium text-muted-foreground text-xs">
														{pct.toFixed(1)}%
													</div>
												) : null;
											})()}
										</td>
									</tr>
								))}
							</tbody>
							{/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
							{!!(data as any)?.totales && (
								<tfoot className="border-t-2 bg-muted/50 font-semibold">
									<tr>
										<td className="px-4 py-3">TOTAL</td>
										{ETAPAS.map((etapa) => {
											// eslint-disable-next-line @typescript-eslint/no-explicit-any
											const bucket = (data as any).totales[etapa.key];
											return (
												<td key={etapa.key} className="px-4 py-3 text-right">
													<div>{fmtQ(bucket?.sumaMora ?? "0")}</div>
													<div className="font-normal text-muted-foreground text-xs">
														{bucket?.cantidad ?? 0} créd.
													</div>
												</td>
											);
										})}
										<td className="px-4 py-3 text-right text-red-700">
											{/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
											<div>
												{fmtQ(
													(data as any).totales.totalEnMora?.sumaMora ?? "0",
												)}
											</div>
											{/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
											<div className="font-normal text-muted-foreground text-xs">
												{(data as any).totales.totalEnMora?.cantidad ?? 0} créd.
											</div>
										</td>
									</tr>
								</tfoot>
							)}
						</table>
					</div>
				)}
			</div>
		</div>
	);
}

// ─── Pagos Esperados ────────────────────────────────────────────────────────

type Temporalidad = "hoy" | "semana" | "quincena" | "mes";

const TEMPORALIDAD_LABELS: Record<Temporalidad, string> = {
	hoy: "Hoy",
	semana: "Esta Semana",
	quincena: "Esta Quincena",
	mes: "Este Mes",
};

const RUBROS = [
	{ key: "totalCuota" as const, label: "Total a Cobrar", highlight: true },
	{ key: "capital" as const, label: "Capital" },
	{ key: "interes" as const, label: "Interés" },
	{ key: "iva" as const, label: "IVA" },
	{ key: "seguro" as const, label: "Seguro" },
	{ key: "gps" as const, label: "GPS" },
	{ key: "membresias" as const, label: "Membresías" },
	{ key: "royalti" as const, label: "Royaltí" },
];

type DesgloseDia = {
	bucket: string;
	cuotas_count: number;
	total_cuota: string;
	total_interes: string;
	total_iva: string;
	total_seguro: string;
	total_gps: string;
	total_membresias: string;
	total_royalti: string;
};

// Buckets date-only se parsean como mediodía local para evitar que el
// offset de zona horaria los desplace al día anterior.
function fmtBucketDia(bucket: string) {
	const date = new Date(bucket.length === 10 ? `${bucket}T12:00:00` : bucket);
	return date.toLocaleDateString("es-GT", {
		weekday: "short",
		day: "2-digit",
		month: "short",
	});
}

// `total_cuota` de cartera-back es el capital; el total a cobrar de la fila
// es la suma de rubros (mismo criterio que el reporte monto-a-cobrar).
function totalDeFila(row: DesgloseDia) {
	return (
		Number.parseFloat(row.total_cuota) +
		Number.parseFloat(row.total_interes) +
		Number.parseFloat(row.total_iva) +
		Number.parseFloat(row.total_seguro) +
		Number.parseFloat(row.total_gps) +
		Number.parseFloat(row.total_membresias) +
		Number.parseFloat(row.total_royalti)
	);
}

type PagoNoRecibido = {
	sifco: string;
	clienteNombre: string;
	asesorNombre: string;
	cuotasAtrasadas: number;
	montoMora: string;
	capital: string;
	cuotaMensual: string;
	proximaFechaVencimiento: string | null;
	tipoCredito: string | null;
};

function getMoraBadge(cuotas: number) {
	if (cuotas >= 4)
		return <Badge className="bg-red-300 text-red-950">Mora 120+</Badge>;
	if (cuotas === 3)
		return <Badge className="bg-red-100 text-red-800">Mora 90</Badge>;
	if (cuotas === 2)
		return <Badge className="bg-orange-100 text-orange-800">Mora 60</Badge>;
	return <Badge className="bg-yellow-100 text-yellow-800">Mora 30</Badge>;
}

const colsPagos: ColumnDef<PagoNoRecibido>[] = [
	{
		accessorKey: "sifco",
		header: "Crédito",
		cell: ({ row }) => (
			<Link
				to="/cobros/$id"
				params={{ id: row.original.sifco }}
				search={{ tipo: "contrato" }}
				className="font-mono text-blue-600 text-xs hover:underline"
			>
				{row.original.sifco}
			</Link>
		),
	},
	{ accessorKey: "clienteNombre", header: "Cliente" },
	{ accessorKey: "asesorNombre", header: "Asesor" },
	{
		accessorKey: "cuotasAtrasadas",
		header: "Cuotas Atrasadas",
		cell: ({ row }) => getMoraBadge(row.original.cuotasAtrasadas),
	},
	{
		accessorKey: "montoMora",
		header: "Monto Mora",
		cell: ({ row }) => (
			<span className="font-medium text-red-700">
				{fmtQ(row.original.montoMora)}
			</span>
		),
	},
	{
		accessorKey: "capital",
		header: "Capital Restante",
		cell: ({ row }) => fmtQ(row.original.capital),
	},
	{
		accessorKey: "cuotaMensual",
		header: "Cuota Mensual",
		cell: ({ row }) => fmtQ(row.original.cuotaMensual),
	},
	{
		accessorKey: "proximaFechaVencimiento",
		header: "Próx. Vencimiento",
		cell: ({ row }) =>
			row.original.proximaFechaVencimiento
				? new Date(
						`${row.original.proximaFechaVencimiento}T00:00:00`,
					).toLocaleDateString("es-GT")
				: "—",
	},
];

function TabPagos({
	session,
	canSeeAll,
}: {
	session: ReturnType<typeof authClient.useSession>["data"];
	canSeeAll: boolean;
}) {
	const [temporalidad, setTemporalidad] = usePersistedState<Temporalidad>(
		"cobros/reportes/temporalidad",
		"hoy",
	);
	const [emailAsesor, setEmailAsesor] = usePersistedState<string>(
		"cobros/reportes/pagos/emailAsesor",
		"",
	);
	const [capitalMin, setCapitalMin] = usePersistedState<number | undefined>(
		"cobros/reportes/pagos/capitalMin",
		undefined,
	);
	const [capitalMax, setCapitalMax] = usePersistedState<number | undefined>(
		"cobros/reportes/pagos/capitalMax",
		undefined,
	);
	const [cuotasMin, setCuotasMin] = usePersistedState<string>(
		"cobros/reportes/pagos/cuotasMin",
		"",
	);
	const [cuotasMax, setCuotasMax] = usePersistedState<string>(
		"cobros/reportes/pagos/cuotasMax",
		"",
	);
	const [fechaDesde, setFechaDesde] = usePersistedState<string>(
		"cobros/reportes/pagos/fechaDesde",
		"",
	);
	const [fechaHasta, setFechaHasta] = usePersistedState<string>(
		"cobros/reportes/pagos/fechaHasta",
		"",
	);
	const [page, setPage] = usePersistedState<number>(
		"cobros/reportes/pagos/page",
		1,
	);
	const [pageSize] = usePersistedState<number>(
		"cobros/reportes/pagos/pageSize",
		25,
	);

	const emailCobrador = canSeeAll
		? emailAsesor || undefined
		: (session?.user?.email ?? undefined);

	const {
		data: resumenData,
		isLoading: resumenLoading,
		dataUpdatedAt,
		refetch: refetchResumen,
		isFetching: resumenFetching,
	} = useQuery({
		...orpc.getPagosEsperadosCobros.queryOptions({ input: { temporalidad } }),
		enabled: !!session,
		staleTime: 5 * 60 * 1000,
	});

	const { data: asesoresData } = useQuery({
		...orpc.getAsesores.queryOptions({ input: { perPage: 100 } }),
		enabled: !!session && canSeeAll,
	});

	const { data: noRecibidosData, isLoading: noRecibidosLoading } = useQuery({
		...orpc.getPagosNoRecibidos.queryOptions({
			input: {
				emailCobrador,
				capitalMin,
				capitalMax,
				cuotasAtrasadasMin: cuotasMin
					? Number.parseInt(cuotasMin, 10)
					: undefined,
				cuotasAtrasadasMax: cuotasMax
					? Number.parseInt(cuotasMax, 10)
					: undefined,
				fechaDesde: fechaDesde || undefined,
				fechaHasta: fechaHasta || undefined,
				page,
				pageSize,
			},
		}),
		enabled: !!session,
		staleTime: 5 * 60 * 1000,
	});

	const ultimaAct = dataUpdatedAt
		? new Date(dataUpdatedAt).toLocaleTimeString("es-GT", {
				hour: "2-digit",
				minute: "2-digit",
			})
		: null;

	return (
		<div className="space-y-6">
			<div className="flex items-center gap-2">
				<CalendarClock className="h-5 w-5 text-blue-600" />
				<h2 className="font-semibold text-xl">Pagos Esperados</h2>
			</div>

			{/* Período selector */}
			<div className="flex flex-wrap items-center gap-2">
				<span className="font-medium text-sm">Período:</span>
				{(Object.keys(TEMPORALIDAD_LABELS) as Temporalidad[]).map((t) => (
					<Button
						key={t}
						variant={temporalidad === t ? "default" : "outline"}
						size="sm"
						onClick={() => setTemporalidad(t)}
					>
						{TEMPORALIDAD_LABELS[t]}
					</Button>
				))}
				<div className="ml-auto flex items-center gap-2">
					{ultimaAct && (
						<span className="text-muted-foreground text-xs">
							Actualizado: {ultimaAct}
						</span>
					)}
					<Button
						variant="outline"
						size="sm"
						onClick={() => refetchResumen()}
						disabled={resumenFetching}
					>
						<RefreshCw
							className={`mr-2 h-4 w-4 ${resumenFetching ? "animate-spin" : ""}`}
						/>
						Actualizar
					</Button>
				</div>
			</div>

			{resumenLoading ? (
				<div className="grid grid-cols-2 gap-4 md:grid-cols-4">
					{RUBROS.map((r) => (
						<Card key={r.key}>
							<CardContent className="pt-6">
								<div className="h-10 animate-pulse rounded bg-muted" />
							</CardContent>
						</Card>
					))}
				</div>
			) : (
				<div className="grid grid-cols-2 gap-4 md:grid-cols-4">
					{RUBROS.map((r) => {
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						const value = (resumenData as any)?.totales?.[r.key] as
							| string
							| number
							| undefined;
						return (
							<Card
								key={r.key}
								className={r.highlight ? "border-blue-200 bg-blue-50" : ""}
							>
								<CardHeader className="pb-2">
									<CardTitle
										className={`font-medium text-sm ${r.highlight ? "text-blue-700" : ""}`}
									>
										{r.label}
									</CardTitle>
								</CardHeader>
								<CardContent>
									<div
										className={`font-bold text-xl ${r.highlight ? "text-blue-800" : ""}`}
									>
										{fmtQ(String(value ?? "0"))}
									</div>
								</CardContent>
							</Card>
						);
					})}
					<Card>
						<CardHeader className="pb-2">
							<CardTitle className="font-medium text-sm">
								Cant. Cuotas
							</CardTitle>
						</CardHeader>
						{/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
						<CardContent>
							<div className="font-bold text-xl">
								{(resumenData as any)?.totales?.cantidadCuotas ?? 0}
							</div>
						</CardContent>
					</Card>
				</div>
			)}

			{!!resumenData && (
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				<p className="text-muted-foreground text-xs">
					Período: {(resumenData as any).fechaInicio} →{" "}
					{(resumenData as any).fechaFin}
				</p>
			)}

			{(() => {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const desglose = ((resumenData as any)?.desglose ??
					[]) as DesgloseDia[];
				if (temporalidad === "hoy" || desglose.length <= 1) return null;
				return (
					<div>
						<h3 className="mb-3 font-semibold text-base">Desglose por Día</h3>
						<div className="overflow-x-auto rounded-lg border">
							<table className="w-full text-sm">
								<thead className="bg-muted/50">
									<tr>
										<th className="px-4 py-3 text-left font-semibold">Fecha</th>
										<th className="px-4 py-3 text-right font-semibold">
											Cuotas
										</th>
										<th className="px-4 py-3 text-right font-semibold">
											Capital
										</th>
										<th className="px-4 py-3 text-right font-semibold">
											Interés
										</th>
										<th className="px-4 py-3 text-right font-semibold">IVA</th>
										<th className="px-4 py-3 text-right font-semibold">
											Total a Cobrar
										</th>
									</tr>
								</thead>
								<tbody>
									{desglose.map((row) => (
										<tr key={row.bucket} className="border-t hover:bg-muted/30">
											<td className="px-4 py-3 font-medium">
												{fmtBucketDia(row.bucket)}
											</td>
											<td className="px-4 py-3 text-right">
												{row.cuotas_count}
											</td>
											<td className="px-4 py-3 text-right">
												{fmtQ(row.total_cuota)}
											</td>
											<td className="px-4 py-3 text-right">
												{fmtQ(row.total_interes)}
											</td>
											<td className="px-4 py-3 text-right">
												{fmtQ(row.total_iva)}
											</td>
											<td className="px-4 py-3 text-right font-medium">
												{fmtQ(totalDeFila(row))}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</div>
				);
			})()}

			<Separator />

			<h3 className="font-semibold text-base">Pagos No Recibidos</h3>

			<div className="flex flex-wrap items-end gap-4">
				{canSeeAll && (
					<div className="flex flex-col gap-1">
						<Label className="text-xs">Asesor</Label>
						<Select
							value={emailAsesor}
							onValueChange={(v) => {
								setEmailAsesor(v === "todos" ? "" : v);
								setPage(1);
							}}
						>
							<SelectTrigger className="w-52">
								<SelectValue placeholder="Todos los asesores" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="todos">Todos</SelectItem>
								{/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
								{(asesoresData as any)?.asesores?.map((a: any) => (
									<SelectItem key={a.asesorId} value={a.email}>
										{a.nombre}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
				)}
				<CapitalRangeFilter
					capitalMin={capitalMin}
					capitalMax={capitalMax}
					onCapitalRangeChange={(min, max) => {
						setCapitalMin(min);
						setCapitalMax(max);
						setPage(1);
					}}
				/>
				<div className="flex items-end gap-2">
					<div className="flex flex-col gap-1">
						<Label className="text-xs">Cuotas atrasadas mín.</Label>
						<Input
							type="number"
							min={1}
							className="w-24"
							placeholder="1"
							value={cuotasMin}
							onChange={(e) => {
								setCuotasMin(e.target.value);
								setPage(1);
							}}
						/>
					</div>
					<div className="flex flex-col gap-1">
						<Label className="text-xs">Cuotas atrasadas máx.</Label>
						<Input
							type="number"
							min={1}
							className="w-24"
							placeholder="—"
							value={cuotasMax}
							onChange={(e) => {
								setCuotasMax(e.target.value);
								setPage(1);
							}}
						/>
					</div>
				</div>
				<div className="flex items-end gap-2">
					<div className="flex flex-col gap-1">
						<Label className="text-xs">Fecha pago desde</Label>
						<Input
							type="date"
							className="w-40"
							value={fechaDesde}
							onChange={(e) => {
								setFechaDesde(e.target.value);
								setPage(1);
							}}
						/>
					</div>
					<div className="flex flex-col gap-1">
						<Label className="text-xs">Fecha pago hasta</Label>
						<Input
							type="date"
							className="w-40"
							value={fechaHasta}
							onChange={(e) => {
								setFechaHasta(e.target.value);
								setPage(1);
							}}
						/>
					</div>
				</div>
			</div>

			<DataTable
				columns={colsPagos}
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				data={(noRecibidosData as any)?.data ?? []}
				isLoading={noRecibidosLoading}
				hideSearch
				serverPagination={
					noRecibidosData
						? // eslint-disable-next-line @typescript-eslint/no-explicit-any
							{
								page: (noRecibidosData as any).page,
								pageSize: (noRecibidosData as any).pageSize,
								totalPages: (noRecibidosData as any).totalPages,
								totalItems: (noRecibidosData as any).total,
								onPageChange: setPage,
							}
						: undefined
				}
			/>
		</div>
	);
}

// ─── Descuentos ─────────────────────────────────────────────────────────────

type DescuentoRow = {
	sifco: string;
	clienteNombre: string;
	asesorNombre: string;
	gps: string;
	seguro: string;
	membresias: string;
	otros: string;
	rubros: { nombre: string; monto: string }[];
	rubrosTotal: string;
	totalDescuentos: string;
	capital: string;
	tipoCredito: string | null;
};

const colsDescuentos: ColumnDef<DescuentoRow>[] = [
	{
		accessorKey: "sifco",
		header: "Crédito",
		cell: ({ row }) => (
			<Link
				to="/cobros/$id"
				params={{ id: row.original.sifco }}
				search={{ tipo: "contrato" }}
				className="font-mono text-blue-600 text-xs hover:underline"
			>
				{row.original.sifco}
			</Link>
		),
	},
	{ accessorKey: "clienteNombre", header: "Cliente" },
	{ accessorKey: "asesorNombre", header: "Asesor" },
	{
		accessorKey: "capital",
		header: "Capital",
		cell: ({ row }) => fmtQ(row.original.capital),
	},
	{
		accessorKey: "gps",
		header: "GPS",
		cell: ({ row }) => fmtQ(row.original.gps),
	},
	{
		accessorKey: "seguro",
		header: "Seguro",
		cell: ({ row }) => fmtQ(row.original.seguro),
	},
	{
		accessorKey: "membresias",
		header: "Membresías",
		cell: ({ row }) => fmtQ(row.original.membresias),
	},
	{
		accessorKey: "otros",
		header: "Otros",
		cell: ({ row }) => fmtQ(row.original.otros),
	},
	{
		accessorKey: "rubrosTotal",
		header: "Rubros Extra",
		cell: ({ row }) => {
			const monto = fmtQ(row.original.rubrosTotal);
			if (Number.parseFloat(row.original.rubrosTotal) <= 0)
				return <span className="text-muted-foreground">—</span>;
			return (
				<div
					title={row.original.rubros
						.map((r) => `${r.nombre}: ${fmtQ(r.monto)}`)
						.join("\n")}
				>
					{monto}
				</div>
			);
		},
	},
	{
		accessorKey: "totalDescuentos",
		header: "Total Descuentos",
		cell: ({ row }) => (
			<span className="font-semibold">
				{fmtQ(row.original.totalDescuentos)}
			</span>
		),
	},
];

function TabDescuentos({
	session,
	canSeeAll,
}: {
	session: ReturnType<typeof authClient.useSession>["data"];
	canSeeAll: boolean;
}) {
	const [emailAsesor, setEmailAsesor] = usePersistedState<string>(
		"cobros/reportes/desc/emailAsesor",
		"",
	);
	const [page, setPage] = usePersistedState<number>(
		"cobros/reportes/desc/page",
		1,
	);
	const [pageSize] = usePersistedState<number>(
		"cobros/reportes/desc/pageSize",
		25,
	);

	const emailCobrador = canSeeAll
		? emailAsesor || undefined
		: (session?.user?.email ?? undefined);

	const { data: asesoresData } = useQuery({
		...orpc.getAsesores.queryOptions({ input: { perPage: 100 } }),
		enabled: !!session && canSeeAll,
	});

	const { data, isLoading } = useQuery({
		...orpc.getDescuentosCRM.queryOptions({
			input: { page, pageSize, emailCobrador },
		}),
		enabled: !!session,
		staleTime: 5 * 60 * 1000,
	});

	return (
		<div className="space-y-6">
			<div className="flex items-center gap-2">
				<BarChart3 className="h-5 w-5 text-purple-600" />
				<h2 className="font-semibold text-xl">Descuentos por Crédito</h2>
			</div>

			{canSeeAll && (
				<div className="flex flex-col gap-1">
					<Label className="text-xs">Asesor</Label>
					<Select
						value={emailAsesor}
						onValueChange={(v) => {
							setEmailAsesor(v === "todos" ? "" : v);
							setPage(1);
						}}
					>
						<SelectTrigger className="w-52">
							<SelectValue placeholder="Todos los asesores" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="todos">Todos</SelectItem>
							{/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
							{(asesoresData as any)?.asesores?.map((a: any) => (
								<SelectItem key={a.asesorId} value={a.email}>
									{a.nombre}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			)}

			<DataTable
				columns={colsDescuentos}
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				data={(data as any)?.data ?? []}
				isLoading={isLoading}
				hideSearch
				serverPagination={
					data
						? // eslint-disable-next-line @typescript-eslint/no-explicit-any
							{
								page: (data as any).page,
								pageSize: (data as any).pageSize,
								totalPages: (data as any).totalPages,
								totalItems: (data as any).total,
								onPageChange: setPage,
							}
						: undefined
				}
			/>
		</div>
	);
}

// ─── Root ───────────────────────────────────────────────────────────────────

function RouteComponent() {
	const { data: session } = authClient.useSession();
	const userRole = session?.user.role;
	const canSeeAll = PERMISSIONS.canAssignCobros(userRole ?? "");
	const [tab, setTab] = useState("mora");

	// Reportes restringidos a admin/supervisor de cobros. Los endpoints ya
	// devuelven 403 a otros roles; aquí evitamos renderizar la página rota.
	if (session && !canSeeAll) {
		return (
			<div className="space-y-2 p-6">
				<h1 className="font-bold text-2xl">Reportes de Cobros</h1>
				<p className="text-muted-foreground">
					No tienes permiso para ver estos reportes.
				</p>
			</div>
		);
	}

	return (
		<div className="space-y-6 p-6">
			<div className="flex items-center gap-2">
				<BarChart3 className="h-6 w-6 text-blue-600" />
				<h1 className="font-bold text-2xl">Reportes de Cobros</h1>
			</div>

			<Tabs value={tab} onValueChange={setTab}>
				<TabsList>
					<TabsTrigger value="mora">
						<TrendingDown className="mr-2 h-4 w-4" />
						Análisis de Mora
					</TabsTrigger>
					<TabsTrigger value="pagos">
						<CalendarClock className="mr-2 h-4 w-4" />
						Pagos Esperados
					</TabsTrigger>
					<TabsTrigger value="descuentos">
						<BarChart3 className="mr-2 h-4 w-4" />
						Descuentos
					</TabsTrigger>
				</TabsList>

				<TabsContent value="mora" className="mt-6">
					<TabMora session={session} canSeeAll={canSeeAll} />
				</TabsContent>
				<TabsContent value="pagos" className="mt-6">
					<TabPagos session={session} canSeeAll={canSeeAll} />
				</TabsContent>
				<TabsContent value="descuentos" className="mt-6">
					<TabDescuentos session={session} canSeeAll={canSeeAll} />
				</TabsContent>
			</Tabs>
		</div>
	);
}
