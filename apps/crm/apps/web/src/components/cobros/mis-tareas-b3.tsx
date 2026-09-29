import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, PhoneCall } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { orpc } from "@/utils/orpc";

/**
 * CB-035 — "Mis tareas" del supervisor: las tareas de llamada por ingreso a B3
 * que tiene abiertas. El supervisor no tiene agenda propia, así que esta
 * sección vive DENTRO de la tarjeta de la Cola del día (no como tarjeta
 * aparte), debajo de los filtros. Se alimenta de `getMisTareasCobros`
 * (solo la DB del CRM), por lo que se ve aunque cartera-back esté caído y la
 * cola falle. Se oculta si no hay tareas.
 */

type EstadoPlazo = "vencida" | "vence_hoy" | "en_plazo";

type TareaB3 = {
	id: string;
	casoId: string | null;
	numeroCreditoSifco: string | null;
	titulo: string;
	descripcion: string | null;
	fechaVencimiento: Date | string | null;
	estadoPlazo: EstadoPlazo;
};

function fechaCorta(v: Date | string | null): string {
	if (!v) return "—";
	return new Date(v).toLocaleDateString("es-GT", {
		day: "2-digit",
		month: "2-digit",
		timeZone: "America/Guatemala",
	});
}

function BadgePlazo({ tarea }: { tarea: TareaB3 }) {
	if (tarea.estadoPlazo === "vencida") {
		return (
			<Badge className="bg-red-600 text-white hover:bg-red-600">
				Vencida · {fechaCorta(tarea.fechaVencimiento)}
			</Badge>
		);
	}
	if (tarea.estadoPlazo === "vence_hoy") {
		return (
			<Badge className="bg-amber-500 text-white hover:bg-amber-500">
				Vence hoy
			</Badge>
		);
	}
	return (
		<Badge variant="secondary">
			Vence {fechaCorta(tarea.fechaVencimiento)}
		</Badge>
	);
}

export function MisTareasB3({
	onVerCaso,
}: {
	/** Abre la Ficha 360 del crédito (la ruta de detalle usa el SIFCO). */
	onVerCaso: (sifco: string) => void;
}) {
	const [abierto, setAbierto] = useState(true);
	const { data } = useQuery({
		...orpc.getMisTareasCobros.queryOptions(),
		// Las tareas se cierran al registrar una llamada, o las crea el job de las
		// 8:00: refrescar sin recargar la página.
		refetchInterval: 60_000,
	});

	const tareas = (data?.tareas ?? []) as TareaB3[];
	if (tareas.length === 0) return null;
	// El servidor topa la lista; `total` es el real (puede ser mayor).
	const total = Math.max(data?.total ?? 0, tareas.length);

	const vencidas = tareas.filter((t) => t.estadoPlazo === "vencida").length;

	return (
		<section className="mt-4 border-t pt-3">
			<button
				type="button"
				className="flex w-full items-center justify-between gap-3 text-left"
				onClick={() => setAbierto((v) => !v)}
				aria-expanded={abierto}
			>
				<span className="flex items-center gap-2">
					<span className="flex h-7 w-7 items-center justify-center rounded-md bg-orange-100 text-orange-600 dark:bg-orange-900/40 dark:text-orange-400">
						<PhoneCall className="h-3.5 w-3.5" />
					</span>
					<span className="font-semibold text-sm">Mis tareas</span>
					<Badge variant="secondary">{total}</Badge>
					{vencidas > 0 && (
						<Badge className="bg-red-600 text-white hover:bg-red-600">
							{vencidas} vencida{vencidas === 1 ? "" : "s"}
						</Badge>
					)}
				</span>
				{abierto ? (
					<ChevronDown className="h-4 w-4 text-muted-foreground" />
				) : (
					<ChevronRight className="h-4 w-4 text-muted-foreground" />
				)}
			</button>
			{abierto && (
				<div className="mt-3 space-y-2">
					{tareas.map((t) => (
						<div
							key={t.id}
							className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/30 p-3"
						>
							<div className="min-w-0 flex-1">
								<p className="font-medium text-sm">{t.titulo}</p>
								{t.descripcion && (
									<p className="mt-0.5 text-muted-foreground text-xs">
										{t.descripcion}
									</p>
								)}
							</div>
							<div className="flex shrink-0 items-center gap-2">
								<BadgePlazo tarea={t} />
								{t.numeroCreditoSifco && (
									<Button
										size="sm"
										variant="outline"
										className="h-7 text-xs"
										onClick={() => onVerCaso(t.numeroCreditoSifco as string)}
									>
										Ver caso
									</Button>
								)}
							</div>
						</div>
					))}
					{total > tareas.length && (
						<p className="text-muted-foreground text-xs">
							Mostrando las {tareas.length} más urgentes de {total} tareas.
						</p>
					)}
				</div>
			)}
		</section>
	);
}
