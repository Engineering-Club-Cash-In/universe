import type { LucideIcon } from "lucide-react";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * SectionHeader — Figma "02 · Componentes › Navegación de bloques › Section Header" (335:1373).
 *
 * Encabezado transversal de bloque (Casos, Alertas, Promesas, Convenios, Reportes…).
 *
 * Figma → props:
 *   Título                         → `title` (18/26 600, text/primary)
 *   Descripción + Mostrar desc.    → `description` (13/18 400, text/secondary); se oculta si no viene
 *   Icono + Mostrar icono          → `icon` (lucide, 20px, text/secondary); se oculta si no viene
 *   Acción (swap) + Mostrar acción → `action` (ReactNode). Figma usa Button Text/Small
 *                                    (`<Button variant="link" size="sm">`) o Ghost/Small (`variant="outline"`).
 * Alto 40px fijo en Figma; aquí es mínimo 40px para que la descripción no se recorte.
 */
function SectionHeader({
	title,
	description,
	icon: Icon,
	action,
	titleAs: Title = "h3",
	className,
	...props
}: Omit<React.ComponentProps<"div">, "title"> & {
	title: React.ReactNode;
	description?: React.ReactNode;
	icon?: LucideIcon;
	action?: React.ReactNode;
	/** Etiqueta del título (por defecto h3). */
	titleAs?: "h2" | "h3" | "h4" | "div";
}) {
	return (
		<div
			data-slot="section-header"
			className={cn(
				"flex min-h-10 w-full items-center justify-between gap-4",
				className,
			)}
			{...props}
		>
			<div className="flex min-w-0 items-center gap-2.5">
				{Icon ? (
					<Icon aria-hidden className="size-5 shrink-0 text-fg-secondary" />
				) : null}
				<div className="flex min-w-0 flex-col gap-0.5">
					<Title className="truncate font-semibold text-fg text-lg leading-6.5">
						{title}
					</Title>
					{description ? (
						<p className="type-body-sm text-fg-secondary">{description}</p>
					) : null}
				</div>
			</div>
			{action ? (
				<div className="flex shrink-0 items-center">{action}</div>
			) : null}
		</div>
	);
}

export { SectionHeader };
