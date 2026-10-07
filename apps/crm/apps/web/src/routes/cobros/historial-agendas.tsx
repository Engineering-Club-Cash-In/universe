import { createFileRoute, Navigate, redirect } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { HistorialGestiones } from "@/components/cobros/historial/historial-gestiones";
import { authClient } from "@/lib/auth-client";
import { PERMISSIONS } from "@/lib/roles";

/**
 * /cobros/historial-agendas (CB-128).
 *
 * - **Supervisión y admin** (`canAssignCobros`, los dos por igual): el
 *   Historial de gestiones del equipo vive ahora en Mi equipo › Día ›
 *   Gestiones, y el «Cumplimiento de agenda» de cada asesor en su detalle
 *   (Mi equipo › asesor › pestaña Agenda, con navegación por día). La ruta se
 *   conserva y redirige, para que los enlaces guardados sigan funcionando.
 * - **El asesor** (rol cobros) sigue viendo aquí sus propias gestiones, como
 *   siempre (el server fuerza el alcance por `realizado_por`).
 */

/** Destino de supervisión: Mi equipo › Día › Gestiones. */
const DESTINO_SUPERVISION = {
	to: "/cobros/equipo",
	search: { tab: "dia", vista: "gestiones" },
} as const;

export const Route = createFileRoute("/cobros/historial-agendas")({
	beforeLoad: async () => {
		const sesion = await authClient.getSession().catch(() => null);
		const rol = sesion?.data?.user?.role;
		if (rol && PERMISSIONS.canAssignCobros(rol)) {
			throw redirect({
				// La ruta y sus search params los declara Mi equipo (otra pantalla).
				to: DESTINO_SUPERVISION.to as never,
				search: DESTINO_SUPERVISION.search as never,
				replace: true,
			});
		}
	},
	component: HistorialAgendasPage,
});

function HistorialAgendasPage() {
	const { data: session, isPending: sesionCargando } = authClient.useSession();
	// Esperar a que la sesión resuelva antes de decidir: con el rol todavía
	// `undefined` se montaría la vista del asesor y, si en realidad es
	// supervisor, se desmontaría al resolver (consultas de más y filtros
	// perdidos). Mismo patrón ya corregido en c185579bc.
	if (sesionCargando) {
		return (
			<div className="flex min-h-screen items-center justify-center text-gray-500">
				<Loader2 className="mr-2 h-5 w-5 animate-spin" />
				Cargando…
			</div>
		);
	}
	// Respaldo del `beforeLoad` (si la sesión no se pudo leer ahí).
	const rol = session?.user?.role;
	if (rol && PERMISSIONS.canAssignCobros(rol)) {
		return (
			<Navigate
				to={DESTINO_SUPERVISION.to as never}
				search={DESTINO_SUPERVISION.search as never}
				replace
			/>
		);
	}
	return <HistorialGestiones />;
}
