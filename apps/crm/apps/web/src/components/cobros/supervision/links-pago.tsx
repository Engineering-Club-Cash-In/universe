import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { Destino } from "./destino";
import { EnlaceVer } from "./tarjeta";

/**
 * «Links de pago» del Dashboard del supervisor (Figma `1954:14`): franja con los
 * links de Págalo pendientes de pago y los vencidos, y «Ver todos →» a la
 * Supervisión Págalo. Presentación pura.
 */

export type LinksPagoProps = {
	/** Grupos esperando el pago (links pendientes, pago pendiente o parcial). */
	pendientes: number | undefined;
	/** Grupos con algún link vencido. */
	vencidos: number | undefined;
	error?: boolean;
	verTodos: Destino;
};

export function LinksPago({
	pendientes,
	vencidos,
	error,
	verTodos,
}: LinksPagoProps) {
	const cargando =
		!error && (pendientes === undefined || vencidos === undefined);
	return (
		<section className="flex flex-col gap-3 rounded-2xl border border-line-subtle bg-surface px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
			<div className="flex min-w-0 flex-col gap-0.5">
				<h2 className="font-semibold text-base text-fg leading-[1.26]">
					Links de pago
				</h2>
				<p className="type-body-sm text-fg-secondary">
					Seguimiento de los links enviados · estado y vencimiento
				</p>
			</div>
			<div className="flex flex-wrap items-center gap-2.5">
				{cargando ? (
					<>
						<Skeleton className="h-7 w-28 rounded-full" />
						<Skeleton className="h-7 w-24 rounded-full" />
					</>
				) : error ? (
					<span className="type-body-sm text-fg-tertiary">
						No se pudo cargar el resumen de Págalo.
					</span>
				) : (
					<>
						<Badge variant="warning" className="px-3.5 py-1.5 text-[13px]">
							{(pendientes ?? 0).toLocaleString("es-GT")} pendientes
						</Badge>
						<Badge variant="danger" className="px-3.5 py-1.5 text-[13px]">
							{(vencidos ?? 0).toLocaleString("es-GT")} vencidos
						</Badge>
					</>
				)}
				<EnlaceVer destino={verTodos} className="px-1.5">
					Ver todos
				</EnlaceVer>
			</div>
		</section>
	);
}
