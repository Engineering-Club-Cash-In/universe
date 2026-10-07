import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Las solicitudes de recuperación del vehículo (CB-043) son ahora parte de la
 * bandeja única de Solicitudes: las que esperan aprobación en el chip
 * «Recuperación del vehículo» (con el checklist y la regla de cuatro ojos en
 * el Espacio de aprobación) y las decididas en la pestaña Historial, con su
 * filtro de estado. La ruta se conserva para los enlaces guardados.
 */
export const Route = createFileRoute("/cobros/recuperaciones")({
	beforeLoad: ({ location }) => {
		const search = location.search as Record<string, unknown>;
		throw redirect({
			to: "/cobros/solicitudes",
			search: {
				tipo: "recuperacion",
				...(search.tab === "historial" ? { tab: "historial" as const } : {}),
			},
			replace: true,
		});
	},
});
