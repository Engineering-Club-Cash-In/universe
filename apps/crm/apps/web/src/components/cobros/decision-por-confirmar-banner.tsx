/**
 * CB-033 — "Decisión por confirmar": el rechazo pudo haberse confirmado en
 * cartera aunque la respuesta al usuario se haya perdido (timeout, cierre de
 * pestaña). El convenio ya no existe en ese caso, así que este banner es lo
 * único que le permite al supervisor recuperar el resultado real en vez de
 * quedarse sin saber si su decisión se aplicó o no.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	borrarIntentoPendiente,
	type ConvenioDecisionIntento,
	errorPruebaQueNoSeAplico,
} from "@/lib/cobros/decision-intentos";
import { client, orpc } from "@/utils/orpc";

interface DecisionPorConfirmarBannerProps {
	userId: string;
	intentos: ConvenioDecisionIntento[];
	onResuelto: () => void;
}

function FilaIntento({
	userId,
	intento,
	onResuelto,
}: {
	userId: string;
	intento: ConvenioDecisionIntento;
	onResuelto: () => void;
}) {
	const queryClient = useQueryClient();
	const esRechazo = intento.decision === "rechazado";

	const reenviar = useMutation({
		mutationFn: async () =>
			client.decidirConvenio({
				convenioId: intento.convenioId,
				decision: intento.decision,
				motivo: intento.motivo ?? undefined,
				operacionId: intento.operacionId,
			}),
		onSuccess: (r) => {
			// Borrado acotado al `operacionId` de ESTE intento: corre bajo el
			// mismo Web Lock que la reserva, así que una respuesta tardía no
			// puede borrar lo que otra pestaña acaba de reservar.
			void borrarIntentoPendiente(
				userId,
				intento.convenioId,
				intento.operacionId,
			);
			queryClient.invalidateQueries({
				queryKey: orpc.getConveniosListado.key(),
			});
			// El resultado que devuelve cartera es el de la decisión ORIGINAL
			// (respuesta idempotente): es lo que el usuario vino a averiguar.
			const resuelto = r as { decision?: string } | null;
			toast.success(
				resuelto?.decision === "rechazado"
					? "Confirmado: el convenio quedó rechazado (se eliminó y se recalculó la mora)."
					: "Confirmado: el convenio quedó aprobado.",
				{ duration: 6000 },
			);
			onResuelto();
		},
		onError: (error: unknown) => {
			// Igual que en el modal: solo un 4xx prueba que no se aplicó. Ante
			// 5xx/timeout el intento sobrevive para poder reintentar más tarde.
			if (errorPruebaQueNoSeAplico(error)) {
				void borrarIntentoPendiente(
					userId,
					intento.convenioId,
					intento.operacionId,
				);
				onResuelto();
				toast.error(
					(error as { message?: string } | null)?.message ??
						"La decisión no se pudo aplicar.",
					{ duration: 8000 },
				);
				return;
			}
			toast.error(
				"Sigue sin poder confirmarse. Probá de nuevo en unos minutos: el aviso se mantiene.",
				{ duration: 8000 },
			);
		},
	});

	return (
		<div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-sm">
			<span className="text-amber-800">
				Se intentó <strong>{esRechazo ? "rechazar" : "aprobar"}</strong> el
				convenio de{" "}
				{intento.resumen.clienteNombre ?? intento.resumen.numeroCreditoSifco}
				{intento.resumen.montoTotalConvenio && (
					<>
						{" "}
						(Q
						{Number(intento.resumen.montoTotalConvenio).toLocaleString(
							"es-GT",
							{
								minimumFractionDigits: 2,
							},
						)}
						)
					</>
				)}{" "}
				pero no se pudo confirmar el resultado.
			</span>
			<Button
				variant="outline"
				size="sm"
				className="h-7 border-amber-400 bg-amber-100 text-amber-800 hover:bg-amber-200"
				onClick={() => reenviar.mutate()}
				disabled={reenviar.isPending}
			>
				{reenviar.isPending ? (
					<>
						<Loader className="mr-1 h-3.5 w-3.5 animate-spin" />
						Confirmando...
					</>
				) : (
					"Reenviar y ver resultado"
				)}
			</Button>
		</div>
	);
}

export function DecisionPorConfirmarBanner({
	userId,
	intentos,
	onResuelto,
}: DecisionPorConfirmarBannerProps) {
	if (intentos.length === 0) return null;
	return (
		<div className="space-y-2">
			<div className="flex items-center gap-1.5 font-semibold text-amber-800 text-sm">
				<AlertTriangle className="h-4 w-4" />
				Decisiones por confirmar ({intentos.length})
			</div>
			{intentos.map((intento) => (
				<FilaIntento
					key={intento.operacionId}
					userId={userId}
					intento={intento}
					onResuelto={onResuelto}
				/>
			))}
		</div>
	);
}
