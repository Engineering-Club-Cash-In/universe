/**
 * Alertas del caso · W5. Lo comparten el Workspace (`contexto-caso.tsx`) y la
 * Ficha 360 (`routes/cobros/$id.tsx`):
 *  - `useMarcarAlertaLeida`: `marcarAlertaCasoLeida` (marca el grupo entero) y
 *    refresca las alertas abiertas y las leídas.
 *  - `VerAlertasLeidas`: botón + diálogo con `getAlertasLeidasCaso` (fecha y
 *    quién la leyó; «Automático (más de 30 días)» si fue el job).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { fechaLargaGT } from "@/lib/cobros/reglas-caso";
import { client, orpc } from "@/utils/orpc";

/** El Workspace antepone `alerta-` al id; el servidor espera el id crudo. */
export function idCrudoDeAlerta(id: string): string {
	return id.replace(/^alerta-/, "");
}

export function useMarcarAlertaLeida(casoCobroId: string | null | undefined) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (alertaId: string) =>
			client.marcarAlertaCasoLeida({
				casoCobroId: casoCobroId ?? "",
				alertaId: idCrudoDeAlerta(alertaId),
			}),
		onSuccess: () => {
			toast.success("Alerta marcada como leída");
		},
		onError: (error: Error) => {
			toast.error(error.message || "No se pudo marcar la alerta como leída");
		},
		// También si el servidor responde que ya no estaba abierta (NOT_FOUND):
		// refrescar deja la lista como está en el servidor.
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: orpc.getAlertasCaso.key() });
			queryClient.invalidateQueries({
				queryKey: orpc.getAlertasLeidasCaso.key(),
			});
		},
	});
}

export function VerAlertasLeidas({
	casoCobroId,
}: {
	casoCobroId: string | null | undefined;
}) {
	const [abierto, setAbierto] = React.useState(false);
	const leidas = useQuery({
		...orpc.getAlertasLeidasCaso.queryOptions({
			input: { casoCobroId: casoCobroId ?? "" },
		}),
		enabled: abierto && !!casoCobroId,
	});
	return (
		<>
			<Button
				type="button"
				variant="text"
				size="sm"
				disabled={!casoCobroId}
				onClick={() => setAbierto(true)}
				className="h-auto px-0"
			>
				Ver alertas leídas
			</Button>
			<Dialog open={abierto} onOpenChange={setAbierto}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Alertas leídas</DialogTitle>
						<DialogDescription>
							Alertas de este caso que ya se marcaron como leídas.
						</DialogDescription>
					</DialogHeader>
					{leidas.isLoading ? (
						<div className="flex items-center gap-2 text-fg-secondary text-sm">
							<Loader2 aria-hidden className="size-4 animate-spin" />
							Cargando…
						</div>
					) : leidas.isError ? (
						<p className="text-danger-text text-sm">
							No se pudieron cargar las alertas leídas.
						</p>
					) : (leidas.data ?? []).length === 0 ? (
						<p className="text-fg-secondary text-sm">
							Este caso no tiene alertas leídas.
						</p>
					) : (
						<ul className="flex max-h-80 flex-col divide-y divide-line-subtle overflow-y-auto">
							{(leidas.data ?? []).map((a) => (
								<li key={a.id} className="flex flex-col gap-0.5 py-2">
									<span className="wrap-break-word font-semibold text-[13px] text-fg leading-[1.26]">
										{a.titulo}
									</span>
									{a.descripcion ? (
										<span className="wrap-break-word text-fg-secondary text-xs leading-snug">
											{a.descripcion}
										</span>
									) : null}
									<span className="text-fg-tertiary text-xs">
										Leída el {fechaLargaGT(a.leidaEn)}
										{a.leidaPor ? ` · ${a.leidaPor}` : ""}
									</span>
								</li>
							))}
						</ul>
					)}
				</DialogContent>
			</Dialog>
		</>
	);
}
