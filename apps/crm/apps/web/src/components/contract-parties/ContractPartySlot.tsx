import { AlertCircle, CheckCircle2, Circle, Plus } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ContractPartyStatus =
	| { tipo: "vacio" }
	| { tipo: "incompleto"; falta: string }
	| { tipo: "completo" };

/** DPI agrupado como aparece impreso en el documento: 4-5-4. */
export function formatDpiGrupos(dpi: string): string {
	const d = dpi.replace(/\D/g, "");
	if (d.length !== 13) return dpi;
	return `${d.slice(0, 4)} ${d.slice(4, 9)} ${d.slice(9)}`;
}

function StatusPill({ status }: { status: ContractPartyStatus }) {
	if (status.tipo === "completo") {
		return (
			<span className="inline-flex items-center gap-1 text-emerald-700 text-xs dark:text-emerald-400">
				<CheckCircle2 className="h-3.5 w-3.5" />
				Listo para contratos
			</span>
		);
	}
	if (status.tipo === "incompleto") {
		return (
			<span className="inline-flex items-center gap-1 text-amber-700 text-xs dark:text-amber-400">
				<AlertCircle className="h-3.5 w-3.5" />
				{status.falta}
			</span>
		);
	}
	return (
		<span className="inline-flex items-center gap-1 text-muted-foreground text-xs">
			<Circle className="h-3.5 w-3.5" />
			Sin asignar
		</span>
	);
}

/** Dato en línea: etiqueta tenue y valor, para una ficha compacta. */
export function PartyField({
	label,
	children,
}: {
	label: string;
	children: ReactNode;
}) {
	return (
		<span className="whitespace-nowrap">
			<span className="text-muted-foreground">{label} </span>
			{children}
		</span>
	);
}

/** Fila de datos de la ficha; se parte en líneas solo si no cabe. */
export function PartyFields({ children }: { children: ReactNode }) {
	return (
		<div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">{children}</div>
	);
}

/**
 * Ficha de una parte del contrato (vendedor o agencia). Vacía muestra el
 * selector y "Nuevo"; asignada muestra la ficha con "Cambiar", y lo que falte
 * se resuelve dentro de la misma ficha (children).
 */
export function ContractPartySlot({
	titulo,
	status,
	seleccionado,
	selector,
	onNuevo,
	nuevoLabel,
	ayudaVacio,
	disabled,
	className,
	children,
}: {
	titulo: string;
	status: ContractPartyStatus;
	/** Identidad y nombre visible de lo asignado; null si no hay. */
	seleccionado: { id: string; nombre: string } | null;
	selector: ReactNode;
	onNuevo: () => void;
	nuevoLabel: string;
	ayudaVacio: string;
	disabled?: boolean;
	className?: string;
	children?: ReactNode;
}) {
	const [cambiando, setCambiando] = useState(false);

	// Al elegir o crear otro, vuelve a la ficha
	// biome-ignore lint/correctness/useExhaustiveDependencies: depende solo del id
	useEffect(() => {
		setCambiando(false);
	}, [seleccionado?.id]);

	const mostrarSelector = !seleccionado || cambiando;

	return (
		<section className={cn("rounded-lg border bg-background", className)}>
			<header className="flex items-center justify-between gap-2 border-b px-3 py-1.5">
				<h4 className="font-medium text-sm">{titulo}</h4>
				<StatusPill status={status} />
			</header>

			<div className="p-3">
				{mostrarSelector ? (
					<div className="space-y-2">
						<div className="flex gap-2">
							<div className="min-w-0 flex-1">{selector}</div>
							{!disabled && (
								<Button
									type="button"
									variant="outline"
									onClick={onNuevo}
									className="shrink-0"
								>
									<Plus className="mr-1 h-4 w-4" />
									{nuevoLabel}
								</Button>
							)}
						</div>
						{seleccionado ? (
							<button
								type="button"
								className="text-muted-foreground text-xs hover:text-foreground hover:underline"
								onClick={() => setCambiando(false)}
							>
								Mantener {seleccionado.nombre}
							</button>
						) : (
							<p className="text-muted-foreground text-xs">{ayudaVacio}</p>
						)}
					</div>
				) : (
					<div className="space-y-1.5">
						<div className="flex items-start justify-between gap-2">
							<p className="break-words font-medium text-sm leading-snug">
								{seleccionado.nombre}
							</p>
							{!disabled && (
								<Button
									type="button"
									variant="ghost"
									size="sm"
									className="-my-1 h-7 shrink-0 px-2 text-xs"
									onClick={() => setCambiando(true)}
								>
									Cambiar
								</Button>
							)}
						</div>
						{children}
					</div>
				)}
			</div>
		</section>
	);
}
