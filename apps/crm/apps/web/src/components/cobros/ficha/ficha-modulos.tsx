import { Lock, MapPin, Pencil } from "lucide-react";
import type * as React from "react";
import {
	CrmAvatar,
	CrmCard,
	CrmPill,
	crmText,
	inicialesDe,
} from "@/components/ds/cards-credito";
import { FichaEditableRow } from "@/components/ds/ficha-edicion";
import { PhotoStrip, VolverButton } from "@/components/ds/ubicaciones";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Ficha 360 · módulos que se abren desde el Resumen («Volver al resumen»):
 * Contacto (1366:12), Ubicaciones (1209:10624 / 1209:10804 / 1211:12) y
 * Edición de la información del cliente (1177:877 / 1179:1089).
 * Solo presentación.
 */

/** "← Volver al resumen" + título del módulo (y su control a la derecha). */
export function EncabezadoModulo({
	onVolver,
	titulo,
	subtitulo,
	derecha,
	children,
}: {
	onVolver: () => void;
	titulo?: React.ReactNode;
	subtitulo?: React.ReactNode;
	/** Control segmentado a la derecha del título (Figma 1177:877). */
	derecha?: React.ReactNode;
	/** Va entre el botón y el título (el segmentado de Ubicaciones). */
	children?: React.ReactNode;
}) {
	return (
		<div className="flex flex-col gap-5">
			<div>
				<VolverButton onClick={onVolver} />
			</div>
			{children}
			{titulo ? (
				<div className="flex flex-wrap items-center justify-between gap-4 border-line-subtle border-b pb-5">
					<div className="flex min-w-0 flex-col gap-1">
						<h2 className="font-bold text-[26px] text-fg leading-[1.26]">
							{titulo}
						</h2>
						{subtitulo ? (
							<p className="text-fg-secondary text-sm leading-[1.26]">
								{subtitulo}
							</p>
						) : null}
					</div>
					{derecha}
				</div>
			) : null}
		</div>
	);
}

/* ── Contacto ───────────────────────────────────────────────────────────────── */

export type FilaContacto = {
	icono: React.ReactNode;
	label: string;
	/** Uno o varios valores (varios teléfonos principales, p. ej.). */
	valores: Array<{ texto: string; href?: string; title?: string }>;
};

/**
 * Una persona del crédito (titular o codeudor) con sus datos de contacto.
 * Los valores largos (correos, direcciones) hacen salto de línea dentro de la
 * card: nunca se salen del borde.
 */
export function PersonaContacto({
	nombre,
	rol,
	filas,
	onEditar,
	children,
	compacto = false,
}: {
	nombre: string;
	/** "Titular", "Codeudor 1". */
	rol: string;
	filas: FilaContacto[];
	onEditar?: () => void;
	/** Debajo de la tabla: trabajo, números nuevos, referencias… */
	children?: React.ReactNode;
	/**
	 * Workspace (panel de 520–640px): container queries en vez de breakpoints
	 * de viewport. Sin `compacto`, la ficha conserva sus `sm:` de siempre.
	 */
	compacto?: boolean;
}) {
	return (
		<CrmCard
			superficie="outline"
			className={cn("gap-4 p-4", compacto ? "@container" : "sm:p-5")}
		>
			<div className="flex flex-wrap items-center gap-3">
				<CrmAvatar
					iniciales={inicialesDe(nombre)}
					className="size-8 bg-violet-bg text-[13px] text-violet-fg"
				/>
				<span className="wrap-break-word min-w-0 font-semibold text-base text-fg leading-[1.26]">
					{nombre}
				</span>
				<CrmPill tone="neutral" dot={false} className="px-2.5 py-0.5">
					{rol}
				</CrmPill>
				{onEditar ? (
					<Button
						variant="secondary"
						size="sm"
						className="ml-auto"
						onClick={onEditar}
					>
						<Pencil aria-hidden className="size-3.5" />
						Editar
					</Button>
				) : null}
			</div>
			<dl className="flex flex-col gap-2.5 rounded-lg border border-line-subtle px-4 py-3">
				{filas.map((f) => (
					<div
						key={f.label}
						className={cn(
							"grid grid-cols-1 gap-x-4 gap-y-0.5",
							compacto
								? "@lg:grid-cols-[minmax(0,180px)_minmax(0,1fr)]"
								: "sm:grid-cols-[minmax(0,180px)_minmax(0,1fr)]",
						)}
					>
						<dt className="flex items-center gap-2 text-[13px] text-fg-secondary leading-[1.26]">
							<span className="flex shrink-0 [&_svg]:size-3.5">{f.icono}</span>
							{f.label}
						</dt>
						<dd
							className={cn(
								"flex min-w-0 flex-wrap justify-start gap-x-3 gap-y-1",
								compacto ? "@lg:justify-end" : "sm:justify-end",
							)}
						>
							{f.valores.length === 0 ? (
								<span className="text-[13px] text-fg-tertiary">—</span>
							) : (
								f.valores.map((v) =>
									v.href ? (
										<a
											key={v.texto}
											href={v.href}
											title={v.title}
											className={cn(
												"min-w-0 break-all font-medium text-[13px] text-brand leading-[1.26] hover:underline",
												compacto ? "@lg:text-right" : "sm:text-right",
											)}
										>
											{v.texto}
										</a>
									) : (
										<span
											key={v.texto}
											title={v.title}
											className={cn(
												"wrap-break-word min-w-0 font-medium text-[13px] text-fg leading-[1.26]",
												compacto ? "@lg:text-right" : "sm:text-right",
											)}
										>
											{v.texto}
										</span>
									),
								)
							)}
						</dd>
					</div>
				))}
			</dl>
			{children}
		</CrmCard>
	);
}

/* ── Ubicaciones verificadas ────────────────────────────────────────────────── */

export type VerificacionUbicacion = {
	direccion: string;
	/** Mapa real (iframe) si la visita guardó coordenadas. */
	mapa?: React.ReactNode;
	fotos: Array<{ src?: string; alt?: string }>;
	comentarios?: string | null;
	/** "Verificada el 12 jun 2026 · Responsable: Carlos Ramírez". */
	pie: string;
	/** Resultado de la visita ("Pago total", "Sin contacto"…). */
	resultado?: string | null;
};

export function UbicacionVerificada({
	persona,
	rol = "Titular",
	verificacion,
	onFotoClick,
	compacto = false,
}: {
	persona: string;
	rol?: string;
	verificacion: VerificacionUbicacion | null;
	onFotoClick?: (indice: number) => void;
	/**
	 * Workspace: las dos tarjetas (fotos y comentarios) van lado a lado según
	 * el ancho del panel (container query), no de la pantalla.
	 */
	compacto?: boolean;
}) {
	return (
		<div className={cn("flex flex-col gap-5", compacto && "@container")}>
			<div className="flex items-center gap-2.5 border-line-subtle border-b pb-5">
				<span className="font-semibold text-[15px] text-fg">{persona}</span>
				<CrmPill tone="neutral" dot={false} className="px-2.5 py-0.5">
					{rol}
				</CrmPill>
			</div>
			{verificacion ? (
				<>
					<div className="flex flex-wrap items-center gap-3">
						<CrmPill tone="success">Dirección verificada</CrmPill>
						<span className="wrap-break-word min-w-0 text-fg text-sm">
							{verificacion.direccion}
						</span>
						{verificacion.resultado ? (
							<CrmPill tone="neutral" kind="chip">
								{verificacion.resultado}
							</CrmPill>
						) : null}
					</div>
					<CrmCard superficie="outline" className="gap-3 p-4">
						<h3 className={crmText.title}>Ubicación en el mapa</h3>
						{verificacion.mapa ?? (
							<div className="flex h-40 items-center justify-center gap-2 rounded-xl bg-muted text-fg-secondary text-sm">
								<MapPin aria-hidden className="size-4" />
								La visita no registró coordenadas.
							</div>
						)}
					</CrmCard>
					<div
						className={cn(
							"grid gap-5",
							compacto ? "@2xl:grid-cols-2" : "lg:grid-cols-2",
						)}
					>
						<CrmCard superficie="outline" className="gap-3 p-4">
							<h3 className={crmText.title}>Fotografías de la visita</h3>
							{verificacion.fotos.length > 0 ? (
								<PhotoStrip
									fotos={verificacion.fotos}
									onFotoClick={onFotoClick}
									onVerMas={onFotoClick ? () => onFotoClick(3) : undefined}
								/>
							) : (
								<p className="text-fg-tertiary text-sm">Sin fotografías.</p>
							)}
						</CrmCard>
						<CrmCard superficie="outline" className="gap-2 p-4">
							<h3 className={crmText.title}>Comentarios del verificador</h3>
							<p className="wrap-break-word text-fg-secondary text-sm leading-relaxed">
								{verificacion.comentarios || "Sin comentarios."}
							</p>
						</CrmCard>
					</div>
					<p className="text-fg-tertiary text-xs">{verificacion.pie}</p>
				</>
			) : (
				<div className="flex flex-col items-center gap-2 rounded-xl border border-line border-dashed bg-muted/40 px-6 py-12 text-center">
					<span
						aria-hidden
						className="mb-2 flex size-11 items-center justify-center rounded-full bg-line-subtle"
					>
						<MapPin className="size-5 text-fg-tertiary" />
					</span>
					<p className="font-semibold text-base text-fg">
						Sin verificación registrada
					</p>
					<p className="text-fg-secondary text-sm">
						Esta dirección aún no ha sido verificada en campo.
					</p>
					<p className="max-w-md text-fg-tertiary text-xs">
						La información de la visita (mapa, fotos y comentarios) se mostrará
						aquí automáticamente cuando se registre una visita realizada.
					</p>
				</div>
			)}
		</div>
	);
}

/* ── Edición: datos personales (RENAP, solo lectura) y direcciones ──────────── */

export function DatosPersonalesCard({
	datos,
}: {
	datos: Array<{ label: string; valor: string | null | undefined }>;
}) {
	return (
		<CrmCard superficie="outline" className="gap-4 bg-muted/50 p-5">
			<div className="flex items-center justify-between gap-2">
				<h3 className={crmText.name}>Datos personales</h3>
				<span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 font-medium text-[11px] text-fg-secondary">
					<Lock aria-hidden className="size-3" />
					RENAP · Solo lectura
				</span>
			</div>
			{datos.map((d) => (
				<FichaEditableRow
					key={d.label}
					etiqueta={d.label}
					valor={d.valor ?? ""}
				/>
			))}
			<p className="text-[11px] text-fg-tertiary">
				Sincronizado desde RENAP · no editable
			</p>
		</CrmCard>
	);
}

/** Dirección de residencia o de trabajo, en modo vista. */
export function DireccionCard({
	titulo,
	filas,
	nota,
	className,
}: {
	titulo: string;
	filas: Array<{ label: string; valor: string | null | undefined }>;
	/** "Fuente: solicitud de crédito", "Última modificación…". */
	nota?: React.ReactNode;
	className?: string;
}) {
	return (
		<CrmCard superficie="outline" className={cn("gap-4 p-5", className)}>
			<h3 className={crmText.name}>{titulo}</h3>
			{filas.map((f) => (
				<FichaEditableRow
					key={f.label}
					etiqueta={f.label}
					valor={f.valor ?? ""}
				/>
			))}
			{nota ? <p className="text-[11px] text-fg-tertiary">{nota}</p> : null}
		</CrmCard>
	);
}
