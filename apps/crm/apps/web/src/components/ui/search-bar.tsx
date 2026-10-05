import { Search, X } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * SearchBar — Figma "03 · Componentes CRM › Cartera › Search Bar" (127:1210); ejemplo en
 * "02 · Componentes › Search Bar". Barra de búsqueda global en pastilla.
 *
 * Figma → código (los estados salen solos del input; la API es la de un <input>):
 *   Estado=Default  → surface + border/default; lupa text/tertiary; atajo "⌘K" si `shortcut`
 *   Estado=Hover    → :hover → surface-raised
 *   Estado=Focus    → :focus-within → borde brand de 2px + Shadow/Clay-Subtle; lupa brand
 *   Estado=ConTexto → con valor → lupa brand y botón limpiar (✕) en lugar del atajo
 * Props extra:
 *   `shortcut`  → muestra el atajo ("⌘K" en Mac, "Ctrl K" en el resto) y lo activa: enfoca la barra.
 *   `onClear`   → se llama al limpiar (además el input dispara `onChange` con "").
 *   `containerClassName` → clases de la pastilla (ancho, márgenes); `className` va al <input>.
 * Medidas: alto 42px (p 12/12/12/16), gap 10, texto 14px, radius/full.
 */

function setNativeValue(input: HTMLInputElement, value: string) {
	// Asigna el valor como lo haría el usuario para que React dispare onChange
	// (sirve igual para inputs controlados y no controlados).
	const setter = Object.getOwnPropertyDescriptor(
		HTMLInputElement.prototype,
		"value",
	)?.set;
	setter?.call(input, value);
	input.dispatchEvent(new Event("input", { bubbles: true }));
}

function isMacPlatform() {
	if (typeof navigator === "undefined") return false;
	return /Mac|iPhone|iPad|iPod/i.test(
		navigator.platform || navigator.userAgent,
	);
}

function SearchBar({
	value,
	defaultValue,
	onChange,
	onClear,
	shortcut = false,
	placeholder = "Buscar cliente, crédito, placa o DPI…",
	disabled,
	className,
	containerClassName,
	ref,
	...props
}: React.ComponentProps<"input"> & {
	onClear?: () => void;
	shortcut?: boolean;
	containerClassName?: string;
}) {
	const innerRef = React.useRef<HTMLInputElement | null>(null);
	const isControlled = value !== undefined;
	const [uncontrolledHasValue, setUncontrolledHasValue] = React.useState(
		() => String(defaultValue ?? "").length > 0,
	);
	const hasValue = isControlled
		? String(value ?? "").length > 0
		: uncontrolledHasValue;

	const setRefs = React.useCallback(
		(node: HTMLInputElement | null) => {
			innerRef.current = node;
			if (typeof ref === "function") ref(node);
			else if (ref) ref.current = node;
		},
		[ref],
	);

	React.useEffect(() => {
		if (!shortcut) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
				event.preventDefault();
				innerRef.current?.focus();
				innerRef.current?.select();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [shortcut]);

	const shortcutLabel = React.useMemo(
		() => (isMacPlatform() ? "⌘K" : "Ctrl K"),
		[],
	);

	const clear = () => {
		const input = innerRef.current;
		if (input) {
			setNativeValue(input, "");
			input.focus();
		}
		onClear?.();
	};

	return (
		// <label>: un clic en cualquier parte de la pastilla enfoca el input.
		<label
			data-slot="search-bar"
			data-filled={hasValue || undefined}
			className={cn(
				"group/search flex h-10.5 w-full cursor-text items-center gap-2.5 rounded-full border border-line bg-surface pr-3 pl-4 transition-[background-color,border-color,box-shadow] duration-150 ease-out",
				"hover:not-focus-within:bg-surface-raised",
				"focus-within:inset-ring-1 focus-within:inset-ring-brand focus-within:border-brand focus-within:shadow-clay-subtle",
				"has-[input:disabled]:pointer-events-none has-[input:disabled]:opacity-40",
				containerClassName,
			)}
		>
			<Search
				aria-hidden
				className="size-4 shrink-0 text-fg-tertiary transition-colors duration-150 group-focus-within/search:text-brand group-data-[filled]/search:text-brand"
			/>
			<input
				ref={setRefs}
				type="search"
				data-slot="search-bar-input"
				value={value}
				defaultValue={defaultValue}
				placeholder={placeholder}
				disabled={disabled}
				onChange={(event) => {
					if (!isControlled)
						setUncontrolledHasValue(event.target.value.length > 0);
					onChange?.(event);
				}}
				className={cn(
					"h-full min-w-0 flex-1 bg-transparent text-fg text-sm leading-[1.26] outline-none placeholder:text-fg-tertiary [&::-webkit-search-cancel-button]:appearance-none",
					className,
				)}
				{...props}
			/>
			{hasValue ? (
				<button
					type="button"
					aria-label="Limpiar búsqueda"
					onClick={clear}
					className="relative inline-flex h-3.5 w-5.5 shrink-0 cursor-pointer items-center justify-center rounded-full bg-muted text-fg-secondary outline-none transition-colors duration-150 after:absolute after:-inset-1.5 hover:bg-line-subtle hover:text-fg focus-visible:ring-2 focus-visible:ring-ring"
				>
					<X aria-hidden className="size-2.5" strokeWidth={2.5} />
				</button>
			) : shortcut ? (
				<kbd className="inline-flex shrink-0 items-center rounded-md border border-line-subtle bg-canvas px-2 py-0.5 font-medium font-sans text-[11px] text-fg-tertiary leading-[1.26]">
					{shortcutLabel}
				</kbd>
			) : null}
		</label>
	);
}

export { SearchBar };
