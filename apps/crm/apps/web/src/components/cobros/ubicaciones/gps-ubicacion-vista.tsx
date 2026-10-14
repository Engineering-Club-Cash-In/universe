import {
	ChevronDown,
	History,
	LocateFixed,
	Map as MapIcon,
	MapPin,
	MapPinned,
	MapPinOff,
	Radar,
	SatelliteDish,
	Undo2,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { DatosTelemetria } from "@/components/cobros/gps-telemetria-datos";
import {
	type AvisoGps,
	type ConsultaGps,
	derivarVistaGps,
	type EnVivoGps,
	type GpsNoDisponible,
	type GpsSinVinculo,
	type GpsVinculado,
	tieneUbicacion,
} from "@/components/cobros/ubicaciones/gps-derivar";
import {
	FormMotivoConsulta,
	fechaCortaGps,
	ListaAnteriores,
	MetaConsulta,
	PanelCargando,
	PanelEncabezado,
	PanelError,
	PanelVacio,
} from "@/components/cobros/ubicaciones/panel";
import { CrmPill } from "@/components/ds/cards-credito";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
	formatCoordenadas,
	formatVelocidad,
	MOTIVO_SIN_VINCULO,
} from "@/routes/cobros/-gps-ficha";

export const ORIGEN_CONSULTA_GPS: Record<string, string> = {
	telemetria: "Ubicación actual",
	ubicaciones_clave: "Ubicaciones frecuentes",
	inmovilizacion_solicitud: "Solicitud de apagado",
	inmovilizacion_ejecucion: "Apagado ejecutado",
};

export type HistorialGps =
	| { estado: "cargando" }
	| { estado: "error"; mensaje?: string; onReintentar?: () => void }
	| { estado: "listo"; entradas: ConsultaGps[] };

/** Piezas que solo existen para la consulta de esta sesión (las arma el contenedor). */
export type ExtrasEnVivoGps = {
	/** Botones junto a «Abrir en Google Maps» (enlace de rastreo, supervisor). */
	acciones?: ReactNode;
	/** Debajo de la ubicación (unidad deducida por placa, cambiar unidad). */
	pie?: ReactNode;
	/** Cómo vincular la unidad cuando la consulta no la encontró. */
	sinVinculo?: (datos: GpsSinVinculo) => ReactNode;
};

/**
 * Pestaña GPS / Wialon de la Ficha 360 (CB-118), solo presentación.
 *
 * Responde de una vez «¿dónde está el vehículo?»: la última ubicación
 * registrada (mapa, de cuándo es, si está detenido, velocidad y quién la
 * consultó con qué motivo), sin pedir una consulta nueva. Debajo, las
 * consultas anteriores visibles; «Ver en el mapa» pone cualquiera de ellas
 * arriba. «Nueva consulta» pide el motivo en línea: toda consulta a Wialon
 * queda registrada con el suyo.
 */
export function GpsUbicacionVista({
	historial,
	enVivo,
	historialActualizado,
	extrasEnVivo,
	esSupervisor,
	paginacion,
	onConsultar,
	idCampo,
	anterioresAbiertas = false,
	mapa,
}: {
	historial: HistorialGps;
	enVivo: EnVivoGps | null;
	historialActualizado: boolean;
	extrasEnVivo?: ExtrasEnVivoGps;
	esSupervisor: boolean;
	paginacion?: {
		hayMas: boolean;
		cargandoMas: boolean;
		onPedirMas: () => void;
		limiteAlcanzado?: boolean;
	};
	onConsultar: (motivo: string) => void;
	idCampo: string;
	/** Consultas anteriores abiertas de entrada (catálogo del design system). */
	anterioresAbiertas?: boolean;
	/** Catálogo del design system: reemplaza el mapa de Google. */
	mapa?: ReactNode;
}) {
	const [formAbierto, setFormAbierto] = useState(false);
	const [seleccionId, setSeleccionId] = useState<string | null>(null);

	const entradas = historial.estado === "listo" ? historial.entradas : [];
	const vista = derivarVistaGps({ entradas, enVivo, historialActualizado });
	const seleccionada =
		seleccionId != null
			? (vista.anteriores.find((e) => e.id === seleccionId) ?? null)
			: null;
	const verSeleccionada = seleccionada && tieneUbicacion(seleccionada);

	const consultar = (motivo: string) => {
		setFormAbierto(false);
		setSeleccionId(null);
		onConsultar(motivo);
	};

	const botonNueva = !formAbierto ? (
		<Button
			disabled={vista.cargandoEnVivo}
			onClick={() => setFormAbierto(true)}
			size="sm"
			variant="outline"
		>
			<LocateFixed aria-hidden />
			Nueva consulta
		</Button>
	) : null;

	const formulario = formAbierto ? (
		<FormMotivoConsulta
			aviso="Cada consulta de ubicación queda registrada con su motivo."
			etiquetaBoton="Consultar"
			id={idCampo}
			onCancelar={() => setFormAbierto(false)}
			onConfirmar={consultar}
			placeholder="Ej.: Cliente en mora crítica, ubicar para gestión de recuperación"
		/>
	) : null;

	const historialCargando = historial.estado === "cargando" && !enVivo;
	const sinNada =
		historial.estado === "listo" &&
		!enVivo &&
		!vista.ubicacion &&
		!vista.aviso &&
		vista.anteriores.length === 0;

	let cuerpo: ReactNode;
	if (historialCargando) {
		cuerpo = <PanelCargando texto="Cargando la última ubicación…" />;
	} else if (vista.cargandoEnVivo) {
		cuerpo = <PanelCargando texto="Consultando el GPS del vehículo…" />;
	} else if (verSeleccionada) {
		cuerpo = (
			<div className="flex flex-col gap-3">
				<div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-brand-subtle px-3 py-2">
					<span className="flex items-center gap-2 font-medium text-[13px] text-brand">
						<History aria-hidden className="size-4" />
						Consulta del {fechaCortaGps(seleccionada.createdAt)}
					</span>
					<Button onClick={() => setSeleccionId(null)} size="sm" variant="text">
						<Undo2 aria-hidden />
						Volver a la más reciente
					</Button>
				</div>
				<UbicacionDeConsulta entrada={seleccionada} mapa={mapa} />
			</div>
		);
	} else if (sinNada) {
		cuerpo = formAbierto ? null : (
			<PanelVacio
				accion={
					<Button onClick={() => setFormAbierto(true)} size="sm">
						<LocateFixed aria-hidden />
						Consultar ubicación
					</Button>
				}
				descripcion="Consulte el GPS para ver dónde está el vehículo. La consulta queda registrada con su motivo."
				icono={<Radar />}
				titulo="Todavía no se ha consultado la ubicación de este vehículo"
			/>
		);
	} else {
		cuerpo = (
			<div className="flex flex-col gap-4">
				{vista.aviso ? (
					<AvisoConsultaGps
						aviso={vista.aviso}
						esSupervisor={esSupervisor}
						sinVinculo={
							(vista.aviso.tipo === "en-vivo" || vista.aviso.esEnVivo) &&
							extrasEnVivo?.sinVinculo
								? extrasEnVivo.sinVinculo
								: undefined
						}
					/>
				) : null}
				{vista.ubicacion ? (
					<div className="flex flex-col gap-2">
						{vista.aviso ? (
							<h4 className="font-semibold text-[13px] text-fg-secondary">
								Última ubicación conocida
							</h4>
						) : null}
						{vista.ubicacion.tipo === "en-vivo" ? (
							<UbicacionEnVivo
								acciones={extrasEnVivo?.acciones}
								datos={vista.ubicacion.datos}
								at={vista.ubicacion.at}
								mapa={mapa}
								motivo={vista.ubicacion.motivo}
								pie={extrasEnVivo?.pie}
							/>
						) : (
							<UbicacionDeConsulta
								acciones={
									vista.ubicacion.esEnVivo ? extrasEnVivo?.acciones : undefined
								}
								entrada={vista.ubicacion.entrada}
								mapa={mapa}
								pie={vista.ubicacion.esEnVivo ? extrasEnVivo?.pie : undefined}
							/>
						)}
					</div>
				) : vista.aviso ? (
					<p className="text-fg-tertiary text-xs">
						No hay una ubicación anterior registrada para este vehículo.
					</p>
				) : null}
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-4">
			<PanelEncabezado
				accion={sinNada ? null : botonNueva}
				descripcion="Según la consulta más reciente al GPS de la unidad."
				titulo="Última ubicación"
			/>
			{formulario}
			{historial.estado === "error" && !enVivo ? (
				<PanelError
					detalle={historial.mensaje}
					onReintentar={historial.onReintentar}
					texto="No se pudo cargar la última consulta del GPS."
				/>
			) : (
				cuerpo
			)}
			{historial.estado === "listo" ? (
				<ListaAnteriores
					abiertoInicial={anterioresAbiertas}
					cargandoMas={paginacion?.cargandoMas}
					clave={(e) => e.id}
					hayMasEnServidor={paginacion?.hayMas}
					items={vista.anteriores}
					limiteAlcanzado={
						paginacion?.limiteAlcanzado
							? "Se muestran las 100 consultas más recientes."
							: undefined
					}
					onPedirMas={paginacion?.onPedirMas}
					render={(e) => (
						<FilaConsultaGps
							consulta={e}
							onVerEnMapa={
								tieneUbicacion(e) ? () => setSeleccionId(e.id) : undefined
							}
							seleccionada={e.id === seleccionId}
						/>
					)}
				/>
			) : null}
		</div>
	);
}

/** Ubicación de una consulta del historial (la última o una anterior). */
function UbicacionDeConsulta({
	entrada,
	acciones,
	pie,
	mapa,
}: {
	entrada: ConsultaGps & { snapshot: GpsVinculado };
	acciones?: ReactNode;
	pie?: ReactNode;
	mapa?: ReactNode;
}) {
	return (
		<div className="flex flex-col gap-3">
			<DatosTelemetria
				acciones={acciones}
				// Fecha de ESA consulta: «Señal con retraso» se mide contra cuando
				// se consultó, no contra hoy.
				consultadaAt={new Date(entrada.createdAt)}
				mapa={mapa}
				telemetria={entrada.snapshot.telemetria}
				unitName={entrada.snapshot.unitName}
			/>
			<div className="flex flex-col gap-1.5 border-line-subtle border-t pt-3">
				<MetaConsulta
					fecha={fechaCortaGps(entrada.createdAt)}
					motivo={entrada.motivo}
					usuario={entrada.userNombre ?? "Usuario desconocido"}
				/>
				<ConsultasDelGrupo consulta={entrada} />
				{pie}
			</div>
		</div>
	);
}

function UbicacionEnVivo({
	datos,
	motivo,
	at,
	acciones,
	pie,
	mapa,
}: {
	datos: GpsVinculado;
	motivo: string;
	at: Date;
	acciones?: ReactNode;
	pie?: ReactNode;
	mapa?: ReactNode;
}) {
	return (
		<div className="flex flex-col gap-3">
			<DatosTelemetria
				acciones={acciones}
				mapa={mapa}
				telemetria={datos.telemetria}
				unitName={datos.unitName}
			/>
			<div className="flex flex-col gap-1.5 border-line-subtle border-t pt-3">
				<MetaConsulta
					estado={
						datos.auditada ? "Consulta registrada" : "Consulta no registrada"
					}
					fecha={fechaCortaGps(at)}
					motivo={motivo}
					usuario={null}
				/>
				{pie}
			</div>
		</div>
	);
}

/** La consulta más reciente no trajo ubicación: por qué, y qué se puede hacer. */
function AvisoConsultaGps({
	aviso,
	esSupervisor,
	sinVinculo,
}: {
	aviso: AvisoGps;
	esSupervisor: boolean;
	sinVinculo?: (datos: GpsSinVinculo) => ReactNode;
}) {
	const datos: GpsSinVinculo | GpsNoDisponible | null =
		aviso.tipo === "en-vivo" ? aviso.datos : aviso.entrada.snapshot;
	const meta =
		aviso.tipo === "en-vivo" ? (
			<MetaConsulta
				estado={
					datos?.auditada ? "Consulta registrada" : "Consulta no registrada"
				}
				fecha={aviso.at ? fechaCortaGps(aviso.at) : "Ahora"}
				motivo={aviso.motivo}
				usuario={null}
			/>
		) : (
			<MetaConsulta
				fecha={fechaCortaGps(aviso.entrada.createdAt)}
				motivo={aviso.entrada.motivo}
				usuario={aviso.entrada.userNombre ?? "Usuario desconocido"}
			/>
		);

	if (datos?.estado === "sin_vinculo") {
		return (
			<div className="flex flex-col gap-3 rounded-xl bg-warning-subtle px-4 py-3">
				<div className="flex items-start gap-2.5">
					<MapPinOff
						aria-hidden
						className="mt-0.5 size-4 shrink-0 text-warning-text"
					/>
					<div className="flex min-w-0 flex-col gap-0.5">
						<p className="font-semibold text-sm text-warning-text">
							Sin unidad GPS vinculada
						</p>
						<p className="text-fg-secondary text-xs">
							{MOTIVO_SIN_VINCULO[datos.motivo]}
						</p>
					</div>
				</div>
				{sinVinculo ? (
					<div className="rounded-lg bg-surface p-3">{sinVinculo(datos)}</div>
				) : (
					<p className="text-fg-secondary text-xs">
						{esSupervisor
							? "Para vincular la unidad, realice una nueva consulta."
							: "Un supervisor puede vincular la unidad GPS de este vehículo."}
					</p>
				)}
				{meta}
			</div>
		);
	}

	// Wialon caído o la petición falló: nota discreta, no una alerta roja. Que
	// el proveedor no responda no es un problema del crédito ni del asesor.
	const mensaje =
		datos?.estado === "no_disponible"
			? datos.error.message
			: aviso.tipo === "en-vivo"
				? aviso.mensaje
				: undefined;
	return (
		<div className="flex flex-col gap-2 rounded-xl bg-muted px-4 py-3">
			<div className="flex items-start gap-2.5">
				<SatelliteDish
					aria-hidden
					className="mt-0.5 size-4 shrink-0 text-fg-tertiary"
				/>
				<div className="flex min-w-0 flex-col gap-0.5">
					<p className="font-semibold text-fg text-sm">
						{aviso.tipo === "en-vivo"
							? "No se pudo consultar el GPS en este momento"
							: "La consulta más reciente no obtuvo ubicación"}
					</p>
					{mensaje ? (
						<p className="wrap-break-word text-fg-secondary text-xs">
							{mensaje}
						</p>
					) : null}
					{datos?.estado === "no_disponible" &&
					datos.error.code === "WIALON_NO_DISPONIBLE" ? (
						<p className="text-fg-secondary text-xs">
							La integración está temporalmente deshabilitada por fallos
							repetidos. Use el portal de La Legión o contacte a su supervisor
							mientras se restablece.
						</p>
					) : null}
					{datos?.estado === "no_disponible" && datos.referencia ? (
						<p className="text-fg-tertiary text-xs">
							Referencia para soporte:{" "}
							<span className="font-mono">{datos.referencia}</span>
						</p>
					) : null}
				</div>
			</div>
			{meta}
		</div>
	);
}

/** Misma ubicación en varias consultas: se muestran juntas, cada una con su motivo. */
function ConsultasDelGrupo({ consulta }: { consulta: ConsultaGps }) {
	const [abierto, setAbierto] = useState(false);
	const total = consulta.consultas.length;
	if (total <= 1) return null;
	return (
		<div className="flex flex-col gap-1">
			<Button
				aria-expanded={abierto}
				className="self-start px-0"
				onClick={() => setAbierto((v) => !v)}
				size="sm"
				variant="text"
			>
				Consultada {total} veces en esta ubicación
				<ChevronDown
					aria-hidden
					className={cn("transition-transform", abierto && "rotate-180")}
				/>
			</Button>
			{abierto ? (
				<ul className="flex flex-col gap-1 border-line-subtle border-l-2 pl-3">
					{consulta.consultas.map((c) => (
						<li className="wrap-break-word text-xs" key={c.id}>
							<span className="text-fg-tertiary">
								{fechaCortaGps(c.createdAt)} ·{" "}
								{c.userNombre ?? "Usuario desconocido"} —{" "}
							</span>
							<span className="text-fg-secondary">{c.motivo}</span>
						</li>
					))}
				</ul>
			) : null}
		</div>
	);
}

function resumenConsulta(c: ConsultaGps): string {
	const snap = c.snapshot;
	if (c.origen === "ubicaciones_clave")
		return "El resultado está en la pestaña Ubicaciones frecuentes";
	if (!snap) return "Sin datos guardados de esta consulta";
	if (snap.estado === "vinculado") {
		const t = snap.telemetria;
		const partes = [
			formatCoordenadas(t.latitude, t.longitude),
			t.speedKmh != null ? formatVelocidad(t.speedKmh) : null,
		].filter(Boolean);
		return partes.join(" · ");
	}
	if (snap.estado === "sin_vinculo") return "Sin unidad GPS vinculada";
	return `Sin ubicación: ${snap.error.message}`;
}

/** Fila compacta de una consulta anterior. */
export function FilaConsultaGps({
	consulta,
	onVerEnMapa,
	seleccionada = false,
}: {
	consulta: ConsultaGps;
	onVerEnMapa?: () => void;
	seleccionada?: boolean;
}) {
	const conUbicacion = tieneUbicacion(consulta);
	return (
		<div
			className={cn(
				"flex items-start gap-3 px-3.5 py-2.5",
				seleccionada && "bg-brand-subtle/50",
			)}
		>
			<span
				aria-hidden
				className={cn(
					"mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full [&_svg]:size-3.5",
					conUbicacion
						? "bg-violet-bg text-violet-fg"
						: "bg-muted text-fg-tertiary",
				)}
			>
				{conUbicacion ? (
					<MapPin />
				) : consulta.origen === "ubicaciones_clave" ? (
					<MapPinned />
				) : (
					<MapPinOff />
				)}
			</span>
			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				<div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
					<span className="font-semibold text-[13px] text-fg">
						{fechaCortaGps(consulta.createdAt)}
					</span>
					<span className="text-fg-tertiary text-xs">
						{consulta.userNombre ?? "Usuario desconocido"}
					</span>
					<CrmPill
						className="px-2 py-0.5 text-[11px]"
						dot={false}
						kind="chip"
						tone="neutral"
					>
						{ORIGEN_CONSULTA_GPS[consulta.origen ?? ""] ?? "Consulta GPS"}
					</CrmPill>
				</div>
				<p className="wrap-break-word line-clamp-2 text-fg-secondary text-xs">
					{consulta.motivo}
				</p>
				<p className="wrap-break-word text-[11px] text-fg-tertiary">
					{resumenConsulta(consulta)}
				</p>
				<ConsultasDelGrupo consulta={consulta} />
			</div>
			{conUbicacion && onVerEnMapa ? (
				<Button
					aria-label="Ver esta consulta en el mapa"
					aria-pressed={seleccionada}
					className="shrink-0"
					onClick={onVerEnMapa}
					size="sm"
					variant={seleccionada ? "secondary" : "ghost"}
				>
					<MapIcon aria-hidden />
					<span className="hidden sm:inline">Ver en el mapa</span>
				</Button>
			) : null}
		</div>
	);
}
