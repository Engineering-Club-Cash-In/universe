import { X } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef } from "react";

/**
 * Ventana flotante. No usa `<dialog>` nativo: en modo modal queda por encima
 * de todo, incluidos los toasts, que se verían detrás del fondo.
 * `onCerrar` debe ser estable (useCallback).
 */
export function Ventana({
	abierta,
	onCerrar,
	titulo,
	subtitulo,
	children,
}: {
	abierta: boolean;
	onCerrar: () => void;
	titulo: string;
	subtitulo?: string;
	children: ReactNode;
}) {
	const idTitulo = useId();
	const cerrarRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		if (!abierta) return;
		const previo = document.activeElement as HTMLElement | null;
		const overflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		cerrarRef.current?.focus();
		const alTeclear = (e: KeyboardEvent) => {
			if (e.key === "Escape") onCerrar();
		};
		document.addEventListener("keydown", alTeclear);
		return () => {
			document.removeEventListener("keydown", alTeclear);
			document.body.style.overflow = overflow;
			previo?.focus();
		};
	}, [abierta, onCerrar]);

	if (!abierta) return null;

	return (
		<div
			className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 sm:items-center sm:p-4"
			onMouseDown={(e) => {
				if (e.target === e.currentTarget) onCerrar();
			}}
		>
			<div
				role="dialog"
				aria-modal="true"
				aria-labelledby={idTitulo}
				className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl"
			>
				<div className="flex items-start justify-between gap-3 border-slate-100 border-b px-5 py-4">
					<div className="min-w-0">
						<h2 id={idTitulo} className="font-semibold text-lg text-slate-900">
							{titulo}
						</h2>
						{subtitulo && (
							<p className="truncate text-slate-500 text-sm">{subtitulo}</p>
						)}
					</div>
					<button
						ref={cerrarRef}
						type="button"
						onClick={onCerrar}
						aria-label="Cerrar"
						className="shrink-0 rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
					>
						<X className="h-5 w-5" />
					</button>
				</div>
				<div className="overflow-y-auto px-5 py-4">{children}</div>
			</div>
		</div>
	);
}
