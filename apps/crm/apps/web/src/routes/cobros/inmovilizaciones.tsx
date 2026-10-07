import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * La cola de apagado y reactivación de unidades (CB-041) es ahora parte de la
 * bandeja única de Solicitudes: los pendientes en el chip «Apagado» (y
 * «Reactivación»), los aprobados sin ejecutar en «Por ejecutar» y el
 * historial completo (decidido por, ejecutado por, evidencia y ubicación) en
 * la pestaña Historial. La ruta se conserva para los enlaces guardados.
 */
export const Route = createFileRoute("/cobros/inmovilizaciones")({
	beforeLoad: ({ location }) => {
		const search = location.search as Record<string, unknown>;
		throw redirect({
			to: "/cobros/solicitudes",
			search: {
				tipo: "apagado",
				...(search.tab === "historial" ? { tab: "historial" as const } : {}),
			},
			replace: true,
		});
	},
});
