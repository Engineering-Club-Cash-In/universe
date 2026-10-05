import { TriangleAlert } from "lucide-react";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Indicadores de seguimiento de cobros — Figma "03 · Componentes CRM".
 *
 *   SinContacto      → "Cartera › Indicador/SinContacto" (1406:3179)
 *                      Intentos=Cero|Uno|2Mas → se deriva de `intentos` (0 → Cero, 1 → Uno, ≥2 → 2Mas).
 *                      `ultimoIntento` es la fecha ya formateada ("11 ago 2026"); solo se muestra con ≥1 intento.
 *   AccionPendiente  → "Cartera › Info/AccionPendiente" (2195:3402)
 *                      Tipo=Llamar|Promesa por vencer|Promesa vencida|Confirmar pago|
 *                           Contactar referencia|Sin intento → `tipo`.
 *                      `detalle` es la segunda línea ("hoy · 3:00 PM", "vence hoy", …).
 *   ProximoContacto  → "Sección: Seguimiento de contacto › Info/ProximoContacto" (1394:3368)
 *                      Estado=Programado|Hoy|SinProgramar → `estado`. `valor` es obligatorio con
 *                      "Programado" ("12 ago · 3:00 PM"); con "Hoy"/"SinProgramar" tiene texto por defecto.
 *
 * Desvíos/notas:
 *  - Figma usa hex sueltos (#9aa3af para etiquetas/fechas, #111827 para el valor): se mapean a
 *    text/tertiary → `text-fg-tertiary` y text/primary → `text-fg`, como el resto de la ficha.
 *  - Ícono "Alerta" (triangle-alert, 16px) → `text-warning-solid`.
 *  - Tamaños sin estilo de texto en Figma: 13/16.38 → `text-[13px] leading-[1.26]`,
 *    11/13.86 → `text-[11px] leading-[1.26]`, 14/17.64 → `text-sm leading-[1.26]`.
 */

/* ── Indicador/SinContacto ──────────────────────────────────────────────────── */

export type SinContactoVariante = "Cero" | "Uno" | "2Mas";

export function sinContactoVariante(intentos: number): SinContactoVariante {
	if (intentos <= 0) return "Cero";
	if (intentos === 1) return "Uno";
	return "2Mas";
}

export function SinContacto({
	intentos,
	ultimoIntento,
	className,
	...props
}: Omit<React.ComponentProps<"div">, "children"> & {
	/** Intentos de contacto fallidos acumulados. */
	intentos: number;
	/** Fecha del último intento, ya formateada ("11 ago 2026"). */
	ultimoIntento?: string;
}) {
	const variante = sinContactoVariante(intentos);
	const texto =
		variante === "Cero"
			? "Sin intento hoy"
			: `${intentos} ${intentos === 1 ? "intento" : "intentos"} sin contacto`;

	return (
		<div
			data-slot="sin-contacto"
			data-variante={variante}
			className={cn("inline-flex items-start gap-2", className)}
			{...props}
		>
			<span className="flex size-4 shrink-0 items-center justify-center">
				{variante === "2Mas" ? (
					<TriangleAlert
						aria-hidden
						className="text-warning-solid"
						size={16}
						strokeWidth={2}
						absoluteStrokeWidth
					/>
				) : (
					<span
						aria-hidden
						className={cn(
							"size-2 rounded-full",
							variante === "Uno" ? "bg-fg-secondary" : "bg-fg-tertiary",
						)}
					/>
				)}
			</span>
			<span className="flex flex-col gap-0.5">
				<span
					className={cn(
						"text-[13px] leading-[1.26]",
						variante === "2Mas" && "font-semibold text-warning-solid",
						variante === "Uno" && "font-semibold text-fg-secondary",
						variante === "Cero" && "font-medium text-fg-tertiary",
					)}
				>
					{texto}
				</span>
				{variante !== "Cero" && ultimoIntento ? (
					<span className="text-[11px] text-fg-tertiary leading-[1.26]">
						Último intento: {ultimoIntento}
					</span>
				) : null}
			</span>
		</div>
	);
}

/* ── Info/AccionPendiente ───────────────────────────────────────────────────── */

export type AccionPendienteTipo =
	| "Llamar"
	| "Promesa por vencer"
	| "Promesa vencida"
	| "Confirmar pago"
	| "Contactar referencia"
	| "Sin intento";

const accionPendiente: Record<
	AccionPendienteTipo,
	{ titulo: string; punto: string }
> = {
	Llamar: { titulo: "Llamar", punto: "bg-accent-default" },
	"Promesa por vencer": {
		titulo: "Promesa por vencer",
		punto: "bg-warning-solid",
	},
	"Promesa vencida": { titulo: "Promesa vencida", punto: "bg-danger-solid" },
	"Confirmar pago": { titulo: "Confirmar pago", punto: "bg-warning-solid" },
	"Contactar referencia": {
		titulo: "Contactar referencia",
		punto: "bg-accent-default",
	},
	"Sin intento": {
		titulo: "Sin intento de contacto",
		punto: "bg-warning-solid",
	},
};

export function AccionPendiente({
	tipo,
	titulo,
	detalle,
	className,
	...props
}: Omit<React.ComponentProps<"div">, "children"> & {
	tipo: AccionPendienteTipo;
	/** Reemplaza el título de Figma para el tipo. */
	titulo?: React.ReactNode;
	/** Segunda línea: "hoy · 3:00 PM", "vence hoy", "72 h restantes"… */
	detalle?: React.ReactNode;
}) {
	const def = accionPendiente[tipo];
	return (
		<div
			data-slot="accion-pendiente"
			className={cn("inline-flex items-center gap-2.5", className)}
			{...props}
		>
			<span
				aria-hidden
				className={cn("size-2 shrink-0 rounded-full", def.punto)}
			/>
			<span className="flex min-w-0 flex-col gap-0.5">
				<span className="font-semibold text-[13px] text-fg leading-[1.26]">
					{titulo ?? def.titulo}
				</span>
				{detalle ? (
					<span className="text-fg-secondary text-xs leading-[1.26]">
						{detalle}
					</span>
				) : null}
			</span>
		</div>
	);
}

/* ── Info/ProximoContacto ───────────────────────────────────────────────────── */

export type ProximoContactoEstado = "Programado" | "Hoy" | "SinProgramar";

type ProximoContactoProps = Omit<React.ComponentProps<"div">, "children"> & {
	/** Etiqueta superior. */
	label?: string;
} & (
		| {
				estado: "Programado";
				/** Fecha y hora ya formateadas: "12 ago · 3:00 PM". */
				valor: React.ReactNode;
		  }
		| {
				estado: "Hoy" | "SinProgramar";
				/** Por defecto "Hoy" / "Sin programar". */
				valor?: React.ReactNode;
		  }
	);

export function ProximoContacto({
	estado,
	valor,
	label = "Próximo contacto",
	className,
	...props
}: ProximoContactoProps) {
	const texto =
		valor ??
		(estado === "Hoy"
			? "Hoy"
			: estado === "SinProgramar"
				? "Sin programar"
				: null);
	return (
		<div
			data-slot="proximo-contacto"
			data-estado={estado}
			className={cn("inline-flex flex-col gap-0.5 py-0.5", className)}
			{...props}
		>
			<span className="font-medium text-[11px] text-fg-tertiary leading-[1.26]">
				{label}
			</span>
			<span
				className={cn(
					"text-sm leading-[1.26]",
					estado === "SinProgramar"
						? "font-normal text-fg-tertiary"
						: "font-semibold text-fg",
				)}
			>
				{texto}
			</span>
		</div>
	);
}
