import { ToggleGroup } from "radix-ui";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * PeriodSelector — Figma "02 · Componentes › Period Selector" (708:1869).
 *
 * Control segmentado (Día · Semana · Mes) para filtrar los KPIs de desempeño. Radix ToggleGroup
 * de selección única: siempre hay un segmento activo (no se puede deseleccionar).
 *
 * Figma → props:
 *   Período=Día | Semana | Mes → `value` (default de opciones: "dia" | "semana" | "mes")
 *   cambio de segmento          → `onChange(value)`
 *   segmentos                   → `options` (por defecto Día/Semana/Mes; se pueden pasar otros)
 * Contenedor: surface-raised + border/subtle, r:10, p:3, gap:2.
 * Segmento: r:8, p 6/16, 13px. Activo: surface + sombra 0 1 3 (≈ `shadow-sm`), 600 text/primary;
 * inactivo: 500 text/secondary. Hover/focus/disabled no vienen en Figma: hover sube a text/primary.
 */

type PeriodOption<T extends string = string> = {
	value: T;
	label: React.ReactNode;
	disabled?: boolean;
};

const DEFAULT_PERIOD_OPTIONS = [
	{ value: "dia", label: "Día" },
	{ value: "semana", label: "Semana" },
	{ value: "mes", label: "Mes" },
] as const satisfies readonly PeriodOption[];

type DefaultPeriod = (typeof DEFAULT_PERIOD_OPTIONS)[number]["value"];

function PeriodSelector<T extends string = DefaultPeriod>({
	value,
	onChange,
	options = DEFAULT_PERIOD_OPTIONS as unknown as readonly PeriodOption<T>[],
	disabled,
	className,
	"aria-label": ariaLabel = "Período",
	...props
}: Omit<
	React.ComponentProps<"div">,
	"onChange" | "defaultValue" | "dir" | "value"
> & {
	value: T;
	onChange: (value: T) => void;
	options?: readonly PeriodOption<T>[];
	disabled?: boolean;
}) {
	return (
		<ToggleGroup.Root
			type="single"
			data-slot="period-selector"
			aria-label={ariaLabel}
			value={value}
			onValueChange={(next) => {
				if (next) onChange(next as T);
			}}
			disabled={disabled}
			className={cn(
				"inline-flex w-fit items-center gap-0.5 rounded-lg border border-line-subtle bg-surface-raised p-0.75",
				className,
			)}
			{...props}
		>
			{options.map((option) => (
				<ToggleGroup.Item
					key={option.value}
					value={option.value}
					disabled={option.disabled}
					className="inline-flex h-7 cursor-pointer items-center justify-center whitespace-nowrap rounded-md px-4 font-medium text-[13px] text-fg-secondary leading-[1.26] outline-none transition-[background-color,box-shadow,color] duration-150 ease-out hover:text-fg focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 data-[state=on]:bg-surface data-[state=on]:font-semibold data-[state=on]:text-fg data-[state=on]:shadow-sm"
				>
					{/* La copia invisible en 600 reserva el ancho: el segmento no "salta" al activarse. */}
					<span className="grid">
						<span
							aria-hidden
							className="invisible col-start-1 row-start-1 font-semibold"
						>
							{option.label}
						</span>
						<span className="col-start-1 row-start-1">{option.label}</span>
					</span>
				</ToggleGroup.Item>
			))}
		</ToggleGroup.Root>
	);
}

export {
	PeriodSelector,
	DEFAULT_PERIOD_OPTIONS,
	type DefaultPeriod,
	type PeriodOption,
};
