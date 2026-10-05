import { format, formatDistanceToNowStrict } from "date-fns";
import { es } from "date-fns/locale";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Cells de Tabla — Figma "03 · Componentes CRM › Cells de Tabla". Contenido de celda
 * reutilizable para cualquier tabla (va dentro de un TableCell de ui/table.tsx).
 *
 *   Cell/Avatar (136:1771) → <CellAvatar nombre subtitulo iniciales? avatar? />
 *       Avatar Iniciales S (32px, brand/primary) + nombre 600 13 + subtítulo 400 11 tertiary.
 *   Cell/Dinero (136:1777) → <CellDinero monto moneda? align? />
 *       700 13, alineado a la derecha (justify:max). `monto` numérico se formatea "Q 48,250.00".
 *   Cell/Fecha  (136:1779) → <CellFecha fecha relativo? />
 *       fecha 500 13 + relativo 400 11 tertiary. Con `Date` se formatea "15 jul 2026" y,
 *       si no se pasa `relativo`, se calcula ("hace 3 días").
 *   Cell/Badge  (136:1782) → <CellBadge>{<MoraBadge …/>}</CellBadge>   (130px)
 *   Cell/Estado (136:1786) → <CellEstado>{<BucketBadge …/>}</CellEstado> (80px)
 * Los anchos fijos de Figma (240/140/120/130/80) son el default y se cambian con `className`.
 */

function iniciales(nombre: string) {
	const partes = nombre.trim().split(/\s+/).filter(Boolean);
	if (partes.length === 0) return "";
	const primera = partes[0][0] ?? "";
	const ultima = partes.length > 1 ? (partes[partes.length - 1][0] ?? "") : "";
	return (primera + ultima).toUpperCase();
}

type CellAvatarProps = Omit<React.ComponentProps<"div">, "children"> & {
	nombre: React.ReactNode;
	subtitulo?: React.ReactNode;
	/** Por defecto: primera letra del primer y del último nombre. */
	iniciales?: string;
	/** Reemplaza el avatar de iniciales (p. ej. una foto). */
	avatar?: React.ReactNode;
};

function CellAvatar({
	nombre,
	subtitulo,
	iniciales: inicialesProp,
	avatar,
	className,
	...props
}: CellAvatarProps) {
	const texto =
		inicialesProp ?? (typeof nombre === "string" ? iniciales(nombre) : "");
	return (
		<div
			data-slot="cell-avatar"
			className={cn("flex w-60 min-w-0 items-center gap-2.5", className)}
			{...props}
		>
			{avatar ?? (
				<span
					aria-hidden
					className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand font-bold text-on-brand text-xs leading-[1.26]"
				>
					{texto}
				</span>
			)}
			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className="truncate font-semibold text-[13px] text-fg leading-[1.26]">
					{nombre}
				</span>
				{subtitulo ? (
					<span className="truncate text-[11px] text-fg-tertiary leading-[1.26]">
						{subtitulo}
					</span>
				) : null}
			</div>
		</div>
	);
}

const formatoMonto = new Intl.NumberFormat("es-GT", {
	minimumFractionDigits: 2,
	maximumFractionDigits: 2,
});

/** "Q 48,250.00" — formato de Figma para montos en quetzales. */
function formatearQuetzales(monto: number, moneda = "Q") {
	return `${moneda} ${formatoMonto.format(monto)}`;
}

type CellDineroProps = Omit<React.ComponentProps<"div">, "children"> & {
	monto: number | React.ReactNode;
	moneda?: string;
	/** Figma alinea a la derecha (justify:max). */
	align?: "end" | "start";
};

function CellDinero({
	monto,
	moneda = "Q",
	align = "end",
	className,
	...props
}: CellDineroProps) {
	return (
		<div
			data-slot="cell-dinero"
			className={cn(
				"flex w-35 items-center",
				align === "end" ? "justify-end" : "justify-start",
				className,
			)}
			{...props}
		>
			<span className="whitespace-nowrap font-bold text-[13px] text-fg tabular-nums leading-[1.26]">
				{typeof monto === "number" ? formatearQuetzales(monto, moneda) : monto}
			</span>
		</div>
	);
}

type CellFechaProps = Omit<React.ComponentProps<"div">, "children"> & {
	fecha: Date | React.ReactNode;
	/** Texto relativo ("hace 3 días"). Con `fecha` Date se calcula si no se pasa; `null` lo oculta. */
	relativo?: React.ReactNode | null;
};

function CellFecha({ fecha, relativo, className, ...props }: CellFechaProps) {
	const esFecha = fecha instanceof Date;
	const principal = esFecha
		? format(fecha, "d MMM yyyy", { locale: es })
		: fecha;
	const secundario =
		relativo === undefined && esFecha
			? formatDistanceToNowStrict(fecha, { addSuffix: true, locale: es })
			: relativo;
	return (
		<div
			data-slot="cell-fecha"
			className={cn("flex w-30 flex-col gap-0.5", className)}
			{...props}
		>
			<span className="whitespace-nowrap font-medium text-[13px] text-fg leading-[1.26]">
				{principal}
			</span>
			{secundario ? (
				<span className="whitespace-nowrap text-[11px] text-fg-tertiary leading-[1.26]">
					{secundario}
				</span>
			) : null}
		</div>
	);
}

/** Cell/Badge: contenedor de 130px para un badge (en Figma, Badge/Mora). */
function CellBadge({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="cell-badge"
			className={cn("flex w-32.5 items-center", className)}
			{...props}
		/>
	);
}

/** Cell/Estado: contenedor de 80px para un estado corto (en Figma, Badge/Bucket compacta). */
function CellEstado({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="cell-estado"
			className={cn("flex w-20 items-center", className)}
			{...props}
		/>
	);
}

export {
	CellAvatar,
	CellBadge,
	CellDinero,
	CellEstado,
	CellFecha,
	formatearQuetzales,
};
export type { CellAvatarProps, CellDineroProps, CellFechaProps };
