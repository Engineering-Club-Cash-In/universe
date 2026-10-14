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
import type * as React from "react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { client, orpc } from "@/utils/orpc";
import {
	BitacoraJuridicoCaso,
	MOTIVOS_JURIDICO,
	type MotivoJuridico,
	SolicitudCasoTarjeta,
	useSolicitudesDelCaso,
	vistaDeJuridico,
} from "../solicitudes-caso";
import { SolicitudAbiertaPaso } from "./rebaja-mora";

export type EscaladaJuridico = {
	motivo: string;
	nota: string;
	bucket: string;
};

export function EscalarJuridicoForm({
	casoCobroId,
	onCancelar,
	onExito,
	extra,
}: {
	casoCobroId: string;
	onCancelar: () => void;
	onExito: (r: EscaladaJuridico) => void;
	/** Al final del cuerpo con scroll (las solicitudes anteriores). */
	extra?: React.ReactNode;
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
			queryClient.invalidateQueries({
				queryKey: orpc.getSolicitudesJuridicoDelCaso.key(),
			});
			toast.success("Solicitud enviada al supervisor");
			onExito({
				motivo:
					MOTIVOS_JURIDICO.find((m) => m.valor === motivo)?.etiqueta ?? "",
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
						{MOTIVOS_JURIDICO.map((m) => (
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
				{extra}
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

/**
 * El paso «Escalar a Jurídico» del Workspace: la solicitud abierta (con
 * «Cancelar solicitud» si sigue pendiente y la pidió el usuario) o el
 * formulario, y las solicitudes anteriores del caso.
 */
export function EscalarJuridicoPaso({
	casoCobroId,
	onCancelar,
	onExito,
}: {
	casoCobroId: string;
	onCancelar: () => void;
	onExito: (r: EscaladaJuridico) => void;
}) {
	const s = useSolicitudesDelCaso(casoCobroId);
	const abierta = s.juridicoAbierta;
	if (!abierta) {
		return (
			<EscalarJuridicoForm
				casoCobroId={casoCobroId}
				onCancelar={onCancelar}
				onExito={onExito}
				extra={
					<BitacoraJuridicoCaso
						casoCobroId={casoCobroId}
						soloCerradas
						ocultarSiVacia
						className="pt-2"
					/>
				}
			/>
		);
	}
	const vista = vistaDeJuridico(abierta, s.userId);
	return (
		<SolicitudAbiertaPaso
			tarjeta={
				<SolicitudCasoTarjeta
					solicitud={vista}
					cancelando={s.cancelandoId === vista.id}
					onCancelar={() => s.cancelar("juridico", vista.id)}
				/>
			}
			bitacora={
				<BitacoraJuridicoCaso
					casoCobroId={casoCobroId}
					soloCerradas
					ocultarSiVacia
				/>
			}
			aviso="Este caso ya tiene una solicitud a Jurídico abierta. Para pedir otra, cancélela o espere la decisión del supervisor."
			accion="Escalar a Jurídico"
			onVolver={onCancelar}
		/>
	);
}
