import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import {
	BarChart3,
	CalendarClock,
	ChevronDown,
	Loader2,
	RefreshCw,
	TrendingDown,
} from "lucide-react";
import { useMemo, useState } from "react";
import { AsesorMultiSelect } from "@/components/cobros/asesor-multi-select";
import { DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
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

function todayGTISO() {
	return new Date().toLocaleDateString("sv-SE", {
		timeZone: "America/Guatemala",
	});
}
function currentMonthGT() {
	return todayGTISO().slice(0, 7); // YYYY-MM
}

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

	const [modo, setModo] = usePersistedState<"hoy" | "mes">(
		"cobros.mora.modo",
		"hoy",
	);
	const [mesAnio, setMesAnio] = usePersistedState<string>(
		"cobros.mora.mes",
		currentMonthGT(),
	);
	const [asesoresSel, setAsesoresSel] = usePersistedState<number[] | null>(
		"cobros.mora.asesores",
		null,
	);

	// Fecha snapshot = día 6 del mes elegido, clamp a hoy (nunca futura).
	const hoy = todayGTISO();
	const fechaSnapshot = useMemo(() => {
		if (modo === "hoy") return undefined;
		const dia6 = `${mesAnio}-06`;
		return dia6 > hoy ? hoy : dia6;
	}, [modo, mesAnio, hoy]);

	const { data: asesoresData } = useQuery({
		...orpc.getAsesores.queryOptions({ input: { perPage: 100 } }),
		enabled: !!session && canSeeAll,
	});
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const asesores: { asesorId: number; nombre: string }[] =
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(asesoresData as any)?.asesores ?? [];

	const { data, isLoading, dataUpdatedAt, refetch, isFetching } = useQuery({
		...orpc.getMoraByEtapaYAsesor.queryOptions({
			input: {
				emailCobrador,
				fecha: fechaSnapshot,
				asesores: asesoresSel ?? undefined,
			},
		}),
		enabled: !!session,
		refetchInterval: modo === "hoy" ? 60_000 : false,
		refetchIntervalInBackground: false,
	});

	// Totales con / sin Gerencia (cliente, sobre porAsesor).
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const porAsesor: any[] = (data as any)?.porAsesor ?? [];
	const totalConGerencia = porAsesor.reduce(
		(s, a) => s + Number(a.totalEnMora?.sumaMora ?? 0),
		0,
	);
	const totalSinGerencia = porAsesor
		.filter((a) => a.nombre !== "Gerencia")
		.reduce((s, a) => s + Number(a.totalEnMora?.sumaMora ?? 0), 0);
	const credConGerencia = porAsesor.reduce(
		(s, a) => s + Number(a.totalEnMora?.cantidad ?? 0),
		0,
	);
	const credSinGerencia = porAsesor
		.filter((a) => a.nombre !== "Gerencia")
		.reduce((s, a) => s + Number(a.totalEnMora?.cantidad ?? 0), 0);

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const dataDisponibleDesde = (data as any)?.dataDisponibleDesde as
		| string
		| undefined;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const alcance = (data as any)?.alcance as "live" | "historico" | undefined;

	// Cobrado (mora cobrada en el período del mes). Solo aplica en modo "mes".
	const anioNum = Number(mesAnio.slice(0, 4));
	const mesNum = Number(mesAnio.slice(5, 7));
	const { data: cobradoData, refetch: refetchCobrado } = useQuery({
		...orpc.getMoraCobradaPorAsesor.queryOptions({
			input: {
				mes: mesNum,
				anio: anioNum,
				asesores: asesoresSel ?? undefined,
				emailCobrador,
			},
		}),
		enabled: !!session && modo === "mes",
	});
	const cobradoMap = useMemo(() => {
		const m = new Map<number, { cobrado: number; nombre: string }>();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		for (const a of ((cobradoData as any)?.porAsesor ?? []) as any[]) {
			m.set(a.asesorId, { cobrado: Number(a.cobrado), nombre: a.nombre });
		}
		return m;
	}, [cobradoData]);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const totalCobrado = Number((cobradoData as any)?.totalCobrado ?? 0);
	const verCobrado = modo === "mes";

	// Filas del desglose = unión de asesores con mora esperada y/o cobrada. El
	// total cobrado incluye pagos sobre créditos ya saldados / fuera del snapshot
	// de mora activa, así que sin la unión las filas no sumarían el total.
	const filasAsesor = useMemo(() => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const map = new Map<number, any>();
		for (const a of porAsesor) map.set(a.asesorId, a);
		if (verCobrado) {
			for (const [id, c] of cobradoMap) {
				if (!map.has(id)) map.set(id, { asesorId: id, nombre: c.nombre });
			}
		}
		return [...map.values()];
	}, [porAsesor, cobradoMap, verCobrado]);

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
						onClick={() => {
							refetch();
							if (verCobrado) refetchCobrado();
						}}
						disabled={isFetching}
					>
						<RefreshCw
							className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`}
						/>
						Actualizar
					</Button>
				</div>
			</div>

			{/* Filtros */}
			<div className="flex flex-wrap items-end gap-3 rounded-lg border bg-muted/30 p-3">
				<div className="flex flex-col gap-1.5">
					<Label className="font-semibold text-xs">Momento</Label>
					<div className="flex items-center gap-1.5">
						<Button
							variant={modo === "hoy" ? "default" : "outline"}
							size="sm"
							onClick={() => setModo("hoy")}
						>
							Hoy (en vivo)
						</Button>
						<Button
							variant={modo === "mes" ? "default" : "outline"}
							size="sm"
							onClick={() => setModo("mes")}
						>
							Por mes
						</Button>
					</div>
				</div>

				<div className="flex flex-col gap-1">
					<Label className="text-muted-foreground text-xs">Mes</Label>
					<Input
						type="month"
						className="w-40"
						value={mesAnio}
						max={currentMonthGT()}
						disabled={modo !== "mes"}
						onChange={(e) => setMesAnio(e.target.value)}
					/>
				</div>

				{canSeeAll && asesores.length > 0 && (
					<div className="flex flex-col gap-1">
						<Label className="text-muted-foreground text-xs">Asesores</Label>
						<AsesorMultiSelect
							asesores={asesores}
							value={asesoresSel}
							onChange={setAsesoresSel}
						/>
					</div>
				)}

				<p className="pb-2 text-muted-foreground text-xs">
					{modo === "hoy"
						? "Mora actual en vivo"
						: `Mora al ${fechaSnapshot ?? hoy}${alcance === "historico" ? " (histórico)" : ""}`}
				</p>
			</div>

			{dataDisponibleDesde && (
				<div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-amber-800 text-sm">
					No hay datos de mora antes del {dataDisponibleDesde}.
				</div>
			)}

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
						const totalMora = Number.parseFloat(
							(data as any)?.totales?.totalEnMora?.sumaMora ?? "0",
						);
						const pct =
							totalMora > 0
								? (Number.parseFloat(bucket?.sumaMora ?? "0") / totalMora) * 100
								: 0;
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
									<p className="mt-1 font-medium text-muted-foreground text-xs">
										{pct.toFixed(1)}% del total en mora
									</p>
								</CardContent>
							</Card>
						);
					})}
				</div>
			)}

			{(porAsesor.length > 0 || (verCobrado && totalCobrado > 0)) && (
				<div
					className={`grid grid-cols-1 gap-4 md:grid-cols-2 ${verCobrado ? "lg:grid-cols-3" : ""}`}
				>
					{porAsesor.length > 0 && (
						<Card className="border-red-200 bg-red-50">
							<CardContent className="pt-4">
								<p className="font-semibold text-red-700 text-sm">
									Total en Mora (con Gerencia)
								</p>
								<p className="font-bold text-3xl text-red-800">
									{fmtQ(totalConGerencia)}
								</p>
								<p className="text-muted-foreground text-xs">
									{credConGerencia} créditos
								</p>
							</CardContent>
						</Card>
					)}
					{porAsesor.length > 0 && (
						<Card className="border-orange-200 bg-orange-50">
							<CardContent className="pt-4">
								<p className="font-semibold text-orange-700 text-sm">
									Total en Mora (sin Gerencia)
								</p>
								<p className="font-bold text-3xl text-orange-800">
									{fmtQ(totalSinGerencia)}
								</p>
								<p className="text-muted-foreground text-xs">
									{credSinGerencia} créditos
								</p>
							</CardContent>
						</Card>
					)}
					{verCobrado && (
						<Card className="border-green-200 bg-green-50">
							<CardContent className="pt-4">
								<p className="font-semibold text-green-700 text-sm">
									Mora Cobrada (en el mes)
								</p>
								<p className="font-bold text-3xl text-green-800">
									{fmtQ(totalCobrado)}
								</p>
								<p className="text-muted-foreground text-xs">
									{totalConGerencia > 0
										? `${((totalCobrado / totalConGerencia) * 100).toFixed(1)}% de lo esperado`
										: "—"}
								</p>
							</CardContent>
						</Card>
					)}
				</div>
			)}

			<div>
				<h3 className="mb-3 font-semibold text-base">Desglose por Asesor</h3>
				{isLoading ? (
					<div className="h-32 animate-pulse rounded bg-muted" />
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
				) : filasAsesor.length === 0 ? (
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
									{verCobrado && (
										<>
											<th className="px-4 py-3 text-right font-semibold">
												Cobrado
											</th>
											<th className="px-4 py-3 text-right font-semibold">
												% Cobrado
											</th>
											<th className="px-4 py-3 text-right font-semibold">
												Pendiente
											</th>
										</>
									)}
								</tr>
							</thead>
							<tbody>
								{/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
								{filasAsesor.map((asesor: any) => (
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
												const totalMora = Number.parseFloat(
													(data as any)?.totales?.totalEnMora?.sumaMora ?? "0",
												);
												const pct =
													totalMora > 0
														? (Number.parseFloat(
																asesor.totalEnMora?.sumaMora ?? "0",
															) /
																totalMora) *
															100
														: 0;
												return pct > 0 ? (
													<div className="font-medium text-muted-foreground text-xs">
														{pct.toFixed(1)}%
													</div>
												) : null;
											})()}
										</td>
										{verCobrado &&
											(() => {
												const esperado = Number.parseFloat(
													asesor.totalEnMora?.sumaMora ?? "0",
												);
												const cobrado =
													cobradoMap.get(asesor.asesorId)?.cobrado ?? 0;
												const pct =
													esperado > 0 ? (cobrado / esperado) * 100 : 0;
												const pendiente = Math.max(0, esperado - cobrado);
												return (
													<>
														<td className="px-4 py-3 text-right font-medium text-green-700">
															{cobrado > 0 ? (
																fmtQ(cobrado)
															) : (
																<span className="text-muted-foreground">—</span>
															)}
														</td>
														<td className="px-4 py-3 text-right text-muted-foreground">
															{esperado > 0 ? `${pct.toFixed(1)}%` : "—"}
														</td>
														<td className="px-4 py-3 text-right">
															{fmtQ(pendiente)}
														</td>
													</>
												);
											})()}
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
										{verCobrado &&
											(() => {
												// eslint-disable-next-line @typescript-eslint/no-explicit-any
												const esperadoTot = Number.parseFloat(
													(data as any).totales.totalEnMora?.sumaMora ?? "0",
												);
												const pctTot =
													esperadoTot > 0
														? (totalCobrado / esperadoTot) * 100
														: 0;
												return (
													<>
														<td className="px-4 py-3 text-right text-green-700">
															{fmtQ(totalCobrado)}
														</td>
														<td className="px-4 py-3 text-right font-normal text-muted-foreground">
															{esperadoTot > 0 ? `${pctTot.toFixed(1)}%` : "—"}
														</td>
														<td className="px-4 py-3 text-right">
															{fmtQ(Math.max(0, esperadoTot - totalCobrado))}
														</td>
													</>
												);
											})()}
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

// ─── shared helpers (fecha) ───────────────────────────────────────────────

function todayGT(): string {
	return new Intl.DateTimeFormat("en-CA", {
		timeZone: "America/Guatemala",
	}).format(new Date());
}

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
				className={`font-medium text-xs ${pagadoNum > 0 ? "text-green-600" : "text-muted-foreground/40"}`}
			>
				{pagadoNum > 0 ? fmtQ(pagado) : "—"}
			</div>
		</div>
	);
}

// ─── Cobrado vs Esperado (Cobranza Diaria) ──────────────────────────────────

type RubroMontos = {
	capital: string;
	interes: string;
	iva: string;
	seguro: string;
	gps: string;
	membresia: string;
};

type CobranzaAsesorRow = {
	asesor_id: number | null;
	asesor_nombre: string;
	cuotas: number;
	cobrado: RubroMontos;
	restante: RubroMontos;
	cube: { esperado: string; cobrado: string };
	mora_cobrada: string;
	total_cobrado: string;
	total_esperado: string;
	programado: string;
	efectividad: number;
};

type CobranzaCreditoRow = {
	credito_id: number;
	numero_credito_sifco: string;
	cliente_nombre: string;
	asesor_id: number | null;
	asesor_nombre: string | null;
	cobrado: RubroMontos;
	restante: RubroMontos;
	cube: { esperado: string; cobrado: string };
	mora_cobrada: string;
	total_cobrado: string;
	total_esperado: string;
};

const DETALLE_COBRANZA_COLS = [
	"Crédito / Cliente",
	"Capital",
	"Interés",
	"Int. CUBE",
	"IVA",
	"Seguro",
	"GPS",
	"Membresía",
	"Mora",
	"Total",
];

function AsesorRow({
	asesor,
	filtro,
}: {
	asesor: CobranzaAsesorRow;
	filtro: { anio: number; mes: number; dia: number };
}) {
	const [isOpen, setIsOpen] = useState(false);
	const [limit, setLimit] = useState(10);

	// El grupo "Sin asesor" (asesor_id null) no se puede expandir: el endpoint de
	// detalle exige un asesorId, así que la fila queda como total no desglosable.
	const expandable = asesor.asesor_id != null;

	const detalle = useQuery({
		...orpc.getCobranzaDiariaDetalle.queryOptions({
			input: {
				...filtro,
				asesorId: asesor.asesor_id as number,
				limit,
				offset: 0,
			},
		}),
		enabled: isOpen && asesor.asesor_id != null,
	});

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const detalleData = detalle.data as any;
	const creditos: CobranzaCreditoRow[] = detalleData?.creditos ?? [];

	return (
		<Collapsible
			open={isOpen}
			onOpenChange={setIsOpen}
			disabled={!expandable}
			className="rounded-lg border border-border"
		>
			<CollapsibleTrigger asChild>
				<button
					type="button"
					className="group flex w-full items-center gap-3 p-3 text-left hover:bg-muted/50 enabled:cursor-pointer disabled:cursor-default disabled:hover:bg-transparent data-[state=open]:cursor-pointer"
				>
					<span className="min-w-40 font-medium">{asesor.asesor_nombre}</span>
					<span className="text-muted-foreground text-xs">
						{asesor.cuotas} cuotas
					</span>
					<span className="ml-auto text-right text-sm">
						{fmtQ(asesor.total_cobrado)} / {fmtQ(asesor.total_esperado)}
					</span>
					<Badge variant="outline">
						{(asesor.efectividad * 100).toFixed(1)}%
					</Badge>
					{expandable && (
						<ChevronDown
							className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`}
						/>
					)}
				</button>
			</CollapsibleTrigger>
			<CollapsibleContent>
				<div className="overflow-x-auto border-t bg-card">
					{detalle.isLoading ? (
						<div className="flex items-center gap-2 p-3 text-muted-foreground text-sm">
							<Loader2 className="h-4 w-4 animate-spin" /> Cargando detalle…
						</div>
					) : (
						<>
							<table className="w-full text-sm">
								<thead className="bg-muted/50">
									<tr>
										{DETALLE_COBRANZA_COLS.map((h) => (
											<th
												key={h}
												className="px-3 py-2 text-left font-medium text-muted-foreground text-xs"
											>
												{h}
											</th>
										))}
									</tr>
								</thead>
								<tbody>
									{creditos.map((c) => (
										<tr
											key={c.credito_id}
											className="border-t hover:bg-muted/30"
										>
											<td className="px-3 py-1.5">
												<div className="font-mono text-blue-600 text-xs">
													{c.numero_credito_sifco}
												</div>
												<div className="text-muted-foreground text-xs">
													{c.cliente_nombre}
												</div>
											</td>
											<td className="px-3">
												<RubroCelda
													esperado={c.restante.capital}
													pagado={c.cobrado.capital}
												/>
											</td>
											<td className="px-3">
												<RubroCelda
													esperado={c.restante.interes}
													pagado={c.cobrado.interes}
												/>
											</td>
											<td className="px-3">
												<RubroCelda
													esperado={c.cube.esperado}
													pagado={c.cube.cobrado}
												/>
											</td>
											<td className="px-3">
												<RubroCelda
													esperado={c.restante.iva}
													pagado={c.cobrado.iva}
												/>
											</td>
											<td className="px-3">
												<RubroCelda
													esperado={c.restante.seguro}
													pagado={c.cobrado.seguro}
												/>
											</td>
											<td className="px-3">
												<RubroCelda
													esperado={c.restante.gps}
													pagado={c.cobrado.gps}
												/>
											</td>
											<td className="px-3">
												<RubroCelda
													esperado={c.restante.membresia}
													pagado={c.cobrado.membresia}
												/>
											</td>
											<td className="px-3 text-right text-green-600 text-xs">
												{Number(c.mora_cobrada) > 0
													? fmtQ(c.mora_cobrada)
													: "—"}
											</td>
											<td className="px-3">
												<RubroCelda
													esperado={c.total_esperado}
													pagado={c.total_cobrado}
												/>
											</td>
										</tr>
									))}
								</tbody>
							</table>
							{detalleData?.hasMore && (
								<div className="border-t px-3 py-2 text-center">
									<Button
										variant="ghost"
										size="sm"
										onClick={() => setLimit((l) => l + 10)}
									>
										Mostrar más ({detalleData.total - (creditos.length ?? 0)}{" "}
										restantes)
									</Button>
								</div>
							)}
						</>
					)}
				</div>
			</CollapsibleContent>
		</Collapsible>
	);
}

function TabCobradoVsEsperado({
	session,
	canSeeAll,
}: {
	session: ReturnType<typeof authClient.useSession>["data"];
	canSeeAll: boolean;
}) {
	const [anioHoy, mesHoy, diaHoy] = todayGT().split("-").map(Number) as [
		number,
		number,
		number,
	];

	const [anio, setAnio] = usePersistedState<number>(
		"cobros/reportes/cobranza/anio",
		anioHoy,
	);
	const [mes, setMes] = usePersistedState<number>(
		"cobros/reportes/cobranza/mes",
		mesHoy,
	);
	const [dia, setDia] = usePersistedState<number>(
		"cobros/reportes/cobranza/dia",
		diaHoy,
	);
	const [asesorId, setAsesorId] = usePersistedState<string>(
		"cobros/reportes/cobranza/asesorId",
		"",
	);

	const { data: asesoresData } = useQuery({
		...orpc.getAsesores.queryOptions({ input: { perPage: 100 } }),
		enabled: !!session && canSeeAll,
	});

	// Días válidos del mes seleccionado (evita Feb 31 → make_date inválido → 500).
	const diasEnMes = new Date(anio, mes, 0).getDate();
	const diaValido = Math.min(dia, diasEnMes);

	const filtro = { anio, mes, dia: diaValido };

	const { data, isLoading, dataUpdatedAt, refetch, isFetching } = useQuery({
		...orpc.getCobranzaDiaria.queryOptions({
			input: {
				...filtro,
				asesorId: canSeeAll
					? asesorId
						? Number(asesorId)
						: undefined
					: undefined,
			},
		}),
		enabled: !!session,
	});

	const ultimaAct = dataUpdatedAt
		? new Date(dataUpdatedAt).toLocaleTimeString("es-GT", {
				hour: "2-digit",
				minute: "2-digit",
			})
		: null;

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const resultado = data as any;
	const asesores: CobranzaAsesorRow[] = resultado?.asesores ?? [];
	const totalGeneral: CobranzaAsesorRow | undefined = resultado?.totalGeneral;

	const anios = [anioHoy, anioHoy - 1, anioHoy - 2];
	const meses = Array.from({ length: 12 }, (_, i) => i + 1);
	const dias = Array.from({ length: diasEnMes }, (_, i) => i + 1);

	return (
		<div className="space-y-6">
			<div className="flex items-center gap-2">
				<CalendarClock className="h-5 w-5 text-blue-600" />
				<h2 className="font-semibold text-xl">Cobrado vs Esperado</h2>
			</div>

			{/* Filtros */}
			<div className="flex flex-wrap items-end gap-3 rounded-lg border bg-muted/30 p-3">
				<div className="flex flex-col gap-1">
					<Label className="text-xs">Año</Label>
					<Select
						value={String(anio)}
						onValueChange={(v) => setAnio(Number(v))}
					>
						<SelectTrigger className="w-24">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{anios.map((a) => (
								<SelectItem key={a} value={String(a)}>
									{a}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>

				<div className="flex flex-col gap-1">
					<Label className="text-xs">Mes</Label>
					<Select value={String(mes)} onValueChange={(v) => setMes(Number(v))}>
						<SelectTrigger className="w-20">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{meses.map((m) => (
								<SelectItem key={m} value={String(m)}>
									{m}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>

				<div className="flex flex-col gap-1">
					<Label className="text-xs">Día</Label>
					<Select
						value={String(diaValido)}
						onValueChange={(v) => setDia(Number(v))}
					>
						<SelectTrigger className="w-20">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{dias.map((d) => (
								<SelectItem key={d} value={String(d)}>
									{d}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>

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

			{/* Summary cards */}
			<div className="grid grid-cols-2 gap-3 md:grid-cols-4">
				<Card className="gap-1 border-blue-200 bg-blue-50 py-3">
					<CardHeader className="px-4 pt-0 pb-0">
						<CardTitle className="font-medium text-blue-700 text-xs">
							A Cobrar
						</CardTitle>
					</CardHeader>
					<CardContent className="px-4 pb-0">
						<div className="font-bold text-blue-800 text-lg">
							{fmtQ(totalGeneral?.programado ?? "0")}
						</div>
					</CardContent>
				</Card>
				<Card className="gap-1 border-green-200 bg-green-50 py-3">
					<CardHeader className="px-4 pt-0 pb-0">
						<CardTitle className="font-medium text-green-700 text-xs">
							Cobrado
						</CardTitle>
					</CardHeader>
					<CardContent className="px-4 pb-0">
						<div className="font-bold text-green-700 text-lg">
							{fmtQ(totalGeneral?.total_cobrado ?? "0")}
						</div>
					</CardContent>
				</Card>
				<Card className="gap-1 border-red-200 bg-red-50 py-3">
					<CardHeader className="px-4 pt-0 pb-0">
						<CardTitle className="font-medium text-red-700 text-xs">
							Restante
						</CardTitle>
					</CardHeader>
					<CardContent className="px-4 pb-0">
						<div className="font-bold text-lg text-red-700">
							{fmtQ(totalGeneral?.total_esperado ?? "0")}
						</div>
					</CardContent>
				</Card>
				<Card className="gap-1 py-3">
					<CardHeader className="px-4 pt-0 pb-0">
						<CardTitle className="font-medium text-xs">Efectividad</CardTitle>
					</CardHeader>
					<CardContent className="px-4 pb-0">
						<div className="font-bold text-lg">
							{((totalGeneral?.efectividad ?? 0) * 100).toFixed(1)}%
						</div>
						<p className="text-muted-foreground text-xs">
							{totalGeneral?.cuotas ?? 0} cuotas
						</p>
					</CardContent>
				</Card>
			</div>

			{/* Por asesor */}
			{isLoading ? (
				<div className="h-32 animate-pulse rounded bg-muted" />
			) : asesores.length === 0 ? (
				<p className="text-muted-foreground text-sm">
					No hay datos disponibles para la fecha seleccionada.
				</p>
			) : (
				<div className="space-y-2">
					{asesores.map((a) => (
						<AsesorRow
							key={a.asesor_id ?? "sin-asesor"}
							asesor={a}
							filtro={filtro}
						/>
					))}
					{totalGeneral && (
						<div className="flex items-center gap-3 rounded-lg border border-border bg-muted/50 p-3 font-semibold">
							<span className="min-w-40">TOTAL</span>
							<span className="text-muted-foreground text-xs">
								{totalGeneral.cuotas} cuotas
							</span>
							<span className="ml-auto text-right text-sm">
								{fmtQ(totalGeneral.total_cobrado)} /{" "}
								{fmtQ(totalGeneral.total_esperado)}
							</span>
							<Badge variant="outline">
								{(totalGeneral.efectividad * 100).toFixed(1)}%
							</Badge>
						</div>
					)}
				</div>
			)}
		</div>
	);
}

// ─── Descuentos ─────────────────────────────────────────────────────────────

type DescuentoRow = {
	sifco: string;
	clienteNombre: string;
	multas: string;
	copiaDeLlave: string;
	diferenciaCopia: string;
	impuestoCirculacion: string;
	garantiaMobiliaria: string;
	placas: string;
	contratoLeasing: string;
	autenticaCobranza: string;
	nombramiento: string;
	verificacionDireccion: string;
	traspasoVehiculo: string;
	intereses: string;
	rcdp: string;
	gps: string;
	seguro: string;
	membresia: string;
	gastosAdmin: string;
	freelance: string;
	royalty: string;
	inspeccion: string;
	gastosLegales: string;
	totalDescuentos: string;
};

function fmtDesc(v: string) {
	const n = Number.parseFloat(v);
	if (!n || n <= 0) return <span className="text-muted-foreground">—</span>;
	return <span>{fmtQ(n)}</span>;
}

const colsDescuentos: ColumnDef<DescuentoRow>[] = [
	{
		id: "creditoCliente",
		header: "Crédito / Cliente",
		cell: ({ row }) => (
			<div className="flex flex-col gap-0.5">
				<Link
					to="/cobros/$id"
					params={{ id: row.original.sifco }}
					search={{ tipo: "contrato" }}
					className="font-mono text-blue-600 text-xs hover:underline"
				>
					{row.original.sifco}
				</Link>
				<span className="text-muted-foreground text-xs">
					{row.original.clienteNombre}
				</span>
			</div>
		),
	},
	{
		accessorKey: "multas",
		header: "Multas",
		cell: ({ row }) => fmtDesc(row.original.multas),
	},
	{
		accessorKey: "copiaDeLlave",
		header: "Copia llave",
		cell: ({ row }) => fmtDesc(row.original.copiaDeLlave),
	},
	{
		accessorKey: "diferenciaCopia",
		header: "Dif. copia",
		cell: ({ row }) => fmtDesc(row.original.diferenciaCopia),
	},
	{
		accessorKey: "impuestoCirculacion",
		header: "Imp. circulación",
		cell: ({ row }) => fmtDesc(row.original.impuestoCirculacion),
	},
	{
		accessorKey: "garantiaMobiliaria",
		header: "Garantía mob.",
		cell: ({ row }) => fmtDesc(row.original.garantiaMobiliaria),
	},
	{
		accessorKey: "placas",
		header: "Placas",
		cell: ({ row }) => fmtDesc(row.original.placas),
	},
	{
		accessorKey: "contratoLeasing",
		header: "Cto. leasing",
		cell: ({ row }) => fmtDesc(row.original.contratoLeasing),
	},
	{
		accessorKey: "verificacionDireccion",
		header: "Verif. dirección",
		cell: ({ row }) => fmtDesc(row.original.verificacionDireccion),
	},
	{
		accessorKey: "traspasoVehiculo",
		header: "Traspaso",
		cell: ({ row }) => fmtDesc(row.original.traspasoVehiculo),
	},
	{
		accessorKey: "intereses",
		header: "Intereses",
		cell: ({ row }) => fmtDesc(row.original.intereses),
	},
	{
		accessorKey: "rcdp",
		header: "RCDP",
		cell: ({ row }) => fmtDesc(row.original.rcdp),
	},
	{
		accessorKey: "gps",
		header: "GPS",
		cell: ({ row }) => fmtDesc(row.original.gps),
	},
	{
		accessorKey: "seguro",
		header: "Seguro",
		cell: ({ row }) => fmtDesc(row.original.seguro),
	},
	{
		accessorKey: "membresia",
		header: "Membresía",
		cell: ({ row }) => fmtDesc(row.original.membresia),
	},
	{
		accessorKey: "gastosAdmin",
		header: "Gastos admin",
		cell: ({ row }) => fmtDesc(row.original.gastosAdmin),
	},
	{
		accessorKey: "freelance",
		header: "Free Lance",
		cell: ({ row }) => fmtDesc(row.original.freelance),
	},
	{
		accessorKey: "royalty",
		header: "Royalty",
		cell: ({ row }) => fmtDesc(row.original.royalty),
	},
	{
		accessorKey: "totalDescuentos",
		header: "Total",
		cell: ({ row }) => (
			<span className="font-semibold">
				{fmtQ(row.original.totalDescuentos)}
			</span>
		),
	},
];

function TabDescuentos({
	session,
}: {
	session: ReturnType<typeof authClient.useSession>["data"];
}) {
	const [search, setSearch] = usePersistedState<string>(
		"cobros/reportes/desc/search",
		"",
	);
	const [debouncedSearch, setDebouncedSearch] = useState(search);
	const [page, setPage] = usePersistedState<number>(
		"cobros/reportes/desc/page",
		1,
	);
	const [pageSize] = usePersistedState<number>(
		"cobros/reportes/desc/pageSize",
		25,
	);

	const { data, isLoading } = useQuery({
		...orpc.getDescuentosCRM.queryOptions({
			input: { page, pageSize, search: debouncedSearch || undefined },
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

			<div className="flex flex-col gap-1">
				<Label className="text-xs">Buscar por crédito o cliente</Label>
				<Input
					className="max-w-sm"
					placeholder="CRM-... o nombre del cliente"
					value={search}
					onChange={(e) => {
						setSearch(e.target.value);
						setPage(1);
						clearTimeout((window as any)._descSearch);
						(window as any)._descSearch = setTimeout(
							() => setDebouncedSearch(e.target.value),
							400,
						);
					}}
				/>
			</div>

			<DataTable
				columns={colsDescuentos}
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				data={(data as any)?.data ?? []}
				isLoading={isLoading}
				hideSearch
				stickyFirstColumn
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
		<div className="min-w-0 space-y-6 p-6">
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
						Cobrado vs Esperado
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
					<TabCobradoVsEsperado session={session} canSeeAll={canSeeAll} />
				</TabsContent>
				<TabsContent value="descuentos" className="mt-6">
					<TabDescuentos session={session} />
				</TabsContent>
			</Tabs>
		</div>
	);
}
