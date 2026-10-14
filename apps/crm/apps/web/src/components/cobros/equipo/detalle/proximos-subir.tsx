import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { type Bucket, BucketBadge } from "@/components/ds/badges";
import { formatearQuetzales } from "@/components/ds/table-cells";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * Créditos detrás del contador «próximos a subir de bucket» del Detalle del
 * asesor (M2, `getProximosSubirBucket`). La Cartera general no tiene un filtro
 * con esta regla, así que la lista se muestra aquí: B1 a B4 cuya siguiente
 * cuota vence en 7 días o menos y sin promesa vigente, la más urgente primero.
 * Cada fila abre el caso en el Workspace (con la lista navegable).
 * Presentación pura: el contenedor pasa los datos y abre el Workspace.
 */

export type CreditoProximoSubir = {
	sifco: string;
	cliente: string;
	bucketActual: number;
	bucketSiguiente: number;
	diasParaVencer: number;
	/** YYYY-MM-DD de la cuota que lo haría subir. */
	fechaVencimiento: string;
	montoCuota: number;
	montoMora: number;
};

/** Filas visibles por tanda (la lista puede pasar de 400). */
const POR_TANDA = 50;

const formatoEntero = new Intl.NumberFormat("es-GT");

function bucket(n: number): Bucket {
	return `B${Math.min(5, Math.max(0, n))}` as Bucket;
}

/** «2026-10-16» → «16 oct 2026» (día calendario de Guatemala). */
function fecha(iso: string) {
	const [y, m, d] = iso.split("-").map(Number);
	if (!y || !m || !d) return iso;
	return new Date(y, m - 1, d)
		.toLocaleDateString("es-GT", {
			day: "numeric",
			month: "short",
			year: "numeric",
		})
		.replace(".", "");
}

function vence(dias: number) {
	if (dias <= 0) return "Vence hoy";
	if (dias === 1) return "Vence mañana";
	return `Vence en ${dias} días`;
}

export function ProximosSubirDialog({
	open,
	onOpenChange,
	nombre,
	items,
	ventanaDias,
	onAbrir,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Nombre del asesor. */
	nombre: string;
	items: CreditoProximoSubir[];
	ventanaDias: number;
	/** Abre el caso `indice` de `items` (el contenedor cierra el diálogo). */
	onAbrir: (indice: number) => void;
}) {
	const [visibles, setVisibles] = useState(POR_TANDA);
	const porBucket = new Map<number, number>();
	for (const i of items)
		porBucket.set(i.bucketActual, (porBucket.get(i.bucketActual) ?? 0) + 1);

	return (
		<Dialog
			open={open}
			onOpenChange={(o) => {
				if (!o) setVisibles(POR_TANDA);
				onOpenChange(o);
			}}
		>
			<DialogContent className="sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>Próximos a subir de bucket</DialogTitle>
					<DialogDescription>
						Créditos de {nombre} cuya siguiente cuota vence en {ventanaDias}{" "}
						días o menos y que no tienen una promesa vigente: si no pagan, suben
						al bucket siguiente. La más urgente primero.
					</DialogDescription>
				</DialogHeader>

				{items.length === 0 ? (
					<EmptyState
						size="sm"
						variant="empty"
						title="Sin créditos por subir"
						description="Ningún crédito de este asesor está a punto de subir de bucket."
					/>
				) : (
					<div className="flex min-w-0 flex-col gap-3">
						<ul className="flex flex-wrap gap-2" aria-label="Por bucket">
							{[...porBucket]
								.sort(([a], [b]) => a - b)
								.map(([b, n]) => (
									<li
										key={b}
										className="type-caption inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-fg-secondary"
									>
										{bucket(b)}
										<ArrowRight aria-hidden className="size-3" />
										{bucket(b + 1)}
										<span className="font-semibold text-fg tabular-nums">
											{formatoEntero.format(n)}
										</span>
									</li>
								))}
						</ul>
						<ul className="-mx-2 flex max-h-[min(60vh,480px)] flex-col divide-y divide-divider overflow-y-auto">
							{items.slice(0, visibles).map((c, i) => (
								<li key={c.sifco}>
									<button
										type="button"
										onClick={() => onAbrir(i)}
										className="flex w-full cursor-pointer flex-col gap-1.5 rounded-lg px-2 py-2.5 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring sm:flex-row sm:items-center sm:gap-3"
									>
										<span className="flex min-w-0 flex-1 flex-col gap-0.5">
											<span className="wrap-break-word font-medium text-fg text-sm leading-[1.26]">
												{c.cliente}
											</span>
											<span className="type-caption text-fg-tertiary">
												Crédito{" "}
												<span className="whitespace-nowrap">{c.sifco}</span>
											</span>
										</span>
										<span className="flex shrink-0 items-center gap-1.5">
											<BucketBadge bucket={bucket(c.bucketActual)} />
											<ArrowRight
												aria-hidden
												className="size-3.5 text-fg-tertiary"
											/>
											<BucketBadge bucket={bucket(c.bucketSiguiente)} />
										</span>
										<span className="flex shrink-0 flex-col gap-0.5 sm:w-52 sm:text-right">
											<span
												className={
													c.diasParaVencer <= 1
														? "type-label-sm text-danger-text"
														: "type-label-sm text-warning-text"
												}
											>
												{vence(c.diasParaVencer)} · {fecha(c.fechaVencimiento)}
											</span>
											<span className="type-caption text-fg-tertiary">
												<span className="whitespace-nowrap">
													Cuota {formatearQuetzales(c.montoCuota)}
												</span>
												{c.montoMora > 0 ? (
													<>
														{" · "}
														<span className="whitespace-nowrap">
															Mora {formatearQuetzales(c.montoMora)}
														</span>
													</>
												) : null}
											</span>
										</span>
									</button>
								</li>
							))}
						</ul>
						{items.length > visibles ? (
							<Button
								variant="outline"
								size="sm"
								className="self-center"
								onClick={() => setVisibles((v) => v + POR_TANDA)}
							>
								Mostrar más ({formatoEntero.format(items.length - visibles)}{" "}
								restantes)
							</Button>
						) : null}
					</div>
				)}

				<DialogFooter>
					<Button onClick={() => onOpenChange(false)}>Cerrar</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
