/**
 * Workspace · panel de gestión: «Escalar a Jurídico» embebido (W3).
 *
 * El asesor indica el motivo y una nota; la solicitud
 * (`solicitarEscalarJuridico`) queda pendiente hasta que el supervisor la
 * decide. Cartera solo la acepta en B3 y B4: el servidor lo valida contra el
 * bucket vigente.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { client, orpc } from "@/utils/orpc";

type MotivoJuridico = "no_contacto" | "no_quiere_pagar" | "sin_acuerdo";

const MOTIVOS: Array<{ valor: MotivoJuridico; etiqueta: string }> = [
	{ valor: "no_contacto", etiqueta: "No hubo contacto con el cliente" },
	{ valor: "no_quiere_pagar", etiqueta: "El cliente no quiere pagar" },
	{ valor: "sin_acuerdo", etiqueta: "No hay acuerdo de pago" },
];

export type EscaladaJuridico = {
	motivo: string;
	nota: string;
	bucket: string;
};

export function EscalarJuridicoForm({
	casoCobroId,
	onCancelar,
	onExito,
}: {
	casoCobroId: string;
	onCancelar: () => void;
	onExito: (r: EscaladaJuridico) => void;
}) {
	const [motivo, setMotivo] = useState<MotivoJuridico | null>(null);
	const [nota, setNota] = useState("");

	const queryClient = useQueryClient();
	const solicitar = useMutation({
		mutationFn: () => {
			if (!motivo) throw new Error("Seleccione el motivo");
			return client.solicitarEscalarJuridico({
				casoCobroId,
				motivo,
				notaJuridico: nota.trim(),
			});
		},
		onSuccess: (r) => {
			queryClient.invalidateQueries({
				queryKey: orpc.getSolicitudesJuridico.key(),
			});
			toast.success("Solicitud enviada al supervisor");
			onExito({
				motivo: MOTIVOS.find((m) => m.valor === motivo)?.etiqueta ?? "",
				nota: nota.trim(),
				bucket: `B${r.bucketSnapshot}`,
			});
		},
		onError: (error: Error) => {
			toast.error(error.message || "No se pudo enviar la solicitud");
		},
	});

	const valido = motivo !== null && nota.trim().length >= 10;

	return (
		<div className="@container flex min-h-0 flex-1 flex-col">
			<div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
				<p className="text-fg-secondary text-sm leading-snug">
					El caso pasa al área legal solo si el supervisor lo aprueba. Cartera
					acepta esta solicitud en los buckets B3 y B4.
				</p>
				<div className="space-y-2">
					<Label>
						Motivo <span className="text-danger-text">*</span>
					</Label>
					<RadioGroup
						value={motivo ?? ""}
						onValueChange={(v) => setMotivo(v as MotivoJuridico)}
					>
						{MOTIVOS.map((m) => (
							<div key={m.valor} className="flex items-center gap-2">
								<RadioGroupItem id={`ws-juridico-${m.valor}`} value={m.valor} />
								<Label
									htmlFor={`ws-juridico-${m.valor}`}
									className="font-normal"
								>
									{m.etiqueta}
								</Label>
							</div>
						))}
					</RadioGroup>
				</div>
				<div className="space-y-2">
					<Label htmlFor="ws-juridico-nota">
						Nota para Jurídico <span className="text-danger-text">*</span>
					</Label>
					<Textarea
						id="ws-juridico-nota"
						value={nota}
						onChange={(e) => setNota(e.target.value)}
						placeholder="Qué se intentó y por qué pasa a Jurídico (mínimo 10 caracteres)"
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
					disabled={!valido || solicitar.isPending}
					onClick={() => solicitar.mutate()}
				>
					{solicitar.isPending ? (
						<>
							<Loader2 aria-hidden className="animate-spin" />
							Enviando…
						</>
					) : (
						"Escalar a Jurídico"
					)}
				</Button>
			</div>
		</div>
	);
}
