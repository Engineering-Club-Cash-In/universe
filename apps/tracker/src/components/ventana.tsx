import { X } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef } from "react";
import { cierraSinBoton, destinoDelTab, ENFOCABLES } from "@/lib/ciclo-foco";


/**
 * Ventana flotante. No usa `<dialog>` nativo: en modo modal queda por encima
 * de todo, incluidos los toasts, que se verían detrás del fondo. Por eso el
 * foco se atrapa a mano: con Tab no se llega a la página de atrás.
 * `onCerrar` debe ser estable (useCallback). Con `protegida`, el clic en el
 * fondo y Escape no la cierran: solo la X o los botones de su contenido.
 */
export function Ventana({
	abierta,
	onCerrar,
	titulo,
	subtitulo,
	protegida,
	sinCerrar,
	children,
}: {
	abierta: boolean;
	onCerrar: () => void;
	titulo: string;
	subtitulo?: string;
	protegida?: boolean;
	// Deshabilita la X (p. ej. mientras se guarda algo que no debe perderse).
	sinCerrar?: boolean;
	children: ReactNode;
}) {
	const idTitulo = useId();
	const cerrarRef = useRef<HTMLButtonElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);
	// En una ref para no reiniciar el efecto (y mover el foco) al cambiar.
	const protegidaRef = useRef(protegida);
	protegidaRef.current = protegida;

	useEffect(() => {
		if (!abierta) return;
		const previo = document.activeElement as HTMLElement | null;
		const overflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		// Con la X deshabilitada no puede recibir el foco: entra al panel.
		(cerrarRef.current && !cerrarRef.current.disabled
			? cerrarRef.current
			: panelRef.current
		)?.focus();
		const enfocables = () =>
			Array.from(
				panelRef.current?.querySelectorAll<HTMLElement>(ENFOCABLES) ?? [],
			);
		const alTeclear = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				if (cierraSinBoton(protegidaRef.current)) onCerrar();
				return;
			}
			if (e.key !== "Tab") return;
			const destino = destinoDelTab(
				enfocables(),
				document.activeElement as HTMLElement | null,
				e.shiftKey,
				panelRef.current,
			);
			if (destino) {
				e.preventDefault();
				destino.focus();
			}
		};
		// Si el foco sale por otra vía (lector de pantalla, clic), vuelve adentro.
		// Los toasts quedan fuera de la regla para poder cerrarlos.
		const alEnfocar = (e: FocusEvent) => {
			const destino = e.target as HTMLElement | null;
			if (
				!destino ||
				panelRef.current?.contains(destino) ||
				destino.closest("[data-sonner-toaster]")
			)
				return;
			(enfocables()[0] ?? panelRef.current)?.focus();
		};
		document.addEventListener("keydown", alTeclear);
		document.addEventListener("focusin", alEnfocar);
		return () => {
			document.removeEventListener("keydown", alTeclear);
			document.removeEventListener("focusin", alEnfocar);
			document.body.style.overflow = overflow;
			previo?.focus();
		};
	}, [abierta, onCerrar]);

	if (!abierta) return null;

	return (
		<div
			className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 sm:items-center sm:p-4"
			onMouseDown={(e) => {
				if (e.target === e.currentTarget && cierraSinBoton(protegida)) {
					onCerrar();
				}
			}}
		>
			<div
				ref={panelRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby={idTitulo}
				// -1: recibe el foco por código cuando no hay nada enfocable, pero
				// no entra en el orden de Tab (ENFOCABLES lo excluye).
				tabIndex={-1}
				className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-t-2xl bg-white shadow-xl outline-none sm:rounded-2xl"
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
						disabled={sinCerrar}
						aria-label="Cerrar"
						className="shrink-0 rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 disabled:opacity-40"
					>
						<X className="h-5 w-5" />
					</button>
				</div>
				<div className="overflow-y-auto px-5 py-4">{children}</div>
			</div>
		</div>
	);
}
