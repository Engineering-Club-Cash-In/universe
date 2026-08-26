import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	ChevronLeft,
	ChevronRight,
	Loader2,
	LogOut,
	Search,
	X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { BarraPasos } from "@/components/barra-pasos";
import { authClient, cerrarSesion } from "@/lib/auth-client";
import {
	type Caso,
	anioEnGuatemala,
	coincidenciaEnPaso,
	ESTADOS,
	etiquetaDeEtapa,
	PASOS,
	formatearFecha,
	formatearMonto,
	rangoDePaso,
	tuvoAvanceEn,
	ventanaDelMes,
} from "@/lib/pasos";
import { cn } from "@/lib/utils";
import { orpc } from "@/utils/orpc";

const MESES = [
	"Enero",
	"Febrero",
	"Marzo",
	"Abril",
	"Mayo",
	"Junio",
	"Julio",
	"Agosto",
	"Septiembre",
	"Octubre",
	"Noviembre",
	"Diciembre",
];

const TAMANOS_PAGINA = [10, 20, 50, 100];
const TODO_EL_TIEMPO = "todo";

export function ListadoPage() {
	const ahora = new Date();
	const [periodo, setPeriodo] = useState<string>(TODO_EL_TIEMPO);
	const [anio, setAnio] = useState(anioEnGuatemala(ahora));
	const [busqueda, setBusqueda] = useState("");
	const [pasoFiltro, setPasoFiltro] = useState<number | null>(null);
	const [pctFiltro, setPctFiltro] = useState<number | null>(null);
	const [pagina, setPagina] = useState(1);
	const [porPagina, setPorPagina] = useState(10);

	const { data: session } = authClient.useSession();
	const casosQuery = useQuery(orpc.getCasos.queryOptions({ input: {} }));

	// El servidor acota los cerrados a una ventana de retención. Ofrecer años
	// anteriores solo devuelve listados vacíos sin explicación, así que el
	// selector se limita a lo que el payload realmente alcanza.
	const aniosDisponibles = useMemo(() => {
		const actual = anioEnGuatemala(new Date());
		let minimo = actual;
		for (const caso of casosQuery.data ?? []) {
			for (const entrada of caso.historial) {
				minimo = Math.min(minimo, anioEnGuatemala(entrada.fecha));
			}
		}
		return Array.from({ length: actual - minimo + 1 }, (_, i) => actual - i);
	}, [casosQuery.data]);

	const anioVigente = aniosDisponibles.includes(anio)
		? anio
		: (aniosDisponibles[0] ?? anio);

	// El refresco puede retirar un año de la lista si su último caso cruza la
	// ventana de retención. anioVigente evita filtrar por un año inexistente en
	// ese render, y este efecto alinea el estado para que el filtro de avance
	// exacto no quede aplicado en silencio sobre un año que ya no es el elegido.
	useEffect(() => {
		if (!aniosDisponibles.includes(anio)) {
			setAnio(anioVigente);
			setPctFiltro(null);
			setPagina(1);
		}
	}, [aniosDisponibles, anio, anioVigente]);

	const hayPeriodo = periodo !== TODO_EL_TIEMPO;
	const ventana = hayPeriodo ? ventanaDelMes(anioVigente, Number(periodo)) : null;

	// Sin período cuenta la etapa actual; con período, la llegada dentro del mes.
	const coincidencia = useMemo(
		() => (caso: Caso, paso: number) => coincidenciaEnPaso(caso, paso, ventana),
		[ventana],
	);

	const filtrados = useMemo(() => {
		const todos: Caso[] = casosQuery.data ?? [];
		const termino = busqueda.trim().toLowerCase();
		return todos.filter((caso) => {
			if (pasoFiltro === null) {
				if (ventana && !tuvoAvanceEn(caso, ventana)) return false;
			} else {
				const marca = coincidencia(caso, pasoFiltro);
				if (!marca) return false;
				if (pctFiltro !== null && marca.porcentaje !== pctFiltro) return false;
			}
			if (!termino) return true;
			return [caso.referencia, caso.cliente, caso.vehiculo ?? ""]
				.join(" ")
				.toLowerCase()
				.includes(termino);
		});
	}, [casosQuery.data, busqueda, pasoFiltro, pctFiltro, ventana, coincidencia]);

	const totalPaginas = Math.max(1, Math.ceil(filtrados.length / porPagina));

	// El listado se refresca solo cada minuto: si los resultados encogen, la
	// página vigente puede quedar fuera de rango y mostrar un tramo vacío.
	const paginaActual = Math.min(pagina, totalPaginas);
	const visibles = filtrados.slice(
		(paginaActual - 1) * porPagina,
		paginaActual * porPagina,
	);

	const conteoPorPaso = useMemo(() => {
		const conteo = new Map<number, number>();
		for (const caso of casosQuery.data ?? []) {
			for (let paso = 1; paso <= PASOS.length; paso++) {
				if (coincidencia(caso, paso)) {
					conteo.set(paso, (conteo.get(paso) ?? 0) + 1);
				}
			}
		}
		return conteo;
	}, [casosQuery.data, coincidencia]);

	const totalVisible = useMemo(() => {
		const todos: Caso[] = casosQuery.data ?? [];
		if (!ventana) return todos.length;
		return todos.filter((caso) => tuvoAvanceEn(caso, ventana)).length;
	}, [casosQuery.data, ventana]);

	// Porcentajes exactos presentes dentro de la etapa seleccionada.
	const porcentajesDelPaso = useMemo(() => {
		if (pasoFiltro === null) return [];
		const conteo = new Map<number, number>();
		for (const caso of casosQuery.data ?? []) {
			const marca = coincidencia(caso, pasoFiltro);
			if (!marca) continue;
			conteo.set(marca.porcentaje, (conteo.get(marca.porcentaje) ?? 0) + 1);
		}
		return [...conteo.entries()].sort(([a], [b]) => a - b);
	}, [casosQuery.data, pasoFiltro, coincidencia]);

	useEffect(() => {
		if (pasoFiltro === null || pctFiltro === null) return;
		if (!porcentajesDelPaso.some(([pct]) => pct === pctFiltro)) {
			setPctFiltro(null);
			setPagina(1);
		}
	}, [porcentajesDelPaso, pasoFiltro, pctFiltro]);

	const cambiarFiltro = (accion: () => void) => {
		accion();
		setPagina(1);
	};

	return (
		<div className="min-h-screen bg-slate-50">
			<header className="sticky top-0 z-10 border-slate-200 border-b bg-white">
				<div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-4">
					<div className="min-w-0">
						<h1 className="truncate font-bold text-lg text-slate-900">
							Seguimiento de Créditos
						</h1>
						<p className="truncate text-slate-500 text-xs">
							{session?.user.email}
						</p>
					</div>
					<button
						type="button"
						onClick={() => cerrarSesion()}
						className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-slate-700 text-sm transition hover:bg-slate-50"
					>
						<LogOut className="h-4 w-4" />
						<span className="hidden sm:inline">Salir</span>
					</button>
				</div>
			</header>

			<main className="mx-auto max-w-3xl space-y-4 px-4 py-5">
				<div className="flex flex-col gap-3 sm:flex-row">
					<div className="relative flex-1">
						<Search className="-translate-y-1/2 absolute top-1/2 left-3 h-4 w-4 text-slate-400" />
						<input
							type="search"
							value={busqueda}
							onChange={(e) => cambiarFiltro(() => setBusqueda(e.target.value))}
							placeholder="Buscar por cliente, vehículo o referencia"
							className="w-full rounded-lg border border-slate-300 bg-white py-2 pr-3 pl-9 text-sm outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900"
						/>
					</div>
					<div className="flex gap-2">
						<select
							value={periodo}
							onChange={(e) =>
								cambiarFiltro(() => {
									setPeriodo(e.target.value);
									setPctFiltro(null);
								})
							}
							className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-900"
						>
							<option value={TODO_EL_TIEMPO}>Todo el tiempo</option>
							{MESES.map((nombre, i) => (
								<option key={nombre} value={i + 1}>
									{nombre}
								</option>
							))}
						</select>
						{hayPeriodo && (
							<select
								value={anioVigente}
								onChange={(e) =>
									cambiarFiltro(() => {
										setAnio(Number(e.target.value));
										setPctFiltro(null);
									})
								}
								className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-900"
							>
								{aniosDisponibles.map((valor) => (
									<option key={valor} value={valor}>
										{valor}
									</option>
								))}
							</select>
						)}
					</div>
				</div>

				{!casosQuery.isPending && (
					<p className="text-slate-500 text-xs">
						{hayPeriodo ? (
							<>
								Mostrando lo que{" "}
								<span className="font-medium text-slate-700">
									llegó a cada etapa en {MESES[Number(periodo) - 1].toLowerCase()}{" "}
									{anioVigente}
								</span>
								. Un caso puede aparecer en varias etapas si avanzó más de una
								vez ese mes.
							</>
						) : (
							<>
								Mostrando{" "}
								<span className="font-medium text-slate-700">
									dónde está cada caso hoy
								</span>
								. Elige un mes para ver qué llegó a cada etapa en ese período.
							</>
						)}
					</p>
				)}

				<div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
					<Chip
						activo={pasoFiltro === null}
						onClick={() =>
							cambiarFiltro(() => {
								setPasoFiltro(null);
								setPctFiltro(null);
							})
						}
						titulo="Todos"
						detalle={`${totalVisible} casos`}
					/>
					{PASOS.map((p, i) => (
						<Chip
							key={p.etiqueta}
							activo={pasoFiltro === i + 1}
							onClick={() =>
								cambiarFiltro(() => {
									setPasoFiltro(pasoFiltro === i + 1 ? null : i + 1);
									setPctFiltro(null);
								})
							}
							titulo={p.etiqueta}
							detalle={`${rangoDePaso(i + 1)} · ${conteoPorPaso.get(i + 1) ?? 0}`}
						/>
					))}
				</div>

				{pasoFiltro !== null && (
					<div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5">
						<span className="shrink-0 font-medium text-slate-500 text-xs">
							Avance exacto
						</span>
						{porcentajesDelPaso.length === 0 ? (
							<span className="text-slate-400 text-xs">
								Sin casos en esta etapa
							</span>
						) : (
							porcentajesDelPaso.map(([pct, cuantos]) => {
								const activo = pctFiltro === pct;
								return (
									<button
										key={pct}
										type="button"
										onClick={() =>
											cambiarFiltro(() => setPctFiltro(activo ? null : pct))
										}
										className={cn(
											"flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium text-xs transition",
											activo
												? "border-emerald-600 bg-emerald-600 text-white"
												: "border-slate-300 bg-white text-slate-600 hover:bg-slate-50",
										)}
									>
										<span className="tabular-nums">{pct}%</span>
										<span
											className={cn(
												"tabular-nums",
												activo ? "text-emerald-100" : "text-slate-400",
											)}
										>
											{cuantos}
										</span>
										{activo && <X className="h-3.5 w-3.5" />}
									</button>
								);
							})
						)}
					</div>
				)}

				{casosQuery.isPending ? (
					<div className="flex items-center justify-center py-16 text-slate-500">
						<Loader2 className="mr-2 h-5 w-5 animate-spin" />
						Cargando casos...
					</div>
				) : casosQuery.isError ? (
					<div className="rounded-xl border border-slate-200 bg-white py-16 text-center">
						<p className="font-medium text-slate-900">
							No se pudieron cargar tus casos
						</p>
						<p className="mt-1 text-slate-500 text-sm">
							{casosQuery.error.message}
						</p>
						<button
							type="button"
							onClick={() => casosQuery.refetch()}
							disabled={casosQuery.isFetching}
							className="mt-4 inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 font-medium text-slate-700 text-sm transition hover:bg-slate-50 disabled:opacity-60"
						>
							{casosQuery.isFetching && (
								<Loader2 className="h-4 w-4 animate-spin" />
							)}
							Reintentar
						</button>
					</div>
				) : filtrados.length === 0 ? (
					<div className="rounded-xl border border-slate-200 border-dashed bg-white py-16 text-center">
						<p className="font-medium text-slate-900">
							No hay casos que mostrar
						</p>
						<p className="mt-1 text-slate-500 text-sm">
							{busqueda || pasoFiltro !== null || hayPeriodo
								? "Prueba quitando los filtros o eligiendo otro período."
								: "Aún no hay créditos registrados."}
						</p>
					</div>
				) : (
					<>
						<ul className="space-y-2.5">
							{visibles.map((caso) => {
								const marca = coincidencia(caso, pasoFiltro ?? caso.pasoActual);
								const llegada = hayPeriodo ? (marca?.fecha ?? null) : null;
								return (
									<li key={caso.id}>
										<Link
											to="/caso/$id"
											params={{ id: caso.id }}
											className="block rounded-xl border border-slate-200 bg-white p-4 transition hover:border-slate-300 hover:shadow-sm"
										>
											<div className="flex items-start justify-between gap-3">
												<div className="min-w-0">
													<p className="truncate font-semibold text-slate-900">
														{caso.vehiculo ?? caso.cliente}
													</p>
													<p className="truncate text-slate-500 text-sm">
														{caso.vehiculo
															? caso.cliente
															: "Vehículo por definir"}
														{" · "}
														{formatearMonto(caso.monto)}
													</p>
													<p className="mt-1 truncate text-slate-400 text-xs">
														{caso.agencia}
													</p>
												</div>
												<div className="flex shrink-0 items-center gap-2">
													<span className="font-semibold text-slate-900 text-sm tabular-nums">
														{hayPeriodo ? (marca?.porcentaje ?? caso.porcentaje) : caso.porcentaje}%
													</span>
													<ChevronRight className="h-5 w-5 text-slate-400" />
												</div>
											</div>

											<div className="mt-3">
												<BarraPasos
													compacta
													pasoActual={caso.pasoActual}
													porcentaje={caso.porcentaje}
													estado={caso.estado}
												/>
											</div>

											<div className="mt-2.5 flex items-center justify-between gap-2">
												<span
													className={cn(
														"inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-medium text-xs ring-1 ring-inset",
														ESTADOS[caso.estado].clase,
													)}
												>
													<span
														className={cn(
															"h-1.5 w-1.5 rounded-full",
															ESTADOS[caso.estado].punto,
														)}
													/>
													{etiquetaDeEtapa(caso)}
												</span>
												<span className="shrink-0 text-slate-400 text-xs">
													{llegada
														? `Llegó el ${formatearFecha(llegada)}`
														: formatearFecha(caso.actualizadoAt)}
												</span>
											</div>
										</Link>
									</li>
								);
							})}
						</ul>

						<nav className="flex flex-wrap items-center justify-between gap-3 pt-1 pb-2">
							<div className="flex items-center gap-2">
								<p className="text-slate-500 text-xs tabular-nums">
									{(paginaActual - 1) * porPagina + 1}–
									{Math.min(paginaActual * porPagina, filtrados.length)} de{" "}
									{filtrados.length}
								</p>
								<select
									value={porPagina}
									aria-label="Casos por página"
									onChange={(e) =>
										cambiarFiltro(() => setPorPagina(Number(e.target.value)))
									}
									className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-slate-600 text-xs outline-none focus:border-slate-900"
								>
									{TAMANOS_PAGINA.map((n) => (
										<option key={n} value={n}>
											{n} por página
										</option>
									))}
								</select>
							</div>
							<div className="flex items-center gap-2">
								<button
									type="button"
									onClick={() => setPagina(Math.max(1, paginaActual - 1))}
									disabled={paginaActual === 1}
									className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-slate-700 text-sm transition hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-white"
								>
									<ChevronLeft className="h-4 w-4" />
									<span className="hidden sm:inline">Anterior</span>
								</button>
								<span className="text-slate-600 text-sm tabular-nums">
									{paginaActual} / {totalPaginas}
								</span>
								<button
									type="button"
									onClick={() => setPagina(Math.min(totalPaginas, paginaActual + 1))}
									disabled={paginaActual >= totalPaginas}
									className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-slate-700 text-sm transition hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-white"
								>
									<span className="hidden sm:inline">Siguiente</span>
									<ChevronRight className="h-4 w-4" />
								</button>
							</div>
						</nav>
					</>
				)}
			</main>
		</div>
	);
}

function Chip({
	activo,
	onClick,
	titulo,
	detalle,
}: {
	activo: boolean;
	onClick: () => void;
	titulo: string;
	detalle: string;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"shrink-0 rounded-lg border px-3 py-1.5 text-left transition",
				activo
					? "border-slate-900 bg-slate-900 text-white"
					: "border-slate-300 bg-white text-slate-600 hover:bg-slate-50",
			)}
		>
			<span className="block font-medium text-xs">{titulo}</span>
			<span
				className={cn(
					"block font-mono text-[10px]",
					activo ? "text-slate-300" : "text-slate-400",
				)}
			>
				{detalle}
			</span>
		</button>
	);
}
