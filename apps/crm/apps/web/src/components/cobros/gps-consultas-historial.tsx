import { keepPreviousData, skipToken, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { HistorialGps } from "@/components/cobros/ubicaciones/gps-ubicacion-vista";
import { orpc } from "@/utils/orpc";

const POR_PAGINA = 20;
const MAX_CONSULTAS = 100;

/**
 * Consultas GPS de este vehículo (quién, cuándo, con qué motivo y lo que
 * respondió Wialon), para la pestaña GPS / Wialon de la Ficha 360.
 *
 * Lee `gps_consulta_logs`: cada consulta de telemetría guarda su respuesta
 * (`snapshot`), así que la última ubicación se ve sin volver a consultar.
 * Mismo acceso que la consulta en vivo (caso + vehículo + cartera), pero leer
 * el historial no es una consulta nueva: no pide motivo ni audita (ver
 * `getGpsConsultasCaso` en el server). La consulta en vivo lo invalida al
 * terminar, para que su fila aparezca.
 */
export function useHistorialConsultasGps({
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
		orpc.getGpsConsultasCaso.queryOptions({
			input: habilitado ? { casoCobroId, vehicleId, limit: limite } : skipToken,
			// Al pedir más, se queda la lista actual en pantalla en vez de parpadear.
			placeholderData: keepPreviousData,
		}),
	);

	// El límite cuenta consultas (filas), no entradas: una entrada puede agrupar
	// varias. Para saber si puede haber más se suman las de cada entrada.
	const totalConsultas =
		consultas.data?.reduce((n, e) => n + e.consultas.length, 0) ?? 0;

	const historial: HistorialGps = consultas.isError
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
			// Si llegó justo al límite pedido, puede haber más.
			hayMas: totalConsultas >= limite && limite < MAX_CONSULTAS,
			limiteAlcanzado: totalConsultas >= MAX_CONSULTAS,
			cargandoMas: consultas.isPlaceholderData,
			onPedirMas: () =>
				setLimite((l) => Math.min(l + POR_PAGINA, MAX_CONSULTAS)),
		},
	};
}
