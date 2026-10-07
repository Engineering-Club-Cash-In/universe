import { ArrowRight } from "lucide-react";
import type * as React from "react";
import { cn } from "@/lib/utils";
import { type Destino, EnlaceDestino } from "./destino";

/**
 * Piezas comunes de las tarjetas del Dashboard del supervisor (Figma `1954:14`):
 * superficie con título 16/600, descripción 13 secundaria y el enlace «Ver … →»
 * arriba a la derecha.
 */

export function TarjetaSupervision({
	titulo,
	descripcion,
	accion,
	children,
	className,
	...props
}: Omit<React.ComponentProps<"section">, "title"> & {
	titulo: React.ReactNode;
	descripcion?: React.ReactNode;
	accion?: React.ReactNode;
}) {
	return (
		<section
			className={cn(
				"flex min-w-0 flex-col gap-4 rounded-2xl bg-surface p-5 text-fg shadow-clay-raised sm:px-6",
				className,
			)}
			{...props}
		>
			<div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1.5">
				<div className="flex min-w-48 flex-1 flex-col gap-0.5">
					<h2 className="font-semibold text-base text-fg leading-[1.26]">
						{titulo}
					</h2>
					{descripcion ? (
						<p className="type-body-sm text-fg-secondary">{descripcion}</p>
					) : null}
				</div>
				{accion}
			</div>
			{children}
		</section>
	);
}

/** «Ver todas →», «Ver cartera completa →». */
export function EnlaceVer({
	destino,
	children,
	className,
}: {
	destino: Destino;
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<EnlaceDestino
			destino={destino}
			className={cn(
				"inline-flex shrink-0 items-center gap-1 rounded-md font-semibold text-brand text-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring",
				className,
			)}
		>
			{children}
			<ArrowRight aria-hidden className="size-3.5" />
		</EnlaceDestino>
	);
}
