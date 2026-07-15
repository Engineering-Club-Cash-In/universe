import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
	ArrowRight,
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	Layers,
	Loader2,
	Search,
	Sparkles,
	TrendingDown,
	TrendingUp,
	X,
} from "lucide-react";
import { Fragment, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import {
	type BucketsCatalogoQueryData,
	bucketDeEstado,
	estiloBucket,
	useBucketsCatalogo,
} from "@/lib/cobros/buckets-catalogo";
import { PERMISSIONS } from "@/lib/roles";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/cobros/buckets")({
	component: BucketsHistorialPage,
});

/**
 * Bucket numérico del motor (0-5) → key de estadoMora del catálogo de UI.
 * Mismo puente numero↔estadoMora que usa cartera-back en /stats.
 */
const KEY_POR_NUMERO = [
	"al_dia",
	"mora_30",
	"mora_60",
	"mora_90",
	"mora_120",
	"mora_120_plus",
] as const;

const EVENTO_BADGE: Record<string, string> = {
	// SUBIDA = empeora (rojo), BAJADA = cura (verde), INICIAL = línea base (azul).
	SUBIDA: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
	BAJADA:
		"bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
	INICIAL: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
};

function EventoBadge({ tipo }: { tipo: string }) {
	const icon =
		tipo === "SUBIDA" ? (
			<TrendingUp className="h-3 w-3" />
		) : tipo === "BAJADA" ? (
			<TrendingDown className="h-3 w-3" />
		) : (
			<Sparkles className="h-3 w-3" />
		);
	return (
		<Badge
			variant="outline"
			className={`gap-1 border-transparent text-[10px] ${EVENTO_BADGE[tipo] ?? ""}`}
		>
			{icon}
			{tipo}
		</Badge>
	);
}

/** Badge de bucket con label/color del catálogo dinámico (fuente única de la UI). */
function BucketBadge({
	numero,
	catalogo,
}: {
	numero: number | null;
	catalogo: BucketsCatalogoQueryData | undefined;
}) {
	if (numero === null || numero === undefined) {
		return <span className="text-muted-foreground text-xs">—</span>;
	}
	const ui = bucketDeEstado(KEY_POR_NUMERO[numero], catalogo);
	return (
		<Badge
			variant="outline"
			className="whitespace-nowrap text-[10px]"
			style={estiloBucket(ui.colorHex)}
			title={ui.label}
		>
			B{numero}
		</Badge>
	);
}

/** Transición Bx → By del evento (INICIAL no tiene anterior). */
function Transicion({
	anterior,
	nuevo,
	catalogo,
}: {
	anterior: number | null;
	nuevo: number;
	catalogo: BucketsCatalogoQueryData | undefined;
}) {
	return (
		<span className="inline-flex items-center gap-1.5">
			<BucketBadge numero={anterior} catalogo={catalogo} />
			<ArrowRight className="h-3 w-3 text-muted-foreground" />
			<BucketBadge numero={nuevo} catalogo={catalogo} />
		</span>
	);
}

/**
 * Fecha del evento en día GUATEMALA: los filtros desde/hasta del endpoint
 * cortan por día GT y el job corre ~23:59 GT (~05:59 UTC del día siguiente) —
 * mostrar el string UTC crudo descuadraría la fecha visible contra el filtro.
 */
function fechaEventoGT(v: string) {
	const d = new Date(v);
	if (Number.isNaN(d.getTime())) return String(v ?? "").slice(0, 16);
	const fecha = d.toLocaleDateString("es-GT", {
		timeZone: "America/Guatemala",
		day: "2-digit",
		month: "2-digit",
		year: "numeric",
	});
	const hora = d.toLocaleTimeString("es-GT", {
		timeZone: "America/Guatemala",
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	});
	return `${fecha} ${hora}`;
}

/** Cuotas atrasadas + su etiqueta de negocio en días (1 cuota ≈ 30 días). */
function AtrasoCell({ cuotas }: { cuotas: number | null }) {
	if (cuotas === null || cuotas === undefined) {
		return <span className="text-muted-foreground">—</span>;
	}
	return (
		<div className="text-center">
			<p className="font-medium">
				{cuotas} {cuotas === 1 ? "cuota" : "cuotas"}
			</p>
			<p className="text-muted-foreground text-xs">≈ {cuotas * 30} días</p>
		</div>
	);
}

/** Ficha por cuenta (CB-006): historial completo de migraciones del crédito. */
function FichaCredito({
	creditoId,
	catalogo,
}: {
	creditoId: number;
	catalogo: BucketsCatalogoQueryData | undefined;
}) {
	const fichaQuery = useQuery(
		orpc.getBucketsHistorialCredito.queryOptions({
			input: { creditoId },
		}),
	);

	if (fichaQuery.isLoading) {
		return (
			<div className="flex items-center justify-center gap-2 py-4 text-muted-foreground text-sm">
				<Loader2 className="h-4 w-4 animate-spin" />
				Cargando ficha del crédito...
			</div>
		);
	}
	if (fichaQuery.isError) {
		return (
			<p className="py-4 text-center text-destructive text-sm">
				Error al cargar la ficha del crédito
			</p>
		);
	}
	const eventos = fichaQuery.data ?? [];
	if (eventos.length === 0) {
		return (
			<p className="py-4 text-center text-muted-foreground text-sm italic">
				Sin migraciones registradas para este crédito.
			</p>
		);
	}

	return (
		<div className="space-y-2 py-2">
			<p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
				Ficha del crédito — {eventos.length}{" "}
				{eventos.length === 1 ? "evento" : "eventos"}
			</p>
			<table className="w-full text-xs">
				<thead>
					<tr className="border-b text-left text-muted-foreground">
						<th className="px-2 py-1.5 font-medium">Fecha</th>
						<th className="px-2 py-1.5 font-medium">Evento</th>
						<th className="px-2 py-1.5 font-medium">Transición</th>
						<th className="px-2 py-1.5 text-center font-medium">Atraso</th>
						<th className="px-2 py-1.5 font-medium">Atribución</th>
						<th className="px-2 py-1.5 font-medium">Motivo</th>
					</tr>
				</thead>
				<tbody>
					{eventos.map((ev) => (
						<tr key={ev.historial_id} className="border-b last:border-0">
							<td className="whitespace-nowrap px-2 py-1.5">
								{fechaEventoGT(ev.fecha)}
							</td>
							<td className="px-2 py-1.5">
								<EventoBadge tipo={ev.tipo_evento} />
							</td>
							<td className="px-2 py-1.5">
								<Transicion
									anterior={ev.bucket_anterior}
									nuevo={ev.bucket_nuevo}
									catalogo={catalogo}
								/>
							</td>
							<td className="px-2 py-1.5 text-center">
								{ev.cuotas_atrasadas_nuevas ?? "—"}
							</td>
							<td className="px-2 py-1.5 text-muted-foreground">
								{ev.asesor_atribucion ??
									(ev.pago_id ? `Pago #${ev.pago_id}` : "—")}
							</td>
							<td
								className="max-w-[280px] truncate px-2 py-1.5 text-muted-foreground"
								title={ev.motivo ?? undefined}
							>
								{ev.motivo ?? "—"}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

const PAGE_SIZES = [20, 50, 100] as const;

function BucketsHistorialPage() {
	const { data: session } = authClient.useSession();
	const userRole = session?.user?.role;

	const [desde, setDesde] = useState("");
	const [hasta, setHasta] = useState("");
	const [tipoEvento, setTipoEvento] = useState("todos");
	const [bucketNuevo, setBucketNuevo] = useState("todos");
	const [sifcoInput, setSifcoInput] = useState("");
	const [clienteInput, setClienteInput] = useState("");
	const [sifco, setSifco] = useState("");
	const [cliente, setCliente] = useState("");
	const [page, setPage] = useState(1);
	const [pageSize, setPageSize] = useState<number>(20);
	const [expandedCreditoId, setExpandedCreditoId] = useState<number | null>(
		null,
	);

	const catalogoQuery = useBucketsCatalogo();
	const catalogo = catalogoQuery.data;

	const historialQuery = useQuery({
		...orpc.getBucketsHistorial.queryOptions({
			input: {
				desde: desde || undefined,
				hasta: hasta || undefined,
				tipoEvento:
					tipoEvento === "todos"
						? undefined
						: (tipoEvento as "INICIAL" | "SUBIDA" | "BAJADA"),
				bucketNuevo: bucketNuevo === "todos" ? undefined : Number(bucketNuevo),
				numeroCreditoSifco: sifco || undefined,
				nombreUsuario: cliente || undefined,
				page,
				pageSize,
			},
		}),
		enabled: !!session,
	});

	const aplicarBusqueda = () => {
		setSifco(sifcoInput.trim());
		setCliente(clienteInput.trim());
		setPage(1);
	};

	const limpiarFiltros = () => {
		setDesde("");
		setHasta("");
		setTipoEvento("todos");
		setBucketNuevo("todos");
		setSifcoInput("");
		setClienteInput("");
		setSifco("");
		setCliente("");
		setPage(1);
	};

	const filtrosActivos =
		(desde ? 1 : 0) +
		(hasta ? 1 : 0) +
		(tipoEvento !== "todos" ? 1 : 0) +
		(bucketNuevo !== "todos" ? 1 : 0) +
		(sifco ? 1 : 0) +
		(cliente ? 1 : 0);

	if (!userRole || !PERMISSIONS.canAssignCobros(userRole)) {
		return (
			<div className="flex min-h-screen items-center justify-center">
				<div className="text-center">
					<h1 className="mb-4 font-bold text-2xl text-gray-800">
						Acceso Denegado
					</h1>
					<p className="text-gray-600">
						Solo supervisores y administradores pueden ver el historial de
						buckets.
					</p>
				</div>
			</div>
		);
	}

	const rows = historialQuery.data?.data ?? [];
	const resumen = historialQuery.data?.resumen;
	const pagination = historialQuery.data?.pagination;
	const totalPages = pagination?.totalPages ?? 1;

	return (
		<div className="container mx-auto space-y-6 p-6">
			<div>
				<h1 className="flex items-center gap-2 font-bold text-3xl">
					<Layers className="h-7 w-7" />
					Historial de Buckets
				</h1>
				<p className="text-muted-foreground">
					Migraciones de bucket por cuenta registradas por el motor de cobros —
					cada movimiento queda con su evento, atraso y transición.
				</p>
			</div>

			{/* Filtros */}
			<Card>
				<CardContent className="pt-6">
					<div className="flex flex-wrap items-end gap-3">
						<div className="space-y-1">
							<p className="font-medium text-muted-foreground text-xs">Desde</p>
							<Input
								type="date"
								value={desde}
								onChange={(e) => {
									setDesde(e.target.value);
									setPage(1);
								}}
								className="w-[150px]"
							/>
						</div>
						<div className="space-y-1">
							<p className="font-medium text-muted-foreground text-xs">Hasta</p>
							<Input
								type="date"
								value={hasta}
								onChange={(e) => {
									setHasta(e.target.value);
									setPage(1);
								}}
								className="w-[150px]"
							/>
						</div>
						<div className="space-y-1">
							<p className="font-medium text-muted-foreground text-xs">
								Evento
							</p>
							<Select
								value={tipoEvento}
								onValueChange={(v) => {
									setTipoEvento(v);
									setPage(1);
								}}
							>
								<SelectTrigger className="w-[140px]">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="todos">Todos</SelectItem>
									<SelectItem value="SUBIDA">Subidas</SelectItem>
									<SelectItem value="BAJADA">Bajadas</SelectItem>
									<SelectItem value="INICIAL">Iniciales</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<div className="space-y-1">
							<p className="font-medium text-muted-foreground text-xs">
								Bucket destino
							</p>
							<Select
								value={bucketNuevo}
								onValueChange={(v) => {
									setBucketNuevo(v);
									setPage(1);
								}}
							>
								<SelectTrigger className="w-[210px]">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="todos">Todos</SelectItem>
									{KEY_POR_NUMERO.map((key, numero) => {
										const ui = bucketDeEstado(key, catalogo);
										return (
											<SelectItem key={key} value={String(numero)}>
												B{numero} · {ui.label}
											</SelectItem>
										);
									})}
								</SelectContent>
							</Select>
						</div>
						<div className="min-w-[160px] flex-1 space-y-1">
							<p className="font-medium text-muted-foreground text-xs">
								No. SIFCO
							</p>
							<Input
								placeholder="Buscar SIFCO..."
								value={sifcoInput}
								onChange={(e) => setSifcoInput(e.target.value)}
								onKeyDown={(e) => e.key === "Enter" && aplicarBusqueda()}
							/>
						</div>
						<div className="min-w-[160px] flex-1 space-y-1">
							<p className="font-medium text-muted-foreground text-xs">
								Cliente
							</p>
							<Input
								placeholder="Buscar nombre..."
								value={clienteInput}
								onChange={(e) => setClienteInput(e.target.value)}
								onKeyDown={(e) => e.key === "Enter" && aplicarBusqueda()}
							/>
						</div>
						<Button variant="outline" size="sm" onClick={aplicarBusqueda}>
							<Search className="mr-1 h-4 w-4" />
							Buscar
						</Button>
						{filtrosActivos > 0 ? (
							<Button variant="ghost" size="sm" onClick={limpiarFiltros}>
								<X className="mr-1 h-4 w-4" />
								Limpiar ({filtrosActivos})
							</Button>
						) : null}
					</div>
				</CardContent>
			</Card>

			{/* Resumen */}
			{resumen ? (
				<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
					<Card>
						<CardContent className="pt-6 text-center">
							<p className="text-muted-foreground text-xs">Eventos</p>
							<p className="font-bold text-2xl">
								{resumen.total.toLocaleString("es-GT")}
							</p>
						</CardContent>
					</Card>
					<Card>
						<CardContent className="pt-6 text-center">
							<p className="flex items-center justify-center gap-1 text-muted-foreground text-xs">
								<TrendingUp className="h-3 w-3" /> Subidas
							</p>
							<p className="font-bold text-2xl text-red-600 dark:text-red-400">
								{resumen.subidas.toLocaleString("es-GT")}
							</p>
						</CardContent>
					</Card>
					<Card>
						<CardContent className="pt-6 text-center">
							<p className="flex items-center justify-center gap-1 text-muted-foreground text-xs">
								<TrendingDown className="h-3 w-3" /> Bajadas (curadas)
							</p>
							<p className="font-bold text-2xl text-emerald-600 dark:text-emerald-400">
								{resumen.bajadas.toLocaleString("es-GT")}
							</p>
						</CardContent>
					</Card>
					<Card>
						<CardContent className="pt-6 text-center">
							<p className="flex items-center justify-center gap-1 text-muted-foreground text-xs">
								<Sparkles className="h-3 w-3" /> Iniciales
							</p>
							<p className="font-bold text-2xl text-blue-600 dark:text-blue-400">
								{resumen.iniciales.toLocaleString("es-GT")}
							</p>
						</CardContent>
					</Card>
				</div>
			) : null}

			{/* Tabla */}
			<Card>
				<CardHeader>
					<CardTitle className="text-lg">Migraciones</CardTitle>
					<CardDescription>
						Haz clic en una fila para ver la ficha completa del crédito; el No.
						SIFCO abre el detalle del caso.
					</CardDescription>
				</CardHeader>
				<CardContent>
					{historialQuery.isLoading ? (
						<div className="flex items-center justify-center py-12">
							<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
						</div>
					) : historialQuery.isError ? (
						<p className="py-12 text-center text-destructive">
							Error al cargar el historial de buckets
						</p>
					) : rows.length === 0 ? (
						<p className="py-12 text-center text-muted-foreground">
							No hay migraciones para los filtros seleccionados
						</p>
					) : (
						<>
							<div className="overflow-x-auto">
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead className="w-8" />
											<TableHead>Fecha</TableHead>
											<TableHead>No. SIFCO</TableHead>
											<TableHead>Cliente</TableHead>
											<TableHead className="text-center">Evento</TableHead>
											<TableHead className="text-center">Transición</TableHead>
											<TableHead className="text-center">
												Días de atraso
											</TableHead>
											<TableHead>Asesor actual</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{rows.map((r) => {
											const expanded = expandedCreditoId === r.credito_id;
											return (
												<Fragment key={r.historial_id}>
													<TableRow
														className="cursor-pointer"
														onClick={() =>
															setExpandedCreditoId(
																expanded ? null : r.credito_id,
															)
														}
													>
														<TableCell>
															<ChevronDown
																className={`h-4 w-4 text-muted-foreground transition-transform ${
																	expanded ? "" : "-rotate-90"
																}`}
															/>
														</TableCell>
														<TableCell className="whitespace-nowrap text-muted-foreground text-xs">
															{fechaEventoGT(r.fecha)}
														</TableCell>
														<TableCell>
															<Link
																to="/cobros/$id"
																params={{ id: r.numero_credito_sifco }}
																search={{ tipo: "caso" }}
																className="font-medium text-primary hover:underline"
																onClick={(e) => e.stopPropagation()}
															>
																{r.numero_credito_sifco}
															</Link>
														</TableCell>
														<TableCell>{r.cliente}</TableCell>
														<TableCell className="text-center">
															<EventoBadge tipo={r.tipo_evento} />
														</TableCell>
														<TableCell className="text-center">
															<Transicion
																anterior={r.bucket_anterior}
																nuevo={r.bucket_nuevo}
																catalogo={catalogo}
															/>
														</TableCell>
														<TableCell>
															<AtrasoCell cuotas={r.cuotas_atrasadas_nuevas} />
														</TableCell>
														<TableCell className="text-sm">
															{r.asesor ?? "—"}
														</TableCell>
													</TableRow>
													{expanded ? (
														<TableRow className="bg-muted/40 hover:bg-muted/40">
															<TableCell colSpan={8} className="px-6">
																<FichaCredito
																	creditoId={r.credito_id}
																	catalogo={catalogo}
																/>
															</TableCell>
														</TableRow>
													) : null}
												</Fragment>
											);
										})}
									</TableBody>
								</Table>
							</div>

							{/* Paginación */}
							<div className="mt-4 flex flex-wrap items-center justify-between gap-3">
								<p className="text-muted-foreground text-sm">
									Página {pagination?.page ?? 1} de {totalPages} (
									{(pagination?.total ?? 0).toLocaleString("es-GT")} eventos)
								</p>
								<div className="flex items-center gap-2">
									<Select
										value={String(pageSize)}
										onValueChange={(v) => {
											setPageSize(Number(v));
											setPage(1);
										}}
									>
										<SelectTrigger className="w-[130px]">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{PAGE_SIZES.map((n) => (
												<SelectItem key={n} value={String(n)}>
													{n} por página
												</SelectItem>
											))}
										</SelectContent>
									</Select>
									<Button
										variant="outline"
										size="sm"
										disabled={page <= 1}
										onClick={() => setPage((p) => p - 1)}
									>
										<ChevronLeft className="h-4 w-4" />
									</Button>
									<Button
										variant="outline"
										size="sm"
										disabled={page >= totalPages}
										onClick={() => setPage((p) => p + 1)}
									>
										<ChevronRight className="h-4 w-4" />
									</Button>
								</div>
							</div>
						</>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
