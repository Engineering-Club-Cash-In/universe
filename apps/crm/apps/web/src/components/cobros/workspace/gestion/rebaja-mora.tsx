/**
 * Workspace · panel de gestión: «Solicitar rebaja de mora» embebido (W2).
 *
 * El asesor pide cuánto de la mora quiere rebajar y por qué; la solicitud
 * (`solicitarRebajaMora`) queda pendiente hasta que el supervisor la decide.
 * El servidor valida que el monto no pase de la mora vigente y que no haya
 * otra solicitud abierta en el caso.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatoQuetzales } from "@/lib/cobros/reglas-caso";
import { client, orpc } from "@/utils/orpc";

export type RebajaSolicitada = {
	monto: number;
	moraSnapshot: string;
	notas: string;
};

const MONTO_VALIDO = /^\d+(\.\d{1,2})?$/;

export function RebajaMoraForm({
	casoCobroId,
	moraActual,
	onCancelar,
	onExito,
}: {
	casoCobroId: string;
	/** Mora acumulada del caso: tope del monto. */
	moraActual: number;
	onCancelar: () => void;
	onExito: (r: RebajaSolicitada) => void;
}) {
	const [monto, setMonto] = useState("");
	const [notas, setNotas] = useState("");

	const queryClient = useQueryClient();
	const solicitar = useMutation({
		mutationFn: () =>
			client.solicitarRebajaMora({
				casoCobroId,
				monto: monto.trim(),
				notas: notas.trim(),
			}),
		onSuccess: (r) => {
			queryClient.invalidateQueries({
				queryKey: orpc.getSolicitudesRebajaMora.key(),
			});
			toast.success("Solicitud de rebaja enviada al supervisor");
			onExito({
				monto: Number(r.montoSolicitado),
				moraSnapshot: r.moraSnapshot,
				notas: notas.trim(),
			});
		},
		onError: (error: Error) => {
			toast.error(error.message || "No se pudo enviar la solicitud de rebaja");
		},
	});

	const montoNumero = Number(monto);
	const montoValido =
		MONTO_VALIDO.test(monto.trim()) &&
		montoNumero > 0 &&
		montoNumero <= moraActual;
	const notasValidas = notas.trim().length >= 10;

	return (
		<div className="@container flex min-h-0 flex-1 flex-col">
			<div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
				<p className="text-fg-secondary text-sm leading-snug">
					La mora acumulada es{" "}
					<strong className="text-fg">{formatoQuetzales(moraActual)}</strong>.
					La rebaja se aplica solo si el supervisor la aprueba.
				</p>
				<div className="space-y-2">
					<Label htmlFor="ws-rebaja-monto">
						Monto a rebajar (Q) <span className="text-danger-text">*</span>
					</Label>
					<Input
						id="ws-rebaja-monto"
						inputMode="decimal"
						value={monto}
						onChange={(e) => setMonto(e.target.value)}
						placeholder="0.00"
					/>
					{monto.trim() !== "" && !montoValido ? (
						<p className="text-danger-text text-xs">
							Ingrese un monto mayor que cero, con hasta dos decimales y que no
							pase de la mora ({formatoQuetzales(moraActual)}).
						</p>
					) : null}
				</div>
				<div className="space-y-2">
					<Label htmlFor="ws-rebaja-notas">
						Motivo <span className="text-danger-text">*</span>
					</Label>
					<Textarea
						id="ws-rebaja-notas"
						value={notas}
						onChange={(e) => setNotas(e.target.value)}
						placeholder="Por qué se pide la rebaja (mínimo 10 caracteres)"
						rows={3}
						maxLength={1000}
					/>
				</div>
			</div>
			<div className="mt-auto flex gap-2 border-line-subtle border-t pt-3">
				<Button
					type="button"
					variant="outline"
					onClick={onCancelar}
					disabled={solicitar.isPending}
				>
					Cancelar
				</Button>
				<Button
					type="button"
					className="flex-1"
					disabled={!montoValido || !notasValidas || solicitar.isPending}
					onClick={() => solicitar.mutate()}
				>
					{solicitar.isPending ? (
						<>
							<Loader2 aria-hidden className="animate-spin" />
							Enviando…
						</>
					) : (
						"Solicitar rebaja"
					)}
				</Button>
			</div>
		</div>
	);
}
