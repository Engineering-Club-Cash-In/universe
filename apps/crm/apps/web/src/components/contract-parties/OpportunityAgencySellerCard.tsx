import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Store } from "lucide-react";
import { toast } from "sonner";
import { Combobox } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import { client, orpc } from "@/utils/orpc";

/**
 * Vendedor de la agencia/predio que colocó la oportunidad. No es parte del
 * contrato: define qué usuario del tracker de predios y agencias la ve.
 * Se guarda al elegir, y volver a elegir al que ya está lo quita.
 */
export function OpportunityAgencySellerCard({
	opportunityId,
	companyId,
	disabled,
}: {
	opportunityId: string;
	companyId: string;
	disabled?: boolean;
}) {
	const queryClient = useQueryClient();

	const asignadoQuery = useQuery(
		orpc.getOpportunityAgencySeller.queryOptions({ input: { opportunityId } }),
	);
	const vendedoresQuery = useQuery(
		orpc.getAgencySellers.queryOptions({ input: { companyId } }),
	);

	const asignarMutation = useMutation({
		mutationFn: (sellerId: string | null) =>
			client.setOpportunityAgencySeller({ opportunityId, sellerId }),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: orpc.getOpportunityAgencySeller.key({
					input: { opportunityId },
				}),
			});
		},
		onError: (error: Error) => {
			toast.error(error.message || "No se pudo asignar el vendedor");
		},
	});

	const asignado = asignadoQuery.data;
	const vendedores = vendedoresQuery.data ?? [];
	const cargando = asignadoQuery.isLoading || vendedoresQuery.isLoading;

	return (
		<div className="space-y-3 rounded-lg border bg-muted/30 p-4">
			<Label className="font-semibold text-muted-foreground text-sm">
				Vendedor de la agencia
			</Label>
			{cargando ? (
				<div className="flex items-center gap-2 text-muted-foreground text-sm">
					<Loader2 className="h-4 w-4 animate-spin" />
					Cargando…
				</div>
			) : vendedores.length === 0 && !asignado ? (
				<p className="text-muted-foreground text-sm">
					Esta agencia no tiene vendedores registrados. Agrégalos en Vendedores
					como "Vendedor de agencia/predio".
				</p>
			) : (
				<>
					{asignado && (
						<div className="flex items-center gap-3">
							<Store className="h-5 w-5 text-muted-foreground" />
							<div>
								<div className="font-medium">{asignado.name}</div>
								{asignado.email && (
									<div className="text-muted-foreground text-xs">
										{asignado.email}
									</div>
								)}
							</div>
						</div>
					)}
					<Combobox
						options={vendedores.map((v) => ({ value: v.id, label: v.name }))}
						value={asignado?.sellerId ?? null}
						// Cadena vacía = se deseleccionó al elegir el mismo de nuevo
						onChange={(value) => asignarMutation.mutate(value || null)}
						placeholder="Buscar vendedor de la agencia"
						width="full"
						disabled={disabled || asignarMutation.isPending}
					/>
					<p className="text-muted-foreground text-xs">
						Solo ese vendedor (y los gerentes de la agencia) verán esta
						oportunidad en el tracker.
					</p>
				</>
			)}
		</div>
	);
}
