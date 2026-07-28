import type * as React from "react";
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type CurrencyInputProps = Omit<
	React.ComponentProps<"input">,
	"value" | "onChange" | "type" | "inputMode"
> & {
	value: string;
	onChange: (value: string) => void;
	symbol?: string;
	locale?: string;
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
// ".50" → "0.50". Un decimal(12,2) no acepta ninguno de los dos crudos
// (Codex, PR #1191).
function normalizeForSubmit(raw: string) {
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
	className,
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

	return (
		<div className="relative">
			<span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
				{symbol}
			</span>
			<Input
				type="text"
				inputMode="decimal"
				placeholder="0.00"
				className={cn("pl-7", className)}
				value={display}
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
		</div>
	);
}
