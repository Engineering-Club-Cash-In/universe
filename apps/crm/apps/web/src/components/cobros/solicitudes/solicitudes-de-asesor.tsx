/**
 * «Solicitudes de {asesor}» (Figma 3654:5711): todo lo que un asesor envió a
 * aprobación del supervisor, con su estado y su resultado. La usa el Detalle
 * del asesor (/cobros/equipo/$asesorId › pestaña Solicitudes).
 *
 *  - `SolicitudesDeAsesorVista`: solo presentación (props). La usa el showcase.
 *  - `SolicitudesDeAsesor`: el contenedor, con props
 *    `{ asesorId, userId, nombre }` (asesor_id de cartera, userId del CRM y
 *    nombre del catálogo `getAsesoresTraslados`).
 *
 * Fuentes: convenios del asesor (`getConveniosListado` con `asesorId`, todos
 * los estados), la cola y el historial de apagados y reactivaciones, y las
 * solicitudes de recuperación del vehículo. Las pendientes abren el Espacio de
 * aprobación; las demás llevan a la Ficha 360.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Info } from "lucide-react";
import * as React from "react";
import { etiquetaMotivo } from "server/src/lib/recuperacion-vehiculo";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { orpc, orpcAparte } from "@/utils/orpc";
import { EspacioAprobacion, useEspacioAprobacion } from "./espacio-aprobacion";
import {
	type ConvenioFuente,
	ETIQUETA_TIPO,
	esSolicitudDeAsesor,
	type InmovilizacionHistorialFuente,
	type RecuperacionFuente,
	type Solicitud,
	solicitudDeConvenio,
	solicitudDeInmovilizacion,
	solicitudDeRecuperacion,
	type TipoSolicitud,
} from "./normalizar";
import {
	fechaGT,
	fechaHoraCorta,
	quetzales,
	TextoDecision,
	TipoConPunto,
	type TonoDecision,
} from "./piezas";
import {
	useHistorialInmovilizaciones,
	useNombreUsuarioCrm,
	useSolicitudesPendientes,
} from "./use-solicitudes";

/* ── Tipos ──────────────────────────────────────────────────────────────────── */

export type EstadoSolicitudAsesor =
	| "pendiente"
	| "aprobada"
	| "rechazada"
	| "cancelada"
	| "sin_efecto";

const ESTADO: Record<
	EstadoSolicitudAsesor,
	{ etiqueta: string; tono: TonoDecision }
> = {
	pendiente: { etiqueta: "Pendiente", tono: "warning" },
	aprobada: { etiqueta: "Aprobada", tono: "success" },
	rechazada: { etiqueta: "Rechazada", tono: "danger" },
	cancelada: { etiqueta: "Cancelada", tono: "neutral" },
	sin_efecto: { etiqueta: "Sin efecto", tono: "neutral" },
};

export type FilaSolicitudAsesor = {
	id: string;
	/** ISO de la solicitud. */
	fecha: string | null;
	tipo: TipoSolicitud;
	credito: string | null;
	bucket: number | null;
	cliente: string;
	estado: EstadoSolicitudAsesor;
	resultado: string | null;
	/** Solo las que esperan decisión: abre el Espacio de aprobación. */
	solicitud?: Solicitud;
	/** Ficha 360 del crédito (id de /cobros/$id). */
	ficha: { id: string; seccion?: "inmovilizacion" } | null;
};

export type SolicitudesDeAsesorVistaProps = {
	nombre: string;
	/** El asesor no tiene usuario del CRM: sus solicitudes se asocian por nombre. */
	sinUsuario?: boolean;
	filas: FilaSolicitudAsesor[];
	cargando: boolean;
	error: boolean;
	onReintentar: () => void;
	/** Abre una solicitud pendiente en el Espacio de aprobación. */
	onAbrir?: (fila: FilaSolicitudAsesor) => void;
	/** Hay apagados y reactivaciones más viejos sin cargar. */
	onCargarMas?: () => void;
	cargandoMas?: boolean;
};

/* ── Vista ──────────────────────────────────────────────────────────────────── */

const CABECERA =
	"h-9 px-0 font-semibold text-[10px] text-fg-tertiary uppercase leading-[1.26] first:pl-6 last:pr-6";
const CELDA = "whitespace-normal py-3.5 pr-4 align-middle first:pl-6 last:pr-6";

export function SolicitudesDeAsesorVista({
	nombre,
	sinUsuario,
	filas,
	cargando,
	error,
	onReintentar,
	onAbrir,
	onCargarMas,
	cargandoMas,
}: SolicitudesDeAsesorVistaProps) {
	let cuerpo: React.ReactNode;
	if (cargando && filas.length === 0) {
		cuerpo = (
			<div className="flex flex-col gap-3 p-6" aria-hidden>
				{[0, 1, 2, 3].map((i) => (
					<Skeleton key={i} className="h-10 w-full" />
				))}
			</div>
		);
	} else if (error && filas.length === 0) {
		cuerpo = (
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
		);
	} else if (filas.length === 0) {
		cuerpo = (
			<EmptyState
				size="sm"
				variant="empty"
				title="Sin solicitudes"
				description={`${nombre} no ha enviado solicitudes a aprobación.`}
			/>
		);
	} else {
		cuerpo = (
			<div className="overflow-x-auto">
				<Table className="min-w-240 table-fixed text-fg">
					<TableHeader className="[&_tr]:border-divider">
						<TableRow className="hover:bg-transparent">
							<TableHead className={cn(CABECERA, "w-32")}>Fecha</TableHead>
							<TableHead className={cn(CABECERA, "w-48")}>Tipo</TableHead>
							<TableHead className={cn(CABECERA, "w-60")}>Crédito</TableHead>
							<TableHead className={CABECERA}>Cliente</TableHead>
							<TableHead className={cn(CABECERA, "w-28")}>Estado</TableHead>
							<TableHead className={CABECERA}>Resultado</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{filas.map((f) => {
							const estado = ESTADO[f.estado];
							const abrir =
								f.solicitud && onAbrir ? () => onAbrir(f) : undefined;
							return (
								<TableRow
									key={f.id}
									className={cn(
										"border-divider",
										abrir && "cursor-pointer hover:bg-brand-subtle",
									)}
									onClick={abrir}
								>
									<TableCell
										className={cn(
											CELDA,
											"whitespace-nowrap text-[13px] text-fg-secondary",
										)}
									>
										{fechaHoraCorta(f.fecha)}
									</TableCell>
									<TableCell className={CELDA}>
										<TipoConPunto clave={f.tipo}>
											{ETIQUETA_TIPO[f.tipo]}
										</TipoConPunto>
									</TableCell>
									<TableCell className={CELDA}>
										<div className="flex flex-col gap-0.5">
											{f.ficha && !abrir ? (
												<Link
													to="/cobros/$id"
													params={{ id: f.ficha.id }}
													search={{
														tipo: "caso" as const,
														...(f.ficha.seccion
															? { seccion: f.ficha.seccion }
															: {}),
													}}
													className="rounded-sm font-semibold text-[13px] text-fg leading-[1.26] outline-none hover:text-brand hover:underline focus-visible:ring-2 focus-visible:ring-ring"
												>
													Crédito #{f.credito ?? "—"}
												</Link>
											) : abrir ? (
												<button
													type="button"
													onClick={(e) => {
														e.stopPropagation();
														abrir();
													}}
													className="w-fit rounded-sm text-left font-semibold text-[13px] text-fg leading-[1.26] outline-none hover:text-brand hover:underline focus-visible:ring-2 focus-visible:ring-ring"
												>
													Crédito #{f.credito ?? "—"}
												</button>
											) : (
												<span className="font-semibold text-[13px] leading-[1.26]">
													Crédito #{f.credito ?? "—"}
												</span>
											)}
											<span className="text-[11px] text-fg-tertiary leading-[1.26]">
												{f.bucket !== null ? `B${f.bucket}` : "Sin bucket"}
											</span>
										</div>
									</TableCell>
									<TableCell
										className={cn(
											CELDA,
											"wrap-break-word text-[13px] text-fg-secondary",
										)}
									>
										{f.cliente}
									</TableCell>
									<TableCell className={CELDA}>
										<TextoDecision tono={estado.tono}>
											{estado.etiqueta}
										</TextoDecision>
									</TableCell>
									<TableCell
										className={cn(
											CELDA,
											"wrap-break-word text-[13px] text-fg-secondary",
										)}
									>
										{f.resultado || "—"}
									</TableCell>
								</TableRow>
							);
						})}
					</TableBody>
				</Table>
			</div>
		);
	}

	return (
		<section className="flex flex-col gap-4">
			<header className="flex flex-col gap-1">
				<h2 className="wrap-break-word font-semibold text-fg text-xl leading-[1.26]">
					Solicitudes de {nombre}
				</h2>
				<p className="type-body-base text-fg-secondary">
					Todo lo que envió a aprobación del supervisor · con su resultado
				</p>
			</header>
			<div className="@container overflow-hidden rounded-2xl border border-line-subtle bg-surface shadow-clay-raised">
				{cuerpo}
				{onCargarMas ? (
					<div className="flex justify-center border-divider border-t px-4 py-3">
						<Button
							variant="ghost"
							size="sm"
							onClick={onCargarMas}
							loading={cargandoMas}
						>
							Cargar apagados y reactivaciones más antiguos
						</Button>
					</div>
				) : null}
			</div>
			<p className="type-caption flex items-start gap-2 text-fg-tertiary">
				<Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
				<span>
					Los convenios rechazados salen de la bitácora de decisiones del
					supervisor (cartera elimina el convenio al rechazarlo).
					{sinUsuario
						? " Este asesor no tiene usuario del CRM vinculado: sus apagados, reactivaciones y recuperaciones se asocian por el nombre de quien los solicitó."
						: ""}
				</span>
			</p>
		</section>
	);
}

/* ── Filas ──────────────────────────────────────────────────────────────────── */

const ESTADO_INMOVILIZACION: Record<string, EstadoSolicitudAsesor> = {
	pendiente_aprobacion: "pendiente",
	aprobada: "aprobada",
	ejecutada: "aprobada",
	rechazada: "rechazada",
	cancelada: "cancelada",
};

function filaDeConvenio(c: ConvenioFuente): FilaSolicitudAsesor {
	const pendiente = !c.activo && !c.completado;
	const plan = [
		c.numero_meses
			? `${c.numero_meses} ${c.numero_meses === 1 ? "cuota" : "cuotas"}`
			: null,
		c.cuota_mensual ? `${quetzales(c.cuota_mensual)} al mes` : null,
	]
		.filter(Boolean)
		.join(" · ");
	return {
		id: `convenio-${c.convenio_id}`,
		fecha: c.fecha_convenio,
		tipo: "convenio",
		credito: c.numero_credito_sifco,
		bucket: c.bucket_previo ?? null,
		cliente: c.cliente_nombre || "Sin nombre",
		estado: pendiente ? "pendiente" : "aprobada",
		resultado: pendiente
			? plan || null
			: `${c.completado ? "Convenio cumplido" : "Convenio activo"}${plan ? ` · ${plan}` : ""}`,
		solicitud: pendiente ? solicitudDeConvenio(c) : undefined,
		ficha: { id: c.numero_credito_sifco },
	};
}

/** Una decisión de convenio rechazada, de la bitácora del supervisor (M3). */
function filaDeConvenioRechazado(d: {
	id: string;
	fecha: string;
	credito: { sifco: string; cliente: string | null } | null;
	resumen: string | null;
	nota: string | null;
	motivo: string | null;
}): FilaSolicitudAsesor {
	return {
		id: d.id,
		fecha: d.fecha,
		tipo: "convenio",
		credito: d.credito?.sifco ?? null,
		bucket: null,
		cliente: d.credito?.cliente?.trim() || "Sin nombre",
		estado: "rechazada",
		resultado: d.nota ?? d.resumen ?? d.motivo ?? null,
		ficha: d.credito ? { id: d.credito.sifco } : null,
	};
}

function filaDeInmovilizacion(
	i: InmovilizacionHistorialFuente,
	solicitud?: Solicitud,
): FilaSolicitudAsesor {
	const estado = ESTADO_INMOVILIZACION[i.estado] ?? "pendiente";
	const resultado =
		i.estado === "rechazada"
			? (i.motivoRechazo ?? null)
			: i.estado === "aprobada"
				? "Aprobada · pendiente de ejecución"
				: i.estado === "ejecutada"
					? `Ejecutada el ${fechaGT(i.ejecutadoAt)}`
					: (i.motivo ?? null);
	return {
		id: `inmovilizacion-${i.id}`,
		fecha: solicitudDeInmovilizacion(i).solicitadoEn,
		tipo: i.accion === "reactivacion" ? "reactivacion" : "apagado",
		credito: i.numeroCreditoSifco,
		bucket: i.bucketSnapshot ?? null,
		cliente: i.clienteNombre ?? "Sin nombre",
		estado,
		resultado,
		solicitud: i.estado === "pendiente_aprobacion" ? solicitud : undefined,
		ficha: i.casoCobroId
			? { id: i.casoCobroId, seccion: "inmovilizacion" }
			: { id: i.numeroCreditoSifco, seccion: "inmovilizacion" },
	};
}

function filaDeRecuperacion(r: RecuperacionFuente): FilaSolicitudAsesor {
	const estado = (
		r.estadoSolicitud && r.estadoSolicitud in ESTADO
			? r.estadoSolicitud
			: "pendiente"
	) as EstadoSolicitudAsesor;
	const motivos = (r.motivos ?? [])
		.filter((m) => m !== "otro")
		.map(etiquetaMotivo)
		.join(", ");
	return {
		id: `recuperacion-${r.id}`,
		fecha: solicitudDeRecuperacion(r).solicitadoEn,
		tipo: "recuperacion",
		credito: r.numeroSifco,
		bucket: r.bucketOrigen ?? null,
		cliente: r.cliente?.trim() || "Sin nombre",
		estado,
		resultado:
			estado === "pendiente"
				? motivos || r.motivoDetalle || null
				: estado === "aprobada"
					? "Enviado a B4 · En recuperación"
					: (r.motivoDecision ?? null),
		solicitud: estado === "pendiente" ? solicitudDeRecuperacion(r) : undefined,
		ficha: r.casoCobroId
			? { id: r.casoCobroId }
			: r.numeroSifco
				? { id: r.numeroSifco }
				: null,
	};
}

/** Las más recientes primero (Figma). */
function porFechaDesc(a: FilaSolicitudAsesor, b: FilaSolicitudAsesor) {
	return new Date(b.fecha ?? 0).getTime() - new Date(a.fecha ?? 0).getTime();
}

/* ── Contenedor ─────────────────────────────────────────────────────────────── */

export function SolicitudesDeAsesor({
	asesorId,
	userId,
	nombre,
}: {
	/** asesor_id de cartera. */
	asesorId: number;
	/** userId del CRM (de `getAsesoresTraslados`); null si no tiene usuario. */
	userId: string | null;
	nombre: string;
}) {
	const habilitado = Number.isInteger(asesorId) && asesorId > 0;
	const [paginas, setPaginas] = React.useState(1);

	const convenios = useQuery({
		...orpc.getConveniosListado.queryOptions({
			input: { estado: "all", asesorId, page: 1, perPage: 100 },
		}),
		enabled: habilitado,
	});
	// M3: los convenios rechazados (cartera los borra) salen de la bitácora de
	// decisiones, filtrada por el usuario que los pidió.
	const conveniosRechazados = useQuery({
		...orpcAparte.getHistorialDecisionesConvenio.queryOptions({
			input: {
				decision: "rechazada",
				solicitanteId: userId ?? "",
				perPage: 50,
			},
		}),
		enabled: habilitado && !!userId,
	});
	const bandeja = useSolicitudesPendientes(habilitado);
	const historialInmov = useHistorialInmovilizaciones(paginas, habilitado);
	const usuarioCrm = useNombreUsuarioCrm(userId, habilitado);
	const espacio = useEspacioAprobacion({ alCerrar: bandeja.refetch });

	const filas = React.useMemo(() => {
		const nombres = [usuarioCrm.nombre, nombre];
		const propias = (
			idSolicitante: string | null | undefined,
			nombreSolicitante: string | null | undefined,
		) =>
			esSolicitudDeAsesor({
				idSolicitante,
				nombreSolicitante,
				userIdAsesor: userId,
				nombres,
			});

		const deConvenios = (
			(convenios.data?.items ?? []) as unknown as ConvenioFuente[]
		).map(filaDeConvenio);
		const rechazados = (conveniosRechazados.data?.items ?? []).map(
			filaDeConvenioRechazado,
		);

		// Pendientes y por ejecutar: de la cola (trae el respaldo de las
		// reactivaciones). Las demás: del historial, sin repetir.
		const enCola = new Map<string, Solicitud>();
		for (const s of [...bandeja.pendientes, ...bandeja.porEjecutar]) {
			if (s.tipo === "apagado" || s.tipo === "reactivacion") {
				enCola.set(s.inmovilizacion.id, s);
			}
		}
		const inmov = new Map<string, FilaSolicitudAsesor>();
		for (const s of enCola.values()) {
			if (s.tipo !== "apagado" && s.tipo !== "reactivacion") continue;
			if (
				!propias(
					s.inmovilizacion.solicitadoPorId,
					s.inmovilizacion.solicitanteNombre,
				)
			)
				continue;
			inmov.set(s.inmovilizacion.id, filaDeInmovilizacion(s.inmovilizacion, s));
		}
		for (const i of historialInmov.items) {
			if (inmov.has(i.id) || !propias(i.solicitadoPorId, i.solicitanteNombre))
				continue;
			// Una pendiente que ya no está en la cola se decidió hace un momento.
			inmov.set(i.id, filaDeInmovilizacion(i, enCola.get(i.id)));
		}

		const recup = (
			bandeja.recuperacionesQuery.data
				? [
						...((bandeja.recuperacionesQuery.data.pendientes ??
							[]) as unknown as RecuperacionFuente[]),
						...bandeja.historialRecuperaciones,
					]
				: []
		)
			.filter((r) => propias(r.solicitanteId, r.solicitante))
			.map(filaDeRecuperacion);

		return [...deConvenios, ...rechazados, ...inmov.values(), ...recup].sort(
			porFechaDesc,
		);
	}, [
		convenios.data,
		conveniosRechazados.data,
		userId,
		bandeja.pendientes,
		bandeja.porEjecutar,
		bandeja.recuperacionesQuery.data,
		bandeja.historialRecuperaciones,
		historialInmov.items,
		usuarioCrm.nombre,
		nombre,
	]);

	const pendientes = filas
		.map((f) => f.solicitud)
		.filter((s): s is Solicitud => !!s);

	return (
		<>
			<SolicitudesDeAsesorVista
				nombre={nombre}
				sinUsuario={!userId}
				filas={filas}
				cargando={
					convenios.isLoading ||
					conveniosRechazados.isLoading ||
					bandeja.cargando ||
					historialInmov.cargando ||
					usuarioCrm.cargando
				}
				error={
					convenios.isError ||
					bandeja.errores.length > 0 ||
					historialInmov.error
				}
				onReintentar={() => {
					void convenios.refetch();
					bandeja.refetch();
					historialInmov.refetch();
				}}
				onAbrir={(f) => {
					const i = pendientes.findIndex((s) => s.id === f.solicitud?.id);
					if (i >= 0) espacio.abrir(pendientes, i);
				}}
				onCargarMas={
					historialInmov.hayMas ? () => setPaginas((p) => p + 1) : undefined
				}
				cargandoMas={historialInmov.cargando && paginas > 1}
			/>
			<EspacioAprobacion {...espacio.modal} />
		</>
	);
}
