import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type * as React from "react";
import { useState } from "react";
import { orpc } from "@/utils/orpc";
import {
	type CierreFila,
	CierreVista,
	type DetalleCierreItem,
	DetalleCierreVista,
	hoyGT,
	lunesDeEstaSemanaGT,
} from "./cierre-vista";

/**
 * Contenedor de «Mi equipo» › Día › Cierre: `getCierreDiarioPorRango` y, por
 * asesor expandido, `getDetalleCierrePorAsesor`, igual que la página vieja
 * `/cobros/cierre`.
 */
export function CierreDiario({
	habilitado,
	selector,
}: {
	habilitado: boolean;
	/** Selector Apertura / Cierre / Gestiones, en el encabezado de la vista. */
	selector?: React.ReactNode;
}) {
	const [rango, setRango] = useState(() => ({
		inicio: lunesDeEstaSemanaGT(),
		fin: hoyGT(),
	}));
	const [asesorId, setAsesorId] = useState<string>("todos");
	const [abierto, setAbierto] = useState<string | null>(null);

	const query = useQuery({
		...orpc.getCierreDiarioPorRango.queryOptions({
			input: { fechaInicio: rango.inicio, fechaFin: rango.fin },
		}),
		enabled: habilitado,
	});

	// Solo asesores con cierre generado en el rango elegido — no el catálogo
	// completo de usuarios de cobros (la mayoría no tendría filas que mostrar).
	const asesoresConCierre = (query.data ?? []) as CierreFila[];
	const filas = asesoresConCierre.filter(
		(f) => asesorId === "todos" || f.asesorId === asesorId,
	);

	return (
		<CierreVista
			filas={filas}
			asesoresConCierre={asesoresConCierre}
			fechaInicio={rango.inicio}
			fechaFin={rango.fin}
			onRango={setRango}
			asesorId={asesorId}
			onAsesor={setAsesorId}
			abierto={abierto}
			onToggle={(id) => setAbierto(abierto === id ? null : id)}
			cargando={query.isPending}
			recargando={query.isFetching && !query.isPending}
			error={query.isError}
			onReintentar={() => query.refetch()}
			selector={selector}
			renderDetalle={(fila) => (
				<DetalleCierreAsesor
					asesorId={fila.asesorId}
					fechaInicio={rango.inicio}
					fechaFin={rango.fin}
				/>
			)}
		/>
	);
}

function DetalleCierreAsesor({
	asesorId,
	fechaInicio,
	fechaFin,
}: {
	asesorId: string;
	fechaInicio: string;
	fechaFin: string;
}) {
	const navigate = useNavigate();
	const detalle = useQuery({
		...orpc.getDetalleCierrePorAsesor.queryOptions({
			input: { asesorId, fechaInicio, fechaFin },
		}),
		// Es snapshot ya generado por el job (no dato vivo) — no hace falta
		// refetch al cerrar/reabrir la misma fila. Mismo criterio que reportes.tsx.
		staleTime: 5 * 60 * 1000,
	});
	return (
		<DetalleCierreVista
			cargando={detalle.isPending}
			items={(detalle.data ?? []) as unknown as DetalleCierreItem[]}
			onAbrirCaso={(id) =>
				navigate({
					to: "/cobros/$id",
					params: { id },
					search: { tipo: "caso" },
				})
			}
		/>
	);
}
