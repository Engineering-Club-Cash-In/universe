import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import {
	Car,
	ClipboardCheck,
	FilePenLine,
	Handshake,
	type LucideIcon,
	MapPin,
	RefreshCw,
	TrendingUp,
	UserRoundCog,
} from "lucide-react";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * ActionCrm — Figma "03 · Componentes CRM › Botones de Acción CRM", Action/CRM (94:1065).
 *
 * Variante "Acción" de Figma → prop `accion` (ícono, etiqueta y jerarquía salen de ACCIONES_CRM):
 *   RegistrarGestion  → "registrar-gestion"   (primario · lucide/clipboard-check)
 *   CrearPromesa      → "crear-promesa"       (primario · lucide/handshake)
 *   CrearConvenio     → "crear-convenio"      (secundario · lucide/file-pen-line)
 *   Reasignar         → "reasignar"           (ghost · lucide/user-round-cog)
 *   Reestructurar     → "reestructurar"       (secundario · lucide/refresh-cw)
 *   EscalarBucket     → "escalar-bucket"      (peligro · lucide/trending-up)
 *   RegistrarVisita   → "registrar-visita"    (ghost · lucide/map-pin)
 *   RecuperarVehiculo → "recuperar-vehiculo"  (peligro · lucide/car)
 * Variante "Estado":
 *   Default/Hover/Pressed → CSS (:hover, :active).  Disabled → `disabled`.
 *   Loading → `loading` (spinner + "Procesando", conserva el color pleno como en Figma).
 * Extra (no es variante de Figma): `superficie="oscura"` para usarlo dentro de la
 * Bottom Action Bar (contenedor neutral/900): el ghost toma borde neutral/600 y texto
 * neutral/200, y la sombra Clay-Subtle/Light se cambia por una sin brillo blanco.
 * `tono` permite forzar otra jerarquía; `children`/`icon` reemplazan etiqueta/ícono.
 */

type Tono = "primario" | "secundario" | "ghost" | "peligro";

export type AccionCrm =
	| "registrar-gestion"
	| "crear-promesa"
	| "crear-convenio"
	| "reasignar"
	| "reestructurar"
	| "escalar-bucket"
	| "registrar-visita"
	| "recuperar-vehiculo";

export const ACCIONES_CRM: Record<
	AccionCrm,
	{ etiqueta: string; icono: LucideIcon; tono: Tono }
> = {
	"registrar-gestion": {
		etiqueta: "Registrar gestión",
		icono: ClipboardCheck,
		tono: "primario",
	},
	"crear-promesa": {
		etiqueta: "Crear promesa",
		icono: Handshake,
		tono: "primario",
	},
	"crear-convenio": {
		etiqueta: "Crear convenio",
		icono: FilePenLine,
		tono: "secundario",
	},
	reasignar: { etiqueta: "Reasignar", icono: UserRoundCog, tono: "ghost" },
	reestructurar: {
		etiqueta: "Reestructurar",
		icono: RefreshCw,
		tono: "secundario",
	},
	"escalar-bucket": {
		etiqueta: "Escalar Bucket",
		icono: TrendingUp,
		tono: "peligro",
	},
	"registrar-visita": {
		etiqueta: "Registrar visita",
		icono: MapPin,
		tono: "ghost",
	},
	"recuperar-vehiculo": {
		etiqueta: "Recuperar vehículo",
		icono: Car,
		tono: "peligro",
	},
};

const actionCrmVariants = cva(
	// 32px de alto: p 8/16, gap 8, radius/md (14), texto 600 13/16.38, ícono S (16).
	"inline-flex h-8 shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-xl px-4 font-semibold text-[13px] leading-[1.26] outline-none transition-[background-color,box-shadow,color,opacity] duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 disabled:shadow-none [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
	{
		variants: {
			tono: {
				primario:
					"bg-brand text-on-brand shadow-clay-subtle hover:bg-brand-hover active:bg-cci-primary-700 active:shadow-pressed dark:active:bg-cci-primary-200",
				secundario:
					"bg-brand-subtle text-brand hover:bg-cci-primary-100 active:bg-cci-primary-200 active:shadow-pressed dark:active:bg-cci-primary-700 dark:hover:bg-cci-primary-800",
				ghost:
					"border border-line bg-transparent text-fg-secondary hover:bg-muted active:bg-cci-neutral-200 active:shadow-pressed dark:active:bg-cci-carbon-750",
				peligro:
					"bg-danger-solid text-on-solid shadow-clay-subtle hover:bg-cci-danger-700 active:bg-cci-danger-700 active:shadow-pressed",
			},
			superficie: {
				normal: "",
				oscura: "",
			},
		},
		compoundVariants: [
			// Sobre la barra oscura (neutral/900 en ambos modos) Figma usa Clay-Subtle/Dark,
			// que no tiene token de clase propio: se usa una sombra de elevación sin brillo.
			{
				tono: ["primario", "peligro"],
				superficie: "oscura",
				className: "shadow-tooltip",
			},
			{
				tono: "ghost",
				superficie: "oscura",
				className:
					"border-cci-neutral-600 text-cci-neutral-200 hover:bg-cci-neutral-800 active:bg-cci-neutral-800 dark:active:bg-cci-neutral-800 [&_svg]:text-cci-neutral-600",
			},
		],
		defaultVariants: { tono: "primario", superficie: "normal" },
	},
);

function ActionCrmSpinner() {
	return (
		<span
			aria-hidden
			className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
		/>
	);
}

type ActionCrmProps = Omit<React.ComponentProps<"button">, "children"> &
	Omit<VariantProps<typeof actionCrmVariants>, "tono"> & {
		accion: AccionCrm;
		/** Fuerza otra jerarquía visual; por defecto la de ACCIONES_CRM[accion]. */
		tono?: Tono;
		/** Reemplaza la etiqueta de Figma. */
		children?: React.ReactNode;
		/** Reemplaza el ícono de Figma; `null` lo oculta. */
		icon?: React.ReactNode;
		/** Estado "Loading": spinner + `loadingLabel`, sin opacidad de deshabilitado. */
		loading?: boolean;
		loadingLabel?: React.ReactNode;
		asChild?: boolean;
	};

function ActionCrm({
	accion,
	tono,
	superficie,
	children,
	icon,
	loading = false,
	loadingLabel = "Procesando",
	asChild = false,
	className,
	type = "button",
	...props
}: ActionCrmProps) {
	const def = ACCIONES_CRM[accion];
	const Icono = def.icono;
	const Comp = asChild ? Slot : "button";

	return (
		<Comp
			data-slot="action-crm"
			data-accion={accion}
			type={asChild ? undefined : type}
			className={cn(
				actionCrmVariants({ tono: tono ?? def.tono, superficie }),
				loading && "pointer-events-none",
				className,
			)}
			aria-busy={loading || undefined}
			aria-disabled={loading || undefined}
			{...props}
		>
			{asChild ? (
				children
			) : loading ? (
				<>
					<ActionCrmSpinner />
					{loadingLabel}
				</>
			) : (
				<>
					{icon === undefined ? <Icono aria-hidden /> : icon}
					{children ?? def.etiqueta}
				</>
			)}
		</Comp>
	);
}

export { ActionCrm, actionCrmVariants };
export type { ActionCrmProps, Tono as ActionCrmTono };
