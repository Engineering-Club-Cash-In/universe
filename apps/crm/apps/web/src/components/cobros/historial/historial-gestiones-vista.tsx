import {
	AlertTriangle,
	CalendarClock,
	FileSpreadsheet,
	History,
	Loader2,
	RotateCcw,
	ScrollText,
	Table2,
} from "lucide-react";
import type * as React from "react";
import type { DateRange } from "react-day-picker";
import {
	type UsuarioCobros,
	UsuarioCobrosMultiSelect,
} from "@/components/cobros/usuario-cobros-multi-select";
import { FilterChip } from "@/components/ds/cartera-chips";
import { KpiCard, KpiSimple } from "@/components/ds/kpi";
import { DateRangeFilter } from "@/components/reports/date-range-filter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import {
	type BucketsCatalogoQueryData,
	bucketDeNumero,
	labelBucketConCodigo,
} from "@/lib/cobros/buckets-catalogo";
import { cn } from "@/lib/utils";
import { CATEGORIAS_ACTIVIDAD, type CategoriaActividad } from "./categorias";
import { EncabezadoHistorial, FilaHistorial } from "./fila-historial";
import {
	ESTADOS_CONTACTO,
	METODOS_CONTACTO,
	ROLES_FILTRABLES,
} from "./formato";
import { LineaTiempoGestiones } from "./linea-tiempo";
import type { RespuestaHistorial, ResumenHistorial } from "./tipos";

/**
 * Presentación del Historial de gestiones (antes, el cuerpo de
 * `/cobros/historial-agendas`). Recibe todo por props: el contenedor
 * (`historial-gestiones.tsx`) hace las consultas, la persistencia y el export,
 * y el showcase la pinta con datos de ejemplo.
 *
 * Dos usos:
 *   - **Vista del equipo** (sin asesor fijo): KPIs, filtros (con usuario y rol
 *     para supervisión), chips de bucket, tabla, paginación, auditoría y
 *     exportar XLSX. Es la página de siempre.
 *   - **Detalle del asesor** (con asesor fijo): lo mismo sin los filtros de
 *     usuario y rol, más los chips de categoría del Figma 4063:12 y el cambio
 *     entre tabla y línea de tiempo.
 */

/**
 * Sentinela del chip "Sin bucket" (gestiones con `bucket_snapshot` NULL).
 *
 * Espejo de `BUCKET_SIN_ASIGNAR` en server/src/lib/historial-agendas.ts —
 * mantener ambos en -1. Se duplica en vez de importarse porque el web no
 * importa del server (el tipado del router va por los tipos manuales, ver la
 * nota de TS7056 en el contenedor); el input de zod valida `min(-1)`, así que
 * un cambio de un solo lado se rechaza en el borde en vez de filtrar mal en
 * silencio.
 */
export const BUCKET_SIN_ASIGNAR = -1;

/** Valores de los filtros tal como los ve y edita la pantalla. */
export type FiltrosHistorialUI = {
	rangoFechas: DateRange | undefined;
	/**
	 * Selección del multi-select de usuarios. `[]` ("Deseleccionar todos") y
	 * `null` (nunca elegido) son estados distintos para el componente: ver la
	 * nota larga en el contenedor.
	 */
	usuarioIds: string[] | null;
	rol: string;
	estadoContacto: string;
	metodoContacto: string;
	estadoPromesa: string;
	busquedaSifco: string;
	incluirAutomaticos: boolean;
	buckets: number[] | null;
};

export type ChipBucketDato = { bucket: number | null; cantidad: number };

export type HistorialGestionesVistaProps = {
	/**
	 * `pagina`: título grande con ícono y márgenes de página (la de siempre).
	 * `seccion`: embebido en otra pantalla (Detalle del asesor, Mi equipo).
	 */
	encabezado:
		| { tipo: "pagina"; titulo: string; descripcion: string }
		| {
				tipo: "seccion";
				titulo?: string;
				descripcion?: string;
				/** Controles antes de «Exportar XLSX» (p. ej. el selector de Mi equipo › Día). */
				controles?: React.ReactNode;
		  };
	/** Habilita el detalle de auditoría (el procedure está gateado). */
	esSupervisor: boolean;
	/** Filtros de usuario y rol (solo la vista del equipo, para supervisión). */
	mostrarFiltrosEquipo: boolean;
	usuarios: UsuarioCobros[];
	filtros: FiltrosHistorialUI;
	onFiltros: (cambio: Partial<FiltrosHistorialUI>) => void;
	filtrosActivos: number;
	onLimpiar: () => void;
	catalogo: BucketsCatalogoQueryData | undefined;
	bucketsChips: ChipBucketDato[];
	resumen: {
		datos: ResumenHistorial | undefined;
		cargando: boolean;
		error: boolean;
	};
	listado: {
		datos: RespuestaHistorial | undefined;
		cargando: boolean;
		error: boolean;
		/** Refetch en segundo plano (spinner chico junto a Exportar). */
		actualizando: boolean;
	};
	page: number;
	pageSize: number;
	hayMasPaginas: boolean;
	onPage: (page: number) => void;
	onPageSize: (pageSize: number) => void;
	exportacion: {
		exportando: boolean;
		deshabilitada: boolean;
		/** Por qué está deshabilitada (tooltip), si no es obvio. */
		motivo?: string;
		onExportar: () => void;
	};
	/** Chips de categoría del Figma 4063:12 (solo el Detalle del asesor). */
	categorias?: {
		activa: CategoriaActividad;
		onCambiar: (categoria: CategoriaActividad) => void;
	};
	/** Tabla o línea de tiempo (solo el Detalle del asesor). */
	vistaLista?: {
		valor: "tabla" | "linea";
		onCambiar: (valor: "tabla" | "linea") => void;
	};
	/** Reemplaza la tabla y la paginación (p. ej. «Cambios de bucket»). */
	contenidoAlterno?: React.ReactNode;
	/** Hoy en Guatemala (YYYY-MM-DD) para «Hoy»/«Ayer» en la línea de tiempo. */
	hoy?: string;
};

export function HistorialGestionesVista({
	encabezado,
	esSupervisor,
	mostrarFiltrosEquipo,
	usuarios,
	filtros,
	onFiltros,
	filtrosActivos,
	onLimpiar,
	catalogo,
	bucketsChips,
	resumen,
	listado,
	page,
	pageSize,
	hayMasPaginas,
	onPage,
	onPageSize,
	exportacion,
	categorias,
	vistaLista,
	contenidoAlterno,
	hoy,
}: HistorialGestionesVistaProps) {
	const datos = listado.datos;
	const resumenData = resumen.datos;
	const items = datos?.items ?? [];
	const totalPaginas = datos?.totalPaginas ?? 1;
	const { buckets } = filtros;
	const esPagina = encabezado.tipo === "pagina";

	const botonExportar = (
		<Button
			variant="outline"
			size="sm"
			className="h-9"
			onClick={exportacion.onExportar}
			disabled={exportacion.exportando || exportacion.deshabilitada}
		>
			{exportacion.exportando ? (
				<Loader2 className="mr-2 h-4 w-4 animate-spin" />
			) : (
				<FileSpreadsheet className="mr-2 h-4 w-4" />
			)}
			{exportacion.exportando ? "Exportando…" : "Exportar XLSX"}
		</Button>
	);

	const acciones = (
		<div className="flex min-w-0 flex-wrap items-center gap-2.5">
			{encabezado.tipo === "seccion" ? encabezado.controles : null}
			{listado.actualizando && (
				<Loader2
					aria-label="Actualizando"
					className="h-4 w-4 animate-spin text-fg-tertiary"
				/>
			)}
			{vistaLista ? (
				<SelectorVistaLista
					valor={vistaLista.valor}
					onCambiar={vistaLista.onCambiar}
				/>
			) : null}
			{exportacion.motivo && exportacion.deshabilitada ? (
				<Tooltip>
					<TooltipTrigger asChild>
						<span>{botonExportar}</span>
					</TooltipTrigger>
					<TooltipContent>{exportacion.motivo}</TooltipContent>
				</Tooltip>
			) : (
				botonExportar
			)}
		</div>
	);

	return (
		<div
			className={
				esPagina ? "mx-auto max-w-[1600px] px-4 py-6" : "flex min-w-0 flex-col"
			}
		>
			{encabezado.tipo === "pagina" ? (
				<div className="mb-6 flex flex-wrap items-start justify-between gap-4">
					<div className="flex items-center gap-3">
						<ScrollText className="h-7 w-7 text-brand" />
						<div>
							<h1 className="font-bold text-2xl text-fg">
								{encabezado.titulo}
							</h1>
							<p className="text-fg-secondary text-sm">
								{encabezado.descripcion}
							</p>
						</div>
					</div>
					{acciones}
				</div>
			) : (
				// Mismo encabezado que las vistas de Reportería del Figma: título
				// 17/600 + subtítulo 13 y los controles a la derecha.
				<div className="mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
					{encabezado.titulo || encabezado.descripcion ? (
						<div className="flex min-w-0 flex-col gap-0.5">
							{encabezado.titulo ? (
								<h2 className="font-semibold text-[17px] text-fg leading-[1.26]">
									{encabezado.titulo}
								</h2>
							) : null}
							{encabezado.descripcion ? (
								<p className="type-body-sm text-fg-secondary">
									{encabezado.descripcion}
								</p>
							) : null}
						</div>
					) : (
						<span />
					)}
					{acciones}
				</div>
			)}

			{categorias ? (
				<ChipsCategoria
					activa={categorias.activa}
					onCambiar={categorias.onCambiar}
				/>
			) : null}

			{/* KPIs del conjunto filtrado (KPI/Simple del design system) */}
			<div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
				<TarjetaKpi
					titulo="Actividades"
					info="Gestiones registradas con los filtros aplicados."
					valor={resumenData?.total}
					cargando={resumen.cargando}
					error={resumen.error}
				/>
				<TarjetaKpi
					titulo="Contactos efectivos"
					info="Gestiones en las que se logró hablar con el cliente."
					valor={resumenData?.efectivos}
					total={resumenData?.total}
					cargando={resumen.cargando}
					error={resumen.error}
				/>
				<TarjetaKpi
					titulo="Promesas de pago"
					info="Gestiones con resultado «Promesa de pago»."
					valor={resumenData?.promesas}
					cargando={resumen.cargando}
					error={resumen.error}
				/>
				<TarjetaKpi
					titulo="Sin contacto"
					info="Gestiones en las que no se logró hablar con el cliente."
					valor={resumenData?.sinContacto}
					total={resumenData?.total}
					cargando={resumen.cargando}
					error={resumen.error}
				/>
				<TarjetaKpi
					titulo="Con próxima acción"
					info="Gestiones con una fecha de próximo contacto agendada."
					valor={resumenData?.conProximaAccion}
					cargando={resumen.cargando}
					error={resumen.error}
				/>
				{/* AC-6: cuántos registros editó una persona después de crearlos.
				    Cuenta solo ediciones manuales (audit con origen='manual'), no los
				    recálculos de estado que hace el sistema. */}
				<TarjetaKpi
					titulo="Editadas"
					info="Registros que una persona editó después de crearlos. No cuenta los recálculos del sistema."
					valor={resumenData?.editadas}
					cargando={resumen.cargando}
					error={resumen.error}
				/>
			</div>

			{/* Filtros */}
			<Card className="mb-4">
				<CardContent className="space-y-3 py-3">
					<div className="flex flex-wrap items-center gap-2">
						<DateRangeFilter
							dateRange={filtros.rangoFechas}
							onDateRangeChange={(r) => onFiltros({ rangoFechas: r })}
						/>

						{mostrarFiltrosEquipo && (
							<UsuarioCobrosMultiSelect
								usuarios={usuarios}
								// La selección de UI, NO la del backend: el componente
								// necesita distinguir `[]` ("Deseleccionar todos") de `null`
								// (nunca elegido) para saber si el próximo click selecciona un
								// usuario o lo saca de un conjunto ya completo (ver la nota
								// larga en el contenedor).
								value={filtros.usuarioIds}
								onChange={(v) => onFiltros({ usuarioIds: v })}
							/>
						)}

						{mostrarFiltrosEquipo && (
							<FiltroSelect
								ancho="w-44"
								placeholder="Todos los roles"
								valor={filtros.rol}
								onChange={(v) => onFiltros({ rol: v })}
								opciones={ROLES_FILTRABLES}
							/>
						)}

						<FiltroSelect
							ancho="w-48"
							placeholder="Todos los resultados"
							valor={filtros.estadoContacto}
							onChange={(v) => onFiltros({ estadoContacto: v })}
							opciones={ESTADOS_CONTACTO}
						/>

						<FiltroSelect
							ancho="w-40"
							placeholder="Todos los tipos"
							valor={filtros.metodoContacto}
							onChange={(v) => onFiltros({ metodoContacto: v })}
							opciones={METODOS_CONTACTO}
						/>

						<FiltroSelect
							ancho="w-44"
							placeholder="Todas las promesas"
							valor={filtros.estadoPromesa}
							onChange={(v) => onFiltros({ estadoPromesa: v })}
							opciones={[
								{ value: "pendiente", label: "Promesa pendiente" },
								{ value: "cumplida", label: "Promesa cumplida" },
								{ value: "incumplida", label: "Promesa incumplida" },
							]}
						/>

						{/* El backend filtra por igualdad exacta, no por prefijo: el
						    placeholder lo dice para que un número parcial no se lea como
						    "no hay resultados". El reset de página vive en el efecto de
						    debounce del contenedor, no acá. */}
						<Input
							className="h-8 w-44 px-3 text-[13px]"
							aria-label="No. SIFCO exacto"
							placeholder="No. SIFCO exacto"
							title="Búsqueda por número de crédito SIFCO exacto (no busca por coincidencia parcial)"
							value={filtros.busquedaSifco}
							onChange={(e) => onFiltros({ busquedaSifco: e.target.value })}
						/>

						<div className="flex items-center gap-1.5">
							<Checkbox
								id="historial-incluir-automaticos"
								size="sm"
								checked={filtros.incluirAutomaticos}
								onCheckedChange={(v) =>
									onFiltros({ incluirAutomaticos: v === true })
								}
							/>
							<Label
								htmlFor="historial-incluir-automaticos"
								className="font-normal text-fg-secondary text-sm"
							>
								Incluir automáticos
							</Label>
						</div>

						{filtrosActivos > 0 && (
							<Button variant="ghost" size="sm" onClick={onLimpiar}>
								<RotateCcw className="mr-1 h-3.5 w-3.5" />
								Limpiar ({filtrosActivos})
							</Button>
						)}
					</div>

					{/* Buckets como chips clicables en vez de un select: son el eje del
					    ticket, así que se ven de un vistazo con su conteo y se filtran
					    con un click. Los conteos vienen SIN el filtro de bucket aplicado
					    (ver getHistorialAgendasResumen), si no al elegir uno
					    desaparecerían los demás y no se podría cambiar de bucket.

					    La fila se muestra también cuando hay un bucket elegido aunque el
					    resumen venga vacío: si OTRO filtro (fecha, usuario, resultado)
					    deja el set en cero, esconderla se llevaba puesto el chip activo y
					    el de "Todos", y el único camino de salida era "Limpiar" — que
					    también borra los filtros que el usuario sí quería conservar. */}
					{(bucketsChips.length > 0 || (buckets?.length ?? 0) > 0) && (
						<div className="flex flex-wrap items-center gap-1.5 border-divider border-t pt-3">
							<span className="mr-1 font-semibold text-[10px] text-fg-tertiary uppercase tracking-wide">
								Bucket
							</span>
							<ChipBucket
								activo={!buckets?.length}
								onClick={() => onFiltros({ buckets: null })}
							>
								Todos
							</ChipBucket>
							{bucketsChips.map((b) => {
								// `null` = gestiones sin bucket registrado (previas a CB-128, o
								// créditos fuera del funnel). Es un chip como cualquier otro:
								// el grupo es grande —toda la mensajería automática de premora
								// y convenio cae ahí— y mostrar un conteo que no se puede
								// aislar sería el único filtro imposible de la pantalla. Viaja
								// como BUCKET_SIN_ASIGNAR y el backend lo traduce a IS NULL.
								const valor = b.bucket ?? BUCKET_SIN_ASIGNAR;
								const info =
									b.bucket == null ? null : bucketDeNumero(b.bucket, catalogo);
								const etiqueta = info
									? labelBucketConCodigo(info)
									: "Sin bucket";
								const seleccionado = buckets?.includes(valor) ?? false;
								return (
									<ChipBucket
										key={valor}
										activo={seleccionado}
										title={
											info
												? undefined
												: "Gestiones sin bucket registrado: anteriores a esta función, o créditos fuera del funnel (convenio, cancelado)"
										}
										onClick={() => {
											// Multi-selección: sumar o quitar del conjunto. Quedarse
											// sin ninguno equivale a "Todos" (null).
											const base = buckets ?? [];
											const next = base.includes(valor)
												? base.filter((x) => x !== valor)
												: [...base, valor];
											onFiltros({ buckets: next.length ? next : null });
										}}
									>
										{etiqueta} · {b.cantidad}
									</ChipBucket>
								);
							})}
						</div>
					)}
				</CardContent>
			</Card>

			{/* Aviso de ventana por defecto: el usuario debe saber que no está
			    viendo toda la historia si no eligió rango. */}
			{datos?.rangoAplicado?.esDefault && (
				<p className="mb-3 flex items-center gap-1.5 text-fg-tertiary text-xs">
					<CalendarClock className="h-3.5 w-3.5" />
					Mostrando los últimos 30 días. Seleccione un rango de fechas para ver
					otro período.
				</p>
			)}

			{contenidoAlterno ?? (
				<ListadoGestiones
					listado={listado}
					items={items}
					page={page}
					pageSize={pageSize}
					totalPaginas={totalPaginas}
					hayMasPaginas={hayMasPaginas}
					onPage={onPage}
					onPageSize={onPageSize}
					catalogo={catalogo}
					esSupervisor={esSupervisor}
					linea={vistaLista?.valor === "linea"}
					hoy={hoy}
				/>
			)}
		</div>
	);
}

function ListadoGestiones({
	listado,
	items,
	page,
	pageSize,
	totalPaginas,
	hayMasPaginas,
	onPage,
	onPageSize,
	catalogo,
	esSupervisor,
	linea,
	hoy,
}: {
	listado: HistorialGestionesVistaProps["listado"];
	items: RespuestaHistorial["items"];
	page: number;
	pageSize: number;
	totalPaginas: number;
	hayMasPaginas: boolean;
	onPage: (page: number) => void;
	onPageSize: (pageSize: number) => void;
	catalogo: BucketsCatalogoQueryData | undefined;
	esSupervisor: boolean;
	linea: boolean;
	hoy?: string;
}) {
	const datos = listado.datos;
	return (
		<>
			{listado.error && (
				<Card className="border-danger-subtle bg-danger-subtle">
					<CardContent className="flex items-center gap-2 py-4 text-danger-text">
						<AlertTriangle className="h-5 w-5" />
						No se pudo cargar el historial. Intente de nuevo en unos segundos.
					</CardContent>
				</Card>
			)}

			{listado.cargando && (
				<div className="flex items-center justify-center py-20 text-fg-secondary">
					<Loader2 className="mr-2 h-5 w-5 animate-spin" />
					Cargando historial…
				</div>
			)}

			{/* Página vacía CON page > 1: no es "sin resultados con estos filtros",
			    es haber pedido una página que no existe (el caso aproximado permite
			    probar una página más allá del último COUNT exacto, ver
			    hayMasPaginas). El mensaje de "sin gestiones" sería engañoso —el
			    filtro sí tiene resultados, están en páginas anteriores— y esconder
			    la paginación entera dejaría sin botón "Anterior" para volver. */}
			{!listado.error &&
				!listado.cargando &&
				items.length === 0 &&
				page === 1 && (
					<p className="py-20 text-center text-fg-tertiary text-sm">
						No hay gestiones registradas con estos filtros.
					</p>
				)}

			{!listado.error &&
				!listado.cargando &&
				items.length === 0 &&
				page > 1 && (
					<p className="py-10 text-center text-fg-tertiary text-sm">
						Esta página no tiene resultados. Regrese a la página anterior.
					</p>
				)}

			{!listado.error &&
				!listado.cargando &&
				(items.length > 0 || page > 1) && (
					<>
						{items.length > 0 &&
							(linea ? (
								<div className="rounded-2xl border border-line-subtle bg-surface p-4 sm:p-6">
									<LineaTiempoGestiones
										items={items}
										esSupervisor={esSupervisor}
										hoy={hoy}
									/>
								</div>
							) : (
								<div className="overflow-x-auto rounded-xl border border-line-subtle bg-surface contain-inline-size">
									<table className="w-full text-sm">
										<thead className="sticky top-0 bg-canvas">
											<EncabezadoHistorial />
										</thead>
										<tbody>
											{items.map((fila) => (
												<FilaHistorial
													key={fila.id}
													fila={fila}
													catalogo={catalogo}
													esSupervisor={esSupervisor}
												/>
											))}
										</tbody>
									</table>
								</div>
							))}

						<div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm">
							<span className="text-fg-secondary">
								{datos?.totalEsAproximado
									? `Más de ${(datos?.total ?? 0).toLocaleString("es-GT")} registros`
									: `${(datos?.total ?? 0).toLocaleString("es-GT")} registros`}
							</span>
							<div className="flex flex-wrap items-center gap-2">
								<Select
									value={String(pageSize)}
									onValueChange={(v) => onPageSize(Number(v))}
								>
									<SelectTrigger className="h-8 w-28">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{[25, 50, 100, 200].map((n) => (
											<SelectItem key={n} value={String(n)}>
												{n} / página
											</SelectItem>
										))}
									</SelectContent>
								</Select>
								<Button
									variant="outline"
									size="sm"
									disabled={page <= 1}
									onClick={() => onPage(Math.max(1, page - 1))}
								>
									Anterior
								</Button>
								<span className="text-fg-secondary">
									{datos?.totalEsAproximado ? (
										// `totalPaginas` sale del COUNT capado a 10,000
										// (LIMITE_CONTEO), pero `hayMasPaginas` deliberadamente
										// permite seguir navegando más allá de ese tope. Un número
										// fijo se vuelve imposible apenas se cruza ("Página 201 de
										// 200") y sigue subestimando cuántas hay en realidad —se
										// muestra como cota inferior en vez de total exacto.
										<>
											Página {page} de {totalPaginas}+
										</>
									) : (
										<>
											Página {page} de {totalPaginas}
										</>
									)}
								</span>
								<Button
									variant="outline"
									size="sm"
									disabled={!hayMasPaginas}
									onClick={() => onPage(page + 1)}
								>
									Siguiente
								</Button>
							</div>
						</div>
					</>
				)}
		</>
	);
}

/** Chips de categoría del Historial de actividad del asesor (Figma 4063:12). */
export function ChipsCategoria({
	activa,
	onCambiar,
}: {
	activa: CategoriaActividad;
	onCambiar: (categoria: CategoriaActividad) => void;
}) {
	return (
		<fieldset className="mb-4 flex min-w-0 flex-wrap items-center gap-2">
			<legend className="sr-only">Categoría de actividad</legend>
			{CATEGORIAS_ACTIVIDAD.map((c) => {
				const chip = (
					<FilterChip
						key={c.clave}
						seleccionado={activa === c.clave}
						disabled={c.pronto}
						onClick={() => onCambiar(c.clave)}
						className="text-[13px]"
					>
						{c.etiqueta}
						{c.pronto ? (
							<Badge variant="secondary" className="ml-0.5 px-1.5 py-0">
								Pronto
							</Badge>
						) : null}
					</FilterChip>
				);
				return (
					<Tooltip key={c.clave}>
						<TooltipTrigger asChild>
							{/* El span deja que el tooltip funcione aun con el chip deshabilitado. */}
							<span className="inline-flex">{chip}</span>
						</TooltipTrigger>
						<TooltipContent>{c.descripcion}</TooltipContent>
					</Tooltip>
				);
			})}
		</fieldset>
	);
}

/** Tabla o línea de tiempo (segmentado de dos opciones). */
export function SelectorVistaLista({
	valor,
	onCambiar,
}: {
	valor: "tabla" | "linea";
	onCambiar: (valor: "tabla" | "linea") => void;
}) {
	const opcion = (
		v: "tabla" | "linea",
		Icono: typeof Table2,
		texto: string,
	) => (
		<button
			type="button"
			aria-pressed={valor === v}
			onClick={() => onCambiar(v)}
			className={cn(
				"inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2.5 font-medium text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
				valor === v
					? "bg-brand-subtle text-brand"
					: "text-fg-secondary hover:bg-muted",
			)}
		>
			<Icono aria-hidden className="size-3.5" />
			{texto}
		</button>
	);
	return (
		<fieldset className="inline-flex items-center gap-0.5 rounded-lg border border-line-subtle bg-surface p-0.5">
			<legend className="sr-only">Vista</legend>
			{opcion("linea", History, "Línea de tiempo")}
			{opcion("tabla", Table2, "Tabla")}
		</fieldset>
	);
}

/**
 * Chip de bucket clicable — reemplaza al select de buckets.
 *
 * Se prefiere sobre un `<Select>` porque el bucket es el eje del reporte: con
 * chips el supervisor ve de un vistazo cuántas gestiones hay en cada etapa Y
 * filtra con un click, en vez de abrir un desplegable para descubrirlo.
 * Es el FilterChip del design system (Cartera/FilterChip), igual que los chips
 * de categoría: el código del bucket va en la etiqueta («B2 – Gestión Activa»).
 */
function ChipBucket({
	activo,
	title,
	onClick,
	children,
}: {
	activo: boolean;
	/** Tooltip opcional — lo usa "Sin bucket" para explicar qué agrupa. */
	title?: string;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<FilterChip seleccionado={activo} title={title} onClick={onClick}>
			{children}
		</FilterChip>
	);
}

function TarjetaKpi({
	titulo,
	info,
	valor,
	total,
	cargando,
	error,
}: {
	titulo: string;
	info: string;
	valor: number | undefined;
	/** Con `total`, la tarjeta dice qué % de las actividades representa. */
	total?: number;
	cargando: boolean;
	// Reintentos agotados de getHistorialAgendasResumen: `resumen.data` queda
	// `undefined` con `isPending: false`, igual que "cargó y dio 0" — sin este
	// estado separado, un fallo de red se mostraba como "Actividades: 0" pese a
	// que la tabla de abajo sí tiene filas. Fabrica una métrica del reporte
	// durante una falla parcial en vez de señalarla.
	error: boolean;
}) {
	if (cargando) {
		return (
			<KpiCard aria-busy className="gap-2 p-4 sm:p-5">
				<p className="font-medium text-[13px] text-fg-secondary leading-[1.26]">
					{titulo}
				</p>
				<Skeleton className="h-9 w-16" />
			</KpiCard>
		);
	}
	const pct =
		!error && total && total > 0 && valor !== undefined
			? Math.round((valor / total) * 100)
			: null;
	return (
		<KpiSimple
			title={titulo}
			info={error ? "No se pudo cargar este dato." : info}
			showIcon={false}
			value={
				error ? (
					<span className="text-fg-tertiary">—</span>
				) : (
					(valor ?? 0).toLocaleString("es-GT")
				)
			}
			showTrend={pct !== null}
			comparison={pct !== null ? `${pct}% de las actividades` : undefined}
			className="gap-2 p-4 sm:p-5"
		/>
	);
}

function FiltroSelect({
	valor,
	onChange,
	opciones,
	placeholder,
	ancho,
}: {
	valor: string;
	onChange: (v: string) => void;
	opciones: readonly { value: string; label: string }[];
	placeholder: string;
	ancho: string;
}) {
	return (
		<Select value={valor} onValueChange={onChange}>
			<SelectTrigger className={`h-8 ${ancho}`}>
				<SelectValue placeholder={placeholder} />
			</SelectTrigger>
			<SelectContent>
				<SelectItem value="todos">{placeholder}</SelectItem>
				{opciones.map((o) => (
					<SelectItem key={o.value} value={o.value}>
						{o.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}
