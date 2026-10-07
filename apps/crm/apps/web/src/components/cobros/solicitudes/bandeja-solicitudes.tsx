/**
 * Pestaña «Pendientes» de /cobros/solicitudes (Figma 3310:12): una bandeja
 * única con todo lo que espera la decisión del supervisor, las más antiguas
 * primero. Chips por tipo con conteo, buscador, filtro por asesor y la tabla
 * del Figma («Cartera/FilaAprobaciones»). Clic en una fila abre el Espacio
 * de aprobación. Presentación pura.
 */
import { UserRound } from "lucide-react";
import * as React from "react";
import {
	haceCuanto,
	nombreCorto,
} from "@/components/cobros/supervision/formato";
import { AsesorChip, FilterChip } from "@/components/ds/cartera-chips";
import {
	COLUMNAS_APROBACIONES,
	type ColumnaCartera,
	FilaAprobaciones,
	TablaCartera,
} from "@/components/ds/tabla-cartera";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { SearchBar } from "@/components/ui/search-bar";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { TableCell, TableRow } from "@/components/ui/table";
import {
	coincideBusqueda,
	normalizarTexto,
	type Solicitud,
	type TipoSolicitud,
} from "./normalizar";
import { BucketSolicitud, ChipPronto, ChipTipoSolicitud } from "./piezas";

/** `?tipo=` de /cobros/solicitudes. */
export type FiltroTipoSolicitud =
	| "todas"
	| TipoSolicitud
	| "por_ejecutar"
	| "rebaja"
	| "documentos";

export const FILTROS_TIPO: FiltroTipoSolicitud[] = [
	"todas",
	"convenio",
	"apagado",
	"reactivacion",
	"recuperacion",
	"por_ejecutar",
	"rebaja",
	"documentos",
];

const ETIQUETA_CHIP: Record<FiltroTipoSolicitud, string> = {
	todas: "Todas",
	convenio: "Convenio",
	apagado: "Apagado",
	reactivacion: "Reactivación",
	recuperacion: "Recuperación del vehículo",
	por_ejecutar: "Por ejecutar",
	rebaja: "Rebaja de mora",
	documentos: "Documentos",
};

/** Estado vacío de cada chip (los textos de las páginas de antes). */
const VACIO: Record<FiltroTipoSolicitud, { titulo: string; texto?: string }> = {
	todas: {
		titulo: "Sin solicitudes pendientes",
		texto: "Nada espera su decisión en este momento.",
	},
	convenio: { titulo: "No hay convenios pendientes de aprobación." },
	apagado: { titulo: "No hay solicitudes pendientes." },
	reactivacion: { titulo: "No hay solicitudes pendientes." },
	recuperacion: { titulo: "No hay solicitudes esperando aprobación." },
	por_ejecutar: {
		titulo: "No hay solicitudes aprobadas pendientes de ejecución.",
	},
	rebaja: { titulo: "Pronto" },
	documentos: { titulo: "Pronto" },
};

/** Columnas del Figma (mismos ids que FilaAprobaciones, otros rótulos). */
const COLUMNAS: ColumnaCartera[] = COLUMNAS_APROBACIONES.map((c) =>
	c.id === "cliente"
		? { ...c, etiqueta: "Solicitud / crédito" }
		: c.id === "fecha"
			? { ...c, etiqueta: "Antigüedad" }
			: c,
);

const POR_PAGINA = 20;

export type BandejaSolicitudesProps = {
	pendientes: Solicitud[];
	porEjecutar: Solicitud[];
	tipo: FiltroTipoSolicitud;
	onTipo: (tipo: FiltroTipoSolicitud) => void;
	busqueda: string;
	onBusqueda: (busqueda: string) => void;
	/** Asesor elegido (nombre normalizado) o null = todos. */
	asesor: string | null;
	onAsesor: (asesor: string | null) => void;
	cargando: boolean;
	/** Fuentes que no se pudieron cargar (las demás se muestran igual). */
	errores: string[];
	onReintentar: () => void;
	/** Abre el Espacio de aprobación sobre la lista visible. */
	onAbrir: (lista: Solicitud[], indice: number) => void;
	/** Fila del Espacio abierto (se resalta). */
	idAbierta?: string | null;
	/** Arriba de la tabla: «decisiones por confirmar», convenios fuera de la consulta… */
	avisos?: React.ReactNode;
	/** Para fijar la antigüedad en el showcase. */
	ahora?: Date;
};

const TODOS = "__todos__";

export function BandejaSolicitudes({
	pendientes,
	porEjecutar,
	tipo,
	onTipo,
	busqueda,
	onBusqueda,
	asesor,
	onAsesor,
	cargando,
	errores,
	onReintentar,
	onAbrir,
	idAbierta,
	avisos,
	ahora = new Date(),
}: BandejaSolicitudesProps) {
	const [pagina, setPagina] = React.useState(1);
	// biome-ignore lint/correctness/useExhaustiveDependencies: otro filtro, primera página
	React.useEffect(() => setPagina(1), [tipo, busqueda, asesor]);

	const conteo = (t: FiltroTipoSolicitud) =>
		t === "todas"
			? pendientes.length
			: t === "por_ejecutar"
				? porEjecutar.length
				: pendientes.filter((s) => s.tipo === t).length;

	// Asesores con solicitudes (las fuentes solo traen el nombre).
	const asesores = React.useMemo(() => {
		const mapa = new Map<string, string>();
		for (const s of [...pendientes, ...porEjecutar]) {
			const clave = normalizarTexto(s.asesor);
			if (clave && !mapa.has(clave)) mapa.set(clave, s.asesor ?? "");
		}
		return [...mapa.entries()]
			.map(([valor, nombre]) => ({ valor, nombre }))
			.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
	}, [pendientes, porEjecutar]);

	const pronto = tipo === "rebaja" || tipo === "documentos";
	const base =
		tipo === "por_ejecutar"
			? porEjecutar
			: tipo === "todas" || pronto
				? pronto
					? []
					: pendientes
				: pendientes.filter((s) => s.tipo === tipo);
	const visibles = base.filter(
		(s) =>
			coincideBusqueda(s, busqueda) &&
			(asesor === null || normalizarTexto(s.asesor) === asesor),
	);
	const totalPaginas = Math.max(1, Math.ceil(visibles.length / POR_PAGINA));
	const paginaActual = Math.min(pagina, totalPaginas);
	const desde = (paginaActual - 1) * POR_PAGINA;
	const filas = visibles.slice(desde, desde + POR_PAGINA);
	const filtrando = busqueda.trim() !== "" || asesor !== null;

	let vacio: React.ReactNode = null;
	if (filas.length === 0 && !cargando) {
		vacio = pronto ? (
			// TODO(José) · W2 (rebajas de mora, #1873) y F6 (documentos): cuando
			// existan, entran como otra fuente de la bandeja.
			<EmptyState
				size="sm"
				variant="no-data"
				title="Pronto"
				description={
					tipo === "rebaja"
						? "Las solicitudes de rebaja de mora llegarán a esta bandeja próximamente."
						: "Las solicitudes de documentos llegarán a esta bandeja próximamente."
				}
			/>
		) : errores.length > 0 && base.length === 0 ? (
			<EmptyState
				size="sm"
				variant="error"
				title="No se pudieron cargar las solicitudes"
				action={
					<Button variant="outline" size="sm" onClick={onReintentar}>
						Reintentar
					</Button>
				}
			/>
		) : filtrando ? (
			<EmptyState
				size="sm"
				variant="no-data"
				title="No hay solicitudes con estos filtros"
				description="Revise la búsqueda o elija otro asesor."
			/>
		) : (
			<EmptyState
				size="sm"
				variant="empty"
				title={VACIO[tipo].titulo}
				description={VACIO[tipo].texto}
			/>
		);
	}

	return (
		<div className="flex flex-col gap-4">
			<fieldset className="flex min-w-0 flex-wrap items-center gap-2">
				<legend className="sr-only">Filtrar por tipo de solicitud</legend>
				{FILTROS_TIPO.map((t) => {
					const esPronto = t === "rebaja" || t === "documentos";
					return (
						<FilterChip
							key={t}
							seleccionado={tipo === t}
							cantidad={esPronto || cargando ? undefined : conteo(t)}
							onClick={() => onTipo(t)}
						>
							{ETIQUETA_CHIP[t]}
							{esPronto ? <ChipPronto className="-my-0.5 ml-0.5" /> : null}
						</FilterChip>
					);
				})}
			</fieldset>

			{avisos}

			{errores.length > 0 && base.length > 0 ? (
				<div className="flex flex-wrap items-center gap-3 rounded-lg bg-danger-subtle px-3 py-2 text-[13px] text-danger-text">
					<span className="min-w-0 flex-1">
						No se pudieron cargar: {errores.join(", ")}. Las demás solicitudes
						se muestran igual.
					</span>
					<Button variant="outline" size="sm" onClick={onReintentar}>
						Reintentar
					</Button>
				</div>
			) : null}

			{tipo === "por_ejecutar" ? (
				<p className="type-caption text-fg-tertiary">
					Aprobadas, esperando que LEGION las aplique. El asesor registra la
					ejecución desde la Ficha 360, con la confirmación de LEGION; aquí solo
					se muestra lo pendiente.
				</p>
			) : null}

			<div className="flex flex-wrap items-center gap-3">
				<SearchBar
					shortcut
					containerClassName="w-full sm:w-[360px]"
					placeholder="Buscar cliente, crédito o SIFCO…"
					aria-label="Buscar cliente, crédito o SIFCO"
					value={busqueda}
					onChange={(e) => onBusqueda(e.target.value)}
					onClear={() => onBusqueda("")}
				/>
				<Select
					value={asesor ?? TODOS}
					onValueChange={(v) => onAsesor(v === TODOS ? null : v)}
				>
					<SelectTrigger
						size="sm"
						className="w-full sm:w-56"
						aria-label="Filtrar por asesor"
					>
						<span className="flex min-w-0 items-center gap-2">
							<UserRound aria-hidden className="size-3.5" />
							<SelectValue placeholder="Todos los asesores" />
						</span>
					</SelectTrigger>
					<SelectContent size="sm">
						<SelectItem value={TODOS}>Todos los asesores</SelectItem>
						{asesores.map((a) => (
							<SelectItem key={a.valor} value={a.valor}>
								{a.nombre}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			<div className="@container">
				<TablaCartera
					titulo="Solicitudes"
					contador={
						cargando
							? null
							: `${visibles.length.toLocaleString("es-GT")} ${
									tipo === "por_ejecutar"
										? "por ejecutar"
										: visibles.length === 1
											? "pendiente"
											: "pendientes"
								}`
					}
					columnas={COLUMNAS}
					vacio={vacio}
					pie={
						visibles.length > 0 ? (
							<Pagination
								className="rounded-none border-x-0 border-b-0"
								page={paginaActual}
								pageCount={totalPaginas}
								onPageChange={setPagina}
								totalItems={visibles.length}
								pageSize={POR_PAGINA}
							/>
						) : null
					}
				>
					{cargando && filas.length === 0
						? [0, 1, 2, 3, 4].map((i) => (
								<TableRow key={i} className="hover:bg-transparent">
									{COLUMNAS.map((c) => (
										<TableCell
											key={c.id}
											className="h-14 p-0 first:pl-4 last:pr-4"
										>
											<Skeleton className="h-3 w-3/4" />
										</TableCell>
									))}
								</TableRow>
							))
						: filas.map((s, i) => {
								const abrir = () => onAbrir(visibles, desde + i);
								return (
									<FilaAprobaciones
										key={s.id}
										className="cursor-pointer focus-visible:bg-brand-subtle focus-visible:outline-none"
										tabIndex={0}
										activa={idAbierta === s.id}
										onClick={abrir}
										onKeyDown={(e) => {
											if (e.key === "Enter" || e.key === " ") {
												e.preventDefault();
												abrir();
											}
										}}
										cliente={s.cliente || "Sin nombre"}
										detalle={
											s.credito
												? `Crédito #${s.credito}${
														tipo === "por_ejecutar"
															? " · Lo registra el asesor en la Ficha 360"
															: ""
													}`
												: null
										}
										asesor={
											s.asesor ? (
												<AsesorChip nombre={nombreCorto(s.asesor)} />
											) : (
												<span className="text-fg-tertiary">—</span>
											)
										}
										tipo={<ChipTipoSolicitud tipo={s.tipo} />}
										monto={s.monto ?? "—"}
										fecha={
											s.solicitadoEn ? haceCuanto(s.solicitadoEn, ahora) : "—"
										}
										bucket={<BucketSolicitud numero={s.bucket} />}
									/>
								);
							})}
				</TablaCartera>
			</div>
		</div>
	);
}
