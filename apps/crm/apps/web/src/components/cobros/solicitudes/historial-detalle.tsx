/**
 * Detalle de una fila del Historial al abrirla. La bitácora trae quién pidió,
 * quién decidió, el motivo, la nota y lo propio de cada tipo (montos de la
 * rebaja, nota para Jurídico, bucket, documento, plan de la contrapropuesta,
 * asesor de origen…). Solo la ubicación y la evidencia del apagado y el
 * checklist de la recuperación salen de la consulta de su tipo, acotada al día
 * de la decisión. Mientras carga, o si la fila no aparece, se muestra lo de la
 * bitácora.
 */
import { useQuery } from "@tanstack/react-query";
import type * as React from "react";
import { orpc } from "@/utils/orpc";
import { diaGT, type EntradaHistorial } from "./historial";
import {
	DetalleInmovilizacion,
	DetalleRecuperacion,
} from "./historial-decisiones";
import type {
	InmovilizacionHistorialFuente,
	RecuperacionFuente,
} from "./normalizar";

/** Filas que se leen por día (un día con más decisiones de un tipo es raro). */
const FILAS_POR_DIA = 100;

type Props = { entrada: EntradaHistorial; base: React.ReactNode };

function Cargando({ base }: { base: React.ReactNode }) {
	return (
		<div className="flex flex-col gap-2" aria-busy>
			{base}
			<p className="type-caption text-fg-tertiary">Cargando el detalle…</p>
		</div>
	);
}

function DetalleInmovilizacionConectado({ entrada, base }: Props) {
	const o = entrada.origen;
	const dia = diaGT(entrada.fecha);
	const consulta = useQuery({
		...orpc.getHistorialInmovilizaciones.queryOptions({
			input: {
				page: 1,
				perPage: FILAS_POR_DIA,
				accion: o?.tipo === "reactivacion" ? "reactivacion" : "apagado",
				...(dia ? { desde: dia, hasta: dia } : {}),
				...(o?.solicitanteId ? { solicitanteId: o.solicitanteId } : {}),
			},
		}),
		enabled: !!o,
		staleTime: 60_000,
	});
	if (consulta.isPending) return <Cargando base={base} />;
	const item = (
		(consulta.data?.items ?? []) as unknown as InmovilizacionHistorialFuente[]
	).find((i) => i.id === o?.refId);
	return item ? <DetalleInmovilizacion i={item} /> : base;
}

function DetalleRecuperacionConectado({ entrada, base }: Props) {
	const o = entrada.origen;
	const dia = diaGT(entrada.fecha);
	const consulta = useQuery({
		...orpc.getHistorialSolicitudesRecuperacion.queryOptions({
			input: {
				page: 1,
				perPage: FILAS_POR_DIA,
				...(dia ? { desde: dia, hasta: dia } : {}),
				...(o?.solicitanteId ? { solicitanteId: o.solicitanteId } : {}),
			},
		}),
		enabled: !!o,
		staleTime: 60_000,
	});
	if (consulta.isPending) return <Cargando base={base} />;
	const item = (
		(consulta.data?.items ?? []) as unknown as RecuperacionFuente[]
	).find((r) => r.id === o?.refId);
	return item ? <DetalleRecuperacion r={item} /> : base;
}

/** El `DetalleExtra` del Historial de /cobros/solicitudes. */
export function DetalleHistorialConectado(props: Props) {
	switch (props.entrada.origen?.tipo) {
		case "apagado":
		case "reactivacion":
			return <DetalleInmovilizacionConectado {...props} />;
		case "recuperacion":
			return <DetalleRecuperacionConectado {...props} />;
		// Rebajas (montos), Jurídico (nota y bucket), documentos y lo demás ya
		// vienen completos en la bitácora.
		default:
			return <>{props.base}</>;
	}
}
