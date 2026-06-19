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

// ─── Cuotas por Fecha (Pagos Esperados) ─────────────────────────────────────

type QuickPeriod = "hoy" | "semana" | "quincena" | "mes";
type FechaMode = QuickPeriod | "personalizado";

const QUICK_LABELS: Record<QuickPeriod, string> = {
	hoy: "Hoy",
	semana: "Esta Semana",
	quincena: "Esta Quincena",
	mes: "Este Mes",
};

function todayGT(): string {
	return new Intl.DateTimeFormat("en-CA", {
		timeZone: "America/Guatemala",
	}).format(new Date());
}

function addDaysGT(dateStr: string, n: number): string {
	const [y, m, d] = dateStr.split("-").map(Number);
	const dt = new Date(Date.UTC(y, m - 1, d + n));
	return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

function fmtDate(dt: Date): string {
	return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

function weekRangeGT(): { start: string; end: string } {
	const h = todayGT();
	const [y, m, d] = h.split("-").map(Number);
	const dt = new Date(Date.UTC(y, m - 1, d));
	const dow = dt.getUTCDay(); // 0=Dom, 1=Lun ... 6=Sab
	const daysFromMon = dow === 0 ? 6 : dow - 1;
	const monday = new Date(Date.UTC(y, m - 1, d - daysFromMon));
	const sunday = new Date(Date.UTC(y, m - 1, d - daysFromMon + 6));
	return { start: fmtDate(monday), end: fmtDate(sunday) };
}

function monthRangeGT(): { start: string; end: string } {
	const h = todayGT();
	const [y, m] = h.split("-").map(Number);
	const start = `${y}-${String(m).padStart(2, "0")}-01`;
	const lastDay = new Date(Date.UTC(y, m, 0));
	return { start, end: fmtDate(lastDay) };
}

// Rango calculado para un preset. Se recalcula en cada render, así "Hoy" /
// "Esta Semana" siguen frescos aunque el usuario vuelva otro día.
function rangeForPreset(p: QuickPeriod): { start: string; end: string } {
	if (p === "hoy") {
		const h = todayGT();
		return { start: h, end: h };
	}
	if (p === "semana") return weekRangeGT();
	if (p === "quincena") {
		const h = todayGT();
		return { start: h, end: addDaysGT(h, 14) };
	}
	return monthRangeGT();
}

type CuotaFila = {
	cuota_id: number;
	fecha_vencimiento: string;
	pagado: boolean;
	numero_credito_sifco: string;
	cliente_nombre: string;
	asesor_nombre: string | null;
	statusCredit: string;
	capital_esperado: string;
	interes_esperado: string;
	iva_esperado: string;
	seguro_esperado: string;
	gps_esperado: string;
	membresias_esperado: string;
	total_esperado: string;
	capital_pagado: string;
	interes_pagado: string;
	iva_pagado: string;
	seguro_pagado: string;
	gps_pagado: string;
	total_pagado: string;
	membresias_pagado: string;
};

function RubroCelda({
	esperado,
	pagado,
}: {
	esperado: string;
	pagado: string;
}) {
	const pagadoNum = Number(pagado);
	return (
		<div className="space-y-0.5 text-right">
			<div className="text-muted-foreground text-xs">{fmtQ(esperado)}</div>
			<div
				className={`text-xs font-medium ${pagadoNum > 0 ? "text-green-600" : "text-muted-foreground/40"}`}
			>
				{pagadoNum > 0 ? fmtQ(pagado) : "—"}
			</div>
		</div>
	);
}

function EstadoBadge({ row }: { row: CuotaFila }) {
	if (row.pagado)
		return <Badge className="bg-green-100 text-green-800">Pagado</Badge>;
	if (Number(row.total_pagado) > 0)
		return <Badge className="bg-yellow-100 text-yellow-800">Parcial</Badge>;
	return <Badge className="bg-red-100 text-red-800">Pendiente</Badge>;
}

const colsCuotas: ColumnDef<CuotaFila>[] = [
	{
		accessorKey: "numero_credito_sifco",
		header: "Crédito / Cliente",
		cell: ({ row }) => (
			<div className="flex flex-col gap-0.5">
				<Link
					to="/cobros/$id"
					params={{ id: row.original.numero_credito_sifco }}
					search={{ tipo: "contrato" }}
					className="font-mono text-blue-600 text-xs hover:underline"
				>
					{row.original.numero_credito_sifco}
				</Link>
				<span className="text-muted-foreground text-xs">
					{row.original.cliente_nombre}
				</span>
			</div>
		),
	},
	{
		accessorKey: "asesor_nombre",
		header: "Asesor",
		cell: ({ row }) => row.original.asesor_nombre ?? "—",
	},
	{
		accessorKey: "fecha_vencimiento",
		header: "Fecha Venc.",
		cell: ({ row }) =>
			new Date(`${row.original.fecha_vencimiento}T12:00:00`).toLocaleDateString(
				"es-GT",
			),
	},
	{
		accessorKey: "capital_esperado",
		header: "Capital",
		cell: ({ row }) => (
			<RubroCelda
				esperado={row.original.capital_esperado}
				pagado={row.original.capital_pagado}
			/>
		),
	},
	{
		accessorKey: "interes_esperado",
		header: "Interés",
		cell: ({ row }) => (
			<RubroCelda
				esperado={row.original.interes_esperado}
				pagado={row.original.interes_pagado}
			/>
		),
	},
	{
		accessorKey: "iva_esperado",
		header: "IVA 12%",
		cell: ({ row }) => (
			<RubroCelda
				esperado={row.original.iva_esperado}
				pagado={row.original.iva_pagado}
			/>
		),
	},
	{
		accessorKey: "seguro_esperado",
		header: "Seguro",
		cell: ({ row }) => (
			<RubroCelda
				esperado={row.original.seguro_esperado}
				pagado={row.original.seguro_pagado}
			/>
		),
	},
	{
		accessorKey: "gps_esperado",
		header: "GPS",
		cell: ({ row }) => (
			<RubroCelda
				esperado={row.original.gps_esperado}
				pagado={row.original.gps_pagado}
			/>
		),
	},
	{
		accessorKey: "membresias_esperado",
		header: "Membresías",
		cell: ({ row }) => (
			<RubroCelda
				esperado={row.original.membresias_esperado}
				pagado={row.original.membresias_pagado}
			/>
		),
	},
	{
		accessorKey: "total_esperado",
		header: "Total",
		cell: ({ row }) => (
			<RubroCelda
				esperado={row.original.total_esperado}
				pagado={row.original.total_pagado}
			/>
		),
	},
	{
		id: "estado",
		header: "Estado",
		cell: ({ row }) => <EstadoBadge row={row.original} />,
	},
];

function TabCuotasPorFecha({
	session,
	canSeeAll,
}: {
	session: ReturnType<typeof authClient.useSession>["data"];
	canSeeAll: boolean;
}) {
	const hoyInit = todayGT();

	// El modo manda: si es un preset, las fechas se calculan al vuelo. Solo en
	// "personalizado" se usan (y editan) las fechas guardadas.
	const [modoFecha, setModoFecha] = usePersistedState<FechaMode>(
		"cobros/reportes/cuotas/modoFecha",
		"hoy",
	);
	const [fechaInicioCustom, setFechaInicioCustom] = usePersistedState<string>(
		"cobros/reportes/cuotas/fechaInicio",
		hoyInit,
	);
	const [fechaFinCustom, setFechaFinCustom] = usePersistedState<string>(
		"cobros/reportes/cuotas/fechaFin",
		hoyInit,
	);
	const [asesorId, setAsesorId] = usePersistedState<string>(
		"cobros/reportes/cuotas/asesorId",
		"",
	);
	const [filtroEstado, setFiltroEstado] = usePersistedState<string>(
		"cobros/reportes/cuotas/filtroEstado",
		"todos",
	);

	const esPersonalizado = modoFecha === "personalizado";
	const { start: fechaInicio, end: fechaFin } = esPersonalizado
		? { start: fechaInicioCustom, end: fechaFinCustom }
		: rangeForPreset(modoFecha);

	function activarPersonalizado() {
		// Sembrar las fechas editables con el rango del preset actual.
		if (!esPersonalizado) {
			const r = rangeForPreset(modoFecha);
			setFechaInicioCustom(r.start);
			setFechaFinCustom(r.end);
		}
		setModoFecha("personalizado");
	}

	const { data: asesoresData } = useQuery({
		...orpc.getAsesores.queryOptions({ input: { perPage: 100 } }),
		enabled: !!session && canSeeAll,
	});

	const {
		data,
		isLoading,
		dataUpdatedAt,
		refetch,
		isFetching,
	} = useQuery({
		...orpc.getCuotasPorFecha.queryOptions({
			input: {
				fechaInicio,
				fechaFin,
				asesorId: canSeeAll ? (asesorId ? Number(asesorId) : undefined) : undefined,
			},
		}),
		enabled: !!session && !!fechaInicio && !!fechaFin,
		staleTime: 5 * 60 * 1000,
	});

	const ultimaAct = dataUpdatedAt
		? new Date(dataUpdatedAt).toLocaleTimeString("es-GT", {
				hour: "2-digit",
				minute: "2-digit",
			})
		: null;

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const totales = (data as any)?.totales;
	const rows: CuotaFila[] =
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(data as any)?.rows ?? [];

	function getEstado(row: CuotaFila): "pagado" | "parcial" | "pendiente" {
		if (row.pagado) return "pagado";
		if (Number(row.total_pagado) > 0) return "parcial";
		return "pendiente";
	}

	const filteredRows = filtroEstado === "todos"
		? rows
		: rows.filter((r) => getEstado(r) === filtroEstado);

	return (
		<div className="space-y-6">
			<div className="flex items-center gap-2">
				<CalendarClock className="h-5 w-5 text-blue-600" />
				<h2 className="font-semibold text-xl">Pagos Esperados</h2>
			</div>

			{/* Filtros */}
			<div className="space-y-3">
				{/* Período — filtro principal */}
				<div className="rounded-lg border bg-muted/30 p-3">
					<div className="flex flex-wrap items-end gap-x-4 gap-y-3">
						<div className="flex flex-col gap-1.5">
							<Label className="font-semibold text-xs">Período</Label>
							<div className="flex flex-wrap items-center gap-1.5">
								{(Object.keys(QUICK_LABELS) as QuickPeriod[]).map((p) => (
									<Button
										key={p}
										variant={modoFecha === p ? "default" : "outline"}
										size="sm"
										onClick={() => setModoFecha(p)}
									>
										{QUICK_LABELS[p]}
									</Button>
								))}
								<Button
									variant={esPersonalizado ? "default" : "outline"}
									size="sm"
									onClick={activarPersonalizado}
								>
									Personalizado
								</Button>
							</div>
						</div>

						<div className="flex items-end gap-2">
							<div className="flex flex-col gap-1">
								<Label className="text-muted-foreground text-xs">Desde</Label>
								<Input
									type="date"
									className="w-36"
									value={fechaInicio}
									disabled={!esPersonalizado}
									onChange={(e) => setFechaInicioCustom(e.target.value)}
								/>
							</div>
							<div className="flex flex-col gap-1">
								<Label className="text-muted-foreground text-xs">Hasta</Label>
								<Input
									type="date"
									className="w-36"
									value={fechaFin}
									disabled={!esPersonalizado}
									onChange={(e) => setFechaFinCustom(e.target.value)}
								/>
							</div>
						</div>

						{!esPersonalizado && (
							<p className="pb-2 text-muted-foreground text-xs">
								Selecciona «Personalizado» para elegir fechas.
							</p>
						)}
					</div>
				</div>

				{/* Filtros secundarios */}
				<div className="flex flex-wrap items-end gap-3">
					{canSeeAll && (
						<div className="flex flex-col gap-1">
							<Label className="text-xs">Asesor</Label>
							<Select
								value={asesorId}
								onValueChange={(v) => setAsesorId(v === "todos" ? "" : v)}
							>
								<SelectTrigger className="w-48">
									<SelectValue placeholder="Todos los asesores" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="todos">Todos</SelectItem>
									{/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
									{(asesoresData as any)?.asesores?.map((a: any) => (
										<SelectItem key={a.asesorId} value={String(a.asesorId)}>
											{a.nombre}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					)}

					<div className="flex flex-col gap-1">
						<Label className="text-xs">Estado</Label>
						<Select value={filtroEstado} onValueChange={setFiltroEstado}>
							<SelectTrigger className="w-36">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="todos">Todos</SelectItem>
								<SelectItem value="pagado">Pagado</SelectItem>
								<SelectItem value="parcial">Parcial</SelectItem>
								<SelectItem value="pendiente">Pendiente</SelectItem>
							</SelectContent>
						</Select>
					</div>

					<div className="ml-auto flex items-center gap-2">
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
			</div>

			{/* Summary cards */}
			<div className="grid grid-cols-2 gap-3 md:grid-cols-4">
				<Card className="gap-1 border-blue-200 bg-blue-50 py-3">
					<CardHeader className="px-4 pb-0 pt-0">
						<CardTitle className="font-medium text-blue-700 text-xs">
							Total Esperado
						</CardTitle>
					</CardHeader>
					<CardContent className="px-4 pb-0">
						<div className="font-bold text-blue-800 text-lg">
							{fmtQ(totales?.totalEsp ?? "0")}
						</div>
					</CardContent>
				</Card>
				<Card className="gap-1 border-green-200 bg-green-50 py-3">
					<CardHeader className="px-4 pb-0 pt-0">
						<CardTitle className="font-medium text-green-700 text-xs">
							Total Pagado
						</CardTitle>
					</CardHeader>
					<CardContent className="px-4 pb-0">
						<div className="font-bold text-green-700 text-lg">
							{fmtQ(totales?.totalPag ?? "0")}
						</div>
					</CardContent>
				</Card>
				<Card className="gap-1 border-red-200 bg-red-50 py-3">
					<CardHeader className="px-4 pb-0 pt-0">
						<CardTitle className="font-medium text-red-700 text-xs">
							Total Pendiente
						</CardTitle>
					</CardHeader>
					<CardContent className="px-4 pb-0">
						<div className="font-bold text-red-700 text-lg">
							{fmtQ(totales?.totalPendiente ?? "0")}
						</div>
					</CardContent>
				</Card>
				<Card className="gap-1 py-3">
					<CardHeader className="px-4 pb-0 pt-0">
						<CardTitle className="font-medium text-xs">Cuotas</CardTitle>
					</CardHeader>
					<CardContent className="px-4 pb-0">
						<div className="font-bold text-lg">
							{totales?.cuotasPagadas ?? 0} / {totales?.cuotasTotal ?? 0}
						</div>
						<p className="text-muted-foreground text-xs">pagadas / total</p>
					</CardContent>
				</Card>
			</div>

			{/* Rubro breakdown cards */}
			<div className="grid grid-cols-3 gap-3 md:grid-cols-6">
				{(
					[
						{ key: "capitalEsp", label: "Capital" },
						{ key: "interesEsp", label: "Interés" },
						{ key: "ivaEsp", label: "IVA 12%" },
						{ key: "seguroEsp", label: "Seguro" },
						{ key: "gpsEsp", label: "GPS" },
						{ key: "membresiasEsp", label: "Membresías" },
					] as const
				).map((c) => (
					<Card key={c.key} className="gap-0.5 py-2.5">
						<CardHeader className="px-3 pb-0 pt-0">
							<CardTitle className="font-medium text-muted-foreground text-xs">
								{c.label}
							</CardTitle>
						</CardHeader>
						<CardContent className="px-3 pb-0">
							<div className="font-semibold text-sm">
								{fmtQ(totales?.[c.key] ?? "0")}
							</div>
						</CardContent>
					</Card>
				))}
			</div>

			{/* Detail table */}
			<DataTable columns={colsCuotas} data={filteredRows} isLoading={isLoading} />
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
					<TabCuotasPorFecha session={session} canSeeAll={canSeeAll} />
				</TabsContent>
				<TabsContent value="descuentos" className="mt-6">
					<TabDescuentos session={session} canSeeAll={canSeeAll} />
				</TabsContent>
			</Tabs>
		</div>
	);
}
