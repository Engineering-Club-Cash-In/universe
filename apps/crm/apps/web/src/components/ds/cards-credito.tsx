import { cva, type VariantProps } from "class-variance-authority";
import { Car, Phone, Shield } from "lucide-react";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Cards de crédito — Figma "03 · Componentes CRM" (CCI Cobros).
 *
 *   CardCredito    → "Card · Crédito"     Card/Crédito (87:1000)
 *                    Prioridad=Alta|Media|Baja → `prioridad` ("alta" | "media" | "baja").
 *   CardCliente    → "Card · Cliente"     Card/Cliente (88:877)
 *   CardVehiculo   → "Card · Vehículo"    Card/Vehículo (88:902)
 *   CardReferencia → "Card · Referencia"  Card/Referencia (88:933)
 *   CardSeguro     → "Card/Seguro"        Card/Seguro (732:2369)
 *
 * Son de presentación: reciben los datos por props y no consultan el servidor.
 * Los badges (Bucket, Mora, estado de ubicación, resultado del contacto…) entran
 * como `React.ReactNode` para usar los de `ds/badges.tsx` o cualquier otro.
 *
 * Este archivo también exporta las piezas que comparten todas las cards de `ds/`
 * (superficie, par etiqueta-valor, pill, avatar de iniciales y divisor). Son
 * internas de las cards de cobros; en pantallas nuevas usen los componentes de `ui/`.
 *
 * Desvíos respecto a Figma (todos por errores de auto-layout del archivo):
 *  - Avatar de iniciales: Figma lo exporta "w:fixed h:hug" y queda en 44×19 (pill).
 *    Se implementa el círculo que se quiso: 44×44 (M) y 64×64 (L).
 *  - Lo mismo con el círculo del ícono de "Próxima acción" (36×36) y el cuadro del
 *    ícono del vehículo (44×44, radius/md).
 *  - Los frames internos traen `bg:neutral/0` (blanco) por defecto de Figma; se dejan
 *    transparentes para que el modo oscuro no muestre parches blancos (en la captura
 *    de Card/Crédito se ve un recuadro blanco detrás del texto de la próxima acción).
 *  - El pill de prioridad de Card/Crédito tiene fondo neutral/0 → `bg-surface`.
 *  - Card/Seguro usa r:16 sin variable → `rounded-xl` (radius/md, 14), el token más cercano.
 *  - El ancho es fluido (`w-full`); el contenedor decide (Figma: 340/360/400 fijos).
 */

/* ── Piezas compartidas ─────────────────────────────────────────────────────── */

/**
 * Estilos de texto que Figma usa sin text style (tamaño/peso sueltos). El
 * interlineado "auto" de Plus Jakarta Sans es 126% → `leading-[1.26]`.
 */
export const crmText = {
	/** 10/600 terciario en mayúsculas: "PRÓXIMA ACCIÓN". */
	overline:
		"font-semibold text-[10px] text-fg-tertiary uppercase leading-[1.26]",
	/** 11/400 terciario: etiqueta de un par etiqueta-valor. */
	label: "text-[11px] text-fg-tertiary leading-[1.26]",
	/** 13/500 primario: valor de un par etiqueta-valor. */
	value: "font-medium text-[13px] text-fg leading-[1.26]",
	/** 12/400 secundario: subtítulo bajo un nombre. */
	sub: "text-fg-secondary text-xs leading-[1.26]",
	/** 15/600 primario: título de card. */
	title: "font-semibold text-[15px] text-fg leading-[1.26]",
	/** 16/600 primario: nombre de cliente/vehículo. */
	name: "font-semibold text-base text-fg leading-[1.26]",
} as const;

const crmCardVariants = cva("flex min-w-0 flex-col bg-surface text-fg", {
	variants: {
		/** raised: radius/lg + Clay-Raised (cards de la Ficha). outline: r16 + border/subtle. */
		superficie: {
			raised: "rounded-2xl shadow-clay-raised",
			outline: "rounded-xl border border-line-subtle",
		},
	},
	defaultVariants: { superficie: "raised" },
});

/** Superficie de card: p20, gap14, radius/lg, Shadow/Clay-Raised. */
export function CrmCard({
	className,
	superficie,
	...props
}: React.ComponentProps<"article"> & VariantProps<typeof crmCardVariants>) {
	return (
		<article
			data-slot="crm-card"
			className={cn(crmCardVariants({ superficie }), "gap-3.5 p-5", className)}
			{...props}
		/>
	);
}

/** Línea de 1px en border/divider. */
export function CrmDivider({ className }: { className?: string }) {
	return (
		<div
			aria-hidden
			className={cn("h-px w-full shrink-0 bg-divider", className)}
		/>
	);
}

/**
 * Par etiqueta-valor vertical (patrón "kv" de las cards y DataField de Figma):
 * etiqueta 11/400 terciaria, gap 2, valor 13/500 primario.
 */
export function CrmField({
	label,
	children,
	align = "start",
	className,
	valueClassName,
}: {
	label: React.ReactNode;
	children: React.ReactNode;
	/** "end" = Figma `items:max` (columna alineada a la derecha). */
	align?: "start" | "end";
	className?: string;
	valueClassName?: string;
}) {
	return (
		<div
			className={cn(
				"flex min-w-0 flex-col gap-0.5",
				align === "end" && "items-end text-right",
				className,
			)}
		>
			<span className={crmText.label}>{label}</span>
			<div className={cn(crmText.value, valueClassName)}>{children}</div>
		</div>
	);
}

export type CrmTone =
	| "success"
	| "warning"
	| "danger"
	| "info"
	| "neutral"
	| "brand";

const crmPillVariants = cva(
	"inline-flex w-fit shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-xs leading-[1.26]",
	{
		variants: {
			tone: {
				success: "bg-success-subtle text-success-text",
				warning: "bg-warning-subtle text-warning-text",
				danger: "bg-danger-subtle text-danger-text",
				info: "bg-info-subtle text-info-text",
				neutral: "bg-muted text-fg-secondary",
				brand: "bg-brand-subtle text-brand",
			},
			/**
			 * badge: pill de estado de 03 (texto 600, punto 7px).
			 * chip: "02 · Componentes › Chip" (texto 500, punto 6px).
			 */
			kind: { badge: "font-semibold", chip: "font-medium" },
		},
		defaultVariants: { tone: "neutral", kind: "badge" },
	},
);

/** Pill con punto: estados de ubicación, resultado de contacto, Chip de 02, etc. */
export function CrmPill({
	tone,
	kind,
	dot = true,
	className,
	children,
	...props
}: React.ComponentProps<"span"> &
	VariantProps<typeof crmPillVariants> & { dot?: boolean }) {
	return (
		<span
			data-slot="crm-pill"
			className={cn(crmPillVariants({ tone, kind }), className)}
			{...props}
		>
			{dot ? (
				<span
					aria-hidden
					className={cn(
						"shrink-0 rounded-full bg-current",
						kind === "chip" ? "size-1.5" : "size-1.75",
					)}
				/>
			) : null}
			{children}
		</span>
	);
}

/** Iniciales a partir del nombre: "María José Contreras" → "MC". */
export function inicialesDe(nombre: string) {
	const partes = nombre.trim().split(/\s+/).filter(Boolean);
	if (partes.length === 0) return "";
	// Con 4 palabras (dos nombres + dos apellidos) se toma el primer apellido.
	const segunda =
		partes.length >= 4 ? partes[2] : partes.length > 1 ? partes.at(-1) : "";
	return `${partes[0][0] ?? ""}${segunda?.[0] ?? ""}`.toUpperCase();
}

const crmAvatarVariants = cva(
	"relative inline-flex shrink-0 select-none items-center justify-center rounded-full font-bold leading-[1.26]",
	{
		variants: {
			size: {
				/** Avatar M: 44px, iniciales 15/700. */
				m: "size-11 text-[15px]",
				/** Avatar L: 64px, iniciales 22/700. */
				l: "size-16 text-[22px]",
			},
			tone: {
				brand: "bg-brand text-on-brand",
				// Card/Referencia liga el primitivo neutral/600.
				neutral: "bg-cci-neutral-600 text-on-solid dark:bg-cci-neutral-700",
			},
		},
		defaultVariants: { size: "m", tone: "brand" },
	},
);

/** "02 · Componentes › Avatar", Tipo=Iniciales. `activo` = Estado=Activo (punto verde). */
export function CrmAvatar({
	iniciales,
	size,
	tone,
	activo = false,
	className,
}: VariantProps<typeof crmAvatarVariants> & {
	iniciales: string;
	activo?: boolean;
	className?: string;
}) {
	return (
		<span
			aria-hidden
			className={cn(crmAvatarVariants({ size, tone }), className)}
		>
			{iniciales}
			{activo ? (
				<span
					className={cn(
						"absolute right-0 bottom-0 rounded-full border-2 border-surface bg-success-solid",
						size === "l" ? "size-4" : "size-3",
					)}
				/>
			) : null}
		</span>
	);
}

type ArticleProps = Omit<React.ComponentProps<"article">, "children">;

/* ── Card/Crédito ───────────────────────────────────────────────────────────── */

export type PrioridadCredito = "alta" | "media" | "baja";

const prioridadCredito: Record<
	PrioridadCredito,
	{ franja: string; texto: string; etiqueta: string }
> = {
	alta: {
		franja: "bg-danger-solid",
		texto: "text-danger-solid",
		etiqueta: "Prioridad Alta",
	},
	media: {
		franja: "bg-warning-solid",
		texto: "text-warning-solid",
		etiqueta: "Prioridad Media",
	},
	baja: {
		franja: "bg-success-solid",
		texto: "text-success-solid",
		etiqueta: "Prioridad Baja",
	},
};

export type CardCreditoProps = ArticleProps & {
	/** Variante "Prioridad" de Figma: color de la franja superior y del pill. */
	prioridad?: PrioridadCredito;
	/** Reemplaza "Prioridad Alta/Media/Baja". */
	prioridadLabel?: React.ReactNode;
	/** Badge del bucket, p. ej. `<BucketBadge bucket="B2" formato="Completa" />`. */
	bucket: React.ReactNode;
	cliente: React.ReactNode;
	/** "Toyota Hilux 2021". */
	vehiculo?: React.ReactNode;
	placa?: React.ReactNode;
	/** Texto de la próxima acción: "Llamar — seguimiento de promesa". */
	accion: React.ReactNode;
	/** Ícono de la próxima acción (lucide). Por defecto, teléfono. */
	accionIcon?: React.ReactNode;
	/** Badge del estado de mora, p. ej. `<MoraBadge mora="Mora60" />`. */
	mora: React.ReactNode;
	saldo: React.ReactNode;
	ultimoContacto: React.ReactNode;
	asesor: React.ReactNode;
};

export function CardCredito({
	prioridad = "alta",
	prioridadLabel,
	bucket,
	cliente,
	vehiculo,
	placa,
	accion,
	accionIcon,
	mora,
	saldo,
	ultimoContacto,
	asesor,
	className,
	...props
}: CardCreditoProps) {
	const p = prioridadCredito[prioridad];
	return (
		<article
			data-slot="card-credito"
			data-prioridad={prioridad}
			className={cn(
				"flex min-w-0 flex-col overflow-hidden rounded-2xl bg-surface text-fg shadow-clay-raised",
				className,
			)}
			{...props}
		>
			<div aria-hidden className={cn("h-1 w-full shrink-0", p.franja)} />
			<div className="flex flex-col gap-4 p-5">
				<div className="flex items-center justify-between gap-2">
					{bucket}
					<span
						className={cn(
							"inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-surface px-3 py-1 font-semibold text-xs leading-[1.26]",
							p.texto,
						)}
					>
						<span aria-hidden className="size-1.75 rounded-full bg-current" />
						{prioridadLabel ?? p.etiqueta}
					</span>
				</div>

				<div className="flex min-w-0 flex-col gap-0.5">
					<h3 className={cn(crmText.name, "truncate")}>{cliente}</h3>
					{vehiculo || placa ? (
						<p className="flex min-w-0 items-center gap-1.5 text-[13px] text-fg-secondary leading-[1.26]">
							{vehiculo ? <span className="truncate">{vehiculo}</span> : null}
							{vehiculo && placa ? (
								<span aria-hidden className="text-fg-tertiary">
									·
								</span>
							) : null}
							{placa ? (
								<span className="shrink-0 font-medium">{placa}</span>
							) : null}
						</p>
					) : null}
				</div>

				<CrmDivider />

				<div className="flex items-center gap-3 rounded-xl bg-brand-subtle p-3">
					<span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface text-brand [&_svg]:size-4">
						{accionIcon ?? <Phone aria-hidden />}
					</span>
					<div className="flex min-w-0 flex-1 flex-col gap-0.5">
						<span className={crmText.overline}>Próxima acción</span>
						<span className="truncate font-semibold text-brand text-sm leading-[1.26]">
							{accion}
						</span>
					</div>
				</div>

				<div className="flex flex-col gap-2.5">
					<div className="flex items-center justify-between gap-4">
						<CrmField label="Estado de mora">{mora}</CrmField>
						<CrmField
							label="Saldo pendiente"
							align="end"
							valueClassName="font-bold text-base"
						>
							{saldo}
						</CrmField>
					</div>
					<div className="flex items-center justify-between gap-4">
						<CrmField
							label="Último contacto"
							valueClassName="text-fg-secondary"
						>
							{ultimoContacto}
						</CrmField>
						<CrmField
							label="Asesor asignado"
							align="end"
							valueClassName="text-fg-secondary"
						>
							{asesor}
						</CrmField>
					</div>
				</div>
			</div>
		</article>
	);
}

/* ── Card/Cliente ───────────────────────────────────────────────────────────── */

export type Contactabilidad = "alta" | "media" | "baja";

const contactabilidadTexto: Record<
	Contactabilidad,
	{ etiqueta: string; className: string }
> = {
	alta: { etiqueta: "Alta", className: "text-success-text" },
	media: { etiqueta: "Media", className: "text-warning-text" },
	baja: { etiqueta: "Baja", className: "text-danger-text" },
};

export type CardClienteProps = ArticleProps & {
	nombre: string;
	/** Por defecto salen del nombre ("María José Contreras" → "MC"). */
	iniciales?: string;
	/** "DPI 2547 88213 0101". */
	documento?: React.ReactNode;
	telefono: React.ReactNode;
	creditosActivos: React.ReactNode;
	ciudad: React.ReactNode;
	/** Alta → status/success/text (Figma); Media → warning; Baja → danger. */
	contactabilidad: Contactabilidad;
};

export function CardCliente({
	nombre,
	iniciales,
	documento,
	telefono,
	creditosActivos,
	ciudad,
	contactabilidad,
	className,
	...props
}: CardClienteProps) {
	const c = contactabilidadTexto[contactabilidad];
	return (
		<CrmCard data-slot="card-cliente" className={className} {...props}>
			<div className="flex items-center gap-3">
				<CrmAvatar iniciales={iniciales ?? inicialesDe(nombre)} />
				<div className="flex min-w-0 flex-1 flex-col gap-0.5">
					<h3 className={cn(crmText.name, "truncate")}>{nombre}</h3>
					{documento ? <p className={crmText.sub}>{documento}</p> : null}
				</div>
			</div>
			<CrmDivider />
			{/* Dos columnas: la segunda queda alineada entre filas (Figma: justify space-between). */}
			<div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-3.5">
				<CrmField label="Teléfono">{telefono}</CrmField>
				<CrmField label="Créditos activos" valueClassName="font-semibold">
					{creditosActivos}
				</CrmField>
				<CrmField label="Ciudad">{ciudad}</CrmField>
				<CrmField
					label="Contactabilidad"
					valueClassName={cn("font-semibold", c.className)}
				>
					{c.etiqueta}
				</CrmField>
			</div>
		</CrmCard>
	);
}

/* ── Card/Vehículo ──────────────────────────────────────────────────────────── */

const estadoTexto: Record<
	"success" | "warning" | "danger" | "neutral",
	string
> = {
	success: "text-success-text",
	warning: "text-warning-text",
	danger: "text-danger-text",
	neutral: "text-fg",
};

export type CardVehiculoProps = ArticleProps & {
	/** "Toyota Hilux 2021". */
	vehiculo: React.ReactNode;
	placa: React.ReactNode;
	/** Pill de ubicación, p. ej. `<CrmPill tone="success">Ubicado</CrmPill>`. */
	ubicacion?: React.ReactNode;
	color: React.ReactNode;
	motor: React.ReactNode;
	/** Últimos dígitos del chasis: "…83402". */
	chasis: React.ReactNode;
	/** "Operativo". */
	estado: React.ReactNode;
	/** Color del estado; Figma: Operativo = success. */
	estadoTone?: "success" | "warning" | "danger" | "neutral";
	/** Estado del GPS: "Activo". */
	gps: React.ReactNode;
};

export function CardVehiculo({
	vehiculo,
	placa,
	ubicacion,
	color,
	motor,
	chasis,
	estado,
	estadoTone = "success",
	gps,
	className,
	...props
}: CardVehiculoProps) {
	return (
		<CrmCard data-slot="card-vehiculo" className={className} {...props}>
			<div className="flex items-center gap-3">
				<span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-subtle text-brand">
					<Car aria-hidden className="size-5" />
				</span>
				<div className="flex min-w-0 flex-1 flex-col gap-0.5">
					<h3 className={cn(crmText.name, "truncate")}>{vehiculo}</h3>
					<p className={crmText.sub}>Placa {placa}</p>
				</div>
				{ubicacion}
			</div>
			<CrmDivider />
			<div className="flex justify-between gap-4">
				<CrmField label="Color">{color}</CrmField>
				<CrmField label="Motor">{motor}</CrmField>
				<CrmField label="Chasis">{chasis}</CrmField>
			</div>
			<div className="flex justify-between gap-4">
				<CrmField
					label="Estado"
					valueClassName={cn("font-semibold", estadoTexto[estadoTone])}
				>
					{estado}
				</CrmField>
				<CrmField label="GPS">{gps}</CrmField>
			</div>
		</CrmCard>
	);
}

/* ── Card/Referencia ────────────────────────────────────────────────────────── */

export type CardReferenciaProps = ArticleProps & {
	nombre: string;
	iniciales?: string;
	/** "Referencia familiar". */
	tipo: React.ReactNode;
	telefono: React.ReactNode;
	parentesco: React.ReactNode;
	ultimoContacto: React.ReactNode;
	/** Pill del resultado, p. ej. `<CrmPill tone="info">Contactado — dará razón</CrmPill>`. */
	resultado?: React.ReactNode;
};

export function CardReferencia({
	nombre,
	iniciales,
	tipo,
	telefono,
	parentesco,
	ultimoContacto,
	resultado,
	className,
	...props
}: CardReferenciaProps) {
	return (
		<CrmCard data-slot="card-referencia" className={className} {...props}>
			<div className="flex items-center gap-3">
				<CrmAvatar
					iniciales={iniciales ?? inicialesDe(nombre)}
					tone="neutral"
				/>
				<div className="flex min-w-0 flex-1 flex-col gap-0.5">
					<h3 className={cn(crmText.title, "truncate")}>{nombre}</h3>
					<p className={crmText.sub}>{tipo}</p>
				</div>
			</div>
			<CrmDivider />
			<div className="flex justify-between gap-4">
				<CrmField label="Teléfono">{telefono}</CrmField>
				<CrmField label="Parentesco">{parentesco}</CrmField>
			</div>
			<CrmField label="Último contacto">{ultimoContacto}</CrmField>
			{resultado ? (
				<CrmField label="Resultado del contacto">{resultado}</CrmField>
			) : null}
		</CrmCard>
	);
}

/* ── Card/Seguro (y base de Card/EstadoCuenta) ──────────────────────────────── */

/**
 * Card con ícono + título y una grilla de DataField (Card/Seguro, Card/EstadoCuenta):
 * p20, gap14, r16, border/subtle, sin sombra. Grilla wrap de 2 columnas, gap 12.
 */
export function CrmInfoCard({
	icon,
	titulo,
	children,
	className,
	...props
}: ArticleProps & {
	icon?: React.ReactNode;
	titulo: React.ReactNode;
	children: React.ReactNode;
}) {
	return (
		<CrmCard superficie="outline" className={className} {...props}>
			<div className="flex items-center gap-2">
				<span className="flex shrink-0 text-fg-secondary [&_svg]:size-4">
					{icon ?? <Shield aria-hidden />}
				</span>
				<h3 className={crmText.title}>{titulo}</h3>
			</div>
			<div className="grid grid-cols-2 gap-3">{children}</div>
		</CrmCard>
	);
}

/**
 * DataField vertical de "02 · Componentes" (149:3001): Énfasis Normal = 13/600,
 * Fuerte = 16/700, Positivo = success, Negativo = danger.
 */
export function CrmDataField({
	label,
	children,
	enfasis = "normal",
	className,
}: {
	label: React.ReactNode;
	children: React.ReactNode;
	enfasis?: "normal" | "fuerte" | "positivo" | "negativo";
	className?: string;
}) {
	return (
		<CrmField
			label={label}
			className={className}
			valueClassName={cn(
				"font-semibold",
				enfasis === "fuerte" && "font-bold text-base",
				enfasis === "positivo" && "text-success-text",
				enfasis === "negativo" && "text-danger-text",
			)}
		>
			{children}
		</CrmField>
	);
}

export type CardSeguroProps = ArticleProps & {
	titulo?: React.ReactNode;
	aseguradora: React.ReactNode;
	tipoSeguro: React.ReactNode;
	/** Se muestra con énfasis Fuerte (16/700). */
	telefonoEmergencia: React.ReactNode;
	coberturas: React.ReactNode;
};

export function CardSeguro({
	titulo = "Seguro",
	aseguradora,
	tipoSeguro,
	telefonoEmergencia,
	coberturas,
	...props
}: CardSeguroProps) {
	return (
		<CrmInfoCard data-slot="card-seguro" titulo={titulo} {...props}>
			<CrmDataField label="Aseguradora">{aseguradora}</CrmDataField>
			<CrmDataField label="Tipo de seguro">{tipoSeguro}</CrmDataField>
			<CrmDataField label="Teléfono de emergencia" enfasis="fuerte">
				{telefonoEmergencia}
			</CrmDataField>
			<CrmDataField label="Coberturas">{coberturas}</CrmDataField>
		</CrmInfoCard>
	);
}
