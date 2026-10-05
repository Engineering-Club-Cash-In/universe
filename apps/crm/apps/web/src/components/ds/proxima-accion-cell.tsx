import {
	CircleCheck,
	Gavel,
	Handshake,
	type LucideIcon,
	MapPin,
	Phone,
	UsersRound,
} from "lucide-react";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * ProximaAccionCell — Figma "03 · Componentes CRM › Sección: Próxima Acción ›
 * Cell/PróximaAcción" (95:909). Celda con ícono y color semántico para la Tabla de
 * Cartera, tarjetas y paneles.
 *
 * Variantes de Figma → `accion`:
 *   Llamar        → "Llamar"                 (brand, ícono phone · Marca)
 *   SeguirPromesa → "Seguir promesa"         (warning, ícono handshake · Alerta)
 *   Referencias   → "Contactar referencias"  (info, ícono users-round · Default)
 *   Juridico      → "Escalar a jurídico"     (danger, ícono gavel · Peligro)
 *   Visita        → "Programar visita"       (accent/alt-bg + bucket/b3/fg, ícono map-pin · Alerta)
 *   Ninguna       → "Sin acción pendiente"   (neutral/100, ícono circle-check · Terciario)
 * `children` reemplaza el texto por defecto.
 *
 * Desvíos/notas:
 *  - Colores del componente Icon: Default → `text-fg`, Marca → `text-brand`,
 *    Alerta → `text-warning-solid`, Peligro → `text-danger-solid`, Terciario → `text-fg-tertiary`.
 *  - El círculo del ícono usa bg/surface (Juridico y Visita lo ligan a neutral/0; se unifica
 *    en `bg-surface` para que en oscuro no quede un círculo blanco).
 *  - neutral/100 (Ninguna) → `bg-muted` (carbon/800 en oscuro).
 *  - Íconos de 14px con trazo de 2px absoluto (`absoluteStrokeWidth`), como el vector de Figma.
 */

export type ProximaAccion =
	| "Llamar"
	| "SeguirPromesa"
	| "Referencias"
	| "Juridico"
	| "Visita"
	| "Ninguna";

const proximaAccion: Record<
	ProximaAccion,
	{ label: string; icon: LucideIcon; chip: string; iconFg: string }
> = {
	Llamar: {
		label: "Llamar",
		icon: Phone,
		chip: "bg-brand-subtle text-brand",
		iconFg: "text-brand",
	},
	SeguirPromesa: {
		label: "Seguir promesa",
		icon: Handshake,
		chip: "bg-warning-subtle text-warning-text",
		iconFg: "text-warning-solid",
	},
	Referencias: {
		label: "Contactar referencias",
		icon: UsersRound,
		chip: "bg-info-subtle text-info-text",
		iconFg: "text-fg",
	},
	Juridico: {
		label: "Escalar a jurídico",
		icon: Gavel,
		chip: "bg-danger-subtle text-danger-text",
		iconFg: "text-danger-solid",
	},
	Visita: {
		label: "Programar visita",
		icon: MapPin,
		chip: "bg-accent-alt text-bucket-b3-fg",
		iconFg: "text-warning-solid",
	},
	Ninguna: {
		label: "Sin acción pendiente",
		icon: CircleCheck,
		chip: "bg-muted text-fg-tertiary",
		iconFg: "text-fg-tertiary",
	},
};

export const PROXIMA_ACCION_LABEL: Record<ProximaAccion, string> =
	Object.fromEntries(
		Object.entries(proximaAccion).map(([k, v]) => [k, v.label]),
	) as Record<ProximaAccion, string>;

export function ProximaAccionCell({
	accion,
	children,
	className,
	...props
}: Omit<React.ComponentProps<"span">, "children"> & {
	accion: ProximaAccion;
	/** Texto; por defecto, el de Figma para la acción. */
	children?: React.ReactNode;
}) {
	const def = proximaAccion[accion];
	const Icon = def.icon;
	return (
		<span
			data-slot="proxima-accion-cell"
			data-accion={accion}
			className={cn(
				"inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full py-1 pr-3 pl-2 font-semibold text-xs leading-[1.26]",
				def.chip,
				className,
			)}
			{...props}
		>
			<span className="flex w-5.5 shrink-0 items-center justify-center rounded-full bg-surface py-0.5">
				<Icon
					aria-hidden
					className={def.iconFg}
					size={14}
					strokeWidth={2}
					absoluteStrokeWidth
				/>
			</span>
			{children ?? def.label}
		</span>
	);
}
