/**
 * Workspace · panel de gestión: «Solicitar rebaja de mora» embebido (W2).
 *
 * El asesor pide cuánto de la mora quiere rebajar y por qué; la solicitud
 * (`solicitarRebajaMora`) queda pendiente hasta que el supervisor la decide.
 * El servidor valida que el monto no pase de la mora vigente y que no haya
 * otra solicitud abierta en el caso.
 *
 * `RebajaMoraPaso` es lo que abre el Workspace: con una solicitud abierta
 * muestra esa solicitud (con «Cancelar solicitud» si sigue pendiente y la
 * pidió el usuario) y explica por qué no se puede pedir otra; si no, el
 * formulario. En los dos casos, debajo, la bitácora de rebajas del caso.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import type * as React from "react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatoQuetzales } from "@/lib/cobros/reglas-caso";
import { client, orpc } from "@/utils/orpc";
import {
	BitacoraRebajasCaso,
	SolicitudCasoTarjeta,
	useSolicitudesDelCaso,
	vistaDeRebaja,
} from "../solicitudes-caso";

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
	extra,
}: {
	casoCobroId: string;
	/** Mora acumulada del caso: tope del monto. */
	moraActual: number;
	onCancelar: () => void;
	onExito: (r: RebajaSolicitada) => void;
	/** Al final del cuerpo con scroll (la bitácora del caso). */
	extra?: React.ReactNode;
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
			queryClient.invalidateQueries({
				queryKey: orpc.getSolicitudesRebajaMoraDelCaso.key(),
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

/**
 * El paso «Solicitar rebaja de mora» del Workspace: la solicitud abierta (si
 * hay) o el formulario, y la bitácora de rebajas del caso.
 */
export function RebajaMoraPaso({
	casoCobroId,
	moraActual,
	onCancelar,
	onExito,
}: {
	casoCobroId: string;
	moraActual: number;
	/** «Volver» / «Cancelar». */
	onCancelar: () => void;
	onExito: (r: RebajaSolicitada) => void;
}) {
	const s = useSolicitudesDelCaso(casoCobroId);
	const abierta = s.rebajaAbierta;
	if (!abierta) {
		return (
			<RebajaMoraForm
				casoCobroId={casoCobroId}
				moraActual={moraActual}
				onCancelar={onCancelar}
				onExito={onExito}
				extra={
					<BitacoraRebajasCaso
						casoCobroId={casoCobroId}
						soloCerradas
						ocultarSiVacia
						className="pt-2"
					/>
				}
			/>
		);
	}
	const vista = vistaDeRebaja(abierta, s.userId);
	return (
		<SolicitudAbiertaPaso
			tarjeta={
				<SolicitudCasoTarjeta
					solicitud={vista}
					cancelando={s.cancelandoId === vista.id}
					onCancelar={() => s.cancelar("rebaja", vista.id)}
				/>
			}
			bitacora={
				<BitacoraRebajasCaso
					casoCobroId={casoCobroId}
					soloCerradas
					ocultarSiVacia
				/>
			}
			aviso="Este caso ya tiene una solicitud de rebaja abierta. Para pedir otra, cancélela o espere la decisión del supervisor."
			accion="Solicitar rebaja"
			onVolver={onCancelar}
		/>
	);
}

/**
 * Armazón de un paso con una solicitud abierta: la tarjeta y la bitácora en
 * el cuerpo; en el pie, por qué no se puede pedir otra, «Volver» y la acción
 * principal deshabilitada (mismo pie que el formulario).
 */
export function SolicitudAbiertaPaso({
	tarjeta,
	bitacora,
	aviso,
	accion,
	onVolver,
}: {
	tarjeta: React.ReactNode;
	bitacora?: React.ReactNode;
	aviso: string;
	/** Etiqueta del botón de pedir (deshabilitado). */
	accion: string;
	onVolver: () => void;
}) {
	return (
		<div className="@container flex min-h-0 flex-1 flex-col">
			<div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
				{tarjeta}
				{bitacora}
			</div>
			<div className="mt-auto flex flex-col gap-2 border-line-subtle border-t pt-3">
				<p
					id="ws-solicitud-abierta-aviso"
					className="wrap-break-word text-fg-secondary text-xs leading-snug"
				>
					{aviso}
				</p>
				<div className="flex gap-2">
					<Button type="button" variant="outline" onClick={onVolver}>
						Volver
					</Button>
					<Button
						type="button"
						className="flex-1"
						disabled
						aria-describedby="ws-solicitud-abierta-aviso"
					>
						{accion}
					</Button>
				</div>
			</div>
		</div>
	);
}
