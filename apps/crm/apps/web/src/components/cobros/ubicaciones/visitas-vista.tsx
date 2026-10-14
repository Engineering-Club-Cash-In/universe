import { Briefcase, Home, MapPin, MapPinCheck } from "lucide-react";
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui";
import { type ReactNode, useState } from "react";
import {
	PanelEncabezado,
	PanelVacio,
} from "@/components/cobros/ubicaciones/panel";
import { CrmPill } from "@/components/ds/cards-credito";
import { MapView, PhotoStrip } from "@/components/ds/ubicaciones";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type TipoDireccionVisita = "residencia" | "trabajo";

/** La última visita REALIZADA a una dirección (CB-037/038). */
export type VisitaVerificada = {
	/** Dirección donde se hizo la visita. */
	direccion: string;
	/** Mapa real (iframe) si la visita guardó coordenadas. */
	mapa?: ReactNode;
	fotos: Array<{ src?: string; alt?: string }>;
	comentarios?: string | null;
	/** «Pago total», «Sin contacto»… */
	resultado?: string | null;
	/** «12 jun 2026». */
	fecha: string;
	responsable?: string | null;
};

export type DireccionVisitas = {
	clave: TipoDireccionVisita;
	/** La dirección que el cliente tiene registrada (puede no estar visitada). */
	direccionRegistrada: string | null;
	verificacion: VisitaVerificada | null;
};

const TITULO: Record<TipoDireccionVisita, string> = {
	residencia: "Residencia",
	trabajo: "Trabajo",
};

const SIN_VISITA: Record<TipoDireccionVisita, string> = {
	residencia: "Sin visita realizada a la residencia",
	trabajo: "Sin visita realizada al trabajo",
};

/**
 * Pestaña Visitas de la Ficha 360 › Ubicaciones (antes «Ubicaciones
 * verificadas»), solo presentación. Arriba, las dos direcciones del cliente
 * con su estado de un vistazo (cuál está verificada y cuándo); al elegir una,
 * debajo se ve lo que dejó la última visita realizada: mapa, fotos y
 * comentarios. Sin visita, un aviso corto con el botón para registrarla.
 */
export function VisitasUbicacionVista({
	direcciones,
	onRegistrarVisita,
	bloqueoVisita,
	onFotoClick,
}: {
	direcciones: DireccionVisitas[];
	/** Abre «Registrar visita» con el tipo ya elegido. */
	onRegistrarVisita?: (tipo: TipoDireccionVisita) => void;
	/** Por qué hoy no se pueden registrar visitas; null si se puede. */
	bloqueoVisita?: string | null;
	onFotoClick?: (tipo: TipoDireccionVisita, indice: number) => void;
}) {
	// Abre en la primera dirección verificada; si no hay, en la residencia.
	const [seleccion, setSeleccion] = useState<TipoDireccionVisita>(
		() =>
			direcciones.find((d) => d.verificacion)?.clave ??
			direcciones[0]?.clave ??
			"residencia",
	);
	const actual =
		direcciones.find((d) => d.clave === seleccion) ?? direcciones[0];
	const puedeRegistrar = onRegistrarVisita && !bloqueoVisita;

	return (
		<div className="flex flex-col gap-4">
			<PanelEncabezado
				accion={
					puedeRegistrar && actual ? (
						<Button
							onClick={() => onRegistrarVisita(actual.clave)}
							size="sm"
							variant="outline"
						>
							<MapPin aria-hidden />
							Registrar visita
						</Button>
					) : null
				}
				descripcion="La última visita realizada a cada dirección del cliente."
				titulo="Direcciones verificadas en campo"
			/>

			<ToggleGroupPrimitive.Root
				aria-label="Dirección"
				className="grid gap-2 sm:grid-cols-2"
				onValueChange={(v) => {
					// Radix permite des-seleccionar el activo: siempre queda una.
					if (v) setSeleccion(v as TipoDireccionVisita);
				}}
				type="single"
				value={seleccion}
			>
				{direcciones.map((d) => (
					<ToggleGroupPrimitive.Item
						className="flex min-w-0 cursor-pointer items-start gap-3 rounded-xl border border-line-subtle bg-surface px-3.5 py-3 text-left outline-none transition-colors duration-150 hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring data-[state=on]:border-brand data-[state=on]:bg-brand-subtle/40"
						key={d.clave}
						value={d.clave}
					>
						<span
							aria-hidden
							className={cn(
								"flex size-8 shrink-0 items-center justify-center rounded-full [&_svg]:size-4",
								d.verificacion
									? "bg-success-subtle text-success-text"
									: "bg-muted text-fg-tertiary",
							)}
						>
							{d.clave === "trabajo" ? <Briefcase /> : <Home />}
						</span>
						<span className="flex min-w-0 flex-1 flex-col gap-0.5">
							<span className="flex flex-wrap items-center gap-2">
								<span className="font-semibold text-fg text-sm leading-[1.26]">
									{TITULO[d.clave]}
								</span>
								{d.verificacion ? (
									<CrmPill kind="chip" tone="success">
										Verificada
									</CrmPill>
								) : (
									<CrmPill kind="chip" tone="neutral">
										Sin verificar
									</CrmPill>
								)}
							</span>
							<span
								className={cn(
									"line-clamp-2 text-xs",
									d.verificacion?.direccion || d.direccionRegistrada
										? "text-fg-secondary"
										: "text-fg-tertiary",
								)}
							>
								{d.verificacion?.direccion ??
									d.direccionRegistrada ??
									"Sin dirección registrada"}
							</span>
							{d.verificacion ? (
								<span className="text-[11px] text-fg-tertiary">
									Visitada el {d.verificacion.fecha}
									{d.verificacion.responsable
										? ` · ${d.verificacion.responsable}`
										: ""}
								</span>
							) : null}
						</span>
					</ToggleGroupPrimitive.Item>
				))}
			</ToggleGroupPrimitive.Root>

			{actual?.verificacion ? (
				<DetalleVisita
					onFotoClick={
						onFotoClick ? (i) => onFotoClick(actual.clave, i) : undefined
					}
					verificacion={actual.verificacion}
				/>
			) : actual ? (
				<PanelVacio
					accion={
						puedeRegistrar ? (
							<Button onClick={() => onRegistrarVisita(actual.clave)} size="sm">
								<MapPin aria-hidden />
								Registrar visita
							</Button>
						) : null
					}
					descripcion={
						<>
							El mapa, las fotos y los comentarios aparecerán aquí cuando se
							registre una visita realizada a esta dirección.
							{bloqueoVisita ? (
								<span className="mt-1 block text-fg-tertiary">
									{bloqueoVisita}
								</span>
							) : null}
						</>
					}
					icono={<MapPinCheck />}
					titulo={SIN_VISITA[actual.clave]}
				/>
			) : null}
		</div>
	);
}

function DetalleVisita({
	verificacion,
	onFotoClick,
}: {
	verificacion: VisitaVerificada;
	onFotoClick?: (indice: number) => void;
}) {
	return (
		<div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
			<div className="flex min-w-0 flex-col">
				{verificacion.mapa ?? (
					<MapView
						className="h-52 w-full sm:h-60 lg:h-auto lg:min-h-60 lg:flex-1"
						etiqueta="La visita no registró coordenadas"
						pins={[]}
					/>
				)}
			</div>
			<div className="flex min-w-0 flex-col gap-3.5">
				<div className="flex flex-col gap-1.5">
					<div className="flex flex-wrap items-center gap-2">
						<CrmPill tone="success">Dirección verificada</CrmPill>
						{verificacion.resultado ? (
							<CrmPill kind="chip" tone="neutral">
								{verificacion.resultado}
							</CrmPill>
						) : null}
					</div>
					<p className="wrap-break-word font-medium text-fg text-sm">
						{verificacion.direccion}
					</p>
				</div>
				<section className="flex flex-col gap-1.5">
					<h4 className="font-semibold text-fg-secondary text-xs">
						Fotografías de la visita
					</h4>
					{verificacion.fotos.length > 0 ? (
						<PhotoStrip
							className="flex-wrap [&>*]:size-20"
							fotos={verificacion.fotos}
							onFotoClick={onFotoClick}
							onVerMas={onFotoClick ? () => onFotoClick(3) : undefined}
						/>
					) : (
						<p className="text-fg-tertiary text-xs">Sin fotografías.</p>
					)}
				</section>
				<section className="flex flex-col gap-1">
					<h4 className="font-semibold text-fg-secondary text-xs">
						Comentarios del verificador
					</h4>
					<p className="wrap-break-word text-fg-secondary text-sm leading-relaxed">
						{verificacion.comentarios || "Sin comentarios."}
					</p>
				</section>
				<p className="text-fg-tertiary text-xs">
					Verificada el {verificacion.fecha}
					{verificacion.responsable
						? ` · Responsable: ${verificacion.responsable}`
						: ""}
				</p>
			</div>
		</div>
	);
}
