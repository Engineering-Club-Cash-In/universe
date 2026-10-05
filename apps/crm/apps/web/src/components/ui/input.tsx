import { CircleCheck, CircleX } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Input — Figma "02 · Componentes › Inputs" › Input/Text (79:914) e Input/Variants (80:906).
 *
 * El "field" de Figma: alto 42px (p 12/16), gap 8, radius/md (14), bg/surface,
 * borde 1px border/default, texto 14px text/primary, placeholder text/tertiary.
 *
 * Estado de Figma → cómo se activa:
 *   Empty / Filled → con o sin valor (placeholder text/tertiary)
 *   Hover          → :hover → neutral/50 (= bg/canvas; en oscuro, canvas oscuro)
 *   Focus          → :focus-visible → borde brand/primary de 2px (borde + inset-ring) + Shadow/Clay-Subtle
 *   Disabled       → `disabled` → bg neutral/100 (bg-muted), border/subtle, text/tertiary, opacidad 60%
 *   ReadOnly       → `readOnly` → border/subtle, text/secondary, sin hover
 *   Success        → `status="success"` → borde status/success/solid
 *   Error          → `status="error"` o `aria-invalid` → borde status/danger/solid, texto status/danger/text
 *
 * Piezas:
 *   Input            → el <input> nativo es la caja (API de siempre; `status` es opcional).
 *   InputGroup       → la caja como fila (para íconos o botones dentro). Con `status` agrega
 *                      solo el ícono de Figma: Success → CircleCheck, Error → CircleX (16px).
 *   InputGroupInput  → el <input> sin borde que va dentro del grupo.
 *   InputGroupAddon  → ícono/botón (16px, text/tertiary).
 *   InputStepper     → ▲▼ de Figma "Tipo=Number" (lo usa CurrencyInput con `step`).
 * Variantes de Figma ya armadas: SearchInput, PasswordInput, DateInput, CurrencyInput, Textarea.
 */

type InputStatus = "success" | "error";

/** Estados del "field" sobre el elemento nativo (Input y Textarea). */
const fieldStateClassName = [
	"rounded-xl border border-line bg-surface text-fg outline-none",
	"transition-[background-color,border-color,box-shadow,color,opacity] duration-150 ease-out",
	"selection:bg-brand selection:text-on-brand placeholder:text-fg-tertiary",
	"scheme-light dark:scheme-dark",
	"not-read-only:hover:bg-canvas",
	"focus-visible:border-brand focus-visible:bg-surface focus-visible:shadow-clay-subtle focus-visible:inset-ring-1 focus-visible:inset-ring-brand",
	"[[readonly]]:border-line-subtle [[readonly]]:text-fg-secondary",
	"disabled:cursor-not-allowed disabled:border-line-subtle disabled:bg-muted disabled:text-fg-tertiary disabled:opacity-60",
	"data-[status=success]:border-success-solid data-[status=success]:inset-ring-success-solid",
	"aria-invalid:border-danger-solid aria-invalid:text-danger-text aria-invalid:inset-ring-danger-solid",
].join(" ");

function Input({
	className,
	type,
	status,
	"aria-invalid": ariaInvalid,
	...props
}: React.ComponentProps<"input"> & {
	/** Success / Error de Figma (solo el borde; el ícono lo pone InputGroup). */
	status?: InputStatus;
}) {
	return (
		<input
			type={type}
			data-slot="input"
			data-status={status}
			aria-invalid={status === "error" ? true : ariaInvalid}
			className={cn(
				fieldStateClassName,
				"flex h-10.5 w-full min-w-0 px-4 py-1 text-base md:text-sm",
				"file:inline-flex file:h-7 file:border-0 file:bg-transparent file:font-medium file:text-fg file:text-sm",
				// <Input type="date|month|time…">: el indicador nativo en el tono de los íconos de Figma.
				"[&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-50 [&::-webkit-calendar-picker-indicator]:hover:opacity-80",
				className,
			)}
			{...props}
		/>
	);
}

const InputGroupContext = React.createContext<{ status?: InputStatus }>({});

/**
 * Caja de Figma como fila (auto-layout: p 12/16, gap 8). El estado lo toma del input
 * de adentro (`:focus-within`, `disabled`, `readOnly`, `aria-invalid`) o de `status`.
 */
function InputGroup({
	className,
	status,
	children,
	...props
}: React.ComponentProps<"div"> & { status?: InputStatus }) {
	const value = React.useMemo(() => ({ status }), [status]);
	return (
		<InputGroupContext.Provider value={value}>
			<div
				data-slot="input-group"
				data-status={status}
				className={cn(
					"relative flex h-10.5 w-full min-w-0 items-center gap-2 rounded-xl border border-line bg-surface px-4 text-fg",
					"transition-[background-color,border-color,box-shadow,opacity] duration-150 ease-out",
					"scheme-light dark:scheme-dark",
					"not-has-[input:disabled,input[readonly]]:hover:bg-canvas",
					"focus-within:inset-ring-1 focus-within:inset-ring-brand focus-within:border-brand focus-within:bg-surface focus-within:shadow-clay-subtle",
					"has-[input[readonly]]:border-line-subtle",
					"has-[input:disabled]:cursor-not-allowed has-[input:disabled]:border-line-subtle has-[input:disabled]:bg-muted has-[input:disabled]:opacity-60",
					"data-[status=success]:inset-ring-success-solid data-[status=success]:border-success-solid",
					"has-[input[aria-invalid=true]]:inset-ring-danger-solid has-[input[aria-invalid=true]]:border-danger-solid",
					"[&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0",
					className,
				)}
				{...props}
			>
				{children}
				{status === "success" ? (
					<CircleCheck aria-hidden className="text-success-solid" />
				) : null}
				{status === "error" ? (
					<CircleX aria-hidden className="text-danger-solid" />
				) : null}
			</div>
		</InputGroupContext.Provider>
	);
}

function InputGroupInput({
	className,
	"aria-invalid": ariaInvalid,
	...props
}: React.ComponentProps<"input">) {
	const { status } = React.useContext(InputGroupContext);
	return (
		<input
			data-slot="input-group-input"
			aria-invalid={status === "error" ? true : ariaInvalid}
			className={cn(
				"h-full w-full min-w-0 flex-1 border-0 bg-transparent p-0 text-base text-fg outline-none md:text-sm",
				"selection:bg-brand selection:text-on-brand placeholder:text-fg-tertiary",
				"disabled:cursor-not-allowed disabled:text-fg-tertiary",
				"aria-invalid:text-danger-text [[readonly]]:text-fg-secondary",
				"[&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none",
				className,
			)}
			{...props}
		/>
	);
}

/** Ícono o botón dentro de InputGroup (Figma "Icon / Tamaño=S, Color=Terciario"). */
function InputGroupAddon({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="input-group-addon"
			className={cn(
				"flex shrink-0 select-none items-center text-fg-tertiary",
				className,
			)}
			{...props}
		/>
	);
}

/**
 * ▲▼ de Figma "Input/Variants › Tipo=Number" (frame "stepper": col, gap 2, glifos 8px
 * text/tertiary). Los botones no entran al orden de tabulación: con teclado se usan
 * las flechas ↑/↓ del input.
 */
function InputStepper({
	onIncrement,
	onDecrement,
	disabled,
	className,
	incrementLabel = "Aumentar",
	decrementLabel = "Disminuir",
}: {
	onIncrement: () => void;
	onDecrement: () => void;
	disabled?: boolean;
	className?: string;
	incrementLabel?: string;
	decrementLabel?: string;
}) {
	const buttonClassName =
		"flex h-2.5 w-3 cursor-pointer items-center justify-center text-[8px] text-fg-tertiary leading-[10px] transition-colors duration-150 hover:text-fg disabled:cursor-not-allowed disabled:hover:text-fg-tertiary";
	return (
		<div
			data-slot="input-stepper"
			className={cn("flex shrink-0 flex-col items-center gap-0.5", className)}
		>
			<button
				type="button"
				tabIndex={-1}
				aria-label={incrementLabel}
				disabled={disabled}
				onClick={onIncrement}
				className={buttonClassName}
			>
				<span aria-hidden>▲</span>
			</button>
			<button
				type="button"
				tabIndex={-1}
				aria-label={decrementLabel}
				disabled={disabled}
				onClick={onDecrement}
				className={buttonClassName}
			>
				<span aria-hidden>▼</span>
			</button>
		</div>
	);
}

export {
	Input,
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
	InputStepper,
	fieldStateClassName,
	type InputStatus,
};
