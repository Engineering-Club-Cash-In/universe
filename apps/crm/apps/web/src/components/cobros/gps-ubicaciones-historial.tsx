import { keepPreviousData, skipToken, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { HistorialFrecuentes } from "@/components/cobros/ubicaciones/frecuentes-vista";
import { orpc } from "@/utils/orpc";

const POR_PAGINA = 20;
const MAX_CONSULTAS = 100;

/**
 * Consultas anteriores de ubicaciones clave de este vehículo (quién, cuándo,
 * con qué motivo y lo que se mostró), para verlas sin volver a pedirlas con un
 * motivo. Ver una consulta anterior no es una consulta nueva: no pide motivo
 * ni audita (ver `getUbicacionesConsultasCaso` en el server). La consulta en
 * vivo lo invalida al terminar.
 */
export function useHistorialUbicaciones({
	casoCobroId,
	vehicleId,
	habilitado = true,
}: {
	casoCobroId: string;
	vehicleId: string;
	habilitado?: boolean;
}) {
	const [limite, setLimite] = useState(POR_PAGINA);

	const consultas = useQuery(
		orpc.getUbicacionesConsultasCaso.queryOptions({
			input: habilitado ? { casoCobroId, vehicleId, limit: limite } : skipToken,
			placeholderData: keepPreviousData,
		}),
	);

	const total = consultas.data?.length ?? 0;
	const historial: HistorialFrecuentes = consultas.isError
		? {
				estado: "error",
				mensaje: consultas.error?.message,
				onReintentar: () => void consultas.refetch(),
			}
		: consultas.data
			? { estado: "listo", entradas: consultas.data }
			: { estado: "cargando" };

	return {
		historial,
		dataUpdatedAt: consultas.dataUpdatedAt,
		paginacion: {
			hayMas: total >= limite && limite < MAX_CONSULTAS,
			limiteAlcanzado: total >= MAX_CONSULTAS,
			cargandoMas: consultas.isPlaceholderData,
			onPedirMas: () =>
				setLimite((l) => Math.min(l + POR_PAGINA, MAX_CONSULTAS)),
		},
	};
}
