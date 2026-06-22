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
	const parts = clean.split(".");
	const intPart = parts[0] ?? "";
	const hasDecimal = parts.length > 1;
	const decPart = hasDecimal ? parts.slice(1).join("").slice(0, 2) : null;
	const normalized = decPart !== null ? `${intPart}.${decPart}` : intPart;
	return { normalized, intPart, decPart };
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
			<span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground text-sm">
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
					const n = Number(value);
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
