import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
	AlertTriangle,
	ChevronDown,
	Loader2,
	Sunrise,
	TrendingDown,
	TrendingUp,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
	catalogoDeNumero,
	estiloBucket,
	useBucketsCatalogo,
} from "@/lib/cobros/buckets-catalogo";
import { PERMISSIONS } from "@/lib/roles";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/cobros/apertura")({
	component: AperturaDiaPage,
});
// ─── Tipos del payload de getAperturaDia ─────────────────────────────────────
//
// Espejo local de los `Apertura*` de apps/server/src/types/cartera-back.ts.
// Importarlos de allá sería lo correcto, pero hoy el tsconfig del web no
// resuelve los .d.ts del server (TS6305: falta el build de `dist`), y sin
// resolución los tipos degradan a `any` — peor que la duplicación. Mantener
// ambos lados sincronizados a mano hasta que se arregle la referencia del
// proyecto; si cambia la forma del endpoint, actualizar los dos archivos.

interface Top3Fila {
	credito_id: number;
	numero_credito_sifco: string | null;
	cliente: string | null;
	bucket: number;
	status_credito: string;
	cuotas_vencidas: number;
	monto_cuota: number;
	monto_mora: number;
	monto_adeudado: number;
	dias_mora: number;
	asesor_id: number | null;
	asesor: string | null;
}

interface Top3Bucket {
	bucket: number;
	total_criticos: number;
	peor_monto: number;
	top: Top3Fila[];
}

interface CuentasNuevasOrigen {
	desde: number;
	tipo: "SUBIDA" | "BAJADA";
	cantidad: number;
}

interface CuentasNuevas {
	bucket: number;
	entradas: number;
	subidas: number;
	bajadas: number;
	origenes: CuentasNuevasOrigen[];
}

/** Un crédito que cambió de bucket hoy. */
interface Movimiento {
	credito_id: number;
	numero_credito_sifco: string | null;
	cliente: string | null;
	bucket_anterior: number | null;
	bucket_nuevo: number;
	tipo_evento: "SUBIDA" | "BAJADA";
	saltos: number;
	status_credito: string | null;
	cuotas_vencidas: number;
	monto_cuota: number;
	monto_mora: number;
	monto_adeudado: number;
	dias_mora: number;
	asesor_id: number | null;
	asesor: string | null;
	fecha: string;
}

interface Cumplimiento {
	fecha: string;
	cuentas_esperadas: number;
	cuentas_pagadas: number;
	pct: number;
	monto_esperado: number;
	monto_pagado: number;
}

/**
 * Ingreso agregado al bucket del asesor: "2 cuentas entraron desde B1".
 * No distingue subida de bajada: para quien recibe, ambas son trabajo nuevo.
 */
interface AsignacionBucket {
	desde: number | null;
	bucket: number; // destino (= bucket que atiende el asesor)
	cantidad: number;
}

interface AsignacionAsesor {
	asesor_id: number | null;
	asesor: string | null;
	/** Cuentas que entraron hoy al bucket del asesor. */
	ingresos: number;
	/** Bucket(s) del pool del asesor: a qué está asignado a atender. */
	buckets_pool: number[];
	porBucket: AsignacionBucket[];
}

interface AperturaResponse {
	fecha: string;
	cuentas_nuevas: CuentasNuevas[];
	cumplimiento: Cumplimiento;
	top3: Top3Bucket[];
	asignacion: AsignacionAsesor[];
	movimientos: Movimiento[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Hoy en Guatemala (YYYY-MM-DD). NO usar `new Date()` a secas: eso da el día
 * del navegador, así que un usuario en otra zona horaria podría elegir un
 * "mañana" que en GT todavía no existe — y el backend calcula todo en GT.
 */
function hoyGT() {
	return new Date().toLocaleDateString("sv-SE", {
		timeZone: "America/Guatemala",
	});
}

// Ventana fiel de la apertura: hoy y hasta 7 días atrás. Igual que
// APERTURA_DIAS_ATRAS en cartera-back (routers/buckets.ts) — fuera de esta
// ventana el backend responde 400 porque el dueño/status del crédito no son
// reconstruibles. Acotar el date picker evita que el usuario pida un 400.
const APERTURA_DIAS_ATRAS = 7;

/** Fecha mínima elegible (hoy GT − 7 días), en YYYY-MM-DD. */
function minFechaGT() {
	const [y, m, d] = hoyGT().split("-").map(Number);
	const min = new Date(Date.UTC(y, m - 1, d - APERTURA_DIAS_ATRAS));
	return min.toISOString().slice(0, 10);
}

function montoQ(v: number) {
	return Number.isFinite(v)
		? `Q${v.toLocaleString("es-GT", {
				minimumFractionDigits: 2,
				maximumFractionDigits: 2,
			})}`
		: "Q0.00";
}

// Etiqueta y color del bucket numérico (0-5). `orden` es de presentación y
// puede reordenarse sin tocar el bucket — el join correcto es por `numero` vía
// catalogoDeNumero() (mapea a estadoMora, la identidad estable del catálogo).
function bucketUI(
	numero: number,
	catalogo: BucketsCatalogoQueryData | undefined,
) {
	const fila = catalogoDeNumero(numero, catalogo);
	return {
		label: fila?.prefijo || fila?.label || `B${numero}`,
		nombre: fila?.label ?? "",
		color: fila?.color ?? "#64748b",
	};
}

// Todos los buckets del catálogo (0-5) para render — así el acordeón muestra
// SIEMPRE las 6 secciones aunque un bucket no tenga críticos (un bucket vacío
// es información, no ausencia — decisión CB-023). Se devuelven números de
// bucket estables (0-5), NO `orden` (presentación, reordenable) — ordenados
// por `orden` para respetar el orden de presentación del catálogo.
const BUCKET_NUMEROS = [0, 1, 2, 3, 4, 5] as const;
function bucketsOrdenados(catalogo: BucketsCatalogoQueryData | undefined) {
	if (!catalogo || catalogo.length === 0) return [...BUCKET_NUMEROS];
	return [...BUCKET_NUMEROS].sort(
		(a, b) =>
			(catalogoDeNumero(a, catalogo)?.orden ?? a) -
			(catalogoDeNumero(b, catalogo)?.orden ?? b),
	);
}

/**
 * De qué buckets vinieron los ingresos del asesor. Sin flechas ni signos: el
 * destino ya lo dice la columna "Atiende" y el total su propia columna, así
 * que aquí solo hace falta el origen.
 */
function OrigenesCelda({
	filas,
	catalogo,
}: {
	filas: AsignacionBucket[];
	catalogo: BucketsCatalogoQueryData | undefined;
}) {
	if (filas.length === 0) return <span className="text-gray-300">—</span>;
	return (
		<div className="flex flex-wrap items-center gap-1">
			{filas.map((b) => {
				const ui = b.desde != null ? bucketUI(b.desde, catalogo) : null;
				return (
					<span
						className="inline-flex items-center gap-0.5"
						key={`${b.desde}-${b.bucket}`}
					>
						<Badge
							className="border text-xs"
							style={ui ? estiloBucket(ui.color) : undefined}
							variant="outline"
						>
							{ui?.label ?? "—"}
						</Badge>
						{b.cantidad > 1 && (
							<span className="text-gray-500 text-xs">×{b.cantidad}</span>
						)}
					</span>
				);
			})}
		</div>
	);
}

function AperturaDiaPage() {
	const navigate = useNavigate();
	// `isPending` es necesario para el gate de permisos: mientras la sesión
	// carga, `userRole` es undefined y sin distinguir ese estado del de "rol
	// insuficiente" se pinta "Acceso Denegado" por un instante a un supervisor
	// legítimo en cada carga de la página.
	const { data: session, isPending: sesionCargando } = authClient.useSession();
	const userRole = session?.user?.role;
	const catalogo = useBucketsCatalogo().data;

	// Fecha en YYYY-MM-DD (default hoy GT — lo resuelve el server). El supervisor
	// puede mirar días pasados.
	const [fecha, setFecha] = useState<string>("");
	// Bucket abierto en el acordeón (uno a la vez para no llenar la pantalla).
	const [abierto, setAbierto] = useState<number | null>(null);
	// Filtro de la lista de movimientos: null = todos, o el bucket DESTINO.
	const [bucketFiltro, setBucketFiltro] = useState<number | null>(null);

	const query = useQuery({
		...orpc.getAperturaDia.queryOptions({
			input: fecha ? { fecha } : {},
		}),
		enabled: !!session,
	});

	if (sesionCargando) {
		return (
			<div className="flex min-h-screen items-center justify-center text-gray-500">
				<Loader2 className="mr-2 h-5 w-5 animate-spin" />
				Cargando…
			</div>
		);
	}

	if (!userRole || !PERMISSIONS.canAssignCobros(userRole)) {
		return (
			<div className="flex min-h-screen items-center justify-center">
				<div className="text-center">
					<h1 className="mb-4 font-bold text-2xl text-gray-800">
						Acceso Denegado
					</h1>
					<p className="text-gray-600">
						Solo supervisores pueden ver la apertura del día.
					</p>
				</div>
			</div>
		);
	}

	const apertura = query.data as AperturaResponse | undefined;
	const cumplimiento = apertura?.cumplimiento;

	const top3PorBucket = new Map<number, Top3Bucket>(
		(apertura?.top3 ?? []).map((t) => [t.bucket, t]),
	);
	const nuevasPorBucket = new Map<number, CuentasNuevas>(
		(apertura?.cuentas_nuevas ?? []).map((c) => [c.bucket, c]),
	);
	const buckets = bucketsOrdenados(catalogo);

	// Filtrado en memoria: son los movimientos de UN día (decenas), así el chip
	// responde al instante sin volver al server.
	const movimientosFiltrados = (apertura?.movimientos ?? []).filter(
		(m) => bucketFiltro === null || m.bucket_nuevo === bucketFiltro,
	);

	return (
		<div className="mx-auto max-w-6xl px-4 py-6">
			{/* Header */}
			<div className="mb-6 flex flex-wrap items-center justify-between gap-4">
				<div className="flex items-center gap-3">
					<Sunrise className="h-7 w-7 text-amber-500" />
					<div>
						<h1 className="font-bold text-2xl text-gray-900 dark:text-gray-100">
							Apertura del día
						</h1>
						<p className="text-gray-500 text-sm">
							Casos críticos y estado de la cartera para arrancar la jornada.
						</p>
					</div>
				</div>
				<div className="flex items-center gap-2">
					{/* Spinner discreto al recargar por cambio de fecha: sin él la tabla
					    se queda mostrando la data del día anterior sin avisar. */}
					{query.isFetching && !query.isPending && (
						<Loader2 className="h-4 w-4 animate-spin text-gray-400" />
					)}
					<label className="text-gray-500 text-sm" htmlFor="apertura-fecha">
						Fecha
					</label>
					<input
						className="rounded-md border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800"
						id="apertura-fecha"
						max={hoyGT()}
						min={minFechaGT()}
						onChange={(e) => setFecha(e.target.value)}
						type="date"
						value={fecha}
					/>
				</div>
			</div>

			{query.isPending && (
				<div className="flex items-center justify-center py-20 text-gray-500">
					<Loader2 className="mr-2 h-5 w-5 animate-spin" />
					Cargando apertura…
				</div>
			)}

			{query.isError && (
				<Card className="border-red-300 bg-red-50 dark:bg-red-950/30">
					<CardContent className="flex items-center gap-2 py-4 text-red-700 dark:text-red-300">
						<AlertTriangle className="h-5 w-5" />
						No se pudo cargar la apertura del día. Reintenta en unos segundos.
					</CardContent>
				</Card>
			)}

			{!query.isPending && !query.isError && apertura && (
				<div className="space-y-6">
					{/* Fila de resumen: cumplimiento de ayer + movimientos */}
					<div className="grid gap-4 sm:grid-cols-2">
						<Card>
							<CardHeader className="pb-2">
								<CardTitle className="text-base">
									Cumplimiento de ayer
								</CardTitle>
							</CardHeader>
							<CardContent>
								{cumplimiento && cumplimiento.cuentas_esperadas > 0 ? (
									<>
										<div className="flex items-baseline gap-2">
											<span className="font-bold text-3xl">
												{cumplimiento.pct}%
											</span>
											<span className="text-gray-500 text-sm">
												{cumplimiento.cuentas_pagadas} /{" "}
												{cumplimiento.cuentas_esperadas} cuentas pagaron
											</span>
										</div>
										<p className="mt-1 text-gray-500 text-sm">
											{montoQ(cumplimiento.monto_pagado)} de{" "}
											{montoQ(cumplimiento.monto_esperado)}
										</p>
									</>
								) : (
									<p className="text-gray-500 text-sm">
										No había cuotas con vencimiento ayer.
									</p>
								)}
							</CardContent>
						</Card>

						<Card>
							<CardHeader className="pb-2">
								<CardTitle className="text-base">
									Movimientos de la noche
								</CardTitle>
							</CardHeader>
							<CardContent>
								<div className="flex flex-wrap gap-2">
									{buckets.map((n) => {
										const nuevas = nuevasPorBucket.get(n);
										const ui = bucketUI(n, catalogo);
										return (
											<Badge
												className="border"
												key={n}
												style={estiloBucket(ui.color)}
												variant="outline"
											>
												{ui.label}
												<span className="ml-1 inline-flex items-center gap-1">
													<TrendingUp className="h-3 w-3" />
													{nuevas?.subidas ?? 0}
													<TrendingDown className="h-3 w-3" />
													{nuevas?.bajadas ?? 0}
												</span>
											</Badge>
										);
									})}
								</div>
								<p className="mt-2 text-gray-400 text-xs">
									↑ subidas de bucket · ↓ bajadas (cuentas curadas)
								</p>
							</CardContent>
						</Card>
					</div>

					{/* Top 3 por bucket — acordeón (una sección abierta a la vez) */}
					<div>
						<h2 className="mb-3 font-semibold text-gray-900 text-lg dark:text-gray-100">
							Top 3 casos críticos por bucket
						</h2>
						<div className="space-y-2">
							{buckets.map((n) => {
								const grupo = top3PorBucket.get(n);
								const ui = bucketUI(n, catalogo);
								const criticos = grupo?.total_criticos ?? 0;
								const estaAbierto = abierto === n;
								return (
									<Card className="overflow-hidden" key={n}>
										<button
											aria-expanded={estaAbierto}
											className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50"
											onClick={() => setAbierto(estaAbierto ? null : n)}
											type="button"
										>
											<div className="flex items-center gap-3">
												<Badge
													className="border"
													style={estiloBucket(ui.color)}
													variant="outline"
												>
													{ui.label}
												</Badge>
												<span className="text-gray-600 text-sm dark:text-gray-300">
													{criticos}{" "}
													{criticos === 1
														? "cuenta crítica"
														: "cuentas críticas"}
												</span>
												{grupo && grupo.peor_monto > 0 && (
													<span className="text-gray-400 text-sm">
														peor: {montoQ(grupo.peor_monto)}
													</span>
												)}
											</div>
											<ChevronDown
												className={`h-4 w-4 text-gray-400 transition-transform ${
													estaAbierto ? "rotate-180" : ""
												}`}
											/>
										</button>

										{estaAbierto && (
											<div className="border-t">
												{grupo && grupo.top.length > 0 ? (
													<Table>
														<TableHeader>
															<TableRow>
																<TableHead>Cliente</TableHead>
																<TableHead>Crédito</TableHead>
																<TableHead className="text-right">
																	Cuota
																</TableHead>
																<TableHead className="text-right">
																	Vencidas
																</TableHead>
																<TableHead className="text-right">
																	Días
																</TableHead>
																<TableHead className="text-right">
																	Adeudado
																</TableHead>
																<TableHead>Asesor</TableHead>
															</TableRow>
														</TableHeader>
														<TableBody>
															{grupo.top.map((fila) => (
																<TableRow
																	className={
																		fila.numero_credito_sifco
																			? "cursor-pointer"
																			: undefined
																	}
																	key={fila.credito_id}
																	onClick={() => {
																		// El detalle se abre por número SIFCO (caso de
																		// cobros), igual que la Agenda. Sin SIFCO no hay a
																		// dónde navegar.
																		if (!fila.numero_credito_sifco) return;
																		navigate({
																			to: "/cobros/$id",
																			params: { id: fila.numero_credito_sifco },
																			search: { tipo: "caso" },
																		});
																	}}
																>
																	<TableCell>{fila.cliente ?? "—"}</TableCell>
																	<TableCell>
																		{fila.numero_credito_sifco ??
																			fila.credito_id}
																	</TableCell>
																	<TableCell className="text-right">
																		{montoQ(fila.monto_cuota)}
																	</TableCell>
																	<TableCell className="text-right">
																		{fila.cuotas_vencidas}
																	</TableCell>
																	<TableCell className="text-right">
																		{fila.dias_mora}
																	</TableCell>
																	<TableCell className="text-right font-semibold">
																		{montoQ(fila.monto_adeudado)}
																	</TableCell>
																	<TableCell>{fila.asesor ?? "—"}</TableCell>
																</TableRow>
															))}
														</TableBody>
													</Table>
												) : (
													<p className="px-4 py-3 text-gray-400 text-sm">
														Sin cuentas críticas en este bucket.
													</p>
												)}
											</div>
										)}
									</Card>
								);
							})}
						</div>
					</div>

					{/* Cuentas que cambiaron de bucket — desglose + lista filtrable */}
					<div>
						<h2 className="mb-1 font-semibold text-gray-900 text-lg dark:text-gray-100">
							Cuentas que cambiaron de bucket
						</h2>
						<p className="mb-3 text-gray-500 text-sm">
							De dónde vino cada cuenta que entró a un bucket hoy.
						</p>

						{/* Chips de filtro por bucket destino */}
						<div className="mb-3 flex flex-wrap gap-2">
							<button
								className={`rounded-full border px-3 py-1 text-sm transition ${
									bucketFiltro === null
										? "border-gray-900 bg-gray-900 text-white dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900"
										: "border-gray-300 text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
								}`}
								onClick={() => setBucketFiltro(null)}
								type="button"
							>
								Todos ({apertura.movimientos?.length ?? 0})
							</button>
							{buckets.map((n) => {
								const nuevas = nuevasPorBucket.get(n);
								const ui = bucketUI(n, catalogo);
								const activo = bucketFiltro === n;
								return (
									<button
										className={`rounded-full border px-3 py-1 text-sm transition ${
											activo
												? "ring-2 ring-gray-900 ring-offset-1 dark:ring-gray-100"
												: "hover:opacity-80"
										}`}
										key={n}
										onClick={() => setBucketFiltro(activo ? null : n)}
										style={estiloBucket(ui.color)}
										type="button"
									>
										{ui.label} ({nuevas?.entradas ?? 0})
									</button>
								);
							})}
						</div>

						{/* Desglose de orígenes del bucket seleccionado */}
						{bucketFiltro !== null &&
							(nuevasPorBucket.get(bucketFiltro)?.origenes.length ?? 0) > 0 && (
								<Card className="mb-3">
									<CardContent className="py-3">
										<p className="mb-2 font-medium text-sm">
											Entradas a {bucketUI(bucketFiltro, catalogo).label}
										</p>
										<div className="flex flex-wrap gap-3 text-sm">
											{nuevasPorBucket.get(bucketFiltro)?.origenes.map((o) => {
												const origenUi = bucketUI(o.desde, catalogo);
												const esSubida = o.tipo === "SUBIDA";
												return (
													<span
														className="inline-flex items-center gap-1"
														key={`${o.desde}-${o.tipo}`}
													>
														{esSubida ? (
															<TrendingUp className="h-4 w-4 text-amber-600" />
														) : (
															<TrendingDown className="h-4 w-4 text-emerald-600" />
														)}
														<span
															className={
																esSubida ? "text-amber-600" : "text-emerald-600"
															}
														>
															{o.cantidad}
														</span>
														<span className="text-gray-500">
															{esSubida ? "subieron" : "bajaron"} desde
														</span>
														<Badge
															className="border text-xs"
															style={estiloBucket(origenUi.color)}
															variant="outline"
														>
															{origenUi.label}
														</Badge>
													</span>
												);
											})}
										</div>
									</CardContent>
								</Card>
							)}

						{/* Lista de créditos */}
						<Card>
							<CardContent className="p-0">
								{movimientosFiltrados.length === 0 ? (
									<p className="px-4 py-6 text-center text-gray-400 text-sm">
										{bucketFiltro === null
											? "Sin movimientos de bucket hoy."
											: `Sin entradas a ${bucketUI(bucketFiltro, catalogo).label} hoy.`}
									</p>
								) : (
									<Table>
										<TableHeader>
											<TableRow>
												<TableHead>Cliente</TableHead>
												<TableHead>Crédito</TableHead>
												<TableHead>Movimiento</TableHead>
												<TableHead className="text-right">Vencidas</TableHead>
												<TableHead className="text-right">Cuota</TableHead>
												<TableHead>Asesor</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{movimientosFiltrados.map((m) => {
												const desdeUi =
													m.bucket_anterior != null
														? bucketUI(m.bucket_anterior, catalogo)
														: null;
												const haciaUi = bucketUI(m.bucket_nuevo, catalogo);
												const esSubida = m.tipo_evento === "SUBIDA";
												return (
													<TableRow
														className={
															m.numero_credito_sifco
																? "cursor-pointer"
																: undefined
														}
														key={`${m.credito_id}-${m.fecha}-${m.bucket_nuevo}`}
														onClick={() => {
															if (!m.numero_credito_sifco) return;
															navigate({
																to: "/cobros/$id",
																params: { id: m.numero_credito_sifco },
																search: { tipo: "caso" },
															});
														}}
													>
														<TableCell>{m.cliente ?? "—"}</TableCell>
														<TableCell>
															{m.numero_credito_sifco ?? m.credito_id}
														</TableCell>
														<TableCell>
															<span className="inline-flex items-center gap-1">
																{desdeUi && (
																	<Badge
																		className="border text-xs"
																		style={estiloBucket(desdeUi.color)}
																		variant="outline"
																	>
																		{desdeUi.label}
																	</Badge>
																)}
																{esSubida ? (
																	<TrendingUp className="h-3 w-3 text-amber-600" />
																) : (
																	<TrendingDown className="h-3 w-3 text-emerald-600" />
																)}
																<Badge
																	className="border text-xs"
																	style={estiloBucket(haciaUi.color)}
																	variant="outline"
																>
																	{haciaUi.label}
																</Badge>
																{m.saltos > 1 && (
																	<Badge
																		className="text-xs"
																		variant="destructive"
																	>
																		{m.saltos} saltos
																	</Badge>
																)}
															</span>
														</TableCell>
														<TableCell className="text-right">
															{m.cuotas_vencidas}
														</TableCell>
														<TableCell className="text-right">
															{montoQ(m.monto_cuota)}
														</TableCell>
														<TableCell>{m.asesor ?? "—"}</TableCell>
													</TableRow>
												);
											})}
										</TableBody>
									</Table>
								)}
							</CardContent>
						</Card>
					</div>

					{/* Asignación del día — qué le cayó HOY a cada asesor */}
					<div>
						<h2 className="mb-1 font-semibold text-gray-900 text-lg dark:text-gray-100">
							Asignación del día
						</h2>
						<p className="mb-3 text-gray-500 text-sm">
							Cuentas que entraron hoy al bucket de cada asesor. No aparecen los
							asesores sin entradas.
						</p>
						<Card>
							<CardContent className="p-0">
								{(apertura.asignacion ?? []).length === 0 ? (
									<p className="px-4 py-6 text-center text-gray-400 text-sm">
										Sin movimientos de bucket hoy.
									</p>
								) : (
									<Table>
										<TableHeader>
											<TableRow>
												<TableHead>Asesor</TableHead>
												<TableHead>Atiende</TableHead>
												<TableHead className="text-right">Ingresaron</TableHead>
												<TableHead>Vienen de</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{apertura.asignacion.map((asesor) => (
												<TableRow key={asesor.asesor_id ?? "sin-asesor"}>
													<TableCell>
														{asesor.asesor ?? (
															<span className="text-gray-400 italic">
																Sin asesor
															</span>
														)}
													</TableCell>
													{/* Pool del asesor (config estable) — distinto de los
													    buckets donde tuvo movimiento hoy, última columna. */}
													<TableCell>
														{asesor.buckets_pool?.length ? (
															<div className="flex flex-wrap gap-1">
																{asesor.buckets_pool.map((n) => {
																	const ui = bucketUI(n, catalogo);
																	return (
																		<Badge
																			className="border text-xs"
																			key={n}
																			style={estiloBucket(ui.color)}
																			variant="outline"
																		>
																			{ui.label}
																		</Badge>
																	);
																})}
															</div>
														) : (
															<span className="text-gray-300">—</span>
														)}
													</TableCell>
													<TableCell className="text-right font-semibold">
														{asesor.ingresos}
													</TableCell>
													<TableCell>
														<OrigenesCelda
															catalogo={catalogo}
															filas={asesor.porBucket}
														/>
													</TableCell>
												</TableRow>
											))}
										</TableBody>
									</Table>
								)}
							</CardContent>
						</Card>
					</div>
				</div>
			)}
		</div>
	);
}
