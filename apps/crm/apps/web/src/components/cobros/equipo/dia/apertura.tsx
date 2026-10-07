import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type * as React from "react";
import { useState } from "react";
import { useBucketsCatalogo } from "@/lib/cobros/buckets-catalogo";
import { orpc } from "@/utils/orpc";
import { type AperturaResponse, AperturaVista } from "./apertura-vista";

/**
 * Contenedor de «Mi equipo» › Día › Apertura: `getAperturaDia({fecha?})`
 * (supervisión, cartera-back) y el catálogo de buckets, igual que la página
 * vieja `/cobros/apertura`.
 */
export function AperturaDia({
	habilitado,
	selector,
}: {
	habilitado: boolean;
	/** Selector Apertura / Cierre / Gestiones, en el encabezado de la vista. */
	selector?: React.ReactNode;
}) {
	const navigate = useNavigate();
	const catalogo = useBucketsCatalogo().data;
	// Fecha en YYYY-MM-DD (por defecto hoy GT, lo resuelve el server). El
	// supervisor puede mirar días pasados.
	const [fecha, setFecha] = useState<string>("");

	const query = useQuery({
		...orpc.getAperturaDia.queryOptions({
			input: fecha ? { fecha } : {},
		}),
		enabled: habilitado,
	});

	return (
		<AperturaVista
			apertura={query.data as AperturaResponse | undefined}
			catalogo={catalogo}
			fecha={fecha}
			onFecha={setFecha}
			cargando={query.isPending}
			recargando={query.isFetching && !query.isPending}
			error={query.isError}
			onReintentar={() => query.refetch()}
			selector={selector}
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
