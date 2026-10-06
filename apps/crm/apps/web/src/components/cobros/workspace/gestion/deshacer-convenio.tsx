/**
 * Workspace · panel de gestión: «Deshacer convenio» embebido.
 *
 * Replica el AlertDialog de la Ficha 360 (`routes/cobros/$id.tsx`, COBROS-02
 * Fase 3): mismos textos, motivo obligatorio de mínimo 5 caracteres y
 * `client.deshacerConvenio({ casoCobroId, motivo })`. El convenio lo resuelve
 * el servidor desde el caso. Al terminar, el Workspace refresca el caso
 * (`caso.refrescar()` invalida lo mismo que la ficha: detalle, bucket, alerta
 * y convenio vigente, plan de pagos) y muestra «Gestión registrada».
 */
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { client } from "@/utils/orpc";

export type ConvenioDeshecho = {
	/** "MOROSO" o "ACTIVO". */
	statusCredito: string | null;
	cuotasAtrasadas: number | null;
	motivo: string;
	/** El mismo texto del toast de la ficha. */
	mensaje: string;
};

type RespuestaDeshacer = {
	status_credito?: string | null;
	cuotas_atrasadas?: number | null;
};

export function DeshacerConvenioForm({
	casoCobroId,
	onCancelar,
	onExito,
}: {
	casoCobroId: string;
	onCancelar: () => void;
	onExito: (r: ConvenioDeshecho) => void;
}) {
	const [motivo, setMotivo] = useState("");

	const deshacer = useMutation({
		mutationFn: () =>
			client.deshacerConvenio({ casoCobroId, motivo: motivo.trim() }),
		onSuccess: (resultado) => {
			const r = resultado as RespuestaDeshacer;
			const mensaje =
				r.status_credito === "MOROSO"
					? `Convenio deshecho. El crédito vuelve a MOROSO con ${r.cuotas_atrasadas} cuota(s) vencida(s) y su mora recalculada.`
					: "Convenio deshecho. El crédito queda ACTIVO: no tiene cuotas vencidas.";
			toast.success(mensaje);
			onExito({
				statusCredito: r.status_credito ?? null,
				cuotasAtrasadas: r.cuotas_atrasadas ?? null,
				motivo: motivo.trim(),
				mensaje,
			});
		},
		onError: (error: Error) => {
			toast.error(error.message || "No se pudo deshacer el convenio");
		},
	});

	const motivoValido = motivo.trim().length >= 5;

	return (
		<div className="@container flex min-h-0 flex-1 flex-col">
			<div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
				<div className="space-y-3 text-fg-secondary text-sm leading-snug">
					<p>
						El acuerdo deja de estar vigente y el crédito vuelve a{" "}
						<strong className="text-fg">MOROSO</strong>, con la mora recalculada
						sobre las cuotas que realmente debe.
					</p>
					<p>
						El convenio <strong className="text-fg">no se borra</strong>: su
						plan de cuotas y los pagos que recibió quedan guardados para
						auditoría.
					</p>
					<p className="text-xs">
						Si además se debe recuperar el vehículo, solicítelo después desde
						«Recuperación del vehículo».
					</p>
				</div>
				<div className="space-y-2">
					<Label htmlFor="ws-motivo-deshacer">
						Motivo <span className="text-danger-text">*</span>
					</Label>
					<Textarea
						id="ws-motivo-deshacer"
						value={motivo}
						onChange={(e) => setMotivo(e.target.value)}
						placeholder="Motivo por el que se deshace el convenio (mínimo 5 caracteres)"
						rows={3}
					/>
				</div>
			</div>
			<div className="mt-auto flex gap-2 border-line-subtle border-t pt-3">
				<Button
					type="button"
					variant="outline"
					onClick={onCancelar}
					disabled={deshacer.isPending}
				>
					Cancelar
				</Button>
				<Button
					type="button"
					variant="destructive"
					className="flex-1"
					disabled={!motivoValido || deshacer.isPending}
					onClick={() => deshacer.mutate()}
				>
					{deshacer.isPending ? (
						<>
							<Loader2 aria-hidden className="animate-spin" />
							Deshaciendo…
						</>
					) : (
						"Deshacer convenio"
					)}
				</Button>
			</div>
		</div>
	);
}
