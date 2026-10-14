import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { client, orpc, orpcAparte, queryClient } from "@/utils/orpc";
import { coberturaVigente } from "./estado-asesor";
import {
	AsesorReactivadoDialog,
	type CoberturaReactivar,
	ConfirmarReactivarDialog,
	type ResultadoReactivacion,
} from "./reactivar-dialogs";

/**
 * «Reactivar» a un asesor ausente, el mismo flujo en la tarjeta de Mi equipo y
 * en el encabezado del Detalle del asesor:
 *   - cobertura con suplente → `cancelarCobertura`;
 *   - ausencia indefinida con reparto (M5) → `reactivarAsesor` (devuelve la
 *     cartera, vuelve al pool y el servidor avisa al equipo).
 * Devuelve la acción para pedirlo, el asesor que se está reactivando y los dos
 * modales (confirmación y «Asesor reactivado») ya armados.
 */

type CoberturaFuente = {
	id: string;
	titularId: string;
	suplenteId: string;
	motivo: string;
	desde: string;
	hasta: string;
	canceladaEn: unknown;
};

type AusenciaFuente = {
	id: string;
	asesorId: number;
	motivo: string;
	reactivacionIniciadaAt?: unknown;
};

export type AsesorPorReactivar = {
	asesorId: number;
	nombre: string;
	/** Usuario del CRM (titular de la cobertura). */
	userId: string | null;
};

export function useReactivarAsesor({
	coberturas,
	ausencias,
	nombrePorUsuario,
	hoy,
}: {
	/** Coberturas de hoy (`listarCoberturas`). */
	coberturas: readonly CoberturaFuente[];
	/** Ausencias indefinidas vigentes (`listarAusencias`). */
	ausencias: readonly AusenciaFuente[];
	/** Para nombrar al suplente en la confirmación. */
	nombrePorUsuario: ReadonlyMap<string, string>;
	hoy: string;
}) {
	const [porReactivar, setPorReactivar] = useState<{
		asesorId: number;
		/** Cobertura (`cancelarCobertura`) o ausencia indefinida (`reactivarAsesor`). */
		id: string;
		indefinida: boolean;
		datos: CoberturaReactivar;
	} | null>(null);
	const [reactivado, setReactivado] = useState<string | null>(null);
	const [resultado, setResultado] = useState<ResultadoReactivacion | null>(
		null,
	);

	const mutacion = useMutation({
		mutationFn: async (r: { id: string; indefinida: boolean }) => {
			if (!r.indefinida) {
				await client.cancelarCobertura({ id: r.id });
				return null;
			}
			const res = await orpcAparte.reactivarAsesor.call({ id: r.id });
			return {
				devueltas: res.devueltas,
				retenidas: res.retenidas as { motivo: string }[],
			} satisfies ResultadoReactivacion;
		},
		// También tras un fallo: si la respuesta se perdió con la reactivación ya
		// hecha, se vuelve a leer el estado real en lugar de dejar al asesor como
		// ausente (cada reintento recibiría «ya fue reactivado»).
		onSettled: () => {
			for (const queryKey of [
				orpc.listarCoberturas.key(),
				orpcAparte.listarAusencias.key(),
				orpc.getCargaPorAsesorBucket.key(),
				// El pool vuelve: el catálogo cacheado trae al asesor sin buckets.
				orpc.getAsesoresTraslados.key(),
			]) {
				void queryClient.invalidateQueries({ queryKey });
			}
		},
		onSuccess: (res) => {
			setResultado(res);
			setReactivado(porReactivar?.datos.nombre ?? null);
			setPorReactivar(null);
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const pedir = (a: AsesorPorReactivar) => {
		mutacion.reset();
		const indefinida = ausencias.find((x) => x.asesorId === a.asesorId);
		if (indefinida) {
			setPorReactivar({
				asesorId: a.asesorId,
				id: indefinida.id,
				indefinida: true,
				datos: {
					nombre: a.nombre,
					motivo: indefinida.motivo,
					desde: "",
					hasta: "",
					suplente: "",
					indefinida: { aMedias: !!indefinida.reactivacionIniciadaAt },
				},
			});
			return;
		}
		const c = coberturaVigente(coberturas, a.userId, hoy);
		if (!c) return;
		setPorReactivar({
			asesorId: a.asesorId,
			id: c.id,
			indefinida: false,
			datos: {
				nombre: a.nombre,
				motivo: c.motivo,
				desde: c.desde,
				hasta: c.hasta,
				suplente: nombrePorUsuario.get(c.suplenteId) ?? "el suplente",
			},
		});
	};

	const dialogos = (
		<>
			<ConfirmarReactivarDialog
				cobertura={porReactivar?.datos ?? null}
				pendiente={mutacion.isPending}
				onConfirmar={() =>
					porReactivar &&
					mutacion.mutate({
						id: porReactivar.id,
						indefinida: porReactivar.indefinida,
					})
				}
				onCerrar={() => setPorReactivar(null)}
			/>
			<AsesorReactivadoDialog
				nombre={reactivado}
				resultado={resultado}
				onCerrar={() => {
					setReactivado(null);
					setResultado(null);
				}}
			/>
		</>
	);

	return {
		pedir,
		/** Asesor cuya reactivación está en curso (para el botón de su tarjeta). */
		reactivandoId: mutacion.isPending ? (porReactivar?.asesorId ?? null) : null,
		dialogos,
	};
}
