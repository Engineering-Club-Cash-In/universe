import type * as React from "react";
import { useEffect, useState } from "react";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
	type InputStatus,
	InputStepper,
} from "@/components/ui/input";

/**
 * CurrencyInput — monto en quetzales. Figma "02 · Componentes › Inputs" ›
 * Input/Variants › Tipo=Number (80:906): misma caja que Input/Text, valor con
 * separadores ("15,000.00") y el stepper ▲▼ a la derecha (prop `step`).
 *
 * Props (además de las de un <input>; `className` va al <input>):
 *   value / onChange → string normalizado ("15000.50"); el input muestra "15,000.50".
 *   symbol           → prefijo en text/secondary (default "Q"; "" lo quita, como en Figma).
 *   step             → muestra el stepper de Figma y activa ↑/↓ del teclado (suma/resta `step`).
 *   status           → Success/Error de Figma; error también con `aria-invalid`.
 *   containerClassName → la caja (ancho, márgenes).
 */
type CurrencyInputProps = Omit<
	React.ComponentProps<"input">,
	"value" | "onChange" | "type" | "inputMode" | "step"
> & {
	value: string;
	onChange: (value: string) => void;
	symbol?: string;
	locale?: string;
	step?: number;
	status?: InputStatus;
	containerClassName?: string;
};

function formatWithSeparators(raw: string, locale: string) {
	if (!raw) return "";
	const [intPart, decPart] = raw.split(".");
	const intFormatted = intPart ? Number(intPart).toLocaleString(locale) : "";
	return decPart !== undefined ? `${intFormatted}.${decPart}` : intFormatted;
}

function sanitize(input: string) {
	const clean = input.replace(/,/g, "").replace(/[^0-9.]/g, "");
	if (!clean) return { normalized: "", intPart: "", decPart: null };
	const parts = clean.split(".");
	const intPart = parts[0] ?? "";
	const hasDecimal = parts.length > 1;
	// decPart conserva "" (punto recién tecleado, sin dígitos aún) para que
	// el display no se coma el punto mientras el usuario sigue escribiendo
	// (Codex, PR #1191 ronda 2: convertir "" a null aquí rompía "12." → "3"
	// porque el display perdía el punto antes de que el usuario pudiera
	// escribir el decimal). La limpieza para el backend va en normalizeForSubmit.
	const decPart = hasDecimal ? parts.slice(1).join("").slice(0, 2) : null;
	const normalized = decPart !== null ? `${intPart}.${decPart}` : intPart;
	return { normalized, intPart, decPart };
}

// Valor final a enviar (onBlur / submit) — a diferencia de sanitize(), acá sí
// se descarta un punto sin dígitos o una parte entera vacía: "2500." → "2500",
// ".50" → "0.50". Un decimal(12,2) no acepta ninguno de los dos crudos.
// Exportada para que quien envía el formulario (ej. Enter dispara submit sin
// pasar por el onBlur del input) pueda limpiar el valor justo antes de
// mandarlo, sin duplicar esta lógica (Codex, PR #1191, ronda 3).
export function normalizeForSubmit(raw: string) {
	if (!raw) return raw;
	const [intPart, decPart] = raw.split(".");
	if (decPart === undefined) return raw;
	if (decPart === "") return intPart || "0";
	return `${intPart || "0"}.${decPart}`;
}

export function CurrencyInput({
	value,
	onChange,
	symbol = "Q",
	locale = "es-GT",
	step,
	status,
	containerClassName,
	onKeyDown,
	...props
}: CurrencyInputProps) {
	const [display, setDisplay] = useState(() =>
		value
			? new Intl.NumberFormat(locale, {
					minimumFractionDigits: 2,
					maximumFractionDigits: 2,
				}).format(Number(value))
			: "",
	);

	useEffect(() => {
		if (!value) {
			setDisplay("");
			return;
		}
		const rawDisplay = display.replace(/,/g, "");
		if (rawDisplay !== value) {
			setDisplay(formatWithSeparators(value, locale));
		}
	}, [value, locale, display]);

	// Stepper de Figma: suma/resta `step` al monto (nunca por debajo de 0) y lo
	// deja formateado con dos decimales, igual que al salir del campo.
	const stepBy = (direction: 1 | -1) => {
		if (!step || props.disabled || props.readOnly) return;
		const current = Number(normalizeForSubmit(value) || "0");
		if (Number.isNaN(current)) return;
		const next = Math.max(
			0,
			Math.round((current + direction * step) * 100) / 100,
		);
		const nextValue = next.toFixed(2);
		onChange(nextValue);
		setDisplay(
			new Intl.NumberFormat(locale, {
				minimumFractionDigits: 2,
				maximumFractionDigits: 2,
			}).format(next),
		);
	};

	return (
		<InputGroup status={status} className={containerClassName}>
			{symbol ? (
				<InputGroupAddon className="text-base text-fg-secondary md:text-sm">
					{symbol}
				</InputGroupAddon>
			) : null}
			<InputGroupInput
				type="text"
				inputMode="decimal"
				placeholder="0.00"
				value={display}
				onKeyDown={(e) => {
					onKeyDown?.(e);
					if (!step || e.defaultPrevented) return;
					if (e.key === "ArrowUp" || e.key === "ArrowDown") {
						e.preventDefault();
						stepBy(e.key === "ArrowUp" ? 1 : -1);
					}
				}}
				onChange={(e) => {
					const { normalized, intPart, decPart } = sanitize(e.target.value);
					onChange(normalized);
					const intFormatted = intPart
						? Number(intPart).toLocaleString(locale)
						: "";
					setDisplay(
						decPart !== null ? `${intFormatted}.${decPart}` : intFormatted,
					);
				}}
				onBlur={() => {
					if (!value) {
						setDisplay("");
						return;
					}
					// Recién al perder foco se descarta un punto colgante o una
					// parte entera vacía — mientras el usuario escribe, sanitize()
					// los conserva para no comerse el punto que acaba de teclear
					// (Codex, PR #1191 ronda 2).
					const cleaned = normalizeForSubmit(value);
					if (cleaned !== value) onChange(cleaned);
					const n = Number(cleaned);
					if (Number.isNaN(n)) return;
					setDisplay(
						new Intl.NumberFormat(locale, {
							minimumFractionDigits: 2,
							maximumFractionDigits: 2,
						}).format(n),
					);
				}}
				{...props}
			/>
			{step ? (
				<InputStepper
					onIncrement={() => stepBy(1)}
					onDecrement={() => stepBy(-1)}
					disabled={props.disabled || props.readOnly}
				/>
			) : null}
		</InputGroup>
	);
}
