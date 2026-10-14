import { History, MapPinned, Undo2 } from "lucide-react";
import { type ReactNode, useState } from "react";
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
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { client } from "@/utils/orpc";

export type ConsultaUbicaciones = Awaited<
	ReturnType<typeof client.getUbicacionesConsultasCaso>
>[number];

export type HistorialFrecuentes =
	| { estado: "cargando" }
	| { estado: "error"; mensaje?: string; onReintentar?: () => void }
	| { estado: "listo"; entradas: ConsultaUbicaciones[] };

/** La consulta de esta sesión: el contenedor arma el resultado (con «Calcular ahora»). */
export type EnVivoFrecuentes = {
	motivo: string;
	/** Resultado, carga o error de la consulta en vivo. */
	contenido: ReactNode;
	/** Quedó registrada en la bitácora (la fila ya existe en el historial). */
	registrada: boolean;
	cargando: boolean;
	at: Date | null;
};

export type TipoUbicacionClave =
	| "probable_casa"
	| "probable_trabajo"
	| "recurrente"
	| "frecuente";

export const TIPO_UBICACION_LABEL: Record<TipoUbicacionClave, string> = {
	probable_casa: "Probable casa",
	probable_trabajo: "Probable trabajo",
	recurrente: "Lugar recurrente",
	frecuente: "Visitado con frecuencia",
};

export function etiquetaTipoUbicacion(tipo: string): string {
	return TIPO_UBICACION_LABEL[tipo as TipoUbicacionClave] ?? "Ubicación";
}

type Lugares = NonNullable<ConsultaUbicaciones["snapshot"]>["ubicaciones"];

/** Pinta la lista de lugares (la arma el contenedor: compara con el domicilio). */
export type RenderLugares = (
	ubicaciones: Lugares,
	casoCobroId?: string,
) => ReactNode;

const AVISO_MOTIVO =
	"Esta información revela dónde vive o trabaja el cliente. Cada consulta queda registrada con su motivo.";

/** Cuándo se calcularon las ubicaciones de un resultado (la más reciente). */
function fechaCalculo(
	ubicaciones: Array<{ calculadoAt: Date | string }>,
): string | null {
	const tiempos = ubicaciones
		.map((u) => new Date(u.calculadoAt).getTime())
		.filter((t) => Number.isFinite(t));
	if (tiempos.length === 0) return null;
	return fechaCortaGps(new Date(Math.max(...tiempos)));
}

/**
 * Pestaña Ubicaciones frecuentes de la Ficha 360 (CB-119, D-15), solo
 * presentación. Muestra de entrada lo último que ya se consultó (casa,
 * trabajo, lugares recurrentes), sin pedir una consulta nueva: cada consulta
 * guarda lo que se mostró. «Nueva consulta» pide el motivo en línea.
 */
export function UbicacionesFrecuentesVista({
	historial,
	enVivo,
	historialActualizado,
	casoCobroId,
	paginacion,
	onConsultar,
	idCampo,
	anterioresAbiertas = false,
	renderLugares,
}: {
	renderLugares: RenderLugares;
	historial: HistorialFrecuentes;
	enVivo: EnVivoFrecuentes | null;
	historialActualizado: boolean;
	/** Habilita comparar la probable casa/trabajo con la dirección declarada. */
	casoCobroId?: string;
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
}) {
	const [formAbierto, setFormAbierto] = useState(false);
	const [seleccionId, setSeleccionId] = useState<string | null>(null);

	const entradas = historial.estado === "listo" ? historial.entradas : [];
	// La fila de la consulta de esta sesión ya está en el historial: no se
	// repite abajo, porque arriba se ve su resultado.
	const filaEnVivo =
		enVivo?.registrada && historialActualizado ? (entradas[0] ?? null) : null;
	const ultima = enVivo ? null : (entradas.find((e) => e.snapshot) ?? null);
	const anteriores = entradas.filter((e) => e !== filaEnVivo && e !== ultima);
	const seleccionada =
		seleccionId != null
			? (anteriores.find((e) => e.id === seleccionId && e.snapshot) ?? null)
			: null;

	const consultar = (motivo: string) => {
		setFormAbierto(false);
		setSeleccionId(null);
		onConsultar(motivo);
	};

	const sinNada =
		historial.estado === "listo" && !enVivo && entradas.length === 0;

	let cuerpo: ReactNode;
	if (historial.estado === "cargando" && !enVivo) {
		cuerpo = <PanelCargando texto="Cargando las ubicaciones frecuentes…" />;
	} else if (historial.estado === "error" && !enVivo) {
		cuerpo = (
			<PanelError
				detalle={historial.mensaje}
				onReintentar={historial.onReintentar}
				texto="No se pudo cargar la última consulta de ubicaciones frecuentes."
			/>
		);
	} else if (seleccionada?.snapshot) {
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
				<ResultadoGuardado
					consulta={seleccionada}
					renderLugares={renderLugares}
				/>
			</div>
		);
	} else if (enVivo) {
		cuerpo = (
			<div className="flex flex-col gap-3">
				{enVivo.contenido}
				{!enVivo.cargando ? (
					<MetaConsulta
						className="border-line-subtle border-t pt-3"
						estado={
							enVivo.registrada
								? "Consulta registrada"
								: "Consulta no registrada"
						}
						fecha={enVivo.at ? fechaCortaGps(enVivo.at) : "Ahora"}
						motivo={enVivo.motivo}
						usuario={null}
					/>
				) : null}
			</div>
		);
	} else if (ultima?.snapshot) {
		cuerpo = (
			<ResultadoGuardado
				casoCobroId={casoCobroId}
				consulta={ultima}
				renderLugares={renderLugares}
			/>
		);
	} else if (sinNada) {
		cuerpo = formAbierto ? null : (
			<PanelVacio
				accion={
					<Button onClick={() => setFormAbierto(true)} size="sm">
						<MapPinned aria-hidden />
						Consultar ubicaciones
					</Button>
				}
				descripcion={AVISO_MOTIVO}
				icono={<MapPinned />}
				titulo="Todavía no se han consultado las ubicaciones frecuentes"
			/>
		);
	} else {
		// Hay consultas, pero ninguna guardó lo que se mostró (anteriores al
		// historial o el guardado falló).
		cuerpo = formAbierto ? null : (
			<PanelVacio
				descripcion="Las consultas anteriores no guardaron sus resultados. Haga una nueva consulta para verlos."
				icono={<MapPinned />}
				titulo="Sin resultados guardados"
			/>
		);
	}

	return (
		<div className="flex flex-col gap-4">
			<PanelEncabezado
				accion={
					sinNada || formAbierto ? null : (
						<Button
							disabled={enVivo?.cargando}
							onClick={() => setFormAbierto(true)}
							size="sm"
							variant="outline"
						>
							<MapPinned aria-hidden />
							Nueva consulta
						</Button>
					)
				}
				descripcion="Dónde permanece el vehículo con más frecuencia, según los últimos 60 días de GPS."
				titulo="Ubicaciones frecuentes"
			/>
			{formAbierto ? (
				<FormMotivoConsulta
					aviso={AVISO_MOTIVO}
					etiquetaBoton="Consultar"
					id={idCampo}
					onCancelar={() => setFormAbierto(false)}
					onConfirmar={consultar}
					placeholder="Ej.: Preparar visita de recuperación"
				/>
			) : null}
			{cuerpo}
			{historial.estado === "listo" ? (
				<ListaAnteriores
					abiertoInicial={anterioresAbiertas}
					cargandoMas={paginacion?.cargandoMas}
					clave={(e) => e.id}
					hayMasEnServidor={paginacion?.hayMas}
					items={anteriores}
					limiteAlcanzado={
						paginacion?.limiteAlcanzado
							? "Se muestran las 100 consultas más recientes."
							: undefined
					}
					onPedirMas={paginacion?.onPedirMas}
					render={(e) => (
						<FilaConsultaUbicaciones
							consulta={e}
							onVer={e.snapshot ? () => setSeleccionId(e.id) : undefined}
							seleccionada={e.id === seleccionId}
						/>
					)}
				/>
			) : null}
		</div>
	);
}

/** Lo que se mostró en una consulta guardada. */
function ResultadoGuardado({
	consulta,
	casoCobroId,
	renderLugares,
}: {
	consulta: ConsultaUbicaciones;
	casoCobroId?: string;
	renderLugares: RenderLugares;
}) {
	const ubicaciones = consulta.snapshot?.ubicaciones ?? [];
	const calculo = fechaCalculo(ubicaciones);
	return (
		<div className="flex flex-col gap-3">
			{ubicaciones.length > 0 ? (
				renderLugares(ubicaciones, casoCobroId)
			) : (
				<p className="rounded-xl bg-muted/40 px-4 py-3 text-fg-secondary text-sm">
					En esa consulta no había suficientes datos para identificar
					ubicaciones frecuentes.
				</p>
			)}
			<div className="flex flex-col gap-1 border-line-subtle border-t pt-3">
				<MetaConsulta
					fecha={fechaCortaGps(consulta.createdAt)}
					motivo={consulta.motivo}
					usuario={consulta.userNombre ?? "Usuario desconocido"}
				/>
				{calculo ? (
					<p className="text-fg-tertiary text-xs">
						Cálculo actualizado: {calculo}.
					</p>
				) : null}
			</div>
		</div>
	);
}

function FilaConsultaUbicaciones({
	consulta,
	onVer,
	seleccionada,
}: {
	consulta: ConsultaUbicaciones;
	onVer?: () => void;
	seleccionada: boolean;
}) {
	const lugares = consulta.snapshot?.ubicaciones ?? null;
	const resumen =
		lugares == null
			? "Sin datos guardados de esta consulta"
			: lugares.length === 0
				? "Sin ubicaciones identificadas"
				: lugares
						.slice(0, 3)
						.map((u) => etiquetaTipoUbicacion(u.tipo))
						.join(", ") +
					(lugares.length > 3 ? ` y ${lugares.length - 3} más` : "");
	return (
		<div
			className={cn(
				"flex items-start gap-3 px-3.5 py-2.5",
				seleccionada && "bg-brand-subtle/50",
			)}
		>
			<span
				aria-hidden
				className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-violet-bg text-violet-fg [&_svg]:size-3.5"
			>
				<MapPinned />
			</span>
			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				<div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
					<span className="font-semibold text-[13px] text-fg">
						{fechaCortaGps(consulta.createdAt)}
					</span>
					<span className="text-fg-tertiary text-xs">
						{consulta.userNombre ?? "Usuario desconocido"}
					</span>
				</div>
				<p className="wrap-break-word line-clamp-2 text-fg-secondary text-xs">
					{consulta.motivo}
				</p>
				<p className="text-[11px] text-fg-tertiary">{resumen}</p>
			</div>
			{onVer && lugares && lugares.length > 0 ? (
				<Button
					aria-label="Ver las ubicaciones de esta consulta"
					aria-pressed={seleccionada}
					className="shrink-0"
					onClick={onVer}
					size="sm"
					variant={seleccionada ? "secondary" : "ghost"}
				>
					<MapPinned aria-hidden />
					<span className="hidden sm:inline">Ver ubicaciones</span>
				</Button>
			) : null}
		</div>
	);
}
