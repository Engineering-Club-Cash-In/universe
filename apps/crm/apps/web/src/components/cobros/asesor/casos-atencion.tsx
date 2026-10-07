import { useNavigate } from "@tanstack/react-router";
import { ArrowRight, CircleCheck, Phone, UserCheck, X } from "lucide-react";
import type * as React from "react";
import type { CasoNavegable } from "@/components/cobros/workspace/workspace-modal";
import { BucketBadge, MoraBadge } from "@/components/ds/badges";
import { FilaCredito, TablaCartera } from "@/components/ds/tabla-cartera";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { SectionHeader } from "@/components/ui/section-header";
import { Skeleton } from "@/components/ui/skeleton";
import { TableCell, TableRow } from "@/components/ui/table";
import { ToolbarButton } from "@/components/ui/toolbar-button";
import { cn } from "@/lib/utils";
import {
	AccionesFila,
	AccionPendienteCelda,
	bucketDeFila,
	type ColumnaOpcional,
	destinoFicha,
	EstadoGestionCelda,
	type FilaCartera,
	type FilaCola,
	FilaCreditoAsesor,
	fechaCorta,
	moraDeEstado,
	propsFilaEnfocable,
	SeguimientoCelda,
	useColumnasVisibles,
} from "./fila-cartera";

/**
 * "Casos que requieren atención hoy" del Dashboard del asesor (Figma ›
 * 01 · Dashboard › Table/Cartera con Prioridad). Presentación: recibe las filas
 * de la cola del día (getColaDia) ya unidas con su fila de cartera
 * (getTodosLosCreditos por SIFCO) para tener todas las columnas de Figma.
 *
 * Toolbar: Buscar, Filtros y Ordenar llevan a Mi Cartera (allí viven la búsqueda
 * y los filtros completos); Columnas es el selector de useColumnasVisibles, con
 * las columnas que ya mostraba Mi día (Límite SLA, Teléfono, Promesa de pago,
 * Categoría) como opcionales.
 */

export type FilaAtencion = {
	cola: FilaCola;
	/** Fila de cartera del mismo SIFCO; `null` si cartera no la devolvió. */
	credito: FilaCartera | null;
};

export type EstadoCasos =
	| "cargando"
	| "error"
	| "sinAsesor"
	| "ausente"
	| "listo";

export type CasosAtencionProps = {
	estado: EstadoCasos;
	filas: FilaAtencion[];
	total: number;
	page: number;
	perPage: number;
	totalPages: number;
	onPage: (page: number) => void;
	/** Se está refrescando en segundo plano (paginación, refetch). */
	actualizando?: boolean;
	/** Etiqueta del contador de la agenda que filtra la tabla. */
	filtro: string | null;
	onQuitarFiltro: () => void;
	onReintentar: () => void;
	/** Abre Mi Cartera (la cola de trabajo completa). */
	onVerCartera: () => void;
	onVistaRapida: (creditoId: string) => void;
	/**
	 * Clic en una fila: abre el Workspace en esa posición de
	 * `casosNavegablesDeAtencion(filas)`. Sin él, la fila navega a la Ficha 360.
	 */
	onAbrir?: (indice: number) => void;
};

/**
 * La lista del Workspace, en el orden de la tabla: misma id y tipo con que
 * cada fila abre la Ficha 360 (`destinoFicha`, o el SIFCO de la cola si
 * cartera no devolvió la fila).
 */
export function casosNavegablesDeAtencion(
	filas: FilaAtencion[],
): CasoNavegable[] {
	return filas.map(({ cola, credito }) =>
		credito
			? { ...destinoFicha(credito), nombre: credito.clienteNombre ?? undefined }
			: {
					id: cola.numeroCreditoSifco,
					tipo: cola.casoId ? "caso" : "contrato",
					nombre: cola.cliente ?? undefined,
				},
	);
}

const COLUMNAS_OPCIONALES: ColumnaOpcional[] = [
	{ id: "limiteSla", etiqueta: "Límite SLA", ancho: 104, despuesDe: "fecha" },
	{
		id: "promesa",
		etiqueta: "Promesa de pago",
		ancho: 120,
		despuesDe: "fecha",
	},
	{
		id: "categoria",
		etiqueta: "Categoría",
		ancho: 210,
		celda: "pl-6",
		despuesDe: "accion",
	},
	{ id: "telefono", etiqueta: "Teléfono", ancho: 130, despuesDe: "accion" },
];

/* ── Celdas ─────────────────────────────────────────────────────────────────── */

const KEY_POR_NUMERO = [
	"al_dia",
	"mora_30",
	"mora_60",
	"mora_90",
	"mora_120",
	"mora_120_plus",
] as const;

function CategoriaBadges({ item }: { item: FilaCola }) {
	const badges: {
		texto: string;
		variante: "danger" | "warning" | "info" | "brand";
	}[] = [];
	if (item.slaHoy) badges.push({ texto: "Gestionar hoy", variante: "danger" });
	if (item.promesaHoy)
		badges.push({ texto: "Promesa hoy", variante: "warning" });
	if (item.venceHoy)
		badges.push({ texto: "Cuota vence hoy", variante: "warning" });
	if (item.incumplida)
		badges.push({ texto: "Promesa vencida", variante: "danger" });
	if (item.promesaProxima)
		badges.push({ texto: "Promesa próxima", variante: "info" });
	if (item.sinContacto)
		badges.push({
			texto: `${item.diasSinContacto ?? 0} días sin contacto`,
			variante: "brand",
		});
	if (badges.length === 0) {
		return <span className="text-[13px] text-fg-tertiary">—</span>;
	}
	return (
		<span className="flex flex-wrap gap-1 whitespace-normal">
			{badges.map((b) => (
				<Badge key={b.texto} variant={b.variante} className="text-[10px]">
					{b.texto}
				</Badge>
			))}
		</span>
	);
}

function celdasOpcionales(item: FilaCola): Record<string, React.ReactNode> {
	const texto = "font-semibold text-[13px] text-fg leading-[1.26] tabular-nums";
	return {
		limiteSla: item.fechaLimiteSla ? (
			<span className={texto}>{fechaCorta(item.fechaLimiteSla)}</span>
		) : (
			<span className="text-[13px] text-fg-tertiary">—</span>
		),
		promesa: item.fechaPromesa ? (
			<span className={texto}>{fechaCorta(item.fechaPromesa)}</span>
		) : (
			<span className="text-[13px] text-fg-tertiary">—</span>
		),
		categoria: <CategoriaBadges item={item} />,
		telefono: item.telefono ? (
			<span className="inline-flex items-center gap-1 text-[13px] text-fg tabular-nums">
				<Phone aria-hidden className="size-3 text-fg-tertiary" />
				{item.telefono}
			</span>
		) : (
			<span className="text-[12px] text-fg-tertiary">Sin teléfono</span>
		),
	};
}

/** Igual a la Identidad de FilaCredito, con "Cubriendo a X" en la 2.ª línea. */
function ClienteCubierto({
	nombre,
	detalle,
	asesor,
}: {
	nombre: string;
	detalle: string;
	asesor: string | null | undefined;
}) {
	return (
		<div className="flex min-w-0 flex-col gap-0.5">
			<span className="truncate font-semibold text-[13px] text-fg leading-[1.26]">
				{nombre}
			</span>
			<span className="truncate text-[11px] text-fg-tertiary leading-[1.26]">
				<span className="inline-flex items-center gap-0.5 font-semibold text-brand">
					<UserCheck aria-hidden className="size-3" />
					{asesor ? `Cubriendo a ${asesor}` : "Cobertura"}
				</span>
				{detalle ? ` · ${detalle}` : ""}
			</span>
		</div>
	);
}

function detalleVehiculo(
	marca: string | null,
	modelo: string | null,
	placa: string | null,
	sifco: string | null,
) {
	const vehiculo = [marca, modelo].filter((v) => v && v !== "-").join(" ");
	return [vehiculo, placa, sifco].filter((v) => v && v !== "-").join(" · ");
}

/** Fila cuando cartera no devolvió el SIFCO: se arma con lo de la cola. */
function FilaSoloCola({
	item,
	prioridad,
	extras,
	onVistaRapida,
	onAbrir,
}: {
	item: FilaCola;
	prioridad: number;
	extras: Record<string, React.ReactNode>;
	onVistaRapida: (creditoId: string) => void;
	/** Clic en la fila (Workspace). Sin él, navega a la Ficha 360. */
	onAbrir?: () => void;
}) {
	const navigate = useNavigate();
	const bucket = bucketDeFila(item.bucket, null);
	const mora = moraDeEstado(KEY_POR_NUMERO[item.bucket]);
	const tipo = item.casoId ? "caso" : "contrato";
	const minima = {
		numeroCredito: item.numeroCreditoSifco,
		contratoId: item.numeroCreditoSifco,
		casoCobroId: item.casoId,
	} as unknown as FilaCartera;
	const abrir = () =>
		onAbrir
			? onAbrir()
			: navigate({
					to: "/cobros/$id",
					params: { id: item.numeroCreditoSifco },
					search: { tipo },
				});
	return (
		<FilaCredito
			prioridad={prioridad}
			className="cursor-pointer focus-visible:bg-muted focus-visible:outline-none"
			onClick={abrir}
			{...(onAbrir ? propsFilaEnfocable(abrir) : {})}
			cliente={item.cliente}
			detalle={
				detalleVehiculo(
					item.vehiculoMarca,
					item.vehiculoModelo,
					item.vehiculoPlaca,
					item.numeroCreditoSifco,
				) || undefined
			}
			bucket={bucket ? <BucketBadge bucket={bucket} /> : "—"}
			mora={mora ? <MoraBadge mora={mora} /> : "—"}
			deudaVencida="—"
			cuotaNormal={item.montoCuotaHoy ? Number(item.montoCuotaHoy) : "—"}
			fechaPago="—"
			seguimiento={<SeguimientoCelda seguimiento={item.seguimiento} />}
			estadoGestion={<EstadoGestionCelda estado={item.estadoGestion} />}
			accionPendiente={<AccionPendienteCelda accion={item.accionPendiente} />}
			extras={{
				acciones: <AccionesFila fila={minima} onVistaRapida={onVistaRapida} />,
				...extras,
			}}
		/>
	);
}

const FILAS_RELLENO = ["a", "b", "c", "d", "e"];

function FilasCargando({ columnas }: { columnas: number }) {
	return (
		<>
			{FILAS_RELLENO.map((k) => (
				<TableRow
					key={k}
					className="border-divider border-b hover:bg-transparent"
				>
					<TableCell colSpan={columnas} className="h-14 px-4">
						<Skeleton className="h-6 w-full" />
					</TableCell>
				</TableRow>
			))}
		</>
	);
}

/* ── Sección ────────────────────────────────────────────────────────────────── */

export function CasosAtencion({
	estado,
	filas,
	total,
	page,
	perPage,
	totalPages,
	onPage,
	actualizando = false,
	filtro,
	onQuitarFiltro,
	onReintentar,
	onVerCartera,
	onVistaRapida,
	onAbrir,
}: CasosAtencionProps) {
	const { columnas, menu } = useColumnasVisibles(
		"dashboard",
		COLUMNAS_OPCIONALES,
	);
	const columnasTotales = columnas.length + 1;

	let vacio: React.ReactNode;
	if (estado === "sinAsesor") {
		vacio = (
			<EmptyState
				size="sm"
				variant="no-data"
				title="Sin cartera asignada"
				description="Su usuario no está vinculado a un asesor de cartera (por correo). Solicite al supervisor que revise su correo de asesor."
			/>
		);
	} else if (estado === "ausente") {
		vacio = (
			<EmptyState
				size="sm"
				variant="no-data"
				title="Hoy está registrado como ausente"
				description="Su suplente está trabajando su agenda. Su cartera sigue asignada a usted."
			/>
		);
	} else if (estado === "error") {
		vacio = (
			<EmptyState
				size="sm"
				variant="error"
				title="No se pudieron cargar los casos de hoy"
				action={
					<Button variant="outline" size="sm" onClick={onReintentar}>
						Reintentar
					</Button>
				}
			/>
		);
	} else if (filtro) {
		vacio = (
			<EmptyState
				size="sm"
				variant="empty"
				title="Sin casos en esta categoría hoy"
				description={`Ningún caso de su cartera coincide con «${filtro}».`}
				action={
					<div className="flex flex-wrap justify-center gap-2">
						<Button variant="outline" size="sm" onClick={onQuitarFiltro}>
							Quitar filtro
						</Button>
						<Button variant="link" size="sm" onClick={onVerCartera}>
							Ver toda mi cartera
						</Button>
					</div>
				}
			/>
		);
	} else {
		vacio = (
			<EmptyState
				size="sm"
				variant="empty"
				icon={<CircleCheck aria-hidden className="text-success-solid" />}
				title="Todo al día"
				description="No tiene casos que requieran atención hoy. Buen trabajo."
				action={
					<Button variant="outline" size="sm" onClick={onVerCartera}>
						Ver toda mi cartera
					</Button>
				}
			/>
		);
	}

	const conFilas = estado === "listo" && filas.length > 0;

	return (
		<section className="flex flex-col gap-4">
			<SectionHeader
				titleAs="h2"
				title="Casos que requieren atención hoy"
				description={
					onAbrir
						? "Ordenados por prioridad. Abra un caso para gestionarlo en el espacio de trabajo."
						: "Ordenados por prioridad. Abra la Ficha 360 para gestionar."
				}
				action={
					<Button variant="link" size="sm" onClick={onVerCartera}>
						Ver cartera completa
						<ArrowRight aria-hidden />
					</Button>
				}
			/>
			{filtro ? (
				<div className="flex flex-wrap items-center gap-2">
					<span className="type-body-sm text-fg-secondary">Filtrado por</span>
					<Badge variant="brand" className="gap-1.5 py-1 pr-1.5 pl-2.5">
						{filtro}
						<button
							type="button"
							onClick={onQuitarFiltro}
							aria-label="Quitar filtro"
							className="inline-flex size-4 cursor-pointer items-center justify-center rounded-full hover:bg-brand/15"
						>
							<X aria-hidden className="size-3" />
						</button>
					</Badge>
					<Button variant="link" size="sm" onClick={onQuitarFiltro}>
						Quitar filtro
					</Button>
				</div>
			) : null}
			<TablaCartera
				titulo="Cartera Asignada"
				contador={estado === "listo" ? total : null}
				prioridad
				columnas={columnas}
				className={cn("@container", actualizando && "opacity-90")}
				herramientas={
					<>
						<ToolbarButton action="buscar" onClick={onVerCartera} />
						<ToolbarButton action="filtros" onClick={onVerCartera} />
						<ToolbarButton action="ordenar" onClick={onVerCartera} />
						{menu}
					</>
				}
				// El vacío ocupa el ancho visible (no el de la tabla, que puede
				// desbordar y hacer scroll): la tabla es contenedor de `cqw`.
				vacio={
					<div className="sticky left-0 w-[calc(100cqw-1rem)]">{vacio}</div>
				}
				pie={
					conFilas && totalPages > 1 ? (
						<Pagination
							className="rounded-none border-0 border-line-subtle border-t"
							page={page}
							pageCount={totalPages}
							onPageChange={onPage}
							totalItems={total}
							pageSize={perPage}
							disabled={actualizando}
						/>
					) : conFilas ? (
						<div className="type-caption border-line-subtle border-t px-4 py-3 text-fg-tertiary">
							Mostrando {filas.length} de {total}
						</div>
					) : null
				}
			>
				{estado === "cargando" ? (
					<FilasCargando columnas={columnasTotales} />
				) : conFilas ? (
					filas.map(({ cola, credito }, i) => {
						const prioridad = (page - 1) * perPage + i + 1;
						const extras = celdasOpcionales(cola);
						if (!credito) {
							return (
								<FilaSoloCola
									key={cola.creditoId}
									item={cola}
									prioridad={prioridad}
									extras={
										cola.cubierto
											? {
													...extras,
													cliente: (
														<ClienteCubierto
															nombre={cola.cliente}
															asesor={cola.asesor}
															detalle={detalleVehiculo(
																cola.vehiculoMarca,
																cola.vehiculoModelo,
																cola.vehiculoPlaca,
																cola.numeroCreditoSifco,
															)}
														/>
													),
												}
											: extras
									}
									onVistaRapida={onVistaRapida}
									onAbrir={onAbrir ? () => onAbrir(i) : undefined}
								/>
							);
						}
						return (
							<FilaCreditoAsesor
								key={cola.creditoId}
								fila={credito}
								prioridad={prioridad}
								onVistaRapida={onVistaRapida}
								onAbrir={onAbrir ? () => onAbrir(i) : undefined}
								extras={
									cola.cubierto
										? {
												...extras,
												cliente: (
													<ClienteCubierto
														nombre={credito.clienteNombre}
														asesor={cola.asesor}
														detalle={detalleVehiculo(
															credito.vehiculoMarca,
															credito.vehiculoModelo,
															credito.vehiculoPlaca,
															credito.numeroCredito,
														)}
													/>
												),
											}
										: extras
								}
							/>
						);
					})
				) : null}
			</TablaCartera>
		</section>
	);
}
